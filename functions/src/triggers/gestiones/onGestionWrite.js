// Máquina de estados de las gestiones por cliente (Ola 2 — reemplazo y demo).
// docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md §4.4.
//
// Reacciona a escrituras en gestiones/{gid}:
//   A) creada pendiente_aprobacion → correo a administradores (excepción por
//      servicio al cliente: propio sin garantía — decisión 2026-08-26 §8.1).
//   B) creada / aprobada → pendiente_bodega → correo a Bodega para asignar.
//   C) asignación COMPLETA (todos los ítems con serial) → mueve los entrantes
//      en el pool (asignados a la gestión, heredando el contrato del saliente),
//      crea la(s) OS de PROGRAMACIÓN (una por contrato afectado) y avisa a
//      Recepción con copia al vendedor del cliente. cierre.asignacion = true.
//   D) las 4 condiciones de cierre en true → estado 'cerrada' + correo al
//      responsable. La solicitud se cierra SOLA (correo de Zuleika, punto 10).
// La entrega y la entrada las estampa onOrdenWriteGestion (la gestión avanza
// desde las órdenes — cero botones extra). Todo idempotente: cada bloque
// verifica el flanco y las marcas antes de actuar.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const pool = require("../../domain/equiposPool");
const G = require("../../lib/gestiones");

// Condiciones de cierre por tipo. Reemplazo/demo: las 4 del correo de Zuleika.
// Baja (Ola 3): aprobación → derivación (fin de facturación aplicado y
// devolución creada) → entrada (check-in resuelto).
const CIERRE_POR_TIPO = {
  reemplazo: ["asignacion", "programacion", "entrega", "entrada"],
  demo: ["asignacion", "programacion", "entrega", "entrada"],
  // Baja: `derivacion` (fin de facturación) se estampa igual pero NO bloquea el
  // cierre — la facturación aún no corre en la plataforma (Alberto 2026-08-27):
  // es placeholder para cuando corra.
  baja: ["aprobacion", "entrada"],
  // Aumento por enmienda FIRMADA (decisión §8.2): aprobación comercial →
  // firma del cliente en el anexo → derivación (líneas con tramo propio en el
  // contrato) → asignación → programación → entrega. Sin entrada: no sale nada.
  aumento: ["aprobacion", "firma", "derivacion", "asignacion", "programacion", "entrega"],
};

function asignacionCompleta(g) {
  if (g.tipo === "reemplazo") {
    const items = g.items || [];
    return items.length > 0 && items.every(it => String(it.serial_nuevo || "").trim());
  }
  if (g.tipo === "demo") {
    const total = (g.demo?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const asignados = (g.demo?.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
    return total > 0 && asignados >= total;
  }
  if (g.tipo === "aumento") {
    // 2026-09-03 (Zuleika, segunda vuelta): la firma del anexo NO frena la OS —
    // programación arranca apenas bodega complete los seriales, y el punto duro
    // es la ENTREGA (rules + UI exigen cierre.firma). Antes se exigía aquí
    // cierre.derivacion y el proceso entero esperaba al cliente.
    const total = (g.aumento?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const asignados = (g.aumento?.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
    return total > 0 && asignados >= total;
  }
  return false;
}

async function correoAdmins(gid, g) {
  // Regla 2026-08-28: TODA solicitud de aprobación va SOLO a
  // ventas@cecomunica.com — ese buzón ES el de los aprobadores (sin copias
  // individuales: llegaría dos veces).
  const items = (g.items || []).filter(it => it.elegibilidad === "propio_excepcion");
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: null,
    subject: `Aprobación requerida: ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid} — ${g.cliente_nombre || "Cliente"}`,
    preheader: "Reemplazo de equipo propio sin garantía vigente (excepción por servicio al cliente)",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Gestión esperando aprobación</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> incluye
        equipo(s) <b>propios sin garantía vigente</b>: el reemplazo procede como excepción por servicio
        al cliente y requiere aprobación de un administrador antes de que Bodega asigne.
      </p>
      ${G.tablaHtml(["Serial", "Modelo", "Motivo"], (items.length ? items : (g.items || [])).map(it => [
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo || "—"),
        G.escapeHtml(it.motivo_detalle || it.motivo_codigo || "—"),
      ]))}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Revisar y aprobar",
    meta: { gestion_id: gid, paso: "aprobacion" },
  });
}

// Baja por serial: UNA sola aprobación por gestión, con el desglose claro de
// qué contrato aporta cada equipo y su penalidad (decisión §8.10).
async function correoAprobadoresBaja(gid, g) {
  // Regla 2026-08-28: la solicitud va SOLO a ventas@cecomunica.com (ese buzón
  // es el de los aprobadores — sin copias que dupliquen).
  const filas = (g.items || []).map(it => [
    `<code>${G.escapeHtml(it.serial_saliente || it.serial || "—")}</code>`,
    G.escapeHtml(it.modelo || "—"),
    `<code>${G.escapeHtml(it.contrato_id || "—")}</code>`,
    G.escapeHtml(it.motivo_detalle || it.motivo_codigo || g.motivo_codigo || "—"),
  ]);
  const terminacion = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
  const cartaLinea = g.carta_path
    ? `<p style="margin:0 0 12px;font:13px Arial,sans-serif;color:#065F46;">✓ Carta de solicitud del cliente adjunta${g.fecha_nota_cliente ? ` (nota del ${G.escapeHtml(g.fecha_nota_cliente)})` : ""}.</p>`
    : `<p style="margin:0 0 12px;font:13px Arial,sans-serif;color:#b91c1c;"><b>Falta la carta de solicitud del cliente</b> — la aprobación queda bloqueada hasta adjuntarla.</p>`;
  const pen = g.penalidad_estimada;
  const penHtml = pen?.por_contrato?.length
    ? `<p style="margin:12px 0 4px;font:14px/1.5 Arial,sans-serif;"><b>Liquidación estimada por contrato — 3 meses de mensualidad en cualquier caso, cobro inmediato</b>
        (vencido: 60 días de preaviso con servicio activo + 30 de penalidad):</p>`
      + G.tablaHtml(["Contrato", "Base", "Penalidad est."], pen.por_contrato.map(p => [
          `<code>${G.escapeHtml(p.contrato_id || "—")}</code>`,
          G.escapeHtml(p.detalle || "—"),
          `<b>$${Number(p.monto || 0).toFixed(2)}</b>`,
        ]))
      + `<p style="margin:4px 0 0;font:13px Arial,sans-serif;">Total estimado: <b>$${Number(pen.total || 0).toFixed(2)}</b></p>`
    : "";
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: null,
    subject: `Aprobación requerida: ${terminacion ? "TERMINACIÓN TOTAL" : "baja"} de ${(g.items || []).length} equipo(s) — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: terminacion ? "Terminación total de contrato — todos sus seriales se desconectan" : "Baja por serial; puede tocar varios contratos — una sola aprobación con desglose",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">${terminacion ? "Terminación total esperando aprobación" : "Baja de equipos esperando aprobación"}</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>
        ${terminacion ? `solicita la <b>terminación total</b> del contrato con la desconexión de todos sus seriales` : `solicita la baja de los siguientes equipos (el desglose indica de qué contrato viene cada uno)`}.
        Al aprobar, el sistema crea de inmediato la orden de devolución <b>por serial</b> (los equipos propios
        del cliente no se recuperan) y deja registrado el fin de facturación.
      </p>
      ${cartaLinea}
      ${G.tablaHtml(["Serial", "Modelo", "Contrato", "Motivo"], filas)}
      ${penHtml}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Revisar y aprobar",
    meta: { gestion_id: gid, paso: "aprobacion_baja" },
  });
}

// Aumento por enmienda: aprobación COMERCIAL previa al anexo (admin/gerencia).
// El detalle completo del anexo vive en G.detalleAumentoHtml (lib/gestiones)
// — compartido con los avisos de facturación y los correos de firma.
const detalleAumentoHtml = (a) => G.detalleAumentoHtml(a);

async function correoAprobadoresAumento(gid, g) {
  // Regla 2026-08-28: la solicitud va SOLO a ventas@cecomunica.com (el buzón
  // de los aprobadores).
  const a = g.aumento || {};
  const esAjuste = a.es_ajuste === true;
  const esReg = a.es_regularizacion === true;
  const etiqueta = esAjuste ? "ajuste de tarifa / servicios" : esReg ? "regularización de equipos en campo" : "aumento de equipos";
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: null,
    subject: `Aprobación comercial: ${etiqueta} — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: esAjuste
      ? `Anexo al contrato ${a.contrato_id || "—"}: solo cargos/tarifas — sin bodega`
      : `Enmienda al contrato ${a.contrato_id || "—"} con vigencia propia (${a.duracion_meses || "?"} meses)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">${esAjuste ? "Ajuste de tarifa esperando aprobación" : esReg ? "Regularización esperando aprobación" : "Aumento esperando aprobación comercial"}</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> propone un anexo al contrato
        <b>${G.escapeHtml(a.contrato_id || "—")}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>.
        ${esAjuste
          ? `Al aprobar, el cliente firma el anexo y el ajuste <b>se aplica solo</b> — no pasa por bodega ni genera entrega.`
          : esReg
          ? `Los equipos <b>ya están en poder del cliente</b>: al firmarse, quedan amarrados al contrato de una vez, sin bodega ni entrega.`
          : `Vigencia propia de <b>${G.escapeHtml(String(a.duracion_meses || "?"))} meses</b> desde la entrega.
             Al aprobar, el cliente firma el anexo y recién entonces el sistema aplica las líneas y
             pide los seriales a Bodega.`}
      </p>
      ${detalleAumentoHtml(a)}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Revisar y aprobar",
    meta: { gestion_id: gid, paso: "aprobacion_aumento" },
  });
}

// `anticipo`: el aumento acaba de APROBARSE y la firma del anexo corre en
// paralelo (2026-09-03, planteamiento de Zuleika: la firma no debe frenar la
// preparación) — bodega puede asignar desde ya; la OS solo sale al firmarse.
async function correoBodega(gid, g, { anticipo = false } = {}) {
  const to = await G.bodegaEmailTo();
  if (!to) {
    logger.warn("[onGestionWrite] sin buzón de bodega (email_bodega) — gestión sin aviso", { gid });
    return;
  }
  const filas = g.tipo === "reemplazo"
    ? (g.items || []).map(it => [
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo || "—"),
        G.escapeHtml(it.modelo_solicitado || it.modelo || "—"),
        G.escapeHtml(it.motivo_detalle || it.motivo_codigo || "—"),
      ])
    : g.tipo === "aumento"
      ? (g.aumento?.lineas || []).map(l => [
          `${Number(l.cantidad || 0)}`,
          G.escapeHtml(l.modelo || "—"),
          `Aumento — contrato ${G.escapeHtml(g.aumento?.contrato_id || "—")}`, "",
        ])
      : (g.demo?.lineas || []).map(l => [
          `${Number(l.cantidad || 0)}`,
          G.escapeHtml(l.modelo || "—"),
          G.escapeHtml(g.demo?.finalidad || "—"), "",
        ]);
  const queEspera = g.tipo === "reemplazo"
    ? "el serial del equipo que sustituye a cada radio"
    : g.tipo === "aumento"
      ? "los seriales del aumento"
      : "los seriales del demo (stock nuevo o refurbished)";
  await G.encolarCorreo({
    to,
    subject: `${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}: asignar serial(es)${anticipo ? " (firma del anexo en paralelo)" : ""} — ${g.cliente_nombre || "Cliente"}`,
    preheader: g.tipo === "reemplazo"
      ? `Asignar ${(g.items || []).length} equipo(s) de reemplazo`
      : g.tipo === "aumento"
        ? `Asignar los equipos del aumento`
        : `Asignar equipos para demo (nuevo o refurbished)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">${G.escapeHtml(G.TIPO_LABEL[g.tipo] || g.tipo)} — asignación de equipos</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> espera
        que Bodega asigne ${queEspera}.
        ${anticipo
          ? "El anexo quedó <b>aprobado</b> y la firma del cliente se está consiguiendo <b>en paralelo</b> — puedes asignar los seriales desde ya. La orden de programación saldrá sola cuando el anexo esté firmado."
          : "Al completar la asignación, el sistema crea solo la orden de programación y avisa a Recepción."}
      </p>
      ${g.tipo === "reemplazo"
        ? G.tablaHtml(["Sale", "Modelo actual", "Modelo solicitado", "Motivo"], filas)
        : G.tablaHtml(["Cantidad", "Modelo", g.tipo === "aumento" ? "Detalle" : "Finalidad", ""], filas)}`,
    ctaUrl: G.urlBodegaGestion(gid),
    ctaLabel: "Asignar seriales",
    meta: { gestion_id: gid, paso: anticipo ? "bodega_anticipo" : "bodega" },
  });
}

// Los seriales del aumento ya están completos (pre-asignados durante la firma):
// misma cuenta que asignacionCompleta, sin exigir cierre.derivacion.
function serialesAumentoCompletos(g) {
  const total = (g.aumento?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
  const asignados = (g.aumento?.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
  return total > 0 && asignados >= total;
}

async function correoRecepcion(gid, g, ordenIds) {
  const dests = await G.destinatariosRecepcionVendedor(g.cliente_id);
  if (!dests.length) {
    logger.warn("[onGestionWrite] OS de programación sin destinatarios", { gid, ordenIds });
    return;
  }
  const pares = g.tipo === "reemplazo"
    ? (g.items || []).map(it => [
        `<code>${G.escapeHtml(it.serial_nuevo || "—")}</code>`,
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo_solicitado || it.modelo || "—"),
      ])
    : ((g.tipo === "aumento" ? g.aumento?.seriales_asignados : g.demo?.seriales_asignados) || []).map(s => [
        `<code>${G.escapeHtml(s.serial || "—")}</code>`, "—", G.escapeHtml(s.modelo || "—"),
      ]);
  // Aumento pre-asignado (2026-09-03): la OS sale con el anexo aún en firma —
  // programar se puede desde ya; la ENTREGA queda candada hasta cierre.firma.
  const firmaEnParalelo = g.tipo === "aumento" && g.estado === "pendiente_firma"
    && g.cierre?.firma !== true;
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
    subject: `OS de programación lista: ${ordenIds.join(", ")} — ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}`,
    preheader: g.tipo === "reemplazo"
      ? "Programar copiando la configuración del radio reemplazado"
      : g.tipo === "aumento"
        ? (firmaEnParalelo ? "Programar desde ya — la entrega espera la firma del anexo" : "Programar los equipos del aumento")
        : "Programar los equipos del demo",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden(es) de programación creada(s)</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Bodega asignó los equipos de la gestión <b>${G.escapeHtml(gid)}</b>
        (<b>${G.escapeHtml(g.cliente_nombre || "—")}</b>) y el sistema creó la(s) orden(es)
        <b>${ordenIds.map(G.escapeHtml).join(", ")}</b>.
        ${g.tipo === "reemplazo"
          ? "Cada equipo indica el serial que sustituye: <b>copia su configuración, coloca su ID y confirma</b>."
          : g.tipo === "aumento"
            ? "Programar los equipos nuevos del aumento y coordinar la entrega."
            : "Programar y coordinar la entrega del demo."}
      </p>
      ${firmaEnParalelo ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;background:#FEF3C7;border-radius:6px;padding:10px 12px;">
        ⚠️ La <b>firma del anexo corre en paralelo</b>: se puede programar desde ya, pero la
        <b>entrega no sale</b> hasta que el cliente firme (el sistema la bloquea solo).</p>` : ""}
      ${G.tablaHtml(["Entra", "Sustituye a", "Modelo"], pares)}`,
    ctaUrl: `${APP_BASE_URL}/ordenes/index.html?ids=${encodeURIComponent(ordenIds.join(","))}`,
    ctaLabel: "Ver la(s) orden(es)",
    meta: { gestion_id: gid, paso: "programacion", ordenes: ordenIds.join(",") },
  });
}

module.exports = onDocumentWritten(
  { document: "gestiones/{gid}", region: "us-central1" },
  async (event) => {
    const gid = event.params.gid;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return null;
    if (!["reemplazo", "demo", "baja", "aumento"].includes(after.tipo)) return null; // devolución/cambio_serial: ola 5
    if (["cerrada", "anulada"].includes(after.estado) && before?.estado === after.estado) return null;

    const creada = !before;
    const ref = event.data.after.ref;

    // ── A0) ANULADA → revertir los efectos regados (caso P223344) ────────
    // Órdenes creadas sin trabajar se eliminan; flags del pool se limpian;
    // derivados de baja se recalculan; el aumento sin entregar se retira del
    // contrato. Lo físico (entregas/check-ins) NUNCA se deshace solo.
    if (before && before.estado !== "anulada" && after.estado === "anulada") {
      try {
        await G.limpiarAnulacion(gid, after);
      } catch (e) {
        logger.error("[onGestionWrite] limpieza de anulación falló", { gid, message: e.message });
      }
      return null;
    }

    // ── A/B) correos de arranque, por flanco de estado ──────────────────
    try {
      if (creada && after.estado === "pendiente_aprobacion") {
        if (after.tipo === "baja") {
          await correoAprobadoresBaja(gid, after);
          await G.registrarEvento(gid, "correo_aprobacion", "Correo de aprobación enviado a administración y gerencia (baja por serial).");
        } else if (after.tipo === "aumento") {
          await correoAprobadoresAumento(gid, after);
          await G.registrarEvento(gid, "correo_aprobacion", "Correo de aprobación comercial enviado a administración y gerencia (aumento por enmienda).");
        } else {
          await correoAdmins(gid, after);
          await G.registrarEvento(gid, "correo_aprobacion", "Correo de aprobación enviado a administradores (excepción propio sin garantía).");
        }
      }
      // Aumento APROBADO comercialmente → aviso ANTICIPADO a bodega
      // (2026-09-03, planteamiento de Zuleika: la firma no debe frenar la
      // preparación): bodega asigna los seriales MIENTRAS el vendedor consigue
      // la firma del anexo, y al completarse la asignación la OS sale de una
      // vez (sección C corre también en pendiente_firma) para que programación
      // avance. El único punto duro es la ENTREGA: rules + UI exigen
      // cierre.firma. Regularización/ajuste no pasan por bodega.
      const aumentoAprobado = after.tipo === "aumento"
        && after.estado === "pendiente_firma"
        && before && before.estado === "pendiente_aprobacion"
        && after.aumento?.es_regularizacion !== true
        && after.aumento?.es_ajuste !== true;
      if (aumentoAprobado) {
        await correoBodega(gid, after, { anticipo: true });
        await G.registrarEvento(gid, "correo_bodega",
          "Aviso anticipado a Bodega: puede asignar los seriales mientras se consigue la firma del anexo.");
      }
      // Un anexo de REGULARIZACIÓN no pasa por bodega: los equipos ya están
      // con el cliente (B3 los amarra directo al firmarse). Un aumento cuyos
      // seriales ya quedaron pre-asignados durante la firma tampoco recibe el
      // segundo correo: a bodega no le queda nada que hacer y la OS sale sola
      // unos segundos después (sección C de este mismo flanco).
      const entraABodega = after.tipo !== "baja" && after.aumento?.es_regularizacion !== true
        && after.aumento?.es_ajuste !== true && (
        (creada && after.estado === "pendiente_bodega") ||
        (before && ["pendiente_aprobacion", "pendiente_firma"].includes(before.estado)
          && after.estado === "pendiente_bodega"));
      if (entraABodega && !(after.tipo === "aumento" && serialesAumentoCompletos(after))) {
        await correoBodega(gid, after);
        await G.registrarEvento(gid, "correo_bodega", "Aviso enviado a Bodega para asignar seriales.");
      }
    } catch (e) {
      logger.error("[onGestionWrite] correos de arranque fallaron", { gid, message: e.message });
    }

    // ── B2) BAJA aprobada → derivados por contrato + devolución por serial ─
    // La aprobación (una sola por gestión, decisión §8.10) la estampa la UI:
    // estado pendiente_aprobacion → en_proceso + cierre.aprobacion. Aquí corre
    // el efecto: recalcular baja_cancelado/fecha_fin en CADA contrato afectado
    // (lib compartida con onCancelacionWrite — no se pisan), marcar los
    // salientes pendiente_devolucion y crear la orden de DEVOLUCIÓN por serial
    // (se acabó adivinar unidades por modelo).
    // Por NIVEL con lectura fresca (2026-08-31): el flanco de estado se
    // consumía aunque la derivación fallara a medias y la baja quedaba
    // aprobada sin devolución PARA SIEMPRE. Idempotencia: cierre.derivacion;
    // el get fresco evita duplicar la devolución si el evento se re-entrega
    // con un snapshot viejo.
    try {
      let gB = null;
      if (after.tipo === "baja" && after.estado === "en_proceso" && !after.cierre?.derivacion) {
        const fresco = await ref.get();
        const d = fresco.exists ? fresco.data() : null;
        if (d && d.estado === "en_proceso" && d.cierre?.aprobacion === true && !d.cierre?.derivacion) gB = d;
      }
      if (gB) {
        const { derivarBajaContrato } = require("../../lib/bajas");
        const contratos = Array.isArray(gB.contratos_afectados) ? gB.contratos_afectados : [];
        for (const cid of contratos) await derivarBajaContrato(cid);

        // Cargos amarrados por serial (2026-09-02, GPS): si un serial dado de
        // baja llevaba un servicio, el cargo del contrato baja SOLO — se quita
        // el serial y la cantidad sigue a seriales.length (un cargo que queda
        // en cero se elimina). Sin esto, el cargo quedaba huérfano cobrando
        // por un radio que ya no está.
        const bajados = new Set((gB.items || [])
          .map(it => String(it.serial_saliente || it.serial || "").trim()).filter(Boolean));
        if (bajados.size) {
          for (const cid of contratos) {
            try {
              await db.runTransaction(async (tx) => {
                const cs = await tx.get(db.collection("contratos").doc(cid));
                if (!cs.exists) return;
                const antes = Array.isArray(cs.data().cargos) ? cs.data().cargos : [];
                let tocado = false;
                const cargos = antes.map((cg) => {
                  if (!Array.isArray(cg.seriales) || !cg.seriales.length) return cg;
                  const rest = cg.seriales.filter((s) => !bajados.has(String(s)));
                  if (rest.length === cg.seriales.length) return cg;
                  tocado = true;
                  return { ...cg, seriales: rest, cantidad: rest.length };
                }).filter((cg) => !(Array.isArray(cg.seriales) && cg.seriales.length === 0 && Number(cg.cantidad) === 0));
                if (tocado) tx.set(db.collection("contratos").doc(cid), { cargos }, { merge: true });
              });
            } catch (e) {
              logger.warn("[onGestionWrite] descuento de cargos por serial falló", { gid, contrato: cid, message: e.message });
            }
          }
        }

        for (const it of (gB.items || [])) {
          const serial = String(it.serial_saliente || it.serial || "").trim();
          if (!serial) continue;
          // Regla heredada de enmiendas: los equipos PROPIOS son del cliente —
          // la baja solo corta el servicio, no se recuperan ni se marcan.
          if (it.propiedad === "cliente") continue;
          try {
            const r = await pool.resolver(serial, it.modelo_id || null, it.modelo || "");
            if (r.data) {
              await r.ref.set({
                pendiente_devolucion: true,
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
              await r.ref.collection("movimientos").add({
                at: admin.firestore.FieldValue.serverTimestamp(),
                por: "system", por_email: null,
                tipo: "baja", de_estado: null, a_estado: null,
                ref: { tipo: "gestion", id: gid, label: gid },
                notas: `Baja aprobada (${gid}) — pendiente de devolución`,
              });
            }
          } catch (e) {
            logger.warn("[onGestionWrite] saliente de baja no marcado", { gid, serial, message: e.message });
          }
        }

        // Aviso de facturación (2026-09-02): recepción necesita la FECHA DE
        // FIN de facturación al aprobarse — independiente de cuándo devuelvan.
        await G.avisoFacturacion({
          subject: `FACTURACIÓN: ${gB.terminacion_total_de?.length ? "TERMINACIÓN TOTAL aprobada" : "baja aprobada"} — ${gB.cliente_nombre || "Cliente"} (${gid})`,
          titulo: gB.terminacion_total_de?.length ? "Terminación total aprobada — fin de facturación" : "Baja de equipos aprobada — fin de facturación",
          cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              La ${gB.terminacion_total_de?.length ? "terminación total" : "baja"} <b>${G.escapeHtml(gid)}</b> de
              <b>${G.escapeHtml(gB.cliente_nombre || "—")}</b> quedó aprobada.
              ${gB.fecha_fin_facturacion ? `Fin de facturación: <b>${G.escapeHtml(String(gB.fecha_fin_facturacion))}</b>.` : "Fin de facturación según la fecha registrada en el expediente."}
              Los equipos de CECOMUNICA entran por la orden de devolución; los propios del cliente no se recuperan.</p>
            ${G.tablaHtml(["Serial", "Modelo", "Contrato"], (gB.items || []).map(it => [
              `<code>${G.escapeHtml(it.serial_saliente || it.serial || "—")}</code>`,
              G.escapeHtml(it.modelo || "—"),
              `<code>${G.escapeHtml(it.contrato_id || "—")}</code>`,
            ]))}
            ${gB.penalidad_estimada?.total ? `<p style="margin:8px 0 0;font:14px Arial,sans-serif;">Liquidación estimada: <b>$${Number(gB.penalidad_estimada.total || 0).toFixed(2)}</b></p>` : ""}`,
          cliente_id: gB.cliente_id, cliente_nombre: gB.cliente_nombre || "",
          responsable_uid: gB.responsable_uid || null, responsable_email: gB.responsable_email || null,
          ctaUrl: G.urlGestion(gB, gid), ctaLabel: "Ver el expediente",
          meta: { gestion_id: gid, paso: "facturacion_baja" },
        });

        const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");
        // Regla de enmiendas: los equipos PROPIOS (del cliente) no se recuperan.
        const recuperables = (gB.items || [])
          .filter(it => String(it.serial_saliente || it.serial || "").trim() && it.propiedad !== "cliente")
          .map(it => ({
            serial: it.serial_saliente || it.serial,
            modelo: it.modelo || "",
            modelo_id: it.modelo_id || null,
            pool_doc_id: it.pool_doc_id_saliente || null,
          }));
        const propias = (gB.items || []).length - recuperables.length;
        let devId = null;
        if (recuperables.length) {
          devId = await crearOrdenDevolucion({
            clienteId: gB.cliente_id,
            clienteNombre: gB.cliente_nombre || "",
            contratoDocId: contratos[0] || null,
            contratoId: (gB.items || []).find(i => i.contrato_id)?.contrato_id || null,
            contratoOrigenIds: contratos,
            modo: "recuperacion",
            origen: { tipo: "gestion_baja", ref_id: gid },
            unidades: recuperables,
            motivo: `${gB.terminacion_total_de?.length ? "Terminación total" : "Baja de equipos"} ${gid} — recuperar las unidades dadas de baja`,
          });
          if (devId) {
            await db.collection("ordenes_de_servicio").doc(devId).set({
              gestion: { id: gid, tipo: "baja" },
            }, { merge: true });
          }
        }
        await ref.set({
          cierre: {
            ...(gB.cierre || {}),
            derivacion: true,
            // Todo propio → no hay nada que recuperar: la entrada se da por
            // cumplida (la baja solo corta el servicio).
            ...(recuperables.length ? {} : { entrada: true }),
          },
          ordenes: { ...(gB.ordenes || {}), devolucion_id: devId || null },
        }, { merge: true });
        await G.registrarEvento(gid, "derivacion",
          `Baja aplicada en ${contratos.length} contrato(s): fin de facturación registrado`
          + (devId ? `; orden de devolución ${devId} creada por serial` : "")
          + (propias ? `; ${propias} equipo(s) propios del cliente quedan con él (sin recuperación)` : "")
          + (gB.terminacion_total_de?.length ? `; TERMINACIÓN TOTAL de ${gB.terminacion_total_de.length} contrato(s)` : "") + ".");
        logger.info("[onGestionWrite] baja derivada", { gid, contratos: contratos.length, devId, propias });

        // Correo de "baja aprobada" al vendedor responsable, al vendedor
        // asignado del cliente y a ventas (pedido 2026-08-27).
        try {
          const dests = new Set();
          if (G.isEmail(gB.responsable_email)) dests.add(gB.responsable_email.toLowerCase());
          const vend = await G.vendedorEmailDeCliente(gB.cliente_id);
          if (vend) dests.add(vend);
          const ventas = await G.configEmailTo("ventas", "ventas@cecomunica.net");
          if (G.isEmail(ventas)) dests.add(ventas.trim().toLowerCase());
          const lista = [...dests];
          if (lista.length) {
            await G.encolarCorreo({
              to: lista[0],
              cc: lista.length > 1 ? lista.slice(1).join(",") : null,
              subject: `${gB.terminacion_total_de?.length ? "Terminación total" : "Baja"} APROBADA: ${gid} — ${gB.cliente_nombre || "Cliente"}`,
              preheader: devId ? `Orden de devolución ${devId} creada por serial` : "Equipos del cliente — sin recuperación",
              bodyContent: `
                <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">${gB.terminacion_total_de?.length ? "Terminación total aprobada" : "Baja aprobada"}</h2>
                <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                  La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(gB.cliente_nombre || "—")}</b> fue aprobada.
                  ${devId ? `La orden de devolución <b>${G.escapeHtml(devId)}</b> quedó creada de inmediato para recuperar los equipos.` : "Los equipos son propios del cliente: no hay recuperación, la baja corta el servicio."}
                  ${propias && devId ? `${propias} equipo(s) propios quedan con el cliente.` : ""}
                </p>
                ${G.tablaHtml(["Serial", "Modelo", "Contrato"], (gB.items || []).map(it => [
                  `<code>${G.escapeHtml(it.serial_saliente || it.serial || "—")}</code>`,
                  G.escapeHtml(it.modelo || "—"),
                  `<code>${G.escapeHtml(it.contrato_id || "—")}</code>`,
                ]))}`,
              ctaUrl: G.urlGestion(gB, gid),
              ctaLabel: "Ver el expediente",
              meta: { gestion_id: gid, paso: "baja_aprobada" },
            });
          }
        } catch (e) {
          logger.warn("[onGestionWrite] correo de baja aprobada falló", { gid, message: e.message });
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] derivación de baja falló", { gid, message: e.message });
    }

    // ── B3) AUMENTO firmado → líneas con tramo propio en el contrato ─────
    // La UI registra el anexo firmado (pendiente_firma → pendiente_bodega +
    // cierre.firma + anexo_firmado_path). Aquí se aplican las líneas a
    // equipos[] del contrato destino con enmienda_id y la duración del tramo;
    // la fecha de inicio/vencimiento del tramo se estampa AL ENTREGAR
    // (decisión §8.2: el período corre desde la entrega). Admin SDK: esquiva
    // touchesCFOwnedFields y las reglas del contrato.
    try {
      // Por NIVEL con lectura fresca (2026-08-31), igual que B2: si aplicar
      // las líneas fallaba, el flanco pendiente_firma→pendiente_bodega ya
      // estaba consumido y el anexo quedaba firmado sin aplicar, sin
      // reintento. cierre.firma la estampan tanto la subida del firmado como
      // la firma digital (onFirmaContrato).
      let gA = null;
      if (after.tipo === "aumento" && after.estado === "pendiente_bodega"
          && after.cierre?.firma === true && !after.cierre?.derivacion) {
        const fresco = await ref.get();
        const d = fresco.exists ? fresco.data() : null;
        if (d && d.estado === "pendiente_bodega" && d.cierre?.firma === true && !d.cierre?.derivacion) gA = d;
      }
      if (gA) {
        const a = gA.aumento || {};
        // Ajuste de tarifa (2026-09-02, caso FORTALEZA/GPS): anexo SOLO-CARGOS
        // — sin líneas de equipo es válido; los cargos se aplican, el servicio
        // se estampa por serial y la gestión cierra sin bodega ni entrega.
        const esAjuste = a.es_ajuste === true && (a.cargos || []).length > 0;
        if (!a.contrato_doc_id || (!(a.lineas || []).length && !esAjuste)) {
          logger.error("[onGestionWrite] aumento firmado sin contrato destino o sin líneas", { gid });
        } else {
          // Anexo de REGULARIZACIÓN (2026-08-31, caso C COMUNICA): los equipos
          // YA están en poder del cliente (sobrantes sin línea de una
          // renovación) — el tramo arranca HOY y no hay bodega ni entrega.
          const esReg = a.es_regularizacion === true
            && Array.isArray(a.regulariza_seriales) && a.regulariza_seriales.length > 0;
          const hoy = new Date();
          const fvReg = new Date(hoy.getTime());
          fvReg.setMonth(fvReg.getMonth() + (Number(a.duracion_meses || 0) || 0));
          const cRef = db.collection("contratos").doc(a.contrato_doc_id);
          await db.runTransaction(async (tx) => {
            const cSnap = await tx.get(cRef);
            if (!cSnap.exists) throw new Error(`contrato destino ${a.contrato_doc_id} no existe`);
            const equipos = Array.isArray(cSnap.data().equipos) ? [...cSnap.data().equipos] : [];
            if (equipos.some(l => l.enmienda_id === gid)) return; // idempotencia
            for (const l of (a.lineas || [])) {
              equipos.push({
                modelo_id: l.modelo_id || null,
                modelo: l.modelo || "",
                descripcion: esReg
                  ? `Regularización por enmienda ${gid} (anexo firmado — equipos ya en campo)`
                  : `Aumento por enmienda ${gid} (anexo firmado)`,
                cantidad: Number(l.cantidad || 0),
                precio: Number(l.precio || 0),
                ...(l.modalidad ? { modalidad: l.modalidad } : {}),
                enmienda_id: gid,
                vigencia: esReg
                  ? {
                      fecha_inicio: admin.firestore.Timestamp.fromDate(hoy),
                      duracion_meses: Number(a.duracion_meses || 0) || null,
                      fecha_vencimiento: admin.firestore.Timestamp.fromDate(fvReg),
                      estado: "vigente", // el equipo ya está entregado
                      enmienda_id: gid,
                    }
                  : {
                      duracion_meses: Number(a.duracion_meses || 0) || null,
                      estado: "pendiente_entrega", // el tramo corre desde la entrega
                    },
              });
            }
            // Cargos del anexo (únicos y mensuales) al contrato — mismo shape
            // que nc-cargos.leer(); la facturación futura los lee de cargos[].
            // Con `seriales` cuando el cargo está amarrado por equipo (GPS).
            const cargos = Array.isArray(cSnap.data().cargos) ? [...cSnap.data().cargos] : [];
            if (cargos.some(cg => cg.enmienda_id === gid)) return; // idempotencia (ajuste solo-cargos)
            for (const cg of (a.cargos || [])) {
              cargos.push({
                cargo_id: cg.cargo_id || "",
                concepto: cg.concepto || "",
                cantidad: Number(cg.cantidad || 1),
                monto: Number(cg.monto || 0),
                recurrente: cg.recurrente === true,
                ...(Array.isArray(cg.seriales) && cg.seriales.length ? { seriales: cg.seriales } : {}),
                enmienda_id: gid,
              });
            }
            // Renegociación de precio (2026-09-02): las líneas listadas en
            // ajustes_precio cambian su tarifa — se busca por índice y se
            // verifica contra modelo+precio_anterior (si el contrato cambió
            // entre la creación del anexo y la firma, se busca por match).
            const ajustesAplicados = [];
            if (esAjuste) {
              for (const aj of (a.ajustes_precio || [])) {
                let idx = Number(aj.idx);
                const coincide = (l) => l
                  && Number(l.precio || 0) === Number(aj.precio_anterior)
                  && ((aj.modelo_id && l.modelo_id === aj.modelo_id)
                      || String(l.modelo || "").trim() === String(aj.modelo || "").trim());
                if (!coincide(equipos[idx])) {
                  idx = equipos.findIndex((l) => coincide(l) && !ajustesAplicados.some((x) => x.idx === equipos.indexOf(l)));
                }
                if (idx < 0 || !equipos[idx]) {
                  logger.warn("[onGestionWrite] ajuste de precio sin línea que coincida", { gid, ajuste: aj });
                  continue;
                }
                equipos[idx] = {
                  ...equipos[idx],
                  precio: Number(aj.precio_nuevo || 0),
                  ajustes: [...(equipos[idx].ajustes || []), {
                    de: Number(aj.precio_anterior || 0), a: Number(aj.precio_nuevo || 0),
                    enmienda_id: gid, at: new Date().toISOString().slice(0, 10),
                  }],
                };
                ajustesAplicados.push({ idx, ...aj });
              }
            }
            // Totales persistidos al día (misma aritmética que
            // ContratoTarifario.totales — el documento y la facturación los
            // leen de aquí; sin esto, un ajuste dejaba el total viejo).
            const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
            const c0 = cSnap.data();
            const equiposSub = r2(equipos.reduce((s2, l) => s2 + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0));
            let cargosRec = 0; let cargosUni = 0;
            for (const cg of cargos) {
              const t = (Number(cg.monto) || 0) * (Number(cg.cantidad) || 1);
              if (cg.recurrente) cargosRec += t; else cargosUni += t;
            }
            cargosRec = r2(cargosRec); cargosUni = r2(cargosUni);
            const rate = Number(c0.itbms_porcentaje ?? 0.07);
            const aplicaItbms = c0.itbms_aplica !== false;
            const subMensual = r2(equiposSub + cargosRec);
            const itbmsMensual = aplicaItbms ? r2(subMensual * rate) : 0;
            const totalMensual = r2(subMensual + itbmsMensual);
            const subInicial = r2(subMensual + cargosUni);
            const primerPago = r2(subInicial + (aplicaItbms ? r2(subInicial * rate) : 0));
            tx.set(cRef, {
              equipos,
              ...(a.cargos?.length ? { cargos } : {}),
              // Los totales persistidos solo se recalculan en el AJUSTE: un
              // aumento normal agrega líneas pendiente_entrega y su mensual
              // no debe subir hasta la entrega real.
              ...(esAjuste ? {
                subtotal: subMensual, subtotal_equipos: equiposSub,
                cargos_recurrente: cargosRec, cargos_unico: cargosUni,
                itbms_monto: itbmsMensual, total_con_itbms: totalMensual,
                total_mensual: totalMensual, total: totalMensual, primer_pago: primerPago,
              } : {}),
              fecha_modificacion: new Date(),
              enmiendas_aumento: admin.firestore.FieldValue.arrayUnion(gid),
            }, { merge: true });
          });
          if (esReg) {
            // 1) Amarrar cada serial (ya en campo) al contrato — update con
            //    dot-paths: jamás set(merge) sobre rutas anidadas del pool.
            let amarrados = 0;
            for (const s of a.regulariza_seriales) {
              if (!s.pool_doc_id) continue;
              try {
                await db.collection("equipos_pool").doc(s.pool_doc_id).update({
                  "asignacion.contrato_doc_id": a.contrato_doc_id,
                  "asignacion.contrato_id": a.contrato_id || a.contrato_doc_id,
                  "asignacion.gestion_doc_id": gid,
                });
                amarrados++;
              } catch (e) {
                logger.warn("[onGestionWrite] amarre de regularización falló", { gid, serial: s.serial, message: e.message });
              }
            }
            // 2) La conciliación del contrato baja: esos seriales dejan de
            //    ser sobrantes.
            await db.runTransaction(async (tx) => {
              const s2 = await tx.get(cRef);
              if (!s2.exists) return;
              const r = s2.data().regularizacion || {};
              const set = new Set(a.regulariza_seriales.map(x => String(x.serial || "")));
              const sl = (r.sin_linea_seriales || []).filter(x => !set.has(String(x)));
              const sc = (r.sin_cupo_seriales || []).filter(x => !set.has(String(x)));
              tx.set(cRef, {
                regularizacion: {
                  ...r,
                  amarradas: Number(r.amarradas || 0) + amarrados,
                  sin_linea: sl.length, sin_linea_seriales: sl,
                  sin_cupo: sc.length, sin_cupo_seriales: sc,
                  ultima_por: `anexo:${gid}`,
                },
              }, { merge: true });
            });
            // 3) La gestión cierra aquí mismo: no hay bodega, OS ni entrega.
            await ref.set({
              estado: "cerrada",
              cerrada_at: admin.firestore.FieldValue.serverTimestamp(),
              aumento: {
                ...a,
                seriales_asignados: a.regulariza_seriales.map(s => ({
                  serial: s.serial || "", modelo_id: s.modelo_id || null, modelo: s.modelo || "",
                })),
              },
              cierre: { ...(gA.cierre || {}), derivacion: true, asignacion: true, programacion: true, entrega: true },
            }, { merge: true });
            await G.registrarEvento(gid, "entrega",
              `Anexo de REGULARIZACIÓN aplicado: ${amarrados} equipo(s) ya en campo amarrados al contrato ${a.contrato_id || a.contrato_doc_id} (${a.regulariza_seriales.map(s => s.serial).join(", ")}); el tramo de ${a.duracion_meses || "?"} meses arranca hoy. Sin bodega ni entrega — la gestión cierra.`);
            logger.info("[onGestionWrite] regularización por anexo aplicada", { gid, contrato: a.contrato_doc_id, amarrados });
            await G.avisoFacturacion({
              subject: `FACTURACIÓN: regularización EFECTIVA — ${gA.cliente_nombre || "Cliente"} (${a.contrato_id || ""})`,
              titulo: "Regularización aplicada — el tramo arranca hoy",
              cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                El cliente firmó el anexo <b>${G.escapeHtml(gid)}</b>: ${amarrados} equipo(s) que ya
                estaban en su poder (${(a.regulariza_seriales || []).map(s => `<code>${G.escapeHtml(s.serial || "")}</code>`).join(", ")})
                quedaron amarrados al contrato <b>${G.escapeHtml(a.contrato_id || "")}</b> con tarifa
                desde <b>hoy</b> — sin bodega ni entrega.</p>
                ${G.detalleAumentoHtml(a)}`,
              cliente_id: gA.cliente_id, cliente_nombre: gA.cliente_nombre || "",
              responsable_uid: gA.responsable_uid || null, responsable_email: gA.responsable_email || null,
              ctaUrl: G.urlGestion(gA, gid), ctaLabel: "Ver el expediente",
              meta: { gestion_id: gid, paso: "facturacion_regularizacion" },
            });
          } else if (esAjuste) {
            // Estampar el servicio EN CADA SERIAL marcado (pool.servicios[]):
            // el Kardex y las bajas saben qué radios llevan qué servicio.
            let estampados = 0;
            for (const cg of (a.cargos || [])) {
              if (!cg.recurrente || !Array.isArray(cg.seriales)) continue;
              for (const serial of cg.seriales) {
                try {
                  const r = await pool.resolver(serial, null, "");
                  if (r?.ref && r.data) {
                    await r.ref.update({
                      servicios: admin.firestore.FieldValue.arrayUnion(cg.concepto || "Servicio"),
                    });
                    estampados++;
                  }
                } catch (e) {
                  logger.warn("[onGestionWrite] servicio no estampado en el pool", { gid, serial, message: e.message });
                }
              }
            }
            // Sin bodega, OS ni entrega: el ajuste cierra al aplicarse.
            await ref.set({
              estado: "cerrada",
              cerrada_at: admin.firestore.FieldValue.serverTimestamp(),
              cierre: { ...(gA.cierre || {}), derivacion: true, asignacion: true, programacion: true, entrega: true },
            }, { merge: true });
            await G.registrarEvento(gid, "entrega",
              `Anexo de AJUSTE aplicado al contrato ${a.contrato_id || a.contrato_doc_id}: ${[
                (a.cargos || []).length ? (a.cargos || []).map(cg => `${cg.concepto} $${Number(cg.monto || 0).toFixed(2)}${cg.recurrente ? "/mes" : ""} × ${cg.cantidad}${(cg.seriales || []).length ? ` (${cg.seriales.join(", ")})` : ""}`).join("; ") : "",
                (a.ajustes_precio || []).length ? `tarifas renegociadas: ${(a.ajustes_precio || []).map(x => `${x.modelo} $${Number(x.precio_anterior).toFixed(2)}→$${Number(x.precio_nuevo).toFixed(2)}`).join(", ")}` : "",
              ].filter(Boolean).join("; ")}${estampados ? `; servicio estampado en ${estampados} equipo(s) del pool` : ""}; totales del contrato recalculados. Sin bodega ni entrega — la gestión cierra.`);
            logger.info("[onGestionWrite] ajuste de tarifa aplicado", { gid, contrato: a.contrato_doc_id, estampados });
            await G.avisoFacturacion({
              subject: `FACTURACIÓN: ajuste de tarifa EFECTIVO — ${gA.cliente_nombre || "Cliente"} (${a.contrato_id || ""})`,
              titulo: "Ajuste de tarifa / servicios aplicado",
              cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                El cliente firmó el anexo <b>${G.escapeHtml(gid)}</b> y el ajuste al contrato
                <b>${G.escapeHtml(a.contrato_id || "")}</b> de <b>${G.escapeHtml(gA.cliente_nombre || "—")}</b>
                quedó <b>efectivo desde hoy</b> — el mensual del contrato ya está recalculado.</p>
                ${G.detalleAumentoHtml(a)}`,
              cliente_id: gA.cliente_id, cliente_nombre: gA.cliente_nombre || "",
              responsable_uid: gA.responsable_uid || null, responsable_email: gA.responsable_email || null,
              ctaUrl: G.urlGestion(gA, gid), ctaLabel: "Ver el expediente",
              meta: { gestion_id: gid, paso: "facturacion_ajuste" },
            });
          } else {
            // Si la OS ya salió durante la firma (pre-asignación 2026-09-03),
            // la sección C no volverá a correr (programacion_id estampado):
            // aquí mismo se avanza a en_proceso — y la entrega, que esperaba
            // cierre.firma, queda libre.
            const osYaSalio = !!gA.ordenes?.programacion_id;
            await ref.set({
              cierre: { ...(gA.cierre || {}), derivacion: true },
              ...(osYaSalio ? { estado: "en_proceso" } : {}),
            }, { merge: true });
            await G.registrarEvento(gid, "derivacion",
              `Anexo firmado: ${(a.lineas || []).length} línea(s) agregada(s) al contrato ${a.contrato_id || a.contrato_doc_id} con vigencia propia (${a.duracion_meses || "?"} meses desde la entrega).${osYaSalio ? ` La OS ${gA.ordenes.programacion_id} ya estaba en curso — la entrega queda libre.` : ""}`);
            logger.info("[onGestionWrite] aumento aplicado al contrato", { gid, contrato: a.contrato_doc_id, osYaSalio });
          }
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] aplicación del aumento falló", { gid, message: e.message });
    }

    // ── C) asignación completa → pool + OS PROGRAMACIÓN + correo ────────
    // Corre también en pendiente_firma (aumento pre-asignado, 2026-09-03): la
    // OS sale para que programación avance en paralelo a la firma — la entrega
    // es el único candado (rules + UI exigen cierre.firma). Ajuste y
    // regularización nunca llegan aquí: no tienen seriales que asignar.
    try {
      const estadoListo = (g) => ["pendiente_bodega", "en_proceso"].includes(g.estado)
        || (g.estado === "pendiente_firma" && g.tipo === "aumento"
            && g.aumento?.es_ajuste !== true && g.aumento?.es_regularizacion !== true);
      const lista = !after.ordenes?.programacion_id
        && estadoListo(after)
        && asignacionCompleta(after);
      // Lectura fresca (2026-08-31): una re-entrega del evento traería un
      // snapshot viejo sin programacion_id y duplicaría la(s) OS y los
      // movimientos del pool.
      let gC = null;
      if (lista) {
        const fresco = await ref.get();
        const d = fresco.exists ? fresco.data() : null;
        if (d && !d.ordenes?.programacion_id
            && estadoListo(d)
            && asignacionCompleta(d)) gC = d;
      }
      if (gC) {
        // Entrantes al pool: asignados a la gestión. El de reemplazo HEREDA el
        // contrato (línea de facturación) del saliente; el de demo queda del
        // cliente sin contrato (asignacion.tipo:'demo').
        const entrantes = gC.tipo === "reemplazo"
          ? (gC.items || []).map(it => ({
              serial: it.serial_nuevo,
              modelo_id: it.modelo_solicitado_id || it.modelo_id || null,
              modelo: it.modelo_solicitado || it.modelo || "",
              asignacion: {
                contrato_doc_id: it.contrato_doc_id || null,
                contrato_id: it.contrato_id || null,
                cliente_id: gC.cliente_id, cliente_nombre: gC.cliente_nombre || "",
                gestion_doc_id: gid,
              },
              nota: `Asignado por gestión ${gid} — reemplaza a ${it.serial_saliente || "—"}`,
            }))
          : gC.tipo === "aumento"
            ? (gC.aumento?.seriales_asignados || []).map(s => ({
                serial: s.serial,
                modelo_id: s.modelo_id || null,
                modelo: s.modelo || "",
                asignacion: {
                  contrato_doc_id: gC.aumento?.contrato_doc_id || null,
                  contrato_id: gC.aumento?.contrato_id || null,
                  cliente_id: gC.cliente_id, cliente_nombre: gC.cliente_nombre || "",
                  gestion_doc_id: gid,
                },
                nota: `Asignado por enmienda de aumento ${gid} (contrato ${gC.aumento?.contrato_id || "—"})`,
              }))
            : (gC.demo?.seriales_asignados || []).map(s => ({
                serial: s.serial,
                modelo_id: s.modelo_id || null,
                modelo: s.modelo || "",
                asignacion: {
                  contrato_doc_id: null, contrato_id: null,
                  cliente_id: gC.cliente_id, cliente_nombre: gC.cliente_nombre || "",
                  gestion_doc_id: gid, tipo: "demo",
                },
                nota: `Asignado por gestión ${gid} (demo)`,
              }));
        for (const u of entrantes) {
          try {
            const r = await pool.transicionar(u.serial, u.modelo_id, u.modelo, {
              aEstado: pool.ESTADOS.ASIGNADO,
              soloDesde: [pool.ESTADOS.EN_BODEGA],
              tipo: "asignacion_gestion",
              refMov: { tipo: "gestion", id: gid, label: gid },
              notas: u.nota,
              extra: { asignacion: u.asignacion },
            });
            // transicionar → 'transicion' | 'sin-cambio' | 'no-existe'. Un
            // 'no-existe' aquí es un serial mal asignado por bodega — se
            // registra pero no frena la OS: el kardex y la conciliación lo ven.
            if (r !== "transicion") {
              logger.warn("[onGestionWrite] entrante no se pudo asignar en pool", { gid, serial: u.serial, motivo: r });
              await G.registrarEvento(gid, "pool_incidencia", `El serial ${u.serial} no se pudo asignar en el pool (${r}).`);
            }
          } catch (e) {
            logger.warn("[onGestionWrite] transición de entrante falló", { gid, serial: u.serial, message: e.message });
          }
        }

        const ordenIds = await G.crearOrdenesProgramacion(gid, gC);
        if (ordenIds.length) {
          // Pre-firma la gestión se QUEDA en pendiente_firma: la máquina de la
          // firma (rules esFirmaAnexoGestion, aplicarAnexo de onFirmaContrato)
          // exige esa transición; B3 la avanza a en_proceso al aplicar las
          // líneas cuando la OS ya existe.
          const preFirma = gC.estado === "pendiente_firma";
          await ref.set({
            ...(preFirma ? {} : { estado: "en_proceso" }),
            ordenes: {
              ...(gC.ordenes || {}),
              programacion_id: ordenIds[0],
              programacion_ids: ordenIds,
            },
            cierre: { ...(gC.cierre || {}), asignacion: true },
          }, { merge: true });
          await G.registrarEvento(gid, "programacion",
            `Asignación completa. OS de programación ${ordenIds.join(", ")} creada(s); correo a Recepción con copia al vendedor.${preFirma ? " La firma del anexo corre en paralelo — la ENTREGA queda candada hasta que el cliente firme." : ""}`);
          await correoRecepcion(gid, gC, ordenIds);
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] bloque de asignación falló", { gid, message: e.message });
    }

    // ── D) cierre automático (flags completos según el tipo) ─────────────
    try {
      const c = after.cierre || {};
      const flags = CIERRE_POR_TIPO[after.tipo] || CIERRE_POR_TIPO.reemplazo;
      const completo = flags.every(k => c[k] === true);
      if (completo && !["cerrada", "anulada"].includes(after.estado)) {
        await ref.set({
          estado: "cerrada",
          cerrada_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await G.registrarEvento(gid, "cierre", `Gestión cerrada automáticamente — ${flags.length} de ${flags.length} condiciones completadas.`);
        if (G.isEmail(after.responsable_email)) {
          await G.encolarCorreo({
            to: after.responsable_email,
            subject: `${G.TIPO_LABEL[after.tipo] || after.tipo} ${gid} cerrada — ${after.cliente_nombre || "Cliente"}`,
            preheader: "Las 4 condiciones de cierre se completaron",
            bodyContent: `
              <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Gestión cerrada</h2>
              <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                La gestión <b>${G.escapeHtml(gid)}</b> (${G.escapeHtml(G.TIPO_LABEL[after.tipo] || after.tipo)})
                de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>
                completó todas sus condiciones de cierre y se cerró automáticamente.
                El expediente queda como historial del cliente.
              </p>
              ${after.tipo === "aumento" ? detalleAumentoHtml(after.aumento || {}) : ""}`,
            ctaUrl: G.urlGestion(after, gid),
            ctaLabel: "Ver el expediente",
            meta: { gestion_id: gid, paso: "cierre" },
          });
        }
        logger.info("[onGestionWrite] gestión cerrada automáticamente", { gid });
      }
    } catch (e) {
      logger.error("[onGestionWrite] cierre automático falló", { gid, message: e.message });
    }

    return null;
  }
);

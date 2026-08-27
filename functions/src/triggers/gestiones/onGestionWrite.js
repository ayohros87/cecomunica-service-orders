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
    if (g.cierre?.derivacion !== true) return false; // primero la firma y las líneas
    const total = (g.aumento?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const asignados = (g.aumento?.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
    return total > 0 && asignados >= total;
  }
  return false;
}

async function correoAdmins(gid, g) {
  const admins = await G.adminEmails();
  if (!admins.length) {
    logger.warn("[onGestionWrite] excepción sin administradores con email", { gid });
    return;
  }
  const items = (g.items || []).filter(it => it.elegibilidad === "propio_excepcion");
  await G.encolarCorreo({
    to: admins[0],
    cc: admins.length > 1 ? admins.slice(1).join(",") : null,
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
  const dests = await G.aprobadoresEmails();
  if (!dests.length) {
    logger.warn("[onGestionWrite] baja sin aprobadores con email", { gid });
    return;
  }
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
    ? `<p style="margin:12px 0 4px;font:14px/1.5 Arial,sans-serif;"><b>Penalidad estimada por contrato</b>
        (no vencido: 3 meses de mensualidad · vencido: 30 días):</p>`
      + G.tablaHtml(["Contrato", "Base", "Penalidad est."], pen.por_contrato.map(p => [
          `<code>${G.escapeHtml(p.contrato_id || "—")}</code>`,
          G.escapeHtml(p.detalle || "—"),
          `<b>$${Number(p.monto || 0).toFixed(2)}</b>`,
        ]))
      + `<p style="margin:4px 0 0;font:13px Arial,sans-serif;">Total estimado: <b>$${Number(pen.total || 0).toFixed(2)}</b></p>`
    : "";
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
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
async function correoAprobadoresAumento(gid, g) {
  const dests = await G.aprobadoresEmails();
  if (!dests.length) {
    logger.warn("[onGestionWrite] aumento sin aprobadores con email", { gid });
    return;
  }
  const a = g.aumento || {};
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
    subject: `Aprobación comercial: aumento de equipos — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: `Enmienda al contrato ${a.contrato_id || "—"} con vigencia propia (${a.duracion_meses || "?"} meses)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Aumento esperando aprobación comercial</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> propone una <b>enmienda de aumento</b> al contrato
        <b>${G.escapeHtml(a.contrato_id || "—")}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>,
        con <b>vigencia propia de ${G.escapeHtml(String(a.duracion_meses || "?"))} meses</b> desde la entrega
        (el equipo nuevo vence más tarde que el resto — el anexo lo deja explícito).
        Al aprobar, el vendedor imprime el anexo, el cliente lo firma, y recién entonces
        el sistema aplica las líneas y pide los seriales a Bodega.
      </p>
      ${G.tablaHtml(["Cantidad", "Modelo", "Precio/mes"], (a.lineas || []).map(l => [
        `${Number(l.cantidad || 0)}`,
        G.escapeHtml(l.modelo || "—"),
        `$${Number(l.precio || 0).toFixed(2)}`,
      ]))}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Revisar y aprobar",
    meta: { gestion_id: gid, paso: "aprobacion_aumento" },
  });
}

async function correoBodega(gid, g) {
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
  await G.encolarCorreo({
    to,
    subject: `${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}: asignar serial(es) — ${g.cliente_nombre || "Cliente"}`,
    preheader: g.tipo === "reemplazo"
      ? `Asignar ${(g.items || []).length} equipo(s) de reemplazo`
      : `Asignar equipos para demo (nuevo o refurbished)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">${G.escapeHtml(G.TIPO_LABEL[g.tipo] || g.tipo)} — asignación de equipos</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> espera
        que Bodega asigne ${g.tipo === "reemplazo" ? "el serial del equipo que sustituye a cada radio" : "los seriales del demo (stock nuevo o refurbished)"}.
        Al completar la asignación, el sistema crea solo la orden de programación y avisa a Recepción.
      </p>
      ${g.tipo === "reemplazo"
        ? G.tablaHtml(["Sale", "Modelo actual", "Modelo solicitado", "Motivo"], filas)
        : G.tablaHtml(["Cantidad", "Modelo", g.tipo === "aumento" ? "Detalle" : "Finalidad", ""], filas)}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Asignar seriales",
    meta: { gestion_id: gid, paso: "bodega" },
  });
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
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
    subject: `OS de programación lista: ${ordenIds.join(", ")} — ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}`,
    preheader: g.tipo === "reemplazo"
      ? "Programar copiando la configuración del radio reemplazado"
      : "Programar los equipos del demo",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden(es) de programación creada(s)</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Bodega asignó los equipos de la gestión <b>${G.escapeHtml(gid)}</b>
        (<b>${G.escapeHtml(g.cliente_nombre || "—")}</b>) y el sistema creó la(s) orden(es)
        <b>${ordenIds.map(G.escapeHtml).join(", ")}</b>.
        ${g.tipo === "reemplazo"
          ? "Cada equipo indica el serial que sustituye: <b>copia su configuración, coloca su ID y confirma</b>."
          : "Programar y coordinar la entrega del demo."}
      </p>
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
      const entraABodega = after.tipo !== "baja" && (
        (creada && after.estado === "pendiente_bodega") ||
        (before && ["pendiente_aprobacion", "pendiente_firma"].includes(before.estado)
          && after.estado === "pendiente_bodega"));
      if (entraABodega) {
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
    try {
      const aprobadaAhora = after.tipo === "baja"
        && before && before.estado === "pendiente_aprobacion" && after.estado === "en_proceso"
        && !after.cierre?.derivacion;
      if (aprobadaAhora) {
        const { derivarBajaContrato } = require("../../lib/bajas");
        const contratos = Array.isArray(after.contratos_afectados) ? after.contratos_afectados : [];
        for (const cid of contratos) await derivarBajaContrato(cid);

        for (const it of (after.items || [])) {
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

        const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");
        // Regla de enmiendas: los equipos PROPIOS (del cliente) no se recuperan.
        const recuperables = (after.items || [])
          .filter(it => String(it.serial_saliente || it.serial || "").trim() && it.propiedad !== "cliente")
          .map(it => ({
            serial: it.serial_saliente || it.serial,
            modelo: it.modelo || "",
            modelo_id: it.modelo_id || null,
            pool_doc_id: it.pool_doc_id_saliente || null,
          }));
        const propias = (after.items || []).length - recuperables.length;
        let devId = null;
        if (recuperables.length) {
          devId = await crearOrdenDevolucion({
            clienteId: after.cliente_id,
            clienteNombre: after.cliente_nombre || "",
            contratoDocId: contratos[0] || null,
            contratoId: (after.items || []).find(i => i.contrato_id)?.contrato_id || null,
            contratoOrigenIds: contratos,
            modo: "recuperacion",
            origen: { tipo: "gestion_baja", ref_id: gid },
            unidades: recuperables,
            motivo: `${after.terminacion_total_de?.length ? "Terminación total" : "Baja de equipos"} ${gid} — recuperar las unidades dadas de baja`,
          });
          if (devId) {
            await db.collection("ordenes_de_servicio").doc(devId).set({
              gestion: { id: gid, tipo: "baja" },
            }, { merge: true });
          }
        }
        await ref.set({
          cierre: {
            ...(after.cierre || {}),
            derivacion: true,
            // Todo propio → no hay nada que recuperar: la entrada se da por
            // cumplida (la baja solo corta el servicio).
            ...(recuperables.length ? {} : { entrada: true }),
          },
          ordenes: { ...(after.ordenes || {}), devolucion_id: devId || null },
        }, { merge: true });
        await G.registrarEvento(gid, "derivacion",
          `Baja aplicada en ${contratos.length} contrato(s): fin de facturación registrado`
          + (devId ? `; orden de devolución ${devId} creada por serial` : "")
          + (propias ? `; ${propias} equipo(s) propios del cliente quedan con él (sin recuperación)` : "")
          + (after.terminacion_total_de?.length ? `; TERMINACIÓN TOTAL de ${after.terminacion_total_de.length} contrato(s)` : "") + ".");
        logger.info("[onGestionWrite] baja derivada", { gid, contratos: contratos.length, devId, propias });

        // Correo de "baja aprobada" al vendedor responsable, al vendedor
        // asignado del cliente y a ventas (pedido 2026-08-27).
        try {
          const dests = new Set();
          if (G.isEmail(after.responsable_email)) dests.add(after.responsable_email.toLowerCase());
          const vend = await G.vendedorEmailDeCliente(after.cliente_id);
          if (vend) dests.add(vend);
          const ventas = await G.configEmailTo("ventas", "ventas@cecomunica.net");
          if (G.isEmail(ventas)) dests.add(ventas.trim().toLowerCase());
          const lista = [...dests];
          if (lista.length) {
            await G.encolarCorreo({
              to: lista[0],
              cc: lista.length > 1 ? lista.slice(1).join(",") : null,
              subject: `${after.terminacion_total_de?.length ? "Terminación total" : "Baja"} APROBADA: ${gid} — ${after.cliente_nombre || "Cliente"}`,
              preheader: devId ? `Orden de devolución ${devId} creada por serial` : "Equipos del cliente — sin recuperación",
              bodyContent: `
                <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">${after.terminacion_total_de?.length ? "Terminación total aprobada" : "Baja aprobada"}</h2>
                <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                  La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b> fue aprobada.
                  ${devId ? `La orden de devolución <b>${G.escapeHtml(devId)}</b> quedó creada de inmediato para recuperar los equipos.` : "Los equipos son propios del cliente: no hay recuperación, la baja corta el servicio."}
                  ${propias && devId ? `${propias} equipo(s) propios quedan con el cliente.` : ""}
                </p>
                ${G.tablaHtml(["Serial", "Modelo", "Contrato"], (after.items || []).map(it => [
                  `<code>${G.escapeHtml(it.serial_saliente || it.serial || "—")}</code>`,
                  G.escapeHtml(it.modelo || "—"),
                  `<code>${G.escapeHtml(it.contrato_id || "—")}</code>`,
                ]))}`,
              ctaUrl: G.urlGestion(after, gid),
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
      const firmadoAhora = after.tipo === "aumento"
        && before && before.estado === "pendiente_firma" && after.estado === "pendiente_bodega"
        && !after.cierre?.derivacion;
      if (firmadoAhora) {
        const a = after.aumento || {};
        if (!a.contrato_doc_id || !(a.lineas || []).length) {
          logger.error("[onGestionWrite] aumento firmado sin contrato destino o sin líneas", { gid });
        } else {
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
                descripcion: `Aumento por enmienda ${gid} (anexo firmado)`,
                cantidad: Number(l.cantidad || 0),
                precio: Number(l.precio || 0),
                enmienda_id: gid,
                vigencia: {
                  duracion_meses: Number(a.duracion_meses || 0) || null,
                  estado: "pendiente_entrega", // el tramo corre desde la entrega
                },
              });
            }
            // Cargos del anexo (únicos y mensuales) al contrato — mismo shape
            // que nc-cargos.leer(); la facturación futura los lee de cargos[].
            const cargos = Array.isArray(cSnap.data().cargos) ? [...cSnap.data().cargos] : [];
            for (const cg of (a.cargos || [])) {
              cargos.push({
                cargo_id: cg.cargo_id || "",
                concepto: cg.concepto || "",
                cantidad: Number(cg.cantidad || 1),
                monto: Number(cg.monto || 0),
                recurrente: cg.recurrente === true,
                enmienda_id: gid,
              });
            }
            tx.set(cRef, {
              equipos,
              ...(a.cargos?.length ? { cargos } : {}),
              enmiendas_aumento: admin.firestore.FieldValue.arrayUnion(gid),
            }, { merge: true });
          });
          await ref.set({ cierre: { ...(after.cierre || {}), derivacion: true } }, { merge: true });
          await G.registrarEvento(gid, "derivacion",
            `Anexo firmado: ${(a.lineas || []).length} línea(s) agregada(s) al contrato ${a.contrato_id || a.contrato_doc_id} con vigencia propia (${a.duracion_meses || "?"} meses desde la entrega).`);
          logger.info("[onGestionWrite] aumento aplicado al contrato", { gid, contrato: a.contrato_doc_id });
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] aplicación del aumento falló", { gid, message: e.message });
    }

    // ── C) asignación completa → pool + OS PROGRAMACIÓN + correo ────────
    try {
      const lista = !after.ordenes?.programacion_id
        && ["pendiente_bodega", "en_proceso"].includes(after.estado)
        && asignacionCompleta(after);
      if (lista) {
        // Entrantes al pool: asignados a la gestión. El de reemplazo HEREDA el
        // contrato (línea de facturación) del saliente; el de demo queda del
        // cliente sin contrato (asignacion.tipo:'demo').
        const entrantes = after.tipo === "reemplazo"
          ? (after.items || []).map(it => ({
              serial: it.serial_nuevo,
              modelo_id: it.modelo_solicitado_id || it.modelo_id || null,
              modelo: it.modelo_solicitado || it.modelo || "",
              asignacion: {
                contrato_doc_id: it.contrato_doc_id || null,
                contrato_id: it.contrato_id || null,
                cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
                gestion_doc_id: gid,
              },
              nota: `Asignado por gestión ${gid} — reemplaza a ${it.serial_saliente || "—"}`,
            }))
          : after.tipo === "aumento"
            ? (after.aumento?.seriales_asignados || []).map(s => ({
                serial: s.serial,
                modelo_id: s.modelo_id || null,
                modelo: s.modelo || "",
                asignacion: {
                  contrato_doc_id: after.aumento?.contrato_doc_id || null,
                  contrato_id: after.aumento?.contrato_id || null,
                  cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
                  gestion_doc_id: gid,
                },
                nota: `Asignado por enmienda de aumento ${gid} (contrato ${after.aumento?.contrato_id || "—"})`,
              }))
            : (after.demo?.seriales_asignados || []).map(s => ({
                serial: s.serial,
                modelo_id: s.modelo_id || null,
                modelo: s.modelo || "",
                asignacion: {
                  contrato_doc_id: null, contrato_id: null,
                  cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
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

        const ordenIds = await G.crearOrdenesProgramacion(gid, after);
        if (ordenIds.length) {
          await ref.set({
            estado: "en_proceso",
            ordenes: {
              ...(after.ordenes || {}),
              programacion_id: ordenIds[0],
              programacion_ids: ordenIds,
            },
            cierre: { ...(after.cierre || {}), asignacion: true },
          }, { merge: true });
          await G.registrarEvento(gid, "programacion",
            `Asignación completa. OS de programación ${ordenIds.join(", ")} creada(s); correo a Recepción con copia al vendedor.`);
          await correoRecepcion(gid, after, ordenIds);
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
                La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>
                completó todas sus condiciones de cierre y se cerró automáticamente.
                El expediente queda como historial del cliente.
              </p>`,
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

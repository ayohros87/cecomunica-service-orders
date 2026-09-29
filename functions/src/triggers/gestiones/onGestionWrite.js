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
const CS = require("../../lib/cambioSerial");
const CG = require("../../lib/correccionGestion");
const AP = require("../../lib/adendaPapel");
const RC = require("../../domain/regularizacionCuentas");
const RD = require("../../lib/reposicionDano");

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
  // Cambio de serial (Ola 5): corregir el papel, no mover equipo. Dos pasos —
  // bodega declara cuál es el serial de verdad (`asignacion`) y la corrección
  // queda aplicada al contrato y al pool (`derivacion`). Sin OS, sin entrega y
  // sin entrada: el radio ya está donde tiene que estar.
  cambio_serial: ["asignacion", "derivacion"],
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

// ¿La gestión nació de una propuesta del taller? (2026-09-09)
const esPropuestaTaller = (g) => g?.origen?.tipo === "taller";

// ¿La escritura tocó SOLO estos campos (y al menos uno de ellos)? Sirve para
// ignorar los ecos de los triggers que denormalizan sobre el mismo documento.
// Una escritura que no cambió nada devuelve false a propósito: no se le quita
// el camino normal a un reintento.
function soloCambiaron(a, b, campos) {
  if (!a || !b) return false;
  const cambio = (k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null);
  if (!campos.some(cambio)) return false;
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of claves) {
    if (campos.includes(k)) continue;
    if (cambio(k)) return false;
  }
  return true;
}

// Copia de los correos de una propuesta del taller: el vendedor del cliente
// —informado, NO aprueba: la aprobación es del buzón ventas@, que le llega a
// administración (Alberto 2026-09-10)— y el técnico
// que la propuso, para que sepa en qué quedó lo que pidió.
async function ccTaller(g) {
  if (!esPropuestaTaller(g)) return null;
  const set = new Set();
  const vend = await G.vendedorEmailDeCliente(g.cliente_id);
  if (vend) set.add(vend);
  const tec = String(g.origen?.tecnico_email || g.responsable_email || "").trim().toLowerCase();
  if (tec) set.add(tec);
  return set.size ? [...set].join(",") : null;
}

// Situación de garantía de un ítem, tal como la vio el taller al proponer.
function garantiaTexto(it) {
  if (it.elegibilidad === "alquiler") return "Alquiler";
  const gar = it.garantia;
  if (!gar) return it.elegibilidad === "propio_garantia" ? "Del cliente · en garantía" : "Del cliente · sin garantía";
  const f = gar.vence ? new Date(gar.vence).toLocaleDateString("es-PA", { month: "short", year: "numeric" }) : null;
  const suf = gar.derivada ? " (estimada: 12 meses desde la factura)" : "";
  return gar.vigente
    ? `Del cliente · en garantía${f ? ` hasta ${f}` : ""}${suf}`
    : `Del cliente · garantía vencida${f ? ` en ${f}` : ""}${suf}`;
}

// Propuesta del TALLER (2026-09-09): la abre el técnico desde su orden y la
// aprueba administración. Lleva el diagnóstico por delante — es lo que se lee
// para decidir — y la orden de servicio de donde salió.
async function correoPropuestaTaller(gid, g) {
  const o = g.origen || {};
  // Una propuesta = UN radio (decisión 2026-09-09): el asunto lo nombra, que
  // es lo que administración necesita para decidir sin abrir nada.
  const it = (g.items || [])[0] || {};
  const serial = it.serial_saliente || o.serial || "—";
  // DAÑO CAUSADO POR EL CLIENTE (2026-09-25): el mismo expediente, pero es
  // otra decisión — si se le cobra y cuánto. El asunto lo dice primero, y el
  // cuerpo trae el monto de referencia y las fotos.
  const dano = RD.esReposicionDano(g);
  const ref = RD.montoReposicion(g);
  const fotos = (g.dano?.fotos || []).length;
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: await ccTaller(g),
    subject: dano
      ? `Aprobación requerida: reemplazo CON CARGO por daño — radio ${serial} — ${g.cliente_nombre || "Cliente"} (${gid})`
      : `Aprobación requerida: reemplazo del radio ${serial} — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: dano
      ? `El taller reporta que el cliente dañó ${serial}: se cotiza y se factura`
      : `El taller propone reemplazar ${serial} (${it.modelo || "sin modelo"}) de ${g.cliente_nombre || "un cliente"}`,
    bodyContent: dano ? `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Reemplazo por daño causado por el cliente</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        <b>${G.escapeHtml(o.tecnico_email || g.responsable_email || "El taller")}</b> revisó el radio
        <b><code>${G.escapeHtml(serial)}</code></b> (${G.escapeHtml(it.modelo || "—")}) de
        <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> en la orden <b>${G.escapeHtml(o.orden_id || "—")}</b>
        y reporta <b>daño causado por el cliente</b>: ${G.escapeHtml(RD.TIPOS_DANO[g.dano?.tipo] || g.dano?.tipo || "daño físico")}.
        No es garantía: <b>se cotiza y se factura</b>.</p>
      <div style="margin:0 0 14px;padding:10px 12px;background:#F1F5F9;border-radius:6px;">
        <p style="margin:0 0 4px;font:700 13px Arial,sans-serif;color:#334155;">Diagnóstico del taller</p>
        <p style="margin:0;font:14px/1.5 Arial,sans-serif;">${G.escapeHtml(o.diagnostico || "—")}</p>
      </div>
      ${G.tablaHtml(["Radio", "Modelo", "Contrato", "Valor de reposición"], [[
        `<code>${G.escapeHtml(serial)}</code>`,
        G.escapeHtml(it.modelo || "—"),
        `<code>${G.escapeHtml(it.contrato_id || "custodia")}</code>`,
        ref ? `<b>$${ref.toFixed(2)}</b> + ITBMS` : "<b>sin precio en el catálogo</b> — lo fijas al aprobar",
      ]])}
      <p style="margin:12px 0 0;font:14px/1.5 Arial,sans-serif;">
        <b>Tres salidas en el expediente:</b> aprobar <b>con cargo</b> (fijas el monto; el sistema arma la cotización y
        la jefatura de taller se la envía al cliente — Bodega no asigna hasta que el cliente acepte), aprobar
        <b>sin cargo</b> como cortesía (con motivo), o <b>rechazar</b>.
        ${fotos ? `El técnico adjuntó <b>${fotos} foto(s)</b> del daño: están en el expediente.` : ""}</p>` : `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">El taller propone reemplazar un radio</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        <b>${G.escapeHtml(o.tecnico_email || g.responsable_email || "El taller")}</b> revisó el radio
        <b><code>${G.escapeHtml(serial)}</code></b> (${G.escapeHtml(it.modelo || "—")}) de
        <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> en la orden
        <b>${G.escapeHtml(o.orden_id || "—")}</b> y propone reemplazarlo.
        <b>Nada se mueve hasta que administración apruebe</b>: al aprobar, Bodega recibe el aviso para asignar
        el equipo que lo sustituye (mismo modelo).
      </p>
      <div style="margin:0 0 14px;padding:10px 12px;background:#F1F5F9;border-radius:6px;">
        <p style="margin:0 0 4px;font:700 13px Arial,sans-serif;color:#334155;">Diagnóstico del taller</p>
        <p style="margin:0;font:14px/1.5 Arial,sans-serif;">${G.escapeHtml(o.diagnostico || "—")}</p>
      </div>
      ${G.tablaHtml(["Radio", "Modelo", "Contrato", "Situación"], [[
        `<code>${G.escapeHtml(serial)}</code>`,
        G.escapeHtml(it.modelo || "—"),
        `<code>${G.escapeHtml(it.contrato_id || "custodia")}</code>`,
        G.escapeHtml(garantiaTexto(it)),
      ]])}
      <p style="margin:12px 0 0;font:13px/1.5 Arial,sans-serif;color:#475569;">
        ${it.saliente_en_casa
          ? "El radio ya está en CECOMUNICA (entró con esa orden): no hace falta ir a buscarlo, y el sistema no abrirá una orden de devolución por él."
          : "El radio sigue donde el cliente: al entregarse el reemplazo, el sistema abre sola la orden de devolución para recuperarlo."}
      </p>`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Revisar y aprobar",
    meta: { gestion_id: gid, paso: "aprobacion", origen: "taller", orden: o.orden_id || "", serial },
  });
}

// Propuesta del taller RECHAZADA: sin esto el técnico nunca se entera de qué
// pasó con el radio que dejó apartado (la aprobación sí se sabe — el aviso a
// bodega le llega en copia).
async function correoRechazoTaller(gid, g) {
  const para = String(g.origen?.tecnico_email || g.responsable_email || "").trim().toLowerCase();
  if (!para) return;
  const vend = await G.vendedorEmailDeCliente(g.cliente_id);
  await G.encolarCorreo({
    to: para,
    cc: vend || null,
    subject: `Propuesta de reemplazo rechazada: radio ${(g.items || [])[0]?.serial_saliente || g.origen?.serial || "—"} — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: "Administración no aprobó el reemplazo propuesto desde el taller",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991B1B;">Propuesta rechazada</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La propuesta de reemplazo <b>${G.escapeHtml(gid)}</b> de
        <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> (orden
        <b>${G.escapeHtml(g.origen?.orden_id || "—")}</b>) <b>no fue aprobada</b>.
        ${g.anulada_motivo ? `Motivo: <b>${G.escapeHtml(g.anulada_motivo)}</b>.` : ""}
        No habrá equipo de reposición: el radio sigue su curso normal en la orden.
      </p>
      ${G.tablaHtml(["Radio", "Modelo"], (g.items || []).map(it => [
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo || "—"),
      ]))}`,
    ctaUrl: `${APP_BASE_URL}/ordenes/index.html?ids=${encodeURIComponent(g.origen?.orden_id || "")}`,
    ctaLabel: "Ver la orden",
    meta: { gestion_id: gid, paso: "rechazo_taller", orden: g.origen?.orden_id || "" },
  });
}

// Reemplazo pedido por el vendedor desde el Centro. Desde 2026-09-10 TODO
// reemplazo pasa por aquí, no solo la excepción: antes, un reemplazo de
// alquiler salía derecho a Bodega y administración se enteraba con el radio
// ya asignado. El correo se escribe distinto según lo que se esté aprobando —
// una excepción (cortesía sobre un equipo del CLIENTE, sin garantía) no es lo
// mismo que un reemplazo de alquiler, y quien aprueba necesita ver cuál es.
async function correoAdmins(gid, g) {
  // Regla 2026-08-28: TODA solicitud de aprobación va SOLO a
  // ventas@cecomunica.com — ese buzón ES el de los aprobadores (sin copias
  // individuales: llegaría dos veces).
  const excepciones = (g.items || []).filter(it => it.elegibilidad === "propio_excepcion");
  const todos = g.items || [];
  const hayExcepcion = excepciones.length > 0;
  const vend = await G.vendedorEmailDeCliente(g.cliente_id);
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: vend || null,
    subject: `Aprobación requerida: ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid} — ${g.cliente_nombre || "Cliente"}`,
    preheader: hayExcepcion
      ? "Incluye equipo propio sin garantía vigente (excepción por servicio al cliente)"
      : `${todos.length} radio(s) a reemplazar — Bodega no asigna hasta que administración apruebe`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">${hayExcepcion
        ? "Reemplazo con excepción, esperando aprobación" : "Reemplazo esperando aprobación"}</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        ${G.escapeHtml(g.responsable_email || "Un vendedor")} pidió el reemplazo de
        <b>${todos.length} radio(s)</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>
        (gestión <b>${G.escapeHtml(gid)}</b>). Bodega <b>no recibe el aviso</b> hasta que esto se apruebe.
      </p>
      ${hayExcepcion ? `
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        ${excepciones.length === todos.length ? "Todos los equipos son" : `${excepciones.length} de los equipos son`}
        <b>propios del cliente y sin garantía vigente</b> (marcados abajo): ese reemplazo procede
        como <b>excepción por servicio al cliente</b> — no hay obligación contractual de reponerlo.
      </p>` : ""}
      ${G.tablaHtml(["Serial", "Modelo", "Sale por", "Motivo"], todos.map(it => [
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo || "—"),
        it.elegibilidad === "propio_excepcion" ? "<b>Propio SIN garantía</b>"
          : it.elegibilidad === "propio_garantia" ? "Propio en garantía" : "Alquiler",
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
          // Actualización de seriales (2026-09-09): se aplica al APROBAR, sin
          // firma — al cliente no se le manda nada.
          ? `Los equipos <b>ya están en poder del cliente</b>: al aprobar, quedan amarrados al contrato de una vez.
             <b>No se le envía nada al cliente para firmar</b>, ni pasa por bodega ni genera entrega.`
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
        (RD.cobraCargo(g) ? "<b>Reposición por daño — el cliente aceptó el cobro.</b> " : "")
          + G.escapeHtml(it.motivo_detalle || it.motivo_codigo || "—"),
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
    // Propuesta del taller: el vendedor y el técnico siguen el hilo en copia
    // (el vendedor no aprueba, pero es su cliente; el técnico pidió el radio).
    cc: await ccTaller(g),
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

// ── Cambio de serial: los dos correos del flujo ────────────────────────────
// Va aparte de correoBodega a propósito: aquí no se pide sacar nada del
// estante, se pide confirmar cuál es el serial de verdad. Meterlo en la
// cadena de arriba haría que el correo dijera "asignar equipos", que es
// justo lo que NO hay que hacer.
async function correoBodegaCambioSerial(gid, g) {
  const to = await G.bodegaEmailTo();
  if (!to) {
    logger.warn("[onGestionWrite] sin buzón de bodega — cambio de serial sin aviso", { gid });
    return;
  }
  const items = g.items || [];
  const filas = items.map(it => [
    `<code>${G.escapeHtml(it.serial || "—")}</code>`,
    G.escapeHtml(it.modelo || "—"),
    it.serial_nuevo
      ? `<code>${G.escapeHtml(it.serial_nuevo)}</code> <span style="color:#6B7280;">(por confirmar)</span>`
      : "<span style=\"color:#6B7280;\">por declarar</span>",
    G.escapeHtml(it.contrato_id || "sin contrato"),
    G.escapeHtml(it.motivo_detalle || it.motivo_codigo || "—"),
  ]);
  const propuestos = items.filter(it => String(it.serial_nuevo || "").trim()).length;
  // En copia quien lo pidió (se entera de que llegó) y el vendedor del cliente.
  const cc = [...new Set([
    g.responsable_email,
    await G.vendedorEmailDeCliente(g.cliente_id).catch(() => null),
  ].filter(e => G.isEmail(e)).map(e => String(e).toLowerCase()))].join(",");
  await G.encolarCorreo({
    to,
    ...(cc ? { cc } : {}),
    subject: `Cambio de serial ${gid}: confirmar el serial correcto — ${g.cliente_nombre || "Cliente"}`,
    preheader: `Corregir ${items.length} serial(es) mal registrado(s)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Cambio de serial — corrección de registro</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        El sistema tiene mal ${items.length === 1 ? "un serial" : `${items.length} seriales`} de
        <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>. <b>No hay que sacar nada del estante ni ir a buscar
        ningún radio</b>: el equipo ya está donde tiene que estar — lo que está mal es el registro.
        ${propuestos
    ? `Quien abrió la gestión ya propuso ${propuestos === items.length ? "el serial correcto" : "algunos seriales"}; confírmalo contra el radio y guarda.`
    : "Confirma contra el radio cuál es el serial de verdad y guárdalo."}
      </p>
      ${G.tablaHtml(["Figura en el sistema", "Modelo", "Serial real", "Contrato", "Motivo"], filas)}
      <p style="margin:12px 0 0;font:13px/1.5 Arial,sans-serif;color:#6B7280;">
        Al guardarlo, el sistema corrige el contrato, devuelve al estante el serial que estaba mal
        (marcado <i>verificar físicamente</i>) y avisa la corrección a activaciones.
      </p>`,
    ctaUrl: G.urlBodegaGestion(gid),
    ctaLabel: "Corregir el serial",
    meta: { gestion_id: gid, paso: "bodega_cambio_serial" },
  });
}

// Corrección aplicada → activaciones actualiza sus registros (el envío
// original salió con el serial equivocado). Mismo cuadro anterior→nuevo que
// mandaba el canal viejo (onSerialCambio.resuelto), ahora desde la gestión.
async function correoActivacionesCambioSerial(gid, g, aplicados) {
  const { activacionesEmailTo } = require("../../lib/mailRecipients");
  const filas = aplicados.map(r => [
    G.escapeHtml(r.modelo || "—"),
    `<code style="color:#991B1B;text-decoration:line-through;">${G.escapeHtml(r.anterior || "—")}</code>`,
    `<code style="color:#065F46;font-weight:700;">${G.escapeHtml(r.nuevo || "—")}</code>`,
    G.escapeHtml(r.contrato_id || "sin contrato"),
  ]);
  const cc = [...new Set([
    g.responsable_email,
    await G.vendedorEmailDeCliente(g.cliente_id).catch(() => null),
  ].filter(e => G.isEmail(e)).map(e => String(e).toLowerCase()))].join(",");
  await G.encolarCorreo({
    to: await activacionesEmailTo(),
    ...(cc ? { cc } : {}),
    subject: `Corrección de seriales: ${g.cliente_nombre || "Cliente"} — gestión ${gid}`,
    preheader: `Se corrigieron ${aplicados.length} serial(es) mal registrado(s)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Corrección de seriales</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Se corrigieron seriales de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> que salieron mal en el
        envío original. Actualiza tus registros:
      </p>
      ${G.tablaHtml(["Modelo", "Serial anterior", "Serial correcto", "Contrato"], filas)}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Ver el expediente",
    meta: { gestion_id: gid, paso: "correccion_activaciones" },
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
  // Reemplazo: columna "Contrato" por fila — los ítems pueden cruzar contratos.
  const pares = g.tipo === "reemplazo"
    ? (g.items || []).map(it => [
        `<code>${G.escapeHtml(it.serial_nuevo || "—")}</code>`,
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo_solicitado || it.modelo || "—"),
        G.escapeHtml(it.contrato_id || "custodia"),
      ])
    : ((g.tipo === "aumento" ? g.aumento?.seriales_asignados : g.demo?.seriales_asignados) || []).map(s => [
        `<code>${G.escapeHtml(s.serial || "—")}</code>`, "—", G.escapeHtml(s.modelo || "—"),
      ]);
  const cabeceras = g.tipo === "reemplazo" ? ["Entra", "Sustituye a", "Modelo", "Contrato"] : ["Entra", "Sustituye a", "Modelo"];
  // Aumento pre-asignado (2026-09-03): la OS sale con el anexo aún en firma —
  // programar se puede desde ya; la ENTREGA queda candada hasta cierre.firma.
  const firmaEnParalelo = g.tipo === "aumento" && g.estado === "pendiente_firma"
    && g.cierre?.firma !== true;
  // Cuadro "Trámite" (Brenda, 2026-09-08): qué es, a qué contrato y de qué
  // tipo — lo que recepción necesita para el archivo de activaciones. El
  // asunto también lo dice, para que se distinga desde la bandeja.
  const tramite = G.tramiteResumen(gid, g);
  const contratoAsunto = g.tipo === "aumento"
    ? ` · ${g.aumento?.contrato_papel === true && !g.aumento?.contrato_doc_id ? "adenda a contrato en papel" : "anexo al contrato"} ${g.aumento?.contrato_id || "—"}`
    : g.tipo === "demo" ? " · sin contrato" : "";
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
    subject: `OS de programación lista: ${ordenIds.join(", ")} — ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}${contratoAsunto}`,
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
      ${tramite.html}
      ${firmaEnParalelo ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;background:#FEF3C7;border-radius:6px;padding:10px 12px;">
        ⚠️ La <b>firma del anexo corre en paralelo</b>: se puede programar desde ya, pero la
        <b>entrega no sale</b> hasta que el cliente firme (el sistema la bloquea solo).</p>` : ""}
      ${G.tablaHtml(cabeceras, pares)}`,
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
    // `devolucion` sigue esperando su ola; `cambio_serial` entró el 2026-09-15.
    if (!["reemplazo", "demo", "baja", "aumento", "cambio_serial"].includes(after.tipo)) return null;
    if (["cerrada", "anulada"].includes(after.estado) && before?.estado === after.estado) return null;

    const creada = !before;
    const ref = event.data.after.ref;

    // El indexador del archivo (onGestionArchivo) vive sobre ESTE mismo
    // documento y le escribe `seriales_norm` de vuelta. Ese eco llegaba aquí
    // como una escritura más y volvía a correr la máquina de estados entera:
    // el 2026-09-10 (GR20260910-01, Silverking) la asignación de bodega y su
    // eco entraron a la sección C a 300 ms uno del otro y salieron DOS OS de
    // programación (2026091003 y 2026091004), dos correos a Recepción y una
    // "incidencia de pool" falsa en el expediente. El eco no decide nada.
    // `correccion_en_curso` va en la misma bolsa: es la puerta de la sección
    // C2, no información — y su propia escritura no tiene nada que decidir.
    // `cobro` también: lo escriben SOLO este trigger y lib/reposicionDano (el
    // monto de referencia, el puntero a la cotización) — sus ecos no deciden
    // nada. Cuando administración aprueba, `cobro` cambia JUNTO con `estado`,
    // y eso sí pasa.
    if (soloCambiaron(before, after, ["seriales_norm", "correccion_en_curso", "cobro"])) return null;

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
      // Reposición por daño con la cotización todavía viva: se descarta, para
      // que nadie la envíe ni la marque aceptada sobre un caso anulado.
      if (RD.esReposicionDano(after)) {
        try {
          if (await RD.alAnularse(gid, after)) {
            await G.registrarEvento(gid, "cotizacion_descartada",
              `La cotización ${after.cobro?.cotizacion_id || ""} de la reposición se descartó junto con la gestión.`);
          }
        } catch (e) {
          logger.error("[onGestionWrite] cotización de reposición no descartada", { gid, error: e.message });
        }
      }
      if (esPropuestaTaller(after)) {
        try {
          await correoRechazoTaller(gid, after);
          await G.registrarEvento(gid, "rechazo_taller", "Rechazo avisado al técnico que propuso el reemplazo (vendedor en copia).");
        } catch (e) {
          logger.error("[onGestionWrite] aviso de rechazo al taller falló", { gid, message: e.message });
        }
      }
      return null;
    }

    // ── A00) REEMPLAZO de un radio que el sistema NO conocía ─────────────
    // (2026-09-09, Alberto). El cliente reporta un radio dañado que nunca
    // entró al pool: sin ficha no había con qué armar la solicitud, y obligar
    // a regularizar la cuenta primero para poder reemplazar un radio es pedir
    // el trámite largo para el trámite corto. El vendedor lo declara en el
    // wizard y la ficha nace aquí, en custodia del cliente (en cliente, sin
    // contrato) — exactamente el estado en que ya vivían tantos radios de
    // campo, así que el resto del flujo de reemplazo no cambia en nada.
    // El alta la hace el trigger porque las reglas no dejan a un vendedor
    // crear fichas del pool: se declara, no se inventa inventario.
    if (creada && after.tipo === "reemplazo" && (after.items || []).some(it => it && it.saliente_sin_ficha === true)) {
      try {
        const items = [...(after.items || [])];
        let nacidas = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || it.saliente_sin_ficha !== true || it.pool_doc_id_saliente) continue;
          const r = await pool.upsertContacto({
            serial: it.serial_saliente,
            modelo_id: it.modelo_id || null,
            modelo_label: it.modelo || "",
            estado: pool.ESTADOS.EN_CLIENTE,
            noTocarDesde: [pool.ESTADOS.EN_TALLER],
            tipo: "declaracion_vendedor",
            refMov: { tipo: "gestion", id: gid, label: gid },
            origen: "declarado_vendedor",
            notas: `Declarado en la solicitud de reemplazo ${gid}: el cliente lo tenía y el sistema no lo sabía`,
            extra: {
              asignacionSiFalta: {
                contrato_doc_id: null, contrato_id: "",
                cliente_id: after.cliente_id || "", cliente_nombre: after.cliente_nombre || "",
              },
            },
          });
          const { ref: fRef } = await pool.resolver(it.serial_saliente, it.modelo_id || null, it.modelo || "");
          items[i] = { ...it, pool_doc_id_saliente: fRef.id, saliente_ficha_creada: r === "creado" };
          if (r === "creado") nacidas++;
          logger.info("[onGestionWrite] saliente declarado por el vendedor", { gid, serial: it.serial_saliente, resultado: r });
        }
        await ref.set({ items }, { merge: true });
        if (nacidas) {
          await G.registrarEvento(gid, "declaracion",
            `${nacidas} equipo(s) que el sistema no conocía quedaron declarados en la cuenta del cliente para poder reemplazarlos: `
            + `${items.filter(it => it.saliente_ficha_creada).map(it => it.serial_saliente).join(", ")}. `
            + "Quedan en campo sin contrato — la cuenta sigue pidiendo regularización.");
        }
      } catch (e) {
        logger.error("[onGestionWrite] alta del saliente declarado falló", { gid, message: e.message });
      }
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
        } else if (esPropuestaTaller(after)) {
          // Reemplazo por DAÑO: el valor de reposición lo pone el servidor
          // (precio de venta del catálogo, con la caída a la base de la
          // familia que usa cobranza), antes del correo que lo muestra.
          if (RD.esReposicionDano(after) && after.cobro?.monto_referencia === undefined) {
            try {
              const CE = require("../../lib/cobrosEquipos");
              const it0 = (after.items || [])[0] || {};
              const precio = await CE.precioCatalogo(it0.modelo_id);
              after.cobro = { ...(after.cobro || {}), monto_referencia: precio, modelo_id: it0.modelo_id || null };
              await ref.update({ "cobro.monto_referencia": precio, "cobro.modelo_id": it0.modelo_id || null });
            } catch (e) {
              logger.warn("[onGestionWrite] valor de reposición no calculado", { gid, error: e.message });
            }
          }
          await correoPropuestaTaller(gid, after);
          await G.registrarEvento(gid, "correo_aprobacion",
            `Propuesta del taller (orden ${after.origen?.orden_id || "—"}) enviada a administración para aprobación, con el vendedor del cliente y el técnico en copia.`);
        } else {
          await correoAdmins(gid, after);
          const conExcepcion = (after.items || []).some(it => it.elegibilidad === "propio_excepcion");
          await G.registrarEvento(gid, "correo_aprobacion", conExcepcion
            ? "Solicitud de aprobación enviada a administración — incluye equipo propio sin garantía (excepción por servicio al cliente)."
            : "Solicitud de aprobación enviada a administración, con el vendedor en copia. Bodega no recibe el aviso hasta que se apruebe.");
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
      // Cambio de serial: nace directo en bodega (no lleva aprobación — es una
      // corrección de registro, no saca equipo del estante) con su propio
      // correo, que dice explícitamente que NO hay nada que sacar.
      if (creada && after.tipo === "cambio_serial" && after.estado === "pendiente_bodega") {
        await correoBodegaCambioSerial(gid, after);
        const props = (after.items || []).filter(it => String(it.serial_nuevo || "").trim()).length;
        await G.registrarEvento(gid, "correo_bodega", props
          ? `Aviso enviado a Bodega para confirmar el serial correcto (${props} propuesto(s) por quien abrió la gestión).`
          : "Aviso enviado a Bodega para declarar cuál es el serial correcto.");
      }
      // Reemplazo por DAÑO aprobado con cargo → se arma la cotización de la
      // reposición. Bodega NO recibe nada todavía: espera a que el cliente
      // acepte (pendiente_cliente → pendiente_bodega, lo mueve la cotización).
      if (before && before.estado === "pendiente_aprobacion" && after.estado === "pendiente_cliente"
          && RD.cobraCargo(after)) {
        const r = await RD.crearCotizacionReposicion(gid);
        if (r) logger.info("[onGestionWrite] cotización de reposición creada", { gid, cotizacion: r.cotizacionId });
      }
      // `pendiente_cliente` → `pendiente_bodega`: el cliente aceptó la
      // reposición (lib/reposicionDano.alAceptarse). Es el aviso a bodega que
      // se retuvo al aprobar.
      const entraABodega = after.tipo !== "baja" && after.tipo !== "cambio_serial"
        && after.aumento?.es_regularizacion !== true
        && after.aumento?.es_ajuste !== true && (
        (creada && after.estado === "pendiente_bodega") ||
        (before && ["pendiente_aprobacion", "pendiente_firma", "pendiente_cliente"].includes(before.estado)
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
          aviso: (() => {
            const items = gB.items || [];
            const finTxt = gB.fecha_fin_facturacion ? String(gB.fecha_fin_facturacion) : null;
            const fin = finTxt && /^\d{4}-\d{2}-\d{2}/.test(finTxt) ? new Date(`${finTxt.slice(0, 10)}T12:00:00-05:00`) : null;
            const contratos = [...new Set(items.map(it => it.contrato_id).filter(Boolean))];
            return {
              tipo: "baja_aprobada", origen_col: "gestiones", origen_id: gid, gestion_id: gid,
              contrato_id: contratos.join(", ") || null,
              fecha_efectiva: fin && !isNaN(fin) ? fin : new Date(),
              contexto: { terminacion_total: !!gB.terminacion_total_de?.length, fecha_fin_texto: finTxt,
                liquidacion: gB.penalidad_estimada?.total ?? null,
                origen_texto: gB.terminacion_total_de?.length ? "Terminación total aprobada" : "Baja parcial aprobada" },
              resumen: { equipos_n: items.length, seriales: items.map(it => it.serial_saliente || it.serial).filter(Boolean),
                equipos: items.map(it => it.modelo).filter(Boolean).join(", "), delta_mensual: null },
              detalle: { items },
            };
          })(),
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
        // Cómo quedó autorizada, del expediente y no del camino (2026-09-10,
        // caso GA20260909-03): la actualización de seriales se aplica SIN
        // firma desde 2026-09-09 y los avisos seguían diciendo "el cliente
        // firmó el anexo" al vendedor en copia.
        const aut = G.autorizacionTexto(gA);
        // Ajuste de tarifa (2026-09-02, caso FORTALEZA/GPS): anexo SOLO-CARGOS
        // — sin líneas de equipo es válido; los cargos se aplican, el servicio
        // se estampa por serial y la gestión cierra sin bodega ni entrega.
        const esAjuste = a.es_ajuste === true && (a.cargos || []).length > 0;
        // ADENDA A CONTRATO EN PAPEL (2026-09-07, caso Falcon Servicios): el
        // contrato marco no está en el sistema y la cuenta no se pudo
        // regularizar en el momento. No hay doc al que aplicarle líneas — la
        // derivación se marca igual para que la OS salga (sección C exige el
        // flag); el tramo se estampa EN LAS UNIDADES al entregar
        // (onOrdenWriteGestion) y la cuenta sigue pidiendo regularización.
        const esPapel = AP.esAdendaPapel(a);
        if (esPapel && (a.lineas || []).length) {
          const osYaSalio = !!gA.ordenes?.programacion_id;
          await ref.set({
            cierre: { ...(gA.cierre || {}), derivacion: true },
            ...(osYaSalio ? { estado: "en_proceso" } : {}),
          }, { merge: true });
          await G.registrarEvento(gid, "derivacion",
            `Adenda al contrato EN PAPEL ${a.contrato_id || "—"} (${aut.corto}): ${(a.lineas || []).length} línea(s) con vigencia propia (${a.duracion_meses || "?"} meses desde la entrega). El contrato marco no está en el sistema, así que no hay líneas que aplicar: el tramo se estampará en cada equipo al entregarse y la cuenta sigue pendiente de regularizar.${osYaSalio ? ` La OS ${gA.ordenes.programacion_id} ya estaba en curso — la entrega queda libre.` : ""}`);
          logger.info("[onGestionWrite] adenda a contrato en papel aplicada", { gid, contrato_papel: a.contrato_id || "", firmado: aut.firmado, osYaSalio });
        } else if (!a.contrato_doc_id || (!(a.lineas || []).length && !esAjuste)) {
          logger.error("[onGestionWrite] aumento aplicado sin contrato destino o sin líneas", { gid });
        } else if (a.es_regularizacion === true && !G.regularizacionConsistente(a).ok) {
          // Candado server-side (verificación 2026-09-08): un anexo de
          // regularización con más cantidades que seriales llevaría radios
          // NUEVOS que nunca pasarían por bodega ni tendrían OS ni entrega, y
          // se facturarían desde hoy. NO se aplica: queda marcado para que
          // el expediente lo diga y alguien lo corrija (anular y rehacer).
          const chk = G.regularizacionConsistente(a);
          await ref.set({
            regularizacion_bloqueada: { motivo: chk.motivo, total: chk.total, seriales: chk.seriales, at: admin.firestore.FieldValue.serverTimestamp() },
          }, { merge: true });
          await G.registrarEvento(gid, "regularizacion_bloqueada",
            `El anexo de regularización NO se aplicó: ${chk.motivo}. Un anexo de regularización solo cubre equipos que el cliente ya tiene; los radios nuevos van en un aumento aparte. Anula esta gestión y créala de nuevo desde el Centro.`);
          logger.error("[onGestionWrite] anexo de regularización inconsistente — no aplicado", { gid, ...chk });
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
                  ? `Actualización de seriales ${gid} — equipos ya en campo`
                  : `Aumento por enmienda ${gid} (${aut.corto})`,
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
            let nacidos = 0;
            for (const s of a.regulariza_seriales) {
              // Serial que el sistema NO conocía (2026-09-09): el vendedor lo
              // agregó al anexo y la ficha nace aquí, ya en cliente y con la
              // propiedad que declara la línea — mismo upsertContacto que usa
              // onSerialWrite, así que el kardex y las guardias son las mismas.
              if (!s.pool_doc_id) {
                try {
                  const r = await pool.upsertContacto({
                    serial: s.serial,
                    modelo_id: s.modelo_id || null,
                    modelo_label: s.modelo || "",
                    estado: pool.ESTADOS.EN_CLIENTE,
                    noTocarDesde: [pool.ESTADOS.EN_TALLER],
                    tipo: "regularizacion",
                    refMov: { tipo: "gestion", id: gid, label: gid },
                    origen: "declarado_vendedor",
                    notas: `Alta por anexo de regularización ${gid} — el cliente lo tenía y el sistema no lo sabía`,
                    propiedadDeclarada: true,
                    extra: {
                      ...(s.modalidad === "propio" ? { propiedad: "cliente" }
                        : s.modalidad === "alquiler" ? { propiedad: "cecomunica" } : {}),
                      asignacion: {
                        contrato_doc_id: a.contrato_doc_id,
                        contrato_id: a.contrato_id || a.contrato_doc_id,
                        cliente_id: gA.cliente_id || "",
                        cliente_nombre: gA.cliente_nombre || "",
                        gestion_doc_id: gid,
                      },
                    },
                  });
                  if (r !== "ignorado") { amarrados++; nacidos++; }
                  logger.info("[onGestionWrite] serial nuevo por regularización", { gid, serial: s.serial, resultado: r });
                } catch (e) {
                  logger.warn("[onGestionWrite] alta de serial por regularización falló", { gid, serial: s.serial, message: e.message });
                }
                continue;
              }
              try {
                const ref = db.collection("equipos_pool").doc(s.pool_doc_id);
                // De quién es el equipo: lo dice la LÍNEA del anexo, no la
                // ficha (2026-09-09, Alberto). Este amarre escribe el pool
                // directo — no pasa por onSerialWrite — así que la corrección
                // se hace aquí, con el mismo criterio y el mismo rastro.
                const mod = s.modalidad === "propio" ? "cliente" : s.modalidad === "alquiler" ? "cecomunica" : null;
                const antes = mod ? (await ref.get()).get("propiedad") || null : null;
                await ref.update({
                  "asignacion.contrato_doc_id": a.contrato_doc_id,
                  "asignacion.contrato_id": a.contrato_id || a.contrato_doc_id,
                  "asignacion.gestion_doc_id": gid,
                  ...(mod ? { propiedad: mod } : {}),
                });
                if (mod && antes && antes !== mod) {
                  await ref.collection("movimientos").add({
                    at: admin.firestore.FieldValue.serverTimestamp(),
                    por: "system", por_email: null,
                    tipo: "correccion", de_estado: null, a_estado: null,
                    ref: { tipo: "gestion", id: gid, label: gid },
                    notas: `Propiedad corregida por la línea del anexo de regularización: ${antes} → ${mod}`,
                  });
                }
                amarrados++;
              } catch (e) {
                logger.warn("[onGestionWrite] amarre de regularización falló", { gid, serial: s.serial, message: e.message });
              }
            }
            // 1b) Los que el cliente NO tiene (2026-09-09): salen de la cuenta
            //     y quedan por clasificar, igual que el destino 'no_tiene' del
            //     plan por serial de una renovación. Así el anexo deja la
            //     cuenta al día en los dos sentidos, no solo sumando.
            let soltados = 0;
            for (const s of (a.regulariza_no_tiene || [])) {
              try {
                const r = await pool.soltarDelCliente(s.serial, s.modelo_id || null, s.modelo || "", {
                  cliente_id: gA.cliente_id || "",
                  refMov: { tipo: "gestion", id: gid, label: gid },
                  notas: `Anexo de regularización ${gid}: el cliente declaró que NO tiene este equipo`,
                });
                if (r === "liberado") soltados++;
                else logger.info("[onGestionWrite] no_tiene sin efecto", { gid, serial: s.serial, resultado: r });
              } catch (e) {
                logger.warn("[onGestionWrite] no se pudo soltar el serial", { gid, serial: s.serial, message: e.message });
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
              `Actualización de seriales aplicada (${aut.corto}): ${amarrados} equipo(s) ya en campo amarrados al contrato ${a.contrato_id || a.contrato_doc_id} (${a.regulariza_seriales.map(s => s.serial).join(", ")})`
              + `${nacidos ? `, ${nacidos} de ellos dados de alta con este anexo` : ""}`
              + `${soltados ? `; ${soltados} serial(es) que el cliente NO tiene salieron de la cuenta (${(a.regulariza_no_tiene || []).map(s => s.serial).join(", ")})` : ""}`
              + `; el tramo de ${a.duracion_meses || "?"} meses arranca hoy. Sin bodega ni entrega — la gestión cierra.`);
            logger.info("[onGestionWrite] regularización por anexo aplicada", { gid, contrato: a.contrato_doc_id, amarrados, nacidos, soltados });
            // La deuda de la cuenta se recalcula AQUÍ MISMO, no en el barrido
            // de los 10 minutos (2026-09-09, Alberto): el vendedor aprueba la
            // actualización de seriales y la ficha seguía diciendo "por
            // regularizar" un buen rato después. El barrido sigue como red.
            try { await RC.recalcularCuenta(gA.cliente_id); }
            catch (e) { logger.warn("[onGestionWrite] recálculo de regularización no pudo correr en el acto", { gid, message: e.message }); }
            await G.avisoFacturacion({
              subject: `FACTURACIÓN: regularización EFECTIVA — ${gA.cliente_nombre || "Cliente"} (${a.contrato_id || ""})`,
              titulo: "Regularización aplicada — el tramo arranca hoy",
              cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                La actualización de seriales <b>${G.escapeHtml(gid)}</b> quedó aplicada: ${amarrados} equipo(s) que ya
                estaban en poder del cliente (${(a.regulariza_seriales || []).map(s => `<code>${G.escapeHtml(s.serial || "")}</code>`).join(", ")})
                quedaron amarrados al contrato <b>${G.escapeHtml(a.contrato_id || "")}</b> con tarifa
                desde <b>hoy</b> — sin bodega ni entrega.</p>
                <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#4b5563;">${aut.html}</p>
                ${G.detalleAumentoHtml(a)}`,
              cliente_id: gA.cliente_id, cliente_nombre: gA.cliente_nombre || "",
              responsable_uid: gA.responsable_uid || null, responsable_email: gA.responsable_email || null,
              ctaUrl: G.urlGestion(gA, gid), ctaLabel: "Ver el expediente",
              meta: { gestion_id: gid, paso: "facturacion_regularizacion" },
              aviso: {
                tipo: "regularizacion", origen_col: "gestiones", origen_id: gid, gestion_id: gid,
                contrato_id: a.contrato_id || null, contrato_doc_id: a.contrato_doc_id || null,
                fecha_efectiva: new Date(),
                contexto: { duracion_meses: a.duracion_meses || null, origen_texto: `Actualización de seriales — ${aut.corto}` },
                resumen: { equipos: require("../../lib/facturacionAvisos").equiposTexto(a.lineas),
                  equipos_n: amarrados, mensual: a.totales?.total_mensual ?? null, delta_mensual: a.totales?.total_mensual ?? null,
                  seriales: (a.regulariza_seriales || []).map(s => s.serial).filter(Boolean) },
                detalle: { lineas: a.lineas || [], cargos: a.cargos || [], ajustes_precio: a.ajustes_precio || [] },
              },
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
              `Ajuste de tarifa aplicado (${aut.corto}) al contrato ${a.contrato_id || a.contrato_doc_id}: ${[
                (a.cargos || []).length ? (a.cargos || []).map(cg => `${cg.concepto} $${Number(cg.monto || 0).toFixed(2)}${cg.recurrente ? "/mes" : ""} × ${cg.cantidad}${(cg.seriales || []).length ? ` (${cg.seriales.join(", ")})` : ""}`).join("; ") : "",
                (a.ajustes_precio || []).length ? `tarifas renegociadas: ${(a.ajustes_precio || []).map(x => `${x.modelo} $${Number(x.precio_anterior).toFixed(2)}→$${Number(x.precio_nuevo).toFixed(2)}`).join(", ")}` : "",
              ].filter(Boolean).join("; ")}${estampados ? `; servicio estampado en ${estampados} equipo(s) del pool` : ""}; totales del contrato recalculados. Sin bodega ni entrega — la gestión cierra.`);
            logger.info("[onGestionWrite] ajuste de tarifa aplicado", { gid, contrato: a.contrato_doc_id, estampados });
            await G.avisoFacturacion({
              subject: `FACTURACIÓN: ajuste de tarifa EFECTIVO — ${gA.cliente_nombre || "Cliente"} (${a.contrato_id || ""})`,
              titulo: "Ajuste de tarifa / servicios aplicado",
              cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                El ajuste <b>${G.escapeHtml(gid)}</b> al contrato
                <b>${G.escapeHtml(a.contrato_id || "")}</b> de <b>${G.escapeHtml(gA.cliente_nombre || "—")}</b>
                quedó <b>efectivo desde hoy</b> — el mensual del contrato ya está recalculado.</p>
                <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#4b5563;">${aut.html}</p>
                ${G.detalleAumentoHtml(a)}`,
              cliente_id: gA.cliente_id, cliente_nombre: gA.cliente_nombre || "",
              responsable_uid: gA.responsable_uid || null, responsable_email: gA.responsable_email || null,
              ctaUrl: G.urlGestion(gA, gid), ctaLabel: "Ver el expediente",
              meta: { gestion_id: gid, paso: "facturacion_ajuste" },
              aviso: {
                tipo: "ajuste_tarifa", origen_col: "gestiones", origen_id: gid, gestion_id: gid,
                contrato_id: a.contrato_id || null, contrato_doc_id: a.contrato_doc_id || null,
                fecha_efectiva: new Date(),
                contexto: { origen_texto: `Ajuste de tarifa / servicios — ${aut.corto}`, servicios_estampados: estampados },
                resumen: { equipos: (a.ajustes_precio || []).map(x => x.modelo).filter(Boolean).join(", "),
                  mensual: a.totales?.total_mensual ?? null, delta_mensual: a.totales?.total_mensual ?? null,
                  seriales: [...new Set((a.cargos || []).flatMap(cg => cg.seriales || []))] },
                detalle: { lineas: a.lineas || [], cargos: a.cargos || [], ajustes_precio: a.ajustes_precio || [] },
              },
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
              `Anexo aplicado (${aut.corto}): ${(a.lineas || []).length} línea(s) agregada(s) al contrato ${a.contrato_id || a.contrato_doc_id} con vigencia propia (${a.duracion_meses || "?"} meses desde la entrega).${osYaSalio ? ` La OS ${gA.ordenes.programacion_id} ya estaba en curso — la entrega queda libre.` : ""}`);
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
      // Puerta TRANSACCIONAL (2026-09-10, caso GR20260910-01). La lectura
      // fresca de 2026-08-31 solo tapaba la re-entrega TARDÍA de un evento:
      // dos escrituras casi simultáneas al expediente leían fresco las dos
      // antes de que la primera estampara `programacion_id` —la marca se
      // ponía DESPUÉS de crear las órdenes, así que la ventana era de unos
      // 600 ms— y salían dos OS idénticas. Ahora la marca se RESERVA antes de
      // crear nada, dentro de una transacción: la segunda invocación la ve y
      // se va. `programacion_en_curso` se limpia al estampar el resultado (y
      // también si no se pudo crear ninguna, más abajo: si esto falla, el
      // próximo evento tiene que poder reintentar).
      let gC = null;
      if (lista) {
        gC = await db.runTransaction(async (tx) => {
          const s = await tx.get(ref);
          const d = s.exists ? s.data() : null;
          if (!d || d.ordenes?.programacion_id || d.ordenes?.programacion_en_curso
              || !estadoListo(d) || !asignacionCompleta(d)) return null;
          tx.set(ref, { ordenes: { ...(d.ordenes || {}), programacion_en_curso: true } }, { merge: true });
          return d;
        });
      }
      if (gC) {
        // El entrante lleva el modelo de SU ficha (G.modeloEntrante). Si el
        // navegador no lo estampó (bundle viejo), se completa aquí y se guarda
        // en el expediente para la entrega y la anulación.
        if (gC.tipo === "reemplazo") {
          const { items, cambio } = await G.completarModeloEntrante(gC.items);
          if (cambio) {
            gC.items = items;
            await ref.set({ items }, { merge: true }).catch((e) =>
              logger.warn("[onGestionWrite] modelo del entrante no guardado", { gid, message: e.message }));
          }
        }
        // Entrantes al pool: asignados a la gestión. El de reemplazo HEREDA el
        // contrato (línea de facturación) del saliente; el de demo queda del
        // cliente sin contrato (asignacion.tipo:'demo').
        const entrantes = gC.tipo === "reemplazo"
          ? (gC.items || []).map(it => ({
              serial: it.serial_nuevo,
              ...G.modeloEntrante(it),
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
                  // Adenda a contrato en papel: el número manual queda como
                  // etiqueta y la unidad es CUSTODIA (sin contrato interno).
                  ...(AP.esAdendaPapel(gC.aumento) ? { contrato_papel: true } : {}),
                },
                nota: AP.esAdendaPapel(gC.aumento)
                  ? `Asignado por adenda ${gid} al contrato EN PAPEL ${gC.aumento?.contrato_id || "—"} — custodia sin contrato interno (regularizar la cuenta)`
                  : `Asignado por enmienda de aumento ${gid} (contrato ${gC.aumento?.contrato_id || "—"})`,
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

        let ordenIds = [];
        try {
          ordenIds = await G.crearOrdenesProgramacion(gid, gC);
        } finally {
          // Sin órdenes (o con excepción) la puerta se vuelve a abrir: si se
          // quedara reservada, la gestión no volvería a intentar la OS nunca.
          if (!ordenIds.length) {
            await ref.set({
              ordenes: { ...(gC.ordenes || {}), programacion_en_curso: admin.firestore.FieldValue.delete() },
            }, { merge: true }).catch(() => {});
          }
        }
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
              programacion_en_curso: admin.firestore.FieldValue.delete(),
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

    // ── C2) CAMBIO DE SERIAL con el serial correcto declarado → aplicar ──
    // Bodega confirmó cuál es el radio de verdad: se reescribe la fila del
    // contrato (onSerialWrite hace el intercambio en el pool) y se avisa la
    // corrección a activaciones. Puerta TRANSACCIONAL antes del efecto, no
    // después: dos eventos casi simultáneos sobre el mismo expediente (la
    // escritura de bodega y el eco de seriales_norm) aplicarían la corrección
    // dos veces y el segundo pase no encontraría el serial viejo — mismo
    // patrón que la reserva de `programacion_en_curso` de la sección C.
    try {
      const listoCS = after.tipo === "cambio_serial"
        && !["cerrada", "anulada"].includes(after.estado)
        && after.cierre?.derivacion !== true
        && CS.asignacionCompleta(after);
      let gCS = null;
      if (listoCS) {
        gCS = await db.runTransaction(async (tx) => {
          const s = await tx.get(ref);
          const d = s.exists ? s.data() : null;
          if (!d || d.correccion_en_curso === true || d.cierre?.derivacion === true
              || ["cerrada", "anulada"].includes(d.estado) || !CS.asignacionCompleta(d)) return null;
          tx.set(ref, { correccion_en_curso: true }, { merge: true });
          return d;
        });
      }
      if (gCS) {
        let r = { aplicados: [], fallidos: [] };
        try {
          r = await CS.aplicar(gid, gCS);
        } finally {
          // La puerta se cierra SIEMPRE: si la aplicación se cae a medias, el
          // próximo evento tiene que poder reintentar lo que quedó pendiente.
          const nuevos = r.aplicados.filter(x => x.via !== "ya_aplicado");
          const ok = r.aplicados.length > 0 && r.fallidos.length === 0;
          await ref.set({
            correccion_en_curso: admin.firestore.FieldValue.delete(),
            ...(ok ? {
              cierre: { ...(gCS.cierre || {}), asignacion: true, derivacion: true },
              correccion: { aplicados: r.aplicados, at: admin.firestore.FieldValue.serverTimestamp() },
            } : {}),
          }, { merge: true });
          if (nuevos.length) {
            await G.registrarEvento(gid, "correccion",
              `Corrección aplicada: ${nuevos.map(x => `${x.anterior} → ${x.nuevo}`).join(", ")}. `
              + "El serial que estaba mal vuelve al estante marcado «verificar físicamente».");
            await correoActivacionesCambioSerial(gid, gCS, r.aplicados);
            await G.registrarEvento(gid, "correo_correccion",
              "Corrección avisada a activaciones, con el vendedor y quien la pidió en copia.");
          }
          if (r.fallidos.length) {
            await G.registrarEvento(gid, "correccion_incompleta",
              `No se pudo corregir ${r.fallidos.length} serial(es): `
              + r.fallidos.map(f => `${f.anterior} → ${f.nuevo} (${f.motivo})`).join("; ")
              + ". La gestión queda abierta: corrige el expediente o anúlala.");
            logger.warn("[onGestionWrite] cambio de serial incompleto", { gid, fallidos: r.fallidos.length });
          }
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] aplicación del cambio de serial falló", { gid, message: e.message });
    }

    // ── C2b) EL TALLER marcó un radio que no sirve → avisar a bodega ─────
    // (Zuleika 2026-09-16.) El técnico, con el radio delante, dice cuál no se
    // puede usar; bodega elige el que va en su lugar. Solo se avisa de lo que
    // NO estaba marcado antes: la marca vive hasta que la corrección se
    // aplique, así que sin este diff cada escritura del expediente repetiría
    // el correo.
    try {
      const antes = before?.correccion_solicitada || {};
      const ahora = after.correccion_solicitada || {};
      const nuevas = Object.keys(ahora).filter(k => !antes[k] || antes[k].at_iso !== ahora[k].at_iso);
      if (nuevas.length && !["cerrada", "anulada"].includes(after.estado)) {
        const marcas = nuevas.map(k => ahora[k]);
        const to = await G.bodegaEmailTo();
        if (to) {
          await G.encolarCorreo({
            to,
            subject: `El taller marcó ${marcas.length} radio(s) que no sirven — ${G.TIPO_LABEL[after.tipo] || after.tipo} ${gid}`,
            preheader: `Cambiar ${marcas.map(m => m.serial).join(", ")} en la gestión ${gid}`,
            bodyContent: `
              <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Hay que cambiar seriales de esta gestión</h2>
              <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                El taller revisó los equipos de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b> y estos
                <b>no se pueden usar</b>. No es un reemplazo: los radios no salieron a ningún lado —
                hay que poner otros en su lugar.
              </p>
              ${G.tablaHtml(["Serial", "Modelo", "Qué pasa", "Quién avisó"], marcas.map(m => [
    `<code>${G.escapeHtml(m.serial || "—")}</code>`,
    G.escapeHtml(m.modelo || "—"),
    G.escapeHtml(m.motivo_detalle || m.motivo_codigo || "—"),
    G.escapeHtml(m.por_email || "taller"),
  ]))}
              <p style="margin:12px 0 0;font:13px/1.5 Arial,sans-serif;color:#6B7280;">
                Se corrigen desde <b>Almacén · Asignar → Corregir seriales</b>: al guardar, el sistema
                actualiza la gestión, sus órdenes de servicio y el inventario de una vez.
              </p>`,
            ctaUrl: `${G.urlBodegaGestion(gid)}&corregir=1`,
            ctaLabel: "Corregir los seriales",
            meta: { gestion_id: gid, paso: "correccion_solicitada_taller" },
          });
        } else {
          logger.warn("[onGestionWrite] sin buzón de bodega — marca del taller sin aviso", { gid });
        }
        await G.registrarEvento(gid, "correccion_solicitada",
          `El taller marcó ${marcas.length} radio(s) que no se pueden usar: `
          + marcas.map(m => `${m.serial} (${m.motivo_detalle || m.motivo_codigo || "sin detalle"})`).join("; ")
          + ". Bodega pone otros en su lugar.");
      }
    } catch (e) {
      logger.error("[onGestionWrite] aviso de la marca del taller falló", { gid, message: e.message });
    }

    // ── C3) CORRECCIÓN de los seriales ya asignados de una gestión ───────
    // Bodega deja los pares {anterior, nuevo} en `correccion_seriales_pendiente`
    // desde Almacén · Asignar y aquí se aplican: gestión, sus órdenes y el pool
    // (el entrante toma el lugar exacto del saliente). Antes esto no existía y
    // un serial mal puesto obligaba a anular la gestión entera.
    //
    // La petición se consume dentro de la transacción que la lee: si el evento
    // se re-entrega, el segundo pase ya no la encuentra y no vuelve a mover
    // radios. El resultado queda en `correcciones` (histórico, append-only).
    try {
      const pend = after.correccion_seriales_pendiente;
      let pedido = null;
      if (pend && Array.isArray(pend.pares) && pend.pares.length
          && !["anulada"].includes(after.estado)) {
        pedido = await db.runTransaction(async (tx) => {
          const s = await tx.get(ref);
          const d = s.exists ? s.data() : null;
          const p = d?.correccion_seriales_pendiente;
          if (!d || !p || !Array.isArray(p.pares) || !p.pares.length || d.estado === "anulada") return null;
          tx.set(ref, { correccion_seriales_pendiente: admin.firestore.FieldValue.delete() }, { merge: true });
          return { g: d, pares: p.pares, por: p.por_email || p.por_uid || "bodega" };
        });
      }
      if (pedido) {
        const r = await CG.aplicar(gid, pedido.g, pedido.pares);
        if (r.aplicados.length) {
          const pares = r.aplicados.map(a => `${a.anterior} → ${a.nuevo}`).join(", ");
          // Lo que el taller marcó ya está resuelto: se quita la marca de los
          // seriales corregidos (y solo de esos — otro radio marcado del mismo
          // expediente sigue esperando su cambio).
          const limpiar = {};
          for (const a of r.aplicados) {
            const k = pool.normSerial(a.anterior);
            if (k && pedido.g.correccion_solicitada?.[k]) {
              limpiar[`correccion_solicitada.${k}`] = admin.firestore.FieldValue.delete();
            }
          }
          if (Object.keys(limpiar).length) await ref.update(limpiar);
          await ref.set({
            correcciones: admin.firestore.FieldValue.arrayUnion({
              pares: r.aplicados.map(a => ({ anterior: a.anterior, nuevo: a.nuevo })),
              por: pedido.por, at_iso: new Date().toISOString(),
              ordenes_tocadas: r.ordenes,
            }),
          }, { merge: true });
          await G.registrarEvento(gid, "correccion_seriales",
            `Seriales corregidos por ${pedido.por}: ${pares}. `
            + `${r.ordenes ? `Se actualizaron ${r.ordenes} línea(s) en las órdenes de la gestión. ` : ""}`
            + (pedido.g.cierre?.entrega === true
              ? "El radio que salía vuelve al estante marcado «verificar físicamente»."
              : "El radio que salía vuelve al estante."));
          logger.info("[onGestionWrite] seriales de gestión corregidos", { gid, pares: r.aplicados.length, ordenes: r.ordenes });
        }
        if (r.fallidos.length) {
          await G.registrarEvento(gid, "correccion_incompleta",
            `No se pudo corregir ${r.fallidos.length} serial(es): `
            + r.fallidos.map(f => `${f.anterior} → ${f.nuevo} (${f.motivo})`).join("; ") + ".");
          logger.warn("[onGestionWrite] corrección de seriales incompleta", { gid, fallidos: r.fallidos.length });
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] corrección de seriales falló", { gid, message: e.message });
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

// Aviso de PIEZAS USADAS a bodega (2026-11-19, propuesta de Solangel).
//
// EL HUECO. El resumen de piezas solo salía cuando una cotización de taller se
// ENVIABA y la orden tenía consumos (triggers/cotizaciones/onEstadoChange). En
// la práctica eso dejó a bodega a ciegas: el último correo salió el 28-oct.
//   · Visita sin costo (renovación de contrato, refurbish): el técnico registra
//     las piezas "sin costo" y cierra; no hay cotización → no salía nada
//     (visita 2026111802, 14 consumos, ningún correo).
//   · Reparación cotizada a mano: la jefa de taller escribe los renglones en la
//     cotización y la orden no tiene consumos → tampoco salía nada.
// Bodega seguía con el libro, la hoja del técnico y el correo a recepción.
//
// LO QUE HACE. Un solo aviso, tres puertas, sin duplicar:
//   1. `cierre`     — la orden pasa a COMPLETADO / CERRADA (VISITA).
//   2. `cotizacion` — la cotización de taller sale al cliente (la puerta de
//                     siempre). Si la orden no tiene consumos, el detalle sale
//                     de los renglones de la cotización.
//   3. `consumo`    — el técnico agrega o quita una pieza DESPUÉS de cerrar.
// Las tres comparan la HUELLA de lo que ya se avisó (ordenes_de_servicio/{id}/
// sistema/piezas_bodega): el mismo conteo no sale dos veces, y si cambia sale
// marcado como actualización. La huella se reserva en transacción ANTES de
// encolar el correo (reference_eco_triggers_mismo_doc).
//
// El estado vive en una subcolección y no en la orden a propósito: escribir la
// orden despierta sus cinco triggers por cada aviso.
const crypto = require("node:crypto");
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { bodegaEmailTo, tallerEmailTo } = require("./mailRecipients");
const { APP_BASE_URL } = require("./inventario");
const CS = require("./cotizacionServicio");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

// Estados en los que el trabajo ya se hizo: de aquí en adelante un cambio en
// las piezas es una corrección que bodega tiene que conocer.
const RE_TRABAJO_HECHO = /COMPLETADO|CERRADA \(VISITA\)|ENTREGADO AL CLIENTE/i;
const trabajoHecho = (orden) => RE_TRABAJO_HECHO.test(String(orden?.estado_reparacion || ""));

// Motivo de la visita tal como lo pidió bodega en el encabezado. Las claves son
// las de ordenes-visita.js (MOTIVOS).
const MOTIVOS_VISITA = {
  preventivo: "MANTENIMIENTO PREVENTIVO",
  correctivo: "MANTENIMIENTO CORRECTIVO",
  emergencia: "EMERGENCIA",
  renovacion: "RENOVACIÓN DE CONTRATO",
};

/**
 * Piezas usadas en la orden, agregadas por pieza. La fuente es la subcolección
 * `consumos` —lo que el técnico registró— y no la cotización: al cliente solo
 * se le cobra el consumo 'cobro', pero bodega repone también lo que salió sin
 * costo ('garantia': garantía, renovación de contrato, cortesía).
 */
async function resumenPiezasDeOrden(ordenId) {
  const snap = await db.collection("ordenes_de_servicio").doc(String(ordenId))
    .collection("consumos").get();
  const porPieza = new Map();
  snap.forEach((d) => {
    const c = d.data() || {};
    const qty = Number(c.qty || 0);
    if (!(qty > 0)) return;
    // Clave: el id de catálogo si lo hay; si no, sku o nombre. Una pieza fuera
    // de catálogo (escrita a mano) sigue contando — bodega igual la repone.
    const key = String(c.pieza_id || c.sku || c.pieza_nombre || "").trim().toLowerCase();
    if (!key) return;
    if (!porPieza.has(key)) {
      porPieza.set(key, {
        key,
        nombre: c.pieza_nombre || c.sku || "(sin nombre)",
        sku: c.sku || "",
        fuera_catalogo: c.fuera_catalogo === true,
        total: 0, cobro: 0, garantia: 0,
      });
    }
    const p = porPieza.get(key);
    if (c.fuera_catalogo === true) p.fuera_catalogo = true;
    p.total += qty;
    if (String(c.tipo || "") === "garantia") p.garantia += qty;
    else p.cobro += qty;
  });
  return ordenar([...porPieza.values()]);
}

/**
 * El mismo cuadro, pero sacado de los renglones de la cotización: solo cuando
 * la orden NO tiene consumos (la jefa de taller cotizó a mano). Un renglón a
 * $0 cuenta como "sin costo". Puede traer mano de obra — el correo lo dice.
 */
function resumenPiezasDeCotizacion(cot = {}) {
  const porPieza = new Map();
  CS.renglones(cot).forEach((r) => {
    const key = `${String(r.parte || "").toLowerCase()}|${String(r.nombre || "").toLowerCase()}`;
    if (!porPieza.has(key)) {
      porPieza.set(key, { key, nombre: r.nombre, sku: r.parte || "", fuera_catalogo: false, total: 0, cobro: 0, garantia: 0 });
    }
    const p = porPieza.get(key);
    p.total += r.cant;
    if (r.precio > 0) p.cobro += r.cant; else p.garantia += r.cant;
  });
  return ordenar([...porPieza.values()]);
}

function ordenar(piezas) {
  return piezas.sort((a, b) => (b.total - a.total) || String(a.nombre).localeCompare(String(b.nombre)));
}

// Huella de un conteo: cambia si cambia qué piezas, cuántas o con qué costo.
function huella(piezas, fuente = "consumos") {
  const txt = piezas.map((p) => `${p.key}|${p.cobro}|${p.garantia}`).sort().join("\n");
  return crypto.createHash("sha1").update(`${fuente}\n${txt}`).digest("hex").slice(0, 16);
}

/**
 * El encabezado que bodega pidió ver EN GRANDE: tipo de servicio, motivo y si
 * se le cobra al cliente. "VISITA TÉCNICA: RENOVACIÓN DE CONTRATO – SIN COSTO".
 */
function encabezado(orden = {}, piezas = []) {
  const tipo = norm(orden.tipo_de_servicio);
  const conCosto = piezas.some((p) => p.cobro > 0);
  const costo = conCosto ? "CON COSTO" : "SIN COSTO";
  let servicio;
  if (tipo === "VISITA TECNICA") {
    const motivo = MOTIVOS_VISITA[String(orden.informe_visita?.motivo || "")] || "";
    servicio = `VISITA TÉCNICA${motivo ? `: ${motivo}` : ""}`;
  } else if (tipo === "REPARACION") {
    servicio = "REPARACIÓN EN TALLER";
  } else {
    servicio = String(orden.tipo_de_servicio || "ORDEN DE SERVICIO").toUpperCase();
  }
  return { servicio, costo, conCosto, texto: `${servicio} – ${costo}` };
}

function cuerpoCorreo({ ordenId, orden, piezas, enc, cot, fuente, actualizacion }) {
  const unidades = piezas.reduce((n, p) => n + p.total, 0);
  const fueraCat = piezas.filter((p) => p.fuera_catalogo);
  const tagFc = "<span style=\"display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:#fef3c7;color:#92400e;font:600 11px Arial,sans-serif;\">fuera de catálogo</span>";
  const td = "padding:6px 8px;border-bottom:1px solid #eee;";
  const th = "padding:6px 8px;border-bottom:2px solid #e5e7eb;";
  const filas = piezas.map((p) => `
    <tr>
      <td style="${td}">${esc(p.nombre)}${p.fuera_catalogo ? tagFc : ""}</td>
      <td style="${td}font-family:monospace;">${esc(p.sku || "—")}</td>
      <td style="${td}text-align:right;"><b>${p.total}</b></td>
      <td style="${td}text-align:right;">${p.cobro || "—"}</td>
      <td style="${td}text-align:right;">${p.garantia || "—"}</td>
    </tr>`).join("");
  const dato = (k, v) => (v ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;">${k}</td><td style="padding:2px 0;"><b>${esc(v)}</b></td></tr>` : "");
  const colorCosto = enc.conCosto ? "#0B2A47" : "#065F46";
  return {
    unidades,
    fueraCat,
    html: `
      <div style="margin:0 0 14px;padding:14px 16px;border-radius:8px;background:${enc.conCosto ? "#EFF6FF" : "#ECFDF5"};border-left:6px solid ${colorCosto};">
        <div style="font:800 22px/1.25 Arial,sans-serif;color:${colorCosto};letter-spacing:.01em;">${esc(enc.texto)}</div>
      </div>
      ${actualizacion ? `<p style="margin:0 0 10px;font:600 14px/1.5 Arial,sans-serif;color:#92400E;">
        Actualiza el aviso anterior de esta orden: las piezas cambiaron después. Este conteo es el que vale.</p>` : ""}
      <table role="presentation" style="border-collapse:collapse;font:14px/1.5 Arial,sans-serif;margin:0 0 10px;">
        ${dato("Orden", ordenId)}
        ${dato("Cliente", orden.cliente_nombre || cot?.cliente_nombre || "")}
        ${dato("Técnico", orden.tecnico_asignado || "")}
        ${dato("Sitio", orden.visita?.sitio || "")}
        ${dato("Cotización", cot ? (cot.cotizacion_id || "") : "")}
      </table>
      <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:4px 0;">
        <thead><tr>
          <th style="text-align:left;${th}">Pieza</th>
          <th style="text-align:left;${th}">N.º de parte</th>
          <th style="text-align:right;${th}">Cantidad</th>
          <th style="text-align:right;${th}">Con costo</th>
          <th style="text-align:right;${th}">Sin costo</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <p style="margin:10px 0 0;font:13px/1.5 Arial,sans-serif;color:#374151;">
        ${fuente === "cotizacion"
          ? `El técnico no registró piezas en la orden: este es el detalle de la cotización <b>${esc(cot?.cotizacion_id || "")}</b> y puede incluir mano de obra.`
          : "Es lo que el técnico registró como usado. Compáralo contra lo que le entregaste y pide el ajuste de lo que sobre o falte."}
      </p>
      ${fueraCat.length ? `
      <div style="margin:12px 0 0;padding:10px 12px;border-left:3px solid #B45309;background:#FFFBEB;font:13px/1.5 Arial,sans-serif;">
        <b>${fueraCat.length} pieza(s) fuera de catálogo.</b> El técnico las escribió a mano porque
        no existen en Piezas y tarifas, así que no descontaron stock. Hay que cargarlas al catálogo:
        <ul style="margin:6px 0 0;padding-left:18px;">
          ${fueraCat.map((p) => `<li>${esc(p.nombre)}${p.sku ? ` <span style="font-family:monospace;">(${esc(p.sku)})</span>` : ""} — ${p.total} unidad(es)</li>`).join("")}
        </ul>
      </div>` : ""}`,
  };
}

const refEstado = (ordenId) => db.collection("ordenes_de_servicio").doc(String(ordenId))
  .collection("sistema").doc("piezas_bodega");

/**
 * Avisa a bodega las piezas usadas en una orden, si hay algo nuevo que decir.
 *
 * @param {object} p
 * @param {string} p.ordenId
 * @param {object} [p.orden]        la orden ya leída (si no, se lee)
 * @param {object} [p.cot]          la cotización que dispara (puerta 2)
 * @param {'cierre'|'cotizacion'|'consumo'} p.momento
 * @returns {Promise<{enviado:boolean, motivo?:string, mailId?:string, unidades?:number}>}
 */
async function avisarPiezasABodega({ ordenId, orden = null, cot = null, momento }) {
  const oid = String(ordenId || "");
  if (!oid) return { enviado: false, motivo: "sin_orden" };
  let o = orden;
  if (!o) {
    const s = await db.collection("ordenes_de_servicio").doc(oid).get();
    if (!s.exists) return { enviado: false, motivo: "orden_no_existe" };
    o = s.data() || {};
  }
  if (o.eliminado === true) return { enviado: false, motivo: "orden_eliminada" };

  let piezas = await resumenPiezasDeOrden(oid);
  let fuente = "consumos";
  if (!piezas.length && cot) {
    piezas = resumenPiezasDeCotizacion(cot);
    fuente = "cotizacion";
  }
  if (!piezas.length) return { enviado: false, motivo: "sin_piezas" };

  const to = await bodegaEmailTo();
  if (!to) {
    logger.warn("[piezasBodega] sin buzón de bodega configurado (email_bodega)", { ordenId: oid });
    return { enviado: false, motivo: "sin_buzon" };
  }

  // Reserva de la huella ANTES del correo. Lo ya avisado con consumos no se
  // pisa con el detalle de una cotización (dice menos, no más).
  const h = huella(piezas, fuente);
  const ref = refEstado(oid);
  const reserva = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const prev = s.exists ? s.data() : null;
    if (prev?.huella === h) return { ok: false, motivo: "ya_avisado" };
    if (prev?.huella && prev.fuente === "consumos" && fuente === "cotizacion") return { ok: false, motivo: "ya_avisado_con_consumos" };
    tx.set(ref, {
      huella: h, fuente, momento,
      unidades: piezas.reduce((n, p) => n + p.total, 0),
      tipos: piezas.length,
      veces: admin.firestore.FieldValue.increment(1),
      enviado_at: admin.firestore.FieldValue.serverTimestamp(),
      ...(cot ? { cotizacion_id: cot.cotizacion_id || null } : {}),
    }, { merge: true });
    return { ok: true, actualizacion: !!prev?.huella };
  });
  if (!reserva.ok) return { enviado: false, motivo: reserva.motivo };

  const enc = encabezado(o, piezas);
  const c = cuerpoCorreo({ ordenId: oid, orden: o, piezas, enc, cot, fuente, actualizacion: reserva.actualizacion });
  const cliente = o.cliente_nombre || cot?.cliente_nombre || "Cliente";
  // Copia a la jefatura de taller: es quien responde si bodega pregunta.
  const cc = String(await tallerEmailTo() || "").split(",").map((e) => e.trim().toLowerCase())
    .filter((e) => e && !String(to).toLowerCase().includes(e)).join(", ") || null;
  const mail = await db.collection("mail_queue").add({
    to, cc,
    subject: `Piezas usadas — ${enc.texto} — Orden ${oid} · ${cliente}${reserva.actualizacion ? " (actualizado)" : ""}`,
    preheader: `${c.unidades} unidad(es) en ${piezas.length} tipo(s) de pieza · ${o.tecnico_asignado || "técnico sin asignar"}`,
    bodyContent: c.html,
    ctaUrl: `${APP_BASE_URL}/ordenes/index.html?ids=${encodeURIComponent(oid)}`,
    ctaLabel: "Ver la orden",
    status: "queued",
    meta: {
      source: "piezasBodega", seccion: "piezas_a_bodega", momento, fuente, ordenId: oid,
      tipos: piezas.length, unidades: c.unidades, fuera_catalogo: c.fueraCat.length,
      con_costo: enc.conCosto, actualizacion: reserva.actualizacion,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info("[piezasBodega] aviso de piezas encolado", { ordenId: oid, momento, fuente, unidades: c.unidades, actualizacion: reserva.actualizacion });
  return { enviado: true, mailId: mail.id, unidades: c.unidades, actualizacion: reserva.actualizacion };
}

module.exports = {
  MOTIVOS_VISITA, trabajoHecho, refEstado,
  resumenPiezasDeOrden, resumenPiezasDeCotizacion, huella, encabezado,
  avisarPiezasABodega,
};

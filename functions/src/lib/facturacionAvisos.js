// facturacionAvisos — registro de los momentos que cambian lo que se cobra
// (propuesta "Facturación pendiente", 2026-09-04, caso Brenda / Riba Smith).
//
// Antes, cada momento comercialmente efectivo (contrato activo, aumento
// entregado, baja aprobada…) solo mandaba un correo a activaciones@. Nada
// decía cuáles ya se procesaron en QuickBooks/POC, quién lo hizo ni desde qué
// fecha se factura un contrato firmado tarde. Este módulo crea UN documento
// por evento en `facturacion_avisos`, en el mismo embudo que encola el correo
// (G.avisoFacturacion). El navegador solo marca pasos (rules acotan campos).
//
// NO emite ni activa nada: es el registro de lo que Recepción hace a mano.
// Cuando la app emita facturas, el paso `qbo` se completará solo.

const { admin, db } = require("./admin");

const COL = "facturacion_avisos";
const ITBMS = 0.07;

// tipo → efecto sobre el cobro (la única voz de color de la fila) y pasos que
// aplican. "taller" no es un paso: la OS ya llega a taller por su flujo.
const TIPOS = {
  contrato_activo:        { efecto: "arranca", pasos: { qbo: true, poc: true },  titulo: "Contrato activo" },
  renovacion_activa:      { efecto: "arranca", pasos: { qbo: true, poc: true },  titulo: "Renovación activa" },
  contrato_entregado:     { efecto: "arranca", pasos: { qbo: true, poc: true },  titulo: "Contrato entregado" },
  aumento_entregado:      { efecto: "cambia",  pasos: { qbo: true, poc: true },  titulo: "Aumento entregado" },
  ajuste_tarifa:          { efecto: "cambia",  pasos: { qbo: true, poc: false }, titulo: "Ajuste de tarifa" },
  regularizacion:         { efecto: "cambia",  pasos: { qbo: true, poc: true },  titulo: "Regularización" },
  baja_aprobada:          { efecto: "termina", pasos: { qbo: true, poc: false }, titulo: "Baja aprobada" },
  terminacion_completada: { efecto: "termina", pasos: { qbo: true, poc: true },  titulo: "Terminación completada" },
  venta_propio:           { efecto: "arranca", pasos: { qbo: true, poc: false }, titulo: "Venta con contrato Propio" },
};

const ESTADOS = ["esperando", "pendiente", "hecho", "descartado"];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

// Mensual del contrato desde sus LÍNEAS. `total_mensual` no existe en los
// contratos anteriores a jun-2026 (los 6 de Riba Smith salieron sin monto en
// el correo por eso), y `total` a veces ya trae el ITBMS y a veces no.
function mensualDeContrato(c = {}) {
  const equipos = (Array.isArray(c.equipos) ? c.equipos : [])
    .reduce((s, e) => s + num(e.cantidad) * num(e.precio), 0);
  const cargosRec = (Array.isArray(c.cargos) ? c.cargos : [])
    .filter(cg => cg && cg.recurrente)
    .reduce((s, cg) => s + num(cg.cantidad || 1) * num(cg.monto), 0);
  const cargosUni = (Array.isArray(c.cargos) ? c.cargos : [])
    .filter(cg => cg && !cg.recurrente)
    .reduce((s, cg) => s + num(cg.cantidad || 1) * num(cg.monto), 0);
  const mensual = r2(equipos + cargosRec);
  const exento = c.itbms_aplica === false;
  return {
    mensual,
    unico: r2(cargosUni),
    exento,
    con_itbms: exento ? mensual : r2(mensual * (1 + ITBMS)),
    equipos_n: (Array.isArray(c.equipos) ? c.equipos : []).reduce((s, e) => s + num(e.cantidad), 0),
  };
}

// "6 × PNC360S" / "2 × HP786, 1 × Consola"
function equiposTexto(lineas = []) {
  return (Array.isArray(lineas) ? lineas : [])
    .filter(e => num(e.cantidad) > 0)
    .map(e => `${num(e.cantidad)} × ${String(e.modelo || "—").trim()}`)
    .join(", ");
}

// Id determinista: el mismo evento del mismo origen no se duplica aunque el
// trigger corra dos veces. Un aviso ya cerrado (hecho/descartado) que vuelve
// a dispararse (reactivación, otra baja) es un evento NUEVO → sufijo.
function avisoId(tipo, origenId) {
  return `${tipo}__${String(origenId || "").replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function pasosIniciales(tipo) {
  const def = TIPOS[tipo] || { pasos: { qbo: true, poc: true } };
  const mk = (aplica) => ({ aplica: !!aplica, hecho: false, at: null, por_email: null });
  return { qbo: mk(def.pasos.qbo), poc: mk(def.pasos.poc) };
}

// Estado derivado de los pasos: 'hecho' cuando todos los que aplican están
// hechos. `esperando` y `descartado` se respetan (no dependen de pasos).
function estadoDerivado(aviso = {}) {
  if (aviso.estado === "descartado" || aviso.estado === "esperando") return aviso.estado;
  const pasos = aviso.pasos || {};
  const aplican = Object.values(pasos).filter(p => p && p.aplica);
  if (!aplican.length) return "pendiente";
  return aplican.every(p => p.hecho) ? "hecho" : "pendiente";
}

/**
 * Crea (o refresca) el aviso. Devuelve { id, creado }.
 * @param {object} a
 *   tipo, origen_id (doc que dispara: contrato/gestión), cliente_id,
 *   cliente_nombre, vendedor_email, contrato_id, contrato_doc_id, gestion_id,
 *   orden_id, fecha_efectiva (Date|Timestamp|null), esperando (bool),
 *   contexto {…}, resumen {…}, detalle {…}
 */
async function crearAviso(a) {
  const def = TIPOS[a.tipo];
  if (!def) throw new Error(`tipo de aviso desconocido: ${a.tipo}`);
  let id = avisoId(a.tipo, a.origen_id);
  const ref0 = db.collection(COL).doc(id);
  const snap = await ref0.get();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const fechaEf = a.fecha_efectiva instanceof Date
    ? admin.firestore.Timestamp.fromDate(a.fecha_efectiva)
    : (a.fecha_efectiva || null);

  if (snap.exists) {
    const cur = snap.data() || {};
    if (cur.estado === "hecho" || cur.estado === "descartado") {
      id = `${id}__${Date.now()}`;
    } else {
      // Mismo evento re-disparado: refrescar contexto/resumen sin tocar pasos.
      await ref0.set({
        fecha_efectiva: fechaEf, estado: a.esperando ? "esperando" : (cur.estado || "pendiente"),
        contexto: a.contexto || {}, resumen: a.resumen || {}, detalle: a.detalle || {},
        updated_at: now,
      }, { merge: true });
      return { id, creado: false };
    }
  }

  const doc = {
    tipo: a.tipo,
    efecto: def.efecto,
    titulo: def.titulo,
    estado: a.esperando ? "esperando" : "pendiente",
    cliente_id: a.cliente_id || null,
    cliente_nombre: a.cliente_nombre || "",
    vendedor_email: a.vendedor_email || null,
    contrato_id: a.contrato_id || null,
    contrato_doc_id: a.contrato_doc_id || null,
    gestion_id: a.gestion_id || null,
    orden_id: a.orden_id || null,
    origen: { col: a.origen_col || null, id: a.origen_id || null, source: a.source || null },
    fecha_efectiva: fechaEf,
    contexto: a.contexto || {},
    resumen: a.resumen || {},
    detalle: a.detalle || {},
    pasos: pasosIniciales(a.tipo),
    descarte: null,
    reenvio_solicitado: null,
    correo: { mail_queue_id: null, status: null, error: null },
    historial: [{
      accion: "creado", detalle: a.contexto?.origen_texto || def.titulo,
      fecha_iso: new Date().toISOString(), por_email: null,
    }],
    created_at: now, updated_at: now,
  };
  await db.collection(COL).doc(id).set(doc);
  return { id, creado: true };
}

async function vincularCorreo(id, mailQueueId) {
  if (!id || !mailQueueId) return;
  await db.collection(COL).doc(id).set({
    correo: { mail_queue_id: mailQueueId, status: "queued", error: null },
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  COL, TIPOS, ESTADOS, ITBMS,
  mensualDeContrato, equiposTexto, avisoId, pasosIniciales, estadoDerivado,
  crearAviso, vincularCorreo,
};

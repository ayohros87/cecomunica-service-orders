// Equipos que el cliente NO devolvió y hay que cobrarle — helpers server-side
// de la colección `cobros_equipos`.
// Plan: docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md.
//
// La lógica de negocio (umbral de descuento, días a cobranza, forma del doc)
// DUPLICA la de public/js/services/cobrosEquiposService.js — mantener
// sincronizadas: el trigger de devoluciones abre renglones por aquí y la
// bandeja los cierra por allá, y si divergen el mismo renglón se lee distinto
// según quién lo mire.
const { admin, db } = require("./admin");

const COL = "cobros_equipos";

const ETAPAS = {
  PENDIENTE:   "pendiente",
  EN_COBRANZA: "en_cobranza",
  FACTURADO:   "facturado",
  CONDONADO:   "condonado",
  RECUPERADO:  "recuperado",
};

// Etapas ABIERTAS: las que hay que perseguir (bandeja + correo diario).
const ABIERTAS = [ETAPAS.PENDIENTE, ETAPAS.EN_COBRANZA];

// Mismo umbral que el auto-envío de cotizaciones (15%): el equipo ya conoce
// el número y no hace falta enseñar dos reglas distintas.
const DESCUENTO_LIBRE_PCT = 15;

// Días antes de escalar a cobranza (decidido con el usuario 2026-08-20).
const DIAS_A_COBRANZA = 10;

// Motivos de "No se devuelve" que SÍ son una deuda. `parcial` (renovación
// parcial, el equipo sigue en servicio legítimamente) y `vendido` (la venta ya
// ocurrió) NO abren renglón: no hay nada que perseguir.
const MOTIVOS_COBRABLES = ["perdido", "otro"];

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

function descuentoPct(montoCatalogo, montoUnit) {
  const cat = Number(montoCatalogo) || 0;
  if (cat <= 0) return 0;
  return redondear(Math.max(0, ((cat - (Number(montoUnit) || 0)) / cat) * 100));
}

// Precio de venta del catálogo, o null si el modelo no existe o no lo tiene.
// null NO es 0: significa "nadie ha puesto precio a este modelo", y el renglón
// queda marcado `sin_referencia` para que una persona lo mire. Los modelos
// refurbished (-R) son los más propensos a no tenerlo.
async function precioCatalogo(modeloId) {
  if (!modeloId) return null;
  try {
    const snap = await db.collection("modelos").doc(String(modeloId)).get();
    if (!snap.exists) return null;
    const p = Number(snap.data().precio_venta);
    return Number.isFinite(p) && p > 0 ? redondear(p) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Abre un renglón cobrable. Idempotente por (orden + serial): si el trigger
 * vuelve a correr sobre la misma unidad no duplica la deuda.
 *
 * @returns {Promise<string|null>} id del renglón, o null si ya existía / no aplica
 */
async function abrirCobro({
  cliente_id = "", cliente_nombre = "", orden_devolucion_id = "",
  serial = "", serial_norm = "", pool_doc_id = null,
  modelo_id = "", modelo_label = "", cantidad = 1,
  motivo_codigo = "otro", motivo_detalle = "",
  por_email = "system:devolucion",
} = {}) {
  const norm = (serial_norm || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const qty = norm ? 1 : Math.max(1, Number(cantidad) || 1);

  if (norm && orden_devolucion_id) {
    const ya = await db.collection(COL)
      .where("serial_norm", "==", norm)
      .where("orden_devolucion_id", "==", orden_devolucion_id)
      .limit(1).get();
    if (!ya.empty) return null; // ya abierto: no se duplica la deuda
  }

  const cat = await precioCatalogo(modelo_id);
  const unit = cat === null ? 0 : cat;

  const ref = await db.collection(COL).add({
    cliente_id, cliente_nombre,
    orden_devolucion_id,
    serial: norm ? String(serial || "").trim() : "",
    serial_norm: norm || null,
    pool_doc_id: pool_doc_id || null,
    modelo_id: modelo_id || "",
    modelo_label: modelo_label || "",
    cantidad: qty,
    motivo_codigo, motivo_detalle,
    monto_catalogo_unit: cat,
    monto_unit: unit,
    descuento_pct: descuentoPct(cat, unit),
    monto_total: redondear(unit * qty),
    sin_referencia: cat === null,
    etapa: ETAPAS.PENDIENTE,
    requiere_aprobacion: false,
    aprobado_por_email: "", aprobado_at: null,
    factura_ref: "", facturado_at: null, facturado_por_email: "",
    cerrado_motivo: "",
    desde: admin.firestore.FieldValue.serverTimestamp(),
    escalado_at: null,
    historial: [{
      accion: "abierto",
      detalle: `${qty} × ${modelo_label || "equipo"}${norm ? ` (${norm})` : ""}` +
        `${orden_devolucion_id ? ` — devolución ${orden_devolucion_id}` : ""}`,
      fecha_iso: new Date().toISOString(),
      por_uid: "system", por_email,
    }],
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    por_uid: "system", por_email,
  });
  return ref.id;
}

module.exports = {
  COL, ETAPAS, ABIERTAS, DESCUENTO_LIBRE_PCT, DIAS_A_COBRANZA,
  MOTIVOS_COBRABLES, descuentoPct, precioCatalogo, abrirCobro,
};

// Pool de equipos serializados — helpers server-side (Admin SDK) para la
// "migración por contacto": cada vez que un serial toca el sistema por los
// flujos existentes (seriales de contrato, órdenes de servicio, POC, entregas)
// estos helpers lo dan de alta o lo transicionan en `equipos_pool`.
// Plan: docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md.
//
// La normalización de serial y la clave de modelo DUPLICAN las del frontend
// (public/js/services/equiposPoolService.js) — mantener sincronizadas: una
// divergencia produce docs duplicados del mismo equipo físico.
const { admin, db } = require("../lib/admin");

const ESTADOS = {
  EN_BODEGA:  "en_bodega",
  ASIGNADO:   "asignado_contrato",
  EN_CLIENTE: "en_cliente",
  EN_TALLER:  "en_taller",
  EN_POC:     "en_poc",
  DEVUELTO:   "devuelto_revision",
  BAJA:       "baja",
};

// Serial normalizado: mayúsculas, solo [A-Z0-9]. (== frontend normalizarSerial)
function normSerial(raw) {
  return (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function esSerialValido(serialNorm) {
  return /^[A-Z0-9]{3,30}$/.test(serialNorm);
}

// Clave de modelo para el ID sufijado del failsafe. (== frontend modeloKey)
function modeloKey(modeloId, modeloLabel) {
  if (modeloId) return modeloId;
  const norm = _tightLabel(modeloLabel);
  return norm ? `m_${norm}` : "sinmodelo";
}

function _tightLabel(label) {
  return (label || "").toString().toLowerCase()
    .normalize("NFD").replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// ¿Es la misma unidad-modelo? Las fuentes traen datos desparejos (contrato con
// FK al catálogo, POC/órdenes a veces solo texto; el catálogo además modela
// NUEVO y REUSO como filas distintas: "PNC360S" vs "PNC360S-R"), así que la
// identidad de la unidad se compara por LABEL normalizado ignorando el sufijo
// de reuso — el mismo serial como "PNC360S" en el contrato y "PNC360S-R" en
// POC es el mismo radio físico (la condición vive en `condicion`, no parte la
// identidad). Los ids solo desempatan cuando falta el label; si a un lado le
// falta todo dato de modelo se asume la misma unidad (adoptar > duplicar; una
// colisión real tipo Kenwood NX420/NX920 trae modelo en ambos lados).
function mismoModelo(data, modeloId, modeloLabel) {
  // Misma fila del catálogo → misma unidad, sin importar cómo esté el label.
  if (data.modelo_id && modeloId && data.modelo_id === modeloId) return true;
  const la = _tightLabel(data.modelo_label).replace(/r$/, "");
  const lb = _tightLabel(modeloLabel).replace(/r$/, "");
  if (la && lb) {
    if (la === lb) return true;
    // Marca opcional: una fuente guarda "PNC360S" y otra "HYTERA PNC360S" —
    // si el corto es sufijo del largo (≥4 chars) es el mismo modelo.
    const [corto, largo] = la.length <= lb.length ? [la, lb] : [lb, la];
    return corto.length >= 4 && largo.endsWith(corto);
  }
  // Sin labels comparables: desempata por id; sin ningún dato → misma unidad.
  if (data.modelo_id && modeloId) return data.modelo_id === modeloId;
  return true;
}

function _movimiento({ tipo, de_estado = null, a_estado = null, ref = null, notas = "" }) {
  return {
    at:  admin.firestore.FieldValue.serverTimestamp(),
    por: "system",
    por_email: null,
    tipo, de_estado, a_estado,
    ref: ref || null,
    notas: (notas || "").toString().trim(),
  };
}

function _docNuevo({ serial, serialNorm, modelo_id, modelo_label, estado,
                     asignacion = null, poc_device_id = null, orden_actual_id = null,
                     origen, notas = "" }) {
  return {
    serial: (serial || "").toString().trim(),
    serial_norm: serialNorm,
    serial_compartido: false,
    modelo_id:    modelo_id || null,
    modelo_label: (modelo_label || "").toString().trim(),
    condicion: "reuso",           // ya circula en la operación — no es unidad nueva
    estado,
    asignacion,
    poc_device_id,
    orden_actual_id,
    origen,
    verificado: false,            // migración automática: pendiente de confirmación
    ingreso_bodega_at: null,
    proveedor: "",
    notas: (notas || "").toString().trim(),
    baja_motivo: null,
    created_at:       admin.firestore.FieldValue.serverTimestamp(),
    creado_por_uid:   null,
    creado_por_email: null,
    updated_at:       admin.firestore.FieldValue.serverTimestamp(),
    updated_by:       null,
    updated_by_email: null,
  };
}

// Resuelve el doc del pool para un serial+modelo. Devuelve
// { ref, data|null, colisionConId|null }:
//   · data != null            → doc existente de ESTA unidad (mismo modelo, o
//                               doc sin modelo que se adopta, o único doc)
//   · data == null, colisionConId → el serial existe pero en OTRO(s) modelo(s);
//                               ref apunta al doc sufijado a crear
//   · data == null, sin colisión → no existe; ref apunta al ID limpio
async function resolver(serial, modeloId, modeloLabel) {
  const norm = normSerial(serial);
  const col = db.collection("equipos_pool");
  const snap = await col.where("serial_norm", "==", norm).get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!docs.length) return { ref: col.doc(norm), data: null, colisionConId: null };

  // mismoModelo ya es tolerante (adopta docs/flujos sin datos de modelo).
  const exacto = docs.find((d) => mismoModelo(d, modeloId, modeloLabel));
  if (exacto) return { ref: col.doc(exacto.id), data: exacto, colisionConId: null };

  // Colisión entre modelos (caso Kenwood NX420/NX920): el nuevo doc va sufijado.
  const sufijado = `${norm}__${modeloKey(modeloId, modeloLabel)}`;
  return { ref: col.doc(sufijado), data: null, colisionConId: norm };
}

// Upsert idempotente desde un flujo de contacto.
// opts = {
//   serial, modelo_id, modelo_label,
//   estado,                 // estado destino
//   noTocarDesde: [...],    // estados actuales que NO se transicionan (solo se
//                           //   actualizan los campos extra) — p.ej. en_taller
//   tipo, refMov, notas,    // movimiento
//   origen,                 // migracion_contrato | migracion_orden | migracion_poc
//   extra,                  // campos a fusionar (asignacion, poc_device_id, ...)
// }
// Retorna 'creado' | 'transicion' | 'actualizado' | 'sin-cambio' | 'ignorado'.
async function upsertContacto(opts) {
  const norm = normSerial(opts.serial);
  if (!esSerialValido(norm)) return "ignorado";

  const { ref, data, colisionConId } = await resolver(opts.serial, opts.modelo_id, opts.modelo_label);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      const doc = _docNuevo({
        serial: opts.serial, serialNorm: norm,
        modelo_id: opts.modelo_id, modelo_label: opts.modelo_label,
        estado: opts.estado, origen: opts.origen, notas: opts.notas || "",
        ...(opts.extra || {}),
      });
      if (colisionConId) {
        doc.serial_compartido = true;
        tx.set(db.collection("equipos_pool").doc(colisionConId),
          { serial_compartido: true }, { merge: true });
      }
      tx.set(ref, doc);
      tx.set(ref.collection("movimientos").doc(), _movimiento({
        tipo: "migracion", a_estado: opts.estado, ref: opts.refMov || null,
        notas: opts.notas || `Alta por contacto (${opts.origen})`,
      }));
      return "creado";
    }

    const actual = snap.data();
    const de = actual.estado;
    const update = { ...(opts.extra || {}), updated_at: admin.firestore.FieldValue.serverTimestamp() };
    // Enriquecer modelo cuando el doc lo tiene incompleto y el flujo lo trae.
    if (!actual.modelo_id && opts.modelo_id) update.modelo_id = opts.modelo_id;
    if (!(actual.modelo_label || "").trim() && (opts.modelo_label || "").trim()) {
      update.modelo_label = opts.modelo_label.trim();
    }

    // La baja es terminal: nunca se revive por contacto (se resuelve a mano).
    if (de === ESTADOS.BAJA) return "sin-cambio";

    const noTocar = opts.noTocarDesde || [];
    if (de === opts.estado || noTocar.includes(de)) {
      tx.set(ref, update, { merge: true });
      return de === opts.estado ? "sin-cambio" : "actualizado";
    }

    tx.set(ref, { estado: opts.estado, ...update }, { merge: true });
    tx.set(ref.collection("movimientos").doc(), _movimiento({
      tipo: opts.tipo || "cambio_estado", de_estado: de, a_estado: opts.estado,
      ref: opts.refMov || null, notas: opts.notas || "",
    }));
    return "transicion";
  });
}

// Transición condicionada de un doc EXISTENTE (no crea). `soloDesde` limita los
// estados de partida; si el estado actual no está ahí, no toca nada.
// `condicion(data)` opcional: guard extra sobre el doc (p.ej. mismo contrato).
// Retorna 'transicion' | 'sin-cambio' | 'no-existe'.
async function transicionar(serial, modeloId, modeloLabel,
                            { aEstado, soloDesde = null, condicion = null,
                              tipo, refMov = null, notas = "", extra = {} }) {
  const norm = normSerial(serial);
  if (!esSerialValido(norm)) return "no-existe";
  const { ref, data } = await resolver(serial, modeloId, modeloLabel);
  if (!data) return "no-existe";

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "no-existe";
    const actual = snap.data();
    const de = actual.estado;
    if (de === aEstado) return "sin-cambio";
    if (de === ESTADOS.BAJA) return "sin-cambio";
    if (soloDesde && !soloDesde.includes(de)) return "sin-cambio";
    if (condicion && !condicion(actual)) return "sin-cambio";

    tx.set(ref, { estado: aEstado, ...extra, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref.collection("movimientos").doc(), _movimiento({
      tipo, de_estado: de, a_estado: aEstado, ref: refMov, notas,
    }));
    return "transicion";
  });
}

module.exports = { ESTADOS, normSerial, esSerialValido, modeloKey, mismoModelo, resolver, upsertContacto, transicionar };

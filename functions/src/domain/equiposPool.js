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
  // en_poc ELIMINADO (2026-07-24): POC es la plataforma de airtime, no una
  // ubicación física — la membresía POC vive en poc_device_id, no en estado.
  DEVUELTO:   "devuelto_revision",
  // Ubicación desconocida: la ficha decía en_cliente pero nada la respalda
  // (ni contrato ni orden), o la puso ahí un flujo que resultó estar mal.
  // NO es una ubicación física — es la bandeja de "hay que ir a buscarlo".
  // Sale por donde corresponda: bodega si aparece en el estante, o asignada
  // si se confirma con un cliente.
  POR_CLASIFICAR: "por_clasificar",
  // Venta directa sin contrato (facturada en QuickBooks): la unidad sale de
  // bodega y pasa a propiedad del cliente. NO es terminal como baja — el radio
  // vendido puede volver a taller por una orden de servicio (contacto normal).
  VENDIDO:    "vendido",
  // El cliente NO devolvió la unidad y hay que cobrársela (finiquito, pérdida,
  // se la quedó). Es una ubicación real —está con el cliente— pero NO puede
  // seguir viéndose como `en_cliente`: ahí se confunde con un radio sano de un
  // contrato vivo y nadie lo vuelve a mirar. Así se perdieron los 4 radios del
  // finiquito de TIL PANAMA, que solo existían como una frase en
  // `observaciones`. Sale por una de cuatro puertas, todas explícitas:
  // facturado (→ vendido), condonado (→ baja, solo admin), recuperado
  // (→ en_bodega) o sigue abierto y sale en el correo diario.
  // El avance del cobro NO vive aquí: vive en cobros_equipos.etapa. El pool
  // dice DÓNDE está el equipo; el renglón dice CÓMO va la cobranza.
  // Plan: docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md.
  PENDIENTE_COBRO: "pendiente_cobro",
  BAJA:       "baja",
};

// Serial normalizado: mayúsculas, solo [A-Z0-9]. (== frontend normalizarSerial)
function normSerial(raw) {
  return (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Un serial es 3-30 alfanuméricos Y lleva al menos un dígito. La segunda mitad
// (2026-07-27) existe porque el campo "serial" se usa como cajón de sastre para
// lo que no es radio: "CONSOLA" aparecía en 55 devices POC de otros tantos
// clientes y el pool los colapsaba en UNA ficha; también "GPS", "DEMO",
// "MICROFONO", "CARGADORESYFUENTE", "CELULARCLIENTE". Sin dígito no entra al
// pool (el doc de origen no se toca: la línea del equipo sigue en su orden o
// contrato). Verificado contra las 4 fuentes: 13 textos sin dígito, los 13
// basura — cero seriales reales perdidos. (== frontend esSerialValido)
function esSerialValido(serialNorm) {
  return /^[A-Z0-9]{3,30}$/.test(serialNorm) && /\d/.test(serialNorm);
}

// Clave de modelo para el ID sufijado del failsafe. (== frontend modeloKey)
function modeloKey(modeloId, modeloLabel) {
  if (modeloId) return modeloId;
  const norm = _tightLabel(modeloLabel);
  return norm ? `m_${norm}` : "sinmodelo";
}

function _tightLabel(label) {
  return (label || "").toString().toLowerCase()
    // eslint-disable-next-line no-control-regex -- intencional: recorta todo lo no-ASCII
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
    // Texto de modelo desparejo entre fuentes: con marca o sin marca ("HYTERA
    // PNC360S" vs "PNC360S"), truncado ("PD6" vs "PD606"), o variantes G/U/S
    // ("PD606G" vs "PD606"). Con el MISMO serial, un texto contenido en el
    // otro (≥3 chars) es la misma unidad — dos radios distintos compartiendo
    // serial exacto Y texto contenido es prácticamente imposible; la colisión
    // real tipo Kenwood (NX420 vs NX920) no tiene contención.
    const [corto, largo] = la.length <= lb.length ? [la, lb] : [lb, la];
    return corto.length >= 3 && largo.includes(corto);
  }
  // Sin labels comparables: desempata por id; sin ningún dato → misma unidad.
  if (data.modelo_id && modeloId) return data.modelo_id === modeloId;
  return true;
}

// Invariante de custodia (informe tracking 2026-08-12, P3.2): una unidad
// en_cliente sin cliente en la asignación es un radio "en la calle sin dueño
// registrado" — la brecha que dejó 1,918 unidades sin contrato y 16 sin nada.
// No se bloquea el flujo (avisar, nunca bloquear): se estampa
// `custodia_faltante: true` para que la conciliación y las bandejas lo vean,
// y se borra sola en cuanto una asignación con cliente aparece o el estado
// deja de ser en_cliente. Función pura (test/poolCustodia.test.js).
// `actual` = doc existente ({} en creación — un create no admite delete()).
function custodiaPatch(estadoFinal, asignacionEfectiva, actual = {}) {
  const tiene = !!(asignacionEfectiva
    && (asignacionEfectiva.cliente_id || asignacionEfectiva.cliente_nombre));
  if (estadoFinal === ESTADOS.EN_CLIENTE && !tiene) return { custodia_faltante: true };
  if (actual.custodia_faltante) return { custodia_faltante: admin.firestore.FieldValue.delete() };
  return {};
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
                     propiedad = "desconocida", origen, notas = "" }) {
  return {
    serial: (serial || "").toString().trim(),
    serial_norm: serialNorm,
    serial_compartido: false,
    modelo_id:    modelo_id || null,
    modelo_label: (modelo_label || "").toString().trim(),
    // Condición según la variante del modelo (convención del catálogo: la fila
    // reuso lleva sufijo -R en el nombre). Sin sufijo → se colocó como nuevo.
    condicion: /[\s-]r$/i.test((modelo_label || "").toString().trim()) ? "reuso" : "nuevo",
    // 'cecomunica' (flota propia: alquiler/demo/POC/bodega) | 'cliente' (equipo
    // del cliente: contratos "Propio"/venta, o traído a taller) | 'desconocida'
    propiedad,
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
//
// opts.adoptarSiExiste: el desacuerdo de modelo NO parte la ficha — se adopta
// la que ya existe. Lo usan las fuentes cuyo texto de modelo no manda sobre la
// unidad física (hoy solo POC — decisión "el contrato manda sobre POC",
// 2026-07-27: 35 de los 64 conflictos eran POC contradiciendo al contrato con
// el mismo radio). Las colisiones reales de serial (Kenwood NX420/NX920)
// llegan por contrato u orden, que siguen partiendo la ficha.
async function resolver(serial, modeloId, modeloLabel, opts = {}) {
  const norm = normSerial(serial);
  const col = db.collection("equipos_pool");
  const snap = await col.where("serial_norm", "==", norm).get();
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (!docs.length) return { ref: col.doc(norm), data: null, colisionConId: null };

  // mismoModelo ya es tolerante (adopta docs/flujos sin datos de modelo).
  const exacto = docs.find((d) => mismoModelo(d, modeloId, modeloLabel));
  if (exacto) return { ref: col.doc(exacto.id), data: exacto, colisionConId: null };

  if (opts.adoptarSiExiste) {
    // Sin coincidencia de modelo se adopta la ficha principal del serial (la de
    // ID limpio; si ya estaba partido, la primera). El modelo del llamante NO
    // pisa el de la ficha: upsertContacto solo rellena campos vacíos.
    const principal = docs.find((d) => d.id === norm) || docs[0];
    return { ref: col.doc(principal.id), data: principal, colisionConId: null };
  }

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
//   adoptarSiExiste,        // true: un modelo distinto NO parte la ficha (POC)
// }
// Retorna 'creado' | 'transicion' | 'actualizado' | 'sin-cambio' | 'ignorado'.
async function upsertContacto(opts) {
  const norm = normSerial(opts.serial);
  if (!esSerialValido(norm)) return "ignorado";

  const { ref, data, colisionConId } = await resolver(
    opts.serial, opts.modelo_id, opts.modelo_label,
    { adoptarSiExiste: opts.adoptarSiExiste === true });

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      const extraCreate = { ...(opts.extra || {}) };
      if (extraCreate.asignacionSiFalta) {
        extraCreate.asignacion = extraCreate.asignacion || extraCreate.asignacionSiFalta;
        delete extraCreate.asignacionSiFalta;
      }
      const doc = _docNuevo({
        serial: opts.serial, serialNorm: norm,
        modelo_id: opts.modelo_id, modelo_label: opts.modelo_label,
        estado: opts.estado, origen: opts.origen, notas: opts.notas || "",
        ...extraCreate,
      });
      Object.assign(doc, custodiaPatch(opts.estado, doc.asignacion));
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
    // La propiedad inferida solo se estampa si el doc no la tiene definida —
    // nunca pisa una clasificación existente (pudo ponerla un humano).
    if (update.propiedad && actual.propiedad && actual.propiedad !== "desconocida") {
      delete update.propiedad;
    }
    // asignacionSiFalta: custodia (cliente sin contrato) que solo aplica si el
    // doc no tiene ya una asignación — nunca pisa la de un contrato.
    if (update.asignacionSiFalta) {
      if (!actual.asignacion) update.asignacion = update.asignacionSiFalta;
      delete update.asignacionSiFalta;
    }

    // La baja es terminal: nunca se revive por contacto (se resuelve a mano).
    if (de === ESTADOS.BAJA) return "sin-cambio";

    // Reasignación: la nueva asignación pisa la de OTRO contrato. Por decisión
    // de negocio (2026-07-22) esto se permite — los flujos viejos no daban
    // seguimiento a seriales y el traspaso directo es común — pero tiene que
    // quedar en el historial quién tenía la unidad antes, para conciliación.
    const asigVieja = actual.asignacion;
    const reasignado = update.asignacion && asigVieja
      && (asigVieja.contrato_doc_id || asigVieja.cliente_id)
      && update.asignacion.contrato_doc_id !== asigVieja.contrato_doc_id;
    const notaReasignacion = reasignado
      ? `Reasignado: antes con ${asigVieja.cliente_nombre || "cliente sin nombre"}`
        + (asigVieja.contrato_id ? ` (${asigVieja.contrato_id})` : " (sin contrato)")
      : "";

    // Custodia: la asignación EFECTIVA es la que va a quedar en el doc.
    const asigEfectiva = ("asignacion" in update) ? update.asignacion : actual.asignacion;

    const noTocar = opts.noTocarDesde || [];
    if (de === opts.estado || noTocar.includes(de)) {
      Object.assign(update, custodiaPatch(de, asigEfectiva, actual));
      tx.set(ref, update, { merge: true });
      // Sin transición de estado no habría movimiento: la reasignación silenciosa
      // dejaría al cliente anterior sin rastro. Se registra aparte.
      if (reasignado) {
        tx.set(ref.collection("movimientos").doc(), _movimiento({
          tipo: "reasignacion", de_estado: de, a_estado: de,
          ref: opts.refMov || null, notas: notaReasignacion,
        }));
      }
      return de === opts.estado ? "sin-cambio" : "actualizado";
    }

    // La unidad regresó (entrada/bodega): el flag puesto por los mapeos de
    // transición ya cumplió — se borra para no dejar dato obsoleto en el doc.
    if ((opts.estado === ESTADOS.DEVUELTO || opts.estado === ESTADOS.EN_BODEGA) && actual.pendiente_devolucion) {
      update.pendiente_devolucion = admin.firestore.FieldValue.delete();
    }
    Object.assign(update, custodiaPatch(opts.estado, asigEfectiva, actual));
    tx.set(ref, { estado: opts.estado, ...update }, { merge: true });
    tx.set(ref.collection("movimientos").doc(), _movimiento({
      tipo: opts.tipo || "cambio_estado", de_estado: de, a_estado: opts.estado,
      ref: opts.refMov || null,
      notas: [opts.notas || "", notaReasignacion].filter(Boolean).join(" — "),
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

    const cambios = { ...extra };
    if (cambios.asignacionSiFalta) {
      if (!actual.asignacion) cambios.asignacion = cambios.asignacionSiFalta;
      delete cambios.asignacionSiFalta;
    }
    // La unidad regresó (entrada/bodega): el flag puesto por los mapeos de
    // transición ya cumplió — se borra para no dejar dato obsoleto en el doc.
    if ((aEstado === ESTADOS.DEVUELTO || aEstado === ESTADOS.EN_BODEGA) && actual.pendiente_devolucion) {
      cambios.pendiente_devolucion = admin.firestore.FieldValue.delete();
    }
    Object.assign(cambios, custodiaPatch(aEstado,
      ("asignacion" in cambios) ? cambios.asignacion : actual.asignacion, actual));
    tx.set(ref, { estado: aEstado, ...cambios, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref.collection("movimientos").doc(), _movimiento({
      tipo, de_estado: de, a_estado: aEstado, ref: refMov, notas,
    }));
    return "transicion";
  });
}

// Suelta la asignación a un contrato SIN mover el estado. Existe porque
// transicionar() exige un cambio de estado: cuando el serial deja de estar en
// el contrato pero la unidad está donde dice estar (en_taller por una orden
// viva, vendida, por_clasificar…), no había forma de soltar la asignación y
// quedaba contratada para siempre. Así se duplicaron los equipos de
// PROP20260731-01 y -02 (2026-08-03): se corrigieron los seriales con la orden
// de programación ya abierta, los viejos estaban en_taller, y el contrato
// terminó con el doble de unidades de las que vendió.
// Retorna 'liberado' | 'sin-cambio' | 'no-existe'.
async function desasignarContrato(serial, modeloId, modeloLabel,
                                  { cid, refMov = null, notas = "", extra = {} }) {
  const norm = normSerial(serial);
  if (!esSerialValido(norm)) return "no-existe";
  const { ref, data } = await resolver(serial, modeloId, modeloLabel);
  if (!data) return "no-existe";

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "no-existe";
    const actual = snap.data();
    if (actual.estado === ESTADOS.BAJA) return "sin-cambio";
    // Devolución en curso: la asignación es el hilo que la persigue
    // (onMapeoWrite, recordatorioOperativo C2). No se suelta por una edición
    // de seriales — se resuelve cuando el equipo vuelve.
    if (actual.pendiente_devolucion) return "sin-cambio";
    if (actual.asignacion?.contrato_doc_id !== cid) return "sin-cambio";

    tx.set(ref, { asignacion: null, ...extra,
      updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref.collection("movimientos").doc(), _movimiento({
      tipo: "liberacion", de_estado: actual.estado, a_estado: actual.estado,
      ref: refMov, notas,
    }));
    return "liberado";
  });
}

// Estado desde el que la unidad entró al taller por ESTA orden. El kardex ya lo
// guarda (de_estado del movimiento ingreso_taller), así que deshacer no
// necesita campo nuevo. Los movimientos por ficha son pocos: se filtran en
// memoria para no exigir un índice compuesto.
// Retorna el estado previo o null si no hay rastro.
async function estadoPrevioAOrden(ref, ordenId) {
  try {
    const snap = await ref.collection("movimientos").get();
    let mejor = null;
    snap.forEach((d) => {
      const m = d.data();
      if (m.tipo !== "ingreso_taller" || !m.de_estado) return;
      if (!m.ref || m.ref.id !== ordenId) return;
      const t = m.at && m.at.toMillis ? m.at.toMillis() : 0;
      if (!mejor || t >= mejor.t) mejor = { t, de: m.de_estado };
    });
    return mejor ? mejor.de : null;
  } catch (e) {
    return null;
  }
}

// ¿A dónde va una unidad que SALE del taller sin haberse entregado (se quitó de
// la orden, o la orden se eliminó)? Antes iba siempre a en_cliente — el modelo
// mental era "radio del cliente que vino a reparación y se lo devuelven". Pero
// el caso frecuente es una CORRECCIÓN de la orden (serial mal tecleado o
// cambiado): el radio nunca se entregó, y marcarlo en_cliente lo saca del
// inventario disponible sin que nadie lo note. Los 12 fantasma de
// PROP20260731-01 y los 3 de -02 salieron justo por aquí.
// Función pura (se prueba en test/poolSalidaOrden.test.js).
function destinoAlSalirDeOrden(ficha, estadoPrevio) {
  const tieneContrato = !!(ficha && ficha.asignacion && ficha.asignacion.contrato_doc_id);
  if (estadoPrevio && estadoPrevio !== ESTADOS.EN_TALLER) {
    // asignado_contrato sin contrato es imposible: la asignación se soltó
    // mientras la unidad estaba en el taller (onSerialWrite) → bodega.
    if (estadoPrevio === ESTADOS.ASIGNADO && !tieneContrato) return ESTADOS.EN_BODEGA;
    return estadoPrevio;
  }
  // Sin rastro en el kardex se infiere de la propia ficha.
  if (tieneContrato) return ESTADOS.ASIGNADO;
  if (ficha && ficha.propiedad === "cliente") return ESTADOS.EN_CLIENTE;
  return ESTADOS.EN_BODEGA;
}

// Transición por ID de doc — para flujos que ya identificaron la unidad exacta
// (p.ej. el checklist de entrada al cerrar una enmienda, que lista las unidades
// del pool y manda sus doc IDs). Mismo contrato de retorno que transicionar().
async function transicionarPorId(docId, { aEstado, soloDesde = null, tipo,
                                          refMov = null, notas = "", extra = {} }) {
  const ref = db.collection("equipos_pool").doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "no-existe";
    const actual = snap.data();
    const de = actual.estado;
    if (de === aEstado) return "sin-cambio";
    if (de === ESTADOS.BAJA) return "sin-cambio";
    if (soloDesde && !soloDesde.includes(de)) return "sin-cambio";
    const cambios = { ...extra };
    if ((aEstado === ESTADOS.DEVUELTO || aEstado === ESTADOS.EN_BODEGA) && actual.pendiente_devolucion) {
      cambios.pendiente_devolucion = admin.firestore.FieldValue.delete();
    }
    Object.assign(cambios, custodiaPatch(aEstado,
      ("asignacion" in cambios) ? cambios.asignacion : actual.asignacion, actual));
    tx.set(ref, { estado: aEstado, ...cambios, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(ref.collection("movimientos").doc(), _movimiento({
      tipo, de_estado: de, a_estado: aEstado, ref: refMov, notas,
    }));
    return "transicion";
  });
}

module.exports = { ESTADOS, normSerial, esSerialValido, modeloKey, mismoModelo, resolver,
  upsertContacto, transicionar, transicionarPorId, custodiaPatch,
  desasignarContrato, estadoPrevioAOrden, destinoAlSalirDeOrden };

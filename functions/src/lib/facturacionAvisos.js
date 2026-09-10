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

const logger = require("firebase-functions/logger");
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

// ── Comisiones — F2 de docs/plans/PLAN_COMISIONES.md ────────────────────────
// Qué evento paga comisión y sobre qué base. Decisiones de Alberto 2026-09-10:
// las renovaciones SÍ, sobre el mensual COMPLETO (no el delta contra el
// contrato anterior); los ajustes de tarifa NO, porque el ajuste impacta en la
// renovación y es ahí donde se paga.
//
// El motivo de un `aplica: false` va ESCRITO: la bandeja lo muestra en vez de
// esconder la fila. Un vendedor que no ve su evento asume que se perdió.
const COMISIONABLE = {
  contrato_activo:        { aplica: true,  base: "mensual" },
  renovacion_activa:      { aplica: true,  base: "mensual" },
  // Solo nace cuando el contrato NO tenía aviso previo (§6.1): promover el que
  // ya existe es lo que evita contar dos veces la misma entrega.
  contrato_entregado:     { aplica: true,  base: "mensual" },
  aumento_entregado:      { aplica: true,  base: "delta_mensual" },
  // La base es el monto de la factura de venta, que NO guardamos (solo el
  // número). Sale de QuickBooks en la F4; hasta entonces la base va en null.
  venta_propio:           { aplica: true,  base: "factura_venta" },
  ajuste_tarifa:          { aplica: false, motivo: "el ajuste se comisiona en la renovación" },
  regularizacion:         { aplica: false, motivo: "corrige el registro; no es dinero nuevo" },
  baja_aprobada:          { aplica: false, motivo: "una baja no paga comisión" },
  terminacion_completada: { aplica: false, motivo: "una terminación no paga comisión" },
};

const ESTADOS_COMISION = ["esperando", "listo", "pagada", "no_aplica"];

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

  // Bloque de comisión (§6 del plan). Se DERIVA de los hechos del contrato o
  // de la gestión — por eso se leen aquí, una vez, al nacer el aviso. Si la
  // lectura falla el aviso nace igual: facturación no depende de comisiones.
  let comision = null;
  try {
    const [contrato, gestion] = await Promise.all([
      a.contrato_doc_id ? db.collection("contratos").doc(a.contrato_doc_id).get().then((s) => (s.exists ? s.data() : null)) : null,
      a.gestion_id ? db.collection("gestiones").doc(a.gestion_id).get().then((s) => (s.exists ? s.data() : null)) : null,
    ]);
    comision = bloqueComision(a.tipo, {
      contrato, gestion, resumen: a.resumen || {},
      vendedorEmail: await vendedorDeComision({ contrato, gestion }),
    });
  } catch (e) {
    logger.warn("[facturacionAvisos] bloque de comisión no derivado", { error: e.message, tipo: a.tipo });
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
    ...(comision ? { comision } : {}),
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

// ── Los tres requisitos de comisión, derivados de los HECHOS ────────────────
// Nadie los teclea: firma y entrega salen del contrato o de la gestión, y el
// pago es el único que una persona (o QuickBooks, en la F4) marca.

/**
 * ¿A este contrato le aplica el requisito de ENTREGA?
 *
 * Fuente única del predicado que antes vivía suelto en
 * triggers/contratos/onApproval.js (`esperando`) y en el navegador
 * (clientes-centro.js `_entregaAplica`). Una RENOVACIÓN nunca espera entrega:
 * los radios ya están donde el cliente. Sin esto, la comisión de una
 * renovación se traba PARA SIEMPRE esperando una entrega que no va a existir
 * (caso R. Smith Coronado, ALQ20260601-02).
 */
function entregaAplica(c = {}) {
  if (c.accion === "Renovación" || c.renovacion_sin_equipo === true) return false;
  return (Array.isArray(c.equipos) ? c.equipos : []).some((e) => num(e.cantidad) > 0);
}

// Firma. En un contrato: `firmado` y sin validación pendiente del firmante
// (firmó alguien distinto al representante → administración lo acepta antes de
// que cuente). En una gestión de aumento: cierre.firma con su anexo.
function requisitoFirma(contrato = null, gestion = null) {
  if (gestion) {
    const hecho = gestion.cierre?.firma === true;
    return {
      aplica: true, hecho, at: hecho ? (gestion.anexo_firmado_at || null) : null,
      fuente: hecho ? (gestion.anexo_firma_digital ? "anexo_firma_digital" : "anexo_firmado") : null,
      motivo: hecho ? null : "falta el anexo firmado por el cliente",
    };
  }
  const c = contrato || {};
  const pendiente = c.firmado_pendiente_validacion === true;
  const hecho = c.firmado === true && !pendiente;
  return {
    aplica: true, hecho, at: hecho ? (c.firmado_fecha || null) : null,
    fuente: hecho ? (c.firmado_tipo === "digital" ? "firma_digital" : "firmado_url") : null,
    motivo: hecho ? null
      : pendiente ? "firmó alguien distinto al representante: falta validarlo"
      : "falta la firma del cliente",
  };
}

// Entrega. Con `aplica` explícito y el MOTIVO escrito cuando no aplica.
function requisitoEntrega(contrato = null, gestion = null) {
  if (gestion) {
    const noEntrega = gestion.aumento?.es_regularizacion === true || gestion.aumento?.es_ajuste === true;
    if (noEntrega) {
      return { aplica: false, hecho: false, at: null, motivo: "no entrega equipos nuevos" };
    }
    const hecho = gestion.cierre?.entrega === true;
    return { aplica: true, hecho, at: null, motivo: hecho ? null : "los equipos no se han entregado" };
  }
  const c = contrato || {};
  if (!entregaAplica(c)) {
    return {
      aplica: false, hecho: false, at: null,
      motivo: c.accion === "Renovación"
        ? "renovación: los equipos ya están en el cliente"
        : "el contrato no lleva equipos por entregar",
    };
  }
  const hecho = c.entrega_confirmada === true;
  return {
    aplica: true, hecho, at: hecho ? (c.fecha_entrega_ultima || null) : null,
    motivo: hecho ? null : "los equipos no se han entregado",
  };
}

// Pago. El único que no se deriva: lo marca una persona, o QuickBooks en la
// F4. `hecho` exige la factura en CERO (decisión de Alberto 2026-09-10): un
// abono parcial no libera la comisión.
function requisitoPagoVacio() {
  return {
    aplica: true, hecho: false, at: null,
    factura: null, monto: null, saldo: null, fuente: null,
    motivo: "falta confirmar el primer pago (factura en cero)",
  };
}

/**
 * Estado de la comisión, DERIVADO. No hay booleano que alguien prenda:
 *   no_aplica → el tipo de evento no paga comisión
 *   pagada    → alguien cerró el período (liberada_at)
 *   listo     → todo requisito que aplica está hecho
 *   esperando → falta alguno
 */
function estadoComision(com = {}) {
  if (com.aplica === false) return "no_aplica";
  if (com.liberada_at || com.periodo) return "pagada";
  const req = Object.values(com.requisitos || {}).filter((x) => x && x.aplica);
  return req.length && req.every((x) => x.hecho) ? "listo" : "esperando";
}

/**
 * Arma el bloque `comision` de un aviso a partir de los hechos.
 * @param {string} tipo  tipo del aviso (clave de COMISIONABLE)
 * @param {object} o     { contrato, gestion, vendedorEmail, resumen }
 */
function bloqueComision(tipo, { contrato = null, gestion = null, vendedorEmail = null, resumen = {} } = {}) {
  const def = COMISIONABLE[tipo];
  const vacio = {
    aplica: false, estado: "no_aplica",
    motivo: def?.motivo || "este tipo de evento no paga comisión",
    vendedor_email: null, base: null, base_de: null,
    porcentaje: null, monto: null, regla_id: null,
    requisitos: {}, periodo: null, liberada_por: null, liberada_at: null, nota: null,
  };
  if (!def || !def.aplica) return vacio;

  // Reservados en null para cuando la bandeja calcule (decisión 4, §11): que
  // agregar el cálculo sea agregar el cálculo, no migrar los documentos.
  const com = {
    aplica: true, estado: "esperando", motivo: null,
    vendedor_email: vendedorEmail || null,
    base: def.base === "delta_mensual" ? r2(num(resumen.delta_mensual))
      : def.base === "factura_venta" ? null   // sale de QuickBooks en la F4
      : r2(num(resumen.mensual)),
    base_de: def.base,
    porcentaje: null, monto: null, regla_id: null,
    requisitos: {
      firma: requisitoFirma(contrato, gestion),
      entrega: requisitoEntrega(contrato, gestion),
      pago: requisitoPagoVacio(),
    },
    periodo: null, liberada_por: null, liberada_at: null, nota: null,
  };
  com.estado = estadoComision(com);
  return com;
}

/**
 * Vendedor al que se le comisiona. Decisión de Alberto 2026-09-10: es QUIEN
 * HIZO el trabajo, no el `vendedor_asignado` del cliente.
 *   - gestión  → `responsable_email` (se estampa al crearla; 23/23 lo tienen)
 *   - contrato → el email del `creado_por_uid`
 * OJO: NO es el mismo dato que `vendedor_email` del aviso, que es el asignado
 * del cliente y sirve para el CC del correo. Son dos cosas distintas a
 * propósito.
 */
async function vendedorDeComision({ contrato = null, gestion = null } = {}) {
  const directo = gestion?.responsable_email || null;
  const limpio = (e) => {
    const v = String(e || "").trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
    return v.endsWith("@sin.email.cecomunica.com") ? null : v;
  };
  if (limpio(directo)) return limpio(directo);
  const uid = gestion?.responsable_uid || contrato?.creado_por_uid || null;
  if (!uid) return null;
  try {
    const u = await db.collection("usuarios").doc(uid).get();
    return u.exists ? limpio(u.data().email) : null;
  } catch { return null; }   // ficha ilegible: la bandeja lo muestra "sin vendedor"
}

/**
 * Re-deriva FIRMA y ENTREGA de las comisiones de un origen. Lo llaman los
 * triggers cuando el hecho cambia: se firmó, se validó al firmante, se
 * entregó, se cerró la gestión.
 *
 * Hace falta porque el aviso no siempre nace con el hecho ya escrito. El caso
 * claro es `aumento_entregado`: onOrdenWriteGestion crea el aviso ANTES de
 * escribir `cierre.entrega` (el `gRef.set(patch)` va al final de la función),
 * así que al nacer la comisión lee una gestión que todavía dice "sin
 * entregar".
 *
 * Lo que NO toca: `pago` (lo marca una persona o QuickBooks), `periodo`,
 * `base`, ni una comisión ya `pagada` — una comisión cerrada no se reabre
 * porque un dato del contrato se movió después.
 *
 * @returns {Promise<number>} cuántos avisos cambiaron.
 */
async function refrescarRequisitosComision(origenId, { contrato = null, gestion = null } = {}) {
  // Sin ningún documento no hay nada que derivar, y derivar de la nada
  // regresaría los requisitos a "no hecho".
  if (!origenId || (!contrato && !gestion)) return 0;

  const snap = await db.collection(COL).where("origen.id", "==", origenId).get();
  let tocados = 0;
  for (const d of snap.docs) {
    const com = (d.data() || {}).comision;
    if (!com || com.aplica === false) continue;
    if (com.estado === "pagada" || com.liberada_at) continue;

    const firma = requisitoFirma(contrato, gestion);
    const entrega = requisitoEntrega(contrato, gestion);
    const estado = estadoComision({ ...com, requisitos: { ...(com.requisitos || {}), firma, entrega } });

    const igual = com.estado === estado
      && com.requisitos?.firma?.hecho === firma.hecho
      && com.requisitos?.firma?.aplica === firma.aplica
      && com.requisitos?.entrega?.hecho === entrega.hecho
      && com.requisitos?.entrega?.aplica === entrega.aplica;
    if (igual) continue;

    // set+merge hace merge PROFUNDO de mapas: requisitos.pago sobrevive.
    await d.ref.set({
      comision: { requisitos: { firma, entrega }, estado },
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tocados++;
  }
  return tocados;
}

/**
 * ENTREGA de un contrato que quedó activo "esperando la entrega": PROMUEVE el
 * aviso que ya existe, no crea otro.
 *
 * El hueco que cierra (F1 de docs/plans/PLAN_COMISIONES.md): onApproval crea el
 * aviso con `esperando: true` cuando el contrato lleva equipo por entregar, y
 * al entregarse `onOrdenEntregada` estampaba `entrega_confirmada` en el
 * contrato Y NADA MÁS. El aviso se quedaba en "Espera" para siempre: Recepción
 * nunca se enteraba de que ya podía facturar, y el correo de activación —que
 * promete literalmente "te avisaremos cuando se entregue"— no cumplía nunca.
 *
 * Un aviso NUEVO por la entrega sería contar dos veces el mismo hecho (el
 * mismo contrato daría comisión dos veces). Por eso se mueve el que ya está.
 *
 * Idempotente. Y la diferencia entre "no hay aviso" y "ya lo promoví" IMPORTA:
 * si las dos devolvieran null, una segunda entrega del mismo evento (Cloud
 * Functions reintenta) crearía un `contrato_entregado` encima del aviso ya
 * promovido — dos documentos para un solo hecho, o sea la comisión pagada dos
 * veces. Por eso `null` significa SOLO "este contrato no tiene ningún aviso".
 *
 * @returns {Promise<{id, promovido, aviso}|null>}
 *   null                        → el contrato no tiene aviso: hay que crearlo.
 *   { promovido: true,  … }     → se movió ahora: toca mandar el correo.
 *   { promovido: false, … }     → ya había aviso y no estaba esperando: nada
 *                                 que hacer (reintento, o un contrato que
 *                                 arrancó a facturar sin esperar la entrega).
 */
async function promoverPorEntrega(origenId, { fechaEntrega = null, detalle = "" } = {}) {
  if (!origenId) return null;
  // Una sola igualdad: sin índice compuesto y sin riesgo. Un contrato tiene a
  // lo sumo un par de avisos, así que el filtro de estado va en memoria.
  const snap = await db.collection(COL).where("origen.id", "==", origenId).get();
  if (snap.empty) return null;

  const doc = snap.docs.find((d) => (d.data() || {}).estado === "esperando");
  if (!doc) return { id: snap.docs[0].id, promovido: false, aviso: snap.docs[0].data() || {} };

  const cur = doc.data() || {};
  const fechaEf = fechaEntrega instanceof Date
    ? admin.firestore.Timestamp.fromDate(fechaEntrega)
    : (fechaEntrega || admin.firestore.Timestamp.now());

  await doc.ref.set({
    estado: "pendiente",
    fecha_efectiva: fechaEf,
    contexto: { ...(cur.contexto || {}), entrega_pendiente: false },
    historial: admin.firestore.FieldValue.arrayUnion({
      accion: "entrega_confirmada",
      detalle: detalle || "Equipos entregados — ya se puede facturar",
      fecha_iso: new Date().toISOString(),
      por_email: null,
    }),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { id: doc.id, promovido: true, aviso: { ...cur, estado: "pendiente", fecha_efectiva: fechaEf } };
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
  crearAviso, promoverPorEntrega, vincularCorreo,
  // Comisiones (PLAN_COMISIONES.md F2)
  COMISIONABLE, ESTADOS_COMISION,
  entregaAplica, requisitoFirma, requisitoEntrega, requisitoPagoVacio,
  estadoComision, bloqueComision, vendedorDeComision, refrescarRequisitosComision,
};

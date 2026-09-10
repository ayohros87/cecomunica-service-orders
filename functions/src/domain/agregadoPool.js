// Resumen precalculado del pool por modelo — un doc por `modeloKey` en la
// colección `agregados_pool`.
//
// POR QUÉ EXISTE (auditoría de consumo 2026-09-10): Almacén · Existencias leía
// las 7,592 fichas de `equipos_pool` en CADA apertura, solo para pintar
// conteos por modelo y estado. Eran ~197,000 lecturas al día — el mayor
// consumidor del proyecto, ~70% del total. Firestore no tiene GROUP BY y la
// agrupación es por `modeloKey` (una normalización que reconcilia modelo_id
// con etiquetas sueltas), así que contar en el servidor con `count()` habría
// exigido ~714 consultas por carga. La salida es precalcular.
//
// POR QUÉ UN DOC POR MODELO Y NO UNO SOLO: un backfill que mueve cientos de
// unidades dispara cientos de increments. Contra un único documento eso pelea
// con el límite práctico de ~1 escritura/segundo por doc; repartido en ~119
// docs la contención es manejable. Y leer 119 docs sigue siendo el 1.5% de
// leer 7,592.
//
// EL TRIGGER NO LEE EL POOL: aplica deltas con FieldValue.increment, así que
// mover una unidad cuesta 2 escrituras y CERO lecturas. La reconciliación
// recalcula desde cero y corrige cualquier deriva (un delta perdido por
// contención, un write que no disparó el trigger, un script que escribió en
// crudo). Mientras tanto el número puede quedar corrido: este agregado sirve
// para PINTAR, nunca para decidir una mutación.
//
// Ojo: escribe en `agregados_pool`, jamás en `equipos_pool` — no puede
// realimentarse a sí mismo (ver el bucle de incidencias de ago-2026).

const { FieldValue } = require("firebase-admin/firestore");
const { modeloKey } = require("./equiposPool");

const COL = "agregados_pool";
const META = "agregados_meta";
const META_DOC = "pool";
// El reporte vive donde el resto de la salud del sistema (Admin · Salud):
// admin_reportes es legible por admin y no escribible desde el navegador.
const REPORTE = "admin_reportes";
const REPORTE_DOC = "agregado_pool";
// Cuántas corridas se recuerdan. La pregunta que contesta el historial no es
// "cuánto se corrió una vez" sino "¿esto se repite?" — un mes de corridas
// diarias basta para verlo, y cabe de sobra en un documento.
const HISTORIAL_MAX = 30;
const MUESTRA_MAX = 50;

// Estado con el que se contabiliza una ficha sin `estado` — no debería pasar,
// pero un doc a medio escribir no puede tumbar el conteo ni perderse en
// silencio: cae en su propia casilla y la reconciliación lo delata.
const SIN_ESTADO = "sin_estado";

// Lo único que del pool le importa al agregado.
function claveDe(data) {
  if (!data) return null;
  return {
    key: modeloKey(data.modelo_id, data.modelo_label),
    estado: data.estado || SIN_ESTADO,
    modelo_id: data.modelo_id || null,
    modelo_label: data.modelo_label || "",
  };
}

// ¿El cambio afecta al agregado? Mover `notas` o `verificado` no mueve ningún
// conteo — el 90% de las escrituras del pool no tocan modelo ni estado.
function afecta(a, b) {
  if (!a || !b) return true;                       // alta o baja de la ficha
  return a.key !== b.key
      || a.estado !== b.estado
      || a.modelo_id !== b.modelo_id
      || a.modelo_label !== b.modelo_label;
}

// Aplica el delta de UNA ficha. Devuelve true si tocó algo.
async function aplicarDelta(db, { antes, despues }) {
  const a = claveDe(antes);
  const b = claveDe(despues);
  if (!afecta(a, b)) return false;

  const ops = [];
  if (a) {
    ops.push(db.collection(COL).doc(a.key).set({
      est: { [a.estado]: FieldValue.increment(-1) },
      actualizado_en: FieldValue.serverTimestamp(),
    }, { merge: true }));
  }
  if (b) {
    // El label/id se refrescan en cada toque: si a la ficha le llenaron el
    // modelo_id después, el agregado lo adopta sin esperar la reconciliación.
    ops.push(db.collection(COL).doc(b.key).set({
      modelo_id: b.modelo_id,
      modelo_label: b.modelo_label,
      est: { [b.estado]: FieldValue.increment(1) },
      actualizado_en: FieldValue.serverTimestamp(),
    }, { merge: true }));
  }
  await Promise.all(ops);
  return true;
}

// Deja constancia de que el agregado puede estar corrido. No intenta arreglarlo
// en caliente: reparar aquí significaría leer el pool entero desde un trigger,
// que es justo el gasto que se está evitando.
async function marcarDeriva(db, motivo) {
  await db.collection(META).doc(META_DOC).set({
    deriva: true,
    deriva_motivo: String(motivo || "").slice(0, 300),
    deriva_en: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// Arma el reporte de una corrida. Puro a propósito: es la parte que contesta
// "¿esto se repite?" y merece prueba propia.
//
// `veniaMarcado` es la marca que dejó el trigger al fallar un delta. Importa
// registrarla ANTES de limpiarla: si la reconciliación se limitara a poner
// deriva:false, un trigger que falla todos los días se vería igual de sano que
// uno que nunca falló.
function armarReporte({ fichas, modelos, difs, sobrantes, veniaMarcado, motivoPrevio, historialPrevio, en }) {
  const hubo = difs.length > 0 || sobrantes.length > 0 || !!veniaMarcado;
  const entrada = {
    en: en || null,
    difs: difs.length,
    sobrantes: sobrantes.length,
    venia_marcado: !!veniaMarcado,
    motivo_previo: motivoPrevio || null,
    // En el historial cabe poco: lo que importa de una corrida vieja es QUÉ
    // modelo se corrió, para poder ver si es siempre el mismo.
    muestra: difs.slice(0, 10),
  };
  // Solo las corridas CON deriva entran al historial; las sanas ya se ven en
  // `corridas_limpias_seguidas` y llenarían el documento de ruido.
  const historial = hubo
    ? [entrada, ...(historialPrevio || [])].slice(0, HISTORIAL_MAX)
    : (historialPrevio || []).slice(0, HISTORIAL_MAX);

  return {
    hubo,
    doc: {
      corrida_en: en || null,
      fichas, modelos,
      ok: !hubo,
      difs: difs.length,
      sobrantes: sobrantes.length,
      venia_marcado: !!veniaMarcado,
      motivo_previo: motivoPrevio || null,
      muestra: difs.slice(0, MUESTRA_MAX),
      sobrantes_lista: sobrantes.slice(0, MUESTRA_MAX),
      historial,
      derivas_registradas: historial.length,
    },
  };
}

// Recalcula TODO desde el pool. Una lectura por ficha — se corre a diario, no
// por escritura. Devuelve el reporte de deriva para poder auditarla.
async function recalcular(db, { aplicar = true } = {}) {
  const snap = await db.collection("equipos_pool")
    .select("modelo_id", "modelo_label", "estado")
    .get();

  const real = new Map();
  snap.forEach(doc => {
    const k = claveDe(doc.data());
    const cur = real.get(k.key)
      || { modelo_id: k.modelo_id, modelo_label: k.modelo_label, est: {} };
    cur.est[k.estado] = (cur.est[k.estado] || 0) + 1;
    // Un grupo por etiqueta puede tener fichas con y sin modelo_id; gana el
    // primero que lo traiga, igual que hace el front al armar las filas.
    if (!cur.modelo_id && k.modelo_id) cur.modelo_id = k.modelo_id;
    if (!cur.modelo_label && k.modelo_label) cur.modelo_label = k.modelo_label;
    real.set(k.key, cur);
  });

  const previo = new Map();
  const antesSnap = await db.collection(COL).get();
  antesSnap.forEach(d => previo.set(d.id, d.data() || {}));

  const difs = [];
  for (const [key, val] of real) {
    const p = previo.get(key);
    const pEst = (p && p.est) || {};
    const estados = new Set([...Object.keys(val.est), ...Object.keys(pEst)]);
    for (const e of estados) {
      const nuevo = val.est[e] || 0;
      const viejo = Number(pEst[e] || 0);
      if (nuevo !== viejo) difs.push({ key, estado: e, tenia: viejo, real: nuevo });
    }
  }
  // Modelos que ya no tienen ninguna unidad: el doc sobra.
  const sobrantes = [...previo.keys()].filter(k => !real.has(k));

  if (aplicar) {
    let batch = db.batch();
    let n = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
    for (const [key, val] of real) {
      // `set` sin merge: reemplaza `est` entero, que es el punto de recalcular
      // (un merge dejaría vivos los estados que ya no existen).
      batch.set(db.collection(COL).doc(key), {
        modelo_id: val.modelo_id,
        modelo_label: val.modelo_label,
        est: val.est,
        actualizado_en: FieldValue.serverTimestamp(),
        reconciliado_en: FieldValue.serverTimestamp(),
      });
      if (++n >= 400) await flush();
    }
    for (const key of sobrantes) {
      batch.delete(db.collection(COL).doc(key));
      if (++n >= 400) await flush();
    }
    await flush();

    // Lo que el trigger haya marcado se LEE antes de limpiarlo, y queda en el
    // reporte. Limpiar sin registrar haría invisible justo lo que se vigila.
    const metaPrevia = (await db.collection(META).doc(META_DOC).get()).data() || {};
    const repRef = db.collection(REPORTE).doc(REPORTE_DOC);
    const repPrevio = (await repRef.get()).data() || {};
    const { hubo, doc } = armarReporte({
      fichas: snap.size,
      modelos: real.size,
      difs, sobrantes,
      veniaMarcado: metaPrevia.deriva === true,
      motivoPrevio: metaPrevia.deriva_motivo || null,
      historialPrevio: Array.isArray(repPrevio.historial) ? repPrevio.historial : [],
      en: new Date().toISOString(),
    });
    await repRef.set({
      ...doc,
      // Racha de corridas limpias: la señal de un vistazo en Admin · Salud.
      corridas_limpias_seguidas: hubo ? 0 : Number(repPrevio.corridas_limpias_seguidas || 0) + 1,
      ultima_deriva_en: hubo ? doc.corrida_en : (repPrevio.ultima_deriva_en || null),
      actualizado_en: FieldValue.serverTimestamp(),
    });

    await db.collection(META).doc(META_DOC).set({
      deriva: false,
      deriva_motivo: null,
      reconciliado_en: FieldValue.serverTimestamp(),
      fichas: snap.size,
      modelos: real.size,
    }, { merge: true });
  }

  return {
    fichas: snap.size,
    modelos: real.size,
    difs,
    sobrantes,
    ok: difs.length === 0 && sobrantes.length === 0,
  };
}

module.exports = {
  COL, META, META_DOC, REPORTE, REPORTE_DOC, HISTORIAL_MAX,
  claveDe, afecta, aplicarDelta, marcarDeriva, armarReporte, recalcular,
};

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

module.exports = { COL, META, META_DOC, claveDe, afecta, aplicarDelta, marcarDeriva, recalcular };

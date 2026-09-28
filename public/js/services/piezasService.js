const PiezasService = {

  async getPieza(id) {
    const db = firebase.firestore();
    const doc = await db.collection('inventario_piezas').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async getPiezas() {
    const db = firebase.firestore();
    try {
      const snap = await db.collection('inventario_piezas').orderBy('marca').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
      // Fallback if index not ready
      const snap = await db.collection('inventario_piezas').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  },

  async addPieza(data) {
    const db = firebase.firestore();
    return db.collection('inventario_piezas').add({
      ...data,
      creado_en: firebase.firestore.FieldValue.serverTimestamp(),
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updatePieza(id, fields) {
    const db = firebase.firestore();
    return db.collection('inventario_piezas').doc(id).update({
      ...fields,
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deletePieza(id) {
    const db = firebase.firestore();
    return db.collection('inventario_piezas').doc(id).delete();
  },

  // Atomically set stock to an absolute value.
  async ajustarCantidad(id, cantidad) {
    const db = firebase.firestore();
    const ref = db.collection('inventario_piezas').doc(id);
    return db.runTransaction(async t => {
      await t.get(ref);
      t.update(ref, {
        cantidad,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
  },

  // Atomically apply a signed delta (+/-) to stock; result clamped to >= 0.
  // Auditoría UX 2026-09-28: el recorte a 0 ya no es silencioso — devuelve
  // { antes, despues, pedido, recortado, faltante } y, salvo `avisar:false`,
  // muestra un Toast cuando el stock no alcanzaba (el consumo de una orden
  // descontaba de más y nadie se enteraba). `motivo` (opcional) deja el
  // último ajuste en el doc: `ultimo_ajuste {delta, motivo, por, fecha}`.
  // Además, cada ±N queda en el kardex de la pieza (subcolección `kardex`,
  // P2 §4.6): delta, antes/después, motivo, quién y de dónde vino (`origen`:
  // 'ajuste' desde Piezas, 'orden' desde el consumo de una orden, …). Se
  // escribe DESPUÉS de la transacción y a prueba de fallos: si las rules aún
  // no lo permiten, el stock se ajusta igual y se avisa en consola.
  async ajustarDelta(id, delta, { motivo = '', avisar = true, origen = '', ref: refOrigen = null } = {}) {
    const db = firebase.firestore();
    const ref = db.collection('inventario_piezas').doc(id);
    const res = await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (!doc.exists) return null;
      const d = doc.data();
      const actual = Number(d.cantidad || 0);
      const nueva = Math.max(actual + delta, 0);
      const campos = {
        cantidad: nueva,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (motivo) {
        const u = firebase.auth().currentUser;
        campos.ultimo_ajuste = {
          delta, motivo: String(motivo).trim(),
          por: u?.email || u?.uid || '',
          fecha: firebase.firestore.FieldValue.serverTimestamp(),
          antes: actual, despues: nueva,
        };
      }
      t.update(ref, campos);
      return {
        antes: actual, despues: nueva, pedido: delta,
        recortado: actual + delta < 0, faltante: actual + delta < 0 ? -(actual + delta) : 0,
        etiqueta: d.nombre || [d.marca, d.sku].filter(Boolean).join(' ') || id,
      };
    });
    if (res?.recortado) {
      console.warn('[Piezas] ajuste recortado a 0:', id, res);
      if (avisar && window.Toast) {
        Toast.show(`Stock de ${res.etiqueta}: había ${res.antes} y se pidió descontar ${-delta}. Quedó en 0 — faltan ${res.faltante}; revisa el conteo.`, 'warn');
      }
    }
    if (res) {
      try {
        const u = firebase.auth().currentUser;
        await ref.collection('kardex').add({
          delta, antes: res.antes, despues: res.despues,
          motivo: String(motivo || '').trim(),
          origen: origen || (motivo ? 'ajuste' : 'sistema'),
          ref: refOrigen || null,
          por: u?.uid || 'system', por_email: u?.email || null,
          fecha: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('[Piezas] kardex no registrado:', id, e?.code || e);
      }
    }
    return res;
  },

  // Kardex de una pieza, más reciente primero.
  async getKardex(id, { limite = 100 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('inventario_piezas').doc(id).collection('kardex')
      .orderBy('fecha', 'desc').limit(limite).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Batch-insert up to 450 piezas at a time (Firestore limit is 500 per batch).
  async importarPiezas(rows, creado_por_uid) {
    const db = firebase.firestore();
    const CHUNK = 450;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = db.batch();
      for (const pieza of rows.slice(i, i + CHUNK)) {
        const ref = db.collection('inventario_piezas').doc();
        batch.set(ref, {
          ...pieza,
          creado_por_uid,
          creado_en: firebase.firestore.FieldValue.serverTimestamp(),
          actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  },

  // ── Clave modelo_norm de analytics_piezas_modelo ───────────────────────────
  // ÚNICA fuente de la normalización: la usan el escritor (registro de
  // consumos en ordenes-equipos → incrementarUsoAnalytics) y el lector
  // (sugeridas en cotizar-orden → getTopByModelo). Si esto se edita, ambos
  // lados cambian juntos; nunca copiar esta lógica a una página.
  _normKey(x = '') {
    return String(x).toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  },

  modeloNormDeEquipo(equipo = {}) {
    const m = this._normKey(equipo.modelo || equipo.MODEL || equipo.modelo_nombre || '');
    const b = this._normKey(equipo.marca || equipo.fabricante || '');
    return b ? `${b}_${m}` : m;
  },

  async getTopByModelo(modeloNorm, limit = 8) {
    const db = firebase.firestore();
    const snap = await db.collection('analytics_piezas_modelo')
      .where('modelo_norm', '==', modeloNorm)
      .orderBy('usos_cobro', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => d.data());
  },

  // Paginated catalog fetch from Firestore (used when local inventory cache is bypassed).
  async listCatalogPage({ marca = '', lastDoc = null, pageSize = 50 } = {}) {
    const db = firebase.firestore();
    const col = db.collection('inventario_piezas');
    let q = marca
      ? col.where('activo', '!=', false).where('marca', '==', marca).orderBy('sku').limit(pageSize)
      : col.where('activo', '!=', false).orderBy('activo').orderBy('marca').orderBy('sku').limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    return {
      docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
    };
  },

  // Returns a new auto-ID document reference in the inventario_piezas collection.
  newDocRef() {
    return firebase.firestore().collection('inventario_piezas').doc();
  },

  async incrementarUsoAnalytics(modeloNorm, piezaId) {
    if (!modeloNorm || !piezaId) return;
    const db = firebase.firestore();
    const ref = db.collection('analytics_piezas_modelo').doc(`${modeloNorm}::${piezaId}`);
    return db.runTransaction(async t => {
      const s = await t.get(ref);
      if (!s.exists) {
        t.set(ref, { modelo_norm: modeloNorm, pieza_id: piezaId, usos_cobro: 1, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
      } else {
        t.update(ref, { usos_cobro: Number(s.data().usos_cobro || 0) + 1, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
      }
    });
  },
};

window.PiezasService = PiezasService;

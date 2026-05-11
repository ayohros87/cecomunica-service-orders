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
  async ajustarDelta(id, delta) {
    const db = firebase.firestore();
    const ref = db.collection('inventario_piezas').doc(id);
    return db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      const actual = Number(doc.data().cantidad || 0);
      const nueva = Math.max(actual + delta, 0);
      t.update(ref, {
        cantidad: nueva,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
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

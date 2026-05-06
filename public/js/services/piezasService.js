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
};

window.PiezasService = PiezasService;

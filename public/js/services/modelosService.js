const ModelosService = {

  async getModelos({ source = null } = {}) {
    const db = firebase.firestore();
    const snap = source
      ? await db.collection('modelos').get({ source })
      : await db.collection('modelos').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async addModelo(data) {
    const db = firebase.firestore();
    return db.collection('modelos').add({
      ...data,
      creado_en: firebase.firestore.FieldValue.serverTimestamp(),
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updateModelo(id, fields) {
    const db = firebase.firestore();
    return db.collection('modelos').doc(id).update({
      ...fields,
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Batch-insert de modelos (Firestore: 500 por batch). Usado por la importación
  // desde QuickBooks.
  async importModelos(rows, creado_por_uid) {
    const db = firebase.firestore();
    const CHUNK = 450;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = db.batch();
      for (const m of rows.slice(i, i + CHUNK)) {
        const ref = db.collection('modelos').doc();
        batch.set(ref, {
          ...m,
          creado_por_uid,
          creado_en: firebase.firestore.FieldValue.serverTimestamp(),
          actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  },

  async setActivo(id, activo) {
    const db = firebase.firestore();
    return db.collection('modelos').doc(id).update({
      activo,
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteModelo(id) {
    const db = firebase.firestore();
    return db.collection('modelos').doc(id).delete();
  },

  async getModelo(id) {
    const db = firebase.firestore();
    const doc = await db.collection('modelos').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },
};

window.ModelosService = ModelosService;

const ModelosService = {

  async getModelos() {
    const db = firebase.firestore();
    const snap = await db.collection('modelos').get();
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

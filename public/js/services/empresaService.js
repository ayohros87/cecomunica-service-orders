const EmpresaService = {

  async getOperadores() {
    const db = firebase.firestore();
    const doc = await db.collection('empresa').doc('operadores').get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async getDoc(docId) {
    const db = firebase.firestore();
    const doc = await db.collection('empresa').doc(docId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async setDoc(docId, data) {
    const db = firebase.firestore();
    return db.collection('empresa').doc(docId).set(data);
  },
};

window.EmpresaService = EmpresaService;

// CargosService — catálogo de cargos NO-equipo (activación, instalación, etc.).
// Cada cargo se factura como una línea: concepto + monto + item de QuickBooks,
// único o recurrente. Vive aparte de `modelos` (que es solo para equipos).
const CargosService = {
  async getCargos() {
    const db = firebase.firestore();
    const snap = await db.collection('cargos').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async addCargo(data) {
    const db = firebase.firestore();
    return db.collection('cargos').add({
      ...data,
      creado_en: firebase.firestore.FieldValue.serverTimestamp(),
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async updateCargo(id, fields) {
    const db = firebase.firestore();
    return db.collection('cargos').doc(id).update({
      ...fields,
      actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
  async deleteCargo(id) {
    const db = firebase.firestore();
    return db.collection('cargos').doc(id).delete();
  },
};
window.CargosService = CargosService;

const PocService = {

  async getPocDevices() {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getPocDevice(id, opts) {
    const db = firebase.firestore();
    const doc = await db.collection('poc_devices').doc(id).get(opts);
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async addPocDevice(data) {
    const db = firebase.firestore();
    return db.collection('poc_devices').add(data);
  },

  async updatePocDevice(id, fields) {
    const db = firebase.firestore();
    return db.collection('poc_devices').doc(id).update(fields);
  },

  async softDeletePocDevice(id) {
    const db = firebase.firestore();
    return db.collection('poc_devices').doc(id).update({ deleted: true });
  },

  async restorePocDevice(id) {
    const db = firebase.firestore();
    return db.collection('poc_devices').doc(id).update({ deleted: false });
  },

  async addLog(data) {
    const db = firebase.firestore();
    return db.collection('poc_logs').add(data);
  },

  async findByField(field, value) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').where(field, '==', value).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getRecent(limit = 5) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').orderBy('created_at', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
};

window.PocService = PocService;

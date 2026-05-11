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

  // Query devices by client — tries by clienteId first, falls back to clienteNombre.
  // Cache-first: tries IndexedDB cache before network.
  async getByCliente({ clienteId = null, clienteNombre = null } = {}) {
    const db = firebase.firestore();
    let snap;
    if (clienteId) {
      snap = await db.collection('poc_devices').where('cliente_id', '==', clienteId).get({ source: 'cache' });
      if (snap.empty) snap = await db.collection('poc_devices').where('cliente_id', '==', clienteId).get();
    } else if (clienteNombre) {
      snap = await db.collection('poc_devices').where('cliente', '==', clienteNombre).get({ source: 'cache' });
      if (snap.empty) snap = await db.collection('poc_devices').where('cliente', '==', clienteNombre).get();
    } else {
      return [];
    }
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getRecent(limit = 5) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').orderBy('created_at', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Paginated sorted list, excluding deleted. Returns { docs, lastDoc }.
  async listPage({ sortField = 'cliente', sortAsc = true, onlyActivos = false, cursorDoc = null, limit = 50 } = {}) {
    const db = firebase.firestore();
    let q = db.collection('poc_devices')
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .orderBy(sortField, sortAsc ? 'asc' : 'desc')
      .limit(limit);
    if (onlyActivos) q = q.where('activo', '==', true);
    if (cursorDoc) q = q.startAfter(cursorDoc);
    const snap = await q.get();
    return {
      docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
    };
  },

  // Full list for filter/export — no pagination, sorted by created_at desc.
  // Returns unique non-null operador strings across all poc_devices (fallback when empresa list is empty).
  async getUniqueOperadores(limit = 1000) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices')
      .where('operador', '!=', null).limit(limit).get();
    const set = new Set();
    snap.forEach(doc => {
      const v = (doc.data().operador || '').toString().trim();
      if (v) set.add(v);
    });
    return Array.from(set);
  },

  async getAll({ sortField = 'created_at', sortAsc = false, onlyActivos = false } = {}) {
    const db = firebase.firestore();
    let q = db.collection('poc_devices')
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .orderBy(sortField, sortAsc ? 'asc' : 'desc');
    if (onlyActivos) q = q.where('activo', '==', true);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
};

window.PocService = PocService;

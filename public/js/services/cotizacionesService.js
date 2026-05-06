const CotizacionesService = {

  async getCotizacion(id) {
    const db = firebase.firestore();
    const doc = await db.collection('cotizaciones').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async addCotizacion(data) {
    const db = firebase.firestore();
    return db.collection('cotizaciones').add(data);
  },

  async updateCotizacion(id, fields) {
    const db = firebase.firestore();
    return db.collection('cotizaciones').doc(id).update(fields);
  },

  // Fetch cotizaciones in a date window (newest first) — used for max-ID sequential generation.
  async getCotizacionesPorFecha(inicio, fin, { limit = 20 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('cotizaciones')
      .where('fecha_creacion', '>=', inicio)
      .where('fecha_creacion', '<=', fin)
      .orderBy('fecha_creacion', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Count cotizaciones in a date window — used for sequential ID generation (snap.size + 1 approach).
  async contarPorFecha(inicio, fin) {
    const db = firebase.firestore();
    const snap = await db.collection('cotizaciones')
      .where('fecha_creacion', '>=', inicio)
      .where('fecha_creacion', '<=', fin)
      .orderBy('fecha_creacion', 'desc')
      .limit(20)
      .get();
    return snap.size;
  },

  // Paginated list, newest first.
  async listCotizaciones({ lastDoc = null, limit = 30 } = {}) {
    const db = firebase.firestore();
    let q = db.collection('cotizaciones')
      .orderBy('fecha_creacion', 'desc')
      .limit(limit);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { docs, lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1] };
  },
};

window.CotizacionesService = CotizacionesService;

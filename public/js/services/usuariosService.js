const UsuariosService = {

  async getUsuario(uid) {
    const db = firebase.firestore();
    const doc = await db.collection('usuarios').doc(uid).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  // Load users that have one of the given roles.
  async getUsuariosByRol(roles) {
    const db = firebase.firestore();
    const snap = await db.collection('usuarios')
      .where('rol', 'in', roles)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Convenience: vendedores + administradores (used in many dropdowns).
  async getVendedores() {
    return this.getUsuariosByRol([ROLES.VENDEDOR, ROLES.ADMIN]);
  },

  // Batch-fetch users by document IDs (chunks of 10 to stay within Firestore 'in' limit).
  async getUsuariosByIds(ids) {
    if (!ids || !ids.length) return [];
    const db = firebase.firestore();
    const results = [];
    const CHUNK = 10;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const snap = await db.collection('usuarios')
        .where(firebase.firestore.FieldPath.documentId(), 'in', ids.slice(i, i + CHUNK))
        .get();
      snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
    }
    return results;
  },

  // Fetch stats for a technician, merged across one or more doc keys.
  // Historically `tecnico_asignado` (the stat doc id) stored the Auth UID,
  // but newer orders store the display NAME — so a technician can have stats
  // split across two docs (tecnico_stats/{uid} and tecnico_stats/{nombre}).
  // We sum both, and always read BOTH period subcollections so the ranking
  // can show semanal + mensual + total at the same time.
  async getTecnicoStats(keys, { mes = null, semana = null } = {}) {
    const db = firebase.firestore();
    const ids = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    let total = 0, mensual = 0, semanal = 0;
    await Promise.all(ids.map(async (id) => {
      const statDoc = db.collection('tecnico_stats').doc(id);
      const [root, mDoc, sDoc] = await Promise.all([
        statDoc.get(),
        mes    ? statDoc.collection('mensual').doc(mes).get()    : Promise.resolve(null),
        semana ? statDoc.collection('semanal').doc(semana).get() : Promise.resolve(null),
      ]);
      if (root.exists)         total   += (root.data().total  || 0);
      if (mDoc && mDoc.exists) mensual += (mDoc.data().count || 0);
      if (sDoc && sDoc.exists) semanal += (sDoc.data().count || 0);
    }));
    return { total, mensual, semanal };
  },

  // One-shot read of every technician's historical total. The root doc of
  // each tecnico_stats/{key} carries `total`; reading the whole collection in
  // a single query (it only holds the root docs, not the subcollections)
  // avoids the per-technician fan-out the ranking used to do. Returns a Map
  // keyed by doc id (uid OR legacy nombre) -> total.
  async getAllTecnicoStats() {
    const db = firebase.firestore();
    const snap = await db.collection('tecnico_stats').get();
    const map = new Map();
    snap.forEach(d => map.set(d.id, d.data().total || 0));
    return map;
  },

  // Rolling-window completion counts for ALL technicians in one shot.
  // Each completion is recorded by the onComplete trigger as a doc in
  // tecnico_stats/{key}/eventos with a `fecha` Timestamp. A single
  // collection-group query over `eventos` (filtered by `fecha >= since`)
  // replaces the old per-technician fan-out: O(1) round-trips instead of
  // O(N). We bucket the results client-side by the parent stat-doc id
  // (uid OR legacy nombre) so the caller can merge both keys per technician.
  // Comparing absolute instants keeps it immune to the UTC-server /
  // local-client timezone skew that the calendar buckets (semanal/mensual)
  // suffer from.
  // Requires a COLLECTION_GROUP single-field index on eventos.fecha
  // (see firestore.indexes.json fieldOverrides).
  // Returns Map<parentKey, { count, ultima }>.
  async getEventosCountSince(sinceDate) {
    const db = firebase.firestore();
    const since = firebase.firestore.Timestamp.fromDate(sinceDate);
    const snap = await db.collectionGroup('eventos')
      .where('fecha', '>=', since)
      .get();
    const map = new Map();
    snap.forEach(d => {
      const parent = d.ref.parent.parent; // tecnico_stats/{key}
      const key = parent && parent.id;
      if (!key) return;
      const f  = d.data().fecha;
      const dt = (f && f.toDate) ? f.toDate() : null;
      let e = map.get(key);
      if (!e) { e = { count: 0, ultima: null }; map.set(key, e); }
      e.count += 1;
      if (dt && (!e.ultima || dt > e.ultima)) e.ultima = dt;
    });
    return map;
  },
};

window.UsuariosService = UsuariosService;

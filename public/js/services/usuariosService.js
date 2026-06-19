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
};

window.UsuariosService = UsuariosService;

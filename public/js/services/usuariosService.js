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

  // Fetch stats for a technician (root doc + optional period subcollection).
  async getTecnicoStats(uid, { periodo = null, periodoKey = null } = {}) {
    const db = firebase.firestore();
    const statDoc = db.collection('tecnico_stats').doc(uid);
    const [root, per] = await Promise.all([
      statDoc.get(),
      (periodo && periodoKey)
        ? statDoc.collection(periodo).doc(periodoKey).get()
        : Promise.resolve(null),
    ]);
    const total   = root.exists ? (root.data().total || 0) : 0;
    const mensual = (per && per.exists && periodo === 'mensual') ? (per.data().count || 0) : 0;
    const semanal = (per && per.exists && periodo === 'semanal') ? (per.data().count || 0) : 0;
    return { total, mensual, semanal };
  },
};

window.UsuariosService = UsuariosService;

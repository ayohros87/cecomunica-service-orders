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
};

window.UsuariosService = UsuariosService;

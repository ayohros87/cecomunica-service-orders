/**
 * usuariosAdminService.js — thin wrapper around the manageUser callable.
 *
 * Used exclusively by public/admin/usuarios.html. The callable enforces
 * rol === 'administrador' server-side, so we don't duplicate that check
 * here — the UI gate is purely UX.
 */
const UsuariosAdminService = {

  _call() {
    return firebase.functions().httpsCallable('manageUser');
  },

  async create({ email, nombre, rol }) {
    const res = await this._call()({ action: 'create', email, nombre, rol });
    return res.data; // { uid, resetLink }
  },

  async updateRol(uid, rol) {
    const res = await this._call()({ action: 'updateRol', uid, rol });
    return res.data; // { ok: true }
  },

  async deactivate(uid) {
    const res = await this._call()({ action: 'deactivate', uid });
    return res.data;
  },

  async reactivate(uid) {
    const res = await this._call()({ action: 'reactivate', uid });
    return res.data;
  },

  async resetPassword(uid) {
    const res = await this._call()({ action: 'resetPassword', uid });
    return res.data; // { resetLink }
  },

  // Read-only listing (no admin SDK required — uses public usuarios rules).
  async listAll() {
    const db = firebase.firestore();
    const snap = await db.collection('usuarios').get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  },
};

window.UsuariosAdminService = UsuariosAdminService;

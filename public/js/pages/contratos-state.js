// @ts-nocheck
// Shared mutable state and pure helpers for the contratos page.
// All section modules read/write CS.* — no direct globals needed.
window.CS = {
  // ── Runtime state ──────────────────────────────────────────────
  currentUser:   null,
  lastDoc:       null,
  contratos:     [],      // loaded contract docs
  campoOrden:    'fecha_creacion',
  direccionAsc:  false,
  isLoading:     false,
  lastQueryAt:   0,
  mapaUsuarios:  {},      // uid → display name cache

  // ── Role-based limits ──────────────────────────────────────────
  PAGE_LIMIT_BY_ROLE: { administrador: 40, vendedor: 30, recepcion: 20 },
  MAX_ROWS_BY_ROLE:   { administrador: 400, vendedor: 250, recepcion: 120 },
  MIN_QUERY_INTERVAL_MS: 800,

  pageLimit() { return this.PAGE_LIMIT_BY_ROLE[AUTH.getRole()] || 20; },
  maxRows()   { return this.MAX_ROWS_BY_ROLE[AUTH.getRole()] || 120; },

  // ── DOM / formatting helpers ───────────────────────────────────
  esMovil() { return window.matchMedia('(max-width:760px)').matches; },
  esc(s)    { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); },

  // ── User name resolution ───────────────────────────────────────
  async cargarUsuarios() {
    if (!this.currentUser?.uid) return;
    if (this.mapaUsuarios[this.currentUser.uid]) return;
    const me = await db.collection('usuarios').doc(this.currentUser.uid).get();
    if (me.exists) {
      const u = me.data() || {};
      this.mapaUsuarios[this.currentUser.uid] = u.nombre || u.email || this.currentUser.uid;
    }
  },

  async precargarUsuarios(contratos) {
    const map = this.mapaUsuarios;
    const ids = [...new Set((contratos || []).map(c => c?.creado_por_uid).filter(Boolean))]
      .filter(uid => !map[uid]);
    if (!ids.length) return;
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    for (const chunk of chunks) {
      const snap = await db.collection('usuarios')
        .where(firebase.firestore.FieldPath.documentId(), 'in', chunk).get();
      snap.forEach(doc => {
        const u = doc.data() || {};
        map[doc.id] = u.nombre || u.email || doc.id;
      });
    }
  }
};

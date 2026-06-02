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

  // ── Group administration ─────────────────────────────────────────────
  // Groups are stored as a string[] on each poc_devices doc. There is no
  // grupos collection; the canonical list per client is derived by unioning
  // grupos[] across the client's non-deleted devices.

  // Returns [{ nombre, count, devices: [deviceId] }] sorted by nombre.
  // Excludes soft-deleted devices.
  async listGruposByCliente({ clienteId = null, clienteNombre = null } = {}) {
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const map = new Map();
    devices.forEach(d => {
      if (d.deleted === true) return;
      (d.grupos || []).forEach(g => {
        const nombre = (g || '').toString().trim();
        if (!nombre) return;
        if (!map.has(nombre)) map.set(nombre, { nombre, count: 0, devices: [] });
        const entry = map.get(nombre);
        entry.count++;
        entry.devices.push(d.id);
      });
    });
    return Array.from(map.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  },

  // Rename `from` → `to` across every non-deleted device of the client that
  // references `from`. If a device already has `to`, the rename simply removes
  // `from` (dedup). Touched devices' grupos arrays are deduped and trimmed.
  // Returns { affected: number }.
  async renombrarGrupo({ clienteId = null, clienteNombre = null, from, to }) {
    const fromN = (from || '').toString().trim();
    const toN   = (to   || '').toString().trim();
    if (!fromN || !toN || fromN === toN) return { affected: 0 };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const targets = devices.filter(d => d.deleted !== true && (d.grupos || []).includes(fromN));
    if (!targets.length) return { affected: 0 };
    const db = firebase.firestore();
    const CHUNK = 450;
    const uid = firebase.auth().currentUser?.uid || null;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = db.batch();
      for (const d of targets.slice(i, i + CHUNK)) {
        const next = Array.from(new Set(
          (d.grupos || [])
            .map(g => (g || '').toString().trim())
            .filter(Boolean)
            .map(g => (g === fromN ? toN : g))
        ));
        batch.update(db.collection('poc_devices').doc(d.id), {
          grupos: next,
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_by: uid,
        });
      }
      await batch.commit();
    }
    return { affected: targets.length };
  },

  // Merge `sources[]` → `target` across the client's devices. Equivalent to
  // calling renombrarGrupo for each source but in a single pass.
  async fusionarGrupos({ clienteId = null, clienteNombre = null, sources = [], target }) {
    const targetN = (target || '').toString().trim();
    const sourcesN = (sources || [])
      .map(s => (s || '').toString().trim())
      .filter(s => s && s !== targetN);
    if (!targetN || !sourcesN.length) return { affected: 0 };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const sourceSet = new Set(sourcesN);
    const targets = devices.filter(d => d.deleted !== true
      && (d.grupos || []).some(g => sourceSet.has((g || '').toString().trim())));
    if (!targets.length) return { affected: 0 };
    const db = firebase.firestore();
    const CHUNK = 450;
    const uid = firebase.auth().currentUser?.uid || null;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = db.batch();
      for (const d of targets.slice(i, i + CHUNK)) {
        const next = Array.from(new Set(
          (d.grupos || [])
            .map(g => (g || '').toString().trim())
            .filter(Boolean)
            .map(g => (sourceSet.has(g) ? targetN : g))
        ));
        batch.update(db.collection('poc_devices').doc(d.id), {
          grupos: next,
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_by: uid,
        });
      }
      await batch.commit();
    }
    return { affected: targets.length };
  },

  // Remove `nombre` from every non-deleted device of the client.
  async eliminarGrupo({ clienteId = null, clienteNombre = null, nombre }) {
    const nombreN = (nombre || '').toString().trim();
    if (!nombreN) return { affected: 0 };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const targets = devices.filter(d => d.deleted !== true && (d.grupos || []).includes(nombreN));
    if (!targets.length) return { affected: 0 };
    const db = firebase.firestore();
    const CHUNK = 450;
    const uid = firebase.auth().currentUser?.uid || null;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = db.batch();
      for (const d of targets.slice(i, i + CHUNK)) {
        const next = (d.grupos || [])
          .map(g => (g || '').toString().trim())
          .filter(g => g && g !== nombreN);
        batch.update(db.collection('poc_devices').doc(d.id), {
          grupos: Array.from(new Set(next)),
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_by: uid,
        });
      }
      await batch.commit();
    }
    return { affected: targets.length };
  },
};

window.PocService = PocService;

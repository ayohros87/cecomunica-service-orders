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

  // Query devices by client. Cuando se proveen AMBOS clienteId y clienteNombre,
  // corre las DOS queries y combina los resultados (dedup por docId) — los
  // equipos legacy escriben solo `cliente` (string) sin `cliente_id`, así que
  // sin esto faltarían equipos cuando se llama por id pero hay nombre legacy.
  async getByCliente({ clienteId = null, clienteNombre = null } = {}) {
    if (!clienteId && !clienteNombre) return [];
    const db = firebase.firestore();
    const found = new Map();
    const runQuery = async (field, value) => {
      let snap = await db.collection('poc_devices').where(field, '==', value).get({ source: 'cache' });
      if (snap.empty) snap = await db.collection('poc_devices').where(field, '==', value).get();
      snap.docs.forEach(d => { if (!found.has(d.id)) found.set(d.id, { id: d.id, ...d.data() }); });
    };
    const tasks = [];
    if (clienteId)     tasks.push(runQuery('cliente_id', clienteId));
    if (clienteNombre) tasks.push(runQuery('cliente',    clienteNombre));
    await Promise.all(tasks);
    return Array.from(found.values());
  },

  // Returns identifiers de clientes que tienen al menos un device no eliminado
  // con al menos un grupo + (opcional) los grupos crudos agrupados por cliente
  // para análisis de duplicados desde la página. Una sola lectura cache-first
  // de poc_devices — sirve tanto para filtrar la lista como para el scan de
  // duplicados (no se duplica el read).
  //
  // Retorna:
  //   { ids: Set<clienteId>, nombres: Set<clienteNombre>,
  //     gruposPorId: Map<clienteId, Set<grupoRaw>>,
  //     gruposPorNombre: Map<clienteNombre, Set<grupoRaw>> }
  //
  // Los Sets de grupos dedupan por forma cruda (case-sensitive trimmed) —
  // las helpers de gruposAnalisis hacen su propia normalización.
  async getClientesConGrupos() {
    const db = firebase.firestore();
    let snap = await db.collection('poc_devices').get({ source: 'cache' });
    if (snap.empty) snap = await db.collection('poc_devices').get();
    const ids = new Set();
    const nombres = new Set();
    const gruposPorId = new Map();
    const gruposPorNombre = new Map();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.deleted === true) return;
      const grupos = (Array.isArray(d.grupos) ? d.grupos : [])
        .map(g => (g || '').toString().trim())
        .filter(Boolean);
      if (!grupos.length) return;
      if (d.cliente_id) {
        ids.add(d.cliente_id);
        if (!gruposPorId.has(d.cliente_id)) gruposPorId.set(d.cliente_id, new Set());
        const set = gruposPorId.get(d.cliente_id);
        for (const g of grupos) set.add(g);
      }
      if (d.cliente) {
        nombres.add(d.cliente);
        if (!gruposPorNombre.has(d.cliente)) gruposPorNombre.set(d.cliente, new Set());
        const set = gruposPorNombre.get(d.cliente);
        for (const g of grupos) set.add(g);
      }
    });
    return { ids, nombres, gruposPorId, gruposPorNombre };
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
  // Two layers:
  //   1. Canonical CATALOG — clientes/{id}.poc_grupos (string[]). Source of
  //      truth for "which groups this empresa has". Managed from admin/grupos
  //      and offered as a checklist at data-entry. Can hold groups with 0
  //      devices (pre-provisioned).
  //   2. Device tags — grupos[] on each poc_devices doc (denormalized copy so
  //      filters/exports/queries keep working). rename/merge/delete propagate
  //      to BOTH layers.
  // Pre-backfill clients have no catalog yet; the helpers below derive + seed
  // it lazily from the device tags on the first admin edit.

  // Read the canonical catalog. Returns string[] or null when the field is
  // absent (caller distinguishes "empty catalog" from "no catalog yet").
  async getCatalogoGrupos(clienteId) {
    if (!clienteId) return null;
    const ref = firebase.firestore().collection('clientes').doc(clienteId);
    // OJO: get({source:'cache'}) sobre un DOC individual LANZA si no está en
    // caché (las queries de colección sí devuelven vacío). Probamos caché y
    // caemos al servidor ante cualquier fallo o cache-miss.
    let doc;
    try {
      doc = await ref.get({ source: 'cache' });
      if (!doc.exists) doc = await ref.get();
    } catch (_) {
      doc = await ref.get();
    }
    if (!doc.exists) return null;
    const arr = doc.data().poc_grupos;
    return Array.isArray(arr) ? arr.slice() : null;
  },

  // Write the catalog (deduped accent/case-insensitively + sorted). Stamps
  // updated_at/by like ClientesService does.
  async _writeCatalogo(clienteId, grupos) {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    const limpio = FMT.dedupGrupos(grupos)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    await db.collection('clientes').doc(clienteId).update({
      poc_grupos: limpio,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    });
    return limpio;
  },

  // Apply transformFn to the catalog and persist. Keyed by clientes doc id
  // (legacy name-only clients have no catalog). Seeds from device tags the
  // first time so the catalog materializes on first edit.
  async _syncCatalogo(clienteId, clienteNombre, transformFn) {
    if (!clienteId) return;
    let base = await this.getCatalogoGrupos(clienteId);
    if (base === null) {
      const derivados = await this.listGruposByCliente({ clienteId, clienteNombre });
      base = derivados.map(g => g.nombre);
    }
    await this._writeCatalogo(clienteId, transformFn(base.slice()));
  },

  // Add one group to the catalog without touching any device. Returns
  // { added, grupos }. No-op (added:false) if an accent/case variant exists.
  async agregarGrupoCatalogo({ clienteId = null, clienteNombre = null, nombre }) {
    const n = FMT.normalizeGrupo(nombre);
    if (!clienteId || !n) return { added: false, grupos: [] };
    let base = await this.getCatalogoGrupos(clienteId);
    if (base === null) {
      const derivados = await this.listGruposByCliente({ clienteId, clienteNombre });
      base = derivados.map(g => g.nombre);
    }
    const exists = base.some(g => FMT.normalize(g) === FMT.normalize(n));
    const grupos = await this._writeCatalogo(clienteId, exists ? base : base.concat([n]));
    return { added: !exists, grupos };
  },

  // Admin/data-entry view: union of catalog + device-derived groups.
  // Returns { grupos: [{ nombre, count }], tieneCatalogo }. count = number of
  // non-deleted devices tagging the group (0 for catalog-only groups).
  async listGruposConCatalogo({ clienteId = null, clienteNombre = null } = {}) {
    const [derivados, catalogo] = await Promise.all([
      this.listGruposByCliente({ clienteId, clienteNombre }),
      clienteId ? this.getCatalogoGrupos(clienteId) : Promise.resolve(null),
    ]);
    const map = new Map();   // normKey → { nombre, count }
    for (const g of derivados) map.set(FMT.normalize(g.nombre), { nombre: g.nombre, count: g.count });
    for (const raw of (catalogo || [])) {
      const k = FMT.normalize(raw);
      if (!map.has(k)) map.set(k, { nombre: raw, count: 0 });
    }
    const grupos = Array.from(map.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    return { grupos, tieneCatalogo: Array.isArray(catalogo) };
  },

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
    if (targets.length) {
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
    }
    // Keep the catalog in sync (also seeds it on the first edit). Runs even
    // when 0 devices matched, so renaming a catalog-only group still works.
    await this._syncCatalogo(clienteId, clienteNombre, list =>
      list.map(g => (FMT.normalize(g) === FMT.normalize(fromN) ? toN : g))
    );
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
    if (targets.length) {
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
    }
    // Catalog: drop the sources, ensure the target is present.
    const srcNorms = new Set(sourcesN.map(s => FMT.normalize(s)));
    await this._syncCatalogo(clienteId, clienteNombre, list => {
      const kept = list.filter(g => !srcNorms.has(FMT.normalize(g)));
      if (!kept.some(g => FMT.normalize(g) === FMT.normalize(targetN))) kept.push(targetN);
      return kept;
    });
    return { affected: targets.length };
  },

  // Remove `nombre` from every non-deleted device of the client.
  async eliminarGrupo({ clienteId = null, clienteNombre = null, nombre }) {
    const nombreN = (nombre || '').toString().trim();
    if (!nombreN) return { affected: 0 };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const targets = devices.filter(d => d.deleted !== true && (d.grupos || []).includes(nombreN));
    if (targets.length) {
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
    }
    // Catalog: remove the group too (runs even with 0 device matches, so a
    // catalog-only group can be deleted).
    await this._syncCatalogo(clienteId, clienteNombre, list =>
      list.filter(g => FMT.normalize(g) !== FMT.normalize(nombreN))
    );
    return { affected: targets.length };
  },
};

window.PocService = PocService;

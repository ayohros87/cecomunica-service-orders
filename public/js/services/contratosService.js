// Service layer for the "contratos" collection.
// All Firestore I/O for contracts goes through this object.
// Mirrors the pattern of ordenesService.js.
const ContratosService = {

  // ── Single-document reads / writes ──────────────────────────────────────

  async getContrato(id) {
    const db = firebase.firestore();
    const doc = await db.collection('contratos').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  // Find by the human-readable contrato_id field (e.g. "CT-2024-001"), not the doc ID.
  async getByContratoId(contratoId) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .where('contrato_id', '==', contratoId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  },

  async updateContrato(id, fields) {
    const db = firebase.firestore();
    return db.collection('contratos').doc(id).update(fields);
  },

  // Create a new contract document; returns the Firestore DocumentReference.
  async addContrato(data) {
    const db = firebase.firestore();
    return db.collection('contratos').add(data);
  },

  // Count contracts matching a codigo_tipo in a date window (used for sequential ID generation).
  async contarPorTipoYFecha(codigoTipo, inicio, fin) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .where('codigo_tipo', '==', codigoTipo)
      .where('fecha_creacion', '>=', inicio)
      .where('fecha_creacion', '<', fin)
      .get();
    return snap.size;
  },

  // ── List queries ─────────────────────────────────────────────────────────

  // Primary paginated list.
  // options.searchRange = { lower, upper } enables cliente_nombre_lower index filter.
  // Returns { docs: Array<{id, ...data}>, lastDoc: DocumentSnapshot | null }.
  async listContratos({
    estadoSel    = null,
    creadoPorUid = null,
    searchRange  = null,
    campoOrden   = 'fecha_creacion',
    direccionAsc = false,
    lastDoc      = null,
    limit        = 30,
  } = {}) {
    const db = firebase.firestore();
    let q = db.collection('contratos').where('deleted', '!=', true);

    if (estadoSel)    q = q.where('estado', '==', estadoSel);
    if (creadoPorUid) q = q.where('creado_por_uid', '==', creadoPorUid);

    if (searchRange) {
      q = q
        .where('cliente_nombre_lower', '>=', searchRange.lower)
        .where('cliente_nombre_lower', '<',  searchRange.upper);
    }

    q = q.orderBy('deleted');
    if (searchRange) q = q.orderBy('cliente_nombre_lower');
    q = q.orderBy(campoOrden, direccionAsc ? 'asc' : 'desc').limit(limit);

    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { docs, lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1] };
  },

  // Fallback list without the searchRange filter (used for JS-side client search).
  async listContratosFallback({
    estadoSel    = null,
    creadoPorUid = null,
    campoOrden   = 'fecha_creacion',
    direccionAsc = false,
    lastDoc      = null,
    limit        = 30,
  } = {}) {
    const db = firebase.firestore();
    let q = db.collection('contratos').where('deleted', '!=', true);

    if (estadoSel)    q = q.where('estado', '==', estadoSel);
    if (creadoPorUid) q = q.where('creado_por_uid', '==', creadoPorUid);

    q = q
      .orderBy('deleted')
      .orderBy(campoOrden, direccionAsc ? 'asc' : 'desc')
      .limit(limit);

    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { docs, lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1] };
  },

  // Active/approved contracts for a specific client (used in nueva/editar-orden dropdowns).
  async getContratosActivosPorCliente(clienteId) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .where('cliente_id', '==', clienteId)
      .where('deleted', '!=', true)
      .where('estado', 'in', ['aprobado', 'activo'])
      .orderBy('deleted')
      .orderBy('fecha_creacion', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Remove a linked orden from the cache subcollection.
  async unlinkOrden(contratoId, ordenId) {
    const db = firebase.firestore();
    return db.collection('contratos')
      .doc(contratoId)
      .collection('ordenes')
      .doc(ordenId)
      .delete();
  },

  // All contracts in aprobado or activo estado (used for assignment dropdowns).
  async getContratosActivosAprobados() {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .where('deleted', '!=', true)
      .where('estado', 'in', ['aprobado', 'activo'])
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // ── Ordenes subcollection ─────────────────────────────────────────────────

  // Recent linked orders (cache subdoc), newest first.
  async getOrdenesDeContrato(contratoId, { limit = 5 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .doc(contratoId)
      .collection('ordenes')
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // All linked orders (used for full modal and print view).
  async getOrdenesDeContratoCompleto(contratoId, { limit = 200 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .doc(contratoId)
      .collection('ordenes')
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Write a single cache subdoc. Pass { merge: true } to merge instead of overwrite.
  async linkOrden(contratoId, ordenId, data, { merge = false } = {}) {
    const db = firebase.firestore();
    const ref = db.collection('contratos').doc(contratoId).collection('ordenes').doc(ordenId);
    return merge ? ref.set(data, { merge: true }) : ref.set(data);
  },
};

window.ContratosService = ContratosService;

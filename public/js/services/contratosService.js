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
    // Solo filtro `in` por estado (usa índice automático de un solo campo); `deleted`
    // se descarta en el cliente para NO requerir un índice compuesto
    // (deleted != true + estado in ...).
    const snap = await db.collection('contratos')
      .where('estado', 'in', ['aprobado', 'activo'])
      .get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.deleted !== true);
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

  // Seriales (uso interno). Doc-por-serial en la subcolección
  // `contratos/{id}/seriales/{autoId}` — cada doc es la semilla de un registro de
  // equipo: el serial es la identidad durable, lo demás (contrato/cliente) es la
  // asignación actual. Vive en subcolección para no tocar el documento principal
  // (que tiene campos cacheados por Cloud Functions protegidos por reglas) y para
  // ser consultable por `collectionGroup` por serial el día que se necesite.
  async getSerialesManual(contratoId) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos').doc(contratoId)
      .collection('seriales').get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(x => typeof x.serial === 'string' && x.serial.trim());
  },

  // Reconcilia el set deseado contra lo existente: agrega nuevos, actualiza el
  // modelo/asignación de los que siguen, borra los que se quitaron. Conserva
  // created_at (y futuros enlaces de órdenes) en los que permanecen.
  async saveSerialesManual(contratoId, desired, meta = {}) {
    const db = firebase.firestore();
    const parent = db.collection('contratos').doc(contratoId);
    const col = parent.collection('seriales');
    const norm = (s) => String(s || '').trim().toLowerCase();

    const snap = await col.get();
    const existing = new Map();                       // serialNorm -> docId
    const existingData = new Map();                   // serialNorm -> {serial, modelo} (valor anterior)
    snap.docs.forEach(d => {
      const data = d.data();
      const k = norm(data.serial);
      existing.set(k, d.id);
      existingData.set(k, { serial: String(data.serial || '').trim(), modelo: data.modelo || '' });
    });

    const desiredMap = new Map();                     // serialNorm -> item (deduplicado)
    for (const it of (desired || [])) {
      const k = norm(it.serial);
      if (!k) continue;
      if (!desiredMap.has(k)) desiredMap.set(k, it);
    }

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const uid = meta.uid || null;
    const batch = db.batch();

    for (const [k, it] of desiredMap) {
      const base = {
        serial: String(it.serial || '').trim(),
        modelo: it.modelo || '',
        modelo_id: it.modelo_id || '',
        contrato_doc_id: contratoId,
        contrato_id: meta.contrato_id || '',
        cliente_id: meta.cliente_id || '',
        cliente_nombre: meta.cliente_nombre || '',
        source: it.source || 'manual',
        updated_at: now,
        updated_by: uid,
      };
      if (existing.has(k)) {
        batch.set(col.doc(existing.get(k)), base, { merge: true });
      } else {
        batch.set(col.doc(), { ...base, created_at: now, created_by: uid });
      }
    }
    for (const [k, docId] of existing) {
      if (!desiredMap.has(k)) batch.delete(col.doc(docId));
    }

    // Historial (auditoría): registra en cada guardado qué seriales ENTRARON y
    // cuáles SALIERON, para no perder el valor anterior al sobrescribir/borrar.
    // Como la identidad del doc es el serial normalizado, cambiar un serial se ve
    // como "sale el viejo, entra el nuevo" — exactamente lo que queremos auditar.
    const agregados = [];
    for (const [k, it] of desiredMap) {
      if (!existing.has(k)) agregados.push({ serial: String(it.serial || '').trim(), modelo: it.modelo || '' });
    }
    const eliminados = [];
    for (const [k, prev] of existingData) {
      if (!desiredMap.has(k)) eliminados.push(prev);
    }
    if (agregados.length || eliminados.length) {
      batch.set(parent.collection('seriales_historial').doc(), {
        at: now,
        por: uid,
        estado: meta.estado || null,        // 'pendiente' | 'asignados' (contexto del guardado)
        contrato_id: meta.contrato_id || '',
        cliente_id: meta.cliente_id || '',
        cliente_nombre: meta.cliente_nombre || '',
        agregados,
        eliminados,
      });
    }
    return batch.commit();
  },
};

window.ContratosService = ContratosService;

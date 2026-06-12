/**
 * clientesService.js
 * Service layer for Firestore operations related to clients
 * Separates data access from UI logic
 */

// ── Pure helpers (no Firestore) ──────────────────────────────────────────
// Lower-case, strip accents.
function _norm(s){
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim();
}
// Word-prefix tokens: "instituto" → in, ins, inst, …
function _tokensFrom(text){
  if (!text) return [];
  const parts = _norm(text).split(/[^a-z0-9]+/).filter(Boolean);
  const toks = new Set();
  for (const p of parts){
    for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
  }
  return Array.from(toks).slice(0, 200);
}

const ClientesService = {
  // ── Pure helpers exposed for callers ─────────────────────────────────
  norm: _norm,
  tokensFrom: _tokensFrom,

  // Build the searchTokens array from a cliente object.
  buildSearchTokens(cliente){
    const t = new Set([
      ..._tokensFrom(cliente.nombre),
      ..._tokensFrom(cliente.representante),
      ..._tokensFrom(cliente.direccion),
    ]);
    if (Array.isArray(cliente.tags)){
      for (const x of cliente.tags) _tokensFrom(x).forEach(k => t.add(k));
    }
    if (cliente.ruc)        t.add(String(cliente.ruc).replace(/\D/g, ""));
    if (cliente.rucdv_norm){
      t.add(cliente.rucdv_norm);
      t.add(cliente.rucdv_norm.replace(/\D/g, ""));
    }
    return Array.from(t);
  },

  // Build a fully-normalised cliente payload ready for createCliente/updateCliente.
  // Single source of truth for field names + derived keys (ruc_norm, rucdv_norm,
  // nombre_norm, searchTokens). All callers (forms, batch ops) must use this.
  buildClientePayload(raw, { user = null, isCreate = false } = {}){
    const ahora = firebase.firestore.FieldValue.serverTimestamp();
    const ruc = (raw.ruc || "").trim();
    const dv  = (raw.dv  || "").trim();
    const ruc_norm = ruc.replace(/\D/g, "");
    const dv_norm  = dv.replace(/\D/g, "");
    const rucdv_norm = ruc_norm + (dv_norm ? ("-" + dv_norm) : "");
    const itbmsExento = !!raw.itbms_exento;

    const cliente = {
      nombre: (raw.nombre || "").trim(),
      ruc, dv, ruc_norm, dv_norm, rucdv_norm,
      nombre_norm: _norm(raw.nombre),
      direccion: (raw.direccion || "").trim(),
      direccion_facturacion: (raw.direccion_facturacion || "").trim(),
      telefono: (raw.telefono || "").replace(/[^\d+]/g, ""),
      email: (raw.email || "").toLowerCase().trim(),
      representante: (raw.representante || "").trim(),
      representante_cedula: (raw.representante_cedula || raw.cedula_representante || "").trim(),
      itbms_exento: itbmsExento,
      itbms_motivo_exencion: itbmsExento ? (raw.itbms_motivo_exencion || "").trim() : "",
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      activo: raw.activo !== false,
      vendedor_asignado: raw.vendedor_asignado || null,
      vendedor_email: raw.vendedor_email || null,
      updated_at: ahora,
      updated_by: user?.uid || null,
    };
    cliente.searchTokens = this.buildSearchTokens(cliente);

    if (isCreate){
      cliente.created_at = ahora;
      cliente.created_by = user?.uid || null;
      cliente.deleted = false;
      if (!cliente.vendedor_asignado) cliente.vendedor_asignado = user?.uid || null;
      if (!cliente.vendedor_email)    cliente.vendedor_email    = user?.email || null;
    }
    return cliente;
  },

  /**
   * Load all clients from Firestore
   * @returns {Promise<Map<string, Object>>} Map of clientId => clientData
   */
  async loadClientes() {
    const db = firebase.firestore();
    const snapshot = await db.collection("clientes").get();
    
    const clientesMap = new Map();
    snapshot.forEach(doc => {
      const data = doc.data();
      clientesMap.set(doc.id, {
        id: doc.id,
        nombre: data.nombre || "",
        empresa: data.empresa || "",
        ...data
      });
    });
    
    return clientesMap;
  },

  /**
   * Get a single client by ID
   * @param {string} clienteId - Client ID
   * @returns {Promise<Object|null>}
   */
  async getCliente(clienteId) {
    const db = firebase.firestore();
    const doc = await db.collection("clientes").doc(clienteId).get();
    
    if (!doc.exists) return null;
    
    return {
      id: doc.id,
      ...doc.data()
    };
  },

  /**
   * Search clients by name or empresa
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array<Object>>}
   */
  async searchClientes(searchTerm) {
    if (!searchTerm || searchTerm.trim() === "") {
      return [];
    }
    
    const db = firebase.firestore();
    const term = searchTerm.toLowerCase().trim();
    
    // Note: Firestore doesn't support full-text search natively
    // This loads all clients and filters client-side
    // For production, consider using Algolia or similar
    const snapshot = await db.collection("clientes").get();
    
    const results = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const nombre = (data.nombre || "").toLowerCase();
      const empresa = (data.empresa || "").toLowerCase();
      
      if (nombre.includes(term) || empresa.includes(term)) {
        results.push({
          id: doc.id,
          nombre: data.nombre || "",
          empresa: data.empresa || "",
          ...data
        });
      }
    });
    
    return results;
  },

  async createCliente(clienteData) {
    const db = firebase.firestore();
    const docRef = await db.collection("clientes").add(clienteData);
    return docRef.id;
  },

  async updateCliente(clienteId, updates) {
    const db = firebase.firestore();
    return db.collection("clientes").doc(clienteId).update({
      ...updates,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteCliente(clienteId) {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    return db.collection("clientes").doc(clienteId).update({
      deleted: true,
      deleted_at: firebase.firestore.FieldValue.serverTimestamp(),
      deleted_by: uid,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    });
  },

  // Paginated list ordered by nombre, excluding deleted.
  // Returns { docs, lastDoc }.
  async listClientes({ onlyActive = false, lastDoc = null, limit = 20 } = {}) {
    const db = firebase.firestore();
    let q = db.collection("clientes")
      .where("deleted", "==", false)
      .orderBy("nombre")
      .limit(limit);
    if (onlyActive) q = q.where("activo", "==", true);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { docs, lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1] };
  },

  // Full-text search via searchTokens array-contains, excluding deleted.
  async searchByToken(term, { onlyActive = false, limit = 20 } = {}) {
    const db = firebase.firestore();
    let q = db.collection("clientes")
      .where("searchTokens", "array-contains", term.toLowerCase())
      .where("deleted", "==", false)
      .limit(limit);
    if (onlyActive) q = q.where("activo", "==", true);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Check for a duplicate by a normalised field. Returns true if a match exists.
  // Legacy: ignores `deleted` — keeps soft-deleted matches blocking reuse.
  // Prefer existsActiveByNorm for create flows so reactivation isn't blocked.
  async existsByNorm(field, value) {
    const db = firebase.firestore();
    const snap = await db.collection('clientes').where(field, '==', value).limit(1).get();
    return !snap.empty;
  },

  // Duplicate check that ignores soft-deleted records.
  async existsActiveByNorm(field, value){
    const db = firebase.firestore();
    const snap = await db.collection('clientes')
      .where(field, '==', value)
      .where('deleted', '==', false)
      .limit(1)
      .get();
    return !snap.empty;
  },

  // Parameterized page fetch — handles search-by-token and ordered list with cursor pagination.
  // Returns { docs: [{id,...data}], lastDoc: FirestoreDoc|null, count: number }
  async listClientesPage({ term = '', onlyActive = false, cursorDoc = null, limit = 20 } = {}) {
    const db = firebase.firestore();
    const words = _norm(term).split(/\s+/).filter(Boolean);

    // Sin término: lista ordenada por nombre.
    if (words.length === 0) {
      let q = db.collection('clientes').orderBy('nombre').where('deleted', '==', false).limit(limit);
      if (onlyActive) q = q.where('activo', '==', true);
      if (cursorDoc) q = q.startAfter(cursorDoc);
      const snap = await q.get();
      return {
        docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
        count: snap.size,
      };
    }

    // Una sola palabra: array-contains directo.
    if (words.length === 1) {
      let q = db.collection('clientes')
        .where('searchTokens', 'array-contains', words[0])
        .where('deleted', '==', false)
        .limit(limit);
      if (onlyActive) q = q.where('activo', '==', true);
      if (cursorDoc) q = q.startAfter(cursorDoc);
      const snap = await q.get();
      return {
        docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
        count: snap.size,
      };
    }

    // Varias palabras: Firestore no soporta AND de varios array-contains.
    // Anclamos en la palabra más selectiva (la más larga) y exigimos en cliente
    // que TODAS las palabras estén presentes como token (prefijo) del documento.
    const { base, need } = this._multiWordBase(db, words, onlyActive);
    const out = [];
    let cursor = cursorDoc, returnCursor = null, guard = 0;
    const BATCH = Math.max(limit * 5, 100);
    outer:
    while (guard++ < 50) {
      let q = base.limit(BATCH);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        const toks = doc.data().searchTokens || [];
        if (need.every(w => toks.includes(w))) {
          out.push({ id: doc.id, ...doc.data() });
          if (out.length >= limit) { returnCursor = doc; break outer; }
        }
      }
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < BATCH) break;
    }
    return {
      docs: out,
      // Solo hay "siguiente página" si llenamos la página actual.
      lastDoc: out.length >= limit ? returnCursor : null,
      count: out.length,
    };
  },

  // Helper: query base anclada + lista de palabras a exigir (AND) para multi-palabra.
  _multiWordBase(db, words, onlyActive) {
    const need = words.filter(w => w.length >= 2);
    const anchor = (need.length ? need : words).slice().sort((a, b) => b.length - a.length)[0];
    let base = db.collection('clientes')
      .where('searchTokens', 'array-contains', anchor)
      .where('deleted', '==', false);
    if (onlyActive) base = base.where('activo', '==', true);
    return { base, need: need.length ? need : words };
  },

  // Count all matching clients via paginated scan (no data loaded).
  async countClientes({ term = '', onlyActive = false } = {}) {
    const db = firebase.firestore();
    const words = _norm(term).split(/\s+/).filter(Boolean);

    // Sin término / una palabra: agregación count() en el servidor (1 lectura).
    // Si el SDK/índice no la soporta, cae al escaneo por lotes.
    if (words.length <= 1) {
      let base;
      if (words.length === 0) {
        base = db.collection('clientes').orderBy('nombre').where('deleted', '==', false);
      } else {
        base = db.collection('clientes').where('searchTokens', 'array-contains', words[0]).where('deleted', '==', false);
      }
      if (onlyActive) base = base.where('activo', '==', true);
      try {
        if (typeof base.count === 'function') {
          const snap = await base.count().get();
          const n = snap.data().count;
          if (typeof n === 'number') return n;
        }
      } catch (e) {
        console.warn('count() no disponible, usando escaneo:', e && e.message ? e.message : e);
      }
      return this._scanCount(base);
    }

    // Multi-palabra: necesita filtro AND en cliente, así que escaneamos por lotes.
    const { base, need } = this._multiWordBase(db, words, onlyActive);
    return this._scanCount(base, need);
  },

  // Cuenta por escaneo paginado (500/lote). Si `need` se pasa, aplica filtro AND
  // multi-palabra sobre searchTokens en cliente.
  async _scanCount(base, need = null) {
    let total = 0, last = null, loops = 0;
    while (true) {
      let q = base.limit(500);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (need) {
        for (const doc of snap.docs) {
          const toks = doc.data().searchTokens || [];
          if (need.every(w => toks.includes(w))) total++;
        }
      } else {
        total += snap.size;
      }
      if (snap.empty || snap.size < 500) break;
      last = snap.docs[snap.docs.length - 1];
      if (++loops >= 200) break;
    }
    return total;
  },

  // Full client list for autocomplete/local cache — cache-first then network, 500 per page.
  async getAllClientes() {
    const db = firebase.firestore();
    const baseQ = db.collection('clientes').where('deleted', '==', false).orderBy('nombre');
    const PAGE = 500;
    let lastDoc = null;
    const results = [];
    while (true) {
      let q = lastDoc ? baseQ.startAfter(lastDoc).limit(PAGE) : baseQ.limit(PAGE);
      let snap = await q.get({ source: 'cache' });
      if (snap.empty) snap = await q.get();
      if (snap.empty) break;
      snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE) break;
    }
    return results;
  },

  // Prefix search on nombre using Firestore range query (fallback when token search returns empty).
  async searchByPrefix(text, limit = 25) {
    const db = firebase.firestore();
    const snap = await db.collection('clientes')
      .where('deleted', '==', false)
      .orderBy('nombre')
      .startAt(text)
      .endAt(text + '')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Batch-update multiple clients (450 per batch to stay under Firestore limit).
  async batchUpdate(ids, fields) {
    const db = firebase.firestore();
    const CHUNK = 450;
    const uid = firebase.auth().currentUser?.uid || null;
    const update = {
      ...fields,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    };
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + CHUNK)) {
        batch.update(db.collection("clientes").doc(id), update);
      }
      await batch.commit();
    }
  },
};

window.ClientesService = ClientesService;

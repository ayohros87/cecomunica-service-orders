/**
 * clientesService.js
 * Service layer for Firestore operations related to clients
 * Separates data access from UI logic
 */

const ClientesService = {
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
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async deleteCliente(clienteId) {
    const db = firebase.firestore();
    return db.collection("clientes").doc(clienteId).update({
      deleted: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
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
  async existsByNorm(field, value) {
    const db = firebase.firestore();
    const snap = await db.collection('clientes').where(field, '==', value).limit(1).get();
    return !snap.empty;
  },

  // Parameterized page fetch — handles search-by-token and ordered list with cursor pagination.
  // Returns { docs: [{id,...data}], lastDoc: FirestoreDoc|null, count: number }
  async listClientesPage({ term = '', onlyActive = false, cursorDoc = null, limit = 20 } = {}) {
    const db = firebase.firestore();
    let q;
    if (term) {
      q = db.collection('clientes')
        .where('searchTokens', 'array-contains', term)
        .where('deleted', '==', false)
        .limit(limit);
    } else {
      q = db.collection('clientes')
        .orderBy('nombre')
        .where('deleted', '==', false)
        .limit(limit);
    }
    if (onlyActive) q = q.where('activo', '==', true);
    if (cursorDoc) q = q.startAfter(cursorDoc);
    const snap = await q.get();
    return {
      docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
      count: snap.size,
    };
  },

  // Count all matching clients via paginated scan (no data loaded).
  async countClientes({ term = '', onlyActive = false } = {}) {
    const db = firebase.firestore();
    let base;
    if (term) {
      base = db.collection('clientes').where('searchTokens', 'array-contains', term).where('deleted', '==', false);
    } else {
      base = db.collection('clientes').orderBy('nombre').where('deleted', '==', false);
    }
    if (onlyActive) base = base.where('activo', '==', true);
    let total = 0, last = null, loops = 0;
    while (true) {
      let q = base.limit(500);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      total += snap.size;
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
    const update = { ...fields, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
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

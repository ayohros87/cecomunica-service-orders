/**
 * ordenesService.js
 * Service layer for Firestore operations related to orders
 * Separates data access from UI logic
 */

const OrdenesService = {
  /**
   * Load orders from Firestore with pagination
   * @param {Object} options - Query options
   * @param {firebase.firestore.DocumentSnapshot} options.lastSnapshot - Last document for pagination
   * @param {string} options.userRole - User role for filtering
   * @param {string} options.userId - User ID for filtering
   * @param {number} options.limit - Number of orders to fetch
   * @returns {Promise<{orders: Array, lastSnapshot: firebase.firestore.DocumentSnapshot}>}
   */
  async loadOrders({ lastSnapshot = null, userRole = null, userId = null, limit = 50 } = {}) {
    const db = firebase.firestore();
    let queryRef = db.collection("ordenes_de_servicio");

    // Apply role-based filtering
    if (userRole === "vendedor" && userId) {
      queryRef = queryRef.where("vendedor_asignado", "==", userId);
    } else if (userRole === "tecnico_operativo" && userId) {
      queryRef = queryRef.where("tecnico_uid", "==", userId);
    }

    queryRef = queryRef.orderBy("fecha_creacion", "desc").limit(limit);

    if (lastSnapshot) {
      queryRef = queryRef.startAfter(lastSnapshot);
    }

    const snapshot = await queryRef.get();

    if (snapshot.empty) {
      return { orders: [], lastSnapshot: null };
    }

    const orders = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.eliminado !== true) {
        orders.push({ ordenId: doc.id, ...data });
      }
    });

    return {
      orders,
      lastSnapshot: snapshot.docs[snapshot.docs.length - 1]
    };
  },

  /**
   * Get a single order by ID
   * @param {string} ordenId - Order ID
   * @returns {Promise<Object|null>}
   */
  async getOrder(ordenId) {
    const db = firebase.firestore();
    const doc = await db.collection("ordenes_de_servicio").doc(ordenId).get();
    
    if (!doc.exists) return null;
    
    const data = doc.data();
    if (data.eliminado === true) return null;
    
    return { ordenId: doc.id, ...data };
  },

  /**
   * Assign technician to order
   * @param {string} ordenId - Order ID
   * @param {string} tecnicoUid - Technician user ID
   * @param {string} tecnicoNombre - Technician name
   * @returns {Promise<void>}
   */
  async assignTechnician(ordenId, tecnicoUid, tecnicoNombre) {
    const db = firebase.firestore();
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "ASIGNADO",
      tecnico_asignado: tecnicoNombre,
      tecnico_uid: tecnicoUid,
      fecha_asignacion: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /**
   * Mark order as completed
   * @param {string} ordenId - Order ID
   * @returns {Promise<void>}
   */
  async completeOrder(ordenId) {
    const db = firebase.firestore();
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "COMPLETADO (EN OFICINA)",
      fecha_completado: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /**
   * Mark order as delivered to client
   * @param {string} ordenId - Order ID
   * @returns {Promise<void>}
   */
  async deliverOrder(ordenId) {
    const db = firebase.firestore();
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "ENTREGADO AL CLIENTE",
      fecha_entrega_real: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /**
   * Soft delete order
   * @param {string} ordenId - Order ID
   * @returns {Promise<void>}
   */
  async deleteOrder(ordenId) {
    const db = firebase.firestore();
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      eliminado: true,
      fecha_eliminacion: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  /**
   * Update equipment field
   * @param {string} ordenId - Order ID
   * @param {string} equipoId - Equipment ID
   * @param {string} campo - Field name
   * @param {any} valor - New value
   * @returns {Promise<void>}
   */
  async updateEquipmentField(ordenId, equipoId, campo, valor) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const ordenSnap = await ordenRef.get();
    
    if (!ordenSnap.exists) {
      throw new Error("Orden no encontrada");
    }
    
    const equipos = ordenSnap.data().equipos || [];
    const equipoIndex = equipos.findIndex(e => e.id === equipoId);
    
    if (equipoIndex === -1) {
      throw new Error("Equipo no encontrado");
    }
    
    equipos[equipoIndex][campo] = valor;
    await ordenRef.update({ equipos });
  },

  /**
   * Soft delete equipment
   * @param {string} ordenId - Order ID
   * @param {string} equipoId - Equipment ID
   * @returns {Promise<void>}
   */
  async deleteEquipment(ordenId, equipoId) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const ordenSnap = await ordenRef.get();
    
    if (!ordenSnap.exists) {
      throw new Error("Orden no encontrada");
    }
    
    const equipos = ordenSnap.data().equipos || [];
    const equipoIndex = equipos.findIndex(e => e.id === equipoId);
    
    if (equipoIndex === -1) {
      throw new Error("Equipo no encontrado");
    }
    
    equipos[equipoIndex].eliminado = true;
    await ordenRef.update({ equipos });
  },

  /**
   * Batch update equipment accessories
   * @param {string} ordenId - Order ID
   * @param {Object} updates - Map of equipoId.campo => value
   * @returns {Promise<void>}
   */
  async batchUpdateAccessories(ordenId, updates) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const ordenSnap = await ordenRef.get();
    
    if (!ordenSnap.exists) {
      throw new Error("Orden no encontrada");
    }
    
    const equipos = ordenSnap.data().equipos || [];
    
    Object.keys(updates).forEach(key => {
      const [equipoId, campo] = key.split(".");
      const equipo = equipos.find(e => e.id === equipoId);
      if (equipo) {
        equipo[campo] = updates[key];
      }
    });
    
    await ordenRef.update({ equipos });
  },

  /**
   * Update technical note
   * @param {string} ordenId - Order ID
   * @param {string} nota - Technical note text
   * @returns {Promise<void>}
   */
  async updateTechnicalNote(ordenId, nota) {
    const db = firebase.firestore();
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      nota_tecnica: nota
    });
  },

  /**
   * Load technicians for assignment dropdown
   * @returns {Promise<Array<{uid: string, nombre: string}>>}
   */
  async loadTechnicians() {
    const db = firebase.firestore();
    const snapshot = await db.collection("usuarios")
      .where("rol", "in", ["tecnico", "tecnico_operativo"])
      .get();
    
    const technicians = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      technicians.push({
        uid: doc.id,
        nombre: data.nombre || data.email || doc.id
      });
    });
    
    return technicians;
  },

  /**
   * Search orders by filters (orden, cliente, serial).
   *
   * Primary path: `where('searchTokens', 'array-contains-any', [...])`.
   * Tokens are maintained per-order by the `onOrdenWriteSearchTokens`
   * Cloud Function (functions/src/triggers/ordenes/onWriteSearchTokens.js)
   * and seeded for legacy orders by `functions/backfill-search-tokens.js`.
   * ORDENES_INDEX_IMPROVEMENTS.md §1.1.
   *
   * Fallback path: full-collection scan with the legacy substring logic.
   * Kicks in when the indexed query throws (failed-precondition / no
   * index yet) OR returns zero results. The zero-result fallback covers
   * the transition window before backfill completes — without it, users
   * would see false-negative blanks during migration.
   *
   * Cost: indexed path is O(matching docs), bounded by limit(100).
   * Scan fallback remains O(collection), so its trigger conditions
   * matter — once backfill is done, zero-result fallbacks should be
   * rare and reflect a true "no matches" state.
   *
   * @param {Object} filters
   * @param {string} filters.filtroOrden - Order ID filter
   * @param {string} filters.filtroCliente - Client name filter
   * @param {string} filters.filtroSerial - Serial number filter
   * @param {boolean} filters.quickSearch - true → OR logic, false → AND
   * @returns {Promise<Array>}
   */
  async searchOrders({ filtroOrden = "", filtroCliente = "", filtroSerial = "", quickSearch = false } = {}) {
    const db = firebase.firestore();

    // Normalize: must mirror functions/src/lib/searchTokens.js so query
    // tokens match what the CF/backfill writes.
    const normalize = (s) => String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const tokenSetOf = (s) => normalize(s).split(/\s+/).filter(w => w.length >= 2);

    const ordenWords   = tokenSetOf(filtroOrden);
    const clienteWords = tokenSetOf(filtroCliente);
    const serialWords  = tokenSetOf(filtroSerial);

    const allQueryTokens = Array.from(new Set([...ordenWords, ...clienteWords, ...serialWords]));
    if (allQueryTokens.length === 0) return [];

    // array-contains-any caps at 30; cap at 10 ourselves to keep the
    // read budget bounded even if a user types a long phrase.
    const tokenArr = allQueryTokens.slice(0, 10);

    // Post-filter shared by indexed + fallback paths. For the indexed
    // path we re-check against searchTokens; for the fallback we use
    // substring matching on the raw fields.
    const buildMatch = ({ useTokens }) => (doc) => {
      const data = doc.data ? doc.data() : doc;
      if (data.eliminado === true) return null;

      let coincideOrden, coincideCliente, coincideSerial;

      if (useTokens) {
        const tokens = new Set(Array.isArray(data.searchTokens) ? data.searchTokens : []);
        const anyIn = (arr) => arr.some(t => tokens.has(t));
        coincideOrden   = ordenWords.length   ? anyIn(ordenWords)   : false;
        coincideCliente = clienteWords.length ? anyIn(clienteWords) : false;
        coincideSerial  = serialWords.length  ? anyIn(serialWords)  : false;
      } else {
        const ordenId = normalize(doc.id || data.ordenId || "");
        const cliente = normalize(data.cliente_nombre || data.cliente || "");
        const equipos = data.equipos || [];
        const ordenNorm   = normalize(filtroOrden);
        const clienteNorm = normalize(filtroCliente);
        const serialNorm  = normalize(filtroSerial);

        coincideOrden   = ordenNorm   ? ordenId.includes(ordenNorm)     : false;
        coincideCliente = clienteNorm ? cliente.includes(clienteNorm)   : false;
        coincideSerial  = serialNorm
          ? equipos.some(eq => normalize(eq.numero_de_serie || eq.serial || eq.SERIAL || "").includes(serialNorm))
          : false;
      }

      if (quickSearch) {
        if (coincideOrden || coincideCliente || coincideSerial) {
          return { ordenId: doc.id || data.ordenId, ...data };
        }
        return null;
      }
      const pasaOrden   = (useTokens ? ordenWords.length   : normalize(filtroOrden))   ? coincideOrden   : true;
      const pasaCliente = (useTokens ? clienteWords.length : normalize(filtroCliente)) ? coincideCliente : true;
      const pasaSerial  = (useTokens ? serialWords.length  : normalize(filtroSerial))  ? coincideSerial  : true;
      if (pasaOrden && pasaCliente && pasaSerial) {
        return { ordenId: doc.id || data.ordenId, ...data };
      }
      return null;
    };

    // ── Primary: indexed query ───────────────────────────────────
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("searchTokens", "array-contains-any", tokenArr)
        .limit(100)
        .get();

      const matchIndexed = buildMatch({ useTokens: true });
      const results = [];
      snap.forEach(doc => {
        const m = matchIndexed(doc);
        if (m) results.push(m);
      });

      if (results.length > 0) return results;
      // Zero results from the indexed query may mean either "truly no
      // matches" or "tokens not yet backfilled". Fall through to scan
      // so users don't see false negatives during migration.
      console.debug("[searchOrders] indexed query returned 0; falling back to scan");
    } catch (err) {
      console.warn("[searchOrders] indexed query failed, falling back to scan:",
        err?.code || err?.message);
    }

    // ── Fallback: full-collection scan ───────────────────────────
    const snapshot = await db.collection("ordenes_de_servicio").get();
    const matchScan = buildMatch({ useTokens: false });
    const resultados = [];
    snapshot.forEach(doc => {
      const m = matchScan(doc);
      if (m) resultados.push(m);
    });
    return resultados;
  },

  /**
   * Filter orders by status
   * @param {string} estado - Status to filter by
   * @param {number} limit - Maximum results
   * @returns {Promise<Array>}
   */
  async filterByStatus(estado, limit = 200) {
    const db = firebase.firestore();
    
    try {
      // Try with index first
      const snap = await db.collection("ordenes_de_servicio")
        .where("estado_reparacion", "==", estado)
        .orderBy("fecha_creacion", "desc")
        .limit(limit)
        .get();

      const resultados = [];
      snap.forEach(doc => {
        const data = doc.data();
        if (data.eliminado === true) return;
        resultados.push({ ordenId: doc.id, ...data });
      });

      return resultados;
    } catch (e) {
      // Fallback if index is missing (failed-precondition)
      if (e?.code === "failed-precondition") {
        console.log("🔄 Index missing, using fallback JS filter");
        
        const snapFallback = await db.collection("ordenes_de_servicio")
          .orderBy("fecha_creacion", "desc")
          .limit(limit)
          .get();
        
        const allDocs = [];
        snapFallback.forEach(doc => {
          const data = doc.data();
          if (data.eliminado === true) return;
          allDocs.push({ ordenId: doc.id, ...data });
        });
        
        return allDocs.filter(o => o.estado_reparacion === estado);
      }
      
      throw e; // Re-throw if not index issue
    }
  },

  /**
   * Update trabajo tecnico for a specific equipment in an order
   * @param {Object} params
   * @param {string} params.ordenId - Order ID
   * @param {number} params.equipoIdx - Index of equipment (in non-deleted array)
   * @param {string} params.texto - Technical work text
   * @param {string} params.uid - User ID
   * @param {string} params.email - User email
   * @returns {Promise<Array>} Updated equipos array
   */
  async updateTrabajoTecnico({ ordenId, equipoIdx, texto, uid, email }) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ordenRef.get();
    
    if (!snap.exists) throw new Error("Orden no encontrada");

    const data = snap.data() || {};
    const equiposAll = Array.isArray(data.equipos) ? data.equipos : [];

    // Find the N-th non-deleted equipment in the original array
    let nonDeletedIndex = -1;
    const realIndex = equiposAll.findIndex(e => {
      if (e?.eliminado) return false;
      nonDeletedIndex++;
      return nonDeletedIndex === equipoIdx;
    });

    if (realIndex === -1) throw new Error("Equipo no encontrado");

    // Update equipment
    equiposAll[realIndex].trabajo_tecnico = texto;
    equiposAll[realIndex].trabajo_tecnico_updated_at = firebase.firestore.Timestamp.now();
    equiposAll[realIndex].trabajo_tecnico_uid = uid;
    equiposAll[realIndex].trabajo_tecnico_nombre = email;
    if (texto && texto.trim()) {
      equiposAll[realIndex].intervencion_no_disponible = false;
      equiposAll[realIndex].motivo_no_disponible = "";
    }

    await ordenRef.update({ equipos: equiposAll });
    
    return equiposAll;
  },

  /**
   * Update no disponible status for a specific equipment in an order
   * @param {Object} params
   * @param {string} params.ordenId - Order ID
   * @param {string} params.equipoId - Equipment ID
   * @param {boolean} params.noDisponible - Flag for no disponible
   * @param {string} params.motivo - Free-text reason
   * @param {string} params.uid - User ID
   * @param {string} params.email - User email
   * @returns {Promise<Array>} Updated equipos array
   */
  async updateEquipoNoDisponible({ ordenId, equipoId, noDisponible, motivo, uid, email }) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ordenRef.get();

    if (!snap.exists) throw new Error("Orden no encontrada");

    const data = snap.data() || {};
    const equiposAll = Array.isArray(data.equipos) ? data.equipos : [];
    const realIndex = equiposAll.findIndex(e => !e?.eliminado && e?.id === equipoId);

    if (realIndex === -1) throw new Error("Equipo no encontrado");

    equiposAll[realIndex].intervencion_no_disponible = !!noDisponible;
    equiposAll[realIndex].motivo_no_disponible = noDisponible ? (motivo || "") : "";
    equiposAll[realIndex].intervencion_no_disponible_updated_at = firebase.firestore.Timestamp.now();
    equiposAll[realIndex].intervencion_no_disponible_uid = uid;
    equiposAll[realIndex].intervencion_no_disponible_nombre = email;

    if (noDisponible) {
      equiposAll[realIndex].trabajo_tecnico = "";
      equiposAll[realIndex].trabajo_tecnico_updated_at = null;
      equiposAll[realIndex].trabajo_tecnico_uid = "";
      equiposAll[realIndex].trabajo_tecnico_nombre = "";
    }

    await ordenRef.update({ equipos: equiposAll });

    return equiposAll;
  },

  /**
   * Get user data by UID
   * @param {string} uid - User ID
   * @returns {Promise<Object>}
   */
  async getUserData(uid) {
    const db = firebase.firestore();
    const doc = await db.collection("usuarios").doc(uid).get();
    return doc.exists ? doc.data() : null;
  },

  async getConsumos(ordenId, { tipo, equipoId, orderByField } = {}) {
    const db = firebase.firestore();
    let q = db.collection("ordenes_de_servicio").doc(ordenId).collection("consumos");
    if (tipo) q = q.where("tipo", "==", tipo);
    if (equipoId) q = q.where("equipoId", "==", equipoId);
    if (orderByField) q = q.orderBy(orderByField, "desc");
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getConsumo(ordenId, lineaId) {
    const db = firebase.firestore();
    const doc = await db.collection("ordenes_de_servicio").doc(ordenId).collection("consumos").doc(lineaId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async addConsumo(ordenId, data) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId).collection("consumos").add(data);
  },

  async updateConsumo(ordenId, lineaId, fields) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId).collection("consumos").doc(lineaId).update(fields);
  },

  async deleteConsumo(ordenId, lineaId) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId).collection("consumos").doc(lineaId).delete();
  },

  async updateOrder(id, fields) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(id).update(fields);
  },

  async mergeOrder(id, data) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(id).set(data, { merge: true });
  },

  async setOrder(id, data) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(id).set(data);
  },

  async listAll() {
    const db = firebase.firestore();
    const snap = await db.collection("ordenes_de_servicio").get();
    return snap.docs.map(doc => ({ ordenId: doc.id, ...doc.data() }));
  },

  async filterByStatuses(statuses, orderField = "fecha_entrada") {
    const db = firebase.firestore();
    const snap = await db.collection("ordenes_de_servicio")
      .where("estado_reparacion", "in", statuses)
      .orderBy(orderField, "desc")
      .get();
    return snap.docs
      .filter(doc => doc.data().eliminado !== true)
      .map(doc => ({ ordenId: doc.id, ...doc.data() }));
  },

  async getEquipoMeta(ordenId, equipoId) {
    const db = firebase.firestore();
    const doc = await db.collection("ordenes_de_servicio").doc(ordenId)
      .collection("equipos_meta").doc(equipoId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  subscribeConsumos(ordenId, equipoId, callback) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId)
      .collection("consumos")
      .where("equipoId", "==", equipoId)
      .orderBy("added_at", "desc")
      .onSnapshot(snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  },

  async setEquipoMeta(ordenId, equipoId, data, opts = { merge: true }) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId)
      .collection("equipos_meta").doc(equipoId).set(data, opts);
  },
};

// Export to window for global access
window.OrdenesService = OrdenesService;

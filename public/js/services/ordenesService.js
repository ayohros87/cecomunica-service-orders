/**
 * ordenesService.js
 * Service layer for Firestore operations related to orders
 * Separates data access from UI logic
 */

/**
 * Cobertura de una pasada de control de calidad: cuántos equipos tenía la
 * orden al firmarse y cuáles (por serial).
 *
 * ⚠️ El conteo NO filtra `eliminado` a propósito: la regla de entrega compara
 * contra `equipos.size()` del documento, que tampoco puede filtrar. Filtrar
 * aquí haría caducar el QC de toda orden que ya tuviera un equipo borrado.
 * @param {Object} orden - Documento de la orden
 * @returns {{equipos_n:number, seriales:string[]}}
 */
function qcCoberturaDe(orden) {
  const equipos = Array.isArray(orden?.equipos) ? orden.equipos : [];
  return {
    equipos_n: equipos.length,
    seriales: equipos
      .map(e => String(e?.numero_de_serie || e?.serial || '').trim())
      .filter(Boolean)
  };
}

/**
 * Bloque por-equipo de una pasada de QC, tal como se guarda en `qc`.
 *
 * El QC nació siendo UNA revisión por orden: `qc.checklist` era un mapa plano y
 * una firma sobre 10 radios no podía decir qué se revisó en cada uno. Desde el
 * checklist por equipo, el detalle fiel vive aquí (`por_equipo`, indexado por
 * el `id` del equipo dentro de `orden.equipos[]`) y `qc.checklist` queda como
 * resumen derivado — lo siguen leyendo la regla qcAprobadoTraeChecklist() y las
 * métricas de progreso-tecnicos.js.
 *
 * Devuelve `{}` cuando la orden no tiene equipos (camino legacy) para no
 * estampar claves vacías en el documento.
 * @param {Object|null} equipos - payload armado por ordenes-qc.js
 */
function qcPorEquipoDe(equipos) {
  if (!equipos || !equipos.por_equipo) return {};
  return {
    por_equipo: equipos.por_equipo,
    equipos_revisados_n: equipos.equipos_revisados_n || 0,
    equipos_aprobados: equipos.aprobados || [],
    equipos_denegados: equipos.denegados || [],
    equipos_descartados: equipos.descartados || [],
  };
}

/**
 * Versión COMPACTA para `qc_historial`. El historial es un array que crece con
 * cada pasada (arrayUnion) dentro del mismo documento: meter el detalle por
 * equipo multiplicaría su tamaño por el número de radios y acerca el doc al
 * tope de 1 MiB de Firestore. El detalle completo de la pasada vigente ya está
 * en `qc`; aquí basta el recuento y qué seriales se descartaron, que es lo
 * único del historial que se consulta después.
 * @param {Object|null} equipos
 */
function qcPorEquipoHistorialDe(equipos) {
  if (!equipos || !equipos.por_equipo) return {};
  return {
    equipos_revisados_n: equipos.equipos_revisados_n || 0,
    aprobados_n:   (equipos.aprobados   || []).length,
    denegados_n:   (equipos.denegados   || []).length,
    descartados_n: (equipos.descartados || []).length,
    equipos_denegados:   equipos.denegados   || [],
    equipos_descartados: equipos.descartados || [],
  };
}

const OrdenesService = {
  /**
   * Internal helper: builds the orders query with role-based filtering
   * + orderBy. Used by both loadOrders (one-shot) and subscribeFirstPage
   * (live). Kept in sync via this single source.
   * @private
   */
  _buildOrdersQuery({ userRole = null, userId = null, limit = 50, soloMias = false }) {
    const db = firebase.firestore();
    let queryRef = db.collection("ordenes_de_servicio");

    // Role-based filtering. Other roles see all orders and rely on
    // client-side filters (soloMias toggle, etc).
    if (userRole === "vendedor" && userId) {
      queryRef = queryRef.where("vendedor_asignado", "==", userId);
    } else if (userRole === "tecnico_operativo" && userId) {
      queryRef = queryRef.where("tecnico_uid", "==", userId);
    } else if (userRole === "tecnico" && userId && soloMias) {
      // Auditoría órdenes P1.10: con "Mis órdenes" activo (el default del
      // rol) el técnico bajaba las órdenes de TODOS de 15 en 15 y filtraba
      // en cliente — percepción de lentitud y riesgo de no ver las suyas
      // viejas. Con el toggle APAGADO vuelve a la query general (necesita
      // ver POR ASIGNAR para tomar órdenes). Mismo índice que
      // tecnico_operativo (tecnico_uid + fecha_creacion).
      queryRef = queryRef.where("tecnico_uid", "==", userId);
    }

    // Soft-deleted FUERA en el servidor (auditoría P3.19): antes se
    // descargaban y se botaban en cliente (72 docs muertos por página en el
    // peor caso). Requiere que el campo EXISTA en todos los docs — backfill
    // 2026-08-19 (716 legacy) + todos los creadores lo estampan. Índices:
    // (eliminado, fecha_creacion) y variantes con vendedor/tecnico. El
    // filtro de cliente en subscribeFirstPage/loadOrders queda como
    // cinturón — un doc nuevo sin el campo simplemente no aparece.
    queryRef = queryRef.where("eliminado", "==", false);

    return queryRef.orderBy("fecha_creacion", "desc").limit(limit);
  },

  /**
   * Subscribe to live updates on the first page of orders.
   * Replaces the previous one-shot loadOrders + setTimeout(1000)
   * reload pattern that waited on Cloud Functions to settle.
   * ORDENES_INDEX_IMPROVEMENTS.md §3.1.
   *
   * The listener receives Firestore-pushed updates on:
   *   - Order CREATE: a new doc enters the limit window, oldest drops
   *   - Order UPDATE: any field change on a doc inside the window
   *   - Order DELETE / soft-delete (eliminado=true): doc removed from list
   *
   * Older paginated orders (loaded via subsequent loadOrders calls
   * past the cursor) are NOT live — they're a one-shot snapshot from
   * "Cargar más". Recently-active orders typically live in the first
   * page anyway, so this captures the bulk of the value.
   *
   * @param {Object} options
   * @param {string} options.userRole
   * @param {string} options.userId
   * @param {number} options.limit
   * @param {(payload: {orders: Array, lastSnapshot: firebase.firestore.DocumentSnapshot|null}) => void} options.onUpdate
   * @param {(err: Error) => void} [options.onError]
   * @returns {() => void} unsubscribe function — call when leaving the page
   */
  subscribeFirstPage({ userRole = null, userId = null, limit = 50, soloMias = false, onUpdate, onError } = {}) {
    const queryRef = this._buildOrdersQuery({ userRole, userId, limit, soloMias });
    return queryRef.onSnapshot(
      snapshot => {
        const orders = [];
        let lastDoc = null;
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.eliminado !== true) {
            orders.push({ ordenId: doc.id, ...data });
          }
          lastDoc = doc;
        });
        onUpdate?.({ orders, lastSnapshot: lastDoc, fromCache: snapshot.metadata.fromCache });
      },
      err => {
        console.error("[OrdenesService.subscribeFirstPage]", err);
        onError?.(err);
      }
    );
  },

  /**
   * Load orders from Firestore with pagination (one-shot read).
   * Used for "Cargar más" past the first page; the first page itself
   * runs via subscribeFirstPage for live updates.
   * @param {Object} options - Query options
   * @param {firebase.firestore.DocumentSnapshot} options.lastSnapshot - Last document for pagination
   * @param {string} options.userRole - User role for filtering
   * @param {string} options.userId - User ID for filtering
   * @param {number} options.limit - Number of orders to fetch
   * @returns {Promise<{orders: Array, lastSnapshot: firebase.firestore.DocumentSnapshot}>}
   */
  async loadOrders({ lastSnapshot = null, userRole = null, userId = null, limit = 50, soloMias = false } = {}) {
    let queryRef = this._buildOrdersQuery({ userRole, userId, limit, soloMias });

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

  // ── Correlativo del día (auditoría A5) ────────────────────────────────
  // Antes el número salía de un listAll() de TODA la colección fuera de
  // transacción: lento a escala, con carrera real (dos creadores simultáneos
  // obtenían el mismo número y setOrder pisaba el doc) y tope de 99/día por
  // el slice(-2). Mismo patrón que contratos.reservarSufijo / correlativo COT.

  // Piso para sembrar el contador el primer día que se usa (las órdenes
  // previas no dejaron contador): max sufijo de HOY con una query por rango
  // del doc ID (los ids empiezan por YYYYMMDD).
  async maxSufijoOrdenDelDia(fechaStr) {
    const db = firebase.firestore();
    const snap = await db.collection("ordenes_de_servicio")
      .where(firebase.firestore.FieldPath.documentId(), ">=", fechaStr)
      .where(firebase.firestore.FieldPath.documentId(), "<", fechaStr + "")
      .get();
    let max = 0;
    const re = new RegExp("^" + fechaStr + "(\\d+)$");
    snap.forEach(d => {
      const m = d.id.match(re);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return max;
  },

  // Reserva atómica en contadores/ordenes_{YYYYMMDD} (rules: contadores/ ya
  // permite create/update a todos los roles que crean órdenes).
  async reservarNumeroOrden(fechaStr, piso = 0) {
    const db = firebase.firestore();
    const ref = db.collection("contadores").doc(`ordenes_${fechaStr}`);
    return db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const actual = snap.exists ? Number(snap.data().seq || 0) : 0;
      const siguiente = Math.max(actual, piso) + 1;
      t.set(ref, {
        seq: siguiente,
        fecha: fechaStr,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return siguiente;
    });
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
   * Assign technician to order. Also appends an `os_logs` audit entry
   * for the timeline view in the expanded row (§5.7).
   * @param {string} ordenId - Order ID
   * @param {string} tecnicoUid - Technician user ID
   * @param {string} tecnicoNombre - Technician name
   * @returns {Promise<void>}
   */
  async assignTechnician(ordenId, tecnicoUid, tecnicoNombre, { saltoRecepcion = false } = {}) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "ASIGNADO",
      tecnico_asignado: tecnicoNombre,
      tecnico_uid: tecnicoUid,
      fecha_asignacion: firebase.firestore.FieldValue.serverTimestamp(),
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'ASIGNAR',
        by: user?.uid || '',
        // Asignada directo desde POR ASIGNAR = nunca pasó por RECIBIDO EN
        // MOSTRADOR. La marca hace medible el atajo (auditoría órdenes P2:
        // 34 saltos en 90 días que eran invisibles en la bitácora).
        ...(saltoRecepcion ? { salto_recepcion: true } : {})
      })
    });
  },

  /**
   * Reassign an order to a different technician WITHOUT changing the
   * order's state (unlike assignTechnician, which forces ASIGNADO).
   * Backs the occasional "Cambiar técnico" action available to
   * administrador / jefe_taller. Records a REASIGNAR `os_logs` entry
   * capturing the previous → new technician so the change is auditable,
   * and re-stamps `fecha_asignacion` so the timeline reflects the
   * current effective assignment.
   * @param {string} ordenId - Order ID
   * @param {string} tecnicoUid - New technician user ID
   * @param {string} tecnicoNombre - New technician name
   * @param {{prevUid?: string, prevNombre?: string}} [prev] - Previous técnico, for the audit entry
   * @returns {Promise<void>}
   */
  async reassignTechnician(ordenId, tecnicoUid, tecnicoNombre, { prevUid = "", prevNombre = "" } = {}) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      tecnico_asignado: tecnicoNombre,
      tecnico_uid: tecnicoUid,
      fecha_asignacion: firebase.firestore.FieldValue.serverTimestamp(),
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'REASIGNAR',
        by: user?.uid || '',
        from: prevNombre || prevUid || '',
        to: tecnicoNombre || tecnicoUid || ''
      })
    });
  },

  /**
   * Mark order as completed. Captures `completado_por_email` so the
   * timeline can attribute the action, and appends an `os_logs` entry.
   * @param {string} ordenId - Order ID
   * @param {{qcRequerido?: boolean}} [opts] - qcRequerido:false para órdenes
   *   de ENTRADA (inspección de devueltos): no hay entrega posterior que
   *   proteger con QC — su terminal es CERRADA (ENTRADA).
   * @returns {Promise<void>}
   */
  async completeOrder(ordenId, { qcRequerido = true } = {}) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "COMPLETADO (EN OFICINA)",
      fecha_completado: firebase.firestore.FieldValue.serverTimestamp(),
      completado_por_uid: user?.uid || '',
      completado_por_email: user?.email || '',
      // Candado de QC: a partir de aquí la entrega exige qc.resultado ==
      // 'aprobado' (rules + UI). Las órdenes completadas ANTES del despliegue
      // no llevan la marca y quedan exentas (corte legacy). Visitas y
      // devoluciones nunca pasan por completeOrder; las ENTRADA sí pasan
      // pero quedan exentas (qcRequerido:false — cierran sin entrega).
      qc_requerido: qcRequerido,
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'COMPLETAR',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Control de calidad — aprobar. Estampa `qc` (resultado vigente que
   * habilita la entrega) y agrega la pasada a `qc_historial` (métricas
   * por técnico/motivo). Solo jefe_taller/admin (rules protegen el campo).
   * @param {string} ordenId
   * @param {{tipo:string, checklist:Object, observaciones?:string}} payload
   */
  async saveQcAprobado(ordenId, { tipo, checklist, observaciones = '', equipos = null }) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    const orden = (await db.collection("ordenes_de_servicio").doc(ordenId).get()).data() || {};
    const cobertura = qcCoberturaDe(orden);
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      qc: {
        resultado: 'aprobado',
        tipo,
        checklist,
        observaciones,
        ...qcPorEquipoDe(equipos),
        // Qué cubrió esta firma. equipos_n lo compara la regla de entrega
        // (qcCubreLosEquipos): si después se agregan equipos, el QC caduca.
        // seriales deja el rastro de QUÉ unidades se revisaron — el checklist
        // es por orden, así que sin esto una firma sobre 10 radios no podía
        // decir cuáles.
        equipos_n: cobertura.equipos_n,
        seriales: cobertura.seriales,
        por_uid: user?.uid || '',
        por_email: user?.email || '',
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      },
      // serverTimestamp no es válido dentro de arrayUnion → fecha ISO local.
      qc_historial: firebase.firestore.FieldValue.arrayUnion({
        resultado: 'aprobado',
        tipo,
        checklist,
        observaciones,
        ...qcPorEquipoHistorialDe(equipos),
        equipos_n: cobertura.equipos_n,
        tecnico_uid: orden.tecnico_uid || '',
        tecnico: orden.tecnico_asignado || '',
        por_email: user?.email || '',
        fecha_iso: new Date().toISOString()
      }),
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'QC_APROBADO',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Control de calidad — rechazar. Registra el rechazo (motivos por
   * categoría + observaciones) y devuelve la orden a ASIGNADO para que
   * el técnico corrija; la transición COMPLETADO→ASIGNADO solo es legal
   * en rules cuando el mismo write estampa qc.resultado='rechazado'.
   * @param {string} ordenId
   * @param {{tipo:string, checklist:Object, motivos:string[], observaciones?:string}} payload
   */
  async saveQcRechazado(ordenId, { tipo, checklist, motivos, observaciones = '', equipos = null }) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    const orden = (await db.collection("ordenes_de_servicio").doc(ordenId).get()).data() || {};
    const cobertura = qcCoberturaDe(orden);
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "ASIGNADO",
      qc: {
        resultado: 'rechazado',
        tipo,
        checklist,
        motivos,
        observaciones,
        ...qcPorEquipoDe(equipos),
        equipos_n: cobertura.equipos_n,
        seriales: cobertura.seriales,
        por_uid: user?.uid || '',
        por_email: user?.email || '',
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      },
      qc_historial: firebase.firestore.FieldValue.arrayUnion({
        resultado: 'rechazado',
        tipo,
        checklist,
        motivos,
        observaciones,
        ...qcPorEquipoHistorialDe(equipos),
        equipos_n: cobertura.equipos_n,
        tecnico_uid: orden.tecnico_uid || '',
        tecnico: orden.tecnico_asignado || '',
        por_email: user?.email || '',
        fecha_iso: new Date().toISOString()
      }),
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'QC_RECHAZADO',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Acknowledge receipt of equipment when the client drops it off at the
   * counter. Records the signed acknowledgement (firma + nombre del que
   * entrega) and transitions the order from POR ASIGNAR to
   * RECIBIDO EN MOSTRADOR so the timeline reflects the physical handoff.
   * The order still needs a technician assigned afterwards — the flujo
   * continues normally from there.
   * @param {string} ordenId
   * @param {{receptorNombre:string, firmaUrl:string}} payload
   */
  async receiveAtCounter(ordenId, { receptorNombre, firmaUrl, sinFirma = false, sinFirmaMotivo = '', cedula = '' }) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "RECIBIDO EN MOSTRADOR",
      fecha_recepcion: firebase.firestore.FieldValue.serverTimestamp(),
      recepcion_por_uid: user?.uid || '',
      recepcion_por_email: user?.email || '',
      firma_recepcion_url: firmaUrl || null,
      receptor_recepcion_nombre: receptorNombre,
      // Cédula de quien entrega — hoy solo la captura la firma en tablet.
      receptor_recepcion_cedula: cedula || null,
      recepcion_sin_firma: !!sinFirma,
      recepcion_sin_firma_motivo: sinFirma ? sinFirmaMotivo : null,
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'RECIBIR_MOSTRADOR',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Soft delete order. El motivo y la autoría quedan en el doc y en la
   * bitácora (os_logs) — las rules exigen motivo (≥10 chars), rol
   * admin/recepción y estado NO terminal (auditoría órdenes P2).
   * @param {string} ordenId - Order ID
   * @param {{motivo?: string}} [opts]
   * @returns {Promise<void>}
   */
  async deleteOrder(ordenId, { motivo = "" } = {}) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      eliminado: true,
      fecha_eliminacion: firebase.firestore.FieldValue.serverTimestamp(),
      eliminado_motivo: motivo,
      eliminado_por_uid: user?.uid || "",
      eliminado_por_email: user?.email || "",
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'ELIMINAR',
        by: user?.uid || '',
        motivo: motivo
      })
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
    
    const anterior = equipos[equipoIndex][campo];
    equipos[equipoIndex][campo] = valor;
    // El serial vive bajo DOS claves (`serial` es la que leen los triggers del
    // pool y los renders; `numero_de_serie` es el alias legacy de escritura).
    // Editar solo una dejaba al pool rastreando el serial viejo — se
    // sincronizan siempre juntas.
    const esSerial = campo === "numero_de_serie" || campo === "serial";
    if (esSerial) {
      equipos[equipoIndex].serial = valor;
      equipos[equipoIndex].numero_de_serie = valor;
    }

    // Cambiar un serial deja rastro. Antes esta función hacía un
    // `update({equipos})` pelado: ni `fecha_modificacion` ni `os_logs`, así que
    // el cambio era INDEMOSTRABLE — ni quién ni cuándo.
    //
    // Costó un caso real (TIL PANAMA, 2026-08): la tanda creó la fila con
    // "B8C10597", alguien la editó a "B8C1697" desde aquí, y al cerrar la
    // ENTRADA el equipo se quedó en cuarentena porque ese serial no existía en
    // el pool. Reconstruir qué había pasado exigió descartar hipótesis una por
    // una contra el kardex, y aun así nunca se supo QUIÉN lo editó.
    //
    // Solo el serial se registra: modelo y observaciones se corrigen a cada
    // rato y llenarían la bitácora de ruido. El serial es la identidad del
    // equipo — cambiarlo re-apunta el inventario.
    const patch = { equipos };
    if (esSerial) {
      patch.fecha_modificacion = firebase.firestore.FieldValue.serverTimestamp();
      patch.os_logs = firebase.firestore.FieldValue.arrayUnion({
        action: "EDITAR_SERIAL",
        by: firebase.auth().currentUser?.uid || "",
        by_email: firebase.auth().currentUser?.email || "",
        // ISO y no serverTimestamp: Firestore no admite sentinelas dentro de
        // un array (mismo patrón que el historial de equipos descartados).
        at_iso: new Date().toISOString(),
        de: String(anterior ?? ""),
        a: String(valor ?? ""),
      });
    }
    await ordenRef.update(patch);
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
   * Save the structured site-visit report (órdenes de VISITA TECNICA).
   * Replaces the old habit of dumping the field work narrative into
   * `nota_tecnica`: fecha real de la visita, motivo, trabajo/hallazgos
   * separados y elementos de sitio intervenidos (sin serial obligatorio,
   * y FUERA del array `equipos` para no contaminar equipos_pool).
   * @param {string} ordenId
   * @param {{fecha_visita:string, motivo:string, trabajo_realizado:string,
   *          hallazgos:string, elementos:Array<{tipo:string,detalle:string,serial:string}>}} informe
   */
  async saveInformeVisita(ordenId, informe) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      informe_visita: {
        fecha_visita:      informe.fecha_visita || null,
        motivo:            informe.motivo || null,
        trabajo_realizado: informe.trabajo_realizado || "",
        hallazgos:         informe.hallazgos || "",
        elementos:         Array.isArray(informe.elementos) ? informe.elementos : [],
        updated_at:        firebase.firestore.Timestamp.now(),
        updated_by_uid:    user?.uid || "",
        updated_by_email:  user?.email || ""
      },
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'INFORME_VISITA',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Close a VISITA TECNICA order in the field. Terminal state for visitas
   * (no delivery phase follows): requires either the signature of the
   * client's on-site staff (firmaUrl + receptor) or an explicit waiver
   * reason. Also stamps `fecha_completado`/`completado_por_*` so existing
   * sorts and timelines keep working.
   * @param {string} ordenId
   * @param {{firmaUrl:string|null, receptorNombre:string, receptorCargo:string,
   *          sinFirma:boolean, sinFirmaMotivo:string}} payload
   */
  async closeVisita(ordenId, { firmaUrl = null, receptorNombre = "", receptorCargo = "", sinFirma = false, sinFirmaMotivo = "" }) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "CERRADA (VISITA)",
      fecha_cierre_visita: firebase.firestore.FieldValue.serverTimestamp(),
      fecha_completado: firebase.firestore.FieldValue.serverTimestamp(),
      completado_por_uid: user?.uid || '',
      completado_por_email: user?.email || '',
      firma_visita_url: firmaUrl || null,
      firma_visita_receptor: receptorNombre || null,
      firma_visita_cargo: receptorCargo || null,
      visita_sin_firma: !!sinFirma,
      visita_sin_firma_motivo: sinFirma ? sinFirmaMotivo : null,
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'CERRAR_VISITA',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Close an ENTRADA order (inspección de equipos devueltos). Terminal
   * state for entradas — no delivery phase follows: the units stay under
   * inventory control (bodega/baja se decide por serial en Equipos por
   * serial). `fecha_completado` ya la estampó completeOrder, no se toca.
   * @param {string} ordenId
   * @param {{observaciones?: string}} [payload]
   */
  async closeEntrada(ordenId, { observaciones = "" } = {}) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    await db.collection("ordenes_de_servicio").doc(ordenId).update({
      estado_reparacion: "CERRADA (ENTRADA)",
      fecha_cierre_entrada: firebase.firestore.FieldValue.serverTimestamp(),
      cierre_entrada_por_uid: user?.uid || '',
      cierre_entrada_por_email: user?.email || '',
      cierre_entrada_observaciones: observaciones || null,
      os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: 'CERRAR_ENTRADA',
        by: user?.uid || ''
      })
    });
  },

  /**
   * Load technicians for assignment dropdown. Incluye jefe_taller
   * (supervisor de taller): también trabaja órdenes y puede asignárselas
   * a sí mismo igual que un técnico.
   * @returns {Promise<Array<{uid: string, nombre: string, rol: string}>>}
   */
  _techCache: null,
  async loadTechnicians() {
    // Caché 5 min (auditoría órdenes P0): se leía en el boot de los filtros
    // Y de nuevo en cada apertura del modal Asignar — la plantilla de
    // técnicos casi nunca cambia dentro de una sesión.
    if (this._techCache && (Date.now() - this._techCache.ts) < 300000) {
      return this._techCache.data;
    }
    const db = firebase.firestore();
    const snapshot = await db.collection("usuarios")
      .where("rol", "in", ["tecnico", "tecnico_operativo", "jefe_taller"])
      .get();

    const technicians = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      technicians.push({
        uid: doc.id,
        nombre: data.nombre || data.email || doc.id,
        rol: data.rol || ""
      });
    });

    const data = technicians.sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    this._techCache = { ts: Date.now(), data };
    return data;
  },

  /**
   * Search orders by filters (orden, cliente, serial).
   *
   * Primary path: `where('searchTokens', 'array-contains-any', [...])`.
   * Tokens are maintained per-order by the `onOrdenWriteSearchTokens`
   * Cloud Function (functions/src/triggers/ordenes/onWriteSearchTokens.js)
   * and seeded for legacy orders by `functions/scripts/backfill-search-tokens.js`.
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

      // Cero resultados = cero resultados (auditoría órdenes 2026-08-17).
      // El fall-through a full-scan era una red para la migración de
      // searchTokens, que YA terminó — y convertía cada búsqueda sin
      // coincidencias (un typo bastaba) en la descarga de la COLECCIÓN
      // COMPLETA de órdenes filtrada en el navegador.
      return results;
    } catch (err) {
      console.warn("[searchOrders] indexed query failed, falling back to bounded scan:",
        err?.code || err?.message);
    }

    // ── Fallback ACOTADO: solo si la query indexada FALLÓ (índice caído,
    // sin red a mitad) — nunca por 0 resultados. Últimas 300 órdenes, no
    // toda la colección.
    const snapshot = await db.collection("ordenes_de_servicio")
      .orderBy("fecha_creacion", "desc")
      .limit(300)
      .get();
    const matchScan = buildMatch({ useTokens: false });
    const resultados = [];
    snapshot.forEach(doc => {
      const m = matchScan(doc);
      if (m) resultados.push(m);
    });
    return resultados;
  },

  // Memo de 60s por estado (2026-09-02, factura de agosto): los chips de la
  // bandeja llaman esto en cada clic y cada clic bajaba hasta 200 docs de
  // 8KB. Un chip repetido dentro del minuto sirve lo ya bajado; el costo es
  // que un cambio de OTRO usuario tarda ≤60s en reflejarse en el chip.
  _fbsMemo: new Map(),

  // "POR ASIGNAR" es la cola de ASIGNACIÓN de taller (2026-09-02, pedido del
  // dueño): las DEVOLUCIÓN viven en ese estado pero jamás llevan técnico —
  // fuera de esta vista. Misma convención que PendientesDomain.esColaDeTaller
  // (inline para no obligar a cargar pendientes.js en todas las páginas).
  _sinDevolucionSiPorAsignar(estado, rows) {
    if (String(estado || "").trim().toUpperCase() !== "POR ASIGNAR") return rows;
    return rows.filter(o => (o.tipo_de_servicio || "").toUpperCase() !== "DEVOLUCION");
  },

  /**
   * Filter orders by status
   * @param {string} estado - Status to filter by
   * @param {number} limit - Maximum results
   * @returns {Promise<Array>}
   */
  async filterByStatus(estado, limit = 200) {
    const memoKey = `${estado}|${limit}`;
    const hit = this._fbsMemo.get(memoKey);
    if (hit && (Date.now() - hit.at) < 60_000) return hit.rows;

    const db = firebase.firestore();

    try {
      // Try with index first
      const snap = await db.collection("ordenes_de_servicio")
        .where("estado_reparacion", "==", estado)
        .orderBy("fecha_creacion", "desc")
        .limit(limit)
        .get();

      let resultados = [];
      snap.forEach(doc => {
        const data = doc.data();
        if (data.eliminado === true) return;
        resultados.push({ ordenId: doc.id, ...data });
      });
      resultados = this._sinDevolucionSiPorAsignar(estado, resultados);

      this._fbsMemo.set(memoKey, { at: Date.now(), rows: resultados });
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

        const filtrados = this._sinDevolucionSiPorAsignar(estado,
          allDocs.filter(o => o.estado_reparacion === estado));
        this._fbsMemo.set(memoKey, { at: Date.now(), rows: filtrados });
        return filtrados;
      }
      
      throw e; // Re-throw if not index issue
    }
  },

  /**
   * Cola de control de calidad, CONSULTADA AL SERVIDOR.
   *
   * Por qué existe (reporte jefa de taller 2026-08-19): el chip "QC" y el CTA
   * `?qc=1` del correo diario filtraban en cliente sobre la primera página —
   * las 40 órdenes MÁS RECIENTES. Pero una orden entra en cola de QC después de
   * completarse, así que las que el correo enumera son justamente las viejas:
   * el correo decía "5 órdenes esperando" y la página respondía "No se
   * encontraron coincidencias". Esta query no depende de esa ventana.
   *
   * Mismo criterio (y mismo índice compuesto qc_requerido+estado_reparacion)
   * que SenalesService.countOrdenesQcPendiente, que cuenta lo mismo en el home.
   * @param {number} [limit=200]
   * @returns {Promise<Array>} órdenes pendientes de QC, sin ordenar
   */
  async listQcPendientes(limit = 200) {
    const db = firebase.firestore();
    const snap = await db.collection("ordenes_de_servicio")
      .where("qc_requerido", "==", true)
      .where("estado_reparacion", "==", "COMPLETADO (EN OFICINA)")
      .limit(limit)
      .get();

    const out = [];
    snap.forEach(doc => {
      const o = { ordenId: doc.id, ...(doc.data() || {}) };
      // Predicado compartido con el cron y las señales (PendientesDomain:
      // espejo del servidor + test de sincronía). Aquí vivía la CUARTA copia
      // del criterio, que además no sabía detectar la sustitución de serial.
      if (PendientesDomain.esQcColaOperativa(o)) out.push(o);
    });
    return out;
  },

  /**
   * Órdenes por ID de documento, en un solo viaje por lote.
   *
   * Existe para el deep-link `?ids=` de los correos: la bandeja solo trae las
   * 40 más recientes y las órdenes que un correo enumera son por definición las
   * viejas, así que hay que pedirlas por nombre. Se usa `documentId() in [...]`,
   * que Firestore limita a 30 valores por consulta — de ahí los lotes.
   *
   * Los IDs inexistentes (una orden borrada desde que salió el correo)
   * simplemente no vuelven; no es un error.
   * @param {string[]} ids
   * @returns {Promise<Array>}
   */
  async listByIds(ids) {
    const limpios = [...new Set((ids || []).map(s => String(s).trim()).filter(Boolean))];
    if (!limpios.length) return [];

    const db = firebase.firestore();
    const col = db.collection("ordenes_de_servicio");
    const TAM = 30;
    const lotes = [];
    for (let i = 0; i < limpios.length; i += TAM) lotes.push(limpios.slice(i, i + TAM));

    const out = [];
    const snaps = await Promise.all(lotes.map(lote =>
      col.where(firebase.firestore.FieldPath.documentId(), "in", lote).get()));
    snaps.forEach(snap => snap.forEach(doc => {
      const d = doc.data() || {};
      // Una orden borrada (lógicamente) no se muestra aunque el correo la
      // nombrara: el correo es una foto del día anterior.
      if (d.eliminado === true) return;
      out.push({ ordenId: doc.id, ...d });
    }));
    return out;
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
  async updateTrabajoTecnico({ ordenId, equipoIdx, equipoIdxs = null, texto, uid, email }) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ordenRef.get();

    if (!snap.exists) throw new Error("Orden no encontrada");

    const data = snap.data() || {};
    const equiposAll = Array.isArray(data.equipos) ? data.equipos : [];

    // Lote en UN write (auditoría órdenes P1.8): antes el "aplicar también a
    // estos seriales" llamaba esta función en serie — get+update del doc
    // completo POR EQUIPO (~2N viajes y la espera "Aplicando 3/5…").
    // equipoIdxs (índices sobre la lista sin eliminados) aplica el mismo
    // texto a todos en una sola lectura + una sola escritura.
    const objetivo = new Set(
      Array.isArray(equipoIdxs) && equipoIdxs.length ? equipoIdxs : [equipoIdx]
    );

    let nonDeletedIndex = -1;
    let aplicados = 0;
    equiposAll.forEach(e => {
      if (e?.eliminado) return;
      nonDeletedIndex++;
      if (!objetivo.has(nonDeletedIndex)) return;
      e.trabajo_tecnico = texto;
      e.trabajo_tecnico_updated_at = firebase.firestore.Timestamp.now();
      e.trabajo_tecnico_uid = uid;
      e.trabajo_tecnico_nombre = email;
      if (texto && texto.trim()) {
        e.intervencion_no_disponible = false;
        e.motivo_no_disponible = "";
      }
      aplicados++;
    });

    if (aplicados === 0) throw new Error("Equipo no encontrado");

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
   * Append a photo entry to an equipo inside an order.
   * Photo is stored inline on equipos[i].fotos = [...]
   */
  async addEquipoFoto({ ordenId, equipoId, foto }) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ordenRef.get();
    if (!snap.exists) throw new Error("Orden no encontrada");

    const data = snap.data() || {};
    const equiposAll = Array.isArray(data.equipos) ? data.equipos : [];
    const realIndex = equiposAll.findIndex(e => !e?.eliminado && e?.id === equipoId);
    if (realIndex === -1) throw new Error("Equipo no encontrado");

    const fotosPrev = Array.isArray(equiposAll[realIndex].fotos) ? equiposAll[realIndex].fotos : [];
    equiposAll[realIndex].fotos = [...fotosPrev, foto];
    equiposAll[realIndex].fotos_updated_at = firebase.firestore.Timestamp.now();

    await ordenRef.update({ equipos: equiposAll });
    return equiposAll;
  },

  /**
   * Soft-delete a photo from an equipo (keeps history).
   */
  async softDeleteEquipoFoto({ ordenId, equipoId, fotoId, uid, email }) {
    const db = firebase.firestore();
    const ordenRef = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ordenRef.get();
    if (!snap.exists) throw new Error("Orden no encontrada");

    const data = snap.data() || {};
    const equiposAll = Array.isArray(data.equipos) ? data.equipos : [];
    const realIndex = equiposAll.findIndex(e => !e?.eliminado && e?.id === equipoId);
    if (realIndex === -1) throw new Error("Equipo no encontrado");

    const fotos = Array.isArray(equiposAll[realIndex].fotos) ? equiposAll[realIndex].fotos : [];
    let found = false;
    const updated = fotos.map(f => {
      if (f?.id !== fotoId || f?.deleted === true) return f;
      found = true;
      return {
        ...f,
        deleted: true,
        deleted_by_uid: uid || "",
        deleted_by_email: email || "",
        deleted_at: firebase.firestore.Timestamp.now()
      };
    });
    if (!found) throw new Error("Foto no encontrada");

    equiposAll[realIndex].fotos = updated;
    equiposAll[realIndex].fotos_updated_at = firebase.firestore.Timestamp.now();

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

  // Clave bajo la que se guardan los consumos de un equipo: su id o, para
  // equipos legacy sin id, su número de serie. Única fuente para el ESCRITOR
  // (registro de materiales en ordenes-equipos). Los lectores (precarga de
  // cotizar-orden, snapshot de correo en ordenes-flujo) casan por id Y por
  // serial porque conviven consumos escritos bajo ambas claves.
  consumoKeyDe(equipo) {
    if (!equipo) return null;
    return equipo.id
      || String(equipo.numero_de_serie || equipo.serial || equipo.SERIAL || '').trim()
      || null;
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

  // ── Borradores de cotización (autoguardado de cotizar-orden) ──────────────
  // Un doc por usuario: ordenes_de_servicio/{ordenId}/borradores_cotizacion/{uid}

  async getBorradorCotizacion(ordenId, uid) {
    const db = firebase.firestore();
    const doc = await db.collection("ordenes_de_servicio").doc(ordenId)
      .collection("borradores_cotizacion").doc(uid).get();
    return doc.exists ? doc.data() : null;
  },

  async setBorradorCotizacion(ordenId, uid, data) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId)
      .collection("borradores_cotizacion").doc(uid).set({
        ...data,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
  },

  async deleteBorradorCotizacion(ordenId, uid) {
    const db = firebase.firestore();
    return db.collection("ordenes_de_servicio").doc(ordenId)
      .collection("borradores_cotizacion").doc(uid).delete();
  },
};

// Export to window for global access
window.OrdenesService = OrdenesService;

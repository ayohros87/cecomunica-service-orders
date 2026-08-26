/* =============================================================
   GESTIONES — expedientes de operación por CLIENTE a nivel serial
   (Ola 1, docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md).

   Una gestión opera sobre seriales concretos del cliente y puede
   cruzar contratos: el contrato queda como envoltura de facturación
   y cada ítem lleva su propio contrato_doc_id. Los efectos sobre el
   contrato (baja_cancelado, órdenes, linaje reemplaza_a) los derivan
   Cloud Functions a partir de la gestión — nunca el navegador.

   V1 (Ola 1): fundación — correlativo, crear, listar, contadores.
   Los wizards de reemplazo/demo y los triggers llegan en la Ola 2;
   baja/aumento/devolución/cambio_serial en las Olas 3–5.
   ============================================================= */

const GestionesService = {
  COL: 'gestiones',

  // tipo → { prefijo del correlativo, label }
  TIPOS: {
    reemplazo:     { prefijo: 'GR', label: 'Reemplazo' },
    demo:          { prefijo: 'GD', label: 'Demo' },
    baja:          { prefijo: 'GB', label: 'Baja de equipos' },
    aumento:       { prefijo: 'GA', label: 'Aumento de equipos' },
    devolucion:    { prefijo: 'GV', label: 'Devolución' },
    cambio_serial: { prefijo: 'GC', label: 'Cambio de serial' },
  },

  // Estados del expediente. No todos aplican a todos los tipos (en_demo /
  // retorno son de demo); la máquina fina por tipo la validan los triggers.
  ESTADOS: {
    pendiente_aprobacion: 'Pendiente de aprobación',
    pendiente_firma:      'Esperando firma del cliente',
    pendiente_bodega:     'Pendiente de bodega',
    en_proceso:           'En proceso',
    en_demo:              'En demo',
    retorno:              'En retorno',
    cerrada:              'Cerrada',
    anulada:              'Anulada',
  },
  ABIERTAS: ['pendiente_aprobacion', 'pendiente_firma', 'pendiente_bodega', 'en_proceso', 'en_demo', 'retorno'],

  tipoLabel(t)   { return this.TIPOS[t]?.label || t || '—'; },
  estadoLabel(e) { return this.ESTADOS[e] || e || '—'; },

  // Sello YYYYMMDD en hora LOCAL — mismo criterio (y misma trampa evitada)
  // que el correlativo de contratos: nada de toISOString()/UTC.
  _fechaStr(d = new Date()) {
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  },

  // GR20260826-01: reserva atómica en contadores/gestiones_{PREF}_{YYYYMMDD}
  // (patrón reservarSufijo de contratosService; colección nueva → sin piso).
  async reservarId(tipo) {
    const meta = this.TIPOS[tipo];
    if (!meta) throw new Error(`Tipo de gestión desconocido: ${tipo}`);
    const db = firebase.firestore();
    const fechaStr = this._fechaStr();
    const ref = db.collection('contadores').doc(`gestiones_${meta.prefijo}_${fechaStr}`);
    const seq = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const siguiente = (snap.exists ? Number(snap.data().seq || 0) : 0) + 1;
      t.set(ref, {
        seq: siguiente,
        prefijo: meta.prefijo,
        fecha: fechaStr,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return siguiente;
    });
    return `${meta.prefijo}${fechaStr}-${String(seq).padStart(2, '0')}`;
  },

  // Crea el expediente. `data` trae tipo, cliente_id, cliente_nombre, items[],
  // origen, y lo específico del tipo. El doc-ID ES el correlativo legible.
  // Todos los items deben ser del MISMO cliente — el candado real está en la
  // regla y lo reforzarán los triggers; aquí se valida para fallar temprano.
  async crear(data) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    if (!data?.tipo || !this.TIPOS[data.tipo]) throw new Error('Tipo de gestión inválido');
    if (!data?.cliente_id) throw new Error('La gestión necesita cliente_id');

    const id = await this.reservarId(data.tipo);
    const doc = {
      tipo: data.tipo,
      estado: data.estado || 'pendiente_bodega',
      cliente_id: data.cliente_id,
      cliente_nombre: data.cliente_nombre || '',
      origen: data.origen || { tipo: 'vendedor' },
      items: Array.isArray(data.items) ? data.items : [],
      contratos_afectados: Array.from(new Set(
        (data.items || []).map(i => i.contrato_doc_id).filter(Boolean)
      )),
      ordenes: {},
      cierre: data.cierre || {},
      notas: data.notas || '',
      responsable_uid: user?.uid || null,
      responsable_email: user?.email || null,
      fecha_solicitud: firebase.firestore.FieldValue.serverTimestamp(),
      deleted: false,
      ...(data.demo ? { demo: data.demo } : {}),
      ...(data.aumento ? { aumento: data.aumento } : {}),
      ...(data.aprobacion ? { aprobacion: data.aprobacion } : {}),
      // Baja: la penalidad estimada y la fecha global viajan en el MISMO create
      // para que el correo de aprobación (trigger onCreate) ya traiga el desglose.
      ...(data.penalidad_estimada ? { penalidad_estimada: data.penalidad_estimada } : {}),
      ...(data.fecha_fin_facturacion ? { fecha_fin_facturacion: data.fecha_fin_facturacion } : {}),
      ...(data.motivo_codigo ? { motivo_codigo: data.motivo_codigo } : {}),
    };
    await db.collection(this.COL).doc(id).set(doc);
    await this.registrarEvento(id, 'crear', `Gestión creada (${this.tipoLabel(data.tipo)})`);
    return id;
  },

  // Bitácora append-only del expediente.
  async registrarEvento(gestionId, accion, detalle) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    try {
      await db.collection(this.COL).doc(gestionId).collection('eventos').add({
        accion,
        detalle: detalle || '',
        at: firebase.firestore.FieldValue.serverTimestamp(),
        por_uid: user?.uid || null,
        por_email: user?.email || null,
      });
    } catch (e) {
      console.warn('[gestiones] evento no registrado:', e?.message || e);
    }
  },

  async get(id) {
    const snap = await firebase.firestore().collection(this.COL).doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  // Todas las gestiones de un cliente (el eje del Centro de gestión).
  // Ordena en cliente para no exigir índice compuesto todavía.
  async listarPorCliente(clienteId, { limit = 100 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection(this.COL)
      .where('cliente_id', '==', clienteId)
      .limit(limit)
      .get();
    const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    out.sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
    return out;
  },

  // Bandeja global por estado (o abiertas si no se pasa).
  async listar({ estado = null, limit = 200 } = {}) {
    const db = firebase.firestore();
    let q = db.collection(this.COL);
    if (estado) q = q.where('estado', '==', estado);
    const snap = await q.limit(limit).get();
    let out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!estado) out = out.filter(g => this.ABIERTAS.includes(g.estado));
    out.sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
    return out;
  },

  // Aprobación de la excepción por servicio al cliente (propio sin garantía,
  // decisión 2026-08-26 §8.1). Solo administrador — la regla de UI la valida
  // la página; el trigger onGestionWrite manda el correo a bodega al aprobar.
  async aprobar(gestionId) {
    const user = firebase.auth().currentUser;
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      estado: 'pendiente_bodega',
      aprobacion: {
        requiere: true,
        aprobado_por_uid: user?.uid || null,
        aprobado_por_email: user?.email || null,
        at: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    await this.registrarEvento(gestionId, 'aprobar', 'Excepción aprobada por administración — pasa a Bodega.');
  },

  // Anular el expediente (nunca se borra). Vale para rechazar una excepción o
  // cancelar una gestión que no avanzó.
  async anular(gestionId, motivo) {
    const user = firebase.auth().currentUser;
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      estado: 'anulada',
      anulada_motivo: motivo || '',
      anulada_por_uid: user?.uid || null,
      anulada_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await this.registrarEvento(gestionId, 'anular', motivo ? `Anulada: ${motivo}` : 'Anulada.');
  },

  // Aprobación de una BAJA por serial (admin/gerente — UNA sola aprobación por
  // gestión aunque cruce contratos, decisión §8.10). El trigger deriva el fin
  // de facturación por contrato y crea la devolución por serial.
  async aprobarBaja(gestionId) {
    const user = firebase.auth().currentUser;
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      estado: 'en_proceso',
      'cierre.aprobacion': true,
      aprobacion: {
        requiere: true,
        aprobado_por_uid: user?.uid || null,
        aprobado_por_email: user?.email || null,
        at: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    await this.registrarEvento(gestionId, 'aprobar',
      'Baja aprobada — el sistema deriva el fin de facturación por contrato y crea la devolución por serial.');
  },

  // Bodega asigna los seriales de un REEMPLAZO: reescribe items[] con
  // serial_nuevo/pool_doc_id_nuevo por ítem. El trigger detecta la asignación
  // completa, mueve el pool y crea la(s) OS de programación.
  async asignarItems(gestionId, items) {
    await firebase.firestore().collection(this.COL).doc(gestionId).update({ items });
    await this.registrarEvento(gestionId, 'asignar',
      `Bodega asignó: ${items.map(i => `${i.serial_saliente}→${i.serial_nuevo || '—'}`).join(', ')}`);
  },

  // Bodega asigna los seriales de un DEMO.
  async asignarDemo(gestionId, seriales) {
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      'demo.seriales_asignados': seriales,
    });
    await this.registrarEvento(gestionId, 'asignar',
      `Bodega asignó al demo: ${seriales.map(s => s.serial).join(', ')}`);
  },

  /* ── Aumento por enmienda firmada (Ola 4, decisión §8.2) ── */

  // Aprobación COMERCIAL del aumento (admin/gerente) → queda esperando la
  // firma del cliente en el anexo.
  async aprobarAumento(gestionId) {
    const user = firebase.auth().currentUser;
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      estado: 'pendiente_firma',
      'cierre.aprobacion': true,
      aprobacion: {
        requiere: true,
        aprobado_por_uid: user?.uid || null,
        aprobado_por_email: user?.email || null,
        at: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    await this.registrarEvento(gestionId, 'aprobar',
      'Aumento aprobado comercialmente — imprimir el anexo y recoger la firma del cliente.');
  },

  // Registra el anexo FIRMADO (sube el archivo a Storage y avanza el estado).
  // El trigger aplica entonces las líneas al contrato y avisa a Bodega.
  async registrarFirmaAumento(gestionId, file) {
    const user = firebase.auth().currentUser;
    const ext = /pdf$/i.test(file.type) ? 'pdf' : 'jpg';
    const path = `gestiones_anexos/${gestionId}/anexo-firmado-${Date.now()}.${ext}`;
    await firebase.storage().ref(path).put(file, { contentType: file.type });
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      estado: 'pendiente_bodega',
      'cierre.firma': true,
      anexo_firmado_path: path,
      anexo_firmado_at: firebase.firestore.FieldValue.serverTimestamp(),
      anexo_firmado_por: user?.email || null,
    });
    await this.registrarEvento(gestionId, 'firma',
      'Anexo firmado por el cliente registrado — el sistema aplica las líneas al contrato y avisa a Bodega.');
  },

  // Bodega asigna los seriales del AUMENTO.
  async asignarAumento(gestionId, seriales) {
    await firebase.firestore().collection(this.COL).doc(gestionId).update({
      'aumento.seriales_asignados': seriales,
    });
    await this.registrarEvento(gestionId, 'asignar',
      `Bodega asignó al aumento: ${seriales.map(s => s.serial).join(', ')}`);
  },

  async listarEventos(gestionId, { limit = 50 } = {}) {
    const snap = await firebase.firestore().collection(this.COL).doc(gestionId)
      .collection('eventos').limit(limit).get();
    const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    out.sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
    return out;
  },

  // Conteo de abiertas de un cliente (KPI de la ficha 360). count() con
  // fallback a get acotado, mismo patrón que cancelacionesService.
  async contarAbiertasPorCliente(clienteId) {
    const db = firebase.firestore();
    const base = db.collection(this.COL).where('cliente_id', '==', clienteId);
    try {
      if (typeof base.count === 'function') {
        const s = await base.where('estado', 'in', this.ABIERTAS).count().get();
        const n = s.data().count;
        if (typeof n === 'number') return n;
      }
    } catch (e) { /* fallback */ }
    const snap = await base.limit(200).get();
    return snap.docs.filter(d => this.ABIERTAS.includes(d.data().estado)).length;
  },
};

window.GestionesService = GestionesService;

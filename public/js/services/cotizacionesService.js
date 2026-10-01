const CotizacionesService = {

  async getCotizacion(id) {
    const db = firebase.firestore();
    const doc = await db.collection('cotizaciones').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async addCotizacion(data) {
    const db = firebase.firestore();
    return db.collection('cotizaciones').add(data);
  },

  // Sube un adjunto de cotización (brochure, ficha técnica, etc.) a Storage.
  // A diferencia de los documentos PII de cliente, el brochure es material de
  // marketing: guardamos la download URL para que la Cloud Function de correo
  // (nodemailer, attachment.path) pueda adjuntarlo al enviar la propuesta.
  // Devuelve la UploadTask (para progreso) y resuelve la metadata vía onDone.
  // onDone({ id, nombre, url, path, content_type, size }).
  uploadAdjunto({ file, onProgress, onDone, onError }) {
    const storage = firebase.storage();
    const user = firebase.auth().currentUser;
    const id = 'adj_' + Math.random().toString(36).slice(2, 10);
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `cotizaciones_adjuntos/${id}.${ext}`;

    const task = storage.ref(path).put(file, {
      contentType: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : ''),  // PDF de WhatsApp/escáner llega sin tipo
      customMetadata: { subido_por: user?.uid || '', nombre_original: file.name },
    });

    task.on('state_changed',
      (snap) => { if (onProgress) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)); },
      (err) => { if (onError) onError(err); },
      async () => {
        try {
          const url = await task.snapshot.ref.getDownloadURL();
          if (onDone) onDone({
            id,
            nombre: file.name,
            url,
            path,
            content_type: file.type || null,
            size: file.size || null,
          });
        } catch (err) { if (onError) onError(err); }
      }
    );

    return task;
  },

  async updateCotizacion(id, fields) {
    const db = firebase.firestore();
    const r = await db.collection('cotizaciones').doc(id).update(fields);
    // El estado viaja al espejo público para que el link del cliente diga si
    // la cotización sigue vigente, se aceptó o se cerró (auditoría UX
    // 2026-09-28, #20). Best-effort: sin espejo (aún no enviada) no pasa nada.
    if (fields && typeof fields.estado === 'string') {
      db.collection('cotizacion_verificaciones').doc(id)
        .update({ estado: fields.estado, estado_at: firebase.firestore.FieldValue.serverTimestamp() })
        .catch(() => { /* espejo inexistente o sin permiso: no bloquea */ });
    }
    return r;
  },

  // Fetch cotizaciones in a date window (newest first) — used for max-ID sequential generation.
  async getCotizacionesPorFecha(inicio, fin, { limit = 20 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('cotizaciones')
      .where('fecha_creacion', '>=', inicio)
      .where('fecha_creacion', '<=', fin)
      .orderBy('fecha_creacion', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Count cotizaciones in a date window — used for sequential ID generation (snap.size + 1 approach).
  async contarPorFecha(inicio, fin) {
    const db = firebase.firestore();
    const snap = await db.collection('cotizaciones')
      .where('fecha_creacion', '>=', inicio)
      .where('fecha_creacion', '<=', fin)
      .orderBy('fecha_creacion', 'desc')
      .limit(20)
      .get();
    return snap.size;
  },

  // Paginated list, newest first.
  // creadoPorUid (auditoría A8): el vendedor forzado a "solo mías" descargaba
  // las cotizaciones de TODA la empresa y filtraba en cliente — cada página de
  // 30 le mostraba 3-4 suyas (y los docs ajenos llegaban a su navegador).
  // Índice compuesto: cotizaciones(creado_por_uid ASC, fecha_creacion DESC).
  // desde/hasta (Date, auditoría UX 2026-09-28 §4.5 #12): rango sobre
  // fecha_creacion, `hasta` exclusivo. Con creadoPorUid usa el MISMO índice
  // compuesto (la desigualdad va sobre el campo del orderBy).
  // source:'cache' → solo la caché local (el índice pinta al instante y el servidor corrige).
  async listCotizaciones({ lastDoc = null, limit = 30, creadoPorUid = null, desde = null, hasta = null, source = null } = {}) {
    const db = firebase.firestore();
    let q = db.collection('cotizaciones');
    if (creadoPorUid) q = q.where('creado_por_uid', '==', creadoPorUid);
    if (desde) q = q.where('fecha_creacion', '>=', desde);
    if (hasta) q = q.where('fecha_creacion', '<', hasta);
    q = q.orderBy('fecha_creacion', 'desc').limit(limit);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = source ? await q.get({ source }) : await q.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { docs, lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1] };
  },

  // Búsqueda en el servidor por searchTokens (auditoría UX 2026-09-28 T6):
  // antes la búsqueda por cliente filtraba solo las páginas cargadas. Los
  // tokens los estampa onCotizacionSearchTokens (prefijos de cliente y
  // vendedor, número COT y correlativo). Se consulta el PRIMER token del
  // término; el refinado multi-palabra lo hace la lista con includes() sobre
  // los hits. Índice: cotizaciones(searchTokens CONTAINS, creado_por_uid ASC).
  async searchByToken(term, { creadoPorUid = null, limit = 80 } = {}) {
    const tok = String(term || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(Boolean)[0];
    if (!tok || tok.length < 2) return [];
    let q = firebase.firestore().collection('cotizaciones').where('searchTokens', 'array-contains', tok);
    if (creadoPorUid) q = q.where('creado_por_uid', '==', creadoPorUid);
    const snap = await q.limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Todas las de ciertos estados (p. ej. "activas" de la señal S7), no solo
  // las de la primera página. Sin orderBy: igualdad/in sobre índices simples.
  async listPorEstados(estados, { creadoPorUid = null, limit = 200 } = {}) {
    let q = firebase.firestore().collection('cotizaciones').where('estado', 'in', estados);
    if (creadoPorUid) q = q.where('creado_por_uid', '==', creadoPorUid);
    const snap = await q.limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Borra de Storage un adjunto que se quitó en el editor (auditoría UX
  // 2026-09-28 §4.5 #12). Best-effort: si las reglas de Storage no lo
  // permiten o falla la red, lo recoge el job semanal
  // purgeAdjuntosCotizacionHuerfanos. Solo se llama para archivos subidos en
  // la MISMA sesión del editor y que el documento guardado no nombra: uno ya
  // guardado puede estar en la copia de un Duplicar o en un correo en cola.
  async borrarAdjunto(path) {
    if (!path || !String(path).startsWith('cotizaciones_adjuntos/')) return false;
    try {
      await firebase.storage().ref(path).delete();
      return true;
    } catch (e) {
      console.info('[cotizaciones] el adjunto quedará para la limpieza semanal:', e?.code || e?.message || e);
      return false;
    }
  },

  // Marca la cotización como eliminada (soft delete). El listado oculta por defecto.
  async softDelete(id) {
    const db = firebase.firestore();
    return db.collection('cotizaciones').doc(id).update({
      deleted: true,
      deleted_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Restaura una cotización previamente eliminada.
  async restore(id) {
    const db = firebase.firestore();
    return db.collection('cotizaciones').doc(id).update({
      deleted: false,
      // `delete()` es la API compat; `deleteField()` es del SDK modular y aquí
      // no existe (restore lanzaba TypeError y nadie lo notó porque nadie lo llamaba).
      deleted_at: firebase.firestore.FieldValue.delete(),
    });
  },

  // Copia oculta de supervisión (empresa/config.mail_bcc_cotizacion) para cada
  // cotización que sale al cliente. Best-effort: si la config no carga, el
  // envío sale sin BCC en lugar de fallar.
  async bccSupervision() {
    if (typeof EmpresaService === 'undefined') return null;
    try {
      const cfg = await EmpresaService.getConfig();
      const list = (Array.isArray(cfg.mail_bcc_cotizacion) ? cfg.mail_bcc_cotizacion : []).filter(Boolean);
      return list.length ? list : null;
    } catch (_) { return null; }
  },

  // Encola un correo con la cotización adjunta/embebida. Marca estado=enviada.
  // payload: { to, cc?, subject, html, attachments? }
  // Forma del doc compatible con onMailQueued: campos to/subject/html al top-level.
  async enviarPorCorreo(id, payload) {
    await MailService.enqueue({
      to: payload.to,
      cc: payload.cc || null,
      bcc: await this.bccSupervision(),
      subject: payload.subject,
      html: payload.html,
      attachments: payload.attachments || [],
      // La respuesta del cliente vuelve al firmante (CotState.replyToDe): en
      // el taller "responder el correo" es la aceptación de la reparación.
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
      meta: { tipo: 'cotizacion', cotizacion_id: id },
    });
    return this.updateCotizacion(id, {
      estado: 'enviada',
      enviada_en: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Asegura el mirror público en cotizacion_verificaciones/{docId} con código random.
  // Devuelve { code, url }. Lo escribe/recupera; idempotente.
  async ensureVerificacionPublica(docId, payload = {}) {
    const db = firebase.firestore();
    const ref = db.collection('cotizacion_verificaciones').doc(docId);
    const snap = await ref.get();
    let code;
    if (snap.exists && snap.data()?.code) {
      code = snap.data().code;
    } else {
      // Código corto unguessable (12 chars base36).
      code = Array.from({ length: 2 }, () => Math.random().toString(36).slice(2, 8)).join('');
    }
    const data = {
      cotizacion_id: payload.cotizacion_id || null,
      cliente_nombre: payload.cliente_nombre || null,
      dirigido_a: payload.dirigido_a || null,
      dirigido_email: payload.dirigido_email || null,
      ejecutivo_nombre: payload.ejecutivo_nombre || null,
      creado_por_uid: payload.creado_por_uid || null,
      creado_por_email: payload.creado_por_email || null,
      total: Number(payload.total || 0),
      moneda: payload.moneda || 'USD',
      fecha: payload.fecha || null,
      validezDias: Number(payload.validezDias || 15),
      // Decisión ya resuelta de si el documento público antepone la carta de
      // presentación. Se guarda resuelta (no `origen`) para que la vista pública
      // no tenga que conocer la semántica comercial/taller. Los mirrors creados
      // antes de este campo quedan sin él → la vista los renderiza sin carta.
      lleva_carta: !!payload.lleva_carta,
      // snapshot mínimo necesario para el render público
      snapshot: payload.snapshot || null,
      emisor: payload.emisor || null,
      code,
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(data, { merge: true });
    const base = `${location.origin}/verify/cotizacion.html?id=${encodeURIComponent(docId)}&v=${encodeURIComponent(code)}`;
    return { code, url: base };
  },
};

window.CotizacionesService = CotizacionesService;

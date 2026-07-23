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
      contentType: file.type,
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
    return db.collection('cotizaciones').doc(id).update(fields);
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
  async listCotizaciones({ lastDoc = null, limit = 30 } = {}) {
    const db = firebase.firestore();
    let q = db.collection('cotizaciones')
      .orderBy('fecha_creacion', 'desc')
      .limit(limit);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return { docs, lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1] };
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
      deleted_at: firebase.firestore.FieldValue.deleteField(),
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

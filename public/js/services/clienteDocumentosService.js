/**
 * clienteDocumentosService.js
 * Documentos legales por cliente (registro público, cédula del representante,
 * comprobante de dirección, poderes, etc.).
 *
 * Todos se tratan como PII:
 *  - Storage: clientes_documentos/{clienteId}/{docId}.{ext}, read DENEGADO.
 *  - Firestore: clientes/{clienteId}/documentos/{docId} guarda solo metadata
 *    + storage_path. NUNCA una download URL — verlos pasa por la callable
 *    getClienteDocUrl, que firma una URL efímera.
 *  - Borrado: lógico (deleted:true). El objeto en Storage queda (sin delete
 *    de frontend por reglas); una purga server-side puede limpiarlo después.
 *
 * Desde 2026-11-25 (pedido de Zuleika) el CLIENTE también puede subirlos, sin
 * sesión, desde un enlace (/documentos/?s=…, colección documentos_solicitudes
 * y callable documentosClientePublico). Lo que entra por ahí trae
 * `revision: { estado: 'pendiente' }` y Cobros lo revisa o lo rechaza aquí.
 * Lo que sube el personal no lleva revisión: quien lo sube ya lo vio.
 * Qué se pide y cuándo está completo: js/domain/expedienteCliente.js.
 */

const ClienteDocumentosService = {
  // Tipos soportados. `otro` cubre cualquier documento no catalogado.
  TIPOS: [
    { value: "aviso_operacion",      label: "Aviso de Operación" },
    { value: "registro_publico",     label: "Registro público" },
    { value: "cedula_representante", label: "Cédula del representante legal" },
    { value: "comprobante_direccion",label: "Comprobante de dirección" },
    { value: "poder",                label: "Poder" },
    { value: "otro",                 label: "Otro" },
  ],

  labelFor(tipo) {
    const t = this.TIPOS.find(x => x.value === tipo);
    return t ? t.label : (tipo || "Documento");
  },

  // Lista documentos no eliminados, más recientes primero.
  async list(clienteId) {
    const db = firebase.firestore();
    const snap = await db.collection("clientes").doc(clienteId)
      .collection("documentos")
      .where("deleted", "==", false)
      .get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Orden en cliente para no exigir índice compuesto.
    docs.sort((a, b) => (b.subido_en?.toMillis?.() || 0) - (a.subido_en?.toMillis?.() || 0));
    return docs;
  },

  /**
   * Sube un archivo y crea su doc de metadata.
   * @returns {firebase.storage.UploadTask} para enganchar progreso/errores.
   *          La metadata se escribe en el callback de éxito (onDone).
   */
  upload({ clienteId, tipo, file, onProgress, onDone, onError }) {
    const db = firebase.firestore();
    const storage = firebase.storage();
    const user = firebase.auth().currentUser;

    // Pre-genera el doc para usar su id como nombre de archivo en Storage.
    const docRef = db.collection("clientes").doc(clienteId).collection("documentos").doc();
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `clientes_documentos/${clienteId}/${docRef.id}.${ext}`;

    const task = storage.ref(path).put(file, {
      contentType: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : ''),  // PDF de WhatsApp/escáner llega sin tipo
      customMetadata: { cliente_id: clienteId, doc_id: docRef.id, tipo },
    });

    task.on("state_changed",
      (snap) => {
        if (onProgress) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      (err) => { if (onError) onError(err); },
      async () => {
        try {
          await docRef.set({
            tipo,
            nombre_archivo: file.name,
            storage_path: path,           // NUNCA download URL — es PII
            content_type: file.type || null,
            size: file.size || null,
            subido_por: user?.uid || null,
            subido_en: firebase.firestore.FieldValue.serverTimestamp(),
            deleted: false,
          });
          if (onDone) onDone({ id: docRef.id });
        } catch (err) {
          if (onError) onError(err);
        }
      }
    );

    return task;
  },

  // Borrado lógico de la metadata. El objeto en Storage permanece.
  async softDelete(clienteId, docId) {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    return db.collection("clientes").doc(clienteId)
      .collection("documentos").doc(docId)
      .update({
        deleted: true,
        deleted_at: firebase.firestore.FieldValue.serverTimestamp(),
        deleted_by: uid,
      });
  },

  // ── Revisión de lo que subió el cliente (Cobros) ──────────────────────
  _quien() {
    const u = firebase.auth().currentUser;
    return { por_uid: u?.uid || null, por_email: u?.email || null, at: firebase.firestore.FieldValue.serverTimestamp() };
  },

  // "Lo abrí y sirve": el documento pasa a contar para el expediente.
  async marcarRevisado(clienteId, docId) {
    return firebase.firestore().collection("clientes").doc(clienteId)
      .collection("documentos").doc(docId)
      .update({ revision: { estado: "ok", ...this._quien() } });
  },

  // No se lee o no es el documento: sale del expediente (borrado lógico) con
  // el motivo, y el requisito vuelve a quedar en "falta".
  async rechazar(clienteId, docId, motivo) {
    const q = this._quien();
    return firebase.firestore().collection("clientes").doc(clienteId)
      .collection("documentos").doc(docId)
      .update({
        deleted: true,
        deleted_at: q.at,
        deleted_by: q.por_uid,
        revision: { estado: "rechazado", motivo: String(motivo || "").trim().slice(0, 300), ...q },
      });
  },

  // ── Enlace para que el cliente suba sus documentos ────────────────────
  urlSolicitud(sid) { return `${location.origin}/documentos/?s=${encodeURIComponent(sid)}`; },

  // El enlace vivo de un cliente (pendiente y sin vencer), o null. Dos
  // igualdades: no pide índice compuesto.
  async solicitudVigente(clienteId) {
    const snap = await firebase.firestore().collection("documentos_solicitudes")
      .where("cliente_id", "==", clienteId)
      .where("estado", "==", "pendiente")
      .get();
    const ahora = Date.now();
    const vivas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(x => (x.vence_at?.toMillis?.() || 0) > ahora)
      .sort((a, b) => (b.creado_at?.toMillis?.() || 0) - (a.creado_at?.toMillis?.() || 0));
    return vivas[0] || null;
  },

  // `pide`: ids de ExpedienteCliente.REQUISITOS. Vence a los 30 días.
  async crearSolicitud({ clienteId, clienteNombre, pide }) {
    const u = firebase.auth().currentUser;
    const T = firebase.firestore.Timestamp;
    const dias = window.ExpedienteCliente?.DIAS_ENLACE || 30;
    const ref = await firebase.firestore().collection("documentos_solicitudes").add({
      cliente_id: clienteId,
      cliente_nombre: clienteNombre || "",
      pide: Array.isArray(pide) ? pide : [],
      estado: "pendiente",
      creado_por_uid: u?.uid || null,
      creado_por_email: u?.email || null,
      creado_at: firebase.firestore.FieldValue.serverTimestamp(),
      vence_at: T.fromMillis(Date.now() + dias * 864e5),
    });
    return ref.id;
  },

  async retirarSolicitud(sid) {
    return firebase.firestore().collection("documentos_solicitudes").doc(sid).update({
      estado: "cancelado",
      cancelado_por_uid: firebase.auth().currentUser?.uid || null,
      cancelado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async anotarEnvio(sid, email) {
    return firebase.firestore().collection("documentos_solicitudes").doc(sid).update({
      enviado_a: email,
      enviado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Clientes con contrato vivo (activo o aprobado): la lista de Cobros
  // "expediente incompleto" es de estos, no de todo el directorio. Se pide
  // solo al abrir ese filtro y se guarda 10 minutos (son ~320 lecturas).
  _vivos: null,
  async clientesConContratoVivo() {
    if (this._vivos && Date.now() - this._vivos.at < 10 * 60 * 1000) return this._vivos.set;
    const snap = await firebase.firestore().collection("contratos")
      .where("estado", "in", ["activo", "aprobado"])
      .get();
    const set = new Set();
    snap.forEach(d => { const c = d.data() || {}; if (c.deleted !== true && c.cliente_id) set.add(c.cliente_id); });
    this._vivos = { set, at: Date.now() };
    return set;
  },

  // Pide a la callable una URL firmada efímera (5 min). Lanza si no es viewable.
  async getViewUrl(clienteId, docId) {
    const fn = firebase.functions().httpsCallable("getClienteDocUrl");
    const res = await fn({ clienteId, docId });
    const data = res.data || {};
    if (data.status !== "ok" || !data.url) {
      const motivo = data.status === "deleted" ? "El documento fue eliminado."
        : data.status === "missing" ? "El documento no existe."
        : "No se pudo obtener el documento.";
      throw new Error(motivo);
    }
    return data.url;
  },
};

window.ClienteDocumentosService = ClienteDocumentosService;

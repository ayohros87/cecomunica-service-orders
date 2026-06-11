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
 */

const ClienteDocumentosService = {
  // Tipos soportados. `otro` cubre cualquier documento no catalogado.
  TIPOS: [
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
      contentType: file.type,
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

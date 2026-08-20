// @ts-nocheck
// Firmado upload section — Storage upload of signed contract PDF
//
// Dos modos, porque el archivo firmado se sube UNA vez pero se corrige varias:
//   · 'activacion' — contrato APROBADO: subir el PDF es el acto que lo activa
//     (estado → 'activo' en el mismo write; firestore.rules::esActivacionPorFirmado
//     abre esa transición justo para esta vía).
//   · 'reemplazo'  — contrato YA ACTIVO: se subió el archivo equivocado (p.ej.
//     el contrato sin firmar). Antes esto era un callejón sin salida: el propio
//     upload dejaba el contrato en 'activo' y todos los gates pedían 'aprobado',
//     así que "Reemplazar firmado" no se podía renderizar nunca y no había forma
//     de corregirlo desde la app. Ahora se repunta el archivo SIN tocar estado
//     ni fecha_activacion, y el anterior se archiva en firmado_historial[].
//
// El PDF viejo NO se borra: storage.rules niega delete/update en
// contratos_firmados/ a propósito (es evidencia legal) y el path lleva
// timestamp, así que cada subida es un objeto nuevo. Reemplazar = repuntar
// firmado_url, no borrar el papel anterior.
window.ContratosFirmado = {
  _contratoId: null,
  _modo: null,          // 'activacion' | 'reemplazo'
  _previo: null,        // snapshot del firmado que se está sustituyendo

  async subir(idDocContrato) {
    if (!AUTH.is(ROLES.ADMIN) && !AUTH.is(ROLES.VENDEDOR)) {
      Toast.show('Solo administrador o vendedor pueden subir contratos firmados.', 'bad');
      return;
    }
    const fileEl = document.getElementById('fileFirmado');
    if (!fileEl) {
      Toast.show('No se encontró el input de archivo (#fileFirmado).', 'bad');
      return;
    }

    // La validación va ANTES de abrir el selector: al revés (como estaba) el
    // diálogo se abría y la comprobación resolvía después, así que un usuario
    // rápido podía elegir archivo mientras el guard todavía no había corrido.
    let c;
    try {
      c = await ContratosService.getContrato(idDocContrato);
    } catch (err) {
      console.error(err);
      Toast.show('⚠️ No se pudo validar el estado del contrato.', 'warn');
      return;
    }
    if (!c) { Toast.show('❌ Contrato no encontrado.', 'bad', 5000); return; }

    const yaFirmado = !!c.firmado_url;
    let modo;
    if (c.estado === 'aprobado') {
      modo = 'activacion';
    } else if (c.estado === 'activo') {
      modo = 'reemplazo';
    } else {
      Toast.show('⚠️ Solo se puede subir el firmado a contratos APROBADOS o ACTIVOS.', 'warn', 6000);
      return;
    }

    // Sustituir el papel de un contrato vivo se confirma, y se dice la verdad
    // sobre qué pasa con el archivo anterior (se archiva, no se borra).
    if (modo === 'reemplazo' && yaFirmado) {
      const ok = await Modal.confirm({
        title: 'Reemplazar contrato firmado',
        message: `Vas a sustituir el archivo firmado de ${FMT.esc(c.contrato_id || idDocContrato)}`
          + ` por uno nuevo.<br><br>El archivo actual (<strong>${FMT.esc(c.firmado_nombre || 'sin nombre')}</strong>)`
          + ' queda archivado en el historial del contrato y sigue disponible para auditoría:'
          + ' <strong>no se borra</strong>. El estado y la fecha de activación no cambian.',
        confirmLabel: 'Elegir archivo nuevo'
      });
      if (!ok) return;
    }

    this._contratoId = idDocContrato;
    this._modo = modo;
    this._previo = yaFirmado ? {
      firmado_url:          c.firmado_url || null,
      firmado_nombre:       c.firmado_nombre || null,
      firmado_storage_path: c.firmado_storage_path || null,
      firmado_fecha:        c.firmado_fecha || null,
      firmado_por_uid:      c.firmado_por_uid || null
    } : null;

    fileEl.value = '';
    fileEl.click();
  },

  _limpiar(inputEl) {
    if (inputEl) inputEl.value = '';
    this._contratoId = null;
    this._modo = null;
    this._previo = null;
  },

  async _handleFile(e) {
    const file = e.target.files[0];
    if (!file || !this._contratoId) { this._limpiar(e.target); return; }

    // storage.rules exige application/pdf en contratos_firmados/: sin este
    // guard una foto del contrato fallaba con un error críptico de reglas
    // después de subir.
    const esPdf = file.type === 'application/pdf'
      || (file.name.split('.').pop() || '').toLowerCase() === 'pdf';
    if (!esPdf) {
      Toast.show('El contrato firmado debe ser un PDF.', 'bad', 6000);
      this._limpiar(e.target);
      return;
    }

    const modo   = this._modo;
    const previo = this._previo;
    const storage = firebase.storage();
    try {
      const data = await ContratosService.getContrato(this._contratoId);
      if (!data) throw new Error('Contrato no encontrado.');
      const contratoIdLegible = data?.contrato_id || this._contratoId;

      const ext  = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `contratos_firmados/${contratoIdLegible}_${Date.now()}.${ext}`;

      const uploadTask = storage.ref(path).put(file, {
        contentType: file.type,
        customMetadata: { contrato_doc_id: this._contratoId, contrato_id: contratoIdLegible }
      });

      document.getElementById('uploadStatus').style.display = 'inline';
      uploadTask.on('state_changed',
        (snap) => {
          document.getElementById('uploadPct').textContent =
            Math.round((snap.bytesTransferred / snap.totalBytes) * 100) + '%';
        },
        (err) => {
          console.error(err);
          Toast.show('Error al subir el archivo: ' + err.message, 'bad');
          document.getElementById('uploadStatus').style.display = 'none';
          this._limpiar(e.target);
        },
        async () => {
          // OJO: este callback es async; si el write a Firestore falla (p.ej.
          // reglas), la excepción NO la atrapa el try/catch externo (que ya
          // retornó) y quedaba como unhandled rejection → la barra se congelaba
          // en 100% sin avisar y el botón "Subir firmado" no cambiaba a "Ver".
          // Por eso el guard va AQUÍ, para fallar de forma visible.
          try {
            const url = await uploadTask.snapshot.ref.getDownloadURL();
            const ahora = firebase.firestore.Timestamp.now();
            const uid   = firebase.auth().currentUser?.uid || null;

            const update = {
              firmado: true,
              firmado_url: url,
              firmado_nombre: file.name,
              firmado_storage_path: path,
              firmado_fecha: ahora,
              firmado_por_uid: uid
            };

            if (modo === 'activacion') {
              update.estado_previo = data.estado;
              update.estado = 'activo';
              update.fecha_activacion = ahora;
            } else if (previo) {
              // Reemplazo sobre contrato vivo: NO se toca estado ni
              // fecha_activacion (pisarlos borraba la activación original), y
              // el archivo saliente queda en el historial con quién y cuándo.
              // Timestamp.now() y no serverTimestamp(): arrayUnion no acepta
              // sentinels (ver ARQUITECTURA §5.4).
              update.firmado_historial = firebase.firestore.FieldValue.arrayUnion({
                ...previo,
                reemplazado_at: ahora,
                reemplazado_por_uid: uid,
                reemplazado_por: url
              });
            }

            await ContratosService.updateContrato(this._contratoId, update);
            document.getElementById('uploadStatus').style.display = 'none';
            Toast.show(modo === 'reemplazo'
              ? '✅ Contrato firmado reemplazado. El archivo anterior quedó archivado.'
              : '✅ Contrato firmado subido y guardado.', 'ok');
            this._limpiar(e.target);
            location.reload();
          } catch (err) {
            console.error(err);
            Toast.show('El archivo se subió pero no se pudo guardar el contrato: '
              + (err?.message || err), 'bad', 8000);
            document.getElementById('uploadStatus').style.display = 'none';
            this._limpiar(e.target);
          }
        }
      );
    } catch (err) {
      console.error(err);
      Toast.show('No se pudo procesar el archivo: ' + err.message, 'bad');
      document.getElementById('uploadStatus').style.display = 'none';
      this._limpiar(e.target);
    }
  },

  init() {
    const self = this;
    document.addEventListener('DOMContentLoaded', () => {
      const fi = document.getElementById('fileFirmado');
      if (fi) fi.addEventListener('change', e => self._handleFile(e));
    });
  }
};

ContratosFirmado.init();

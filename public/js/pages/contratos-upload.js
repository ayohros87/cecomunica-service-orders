// @ts-nocheck
// Firmado upload section — Storage upload of signed contract PDF
window.ContratosFirmado = {
  _contratoId: null,

  subir(idDocContrato) {
    if (!AUTH.is(ROLES.ADMIN) && !AUTH.is(ROLES.VENDEDOR)) {
      alert('Solo administrador o vendedor pueden subir contratos firmados.');
      return;
    }
    this._contratoId = idDocContrato;
    const fileEl = document.getElementById('fileFirmado');
    if (!fileEl) {
      alert('No se encontró el input de archivo (#fileFirmado).');
      return;
    }
    fileEl.value = '';
    fileEl.click();

    ContratosService.getContrato(idDocContrato).then(c => {
      if (!c) {
        Toast.show('❌ Contrato no encontrado.', 'bad', 5000);
        this._contratoId = null;
        return;
      }
      if (c.estado !== 'aprobado') {
        Toast.show('⚠️ Solo se pueden subir firmados a contratos APROBADOS.', 'warn');
        this._contratoId = null;
      }
    }).catch(err => {
      console.error(err);
      Toast.show('⚠️ No se pudo validar el estado.', 'warn');
      this._contratoId = null;
    });
  },

  async _handleFile(e) {
    const file = e.target.files[0];
    if (!file || !this._contratoId) { e.target.value = ''; return; }
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
          alert('❌ Error al subir el archivo: ' + err.message);
          document.getElementById('uploadStatus').style.display = 'none';
          e.target.value = '';
          this._contratoId = null;
        },
        async () => {
          const url = await uploadTask.snapshot.ref.getDownloadURL();
          await ContratosService.updateContrato(this._contratoId, {
            firmado: true,
            firmado_url: url,
            firmado_nombre: file.name,
            firmado_storage_path: path,
            firmado_fecha: firebase.firestore.Timestamp.now(),
            firmado_por_uid: firebase.auth().currentUser?.uid || null,
            estado_previo: data.estado,
            estado: 'activo',
            fecha_activacion: firebase.firestore.Timestamp.now()
          });
          document.getElementById('uploadStatus').style.display = 'none';
          Toast.show('✅ Contrato firmado subido y guardado.', 'ok');
          e.target.value = '';
          this._contratoId = null;
          location.reload();
        }
      );
    } catch (err) {
      console.error(err);
      alert('❌ No se pudo procesar el archivo: ' + err.message);
      document.getElementById('uploadStatus').style.display = 'none';
      e.target.value = '';
      this._contratoId = null;
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

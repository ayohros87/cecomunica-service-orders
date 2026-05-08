// @ts-nocheck
// nuevo-contrato preview modal — build, render, open/close, confirm flow
window.NCPreview = {

  buildContratoDraft() {
    const clienteId = document.getElementById('cliente').value;
    const cliente   = NC.listaClientes[clienteId] || {};
    const tipoSel   = document.getElementById('tipo_contrato');
    const tipoNombre = tipoSel.options[tipoSel.selectedIndex]?.text || '';
    const accion     = document.getElementById('accion').value;
    const esRenovacion = accion === 'Renovación';
    const renovacionSinEquipo = esRenovacion && !!document.getElementById('renovacion_sin_equipo')?.checked;
    const renovacionRefurbished = esRenovacion && renovacionSinEquipo
      && !!document.getElementById('renovacion_refurbished_componentes')?.checked;
    const duracionSel   = document.getElementById('duracion').value;
    const otraDuracion  = document.getElementById('otra_duracion').value;
    const duracionFinal = duracionSel === 'Otro' ? `${otraDuracion} meses` : duracionSel;

    const equipos = [...document.querySelectorAll('#tablaEquipos tbody tr')].map(row => {
      const modelo_id = row.querySelector('.modelo').value.trim();
      const modelo    = NC.modelosDisponibles.find(m => m.modelo_id === modelo_id)?.modelo || '';
      const descripcion = (row.querySelector('.descripcion')?.value || '').trim() || 'Equipos de Comunicación';
      const cantidad  = parseInt(row.querySelector('.cantidad').value || 0);
      const precio    = parseFloat(row.querySelector('.precio').value || 0);
      return { modelo_id, modelo, descripcion, cantidad, precio, total: (cantidad || 0) * (precio || 0) };
    });

    const tot = NCForm.recalcularTotalesContrato();
    return {
      cliente_id: clienteId,
      cliente_nombre: cliente?.nombre || '',
      cliente_ruc: cliente?.ruc || '', cliente_dv: cliente?.dv || '',
      cliente_direccion: cliente?.direccion || '', cliente_telefono: cliente?.telefono || '',
      representante: cliente?.representante || '', representante_cedula: cliente?.representante_cedula || '',
      tipo_contrato: tipoNombre, accion,
      renovacion_sin_equipo: renovacionSinEquipo,
      renovacion_refurbished_componentes: renovacionRefurbished,
      renovacion_modalidad: esRenovacion
        ? (renovacionSinEquipo ? 'Renovación sin equipo' : 'Renovación con equipo')
        : '',
      duracion: duracionFinal,
      observaciones: document.getElementById('observaciones').value.trim(),
      equipos,
      subtotal: tot.subtotal, itbms_aplica: tot.itbmsAplica,
      itbms_monto: tot.itbmsMonto, total_con_itbms: tot.totalConITBMS
    };
  },

  renderPreviewHTML(draft) {
    const esc  = NC.escapeHtml;
    const renovacionLabel = draft.accion === 'Renovación'
      ? (draft.renovacion_sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo')
      : '';
    const refurbishedLabel = draft.accion === 'Renovación' && draft.renovacion_sin_equipo
      ? (draft.renovacion_refurbished_componentes ? 'Sí' : 'No')
      : '';

    const eqRows = (draft.equipos || []).map((e, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(e.modelo || '')}</td>
        <td>${esc(e.descripcion || '')}</td>
        <td style="text-align:right;">${Number(e.cantidad || 0)}</td>
        <td style="text-align:right;">$${Number(e.precio || 0).toFixed(2)}</td>
        <td style="text-align:right;">$${Number(e.total || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    return `
      <div class="preview-card">
        <h4>Cliente</h4>
        <div class="preview-grid">
          <div><b>Nombre:</b> ${esc(draft.cliente_nombre || '')}</div>
          <div><b>RUC/DV:</b> ${esc((draft.cliente_ruc || '') + (draft.cliente_dv ? ' - DV' + draft.cliente_dv : ''))}</div>
          <div><b>Dirección:</b> ${esc(draft.cliente_direccion || '')}</div>
          <div><b>Teléfono:</b> ${esc(draft.cliente_telefono || '')}</div>
          <div><b>Representante:</b> ${esc(draft.representante || '')}</div>
          <div><b>Cédula Rep.:</b> ${esc(draft.representante_cedula || '')}</div>
        </div>
      </div>
      <div class="preview-card">
        <h4>Detalles del contrato</h4>
        <div class="preview-grid">
          <div><b>Tipo:</b> ${esc(draft.tipo_contrato || '')}</div>
          <div><b>Acción:</b> ${esc(draft.accion || '')}</div>
          ${renovacionLabel   ? `<div><b>Modalidad renovación:</b> ${esc(renovacionLabel)}</div>` : ''}
          ${refurbishedLabel  ? `<div><b>Refurbished batería/antena/clip/piezas:</b> ${esc(refurbishedLabel)}</div>` : ''}
          <div><b>Duración:</b> ${esc(draft.duracion || '')}</div>
          <div><b>Observaciones:</b> ${esc(draft.observaciones || '-')}</div>
        </div>
      </div>
      <div class="preview-card">
        <h4>Equipos</h4>
        <table class="preview-table">
          <thead><tr><th>#</th><th>Modelo</th><th>Descripción</th><th>Cant</th><th>P.Unit</th><th>Total</th></tr></thead>
          <tbody>${eqRows || "<tr><td colspan='6'>Sin equipos</td></tr>"}</tbody>
        </table>
      </div>
      <div class="preview-card">
        <h4>Totales</h4>
        <div class="preview-totals">
          <table>
            <tr><td>Subtotal</td><td style="text-align:right;">$${Number(draft.subtotal || 0).toFixed(2)}</td></tr>
            <tr><td>ITBMS</td><td style="text-align:right;">$${Number(draft.itbms_monto || 0).toFixed(2)}</td></tr>
            <tr><td><b>Total</b></td><td style="text-align:right;"><b>$${Number(draft.total_con_itbms || 0).toFixed(2)}</b></td></tr>
          </table>
        </div>
        <div class="preview-note">ID del contrato se asigna al guardar.</div>
      </div>
    `;
  },

  open()  { Modal.open('previewOverlay'); },
  close() { Modal.close('previewOverlay'); },

  init() {
    const self = this;

    document.getElementById('formContrato').addEventListener('submit', e => {
      e.preventDefault();
      const clienteId = document.getElementById('cliente').value;
      if (!clienteId) {
        Toast.show('⚠️ Debe seleccionar un cliente antes de crear el contrato.', 'warn');
        document.getElementById('clienteCombo').focus();
        return;
      }
      const filas = [...document.querySelectorAll('#tablaEquipos tbody tr')];
      if (!filas.length) { Toast.show('⚠️ Debe agregar al menos un equipo.', 'warn'); return; }

      NC.previewDraft = self.buildContratoDraft();
      const sub = `${NC.previewDraft.cliente_nombre || ''} · ${NC.previewDraft.tipo_contrato || ''} · ${NC.previewDraft.accion || ''}`;
      document.getElementById('previewSub').textContent  = sub;
      document.getElementById('previewBody').innerHTML   = self.renderPreviewHTML(NC.previewDraft);
      self.open();
    });

    document.getElementById('btnEditPreview').addEventListener('click', () => self.close());
    document.getElementById('btnClosePreview').addEventListener('click', () => self.close());
    document.querySelector('[data-close-preview]').addEventListener('click', () => self.close());
    document.getElementById('previewOverlay').addEventListener('click', e => {
      if (e.target.id === 'previewOverlay') self.close();
    });

    document.getElementById('btnConfirmPreview').addEventListener('click', async () => {
      if (NC.guardando) return;
      NC.guardando = true;
      document.getElementById('btnConfirmPreview').disabled = true;
      document.getElementById('btnGuardar').disabled        = true;
      self.close();
      try {
        await NCGuardar.guardarContratoConfirmado(NC.currentUser);
      } catch (err) {
        console.error(err);
        Toast.show('❌ Error al guardar el contrato.', 'bad');
        document.getElementById('btnConfirmPreview').disabled = false;
        document.getElementById('btnGuardar').disabled        = false;
        NC.guardando = false;
      }
    });
  }
};

NCPreview.init();

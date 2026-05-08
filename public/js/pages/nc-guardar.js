// @ts-nocheck
// nuevo-contrato save flow: data loading, prefill, persist contract
window.NCGuardar = {

  async cargarClientes(limit = 25) {
    const { docs } = await ClientesService.listClientes({ limit });
    NC.listaClientes = {};
    const items = [];
    docs.forEach(c => { NC.listaClientes[c.id] = c; items.push({ id: c.id, d: c }); });
    NCCombo.renderCombo(items);
  },

  async cargarModelos() {
    const raw = await ModelosService.getModelos();
    raw.sort((a, b) => (a.modelo || '').localeCompare(b.modelo || ''));
    NC.modelosDisponibles = raw.map(m => ({ modelo_id: m.id, modelo: m.modelo }));
  },

  async applyPrefillFromDuplicate() {
    const raw = sessionStorage.getItem('contrato_prefill');
    if (!raw) return;
    let draft;
    try { draft = JSON.parse(raw); } catch { sessionStorage.removeItem('contrato_prefill'); return; }

    const params        = new URLSearchParams(window.location.search);
    const yaTraeCliente = !!params.get('cliente_id');
    if (!yaTraeCliente && draft.cliente_id) {
      const c = await ClientesService.getCliente(draft.cliente_id);
      if (c) { NC.listaClientes[draft.cliente_id] = c; NCCombo.selectCliente(draft.cliente_id, true); }
    }

    if (draft.codigo_tipo) document.getElementById('tipo_contrato').value = draft.codigo_tipo;
    if (draft.accion)      document.getElementById('accion').value        = draft.accion;
    NCForm.syncAccionForTipoContrato();

    const cbRenov = document.getElementById('renovacion_sin_equipo');
    if (cbRenov) {
      cbRenov.checked = draft.renovacion_sin_equipo === true
        || String(draft.renovacion_modalidad || '').toLowerCase().includes('sin equipo');
    }
    const cbRefurb = document.getElementById('renovacion_refurbished_componentes');
    if (cbRefurb) cbRefurb.checked = !!draft.renovacion_refurbished_componentes;
    NCForm.refreshRenovacionModeUI();

    if (draft.duracion) {
      const sel = document.getElementById('duracion');
      const val = String(draft.duracion).toLowerCase();
      if (val.includes('12'))      { sel.value = '12 meses'; NCForm.toggleOtraDuracion('12 meses'); }
      else if (val.includes('18')) { sel.value = '18 meses'; NCForm.toggleOtraDuracion('18 meses'); }
      else {
        sel.value = 'Otro'; NCForm.toggleOtraDuracion('Otro');
        const meses = parseInt(val.replace(/\D+/g, ''), 10);
        if (!isNaN(meses) && meses > 0) document.getElementById('otra_duracion').value = meses;
      }
    }

    if (typeof draft.observaciones === 'string') document.getElementById('observaciones').value = draft.observaciones;

    if (Array.isArray(draft.equipos) && draft.equipos.length) {
      document.querySelector('#tablaEquipos tbody').innerHTML = '';
      for (const e of draft.equipos) {
        NCForm.agregarFilaEquipo();
        const row = document.querySelector('#tablaEquipos tbody').lastElementChild;
        let modeloId = e.modelo_id;
        if (!modeloId && e.modelo) {
          const found = NC.modelosDisponibles.find(m =>
            (m.modelo || '').trim().toLowerCase() === String(e.modelo).trim().toLowerCase()
          );
          if (found) modeloId = found.modelo_id;
        }
        if (modeloId) row.querySelector('.modelo').value = modeloId;
        row.querySelector('.descripcion').value = e.descripcion || 'Equipos de Comunicación';
        row.querySelector('.cantidad').value    = Number(e.cantidad || 0);
        row.querySelector('.precio').value      = Number(e.precio || 0).toFixed(2);
      }
      NCForm.calcularTotal();
    }

    sessionStorage.removeItem('contrato_prefill');
  },

  async guardarContratoConfirmado(user) {
    const clienteId = document.getElementById('cliente').value;
    if (!clienteId) {
      Toast.show('⚠️ Debe seleccionar un cliente antes de crear el contrato.', 'warn');
      document.getElementById('clienteCombo').focus();
      return;
    }

    const tipoSel    = document.getElementById('tipo_contrato');
    const tipoCorto  = tipoSel.value;
    const tipoNombre = tipoSel.options[tipoSel.selectedIndex].text;
    const accion     = document.getElementById('accion').value;
    const esRenov    = accion === 'Renovación';
    const sinEquipo  = esRenov && !!document.getElementById('renovacion_sin_equipo')?.checked;
    const refurb     = esRenov && sinEquipo && !!document.getElementById('renovacion_refurbished_componentes')?.checked;
    const hoy        = new Date();
    const fechaStr   = hoy.toISOString().slice(0, 10).replace(/-/g, '');
    const inicio     = new Date(fechaStr.slice(0,4), fechaStr.slice(4,6)-1, fechaStr.slice(6,8));
    const fin        = new Date(inicio); fin.setDate(fin.getDate() + 1);

    const count      = await ContratosService.contarPorTipoYFecha(tipoCorto, inicio, fin);
    const contrato_id = tipoCorto + fechaStr + '-' + String(count + 1).padStart(2, '0');

    const equipos = [...document.querySelectorAll('#tablaEquipos tbody tr')].map(row => {
      const modelo_id  = row.querySelector('.modelo').value.trim();
      const modelo     = NC.modelosDisponibles.find(m => m.modelo_id === modelo_id)?.modelo || '';
      const descripcion = (row.querySelector('.descripcion')?.value || '').trim() || 'Equipos de Comunicación';
      return { modelo_id, modelo, descripcion,
               cantidad: parseInt(row.querySelector('.cantidad').value || 0),
               precio: parseFloat(row.querySelector('.precio').value || 0) };
    });

    const clienteData     = NC.listaClientes[clienteId];
    const duracionSel     = document.getElementById('duracion').value;
    const otraDuracion    = document.getElementById('otra_duracion').value;
    const duracionFinal   = duracionSel === 'Otro' ? `${otraDuracion} meses` : duracionSel;
    const tot             = NCForm.recalcularTotalesContrato();
    const total_equipos   = equipos.reduce((acc, e) => acc + Number(e.cantidad || 0), 0);

    const contrato = {
      contrato_id,
      cliente_id: clienteId,
      cliente_nombre: clienteData?.nombre || '',
      cliente_nombre_lower: (clienteData?.nombre || '').toLowerCase(),
      cliente_direccion: clienteData?.direccion || '',
      cliente_telefono: clienteData?.telefono || '',
      cliente_ruc: clienteData?.ruc || '',
      cliente_dv: clienteData?.dv || '',
      cliente_rucdv: (clienteData?.ruc || '') + (clienteData?.dv ? ' - DV' + clienteData.dv : ''),
      representante: clienteData?.representante || '',
      representante_cedula: clienteData?.representante_cedula || '',
      duracion: duracionFinal,
      codigo_tipo: tipoCorto,
      tipo_contrato: tipoNombre,
      accion,
      renovacion_sin_equipo: sinEquipo,
      renovacion_refurbished_componentes: refurb,
      renovacion_modalidad: esRenov ? (sinEquipo ? 'Renovación sin equipo' : 'Renovación con equipo') : '',
      estado: 'pendiente_aprobacion',
      observaciones: document.getElementById('observaciones').value.trim(),
      equipos,
      total_equipos,
      subtotal: tot.subtotal,
      itbms_aplica: tot.itbmsAplica,
      itbms_porcentaje: FMT.ITBMS_RATE,
      itbms_monto: FMT.round2(tot.itbmsMonto),
      total_con_itbms: FMT.round2(tot.totalConITBMS),
      total: tot.subtotal,
      fecha_creacion: new Date(),
      fecha_modificacion: new Date(),
      deleted: false,
      creado_por_uid: user.uid
    };

    const docRef = await ContratosService.addContrato(contrato);

    try {
      const equiposHtml    = contrato.equipos.map(e =>
        `<li>${e.modelo} – ${e.cantidad} × $${Number(e.precio || 0).toFixed(2)}</li>`
      ).join('');
      const renovacionBanner = contrato.accion === 'Renovación'
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? 'RENOVACIÓN SIN EQUIPO' : 'RENOVACIÓN CON EQUIPO'}</div>`
        : '';
      const obsEsc = (contrato.observaciones || '-').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));

      await MailService.enqueue({
        to: 'ventas@cecomunica.com',
        cc: firebase.auth().currentUser?.email || null,
        subject: `Nuevo contrato creado: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
        preheader: `Contrato pendiente de aprobación: ${contrato.cliente_nombre}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Nuevo contrato creado</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Se ha registrado un nuevo contrato con el ID <b>${contrato.contrato_id}</b>.
          </p>
          ${renovacionBanner}
          <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.cliente_nombre}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.tipo_contrato}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.accion}</td></tr>
            ${contrato.accion === 'Renovación' ? `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? 'Sin equipo' : 'Con equipo'}</td></tr>` : ''}
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Duración</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.duracion || '-'}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${obsEsc}</td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">$${Number(contrato.total_con_itbms || 0).toFixed(2)}</td></tr>
          </table>
          ${equiposHtml ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Equipos</h4><ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${equiposHtml}</ul>` : ''}
        `,
        ctaUrl: `${location.origin}/contratos/index.html?aprobar=${docRef.id}`,
        ctaLabel: 'Revisar contrato',
        meta: {
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          created_by: user.uid,
          source: 'nuevo-contrato'
        },
        status: 'queued'
      });

      Toast.show('✅ Contrato guardado. Enviaremos el correo a ventas@cecomunica.com en segundo plano…', 'ok');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
    } catch (e) {
      console.warn('No se pudo encolar el correo:', e);
      Toast.show('⚠️ Contrato guardado, pero no se pudo encolar el correo.', 'warn');
      setTimeout(() => { window.location.href = 'index.html'; }, 1800);
    }
  }
};

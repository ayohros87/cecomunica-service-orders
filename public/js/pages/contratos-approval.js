// @ts-nocheck
// Approval overlay section — open/review/confirm contract approval
window.ContratosAprobacion = {
  _pendiente:   null,   // contract doc being reviewed
  _pendienteId: null,   // Firestore doc id of contract being reviewed
  _boundKeydown: null,

  async abrir(id) {
    console.log('>>> [UI] Abrir overlay / buscar contrato en Firestore. doc.id =', id);
    this._pendiente = await ContratosService.getContrato(id);
    if (!this._pendiente) {
      console.error('>>> [UI] Contrato no encontrado en Firestore. doc.id =', id);
      Toast.show('Contrato no encontrado', 'bad'); return;
    }
    this._pendienteId = id;

    const c = this._pendiente;
    const esRenovacion = c.accion === 'Renovación';
    const esRenovacionSinEquipo = esRenovacion && !!c.renovacion_sin_equipo;
    const renovacionModalidadTexto = esRenovacion
      ? (esRenovacionSinEquipo ? 'Renovación sin equipo' : 'Renovación con equipo')
      : 'No aplica';
    const refurbishedTexto = esRenovacionSinEquipo
      ? (c.renovacion_refurbished_componentes ? 'Sí, incluye refurbished de batería, antena, clip y piezas' : 'No incluye refurbished')
      : 'No aplica';

    let elaborador = '-';
    if (c.creado_por_uid) {
      elaborador = CS.mapaUsuarios[c.creado_por_uid] || '-';
      if (elaborador === '-') {
        try {
          const u = await UsuariosService.getUsuario(c.creado_por_uid);
          if (u) {
            elaborador = u.nombre || u.email || c.creado_por_uid;
            CS.mapaUsuarios[c.creado_por_uid] = elaborador;
          }
        } catch (e) {
          console.warn('No se pudo resolver elaborador para modal de aprobación', e);
        }
      }
    }

    const tot = ContractTotals.fromDoc(c);
    const esc = CS.esc.bind(CS);

    document.getElementById('detallesContrato').innerHTML = `
      <p><strong>Contrato ID:</strong> ${esc(c.contrato_id)}</p>
      <p><strong>Cliente:</strong> ${esc(c.cliente_nombre)}</p>
      <p><strong>Elaborador:</strong> ${esc(elaborador)}</p>
      <p><strong>Tipo:</strong> ${esc(c.tipo_contrato)}</p>
      <p><strong>Acción:</strong> ${esc(c.accion)}</p>
      <p><strong>Modalidad renovación:</strong> ${esc(renovacionModalidadTexto)}</p>
      <p><strong>Refurbished batería/antena/clip/piezas:</strong> ${esc(refurbishedTexto)}</p>
      <p><strong>Observaciones:</strong> ${esc(c.observaciones || '-')}</p>
      <div style="margin-top:8px; padding:8px; border:1px dashed var(--line); border-radius:8px; max-width:420px;">
        <div style="display:flex; justify-content:space-between;"><span>Subtotal${tot.tieneCargos ? ' equipos' : ''}</span><strong>${FMT.money(tot.equiposSub)}</strong></div>
        ${tot.cargosRecurrente > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Otros conceptos (mensual)</span><strong>${FMT.money(tot.cargosRecurrente)}</strong></div>` : ''}
        <div style="display:flex; justify-content:space-between;"><span>${tot.itbmsLabel}</span><strong>${FMT.money(tot.itbmsMonto)}</strong></div>
        <div style="border-top:1px solid var(--line); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between;">
          <span>Total${tot.tieneCargos ? ' mensual' : ''}</span><strong>${FMT.money(tot.totalConITBMS)}</strong>
        </div>
        ${tot.tieneCargosUnicos ? `
        <div style="display:flex; justify-content:space-between; margin-top:6px;"><span>Otros conceptos (único)</span><strong>${FMT.money(tot.cargosUnico)}</strong></div>
        <div style="display:flex; justify-content:space-between;"><span><b>Primer pago (inicial)</b></span><strong>${FMT.money(tot.primerPago)}</strong></div>` : ''}
      </div>
      ${tot.tieneCargos ? `
      <div style="margin-top:8px; max-width:420px;">
        <p style="margin:0 0 4px; font-weight:600; font-size:13px;">Otros conceptos</p>
        ${(tot.cargos || []).map(cg => `<div style="display:flex; justify-content:space-between; font-size:13px;"><span>${esc(cg.concepto || '')} ${cg.recurrente ? '(mensual)' : '(único)'}</span><span>${FMT.money(Number(cg.monto) || 0)}</span></div>`).join('')}
      </div>` : ''}
    `;

    const tbody = document.getElementById('tablaEquiposAprobacion');
    tbody.innerHTML = '';
    (c.equipos || []).forEach(eq => {
      const fila = document.createElement('tr');
      const subtotal = (eq.cantidad || 0) * (eq.precio || 0);
      fila.innerHTML = `
        <td style="border:1px solid #ccc; padding:6px;">${esc(eq.modelo || '')}</td>
        <td style="border:1px solid #ccc; padding:6px;">${Number(eq.cantidad || 0)}</td>
        <td style="border:1px solid #ccc; padding:6px;">$${Number(eq.precio || 0).toFixed(2)}</td>
        <td style="border:1px solid #ccc; padding:6px;">$${subtotal.toFixed(2)}</td>
      `;
      tbody.appendChild(fila);
    });

    this.abrirOverlay();
  },

  cancelar() {
    this._pendienteId = null;
    this._pendiente   = null;
    this.cerrarOverlay();
  },

  async confirmar() {
    if (!this._pendienteId) { Toast.show('No hay contrato seleccionado para aprobar.', 'bad'); return; }
    const btn = document.querySelector('#overlayAprobacion .btn-accent');
    if (btn) btn.disabled = true;
    try {
      const c = await ContratosService.getContrato(this._pendienteId);
      if (!c) { Toast.show('Contrato no encontrado.', 'bad'); return; }
      if (c.estado === 'anulado') { Toast.show("Este contrato fue ANULADO y no puede aprobarse.", 'bad'); return; }
      if (c.estado !== 'pendiente_aprobacion') { Toast.show("Solo se pueden aprobar contratos en 'Pendiente Aprobación'.", 'bad'); return; }

      await ContratosService.updateContrato(this._pendienteId, {
        estado: 'aprobado',
        fecha_aprobacion: firebase.firestore.Timestamp.now(),
        aprobado_por_uid: firebase.auth().currentUser?.uid || null
      });

      this.cerrarOverlay();
      Toast.show('✅ Contrato aprobado. Enviando PDF por correo en segundo plano…', 'ok');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo aprobar el contrato.', 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  abrirOverlay() {
    const ov    = document.getElementById('overlayAprobacion');
    const sheet = document.getElementById('sheetAprobacion');
    if (!ov || !sheet) return;
    Modal.open('overlayAprobacion', { onEscape: false });
    this._boundKeydown = (e) => { if (e.key === 'Escape') this.cerrarOverlay(); };
    document.addEventListener('keydown', this._boundKeydown);
    const first = ov.querySelector('.btn-accent') || ov.querySelector('button,[href],input,select,textarea');
    if (first) setTimeout(() => first.focus(), 0);
    this._initSwipeClose(sheet);
  },

  cerrarOverlay() {
    Modal.close('overlayAprobacion');
    if (this._boundKeydown) {
      document.removeEventListener('keydown', this._boundKeydown);
      this._boundKeydown = null;
    }
    const sheet = document.getElementById('sheetAprobacion');
    if (sheet) sheet.style.transform = 'translateY(0)';
  },

  _initSwipeClose(el) {
    if (el.__swipeBound) return;
    let startY = 0, dy = 0, dragging = false;
    const self = this;
    const onStart = e => { const t = e.touches ? e.touches[0] : e; startY = t.clientY; dy = 0; dragging = true; el.style.transition = 'none'; };
    const onMove  = e => { if (!dragging) return; const t = e.touches ? e.touches[0] : e; dy = t.clientY - startY; if (dy > 0) el.style.transform = `translateY(${dy}px)`; };
    const onEnd   = () => { if (!dragging) return; dragging = false; el.style.transition = 'transform .18s ease'; if (dy > 90) { self.cerrarOverlay(); } else { el.style.transform = 'translateY(0)'; } };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: true });
    el.addEventListener('touchend',   onEnd);
    el.__swipeBound = true;
  }
};

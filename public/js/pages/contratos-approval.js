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

    // Vínculo al/los contratos originales (renovación/adición/reemplazo) —
    // mismos fallbacks de compat que contrato-transicion-page.
    const origenIds = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length)
      ? c.contrato_origen_ids
      : (c.contrato_origen_id ? [c.contrato_origen_id] : []);
    const origenRefs = (Array.isArray(c.contrato_origen_refs) && c.contrato_origen_refs.length)
      ? c.contrato_origen_refs
      : (c.contrato_origen_id ? [c.contrato_origen_ref || c.contrato_origen_id] : []);
    const bajas = Number(c.baja_cancelado_total || 0);

    document.getElementById('detallesContrato').innerHTML = `
      <p><strong>Contrato ID:</strong> ${esc(c.contrato_id)}</p>
      <p><strong>Cliente:</strong> ${esc(c.cliente_nombre)}</p>
      <p><strong>Elaborador:</strong> ${esc(elaborador)}</p>
      <p><strong>Tipo:</strong> ${esc(c.tipo_contrato)}</p>
      <p><strong>Acción:</strong> ${esc(c.accion)}</p>
      <p><strong>Duración:</strong> ${esc(c.duracion || '-')}</p>
      <p><strong>Modalidad renovación:</strong> ${esc(renovacionModalidadTexto)}</p>
      <p><strong>Refurbished batería/antena/clip/piezas:</strong> ${esc(refurbishedTexto)}</p>
      ${origenRefs.length ? `<p><strong>Contrato(s) origen:</strong> ${origenRefs.map(esc).join(', ')}</p>` : ''}
      ${bajas > 0 ? `<p><strong>Unidades dadas de baja:</strong> ${bajas} (se descuentan al pedir seriales)</p>` : ''}
      <p><strong>Observaciones:</strong> ${esc(c.observaciones || '-')}</p>
      <div style="margin-top:8px; padding:8px; border:1px dashed var(--line); border-radius:8px; max-width:420px;">
        <div style="display:flex; justify-content:space-between;"><span>Subtotal${tot.tieneCargos ? ' equipos' : ''}</span><strong>${FMT.money(tot.equiposSub)}</strong></div>
        ${tot.cargosRecurrente > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Servicios y otros (mensual)</span><strong>${FMT.money(tot.cargosRecurrente)}</strong></div>` : ''}
        <div style="display:flex; justify-content:space-between;"><span>${tot.itbmsLabel}</span><strong>${FMT.money(tot.itbmsMonto)}</strong></div>
        <div style="border-top:1px solid var(--line); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between;">
          <span>Total${tot.tieneCargos ? ' mensual' : ''}</span><strong>${FMT.money(tot.totalConITBMS)}</strong>
        </div>
        ${tot.tieneCargosUnicos ? `
        <div style="display:flex; justify-content:space-between; margin-top:6px;"><span>Servicios y otros (único)</span><strong>${FMT.money(tot.cargosUnico)}</strong></div>
        ${tot.itbmsUnico > 0 ? `<div style="display:flex; justify-content:space-between;"><span>ITBMS (único)</span><strong>${FMT.money(tot.itbmsUnico)}</strong></div>` : ''}
        <div style="display:flex; justify-content:space-between;"><span><b>Primer pago (inicial)</b></span><strong>${FMT.money(tot.primerPago)}</strong></div>` : ''}
      </div>
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

    // Servicios y otros cargos — línea por línea (la caja de totales solo
    // trae el agregado; aquí el aprobador ve QUÉ servicios se están cobrando).
    const fsCargos    = document.getElementById('fieldsetCargosAprobacion');
    const tbodyCargos = document.getElementById('tablaCargosAprobacion');
    const cargos = Array.isArray(c.cargos) ? c.cargos : [];
    if (fsCargos && tbodyCargos) {
      fsCargos.style.display = cargos.length ? '' : 'none';
      tbodyCargos.innerHTML = cargos.map(g => {
        const cant  = Math.max(1, Math.round(Number(g.cantidad)) || 1);
        const monto = Number(g.monto) || 0;
        return `
          <tr>
            <td style="border:1px solid #ccc; padding:6px;">${esc(g.concepto || '—')}</td>
            <td style="border:1px solid #ccc; padding:6px;">${cant}</td>
            <td style="border:1px solid #ccc; padding:6px;">${FMT.money(monto)}</td>
            <td style="border:1px solid #ccc; padding:6px;">${g.recurrente ? 'Mensual' : 'Único'}</td>
            <td style="border:1px solid #ccc; padding:6px;">${FMT.money(cant * monto)}</td>
          </tr>`;
      }).join('');
    }

    // Transición de equipos: solo aplica con equipos de por medio — renovación
    // con equipo, tipo REEMP, o adición vinculada a un original. Los seriales
    // ENTRANTES aún no existen (aprobar es lo que los pide a inventario); lo
    // mostrable son los SALIENTES que el cliente ya tiene en el pool.
    const fsTrans = document.getElementById('fieldsetTransicionAprobacion');
    const aplicaTransicion = (esRenovacion && !esRenovacionSinEquipo)
      || c.tipo_contrato === 'REEMP'
      || (c.accion === 'Adición' && origenIds.length > 0);
    if (fsTrans) {
      fsTrans.style.display = aplicaTransicion ? '' : 'none';
      if (aplicaTransicion) {
        const cont = document.getElementById('transicionAprobacion');
        if (cont) cont.innerHTML = '<span style="color:var(--fg-3);">Cargando equipos del cliente…</span>';
        // Fire-and-forget: el modal abre ya; el bloque se rellena al llegar el pool.
        this._cargarTransicion(c, id, { origenIds, origenRefs });
      }
    }

    this.abrirOverlay();
  },

  // Rellena el bloque "Transición de equipos" del modal. Mismos criterios de
  // carga que contrato-transicion-page: salientes anclados al/los originales
  // si hay vínculo; sin vínculo (o legacy/papel), todos los del cliente.
  async _cargarTransicion(c, id, { origenIds, origenRefs }) {
    const cont = document.getElementById('transicionAprobacion');
    if (!cont) return;
    const esc = CS.esc.bind(CS);
    try {
      let unidades = [];
      if (origenIds.length) {
        const listas = await Promise.all(origenIds.map(oid => EquiposPoolService.listarPorContrato(oid)));
        const vistos = new Set();
        unidades = listas.flat().filter(u => !vistos.has(u.id) && vistos.add(u.id));
      } else {
        unidades = await EquiposPoolService.listarPorCliente(c.cliente_id);
      }
      if (this._pendienteId !== id) return; // el modal cambió de contrato o se cerró

      const salientes = unidades.filter(u =>
        (u.estado === EquiposPoolService.ESTADOS.ASIGNADO || u.estado === EquiposPoolService.ESTADOS.EN_CLIENTE)
        && u.asignacion?.contrato_doc_id !== id);
      const alquiler = salientes.filter(u => u.propiedad !== 'cliente');
      const propios  = salientes.filter(u => u.propiedad === 'cliente');

      // Comparativa mensual origen vs nuevo — el delta económico es lo que se
      // aprueba en una renovación. Best-effort: si falla, el bloque sale igual.
      let mensualOrigen = null;
      if (origenIds.length) {
        try {
          const docs = await Promise.all(origenIds.map(oid => ContratosService.getContrato(oid)));
          const validos = docs.filter(Boolean);
          if (validos.length) {
            mensualOrigen = FMT.round2(validos.reduce((s, o) => s + ContractTotals.fromDoc(o).totalMensual, 0));
          }
        } catch (e) { /* comparativa opcional */ }
        if (this._pendienteId !== id) return;
      }

      const totalUnidades = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
      const entrantes = Math.max(0, totalUnidades - Number(c.baja_cancelado_total || 0));

      const ancla = origenRefs.length
        ? `Vinculado a ${origenRefs.length > 1 ? 'los contratos originales' : 'el contrato original'} <b>${origenRefs.map(esc).join('</b>, <b>')}</b>.`
        : (c.origen_tipo === 'legacy'
            ? `Contrato original en papel${c.origen_legacy_ref ? ` (<b>${esc(c.origen_legacy_ref)}</b>)` : ''} — se listan todos los equipos del cliente en el pool.`
            : `<span style="color:#92400e;"><b>Sin contrato original vinculado</b> — se listan todos los equipos del cliente en el pool. Si aplica, vincúlalo en la página de Transición tras aprobar.</span>`);

      const filasAlquiler = alquiler.length ? alquiler.map(u => `
        <tr>
          <td style="border:1px solid #ccc; padding:6px; font-family:var(--font-mono,monospace);">
            <a class="eq-link" href="${EquiposPoolService.kardexUrl(u.serial || u.serial_norm)}" target="_blank" rel="noopener">${esc(u.serial || u.serial_norm)}</a>
          </td>
          <td style="border:1px solid #ccc; padding:6px;">${esc(u.modelo_label || '—')}</td>
          <td style="border:1px solid #ccc; padding:6px;">${EquiposPoolService.chipEstadoHtml(u.estado)} ${EquiposPoolService.chipPendienteDevolucionHtml(u)}</td>
        </tr>`).join('')
        : `<tr><td colspan="3" style="border:1px solid #ccc; padding:8px; color:var(--fg-3);">El cliente no tiene equipos de alquiler en el pool${origenRefs.length ? ' para ese origen' : ''}.</td></tr>`;

      const delta = mensualOrigen != null ? FMT.round2(ContractTotals.fromDoc(c).totalMensual - mensualOrigen) : null;

      cont.innerHTML = `
        <p style="margin:0 0 8px;">${ancla}</p>
        <p style="margin:0 0 8px;">
          Entran <b>${entrantes}</b> unidad(es) nueva(s) · el cliente tiene <b>${alquiler.length}</b> en alquiler
          que deberán devolverse${propios.length ? ` · <b>${propios.length}</b> propia(s) del cliente (no se devuelven)` : ''}.
          Los seriales entrantes los asigna inventario <b>después de aprobar</b>; la devolución se registra en la página de Transición.
        </p>
        ${mensualOrigen != null ? `
        <p style="margin:0 0 8px;">
          Mensual actual (origen): <b>${FMT.money(mensualOrigen)}</b> → nuevo: <b>${FMT.money(ContractTotals.fromDoc(c).totalMensual)}</b>
          (${delta >= 0 ? '+' : '−'}${FMT.money(Math.abs(delta))})
        </p>` : ''}
        <div class="table-scroll">
          <table class="app-table" style="font-size:13px; min-width:420px;">
            <thead><tr><th>Serial</th><th>Modelo</th><th>Estado</th></tr></thead>
            <tbody>${filasAlquiler}</tbody>
          </table>
        </div>
        ${propios.length ? `
        <div style="margin-top:8px;">
          <div style="font-weight:600; margin-bottom:4px;">Propios del cliente (no se devuelven)</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${propios.map(u => `<span class="eqpool-chip" title="${esc(u.modelo_label || '')}">${esc(u.serial || u.serial_norm)}</span>`).join('')}
          </div>
        </div>` : ''}`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.warn('No se pudo cargar la transición para el modal de aprobación', e);
      if (this._pendienteId === id) {
        cont.innerHTML = '<span style="color:var(--fg-3);">No se pudieron cargar los equipos del cliente. La transición se gestiona tras aprobar, en la página de Transición.</span>';
      }
    }
  },

  cancelar() {
    this._pendienteId = null;
    this._pendiente   = null;
    this.cerrarOverlay();
  },

  async confirmar() {
    if (!this._pendienteId) { Toast.show('No hay contrato seleccionado para aprobar.', 'bad'); return; }
    const btn = document.querySelector('#overlayAprobacion .btn-primary');
    const btnHtmlOriginal = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader"></i> Aprobando…';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
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

      // Mismo criterio que onContratoAprobadoSolicitaSeriales: con unidades
      // serializables se piden seriales a inventario; sin ellas (o renovación
      // sin equipo) el contrato va directo a activaciones.
      const totalUnidades = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
      const unidades = Math.max(0, totalUnidades - Number(c.baja_cancelado_total || 0));
      const sinSeriales = unidades <= 0 || (c.accion === 'Renovación' && !!c.renovacion_sin_equipo);

      this.cancelar();
      Toast.show(sinSeriales
        ? '✅ Contrato aprobado. Se enviará a activaciones (sin seriales que asignar).'
        : '✅ Contrato aprobado. Se pidió a inventario asignar los seriales por correo.', 'ok');

      // Refresca la lista en sitio (sin recargar la página): cargar(true)
      // vuelve a consultar con los filtros activos y hace el swap de la tabla
      // sin pantallazo en blanco.
      await ContratosLista.cargar(true);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo aprobar el contrato.', 'bad');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btnHtmlOriginal;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  },

  abrirOverlay() {
    const ov    = document.getElementById('overlayAprobacion');
    const sheet = document.getElementById('sheetAprobacion');
    if (!ov || !sheet) return;
    Modal.open('overlayAprobacion', { onEscape: false });
    this._boundKeydown = (e) => { if (e.key === 'Escape') this.cerrarOverlay(); };
    document.addEventListener('keydown', this._boundKeydown);
    const first = ov.querySelector('.btn-primary') || ov.querySelector('button,[href],input,select,textarea');
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

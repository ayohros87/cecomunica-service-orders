// @ts-nocheck
// Check-in de órdenes de DEVOLUCIÓN — el tiquete de recuperar equipos que
// siguen con el cliente (renovación/baja) o de confirmar una anulación
// (¿los equipos salieron del taller o nunca?). Cada unidad esperada se
// resuelve con una de tres acciones:
//   Recibido      → el backend (onOrdenDevolucionWrite) la manda a cuarentena;
//                   al cerrar la orden se crea sola la ENTRADA de inspección.
//   Nunca salió   → (solo modo confirmación) vuelve a bodega directo.
//   No se devuelve→ excepción justificada (motivo obligatorio).
// Las resoluciones son definitivas (el pool se mueve al instante); un error
// se corrige desde Inventario · Equipos por serial.
(function () {
  'use strict';

  const MOTIVOS = [
    ['parcial', 'Renovación parcial — sigue en servicio'],
    ['vendido', 'Se vendió al cliente'],
    ['perdido', 'Perdido — pendiente de cobro'],
    ['otro',    'Otro (detallar)'],
  ];
  const RES_LABEL = {
    recibido: '<span class="chip-estado chip-aprobada">Recibido</span>',
    nunca_salio: '<span class="chip-estado chip-entregada">Nunca salió</span>',
    no_devuelve: '<span class="chip-estado chip-espera">No se devuelve</span>',
  };
  const esc = (v) => window.FMT ? FMT.esc(String(v ?? '')) : String(v ?? '');

  let _orden = null;      // copia fresca del doc
  let _ordenId = null;
  let _overlay = null;

  function puedeOperar() {
    const rol = window.APP?.state?.userRole || '';
    return [ROLES.ADMIN, ROLES.RECEPCION, ROLES.JEFE_TALLER, ROLES.VENDEDOR, ROLES.TECNICO].includes(rol);
  }

  async function abrir(ordenId) {
    _ordenId = ordenId;
    try {
      _orden = await OrdenesService.getOrder(ordenId);
    } catch (e) { Toast.show('No se pudo cargar la orden.', 'bad'); return; }
    if (!_orden || !_orden.devolucion) { Toast.show('La orden no tiene datos de devolución.', 'bad'); return; }
    render();
  }

  function cerrarModal() {
    _overlay?.remove();
    _overlay = null;
    // Refresca la fila en la lista si la página de órdenes está montada.
    if (typeof window.cargarOrdenes === 'function') { try { window.cargarOrdenes(true); } catch (e) {} }
  }

  function render() {
    const dev = _orden.devolucion || {};
    const esperados = dev.esperados || [];
    const porModelo = dev.esperados_por_modelo || [];
    const cerrada = (_orden.estado_reparacion || '').toUpperCase() === 'CERRADA (DEVOLUCION)';
    const editable = !cerrada && puedeOperar();
    const esConfirmacion = dev.modo === 'confirmacion';

    const pendientes = esperados.filter(e => !e.resolucion).length;
    const modelosPend = porModelo.reduce((s, m) => s + Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)), 0);

    const intro = esConfirmacion
      ? 'Anulación de contrato: lo usual es que los equipos <b>nunca hayan salido</b>. Confirma unidad por unidad — <b>Nunca salió</b> los regresa a bodega directo; <b>Recibido</b> los manda a inspección.'
      : 'Estos equipos están <b>con el cliente</b>. Marca <b>Recibido</b> cuando cada unidad llegue físicamente — cada tanda recibida alimenta al instante la orden de ENTRADA del taller (inspección), sin esperar a que llegue todo.';

    const filas = esperados.map(e => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);font-family:var(--font-mono,monospace);">${esc(e.serial)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(e.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">
          ${e.resolucion
            ? (RES_LABEL[e.resolucion] || esc(e.resolucion)) + (e.motivo_codigo ? `<div style="font-size:11px;color:var(--fg-3,#6b7280);">${esc((MOTIVOS.find(([v]) => v === e.motivo_codigo) || [,''])[1])}${e.motivo_detalle ? ': ' + esc(e.motivo_detalle) : ''}</div>` : '')
            : (editable ? `
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <button type="button" class="btn btn-sm dev-recibido" data-id="${esc(e.id)}" style="background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;">✓ Recibido</button>
                ${esConfirmacion ? `<button type="button" class="btn btn-sm dev-nunca" data-id="${esc(e.id)}">Nunca salió</button>` : ''}
                <select class="form-select dev-motivo" data-id="${esc(e.id)}" style="height:30px;font-size:12px;max-width:230px;">
                  <option value="">No se devuelve — motivo…</option>
                  ${MOTIVOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              </div>`
            : '<span style="color:var(--fg-3,#6b7280);">pendiente</span>')}
        </td>
      </tr>`).join('');

    const filasModelo = porModelo.map((m, i) => {
      const falta = Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0));
      return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(m.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);text-align:center;">${Number(m.recibidos || 0)} / ${Number(m.cantidad || 0)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">
          ${(editable && falta > 0) ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input class="form-input dev-serial-modelo" data-idx="${i}" placeholder="Serial recibido (tecléalo o escanéalo)" style="height:30px;font-size:12px;max-width:220px;">
              <button type="button" class="btn btn-sm dev-checkin-modelo" data-idx="${i}">Check-in</button>
            </div>` : (falta === 0 ? '<span class="chip-estado chip-aprobada">completo</span>' : '')}
        </td>
      </tr>`;
    }).join('');

    const html = `
      <div class="modal" style="max-width:720px;max-height:88vh;display:flex;flex-direction:column;">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div style="font-weight:700;">Devolución de equipos — orden ${esc(_ordenId)}</div>
            <div style="font-size:12.5px;color:var(--fg-3,#6b7280);">${esc(_orden.cliente_nombre || '')} · ${esc(_orden.contrato?.contrato_id || '')} ${cerrada ? '· <b>CERRADA</b>' : ''}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="devCerrarModal"><i data-lucide="x"></i></button>
        </div>
        <div style="padding:14px 18px;overflow:auto;flex:1;">
          <p style="margin:0 0 12px;font-size:13px;color:var(--fg-2,#374151);">${intro}</p>
          ${esperados.length ? `
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
              <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:12px;">
                <th style="padding:6px 8px;">Serial</th><th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;">Resolución</th>
              </tr></thead>
              <tbody>${filas}</tbody>
            </table>
          </div>` : ''}
          ${porModelo.length ? `
          <div style="margin-top:${esperados.length ? '14px' : '0'};">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;">Por modelo (la baja no registró seriales — se capturan al llegar)</div>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
                <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:12px;">
                  <th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;text-align:center;">Recibidos</th><th style="padding:6px 8px;">Check-in</th>
                </tr></thead>
                <tbody>${filasModelo}</tbody>
              </table>
            </div>
          </div>` : ''}
        </div>
        <div class="sheet-footer" style="display:flex;justify-content:space-between;gap:8px;padding:12px 18px;border-top:1px solid var(--border-subtle,#e5e7eb);">
          <span style="font-size:12px;color:var(--fg-3,#6b7280);align-self:center;">${cerrada ? 'Orden cerrada.' : `${pendientes + modelosPend} unidad(es) sin resolver`}</span>
          ${(!cerrada && puedeOperar()) ? `<button type="button" class="btn btn-primary" id="devCerrarOrden" ${pendientes + modelosPend > 0 ? 'disabled title="Resuelve todas las unidades para cerrar"' : ''}><i data-lucide="check"></i> Cerrar devolución</button>` : ''}
        </div>
      </div>`;

    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.className = 'overlay';
      _overlay.style.display = 'flex';
      document.body.appendChild(_overlay);
      _overlay.addEventListener('click', (ev) => { if (ev.target === _overlay) cerrarModal(); });
    }
    _overlay.innerHTML = html;
    if (window.lucide) lucide.createIcons();

    _overlay.querySelector('#devCerrarModal')?.addEventListener('click', cerrarModal);
    _overlay.querySelector('#devCerrarOrden')?.addEventListener('click', cerrarOrden);
    _overlay.querySelectorAll('.dev-recibido').forEach(b => b.addEventListener('click', () => resolver(b.dataset.id, 'recibido')));
    _overlay.querySelectorAll('.dev-nunca').forEach(b => b.addEventListener('click', () => resolver(b.dataset.id, 'nunca_salio')));
    _overlay.querySelectorAll('.dev-motivo').forEach(sel => sel.addEventListener('change', async () => {
      if (!sel.value) return;
      let detalle = '';
      if (sel.value === 'otro') {
        detalle = (window.Modal?.prompt
          ? await Modal.prompt({ title: 'Motivo de la excepción', message: 'Detalla por qué esta unidad no se devuelve.' })
          : window.prompt('Detalla por qué esta unidad no se devuelve:')) || '';
        if (!detalle.trim()) { sel.value = ''; return; }
      }
      resolver(sel.dataset.id, 'no_devuelve', sel.value, detalle.trim());
    }));
    _overlay.querySelectorAll('.dev-checkin-modelo').forEach(b => b.addEventListener('click', () => checkinPorModelo(Number(b.dataset.idx))));
  }

  async function _guardarDevolucion(log) {
    const user = firebase.auth().currentUser;
    await OrdenesService.mergeOrder(_ordenId, {
      devolucion: _orden.devolucion,
      os_logs: firebase.firestore.FieldValue.arrayUnion({ action: log, by: user?.uid || '' }),
    });
  }

  async function resolver(esperadoId, resolucion, motivoCodigo, motivoDetalle) {
    const e = (_orden.devolucion.esperados || []).find(x => x.id === esperadoId);
    if (!e || e.resolucion) return;
    const labels = { recibido: 'RECIBIDO', nunca_salio: 'NUNCA SALIÓ del taller', no_devuelve: 'NO SE DEVUELVE' };
    if (!window.confirm(`${e.serial} → ${labels[resolucion]}. Esta acción mueve el equipo en el inventario y no se deshace desde aquí. ¿Confirmar?`)) { render(); return; }
    const user = firebase.auth().currentUser;
    e.resolucion = resolucion;
    e.motivo_codigo = motivoCodigo || null;
    e.motivo_detalle = motivoDetalle || null;
    e.resuelto_at = firebase.firestore.Timestamp.now();
    e.resuelto_por = user?.uid || null;
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN');
      Toast.show(`${e.serial}: ${labels[resolucion].toLowerCase()}.`, 'ok');
    } catch (err) {
      console.error(err);
      e.resolucion = null; e.motivo_codigo = null; e.motivo_detalle = null; e.resuelto_at = null; e.resuelto_por = null;
      Toast.show('No se pudo registrar el check-in.', 'bad');
    }
    render();
  }

  async function checkinPorModelo(idx) {
    const m = (_orden.devolucion.esperados_por_modelo || [])[idx];
    const input = _overlay.querySelector(`.dev-serial-modelo[data-idx="${idx}"]`);
    const serial = (input?.value || '').trim().toUpperCase();
    if (!m || !serial) { Toast.show('Escribe o escanea el serial recibido.', 'warn'); return; }
    if ((_orden.devolucion.esperados || []).some(e => (e.serial || '').toUpperCase() === serial)) {
      Toast.show('Ese serial ya está registrado en esta orden.', 'warn'); return;
    }
    const user = firebase.auth().currentUser;
    _orden.devolucion.esperados = _orden.devolucion.esperados || [];
    _orden.devolucion.esperados.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      serial,
      modelo: m.modelo || '',
      modelo_id: m.modelo_id || null,
      pool_doc_id: null, // el backend resuelve por serial
      resolucion: 'recibido',
      motivo_codigo: null, motivo_detalle: null,
      resuelto_at: firebase.firestore.Timestamp.now(),
      resuelto_por: user?.uid || null,
    });
    m.recibidos = Number(m.recibidos || 0) + 1;
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN');
      Toast.show(`${serial}: recibido.`, 'ok');
    } catch (err) {
      console.error(err);
      _orden.devolucion.esperados.pop();
      m.recibidos = Number(m.recibidos || 0) - 1;
      Toast.show('No se pudo registrar el check-in.', 'bad');
    }
    render();
  }

  async function cerrarOrden() {
    if (!window.confirm('¿Cerrar la devolución? Todas las unidades quedaron resueltas; los equipos recibidos ya están (o quedarán) en la orden de ENTRADA de inspección.')) return;
    const user = firebase.auth().currentUser;
    try {
      await OrdenesService.mergeOrder(_ordenId, {
        estado_reparacion: 'CERRADA (DEVOLUCION)',
        fecha_completado: firebase.firestore.FieldValue.serverTimestamp(),
        completado_por_uid: user?.uid || null,
        os_logs: firebase.firestore.FieldValue.arrayUnion({ action: 'CERRAR_DEVOLUCION', by: user?.uid || '' }),
      });
      _orden.estado_reparacion = 'CERRADA (DEVOLUCION)';
      Toast.show('Devolución cerrada.', 'ok');
      render();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cerrar la devolución.', 'bad');
    }
  }

  window.OrdenesDevolucion = { abrir };
})();

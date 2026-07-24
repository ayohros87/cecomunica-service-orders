// Ficha del equipo — consulta de SOLO LECTURA de una unidad del pool, abrible
// desde cualquier página y para CUALQUIER rol autenticado (las reglas permiten
// read a todo usuario logueado; la gestión sigue viviendo en Inventario ·
// Equipos por serial, que mantiene su propio gate de roles).
//
// Motiva su existencia el hallazgo de la auditoría 2026-07-24: los chips de
// estado enlazaban al kardex de inventario/equipos.html, página que expulsa a
// técnicos/recepción/vendedores — el link era un callejón sin salida para la
// mayoría de su audiencia.
//
// API:
//   EquipoFicha.abrir(serialRaw)   — resuelve por serial_norm; si hay varias
//                                    fichas (serial compartido) muestra selector.
//   EquipoFicha.abrirPorId(docId)  — abre una ficha exacta.
//
// Dependencias: firebase compat (global), EquiposPoolService, clases
// .eqpool-chip de ceco-ui.css. El overlay es propio (mismo look del Modal kit).
window.EquipoFicha = {

  _ROLES_INVENTARIO: ['administrador', 'inventario', 'gerente'],

  MOV_LABELS: {
    migracion:            'Alta por migración',
    ingreso_bodega:       'Ingreso a bodega',
    asignacion_contrato:  'Asignado a contrato',
    liberacion:           'Liberación',
    entrega:              'Entrega al cliente',
    ingreso_taller:       'Ingreso a taller',
    salida_taller:        'Salida de taller',
    prestamo_poc:         'Registro en plataforma POC',
    registro_poc:         'Registro en plataforma POC',
    devolucion:           'Devolución',
    reemplazo:            'Reemplazo',
    baja:                 'Baja',
    reactivacion:         'Reactivación',
    venta:                'Venta directa',
    orden_programacion:   'Orden de programación',
    correccion_migracion: 'Corrección de migración',
    reasignacion:         'Reasignación',
    cambio_estado:        'Cambio de estado',
    fusion_duplicado:     'Fusión de ficha duplicada',
  },

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  },

  _fecha(ts) {
    const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
    if (!d) return '—';
    return d.toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' });
  },

  async abrir(serialRaw) {
    const norm = EquiposPoolService.normalizarSerial(serialRaw);
    if (!norm) return;
    let docs = [];
    try {
      const snap = await firebase.firestore().collection('equipos_pool')
        .where('serial_norm', '==', norm).limit(5).get();
      docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { return; }

    if (!docs.length) {
      this._render(`
        <div style="padding:18px 6px; text-align:center; color:var(--fg-3); line-height:1.6;">
          <div style="font-family:var(--mono, monospace); font-size:16px; color:var(--text);">${this._esc(serialRaw)}</div>
          Este serial no está registrado en el pool de equipos.<br>
          Se registrará automáticamente la próxima vez que toque un contrato, una orden o bodega.
        </div>`);
      return;
    }
    if (docs.length > 1) {
      // Serial compartido: el usuario elige la ficha (unidad-modelo) que busca.
      const filas = docs.map(d => `
        <button class="btn btn-ghost" style="display:flex; width:100%; justify-content:space-between; align-items:center; gap:10px; text-align:left;"
                onclick="EquipoFicha.abrirPorId('${this._esc(d.id)}')">
          <span>${this._esc(d.modelo_label || d.modelo_id || 'sin modelo')}</span>
          ${EquiposPoolService.chipEstadoHtml(d.estado)}
        </button>`).join('');
      this._render(`
        <div style="padding:6px 2px;">
          <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
            El serial <span style="font-family:var(--mono, monospace); color:var(--text);">${this._esc(serialRaw)}</span>
            tiene <b>${docs.length} fichas</b> (modelos distintos registrados por fuentes distintas). Elige cuál ver:
          </p>
          <div style="display:flex; flex-direction:column; gap:6px;">${filas}</div>
        </div>`);
      return;
    }
    await this._ficha(docs[0]);
  },

  async abrirPorId(docId) {
    try {
      const d = await firebase.firestore().collection('equipos_pool').doc(docId).get();
      if (d.exists) await this._ficha({ id: d.id, ...d.data() });
    } catch (e) { /* solo lectura, best-effort */ }
  },

  async _ficha(eq) {
    const esc = this._esc.bind(this);
    let movs = [];
    try { movs = await EquiposPoolService.getMovimientos(eq.id); } catch (e) { /* sin historia */ }

    const asig = eq.asignacion || null;
    const linkCliente = asig && asig.cliente_id
      ? `<a href="/clientes/editar.html?id=${encodeURIComponent(asig.cliente_id)}">${esc(asig.cliente_nombre || '—')}</a>`
      : esc((asig && asig.cliente_nombre) || '—');
    const linkContrato = asig && asig.contrato_id
      ? `<a href="/contratos/index.html?buscar=${encodeURIComponent(asig.contrato_id)}">${esc(asig.contrato_id)}</a>` : '—';
    const linkOrden = eq.orden_actual_id
      ? `<a href="/ordenes/editar-orden.html?id=${encodeURIComponent(eq.orden_actual_id)}">${esc(eq.orden_actual_id)}</a>` : '—';

    const chips = [
      EquiposPoolService.chipEstadoHtml(eq.estado),
      (typeof EquiposPoolService.chipPendienteDevolucionHtml === 'function'
        ? EquiposPoolService.chipPendienteDevolucionHtml(eq) : ''),
      eq.serial_compartido ? '<span class="eqpool-chip" style="background:#fef3c7;color:#92400e;" title="Este serial existe en más de una ficha — verifica el modelo">2+ MODELOS</span>' : '',
      eq.verificado === false ? '<span class="eqpool-chip" style="background:#f1f5f9;color:#64748b;" title="Creado por migración automática — pendiente de confirmación física">SIN VERIFICAR</span>' : '',
    ].join(' ');

    const meta = [
      ['Asignado a', linkCliente],
      ['Contrato', linkContrato],
      ['Orden actual', linkOrden],
      ['Condición', eq.condicion === 'reuso' ? 'Reuso' : 'Nuevo'],
      ['Propiedad', eq.propiedad === 'cecomunica' ? 'Flota Cecomunica' : eq.propiedad === 'cliente' ? 'Del cliente' : 'Sin clasificar'],
      ['Plataforma POC', eq.poc_device_id ? 'Registrado' : '—'],
      eq.reemplaza_a ? ['Reemplaza a', `<span style="font-family:var(--mono, monospace);">${esc(eq.reemplaza_a)}</span>`] : null,
      (eq.venta && eq.venta.factura) ? ['Factura QBO', esc(eq.venta.factura)] : null,
      eq.baja_motivo ? ['Motivo de baja', esc(eq.baja_motivo)] : null,
    ].filter(Boolean).map(([k, v]) => `
      <div>
        <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3); margin-bottom:2px;">${k}</div>
        <div style="font-size:13.5px;">${v}</div>
      </div>`).join('');

    const historia = movs.length ? movs.map(m => {
      const tipoLabel = this.MOV_LABELS[m.tipo] || (m.tipo || '').replace(/_/g, ' ');
      const deA = (m.de_estado || m.a_estado)
        ? `<span style="color:var(--fg-3);">${esc(EquiposPoolService.ESTADO_LABELS[m.de_estado] || m.de_estado || '·')} → ${esc(EquiposPoolService.ESTADO_LABELS[m.a_estado] || m.a_estado || '·')}</span>` : '';
      const refHtml = m.ref && m.ref.tipo === 'orden' && m.ref.id
        ? ` · <a href="/ordenes/editar-orden.html?id=${encodeURIComponent(m.ref.id)}">${esc(m.ref.label || m.ref.id)}</a>`
        : (m.ref && m.ref.label ? ` · ${esc(m.ref.label)}` : '');
      return `
        <li style="position:relative; padding:0 0 12px 18px; font-size:12.5px; line-height:1.5;">
          <span style="position:absolute; left:0; top:5px; width:7px; height:7px; border-radius:50%; background:var(--fg-3);"></span>
          <span style="font-family:var(--mono, monospace); font-size:11px; color:var(--fg-3); display:block;">${this._fecha(m.at)}</span>
          <b>${esc(tipoLabel)}</b> ${deA}${refHtml}
          ${m.notas ? `<div style="color:var(--fg-3);">${esc(m.notas)}</div>` : ''}
        </li>`;
    }).join('') : '<li style="font-size:12.5px; color:var(--fg-3); list-style:none;">Sin movimientos registrados.</li>';

    const puedeInventario = this._ROLES_INVENTARIO.includes(window.userRole);
    const footerInv = puedeInventario
      ? `<a class="btn btn-ghost" href="${EquiposPoolService.kardexUrl(eq.serial || eq.serial_norm)}">Abrir en Inventario</a>`
      : '';

    this._render(`
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <span style="font-family:var(--mono, monospace); font-size:17px; font-weight:600;">${esc(eq.serial || eq.serial_norm)}</span>
        ${chips}
      </div>
      <div style="font-size:12.5px; color:var(--fg-3); margin:2px 0 12px;">${esc(eq.modelo_label || eq.modelo_id || 'Modelo sin registrar')}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px 16px; margin-bottom:14px;">${meta}</div>
      <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3); margin-bottom:8px;">Historia</div>
      <ul style="list-style:none; margin:0; padding:0; max-height:290px; overflow-y:auto;">${historia}</ul>`,
      footerInv);
  },

  _render(bodyHtml, footerExtra = '') {
    document.getElementById('equipoFichaOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'equipoFichaOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px; width:min(560px, 94vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;">Ficha del equipo</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:14px 8px;">${bodyHtml}</div>
        <div class="footer" style="display:flex; justify-content:flex-end; gap:8px;">
          ${footerExtra}
          <button class="btn btn-primary" data-action="cerrar">Cerrar</button>
        </div>
      </div>`;
    const cerrar = () => {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', kb);
    };
    const kb = (e) => { if (e.key === 'Escape') cerrar(); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-action="cerrar"]')) cerrar();
    });
    document.addEventListener('keydown', kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  },
};

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
  // Acciones de escritura: mismo gate que la página de Equipos (gerente lee).
  _ROLES_ACCIONES: ['administrador', 'inventario'],
  // Hook de refresco: la página que abrió la ficha lo asigna para re-pintar
  // sus listas cuando una acción cambia el estado de la unidad.
  onCambio: null,

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
    orden_descartada:     'Orden de programación descartada',
    correccion_migracion: 'Corrección de migración',
    reasignacion:         'Reasignación',
    cambio_estado:        'Cambio de estado',
    fusion_duplicado:     'Fusión de ficha duplicada',
    conflicto_revisado:   'Conflicto de modelo resuelto',
    conflicto_reabierto:  'Conflicto de modelo reabierto',
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
      // Sin ficha en el pool la condición igual se muestra: vive por serial,
      // no por ficha (equipo del cliente que nunca entró a bodega).
      const condicionHtml = await this._condicionHtml(serialRaw);
      this._render(`
        <div style="padding:18px 6px; text-align:center; color:var(--fg-3); line-height:1.6;">
          <div style="font-family:var(--mono, monospace); font-size:16px; color:var(--text);">${this._esc(serialRaw)}</div>
          Este serial no está registrado en el pool de equipos.<br>
          Se registrará automáticamente la próxima vez que toque un contrato, una orden o bodega.
        </div>
        ${condicionHtml}`);
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
    const condicionHtml = await this._condicionHtml(eq.serial || eq.serial_norm);

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
      // Mismas clases y MISMO texto que en Inventario y junto a los inputs
      // (auditoría 2026-08-04, A4: una condición con cuatro nombres distintos).
      // Con decisión tomada el chip baja de tono y deja de mandar a la cola:
      // en Conflictos solo está lo pendiente, y un resuelto vive bajo "Ver los
      // ya revisados". Mandarlo a ciegas hacía parecer que el dato se perdió.
      eq.serial_compartido
        ? (eq.conflicto_revisado === true
            ? '<span class="eqpool-compartido" style="background:#fef3c7;color:#92400e;" title="Confirmado: dos radios físicos distintos comparten esta numeración (típico Kenwood NX-420 / NX-920). Verifica el modelo antes de operar. El detalle está en Inventario · Conflictos → «Ver los ya revisados».">2+ modelos · confirmado</span>'
            : '<span class="eqpool-compartido" title="Este serial existe en más de una ficha y nadie lo ha revisado — verifica el modelo. Se resuelve en Inventario · pestaña Conflictos.">2+ modelos</span>')
        : '',
      eq.verificado === false ? '<span class="eqpool-noverif" title="Creado por migración automática — pendiente de confirmación física">Sin verificar</span>' : '',
    ].join(' ');

    const meta = [
      ['Asignado a', linkCliente],
      ['Contrato', linkContrato],
      ['Orden actual', linkOrden],
      ['Condición', eq.condicion === 'reuso' ? 'Refurbished' : 'Nuevo'],
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
    // Fase A (propuesta Almacén 2026-08): la ficha deja de ser solo-lectura.
    // Acciones contextuales por estado, llamando directo al servicio — el
    // mismo que usan las acciones de fila de Equipos por serial.
    const footerAcciones = this._accionesHtml(eq);

    this._render(`
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <span style="font-family:var(--mono, monospace); font-size:17px; font-weight:600;">${esc(eq.serial || eq.serial_norm)}</span>
        ${chips}
      </div>
      <div style="font-size:12.5px; color:var(--fg-3); margin:2px 0 12px;">${esc(eq.modelo_label || eq.modelo_id || 'Modelo sin registrar')}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px 16px; margin-bottom:14px;">${meta}</div>
      ${condicionHtml}
      <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3); margin-bottom:8px;">Historia</div>
      <ul style="list-style:none; margin:0; padding:0; max-height:290px; overflow-y:auto;">${historia}</ul>`,
      footerAcciones + footerInv);
  },

  // ── Acciones contextuales (Fase A) ─────────────────────────────────────
  _accionesHtml(eq) {
    if (!this._ROLES_ACCIONES.includes(window.userRole)) return '';
    const btn = (accion, label, cls = 'btn-ghost') =>
      `<button type="button" class="btn ${cls}" onclick="EquipoFicha._accion('${this._esc(eq.id)}','${accion}')">${label}</button>`;
    const a = [];
    if (eq.estado === 'devuelto_revision') {
      a.push(btn('inspeccion_ok', '✓ Inspección OK → bodega', 'btn-accent'));
      a.push(btn('baja', 'Dar de baja'));
    } else if (eq.estado === 'por_clasificar') {
      a.push(btn('corregir', 'Corregir a bodega', 'btn-accent'));
      a.push(btn('baja', 'Dar de baja'));
    } else if (eq.estado === 'en_bodega') {
      if (window.AsistenteVenta) a.push(btn('vender', 'Registrar venta'));
      a.push(btn('baja', 'Dar de baja'));
    } else if (eq.estado === 'baja') {
      a.push(btn('reactivar', 'Reactivar → bodega', 'btn-accent'));
    }
    if (eq.verificado === false) a.push(btn('verificar', 'Marcar verificado'));
    return a.join('');
  },

  async _accion(docId, accion) {
    const user = firebase.auth().currentUser;
    const doc = await firebase.firestore().collection('equipos_pool').doc(docId).get();
    if (!doc.exists) return;
    const eq = { id: doc.id, ...doc.data() };
    const serial = eq.serial || eq.serial_norm;
    const aviso = (msg, tipo = 'ok') => { if (window.Toast) Toast.show(msg, tipo); };
    try {
      if (accion === 'inspeccion_ok') {
        if (!confirm(`¿Inspección OK? ${serial} regresa a bodega como disponible (condición reuso).`)) return;
        await EquiposPoolService.liberar(eq.id, { notas: 'Inspección OK desde la ficha (Almacén)' }, user);
        aviso(`${serial} → en bodega.`);
      } else if (accion === 'corregir') {
        const motivo = prompt(`Corregir ${serial} a bodega — la unidad está físicamente en bodega y su estado era heredado.\nMotivo (opcional):`);
        if (motivo === null) return;
        await EquiposPoolService.corregirABodega(eq.id, motivo || 'Corrección desde la ficha (Almacén)', user);
        aviso(`${serial} → en bodega (verificado).`);
      } else if (accion === 'baja') {
        const motivo = prompt(`Dar de baja ${serial} — sale de la flota (reversible con "Reactivar").\nMotivo (obligatorio):`);
        if (!motivo) return;
        await EquiposPoolService.darDeBaja(eq.id, motivo, user);
        aviso(`${serial} dado de baja.`);
      } else if (accion === 'reactivar') {
        const motivo = prompt(`Reactivar ${serial} — regresa a bodega como disponible.\nMotivo:`);
        if (!motivo) return;
        await EquiposPoolService.reactivar(eq.id, motivo, user);
        aviso(`${serial} → en bodega.`);
      } else if (accion === 'verificar') {
        await EquiposPoolService.verificar(eq.id, user);
        aviso(`${serial} marcado como verificado.`);
      } else if (accion === 'vender') {
        document.getElementById('equipoFichaOverlay')?.remove();
        document.body.style.overflow = '';
        if (window.AsistenteVenta) {
          AsistenteVenta.abrir({ user, serialesPrefill: [serial], onDone: () => { if (typeof this.onCambio === 'function') this.onCambio(); } });
        }
        return;
      } else {
        return;
      }
      await this.abrirPorId(eq.id);                       // re-pinta la ficha ya movida
      if (typeof this.onCambio === 'function') this.onCambio();
    } catch (e) {
      aviso(e.message || String(e), 'bad');
    }
  },

  // ── Condición particular (petición Solangel 2026-09-04) ────────────────
  // Vive en equipos_condiciones, por serial, aparte del pool: el radio sirve
  // pero arrastra una limitación (auricular dañado, etc.). Aquí se ve la
  // vigente con su historial, se registra una nueva y se levanta cuando el
  // radio se repara de verdad. Las reglas mandan; los roles de abajo solo
  // deciden qué botones pintar.
  _ROLES_CONDICION_LEVANTAR: ['administrador', 'jefe_taller', 'inventario'],
  _ROLES_CONDICION_REGISTRAR: ['administrador', 'jefe_taller', 'inventario', 'tecnico', 'tecnico_operativo', 'recepcion'],

  _rolActual() {
    return window.userRole || (window.APP && APP.state && APP.state.userRole) || '';
  },

  async _condicionHtml(serial) {
    if (typeof EquiposCondicionesService === 'undefined') return '';
    const esc = this._esc.bind(this);
    let c = null;
    try { c = await EquiposCondicionesService.buscarCompleto(serial); } catch (e) { c = null; }
    const rol = this._rolActual();
    const puedeLevantar = this._ROLES_CONDICION_LEVANTAR.includes(rol)
      || (window.OrdenesQC && typeof OrdenesQC.puedeHacerQc === 'function' && OrdenesQC.puedeHacerQc(rol));
    const puedeRegistrar = this._ROLES_CONDICION_REGISTRAR.includes(rol) || puedeLevantar;
    const serialAttr = esc(serial);
    const btnRegistrar = puedeRegistrar
      ? `<button type="button" class="btn btn-ghost btn-sm" onclick="EquipoFicha._registrarCondicion('${serialAttr}')">${c && c.vigente !== false ? 'Corregir la condición' : 'Registrar condición'}</button>`
      : '';

    if (!c || c.vigente === false) {
      // Sin condición vigente: solo el botón (y, si la hubo, la traza).
      const hist = (c && Array.isArray(c.historial) && c.historial.length)
        ? `<details style="margin-top:6px;"><summary style="cursor:pointer; font-size:12px; color:var(--fg-3);">Tuvo una condición, ya levantada (${c.historial.length} movimiento(s))</summary>${this._condicionHistorialHtml(c)}</details>`
        : '';
      if (!btnRegistrar && !hist) return '';
      return `
        <div style="margin:0 0 14px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Condición particular</div>
          ${btnRegistrar}
        </div>
        ${hist ? `<div style="margin:-8px 0 14px;">${hist}</div>` : ''}`;
    }

    const cuando = this._fecha(c.registrado_at);
    const btnLevantar = puedeLevantar
      ? `<button type="button" class="btn btn-secondary btn-sm" onclick="EquipoFicha._levantarCondicion('${serialAttr}')" title="El radio ya no tiene esta limitación: el aviso deja de salir y queda la traza">Levantar (se resolvió)</button>`
      : '';
    return `
      <div style="margin:0 0 14px; background:#FFFBEB; border:1px solid #FCD34D; border-radius:10px; padding:10px 12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:#92400E;">⚠ Condición particular vigente</div>
          <div style="display:flex; gap:6px;">${btnRegistrar}${btnLevantar}</div>
        </div>
        <div style="font-size:13.5px; color:#78350F; margin-top:4px; line-height:1.5;">${esc(c.condicion)}</div>
        <div style="font-size:11.5px; color:#92400E; margin-top:4px;">
          ${[c.por_email, cuando, c.orden_id ? `orden ${c.orden_id}` : ''].filter(Boolean).map(esc).join(' · ')}
        </div>
        ${Array.isArray(c.historial) && c.historial.length > 1
          ? `<details style="margin-top:6px;"><summary style="cursor:pointer; font-size:12px; color:#92400E;">Historial (${c.historial.length})</summary>${this._condicionHistorialHtml(c)}</details>`
          : ''}
      </div>`;
  },

  _condicionHistorialHtml(c) {
    const esc = this._esc.bind(this);
    const items = [...(c.historial || [])].reverse().map(h => {
      const f = h.fecha_iso ? new Date(h.fecha_iso).toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const que = h.tipo === 'levantamiento'
        ? `<b>Levantada</b>${h.motivo ? ': ' + esc(h.motivo) : ''}`
        : `<b>Registrada</b>: ${esc(h.condicion || '')}`;
      return `<li style="font-size:12px; line-height:1.5; padding:2px 0;">${que}
        <span style="color:var(--fg-3);">· ${esc(h.por_email || '')}${f ? ' · ' + f : ''}${h.orden_id ? ' · orden ' + esc(h.orden_id) : ''}</span></li>`;
    }).join('');
    return `<ul style="margin:4px 0 0; padding-left:16px;">${items}</ul>`;
  },

  async _registrarCondicion(serial) {
    if (!window.Modal || typeof EquiposCondicionesService === 'undefined') return;
    const texto = await Modal.prompt({
      title: 'Condición particular del equipo',
      message: `El radio ${serial} funciona, pero con una limitación que hay que tener en cuenta antes de asignarlo o de volver a diagnosticarlo. Queda pegada al serial.`,
      placeholder: 'Cuál — ej.: conector de auricular dañado, no repara en taller',
    });
    if (!texto || !texto.trim()) return;
    try {
      await EquiposCondicionesService.registrar({ serial, condicion: texto.trim(), origen: 'ficha' });
      if (window.SerialField) SerialField.invalidar(serial);
      if (window.Toast) Toast.show('Condición registrada', 'ok');
      await this.abrir(serial);
      if (typeof this.onCambio === 'function') this.onCambio();
    } catch (e) {
      if (window.Toast) Toast.show('No se pudo registrar: ' + (e.message || e), 'bad');
    }
  },

  async _levantarCondicion(serial) {
    if (!window.Modal || typeof EquiposCondicionesService === 'undefined') return;
    const motivo = await Modal.prompt({
      title: 'Levantar la condición',
      message: `El aviso sobre ${serial} dejará de salir. El registro no se borra: queda quién la levantó y por qué.`,
      placeholder: 'Motivo (obligatorio) — ej.: se cambió el conector fuera del taller',
    });
    if (!motivo || !motivo.trim()) return;
    try {
      await EquiposCondicionesService.levantar(serial, motivo.trim());
      if (window.SerialField) SerialField.invalidar(serial);
      if (window.Toast) Toast.show('Condición levantada', 'ok');
      await this.abrir(serial);
      if (typeof this.onCambio === 'function') this.onCambio();
    } catch (e) {
      if (window.Toast) Toast.show('No se pudo levantar: ' + (e.message || e), 'bad');
    }
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

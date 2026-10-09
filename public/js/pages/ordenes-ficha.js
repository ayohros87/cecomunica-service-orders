// @ts-nocheck
/* ========================================
 * FICHA DE LA ORDEN — lista → ficha lateral, como en el Centro (2026-10-09).
 *
 * Por qué: en los primeros 8 días del log de uso, ordenes/imprimir-orden se
 * abrió 172 veces para 57 órdenes creadas. La bandeja no tenía una vista de
 * la orden completa, así que recepción abría el papel (en otra pestaña) para
 * LEER la orden. Esta ficha es esa vista: todo lo de la orden en una hoja
 * lateral, con los mismos verbos que la fila (el botón de flujo y el menú ⋯),
 * sin salir de la bandeja. Imprimir queda como un verbo más.
 *
 * Solo lee: los verbos son los de siempre (data-action delegado en
 * ordenes-events.js), así que lo que se haga desde aquí pasa por el mismo
 * código que desde la fila. Entra por:
 *   · el número de la orden (fila de escritorio y tarjeta móvil),
 *   · ?ficha=<id> (señales del home, correos),
 *   · OrdenesFicha.abrir(id) desde cualquier módulo.
 * ======================================== */
window.OrdenesFicha = (() => {
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? ''));
  const ACCESORIOS = [['bateria', 'Batería'], ['clip', 'Clip'], ['cargador', 'Cargador'], ['fuente', 'Fuente'], ['antena', 'Antena'], ['cubrepolvo', 'Cubrepolvo']];
  let _abierta = null;   // { ordenId, api }

  function _orden(ordenId) {
    return (window.APP?.state?.orders || []).find(o => o.ordenId === ordenId) || null;
  }

  // Los verbos de la fila, aplanados: el botón de flujo tal cual y los ítems
  // del menú ⋯ como botones de texto. Reusa botonesFlujo/botonesGestion para
  // que rol y estado decidan exactamente lo mismo que en la bandeja.
  function _verbos(ordenId, estado, o) {
    const tmp = document.createElement('div');
    try { tmp.innerHTML = botonesFlujo(ordenId, estado, o); } catch { tmp.innerHTML = ''; }
    const flujo = [...tmp.querySelectorAll('[data-action]')]
      .filter(b => !b.closest('.overflow-menu'))
      .map(b => b.outerHTML).join('');
    const tmp2 = document.createElement('div');
    try { tmp2.innerHTML = botonesGestion(ordenId, estado); } catch { tmp2.innerHTML = ''; }
    const items = [...tmp2.querySelectorAll('.overflow-menu-item[data-action]')]
      .filter(b => !b.disabled && b.dataset.action && b.dataset.action !== 'eliminar-orden')
      .map(b => `<button type="button" class="btn btn-ghost btn-sm" data-action="${esc(b.dataset.action)}" data-orden-id="${esc(ordenId)}" data-stop-propagation="true">${b.innerHTML}</button>`);
    const eliminar = tmp2.querySelector('.overflow-menu-item[data-action="eliminar-orden"]');
    return { flujo, items: items.join(''), eliminar: eliminar
      ? `<button type="button" class="btn btn-ghost btn-sm of-eliminar" data-action="eliminar-orden" data-orden-id="${esc(ordenId)}" data-stop-propagation="true">${eliminar.innerHTML}</button>` : '' };
  }

  function _accesorios(e) {
    const si = ACCESORIOS.filter(([k]) => !!e[k]).map(([, l]) => l);
    return si.length ? si.map(l => `<span class="bj-eq">${esc(l)}</span>`).join('') : '<span class="ts">sin accesorios</span>';
  }

  function _equipos(o) {
    const equipos = (o.equipos || []).filter(e => !e.eliminado);
    if (!equipos.length) {
      const esp = o.devolucion?.esperados || [];
      if (esp.length) {
        return `<div class="of-bloque"><h4>Equipos esperados (${esp.length})</h4><div class="of-equipos">${esp.map(e => `
          <div class="of-eq"><div class="of-eq-h"><b class="mono">${esc(e.numero_de_serie || e.serial || '—')}</b> <span>${esc(e.modelo || '')}</span></div></div>`).join('')}</div></div>`;
      }
      return `<div class="of-bloque"><h4>Equipos</h4><p class="ts">Esta orden no tiene equipos registrados.</p></div>`;
    }
    const D = window.DescarteEntrega;
    return `<div class="of-bloque"><h4>Equipos (${equipos.length})</h4><div class="of-equipos">${equipos.map(e => {
      const seQueda = D && D.seQueda ? D.seQueda(o, e) : false;
      const sinReparar = D && D.sinReparar ? D.sinReparar(o, e) : false;
      const marcas = [
        seQueda ? '<span class="bj-chip bj-chip--alerta">Descartado · se queda</span>' : '',
        sinReparar ? '<span class="bj-chip bj-chip--aviso">Sale sin reparar</span>' : '',
        e.intervencion_no_disponible ? '<span class="bj-chip bj-chip--neutro">No disponible</span>' : '',
        e.condicion_especial ? `<span class="bj-chip bj-chip--aviso" title="${esc(e.condicion_texto || '')}">Con condición</span>` : '',
        (e.fotos || []).length ? `<span class="bj-chip bj-chip--neutro">${(e.fotos || []).length} foto${(e.fotos || []).length === 1 ? '' : 's'}</span>` : '',
      ].filter(Boolean).join(' ');
      return `<div class="of-eq${seQueda ? ' is-off' : ''}">
        <div class="of-eq-h"><b class="mono">${esc(e.numero_de_serie || '—')}</b> <span>${esc(e.modelo || '')}</span> ${marcas}</div>
        <div class="of-eq-acc">${_accesorios(e)}</div>
        ${e.observaciones ? `<div class="of-eq-l"><span class="k">Observación</span>${esc(e.observaciones)}</div>` : ''}
        ${e.trabajo_tecnico ? `<div class="of-eq-l"><span class="k">Trabajo técnico</span>${esc(e.trabajo_tecnico)}</div>` : ''}
      </div>`;
    }).join('')}</div></div>`;
  }

  function _visita(o) {
    const v = o.visita, inf = o.informe_visita;
    if (!v && !inf) return '';
    const el = (inf?.elementos || []);
    return `<div class="of-bloque"><h4>Visita técnica</h4>
      ${v ? `<div class="of-kv"><span class="k">Sitio</span><span>${esc(v.sitio || '—')}</span></div>
             <div class="of-kv"><span class="k">Contacto</span><span>${esc(v.contacto_sitio || '—')}</span></div>` : ''}
      ${inf ? `<div class="of-kv"><span class="k">Fecha</span><span>${esc(inf.fecha_visita || '—')}</span></div>
               ${inf.motivo ? `<div class="of-kv"><span class="k">Motivo</span><span>${esc(inf.motivo)}</span></div>` : ''}
               ${inf.trabajo_realizado ? `<div class="of-kv"><span class="k">Trabajo</span><span>${esc(inf.trabajo_realizado)}</span></div>` : ''}
               ${inf.hallazgos ? `<div class="of-kv"><span class="k">Hallazgos</span><span>${esc(inf.hallazgos)}</span></div>` : ''}
               ${el.length ? `<div class="of-kv"><span class="k">Elementos</span><span>${el.map(x => `${esc(x.tipo || '')} ${esc(x.detalle || '')}${x.serial ? ` <b class="mono">${esc(x.serial)}</b>` : ''}`).join('<br>')}</span></div>` : ''}` : ''}
    </div>`;
  }

  function _html(ordenId, o) {
    const estado = (o.estado_reparacion || 'POR ASIGNAR').toUpperCase();
    const ctx = typeof _enlacesContexto === 'function' ? _enlacesContexto(o) : { cliente: esc(nombreClienteDe(o)), contrato: '' };
    const V = _verbos(ordenId, estado, o);
    const gestion = o.gestion?.id
      ? `<a class="orden-ctx-link" href="../clientes/centro.html?id=${encodeURIComponent(o.cliente_id || '')}&g=${encodeURIComponent(String(o.gestion.id))}" title="Abrir el expediente de la gestión">Gestión ${esc(String(o.gestion.id))}</a>` : '';
    const factura = typeof facturaVentaDe === 'function' && facturaVentaDe(o) ? `<span class="orden-ctx-link--mono">Factura ${esc(facturaVentaDe(o))}</span>` : '';
    const timeline = typeof _buildTimelineHTML === 'function' ? _buildTimelineHTML(o) : '';
    return `
      <div class="of-cab">
        <div class="of-cab-l">
          <div class="of-cliente">${ctx.cliente}</div>
          <div class="of-ctx">${[ctx.contrato, gestion, factura].filter(Boolean).join('<span class="sep">·</span>')}</div>
        </div>
        <span class="chip-estado ${getEstadoClass(estado, o)}" title="${estadoTooltip(estado, o)}">${estadoCompacto(estado, o)}</span>
      </div>
      <div class="of-datos">
        <div class="of-kv"><span class="k">Tipo</span><span>${tipoChip(o.tipo_de_servicio)}</span></div>
        <div class="of-kv"><span class="k">Técnico</span><span>${esc(o.tecnico_asignado || 'Sin asignar')}</span></div>
        <div class="of-kv"><span class="k">Creada</span><span>${formatFecha(o.fecha_creacion)}${typeof edadChip === 'function' ? edadChip(o, estado) : ''}</span></div>
        <div class="of-kv"><span class="k">Entrega</span><span>${o.fecha_entrega ? formatFecha(o.fecha_entrega) : '—'}</span></div>
      </div>
      <div class="of-verbos">${V.flujo}${V.items}${V.eliminar}</div>
      ${o.observaciones ? `<div class="of-bloque"><h4>Observaciones</h4><p>${esc(o.observaciones)}</p></div>` : ''}
      ${o.nota_tecnica ? `<div class="of-bloque"><h4>Nota técnica</h4><p>${esc(o.nota_tecnica)}</p></div>` : ''}
      ${_visita(o)}
      ${_equipos(o)}
      ${timeline ? `<div class="of-bloque"><h4>Historial</h4>${timeline}</div>` : ''}
    `;
  }

  async function abrir(ordenId) {
    if (!ordenId || !window.Modal?.sheet) return;
    let o = _orden(ordenId);
    if (!o && window.OrdenesService?.getOrder) {
      try { o = await OrdenesService.getOrder(ordenId); if (o) { APP.state.orders = APP.state.orders || []; APP.state.orders.unshift(o); } } catch { o = null; }
    }
    if (!o) { if (window.Toast) Toast.show('No se encontró la orden ' + ordenId + '.', 'bad'); return; }
    if (_abierta) { try { _abierta.api.close(null); } catch { /* ya cerrada */ } _abierta = null; }
    const p = Modal.sheet({
      titleHtml: `<span class="of-titulo">Orden <b class="mono">${esc(ordenId)}</b></span>`,
      icon: 'clipboard-list',
      html: _html(ordenId, o),
      size: 'lg',
      buttons: [],
      onMount: (root, api) => {
        root.classList.add('is-drawer', 'of-drawer');
        _abierta = { ordenId, api };
        if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(root);
        else if (window.lucide?.createIcons) lucide.createIcons();
        if (window.Uso) Uso.accion('ordenes.ficha');
      },
    });
    p.then(() => { if (_abierta && _abierta.ordenId === ordenId) _abierta = null; });
    return p;
  }

  // Si la ficha está abierta y la orden cambió (un verbo la movió de estado),
  // se repinta con los datos frescos del state. Lo llama el snapshot.
  function refrescar(ordenId) {
    if (!_abierta || (ordenId && _abierta.ordenId !== ordenId)) return;
    const o = _orden(_abierta.ordenId);
    const body = _abierta.api.root.querySelector('.modal-body');
    if (!o || !body) return;
    body.innerHTML = _html(_abierta.ordenId, o);
    if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(body);
  }

  function cerrar() { if (_abierta) { try { _abierta.api.close(null); } catch { /* nada */ } _abierta = null; } }
  function abiertaId() { return _abierta ? _abierta.ordenId : null; }

  // Deep-link ?ficha=<id>: abre la ficha al cargar (señales del home, correos).
  function _deepLink() {
    try {
      const id = new URLSearchParams(location.search).get('ficha');
      if (id) abrir(id);
    } catch { /* sin deep-link */ }
  }

  return { abrir, refrescar, cerrar, abiertaId, _deepLink };
})();

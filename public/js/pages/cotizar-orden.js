// @ts-nocheck
// Cotizar orden — formulario manual y directo que parte de la nota de entrega
// con intervenciones: muestra la orden + sus equipos con intervención, permite
// agregar piezas (nº pieza / descripción / cant. / precio) por equipo y genera
// una cotización REAL (borrador COT-AAAA-NNNN) reutilizando todo el módulo de
// cotizaciones (toDoc, totales, correo de aprobación, detalle/impresión/envío).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = window.CotizacionTotales;

  const params = new URLSearchParams(location.search);
  const ordenId = params.get('id');

  let user = null;
  let rolUsuario = null;     // rol del usuario actual (para textos/avisos)
  let orden = null;
  let equipos = [];          // [{ id, serial, modelo, nombre, intervencion }]
  let catalogos = null;      // { clientes, clientesById, ejecutivos, emisor }
  let piezas = [];           // inventario_piezas activas (catálogo + autocompletar)
  let consumosPorEquipo = {};// { [equipoId]: [{ pieza_nombre, sku, qty, precio_unit, tipo }] }

  // Estado del formulario
  let form = {
    clienteId: '',
    ejecutivoId: '',
    fecha: new Date().toISOString().slice(0, 10),
    validezDias: 15,
    itbmsPct: Math.round(FMT.ITBMS_RATE * 100),
    descuentoPct: 0,
    intro: '',
  };
  // Líneas de pieza por equipo: { [equipoId]: [{ id, sku, nombre, cant, precio }] }
  const lineas = {};

  const uid = () => 'l' + Math.random().toString(36).slice(2, 9);

  // ── Dedup de equipos (mismo criterio que prepararEquiposParaNota) ──────────
  function prepararEquipos(od) {
    const list = Array.isArray(od?.equipos) ? od.equipos : [];
    const out = [];
    const seen = new Set();
    list.forEach((e) => {
      if (!e || e.eliminado === true) return;
      const serial = String(e.numero_de_serie || '').trim();
      const modelo = String(e.modelo || '').trim();
      const id = String(e.id || '').trim();
      const key = id ? `id:${id}` : `sm:${serial.toLowerCase()}|${modelo.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: id || key,
        serial, modelo,
        nombre: String(e.nombre || '').trim(),
        intervencion: String(e.trabajo_tecnico || '').trim(),
      });
    });
    return out;
  }

  // ── Render principal ───────────────────────────────────────────────────────
  function render() {
    const fecha = orden.fecha_creacion?.toDate ? orden.fecha_creacion.toDate().toISOString().slice(0, 10) : '—';
    const estado = (orden.estado_reparacion || '').toUpperCase();
    $('cotizarMount').innerHTML = `
      <nav class="app-breadcrumbs" aria-label="Breadcrumb">
        <a href="index.html">Órdenes</a>
        <span class="app-breadcrumbs-sep"><i data-lucide="chevron-right"></i></span>
        <span class="app-breadcrumbs-current">Cotizar ${esc(ordenId)}</span>
      </nav>

      <div class="app-page-header">
        <div>
          <h1>Cotizar orden ${esc(ordenId)}</h1>
          <p>Servicio <strong>${esc(orden.tipo_de_servicio || '—')}</strong> · Creada ${esc(fecha)}${estado ? ' · ' + esc(estado) : ''}</p>
        </div>
        <div class="app-page-header-actions">
          <button class="btn btn-ghost" id="btnCancelar"><i data-lucide="x"></i> Cancelar</button>
          <button class="btn btn-secondary" id="btnPreview"><i data-lucide="eye"></i> Vista previa</button>
          <button class="btn btn-primary" id="btnGenerar"><i data-lucide="receipt"></i> Preparar cotización</button>
        </div>
      </div>

      <div class="cc-editor-grid">
        <div>
          <!-- Cliente y datos -->
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="building-2"></i> Cliente y datos</h3></div>
            <div class="cc-panel-body" id="panelCliente"></div>
          </div>

          <!-- Equipos + piezas -->
          <div class="cc-panel">
            <div class="cc-panel-head">
              <h3><i data-lucide="package"></i> Equipos e intervenciones</h3>
              <span id="equiposMeta" style="font-size:12px; color:var(--fg-3);"></span>
            </div>
            <div class="cc-panel-body" id="panelEquipos"></div>
          </div>
        </div>

        <!-- Sidebar resumen -->
        <div class="cc-summary">
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="calculator"></i> Resumen</h3></div>
            <div class="cc-panel-body" id="panelResumen"></div>
          </div>
        </div>
      </div>
    `;

    renderCliente();
    renderEquipos();
    renderResumen();
    $('btnCancelar').addEventListener('click', () => { location.href = 'index.html'; });
    $('btnGenerar').addEventListener('click', generar);
    $('btnPreview').addEventListener('click', abrirPreview);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Consumos del taller (piezas registradas por el técnico) ────────────────
  // Indexados por equipoId; se intenta casar por id y, como respaldo, por serial
  // (equipos legacy sin id guardaban consumos bajo el número de serie).
  function consumosDe(eq) {
    return consumosPorEquipo[eq.id] || consumosPorEquipo[eq.serial] || [];
  }

  // ── Cliente / meta ─────────────────────────────────────────────────────────
  function renderCliente() {
    const cli = catalogos.clientesById[form.clienteId] || {};
    const sinCliente = !form.clienteId;
    $('panelCliente').innerHTML = `
      ${sinCliente ? `<div class="form-hint" style="color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:6px 8px; margin-bottom:10px; font-size:12px;">
        Esta orden no tiene un cliente vinculado. Selecciona uno para poder generar la cotización.
      </div>` : ''}
      <div class="form-field">
        <label class="form-label">Cliente (Para) <span class="req">*</span></label>
        <select class="form-select" id="selCliente">
          <option value="">Seleccione…</option>
          ${catalogos.clientes.map(c => `<option value="${esc(c.id)}" ${c.id === form.clienteId ? 'selected' : ''}>${esc(c.razon)}</option>`).join('')}
        </select>
        <div class="cc-dp-ln" style="margin-top:8px;">
          ${cli.representante ? `<b>Representante:</b> ${esc(cli.representante)}<br>` : ''}
          RUC <span class="mono">${esc(cli.ruc || '—')}</span> · Tel <span class="mono">${esc(cli.tel || '—')}</span><br>
          ${esc(cli.email || '')}
        </div>
      </div>

      <div class="cc-meta-grid" style="margin-top:16px;">
        <div class="form-field">
          <label class="form-label">Fecha</label>
          <input type="date" class="form-input" id="inpFecha" value="${esc(form.fecha)}">
        </div>
        <div class="form-field">
          <label class="form-label">Validez (días)</label>
          <input type="number" class="form-input" id="inpValidez" min="1" value="${esc(form.validezDias)}">
        </div>
        <div class="form-field">
          <label class="form-label">Ejecutivo (firmante)</label>
          <select class="form-select" id="selEjec">
            <option value="">—</option>
            ${catalogos.ejecutivos.map(e => `<option value="${esc(e.id)}" ${e.id === form.ejecutivoId ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="form-field" style="margin-top:16px;">
        <label class="form-label">Texto de introducción</label>
        <textarea class="form-textarea" rows="2" id="inpIntro">${esc(form.intro)}</textarea>
      </div>
    `;

    $('selCliente').addEventListener('change', (e) => {
      form.clienteId = e.target.value;
      const cli2 = catalogos.clientesById[form.clienteId];
      if (cli2) form.itbmsPct = cli2.itbms_exento ? 0 : Math.round(FMT.ITBMS_RATE * 100);
      renderCliente(); renderResumen();
    });
    $('inpFecha').addEventListener('change', (e) => { form.fecha = e.target.value; });
    $('inpValidez').addEventListener('input', (e) => { form.validezDias = Number(e.target.value || 0); });
    $('selEjec').addEventListener('change', (e) => { form.ejecutivoId = e.target.value; });
    $('inpIntro').addEventListener('input', (e) => { form.intro = e.target.value; });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Equipos + líneas de pieza ──────────────────────────────────────────────
  function renderEquipos() {
    $('equiposMeta').textContent = equipos.length + (equipos.length === 1 ? ' equipo' : ' equipos');
    const cont = $('panelEquipos');
    if (!equipos.length) {
      cont.innerHTML = '<div class="co-empty">Esta orden no tiene equipos.</div>';
      return;
    }
    cont.innerHTML = equipos.map(eq => equipoHtml(eq)).join('');
    cont.querySelectorAll('.co-equipo').forEach(wrap => bindEquipo(wrap));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function equipoHtml(eq) {
    const ls = lineas[eq.id] || [];
    const filas = ls.map(l => lineaHtml(eq.id, l)).join('');
    const cons = consumosDe(eq);
    const cobrables = cons.filter(c => (c.tipo || 'cobro') === 'cobro').length;
    const consHtml = cons.length ? `
      <div class="co-consumos">
        <div class="co-consumos-hd">
          <strong><i data-lucide="wrench"></i> Piezas / accesorios registrados por el técnico</strong>
          ${cobrables ? `<button class="btn btn-secondary btn-sm" data-add-cons-all="${esc(eq.id)}"><i data-lucide="plus"></i> Agregar cobrables (${cobrables})</button>` : ''}
        </div>
        <ul class="co-consumos-list">
          ${cons.map((c, i) => `<li>
            <span class="co-cons-main">${esc(c.pieza_nombre || 'Pieza')}${c.sku ? ' · <span class="mono">' + esc(c.sku) + '</span>' : ''}</span>
            <span class="co-cons-meta">${Number(c.qty || 0)} × ${FMT.money(c.precio_unit || 0)} <span class="co-cons-tipo tipo-${esc(c.tipo || 'cobro')}">${esc(c.tipo || 'cobro')}</span></span>
            <button class="btn btn-ghost btn-icon btn-sm" data-add-cons="${esc(eq.id)}" data-cons-idx="${i}" title="Agregar a la cotización"><i data-lucide="plus"></i></button>
          </li>`).join('')}
        </ul>
      </div>` : '';
    return `
      <div class="co-equipo" data-eq="${esc(eq.id)}">
        <div class="co-equipo-hd">
          <span class="serie">Serie: ${esc(eq.serial || '—')}</span>
          <span class="modelo">Modelo: ${esc(eq.modelo || '—')}</span>
          <button class="btn btn-ghost btn-sm co-cat-btn" data-cat="${esc(eq.id)}" style="margin-left:auto;"><i data-lucide="puzzle"></i> Catálogo de piezas</button>
        </div>
        <div class="co-interv ${eq.intervencion ? '' : 'vacia'}">
          <strong>Intervención:</strong> ${eq.intervencion ? esc(eq.intervencion) : 'Sin intervención registrada'}
        </div>
        ${consHtml}
        <table class="co-lineas">
          <thead>
            <tr>
              <th class="co-w-sku">Nº pieza</th>
              <th>Descripción</th>
              <th class="co-w-cant num">Cant.</th>
              <th class="co-w-precio num">Precio</th>
              <th class="co-w-total num">Total</th>
              <th class="co-w-acc"></th>
            </tr>
          </thead>
          <tbody data-rows="${esc(eq.id)}">${filas || ''}</tbody>
        </table>
        <button class="btn btn-secondary btn-sm" data-add="${esc(eq.id)}" style="margin-top:8px;"><i data-lucide="plus"></i> Agregar pieza</button>
      </div>
    `;
  }

  function lineaHtml(eqId, l) {
    const total = FMT.money(Number(l.cant || 0) * Number(l.precio || 0));
    return `
      <tr data-line="${esc(l.id)}">
        <td class="co-cell-rel">
          <input class="form-input co-sku" value="${esc(l.sku)}" placeholder="SKU / Nº" autocomplete="off">
          <div class="co-pza-pop" hidden></div>
        </td>
        <td><input class="form-input co-desc" value="${esc(l.nombre)}" placeholder="Descripción de la pieza/servicio"></td>
        <td class="num"><input class="form-input num co-cant" type="number" min="0" step="1" value="${esc(l.cant)}"></td>
        <td class="num"><input class="form-input num co-precio" type="number" min="0" step="0.01" value="${esc(l.precio)}"></td>
        <td class="num co-total">${total}</td>
        <td class="num"><button class="btn btn-ghost btn-icon btn-sm co-del" title="Quitar"><i data-lucide="trash-2"></i></button></td>
      </tr>
    `;
  }

  function bindEquipo(wrap) {
    const eqId = wrap.dataset.eq;
    const eq = equipos.find(x => x.id === eqId);
    wrap.querySelector('[data-add]')?.addEventListener('click', () => {
      (lineas[eqId] = lineas[eqId] || []).push({ id: uid(), sku: '', nombre: '', cant: 1, precio: 0 });
      renderEquipos(); renderResumen();
      // Foco en la última fila agregada de este equipo (tras el re-render)
      const w2 = [...document.querySelectorAll('.co-equipo')].find(x => x.dataset.eq === eqId);
      w2?.querySelector('tbody')?.lastElementChild?.querySelector('.co-sku')?.focus();
    });
    // Catálogo de piezas (facturación) para este equipo
    wrap.querySelector('[data-cat]')?.addEventListener('click', () => abrirCatalogo(eqId));
    // Consumos del técnico → agregar a la cotización
    wrap.querySelectorAll('[data-add-cons]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.consIdx);
        const c = eq ? consumosDe(eq)[idx] : null;
        if (c) { addConsumoLine(eqId, c); }
      });
    });
    wrap.querySelector('[data-add-cons-all]')?.addEventListener('click', () => {
      if (!eq) return;
      consumosDe(eq).filter(c => (c.tipo || 'cobro') === 'cobro').forEach(c => addConsumoLine(eqId, c, { silent: true }));
      renderEquipos(); renderResumen();
      Toast.show('Piezas cobrables agregadas', 'ok');
    });
    // Drop target para arrastrar piezas del catálogo a este equipo
    wrap.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('text/pieza-id')) { e.preventDefault(); wrap.classList.add('co-drop'); }
    });
    wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('co-drop'); });
    wrap.addEventListener('drop', (e) => {
      const pid = e.dataTransfer?.getData('text/pieza-id');
      wrap.classList.remove('co-drop');
      if (!pid) return;
      e.preventDefault();
      const p = piezas.find(x => x.id === pid);
      if (p) addPiezaLine(eqId, p);
    });
    wrap.querySelectorAll('tr[data-line]').forEach(row => bindLinea(eqId, row));
  }

  // Agrega una línea a partir de una pieza del catálogo (inventario_piezas).
  function addPiezaLine(eqId, p, { silent } = {}) {
    (lineas[eqId] = lineas[eqId] || []).push({
      id: uid(), sku: p.sku || '', nombre: p.nombre || p.descripcion || 'Pieza',
      cant: 1, precio: Number(p.precio_venta || 0),
    });
    if (!silent) { renderEquipos(); renderResumen(); Toast.show('Pieza agregada a la cotización', 'ok'); }
  }

  // Agrega una línea a partir de un consumo registrado por el técnico.
  function addConsumoLine(eqId, c, { silent } = {}) {
    (lineas[eqId] = lineas[eqId] || []).push({
      id: uid(), sku: c.sku || '', nombre: c.pieza_nombre || 'Pieza',
      cant: Number(c.qty || 1), precio: Number(c.precio_unit || 0),
    });
    if (!silent) { renderEquipos(); renderResumen(); Toast.show('Pieza agregada a la cotización', 'ok'); }
  }

  function bindLinea(eqId, row) {
    const lineId = row.dataset.line;
    const get = () => (lineas[eqId] || []).find(x => x.id === lineId);
    const recalc = () => {
      const l = get(); if (!l) return;
      row.querySelector('.co-total').textContent = FMT.money(Number(l.cant || 0) * Number(l.precio || 0));
      renderResumen();
    };
    const skuInput = row.querySelector('.co-sku');
    skuInput.addEventListener('input', (e) => { const l = get(); if (l) l.sku = e.target.value; openPop(row, eqId, lineId, e.target.value); });
    skuInput.addEventListener('focus', (e) => openPop(row, eqId, lineId, e.target.value));
    skuInput.addEventListener('keydown', (e) => onPopKeydown(e, row, eqId, lineId));
    row.querySelector('.co-desc').addEventListener('input', (e) => { const l = get(); if (l) l.nombre = e.target.value; });
    row.querySelector('.co-cant').addEventListener('input', (e) => { const l = get(); if (l) l.cant = Number(e.target.value || 0); recalc(); });
    row.querySelector('.co-precio').addEventListener('input', (e) => { const l = get(); if (l) l.precio = Number(e.target.value || 0); recalc(); });
    row.querySelector('.co-del').addEventListener('click', () => {
      lineas[eqId] = (lineas[eqId] || []).filter(x => x.id !== lineId);
      renderEquipos(); renderResumen();
    });
  }

  // ── Autocompletar piezas (inventario_piezas activas) ───────────────────────
  function buscarPiezas(term) {
    const q = (term || '').trim().toLowerCase();
    if (!q) return [];
    return piezas
      .filter(p => (p.nombre || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .slice(0, 8);
  }
  function openPop(row, eqId, lineId, term) {
    const pop = row.querySelector('.co-pza-pop');
    const matches = buscarPiezas(term);
    if (!matches.length) { pop.hidden = true; pop.innerHTML = ''; return; }
    pop.innerHTML = matches.map((p, i) => `
      <div class="co-pza-item${i === 0 ? ' active' : ''}" data-pid="${esc(p.id)}">
        <span>${esc(p.nombre || '—')}</span>
        <span class="meta">${esc(p.sku || '')} · ${FMT.money(p.precio_venta || 0)}</span>
      </div>`).join('');
    pop.hidden = false;
    pop.querySelectorAll('.co-pza-item').forEach(el => {
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickPieza(row, eqId, lineId, el.dataset.pid); });
    });
  }
  function pickPieza(row, eqId, lineId, pid) {
    const p = piezas.find(x => x.id === pid);
    if (!p) return;
    const l = (lineas[eqId] || []).find(x => x.id === lineId);
    if (!l) return;
    l.sku = p.sku || '';
    l.nombre = p.nombre || l.nombre;
    if (Number(p.precio_venta || 0) > 0) l.precio = Number(p.precio_venta);
    row.querySelector('.co-sku').value = l.sku;
    row.querySelector('.co-desc').value = l.nombre;
    row.querySelector('.co-precio').value = l.precio;
    row.querySelector('.co-total').textContent = FMT.money(Number(l.cant || 0) * Number(l.precio || 0));
    row.querySelector('.co-pza-pop').hidden = true;
    renderResumen();
  }
  function onPopKeydown(e, row, eqId, lineId) {
    const pop = row.querySelector('.co-pza-pop');
    if (pop.hidden) return;
    const items = [...pop.querySelectorAll('.co-pza-item')];
    const idx = items.findIndex(el => el.classList.contains('active'));
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.min(idx + 1, items.length - 1); items.forEach(i => i.classList.remove('active')); items[n]?.classList.add('active'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(idx - 1, 0); items.forEach(i => i.classList.remove('active')); items[n]?.classList.add('active'); }
    else if (e.key === 'Enter') { e.preventDefault(); const act = items.find(i => i.classList.contains('active')); if (act) pickPieza(row, eqId, lineId, act.dataset.pid); }
    else if (e.key === 'Escape') { pop.hidden = true; }
  }
  // Cierra popovers al click fuera
  document.addEventListener('mousedown', (e) => {
    document.querySelectorAll('.co-cell-rel').forEach(cell => {
      if (!cell.contains(e.target)) { const p = cell.querySelector('.co-pza-pop'); if (p) p.hidden = true; }
    });
  });

  // ── Resumen / totales ──────────────────────────────────────────────────────
  function itemsDeForm() {
    // Aplana las líneas por equipo en renglones de cotización, en orden de equipo.
    const items = [];
    equipos.forEach(eq => {
      (lineas[eq.id] || []).forEach(l => {
        const tieneContenido = (l.sku || '').trim() || (l.nombre || '').trim() || Number(l.precio) > 0;
        if (!tieneContenido) return;
        const ctx = `Equipo: Serie ${eq.serial || '—'} · Modelo ${eq.modelo || '—'}` +
          (eq.intervencion ? ` · Intervención: ${eq.intervencion}` : '');
        items.push({
          id: CotState.uid(),
          modelo: (l.sku || '').trim(),
          nombre: (l.nombre || '').trim() || (l.sku || '').trim() || 'Pieza',
          spec: ctx,
          cant: Number(l.cant || 0),
          precio: Number(l.precio || 0),
          desc: 0,
        });
      });
    });
    return items;
  }

  function uiActual() {
    return {
      items: itemsDeForm(),
      descuentoPct: Number(form.descuentoPct || 0),
      itbmsPct: Number(form.itbmsPct || 0),
    };
  }

  function renderResumen() {
    const t = T.calcTotales(uiActual());
    const cli = catalogos.clientesById[form.clienteId] || {};
    const itbmsRatePct = Math.round(FMT.ITBMS_RATE * 100);
    const exentoHint = cli.itbms_exento
      ? `<span class="form-hint" style="font-size:11px; color:var(--accent);">Cliente exento de ITBMS</span>` : '';
    $('panelResumen').innerHTML = `
      <div class="cc-sum-controls">
        <div class="form-field">
          <label class="form-label">Descuento global %</label>
          <input type="number" class="form-input" id="inpDesc" min="0" max="100" value="${esc(form.descuentoPct)}">
        </div>
        <div class="form-field">
          <label class="form-label">ITBMS</label>
          <select class="form-select" id="selItbms">
            <option value="${itbmsRatePct}" ${form.itbmsPct > 0 ? 'selected' : ''}>${itbmsRatePct}%</option>
            <option value="0" ${form.itbmsPct === 0 ? 'selected' : ''}>0% (exento)</option>
          </select>
          ${exentoHint}
        </div>
      </div>
      <div class="cc-sum-row"><span>Subtotal</span><span class="v">${FMT.money(t.subtotal)}</span></div>
      ${form.descuentoPct > 0 ? `<div class="cc-sum-row disc"><span>Descuento (${form.descuentoPct}%)</span><span class="v">−${FMT.money(t.descGlobal)}</span></div>` : ''}
      <div class="cc-sum-row"><span>${form.itbmsPct > 0 ? 'ITBMS (' + form.itbmsPct + '%)' : 'ITBMS exento'}</span><span class="v">${FMT.money(t.itbms)}</span></div>
      <div class="cc-sum-total"><span class="lbl">Total</span><span class="v">${FMT.money(t.total)}</span></div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:20px;">
        <button class="btn btn-secondary" id="btnPreview2" style="width:100%;"><i data-lucide="eye"></i> Vista previa</button>
        <button class="btn btn-primary" id="btnGenerar2" style="width:100%;"><i data-lucide="receipt"></i> Preparar cotización</button>
      </div>
      <p class="form-hint" style="font-size:11px; color:var(--fg-3); margin-top:10px; line-height:1.5;">
        Se creará una cotización en borrador y se notificará a los aprobadores configurados para su revisión y envío al cliente. La <b>vista previa</b> no guarda ni notifica.
      </p>
    `;
    $('inpDesc').addEventListener('input', (e) => { form.descuentoPct = Number(e.target.value || 0); renderResumen(); });
    $('selItbms').addEventListener('change', (e) => { form.itbmsPct = Number(e.target.value); renderResumen(); });
    $('btnGenerar2').addEventListener('click', generar);
    $('btnPreview2').addEventListener('click', abrirPreview);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Generar la cotización (borrador real) ──────────────────────────────────
  let generando = false;
  async function generar() {
    if (generando) return;
    if (!form.clienteId) { Toast.show('Selecciona un cliente.', 'warn'); return; }
    const items = itemsDeForm();
    if (!items.length) { Toast.show('Agrega al menos una pieza con precio.', 'warn'); return; }

    generando = true;
    try {
      const ui = CotState.nuevaCotizacion({ ejecutivoId: form.ejecutivoId, clienteId: form.clienteId });
      ui.id = await CotState.nextCotizacionId();
      ui.estado = 'borrador';
      ui.fecha = form.fecha;
      ui.validezDias = Number(form.validezDias || 15);
      ui.itbmsPct = Number(form.itbmsPct || 0);
      ui.descuentoPct = Number(form.descuentoPct || 0);
      ui.intro = form.intro || `Cotización correspondiente a la orden de servicio ${ordenId}.`;
      ui.items = items;
      ui.creado_por_uid = user.uid;
      ui.creado_por_email = user.email || null;

      const doc = CotState.toDoc(ui, { catalogos });
      doc.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
      doc.fecha_modificacion = firebase.firestore.FieldValue.serverTimestamp();
      // Trazabilidad orden ↔ cotización
      doc.orden_id = ordenId;
      doc.origen = 'orden';

      const ref = await CotizacionesService.addCotizacion(doc);

      // Notifica a ventas@ (mismo correo que una cotización nueva).
      try { await CotState.enqueueAprobacionMail({ doc, docId: ref.id, user }); }
      catch (e) { console.warn('No se pudo encolar el correo de aprobación:', e); }

      // Enlaza la cotización en la orden (no rompe si falla).
      try {
        await OrdenesService.updateOrder(ordenId, {
          cotizacion_doc_id: ref.id,
          cotizacion_id: ui.id,
          cotizaciones_ids: firebase.firestore.FieldValue.arrayUnion(ref.id),
        });
      } catch (e) { console.warn('No se pudo enlazar la cotización en la orden:', e); }

      Toast.show('Cotización ' + ui.id + ' creada · solicitud enviada a ventas@cecomunica.com', 'ok');
      setTimeout(() => { location.href = '../cotizaciones/detalle-cotizacion.html?id=' + encodeURIComponent(ref.id); }, 700);
    } catch (err) {
      console.error(err);
      Toast.show('Error al generar la cotización: ' + (err?.message || err), 'bad');
      generando = false;
    }
  }

  // ── Catálogo de piezas (drawer lateral, arrastrable a un equipo) ───────────
  let catalogoTargetEq = null;
  let catalogoEl = null;

  function ensureCatalogo() {
    if (catalogoEl) return catalogoEl;
    const el = document.createElement('div');
    el.className = 'co-cat-drawer';
    el.hidden = true;
    el.innerHTML = `
      <div class="co-cat-overlay" data-close="1"></div>
      <aside class="co-cat-panel" role="dialog" aria-label="Catálogo de piezas">
        <header class="co-cat-head">
          <div>
            <strong>Catálogo de piezas</strong>
            <div class="co-cat-target" style="font-size:12px; color:var(--fg-3);"></div>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm" data-close="1" title="Cerrar"><i data-lucide="x"></i></button>
        </header>
        <div class="co-cat-search">
          <input type="text" class="form-input" placeholder="Buscar por nombre o SKU…">
        </div>
        <div class="co-cat-list"></div>
        <p class="co-cat-hint">Haz clic en <b>＋</b> o arrastra una pieza sobre un equipo para agregarla.</p>
      </aside>`;
    document.body.appendChild(el);
    el.querySelectorAll('[data-close]').forEach(c => c.addEventListener('click', cerrarCatalogo));
    el.querySelector('.co-cat-search input').addEventListener('input', (e) => renderCatalogoList(e.target.value));
    // El backdrop deja pasar el puntero (para arrastrar a los equipos), así que
    // el cierre es por botón X o tecla Escape.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) cerrarCatalogo(); });
    catalogoEl = el;
    return el;
  }

  function abrirCatalogo(eqId) {
    catalogoTargetEq = eqId;
    const el = ensureCatalogo();
    const eq = equipos.find(x => x.id === eqId);
    el.querySelector('.co-cat-target').textContent = eq ? `Agregar a: Serie ${eq.serial || '—'} · ${eq.modelo || '—'}` : '';
    el.querySelector('.co-cat-search input').value = '';
    renderCatalogoList('');
    el.hidden = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => el.querySelector('.co-cat-search input')?.focus(), 30);
  }

  function cerrarCatalogo() { if (catalogoEl) catalogoEl.hidden = true; catalogoTargetEq = null; }

  function renderCatalogoList(term) {
    const list = catalogoEl.querySelector('.co-cat-list');
    const q = (term || '').trim().toLowerCase();
    const rows = piezas
      .filter(p => !q || (p.nombre || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .slice(0, 200);
    if (!rows.length) { list.innerHTML = '<div class="co-cat-empty">Sin coincidencias.</div>'; return; }
    list.innerHTML = rows.map(p => `
      <div class="co-cat-item" draggable="true" data-pid="${esc(p.id)}">
        <div class="co-cat-item-main">
          <span class="co-cat-item-name">${esc(p.nombre || p.descripcion || 'Pieza')}</span>
          <span class="co-cat-item-meta">${esc(p.sku || '—')} · ${FMT.money(p.precio_venta || 0)}${(p.cantidad != null) ? ' · stock ' + Number(p.cantidad) : ''}</span>
        </div>
        <button class="btn btn-secondary btn-icon btn-sm" data-add-pid="${esc(p.id)}" title="Agregar"><i data-lucide="plus"></i></button>
      </div>`).join('');
    list.querySelectorAll('.co-cat-item').forEach(item => {
      const pid = item.dataset.pid;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/pieza-id', pid);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
    list.querySelectorAll('[data-add-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = piezas.find(x => x.id === btn.dataset.addPid);
        if (p && catalogoTargetEq) addPiezaLine(catalogoTargetEq, p);
      });
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Vista previa (no guarda ni notifica) ───────────────────────────────────
  function abrirPreview() {
    const t = T.calcTotales(uiActual());
    const cli = catalogos.clientesById[form.clienteId] || {};
    const ejec = catalogos.ejecutivos.find(e => e.id === form.ejecutivoId);
    const equiposHtml = equipos.map(eq => {
      const ls = (lineas[eq.id] || []).filter(l => (l.sku || '').trim() || (l.nombre || '').trim() || Number(l.precio) > 0);
      const cons = consumosDe(eq);
      const consHtml = cons.length ? `
        <div class="cv-cons"><b>Accesorios / piezas intervenidas:</b>
          <ul>${cons.map(c => `<li>${esc(c.pieza_nombre || 'Pieza')}${c.sku ? ' (' + esc(c.sku) + ')' : ''} — ${Number(c.qty || 0)} u. · ${esc(c.tipo || 'cobro')}</li>`).join('')}</ul>
        </div>` : '';
      const lineasHtml = ls.length ? `
        <table class="cv-table">
          <thead><tr><th>Nº pieza</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
          <tbody>${ls.map(l => `<tr>
            <td>${esc(l.sku || '—')}</td><td>${esc(l.nombre || '—')}</td>
            <td class="num">${Number(l.cant || 0)}</td><td class="num">${FMT.money(l.precio || 0)}</td>
            <td class="num">${FMT.money(Number(l.cant || 0) * Number(l.precio || 0))}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p class="cv-muted">Sin renglones para este equipo.</p>';
      return `
        <section class="cv-eq">
          <h4>Serie ${esc(eq.serial || '—')} · Modelo ${esc(eq.modelo || '—')}</h4>
          <p class="cv-interv"><b>Intervención del técnico:</b> ${eq.intervencion ? esc(eq.intervencion) : '<i>Sin intervención registrada</i>'}</p>
          ${consHtml}
          ${lineasHtml}
        </section>`;
    }).join('');

    const ov = document.createElement('div');
    ov.className = 'co-preview-ov';
    ov.innerHTML = `
      <div class="co-preview-card" role="dialog" aria-label="Vista previa de cotización">
        <header class="co-preview-head">
          <strong><i data-lucide="eye"></i> Vista previa — no se ha guardado ni enviado</strong>
          <div>
            <button class="btn btn-ghost btn-sm" id="cvPrint"><i data-lucide="printer"></i> Imprimir</button>
            <button class="btn btn-ghost btn-icon btn-sm" id="cvClose" title="Cerrar"><i data-lucide="x"></i></button>
          </div>
        </header>
        <div class="co-preview-body" id="cvBody">
          <div class="cv-meta">
            <div><b>Cliente:</b> ${esc(cli.razon || '—')}${cli.ruc ? ' · RUC ' + esc(cli.ruc) : ''}</div>
            <div><b>Orden:</b> ${esc(ordenId)} · <b>Fecha:</b> ${esc(form.fecha)} · <b>Validez:</b> ${esc(form.validezDias)} días</div>
            <div><b>Ejecutivo:</b> ${esc(ejec?.nombre || '—')}</div>
            ${form.intro ? `<div><b>Introducción:</b> ${esc(form.intro)}</div>` : ''}
          </div>
          ${equiposHtml || '<p class="cv-muted">Esta orden no tiene equipos.</p>'}
          <div class="cv-tot">
            <div><span>Subtotal</span><span>${FMT.money(t.subtotal)}</span></div>
            ${form.descuentoPct > 0 ? `<div><span>Descuento (${form.descuentoPct}%)</span><span>−${FMT.money(t.descGlobal)}</span></div>` : ''}
            <div><span>${form.itbmsPct > 0 ? 'ITBMS (' + form.itbmsPct + '%)' : 'ITBMS exento'}</span><span>${FMT.money(t.itbms)}</span></div>
            <div class="cv-tot-total"><span>Total</span><span>${FMT.money(t.total)}</span></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.body.classList.add('co-previewing');
    const close = () => { ov.remove(); document.body.classList.remove('co-previewing'); };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('#cvClose').addEventListener('click', close);
    ov.querySelector('#cvPrint').addEventListener('click', () => window.print());
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  verificarAccesoYAplicarVisibilidad(async (rol) => {
    if (!canRole(rol, 'preparar-cotizacion')) { Toast.show('Sin acceso', 'bad'); location.href = 'index.html'; return; }
    rolUsuario = rol;

    user = firebase.auth().currentUser;
    if (!ordenId) { Toast.show('Falta el id de la orden', 'bad'); location.href = 'index.html'; return; }

    orden = await OrdenesService.getOrder(ordenId);
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); location.href = 'index.html'; return; }
    equipos = prepararEquipos(orden);

    // Piezas/accesorios que el técnico ya registró en el taller (consumos),
    // para mostrarlas y poder jalarlas a la cotización sin reescribir.
    try {
      const allCons = await OrdenesService.getConsumos(ordenId);
      consumosPorEquipo = {};
      (allCons || []).forEach(c => { const k = c.equipoId || 'X'; (consumosPorEquipo[k] = consumosPorEquipo[k] || []).push(c); });
    } catch (e) { console.warn('No se pudieron cargar las piezas del taller (consumos):', e); }

    catalogos = await CotState.bootstrapCatalogos();
    piezas = (await PiezasService.getPiezas()).filter(p => p.activo !== false);

    // Cliente por defecto: el vinculado a la orden (si existe en el catálogo).
    if (orden.cliente_id && catalogos.clientesById[orden.cliente_id]) {
      form.clienteId = orden.cliente_id;
      const cli = catalogos.clientesById[form.clienteId];
      if (cli) form.itbmsPct = cli.itbms_exento ? 0 : Math.round(FMT.ITBMS_RATE * 100);
    }
    // Ejecutivo por defecto: el usuario actual si es vendedor, si no el primero.
    form.ejecutivoId = catalogos.ejecutivos.find(e => e.id === user.uid)?.id || catalogos.ejecutivos[0]?.id || '';

    render();
  });
})();

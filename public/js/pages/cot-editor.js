// @ts-nocheck
// Editor de cotización — compartido por nueva-cotizacion.html y editar-cotizacion.html
// Renderiza el grid de 2 columnas: paneles (Cliente / Renglones / Condiciones) + Resumen.
(() => {
  let draft = null;
  let catalogos = null;
  let dragId = null;
  let overId = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = window.CotizacionTotales;

  // ── Utils ──────────────────────────────────────────────────────
  function set(patch) { draft = { ...draft, ...patch }; renderTodo(); }
  function setItems(items) { draft = { ...draft, items }; renderItems(); renderSummary(); }
  function setCondiciones(condiciones) { draft = { ...draft, condiciones }; renderCondiciones(); }
  function fmtFechaCorta(iso) {
    if (!iso) return '—';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ── Render principal ──────────────────────────────────────────
  function renderTodo() {
    const esNueva = document.body.dataset.modo === 'nueva';
    const titulo = esNueva ? 'Nueva cotización' : (draft.id || draft._docId);
    const subtitulo = esNueva
      ? 'Al guardar se enviará una solicitud de aprobación a ventas@cecomunica.com.'
      : ('Editando · ' + (CotState.ESTADOS[draft.estado] || {}).label);

    $('editorMount').innerHTML = `
      <nav class="app-breadcrumbs" aria-label="Breadcrumb">
        <a href="index.html">Cotizaciones</a>
        <span class="app-breadcrumbs-sep"><i data-lucide="chevron-right"></i></span>
        <span class="app-breadcrumbs-current">${esc(titulo)}</span>
      </nav>

      <div class="app-page-header">
        <div>
          <h1>${esc(titulo)}</h1>
          <p>${esc(subtitulo)}</p>
        </div>
        <div class="app-page-header-actions">
          <button class="btn btn-ghost" id="btnCancelar"><i data-lucide="x"></i> Cancelar</button>
          <button class="btn btn-secondary" id="btnPreview"><i data-lucide="eye"></i> Vista previa</button>
          <button class="btn btn-primary" id="btnGuardar"><i data-lucide="save"></i> Guardar</button>
        </div>
      </div>

      <div class="cc-editor-grid">
        <div>
          <!-- Cliente y datos -->
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="building-2"></i> Cliente y datos</h3></div>
            <div class="cc-panel-body" id="panelCliente"></div>
          </div>

          <!-- Renglones -->
          <div class="cc-panel">
            <div class="cc-panel-head">
              <h3><i data-lucide="list"></i> Renglones</h3>
              <span id="renglonesMeta" style="font-size:12px; color:var(--fg-3);"></span>
            </div>
            <div class="cc-panel-body">
              <div class="cc-items">
                <div class="cc-items-head">
                  <span></span><span>Descripción</span><span class="c">Cant.</span>
                  <span class="r">Precio unit.</span><span class="c">Desc. %</span>
                  <span class="r">Total</span><span></span>
                </div>
                <div id="itemsList"></div>
              </div>
              <button class="btn btn-secondary cc-add-row" id="btnAddItem"><i data-lucide="plus"></i> Agregar renglón</button>
            </div>
          </div>

          <!-- Condiciones -->
          <div class="cc-panel">
            <div class="cc-panel-head">
              <h3><i data-lucide="clipboard-check"></i> Condiciones</h3>
              <select class="form-select" id="plantillaCond" style="width:240px; height:32px;">
                <option value="">Aplicar plantilla…</option>
                ${CotState.PLANTILLAS_COND.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
              </select>
            </div>
            <div class="cc-panel-body">
              <div id="condList"></div>
              <button class="btn btn-secondary cc-add-row" id="btnAddCond"><i data-lucide="plus"></i> Agregar condición</button>
            </div>
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
    renderItems();
    renderCondiciones();
    renderSummary();
    bindHeader();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Cliente y meta ────────────────────────────────────────────
  function renderCliente() {
    const cliente = catalogos.clientesById[draft.clienteId] || {};
    const emisor = catalogos.emisor;
    const vence = T.validezVence(draft);
    // Valores efectivos (override por-cotización si el usuario los completó)
    const dirA = draft.dirigido_a || cliente.representante || '';
    const dirEmail = draft.dirigido_email || cliente.email || '';
    $('panelCliente').innerHTML = `
      <div class="cc-dp">
        <div class="cc-dp-card">
          <div class="cc-dp-lbl">De</div>
          <div class="cc-dp-co">${esc(emisor.razon)}</div>
          <div class="cc-dp-ln">
            RUC <span class="mono">${esc(emisor.ruc)}</span><br>
            ${esc(emisor.dir1)}<br>${esc(emisor.dir2)}<br>
            Tel <span class="mono">${esc(emisor.tel)}</span>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label" style="display:flex; align-items:center; justify-content:space-between;">
            <span>Cliente (Para) <span class="req">*</span></span>
            <button type="button" class="btn btn-ghost btn-sm" id="btnNuevoCliente" style="height:24px; padding:0 8px; font-size:11px;">
              <i data-lucide="plus"></i> Nuevo cliente
            </button>
          </label>
          <select class="form-select" id="selCliente">
            <option value="">Seleccione…</option>
            ${catalogos.clientes.map(c => `<option value="${esc(c.id)}" ${c.id === draft.clienteId ? 'selected' : ''}>${esc(c.razon)}</option>`).join('')}
          </select>
          <div class="cc-dp-ln" style="margin-top:8px;">
            ${cliente.representante ? `<b>Representante legal:</b> ${esc(cliente.representante)}<br>` : ''}
            RUC <span class="mono">${esc(cliente.ruc || '—')}</span><br>
            Tel <span class="mono">${esc(cliente.tel || '—')}</span> · ${esc(cliente.email || '')}
          </div>
        </div>
      </div>

      <!-- Dirigido a / Email destinatario (override del cliente) -->
      <div class="cc-meta-grid" style="margin-top:16px; grid-template-columns:1fr 1fr;">
        <div class="form-field">
          <label class="form-label">Atención / Dirigido a</label>
          <input type="text" class="form-input" id="inpDirigidoA"
                 value="${esc(dirA)}"
                 placeholder="${esc(cliente.representante || 'Nombre del destinatario')}">
          <span class="form-hint" style="font-size:11px; color:var(--fg-3);">
            Por defecto se usa el representante legal del cliente. Puedes cambiarlo si la cotización va a otra persona.
          </span>
        </div>
        <div class="form-field">
          <label class="form-label">Email destinatario</label>
          <input type="email" class="form-input" id="inpDirigidoEmail"
                 value="${esc(dirEmail)}"
                 placeholder="${esc(cliente.email || 'destino@empresa.com')}">
          <span class="form-hint" style="font-size:11px; color:var(--fg-3);">
            Correo al que se enviará la cotización (puede diferir del email del cliente).
          </span>
        </div>
      </div>

      <div class="cc-meta-grid" style="margin-top:16px;">
        <div class="form-field">
          <label class="form-label">Fecha</label>
          <input type="date" class="form-input" id="inpFecha" value="${esc(draft.fecha)}">
        </div>
        <div class="form-field">
          <label class="form-label">Validez (días)</label>
          <input type="number" class="form-input" id="inpValidez" min="1" value="${esc(draft.validezDias)}">
        </div>
        <div class="form-field">
          <label class="form-label">Moneda</label>
          <select class="form-select" id="selMoneda">
            <option value="USD" ${draft.moneda === 'USD' ? 'selected' : ''}>USD</option>
            <option value="PAB" ${draft.moneda === 'PAB' ? 'selected' : ''}>PAB</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Ejecutivo (firmante)</label>
          <select class="form-select" id="selEjec">
            <option value="">—</option>
            ${catalogos.ejecutivos.map(e => `<option value="${esc(e.id)}" ${e.id === draft.ejecutivoId ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Vence</label>
          <input type="text" class="form-input" disabled value="${esc(fmtFechaCorta(vence))}">
        </div>
      </div>

      <div class="form-field" style="margin-top:16px;">
        <label class="form-label">Texto de introducción</label>
        <textarea class="form-textarea" rows="2" id="inpIntro">${esc(draft.intro)}</textarea>
      </div>
    `;

    $('btnNuevoCliente').addEventListener('click', () => {
      location.href = '../contratos/nuevo-cliente.html?from=cotizacion';
    });
    $('selCliente').addEventListener('change', (e) => {
      const newId = e.target.value;
      // Auto-ajusta ITBMS al flag itbms_exento del cliente (mismo patrón que contratos).
      const cli = catalogos.clientesById[newId];
      const patch = { clienteId: newId };
      if (cli) {
        patch.itbmsPct = cli.itbms_exento ? 0 : Math.round(FMT.ITBMS_RATE * 100);
      }
      set(patch);
    });
    $('inpDirigidoA').addEventListener('input', (e) => { draft.dirigido_a = e.target.value; });
    $('inpDirigidoEmail').addEventListener('input', (e) => { draft.dirigido_email = e.target.value; });
    $('inpFecha').addEventListener('change', (e) => { draft.fecha = e.target.value; renderCliente(); });
    $('inpValidez').addEventListener('input', (e) => { draft.validezDias = Number(e.target.value || 0); });
    $('inpValidez').addEventListener('change', () => renderCliente());
    $('selMoneda').addEventListener('change', (e) => { draft.moneda = e.target.value; });
    $('selEjec').addEventListener('change', (e) => { draft.ejecutivoId = e.target.value; });
    $('inpIntro').addEventListener('input', (e) => { draft.intro = e.target.value; });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Renglones ─────────────────────────────────────────────────
  function renderItems() {
    const total = draft.items.length;
    const unidades = T.cuenta(draft.items);
    $('renglonesMeta').textContent = total + ' líneas · ' + unidades + ' unidades';

    const list = $('itemsList');
    list.innerHTML = draft.items.map(it => itemRowHtml(it)).join('');

    // Bind por fila
    list.querySelectorAll('.cc-item-row').forEach(row => bindItemRow(row));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function itemRowHtml(it) {
    const totalLinea = FMT.money(T.lineTotal(it));
    return `
      <div class="cc-item-row" data-id="${it.id}" draggable="true">
        <span class="cc-item-handle" title="Arrastrar para reordenar"><i data-lucide="grip-vertical"></i></span>
        <div class="cc-item-desc">
          <input class="form-input cc-item-nombre" placeholder="Buscar producto o escribir descripción…" value="${esc(it.nombre)}" autocomplete="off">
          <div class="cc-item-spec"><input class="form-input cc-item-spec-input" placeholder="Especificación (opcional)" value="${esc(it.spec)}"></div>
          <div class="cc-cat-pop" hidden></div>
        </div>
        <input class="form-input ctr-input cc-item-cant" type="number" min="0" value="${esc(it.cant)}">
        <input class="form-input num-input cc-item-precio" type="number" min="0" step="0.01" value="${esc(it.precio)}">
        <input class="form-input ctr-input cc-item-descpct" type="number" min="0" max="100" value="${esc(it.desc)}">
        <span class="cc-item-total">${totalLinea}</span>
        <button class="btn btn-ghost btn-icon btn-sm cc-item-del" title="Eliminar"><i data-lucide="trash-2"></i></button>
      </div>
    `;
  }

  function bindItemRow(row) {
    const id = row.dataset.id;
    const getIt = () => draft.items.find(x => x.id === id);
    const upd = (patch) => {
      const it = getIt(); if (!it) return;
      Object.assign(it, patch);
      // Actualiza total de la fila sin re-render completo.
      row.querySelector('.cc-item-total').textContent = FMT.money(T.lineTotal(it));
      renderSummary();
    };

    row.querySelector('.cc-item-nombre').addEventListener('input', (e) => { upd({ nombre: e.target.value }); openCatPop(row, e.target.value); });
    row.querySelector('.cc-item-nombre').addEventListener('focus', (e) => openCatPop(row, e.target.value));
    row.querySelector('.cc-item-nombre').addEventListener('keydown', (e) => onCatKeydown(e, row));
    row.querySelector('.cc-item-spec-input').addEventListener('input', (e) => { const it = getIt(); if (it) it.spec = e.target.value; });
    row.querySelector('.cc-item-cant').addEventListener('input', (e) => upd({ cant: Number(e.target.value || 0) }));
    row.querySelector('.cc-item-precio').addEventListener('input', (e) => upd({ precio: Number(e.target.value || 0) }));
    row.querySelector('.cc-item-descpct').addEventListener('input', (e) => upd({ desc: Number(e.target.value || 0) }));
    row.querySelector('.cc-item-del').addEventListener('click', () => {
      setItems(draft.items.filter(x => x.id !== id));
    });

    // Drag/drop
    row.addEventListener('dragstart', () => { dragId = id; row.classList.add('cc-dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('cc-dragging'); dragId = null; clearDragOver(); });
    row.addEventListener('dragover', (e) => { e.preventDefault(); if (dragId && dragId !== id) { clearDragOver(); row.classList.add('cc-drag-over'); overId = id; } });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === id) return;
      const arr = draft.items.slice();
      const fi = arr.findIndex(x => x.id === dragId);
      const ti = arr.findIndex(x => x.id === id);
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      setItems(arr);
    });
  }

  function clearDragOver() {
    document.querySelectorAll('.cc-item-row.cc-drag-over').forEach(el => el.classList.remove('cc-drag-over'));
    overId = null;
  }

  // ── Autocompletar catálogo ────────────────────────────────────
  function openCatPop(row, term) {
    const pop = row.querySelector('.cc-cat-pop');
    const t = (term || '').toLowerCase();
    const matches = (catalogos.catalogo || [])
      .filter(c => !t || (c.nombre + ' ' + c.modelo + ' ' + c.cat).toLowerCase().includes(t))
      .slice(0, 8);
    if (!matches.length) { pop.hidden = true; pop.innerHTML = ''; return; }
    pop.innerHTML = matches.map((p, i) => `
      <div class="cc-cat-item${i === 0 ? ' active' : ''}" data-modelo="${esc(p.modelo)}">
        <div class="cc-cat-name">${esc(p.nombre)}</div>
        <div class="cc-cat-meta">
          <span class="cc-cat-model">${esc(p.modelo)}</span>
          <span>${esc(p.cat)}</span>
          <span class="cc-cat-price">${FMT.money(p.precio)}</span>
        </div>
      </div>
    `).join('');
    pop.hidden = false;
    pop.querySelectorAll('.cc-cat-item').forEach(el => {
      el.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickCat(row, el.dataset.modelo); });
    });
  }
  function pickCat(row, modelo) {
    const p = (catalogos.catalogo || []).find(x => x.modelo === modelo);
    if (!p) return;
    const id = row.dataset.id;
    const it = draft.items.find(x => x.id === id);
    if (!it) return;
    it.modelo = p.modelo; it.nombre = p.nombre; it.spec = p.spec; it.precio = p.precio;
    row.querySelector('.cc-item-nombre').value = p.nombre;
    row.querySelector('.cc-item-spec-input').value = p.spec || '';
    row.querySelector('.cc-item-precio').value = p.precio;
    row.querySelector('.cc-item-total').textContent = FMT.money(T.lineTotal(it));
    row.querySelector('.cc-cat-pop').hidden = true;
    renderSummary();
  }
  function onCatKeydown(e, row) {
    const pop = row.querySelector('.cc-cat-pop');
    if (pop.hidden) return;
    const items = [...pop.querySelectorAll('.cc-cat-item')];
    const idx = items.findIndex(el => el.classList.contains('active'));
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.min(idx + 1, items.length - 1); items.forEach(i => i.classList.remove('active')); items[n]?.classList.add('active'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(idx - 1, 0); items.forEach(i => i.classList.remove('active')); items[n]?.classList.add('active'); }
    else if (e.key === 'Enter') { e.preventDefault(); const act = items.find(i => i.classList.contains('active')); if (act) pickCat(row, act.dataset.modelo); }
    else if (e.key === 'Escape') { pop.hidden = true; }
  }

  // Cierra popovers al click fuera
  document.addEventListener('mousedown', (e) => {
    document.querySelectorAll('.cc-item-row').forEach(row => {
      if (!row.contains(e.target)) row.querySelector('.cc-cat-pop').hidden = true;
    });
  });

  // ── Condiciones ───────────────────────────────────────────────
  function renderCondiciones() {
    const cont = $('condList');
    cont.innerHTML = draft.condiciones.map((c, i) => `
      <div class="cc-cond-row" data-i="${i}">
        <input class="form-input cc-cond-k" placeholder="Concepto" value="${esc(c.k)}">
        <input class="form-input cc-cond-v" placeholder="Detalle" value="${esc(c.v)}">
        <button class="btn btn-ghost btn-icon btn-sm cc-item-del" title="Eliminar"><i data-lucide="trash-2"></i></button>
      </div>
    `).join('');
    cont.querySelectorAll('.cc-cond-row').forEach(row => {
      const i = Number(row.dataset.i);
      row.querySelector('.cc-cond-k').addEventListener('input', (e) => { draft.condiciones[i].k = e.target.value; });
      row.querySelector('.cc-cond-v').addEventListener('input', (e) => { draft.condiciones[i].v = e.target.value; });
      row.querySelector('.cc-item-del').addEventListener('click', () => {
        setCondiciones(draft.condiciones.filter((_, j) => j !== i));
      });
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Resumen ───────────────────────────────────────────────────
  function renderSummary() {
    const t = T.calcTotales(draft);
    const cli = catalogos.clientesById[draft.clienteId] || {};
    const itbmsRatePct = Math.round(FMT.ITBMS_RATE * 100);
    const exentoHint = cli.itbms_exento
      ? `<span class="form-hint" style="font-size:11px; color:var(--accent);">Cliente exento de ITBMS${cli.itbms_motivo_exencion ? ' · ' + esc(cli.itbms_motivo_exencion) : ''}</span>`
      : '';
    $('panelResumen').innerHTML = `
      <div class="cc-sum-controls">
        <div class="form-field">
          <label class="form-label">Descuento global %</label>
          <input type="number" class="form-input" id="inpDesc" min="0" max="100" value="${esc(draft.descuentoPct)}">
        </div>
        <div class="form-field">
          <label class="form-label">ITBMS</label>
          <select class="form-select" id="selItbms">
            <option value="${itbmsRatePct}" ${draft.itbmsPct > 0 ? 'selected' : ''}>${itbmsRatePct}%</option>
            <option value="0" ${draft.itbmsPct === 0 ? 'selected' : ''}>0% (exento)</option>
          </select>
          ${exentoHint}
        </div>
      </div>
      <div class="cc-sum-row"><span>Subtotal</span><span class="v">${FMT.money(t.subtotal)}</span></div>
      ${draft.descuentoPct > 0 ? `<div class="cc-sum-row disc"><span>Descuento (${draft.descuentoPct}%)</span><span class="v">−${FMT.money(t.descGlobal)}</span></div>` : ''}
      <div class="cc-sum-row"><span>${draft.itbmsPct > 0 ? 'ITBMS (' + draft.itbmsPct + '%)' : 'ITBMS exento'}</span><span class="v">${FMT.money(t.itbms)}</span></div>
      <div class="cc-sum-total"><span class="lbl">Total</span><span class="v">${FMT.money(t.total)}</span></div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:20px;">
        <button class="btn btn-primary" id="btnGuardar2" style="width:100%;"><i data-lucide="save"></i> Guardar cotización</button>
        <button class="btn btn-secondary" id="btnPreview2" style="width:100%;"><i data-lucide="printer"></i> Vista previa / Imprimir</button>
      </div>
    `;
    $('inpDesc').addEventListener('input', (e) => { draft.descuentoPct = Number(e.target.value || 0); renderSummary(); });
    $('selItbms').addEventListener('change', (e) => { draft.itbmsPct = Number(e.target.value); renderSummary(); });
    $('btnGuardar2').addEventListener('click', guardar);
    $('btnPreview2').addEventListener('click', preview);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function bindHeader() {
    $('btnCancelar').addEventListener('click', () => { location.href = 'index.html'; });
    $('btnGuardar').addEventListener('click', guardar);
    $('btnPreview').addEventListener('click', preview);
    $('btnAddItem').addEventListener('click', () => {
      setItems([...draft.items, { id: CotState.uid(), modelo: '', nombre: '', spec: '', cant: 1, precio: 0, desc: 0 }]);
    });
    $('btnAddCond').addEventListener('click', () => {
      setCondiciones([...draft.condiciones, { k: '', v: '' }]);
    });
    $('plantillaCond').addEventListener('change', (e) => {
      const p = CotState.PLANTILLAS_COND.find(x => x.id === e.target.value);
      if (p) setCondiciones(JSON.parse(JSON.stringify(p.cond)));
      e.target.value = '';
    });
  }

  // ── Guardar / preview ─────────────────────────────────────────
  function validar() {
    if (!draft.clienteId) { Toast.show('Selecciona un cliente.', 'warn'); return false; }
    if (!draft.items || !draft.items.length) { Toast.show('Agrega al menos un renglón.', 'warn'); return false; }
    return true;
  }

  async function guardar() {
    if (!validar()) return;
    const esNueva = document.body.dataset.modo === 'nueva';
    const user = firebase.auth().currentUser;
    try {
      if (esNueva) {
        if (!draft.id) draft.id = await CotState.nextCotizacionId();
        // Todas las cotizaciones nuevas nacen en borrador, pendientes de aprobación interna.
        draft.estado = 'borrador';
        draft.creado_por_uid = user?.uid || null;
        draft.creado_por_email = user?.email || null;
        const doc = CotState.toDoc(draft, { catalogos });
        doc.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
        doc.fecha_modificacion = firebase.firestore.FieldValue.serverTimestamp();
        const ref = await CotizacionesService.addCotizacion(doc);
        await enqueueAprobacionMail(doc, ref.id, user);
        Toast.show('Cotización ' + draft.id + ' guardada · solicitud enviada a ventas@cecomunica.com', 'ok');
        setTimeout(() => { location.href = 'detalle-cotizacion.html?id=' + encodeURIComponent(ref.id); }, 800);
      } else {
        // Defensa adicional: nunca persistir cambios sobre una cotización no editable.
        if (!CotState.esEditable(draft.estado)) {
          Toast.show('Esta cotización ya no es editable.', 'warn');
          return;
        }
        const doc = CotState.toDoc(draft, { catalogos });
        doc.fecha_modificacion = firebase.firestore.FieldValue.serverTimestamp();
        await CotizacionesService.updateCotizacion(draft._docId, doc);
        Toast.show('Cambios guardados', 'ok');
        location.href = 'detalle-cotizacion.html?id=' + encodeURIComponent(draft._docId);
      }
    } catch (err) {
      console.error(err);
      Toast.show('Error al guardar: ' + (err?.message || err), 'bad');
    }
  }

  // Encola correo de solicitud de aprobación a ventas@cecomunica.com — la lógica
  // vive en CotState para que duplicar (lista / detalle) reuse el mismo correo.
  async function enqueueAprobacionMail(doc, docId, user) {
    try {
      await CotState.enqueueAprobacionMail({ doc, docId, user });
    } catch (e) {
      console.warn('No se pudo encolar el correo de aprobación:', e);
      Toast.show('⚠️ Cotización guardada, pero no se pudo encolar el correo de aprobación.', 'warn');
    }
  }

  async function preview() {
    if (!validar()) return;
    if (document.body.dataset.modo === 'editar' && draft._docId) {
      window.open('imprimir-cotizacion.html?id=' + encodeURIComponent(draft._docId), '_blank');
      return;
    }
    // En modo nueva, guardamos primero como borrador para tener id.
    await guardar();
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR, ROLES.JEFE_TALLER];
      if (!permitidos.includes(rol)) { Toast.show('Sin acceso', 'bad'); location.href = '../index.html'; return; }

      catalogos = await CotState.bootstrapCatalogos();
      const esNueva = document.body.dataset.modo === 'nueva';
      const params = new URLSearchParams(location.search);

      if (esNueva) {
        const ejecId = catalogos.ejecutivos.find(e => e.id === user.uid)?.id || catalogos.ejecutivos[0]?.id || '';
        const preselectCliente = params.get('cliente_id') || '';
        draft = CotState.nuevaCotizacion({ ejecutivoId: ejecId, clienteId: preselectCliente });
        // Si hay cliente preseleccionado, alinea ITBMS al flag del cliente.
        if (preselectCliente) {
          const cli = catalogos.clientesById[preselectCliente];
          if (cli) draft.itbmsPct = cli.itbms_exento ? 0 : Math.round(FMT.ITBMS_RATE * 100);
        }
      } else {
        const docId = params.get('id');
        if (!docId) { Toast.show('Falta id', 'bad'); location.href = 'index.html'; return; }
        const doc = await CotizacionesService.getCotizacion(docId);
        if (!doc) { Toast.show('No encontrada', 'bad'); location.href = 'index.html'; return; }
        draft = CotState.toUi(doc);
        // Solo se editan borradores. Una cotización aprobada/enviada/convertida/
        // rechazada/vencida es un registro inmutable (ni admin la edita): si se
        // llega por URL directa, se redirige al detalle.
        if (!CotState.esEditable(draft.estado)) {
          const lbl = (CotState.ESTADOS[draft.estado] || {}).label || draft.estado;
          Toast.show('Esta cotización (' + lbl + ') ya no es editable. Usa "Duplicar" para crear una nueva versión.', 'warn');
          location.href = 'detalle-cotizacion.html?id=' + encodeURIComponent(docId);
          return;
        }
        // Vendedor solo puede editar lo suyo
        if (AUTH.is(ROLES.VENDEDOR) && draft.creado_por_uid && draft.creado_por_uid !== user.uid) {
          Toast.show('Solo el creador o un administrador puede editar esta cotización.', 'bad');
          location.href = 'detalle-cotizacion.html?id=' + encodeURIComponent(docId);
          return;
        }
      }
      renderTodo();
    });
  });
})();

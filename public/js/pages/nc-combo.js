// @ts-nocheck
// nuevo-contrato client combobox — search, recents, keyboard navigation
window.NCCombo = {
  idx:              -1,
  items:            [],
  currentQuery:     '',
  currentQueryParts: [],
  RECENTS_KEY:      'clientes_recent_v1',

  renderInfoCliente(id) {
    const c    = NC.listaClientes[id];
    const html = c ? `
      📍 <b>Dirección:</b> ${NC.escapeHtml(c.direccion || '')}<br>
      🧾 <b>RUC:</b> ${NC.escapeHtml(c.ruc || '')}${c.dv ? ' - DV' + c.dv : ''}<br>
      📧 <b>Email:</b> ${NC.escapeHtml(c.email || '')}<br>
      ☎️ <b>Tel:</b> ${NC.escapeHtml(c.telefono || '')}
    ` : '';
    document.getElementById('infoCliente').innerHTML = html;
    document.getElementById('btnEditarCliente').disabled = !id;
  },

  highlightQuery(text) {
    if (!text) return '';
    if (!this.currentQueryParts.length) return NC.escapeHtml(text);
    let out = text;
    this.currentQueryParts.forEach(t => {
      if (!t) return;
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  },

  showLoading() {
    const $list = document.getElementById('clienteList');
    $list.innerHTML = `<div class="combo-empty">Buscando…</div>`;
    $list.hidden = false;
  },

  showEmpty() {
    const $list  = document.getElementById('clienteList');
    const $combo = document.getElementById('clienteCombo');
    const propuesta = NC.escapeHtml(($combo.value || '').trim());
    $list.innerHTML = `
      <div class="combo-empty">
        Sin resultados.<br>
        <button type="button" class="btn btn-pill" id="btnCrearDesdeCombo">
          ➕ Crear cliente${propuesta ? ` "${propuesta}"` : ''}
        </button>
      </div>`;
    $list.hidden = false;
    const $btn = document.getElementById('btnCrearDesdeCombo');
    if ($btn) $btn.onclick = () => window.open('../contratos/nuevo-cliente.html?redirect=true', '_blank');
  },

  loadRecent() {
    try { return JSON.parse(localStorage.getItem(this.RECENTS_KEY) || '[]'); } catch { return []; }
  },

  saveRecent(id) {
    const d = NC.listaClientes[id];
    if (!d) return;
    const rec = this.loadRecent().filter(x => x.id !== id);
    rec.unshift({ id, nombre: d.nombre || '', ruc: d.ruc || '', dv: d.dv || '' });
    localStorage.setItem(this.RECENTS_KEY, JSON.stringify(rec.slice(0, 5)));
  },

  renderRecent() {
    const $list = document.getElementById('clienteList');
    const rec   = this.loadRecent();
    if (!rec.length) { $list.hidden = true; return; }
    $list.innerHTML = '';
    const self = this;
    rec.forEach((r, i) => {
      const div       = document.createElement('div');
      div.className   = 'combo-item' + (i === 0 ? ' active' : '');
      div.dataset.id  = r.id;
      div.innerHTML   = `
        ${NC.escapeHtml(r.nombre || '(sin nombre)')}
        <span class="combo-sub">
          ${NC.escapeHtml((r.ruc || '') + (r.dv ? ' - DV' + r.dv : ''))} · reciente
        </span>`;
      div.onclick = () => self.selectCliente(r.id, true);
      $list.appendChild(div);
    });
    this.items  = rec.map(r => ({ id: r.id, d: r }));
    this.idx    = 0;
    $list.hidden = false;
  },

  renderCombo(items) {
    const $list = document.getElementById('clienteList');
    this.items  = items;
    this.idx    = items.length ? 0 : -1;
    $list.innerHTML = '';
    if (!items.length) { this.showEmpty(); return; }
    const self = this;
    items.forEach(({ id, d }, i) => {
      const div      = document.createElement('div');
      div.className  = 'combo-item' + (i === this.idx ? ' active' : '');
      div.dataset.id = id;
      div.innerHTML  = `
        ${self.highlightQuery(d.nombre || '(sin nombre)')}
        <span class="combo-sub">
          ${d.ruc || ''}${d.dv ? ' - DV' + d.dv : ''} ${d.representante ? '· ' + d.representante : ''}
        </span>`;
      div.onclick = () => self.selectCliente(id, true);
      $list.appendChild(div);
    });
    $list.hidden = false;
  },

  selectCliente(id, close = true) {
    const d = NC.listaClientes[id];
    if (!d) return;
    document.getElementById('cliente').value      = id;
    document.getElementById('clienteCombo').value = d.nombre || '';
    this.renderInfoCliente(id);
    if (close) document.getElementById('clienteList').hidden = true;
    this.saveRecent(id);
    NCForm.updateContratoBadges();
  },

  updateActive() {
    document.getElementById('clienteList').querySelectorAll('.combo-item')
      .forEach((n, i) => n.classList.toggle('active', i === this.idx));
  },

  init() {
    const self = this;

    // debounce lives here — only used by doSearch
    const _deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    const _norm = s => FMT.normalize(s);
    const _tokens = q => _norm(q).split(/[^a-z0-9]+/).filter(Boolean);

    this.doSearch = _deb(async text => {
      const parts = _tokens(text);
      self.currentQuery      = text;
      self.currentQueryParts = parts;

      if (parts.length < 1) { document.getElementById('clienteList').hidden = true; return; }
      self.showLoading();

      const rawDocs = await ClientesService.searchByToken(parts[0], { limit: 50 });
      const items   = [];
      NC.listaClientes = {};

      rawDocs.forEach(c => {
        const hasTokens = Array.isArray(c.searchTokens) && c.searchTokens.length;
        const pass = hasTokens
          ? parts.every(t => c.searchTokens.includes(t))
          : parts.every(t => _norm(c.nombre || '').includes(t));
        if (pass) { NC.listaClientes[c.id] = c; items.push({ id: c.id, d: c }); }
      });

      if (items.length === 0) {
        const prefixDocs = await ClientesService.searchByPrefix(text, 25);
        prefixDocs.forEach(d => {
          if (_norm(d.nombre || '').includes(_norm(text))) {
            NC.listaClientes[d.id] = d;
            items.push({ id: d.id, d });
          }
        });
      }

      if (items.length === 0) self.showEmpty();
      else self.renderCombo(items);
    }, 180);

    const $combo   = document.getElementById('clienteCombo');
    const $hidden  = document.getElementById('cliente');
    const $list    = document.getElementById('clienteList');
    const $btnEdit = document.getElementById('btnEditarCliente');
    const $btnClr  = document.getElementById('btnClearCliente');

    $combo.addEventListener('focus', () => {
      if (!$hidden.value && !$combo.value.trim()) self.renderRecent();
    });

    $combo.addEventListener('input', e => {
      const v = e.target.value;
      $hidden.value = '';
      $btnEdit.disabled = true;
      self.renderInfoCliente(null);
      if (v.trim().length < 2) { $list.hidden = true; return; }
      self.doSearch(v);
    });

    $combo.addEventListener('keydown', e => {
      if ($list.hidden) return;
      const max  = self.items.length - 1;
      const jump = 5;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); self.idx = Math.min(max, self.idx + 1); self.updateActive(); break;
        case 'ArrowUp':   e.preventDefault(); self.idx = Math.max(0,   self.idx - 1); self.updateActive(); break;
        case 'PageDown':  e.preventDefault(); self.idx = Math.min(max, self.idx + jump); self.updateActive(); break;
        case 'PageUp':    e.preventDefault(); self.idx = Math.max(0,   self.idx - jump); self.updateActive(); break;
        case 'Home':      e.preventDefault(); self.idx = 0;   self.updateActive(); break;
        case 'End':       e.preventDefault(); self.idx = max; self.updateActive(); break;
        case 'Enter':
          e.preventDefault();
          if (self.idx >= 0 && self.idx < self.items.length) self.selectCliente(self.items[self.idx].id, true);
          break;
        case 'Escape': $list.hidden = true; break;
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.combobox')) $list.hidden = true;
    });

    $btnClr.addEventListener('click', () => {
      $hidden.value = ''; $combo.value = '';
      self.renderInfoCliente(null);
      $list.hidden = true;
      $combo.focus();
      NCForm.updateContratoBadges();
      const $btnGuardar = document.getElementById('btnGuardar');
      if ($btnGuardar) { $btnGuardar.disabled = true; $btnGuardar.title = 'Seleccione un cliente'; }
    });

    $btnEdit.addEventListener('click', () => {
      const id = $hidden.value;
      if (!id) { Toast.show('Seleccione un cliente para editar', 'warn'); return; }
      window.open(`../contratos/nuevo-cliente.html?id=${id}&redirect=true`, '_blank');
    });
  }
};

NCCombo.init();

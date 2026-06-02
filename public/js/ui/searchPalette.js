/**
 * searchPalette.js — global cmd-K palette for cross-collection search.
 *
 * UX:
 *   - Cmd/Ctrl+K opens the palette
 *   - Input debounced 250ms
 *   - Results grouped by collection with section headers
 *   - Arrow keys + Enter to navigate / open
 *   - Esc or click outside to close
 *
 * Mounted by calling SearchPalette.init() once per page. The page must
 * have busquedaGlobalService.js loaded.
 */
(function () {
  'use strict';

  let overlay = null;
  let input = null;
  let resultsEl = null;
  let activeIdx = -1;
  let flatResults = [];
  let debounceTimer = null;

  const GROUP_META = {
    clientes:     { icon: 'users',       label: 'Clientes' },
    ordenes:      { icon: 'settings-2',  label: 'Órdenes' },
    contratos:    { icon: 'file-text',   label: 'Contratos' },
    cotizaciones: { icon: 'receipt',     label: 'Cotizaciones' },
    poc:          { icon: 'radio-tower', label: 'PoC' },
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureMounted() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'search-palette-overlay';
    overlay.innerHTML = `
      <div class="search-palette">
        <div class="search-palette-input-row">
          <i data-lucide="search"></i>
          <input id="sp-input" type="search" placeholder="Buscar en clientes, órdenes, contratos, cotizaciones, PoC…" autocomplete="off" spellcheck="false">
          <span class="sp-kbd">Esc</span>
        </div>
        <div class="search-palette-results" id="sp-results">
          <div class="sp-hint">Escribe al menos 2 caracteres para buscar.</div>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    input = overlay.querySelector('#sp-input');
    resultsEl = overlay.querySelector('#sp-results');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    if (window.lucide) lucide.createIcons();
  }

  function open() {
    ensureMounted();
    overlay.classList.add('is-open');
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    input.value = '';
    resultsEl.innerHTML = '<div class="sp-hint">Escribe al menos 2 caracteres para buscar.</div>';
    activeIdx = -1;
    flatResults = [];
  }

  function onInput() {
    const q = input.value;
    clearTimeout(debounceTimer);
    if (q.trim().length < 2) {
      resultsEl.innerHTML = '<div class="sp-hint">Escribe al menos 2 caracteres para buscar.</div>';
      flatResults = [];
      activeIdx = -1;
      return;
    }
    resultsEl.innerHTML = '<div class="sp-hint">Buscando…</div>';
    debounceTimer = setTimeout(async () => {
      try {
        const res = await BusquedaGlobalService.searchAll(q);
        renderResults(res);
      } catch (err) {
        console.error('[searchPalette]', err);
        resultsEl.innerHTML = `<div class="sp-hint sp-err">Error: ${escapeHtml(err.message || err.code || '')}</div>`;
      }
    }, 250);
  }

  function renderResults(res) {
    const groups = res.results || {};
    if (!res.total) {
      resultsEl.innerHTML = `<div class="sp-hint">Sin resultados para “${escapeHtml(res.query)}”.</div>`;
      flatResults = [];
      activeIdx = -1;
      return;
    }
    flatResults = [];
    const html = Object.entries(GROUP_META).map(([k, meta]) => {
      const items = groups[k] || [];
      if (!items.length) return '';
      const rows = items.map(it => {
        const idx = flatResults.length;
        flatResults.push(it);
        return `<a class="sp-row" data-idx="${idx}" href="${it.link}">
          <div class="sp-row-title">${escapeHtml(it.title)}</div>
          <div class="sp-row-sub">${escapeHtml(it.subtitle || '')}</div>
        </a>`;
      }).join('');
      return `<div class="sp-group">
        <div class="sp-group-head"><i data-lucide="${meta.icon}"></i> ${meta.label}</div>
        ${rows}
      </div>`;
    }).join('');
    resultsEl.innerHTML = html;
    if (window.lucide) lucide.createIcons();
    activeIdx = flatResults.length ? 0 : -1;
    highlightActive();
  }

  function highlightActive() {
    resultsEl.querySelectorAll('.sp-row').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
    });
    const active = resultsEl.querySelector('.sp-row.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { close(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, flatResults.length - 1); highlightActive(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp')   { activeIdx = Math.max(activeIdx - 1, 0);                       highlightActive(); e.preventDefault(); return; }
    if (e.key === 'Enter' && activeIdx >= 0) {
      const it = flatResults[activeIdx];
      if (it?.link) location.href = it.link;
      e.preventDefault();
      return;
    }
  }

  function init() {
    document.addEventListener('keydown', (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (overlay && overlay.classList.contains('is-open')) close();
        else open();
      }
    });
  }

  window.SearchPalette = { init, open, close };
})();

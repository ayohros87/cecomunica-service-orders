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
 *   - "Recientes": con la caja vacía se listan los últimos 8 resultados
 *     abiertos desde el palette (localStorage, por navegador). Volver al
 *     cliente de hace un rato es Ctrl+K, Enter (P2 auditoría UX 2026-09-28).
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

  // ── Recientes ────────────────────────────────────────────────────────
  const RECIENTES_KEY = 'cc_palette_recientes';
  const RECIENTES_MAX = 8;
  function leerRecientes() {
    try {
      const v = JSON.parse(localStorage.getItem(RECIENTES_KEY) || '[]');
      return Array.isArray(v) ? v.filter(r => r && r.link && r.title) : [];
    } catch (_) { return []; }
  }
  function recordar(it) {
    if (!it || !it.link) return;
    const lista = [{ title: it.title, subtitle: it.subtitle || '', link: it.link, grupo: it.grupo || '' }]
      .concat(leerRecientes().filter(r => r.link !== it.link))
      .slice(0, RECIENTES_MAX);
    try { localStorage.setItem(RECIENTES_KEY, JSON.stringify(lista)); } catch (_) { /* sin storage */ }
  }
  function olvidarRecientes() {
    try { localStorage.removeItem(RECIENTES_KEY); } catch (_) { /* sin storage */ }
  }
  const HINT_VACIO = '<div class="sp-hint">Escribe al menos 2 caracteres para buscar.</div>';

  // Iconos/labels desde el catálogo único (MODULOS.CATALOGO, auditoría A9);
  // los literales quedan de fallback para un modulos.js viejo en caché.
  const GROUP_META = (() => {
    const base = {
      clientes:     { icon: 'users',       label: 'Clientes' },
      ordenes:      { icon: 'settings-2',  label: 'Órdenes' },
      contratos:    { icon: 'file-text',   label: 'Contratos' },
      cotizaciones: { icon: 'receipt',     label: 'Cotizaciones' },
      poc:          { icon: 'radio-tower', label: 'PoC' },
      // Pool de equipos por serial (auditoría 2026-09-30, 08 P5): el grupo
      // se llama como el módulo donde aterriza.
      pool:         { icon: 'warehouse',   label: 'Almacén' },
    };
    try {
      (window.MODULOS?.CATALOGO || []).forEach(g => (g.items || []).forEach(it => {
        if (base[it.id]) base[it.id] = { icon: it.icon, label: it.label };
        if (it.id === 'almacen') base.pool = { icon: it.icon, label: it.label };
      }));
    } catch (_) { /* fallback literal */ }
    return base;
  })();

  // Colecciones que las reglas le niegan al rol: se dice, no se calla
  // (bodega buscaba una cotización y veía "Sin resultados").
  const SIN_PERMISO_LABEL = { cotizaciones: 'cotizaciones', clientes: 'clientes', contratos: 'contratos', ordenes: 'órdenes', poc: 'la Base PoC', pool: 'el pool de equipos' };
  function sinPermisoHtml(res) {
    const lista = (res.sinPermiso || []).map(k => SIN_PERMISO_LABEL[k] || k);
    if (!lista.length) return '';
    return `<div class="sp-hint sp-hint--permiso">Tu rol no ve ${lista.join(' ni ')}: si lo que buscas está ahí, pídelo a quien sí.</div>`;
  }

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
          <input id="sp-input" type="search" placeholder="Buscar cliente, orden, contrato, cotización, serial (PoC o Almacén)…" autocomplete="off" spellcheck="false" aria-label="Buscar en todo el sistema">
          <button type="button" class="sp-kbd sp-cerrar" aria-label="Cerrar la búsqueda" title="Cerrar (Esc)">Esc</button>
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
    // Abrir con clic también cuenta como "reciente" (Enter ya pasa por onKeyDown).
    resultsEl.addEventListener('click', (e) => {
      const fila = e.target.closest && e.target.closest('.sp-row');
      if (fila) { recordar(flatResults[Number(fila.dataset.idx)]); return; }
      if (e.target.closest && e.target.closest('.sp-olvidar')) { olvidarRecientes(); pintarVacio(); }
    });
    // En táctil no hay Esc: el mismo rótulo es un botón (auditoría UX 2026-09-28).
    overlay.querySelector('.sp-cerrar').addEventListener('click', close);
    if (window.lucide) lucide.createIcons();
  }

  // open(texto): con texto (p. ej. lo que se tecleó en el buscador del home)
  // la búsqueda arranca sola, sin volver a escribirlo.
  function open(texto) {
    ensureMounted();
    overlay.classList.add('is-open');
    if (typeof texto === 'string' && texto.trim()) {
      input.value = texto;
      onInput();
    } else {
      pintarVacio();
    }
    setTimeout(() => {
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) { /* type=search */ }
    }, 0);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    input.value = '';
    resultsEl.innerHTML = HINT_VACIO;
    activeIdx = -1;
    flatResults = [];
  }

  // Caja vacía: los recientes (navegables con ↑/↓ y Enter) o la pista.
  function pintarVacio() {
    const rec = leerRecientes();
    flatResults = [];
    activeIdx = -1;
    if (!rec.length) { resultsEl.innerHTML = HINT_VACIO; return; }
    const rows = rec.map(it => {
      const idx = flatResults.length;
      flatResults.push(it);
      const meta = GROUP_META[it.grupo];
      return `<a class="sp-row" data-idx="${idx}" href="${escapeHtml(it.link)}">
        <div class="sp-row-title">${escapeHtml(it.title)}</div>
        <div class="sp-row-sub">${meta ? escapeHtml(meta.label) + (it.subtitle ? ' · ' : '') : ''}${escapeHtml(it.subtitle || '')}</div>
      </a>`;
    }).join('');
    resultsEl.innerHTML = `<div class="sp-group sp-group--recientes">
      <div class="sp-group-head"><i data-lucide="history"></i> Recientes
        <button type="button" class="sp-olvidar" title="Borrar la lista de recientes">Limpiar</button></div>
      ${rows}
    </div>`;
    if (window.lucide) lucide.createIcons();
    activeIdx = 0;
    highlightActive();
  }

  function onInput() {
    const q = input.value;
    clearTimeout(debounceTimer);
    if (q.trim().length < 2) {
      pintarVacio();
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
      resultsEl.innerHTML = `<div class="sp-hint">Sin resultados para “${escapeHtml(res.query)}”.</div>${sinPermisoHtml(res)}`;
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
        flatResults.push({ ...it, grupo: k });
        return `<a class="sp-row" data-idx="${idx}" href="${escapeHtml(it.link)}">
          <div class="sp-row-title">${escapeHtml(it.title)}</div>
          <div class="sp-row-sub">${escapeHtml(it.subtitle || '')}</div>
        </a>`;
      }).join('');
      return `<div class="sp-group">
        <div class="sp-group-head"><i data-lucide="${meta.icon}"></i> ${meta.label}</div>
        ${rows}
      </div>`;
    }).join('');
    resultsEl.innerHTML = html + sinPermisoHtml(res);
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
      if (it?.link) { recordar(it); location.href = it.link; }
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

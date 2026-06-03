// @ts-nocheck
/* ========================================
 * ORDENES INDEX - Page coordinator
 * Thin bootstrap: wires DOM listeners, drives the initial auth +
 * data load, handles back-button reloads, and registers the
 * Ctrl/Cmd+K / Escape keyboard shortcuts.
 *
 * All other behavior is in pages/ordenes-state.js, ordenes-data.js,
 * ordenes-render.js, ordenes-filters.js, ordenes-flujo.js,
 * ordenes-equipos.js, ordenes-notas.js, ordenes-ui.js, and
 * ordenes-events.js (loaded in that order from ordenes/index.html).
 * ======================================== */

// Measures .filters-card-sticky height and exposes it as
// --filter-card-h so the orders-table thead can stick directly below
// the filter card instead of using a hardcoded 128 px estimate.
// Re-measured automatically when the card resizes (advanced filters
// toggle, viewport change, content reflow).
function syncFilterCardHeight() {
  const card = document.querySelector('.filters-card-sticky');
  if (!card) return;
  const h = Math.ceil(card.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--filter-card-h', h + 'px');
}

document.addEventListener("DOMContentLoaded", function () {
  setFechaEntregaVisible(false);

  // Paint the skeleton immediately — before auth + getUserData resolve —
  // so the table area shows placeholders from the first paint instead of
  // sitting empty while the header is already visible, then popping a
  // skeleton in later. It stays until the live snapshot replaces it.
  if (typeof renderSkeletonRows === 'function') renderSkeletonRows(8);

  // §4.1 — Mobile tooltip long-press (500 ms hold on any [title] element).
  // Shows a floating label on touch so tablet/phone users get tooltip info.
  _initTouchTooltips();

  // Initial measurement + observe future resizes.
  syncFilterCardHeight();
  const filterCard = document.querySelector('.filters-card-sticky');
  if (filterCard && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncFilterCardHeight).observe(filterCard);
  }

  // Filter inputs re-apply combined filters on change
  const filtroEstadoEl = document.getElementById("filtroEstado");
  if (filtroEstadoEl) filtroEstadoEl.addEventListener("change", () => aplicarFiltrosCombinados());
  const filtroTipoEl = document.getElementById("filtroTipo");
  if (filtroTipoEl) filtroTipoEl.addEventListener("change", () => aplicarFiltrosCombinados());
  const filtroTecnicoEl = document.getElementById("filtroTecnico");
  if (filtroTecnicoEl) filtroTecnicoEl.addEventListener("change", () => aplicarFiltrosCombinados());
  const toggleMisOrdenes = document.getElementById("toggleMisOrdenes");
  if (toggleMisOrdenes) toggleMisOrdenes.addEventListener("change", () => aplicarFiltrosCombinados());

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "../login.html";
      return;
    }
    try {
      const userData = await OrdenesService.getUserData(user.uid);
      const rol = userData?.rol || null;
      APP.state.user = userData || null;
      APP.state.userId = user.uid || null;
      APP.state.userRole = rol;

      const shouldDefaultMine = [ROLES.TECNICO, ROLES.TECNICO_OPERATIVO].includes(rol);
      if (shouldDefaultMine) {
        const toggleMis = document.getElementById("toggleMisOrdenes");
        const mobileSoloMias = document.getElementById("mobileSoloMias");
        if (toggleMis) toggleMis.checked = true;
        if (mobileSoloMias) mobileSoloMias.checked = true;
      }

      // Skeleton was already painted at DOMContentLoaded (above) so the
      // table never sits empty; it stays until the live snapshot replaces
      // it. ORDENES_INDEX_IMPROVEMENTS.md QW11.
      await cargarTiposDeServicioFiltros();
      await cargarTecnicosFiltros();
      // Apply URL filter state AFTER the dropdowns have their options
      // populated (so `<select>` values resolve correctly) but BEFORE
      // the initial data load (so sort + soloMias take effect on the
      // first render). ORDENES_INDEX_IMPROVEMENTS.md §5.4.
      // Side effect only: writes any URL filter/sort state onto the inputs
      // so the live listener's first render picks them up (see note below).
      if (typeof _applyURLToFilters === 'function') _applyURLToFilters();
      await cargarOrdenesYEquipos();
      aplicarRestriccionesPorRol(rol);
      // NOTE: do NOT call aplicarFiltrosCombinados() here. cargarOrdenesYEquipos
      // sets up the live snapshot listener but returns before its first
      // callback fires, so APP.state.orders is still empty at this point —
      // rendering now would flash the "sin coincidencias" empty state over
      // the skeleton, then get replaced when the snapshot lands. The default
      // "mis órdenes" / URL filters are already set on the inputs above, so
      // the listener's own aplicarFiltrosCombinados() applies them once data
      // arrives.
      // §4.4 — auto-focus search field once the initial render is done.
      _autofocusSearchIfIdle();
    } catch (e) {
      console.error("Error obteniendo rol del usuario:", e);
      Toast.show("Error al verificar permisos. Por favor, recarga la página.", 'bad');
      firebase.auth().signOut();
    }
  });

  // ── "Cargar más" auto-load via IntersectionObserver ──────────────
  // The button stays as a manual fallback (e.g. when IO is unavailable
  // or when the user explicitly clicks it). The observer fires before
  // the user actually scrolls to the button so loading is invisible
  // in normal use. ORDENES_INDEX_IMPROVEMENTS.md QW14.
  const btnCargarMas = APP.utils.mustGetEl("btnCargarMas");
  let _autoLoadInFlight = false;

  const triggerLoadMore = () => {
    if (_autoLoadInFlight) return;
    // Don't paginate until the live first page has rendered. On initial
    // load the skeleton is short, so the observer sees the "Cargar más"
    // button in view and would fire immediately — appending page 1 (with
    // a still-null cursor) BELOW the skeleton, which then jumps as the
    // snapshot re-renders from the top. Wait for the first real render.
    if (!APP.state.firstPageReady) return;
    if (btnCargarMas.disabled) return;
    if (btnCargarMas.style.display === "none") return;
    _autoLoadInFlight = true;
    Promise.resolve(cargarOrdenesYEquipos(false))
      .finally(() => { _autoLoadInFlight = false; });
  };

  btnCargarMas.addEventListener("click", triggerLoadMore);

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) triggerLoadMore();
      }
    }, {
      // Pre-fetch slightly before the button is visible — feels more
      // continuous to the user than waiting for true intersection.
      rootMargin: "200px 0px 200px 0px",
      threshold: 0,
    });
    io.observe(btnCargarMas);
  }

  const filtroRapido = document.getElementById('filtroRapido');
  if (filtroRapido) {
    filtroRapido.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        filtrarRapido();
      }
    });
  }

  // §4.4 — Show scan button when BarcodeDetector is available (Chrome Android).
  if ('BarcodeDetector' in window) {
    const btnScan = document.getElementById('btnScanSerial');
    if (btnScan) btnScan.style.display = '';
  }
});

// §4.1 — Long-press tooltip for touch devices.
// Listens on document via delegation; no per-element setup needed.
// Skips elements that are buttons/inputs (where long-press has OS meaning).
function _initTouchTooltips() {
  let _tipTimer = null;
  let _tipEl    = null;

  const _showTip = (text, x, y) => {
    _hideTip();
    const tip = document.createElement('div');
    tip.id = '__touchTip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    tip.style.cssText = [
      'position:fixed;z-index:9998;max-width:260px',
      'background:#0f172a;color:#fff;font-size:13px',
      'padding:6px 10px;border-radius:6px',
      'pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.35)',
      'animation:_tt-in .12s ease',
    ].join(';');
    document.body.appendChild(tip);
    _tipEl = tip;

    // Position: prefer above the touch point, flip to below if off-screen
    const vw = window.innerWidth, vh = window.innerHeight;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = Math.min(x - tw / 2, vw - tw - 8);
    tx = Math.max(tx, 8);
    let ty = y - th - 12;
    if (ty < 8) ty = y + 24;
    tip.style.left = tx + 'px';
    tip.style.top  = ty + 'px';
  };

  const _hideTip = () => {
    clearTimeout(_tipTimer);
    _tipTimer = null;
    if (_tipEl) { _tipEl.remove(); _tipEl = null; }
  };

  // Inject keyframe once
  if (!document.getElementById('__ttStyles')) {
    const s = document.createElement('style');
    s.id = '__ttStyles';
    s.textContent = '@keyframes _tt-in { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }';
    document.head.appendChild(s);
  }

  document.addEventListener('touchstart', (e) => {
    _hideTip();
    const el = e.target?.closest('[title]');
    if (!el) return;
    const text = el.getAttribute('title');
    if (!text) return;
    const t = e.touches[0];
    _tipTimer = setTimeout(() => _showTip(text, t.clientX, t.clientY), 500);
  }, { passive: true });

  document.addEventListener('touchend',    _hideTip, { passive: true });
  document.addEventListener('touchmove',   _hideTip, { passive: true });
  document.addEventListener('touchcancel', _hideTip, { passive: true });
}

function cerrarSesion() {
  firebase.auth().signOut().then(() => {
    window.location.href = "../login.html";
  });
}
window.cerrarSesion = cerrarSesion;

// §4.4 — BarcodeDetector scan-to-search.
// Opens the rear camera, continuously scans, and on first read pastes
// the barcode value into #filtroRapido and triggers filtrarRapido().
async function _scanSerial() {
  if (!('BarcodeDetector' in window)) return;

  let stream;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    const detector = new BarcodeDetector({ formats });

    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });

    // Build an ephemeral overlay with a live preview
    const overlay = document.createElement('div');
    overlay.id = 'scanOverlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px'
    ].join(';');

    const video = document.createElement('video');
    video.style.cssText = 'width:min(90vw,420px);border-radius:var(--radius-lg,10px);border:3px solid var(--accent,#0091D7);';
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const hint = document.createElement('p');
    hint.textContent = 'Apunta la cámara al código de barras o QR del equipo';
    hint.style.cssText = 'color:#fff;font-size:15px;margin:0;text-align:center;padding:0 16px;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Cancelar';
    btnCancel.className = 'btn btn-ghost';
    btnCancel.style.background = '#fff';

    overlay.append(video, hint, btnCancel);
    document.body.appendChild(overlay);

    let scanning = true;
    const stop = () => {
      scanning = false;
      stream.getTracks().forEach(t => t.stop());
      overlay.remove();
    };

    btnCancel.addEventListener('click', stop);

    const tick = async () => {
      if (!scanning) return;
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          const value = barcodes[0].rawValue;
          stop();
          const input = document.getElementById('filtroRapido');
          if (input) {
            input.value = value;
            filtrarRapido();
          }
          return;
        }
      } catch { /* frame not ready yet */ }
      requestAnimationFrame(tick);
    };

    video.addEventListener('loadedmetadata', () => requestAnimationFrame(tick), { once: true });

  } catch (err) {
    if (stream) stream.getTracks().forEach(t => t.stop());
    const msg = err.name === 'NotAllowedError'
      ? 'Permiso de cámara denegado.'
      : 'No se pudo iniciar la cámara.';
    Toast.show(msg, 'bad');
  }
}

// §4.4 — Auto-focus the serial search on page load when no filter is active.
// Called once after the initial data render so the input is visible.
function _autofocusSearchIfIdle() {
  const input = document.getElementById('filtroRapido');
  if (!input) return;
  // Don't steal focus if the user has already started typing or if any
  // filter-bearing URL param is present (preset was restored).
  const hasUrlFilters = window.location.search.length > 1;
  if (hasUrlFilters) return;
  // Delay a tick so the browser has settled and skeleton rows are gone.
  setTimeout(() => {
    if (document.activeElement === document.body || document.activeElement === null) {
      input.focus({ preventScroll: true });
    }
  }, 300);
}
window._autofocusSearchIfIdle = _autofocusSearchIfIdle;

// Ctrl/Cmd+K focuses the quick search; ESC closes any open .overlay modal;
// ? opens the keyboard shortcut cheatsheet.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const filtroRapido = document.getElementById('filtroRapido');
    if (filtroRapido) {
      filtroRapido.focus();
    } else {
      const filtroOrden = document.getElementById('filtroOrden');
      if (filtroOrden) filtroOrden.focus();
    }
  }

  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) {
    e.preventDefault();
    _showShortcutsModal();
  }

  if (e.key === 'Escape') {
    // Close shortcut modal if open
    const sm = document.getElementById('__shortcutsModal');
    if (sm) { sm.remove(); return; }
    const modal = document.querySelector('.overlay[style*="display: flex"]');
    if (modal) modal.style.display = 'none';
  }
});

// §4.2 — Keyboard shortcut cheatsheet modal.
function _showShortcutsModal() {
  if (document.getElementById('__shortcutsModal')) return; // already open

  const shortcuts = [
    { keys: ['Ctrl', 'K'], desc: 'Enfocar búsqueda rápida' },
    { keys: ['?'],         desc: 'Mostrar estos atajos' },
    { keys: ['Esc'],       desc: 'Cerrar modal o este panel' },
    { keys: ['Enter'],     desc: 'Ejecutar búsqueda rápida' },
  ];

  const rows = shortcuts.map(s => {
    const kbds = s.keys.map(k => `<kbd>${k}</kbd>`).join('<span class="sc-sep">+</span>');
    return `<tr><td class="sc-keys">${kbds}</td><td class="sc-desc">${s.desc}</td></tr>`;
  }).join('');

  const modal = document.createElement('div');
  modal.id = '__shortcutsModal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Atajos de teclado');
  modal.innerHTML = `
    <div class="sc-backdrop"></div>
    <div class="sc-panel">
      <div class="sc-header">
        <span>Atajos de teclado</span>
        <button class="sc-close" aria-label="Cerrar">✕</button>
      </div>
      <table class="sc-table"><tbody>${rows}</tbody></table>
    </div>`;

  modal.querySelector('.sc-backdrop').addEventListener('click', () => modal.remove());
  modal.querySelector('.sc-close').addEventListener('click', () => modal.remove());

  document.body.appendChild(modal);
}

// Inject shortcut modal styles once
(function _injectShortcutStyles() {
  if (document.getElementById('__scStyles')) return;
  const s = document.createElement('style');
  s.id = '__scStyles';
  s.textContent = `
    #__shortcutsModal { position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center; }
    #__shortcutsModal .sc-backdrop { position:absolute;inset:0;background:rgba(0,0,0,.5); }
    #__shortcutsModal .sc-panel {
      position:relative;background:#fff;border-radius:var(--radius-xl,16px);padding:20px 24px;
      min-width:320px;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.25);
    }
    #__shortcutsModal .sc-header {
      display:flex;justify-content:space-between;align-items:center;
      font-weight:700;font-size:15px;margin-bottom:16px;color:#0f172a;
    }
    #__shortcutsModal .sc-close {
      background:none;border:none;font-size:18px;cursor:pointer;
      color:#64748b;line-height:1;padding:2px 6px;border-radius:4px;
    }
    #__shortcutsModal .sc-close:hover { background:#f1f5f9; }
    #__shortcutsModal .sc-table { width:100%;border-collapse:collapse; }
    #__shortcutsModal .sc-table tr { border-bottom:1px solid #f1f5f9; }
    #__shortcutsModal .sc-table tr:last-child { border-bottom:none; }
    #__shortcutsModal .sc-keys { padding:8px 0;white-space:nowrap;width:40%; }
    #__shortcutsModal .sc-desc { padding:8px 0 8px 12px;color:#475569;font-size:13px; }
    #__shortcutsModal kbd {
      display:inline-block;padding:2px 7px;background:#f1f5f9;border:1px solid #cbd5e1;
      border-radius:5px;font-family:monospace;font-size:12px;color:#0f172a;
      box-shadow:0 1px 0 #cbd5e1;
    }
    #__shortcutsModal .sc-sep { margin:0 3px;color:#94a3b8;font-size:11px; }
  `;
  document.head.appendChild(s);
})();

// BFCache restore: re-establish the live snapshot listener. Firestore's
// SDK usually keeps listeners alive across the restore, but on some
// browsers (Safari especially) the connection drops and re-subscribing
// is the safest path. ORDENES_INDEX_IMPROVEMENTS.md §3.1.
window.addEventListener("pageshow", (event) => {
  if (event.persisted || performance.getEntriesByType("navigation")[0].type === "back_forward") {
    if (typeof _iniciarSnapshotInicial === 'function') {
      _iniciarSnapshotInicial();
    }
  }
});

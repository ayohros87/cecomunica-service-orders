// @ts-nocheck
/* ========================================
 * ORDENES UI - Page-local UI primitives
 * Mobile filter drawer, menu togglers, text/alert modals, and the
 * order-completed progreso notification. Toasts use the shared
 * `Toast.show()` from `public/js/ui/toast.js` directly.
 * ======================================== */

// ── Orders view mode (cards | table) — ORDENES_INDEX_IMPROVEMENTS §4.2 ──
// Default is breakpoint-aware: desktop → table, mobile → cards.
// Persisted per-device in localStorage so a user's explicit choice sticks.
const _ORDERS_VIEW_KEY = 'ordenes:view-mode';

function _defaultOrdersView() {
  try {
    return window.matchMedia('(max-width: 768px)').matches ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

function getOrdersView() {
  try {
    const stored = localStorage.getItem(_ORDERS_VIEW_KEY);
    if (stored === 'table' || stored === 'cards') return stored;
    return _defaultOrdersView();
  } catch {
    return _defaultOrdersView();
  }
}

function setOrdersView(mode) {
  const next = mode === 'table' ? 'table' : 'cards';
  try { localStorage.setItem(_ORDERS_VIEW_KEY, next); } catch { /* private mode */ }
  document.body.classList.toggle('orders-view--cards', next === 'cards');
  document.body.classList.toggle('orders-view--table', next === 'table');
  // Update toggle pressed state.
  document.querySelectorAll('[data-action^="set-view-"]').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.view === next ? 'true' : 'false');
  });
}
window.getOrdersView = getOrdersView;
window.setOrdersView = setOrdersView;

// Init on first script run — body class applied before render so the
// first paint already reflects the preferred view.
(function _initOrdersView() {
  if (typeof document === 'undefined') return;
  const apply = () => setOrdersView(getOrdersView());
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();

function mostrarNotificacionProgreso(data) {
  const box = document.createElement("div");
  box.className = "notificacion-progreso";
  box.innerHTML = `
    <strong>🎯 ¡Orden completada!</strong><br>
    <small>Semana: ${data.semanal} · Mes: ${data.mensual} · Total: ${data.total}</small>
  `;
  document.body.appendChild(box);

  setTimeout(() => {
    box.classList.add("fade-out");
    setTimeout(() => box.remove(), 1000);
  }, 3000);
}

// ===== MOBILE UI HELPERS (NO LOGIC CHANGES) =====
function openMobileFilters() {
  const b = document.getElementById('mobileDrawerBackdrop');
  // Toggle the .hidden class (not inline style): ordenes-index.css defines
  // `.hidden { display:none !important }`, which inline style can't override.
  if (b) { b.style.removeProperty('display'); b.classList.remove('hidden'); }

  // sync mobile sort select with existing select
  const real = document.getElementById('campoOrdenamiento');
  const mob = document.getElementById('mobileSortField');
  if (real && mob) mob.value = real.value || 'ordenId';
}

function closeMobileFilters() {
  const b = document.getElementById('mobileDrawerBackdrop');
  if (b) { b.style.removeProperty('display'); b.classList.add('hidden'); }
}

function mobileScrollTop() {
  closeMobileFilters();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mobileClearAll() {
  // reuse existing clear
  if (typeof limpiarFiltros === 'function') limpiarFiltros();

  // clear mobile quick search UI
  const q = document.getElementById('mobileQuickSearch');
  if (q) q.value = '';

  // clear chip active state
  document.querySelectorAll('#mobileEstadoChips .mchip').forEach(c => c.classList.remove('active'));

  closeMobileFilters();
}

function mobileApplyQuickSearch() {
  const qRaw = (document.getElementById('mobileQuickSearch')?.value || '').trim();
  const q = qRaw.toLowerCase();

  const inOrden = document.getElementById('filtroOrden');
  const inCliente = document.getElementById('filtroCliente');
  const inSerial = document.getElementById('filtroSerial');

  if (inOrden) inOrden.value = '';
  if (inCliente) inCliente.value = '';
  if (inSerial) inSerial.value = '';

  if (!q) {
    if (typeof filtrarOrdenes === 'function') filtrarOrdenes();
    closeMobileFilters();
    return;
  }

  const onlyDigits = /^\d+$/.test(q);
  const hasSpace = /\s/.test(q);
  const hasLetter = /[a-z]/i.test(q);
  const hasDigit = /\d/.test(q);

  if (onlyDigits) {
    // Pure numbers -> order
    if (inOrden) inOrden.value = qRaw;
  } else if (hasSpace || (hasLetter && !hasDigit)) {
    // Names / companies / phrases -> cliente
    if (inCliente) inCliente.value = qRaw;
  } else if (hasLetter && hasDigit && !hasSpace) {
    // Mixed serial-like token
    if (inSerial) inSerial.value = qRaw;
  } else {
    // Fallback
    if (inCliente) inCliente.value = qRaw;
  }

  if (typeof filtrarOrdenes === 'function') filtrarOrdenes();
  closeMobileFilters();
}

function mobileSyncSortField() {
  const mob = document.getElementById('mobileSortField');
  const real = document.getElementById('campoOrdenamiento');
  if (mob && real) {
    real.value = mob.value;
    if (typeof cambiarOrden === 'function') cambiarOrden();
  }
}

function mobileToggleSortDir() {
  if (typeof cambiarDireccionOrden === 'function') cambiarDireccionOrden();
}

// Chip click wiring
document.addEventListener('click', (e) => {
  const chip = e.target.closest('#mobileEstadoChips .mchip');
  if (!chip) return;

  const estado = chip.getAttribute('data-estado') || '';
  const wasActive = chip.classList.contains('active');
  const chips = document.querySelectorAll('#mobileEstadoChips .mchip');

  chips.forEach(c => c.classList.remove('active'));

  let finalEstado = estado;
  if (wasActive) {
    // toggle off -> Todos
    finalEstado = '';
    // also highlight Todos chip
    const todos = document.querySelector('#mobileEstadoChips .mchip[data-estado=""]');
    if (todos) todos.classList.add('active');
  } else {
    chip.classList.add('active');
  }

  // Sync existing select and call existing handler
  const sel = document.getElementById('filtroEstado');
  if (sel) sel.value = finalEstado;

  if (typeof filtrarPorEstado === 'function') filtrarPorEstado(finalEstado);
  closeMobileFilters();
});

// Allow Enter key to search from mobile quick search
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement?.id === 'mobileQuickSearch') {
    e.preventDefault();
    mobileApplyQuickSearch();
  }
});

// Ensure callable from inline onclick
window.openMobileFilters = openMobileFilters;
window.closeMobileFilters = closeMobileFilters;
window.mobileScrollTop = mobileScrollTop;
window.mobileClearAll = mobileClearAll;
window.mobileApplyQuickSearch = mobileApplyQuickSearch;
window.mobileSyncSortField = mobileSyncSortField;
window.mobileToggleSortDir = mobileToggleSortDir;

// Overflow Menu Controls
window.toggleOverflowMenu = function(ordenId) {
  const menu = document.getElementById(`overflow-menu-${ordenId}`);
  if (!menu) return;
  const row = document.querySelector(`tr[data-orden-id="${ordenId}"]`);
  
  // Close all other menus first
  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== `overflow-menu-${ordenId}`) {
      m.classList.remove('show');
    }
  });
  document.querySelectorAll('tr.menu-open').forEach(r => r.classList.remove('menu-open'));
  
  // Toggle this menu
  menu.classList.toggle('show');
  if (menu.classList.contains('show') && row) {
    row.classList.add('menu-open');
  }
};

window.toggleOrderActionsMenu = function(ordenId) {
  const menu = document.getElementById(`order-actions-${ordenId}`);
  if (!menu) return;

  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== `order-actions-${ordenId}`) {
      m.classList.remove('show');
    }
  });

  menu.classList.toggle('show');
};


window.toggleTopbarMenu = function() {
  const menu = document.getElementById('topbar-menu');
  const btn = document.querySelector('[data-action="toggle-topbar-menu"]');
  if (!menu) return;

  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== 'topbar-menu') {
      m.classList.remove('show');
    }
  });

  menu.classList.toggle('show');
  if (btn) btn.setAttribute('aria-expanded', menu.classList.contains('show') ? 'true' : 'false');
};

window.toggleResumenMenu = function() {
  const menu = document.getElementById('resumen-menu');
  const btn = document.querySelector('[data-action="toggle-resumen-menu"]');
  if (!menu) return;

  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== 'resumen-menu') {
      m.classList.remove('show');
    }
  });

  menu.classList.toggle('show');
  if (btn) btn.setAttribute('aria-expanded', menu.classList.contains('show') ? 'true' : 'false');
};

window.closeAllMenus = function() {
  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    m.classList.remove('show');
  });
  const btn = document.querySelector('[data-action="toggle-topbar-menu"]');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  const resumenBtn = document.querySelector('[data-action="toggle-resumen-menu"]');
  if (resumenBtn) resumenBtn.setAttribute('aria-expanded', 'false');
  document.querySelectorAll('tr.menu-open').forEach(r => r.classList.remove('menu-open'));
};

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.overflow-menu')) {
    closeAllMenus();
  }
});

// Close menus on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllMenus();
  }
});

// Text Display Modal System
let textModalEl = null;

function createTextModal() {
  if (textModalEl) return textModalEl;
  
  const overlay = document.createElement('div');
  overlay.className = 'text-modal-overlay';
  overlay.id = 'textModalOverlay';
  
  overlay.innerHTML = `
    <div class="text-modal-content" data-stop-propagation="true">
      <div class="text-modal-header">
        <div class="text-modal-title" id="textModalTitle"></div>
        <button class="text-modal-close" data-action="close-text-modal" aria-label="Cerrar"><i data-lucide="x"></i></button>
      </div>
      <div class="text-modal-body">
        <div class="text-modal-text" id="textModalBody"></div>
      </div>
      <div class="text-modal-footer">
        <button class="text-modal-btn secondary" data-action="copy-text-modal"><i data-lucide="copy"></i> Copiar</button>
        <button class="text-modal-btn primary" data-action="close-text-modal">Cerrar</button>
      </div>
    </div>
  `;
  
  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTextModal();
  });
  
  // Close on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('show')) {
      closeTextModal();
    }
  });
  
  document.body.appendChild(overlay);
  APP.utils.lucideRefresh(overlay);
  textModalEl = overlay;
  return overlay;
}

window.showTextModal = function(title, text, isEmpty = false) {
  const modal = createTextModal();
  const titleEl = document.getElementById('textModalTitle');
  const bodyEl = document.getElementById('textModalBody');
  
  titleEl.innerHTML = escapeHtml(title);
  
  if (isEmpty || !text || text.trim() === '') {
    bodyEl.innerHTML = '<div class="text-modal-empty">📭 Sin contenido para mostrar</div>';
    bodyEl.dataset.text = '';
  } else {
    bodyEl.textContent = text;
    bodyEl.dataset.text = text;
  }
  
  modal.classList.add('show');
  
  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
};

window.closeTextModal = function() {
  if (textModalEl) {
    textModalEl.classList.remove('show');
    document.body.style.overflow = '';
  }
};

window.copyTextModalContent = function() {
  const bodyEl = document.getElementById('textModalBody');
  const text = bodyEl?.dataset?.text || bodyEl?.textContent || '';
  
  if (!text || text.trim() === '') {
    Toast.show('⚠️ No hay contenido para copiar', 'bad');
    return;
  }
  
  navigator.clipboard.writeText(text)
    .then(() => {
      Toast.show('✅ Copiado al portapapeles', 'ok');
    })
    .catch(err => {
      console.error('Error copying:', err);
      Toast.show('❌ Error al copiar', 'bad');
    });
};

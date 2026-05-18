// @ts-nocheck
/* ========================================
 * ORDENES STATE - Application State & Config
 * Loaded first by ordenes/index.html before all other page modules.
 * ======================================== */

/**
 * Application namespace - organizes all app functionality
 * Centralized state management for the orders page
 */
window.APP = {
  state: {
    orders: [],           // Loaded orders (replaces window.ordenesCargadas)
    user: null,           // Current user
    userRole: null,       // User role (replaces window.userRole)
    filters: {},          // Active filters
    lastVisible: null,    // Last document for pagination
    sortField: 'ordenId', // Field to sort by
    sortAscending: false  // Sort direction
  },
  services: {},   // Firestore services (will hold ordenesService, clientesService)
  ui: {},         // UI rendering functions
  handlers: {},   // Event handlers
  utils: {}       // Utility helpers
};

/**
 * Configuration constants
 * All global configuration values for the orders page
 */
window.CONFIG = {
  // Collection names
  COLLECTIONS: {
    ORDENES: 'ordenes_de_servicio',
    CLIENTES: 'clientes',
    USUARIOS: 'usuarios',
    EMPRESA: 'empresa',
    CONTRATOS: 'contratos',
    MAIL_QUEUE: 'mail_queue'
  },
  
  // Estados de orden
  ESTADOS: {
    POR_ASIGNAR: 'POR ASIGNAR',
    ASIGNADO: 'ASIGNADO',
    COMPLETADO: 'COMPLETADO (EN OFICINA)',
    ENTREGADO: 'ENTREGADO AL CLIENTE'
  },
  
  // Pagination — per-role page size. Técnicos see far fewer orders
  // (only their assigned ones) so a small page reduces unused reads;
  // admin/recepción/jefe_taller browse sequentially and benefit from 50.
  PAGE_LIMIT_BY_ROLE: {
    administrador:     50,
    gerente:           50,
    recepcion:         50,
    jefe_taller:       40,
    vendedor:          30,
    inventario:        30,
    tecnico:           15,
    tecnico_operativo: 15,
    vista:             30
  },
  pageLimit(role) {
    return this.PAGE_LIMIT_BY_ROLE[role] || 30;
  },

  // Feature flags
  enableContratoFallbackSync: false  // Deprecated - Cloud Function handles this now
};

/**
 * Utility helpers
 * Reusable utility functions used throughout the app
 */
APP.utils = {
  /**
   * Get element by ID, throw error if not found
   * @param {string} id - Element ID
   * @returns {HTMLElement}
   * @throws {Error} If element not found
   */
  mustGetEl(id) {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`[APP.utils.mustGetEl] Element with id "${id}" not found`);
    }
    return el;
  },

  /**
   * Query selector wrapper
   * @param {string} selector - CSS selector
   * @param {Element|Document} root - Root element (default: document)
   * @returns {Element|null}
   */
  qs(selector, root = document) {
    return root.querySelector(selector);
  },

  /**
   * Query selector all wrapper
   * @param {string} selector - CSS selector
   * @param {Element|Document} root - Root element (default: document)
   * @returns {NodeList}
   */
  qsa(selector, root = document) {
    return root.querySelectorAll(selector);
  },

  /**
   * Log error with context
   * @param {string} context - Context/location of error
   * @param {Error} err - Error object
   */
  logError(context, err) {
    console.error(`[${context}]`, err);
  },

  /**
   * Show element (remove hidden class)
   * @param {HTMLElement|string} el - Element or ID
   */
  show(el) {
    const element = typeof el === 'string' ? document.getElementById(el) : el;
    if (element) {
      element.classList.remove('hidden');
      // Si es un overlay, establecer display flex
      if (element.classList.contains('overlay')) {
        element.style.display = 'flex';
      }
    }
  },

  /**
   * Hide element (add hidden class)
   * @param {HTMLElement|string} el - Element or ID
   */
  hide(el) {
    const element = typeof el === 'string' ? document.getElementById(el) : el;
    if (element) {
      element.classList.add('hidden');
      // Si es un overlay, establecer display none
      if (element.classList.contains('overlay')) {
        element.style.display = 'none';
      }
    }
  },

  /**
   * Toggle element visibility
   * @param {HTMLElement|string} el - Element or ID
   */
  toggle(el) {
    const element = typeof el === 'string' ? document.getElementById(el) : el;
    if (element) element.classList.toggle('hidden');
  },

  /**
   * Returns true when the orders page is in mobile-card layout. Mirror of
   * the CSS @media (max-width: 768px) breakpoint that toggles .table-wrap
   * off and .cards-list on (ordenes-index.css:1188). Used to skip building
   * the inactive layout instead of shipping both DOM trees per order.
   * @returns {boolean}
   */
  isMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
  },

  /**
   * Render Lucide icons within a bounded scope instead of walking the
   * whole document. Each unscoped `lucide.createIcons()` traverses every
   * DOM node looking for `[data-lucide]`; on the orders page that fires
   * 3+ times per render and is the source of the visible icon flicker.
   * Pass the freshly-built container(s) so the sweep stays local.
   * @param {HTMLElement|HTMLElement[]|null} scope - Container(s) to scope into.
   *   Falsy → full-document fallback (use sparingly).
   */
  lucideRefresh(scope) {
    if (typeof lucide === 'undefined') return;
    const arr = Array.isArray(scope) ? scope.filter(Boolean) : (scope ? [scope] : null);
    if (arr && arr.length) lucide.createIcons({ nodes: arr });
    else                   lucide.createIcons();
  }
};

/**
 * Detect base path for URLs
 * Handles different deployment contexts (local, POC, production)
 */
window.BASE = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
  ? ''  // en local usamos rutas relativas desde raíz del servidor
  : window.location.pathname.includes('/ordenes/') ? '/ordenes/' :
    window.location.pathname.includes('/POC/') ? '/POC/' :
    window.location.pathname.includes('/inventario/') ? '/inventario/' :
    '/';

/**
 * Global modelos array for equipment types
 * Populated from Firebase on page load
 */
window.modelosDisponibles = [];

/* ========================================
 * Pure formatters
 * No DOM access (except where noted) and no Firestore access.
 * Top-level declarations are globally accessible to every page module.
 * ======================================== */

function formatFecha(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate();
    return d.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

// Compact "Mar 18, 14:32" format for the audit timeline in the
// expanded row. Falls back to the date-only formatFecha if the
// Firestore timestamp can't be converted (e.g. unset / null).
function formatFechaHora(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate();
    return d.toLocaleString('es-PA', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(',', '');
  } catch {
    return formatFecha(ts);
  }
}

function normTxt(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

// Denormalized: every order written by nueva-orden.js since the cliente_nombre
// field landed has the name on the doc directly. `orden.cliente` is a legacy
// fallback for pre-denormalization records. No cross-collection lookup needed —
// stale-name trade-off (if the client renames itself, existing orders keep the
// old name) is accepted; ORDENES_INDEX_IMPROVEMENTS.md §1.2.
function nombreClienteDe(orden) {
  return orden.cliente_nombre || orden.cliente || "—";
}

function getEstadoClass(estado) {
  const e = (estado || "").toUpperCase();
  if (e === "POR ASIGNAR") return "por-asignar";
  if (e === "ASIGNADO") return "asignado";
  if (e === "COMPLETADO (EN OFICINA)") return "completado";
  if (e === "ENTREGADO AL CLIENTE") return "entregado";
  return "por-asignar";
}

function tipoChip(tipo) {
  if (!tipo) return '';
  const t = tipo.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cls =
    t.includes('REPAR')   ? 'tipo-chip--reparacion'   :
    t.includes('PROGRAM') ? 'tipo-chip--programacion' :
    t.includes('MANTEN')  ? 'tipo-chip--mantenimiento' :
    t.includes('VENTA')   ? 'tipo-chip--venta'        : '';
  return `<span class="tipo-chip ${cls}">${tipo.trim()}</span>`;
}

function estadoCompacto(estado) {
  const e = (estado || "").toUpperCase();
  if (e === "COMPLETADO (EN OFICINA)") return "COMPLETADO";
  if (e === "ENTREGADO AL CLIENTE") return "ENTREGADO";
  return e;
}

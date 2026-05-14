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
    clientesMap: {},      // Map of cliente ID to nombre
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
  
  // Pagination
  PAGE_SIZE: 30,
  
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

// Reads APP.state.clientesMap to resolve cliente_id → display name.
function nombreClienteDe(orden) {
  const id = orden.cliente_id || orden.clienteId;
  return (id && APP.state.clientesMap[id]) || orden.cliente_nombre || orden.cliente || "—";
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

console.log('[ordenes-state.js] State management initialized');

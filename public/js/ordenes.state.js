// @ts-nocheck
/* ========================================
 * ORDENES STATE - Application State & Config
 * Extracted from ordenes-index.js
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
  
  // Roles
  ROLES: {
    ADMIN: 'administrador',
    TECNICO: 'tecnico',
    TECNICO_OPERATIVO: 'tecnico_operativo',
    RECEPCION: 'recepcion',
    VENDEDOR: 'vendedor',
    VISTA: 'vista'
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

console.log('[ordenes.state.js] State management initialized');

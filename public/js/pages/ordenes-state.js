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
  
  // Estados de orden (máquina completa: POR ASIGNAR → RECIBIDO EN MOSTRADOR
  // → ASIGNADO → COMPLETADO → ENTREGADO; los strings canónicos viven en
  // empresa/estado_de_reparacion).
  // Las órdenes de VISITA TECNICA (trabajo en sitio, sin equipos que
  // entregar) tienen su propio estado terminal: ASIGNADO → CERRADA (VISITA),
  // que se alcanza con firma del personal de la empresa visitada o motivo.
  ESTADOS: {
    POR_ASIGNAR: 'POR ASIGNAR',
    RECIBIDO: 'RECIBIDO EN MOSTRADOR',
    ASIGNADO: 'ASIGNADO',
    COMPLETADO: 'COMPLETADO (EN OFICINA)',
    ENTREGADO: 'ENTREGADO AL CLIENTE',
    CERRADA_VISITA: 'CERRADA (VISITA)',
    // Órdenes de DEVOLUCIÓN (recuperar equipos del cliente / confirmar
    // anulación): cierran cuando todos los esperados están resueltos.
    CERRADA_DEVOLUCION: 'CERRADA (DEVOLUCION)',
    // Órdenes de ENTRADA (inspección de equipos devueltos): no se entregan
    // al cliente — la revisión termina, se cotiza si hay daños/faltantes y
    // las unidades quedan bajo control de inventario (bodega/baja por serial).
    CERRADA_ENTRADA: 'CERRADA (ENTRADA)'
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
  }
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

function escapeHtml(str) { return FMT.esc(str); } // helper canónico (core/formatting.js)

// Denormalized: every order written by nueva-orden.js since the cliente_nombre
// field landed has the name on the doc directly. `orden.cliente` is a legacy
// fallback for pre-denormalization records. No cross-collection lookup needed —
// stale-name trade-off (if the client renames itself, existing orders keep the
// old name) is accepted; ORDENES_INDEX_IMPROVEMENTS.md §1.2.
function nombreClienteDe(orden) {
  return orden.cliente_nombre || orden.cliente || "—";
}

// Paleta unificada del sistema de señales (Command Center): el badge de la
// fila, el chip de filtro y el KPI usan el MISMO color por estado.
//   POR ASIGNAR rojo (pide acción) · RECIBIDO violeta · ASIGNADO azul ·
//   COMPLETADO verde · ENTREGADO gris. Las clases chip-* son tokens de
//   paleta de ceco-ui (nombradas por el flujo de cotización histórico).
function getEstadoClass(estado) {
  const e = (estado || "").toUpperCase();
  if (e === "POR ASIGNAR") return "chip-porasignar";        // rojo
  if (e === "RECIBIDO EN MOSTRADOR") return "chip-diagnostico"; // violeta
  if (e === "ASIGNADO") return "chip-recibida";             // azul
  if (e === "COMPLETADO (EN OFICINA)") return "chip-lista"; // verde
  if (e === "ENTREGADO AL CLIENTE") return "chip-entregada"; // gris
  if (e === "CERRADA (VISITA)") return "chip-aprobada";     // esmeralda
  if (e === "CERRADA (DEVOLUCION)") return "chip-aprobada"; // esmeralda
  if (e === "CERRADA (ENTRADA)") return "chip-aprobada";    // esmeralda
  return "chip-espera"; // estados legacy/extendidos: neutral
}

function tipoChip(tipo) {
  if (!tipo) return '';
  const t = tipo.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cls =
    t.includes('REPAR')   ? 'tipo-chip--reparacion'   :
    t.includes('PROGRAM') ? 'tipo-chip--programacion' :
    t.includes('MANTEN')  ? 'tipo-chip--mantenimiento' :
    t.includes('VENTA')   ? 'tipo-chip--venta'        :
    t.includes('VISITA')  ? 'tipo-chip--visita'       : '';
  return `<span class="tipo-chip ${cls}">${tipo.trim()}</span>`;
}

function estadoCompacto(estado) {
  const e = (estado || "").toUpperCase();
  if (e === "COMPLETADO (EN OFICINA)") return "COMPLETADO";
  if (e === "ENTREGADO AL CLIENTE") return "ENTREGADO";
  if (e === "RECIBIDO EN MOSTRADOR") return "RECIBIDO";
  if (e === "CERRADA (VISITA)") return "CERRADA";
  if (e === "CERRADA (DEVOLUCION)") return "CERRADA";
  if (e === "CERRADA (ENTRADA)") return "CERRADA";
  return e;
}

// Una orden de VISITA TECNICA es trabajo de campo (torres, repetidores,
// sitios del cliente): no entra equipo al taller ni hay entrega posterior.
// Su flujo cierra en sitio con firma del personal de la empresa visitada
// (o motivo de omisión) — ver ordenes-visita.js.
function esTipoVisita(tipo) {
  return normTxt(tipo).includes("visita");
}
function esOrdenVisita(orden) {
  return esTipoVisita(orden?.tipo_de_servicio);
}

// Una orden de DEVOLUCIÓN es el tiquete de recuperar equipos que siguen con
// el cliente (renovación/baja) o confirmar una anulación (¿salieron o no?).
// Check-in por serial en ordenes-devolucion.js; el backend
// (onOrdenDevolucionWrite) aplica cada resolución al pool.
function esOrdenDevolucion(orden) {
  return normTxt(orden?.tipo_de_servicio).includes("devolucion");
}

// Una orden de ENTRADA es la inspección de equipos que el cliente DEVOLVIÓ:
// entran al taller para revisión técnica (y cotización si hay daños o
// faltantes cobrables) y las unidades quedan bajo control de inventario.
// NUNCA se entregan al cliente — su terminal es CERRADA (ENTRADA), no
// ENTREGADO AL CLIENTE (ese terminal generaba la confusión entrada/entregar).
function esOrdenEntrada(orden) {
  return normTxt(orden?.tipo_de_servicio).includes("entrada");
}

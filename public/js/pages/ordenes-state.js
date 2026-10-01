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
    // Hay un RESULTADO DE SERVIDOR en pantalla (búsqueda o chip de estado):
    // la bandeja NO está mostrando las 40 más recientes, así que ni se pagina
    // ni se repinta la lista viva encima. Ver ordenes-filters.js.
    busquedaServidor: false,
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
    CERRADA_ENTRADA: 'CERRADA (ENTRADA)',
    // Órdenes de REPARACIÓN que el cliente nunca vino a retirar (válvula de
    // casos viejos, 2026-09-09): el trabajo está hecho y cobrado o no, pero
    // los radios siguen en nuestro estante. NO es una entrega — marcarlas
    // ENTREGADO mandaría al pool a decir que el cliente los tiene. Las
    // unidades quedan en `no_retirado` esperando una decisión de inventario.
    CERRADA_SIN_RETIRAR: 'CERRADA (SIN RETIRAR)',
    // Orden cuyo CONTRATO se anuló (2026-09-15): ya no hay papel bajo el cual
    // entregar esos equipos. Lo escribe el trigger de la anulación
    // (functions/src/lib/ordenesDeContratoAnulado.js), no una persona — si la
    // anulación declara un contrato sustituto, la orden se repunta en vez de
    // anularse. El estado ya existía suelto en los datos; aquí se hace canónico.
    ANULADA: 'ANULADA'
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
    // Delegado al helper transversal (js/core/icons.js); fallback local por
    // si la página se cargara sin icons.js.
    if (window.Icons) { Icons.pintar(scope); return; }
    if (typeof lucide === 'undefined') return;
    const arr = Array.isArray(scope) ? scope.filter(Boolean) : (scope ? [scope] : null);
    // `nodes` no existe en el vendor — usar `root` por contenedor (ver
    // js/core/icons.js, auditoría órdenes 2026-08-17).
    if (arr && arr.length) arr.forEach(el => { try { lucide.createIcons({ root: el }); } catch (_) { /* nodo suelto */ } });
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

// Fechas del módulo: SIEMPRE en hora de Panamá y en dos formatos, uno corto
// ("30 sep 2026") y uno largo ("30 sep 2026, 4:16 p. m."). Antes la bandeja y
// la orden impresa usaban toISOString().slice(0,10) —UTC— y una orden creada
// después de las 7 p. m. salía con la fecha del día siguiente (158 de 529
// entregas corridas; auditoría de módulos 2026-09-30, 01 R3 y C3). Las partes
// se piden en en-US numérico para que el resultado no dependa del locale del
// navegador; el texto se arma aquí.
const FECHA_TZ_PANAMA = 'America/Panama';
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function _fechaADate(v) {
  if (!v) return null;
  try {
    const d = typeof v.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : new Date(v));
    return (d && !isNaN(d.getTime())) ? d : null;
  } catch { return null; }
}

function _partesPanama(d) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: FECHA_TZ_PANAMA, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return p;
}

// "30 sep 2026" — bandeja, tarjetas, orden impresa.
function formatFecha(ts) {
  const d = _fechaADate(ts);
  if (!d) return "—";
  const p = _partesPanama(d);
  return `${p.day} ${MESES_CORTOS[Number(p.month) - 1]} ${p.year}`;
}

// "30 sep 2026, 4:16 p. m." — línea de tiempo, acuses, QC, Ver entrega.
function formatFechaHora(ts) {
  const d = _fechaADate(ts);
  if (!d) return "—";
  const p = _partesPanama(d);
  const ampm = String(p.dayPeriod || '').toUpperCase() === 'PM' ? 'p. m.' : 'a. m.';
  return `${p.day} ${MESES_CORTOS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${ampm}`;
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
function getEstadoClass(estado, orden) {
  const e = (estado || "").toUpperCase();
  if (e === "POR ASIGNAR") return "chip-porasignar";        // rojo
  if (e === "RECIBIDO EN MOSTRADOR") return "chip-diagnostico"; // violeta
  if (e === "ASIGNADO") return "chip-recibida";             // azul
  // Completada con el QC todavía pendiente: ámbar, no verde (auditoría UX
  // 2026-09-28, T1) — el verde se leía "lista para entregar".
  if (e === "COMPLETADO (EN OFICINA)" && _completadoFaltaQc(orden)) return "chip-espera";
  if (e === "COMPLETADO (EN OFICINA)") return "chip-lista"; // verde
  if (e === "ANULADA") return "chip-entregada";             // gris (antes caía al ámbar por defecto)
  if (e === "ENTREGADO AL CLIENTE") return "chip-entregada"; // gris
  if (e === "CERRADA (VISITA)") return "chip-aprobada";     // esmeralda
  if (e === "CERRADA (DEVOLUCION)") return "chip-aprobada"; // esmeralda
  if (e === "CERRADA (ENTRADA)") return "chip-aprobada";    // esmeralda
  // Sin retirar NO es esmeralda: las otras CERRADA son cierres limpios, esta
  // es un caso que se archiva con radios ajenos todavía en la casa.
  if (e === "CERRADA (SIN RETIRAR)") return "chip-espera";  // ámbar
  return "chip-espera"; // estados legacy/extendidos: neutral
}

function tipoChip(tipo) {
  if (!tipo) return '';
  const t = tipo.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Color SOLO para los tipos con circuito propio fuera del flujo de taller
  // (2026-09-03, revisión de densidad): son los raros Y los que cambian cómo
  // se trabaja la fila. El caso común (REPARACION ≈80% de la bandeja) va
  // neutro — un chip brillante en 8 de cada 10 filas no señala nada y
  // competía con el chip de estado, que es el que debe mandar.
  const cls =
    t.includes('DEVOL')   ? 'tipo-chip--devolucion' :
    t.includes('VISITA')  ? 'tipo-chip--visita'     :
    t.includes('ENTRADA') ? 'tipo-chip--entrada'    : 'tipo-chip--neutro';
  // Nombre corto en pantalla; el valor crudo queda en el title (auditoría de
  // módulos 2026-09-30, 01 P4: "VISITA TECN", "PROGRAMACI" cortados en la fila).
  const label =
    t.includes('DEVOL')   ? 'Devolución'   :
    t.includes('VISITA')  ? 'Visita'       :
    t.includes('ENTRADA') ? 'Entrada'      :
    t.includes('PROGRAM') ? 'Programación' :
    t.includes('REPARA')  ? 'Reparación'   : tipo.trim();
  return `<span class="tipo-chip ${cls}" title="${escapeHtml(tipo.trim())}">${escapeHtml(label)}</span>`;
}

// ── Nombres de estado EN PANTALLA (auditoría UX 2026-09-28, T1) ──────────
// Solo cambia lo que se lee; el valor guardado (estado_reparacion), las rules,
// los correos y los tests siguen con los nombres de siempre. El `title` de la
// fila conserva el valor crudo.
//   POR ASIGNAR           → "Por recibir" (su botón es Recibir). Los tipos que
//                           no pasan por mostrador (PROGRAMACIÓN, ENTRADA,
//                           VISITA) arrancan en Asignar: ahí sí es "Por asignar".
//   RECIBIDO EN MOSTRADOR → "Por asignar" (la cola real de asignación).
//   COMPLETADO            → "Listo (falta QC)" / "Listo para entregar".
function _completadoFaltaQc(orden) {
  if (!orden) return false;
  if (esOrdenEntrada(orden) || esOrdenVisita(orden)) return false;
  return typeof OrdenesQC !== "undefined" && typeof OrdenesQC.qcPendiente === "function"
    && !!OrdenesQC.qcPendiente(orden);
}

function estadoCompacto(estado, orden) {
  const e = (estado || "").toUpperCase();
  if (e === "POR ASIGNAR") {
    const sinMostrador = orden && (esOrdenProgramacion(orden) || esOrdenEntrada(orden) || esOrdenVisita(orden));
    return sinMostrador ? "POR ASIGNAR" : "POR RECIBIR";
  }
  if (e === "RECIBIDO EN MOSTRADOR") return "POR ASIGNAR";
  if (e === "COMPLETADO (EN OFICINA)") {
    // Sin la orden a mano (o ENTRADA/VISITA, que no se entregan) queda el
    // nombre neutro.
    if (!orden || esOrdenEntrada(orden) || esOrdenVisita(orden)) return "COMPLETADO";
    return _completadoFaltaQc(orden) ? "LISTO (FALTA QC)" : "LISTO PARA ENTREGAR";
  }
  if (e === "ENTREGADO AL CLIENTE") return "ENTREGADO";
  if (e === "CERRADA (VISITA)") return "CERRADA";
  if (e === "CERRADA (DEVOLUCION)") return "CERRADA";
  if (e === "CERRADA (ENTRADA)") return "CERRADA";
  // "CERRADA" a secas se confundiría con los cierres limpios: lo que importa
  // de esta fila es que quedaron radios sin retirar.
  if (e === "CERRADA (SIN RETIRAR)") return "SIN RETIRAR";
  return e;
}

// Tooltip del chip de estado: el MISMO nombre de pantalla + qué significa.
// Antes el title llevaba el valor crudo y la fila "Por recibir" decía
// "POR ASIGNAR" al pasar el mouse (y "Listo para entregar" decía
// "COMPLETADO (EN OFICINA)") — dos nombres para lo mismo.
function estadoTooltip(estado, orden) {
  const e = (estado || "").toUpperCase();
  const nombre = estadoCompacto(estado, orden);
  const sinMostrador = orden && (esOrdenProgramacion(orden) || esOrdenEntrada(orden) || esOrdenVisita(orden));
  const que =
    e === "POR ASIGNAR" ? (sinMostrador ? "esperando técnico" : "el cliente aún no entrega el equipo en mostrador")
    : e === "RECIBIDO EN MOSTRADOR" ? "recibida en mostrador, esperando técnico"
    : e === "ASIGNADO" ? "en manos del técnico"
    : e === "COMPLETADO (EN OFICINA)" ? (nombre === "LISTO (FALTA QC)" ? "trabajo terminado; falta el control de calidad para entregar" : nombre === "COMPLETADO" ? "trabajo terminado" : "trabajo terminado, en oficina")
    : e === "ENTREGADO AL CLIENTE" ? "entregada al cliente"
    : e === "CERRADA (SIN RETIRAR)" ? "archivada con equipos que el cliente no retiró"
    : "";
  const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  return que ? `${cap(nombre)}: ${que}` : cap(nombre);
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

// Equipos que el cliente todavía NO ha devuelto en una orden de DEVOLUCIÓN.
// Tres orígenes según cómo nació la orden:
//   · esperados[]            — lista por serial (contrato en el sistema)
//   · esperados_por_modelo[] — la baja no registró seriales: faltan por modelo
//   · total_esperado         — contrato de PAPEL: no hay lista previa, solo la
//     cantidad que el cliente declaró al abrir el tiquete. Sin este dato la
//     devolución sin contrato siempre daba 0 pendientes (todo lo que existe
//     está recibido), así que nada avisaba de los que faltaban.
// Misma fórmula que recordatorioOperativo (sección C) — si cambia una, cambia
// la otra.
function pendientesDevolucion(orden) {
  const dev = orden?.devolucion || {};
  const esperados = dev.esperados || [];
  const porSerial = esperados.filter(e => !e.resolucion).length;
  const porModelo = (dev.esperados_por_modelo || [])
    .reduce((s, m) => s + Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)), 0);
  let sinContrato = 0;
  if (dev.modo === 'sin_contrato') {
    const total = Number(dev.total_esperado || 0);
    const recibidos = esperados.filter(e => e.resolucion === 'recibido').length;
    if (total > 0) sinContrato = Math.max(0, total - recibidos);
  }
  return porSerial + porModelo + sinContrato;
}

// Una orden de PROGRAMACIÓN prepara equipos que YA están en CECOMUNICA:
// salen de bodega hacia el taller sin que el cliente entregue nada, así que
// la recepción en mostrador sobra — su flujo arranca directo en Asignar
// (decisión Alberto 2026-08-31). Las rules ya permitían el salto
// POR ASIGNAR → ASIGNADO; esto solo quita el paso muerto de la UI.
function esOrdenProgramacion(orden) {
  return normTxt(orden?.tipo_de_servicio).includes("programacion");
}

// Una orden de ENTRADA es la inspección de equipos que el cliente DEVOLVIÓ:
// entran al taller para revisión técnica (y cotización si hay daños o
// faltantes cobrables) y las unidades quedan bajo control de inventario.
// NUNCA se entregan al cliente — su terminal es CERRADA (ENTRADA), no
// ENTREGADO AL CLIENTE (ese terminal generaba la confusión entrada/entregar).
function esOrdenEntrada(orden) {
  return normTxt(orden?.tipo_de_servicio).includes("entrada");
}

// --- Puente window (F1, docs/plans/PLAN_MIGRACION_MODULAR.md) ---
// Estos nombres los usan otros archivos o el HTML (onclick / inline). Hoy son
// globales porque el archivo es un <script> clásico; al empaquetarse como
// módulo ES dejarían de serlo. El puente los publica de forma explícita.
Object.assign(window, {
  esOrdenDevolucion, esOrdenEntrada, esOrdenProgramacion, esOrdenVisita,
  escapeHtml, estadoCompacto, estadoTooltip, formatFecha, formatFechaHora, getEstadoClass,
  nombreClienteDe, normTxt, pendientesDevolucion, tipoChip
});

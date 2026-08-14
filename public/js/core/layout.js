/* =============================================================
   Layout — shared topbar component
   Modes (for renderTopbarFor):
     'index'  — module list page: home + logout, optional action buttons
     'edit'   — create/edit form: back to parent index + logout
     'child'  — workflow child: back to parent task + logout
     'home'   — root home page: logout only, no home link

   DECISIÓN (plan arranque rápido, 2026-08-13): este archivo se queda
   SÍNCRONO a propósito, aunque casi todo lo demás es defer. Dos razones:
   (1) el IIFE de abajo debe correr ANTES del primer paint para reservar
   la columna del rail; (2) ~40 páginas llaman Layout.renderTopbar(...)
   en un <script> inline del body que se ejecuta durante el parse.
   Son ~6 KB gzip same-origin — diferirlo obligaría a migrar esas 40
   páginas para un ahorro marginal.
   ============================================================= */

/* Estado del rail en tiempo de PARSE (este archivo se carga síncrono en el
   <head> de todas las páginas): marca <html data-cc-rail="full|mini"> para
   que el CSS reserve la columna del rail en el primer paint. Sin esto la
   página se pintaba a todo el ancho y solo al montarse el rail —después de
   onAuthStateChanged + la lectura de usuarios/{uid}— saltaba a su ancho
   final; los usuarios con el rail contraído sufrían además un segundo salto
   (236px→64px) al leerse localStorage. */
(() => {
  let mini = false;
  try { mini = localStorage.getItem('cc_rail_mini') === '1'; } catch { /* sin storage */ }
  document.documentElement.setAttribute('data-cc-rail', mini ? 'mini' : 'full');
})();

const Layout = (() => {

  // CeComunica monogram — acabado completo (placa navy con volumen,
  // brillo superior, trazos C en relieve, nodo central con halo).
  // SVG maestro: public/brand/cecomunica-monogram.svg.
  const BRAND_MARK = `<svg class="topbar-brand" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-label="CeComunica" role="img"><defs><linearGradient id="ccPlate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A4267"/><stop offset="0.5" stop-color="#0B2A47"/><stop offset="1" stop-color="#06203A"/></linearGradient><linearGradient id="ccSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="0.32" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><linearGradient id="ccWhite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C4D2E0"/></linearGradient><linearGradient id="ccCyan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BD3EE"/><stop offset="1" stop-color="#0091B0"/></linearGradient><radialGradient id="ccGlow"><stop offset="0" stop-color="#7FE3FF" stop-opacity="0.9"/><stop offset="1" stop-color="#7FE3FF" stop-opacity="0"/></radialGradient></defs><rect x="0" y="0" width="64" height="64" rx="10" fill="url(#ccPlate)"/><rect x="0" y="0" width="64" height="64" rx="10" fill="url(#ccSheen)"/><path d="M30 14 H22 a14 14 0 0 0 0 36 H30" stroke="url(#ccWhite)" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M34 14 H42 a14 14 0 0 1 0 36 H34" stroke="url(#ccCyan)" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="32" cy="32" r="6" fill="url(#ccGlow)"/><rect x="30" y="30" width="4" height="4" rx="1" fill="#00B4D8"/></svg>`;

  /* Origen de navegación (?volver=): los espacios (Almacén/Finanzas) mandan
     a las páginas con este parámetro para que el botón Volver regrese AL
     ESPACIO y no al módulo histórico de la página — sin él, entrar a un ítem
     de la bandeja era un viaje sin regreso. Whitelist a propósito: el
     parámetro elige un destino conocido, nunca una URL cruda. */
  const _VOLVER_DESTINOS = {
    almacen:     { href: '/almacen/index.html',                 label: '<i data-lucide="arrow-left"></i> Almacén · Hoy' },
    existencias: { href: '/almacen/index.html?tab=existencias', label: '<i data-lucide="arrow-left"></i> Existencias' },
    finanzas:    { href: '/facturacion/activacion.html',        label: '<i data-lucide="arrow-left"></i> Finanzas' },
  };

  function renderTopbar(opts = {}) {
    const {
      title      = '',
      leftSlot   = '',         // raw HTML rendered after title (e.g. inline search)
      actions    = [],
      showHome   = true,
      homeHref   = '../index.html',
      showLogout = true,
      menu       = [],
      menuId     = 'topbar-menu',  // override if multiple menus on a page
    } = opts;
    let back = opts.back || null;
    try {
      const volver = new URLSearchParams(location.search).get('volver');
      if (volver && _VOLVER_DESTINOS[volver]) back = _VOLVER_DESTINOS[volver];
    } catch { /* sin URL rara no hay override */ }

    const btnHtml = (a) => {
      if (a.html) return a.html;  // raw HTML pass-through (e.g. view-toggle widget)
      const id    = a.id          ? ` id="${a.id}"`                         : '';
      const cls   = a.cls         ? ` ${a.cls}`                             : '';
      const data  = a.dataAction  ? ` data-action="${a.dataAction}"`        : '';
      const stop  = a.stopProp    ? ` data-stop-propagation="true"`         : '';
      const title = a.title       ? ` title="${a.title}"`                   : '';
      const click = a.onclick     ? ` onclick="${a.onclick}"`               : '';
      if (a.href) return `<a href="${a.href}" class="btn${cls}"${id}${data}${title}>${a.label}</a>`;
      return `<button class="btn${cls}"${id}${data}${stop}${title}${click}>${a.label}</button>`;
    };

    const menuItemHtml = (item) => {
      if (item.divider) return '<div class="overflow-menu-divider"></div>';
      if (item.html)    return item.html;  // raw HTML (e.g. checkbox-labelled toggle)
      const id      = item.id        ? ` id="${item.id}"`              : '';
      const cls     = item.danger    ? ' danger'                       : '';
      const data    = item.dataAction ? ` data-action="${item.dataAction}"` : '';
      const click   = item.onclick   ? ` onclick="${item.onclick}"`    : '';
      const style   = item.hidden    ? ' style="display:none;"'        : '';
      if (item.href) return `<a href="${item.href}" class="overflow-menu-item${cls}"${id}${data}${style}>${item.label}</a>`;
      return `<button class="overflow-menu-item${cls}"${id}${data}${click}${style}>${item.label}</button>`;
    };

    const actionBtns = actions.map(btnHtml).join('');
    const backLabel  = back && (back.label || '<i data-lucide="arrow-left"></i> Volver');
    const backBtn    = !back
      ? ''
      : back.onclick
        // onclick-driven back (destino dinámico, p.ej. volverAContrato()).
        ? `<button type="button" class="btn btn-ghost" onclick="${back.onclick}">${backLabel}</button>`
        // href-driven back (caso por defecto en el resto de páginas).
        : `<a href="${back.href}" class="btn btn-ghost">${backLabel}</a>`;
    const menuWrapId = `__layout-menu-wrap-${menuId}`;
    const menuBtnId  = `__layout-menu-btn-${menuId}`;
    const menuDropId = `__layout-menu-dropdown-${menuId}`;
    const menuBtn    = menu.length
      ? `<div class="overflow-menu topbar-menu" id="${menuWrapId}">
      <button class="btn btn-ghost btn-topbar-menu" id="${menuBtnId}" data-action="toggle-topbar-menu" data-stop-propagation="true" aria-haspopup="true" aria-expanded="false" aria-label="Más opciones"><i data-lucide="more-vertical"></i> <span class="topbar-menu-label">Más</span></button>
      <div class="overflow-menu-dropdown" id="${menuDropId}">${menu.map(menuItemHtml).join('')}</div>
    </div>`
      : '';
    const homeBtn    = showHome
      ? `<a href="${homeHref}" class="btn btn-ghost"><i data-lucide="home"></i> Menú principal</a>`
      : '';
    const logoutBtn  = showLogout
      ? `<button class="btn btn-ghost" onclick="cerrarSesion()" data-action="logout"><i data-lucide="log-out"></i> Cerrar sesión</button>`
      : '';

    const html = `
<header class="topbar app-topbar">
  <div class="topbar-left app-topbar-logo">
    ${BRAND_MARK}
    <h1 class="topbar-title app-topbar-title">${title}</h1>
    ${leftSlot}
  </div>
  <span class="app-topbar-spacer"></span>
  <div class="topbar-actions topbar-right app-topbar-actions">
    ${actionBtns}
    ${backBtn}
    ${menuBtn}
    ${homeBtn}
    ${logoutBtn}
  </div>
</header>`;

    const mount = document.getElementById('topbar-mount') || document.getElementById('app-topbar-mount');
    if (mount) {
      mount.outerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      if (menu.length) _wireMenuToggle(menuBtnId, menuDropId);
    }
  }

  /* Shortcut: pick sensible defaults by page mode */
  function renderTopbarFor(mode, opts = {}) {
    switch (mode) {
      case 'index':
        return renderTopbar({ showHome: true, showLogout: true, homeHref: '../index.html', ...opts });
      case 'edit':
        return renderTopbar({ showHome: false, showLogout: true, back: { href: 'index.html' }, ...opts });
      case 'child':
        return renderTopbar({ showHome: false, showLogout: true, ...opts });
      case 'home':
        return renderTopbar({ showHome: false, showLogout: true, ...opts });
      default:
        return renderTopbar(opts);
    }
  }

  /* Wire up a toggle button + dropdown by element IDs */
  function _wireMenuToggle(btnId, dropId) {
    const btn  = document.getElementById(btnId);
    const drop = document.getElementById(dropId);
    if (!btn || !drop) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = drop.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!drop.contains(e.target) && e.target !== btn) {
        drop.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* =============================================================
     renderShell — shell del rediseño "Command Center" (rail navy +
     topbar claro). Lo usan las páginas MIGRADAS al rediseño (F2+ del
     PLAN_REDISENO_COMMAND_CENTER.md); renderTopbar sigue intacto para
     las demás. Requiere js/core/modulos.js cargado antes.

     La página aporta el esqueleto y los mounts:
       <div class="app">
         <div id="rail-mount"></div>
         <main class="work">
           <div id="shelltop-mount"></div>
           <div class="work__body"> …contenido… </div>
         </main>
       </div>

     Layout.renderShell({
       active: 'ordenes',          // módulo activo en el rail
       rol, userName,              // pie del rail (rol real, no efectivo)
       title, titleIcon,           // topbar
       back: { href },             // botón volver opcional
       actions: [...],             // mismos specs que renderTopbar
     });
     ============================================================= */

  const _RAIL_CATALOGO = [
    { grupo: 'Operación', items: [
      { id: 'ordenes',     label: 'Órdenes',          icon: 'settings-2',  href: '/ordenes/index.html' },
      { id: 'poc',         label: 'Base PoC',          icon: 'radio-tower', href: '/POC/index.html' },
      { id: 'vendedores',  label: 'Registro (Ventas)', icon: 'briefcase',   href: '/POC/vendedores-batch.html' },
    ]},
    { grupo: 'Comercial', items: [
      { id: 'cotizaciones', label: 'Cotizaciones', icon: 'receipt',   href: '/cotizaciones/index.html' },
      { id: 'contratos',    label: 'Contratos',    icon: 'file-text', href: '/contratos/index.html' },
      { id: 'clientes',     label: 'Clientes',     icon: 'users',     href: '/clientes/index.html' },
    ]},
    { grupo: 'Almacén · finanzas', items: [
      // Consolidación 2026-08: 'almacen' absorbió pendientes + inventario
      // (tablero) + el trabajo diario de equipos; la página de Equipos por
      // serial sigue viva como herramienta avanzada (menú de Almacén y
      // deep-links de señales/correos), pero ya no ocupa rail.
      { id: 'almacen',     label: 'Almacén',     icon: 'warehouse',    href: '/almacen/index.html' },
      { id: 'piezas',      label: 'Piezas',      icon: 'puzzle',       href: '/inventario/piezas.html' },
      { id: 'facturacion', label: 'Finanzas',    icon: 'calculator',   href: '/facturacion/activacion.html' },
    ]},
  ];

  const _ROL_LABELS = {
    administrador: 'Administración', gerente: 'Gerencia', recepcion: 'Recepción',
    jefe_taller: 'Jefe de taller', tecnico: 'Técnico', tecnico_operativo: 'Técnico operativo',
    vendedor: 'Ventas', inventario: 'Inventario', contabilidad: 'Contabilidad', vista: 'Solo lectura',
  };

  /* Rail solo (sin topbar) — para páginas HÍBRIDAS que conservan su
     topbar/estilos de ceco-ui y solo suman la navegación lateral (cargan
     css/ceco-rail.css). renderShell lo reutiliza para páginas migradas. */
  function renderRail(opts = {}) {
    const { active = '', rol = '', userName = '' } = opts;

    const visibles = (window.MODULOS && MODULOS.deRol(rol)) || [];
    const grupos = _RAIL_CATALOGO.map(g => {
      const items = g.items.filter(it => visibles.includes(it.id));
      if (!items.length) return '';
      return `<div class="rail__group">${g.grupo}</div>` + items.map(it => `
        <a class="rail__link${it.id === active ? ' is-active' : ''}" href="${it.href}" title="${it.label}">
          <i data-lucide="${it.icon}"></i> <span class="rail__txt">${it.label}</span>
          <span class="badge" data-rail-badge="${it.id}" style="display:none"></span>
        </a>`).join('');
    }).join('');

    const adminLink = rol === 'administrador'
      ? `<div class="rail__group">Administración</div>
         <a class="rail__link${active === 'admin' ? ' is-active' : ''}" href="/admin/index.html" title="Panel admin"><i data-lucide="shield"></i> <span class="rail__txt">Panel admin</span></a>`
      : '';

    const iniciales = (userName || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

    const railHtml = `
<aside class="rail" id="ccRail">
  <div class="rail__brand">
    ${BRAND_MARK}
    <div class="wm"><b>CECOMUNICA</b><span>Centro de gestión</span></div>
  </div>
  <nav class="rail__nav">
    <a class="rail__link${active === 'inicio' ? ' is-active' : ''}" href="/index.html" title="Inicio"><i data-lucide="layout-grid"></i> <span class="rail__txt">Inicio</span></a>
    ${grupos}
    ${adminLink}
  </nav>
  <button class="rail__collapse" id="ccRailCollapse" type="button" title="Contraer / expandir menú">
    <i data-lucide="chevrons-left"></i> <span class="rail__txt">Contraer</span>
  </button>
  <div class="rail__foot">
    <div class="rail__avatar">${iniciales}</div>
    <div class="rail__who"><b>${userName || ''}</b><span>${_ROL_LABELS[rol] || rol || ''}</span></div>
  </div>
</aside>
<div class="rail-scrim" id="ccRailScrim"></div>`;

    const railMount = document.getElementById('rail-mount');
    if (railMount) railMount.outerHTML = railHtml;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Badge de la bandeja de bodega. Doble guarda a propósito: solo cuenta si
    // el rol TIENE el módulo y si la página cargó el servicio — así el conteo
    // lo pagan las páginas de inventario y nadie más.
    if ((visibles.includes('almacen') || visibles.includes('pendientes')) && window.ColaInventarioService) {
      ColaInventarioService.pintarBadgeRail();
    }

    // El ancho de la columna lo manda <html data-cc-rail> (fijado ya en el
    // parse, arriba); aquí solo se sincroniza al alternar. Modo mini (solo
    // iconos) persistido por usuario del navegador en localStorage.
    const appEl = document.querySelector('.cc-app') || document.querySelector('.app');
    const railEl = document.getElementById('ccRail');
    const collapseBtn = document.getElementById('ccRailCollapse');
    const MINI_KEY = 'cc_rail_mini';
    const applyMini = (mini) => {
      document.documentElement.setAttribute('data-cc-rail', mini ? 'mini' : 'full');
      appEl?.classList.toggle('rail-mini', mini);
      railEl?.classList.toggle('rail--mini', mini);
    };
    appEl?.classList.add('has-rail');
    let mini = false;
    try { mini = localStorage.getItem(MINI_KEY) === '1'; } catch { /* sin storage */ }
    applyMini(mini);
    collapseBtn?.addEventListener('click', () => {
      mini = !mini;
      applyMini(mini);
      try { localStorage.setItem(MINI_KEY, mini ? '1' : '0'); } catch { /* sin storage */ }
    });

    // drawer móvil — solo si la página trae el botón (renderShell lo emite;
    // las híbridas desktop-only no lo tienen y el rail se oculta por CSS).
    const rail = document.getElementById('ccRail');
    const scrim = document.getElementById('ccRailScrim');
    const toggle = document.getElementById('ccRailToggle');
    if (rail && toggle) {
      toggle.addEventListener('click', () => {
        rail.classList.toggle('is-open');
        scrim?.classList.toggle('is-open', rail.classList.contains('is-open'));
      });
      scrim?.addEventListener('click', () => {
        rail.classList.remove('is-open');
        scrim.classList.remove('is-open');
      });
    }
  }

  function renderShell(opts = {}) {
    const {
      active = '', rol = '', userName = '',
      title = '', titleIcon = '', back = null, actions = [],
    } = opts;

    const btnHtml = (a) => {
      if (a.html) return a.html;
      const id = a.id ? ` id="${a.id}"` : '';
      const cls = a.cls ? ` ${a.cls}` : '';
      const click = a.onclick ? ` onclick="${a.onclick}"` : '';
      if (a.href) return `<a href="${a.href}" class="btn${cls}"${id}>${a.label}</a>`;
      return `<button class="btn${cls}"${id}${click}>${a.label}</button>`;
    };
    const backBtn = back
      ? `<a class="btn btn--ghost btn--icon" href="${back.href}" aria-label="Volver"><i data-lucide="arrow-left"></i></a>`
      : '';

    const topHtml = `
<div class="topbar">
  <button class="btn btn--ghost btn--icon rail__toggle" id="ccRailToggle" aria-label="Menú"><i data-lucide="menu"></i></button>
  ${backBtn}
  <div class="topbar__title">${titleIcon ? `<i data-lucide="${titleIcon}"></i> ` : ''}${title}</div>
  <div class="topbar__spacer"></div>
  ${actions.map(btnHtml).join('')}
</div>`;

    // Topbar primero (emite #ccRailToggle), luego el rail — renderRail
    // encuentra el toggle ya en el DOM y wirea el drawer móvil.
    const topMount = document.getElementById('shelltop-mount');
    if (topMount) topMount.outerHTML = topHtml;
    renderRail({ active, rol, userName });
  }

  /* Bootstrapping estándar del rail para páginas híbridas: espera auth,
     resuelve el nombre (cache de sesión) y pinta el rail con el rol
     efectivo ("Ver como"). Llamar tras DOMContentLoaded — los scripts de
     Firebase cargan con defer y este helper los necesita ya ejecutados. */
  function initRail(active) {
    if (typeof verificarAccesoYAplicarVisibilidad !== 'function') return;

    // Pintado OPTIMISTA: con sesión cacheada en la pestaña, el rail sale en
    // el primer frame tras DOMContentLoaded — sin esperar a que Auth restaure
    // desde IndexedDB (~100-300 ms). Es lo que hace que el rail "no se mueva"
    // entre páginas (además lo empareja la view transition, ceco-rail.css).
    // Si la sesión expiró de verdad, verificarAcceso redirige a login como
    // siempre; el rail optimista solo se vio un instante y sin datos.
    let optimista = null;
    const c = window.Sesion && Sesion.cacheAnonima ? Sesion.cacheAnonima() : null;
    if (c && c.rol) {
      const rolFx = window.MODULOS ? MODULOS.rolEfectivo(c.rol) : c.rol;
      renderRail({ active, rol: rolFx, userName: c.nombre || '' });
      optimista = { rolFx, nombre: c.nombre || '' };
    }

    verificarAccesoYAplicarVisibilidad(async (rol) => {
      const user = firebase.auth().currentUser;
      if (!user) return;
      // Sesion dedupe la lectura de usuarios/{uid} con la del guard y la
      // sirve de sessionStorage en navegaciones warm (cero red).
      const nombre = window.Sesion
        ? await Sesion.nombre(user)
        : (user.displayName || (user.email || '').split('@')[0]);
      const rolFx = window.MODULOS ? MODULOS.rolEfectivo(rol) : rol;
      // Si el optimista ya pintó exactamente esto, no re-render: el swap de
      // outerHTML idéntico haría parpadear los iconos del rail.
      if (optimista && optimista.rolFx === rolFx && optimista.nombre === nombre) return;
      renderRail({ active, rol: rolFx, userName: nombre });
    });
  }

  /* Pinta un conteo en el badge de un módulo del rail (oculto si n falsy). */
  function setRailBadge(moduloId, n) {
    document.querySelectorAll(`[data-rail-badge="${moduloId}"]`).forEach(el => {
      if (n) { el.textContent = String(n); el.style.display = ''; }
      else { el.style.display = 'none'; }
    });
  }

  return { renderTopbar, renderTopbarFor, renderShell, renderRail, initRail, setRailBadge, wireMenuToggle: _wireMenuToggle };
})();

/* ── Ctrl/Cmd+K: buscador global (auditoría UX 2026-08, A2) ────────────────
   El palette (js/ui/searchPalette.js) busca clientes/órdenes/contratos/
   cotizaciones/PoC pero estaba montado SOLO en el panel admin — buscar "el
   contrato de Fulano" desde órdenes costaba salir al home, entrar a
   contratos y buscar. layout.js es el único script presente en todas las
   páginas con shell, así que el atajo vive aquí y carga los scripts + css
   BAJO DEMANDA al primer Ctrl+K: cero costo en el arranque. En admin (que
   ya trae los scripts en el head) el loader los detecta y solo abre. */
(() => {
  let cargando = null;
  const _css = (href) => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  };
  const _script = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('No cargó ' + src));
    document.head.appendChild(s);
  });
  const asegurarPalette = () => {
    if (window.SearchPalette && window.BusquedaGlobalService) return Promise.resolve();
    if (!cargando) {
      _css('/css/search-palette.css?v=sp1');
      cargando = (async () => {
        // OrdenesService es opcional para el palette (guard interno), pero
        // sin él no salen órdenes en los resultados — se trae también.
        if (typeof OrdenesService === 'undefined') {
          try { await _script('/js/services/ordenesService.js?v=sp1'); }
          catch (_) { /* palette sin resultados de órdenes */ }
        }
        if (!window.BusquedaGlobalService) await _script('/js/services/busquedaGlobalService.js?v=sp1');
        if (!window.SearchPalette) await _script('/js/ui/searchPalette.js?v=sp1');
      })();
    }
    return cargando;
  };
  document.addEventListener('keydown', async (e) => {
    if (!(e.metaKey || e.ctrlKey) || (e.key !== 'k' && e.key !== 'K')) return;
    // Sin Firebase montado no hay qué buscar (páginas públicas/impresión).
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    e.preventDefault();
    try {
      await asegurarPalette();
      const abierto = document.querySelector('.search-palette-overlay.is-open');
      if (abierto) window.SearchPalette.close();
      else window.SearchPalette.open();
    } catch (err) { console.warn('[palette] no se pudo abrir:', err); }
  });
})();

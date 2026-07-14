/* =============================================================
   Layout — shared topbar component
   Modes (for renderTopbarFor):
     'index'  — module list page: home + logout, optional action buttons
     'edit'   — create/edit form: back to parent index + logout
     'child'  — workflow child: back to parent task + logout
     'home'   — root home page: logout only, no home link
   ============================================================= */

const Layout = (() => {

  // CeComunica monogram — acabado completo (placa navy con volumen,
  // brillo superior, trazos C en relieve, nodo central con halo).
  // SVG maestro: public/brand/cecomunica-monogram.svg.
  const BRAND_MARK = `<svg class="topbar-brand" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-label="CeComunica" role="img"><defs><linearGradient id="ccPlate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A4267"/><stop offset="0.5" stop-color="#0B2A47"/><stop offset="1" stop-color="#06203A"/></linearGradient><linearGradient id="ccSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/><stop offset="0.32" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient><linearGradient id="ccWhite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C4D2E0"/></linearGradient><linearGradient id="ccCyan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BD3EE"/><stop offset="1" stop-color="#0091B0"/></linearGradient><radialGradient id="ccGlow"><stop offset="0" stop-color="#7FE3FF" stop-opacity="0.9"/><stop offset="1" stop-color="#7FE3FF" stop-opacity="0"/></radialGradient></defs><rect x="0" y="0" width="64" height="64" rx="10" fill="url(#ccPlate)"/><rect x="0" y="0" width="64" height="64" rx="10" fill="url(#ccSheen)"/><path d="M30 14 H22 a14 14 0 0 0 0 36 H30" stroke="url(#ccWhite)" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M34 14 H42 a14 14 0 0 1 0 36 H34" stroke="url(#ccCyan)" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="32" cy="32" r="6" fill="url(#ccGlow)"/><rect x="30" y="30" width="4" height="4" rx="1" fill="#00B4D8"/></svg>`;

  function renderTopbar(opts = {}) {
    const {
      title      = '',
      leftSlot   = '',         // raw HTML rendered after title (e.g. inline search)
      actions    = [],
      back       = null,
      showHome   = true,
      homeHref   = '../index.html',
      showLogout = true,
      menu       = [],
      menuId     = 'topbar-menu',  // override if multiple menus on a page
    } = opts;

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
      { id: 'inventario',  label: 'Inventario',  icon: 'package',    href: '/inventario/index.html' },
      { id: 'piezas',      label: 'Piezas',      icon: 'puzzle',     href: '/inventario/piezas.html' },
      { id: 'facturacion', label: 'Facturación', icon: 'calculator', href: '/facturacion/index.html' },
    ]},
  ];

  const _ROL_LABELS = {
    administrador: 'Administración', gerente: 'Gerencia', recepcion: 'Recepción',
    jefe_taller: 'Jefe de taller', tecnico: 'Técnico', tecnico_operativo: 'Técnico operativo',
    vendedor: 'Ventas', inventario: 'Inventario', contabilidad: 'Contabilidad', vista: 'Solo lectura',
  };

  function renderShell(opts = {}) {
    const {
      active = '', rol = '', userName = '',
      title = '', titleIcon = '', back = null, actions = [],
    } = opts;

    const visibles = (window.MODULOS && MODULOS.deRol(rol)) || [];
    const grupos = _RAIL_CATALOGO.map(g => {
      const items = g.items.filter(it => visibles.includes(it.id));
      if (!items.length) return '';
      return `<div class="rail__group">${g.grupo}</div>` + items.map(it => `
        <a class="rail__link${it.id === active ? ' is-active' : ''}" href="${it.href}">
          <i data-lucide="${it.icon}"></i> ${it.label}
          <span class="badge" data-rail-badge="${it.id}" style="display:none"></span>
        </a>`).join('');
    }).join('');

    const adminLink = rol === 'administrador'
      ? `<div class="rail__group">Administración</div>
         <a class="rail__link${active === 'admin' ? ' is-active' : ''}" href="/admin/index.html"><i data-lucide="shield"></i> Panel admin</a>`
      : '';

    const iniciales = (userName || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

    const railHtml = `
<aside class="rail" id="ccRail">
  <div class="rail__brand">
    ${BRAND_MARK}
    <div class="wm"><b>CECOMUNICA</b><span>Centro de gestión</span></div>
  </div>
  <nav class="rail__nav">
    <a class="rail__link${active === 'inicio' ? ' is-active' : ''}" href="/index.html"><i data-lucide="layout-grid"></i> Inicio</a>
    ${grupos}
    ${adminLink}
  </nav>
  <div class="rail__foot">
    <div class="rail__avatar">${iniciales}</div>
    <div class="rail__who"><b>${userName || ''}</b><span>${_ROL_LABELS[rol] || rol || ''}</span></div>
  </div>
</aside>
<div class="rail-scrim" id="ccRailScrim"></div>`;

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

    const railMount = document.getElementById('rail-mount');
    const topMount = document.getElementById('shelltop-mount');
    if (railMount) railMount.outerHTML = railHtml;
    if (topMount) topMount.outerHTML = topHtml;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // drawer móvil
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

  /* Pinta un conteo en el badge de un módulo del rail (oculto si n falsy). */
  function setRailBadge(moduloId, n) {
    document.querySelectorAll(`[data-rail-badge="${moduloId}"]`).forEach(el => {
      if (n) { el.textContent = String(n); el.style.display = ''; }
      else { el.style.display = 'none'; }
    });
  }

  return { renderTopbar, renderTopbarFor, renderShell, setRailBadge, wireMenuToggle: _wireMenuToggle };
})();

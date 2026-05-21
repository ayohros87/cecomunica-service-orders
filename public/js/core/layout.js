/* =============================================================
   Layout — shared topbar component
   Modes (for renderTopbarFor):
     'index'  — module list page: home + logout, optional action buttons
     'edit'   — create/edit form: back to parent index + logout
     'child'  — workflow child: back to parent task + logout
     'home'   — root home page: logout only, no home link
   ============================================================= */

const Layout = (() => {

  const BRAND_MARK = `<svg class="topbar-brand" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-label="CeComunica" role="img"><rect x="0" y="0" width="64" height="64" rx="10" fill="#0B2A47"/><path d="M30 14 H22 a14 14 0 0 0 0 36 H30" stroke="#FFFFFF" stroke-width="6" fill="none" stroke-linecap="square"/><path d="M34 14 H42 a14 14 0 0 1 0 36 H34" stroke="#00B4D8" stroke-width="6" fill="none" stroke-linecap="square"/><rect x="30" y="30" width="4" height="4" fill="#00B4D8"/></svg>`;

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
    const backBtn    = back
      ? `<a href="${back.href}" class="btn btn-ghost">${back.label || '<i data-lucide="arrow-left"></i> Volver'}</a>`
      : '';
    const menuWrapId = `__layout-menu-wrap-${menuId}`;
    const menuBtnId  = `__layout-menu-btn-${menuId}`;
    const menuDropId = `__layout-menu-dropdown-${menuId}`;
    const menuBtn    = menu.length
      ? `<div class="overflow-menu topbar-menu" id="${menuWrapId}">
      <button class="btn btn-ghost" id="${menuBtnId}" data-action="toggle-topbar-menu" data-stop-propagation="true" aria-haspopup="true" aria-expanded="false"><i data-lucide="more-horizontal"></i> Más</button>
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

  return { renderTopbar, renderTopbarFor, wireMenuToggle: _wireMenuToggle };
})();

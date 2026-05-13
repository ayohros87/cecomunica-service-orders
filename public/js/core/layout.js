/* =============================================================
   Layout — shared topbar component
   Modes (for renderTopbarFor):
     'index'  — module list page: home + logout, optional action buttons
     'edit'   — create/edit form: back to parent index + logout
     'child'  — workflow child: back to parent task + logout
     'home'   — root home page: logout only, no home link
   ============================================================= */

const Layout = (() => {

  function renderTopbar(opts = {}) {
    const {
      title      = '',
      actions    = [],
      back       = null,
      showHome   = true,
      homeHref   = '../index.html',
      showLogout = true,
    } = opts;

    const btnHtml = (a) => {
      const id    = a.id     ? ` id="${a.id}"`          : '';
      const cls   = a.cls    ? ` ${a.cls}`               : '';
      const click = a.onclick ? ` onclick="${a.onclick}"` : '';
      if (a.href) return `<a href="${a.href}" class="btn${cls}"${id}>${a.label}</a>`;
      return `<button class="btn${cls}"${id}${click}>${a.label}</button>`;
    };

    const actionBtns = actions.map(btnHtml).join('');
    const backBtn    = back
      ? `<a href="${back.href}" class="btn ghost">${back.label || '<i data-lucide="arrow-left"></i> Volver'}</a>`
      : '';
    const homeBtn    = showHome
      ? `<a href="${homeHref}" class="btn ghost"><i data-lucide="home"></i> Menú principal</a>`
      : '';
    const logoutBtn  = showLogout
      ? `<button class="btn ghost" onclick="cerrarSesion()"><i data-lucide="log-out"></i> Cerrar sesión</button>`
      : '';

    const html = `
<div class="topbar">
  <div class="topbar-left">
    <span class="topbar-title">${title}</span>
  </div>
  <div class="topbar-right">
    ${actionBtns}
    ${backBtn}
    ${homeBtn}
    ${logoutBtn}
  </div>
</div>`;

    const mount = document.getElementById('topbar-mount');
    if (mount) {
      mount.outerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
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

  return { renderTopbar, renderTopbarFor };
})();

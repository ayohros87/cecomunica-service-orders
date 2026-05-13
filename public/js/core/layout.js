/* =============================================================
   Layout — shared topbar component
   ============================================================= */

const Layout = (() => {

  function renderTopbar(opts = {}) {
    const {
      title      = '',
      actions    = [],       // [{ label, href?, onclick?, cls?, id? }]
      back       = null,     // { label, href } or null
      showHome   = true,
      homeHref   = '../index.html',
      showLogout = true,
    } = opts;

    const btnHtml = (a) => {
      const id    = a.id    ? ` id="${a.id}"`         : '';
      const cls   = a.cls   ? ` ${a.cls}`              : '';
      const click = a.onclick ? ` onclick="${a.onclick}"` : '';
      if (a.href) {
        return `<a href="${a.href}" class="btn${cls}"${id}>${a.label}</a>`;
      }
      return `<button class="btn${cls}"${id}${click}>${a.label}</button>`;
    };

    const actionBtns = actions.map(btnHtml).join('');
    const backBtn    = back
      ? `<a href="${back.href}" class="btn ghost">${back.label}</a>`
      : '';
    const homeBtn    = showHome
      ? `<a href="${homeHref}" class="btn ghost">Menú principal</a>`
      : '';
    const logoutBtn  = showLogout
      ? `<button class="btn ghost" onclick="cerrarSesion()">Cerrar sesión</button>`
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

  return { renderTopbar };
})();

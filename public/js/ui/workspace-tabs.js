// Barra de pestañas de ESPACIO (Almacén / Finanzas) — propuesta 2026-08.
// La app es multipágina sin build step: cada pestaña puede ser un enlace a
// otra página del espacio (href) o una sección de la misma página (onclick).
// Así el espacio SE SIENTE como una sola pantalla sin reescribir las páginas
// que ya funcionan. CSS en css/ws-tabs.css.
//
// Uso:
//   WorkspaceTabs.render('wsTabs-mount', {
//     active: 'hoy',
//     tabs: [
//       { id: 'hoy',   label: 'Hoy',    icon: 'inbox',  onclick: "AlmacenPage.setTab('hoy')" },
//       { id: 'piezas', label: 'Piezas', icon: 'puzzle', href: '../inventario/piezas.html' },
//     ],
//   });
//   WorkspaceTabs.setBadge('hoy', 12);      // contador (oculto si 0)
//   WorkspaceTabs.setActive('existencias'); // para tabs de la misma página
window.WorkspaceTabs = {

  // variant: 'sub' pinta el segundo nivel como píldoras (ver ws-tabs.css) para
  // que no se confunda con la tira de pestañas del espacio, que va encima.
  render(mountId, { tabs, active, variant }) {
    const el = document.getElementById(mountId);
    if (!el) return;
    const navCls = `ws-tabs${variant === 'sub' ? ' ws-tabs--sub' : ''}`;
    el.innerHTML = `<nav class="${navCls}" role="tablist">` + (tabs || []).map(t => {
      const is = t.id === active;
      const badge = `<span class="ws-tab-badge" id="wsBadge-${t.id}" style="display:none"></span>`;
      const inner = `${t.icon ? `<i data-lucide="${t.icon}"></i>` : ''}<span>${t.label}</span>${badge}`;
      const cls = `ws-tab${is ? ' is-active' : ''}`;
      if (t.href && !t.onclick) {
        return `<a class="${cls}" data-ws-tab="${t.id}" href="${t.href}" role="tab" aria-selected="${is}">${inner}</a>`;
      }
      return `<button class="${cls}" data-ws-tab="${t.id}" type="button" role="tab" aria-selected="${is}"
        ${t.onclick ? `onclick="${t.onclick}"` : ''}>${inner}</button>`;
    }).join('') + `</nav>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  setActive(tabId) {
    document.querySelectorAll('.ws-tab').forEach(el => {
      const is = el.getAttribute('data-ws-tab') === tabId;
      el.classList.toggle('is-active', is);
      el.setAttribute('aria-selected', is ? 'true' : 'false');
    });
  },

  setBadge(tabId, n) {
    const b = document.getElementById(`wsBadge-${tabId}`);
    if (!b) return;
    if (n) { b.textContent = String(n); b.style.display = ''; }
    else { b.style.display = 'none'; }
  },
};

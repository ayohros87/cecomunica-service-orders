// Navegación del espacio FINANZAS (propuesta Almacén/Finanzas 2026-08, E3/E4).
// Una sola definición de las pestañas del espacio, montada en cada página que
// lo compone (MPA sin build step: la barra navega entre páginas, pero el
// espacio se siente como una sola pantalla). Requiere workspace-tabs.js +
// css/ws-tabs.css y los mounts #wsTabs-mount (+ #wsSubTabs-mount en Catálogo).
window.FinanzasNav = {

  TABS: [
    { id: 'activacion', label: 'Activación', icon: 'zap',          href: '/facturacion/activacion.html' },
    { id: 'catalogo',   label: 'Catálogo',   icon: 'book-open',    href: '/inventario/modelos.html' },
    { id: 'quickbooks', label: 'QuickBooks', icon: 'link-2',       href: '/facturacion/clientes-qbo.html' },
    { id: 'emision',    label: 'Emisión',    icon: 'file-output',  href: '/facturacion/emision.html' },
    { id: 'panorama',   label: 'Panorama',   icon: 'bar-chart-3',  href: '/admin/financiero.html' },
  ],

  SUB_CATALOGO: [
    { id: 'modelos', label: 'Modelos', icon: 'radio',   href: '/inventario/modelos.html' },
    { id: 'piezas',  label: 'Piezas',  icon: 'puzzle',  href: '/inventario/piezas-tarifas.html' },
    { id: 'cargos',  label: 'Cargos',  icon: 'receipt', href: '/inventario/cargos.html' },
  ],

  // render('catalogo', 'modelos') — sub solo aplica dentro de Catálogo.
  render(active, sub) {
    if (!window.WorkspaceTabs) return;
    WorkspaceTabs.render('wsTabs-mount', { active, tabs: this.TABS });
    if (active === 'catalogo' && document.getElementById('wsSubTabs-mount')) {
      WorkspaceTabs.render('wsSubTabs-mount', { active: sub, tabs: this.SUB_CATALOGO });
    }
  },
};

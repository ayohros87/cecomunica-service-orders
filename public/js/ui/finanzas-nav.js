// Navegación del espacio FINANZAS (propuesta Almacén/Finanzas 2026-08, E3/E4).
// Una sola definición de las pestañas del espacio, montada en cada página que
// lo compone (MPA sin build step: la barra navega entre páginas, pero el
// espacio se siente como una sola pantalla). Requiere workspace-tabs.js +
// css/ws-tabs.css y los mounts #wsTabs-mount (+ #wsSubTabs-mount en Catálogo).
window.FinanzasNav = {

  // Orden por uso real (2026-09-04): la Bandeja va primero — es la facturación
  // que SÍ existe hoy (Recepción en QuickBooks, a mano). Las pestañas de la
  // emisión desde la app llevan ese nombre para que "activar" no se confunda
  // con lo que Recepción hace en QuickBooks; se ocultan a recepción mientras
  // la emisión no exista (ver OCULTAS_RECEPCION).
  TABS: [
    { id: 'bandeja',    label: 'Bandeja',             icon: 'inbox',        href: '/facturacion/bandeja.html' },
    { id: 'catalogo',   label: 'Catálogo',            icon: 'book-open',    href: '/inventario/modelos.html' },
    { id: 'quickbooks', label: 'QuickBooks',          icon: 'link-2',       href: '/facturacion/clientes-qbo.html' },
    { id: 'activacion', label: 'Facturará la app',    icon: 'zap',          href: '/facturacion/activacion.html' },
    { id: 'emision',    label: 'Emisión desde la app', icon: 'file-output', href: '/facturacion/emision.html' },
    // ?volver=finanzas: financiero.html vive en el panel de administración y su
    // "Volver" nativo va allá. Entrando por esta pestaña, el regreso es al espacio.
    { id: 'panorama',   label: 'Panorama',            icon: 'bar-chart-3',  href: '/admin/financiero.html?volver=finanzas' },
  ],

  // Recepción ve lo que opera hoy: Bandeja, Catálogo y QuickBooks. Lo demás
  // aparece cuando haya emisión desde la app (visibilidad de UI; el piso de
  // permisos sigue en rules y en los guards de cada página).
  OCULTAS_RECEPCION: ['activacion', 'emision', 'panorama'],

  SUB_CATALOGO: [
    { id: 'modelos', label: 'Modelos', icon: 'radio',   href: '/inventario/modelos.html' },
    { id: 'piezas',  label: 'Piezas',  icon: 'puzzle',  href: '/inventario/piezas-tarifas.html' },
    { id: 'cargos',  label: 'Cargos',  icon: 'receipt', href: '/inventario/cargos.html' },
  ],

  // render('catalogo', 'modelos', rol) — sub solo aplica dentro de Catálogo;
  // rol (opcional) oculta a recepción las pestañas de la emisión desde la app.
  // Se llama en el parse sin rol (primer frame) y de nuevo tras el auth con rol.
  render(active, sub, rol) {
    if (!window.WorkspaceTabs) return;
    const tabs = rol === 'recepcion'
      ? this.TABS.filter(t => !this.OCULTAS_RECEPCION.includes(t.id))
      : this.TABS;
    WorkspaceTabs.render('wsTabs-mount', { active, tabs });
    if (active === 'catalogo' && document.getElementById('wsSubTabs-mount')) {
      WorkspaceTabs.render('wsSubTabs-mount', { active: sub, tabs: this.SUB_CATALOGO, variant: 'sub' });
    }
  },
};

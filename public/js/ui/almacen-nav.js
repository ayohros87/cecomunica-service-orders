// Navegación del espacio ALMACÉN (propuesta Almacén/Finanzas 2026-08, E3).
// Una sola definición de las pestañas, montada en TODAS las páginas del
// espacio. Antes la lista vivía escrita a mano en almacen/index.html, una
// copia vieja de 3 pestañas en inventario/piezas.html y en ningún lado en
// Descartados / Con condición / No devueltos: salir de "Hoy" era caerse del
// espacio. Requiere workspace-tabs.js + css/ws-tabs.css y el mount
// #wsTabs-mount.
//
//   AlmacenNav.render('descartados');              // otra página del espacio
//   AlmacenNav.render('hoy', { enPagina: true });  // dentro de /almacen/
window.AlmacenNav = {

  // Las tres primeras son SECCIONES de /almacen/index.html; el resto son
  // páginas propias. `enPagina` las convierte en botones que cambian de
  // sección sin recargar (AlmacenPage.setTab); desde fuera son enlaces con
  // ?tab=, que index.html resuelve en el parse.
  EN_PAGINA: ['hoy', 'asignar', 'existencias'],

  TABS: [
    { id: 'hoy',         label: 'Hoy',           icon: 'inbox',        href: '/almacen/index.html' },
    // Asignar seriales a contratos y gestiones — la herramienta de bodega
    // (propuesta 2026-09-03). Antes se hacía en /contratos/ y en la ficha.
    { id: 'asignar',     label: 'Asignar',       icon: 'scan-barcode', href: '/almacen/index.html?tab=asignar' },
    { id: 'existencias', label: 'Existencias',   icon: 'package',      href: '/almacen/index.html?tab=existencias' },
    { id: 'piezas',      label: 'Piezas',        icon: 'puzzle',       href: '/inventario/piezas.html' },
    // Radios que control de calidad declaró inservibles. Vive aquí porque
    // quien tiene que consultarlo antes de recibir un equipo es bodega.
    { id: 'descartados', label: 'Descartados',   icon: 'ban',          href: '/inventario/descartados.html' },
    // Radios que funcionan pero arrastran una condición particular
    // (petición Solangel 2026-09-04). Bodega la ve antes de asignar.
    { id: 'condiciones', label: 'Con condición', icon: 'alert-triangle', href: '/inventario/condiciones.html' },
    // Equipos que el cliente no devolvió y hay que cobrarle. Vive aquí
    // porque nace de una devolución y termina saliendo del inventario.
    { id: 'no-devueltos', label: 'No devueltos', icon: 'hand-coins',   href: '/inventario/no-devueltos.html' },
  ],

  render(active, { enPagina = false, mount = 'wsTabs-mount' } = {}) {
    if (!window.WorkspaceTabs) return;
    const tabs = this.TABS.map(t => (enPagina && this.EN_PAGINA.includes(t.id))
      ? { id: t.id, label: t.label, icon: t.icon, onclick: `AlmacenPage.setTab('${t.id}')` }
      : t);
    WorkspaceTabs.render(mount, { active, tabs });
  },
};

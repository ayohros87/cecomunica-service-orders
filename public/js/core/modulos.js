/* =============================================================
   MODULOS — fuente única de visibilidad de módulos por rol.
   Extraído de public/index.html (Phase F0 del rediseño Command
   Center, PLAN_REDISENO_COMMAND_CENTER.md). La consumen:
     (a) las tarjetas del home (index.html)
     (b) el rail de navegación (Layout.renderShell)
     (c) el gating de señales/KPIs (js/pages/home-signals.js)
   Nota: esto es visibilidad de UI. El piso de permisos real vive
   en firestore.rules — nada de lo que se oculte aquí concede ni
   quita acceso a datos.
   ============================================================= */

window.MODULOS = (() => {

  // Rol → módulos visibles. "firma" disponible para todo el personal.
  // gerente (ausente del mapa histórico del home): supervisa comercial
  // (aprueba cotizaciones comerciales, aprueba/anula contratos) y tiene
  // ver-inventario/ver-progreso en roles.js.
  // "pendientes" (bandeja de trabajo de bodega, inventario/pendientes.html):
  // es la vía por la que `inventario` ve el trabajo que nace en un contrato
  // SIN darle el módulo Contratos — de ahí que lo tengan justo los dos roles
  // que trabajan esa cola.
  // "almacen" (espacio de trabajo /almacen/, propuesta 2026-08): absorbe la
  // bandeja de pendientes y es la entrada primaria de bodega; los módulos
  // viejos (inventario/equipos/piezas/pendientes) siguen vivos durante la
  // migración para el rail de sus páginas.
  // "centro" (Centro de gestión de clientes, Ola 1 de gestiones por cliente):
  // la vista 360 del cliente y el punto de partida de las gestiones — la
  // ÚNICA entrada al mundo clientes desde el home/rail (decisión 2026-09-03).
  // El grid de edición masiva (/clientes/index.html) ya no es un módulo
  // navegable: se llega SOLO desde el menú del Centro, marcado "avanzada"
  // (admin/recepción; la página conserva su propio guard de roles).
  const visiblesPorRol = {
    administrador: ["ordenes", "poc", "almacen", "inventario", "equipos", "pendientes", "facturacion", "vendedores", "centro", "contratos", "cotizaciones", "piezas", "firma"],
    gerente:       ["ordenes", "poc", "almacen", "inventario", "equipos", "centro", "contratos", "cotizaciones", "firma"],
    inventario:    ["almacen", "centro", "inventario", "equipos", "pendientes", "piezas", "firma"],
    contabilidad:  ["facturacion", "firma"],
    vista:         ["ordenes", "poc", "firma"],
    tecnico:       ["ordenes", "poc", "firma"],
    jefe_taller:   ["ordenes", "poc", "cotizaciones", "firma"],
    recepcion:     ["ordenes", "poc", "vendedores", "centro", "contratos", "firma"],
    vendedor:      ["ordenes", "vendedores", "centro", "contratos", "cotizaciones", "firma"],
    tecnico_operativo: ["ordenes", "firma"]
  };

  // Catálogo de módulos navegables (auditoría A9): fuente ÚNICA de id, label,
  // icono y href — la consumen el rail (Layout._RAIL_CATALOGO) y el buscador
  // global (searchPalette.GROUP_META). Antes eran 3 copias a sincronizar a
  // mano. Las tarjetas del home siguen siendo HTML estático en index.html
  // (gateadas por deRol): si cambias un href/icono aquí, revisa esas tiles.
  const CATALOGO = [
    { grupo: 'Operación', items: [
      { id: 'ordenes',     label: 'Órdenes',           icon: 'settings-2',  href: '/ordenes/index.html' },
      { id: 'poc',         label: 'Base PoC',          icon: 'radio-tower', href: '/POC/index.html' },
      { id: 'vendedores',  label: 'Registro (Ventas)', icon: 'briefcase',   href: '/POC/vendedores-batch.html' },
    ]},
    { grupo: 'Comercial', items: [
      { id: 'centro',       label: 'Centro de gestión', icon: 'compass', href: '/clientes/centro.html' },
      { id: 'cotizaciones', label: 'Cotizaciones', icon: 'receipt',   href: '/cotizaciones/index.html' },
      { id: 'contratos',    label: 'Contratos',    icon: 'file-text', href: '/contratos/index.html' },
    ]},
    { grupo: 'Almacén · finanzas', items: [
      { id: 'almacen',     label: 'Almacén',  icon: 'warehouse',  href: '/almacen/index.html' },
      { id: 'piezas',      label: 'Piezas',   icon: 'puzzle',     href: '/inventario/piezas.html' },
      { id: 'facturacion', label: 'Finanzas', icon: 'calculator', href: '/inventario/modelos.html' },
    ]},
  ];

  function deRol(rol) {
    return visiblesPorRol[rol] || [];
  }

  function puedeVer(rol, modulo) {
    return deRol(rol).includes(modulo);
  }

  // Rol efectivo para el modo "Ver como" (?as=ROL, solo admin, solo visual).
  // No afecta queries ni reglas: los datos siguen leyéndose como el usuario real.
  function rolEfectivo(rolReal, searchParams) {
    const asParam = (searchParams || new URLSearchParams(location.search)).get('as');
    const ok = asParam && rolReal === 'administrador'
      && visiblesPorRol[asParam] && asParam !== 'administrador';
    return ok ? asParam : rolReal;
  }

  return { visiblesPorRol, CATALOGO, deRol, puedeVer, rolEfectivo };
})();

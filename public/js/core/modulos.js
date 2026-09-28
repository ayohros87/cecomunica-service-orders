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
    // admin/contabilidad llegan a la bandeja por Finanzas → Bandeja; el módulo
    // suelto "facturacion_bandeja" es solo para recepción (una sola entrada
    // por rol, sin duplicar tarjetas en el home — Alberto 2026-09-04).
    administrador: ["ordenes", "poc", "almacen", "inventario", "equipos", "pendientes", "facturacion", "vendedores", "centro", "contratos", "cotizaciones", "piezas", "firma"],
    gerente:       ["ordenes", "poc", "almacen", "inventario", "equipos", "centro", "contratos", "cotizaciones", "firma"],
    // inventario perdió "centro" el 2026-09-03: bodega asigna los seriales de
    // las gestiones desde Almacén · Asignar, ya no desde la ficha del cliente.
    inventario:    ["almacen", "inventario", "equipos", "pendientes", "piezas", "firma"],
    contabilidad:  ["facturacion", "firma"],
    vista:         ["ordenes", "poc", "firma"],
    tecnico:       ["ordenes", "poc", "firma"],
    jefe_taller:   ["ordenes", "poc", "cotizaciones", "firma"],
    // "facturacion_bandeja" (2026-09-04): la cola de Recepción para facturar a
    // mano en QuickBooks. Es un módulo APARTE del espacio Finanzas a propósito:
    // la información financiera de la empresa (tarifas, costos, QuickBooks,
    // panorama) es solo admin/contabilidad (need-to-know, Alberto 2026-09-04).
    // Recepción ve la bandeja y nada más del espacio.
    recepcion:     ["ordenes", "poc", "vendedores", "centro", "contratos", "facturacion_bandeja", "firma"],
    vendedor:      ["ordenes", "vendedores", "centro", "contratos", "cotizaciones", "firma"],
    tecnico_operativo: ["ordenes", "firma"]
  };

  // Catálogo de módulos navegables (auditoría A9): fuente ÚNICA de id, label,
  // icono y href — la consumen el rail (Layout.renderRail), el buscador
  // global (searchPalette.GROUP_META) y, desde la auditoría UX 2026-09-28, las
  // tarjetas del home (index.html las genera de aquí: antes eran HTML estático
  // con etiquetas distintas a las del rail y una tarjeta muerta).
  // `subtitulo` y `keywords` son de la tarjeta del home; `tecla` es el atajo
  // de una tecla del home (index.html) y se pinta en la tarjeta.
  const CATALOGO = [
    { grupo: 'Operación', items: [
      { id: 'ordenes',     label: 'Órdenes',           icon: 'settings-2',  href: '/ordenes/index.html',
        subtitulo: 'Recepción, técnicos, estados y equipos', tecla: 'O',
        keywords: 'ordenes servicio reparaciones equipos tecnicos' },
      { id: 'poc',         label: 'Base PoC',          icon: 'radio-tower', href: '/POC/index.html',
        subtitulo: 'Radios, SIM, IP, grupos y notas', tecla: 'P',
        keywords: 'poc base datos radios sim ip gps grupos' },
      { id: 'vendedores',  label: 'Preparar lote (Ventas)', icon: 'briefcase', href: '/POC/vendedores-batch.html',
        subtitulo: 'Prepara el archivo que recepción carga', tecla: 'V',
        keywords: 'vendedores ventas preparar lote batch registro equipos radios' },
    ]},
    { grupo: 'Comercial', items: [
      { id: 'centro',       label: 'Centro de gestión', icon: 'compass', href: '/clientes/centro.html',
        subtitulo: 'La vista 360 del cliente', tecla: 'G',
        keywords: 'centro gestion clientes cartera flota equipos gestiones reemplazo demo baja aumento renovacion' },
      { id: 'cotizaciones', label: 'Cotizaciones', icon: 'receipt',   href: '/cotizaciones/index.html',
        subtitulo: 'Crear, editar e imprimir', tecla: 'Q',
        keywords: 'cotizaciones ventas proformas ofertas clientes' },
      { id: 'contratos',    label: 'Contratos',    icon: 'file-text', href: '/contratos/index.html',
        subtitulo: 'Altas, renovaciones y estados', tecla: 'C',
        keywords: 'contratos clientes facturacion vigencia seriales' },
    ]},
    { grupo: 'Almacén · finanzas', items: [
      { id: 'almacen',     label: 'Almacén',  icon: 'warehouse',  href: '/almacen/index.html',
        subtitulo: 'Hoy · Existencias · Piezas', tecla: 'I',
        keywords: 'almacen inventario bodega radios stock equipos serial pool kardex pendientes bandeja seriales piezas repuestos conteo' },
      // "piezas" NO es un módulo del rail (Alberto 2026-09-10): el repuesto se
      // trabaja DENTRO del espacio Almacén, en su pestaña (js/ui/almacen-nav.js).
      // El id sigue vivo en visiblesPorRol porque gatea la señal S9 del home
      // ("Piezas sin stock"), que aterriza directo en la página.
      { id: 'facturacion_bandeja', label: 'Facturación pendiente', icon: 'inbox', href: '/facturacion/bandeja.html',
        subtitulo: 'Qué facturar en QuickBooks y activar en POC',
        keywords: 'facturacion pendiente bandeja quickbooks poc recepcion avisos' },
      { id: 'facturacion', label: 'Finanzas', icon: 'calculator', href: '/facturacion/bandeja.html',
        subtitulo: 'Catálogo · QuickBooks · Emisión',
        keywords: 'finanzas facturacion contabilidad tarifas alquiler cargos modelos quickbooks activacion' },
    ]},
  ];

  // Rol → nombre legible (auditoría UX 2026-09-28): una sola tabla para el
  // pie del rail, el saludo y el banner "Ver como" del home y el perfil.
  const ROL_LABELS = {
    administrador: 'Administración', gerente: 'Gerencia', recepcion: 'Recepción',
    jefe_taller: 'Jefe de taller', tecnico: 'Técnico', tecnico_operativo: 'Técnico operativo',
    vendedor: 'Ventas', inventario: 'Inventario', contabilidad: 'Contabilidad', vista: 'Solo lectura',
  };

  function rolLabel(rol) {
    return ROL_LABELS[rol] || rol || '';
  }

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

  return { visiblesPorRol, CATALOGO, ROL_LABELS, rolLabel, deRol, puedeVer, rolEfectivo };
})();

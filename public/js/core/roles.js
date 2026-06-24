// Canonical role enum — single source of truth for all pages
window.ROLES = {
  ADMIN:             'administrador',
  GERENTE:           'gerente',
  VENDEDOR:          'vendedor',
  RECEPCION:         'recepcion',
  TECNICO:           'tecnico',
  TECNICO_OPERATIVO: 'tecnico_operativo',
  JEFE_TALLER:       'jefe_taller',
  INVENTARIO:        'inventario',
  CONTABILIDAD:      'contabilidad',
  VISTA:             'vista'
};

// Permission map — which roles can perform each action
const _PERMISOS = {
  'aprobar-contrato':  ['administrador', 'gerente'],
  'anular-contrato':   ['administrador', 'gerente'],
  'eliminar-contrato': ['administrador', 'gerente'],
  'crear-contrato':    ['administrador', 'vendedor'],
  'editar-contrato':   ['administrador', 'vendedor'],
  'subir-firmado':     ['administrador', 'vendedor'],
  'ver-contratos':     ['administrador', 'vendedor', 'recepcion', 'gerente'],
  'crear-orden':       ['administrador', 'vendedor', 'recepcion', 'tecnico', 'tecnico_operativo', 'jefe_taller'],
  'asignar-tecnico':   ['administrador', 'jefe_taller', 'recepcion'],
  'ver-progreso':      ['administrador', 'vendedor', 'jefe_taller', 'gerente'],
  'ver-inventario':    ['administrador', 'inventario', 'jefe_taller', 'gerente'],
  'admin-equipos':     ['administrador'],
  // Catálogo de modelos + tarifas de facturación (info sensible) → contabilidad.
  'gestionar-modelos': ['administrador', 'contabilidad'],
  // Preparar una cotización a partir de una orden (borrador). Los técnicos de
  // taller pueden prepararla; la aprobación/envío al cliente es otro permiso.
  'preparar-cotizacion': ['administrador', 'vendedor', 'recepcion', 'jefe_taller', 'tecnico', 'tecnico_operativo'],
  // Enviar al cliente una cotización DENTRO de política (descuento/total bajo el
  // umbral). El vendedor envía las suyas sin pasar por aprobación; las que exceden
  // el umbral requieren aprobación. La política vive en empresa/config
  // (cotizacion_descuento_max_pct / cotizacion_total_max) y se evalúa con
  // CotizacionTotales.requiereAprobacion (gate solo-UI por ahora).
  'enviar-cotizacion':   ['administrador', 'vendedor', 'jefe_taller'],
  // Aprobación FUERA de política, separada por TIPO de cotización:
  //   · servicio  (origen === 'orden', sale de una orden de taller) → jefe de
  //     mantenimiento (rol jefe_taller) + admin.
  //   · comercial (cotización directa del módulo de ventas)         → gerente + admin.
  // No usar estos permisos sueltos en la UI: pasar por puedeAprobarCotizacion(rol, cot),
  // que elige el correcto según cot.origen.
  'aprobar-cotizacion-servicio':  ['administrador', 'jefe_taller'],
  'aprobar-cotizacion-comercial': ['administrador', 'gerente'],
};

// canRole(rol, accion) → boolean
window.canRole = function(rol, accion) {
  const allowed = _PERMISOS[accion];
  if (!allowed) return false;
  return allowed.includes(rol);
};

// Clasifica una cotización: 'servicio' (sale de una orden de taller) vs 'comercial'
// (cotización directa de ventas). Las de servicio se estampan con origen='orden' +
// orden_id; las comerciales con origen='comercial'. Las legacy sin origen son
// comerciales (las de servicio SIEMPRE han llevado origen='orden').
window.esCotizacionServicio = function(cot) {
  return !!(cot && (cot.origen === 'orden' || cot.orden_id));
};

// ¿El rol puede APROBAR esta cotización? Elige el permiso según el tipo:
// servicio → jefe de mantenimiento/admin; comercial → gerente/admin.
window.puedeAprobarCotizacion = function(rol, cot) {
  return canRole(rol, esCotizacionServicio(cot)
    ? 'aprobar-cotizacion-servicio'
    : 'aprobar-cotizacion-comercial');
};

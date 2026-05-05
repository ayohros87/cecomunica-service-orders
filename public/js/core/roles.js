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
};

// canRole(rol, accion) → boolean
window.canRole = function(rol, accion) {
  const allowed = _PERMISOS[accion];
  if (!allowed) return false;
  return allowed.includes(rol);
};

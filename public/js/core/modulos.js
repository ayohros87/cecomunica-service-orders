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
  const visiblesPorRol = {
    administrador: ["ordenes", "poc", "inventario", "equipos", "facturacion", "vendedores", "contratos", "cotizaciones", "clientes", "piezas", "firma"],
    gerente:       ["ordenes", "poc", "inventario", "equipos", "contratos", "cotizaciones", "clientes", "firma"],
    inventario:    ["inventario", "equipos", "piezas", "firma"],
    contabilidad:  ["facturacion", "firma"],
    vista:         ["ordenes", "poc", "firma"],
    tecnico:       ["ordenes", "poc", "firma"],
    jefe_taller:   ["ordenes", "poc", "cotizaciones", "firma"],
    recepcion:     ["ordenes", "poc", "vendedores", "contratos", "clientes", "firma"],
    vendedor:      ["ordenes", "vendedores", "contratos", "cotizaciones", "firma"],
    tecnico_operativo: ["ordenes", "firma"]
  };

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

  return { visiblesPorRol, deRol, puedeVer, rolEfectivo };
})();

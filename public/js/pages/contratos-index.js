// @ts-nocheck
// Contratos page coordinator — auth bootstrap, role restrictions, sign-out
const auth = firebase.auth();

function cerrarSesion() {
  firebase.auth().signOut().then(() => { window.location.href = '/login.html'; });
}

function aplicarRestriccionesPorRol(rol) {
  // roles.js es la fuente ('ver-contratos': admin/vendedor/recepción/gerente).
  // El gerente estaba expulsado aquí aunque la matriz le da aprobar/anular y
  // firestore.rules se lo permite: clickeaba la tarjeta que el propio rail le
  // muestra y recibía "No autorizado".
  if (!canRole(rol, 'ver-contratos')) {
    Toast.show('No autorizado para ver Contratos.', 'bad');
    window.location.href = '/index.html';
    return;
  }
  const btnNuevoContrato = document.getElementById('btnNuevoContrato');
  if (btnNuevoContrato) {
    btnNuevoContrato.style.display =
      canRole(rol, 'crear-contrato') ? 'inline-block' : 'none';
  }
}

// Badge con el conteo de bajas pendientes en el item de menú "Cancelaciones".
// Solo para aprobadores (admin/gerente); es su cola de aprobación.
async function mostrarBadgeCancelaciones(rol) {
  if (rol !== ROLES.ADMIN && rol !== ROLES.GERENTE) return;
  try {
    const n  = await CancelacionesService.contarPendientes();
    const el = document.getElementById('menuItemCancelaciones');
    if (n > 0 && el && !el.querySelector('.menu-badge')) {
      el.insertAdjacentHTML('beforeend',
        ` <span class="menu-badge" style="display:inline-flex;min-width:18px;height:18px;padding:0 5px;align-items:center;justify-content:center;border-radius:999px;background:#DC2626;color:#fff;font-size:11px;font-weight:700;margin-left:6px;">${n}</span>`);
    }
  } catch (_) { /* sin permisos o sin red — el menú sigue funcionando */ }
}

auth.onAuthStateChanged(async user => {
  if (!user) { window.location.href = '/login.html'; return; }
  CS.currentUser = user;
  // Sesion: rol desde sessionStorage en navegaciones warm (revalida en
  // background); en frío una sola lectura compartida con initRail.
  const rol = (await Sesion.rol(user.uid)) || 'vista';
  window.userRole = rol;

  aplicarRestriccionesPorRol(rol);
  mostrarBadgeCancelaciones(rol);
  await CS.cargarUsuarios();

  const params = new URLSearchParams(location.search);
  // Deep-link ?buscar= (p.ej. desde Equipos por serial): precarga la búsqueda
  // antes de la carga inicial — el filtro ya resuelve por cliente o contrato_id.
  const buscar = params.get('buscar');
  if (buscar) {
    const inp = document.getElementById('filtroCliente');
    if (inp) inp.value = buscar;
  }

  // Deep-link ?estado= (señales del home S8/S10): aterrizar con el filtro de
  // estado aplicado — antes la señal "Contratos por aprobar" dejaba al usuario
  // en "Todos" y tenía que filtrar a mano.
  const estadoParam = params.get('estado');
  if (estadoParam) {
    const sel = document.getElementById('filtroEstado');
    if (sel && [...sel.options].some(o => o.value === estadoParam)) {
      sel.value = estadoParam;
      document.querySelectorAll('#filtroEstadoChips .filter-chip').forEach(ch =>
        ch.classList.toggle('active', (ch.dataset.estado || '') === estadoParam));
      const chkPnd = document.getElementById('chkSoloPendientes');
      if (chkPnd) chkPnd.checked = (estadoParam === 'pendiente_aprobacion');
    }
  }

  await ContratosLista.cargar(true);
  ContratosLista.updateBtnCargarMas(false);

  const aprobarId = params.get('aprobar');
  if (aprobarId) {
    if (canRole(rol, 'aprobar-contrato')) {
      try {
        const doc = await ContratosService.getContrato(aprobarId);
        if (doc) {
          ContratosAprobacion.abrir(aprobarId);
          const url = new URL(window.location);
          url.searchParams.delete('aprobar');
          window.history.replaceState({}, document.title, url.toString());
        } else {
          Toast.show('⚠️ El contrato indicado no existe o fue eliminado.', 'warn');
        }
      } catch (e) {
        console.error(e);
        Toast.show('⚠️ No se pudo abrir el contrato para aprobación.', 'warn');
      }
    } else {
      Toast.show('⚠️ Solo administración o gerencia puede aprobar contratos.', 'warn');
    }
  }
});

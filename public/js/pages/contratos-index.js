// @ts-nocheck
// Contratos page coordinator — auth bootstrap, role restrictions, sign-out
const auth = firebase.auth();

function cerrarSesion() {
  firebase.auth().signOut().then(() => { window.location.href = '/login.html'; });
}

function aplicarRestriccionesPorRol(rol) {
  if (rol !== ROLES.ADMIN && rol !== ROLES.VENDEDOR && rol !== ROLES.RECEPCION) {
    Toast.show('No autorizado para ver Contratos.', 'bad');
    window.location.href = '/index.html';
    return;
  }
  const btnNuevoContrato = document.getElementById('btnNuevoContrato');
  if (btnNuevoContrato) {
    btnNuevoContrato.style.display =
      (rol === ROLES.ADMIN || rol === ROLES.VENDEDOR) ? 'inline-block' : 'none';
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
  const u = await UsuariosService.getUsuario(user.uid);
  const rol = u?.rol || 'vista';
  window.userRole = rol;

  aplicarRestriccionesPorRol(rol);
  mostrarBadgeCancelaciones(rol);
  await CS.cargarUsuarios();
  await ContratosLista.cargar(true);
  ContratosLista.updateBtnCargarMas(false);

  const params    = new URLSearchParams(location.search);
  const aprobarId = params.get('aprobar');
  if (aprobarId) {
    if (rol === ROLES.ADMIN) {
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
      Toast.show('⚠️ Solo un administrador puede aprobar contratos.', 'warn');
    }
  }
});

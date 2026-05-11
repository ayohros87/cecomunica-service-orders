// @ts-nocheck
// Contratos page coordinator — auth bootstrap, role restrictions, sign-out
const auth = firebase.auth();

function cerrarSesion() {
  firebase.auth().signOut().then(() => { window.location.href = '/login.html'; });
}

function aplicarRestriccionesPorRol(rol) {
  if (rol !== ROLES.ADMIN && rol !== ROLES.VENDEDOR && rol !== ROLES.RECEPCION) {
    alert('❌ No autorizado para ver Contratos.');
    window.location.href = '/index.html';
    return;
  }
  const btnNuevoContrato = document.getElementById('btnNuevoContrato');
  if (btnNuevoContrato) {
    btnNuevoContrato.style.display =
      (rol === ROLES.ADMIN || rol === ROLES.VENDEDOR) ? 'inline-block' : 'none';
  }
}

auth.onAuthStateChanged(async user => {
  if (!user) { window.location.href = '/login.html'; return; }
  CS.currentUser = user;
  const u = await UsuariosService.getUsuario(user.uid);
  const rol = u?.rol || 'vista';
  window.userRole = rol;

  aplicarRestriccionesPorRol(rol);
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

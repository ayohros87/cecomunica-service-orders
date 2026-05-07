// @ts-nocheck
// POC page coordinator — auth bootstrap, role guard, utilities
function cerrarSesion() {
  firebase.auth().signOut()
    .then(() => { window.location.href = '/login.html'; })
    .catch(() => { window.location.href = '/login.html'; });
}

function toggleAdvancedFilters() {
  const el = document.getElementById('advancedFilters');
  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '/login.html'; return; }

    const userDoc = await UsuariosService.getUsuario(user.uid);
    PocState.rolActual = userDoc?.rol || ROLES.VISTA;

    const permitidos = [ROLES.ADMIN, ROLES.RECEPCION, ROLES.TECNICO, ROLES.VISTA];
    if (!permitidos.includes(PocState.rolActual)) {
      alert('❌ No autorizado. Tu rol no tiene acceso a este módulo.');
      window.location.href = '/index.html';
      return;
    }

    PocState.aplicarPermisosRol();
    await PocState.cargarOperadores();
    await PocState.cargarClientesMap();
    await PocState.cargarModelosMap();
    PocList.cargar(true);
  });

  // Defensive: inject check-all header if not already present in HTML
  const encabezado = document.getElementById('encabezadoTabla');
  if (encabezado && !encabezado.querySelector('.check-all')) {
    const th    = document.createElement('th');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'check-all';
    check.onclick = () => PocList.toggleSeleccionMasiva(check);
    th.appendChild(check);
    encabezado.insertBefore(th, encabezado.firstChild);
  }
});

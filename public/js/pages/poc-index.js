// @ts-nocheck
// POC page coordinator — auth bootstrap, role guard, utilities
function cerrarSesion() {
  firebase.auth().signOut()
    .then(() => { window.location.href = '/login.html'; })
    .catch(() => { window.location.href = '/login.html'; });
}

document.addEventListener('DOMContentLoaded', () => {
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '/login.html'; return; }

    // Sesion: rol desde sessionStorage en navegaciones warm (revalida en
    // background); en frío una sola lectura compartida con initRail.
    PocState.rolActual = (await Sesion.rol(user.uid)) || ROLES.VISTA;

    const permitidos = [ROLES.ADMIN, ROLES.RECEPCION, ROLES.TECNICO, ROLES.VISTA, ROLES.JEFE_TALLER];
    if (!permitidos.includes(PocState.rolActual)) {
      Toast.show('No autorizado. Tu rol no tiene acceso a este módulo.', 'bad');
      window.location.href = '/index.html';
      return;
    }

    PocState.aplicarPermisosRol();
    // Los tres mapas son independientes y ya NO retienen la lista: el primer
    // paint usa el snapshot d.cliente de cada ficha (nombreClienteDe cae ahí
    // cuando el mapa no está) y refrescarNombresVisibles corrige en sitio al
    // resolver. Antes la tabla esperaba clientes (~413 docs) + modelos + operadores.
    const pMapas = Promise.all([
      PocState.cargarOperadores(),
      PocState.cargarClientesMap(),
      PocState.cargarModelosMap(),
    ]);
    PocList.cargar(true);
    pMapas.then(() => PocList.refrescarNombresVisibles()).catch(() => { /* snapshot manda */ });
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

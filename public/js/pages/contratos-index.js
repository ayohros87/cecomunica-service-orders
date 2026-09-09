// @ts-nocheck
// Coordinador del ARCHIVO de contratos y gestiones — arranque de auth,
// restricciones por rol, pestañas y deep-links.
//
// 2026-09-09: este módulo dejó de crear y de operar. Los deep-links que traían
// trabajo (?aprobar=) ahora rebotan al Centro de gestión, que es donde vive la
// aprobación. La única operación que sobrevive aquí es ?factura_venta= — el
// candado "facturar antes de entregar" de órdenes apunta a esta página y no
// tiene otra casa todavía.
const auth = firebase.auth();

function cerrarSesion() {
  firebase.auth().signOut().then(() => { window.location.href = '/login.html'; });
}

function aplicarRestriccionesPorRol(rol) {
  // roles.js es la fuente ('ver-contratos' incluye ahora a contabilidad: el
  // archivo es de consulta y ellos lo necesitan para conciliar).
  if (!canRole(rol, 'ver-contratos')) {
    Toast.show('No autorizado para ver el archivo de contratos.', 'bad');
    window.location.href = '/index.html';
    return;
  }
  // La columna de montos es need-to-know: se OMITE para quien no la tiene.
  if (!canRole(rol, 'ver-montos-contrato')) {
    document.getElementById('thTotal')?.remove();
  }
}

// Pestañas Contratos / Gestiones. La búsqueda es la misma caja para las dos:
// el archivo se consulta por lo que uno tiene a mano (un número, un serial, un
// cliente), no por saber de antemano en qué colección vive la respuesta.
function wirePestanas() {
  const tabs = document.querySelectorAll('#archivoTabs .filter-chip[data-tab]');
  tabs.forEach((t) => t.addEventListener('click', () => Archivo.irA(t.dataset.tab)));
}

window.Archivo = {
  tab: 'contratos',

  irA(tab) {
    if (tab !== 'contratos' && tab !== 'gestiones') tab = 'contratos';
    this.tab = tab;
    document.querySelectorAll('#archivoTabs .filter-chip[data-tab]').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === tab));
    const esContratos = tab === 'contratos';
    document.getElementById('panelContratos').hidden = !esContratos;
    document.getElementById('panelGestiones').hidden = esContratos;
    // Los filtros de estado de contratos no aplican a gestiones (tienen su
    // propia máquina): se esconden en vez de mentir.
    document.getElementById('filtrosContratos').hidden = !esContratos;
    document.getElementById('filtrosGestiones').hidden = esContratos;

    const url = new URL(window.location);
    if (esContratos) url.searchParams.delete('tab');
    else url.searchParams.set('tab', 'gestiones');
    window.history.replaceState({}, document.title, url.toString());

    document.getElementById('pieContratos').hidden = !esContratos;
    document.getElementById('pieGestiones').hidden = esContratos;
    document.getElementById('listaContratosMovil').style.display = 'none';

    if (!esContratos) ArchivoGestiones.cargar();
  },

  exportar() {
    if (this.tab === 'gestiones') ArchivoGestiones.exportarCsv();
    else ContratosLista.exportarCsv();
  },

  // CSV con BOM: sin él, Excel en Windows abre los acentos como mojibake y el
  // usuario cree que el dato está dañado. Separador ';' por la misma razón
  // (configuración regional de Panamá).
  bajarCsv(nombre, cabeceras, filas) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cabeceras, ...filas].map((f) => f.map(q).join(';')).join('\r\n');
    const hoy = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `archivo-${nombre}-${hoy}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Toast.show(`${filas.length} fila(s) exportadas.`, 'ok');
  },
};

// El rango de fechas y la caja de búsqueda sirven a las DOS pestañas: cada una
// recarga la que esté al frente.
function wireFiltrosCompartidos() {
  const recargar = () => {
    if (Archivo.tab === 'gestiones') ArchivoGestiones.cargar();
    else ContratosLista.cargar(true);
  };
  document.getElementById('filtroDesde')?.addEventListener('change', recargar);
  document.getElementById('filtroHasta')?.addEventListener('change', recargar);
  document.getElementById('btnExportarCsv')?.addEventListener('click', () => Archivo.exportar());
  // La caja de búsqueda ya la escucha contratos-list.js (con su debounce); en
  // gestiones se engancha aquí con el mismo criterio.
  let t = null;
  document.getElementById('filtroCliente')?.addEventListener('input', () => {
    if (Archivo.tab !== 'gestiones') return;
    clearTimeout(t);
    t = setTimeout(() => ArchivoGestiones.cargar(), 350);
  });
}

auth.onAuthStateChanged(async (user) => {
  if (!user) { window.location.href = '/login.html'; return; }
  CS.currentUser = user;
  // Sesion: rol desde sessionStorage en navegaciones warm (revalida en
  // background); en frío una sola lectura compartida con initRail.
  const rol = (await Sesion.rol(user.uid)) || 'vista';
  window.userRole = rol;

  aplicarRestriccionesPorRol(rol);
  wirePestanas();
  wireFiltrosCompartidos();
  ArchivoGestiones.init();
  await CS.cargarUsuarios();

  const params = new URLSearchParams(location.search);

  // ?aprobar= viene de correos y señales viejas. Aprobar ya no se hace aquí.
  const aprobarId = params.get('aprobar');
  if (aprobarId) {
    const url = new URL(window.location);
    url.searchParams.delete('aprobar');
    window.history.replaceState({}, document.title, url.toString());
    Toast.show('Los contratos se aprueban desde el Centro de gestión. Te llevo allá.', 'info');
    try {
      const doc = await ContratosService.getContrato(aprobarId);
      if (doc?.cliente_id) {
        window.location.href = `../clientes/centro.html?id=${encodeURIComponent(doc.cliente_id)}&contrato=${encodeURIComponent(aprobarId)}`;
        return;
      }
    } catch (e) { console.error(e); }
    window.location.href = '../clientes/centro.html';
    return;
  }

  // Deep-link ?buscar= / ?q= (p.ej. desde Equipos por serial): precarga la
  // búsqueda antes de la carga inicial.
  const buscar = params.get('buscar') || params.get('q');
  if (buscar) {
    const inp = document.getElementById('filtroCliente');
    if (inp) inp.value = buscar;
  }

  // Deep-link ?estado= (señales del home S8/S10).
  const estadoParam = params.get('estado');
  if (estadoParam) {
    const sel = document.getElementById('filtroEstado');
    if (sel && [...sel.options].some((o) => o.value === estadoParam)) {
      sel.value = estadoParam;
      document.querySelectorAll('#filtroEstadoChips .filter-chip').forEach((ch) =>
        ch.classList.toggle('active', (ch.dataset.estado || '') === estadoParam));
      const chkPnd = document.getElementById('chkSoloPendientes');
      if (chkPnd) chkPnd.checked = (estadoParam === 'pendiente_aprobacion');
    }
  }

  await ContratosLista.cargar(true);
  ContratosLista.updateBtnCargarMas(false);

  // ?tab=gestiones — después de la carga de contratos para no competir por la red.
  if (params.get('tab') === 'gestiones') Archivo.irA('gestiones');

  // Deep-link ?factura_venta=<doc_id> (candado de entrega en órdenes): aterriza
  // directo en el registro de la factura de la venta — el prompt valida rol,
  // contrato y número por su cuenta (ContratosEquipos.registrarFactura).
  // ÚNICA operación que queda en este módulo: el candado de órdenes apunta
  // aquí y no tiene otra casa todavía.
  const facturaVentaId = params.get('factura_venta');
  if (facturaVentaId) {
    const url = new URL(window.location);
    url.searchParams.delete('factura_venta');
    window.history.replaceState({}, document.title, url.toString());
    if (canRole(rol, 'registrar-factura-venta')) {
      ContratosEquipos.registrarFactura(facturaVentaId);
    } else {
      Toast.show('⚠️ Solo recepción, gerencia o administración registran la factura de venta.', 'warn');
    }
  }
});

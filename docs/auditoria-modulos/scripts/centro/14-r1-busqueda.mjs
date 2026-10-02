// R1 (búsqueda tolerante) + B1 (inactivos del grid) + B2 (resumen del directorio), antes/después.
// Crea UN cliente de prueba (PRUEBA-AUDIT-centro Empresa Dos, RUC 155799999-2-2026) con el propio servicio
// del app (mismos tokens que el formulario) y busca como cobros en el grid y en el Centro. Solo lectura aparte de eso.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 900));

// 1. Cliente de prueba (admin) — si ya existe, se reutiliza.
const a = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });
await a.ir('/clientes/centro.html');
const idNuevo = await a.page.evaluate(async () => {
  const db = firebase.firestore();
  const ya = await db.collection('clientes').where('nombre', '==', 'PRUEBA-AUDIT-centro Empresa Dos').limit(1).get();
  if (!ya.empty) return ya.docs[0].id;
  const raw = { nombre: 'PRUEBA-AUDIT-centro Empresa Dos', ruc: '155799999-2-2026', dv: '30', ruc_tipo: 'juridica',
    representante: 'Juan Prueba', representante_cedula: '8-123-456', telefono: '60000000', email: 'prueba-audit-centro@example.com', activo: true };
  const payload = ClientesService.buildClientePayload(raw, { user: firebase.auth().currentUser, isCreate: true });
  return ClientesService.createCliente(payload);
});
log('cliente_prueba', idNuevo);
log('palabras', await a.page.evaluate(() => ['PRUEBA-AUDIT', '155799999-2-2026', '8-NT-1-21875', 'Empresa Dos', 'seprosa 155', '155799999'].map(t => [t, ClientesService.palabrasBusqueda(t)])));
await a.cerrar();

// 2. Cobros: grid y Centro.
const s = await abrir({ email: USUARIOS.cobros, viewport: 'escritorio', carpeta: 'centro' });
await s.ir('/clientes/index.html');
log('grid_stats_inicial', await s.page.evaluate(() => ({ total: document.getElementById('statTotal')?.innerText, activos: document.getElementById('statActivos')?.innerText, inactivos: document.getElementById('statInactivos')?.innerText, soloActivos: document.getElementById('soloActivos')?.checked })));
const casos = ['PRUEBA-AUDIT', 'PRUEBA', 'Empresa Dos', '155799999', '155799999-2-2026', '155703071-2-2021', '155703071', '8-1-22685-000', '8-1-22685', 'AB SECURITY', 'ab sec', 'órgano judicial'];
const grid = {};
for (const q of casos) {
  await s.page.evaluate(() => { const i = document.getElementById('q'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await s.page.type('#q', q);
  await new Promise(r => setTimeout(r, 2200)); await s.quieto(600, 8000);
  grid[q] = { filas: await s.page.evaluate(() => document.querySelectorAll('#tbody tr').length), primera: await s.page.evaluate(() => document.querySelector('#tbody tr [data-field=nombre]')?.value || null) };
}
log('grid', grid);
await s.ir('/clientes/centro.html');
const centro = {};
for (const q of casos) {
  await s.page.evaluate(() => { const i = document.getElementById('cgBuscar'); i.value = ''; });
  await s.page.type('#cgBuscar', q);
  await new Promise(r => setTimeout(r, 1800)); await s.quieto(600, 8000);
  centro[q] = { resumen: await s.texto('#cgResumen'), primera: (await s.texto('#cgLista')).split('\n').filter(Boolean)[0] || null, masVisible: await s.page.evaluate(() => !document.getElementById('btnMas').classList.contains('hidden')) };
}
log('centro', centro);
log('errores', s.errores.slice(0, 8));
await s.cerrar();

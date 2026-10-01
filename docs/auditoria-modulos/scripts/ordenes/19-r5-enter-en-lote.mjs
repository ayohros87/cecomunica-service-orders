// R5 (ejecución 2026-10-01) · Enter en el serial del lote (nuevo-batch) = fila nueva con el foco
// en su serial; en una fila intermedia salta a la siguiente; con el serial vacío no crea filas.
// NO guarda: solo mide filas y foco en la tabla. Recepción, escritorio.
import { abrir, USUARIOS, log } from './lib-ordenes.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'ordenes' });
await s.ir('/ordenes/index.html');
// Una REPARACIÓN POR ASIGNAR cualquiera (no se guarda nada en ella).
const id = await s.page.evaluate(async () => {
  const snap = await firebase.firestore().collection('ordenes_de_servicio').where('estado_reparacion', '==', 'POR ASIGNAR').orderBy('fecha_creacion', 'desc').limit(5).get();
  return snap.docs.find(d => /REPARACI/i.test(d.data().tipo_de_servicio || ''))?.id || snap.docs[0]?.id;
});
await s.ir(`/ordenes/nuevo-batch.html?orden_id=${id}`);
await s.quieto(1000, 10000);
const estado = () => s.page.evaluate(() => ({ filas: document.querySelectorAll('#filasBatch tr').length, foco: (document.activeElement?.className || document.activeElement?.tagName || '').split(' ')[0], filaFoco: document.activeElement?.closest('tr')?.rowIndex ?? null, seriales: [...document.querySelectorAll('#filasBatch .serie')].map(i => i.value) }));
if (!(await estado()).filas) await s.page.evaluate(() => agregarFila());
log('inicio:', JSON.stringify(await estado()));
let pasos = 0;
await s.page.click('#filasBatch tr:first-child .serie'); pasos++;
await s.page.keyboard.type('R5-TEST-0001'); pasos++;
await s.page.keyboard.press('Enter'); pasos++;        // el lector manda Enter solo: en la práctica no cuenta
await s.quieto(300, 3000);
log('tras serial 1 + Enter:', JSON.stringify(await estado()));
await s.page.keyboard.type('R5-TEST-0002'); pasos++;
await s.page.keyboard.press('Enter'); pasos++;
await s.quieto(300, 3000);
log('tras serial 2 + Enter:', JSON.stringify(await estado()));
// Enter con el serial vacío: no crea otra fila
await s.page.keyboard.press('Enter'); await s.quieto(300, 2000);
log('Enter en vacío:', JSON.stringify(await estado()));
// Enter en una fila intermedia salta a la siguiente, no crea
await s.page.click('#filasBatch tr:first-child .serie'); await s.page.keyboard.press('End'); await s.page.keyboard.press('Enter'); await s.quieto(300, 2000);
log('Enter en fila 1 (intermedia):', JSON.stringify(await estado()));
log(`2 seriales tecleados: ${pasos} interacciones (antes: serial, "Agregar fila", serial = 3 + Enter sin efecto). Con lector: 2 lecturas, 0 clics.`);
await s.captura('19-r5-lote-enter');
log('errores:', s.errores.slice(0, 5));
await s.cerrar();

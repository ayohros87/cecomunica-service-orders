// P4: selectores de seriales de los cuatro wizards (reemplazo, baja, cambio de serial, renovar cuenta) en la ficha grande
// (AGENCIA: 273 radios, 16 contratos). Mide filas totales / visibles y el alto del cuerpo del modal; con BUSCAR=1 teclea
// 4 caracteres de un serial y vuelve a medir. Antes/después del componente compartido. Solo lectura (no guarda nada).
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1400));
const GRANDE = process.env.CLI || 'gFs21DErNjbZFbkGrdAH';
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });
await s.ir(`/clientes/centro.html?id=${GRANDE}`);
const serial4 = await s.page.evaluate(() => { const e = Centro.equipos.find(x => ['en_cliente', 'asignado_contrato'].includes(x.estado) && x.asignacion?.contrato_doc_id); return String(e?.serial || e?.id || '').slice(0, 4); });
log('serial4', serial4);

const medir = () => s.page.evaluate(() => {
  const r = document.querySelector('.modal-backdrop.open .modal'); if (!r) return null;
  const vis = (el) => el.offsetParent !== null && !el.hidden;
  const trs = [...r.querySelectorAll('tbody tr')];
  const filas = trs.filter(t => !t.hasAttribute('data-ssgh') && !t.hasAttribute('data-sscfg'));
  return {
    filasTotales: filas.length, filasVisibles: filas.filter(vis).length,
    grupos: r.querySelectorAll('tr[data-ssgh]').length, gruposAbiertos: [...r.querySelectorAll('tr[data-ssgh]')].filter(t => t.dataset.abierto === '1').length,
    buscador: !!r.querySelector('[data-ssq]'), resumen: r.querySelector('[data-ssres]')?.innerText || null,
    selects: r.querySelectorAll('select').length, selectsVisibles: [...r.querySelectorAll('select')].filter(vis).length,
    bodyScroll: r.querySelector('.modal-body')?.scrollHeight, alto: r.scrollHeight, tablaScroll: r.querySelector('.cg-twrap')?.scrollHeight,
  };
});
const wiz = [['reemplazo', 'Centro.wizReemplazo()'], ['baja', 'Centro.wizBaja()'], ['cambio-serial', 'Centro.wizCambioSerial()'], ['renovar', 'Centro.wizContrato({renovarCuenta:true})']];
for (const [nombre, code] of wiz) {
  const t0 = Date.now();
  await s.page.evaluate(code);
  await s.quieto(900, 20000);
  const antes = await medir();
  let tras = null;
  const q = await s.page.$('.modal-backdrop.open [data-ssq]');
  if (q && serial4) {
    const t1 = Date.now();
    await q.type(serial4);
    await s.quieto(300, 5000);
    tras = { ...(await medir()), msBuscar: Date.now() - t1 };
  }
  log('wiz_' + nombre, { ms: Date.now() - t0, antes, tras, toasts: (await s.toasts()).slice(-1) });
  await s.captura(`70-admin-escritorio-p4-${nombre}`);
  await s.hacer(() => Centro._cerrarModal());
}
log('errores', s.errores.slice(0, 10));
await s.cerrar();

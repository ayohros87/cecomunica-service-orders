// R3 + D8: botón primario de la cabecera, chips y franja en la ficha grande (AGENCIA: D1=2, D7=50),
// en una cuenta con contrato aprobado sin firma (la primera fila de "Ahora" manda) y en el directorio.
// Admin y vendedora. Solo lectura.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1200));
const GRANDE = 'gFs21DErNjbZFbkGrdAH';
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });

const ficha = async (id) => {
  await s.ir(`/clientes/centro.html?id=${id}`);
  return {
    nombre: await s.texto('#fNombre'),
    chip: await s.texto('#fRegChip'),
    primario: await s.page.evaluate(() => ({ label: document.getElementById('btnPrimario')?.innerText, onclick: document.getElementById('btnPrimario')?.getAttribute('onclick'), oculto: document.getElementById('btnPrimario')?.classList.contains('hidden'), hint: document.getElementById('btnPrimario')?.title })),
    resumen: await s.texto('#fResumen'),
    ahora: (await s.texto('#fAhora')).split('\n').filter(Boolean).slice(0, 8),
    destacadoMenu: await s.page.evaluate(() => { const P = Centro._accionPrimaria(); return P ? P.label : null; }),
    banda: await s.page.evaluate(() => Centro._bandaReg().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
  };
};
log('agencia', await ficha(GRANDE));
// Una cuenta con contrato aprobado hace más de 45 días sin firma (C COMUNICA en la auditoría) o la primera que tenga una fila de Ahora con botón primario.
const conAhora = await s.page.evaluate(async () => {
  const db = firebase.firestore();
  const snap = await db.collection('contratos').where('estado', '==', 'aprobado').where('seriales_estado', '==', 'asignados').limit(40).get();
  const out = [];
  snap.forEach(d => { const c = d.data(); if (!c.firmado && !c.deleted && c.cliente_id) out.push({ cid: c.cliente_id, contrato: c.contrato_id, nombre: c.cliente_nombre }); });
  return out.slice(0, 3);
});
log('candidatos_ahora', conAhora);
if (conAhora[0]) log('cuenta_con_ahora', await ficha(conAhora[0].cid));
// Directorio: chips de la primera página y conteo de "Bodega · n"
await s.ir('/clientes/centro.html');
log('directorio_chips', await s.page.evaluate(() => {
  const rows = [...document.querySelectorAll('#cgLista .cg-row')];
  const chips = rows.flatMap(r => [...r.querySelectorAll('.cg-chip')].map(c => c.innerText));
  return { filas: rows.length, porRegularizar: chips.filter(t => /Por regularizar/.test(t)).length, bodega: chips.filter(t => /^Bodega/.test(t)).length, ejemplos: chips.slice(0, 8) };
}));
// Conteo en datos: cuántas cuentas tenían deuda con D7 y cuántas quedan con deuda sin D7.
log('datos', await s.page.evaluate(async () => {
  const snap = await firebase.firestore().collection('clientes').where('regularizacion.puntos', '>', 0).get();
  let conPuntos = 0, sinD7 = 0, soloD7 = 0;
  snap.forEach(d => { const c = d.data(); if (c.deleted) return; conPuntos++; const n = Regularizacion.puntosCuenta(c.regularizacion); if (n > 0) sinD7++; else soloD7++; });
  return { cuentas_con_puntos: conPuntos, con_deuda_sin_d7: sinD7, solo_d7: soloD7 };
}));
log('errores', s.errores.slice(0, 6));
await s.cerrar();

// Vendedora: su cartera y la primera ficha
const v = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'centro' });
await v.ir('/clientes/centro.html');
const primera = await v.page.evaluate(() => document.querySelector('#cgLista .cg-row')?.getAttribute('href'));
log('v_cartera', { resumen: await v.texto('#cgResumen'), primera });
if (primera) {
  await v.ir('/clientes/centro.html' + primera);
  log('v_ficha', { nombre: await v.texto('#fNombre'), chip: await v.texto('#fRegChip'), primario: await v.page.evaluate(() => document.getElementById('btnPrimario')?.innerText), ahora: (await v.texto('#fAhora')).split('\n').filter(Boolean).slice(0, 6) });
}
log('v_errores', v.errores.slice(0, 6));
await v.cerrar();

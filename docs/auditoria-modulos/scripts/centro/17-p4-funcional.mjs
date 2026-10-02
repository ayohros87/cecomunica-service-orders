// P4, funcional: buscar un serial y marcarlo abre su fila de configuración (reemplazo); "Marcar todos" de un grupo
// dispara la liquidación (baja); "Todos continúan" por grupo deja el grupo "listo" (renovación); un cliente chico
// (≤ 8 radios) arranca con los grupos abiertos. Admin; no guarda nada.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1200));
const GRANDE = 'gFs21DErNjbZFbkGrdAH';
const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'centro' });
await s.ir(`/clientes/centro.html?id=${GRANDE}`);

// Reemplazo: buscar y marcar
await s.page.evaluate(() => Centro.wizReemplazo()); await s.quieto(900, 20000);
const serial = await s.page.evaluate(() => { const e = Centro.equipos.find(x => ['en_cliente', 'asignado_contrato'].includes(x.estado) && x.asignacion?.contrato_doc_id); return String(e?.serial || e?.id || ''); });
await (await s.page.$('.modal-backdrop.open [data-ssq]')).type(serial.slice(0, 5));
await s.quieto(300, 5000);
log('r_buscar', await s.page.evaluate((ser) => {
  const tr = [...document.querySelectorAll('.modal-backdrop.open tbody tr[data-ssg]:not([data-sscfg])')].find(t => !t.hidden && t.innerText.includes(ser));
  const chk = tr?.querySelector('input[data-wsel]');
  chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true }));
  const cfg = document.getElementById('wcfg-' + chk.dataset.wsel);
  return { fila: !!tr, cfgVisible: !!cfg && !cfg.hidden && !cfg.classList.contains('hidden') && cfg.offsetParent !== null,
    marcados: document.querySelector('.modal-backdrop.open tr[data-ssgh]:not([hidden]) [data-ssmarc]')?.innerText,
    noDisponibleUltimo: [...document.querySelectorAll('.modal-backdrop.open tr[data-ssgh]')].pop()?.innerText.includes('No disponible') };
}, serial));
await s.captura('71-admin-escritorio-p4-reemplazo-marcado');
await s.hacer(() => Centro._cerrarModal());

// Baja: "Marcar todos" del primer grupo → liquidación
await s.page.evaluate(() => Centro.wizBaja()); await s.quieto(900, 20000);
log('b_grupo', await s.page.evaluate(() => {
  const h = document.querySelector('.modal-backdrop.open tr[data-ssgh]');
  h.querySelector('button.cg-act')?.click();
  const k = h.dataset.ssgh;
  const n = document.querySelectorAll(`.modal-backdrop.open tr[data-ssg="${k}"] input:checked`).length;
  return { grupo: h.innerText.replace(/\s+/g, ' ').slice(0, 80), marcados: n, abierto: h.dataset.abierto, liquidacion: document.getElementById('wbPen')?.innerText.slice(0, 160) };
}));
await s.captura('72-admin-escritorio-p4-baja-grupo');
await s.hacer(() => Centro._cerrarModal());

// Renovación: "Todos continúan" del primer contrato
await s.page.evaluate(() => Centro.wizContrato({ renovarCuenta: true })); await s.quieto(1200, 20000);
log('w_grupo', await s.page.evaluate(() => {
  const h = document.querySelector('.modal-backdrop.open tr[data-ssgh]');
  const antes = h.querySelector('[data-ssmarc]')?.innerText;
  [...h.querySelectorAll('button')].find(b => /Todos continúan/.test(b.innerText))?.click();
  return { grupo: h.innerText.replace(/\s+/g, ' ').slice(0, 60), antes, despues: h.querySelector('[data-ssmarc]')?.innerText, conc: document.getElementById('wcPlanConc')?.innerText.slice(0, 200), bodyScroll: document.querySelector('.modal-backdrop.open .modal-body').scrollHeight };
}));
await s.captura('73-admin-escritorio-p4-renovar-grupos');
await s.hacer(() => Centro._cerrarModal());

// Cliente chico: grupos abiertos de entrada
const chico = await s.page.evaluate(async () => {
  const snap = await firebase.firestore().collection('equipos_pool').where('estado', '==', 'en_cliente').limit(300).get();
  const por = {}; snap.forEach(d => { const c = d.data().asignacion?.cliente_id; if (c) por[c] = (por[c] || 0) + 1; });
  return Object.entries(por).find(([, n]) => n >= 3 && n <= 6)?.[0] || null;
});
if (chico) {
  await s.ir(`/clientes/centro.html?id=${chico}`);
  await s.page.evaluate(() => Centro.wizReemplazo()); await s.quieto(900, 20000);
  log('chico', { nombre: await s.texto('#fNombre'), ...(await s.page.evaluate(() => ({ filas: document.querySelectorAll('.modal-backdrop.open tr[data-ssg]:not([data-sscfg])').length, visibles: [...document.querySelectorAll('.modal-backdrop.open tr[data-ssg]:not([data-sscfg])')].filter(t => !t.hidden).length, resumen: document.querySelector('.modal-backdrop.open [data-ssres]')?.innerText }))) });
  await s.hacer(() => Centro._cerrarModal());
}
log('errores', s.errores.slice(0, 10));
await s.cerrar();

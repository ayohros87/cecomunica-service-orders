// Cotizar desde la orden (2026-10-13, lo que contó Solangel):
//   1. "Atención a" y "Correo del destinatario" viven en el formulario; la
//      introducción nace con el motivo de ingreso (observaciones de la orden);
//   2. lo que se escribe ahí sale en la cotización (dirigido_a/dirigido_email);
//   3. la siguiente cotización de taller del MISMO cliente precarga ese contacto.
// Corre contra el emulador (export del 30-sep) con `npm run build` hecho:
//   node tools/emulador-almacen/emu-test-cotizar-contacto.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

const fallos = [];
const ok = (cond, msg) => { console.log((cond ? 'OK     ' : 'FALLA  ') + msg); if (!cond) fallos.push(msg); };
const limpio = (s) => s.errores.filter(e => !/favicon|Uso|uso_diario/.test(e));

const s = await abrir({ email: USUARIOS.jefe_taller, carpeta: 'cotizar-contacto' });
const p = s.page;

// Dos órdenes del mismo cliente, con intervención y sin cotización, y con
// observaciones en al menos la primera. Se buscan en la bandeja (APP.state).
await s.ir('/ordenes/index.html', { esperar: 1500 });
const par = await p.evaluate(async () => {
  const todas = await OrdenesService.listAll().catch(() => null);
  const base = (Array.isArray(todas) && todas.length ? todas : (window.APP?.state?.orders || []));
  const aptas = base.filter(o => o.cliente_id && !o.cotizacion_doc_id && !/VISITA|DEVOLUCI/i.test(o.tipo_de_servicio || '')
    && (o.equipos || []).some(e => !e.eliminado && String(e.trabajo_tecnico || '').trim()));
  const porCliente = new Map();
  aptas.forEach(o => { (porCliente.get(o.cliente_id) || porCliente.set(o.cliente_id, []).get(o.cliente_id)).push(o); });
  for (const [cid, lista] of porCliente) {
    if (lista.length < 2) continue;
    const conObs = lista.find(o => String(o.observaciones || '').trim());
    const otra = lista.find(o => o !== conObs);
    if (conObs && otra) return { cid, a: conObs.ordenId, obs: String(conObs.observaciones).trim(), b: otra.ordenId };
  }
  const l = [...porCliente.values()].find(x => x.length >= 2);
  return l ? { cid: l[0].cliente_id, a: l[0].ordenId, obs: String(l[0].observaciones || '').trim(), b: l[1].ordenId } : null;
});
ok(!!par, 'hay dos órdenes aptas del mismo cliente: ' + JSON.stringify(par));
if (!par) { await s.browser.close(); process.exit(1); }

// ── 1. Primera orden: campos y motivo precargado ───────────────────────────
const i1 = await s.ir('/ordenes/cotizar-orden.html?id=' + encodeURIComponent(par.a), { esperar: 1800 });
ok(i1.url.startsWith('/ordenes/cotizar-orden.html'), 'jefa de taller: abre Cotizar orden ' + par.a);
// Si ofrece restaurar un borrador, se rechaza (queremos los defaults).
const noRest = await p.$('.modal-backdrop.open [data-action="cancel"]');
if (noRest) { await noRest.click(); await s.quieto(800); }
const f1 = await p.evaluate(() => ({
  a: !!document.getElementById('inpDirigidoA'), e: !!document.getElementById('inpDirigidoEmail'),
  intro: document.getElementById('inpIntro')?.value || '',
}));
ok(f1.a && f1.e, 'formulario: trae "Atención a" y "Correo del destinatario"');
if (par.obs) ok(f1.intro.includes('Motivo de ingreso:') && f1.intro.includes(par.obs.slice(0, 30)), 'introducción precargada con el motivo de ingreso (' + f1.intro.slice(0, 80) + '…)');
else console.log('       (la orden no tiene observaciones: no se prueba el motivo)');
await s.captura('contacto-campos', { el: '#panelCliente' });

const contacto = { a: 'Taller Pruebas ' + Date.now().toString().slice(-4), e: 'reparaciones' + Date.now().toString().slice(-4) + '@cliente-emu.com' };
await p.evaluate((c) => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('inpDirigidoA', c.a); set('inpDirigidoEmail', c.e);
  // Una línea para poder generar.
  if (!document.querySelector('.co-sku')) document.querySelector('[data-add]')?.click();
  const row = document.querySelector('.co-sku')?.closest('tr');
  if (row) {
    const put = (sel, v) => { const el = row.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    put('.co-sku', 'EMU-PZ'); put('.co-desc', 'Pieza de prueba'); put('.co-precio', '10');
  }
}, contacto);
await s.quieto(800);
const lineas = await p.evaluate(() => document.querySelectorAll('.co-sku').length);
ok(lineas >= 1, 'hay al menos una línea de pieza para generar');

// ── 2. Generar: la cotización lleva el contacto ───────────────────────────
await p.click('#btnGenerar');
const fin = Date.now() + 25000;
while (Date.now() < fin) {
  await new Promise(r => setTimeout(r, 300));
  const url = await p.evaluate(() => location.pathname + location.search).catch(() => '');
  if (url.includes('detalle-cotizacion.html') || url.includes('editar-cotizacion.html')) break;
  const c = await p.$('.modal-backdrop.open [data-action="confirm"], .modal-backdrop.open [data-sheet-action="seguir"]');
  if (c) await c.click();
}
const url2 = await p.evaluate(() => location.pathname + location.search);
ok(/detalle-cotizacion|editar-cotizacion/.test(url2), 'generar: aterriza en la cotización (' + url2 + ')');
await s.quieto(1500);
const docId = new URL('http://x' + url2).searchParams.get('id');
const doc = docId ? await p.evaluate(async (id) => { const c = await CotizacionesService.getCotizacion(id); return c ? { a: c.dirigido_a, e: c.dirigido_email, cid: c.clienteId, origen: c.origen } : null; }, docId) : null;
ok(doc && doc.a === contacto.a && doc.e === contacto.e, 'la cotización guarda dirigido_a / dirigido_email ' + JSON.stringify(doc));
ok(doc && doc.cid === par.cid && doc.origen === 'orden', 'la cotización es de taller del mismo cliente');

// ── 3. Segunda orden del mismo cliente: contacto recordado ────────────────
await s.ir('/ordenes/cotizar-orden.html?id=' + encodeURIComponent(par.b), { esperar: 1800 });
const noRest2 = await p.$('.modal-backdrop.open [data-action="cancel"]');
if (noRest2) { await noRest2.click(); await s.quieto(800); }
const f2 = await p.evaluate(() => ({
  a: document.getElementById('inpDirigidoA')?.value || '', e: document.getElementById('inpDirigidoEmail')?.value || '',
  hint: document.getElementById('hintDirigido')?.textContent || '',
}));
ok(f2.a === contacto.a && f2.e === contacto.e, 'segunda orden del cliente: precarga el contacto de taller ' + JSON.stringify(f2));
ok(/última cotización de taller/.test(f2.hint), 'y lo dice en la ayuda (' + f2.hint.slice(0, 70) + ')');
await s.captura('contacto-recordado', { el: '#panelCliente' });

const errs = limpio(s);
ok(!errs.length, 'sin errores ' + JSON.stringify(errs));
await s.browser.close();
console.log(fallos.length ? `\n${fallos.length} FALLA(S)` : '\nTODO OK');
process.exit(fallos.length ? 1 : 0);

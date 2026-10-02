// Verificación P8 (08-home-navegacion-admin): franja de contexto con enlaces
// cruzados. Orden 2026092508 (SEPROSA, ALQ20251211-02, serial NA15A0301):
// orden → cliente (Centro) → contrato → serial en Almacén, y la ficha del pool.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const ORDEN = '2026092508', CLI = 'jT6FlI02u2L52On6zsaj', CON = 'XYYS9AEgnPeg2xuYWJvq', SERIAL = 'NA15A0301';
const roles = (process.env.ROLES || 'recepcion,admin,inventario,tecnico').split(',');
const vps = (process.env.VPS || 'escritorio,telefono').split(',');
const navegar = async (s, sel) => {
  const t0 = Date.now();
  await Promise.all([s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}), s.page.click(sel)]);
  await s.quieto(1200, 20000);
  return Date.now() - t0;
};
for (const rol of roles) for (const vp of vps) {
  const s = await abrir({ email: USUARIOS[rol], viewport: vp, carpeta: 'home-nav' });
  const out = { rol, vp };
  await s.ir('/index.html', { esperar: 800 });
  await s.ir(`/ordenes/index.html?ids=${ORDEN}`, { esperar: 1500 });
  await s.quieto(1500, 20000);
  if (vp === 'escritorio') {
    await s.page.evaluate(() => document.querySelector('table.orders-table tbody tr.filaOrden td, table.orders-table tbody tr td')?.click());
    await s.quieto(1200, 15000);
  }
  out.orden = await s.page.evaluate(() => [...document.querySelectorAll('.orden-ctx-link, .card-contrato__cliente, .header-line .cliente-nombre')]
    .filter(a => a.getClientRects().length).map(a => `${a.tagName}:${a.innerText.trim().slice(0, 24)}${a.getAttribute('href') ? '→' + a.getAttribute('href') : ''}`));
  await s.captura(`p8-${rol}-${vp}-orden`);
  const selCli = vp === 'escritorio' ? '.header-line a.cliente-nombre' : '.card-contrato__cliente a';
  const hayCli = await s.page.$(selCli);
  if (hayCli) {
    out.msOrdenACliente = await navegar(s, selCli);
    out.centro = await s.page.evaluate(() => ({ url: location.pathname + location.search,
      ordenesAbiertas: [...document.querySelectorAll('a[href*="ordenes/index.html?ids="]')].map(a => a.innerText.replace(/\s+/g, ' ').trim().slice(0, 30) + '→' + a.getAttribute('href').slice(0, 60)).slice(0, 3) }));
    await s.ir(`/clientes/centro.html?id=${CLI}&contrato=${CON}`, { esperar: 1500 }); await s.quieto(1500, 20000);
    const t0 = Date.now();
    out.msClienteAContrato = await s.page.evaluate(() => Math.round(window.__m.ultimaMut || 0));
    out.almacenLinks = await s.page.evaluate((ser) => [...document.querySelectorAll('a[href*="almacen/index.html?tab=existencias&serial="]')].filter(a => a.getClientRects().length).length, SERIAL);
    const selAlm = `a[href*="serial=${SERIAL}"]`;
    if (await s.page.$(selAlm)) {
      out.msContratoASerial = await navegar(s, selAlm);
      await s.page.waitForFunction((ser) => document.body.innerText.includes(ser) && document.querySelector('.ef-ficha, #equipoFicha, [data-ficha-abierta], .drawer.open, .modal-backdrop.open'), { timeout: 10000 }, SERIAL).catch(() => {});
      out.serialAbierto = await s.page.evaluate((ser) => document.body.innerText.includes(ser), SERIAL);
    }
  }
  // Ficha del pool (como la abre Almacén / el chip del equipo en la orden)
  if (['admin', 'inventario', 'recepcion'].includes(rol)) {
    await s.ir(`/almacen/index.html?tab=existencias&serial=${SERIAL}`, { esperar: 2000 }); await s.quieto(1500, 20000);
    out.fichaPool = await s.page.evaluate((cli) => [...document.querySelectorAll(`a[href*="${cli}"], a[href*="ALQ20251211-02"]`)].filter(a => a.getClientRects().length).map(a => a.innerText.trim().slice(0, 20) + '→' + a.getAttribute('href')), CLI);
    await s.captura(`p8-${rol}-${vp}-ficha-pool`);
  }
  out.errores = s.errores.filter(e => !/favicon/.test(e)).slice(0, 3);
  console.log(JSON.stringify(out));
  await s.cerrar();
}
// ANTES: Ctrl+K y teclear el nombre del cliente desde la orden (recepción, escritorio)
if (!process.env.SIN_ANTES) {
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio', carpeta: 'home-nav' });
  await s.ir(`/ordenes/index.html?ids=${ORDEN}`, { esperar: 1500 });
  const t0 = Date.now();
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('k'); await s.page.keyboard.up('Control');
  await s.page.keyboard.type('SEPROSA', { delay: 120 });
  await s.page.waitForFunction(() => document.querySelector('#sp-results .sp-row'), { timeout: 15000 }).catch(() => {});
  const tRes = Date.now() - t0;
  await Promise.all([s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}), s.page.keyboard.press('Enter')]);
  await s.quieto(1200, 20000);
  console.log(JSON.stringify({ antes: 'Ctrl+K + "SEPROSA" (7 teclas) + Enter', msHastaResultados: tRes, msTotal: Date.now() - t0, url: await s.page.evaluate(() => location.pathname + location.search) }));
  await s.cerrar();
}

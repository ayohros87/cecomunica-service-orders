// Ejecución 2026-10-02 · D13 (enlaces aviso ↔ contrato / cotización / orden) y P8
// (señales de Finanzas en el home). Solo lectura: no marca nada.
import { abrir, USUARIOS, j } from './_lib.mjs';
const log = (...a) => console.log(...a);
const CONTRATO = '0tvyC3iqszzPIVmJQFTv';           // ALQ20260902-01, aviso pendiente
const CONTRATO_ESP = 'eWb1xJeEF8E2XQD1yeXK';       // SERV20260908-01, aviso en espera
const COT_PEND = 'VHRi2YlvoEWCVsL7vEZI', COT_FACT = 'H9SQYWYw5IPhbqFS9n7C';

const estadoBandeja = (s) => s.page.evaluate(() => ({
  q: document.getElementById('fbBuscar')?.value,
  hechos: document.getElementById('fbVerHechos')?.checked,
  chip: document.querySelector('#fbChips .fb-chip.active')?.getAttribute('data-f'),
  filas: [...document.querySelectorAll('[data-row]')].map(r => r.getAttribute('data-row') + (r.classList.contains('is-open') ? ' (ABIERTA)' : '')),
  vuelta: [...document.querySelectorAll('.fb-row.is-open a.btn')].map(a => a.textContent.trim()),
}));

{ // ── Recepción ──
  const s = await abrir({ email: USUARIOS.recepcion, viewport: 'escritorio' });
  log('CONTRATO', j(await s.ir(`/contratos/documento.html?id=${CONTRATO}`)));
  const lnk = await s.page.evaluate(() => { const a = document.getElementById('lnkFacturacion'); return a && { hidden: a.hidden, href: a.getAttribute('href') }; });
  log('enlace contrato → bandeja', j(lnk));
  if (lnk && !lnk.hidden) {
    const t0 = Date.now();
    await Promise.all([s.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), s.page.click('#lnkFacturacion')]);
    await s.page.waitForSelector('[data-row]', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 800));
    log('bandeja desde contrato', Date.now() - t0, 'ms', j(await estadoBandeja(s)));
  }
  log('CONTRATO EN ESPERA', j(await s.ir(`/facturacion/bandeja.html?q=SERV20260908-01`)));
  log('bandeja ?q= en espera', j(await estadoBandeja(s)));
  for (const id of [COT_PEND, COT_FACT]) {
    await s.ir(`/cotizaciones/detalle-cotizacion.html?id=${id}`);
    const b = await s.page.evaluate(() => [...document.querySelectorAll('a.btn')].filter(a => /bandeja\.html/.test(a.href)).map(a => ({ txt: a.textContent.trim(), href: a.getAttribute('href') })));
    log('cotización', id, j(b));
    if (id === COT_PEND && b.length) {
      await Promise.all([s.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), s.page.click('a.btn[href*="bandeja.html"]')]);
      await s.page.waitForSelector('.fb-row.is-open', { timeout: 15000 }).catch(() => {});
      log('bandeja desde cotización', j(await estadoBandeja(s)));
    }
  }
  log('HOME recepción', j(await s.ir('/index.html')));
  await new Promise(r => setTimeout(r, 2500));
  log('tile FAV', j(await s.page.evaluate(() => [...document.querySelectorAll('[data-sig], .kpi')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 80)).filter(t => /facturar|Comisiones/i.test(t)))));
  log('ERRORES', j(s.errores.slice(0, 5)));
  await s.cerrar();
}
{ // ── Contabilidad ──
  const s = await abrir({ email: USUARIOS.contabilidad, viewport: 'escritorio' });
  log('HOME contabilidad', j(await s.ir('/index.html')));
  await new Promise(r => setTimeout(r, 2500));
  log('tiles', j(await s.page.evaluate(() => [...document.querySelectorAll('[data-sig], .kpi')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 80)).filter(t => /facturar|Comisiones/i.test(t)))));
  log('COMISIONES ?f=pago', j(await s.ir('/facturacion/comisiones.html?f=pago')));
  log('chip', j(await s.page.evaluate(() => document.querySelector('.cm-chip.active')?.innerText.replace(/\s+/g, ' '))));
  log('ERRORES', j(s.errores.slice(0, 5)));
  await s.cerrar();
}
{ // ── Vendedor: el enlace del contrato no aparece ──
  const s = await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio' });
  await s.ir(`/contratos/documento.html?id=${CONTRATO}`);
  log('vendedor enlace', j(await s.page.evaluate(() => document.getElementById('lnkFacturacion')?.hidden)));
  await s.cerrar();
}

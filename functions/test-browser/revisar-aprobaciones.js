/* global document, window, sessionStorage, HomeSignals, CentroAprobaciones, Centro */
// HTML/CSS/JS de producción, datos ficticios; no inicia sesión ni toca Firebase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const puppeteer = require('puppeteer-core');
const ROOT = path.resolve(__dirname, '../../public');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'aprobaciones-'));
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

async function main() {
  const server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    let data = fs.readFileSync(file);
    const ext = path.extname(file);
    if (ext === '.html') data = data.toString().replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[ext] || 'application/octet-stream');
    res.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1280, height: 950 } });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:') ? req.continue() : req.abort());
    const base = `http://127.0.0.1:${server.address().port}`;
    const script = file => page.addScriptTag({ path: path.join(ROOT, 'js', file) });
    async function fixtures() {
      await page.evaluate(() => {
        window.registros = {
          gestiones: Array.from({ length: 54 }, (_, i) => ({ id: `GA-${String(i).padStart(3, '0')}`,
            cliente_id: 'cli1', cliente_nombre: i === 0 ? 'Cliente <prueba> & Asociados' : `Cliente ${i + 1}`,
            tipo: 'aumento', estado: 'pendiente_aprobacion', ...(i === 53 ? { deleted: true } : {}) })),
          contratos: [{ id: 'doc-c1', contrato_id: 'ALQ-2026-01', cliente_id: 'cli1', cliente_nombre: 'Cliente contrato', estado: 'pendiente_aprobacion' }],
        };
        const consulta = (col, filtros = [], cursor = null, limit = 50) => ({
          where: (...f) => consulta(col, [...filtros, f], cursor, limit),
          orderBy: () => consulta(col, filtros, cursor, limit),
          startAfter: c => consulta(col, filtros, c, limit),
          limit: n => consulta(col, filtros, cursor, n),
          get: async () => {
            if (window.falloConsulta) throw new Error('offline');
            const docs = window.registros[col].filter(r => (!cursor || r.id > cursor.id)
              && filtros.every(([f, op, v]) => op === 'in' ? v.includes(r[f]) : r[f] === v))
              .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit).map(r => ({ id: r.id, data: () => r }));
            return { docs, size: docs.length };
          },
        });
        const firestore = () => ({ collection: col => consulta(col) });
        firestore.FieldPath = { documentId: () => '__name__' };
        window.firebase = { firestore };
        window.FbAgg = { disponible: true, count: async (col, filtros) => {
          if (window.falloConsulta) throw new Error('offline');
          return window.registros[col].filter(r => filtros.every(([f, op, v]) => op === 'in' ? v.includes(r[f]) : r[f] === v)).length;
        } };
        window.MODULOS = { puedeVer: () => true };
        window.SenalesService = new Proxy({}, { get: () => async () => 2 });
        window.GestionesService = { tipoLabel: t => ({ aumento: 'Aumento de equipos', baja: 'Baja de equipos' })[t] || t };
      });
      await script('services/aprobacionesService.js');
    }

    await page.goto(base + '/index.html');
    await fixtures();
    await script('pages/home-signals.js');
    await page.evaluate(() => HomeSignals.render({ rolEfectivo: 'administrador', uid: 'test' }));
    assert.equal(await page.$$eval('.kpi', els => els.length), 7);
    assert.equal(await page.$eval('.kpis', el => window.getComputedStyle(el).display), 'grid');
    assert.equal(await page.$eval('[data-signal-val="SAG"]', el => el.textContent), '53');
    assert.equal(await page.$eval('[data-signal-val="S10"]', el => el.textContent), '1');
    await (await page.$('#signalsRow')).screenshot({ path: path.join(OUT, 'home-desktop.png') });
    // La caché conserva 53, pero el servidor ya tiene 52: el home debe releer.
    await page.evaluate(async () => {
      window.registros.gestiones[0].estado = 'pendiente_firma';
      await HomeSignals.render({ rolEfectivo: 'administrador', uid: 'test' });
    });
    assert.equal(await page.$eval('[data-signal-val="SAG"]', el => el.textContent), '52');
    await page.setViewport({ width: 390, height: 844 });
    await (await page.$('#signalsRow')).screenshot({ path: path.join(OUT, 'home-mobile.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const destino = await page.$eval('[data-signal="SAG"]', el => el.getAttribute('href'));
    assert.equal(destino, 'clientes/centro.html?aprobaciones=gestiones');

    // Dos ceros: salen de la rejilla, conservan su destino y ocupan menos.
    await page.setViewport({ width: 1280, height: 950 });
    await page.evaluate(async () => {
      window.registros.gestiones = [];
      window.registros.contratos = [];
      await HomeSignals.render({ rolEfectivo: 'administrador', uid: 'test' });
    });
    assert.equal(await page.$$eval('.kpis > .kpi', els => els.length), 5);
    assert.equal(await page.$$eval('.kpis-zero .kpi', els => els.length), 2);
    assert.equal(await page.$eval('.kpis', el => el.dataset.n), '5');
    assert.ok(await page.evaluate(() => document.querySelector('.kpis-zero .kpi').getBoundingClientRect().height
      < document.querySelector('.kpis > .kpi').getBoundingClientRect().height));
    await (await page.$('#signalsRow')).screenshot({ path: path.join(OUT, 'ceros-mixtos-desktop.png') });
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(await page.$eval('.kpis-zero .kpi', el => el.getBoundingClientRect().height >= 44));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await (await page.$('#signalsRow')).screenshot({ path: path.join(OUT, 'ceros-mixtos-mobile.png') });

    // Regresa un pendiente sin reconstruir el home: se conserva orden y foco.
    await page.focus('[data-signal="SAG"]');
    await page.evaluate(() => {
      window.registros.gestiones = [{ id: 'g1', estado: 'pendiente_aprobacion' }];
      window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForFunction(() => document.querySelector('.kpis > [data-signal="SAG"]'));
    assert.equal(await page.$eval('.kpis > .kpi', el => el.dataset.signal), 'SAG');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.signal), 'SAG');
    assert.equal(await page.$eval('[data-signal-val="SAG"]', el => el.textContent), '1');

    // Todos en cero: solo la franja compacta; los paneles siguen abriendo.
    await script('ui/bandeja.js');
    await page.evaluate(async () => {
      sessionStorage.clear();
      Object.values(HomeSignals.SIGNALS).forEach(sig => { sig.count = async () => 0; });
      HomeSignals.SIGNALS.EST.items = async () => [];
      await HomeSignals.render({ rolEfectivo: 'administrador', uid: 'test' });
    });
    assert.equal(await page.$eval('.kpis', el => window.getComputedStyle(el).display), 'none');
    assert.equal(await page.$$eval('.kpis-zero .kpi', els => els.length), 7);
    assert.equal(await page.$eval('.kpis-zero__label', el => el.textContent), 'Sin pendientes');
    await (await page.$('#signalsRow')).screenshot({ path: path.join(OUT, 'todos-cero-mobile.png') });
    await page.click('.kpis-zero [data-signal="EST"]');
    await page.waitForFunction(() => document.querySelector('.bj-panel')?.textContent.includes('Ninguna orden parada'));
    await page.click('.kpis-zero [data-signal="EST"]');
    assert.equal(await page.$('.bj-panel'), null);
    // Volver a pintar con un panel abierto tampoco deja una referencia vieja.
    await page.click('.kpis-zero [data-signal="EST"]');
    await page.evaluate(() => HomeSignals.render({ rolEfectivo: 'administrador', uid: 'test' }));
    await page.click('.kpis-zero [data-signal="EST"]');
    await page.waitForFunction(() => document.querySelector('.bj-panel')?.textContent.includes('Ninguna orden parada'));
    await page.setViewport({ width: 1280, height: 950 });
    await page.click('.kpis-zero [data-signal="EST"]');
    await (await page.$('#signalsRow')).screenshot({ path: path.join(OUT, 'todos-cero-desktop.png') });
    // Sin red no es cero: la señal queda visible como dato no disponible.
    await page.evaluate(async () => {
      HomeSignals.SIGNALS.SAG.count = async () => { throw new Error('offline'); };
      await HomeSignals.render({ rolEfectivo: 'administrador', uid: 'test' });
    });
    assert.equal(await page.$eval('.kpis > [data-signal="SAG"] .kpi__val', el => el.textContent), '—');
    assert.equal(await page.$eval('.kpis', el => el.hidden), false);

    await page.setViewport({ width: 1280, height: 950 });
    await page.goto(base + '/' + destino);
    await fixtures();
    await script('pages/clientes-centro.js');
    await script('pages/centro-aprobaciones.js');
    await page.evaluate(() => CentroAprobaciones.init('administrador'));
    await page.waitForFunction(() => document.querySelectorAll('.cg-aprobacion-row').length === 50);
    assert.equal(await page.$eval('[data-aprobaciones-count="gestiones"]', el => el.textContent), '53');
    assert.equal(await page.$eval('.cg-aprobacion-row b', el => el.textContent), 'Cliente <prueba> & Asociados');
    assert.equal(await page.$eval('.cg-aprobacion-row a', el => el.getAttribute('href')), '?id=cli1&g=GA-000&aprobaciones=gestiones');
    await page.click('[data-aprobaciones-mas]');
    await page.waitForFunction(() => document.querySelectorAll('.cg-aprobacion-row').length === 53);
    await page.click('[data-aprobaciones="contratos"]');
    await page.waitForFunction(() => document.querySelectorAll('.cg-aprobacion-row').length === 1);
    assert.ok(await page.$eval('.cg-aprobacion-row a', el => el.getAttribute('href').includes('contrato=doc-c1')));
    await (await page.$('#cgAprobaciones')).screenshot({ path: path.join(OUT, 'centro-desktop.png') });
    // Simular la aprobación y el regreso a la bandeja usando el método real.
    await page.evaluate(async () => {
      window.registros.contratos[0].estado = 'aprobado';
      await CentroAprobaciones.refrescar();
    });
    await page.waitForFunction(() => document.querySelector('[data-aprobaciones-mensaje]').textContent.includes('No hay contratos'));
    assert.equal(await page.$eval('[data-aprobaciones-count="contratos"]', el => el.textContent), '0');
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('ccHomeSignals:')).length), 0);
    await page.click('[data-aprobaciones="gestiones"]');
    await page.waitForFunction(() => document.querySelectorAll('.cg-aprobacion-row').length === 50);
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(OUT, 'centro-mobile.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.evaluate(async () => { window.falloConsulta = true; await CentroAprobaciones.refrescar(); });
    await page.waitForFunction(() => document.querySelector('[data-aprobaciones-mensaje]').textContent.includes('No se pudieron'));
    assert.equal(await page.$eval('[data-aprobaciones-count="gestiones"]', el => el.textContent), '—');
    // El retorno desde la ficha conserva la cola seleccionada.
    await page.evaluate(() => {
      window.falloConsulta = false;
      Centro.cargarLista = () => {};
      Centro.volver();
    });
    assert.equal(new URL(page.url()).searchParams.get('aprobaciones'), 'gestiones');
    assert.deepEqual(errors, []);
    console.log('OK: home, caché, enlaces, bandeja, paginación, aprobación, retorno, errores y móvil.');
    console.log('Capturas: ' + OUT);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

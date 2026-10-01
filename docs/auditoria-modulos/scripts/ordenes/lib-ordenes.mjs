// Helpers del recorrido del módulo Órdenes (auditoría 2026-09-30). Sin datos.
// Reutiliza emu-lib.mjs; NO duplica el parche del emulador.
export { abrir, USUARIOS, BASE } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

export const PREFIJO = 'PRUEBA-AUDIT-ordenes';

// Storage y Functions NO corren en el emulador: cualquier put() iría a
// producción. Se stubea firebase.storage() en la página ANTES de confirmar
// una firma. Devuelve una URL falsa reconocible.
export async function stubStorage(s) {
  return s.page.evaluate(async () => {
    try { if (window.CargaDiferida?.storage) await CargaDiferida.storage(); } catch (e) {}
    const fake = () => ({
      ref: (p) => ({
        put: async () => ({}),
        getDownloadURL: async () => 'https://stub.emulador.local/' + encodeURIComponent(p),
        getMetadata: async () => ({}),
        delete: async () => ({}),
      }),
      refFromURL: (u) => ({ delete: async () => ({}), getDownloadURL: async () => u }),
    });
    try { Object.defineProperty(firebase, 'storage', { configurable: true, writable: true, value: fake }); }
    catch (e) { firebase.storage = fake; }
    window.__storageStub = true;
    return typeof firebase.storage === 'function' && firebase.storage().ref('x').put !== undefined;
  });
}

// Espera a que la URL cumpla el patrón (navegaciones por setTimeout+href).
export async function esperarUrl(s, re, max = 15000) {
  const fin = Date.now() + max;
  while (Date.now() < fin) {
    const u = await s.page.evaluate(() => location.pathname + location.search).catch(() => '');
    if (re.test(u)) { await s.quieto(1000, 15000); return u; }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('no llegó a ' + re);
}

// Dibuja una firma con el mouse sobre un canvas (el helper viejo oye mouse y touch).
export async function firmarCanvas(s, sel) {
  const r = await s.page.$eval(sel, el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const m = s.page.mouse;
  const x0 = r.x + r.w * 0.2, y0 = r.y + r.h * 0.5;
  await m.move(x0, y0); await m.down();
  for (let i = 1; i <= 12; i++) await m.move(x0 + i * (r.w * 0.05), y0 + Math.sin(i) * r.h * 0.2, { steps: 2 });
  await m.up();
  return r;
}

// Selecciona una opción de un <select> por texto (contiene) y dispara change.
export async function elegirOpcion(s, sel, texto) {
  return s.page.evaluate((sel, texto) => {
    const el = document.querySelector(sel); if (!el) return 'no-select';
    const t = texto.toLowerCase();
    const op = [...el.options].find(o => (o.textContent || '').toLowerCase().includes(t) || (o.value || '').toLowerCase().includes(t));
    if (!op) return 'no-opcion:' + [...el.options].slice(0, 12).map(o => o.textContent.trim()).join('|');
    el.value = op.value; el.dispatchEvent(new Event('change', { bubbles: true }));
    return op.textContent.trim();
  }, sel, texto);
}

export async function tipear(s, sel, texto) {
  await s.page.click(sel, { clickCount: 3 });
  await s.page.keyboard.type(texto);
}

// Mide una acción: ms hasta que la página se aquieta tras `fn`.
export async function medir(s, nombre, fn) {
  const t0 = Date.now();
  await fn();
  await s.quieto(800, 20000);
  const ms = Date.now() - t0;
  console.log(`  ⏱ ${nombre}: ${ms} ms`);
  return ms;
}

// Clic por texto visible de un botón (dentro de un contenedor opcional).
export async function clicTexto(s, texto, contenedor = 'body') {
  const ok = await s.page.evaluate((texto, contenedor) => {
    const raiz = document.querySelector(contenedor) || document.body;
    const b = [...raiz.querySelectorAll('button, a, [role=button], label')].find(e => e.offsetParent && (e.innerText || e.textContent || '').trim().includes(texto));
    if (!b) return false; b.click(); return true;
  }, texto, contenedor);
  await s.quieto(800, 15000);
  return ok;
}

export async function modalAbierto(s) {
  return s.page.evaluate(() => {
    const m = [...document.querySelectorAll('.modal-backdrop.open, .overlay:not(.hidden), [role=dialog]')].filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; });
    return m.map(e => (e.id || e.className) + ' :: ' + (e.innerText || '').replace(/\s+/g, ' ').slice(0, 160));
  });
}

export function log(...a) { console.log(...a); }

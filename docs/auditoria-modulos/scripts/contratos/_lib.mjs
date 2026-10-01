// Auditoría de módulos 2026-09-30 · CONTRATOS · helpers sobre emu-lib.
// Reutiliza tools/emulador-almacen/emu-lib.mjs (no duplica el parche).
//
// blindar(s): el emulador solo corre auth+firestore+hosting. Storage y las
// callables NO están emulados: cualquier put() de Storage o httpsCallable iría
// a PRODUCCIÓN. Se bloquea EN LA PÁGINA (fetch/XHR) antes de que salga.
import fs from 'node:fs';
import path from 'node:path';
export { abrir, USUARIOS, BASE, CAPTURAS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';

export const ESTADO = process.env.ESTADO_AUDIT
  || 'C:/Users/ayohr/AppData/Local/Temp/claude/c--Projects-cecomunica-service-orders/60b5518e-dd51-4291-ac4d-c4f75cea0c5b/scratchpad/contratos-estado.json';

export function leerEstado() { try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return {}; } }
export function guardarEstado(patch) {
  const cur = leerEstado(); const next = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify(next, null, 2));
  return next;
}

const BLOQUEADOS = /firebasestorage\.googleapis\.com|storage\.googleapis\.com|cloudfunctions\.net|\.run\.app|us-central1-/;
export async function blindar(s) {
  await s.page.evaluateOnNewDocument((re) => {
    const RE = new RegExp(re);
    window.__bloqueadas = [];
    const of = window.fetch.bind(window);
    window.fetch = (u, o) => { const url = String(u && u.url ? u.url : u); if (RE.test(url)) { window.__bloqueadas.push(url.slice(0, 120)); return Promise.reject(new TypeError('AUDITORÍA: bloqueado (Storage/Functions no emulados)')); } return of(u, o); };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...r) { if (RE.test(String(u))) { window.__bloqueadas.push(String(u).slice(0, 120)); throw new TypeError('AUDITORÍA: bloqueado (Storage/Functions no emulados)'); } return oo.call(this, m, u, ...r); };
  }, BLOQUEADOS.source);
  s.bloqueadas = () => s.page.evaluate(() => window.__bloqueadas || []);
  return s;
}

// Contador de interacciones del camino feliz (1 clic, 1 campo, 1 confirmación, 1 gesto = 1).
export function contador(nombre) {
  const pasos = [];
  return {
    paso(desc, n = 1) { pasos.push({ desc, n }); return n; },
    total() { return pasos.reduce((a, p) => a + p.n, 0); },
    tabla() { return pasos.map(p => `  ${String(p.n).padStart(2)}  ${p.desc}`).join('\n') + `\n  == ${this.total()} interacciones (${nombre})`; },
  };
}

export const espera = (ms) => new Promise(r => setTimeout(r, ms));

// Clic por texto visible dentro de un contenedor (botones/enlaces/labels).
export async function clicTexto(s, texto, { dentro = 'body', tag = 'button, a, label, .cg-menu button, .overflow-menu-item', esperar = 800 } = {}) {
  const ok = await s.page.evaluate((texto, dentro, tag) => {
    const root = document.querySelector(dentro) || document;
    const els = [...root.querySelectorAll(tag)].filter(e => e.offsetParent !== null || e.getClientRects().length);
    const el = els.find(e => (e.innerText || e.textContent || '').trim().toLowerCase().includes(texto.toLowerCase()));
    if (!el) return false;
    el.click(); return true;
  }, texto, dentro, tag);
  if (!ok) throw new Error(`no encontré "${texto}" en ${dentro}`);
  await s.quieto(esperar, 15000);
  return true;
}

export async function texto(s, sel) { return s.texto(sel).catch(() => ''); }

// Firma dibujada con el mouse sobre un canvas (gesto = 1 interacción).
export async function firmarCanvas(s, sel) {
  const box = await (await s.page.$(sel)).boundingBox();
  const x0 = box.x + box.width * 0.2, y0 = box.y + box.height * 0.5;
  await s.page.mouse.move(x0, y0);
  await s.page.mouse.down();
  for (let i = 1; i <= 12; i++) await s.page.mouse.move(x0 + i * box.width * 0.05, y0 + Math.sin(i) * box.height * 0.2, { steps: 3 });
  await s.page.mouse.up();
}

// PNG chiquito para "fotos" (cédula, selfie, contrato firmado). 1×1 no basta: se comprime en canvas.
export function pngPrueba(dir, nombre) {
  const p = path.join(dir, nombre);
  if (!fs.existsSync(p)) {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mP8z8BQz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC';
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  }
  return p;
}
export function pdfPrueba(dir, nombre) {
  const p = path.join(dir, nombre);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  }
  return p;
}

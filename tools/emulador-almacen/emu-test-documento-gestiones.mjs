// Columna "Documento" de la pestaña Gestiones del archivo (Zuleika, 2026-10-08:
// "si el documento firmado ya esté subido"). Gerencia —su rol— abre el
// archivo, ve la columna, filtra "Falta documento" y abre una carta de baja.
// Antes: (desde functions/) NODE_PATH=./node_modules node ../tools/emulador-almacen/emu-copiar-gestiones.js
//   node emu-test-documento-gestiones.mjs
import { abrir, USUARIOS } from './emu-lib.mjs';

let fallos = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FALLA ') + m); if (!c) fallos++; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

for (const viewport of ['escritorio', 'telefono']) {
  console.log(`— ${viewport}`);
  const s = await abrir({ email: USUARIOS.gerencia, viewport, carpeta: 'documento-gestiones' });
  await s.ir('/contratos/index.html?tab=gestiones', { esperar: 3000 });
  await s.page.waitForFunction(() => document.querySelectorAll('#tablaGestiones tr[data-gestion-id]').length > 0, { timeout: 15000 });

  const t = await s.page.evaluate(() => {
    const ths = [...document.querySelectorAll('#panelGestiones thead th')].map(th => th.textContent.trim());
    const col = ths.indexOf('Documento');
    const filas = [...document.querySelectorAll('#tablaGestiones tr[data-gestion-id]')].map(tr => ({
      id: tr.dataset.gestionId, doc: tr.children[col]?.textContent.trim(), ver: !!tr.children[col]?.querySelector('button[data-path]'),
    }));
    return { col, filas, resumen: document.getElementById('resumenGestiones').innerText };
  });
  ok(t.col === 6, `columna "Documento" en el encabezado (índice ${t.col})`);
  const por = (re) => t.filas.filter(f => re.test(f.id));
  ok(por(/^GR/).every(f => f.doc === 'No lleva'), `reemplazos: "No lleva" (${por(/^GR/).length})`);
  ok(por(/^GD/).every(f => f.doc === 'No lleva'), `demos: "No lleva" (${por(/^GD/).length})`);
  const bajasConCarta = t.filas.filter(f => f.doc === 'Carta cargada');
  ok(bajasConCarta.length >= 1 && bajasConCarta.every(f => f.ver), `bajas con carta traen botón para verla (${bajasConCarta.length})`);
  ok(t.filas.filter(f => f.doc === 'Firmado en papel').every(f => f.ver), 'anexos en papel traen botón para verlos');
  ok(/sin documento/.test(t.resumen), `el pie cuenta las que faltan: "${t.resumen}"`);
  await s.captura(`01-columna-${viewport}`);

  await s.page.evaluate(() => document.getElementById('chkGestionesSinDocumento').click());
  await espera(300);
  const f = await s.page.evaluate(() => [...document.querySelectorAll('#tablaGestiones tr[data-gestion-id]')].map(tr => tr.dataset.gestionId));
  ok(f.length > 0 && f.every(id => /^G[AB]/.test(id)), `"Falta documento" deja solo aumentos/bajas: ${f.join(', ')}`);
  await s.captura(`02-falta-documento-${viewport}`);

  if (viewport === 'escritorio') {
    // La carta se abre con una URL firmada de Storage — en el emulador no hay
    // Storage: basta con que el botón llame al servicio con el path correcto.
    await s.page.evaluate(() => document.getElementById('chkGestionesSinDocumento').click());
    await espera(300);
    const llamado = await s.page.evaluate(async () => {
      let path = null;
      const orig = GestionesService.urlAnexo;
      GestionesService.urlAnexo = async (p) => { path = p; throw new Error('sin storage'); };
      const b = [...document.querySelectorAll('#tablaGestiones button[data-path]')].find(x => /carta-baja/.test(x.dataset.path));
      b?.click();
      await new Promise(r => setTimeout(r, 200));
      GestionesService.urlAnexo = orig;
      return path;
    });
    ok(/^gestiones_anexos\/GB.+carta-baja/.test(llamado || ''), `el ojo pide la carta correcta: ${llamado}`);
  }

  const geo = await s.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (viewport === 'telefono') console.log(`    (scroll horizontal de la página en teléfono: ${geo}px — la tabla ya scrolleaba antes del cambio)`);
  const errs = s.errores.filter(e => !/sin storage/.test(e));
  ok(!errs.length, `sin errores de consola${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await s.cerrar();
}

console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);

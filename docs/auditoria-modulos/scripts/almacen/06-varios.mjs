// Piezas sueltas del recorrido: Importar hoja paso a paso (¿pide el modelo
// antes del archivo?), Ctrl+K con un serial, y el ±N de Piezas.
//   node 06-varios.mjs
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const s = await abrir({ email: USUARIOS.inventario, viewport: 'escritorio', carpeta: 'almacen' });
const p = s.page;
const log = (...a) => console.log(...a);
const ultimoModal = () => p.evaluate(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return m ? m.innerText.replace(/\n{2,}/g, '\n').slice(0, 1200) : '(sin modal)'; });

// ── Importar hoja: intención "Conté este estante" ──────────────────────
await s.ir('/almacen/index.html');
await s.hacer(() => AlmacenPage.abrirImportar());
await p.waitForSelector('.ai-intencion', { timeout: 10000 }).catch(() => {});
await s.hacer(() => document.querySelector('.ai-intencion[data-intencion="conteo"]')?.click());
await s.quieto(800, 8000);
await s.captura('60-inventario-escritorio-importar-conteo-paso1');
log('Importar · Conté este estante · paso 1:\n' + await ultimoModal());
log('   campos: ' + await p.evaluate(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return [...m.querySelectorAll('input, select, textarea, button')].map(e => `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''}${e.id ? '#' + e.id : ''}${e.placeholder ? '[' + e.placeholder + ']' : ''}${e.tagName === 'BUTTON' ? '(' + e.textContent.trim().slice(0, 25) + ')' : ''}`).join(' · '); }));
await p.keyboard.press('Escape'); await s.quieto(400, 3000);
await s.hacer(() => AlmacenPage.abrirImportar());
await p.waitForSelector('.ai-intencion', { timeout: 10000 }).catch(() => {});
await s.hacer(() => document.querySelector('.ai-intencion[data-intencion="revisar"]')?.click());
await s.quieto(800, 8000);
log('Importar · Solo quiero revisar · paso 1:\n' + (await ultimoModal()).slice(0, 500));
await p.keyboard.press('Escape'); await s.quieto(400, 3000);

// ── Ctrl+K con un serial ───────────────────────────────────────────────
await p.keyboard.down('Control'); await p.keyboard.press('k'); await p.keyboard.up('Control');
await s.quieto(500, 4000);
const hayPaleta = await p.evaluate(() => !!document.querySelector('[data-cc-palette], .cc-palette, .search-palette, #searchPalette, .palette'));
log('Ctrl+K abrió paleta: ' + hayPaleta + ' · activo=' + await p.evaluate(() => document.activeElement?.tagName + '#' + document.activeElement?.id + '[' + (document.activeElement?.placeholder || '') + ']'));
await p.keyboard.type('22610A3919', { delay: 10 }); await s.quieto(1200, 8000);
await s.captura('61-inventario-escritorio-ctrlk-serial');
log('Ctrl+K resultados: ' + (await p.evaluate(() => (document.activeElement?.closest('[role=dialog], .modal-backdrop, .palette, .cc-palette, .search-palette') || document.body).innerText.replace(/\n{2,}/g, '\n').slice(0, 700))).replace(/\n/g, ' / '));
await p.keyboard.press('Escape'); await s.quieto(400, 3000);

// ── Existencias: buscar por serial abre ficha (serial real, con kardex) ─
await s.clic('.ws-tab[data-ws-tab="existencias"]');
await p.focus('#exBuscador'); await p.keyboard.type('22610A3919', { delay: 5 }); await p.keyboard.press('Enter');
await p.waitForFunction(() => { const ms = document.querySelectorAll('.modal-backdrop.open'); const m = ms[ms.length - 1]; return !!m && m.innerText.includes('HISTORIA'); }, { timeout: 12000 }).catch(() => {});
await s.captura('62-inventario-escritorio-ficha-real-kardex');
log('ficha real: ' + (await ultimoModal()).slice(0, 900).replace(/\n/g, ' / '));
await p.keyboard.press('Escape'); await s.quieto(400, 3000);

// ── Existencias: fila expandida (PNC360S-R) ────────────────────────────
await p.evaluate(() => { document.getElementById('exBuscador').value = ''; AlmacenExistencias.onBuscar('PNC360S-R'); });
await s.quieto(500, 3000);
await p.evaluate(() => [...document.querySelectorAll('#exTabla tr.ex-fila')].find(tr => /PNC360S-R/.test(tr.innerText))?.click());
await s.quieto(1500, 12000);
await s.captura('63-inventario-escritorio-existencias-fila-abierta');
log('fila abierta: ' + (await s.texto('tr.ex-expansion')).slice(0, 700).replace(/\n/g, ' / '));
log('consultas fila: ' + (await s.consultas()).slice(-2).join(' · '));

// ── Piezas: ±N ─────────────────────────────────────────────────────────
await s.ir('/inventario/piezas.html');
log('piezas KPIs: ' + (await s.texto('.kpi-grid')).replace(/\n/g, ' · '));
await s.hacer(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '±' && !b.disabled)?.click());
await s.quieto(600, 5000);
await s.captura('64-inventario-escritorio-piezas-ajuste');
log('±N: ' + (await ultimoModal()).slice(0, 500).replace(/\n/g, ' / '));
await p.keyboard.press('Escape'); await s.quieto(300, 2000);
log('fila de pieza: ' + await p.evaluate(() => document.querySelector('table tbody tr')?.innerText.replace(/\s+/g, ' ').slice(0, 300)));
log('errores: ' + [...new Set(s.errores)].slice(0, 5).join(' | '));
await s.cerrar();

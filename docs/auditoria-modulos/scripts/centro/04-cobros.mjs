// Cobros (Andrea, rol recepcion): "asignar vendedor" en la edición masiva de clientes (232/mes según el brief),
// paso a paso sobre el cliente de prueba PRUEBA-AUDIT-centro; la barra masiva; la bandeja de regularización; y el Centro con ese rol.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const log = (k, v) => console.log(k, JSON.stringify(v).slice(0, 1600));
const s = await abrir({ email: USUARIOS.cobros, viewport: 'escritorio', carpeta: 'centro' });

let info = await s.ir('/clientes/index.html');
log('c_grid', { ...info, geo: await s.geometria(), consultas: await s.consultas(), errores: s.errores.slice(0, 6) });
log('c_grid_resumen', await s.texto('#resumen'));
log('c_grid_columnas', await s.page.evaluate(() => [...document.querySelectorAll('#tabla thead th')].map(t => t.innerText.trim())));
await s.captura('50-cobros-escritorio-grid');
// ¿Cómo llega cobros aquí? rail / home
log('c_rail', await s.page.evaluate(() => [...document.querySelectorAll('#rail-mount a')].map(a => a.innerText.trim()).filter(Boolean)));

// Asignar vendedor a UN cliente: buscar → cambiar el select de la fila
let pasos = 0; const t0 = Date.now();
await s.page.type('#q', 'PRUEBA-AUDIT'); pasos++;
await new Promise(r => setTimeout(r, 3000)); await s.quieto(800, 15000);
const filas = await s.page.evaluate(() => [...document.querySelectorAll('#tbody tr')].map(tr => ({ nombre: tr.querySelector('[data-field=nombre]')?.value, vend: tr.querySelector('.vendedorSelect')?.selectedOptions?.[0]?.innerText })));
log('c_buscar', { ms: Date.now() - t0, filas, resumen: await s.texto('#resumen'), consultas: (await s.consultas()).slice(-3) });
await s.captura('51-cobros-escritorio-grid-buscar');
const ixPrueba = filas.findIndex(f => /PRUEBA-AUDIT/.test(f.nombre || ''));
log('c_fila_prueba', ixPrueba);
if (ixPrueba >= 0) {
  const t1 = Date.now();
  await s.page.evaluate(() => { const sel = [...document.querySelectorAll('#tbody tr')].find(tr => /PRUEBA-AUDIT/.test(tr.querySelector('[data-field=nombre]')?.value || '')).querySelector('.vendedorSelect'); const op = [...sel.options].find(o => /salomon/i.test(o.innerText)); sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }); pasos++;
  await s.quieto(1000);
  log('c_asignar', { ms: Date.now() - t1, pasos, estado: await s.page.evaluate(() => [...document.querySelectorAll('#tbody tr')].find(tr => /PRUEBA-AUDIT/.test(tr.querySelector('[data-field=nombre]')?.value || ''))?.querySelector('.row-status')?.className), toasts: (await s.toasts()).slice(-3), errores: s.errores.slice(0, 6) });
  await s.captura('52-cobros-escritorio-grid-vendedor-asignado');
  // deshacer: devolver a Karla (para no dejar el cliente de prueba cambiado)
  await s.page.evaluate(() => { const sel = [...document.querySelectorAll('#tbody tr')].find(tr => /PRUEBA-AUDIT/.test(tr.querySelector('[data-field=nombre]')?.value || '')).querySelector('.vendedorSelect'); const op = [...sel.options].find(o => /karla/i.test(o.innerText)); sel.value = op.value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await s.quieto(1000);
}
// Barra masiva
await s.page.evaluate(() => { document.getElementById('q').value = ''; document.getElementById('q').dispatchEvent(new Event('input', { bubbles: true })); });
await s.quieto(1500, 15000);
await s.page.evaluate(() => { const chks = [...document.querySelectorAll('#tbody .rowSel')].slice(0, 3); chks.forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
await s.quieto(500);
log('c_bulk', { barra: await s.texto('#bulkBar'), visible: await s.page.evaluate(() => document.getElementById('bulkBar').classList.contains('visible')) });
await s.captura('53-cobros-escritorio-grid-barra-masiva');
// Paginación / total
log('c_paginas', await s.page.evaluate(() => ({ pag: document.getElementById('pageInput')?.value, total: document.getElementById('pageTotal')?.innerText, stats: document.getElementById('statTotal')?.innerText + ' / ' + document.getElementById('statActivos')?.innerText + ' / ' + document.getElementById('statInactivos')?.innerText })));

// Regularización como cobros
info = await s.ir('/clientes/regularizacion.html');
log('c_reg', { ...info, errores: s.errores.slice(0, 6), chips: await s.texto('#rgChips'), resumen: await s.texto('#rgResumen') });
await s.hacer(() => [...document.querySelectorAll('.rg-chip')].find(b => b.dataset.f === 'sin_vendedor')?.click());
log('c_reg_sin_vendedor', (await s.texto('#rgRows')).split('\n').filter(Boolean).slice(0, 12));
await s.captura('54-cobros-escritorio-regularizacion-sin-vendedor');

// Centro como recepción
info = await s.ir('/clientes/centro.html');
log('c_centro', { ...info, errores: s.errores.slice(0, 6), resumen: await s.texto('#cgResumen'), extras: await s.texto('#cgToolsExtra'), aprob: await s.page.evaluate(() => document.getElementById('cgAprobaciones').classList.contains('hidden')) });
await s.page.type('#cgBuscar', 'PRUEBA-AUDIT');
await s.quieto(1200);
await s.hacer(() => document.querySelector('#cgLista .cg-row')?.click());
await s.quieto(1200);
log('c_centro_ficha', { cab: await s.texto('.cg-head'), primario: await s.texto('#btnPrimario'), gestion: await s.page.evaluate(() => !document.getElementById('btnGestion').classList.contains('hidden')) });
await s.clic('#btnGestion');
log('c_centro_menu', await s.texto('#cgMenu'));
await s.captura('55-cobros-escritorio-centro-ficha-prueba');
await s.hacer(() => document.getElementById('cgMenu').classList.add('hidden'));
await s.clic('#btnMasFicha');
log('c_centro_mas', await s.texto('#cgMasMenu'));
await s.cerrar();

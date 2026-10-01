// Auditoría CONTRATOS · Paso F: lista de contratos (admin, vendedora,
// contabilidad), señal del home vs. datos, documento v2 e imprimir clásico
// (pantalla vs. impresión), y la verificación pública /c/<id>?v=.
// Uso: node 15-lista-documento-verify.mjs <activoId> <codigoActivo> <anuladoViejoId> <codigoAnulado> <vencidoId> <codigoVencido> <clasicoId> <pasaporteId> <noCoincideId>
import { abrir, USUARIOS, blindar, contador, leerEstado, espera, texto } from './_lib.mjs';
const { contratoId, contratoNum } = leerEstado();
const [activoId, codActivo, anuladoId, codAnulado, vencidoId, codVencido, clasicoId, pasaporteId, noCoincideId] = process.argv.slice(2);

// ── Lista de contratos: admin ──
let s = await blindar(await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'contratos' }));
try {
  const r = await s.ir('/contratos/index.html', { esperar: 1500 });
  console.log('lista admin', r.msTotal, 'ms · primeraFs', r.primeraFs, '· consultas:', (await s.consultas()).slice(0, 6));
  await s.captura('60-admin-escritorio-lista-contratos');
  console.log('resumen:', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '));
  console.log('encabezados:', await s.page.evaluate(() => [...document.querySelectorAll('#encabezadoContratos th')].map(t => t.textContent.trim()).filter(Boolean)));
  console.log('geometría:', await s.geometria());
  // Chip "Aprobado": ¿cuántos? vs. señal del home (13).
  await s.page.evaluate(() => document.querySelector('#filtroEstadoChips [data-estado="aprobado"]').click()); await s.quieto(1500);
  console.log('chip Aprobado →', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '), '| Cargar más:', await texto(s, '#btnCargarMas'));
  await s.captura('61-admin-escritorio-lista-filtro-aprobado');
  // Chip "Anulado" (P0 #14 anterior).
  await s.page.evaluate(() => document.querySelector('#filtroEstadoChips [data-estado="anulado"]').click()); await s.quieto(1500);
  console.log('chip Anulado →', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '));
  await s.captura('62-admin-escritorio-lista-filtro-anulado');
  // Devolución pendiente
  await s.page.evaluate(() => document.querySelector('#filtroEstadoChips [data-estado=""]').click()); await s.quieto(1000);
  await s.page.click('#chkSoloDevolucion'); await s.quieto(1500);
  console.log('Devolución pendiente →', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '));
  await s.captura('63-admin-escritorio-lista-devolucion-pendiente');
  await s.page.click('#chkSoloDevolucion'); await s.quieto(800);
  // Buscar el contrato de prueba por número.
  await s.page.type('#filtroCliente', contratoNum); await s.page.keyboard.press('Enter'); await s.quieto(1500);
  console.log('buscar', contratoNum, '→', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '));
  const fila = await s.page.evaluate((id) => document.querySelector(`tr[data-contrato-doc-id="${id}"]`)?.innerText || '', contratoId);
  console.log('fila:', fila.replace(/\n/g, ' | '));
  await s.captura('64-admin-escritorio-lista-contrato-prueba');
  // Expediente en la fila
  await s.page.evaluate((id) => document.querySelector(`tr[data-contrato-doc-id="${id}"] button`)?.click(), contratoId); await s.quieto(1200);
  await s.captura('65-admin-escritorio-lista-expediente-fila', { full: true });
  // Móvil
  await s.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await s.ir('/contratos/index.html', { esperar: 1500 });
  await s.captura('66-admin-telefono-lista-contratos');
  console.log('geometría móvil:', await s.geometria());
} finally { await s.cerrar(); }

// ── Lista: vendedora y contabilidad ──
for (const [rol, nombre] of [['vendedor', 'vendedor'], ['contabilidad', 'contabilidad'], ['recepcion', 'recepcion']]) {
  s = await blindar(await abrir({ email: USUARIOS[rol], viewport: 'escritorio', carpeta: 'contratos' }));
  try {
    const r = await s.ir('/contratos/index.html', { esperar: 1500 });
    console.log(`lista ${nombre}`, r.msTotal, 'ms →', r.url, '·', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '),
      '· columnas:', (await s.page.evaluate(() => [...document.querySelectorAll('#encabezadoContratos th')].map(t => t.textContent.trim()).filter(Boolean))).join(','));
    await s.captura(`67-${nombre}-escritorio-lista-contratos`);
    if (rol === 'vendedor') {
      // ¿Ve el contrato de prueba (creado por ella)? ¿Y uno de su cartera creado por otro?
      await s.page.type('#filtroCliente', contratoNum); await s.page.keyboard.press('Enter'); await s.quieto(1500);
      console.log('vendedora busca su contrato →', (await texto(s, '#resumenContratos')).replace(/\n/g, ' '));
    }
  } finally { await s.cerrar(); }
}

// ── Documento v2 (contrato de prueba, firmado digital) y clásico ──
s = await blindar(await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'contratos' }));
try {
  const r = await s.ir(`/contratos/documento.html?id=${encodeURIComponent(contratoId)}`, { esperar: 2000 });
  console.log('documento v2', r.msTotal, 'ms');
  await s.captura('70-admin-escritorio-documento-v2-pantalla', { full: true });
  console.log('aviso estado:', await texto(s, '#avisoEstado'));
  console.log('partes:', (await texto(s, '#sPartes')).slice(0, 300));
  console.log('firmas cliente:', (await s.page.evaluate(() => [...document.querySelectorAll('[data-firma="cliente"]')].map(e => e.innerText.replace(/\n/g, ' ')))).slice(0, 2));
  console.log('firmas empresa:', (await s.page.evaluate(() => [...document.querySelectorAll('[data-firma="empresa"]')].map(e => e.innerText.replace(/\n/g, ' ')))).slice(0, 1));
  console.log('verificación:', (await texto(s, '#verifBox')).replace(/\n/g, ' | '));
  console.log('anexo A:', (await texto(s, '#tAnexoA')).replace(/\n/g, ' | ').slice(0, 400));
  await s.page.emulateMediaType('print');
  await s.captura('71-admin-escritorio-documento-v2-impresion', { full: true });
  await s.page.emulateMediaType('screen');
  const hojas = await s.page.evaluate(() => document.querySelectorAll('.hoja').length); console.log('hojas:', hojas);

  if (clasicoId) {
    const r2 = await s.ir(`/contratos/imprimir-contrato.html?id=${encodeURIComponent(clasicoId)}`, { esperar: 2000 });
    console.log('imprimir clásico', r2.msTotal, 'ms');
    await s.captura('72-admin-escritorio-imprimir-clasico-pantalla', { full: true });
    console.log('rep clásico:', await texto(s, '#nombreRepresentante'), '/', await texto(s, '#labelRepresentanteDoc'), await texto(s, '#rucRepresentante'));
    console.log('firma cecom:', (await texto(s, '#firmaCecomunica')).replace(/\n/g, ' | ').slice(0, 200));
    await s.page.emulateMediaType('print');
    await s.captura('73-admin-escritorio-imprimir-clasico-impresion', { full: true });
    await s.page.emulateMediaType('screen');
  }
  if (pasaporteId) {
    await s.ir(`/contratos/documento.html?id=${encodeURIComponent(pasaporteId)}`, { esperar: 2000 });
    console.log('pasaporte · partes:', (await texto(s, '#sPartes')).slice(0, 300));
    await s.captura('74-admin-escritorio-documento-representante-pasaporte', { el: '#sPartes' });
  }
  if (noCoincideId) {
    await s.ir(`/contratos/documento.html?id=${encodeURIComponent(noCoincideId)}`, { esperar: 2000 });
    console.log('firmante≠rep · partes:', (await texto(s, '#sPartes')).slice(0, 200));
    console.log('firmante≠rep · sello cliente:', (await s.page.evaluate(() => document.querySelector('[data-firma="cliente"]')?.innerText || '')).replace(/\n/g, ' '));
    await s.captura('75-admin-escritorio-documento-firmante-distinto', { full: true });
  }
} finally { await s.cerrar(); }

// ── Verificación pública /c/<id>?v= (teléfono, como quien escanea el QR) ──
s = await blindar(await abrir({ email: USUARIOS.recepcion, viewport: 'telefono', carpeta: 'contratos' }));
try {
  const casos = [
    ['activo', activoId, codActivo, '80-publico-telefono-verify-activo'],
    ['anulado-viejo', anuladoId, codAnulado, '81-publico-telefono-verify-anulado-viejo'],
    ['vencido-por-fecha', vencidoId, codVencido, '82-publico-telefono-verify-vencido-por-fecha'],
    ['codigo-malo', activoId, 'XXXX', '83-publico-telefono-verify-codigo-incorrecto'],
    ['prueba-anulado-hoy', leerEstado().c2 || '', leerEstado().codC2 || '', '84-publico-telefono-verify-anulado-hoy'],
  ];
  for (const [nombre, id, cod, cap] of casos) {
    if (!id) continue;
    const r = await s.ir(`/c/${encodeURIComponent(id)}?v=${encodeURIComponent(cod)}`, { esperar: 1500 });
    console.log(`verify ${nombre} (${r.msTotal} ms):`, (await texto(s, '#resultado')).replace(/\n/g, ' | ').slice(0, 300));
    await s.captura(cap);
  }
  // Enlace viejo verificar-contrato.html?id=&v=
  const r = await s.ir(`/verificar-contrato.html?id=${encodeURIComponent(activoId)}&v=${codActivo}`, { esperar: 1500 });
  console.log('verificar-contrato.html →', r.url);
} finally { await s.cerrar(); }

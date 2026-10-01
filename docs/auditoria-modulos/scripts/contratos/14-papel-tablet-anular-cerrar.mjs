// Auditoría CONTRATOS · Paso E: firma en PAPEL (subir el firmado desde el
// Centro: se captura el modal de confirmación y se cancela — Storage no está
// emulado), la tablet de recepción (/firmar/tablet.html: qué tipos acepta),
// ANULAR (modal con motivo y sustitución/terminación, sobre un segundo
// contrato de prueba) y CERRAR un temporal (modal, sin confirmar).
// Uso: node 14-papel-tablet-anular-cerrar.mjs <contratoPrueba2Id> <clienteTempId> <contratoTempId>
import { abrir, USUARIOS, blindar, contador, clicTexto, leerEstado, espera, texto } from './_lib.mjs';
const { clienteId, contratoId } = leerEstado();
const [c2, clienteTemp, contratoTemp] = process.argv.slice(2);

// ── Vendedora sube el firmado en papel (contrato 2, aprobado y con seriales) ──
let s = await blindar(await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'contratos' }));
const k = contador('vendedora sube el firmado (papel)');
try {
  await s.ir(`/clientes/centro.html?id=${encodeURIComponent(clienteId)}&contrato=${encodeURIComponent(c2)}`);
  await s.page.evaluate(() => window.Centro?.abrirBloque?.('blkGestiones')); await s.quieto(600);
  await s.page.evaluate((id) => window.Centro.abrirGestion('ct-' + id), c2); await s.quieto(1000);
  await s.page.evaluate((id) => document.querySelector(`#grow-ct-${id} .cg-masbtn`)?.click(), c2); await s.quieto(600);
  k.paso('abrir el trámite y el menú ⋯', 2);
  await s.captura('50-vendedor-escritorio-menu-acciones-por-firmar');
  const menu = await texto(s, '.cg-menu:not(.hidden)'); console.log('menú ⋯ (aprobado + seriales):', menu.replace(/\n/g, ' | ').slice(0, 700));
  // "Documento completo" abre el papel para imprimir: se cuenta como parte del camino de papel.
  k.paso('clic "Documento completo" → Imprimir/PDF → imprimir → firma en papel → escanear o fotografiar', 4);
  // Subir el firmado: input file dentro del menú. Se simula la selección con un
  // File de prueba (PDF) y se llama al mismo handler que dispara el onchange.
  await s.page.evaluate((id) => {
    const f = new File(['%PDF-1.1 prueba auditoria'], 'contrato-firmado-PRUEBA-AUDIT-contratos.pdf', { type: 'application/pdf' });
    window.Centro._cerrarAcciones?.();
    window.Centro.subirFirmadoContrato(id, [f]);
  }, c2);
  await s.quieto(1000); k.paso('clic "Subir el contrato firmado" y elegir el archivo', 2);
  await s.captura('51-vendedor-escritorio-confirmar-subir-firmado-activa');
  console.log('confirmación:', (await texto(s, '.modal-backdrop.open')).replace(/\n/g, ' | ').slice(0, 500));
  // Cancelar: la subida iría a Storage de producción.
  await clicTexto(s, 'Cancelar', { dentro: '.modal-backdrop.open' }).catch(async () => { await s.page.keyboard.press('Escape'); });
  k.paso('clic "Subir y activar" (no ejecutado: Storage no emulado)');
  console.log('\n' + k.tabla());
  console.log('bloqueadas (prod):', await s.bloqueadas());
} finally { await s.cerrar(); }

// ── Tablet de recepción ──
s = await blindar(await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'contratos' }));
try {
  const r = await s.ir('/firmar/tablet.html', { esperar: 2000 });
  console.log('tablet', r.msTotal, 'ms ·', (await texto(s, 'body')).replace(/\n/g, ' | ').slice(0, 200));
  await s.captura('52-recepcion-tablet-firmar-tablet-espera');
  // Órdenes → una orden con contrato: ¿qué ofrece "Entregar" respecto a la firma del contrato? (solo lectura)
} finally { await s.cerrar(); }

// ── Admin anula el contrato 2 y abre "Cerrar" de un temporal ──
s = await blindar(await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'contratos' }));
const ka = contador('admin anula');
try {
  await s.ir(`/clientes/centro.html?id=${encodeURIComponent(clienteId)}&contrato=${encodeURIComponent(c2)}`);
  await s.page.evaluate(() => window.Centro?.abrirBloque?.('blkGestiones')); await s.quieto(600);
  await s.page.evaluate((id) => window.Centro.abrirGestion('ct-' + id), c2); await s.quieto(800);
  await s.page.evaluate((id) => document.querySelector(`#grow-ct-${id} .cg-masbtn`)?.click(), c2); await s.quieto(500);
  ka.paso('abrir el trámite y el menú ⋯', 2);
  await clicTexto(s, 'Anular contrato', { dentro: '.cg-menu:not(.hidden)' }); ka.paso('clic "Anular contrato…"');
  await s.captura('53-admin-escritorio-modal-anular-sustitucion-terminacion');
  console.log('modal anular:', (await texto(s, '#cgModal')).replace(/\n/g, ' | ').slice(0, 700));
  // ¿Se puede sin motivo?
  await s.page.evaluate(() => document.querySelector('#cgModal .btn-danger')?.click()); await s.quieto(500);
  console.log('sin motivo → toasts:', JSON.stringify((await s.toasts()).slice(-1)));
  await s.page.evaluate(() => { const r = document.querySelector('#cgModal input[name="anulTipo"][value="terminacion"]'); if (r) { r.click(); } });
  ka.paso('elegir "Termina el acuerdo — el cliente devuelve los equipos"');
  await s.page.type('#anulMotivo', 'PRUEBA-AUDIT-contratos: anulación de prueba del auditor'); ka.paso('escribir el motivo');
  await s.captura('54-admin-escritorio-modal-anular-terminacion-con-motivo');
  await s.page.evaluate(() => document.querySelector('#cgModal .btn-danger')?.click()); await s.quieto(2500); ka.paso('clic "Anular contrato"');
  console.log('anular → toasts:', JSON.stringify((await s.toasts()).slice(-2)));
  await s.captura('55-admin-escritorio-ficha-tras-anular', { full: true });
  console.log('\n' + ka.tabla());

  // Cerrar un TEMPORAL vivo (solo el modal; no se confirma: no es del auditor).
  if (clienteTemp && contratoTemp) {
    await s.ir(`/clientes/centro.html?id=${encodeURIComponent(clienteTemp)}&contrato=${encodeURIComponent(contratoTemp)}`);
    await s.page.evaluate((id) => window.Centro.cerrarContrato(id), contratoTemp); await s.quieto(1000);
    await s.captura('56-admin-escritorio-modal-cerrar-temporal');
    console.log('modal cerrar temporal:', (await texto(s, '#cgModal')).replace(/\n/g, ' | ').slice(0, 600));
    await s.page.evaluate(() => window.Centro._cerrarModal());
  }
} finally { await s.cerrar(); }

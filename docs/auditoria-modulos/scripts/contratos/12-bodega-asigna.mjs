// Auditoría CONTRATOS · Paso C: bodega (José, rol inventario) asigna los
// seriales. Mide el enlace desde el contrato (contratos/seriales.html →
// rebote a Almacén · Asignar) y el trabajo completo: Tomar del estante →
// selección automática → Listo para programar → verificar la lista (escanear
// cada serial) → confirmar. Uso: node 12-bodega-asigna.mjs
import { abrir, USUARIOS, blindar, contador, clicTexto, leerEstado, guardarEstado, espera } from './_lib.mjs';
const { contratoId, contratoNum } = leerEstado();
const s = await blindar(await abrir({ email: USUARIOS.inventario, viewport: 'escritorio', carpeta: 'contratos' }));
const k = contador('bodega asigna 3 seriales');
try {
  // El enlace del correo viejo / del contrato: seriales.html rebota a Almacén.
  const r1 = await s.ir(`/contratos/seriales.html?id=${encodeURIComponent(contratoId)}`, { esperar: 1500 });
  console.log('seriales.html como inventario →', r1.url, r1.msTotal, 'ms');
  k.paso('clic en el enlace del correo "Asignar seriales" (aterriza en Almacén · Asignar con el contrato abierto)');
  await s.captura('20-inventario-escritorio-almacen-asignar-contrato-abierto', { full: true });
  const cola = await s.texto('#asCola'); console.log('cola:', cola.replace(/\n/g, ' | ').slice(0, 500));
  const trabajo = await s.texto('#asTrabajo'); console.log('trabajo:', trabajo.replace(/\n/g, ' | ').slice(0, 700));
  const enCola = cola.includes(contratoNum);
  console.log('¿el contrato de prueba está en la cola?', enCola, '· ¿abierto?', trabajo.includes(contratoNum));
  if (!trabajo.includes(contratoNum)) {
    // Deep-link explícito por si el rebote no lo abrió.
    await s.ir(`/almacen/index.html?tab=asignar&contrato=${encodeURIComponent(contratoId)}`, { esperar: 1500 });
  }

  const t0 = Date.now();
  await s.page.click('[data-as="tomar"]'); await s.quieto(1200); k.paso('clic "Tomar del estante"');
  await s.captura('21-inventario-escritorio-picker-tomar-del-estante');
  const picker = await s.texto('.modal-backdrop.open'); console.log('picker:', picker.replace(/\n/g, ' | ').slice(0, 400));
  await s.page.click('.modal-backdrop.open [data-sheet-action="auto"]'); await s.quieto(800); k.paso('clic "Selección automática"');
  await s.captura('22-inventario-escritorio-picker-seleccion-automatica');
  await s.page.click('.modal-backdrop.open [data-sheet-action="aplicar"]'); await s.quieto(1200); k.paso('clic "Asignar seleccionados"');
  const seriales = await s.page.evaluate(() => [...document.querySelectorAll('#asBody .serial-input')].map(i => i.value).filter(Boolean));
  console.log('seriales tomados:', seriales);
  await s.captura('23-inventario-escritorio-formulario-con-seriales', { full: true });

  // El toast "Desde el estante: N agregado(s)" tapa el botón primario unos
  // segundos (captura 24): con un clic humano rápido el clic cae en el toast.
  const tapado = await s.page.evaluate(() => { const b = document.querySelector('[data-as="listo"]'); if (!b) return null; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el && !b.contains(el) ? (el.className || el.tagName) : ''; });
  console.log('¿"Listo para programar" tapado al momento?', tapado || 'no');
  await espera(4500);
  await s.page.click('[data-as="listo"]'); await s.quieto(1500); k.paso('clic "Listo para programar"');
  let hoja = await s.texto('.modal-backdrop.open'); console.log('hoja 1:', hoja.replace(/\n/g, ' | ').slice(0, 400));
  await s.captura('24-inventario-escritorio-verificar-lista-escaneo');
  // Pick & confirm: escanear (teclear + Enter) cada serial.
  for (const ser of seriales) {
    await s.page.type('.modal-backdrop.open [data-ver="input"]', ser);
    await s.page.keyboard.press('Enter'); await espera(250);
    k.paso(`escanear ${ser} + Enter`, 2);
  }
  await s.captura('25-inventario-escritorio-lista-verificada');
  await s.page.click('.modal-backdrop.open [data-sheet-action="confirm"]'); await s.quieto(1200); k.paso('clic "Lista verificada"');
  hoja = await s.texto('.modal-backdrop.open'); console.log('hoja 2:', hoja.replace(/\n/g, ' | ').slice(0, 500));
  await s.captura('26-inventario-escritorio-hoja-listo-para-programar');
  await s.page.click('.modal-backdrop.open [data-sheet-action="confirm"]'); await s.quieto(2000); k.paso('clic "Listo para programar" (confirmar)');
  console.log('asignación →', Date.now() - t0, 'ms · toasts:', JSON.stringify((await s.toasts()).slice(-3)));
  await s.captura('27-inventario-escritorio-tras-confirmar', { full: true });
  guardarEstado({ seriales });
  console.log('\n' + k.tabla());
  console.log('errores:', s.errores.filter(e => !/favicon|lucide/i.test(e)).slice(0, 8));
  console.log('bloqueadas (prod):', await s.bloqueadas());
  // Vista en teléfono de la misma pantalla (bodega a veces anda con el celular).
  await s.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await s.ir(`/almacen/index.html?tab=asignar`, { esperar: 1500 });
  await s.captura('28-inventario-telefono-almacen-asignar');
  console.log('geometría teléfono:', await s.geometria());
} finally { await s.cerrar(); }

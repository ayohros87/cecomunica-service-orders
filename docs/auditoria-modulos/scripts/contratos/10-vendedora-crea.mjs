// Auditoría CONTRATOS · Paso A: la vendedora (Karla) crea un contrato nuevo
// con 3 equipos serializables desde el Centro. Cuenta interacciones, mide y
// captura. Uso: node 10-vendedora-crea.mjs <clienteId>
import { abrir, USUARIOS, blindar, contador, clicTexto, guardarEstado, espera } from './_lib.mjs';
const clienteId = process.argv[2];
if (!clienteId) throw new Error('falta clienteId');
const MODELOS = [
  { id: 'x7hlVuYhyf22JhzR4hqz', precio: 25 },   // PNC360S-R
  { id: '68N7zR5APzO3xIaJCZCU', precio: 30 },   // NX-420-R
  { id: 'yMwl4ybr4hvJQGeqRw2z', precio: 22 },   // BD506U-R
];
const s = await blindar(await abrir({ email: USUARIOS.vendedor, viewport: 'escritorio', carpeta: 'contratos' }));
const k = contador('vendedora crea contrato');
try {
  // Home: la señal "Mis contratos por firmar" de la vendedora.
  const home = await s.ir('/index.html');
  const firv = await s.page.evaluate(() => document.querySelector('[data-signal-val="FIRV"]')?.textContent?.trim() || '(sin señal)');
  console.log('home vendedora', home.msTotal, 'ms · FIRV =', firv);
  await s.captura('01-vendedor-escritorio-home-senales');

  const c = await s.ir(`/clientes/centro.html?id=${encodeURIComponent(clienteId)}`);
  console.log('centro ficha', c.msTotal, 'ms, primeraFs', c.primeraFs, 'fsReqs', c.fsReqs);
  k.paso('Home → Centro (rail) y abrir la ficha del cliente (buscar + clic)', 2);
  await s.captura('02-vendedor-escritorio-ficha-cliente-vacia');

  await clicTexto(s, 'Nueva gestión'); k.paso('clic "Nueva gestión"');
  await s.captura('03-vendedor-escritorio-menu-nueva-gestion', { el: '#cgMenu' }).catch(() => {});
  const menuTxt = await s.texto('#cgMenu');
  console.log('menú:', menuTxt.replace(/\n/g, ' | ').slice(0, 400));
  await clicTexto(s, 'Nuevo contrato', { dentro: '#cgMenu' }); k.paso('clic "Nuevo contrato"');
  await espera(600);
  await s.captura('04-vendedor-escritorio-wizard-contrato-vacio', { full: true });
  const g0 = await s.geometria(); console.log('geometría wizard', g0);

  // Paso 3 del wizard: 3 líneas modelo · cantidad · precio · modalidad.
  for (let i = 0; i < MODELOS.length; i++) {
    if (i > 0) { await clicTexto(s, 'Agregar otro modelo', { dentro: '#cgModal' }); k.paso('clic "+ Agregar otro modelo"'); }
    const ok = await s.page.evaluate((i, m) => {
      const sels = document.querySelectorAll('select[data-wcm-modelo]');
      const cants = document.querySelectorAll('input[data-wcm-cant]');
      const precios = document.querySelectorAll('input[data-wcm-precio]');
      const mods = document.querySelectorAll('select[data-wcm-modalidad]');
      const sel = sels[i]; if (!sel) return 'sin select ' + i;
      if (![...sel.options].some(o => o.value === m.id)) return 'modelo no está en la lista: ' + m.id;
      sel.value = m.id; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true }));
      cants[i].value = '1'; cants[i].dispatchEvent(new Event('input', { bubbles: true }));
      precios[i].value = String(m.precio); precios[i].dispatchEvent(new Event('input', { bubbles: true }));
      mods[i].value = 'alquiler'; mods[i].dispatchEvent(new Event('change', { bubbles: true })); mods[i].dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    }, i, MODELOS[i]);
    if (ok !== 'ok') throw new Error(ok);
    k.paso(`línea ${i + 1}: modelo (select) · cantidad · precio · "¿De quién es?"`, 4);
  }
  await s.page.evaluate(() => { const o = document.getElementById('wcObs'); o.value = 'PRUEBA-AUDIT-contratos · contrato del recorrido del auditor'; o.dispatchEvent(new Event('input', { bubbles: true })); });
  k.paso('observaciones (opcional, aquí por el prefijo de prueba)');
  await s.quieto(600);
  await s.captura('05-vendedor-escritorio-wizard-3-lineas', { full: true });
  const totTxt = await s.texto('#wcTot'); console.log('tarifario:', totTxt.replace(/\n/g, ' | '));
  const repTxt = await s.texto('#cgModal .cg-paso:last-of-type').catch(() => ''); console.log('representante:', repTxt.replace(/\n/g, ' | ').slice(0, 300));

  // ¿Qué pasa si guardo sin validar al representante?
  const btnDis = await s.page.evaluate(() => document.getElementById('wcGuardar')?.disabled);
  console.log('Guardar deshabilitado sin validar representante:', btnDis);
  await s.page.click('#wcRepValidado'); k.paso('marcar "Validé con el cliente que X sigue siendo el representante"');
  await s.quieto(300);

  const t0 = Date.now();
  await s.clic('#wcGuardar', { esperar: 1500 }); k.paso('clic "Guardar contrato"');
  const ms = Date.now() - t0;
  const toasts = await s.toasts();
  console.log('guardar →', ms, 'ms · toasts:', JSON.stringify(toasts.slice(-3)));
  await s.captura('06-vendedor-escritorio-ficha-tras-guardar', { full: true });
  const nuevo = await s.page.evaluate(() => (window.Centro?.contratos || []).find(c => String(c.observaciones || '').includes('PRUEBA-AUDIT-contratos')));
  console.log('contrato creado:', nuevo?.id, nuevo?.contrato_id, nuevo?.estado, 'total', nuevo?.total_con_itbms);
  if (!nuevo) throw new Error('no apareció el contrato en Centro.contratos');
  guardarEstado({ clienteId, contratoId: nuevo.id, contratoNum: nuevo.contrato_id });
  // Abrir el trámite para ver la línea de tiempo del vendedor.
  await s.page.evaluate((id) => window.Centro.abrirGestion('ct-' + id), nuevo.id); await s.quieto(1000);
  await s.captura('07-vendedor-escritorio-tramite-linea-de-tiempo', { full: true });
  console.log('tramite:', (await s.texto(`#grow-ct-${nuevo.id}`)).replace(/\n/g, ' | '));
  const exp = await s.page.evaluate((id) => document.getElementById('grow-ct-' + id)?.nextElementSibling?.innerText || '', nuevo.id);
  console.log('expediente:', exp.replace(/\n/g, ' | ').slice(0, 900));
  console.log('\n' + k.tabla());
  console.log('errores:', s.errores.filter(e => !/favicon|lucide/i.test(e)).slice(0, 8));
  console.log('bloqueadas (prod):', await s.bloqueadas());
} finally { await s.cerrar(); }

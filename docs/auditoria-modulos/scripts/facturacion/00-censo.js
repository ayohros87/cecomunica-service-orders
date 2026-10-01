// Censo de datos del módulo Facturación en el EMULADOR (solo lectura, sin montos).
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/00-censo.js
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const cnt = (o, k) => { o[k] = (o[k] || 0) + 1; };
(async () => {
  // Avisos
  const av = await db.collection('facturacion_avisos').get();
  const porEstado = {}, porTipo = {}, comEstado = {}, qboSinNumero = { hecho: 0, sinNumero: 0 }, pasosAplican = {};
  av.forEach(d => { const x = d.data(); cnt(porEstado, x.estado); cnt(porTipo, x.tipo);
    if (x.comision) cnt(comEstado, x.comision.estado);
    const q = x.pasos?.qbo; if (q?.hecho) { qboSinNumero.hecho++; if (!q.factura) qboSinNumero.sinNumero++; }
    cnt(pasosAplican, `qbo:${!!x.pasos?.qbo?.aplica}/poc:${!!x.pasos?.poc?.aplica}`);
  });
  console.log('facturacion_avisos', av.size, { porEstado, porTipo, comEstado, qboSinNumero, pasosAplican });
  // Clientes
  const cl = await db.collection('clientes').get();
  let vivos = 0, conRuc = 0, conQbo = 0, conQboYRuc = 0, activos = 0, activosSinQbo = 0;
  cl.forEach(d => { const x = d.data(); if (x.deleted === true) return; vivos++;
    if (x.ruc || x.cedula) conRuc++; if (x.qbo_customer_id) { conQbo++; if (x.ruc) conQboYRuc++; }
    if (x.activo === true) { activos++; if (!x.qbo_customer_id) activosSinQbo++; } });
  console.log('clientes', { vivos, conRuc, conQbo, conQboYRuc, activos, activosSinQbo });
  // Contratos por estado de facturación
  const ct = await db.collection('contratos').get();
  const fEstado = {}, estados = {}; let facturableFalse = 0, entregaConf = 0, activosAprobados = 0, clientesConContratoVivo = new Set(), clientesVivosSinQbo = new Set();
  const cliMap = {}; cl.forEach(d => cliMap[d.id] = d.data());
  ct.forEach(d => { const x = d.data(); cnt(estados, x.estado);
    if (['activo', 'aprobado'].includes(x.estado)) { activosAprobados++; cnt(fEstado, x.facturacion_estado || '(sin)'); if (x.facturable === false) facturableFalse++; if (x.entrega_confirmada) entregaConf++;
      if (x.cliente_id) { clientesConContratoVivo.add(x.cliente_id); if (!cliMap[x.cliente_id]?.qbo_customer_id) clientesVivosSinQbo.add(x.cliente_id); } } });
  console.log('contratos', ct.size, { estados, activosAprobados, fEstado, facturableFalse, entregaConf, clientesConContratoVivo: clientesConContratoVivo.size, clientesVivosSinQbo: clientesVivosSinQbo.size });
  // Modelos con mapeo
  const mo = await db.collection('modelos').get();
  let mapeados = 0, conPrecio = 0;
  mo.forEach(d => { const x = d.data(); if (Number(x.precio_alquiler) > 0) conPrecio++; if (Number(x.precio_alquiler) > 0 && x.qbo_item_alquiler_id && x.qbo_bundle_id) mapeados++; });
  console.log('modelos', mo.size, { conPrecio, mapeados });
  const cg = await db.collection('cargos').get();
  console.log('cargos', cg.size, cg.docs.map(d => ({ concepto: d.data().concepto, qbo: !!d.data().qbo_item_id, rec: !!d.data().recurrente, activo: d.data().activo !== false })));
  const cfg = await db.collection('empresa').doc('facturacion_config').get();
  console.log('facturacion_config', cfg.exists ? cfg.data() : null);
  const us = await db.collection('usuarios').get();
  const roles = {}; us.forEach(d => cnt(roles, d.data().rol));
  console.log('usuarios por rol', roles);
  // uso_diario del módulo
  const ud = await db.collection('uso_diario').get();
  const uso = {}; ud.forEach(d => { const x = d.data(); Object.entries(x.paginas || x || {}).forEach(([k, v]) => { if (/factur|comision|qbo|cargos|financiero/.test(k)) uso[k] = (uso[k] || 0) + (typeof v === 'number' ? v : (v?.n || 0)); }); });
  console.log('uso_diario (facturación)', ud.size, uso);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

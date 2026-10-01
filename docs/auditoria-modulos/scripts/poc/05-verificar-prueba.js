// Verifica en el EMULADOR qué dejó el recorrido sobre los datos PRUEBA-AUDIT-poc
// (SIM repetido, pool, cierre, lote de ventas, consola, correo). Solo lectura.
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/poc/05-verificar-prueba.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const dev = await db.collection('poc_devices').where('cliente_id', '==', 'PRUEBA-AUDIT-poc-cliente').get();
  console.log(`fichas del cliente de prueba: ${dev.size}`);
  dev.docs.forEach(d => { const v = d.data(); console.log(`  ${d.id} | ${v.serial} | unit ${v.unit_id} | SIM ${v.sim_number || '-'} / ${v.sim_phone || '-'} / ${v.operador || '-'} | activo ${v.activo} | deleted ${v.deleted} | modelo ${v.modelo_label || v.modelo || '-'} (id ${v.modelo_id || '-'}) | grupos ${(v.grupos || []).join(',')} | contrato ${v.contrato_id || '-'} | creado_por ${v.creado_por_email || '-'}`); });
  const sims = await db.collection('sim_cards').where('sim_number', '>=', '8950799900000000000').where('sim_number', '<', '8950799900000000099').get();
  console.log(`\nsim_cards de prueba: ${sims.size}`);
  sims.docs.forEach(d => { const v = d.data(); console.log(`  ${d.id} | ${v.estado} | asignado_a ${v.asignado_a ? v.asignado_a.serial : '-'} | origen ${v.origen} | liberado_de ${v.liberado_de ? v.liberado_de.serial : '-'}`); });
  const lotes = await db.collection('poc_lotes_preparados').get();
  console.log(`\npoc_lotes_preparados: ${lotes.size}`);
  lotes.docs.forEach(d => { const v = d.data(); console.log(`  ${d.id} | #${v.codigo} | ${v.cliente_nombre} | ${v.total} filas | ${v.estado} | por ${v.creado_por_email} | cargado_por ${v.cargado_por?.email || '-'} | batch_ref ${(v.batch_ref || []).length}`); });
  const mail = await db.collection('mail_queue').orderBy('created_at', 'desc').limit(5).get().catch(() => db.collection('mail_queue').limit(5).get());
  console.log(`\nmail_queue (últimos): ${mail.size}`);
  mail.docs.forEach(d => { const v = d.data(); console.log(`  ${d.id} | to ${v.to} | cc ${JSON.stringify(v.cc || '')} | ${v.subject} | meta ${JSON.stringify(v.meta || {}).slice(0, 80)}`); });
  const ids = dev.docs.map(d => d.id);
  let n = 0; const tipos = {};
  for (let i = 0; i < ids.length; i += 10) {
    const logs = await db.collection('poc_logs').where('equipo_id', 'in', ids.slice(i, i + 10)).get();
    logs.docs.forEach(d => { n++; const v = d.data(); const k = v.accion || ('edicion por ' + (v.usuario || '?')); tipos[k] = (tipos[k] || 0) + 1; });
  }
  console.log(`\npoc_logs de las fichas de prueba: ${n}`, tipos);
  const pool = await db.collection('equipos_pool').where('serial_norm', '>=', 'PRUEBAAUDIT').where('serial_norm', '<', 'PRUEBAAUDIU').get();
  console.log(`\nequipos_pool con serial PRUEBA-AUDIT: ${pool.size} (el trigger onPocDeviceWritePool no corre en el emulador de functions apagado)`);
})().catch(e => { console.error(e); process.exit(1); });

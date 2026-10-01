// Datos de muestra del emulador para el recorrido de home/navegación (solo lectura).
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/home-nav/00-muestra.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const out = {};
  // Cliente con RUC y con contratos
  const cl = await db.collection('clientes').where('deleted', '==', false).orderBy('updated_at', 'desc').limit(60).get().catch(() => db.collection('clientes').limit(60).get());
  out.clientes = cl.docs.filter(d => d.data().ruc && d.data().nombre).slice(0, 4).map(d => ({ id: d.id, nombre: d.data().nombre, ruc: d.data().ruc, tokens: (d.data().searchTokens || []).length }));
  // Orden reciente con cliente_id y equipos
  const os = await db.collection('ordenes_de_servicio').orderBy('fecha_creacion', 'desc').limit(40).get();
  out.ordenes = os.docs.filter(d => !d.data().eliminado && d.data().cliente_id && (d.data().equipos || []).length).slice(0, 3).map(d => { const o = d.data(); return { id: d.id, numero: o.numero_orden, cliente: o.cliente_nombre, cliente_id: o.cliente_id, estado: o.estado_reparacion, serial0: (o.equipos[0] || {}).serial, tokens: (o.searchTokens || []).length }; });
  // Orden vieja (no en las 40 recientes)
  const osv = await db.collection('ordenes_de_servicio').orderBy('fecha_creacion', 'desc').offset(300).limit(3).get();
  out.ordenes_viejas = osv.docs.map(d => ({ id: d.id, numero: d.data().numero_orden, cliente: d.data().cliente_nombre, tokens: (d.data().searchTokens || []).length }));
  // Contrato con seriales
  const ct = await db.collection('contratos').where('estado', 'in', ['activo', 'aprobado']).limit(80).get();
  out.contratos = ct.docs.filter(d => d.data().cliente_id && d.data().contrato_id).slice(0, 3).map(d => { const c = d.data(); return { doc: d.id, contrato_id: c.contrato_id, cliente: c.cliente_nombre, cliente_id: c.cliente_id, estado: c.estado, tokens: (c.searchTokens || []).length }; });
  // Serial del pool con cliente
  const pool = await db.collection('equipos_pool').where('estado', '==', 'asignado_cliente').limit(5).get().catch(() => ({ docs: [] }));
  out.pool = pool.docs.slice(0, 3).map(d => ({ id: d.id, serial: d.data().serial, modelo: d.data().modelo || d.data().modelo_nombre, estado: d.data().estado, cliente: d.data().cliente_nombre }));
  const poolAny = await db.collection('equipos_pool').limit(3).get();
  out.pool_any = poolAny.docs.map(d => ({ id: d.id, serial: d.data().serial, estado: d.data().estado }));
  // PoC reciente y viejo
  const poc = await db.collection('poc_devices').orderBy('created_at', 'desc').limit(3).get();
  out.poc_recientes = poc.docs.map(d => ({ id: d.id, serial: d.data().serial, unit: d.data().unit_id, cliente: d.data().cliente }));
  const pocv = await db.collection('poc_devices').orderBy('created_at', 'desc').offset(2000).limit(3).get();
  out.poc_viejos = pocv.docs.map(d => ({ id: d.id, serial: d.data().serial, unit: d.data().unit_id, cliente: d.data().cliente }));
  // Cotización reciente y vieja
  const cot = await db.collection('cotizaciones').orderBy('fecha_creacion', 'desc').limit(3).get();
  out.cotizaciones = cot.docs.map(d => ({ id: d.id, cot_id: d.data().cotizacion_id || d.data().numero, cliente: d.data().cliente_nombre, estado: d.data().estado }));
  const cotv = await db.collection('cotizaciones').orderBy('fecha_creacion', 'desc').offset(600).limit(2).get();
  out.cotizaciones_viejas = cotv.docs.map(d => ({ id: d.id, cot_id: d.data().cotizacion_id || d.data().numero, cliente: d.data().cliente_nombre }));
  // Totales
  for (const c of ['clientes', 'ordenes_de_servicio', 'contratos', 'cotizaciones', 'poc_devices', 'equipos_pool', 'usuarios', 'uso_diario', 'gestiones']) {
    out['total_' + c] = (await db.collection(c).count().get()).data().count;
  }
  const uso = await db.collection('uso_diario').get();
  out.uso_diario_docs = uso.docs.map(d => d.id);
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });

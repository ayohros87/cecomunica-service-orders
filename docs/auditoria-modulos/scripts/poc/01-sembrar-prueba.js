// Siembra en el EMULADOR un cliente y 4 fichas PoC de prueba (prefijo
// PRUEBA-AUDIT-poc) para recorrer cambio de SIM, edición masiva, cierre y
// lote sin tocar fichas reales. Idempotente: si ya existen, las deja.
// Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/poc/01-sembrar-prueba.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const TS = admin.firestore.FieldValue.serverTimestamp();
const CLIENTE_ID = 'PRUEBA-AUDIT-poc-cliente';
const NOMBRE = 'PRUEBA-AUDIT-poc CLIENTE';

(async () => {
  const cref = db.collection('clientes').doc(CLIENTE_ID);
  if (!(await cref.get()).exists) {
    await cref.set({ nombre: NOMBRE, activo: true, deleted: false, ip: 'poc.cecomunica.net', poc_grupos: ['PRUEBA-AUDIT Grupo A', 'PRUEBA-AUDIT Grupo B'], fecha_creacion: new Date(), created_at: TS, updated_at: TS });
    console.log('cliente creado', CLIENTE_ID);
  }
  const fichas = [
    { serial: 'PRUEBA-AUDIT-poc-001', unit_id: '990001', radio_name: 'PRUEBA-AUDIT RADIO 1', sim_number: '8950799900000000001', sim_phone: '6000-0001', operador: 'TIGO', activo: true },
    { serial: 'PRUEBA-AUDIT-poc-002', unit_id: '990002', radio_name: 'PRUEBA-AUDIT RADIO 2', sim_number: '8950799900000000002', sim_phone: '6000-0002', operador: 'TIGO', activo: true },
    { serial: 'PRUEBA-AUDIT-poc-003', unit_id: '990003', radio_name: 'PRUEBA-AUDIT RADIO 3', sim_number: '8950799900000000003', sim_phone: '6000-0003', operador: 'MAS MOVIL', activo: true },
    { serial: 'PRUEBA-AUDIT-poc-004', unit_id: '990004', radio_name: 'PRUEBA-AUDIT RADIO 4', sim_number: '', sim_phone: '', operador: '', activo: true },
  ];
  for (const f of fichas) {
    const ya = await db.collection('poc_devices').where('serial', '==', f.serial).limit(1).get();
    if (!ya.empty) { console.log('ya existe', f.serial, ya.docs[0].id); continue; }
    const ref = await db.collection('poc_devices').add({
      cliente_id: CLIENTE_ID, cliente_nombre: NOMBRE, cliente: NOMBRE,
      contrato_doc_id: null, contrato_id: null, ip: 'poc.cecomunica.net',
      ...f, unit_id_num: parseInt(f.unit_id, 10), gps: false,
      modelo: 'HYTERA PNC360S-R', modelo_id: '', modelo_label: 'HYTERA PNC360S-R',
      grupos: ['PRUEBA-AUDIT Grupo A'], notas: 'PRUEBA-AUDIT-poc (auditoría de módulos 2026-09-30)',
      activo: f.activo, deleted: false, creado_por_uid: 'audit', creado_por_email: 'audit@prueba',
      created_at: TS, updated_at: TS,
    });
    console.log('ficha creada', f.serial, ref.id);
  }
  // Un SIM disponible en el pool para el flujo "Asignar del pool"
  for (const sim of ['8950799900000000010', '8950799900000000011']) {
    const sref = db.collection('sim_cards').doc(sim);
    if (!(await sref.get()).exists) {
      await sref.set({ sim_number: sim, sim_phone: '6000-00' + sim.slice(-2), operador: 'TIGO', estado: 'disponible', origen: 'manual', asignado_a: null, liberado_de: null, created_at: TS, updated_at: TS, creado_por_email: 'PRUEBA-AUDIT-poc' });
      console.log('sim pool creado', sim);
    }
  }
  console.log('listo');
})().catch(e => { console.error(e); process.exit(1); });

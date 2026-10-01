// Auditoría CONTRATOS · siembra del cliente de prueba (SOLO emulador).
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/contratos/01-seed.js
// Crea (idempotente) el cliente "PRUEBA-AUDIT-contratos CLIENTE, S.A." con
// representante, cédula, correo y vendedor asignado = Karla (USUARIOS.vendedor).
// No toca ningún documento que no sea de la auditoría.
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
// Sufijo opcional (node 01-seed.js 2) para un segundo cliente limpio: la ficha
// de un cliente CON contrato vigente ya no ofrece "Nuevo contrato" (corrida 2).
const SUF = process.argv[2] ? `-${process.argv[2]}` : '';
const NOMBRE = `PRUEBA-AUDIT-contratos CLIENTE${SUF ? ' ' + process.argv[2] : ''}, S.A.`;
(async () => {
  const karla = (await db.collection('usuarios').where('email', '==', 'karla.ferrer@cecomunica.com').get()).docs[0];
  if (!karla) throw new Error('no está Karla en usuarios');
  const ya = await db.collection('clientes').where('nombre', '==', NOMBRE).get();
  let ref;
  if (!ya.empty) { ref = ya.docs[0].ref; console.log('ya existía', ref.id); }
  else {
    ref = db.collection('clientes').doc('PRUEBA-AUDIT-contratos-cliente' + SUF);
    await ref.set({
      nombre: NOMBRE, nombre_lower: NOMBRE.toLowerCase(), nombre_norm: `PRUEBA AUDIT CONTRATOS CLIENTE${SUF ? ' ' + process.argv[2] : ''} S A`,
      ruc: '155699999-2-2026', dv: '55', ruc_tipo: 'juridica', rucdv_norm: '155699999-2-2026 DV 55',
      representante: 'MARIA PRUEBA AUDITORIA', representante_cedula: '8-999-9999', representante_doc_tipo: 'cedula',
      email: 'prueba-audit-contratos@example.invalid', representante_email: 'prueba-audit-contratos@example.invalid',
      telefono: '000-0000', direccion: 'Dirección de prueba (auditoría de módulos 2026-09-30)',
      vendedor_asignado: karla.id, vendedor_email: 'karla.ferrer@cecomunica.com',
      activo: true, deleted: false, tags: ['PRUEBA-AUDIT-contratos'],
      itbms_exento: false,
      creado_en: admin.firestore.FieldValue.serverTimestamp(), creado_por_uid: 'auditoria',
      observaciones: 'PRUEBA-AUDIT-contratos — cliente de prueba del auditor; borrar al terminar',
    });
    console.log('creado', ref.id);
  }
  console.log(JSON.stringify({ clienteId: ref.id, karlaUid: karla.id }));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

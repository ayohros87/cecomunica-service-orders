// Deja las fichas PRUEBA-AUDIT-almacen como al sembrar (para repetir el
// recorrido 02 en otro viewport). Borra lo que el recorrido creó
// (AUDALM0102 por corrección de serial, AUDALM0009/0010 por Recibir).
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/almacen/00b-reset-prueba.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Solo contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const PREF = 'PRUEBA-AUDIT-almacen';
const MODELO = { id: 'x7hlVuYhyf22JhzR4hqz', label: 'HYTERA PNC360S-R' };
const UID = '6sijx2j21GVgRy99Fku7aFkXDiN2', EMAIL = 'jose.solis@cecomunica.com';
(async () => {
  const now = TS.now();
  const ficha = (serial, extra = {}) => ({
    serial, serial_norm: serial, serial_compartido: false,
    modelo_id: MODELO.id, modelo_label: MODELO.label, condicion: 'reuso', propiedad: 'cecomunica',
    estado: 'en_bodega', asignacion: null, poc_device_id: null, orden_actual_id: null,
    origen: 'bodega', verificado: true, proveedor: PREF, notas: PREF, baja_motivo: null,
    creado_por_uid: UID, creado_por_email: EMAIL, updated_by: UID, updated_by_email: EMAIL,
    updated_at: now, ingreso_bodega_at: now, created_at: now, ...extra,
  });
  for (const id of ['AUDALM0102', 'AUDALM0009', 'AUDALM0010']) {
    const ref = db.collection('equipos_pool').doc(id);
    const movs = await ref.collection('movimientos').get();
    for (const m of movs.docs) await m.ref.delete();
    await ref.delete();
  }
  const b = db.batch();
  for (let i = 1; i <= 6; i++) b.set(db.collection('equipos_pool').doc(`AUDALM000${i}`), ficha(`AUDALM000${i}`, i === 6 ? { estado: 'por_clasificar', ingreso_bodega_at: null, verificado: false, origen: 'migracion_poc' } : {}));
  b.set(db.collection('equipos_pool').doc('AUDALM0007'), ficha('AUDALM0007', { notas: `DAÑADA — ${PREF}` }));
  b.set(db.collection('equipos_pool').doc('AUDALM0008'), ficha('AUDALM0008', { estado: 'devuelto_revision', ingreso_bodega_at: null,
    asignacion: { cliente_id: PREF, cliente_nombre: `${PREF} CLIENTE`, contrato_id: `${PREF}-00`, contrato_doc_id: `${PREF}-00` } }));
  await b.commit();
  console.log('reset ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

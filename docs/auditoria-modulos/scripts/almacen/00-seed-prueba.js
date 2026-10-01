// Siembra los datos de prueba de la auditoría de Almacén (prefijo
// PRUEBA-AUDIT-almacen) en el EMULADOR. Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/almacen/00-seed-prueba.js
// Crea: 1 contrato aprobado con 25 × PNC360S-R esperando seriales, 8 fichas
// del pool (6 en bodega, 1 marcada DAÑADA, 1 devuelta sin tiquete de taller).
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Solo contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const PREF = 'PRUEBA-AUDIT-almacen';
const MODELO = { id: 'x7hlVuYhyf22JhzR4hqz', label: 'HYTERA PNC360S-R', corto: 'PNC360S-R' };
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
  const b = db.batch();
  for (let i = 1; i <= 6; i++) b.set(db.collection('equipos_pool').doc(`AUDALM000${i}`), ficha(`AUDALM000${i}`));
  b.set(db.collection('equipos_pool').doc('AUDALM0007'), ficha('AUDALM0007', { notas: `DAÑADA — ${PREF}` }));
  b.set(db.collection('equipos_pool').doc('AUDALM0008'), ficha('AUDALM0008', { estado: 'devuelto_revision', ingreso_bodega_at: null,
    asignacion: { cliente_id: PREF, cliente_nombre: `${PREF} CLIENTE`, contrato_id: `${PREF}-00`, contrato_doc_id: `${PREF}-00` } }));
  b.set(db.collection('contratos').doc(`${PREF}-01`), {
    contrato_id: `${PREF}-01`, cliente_id: PREF, cliente_nombre: `${PREF} CLIENTE`, cliente_nombre_lower: `${PREF.toLowerCase()} cliente`,
    codigo_tipo: 'ALQ', tipo_contrato: 'Alquiler', accion: 'Nuevo', duracion: '24 meses',
    equipos: [{ modelo_id: MODELO.id, modelo: MODELO.corto, descripcion: 'Equipos de Comunicación', cantidad: 25, precio: 25 }],
    cargos: [], total_equipos: 25, estado: 'aprobado', seriales_estado: 'pendiente', deleted: false,
    fecha_creacion: now, fecha_aprobacion: now, creado_por_uid: UID, observaciones: `${PREF}: contrato de prueba de la auditoría (25 unidades)`,
    searchTokens: ['prueba', 'audit', 'almacen', `${PREF.toLowerCase()}-01`],
  });
  await b.commit();
  console.log('Sembrado:', `${PREF}-01 (25 × ${MODELO.corto})`, 'AUDALM0001..0008');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

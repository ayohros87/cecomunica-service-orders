// Siembra un segundo contrato de prueba con 50 × PNC360S-R (el brief pide
// medir Asignar con un contrato de 50) y escribe seriales-lector-50.json con
// 50 seriales REALES de ese modelo que están en bodega (para el lector
// simulado y para "Pegar columna"). Solo contra el emulador, desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/almacen/00d-seed-contrato-50.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Solo contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const PREF = 'PRUEBA-AUDIT-almacen';
const MODELO = { id: 'x7hlVuYhyf22JhzR4hqz', label: 'HYTERA PNC360S-R', corto: 'PNC360S-R' };
const UID = '6sijx2j21GVgRy99Fku7aFkXDiN2';
(async () => {
  const now = TS.now();
  const usados = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'seriales-lector.json'), 'utf8')));
  const q = await db.collection('equipos_pool').where('modelo_id', '==', MODELO.id).where('estado', '==', 'en_bodega').get();
  const seriales = q.docs.map(d => d.data()).filter(x => !usados.has(x.serial) && !/PRUEBA-AUDIT|da[ñn]ad/i.test(x.notas || '') && !x.serial_compartido)
    .map(x => x.serial).sort().slice(0, 50);
  if (seriales.length < 50) { console.error('no hay 50 en bodega:', seriales.length); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, 'seriales-lector-50.json'), JSON.stringify(seriales));
  await db.collection('contratos').doc(`${PREF}-02`).set({
    contrato_id: `${PREF}-02`, cliente_id: PREF, cliente_nombre: `${PREF} CLIENTE`, cliente_nombre_lower: `${PREF.toLowerCase()} cliente`,
    codigo_tipo: 'ALQ', tipo_contrato: 'Alquiler', accion: 'Nuevo', duracion: '24 meses',
    equipos: [{ modelo_id: MODELO.id, modelo: MODELO.corto, descripcion: 'Equipos de Comunicación', cantidad: 50, precio: 25 }],
    cargos: [], total_equipos: 50, estado: 'aprobado', seriales_estado: 'pendiente', deleted: false,
    fecha_creacion: now, fecha_aprobacion: now, creado_por_uid: UID, observaciones: `${PREF}: contrato de prueba de la auditoría (50 unidades)`,
    searchTokens: ['prueba', 'audit', 'almacen', `${PREF.toLowerCase()}-02`],
  });
  console.log('Sembrado', `${PREF}-02 (50 × ${MODELO.corto})`, '· seriales-lector-50.json:', seriales.length);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

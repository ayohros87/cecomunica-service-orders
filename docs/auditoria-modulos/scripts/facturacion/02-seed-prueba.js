// Siembra avisos de prueba PRUEBA-AUDIT-facturacion en el EMULADOR (nunca producción).
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/02-seed-prueba.js
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const T = admin.firestore.Timestamp;
const hace = (d) => T.fromDate(new Date(Date.now() - d * 864e5));
const paso = (aplica, extra = {}) => ({ aplica, hecho: false, at: null, por_email: null, ...extra });
const PREF = 'PRUEBA-AUDIT-facturacion';
const base = (n) => ({ cliente_id: `${PREF}-cli-${n}`, vendedor_email: 'karla.ferrer@cecomunica.com', created_at: hace(10), updated_at: hace(10), historial: [], correo: { status: 'sent', sent_at: hace(10), mail_queue_id: 'x' } });
const docs = {
  [`contrato_activo__${PREF}-1`]: { ...base(1), tipo: 'contrato_activo', titulo: 'Contrato activo', efecto: 'arranca', estado: 'pendiente',
    cliente_nombre: `${PREF} Empresa Uno S.A.`, contrato_id: 'ALQ20260920-99', contrato_doc_id: null, fecha_efectiva: hace(10),
    pasos: { qbo: paso(true), poc: paso(true) },
    resumen: { mensual: 120, con_itbms: 128.4, exento: false, equipos: '4 × PNC360S', seriales_total: 4, seriales_count: 4, seriales: ['PA1','PA2','PA3','PA4'] },
    contexto: { activado_por: 'zuleika.diaz', contrato_fecha: '2026-09-15', duracion: '12 meses', entrega_pendiente: false },
    detalle: { lineas: [{ cantidad: 4, modelo: 'PNC360S', precio: 30 }], cargos: [] },
    comision: { aplica: true, estado: 'esperando', motivo: null, vendedor_email: 'karla.ferrer@cecomunica.com', base: 120, base_de: 'mensual', porcentaje: null, monto: null, regla_id: null,
      requisitos: { firma: { aplica: true, hecho: true, at: hace(12), fuente: 'firma_digital', motivo: null }, entrega: { aplica: true, hecho: true, at: hace(10), motivo: null },
        pago: { aplica: true, hecho: false, at: null, factura: null, monto: null, saldo: null, fuente: null, motivo: 'falta confirmar el primer pago (factura en cero)' } },
      periodo: null, liberada_por: null, liberada_at: null, nota: null } },
  [`cotizacion_servicio__${PREF}-2`]: { ...base(2), tipo: 'cotizacion_servicio', titulo: 'Cotización de taller', efecto: 'arranca', estado: 'pendiente',
    cliente_nombre: `${PREF} Taller Dos`, contrato_id: null, orden_id: null, fecha_efectiva: hace(2),
    pasos: { qbo: paso(true, { periodo: false }), poc: paso(false) },
    resumen: { total: 85, itbms: 5.56, exento: false, equipos: '' },
    contexto: { cotizacion_id: 'COT-PRUEBA-2', orden: 'OS-PRUEBA', cotizado_por: 'solangel.hosang@cecomunica.com' },
    detalle: { renglones: [{ cant: 1, nombre: 'Cambio de antena', parte: 'ANT-1', importe: 79.44 }] },
    comision: { aplica: false, estado: 'no_aplica', motivo: 'reparación de taller: el servicio no paga comisión', requisitos: {} } },
  [`renovacion_activa__${PREF}-3`]: { ...base(3), tipo: 'renovacion_activa', titulo: 'Renovación activa', efecto: 'arranca', estado: 'hecho',
    cliente_nombre: `${PREF} Renovación Tres`, contrato_id: 'ALQ20260901-98', fecha_efectiva: hace(20),
    pasos: { qbo: paso(true, { hecho: true, at: hace(15), por_email: 'cecrecep@cecomunica.com', facturar_desde: '2026-09-10', factura: '10999' }), poc: paso(true, { hecho: true, at: hace(15), por_email: 'cecrecep@cecomunica.com' }) },
    resumen: { mensual: 200, con_itbms: 214, exento: false, equipos: '5 × HP606', seriales_total: 5, seriales_count: 5 },
    contexto: {}, detalle: { lineas: [{ cantidad: 5, modelo: 'HP606', precio: 40 }] },
    comision: { aplica: true, estado: 'listo', motivo: null, vendedor_email: 'elvia.onodera@cecomunica.com', base: 200, base_de: 'mensual', porcentaje: null, monto: null, regla_id: null,
      requisitos: { firma: { aplica: true, hecho: true, at: hace(21), fuente: 'firmado_url', motivo: null }, entrega: { aplica: false, hecho: false, at: null, motivo: 'renovación: los equipos ya están en el cliente' },
        pago: { aplica: true, hecho: true, at: hace(14), factura: '10999', monto: 214, saldo: 0, fuente: 'manual', motivo: null } },
      periodo: null, liberada_por: null, liberada_at: null, nota: null } },
  [`contrato_activo__${PREF}-4`]: { ...base(4), tipo: 'contrato_activo', titulo: 'Contrato activo', efecto: 'arranca', estado: 'hecho',
    cliente_nombre: `${PREF} Cuatro Logística`, contrato_id: 'ALQ20260905-97', fecha_efectiva: hace(18),
    pasos: { qbo: paso(true, { hecho: true, at: hace(15), por_email: 'cecrecep@cecomunica.com', facturar_desde: '2026-09-12', factura: null }), poc: paso(true, { hecho: true, at: hace(15), por_email: 'cecrecep@cecomunica.com' }) },
    resumen: { mensual: 60, con_itbms: 64.2, exento: false, equipos: '2 × PNC360S', seriales_total: 2, seriales_count: 1 },
    contexto: {}, detalle: { lineas: [{ cantidad: 2, modelo: 'PNC360S', precio: 30 }] },
    comision: { aplica: true, estado: 'listo', motivo: null, vendedor_email: 'elvia.onodera@cecomunica.com', base: 60, base_de: 'mensual', porcentaje: null, monto: null, regla_id: null,
      requisitos: { firma: { aplica: true, hecho: true, at: hace(19), fuente: 'firma_digital', motivo: null }, entrega: { aplica: true, hecho: true, at: hace(18), motivo: null },
        pago: { aplica: true, hecho: true, at: hace(13), factura: '11001', monto: 64.2, saldo: 0, fuente: 'manual', motivo: null } },
      periodo: null, liberada_por: null, liberada_at: null, nota: null } },
  // Para probar "No aplica…" sin tocar avisos reales.
  [`baja_aprobada__${PREF}-5`]: { ...base(5), tipo: 'baja_aprobada', titulo: 'Baja aprobada', efecto: 'termina', estado: 'pendiente',
    cliente_nombre: `${PREF} Baja Cinco`, contrato_id: 'ALQ20260101-96', gestion_id: `${PREF}-g5`, fecha_efectiva: hace(5),
    pasos: { qbo: paso(true), poc: paso(false) },
    resumen: { delta_mensual: -30, equipos: '1 × PNC360S' },
    contexto: { fecha_fin_texto: '30 sep 2026', terminacion_total: false },
    detalle: { items: [{ serial_saliente: 'PA9', modelo: 'PNC360S', contrato_id: 'ALQ20260101-96' }] },
    comision: { aplica: false, estado: 'no_aplica', motivo: 'una baja no paga comisión', requisitos: {} } },
};
(async () => {
  const b = db.batch();
  for (const [id, d] of Object.entries(docs)) b.set(db.collection('facturacion_avisos').doc(id), d);
  await b.commit();
  console.log('sembrados', Object.keys(docs));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

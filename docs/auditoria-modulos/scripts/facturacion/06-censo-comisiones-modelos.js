// Censo (solo lectura, EMULADOR): quién cerró comisiones, pagos con factura, cotizaciones de taller facturadas, modelos sin mapeo en contratos vivos.
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/06-censo-comisiones-modelos.js
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const cnt = (o, k) => { o[k] = (o[k] || 0) + 1; };
(async () => {
  const av = (await db.collection('facturacion_avisos').get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !a.id.includes('PRUEBA-AUDIT'));
  const pag = av.filter(a => a.comision?.estado === 'pagada').map(a => ({ por: a.comision.liberada_por?.split('@')[0], at: a.comision.liberada_at?.toDate?.().toISOString().slice(0, 10), periodo: a.comision.periodo, pagoFuente: a.comision.requisitos?.pago?.fuente, pagoHecho: a.comision.requisitos?.pago?.hecho, nota: (a.comision.nota || '').slice(0, 40) }));
  console.log('PAGADAS', pag);
  const pagos = {}; av.forEach(a => { const p = a.comision?.requisitos?.pago; if (p?.factura) cnt(pagos, `${p.fuente}|${a.comision.estado}`); }); console.log('pagos con factura', pagos);
  const histCom = {}; av.forEach(a => (a.historial || []).forEach(h => { if (/comision/.test(h.accion || '')) cnt(histCom, `${h.accion}|${(h.por_email || '').split('@')[0]}|${(h.fecha_iso || '').slice(0, 10)}`); })); console.log('historial comision', histCom);
  // usuarios: último acceso por rol
  const us = (await db.collection('usuarios').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const campos = new Set(); us.forEach(u => Object.keys(u).forEach(k => campos.add(k))); console.log('campos usuarios', [...campos].join(','));
  us.filter(u => ['contabilidad', 'administrador', 'recepcion'].includes(u.rol)).forEach(u => console.log('USUARIO', u.email, u.rol, 'ultimo', u.ultimo_acceso?.toDate?.().toISOString().slice(0, 10) || u.last_login?.toDate?.().toISOString().slice(0, 10) || u.ultimoLogin?.toDate?.().toISOString().slice(0, 10) || '?', 'activo', u.activo));
  // avisos cerrados por persona: estado hecho sin siembra: cuántos cerró Brenda; cotizacion_servicio: factura anotada?
  const cs = av.filter(a => a.tipo === 'cotizacion_servicio').map(a => ({ estado: a.estado, factura: a.pasos?.qbo?.factura, por: a.pasos?.qbo?.por_email?.split('@')[0], dias: a.fecha_efectiva?.toDate ? Math.floor((Date.now() - a.fecha_efectiva.toDate()) / 864e5) : null, hechoAt: a.pasos?.qbo?.at?.toDate?.().toISOString().slice(0, 10) }));
  console.log('COTIZACION_SERVICIO', cs);
  // modelos: cuáles mapeados y cuántos contratos activos usan modelos sin mapeo (top modelos sin mapeo)
  const mo = (await db.collection('modelos').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const mapeado = new Set(mo.filter(m => Number(m.precio_alquiler) > 0 && m.qbo_item_alquiler_id && m.qbo_bundle_id).map(m => String(m.modelo || '').trim().toLowerCase()));
  console.log('modelos mapeados', [...mapeado].join(', '));
  const ct = (await db.collection('contratos').get()).docs.map(d => d.data()).filter(c => ['activo', 'aprobado'].includes(c.estado));
  const sinMapeo = {}; ct.forEach(c => (c.equipos || []).forEach(e => { const k = String(e.modelo || '').trim().toLowerCase(); if (!mapeado.has(k)) cnt(sinMapeo, k || '(vacío)'); }));
  console.log('líneas de contratos vivos con modelo SIN mapeo (top 15)', Object.entries(sinMapeo).sort((a, b) => b[1] - a[1]).slice(0, 15));
  // clientes vinculados sin contrato vivo / exento
  const cl = (await db.collection('clientes').get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.deleted !== true);
  console.log('clientes con itbms_exento/exento campo', cl.filter(c => c.itbms_exento === true || c.exento === true).length, 'campos itbms', [...new Set(cl.flatMap(c => Object.keys(c).filter(k => /itbms|exent/i.test(k))))]);
  // empresa config: destinatarios de alertas
  const cfg = (await db.collection('empresa').doc('config').get()).data() || {};
  console.log('empresa/config claves factur', Object.keys(cfg).filter(k => /factur|alert|activacion|qbo|comision/i.test(k)));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

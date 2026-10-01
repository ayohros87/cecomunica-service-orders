// Lee los campos de entrega de las órdenes de prueba (SOLO emulador, solo lectura).
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  for (const id of process.argv.slice(2)) {
    const o = (await db.collection('ordenes_de_servicio').doc(id).get()).data() || {};
    const pick = (k) => o[k] === undefined ? undefined : (o[k]?.toDate ? o[k].toDate().toISOString() : o[k]);
    console.log(id, JSON.stringify({ estado: o.estado_reparacion, receptor_nombre: pick('receptor_nombre'), entrega_persona_interna: pick('entrega_persona_interna'), no_recibido: pick('no_recibido'), no_recibido_motivo: pick('no_recibido_motivo'), firma_url: pick('firma_url'), receptor_cedula: pick('receptor_cedula'), nota_firmada_url: pick('nota_firmada_url'), fecha_creacion: pick('fecha_creacion'), fecha_entrega: pick('fecha_entrega'), tecnico: o.tecnico_asignado, eq: (o.equipos||[]).map(e => ({ s: e.numero_de_serie || e.serial, trabajo: (e.trabajo_tecnico || e.intervencion_texto || e.intervencion || '').toString().slice(0,40), elim: !!e.eliminado })) }));
  }
  // Cuántas entregas en papel hay en producción (export de hoy) y desde cuándo
  const snap = await db.collection('ordenes_de_servicio').where('no_recibido', '==', true).get();
  let n = 0, conPersona = 0, ultimos30 = 0; const hace30 = Date.now() - 30 * 86400000;
  snap.forEach(d => { const o = d.data(); if (o.eliminado) return; n++; if (o.entrega_persona_interna) conPersona++; const fe = o.fecha_entrega?.toDate?.(); if (fe && fe.getTime() > hace30) ultimos30++; });
  const ent = await db.collection('ordenes_de_servicio').where('estado_reparacion', '==', 'ENTREGADO AL CLIENTE').count().get();
  console.log(`entregas con firma en papel (no_recibido=true): ${n}; con entrega_persona_interna: ${conPersona}; en los últimos 30 días: ${ultimos30}; ENTREGADO total: ${ent.data().count}`);
})().catch(e => { console.error(e); process.exit(1); });

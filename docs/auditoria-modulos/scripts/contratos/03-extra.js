// Auditoría CONTRATOS · utilidades extra (SOLO emulador).
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/contratos/03-extra.js <accion> <id>
//   firmar-cliente <sid>   escribe lo que /firmar/ escribe al firmar (estado firmado + firma) — en el
//                          emulador la subida de la cédula a Storage está bloqueada y la página no llega a esto
//   clonar <contratoDocId> copia el contrato de prueba como un segundo contrato APROBADO con seriales
//                          asignados (para el camino de papel y la anulación); imprime el id nuevo
//   limpiar                borra SOLO lo creado por esta auditoría (cliente, contratos, solicitudes, pool revertido)
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const [accion, id] = process.argv.slice(2);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mP8z8BQz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC';
(async () => {
  if (accion === 'firmar-cliente') {
    const ref = db.collection('firma_solicitudes').doc(id); const s = (await ref.get()).data();
    if (s.estado !== 'pendiente') throw new Error('no está pendiente: ' + s.estado);
    await ref.update({ estado: 'firmado', firma: {
      nombre: s.representante?.nombre || 'FIRMANTE', cedula: s.representante?.cedula || '', cargo: 'Representante Legal', doc_tipo: s.representante?.doc_tipo || 'cedula',
      png: PNG, cedula_path: `firmas_identidad/${id}/cedula.jpg`, selfie_path: `firmas_identidad/${id}/selfie.jpg`,
      consent_biometrico: true, acepta: true, user_agent: 'auditoria', firmado_at: FV.serverTimestamp() } });
    console.log('solicitud firmada por', s.representante?.nombre);
  } else if (accion === 'clonar') {
    const src = (await db.collection('contratos').doc(id).get()).data();
    const num = src.contrato_id.replace(/-\d+$/, '-02');
    const ref = db.collection('contratos').doc();
    const { firma_solicitud_id, firma_solicitud_estado, firmado, firmado_tipo, firmado_digital, firmado_fecha, fecha_activacion, estado_previo, firma_codigo, firma_url, firma_hash, verificacion_ok, ...resto } = src;
    await ref.set({ ...resto, contrato_id: num, estado: 'aprobado', seriales_estado: 'asignados', seriales_count: 0,
      observaciones: 'PRUEBA-AUDIT-contratos · segundo contrato (papel / anulación)', fecha_creacion: FV.serverTimestamp(), fecha_aprobacion: FV.serverTimestamp(),
      searchTokens: (src.searchTokens || []).concat([num.toLowerCase()]) });
    console.log(JSON.stringify({ c2: ref.id, c2Num: num }));
  } else if (accion === 'limpiar') {
    const cs = await db.collection('contratos').where('cliente_id', '==', 'PRUEBA-AUDIT-contratos-cliente').get();
    for (const d of cs.docs) {
      for (const sub of ['seriales', 'seriales_estado', 'seriales_historial', 'ordenes']) { const q = await d.ref.collection(sub).get(); for (const x of q.docs) await x.ref.delete(); }
      await db.collection('verificaciones').doc(d.id).delete().catch(() => {});
      await d.ref.delete();
    }
    const fs = await db.collection('firma_solicitudes').where('cliente_id', '==', 'PRUEBA-AUDIT-contratos-cliente').get();
    for (const d of fs.docs) await d.ref.delete();
    const pool = await db.collection('equipos_pool').where('asignacion.cliente_id', '==', 'PRUEBA-AUDIT-contratos-cliente').get();
    for (const d of pool.docs) await d.ref.set({ estado: 'en_bodega', asignacion: FV.delete() }, { merge: true });
    await db.collection('clientes').doc('PRUEBA-AUDIT-contratos-cliente').delete();
    console.log('limpio:', cs.size, 'contratos,', fs.size, 'solicitudes,', pool.size, 'unidades devueltas a bodega');
  } else { console.error('acción desconocida'); process.exit(2); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

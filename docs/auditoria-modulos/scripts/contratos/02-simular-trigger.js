// Auditoría CONTRATOS · simula lo que harían las Cloud Functions (NO corren en
// el emulador de esta auditoría: solo auth+firestore+hosting). SOLO emulador.
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/contratos/02-simular-trigger.js <accion> <id>
// Acciones (espejo mínimo de cada trigger, solo campos que la UI lee):
//   pedir-seriales <contratoDocId>   onContratoAprobadoSolicitaSeriales → seriales_estado='pendiente'
//   espejar-asignados <contratoDocId> onSerialWrite + onSerialesAsignadasSendPdf → seriales_count, seriales_estado='asignados'
//   verificacion <contratoDocId>     onContratoActivado → verificaciones/{id} + firma_codigo/url/hash
//   firma <solicitudId>              onFirmaContrato pendiente→firmado: coincide → contrato activo; no → validacion
//   estado <contratoDocId>           imprime el contrato (diagnóstico)
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
const crypto = require('crypto');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const [accion, id] = process.argv.slice(2);
const norm = (s) => String(s || '').toUpperCase().replace(/^(?:C[EÉ]D(?:ULA)?|PASAPORTE)\.?\s*(?:N[O°º]?\.?|#|:)?\s*/, '').replace(/[^A-Z0-9]/g, '');

(async () => {
  if (accion === 'pedir-seriales') {
    const ref = db.collection('contratos').doc(id); const c = (await ref.get()).data();
    if (c.estado !== 'aprobado') throw new Error('no está aprobado: ' + c.estado);
    if (c.seriales_estado) { console.log('ya tenía seriales_estado', c.seriales_estado); }
    else { await ref.set({ seriales_estado: 'pendiente' }, { merge: true }); console.log('seriales_estado=pendiente (correo a inventario simulado)'); }
  } else if (accion === 'espejar-asignados') {
    const ref = db.collection('contratos').doc(id);
    const ser = await ref.collection('seriales').get();
    const senal = (await ref.collection('seriales_estado').doc('current').get()).data() || {};
    const norms = new Set(ser.docs.map(d => String(d.data().serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '')));
    await ref.set({
      seriales_count: norms.size,
      seriales_estado: 'asignados', seriales_omitidos_count: (senal.omisiones || []).length,
      seriales_asignados_at: FV.serverTimestamp(), seriales_asignados_por: senal.por || null,
      seriales_pdf_enviado_at: FV.serverTimestamp(),
    }, { merge: true });
    console.log('espejado: seriales_count', norms.size, 'estado señal', senal.estado, '(PDF + correo a activaciones simulados)');
  } else if (accion === 'verificacion') {
    const ref = db.collection('contratos').doc(id); const c = (await ref.get()).data();
    const codigo = c.firma_codigo || crypto.randomBytes(5).toString('hex').toUpperCase();
    const url = c.firma_url || `https://verify.cecomunica.net/c/${encodeURIComponent(id)}?v=${codigo}`;
    const hmac = c.firma_hash || crypto.createHmac('sha256', 'EMULADOR').update(`${id}|${c.aprobado_por_uid}`).digest('hex');
    let aprob = { nombre: '—' };
    try { const u = await db.collection('usuarios').doc(c.aprobado_por_uid || '-').get(); if (u.exists) aprob = u.data(); } catch {}
    await db.collection('verificaciones').doc(id).set({
      contrato_id: id, cliente_nombre: c.cliente_nombre || null, total_con_itbms: c.total_con_itbms ?? null,
      aprobado_por_uid: c.aprobado_por_uid || 'desconocido', fecha_aprobacion: c.fecha_aprobacion || FV.serverTimestamp(),
      firma_codigo: codigo, firma_hash: hmac, firma_url: url, estado: c.estado,
      aprobado_por_nombre: aprob.nombre || '—', aprobado_por_email: aprob.email || '—', aprobado_por_rol: aprob.rol || '—',
      creado_en: FV.serverTimestamp(),
    }, { merge: true });
    await ref.set({ firma_codigo: codigo, firma_hash: hmac, firma_url: url, verificacion_ok: true }, { merge: true });
    console.log('verificación creada', url);
  } else if (accion === 'firma') {
    const sref = db.collection('firma_solicitudes').doc(id); const s = (await sref.get()).data();
    if (s.estado !== 'firmado') throw new Error('la solicitud no está en firmado: ' + s.estado);
    const cedR = norm(s.representante?.cedula), cedF = norm(s.firma?.cedula);
    const coincide = cedR && cedF ? cedR === cedF : String(s.representante?.nombre || '').toUpperCase().trim() === String(s.firma?.nombre || '').toUpperCase().trim();
    const cref = db.collection('contratos').doc(s.contrato_doc_id); const c = (await cref.get()).data();
    if (coincide) {
      const ahora = admin.firestore.Timestamp.now();
      const hash = crypto.createHash('sha256').update(`${c.contrato_id}|${s.firma.nombre}|${s.firma.cedula}`).digest('hex');
      const upd = {
        firmado: true, firmado_tipo: 'digital', firmado_fecha: ahora,
        firmado_digital: { solicitud_id: id, firmante_nombre: s.firma.nombre || '', firmante_cedula: s.firma.cedula || '', firmante_cargo: s.firma.cargo || '',
          firmado_at: s.firma.firmado_at || ahora, hash, texto_version: s.documento?.texto_version || null, coincide_representante: true },
        firmado_pendiente_validacion: FV.delete(), firma_solicitud_estado: 'activado', fecha_modificacion: new Date(),
      };
      if (c.estado === 'aprobado') { upd.estado_previo = c.estado; upd.estado = 'activo'; upd.fecha_activacion = ahora; }
      await cref.update(upd);
      await sref.update({ estado: 'activado', firmante_coincide: true, hash, procesado_at: FV.serverTimestamp() });
      console.log('coincide → contrato activo (correos a ventas/vendedor/cliente simulados)');
    } else {
      await sref.update({ estado: 'validacion', firmante_coincide: false, procesado_at: FV.serverTimestamp() });
      await cref.update({ firmado_pendiente_validacion: true, firma_solicitud_id: id, firma_solicitud_estado: 'validacion', fecha_modificacion: new Date() });
      console.log('NO coincide → contrato en validación de firmante');
    }
  } else if (accion === 'estado') {
    const c = (await db.collection('contratos').doc(id).get()).data();
    const ser = await db.collection('contratos').doc(id).collection('seriales').get();
    console.log(JSON.stringify({ contrato_id: c.contrato_id, estado: c.estado, seriales_estado: c.seriales_estado, seriales_count: c.seriales_count, filas: ser.size,
      firmado: c.firmado, firmado_tipo: c.firmado_tipo, firma_solicitud_id: c.firma_solicitud_id, firma_solicitud_estado: c.firma_solicitud_estado, firma_codigo: c.firma_codigo, os_count: c.os_count }, null, 1));
  } else if (accion === "sync-pool") { return; } else { console.error("acción desconocida"); process.exit(2); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
// (anexo) sync-pool <contratoDocId>: lo que hace onSerialWrite en el pool por
// cada fila de contratos/{cid}/seriales → equipos_pool.{estado:'asignado_contrato', asignacion}.
if (accion === 'sync-pool') {
  (async () => {
    const ref = db.collection('contratos').doc(id); const c = (await ref.get()).data();
    const ser = await ref.collection('seriales').get();
    let n = 0;
    for (const d of ser.docs) {
      const s = d.data(); const key = String(s.serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const q = await db.collection('equipos_pool').where('serial_norm', '==', key).limit(1).get();
      if (q.empty) { console.log('sin ficha en el pool:', s.serial); continue; }
      await q.docs[0].ref.set({ estado: 'asignado_contrato', asignacion: { contrato_doc_id: id, contrato_id: c.contrato_id || '', cliente_id: c.cliente_id || '', cliente_nombre: c.cliente_nombre || '' }, updated_at: FV.serverTimestamp() }, { merge: true });
      n++;
    }
    console.log('pool sincronizado:', n, 'unidades → asignado_contrato');
    process.exit(0);
  })().catch(e => { console.error(e); process.exit(1); });
}

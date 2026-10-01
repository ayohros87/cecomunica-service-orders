// Auditoría de módulos 2026-09-30 · CONTRATOS · lectura de datos del emulador.
// Solo lectura. SOLO contra el emulador. Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/contratos/00-datos.js
// Contesta: conteo por estado; la fórmula de la señal "Contratos por firmar";
// verificaciones sin `estado` (la página pública cae en "no vigente");
// candidatos para el recorrido (cliente con representante y vendedor, modelos
// con stock en bodega); estados de firma_solicitudes; anulados con motivo.
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

const SIN_FIRMA = new Set(['REEMP', 'DEMO']);
function codigoTipo(c) {
  if (c.codigo_tipo) return c.codigo_tipo;
  const m = { Servicio: 'SERV', Alquiler: 'ALQ', Propio: 'PROP', Reemplazo: 'REEMP', Demo: 'DEMO', Temporal: 'TEMP' };
  if (m[c.tipo_contrato]) return m[c.tipo_contrato];
  const x = String(c.contrato_id || '').match(/^[A-Z]+/);
  return x ? x[0] : null;
}
const ms = (v) => v?.toMillis ? v.toMillis() : (v?.seconds ? v.seconds * 1000 : 0);

(async () => {
  const snap = await db.collection('contratos').get();
  const cs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log('contratos total:', cs.length, '| borrados:', cs.filter(c => c.deleted === true).length);

  const porEstado = {};
  cs.filter(c => c.deleted !== true).forEach(c => { porEstado[c.estado || '(sin estado)'] = (porEstado[c.estado || '(sin estado)'] || 0) + 1; });
  console.log('por estado (sin borrados):', porEstado);

  const aprob = cs.filter(c => c.deleted !== true && c.estado === 'aprobado');
  const porSer = {};
  aprob.forEach(c => { porSer[c.seriales_estado || '(sin)'] = (porSer[c.seriales_estado || '(sin)'] || 0) + 1; });
  console.log('aprobados por seriales_estado:', porSer);
  console.log('aprobados firmado===true:', aprob.filter(c => c.firmado === true).length,
    '| entrega_confirmada:', aprob.filter(c => c.entrega_confirmada === true).length,
    '| sin firma (REEMP/DEMO):', aprob.filter(c => SIN_FIRMA.has(codigoTipo(c))).length);

  // Señal "Contratos por firmar" (senalesService.listContratosPorFirmar)
  const porFirmar = cs.filter(c => c.estado === 'aprobado' && c.seriales_estado === 'asignados'
    && c.deleted !== true && c.firmado !== true && c.entrega_confirmada !== true && !SIN_FIRMA.has(codigoTipo(c)));
  console.log('\n== señal Contratos por firmar (fórmula del servicio):', porFirmar.length);
  const uids = [...new Set(porFirmar.map(c => c.creado_por_uid).filter(Boolean))];
  const us = {};
  for (const u of uids) { const s = await db.collection('usuarios').doc(u).get(); us[u] = s.exists ? (s.data().email || u) : u; }
  porFirmar.forEach(c => console.log(`  ${c.contrato_id} | ${(c.cliente_nombre || '').slice(0, 30)} | ${codigoTipo(c)} ${c.accion || ''} | os_count=${c.os_count || 0} | firma_sol=${c.firma_solicitud_estado || '-'} | por ${us[c.creado_por_uid] || '-'} | asignados ${c.seriales_asignados_at?.toDate?.().toISOString().slice(0, 10) || '-'}`));
  const porVend = {};
  porFirmar.forEach(c => { porVend[us[c.creado_por_uid] || '-'] = (porVend[us[c.creado_por_uid] || '-'] || 0) + 1; });
  console.log('  por vendedor:', porVend);
  // Aprobados con firma que NO entran en la señal por seriales_estado ≠ asignados
  const fuera = cs.filter(c => c.estado === 'aprobado' && c.deleted !== true && c.firmado !== true && c.entrega_confirmada !== true
    && !SIN_FIRMA.has(codigoTipo(c)) && c.seriales_estado !== 'asignados' && c.seriales_estado !== 'legacy');
  console.log('  aprobados con firma pendiente FUERA de la señal (seriales no asignados, no legacy):', fuera.length);
  fuera.slice(0, 15).forEach(c => console.log(`    ${c.contrato_id} | ${(c.cliente_nombre || '').slice(0, 28)} | ser=${c.seriales_estado || '(sin)'} | firma_sol=${c.firma_solicitud_estado || '-'} | ${c.fecha_aprobacion?.toDate?.().toISOString().slice(0, 10) || '-'}`));

  // Verificaciones: ¿tienen estado? ¿cuadra con el contrato?
  const vsnap = await db.collection('verificaciones').get();
  const byId = new Map(cs.map(c => [c.id, c]));
  let sinEstado = 0, sinEstadoActivo = 0, desfase = 0; const ejDesfase = []; const ejSinEstado = [];
  vsnap.docs.forEach(d => {
    const v = d.data(); const c = byId.get(d.id);
    if (!v.estado) { sinEstado++; if (c && ['activo', 'aprobado'].includes(c.estado)) { sinEstadoActivo++; if (ejSinEstado.length < 5) ejSinEstado.push(`${c.contrato_id} (${c.estado}) v=${v.firma_codigo}`); } }
    else if (c) {
      const esperado = (c.vencimiento_estado === 'vencido' && ['activo', 'aprobado'].includes(c.estado)) ? 'vencido' : c.estado;
      if (v.estado !== esperado) { desfase++; if (ejDesfase.length < 8) ejDesfase.push(`${c.contrato_id}: verif=${v.estado} contrato=${c.estado}/${c.vencimiento_estado || '-'}`); }
    }
  });
  console.log('\n== verificaciones:', vsnap.size, '| sin `estado`:', sinEstado, '| de esas con contrato activo/aprobado:', sinEstadoActivo, ejSinEstado);
  console.log('   con estado distinto al del contrato:', desfase, ejDesfase);
  const anuladosConVerif = cs.filter(c => c.estado === 'anulado' && vsnap.docs.some(d => d.id === c.id));
  console.log('   anulados con verificación:', anuladosConVerif.length,
    anuladosConVerif.slice(0, 3).map(c => `${c.contrato_id} v=${c.firma_codigo} verif.estado=${vsnap.docs.find(d => d.id === c.id).data().estado || '(sin)'}`));
  const activoConVerif = cs.find(c => c.estado === 'activo' && c.firma_codigo && vsnap.docs.some(d => d.id === c.id && d.data().estado === 'activo'));
  if (activoConVerif) console.log('   ejemplo activo para /c/:', activoConVerif.id, activoConVerif.contrato_id, 'v=' + activoConVerif.firma_codigo);
  const vencidoConVerif = cs.find(c => c.vencimiento_estado === 'vencido' && c.estado === 'activo' && c.firma_codigo);
  if (vencidoConVerif) console.log('   ejemplo vencido por fecha:', vencidoConVerif.id, vencidoConVerif.contrato_id, 'v=' + vencidoConVerif.firma_codigo, 'verif.estado=' + (vsnap.docs.find(d => d.id === vencidoConVerif.id)?.data().estado || '(sin)'));

  // Anulados: motivo y tipo
  const anul = cs.filter(c => c.estado === 'anulado');
  console.log('\n== anulados:', anul.length, '| sin motivo:', anul.filter(c => !c.anulado_motivo).length,
    '| tipo sustitucion:', anul.filter(c => c.anulacion_tipo === 'sustitucion').length,
    '| con orden_devolucion:', anul.filter(c => c.orden_devolucion_id).length,
    '| sustitucion_vinculo_pendiente:', anul.filter(c => c.sustitucion_vinculo_pendiente).length);
  // Vencidos / temporales cerrados
  console.log('== vencidos (estado):', cs.filter(c => c.estado === 'vencido').length,
    '| activos con vencimiento_estado=vencido:', cs.filter(c => c.estado === 'activo' && c.vencimiento_estado === 'vencido').length,
    '| TEMP vivos:', cs.filter(c => codigoTipo(c) === 'TEMP' && ['activo', 'aprobado'].includes(c.estado) && c.deleted !== true).map(c => `${c.contrato_id}/${c.estado}`).slice(0, 6));
  // Devolución (columna)
  const dev = {}; cs.forEach(c => { if (c.devolucion_estado) dev[c.devolucion_estado] = (dev[c.devolucion_estado] || 0) + 1; });
  console.log('== devolucion_estado:', dev);
  // Papel v2 vs clásico entre vivos
  const CORTE = Date.parse('2026-09-09T00:00:00-05:00');
  const vivos = cs.filter(c => c.deleted !== true && ['activo', 'aprobado', 'pendiente_aprobacion'].includes(c.estado));
  const v2 = vivos.filter(c => c.documento_version === 'v2' || c.codigo_tipo === 'SERV' || c.tipo_contrato === 'Servicio' || c.firma_solicitud_id || c.firmado_tipo === 'digital' || ms(c.fecha_creacion) >= CORTE);
  console.log('== vivos:', vivos.length, '| v2:', v2.length, '| clásico:', vivos.length - v2.length,
    '| firmado_tipo digital:', cs.filter(c => c.firmado_tipo === 'digital').length, '| firmado con url (papel):', cs.filter(c => c.firmado_url).length);
  // Representante / doc tipo
  console.log('== representante_doc_tipo en contratos vivos:', vivos.reduce((a, c) => { a[c.representante_doc_tipo || '(sin)'] = (a[c.representante_doc_tipo || '(sin)'] || 0) + 1; return a; }, {}));

  // firma_solicitudes
  const fs = await db.collection('firma_solicitudes').get();
  const fsE = {}; fs.docs.forEach(d => { const x = d.data(); const k = `${x.tipo || 'contrato'}/${x.estado}`; fsE[k] = (fsE[k] || 0) + 1; });
  console.log('\n== firma_solicitudes:', fs.size, fsE);
  console.log('   firmante NO coincide:', fs.docs.filter(d => d.data().firmante_coincide === false).length,
    '| con autorizacion_path:', fs.docs.filter(d => d.data().firma?.autorizacion_path).length,
    '| pendientes de validación:', fs.docs.filter(d => d.data().estado === 'validacion').map(d => `${d.id} ${d.data().contrato_id}`));
  const ejFirmado = fs.docs.find(d => d.data().estado === 'activado' && d.data().firma?.png && !d.data().tipo);
  if (ejFirmado) console.log('   ejemplo firmado (contrato):', ejFirmado.id, ejFirmado.data().contrato_id, 'contrato_doc', ejFirmado.data().contrato_doc_id);
  const ejPend = fs.docs.find(d => d.data().estado === 'pendiente' && !d.data().tipo);
  if (ejPend) console.log('   ejemplo pendiente (contrato):', ejPend.id, ejPend.data().contrato_id);
  const ft = await db.collection('firmas_tablet').get();
  const ftT = {}; ft.docs.forEach(d => { const x = d.data(); const k = `${x.tipo}/${x.estado}`; ftT[k] = (ftT[k] || 0) + 1; });
  console.log('== firmas_tablet:', ft.size, ftT);

  // Candidatos para el recorrido: cliente activo con representante+cédula, con vendedor Karla si hay
  const karla = (await db.collection('usuarios').where('email', '==', 'karla.ferrer@cecomunica.com').get()).docs[0];
  console.log('\n== karla uid:', karla?.id, karla?.data().rol);
  const cl = await db.collection('clientes').where('deleted', '==', false).limit(3000).get();
  const cand = cl.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.activo !== false && c.representante && c.representante_cedula && c.email && !String(c.email).endsWith('@sin.email.cecomunica.com'));
  const deKarla = cand.filter(c => c.vendedor_asignado === karla?.id);
  console.log('clientes con representante+cédula+email:', cand.length, '| de Karla:', deKarla.length);
  const contratosPorCliente = {}; cs.forEach(c => { contratosPorCliente[c.cliente_id] = (contratosPorCliente[c.cliente_id] || 0) + 1; });
  (deKarla.length ? deKarla : cand).slice(0, 8).forEach(c => console.log(`  ${c.id} | ${c.nombre} | rep=${c.representante} ${c.representante_cedula} (${c.representante_doc_tipo || '-'}) | contratos=${contratosPorCliente[c.id] || 0} | vend=${c.vendedor_asignado || '-'}`));
  // Modelos con stock en bodega (para 3 líneas serializables)
  const pool = await db.collection('equipos_pool').where('estado', '==', 'en_bodega').get();
  const stock = {}; pool.docs.forEach(d => { const x = d.data(); const k = `${x.modelo_id || '?'}|${x.modelo_label || '?'}|${x.propiedad || '?'}`; stock[k] = (stock[k] || 0) + 1; });
  console.log('\n== stock en bodega por modelo (top 12):');
  Object.entries(stock).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(`  ${n}  ${k}`));

  // Un contrato PRUEBA-AUDIT-contratos previo (si el script corre de nuevo)
  const prev = cs.filter(c => String(c.observaciones || '').includes('PRUEBA-AUDIT-contratos'));
  console.log('\n== contratos PRUEBA-AUDIT-contratos existentes:', prev.map(c => `${c.id} ${c.contrato_id} ${c.estado} ser=${c.seriales_estado || '-'}`));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

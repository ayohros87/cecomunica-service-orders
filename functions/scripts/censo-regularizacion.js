// Censo SOLO LECTURA: cuántas cuentas tienen "deuda de regularización" hoy y
// de qué tipo, para dimensionar el plan. No escribe nada.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const VIG = new Set(['activo', 'aprobado']);
const CON_VENC = new Set(['SERV', 'ALQ', 'PROP', 'REEMP']);
const codigo = (c) => c.codigo_tipo || ({ Servicio: 'SERV', Alquiler: 'ALQ', Propio: 'PROP', Reemplazo: 'REEMP', Demo: 'DEMO', Temporal: 'TEMP' })[c.tipo_contrato] || (String(c.contrato_id || '').match(/^[A-Z]+/) || [null])[0];

(async () => {
  const [cs, ks, ps, gs] = await Promise.all([
    db.collection('clientes').get(), db.collection('contratos').get(),
    db.collection('equipos_pool').where('estado', 'in', ['en_cliente', 'asignado_contrato']).get(),
    db.collection('gestiones').get(),
  ]);
  const clientes = new Map(cs.docs.filter(d => !d.get('deleted')).map(d => [d.id, { id: d.id, nombre: d.get('nombre') || '', vendedor: d.get('vendedor_email') || '', activo: d.get('activo') }]));
  const porCli = new Map();
  const cta = (id) => { if (!porCli.has(id)) porCli.set(id, { contratos: [], campo: [], gestiones: [] }); return porCli.get(id); };
  ks.docs.forEach(d => { const c = d.data(); if (c.deleted) return; cta(c.cliente_id).contratos.push({ id: d.id, ...c }); });
  // Diagnóstico de campos (para no censar con nombres equivocados).
  const p0 = ps.docs.find(d => d.get('estado') === 'en_cliente');
  console.log('POOL en_cliente:', ps.docs.filter(d => d.get('estado') === 'en_cliente').length, 'asignado_contrato:', ps.docs.filter(d => d.get('estado') === 'asignado_contrato').length);
  if (p0) console.log('POOL sample keys:', Object.keys(p0.data()).sort().join(','), '| asignacion:', JSON.stringify(p0.get('asignacion') || null).slice(0, 300));
  const se = {}; ks.docs.forEach(d => { const c = d.data(); if (VIG.has(c.estado) && !c.deleted) se[c.seriales_estado || '(vacío)'] = (se[c.seriales_estado || '(vacío)'] || 0) + 1; });
  console.log('CONTRATOS vigentes por seriales_estado:', JSON.stringify(se));
  ps.docs.forEach(d => { const e = d.data(); const cid = e.cliente_id || e.asignacion?.cliente_id || e.ultima_asignacion?.cliente_id; if (cid) cta(cid).campo.push({ id: d.id, ...e, _cid: cid }); });
  gs.docs.forEach(d => { const g = d.data(); if (g.cliente_id) cta(g.cliente_id).gestiones.push({ id: d.id, ...g }); });

  const tot = { cuentas: 0, sinContratoConRadios: 0, radiosSinContrato: 0, contratosSinSeriales: 0, contratosLegacyOrigen: 0, adendasPapel: 0, reempSinSaliente: 0, sobrantes: 0, cuentasConDeuda: 0 };
  const porVendedor = new Map();
  const lista = [];
  for (const [cid, a] of porCli) {
    const cli = clientes.get(cid); if (!cli) continue;
    tot.cuentas++;
    const vig = a.contratos.filter(c => VIG.has(c.estado));
    const renov = vig.filter(c => CON_VENC.has(codigo(c)));
    const radiosSinContrato = a.campo.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    const conLineas = vig.filter(c => CON_VENC.has(codigo(c)) && (c.equipos || []).some(l => Number(l.cantidad) > 0));
    const sinSeriales = conLineas.filter(c => c.seriales_estado !== 'asignados' && c.seriales_estado !== 'legacy').length;
    const legacySeriales = conLineas.filter(c => c.seriales_estado === 'legacy').length;
    const radiosSinContratoIds = a.campo.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id);
    const legacy = vig.filter(c => c.origen_tipo === 'legacy' || c.origen_legacy_ref).length;
    const papel = a.gestiones.filter(g => g.tipo === 'aumento' && (g.aumento?.papel || g.aumento?.contrato_papel || g.papel) && !['anulada', 'rechazada'].includes(g.estado)).length;
    const reempNoId = a.contratos.filter(c => codigo(c) === 'REEMP' && VIG.has(c.estado) && Array.isArray(c.reemplaza_seriales) && c.reemplaza_seriales.length === 0).length;
    const sobr = vig.reduce((s, c) => s + Number(c.regularizacion?.sobrantes || 0), 0);
    const deuda = { radiosSinContrato, sinSeriales, legacySeriales, legacy, papel, reempNoId, sobr, sinContrato: !renov.length && radiosSinContrato > 0 };
    const puntos = radiosSinContrato + sinSeriales + legacySeriales + legacy + papel + reempNoId + sobr;
    tot.contratosLegacySeriales = (tot.contratosLegacySeriales || 0) + legacySeriales;
    if (deuda.sinContrato) tot.sinContratoConRadios++;
    tot.radiosSinContrato += radiosSinContrato; tot.contratosSinSeriales += sinSeriales; tot.contratosLegacyOrigen += legacy;
    tot.adendasPapel += papel; tot.reempSinSaliente += reempNoId; tot.sobrantes += sobr;
    if (puntos > 0) {
      tot.cuentasConDeuda++;
      const v = cli.vendedor.split('@')[0] || '(sin vendedor)';
      porVendedor.set(v, (porVendedor.get(v) || 0) + 1);
      lista.push({ nombre: cli.nombre, v, puntos, ...deuda, gestionesUltimos90: a.gestiones.filter(g => { const t = g.fecha_solicitud?.toDate?.() || g.fecha_creacion?.toDate?.() || g.created_at?.toDate?.(); return t && (Date.now() - t) < 90 * 86400000; }).length });
    }
  }
  console.log('TOTALES', JSON.stringify(tot));
  console.log('POR VENDEDOR', JSON.stringify([...porVendedor.entries()].sort((a, b) => b[1] - a[1])));
  lista.sort((a, b) => b.puntos - a.puntos);
  console.log('TOP 15');
  lista.slice(0, 15).forEach(l => console.log(' ', l.puntos, '|', l.nombre, '|', l.v, '| radiosSinContrato', l.radiosSinContrato, 'sinSeriales', l.sinSeriales, 'legacySer', l.legacySeriales, 'legacyOrig', l.legacy, 'papel', l.papel, 'reempNoId', l.reempNoId, 'sobr', l.sobr, 'sinContrato', l.sinContrato, 'gest90', l.gestionesUltimos90));
  const conGest = lista.filter(l => l.gestionesUltimos90 > 0).length;
  console.log('CUENTAS CON DEUDA Y GESTIONES EN 90 DÍAS', conGest, '| gestiones totales', gs.size, '| con fecha_creacion', gs.docs.filter(d => d.get('fecha_creacion')).length);
  const dist = { '1-2': 0, '3-5': 0, '6-10': 0, '11+': 0 };
  lista.forEach(l => { dist[l.puntos <= 2 ? '1-2' : l.puntos <= 5 ? '3-5' : l.puntos <= 10 ? '6-10' : '11+']++; });
  console.log('DISTRIBUCIÓN de puntos por cuenta', JSON.stringify(dist));
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

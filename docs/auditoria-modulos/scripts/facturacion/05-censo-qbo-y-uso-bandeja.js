// Censo (solo lectura, EMULADOR): vínculos QBO por día y ritmo entre clics, marcas de la bandeja por persona y día, avisos abiertos, comisiones por faltante, uso_diario.
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/05-censo-qbo-y-uso-bandeja.js
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const cnt = (o, k) => { o[k] = (o[k] || 0) + 1; };
(async () => {
  const cols = (await db.listCollections()).map(c => c.id);
  console.log('COLECCIONES', cols.join(', '));
  // QBO: vinculaciones por día y por hora
  const cl = (await db.collection('clientes').get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.deleted !== true);
  const porDia = {}; const horas = [];
  cl.filter(c => c.qbo_vinculado_at?.toDate).forEach(c => { const d = c.qbo_vinculado_at.toDate(); cnt(porDia, d.toISOString().slice(0, 10)); horas.push(d.getTime()); });
  horas.sort((a, b) => a - b);
  const gaps = horas.slice(1).map((t, i) => (t - horas[i]) / 1000);
  const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  console.log('QBO vinculaciones por día', porDia, '| mediana segundos entre vínculos', med, '| gaps<60s', gaps.filter(g => g < 60).length, 'de', gaps.length);
  // sesiones: bloques separados por > 30 min
  let sesiones = 1, dur = 0, ini = horas[0]; const bloques = [];
  for (let i = 1; i < horas.length; i++) { if (horas[i] - horas[i - 1] > 30 * 60e3) { bloques.push({ ini: new Date(ini).toISOString(), n: 0, min: Math.round((horas[i - 1] - ini) / 60e3) }); ini = horas[i]; sesiones++; } }
  bloques.push({ ini: new Date(ini).toISOString(), min: Math.round((horas[horas.length - 1] - ini) / 60e3) });
  console.log('bloques de trabajo (>30 min de pausa separa)', bloques);
  // clientes: campo activo vs contrato vivo
  const ct = (await db.collection('contratos').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const vivosSet = new Set(ct.filter(c => ['activo', 'aprobado'].includes(c.estado)).map(c => c.cliente_id));
  const activosSet = new Set(ct.filter(c => c.estado === 'activo').map(c => c.cliente_id));
  const sinQboActivo = cl.filter(c => activosSet.has(c.id) && !c.qbo_customer_id);
  console.log('clientes con contrato ACTIVO (no aprobado)', activosSet.size, 'sin QBO', sinQboActivo.length, 'de ellos con RUC', sinQboActivo.filter(c => c.ruc || c.cedula).length);
  console.log('contratos: con facturacion_estado', ct.filter(c => c.facturacion_estado).length, 'con facturable===false', ct.filter(c => c.facturable === false).length, 'activos con firmado_url', ct.filter(c => c.estado === 'activo' && c.firmado_url).length, 'activos', ct.filter(c => c.estado === 'activo').length);
  // avisos: quién marca y cuándo (persona), y los pendientes/esperando: edad, correo, tipo
  const av = (await db.collection('facturacion_avisos').get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !a.id.includes('PRUEBA-AUDIT'));
  const porPersona = {}, porSemana = {};
  av.forEach(a => { ['qbo', 'poc'].forEach(k => { const p = a.pasos?.[k]; if (p?.hecho && p.fuente !== 'siembra' && p.por_email) { cnt(porPersona, `${k}:${p.por_email.split('@')[0]}`); const d = p.at?.toDate?.(); if (d) cnt(porSemana, d.toISOString().slice(0, 10)); } });
    (a.historial || []).forEach(h => { if (h.por_email && /descart|deshecho|qbo_factura|reactiv/.test(h.accion || '')) cnt(porPersona, `${h.accion}:${h.por_email.split('@')[0]}`); }); });
  console.log('pasos marcados por persona', porPersona);
  console.log('días con marcas', Object.keys(porSemana).sort().map(d => `${d}:${porSemana[d]}`).join(' '));
  const abiertos = av.filter(a => ['pendiente', 'esperando'].includes(a.estado));
  console.log('ABIERTOS', abiertos.map(a => ({ tipo: a.tipo, estado: a.estado, dias: a.fecha_efectiva?.toDate ? Math.floor((Date.now() - a.fecha_efectiva.toDate()) / 864e5) : null, creado: a.created_at?.toDate?.().toISOString().slice(0, 10), correo: a.correo?.status, qbo: a.pasos?.qbo?.hecho, poc: a.pasos?.poc?.hecho, pocAplica: a.pasos?.poc?.aplica, vend: !!a.vendedor_email, comVend: !!a.comision?.vendedor_email, serialesOk: a.resumen?.seriales_total ? `${a.resumen.seriales_count}/${a.resumen.seriales_total}` : '-' })));
  const correoEstados = {}; av.forEach(a => cnt(correoEstados, a.correo?.status || '(null)')); console.log('correo status', correoEstados);
  // tipos por mes de creación
  const porMesTipo = {}; av.forEach(a => { const m = a.created_at?.toDate?.().toISOString().slice(0, 7); cnt(porMesTipo, `${m}:${a.tipo}`); }); console.log('avisos por mes y tipo', porMesTipo);
  // comisiones: estado y faltantes
  const comF = {}; av.forEach(a => { const c = a.comision; if (!c || c.aplica === false) return; const f = Object.entries(c.requisitos || {}).filter(([, r]) => r?.aplica && !r.hecho).map(([k]) => k).join('+') || 'ninguno'; cnt(comF, `${c.estado}|falta:${f}|vend:${c.vendedor_email ? 'sí' : 'NO'}`); }); console.log('comisiones', comF);
  // uso_diario
  const ud = await db.collection('uso_diario').get(); ud.forEach(d => { const x = d.data(); const p = Object.entries(x.paginas || {}).filter(([k]) => /factur|cargos|financiero|modelos|comision/.test(k)); console.log('uso_diario', d.id, p); const u = x.usuarios || {}; console.log('usuarios hoy', Object.keys(u).length, JSON.stringify(u).slice(0, 800)); });
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

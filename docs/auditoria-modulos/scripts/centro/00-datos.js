// Inventario de datos del emulador para la auditoría del Centro (solo lectura).
// Correr desde functions/: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/centro/00-datos.js
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const cli = await db.collection('clientes').get();
  const clientes = new Map(cli.docs.map(d => [d.id, d.data()]));
  console.log('clientes', cli.size, 'activos', cli.docs.filter(d => d.data().activo !== false && !d.data().deleted).length,
    'sin vendedor', cli.docs.filter(d => !d.data().deleted && d.data().activo !== false && !d.data().vendedor_asignado).length,
    'con regularizacion.puntos>0', cli.docs.filter(d => d.data().regularizacion?.puntos > 0).length);
  const pool = await db.collection('equipos_pool').get();
  const porCli = {};
  pool.docs.forEach(d => { const a = d.data().asignacion?.cliente_id; if (a) porCli[a] = (porCli[a] || 0) + 1; });
  const con = await db.collection('contratos').get();
  const conPorCli = {};
  con.docs.forEach(d => { const c = d.data().cliente_id; if (c) { conPorCli[c] = conPorCli[c] || { n: 0, vivos: 0 }; conPorCli[c].n++; if (['activo','aprobado','pendiente_aprobacion'].includes(d.data().estado)) conPorCli[c].vivos++; } });
  const ges = await db.collection('gestiones').get();
  const gesPorCli = {}; const gesEstado = {}; const gesTipo = {};
  ges.docs.forEach(d => { const g = d.data(); gesPorCli[g.cliente_id] = (gesPorCli[g.cliente_id] || 0) + 1; gesEstado[g.estado] = (gesEstado[g.estado] || 0) + 1; gesTipo[g.tipo] = (gesTipo[g.tipo] || 0) + 1; });
  console.log('equipos_pool', pool.size, 'contratos', con.size, 'gestiones', ges.size);
  console.log('gestiones por estado', gesEstado); console.log('gestiones por tipo', gesTipo);
  const top = Object.entries(porCli).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [id, n] of top) console.log(n, 'equipos |', id, '|', clientes.get(id)?.nombre, '| contratos', JSON.stringify(conPorCli[id] || {}), '| gestiones', gesPorCli[id] || 0, '| reg', JSON.stringify(clientes.get(id)?.regularizacion?.puntos), '| vend', clientes.get(id)?.vendedor_email);
  const topG = Object.entries(gesPorCli).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [id, n] of topG) console.log('gestiones', n, '|', id, '|', clientes.get(id)?.nombre, '| equipos', porCli[id] || 0, '| contratos', JSON.stringify(conPorCli[id] || {}));
  // pendientes por aprobar
  console.log('contratos pendiente_aprobacion', con.docs.filter(d => d.data().estado === 'pendiente_aprobacion' && !d.data().deleted).length);
  // audit logs de clientes
  const al = await db.collection('audit_logs').orderBy('timestamp', 'desc').limit(3000).get().catch(e => ({ docs: [], err: e.message }));
  if (al.err) console.log('audit_logs err', al.err); else {
    const acc = {};
    al.docs.forEach(d => { const x = d.data(); const k = `${x.modulo || x.module || '?'}:${x.accion || x.action || '?'}`; if (/clien|gestion|centro|vendedor/i.test(k)) acc[k] = (acc[k] || 0) + 1; });
    console.log('audit_logs (3000 más recientes) clientes/gestiones', acc);
    const primero = al.docs[al.docs.length - 1]?.data(); console.log('campo fecha', Object.keys(al.docs[0]?.data() || {}));
  }
  // clientes karla (vendedor)
  const us = await db.collection('usuarios').get();
  const karla = us.docs.find(d => (d.data().email || '') === 'karla.ferrer@cecomunica.com');
  console.log('karla uid', karla?.id, 'clientes en cartera', cli.docs.filter(d => d.data().vendedor_asignado === karla?.id).length);
  const cobros = us.docs.find(d => (d.data().email || '') === 'cobros@cecomunica.com'); console.log('cobros', cobros?.id, cobros?.data().rol);
})();

// Mide la base PoC en el EMULADOR (solo lectura). Auditoría de módulos 2026-09-30.
// Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/poc/00-base-poc.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();

const norm = (s) => String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const simN = (s) => String(s ?? '').replace(/\D/g, '');
const vacio = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const top = (m, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);

(async () => {
  const t0 = Date.now();
  const snap = await db.collection('poc_devices').get();
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`poc_devices: ${docs.length} docs (lectura completa en ${Date.now() - t0} ms)`);

  const vivas = docs.filter(d => d.deleted !== true);
  const cerradas = docs.filter(d => d.deleted === true);
  const activas = vivas.filter(d => d.activo !== false);
  console.log(`  vivas ${vivas.length} (activas ${activas.length} · inactivas ${vivas.length - activas.length}) · cerradas ${cerradas.length}`);

  // Campos faltantes en vivas
  const f = {
    sinClienteId: vivas.filter(d => vacio(d.cliente_id)).length,
    sinClienteNombreNiId: vivas.filter(d => vacio(d.cliente_id) && vacio(d.cliente) && vacio(d.cliente_nombre)).length,
    sinSim: vivas.filter(d => vacio(d.sim_number)).length,
    activasSinSim: activas.filter(d => vacio(d.sim_number)).length,
    inactivasConSim: vivas.filter(d => d.activo === false && !vacio(d.sim_number)).length,
    sinSerial: vivas.filter(d => vacio(d.serial)).length,
    sinUnitId: vivas.filter(d => vacio(d.unit_id)).length,
    sinModeloId: vivas.filter(d => vacio(d.modelo_id)).length,
    sinModeloNada: vivas.filter(d => vacio(d.modelo_id) && vacio(d.modelo_label) && vacio(d.modelo) && vacio(d.Modelo)).length,
    sinContrato: vivas.filter(d => vacio(d.contrato_id) && vacio(d.contrato_doc_id)).length,
    sinOperador: vivas.filter(d => vacio(d.operador)).length,
    sinIp: vivas.filter(d => vacio(d.ip)).length,
    sinGrupos: vivas.filter(d => !Array.isArray(d.grupos) || d.grupos.length === 0).length,
    incompletas: vivas.filter(d => [d.cliente_id || d.cliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone].some(vacio)).length,
    consolas: vivas.filter(d => norm(d.serial) === 'CONSOLA').length,
    unitIdNumNull: vivas.filter(d => d.unit_id_num == null).length,
  };
  console.log('  faltantes en vivas:', f);

  // Duplicados por serial (vivas)
  const porSerial = new Map();
  for (const d of vivas) { const k = norm(d.serial); if (!k || ['ND', 'NA', 'CONSOLA', 'SINSERIAL'].includes(k)) continue; (porSerial.get(k) || porSerial.set(k, []).get(k)).push(d); }
  const dupSerial = [...porSerial.values()].filter(a => a.length > 1);
  const dupSerialMismoCliente = dupSerial.filter(a => new Set(a.map(d => d.cliente_id || norm(d.cliente))).size === 1);
  const dupSerialActivas = dupSerial.filter(a => a.filter(d => d.activo !== false).length > 1);
  console.log(`  seriales con >1 ficha VIVA: ${dupSerial.length} (fichas ${dupSerial.flat().length}); mismo cliente ${dupSerialMismoCliente.length}; con >1 ACTIVA ${dupSerialActivas.length}`);
  const porSerialTodas = new Map();
  for (const d of docs) { const k = norm(d.serial); if (!k || ['ND', 'NA', 'CONSOLA', 'SINSERIAL'].includes(k)) continue; inc(porSerialTodas, k); }
  console.log(`  seriales con >1 ficha (contando cerradas): ${[...porSerialTodas.values()].filter(n => n > 1).length}`);
  console.log('  ejemplos dup vivas:', dupSerial.slice(0, 5).map(a => `${a[0].serial}: ${a.map(d => `${(d.cliente_nombre || d.cliente || '?').slice(0, 18)}/${d.activo === false ? 'inact' : 'ACT'}/${d.unit_id}`).join(' | ')}`));

  // Duplicados por SIM (vivas) y SIM en varios radios activos
  const porSim = new Map();
  for (const d of vivas) { const k = simN(d.sim_number); if (!k) continue; (porSim.get(k) || porSim.set(k, []).get(k)).push(d); }
  const dupSim = [...porSim.values()].filter(a => a.length > 1);
  const dupSimActivas = dupSim.filter(a => a.filter(d => d.activo !== false).length > 1);
  console.log(`  SIMs en >1 ficha viva: ${dupSim.length}; en >1 ficha ACTIVA: ${dupSimActivas.length}`);
  console.log('  ejemplos SIM dup activas:', dupSimActivas.slice(0, 4).map(a => `${a[0].sim_number}: ${a.map(d => `${(d.cliente_nombre || d.cliente || '?').slice(0, 16)}/${d.serial}`).join(' | ')}`));

  // Unit ID duplicado dentro del mismo cliente (vivas)
  const porUnit = new Map();
  for (const d of vivas) { const u = String(d.unit_id ?? '').trim().toUpperCase(); if (!u) continue; const k = (d.cliente_id || 'n:' + norm(d.cliente)) + '|' + u; inc(porUnit, k); }
  console.log(`  Unit ID repetido dentro del mismo cliente: ${[...porUnit.values()].filter(n => n > 1).length} pares`);

  // Cliente: fichas vivas cuyo cliente_id no existe en clientes
  const cli = await db.collection('clientes').get();
  const cliIds = new Set(cli.docs.map(d => d.id));
  const cliNombres = new Map(cli.docs.map(d => [d.id, d.data().nombre]));
  const huerfanas = vivas.filter(d => d.cliente_id && !cliIds.has(d.cliente_id)).length;
  console.log(`  clientes: ${cli.size}; fichas vivas con cliente_id que NO existe: ${huerfanas}`);
  const porCliente = new Map();
  for (const d of vivas) inc(porCliente, d.cliente_id ? (cliNombres.get(d.cliente_id) || d.cliente_id) : ('(sin id) ' + (d.cliente || d.cliente_nombre || '?')));
  console.log('  clientes con más fichas vivas:', top(porCliente, 10));
  console.log(`  clientes distintos con fichas vivas: ${porCliente.size}`);

  // Modelos y operadores
  const porModelo = new Map(); for (const d of vivas) inc(porModelo, d.modelo_label || d.modelo || d.Modelo || '(sin modelo)');
  console.log('  modelos (vivas):', top(porModelo, 8));
  const porOp = new Map(); for (const d of vivas) inc(porOp, d.operador || '(vacío)');
  console.log('  operadores (vivas):', top(porOp, 8));

  // created_at por mes (lotes)
  const porMes = new Map();
  for (const d of docs) { const t = d.created_at?.toDate?.(); if (t) inc(porMes, t.toISOString().slice(0, 7)); else inc(porMes, '(sin fecha)'); }
  console.log('  fichas creadas por mes:', [...porMes.entries()].sort().slice(-8));

  // Pool de SIM
  const sims = await db.collection('sim_cards').get();
  const simDocs = sims.docs.map(d => ({ id: d.id, ...d.data() }));
  const simDisp = simDocs.filter(s => s.estado === 'disponible').length;
  const simAsig = simDocs.filter(s => s.estado === 'asignado');
  const simEnDevice = new Map(); for (const d of vivas) { const k = simN(d.sim_number); if (k) simEnDevice.set(k, d); }
  const asigSinDevice = simAsig.filter(s => { const dev = simEnDevice.get(simN(s.sim_number)); return !dev; }).length;
  const asigOtroDevice = simAsig.filter(s => { const dev = simEnDevice.get(simN(s.sim_number)); return dev && s.asignado_a?.device_id && dev.id !== s.asignado_a.device_id; }).length;
  const dispPeroEnRadio = simDocs.filter(s => s.estado === 'disponible' && simEnDevice.has(simN(s.sim_number))).length;
  const simIds = new Set(simDocs.map(s => simN(s.sim_number)));
  const devSimFueraPool = activas.filter(d => simN(d.sim_number) && !simIds.has(simN(d.sim_number))).length;
  console.log(`  sim_cards: ${simDocs.length} (disponibles ${simDisp} · asignados ${simAsig.length}); asignados sin radio vivo ${asigSinDevice}; asignados a OTRO radio ${asigOtroDevice}; "disponibles" pero puestos en un radio vivo ${dispPeroEnRadio}; radios activos con SIM fuera del pool ${devSimFueraPool}`);
  const porOrigen = new Map(); simDocs.forEach(s => inc(porOrigen, s.origen || '?')); console.log('  sim_cards por origen:', top(porOrigen));

  // Lotes preparados
  const lotes = await db.collection('poc_lotes_preparados').get();
  const porEstadoLote = new Map(); lotes.docs.forEach(d => inc(porEstadoLote, d.data().estado || '?'));
  console.log(`  poc_lotes_preparados: ${lotes.size}`, top(porEstadoLote));

  // poc_logs últimos 30 días (proxy de las acciones del brief)
  const desde = new Date(Date.now() - 30 * 86400000);
  const logs = await db.collection('poc_logs').where('fecha', '>=', desde).get();
  const L = logs.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`\npoc_logs últimos 30 días: ${L.length}`);
  const porUsuario = new Map(), porTipo = new Map(), simPorUsuario = new Map(), simPorTipo = new Map(), porDia = new Map();
  const claseLog = (l) => {
    if (l.accion) return l.accion;                          // eliminar / restaurar
    const a = l.cambios?.antes || {}, b = l.cambios?.despues || {};
    const simCambio = simN(a.sim_number) !== simN(b.sim_number);
    const keys = Object.keys(b);
    if (simCambio && simN(b.sim_number) === '' && a.sim_number) return 'sim-liberado';
    if (simCambio && keys.includes('created_at') && !keys.includes('updated_by_email')) return 'sim-del-pool';
    if (simCambio && !keys.includes('serial')) return 'sim-modal-lote';
    if (simCambio) return 'sim-cajon-o-masiva';
    const cambiados = ['serial', 'unit_id', 'radio_name', 'grupos', 'activo', 'ip', 'operador', 'sim_phone', 'modelo_id', 'notas', 'gps'].filter(k => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
    return 'edicion:' + (cambiados.join('+') || 'sin-cambio');
  };
  for (const l of L) {
    const c = claseLog(l);
    inc(porUsuario, l.usuario || '?'); inc(porTipo, c);
    if (c.startsWith('sim')) { inc(simPorUsuario, l.usuario || '?'); inc(simPorTipo, c); }
    const t = l.fecha?.toDate?.(); if (t) inc(porDia, t.toISOString().slice(0, 10));
  }
  console.log('  por usuario:', top(porUsuario));
  console.log('  por tipo:', top(porTipo, 14));
  console.log('  cambios de SIM por usuario:', top(simPorUsuario));
  console.log('  cambios de SIM por vía:', top(simPorTipo));
  console.log('  días con más logs:', top(porDia, 6));
  // ¿el SIM que entró ya estaba en otro radio vivo en ese momento? (aprox: hoy)
  let simCruzado = 0;
  for (const l of L) { const b = l.cambios?.despues || {}; const k = simN(b.sim_number); if (!k) continue; const dev = porSim.get(k); if (dev && dev.length > 1) simCruzado++; }
  console.log(`  logs cuyo SIM entrante hoy vive en >1 ficha viva: ${simCruzado}`);

  // Candidatas para el recorrido (cliente chico con fichas activas con SIM)
  const chicos = [...porCliente.entries()].filter(([, n]) => n >= 3 && n <= 8);
  const cand = vivas.filter(d => d.activo !== false && !vacio(d.sim_number) && d.cliente_id && cliNombres.has(d.cliente_id) && chicos.some(([n]) => n === cliNombres.get(d.cliente_id))).slice(0, 6);
  console.log('\ncandidatas (cliente chico, activa, con SIM):');
  cand.forEach(d => console.log(`  ${d.id} | ${cliNombres.get(d.cliente_id)} | serial ${d.serial} | unit ${d.unit_id} | SIM ${d.sim_number} | tel ${d.sim_phone || '-'}`));
  const disp = simDocs.filter(s => s.estado === 'disponible').slice(0, 3);
  console.log('SIMs disponibles en el pool (3):', disp.map(s => `${s.id} ${s.operador || ''}`));
  const conMuchas = [...porCliente.entries()].find(([, n]) => n > 150);
  console.log('cliente grande para medir búsqueda:', conMuchas);
  const uso = await db.collection('uso_diario').get();
  const usoPoc = [];
  uso.docs.forEach(d => { const u = d.data(); const s = JSON.stringify(u); if (/POC/i.test(s)) usoPoc.push({ id: d.id, ...u }); });
  console.log(`\nuso_diario: ${uso.size} docs; con POC: ${usoPoc.length}`);
  usoPoc.slice(0, 3).forEach(u => console.log('  ', JSON.stringify(u).slice(0, 600)));
})().catch(e => { console.error(e); process.exit(1); });

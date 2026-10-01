// Verdad de los conteos del home y del panel admin, con Admin SDK contra el EMULADOR (solo lectura).
// Usa el espejo de dominio del servidor (functions/src/domain/pendientes.js), el mismo que el navegador.
// Correr desde functions/: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/home-nav/02-verdad-senales.js
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('SOLO contra el emulador'); process.exit(1); }
const admin = require('firebase-admin');
const P = require('../../../../functions/src/domain/pendientes.js');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const now = new Date();
const dias = (ts) => { const d = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d && !isNaN(d) ? Math.floor((now - d) / 86400000) : null; };
const cuenta = (arr, f) => arr.reduce((a, x) => { const k = f(x) || '(vacio)'; a[k] = (a[k] || 0) + 1; return a; }, {});
(async () => {
  const cfg = (await db.collection('empresa').doc('config').get()).data() || {};
  const D = P.DEFAULTS || { stale_dias: 10, stale_max_dias: 30, entrega_dias: 3 };
  const staleDias = Number(cfg.orden_stale_dias) || D.stale_dias, staleMax = Number(cfg.orden_stale_max_dias) || D.stale_max_dias, entregaDias = Number(cfg.entrega_recordatorio_dias) || D.entrega_dias;
  console.log('umbrales:', { staleDias, staleMax, entregaDias }, '| exports del dominio:', Object.keys(P).join(','));
  const all = (await db.collection('ordenes_de_servicio').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const vivas = all.filter(o => o.eliminado !== true);
  console.log('ordenes total', all.length, '| vivas', vivas.length, '| por estado (vivas):', JSON.stringify(cuenta(vivas, o => o.estado_reparacion)));
  // S1
  const pa = vivas.filter(o => o.estado_reparacion === 'POR ASIGNAR');
  const paTaller = pa.filter(o => P.esColaDeTaller ? P.esColaDeTaller(o) : String(o.tipo_de_servicio || '').toUpperCase() !== 'DEVOLUCION');
  const edadPA = (o) => dias(o.fecha_entrada || o.fecha_creacion) || 0;
  console.log('S1 POR ASIGNAR vivas', pa.length, '| de taller', paTaller.length, '| <=' + staleMax + 'd (tarjeta):', paTaller.filter(o => edadPA(o) <= staleMax).length, '| >' + staleMax + 'd (por depurar):', paTaller.filter(o => edadPA(o) > staleMax).length, '| fuera de cola (DEVOLUCION etc):', pa.length - paTaller.length);
  console.log('   por tipo (taller):', JSON.stringify(cuenta(paTaller, o => o.tipo_de_servicio)), '| mas viejas:', paTaller.slice().sort((a, b) => edadPA(b) - edadPA(a)).slice(0, 5).map(o => o.id + '(' + edadPA(o) + 'd)').join(' '));
  console.log('S2 RECIBIDO EN MOSTRADOR vivas:', vivas.filter(o => o.estado_reparacion === 'RECIBIDO EN MOSTRADOR').map(o => o.id + ' ' + (o.cliente_nombre || '')).join(', ') || 0);
  const asig = vivas.filter(o => o.estado_reparacion === 'ASIGNADO');
  console.log('S3 ASIGNADO vivas:', asig.length, '| >30d:', asig.filter(o => edadPA(o) > 30).length);
  // ENT
  const comp = vivas.filter(o => o.estado_reparacion === 'COMPLETADO (EN OFICINA)');
  const compTodas = all.filter(o => o.estado_reparacion === 'COMPLETADO (EN OFICINA)');
  const listas = comp.filter(o => P.esListaParaEntregar ? P.esListaParaEntregar(o, now, entregaDias) : false);
  const edadC = (o) => dias(o.fecha_completado || o.fecha_modificacion) || dias(o.fecha_creacion) || 0;
  console.log('ENT COMPLETADO docs (incl. eliminadas):', compTodas.length, '(la consulta topa en 150) | vivas', comp.length, '| esListaParaEntregar', listas.length, '| <=' + staleMax + 'd (tarjeta):', listas.filter(o => edadC(o) <= staleMax).length, '| >' + staleMax + 'd:', listas.filter(o => edadC(o) > staleMax).length, '| pospuestas:', listas.filter(o => P.estaPospuesto && P.estaPospuesto(o, now)).length);
  console.log('   completadas por tipo:', JSON.stringify(cuenta(comp, o => o.tipo_de_servicio)), '| ENTRADA completadas:', comp.filter(o => String(o.tipo_de_servicio || '').toUpperCase().includes('ENTRADA')).length, '| completadas >90d:', comp.filter(o => edadC(o) > 90).length);
  // EST
  const abiertasTodas = all.filter(o => ['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO'].includes(o.estado_reparacion));
  const esEst = (o) => P.esOrdenEstancada ? P.esOrdenEstancada(o, now, { staleDias, staleMax }) : false;
  const est = abiertasTodas.filter(esEst);
  const primeras150 = abiertasTodas.slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, 150);
  console.log('EST abiertas (docs, incl. eliminadas y DEVOLUCION):', abiertasTodas.length, '(la consulta topa en 150 por id asc) | estancadas de verdad:', est.length, '| dentro de las 150 primeras:', primeras150.filter(esEst).length, '| FUERA del tope:', est.length - primeras150.filter(esEst).length);
  // S4Q
  const qc = vivas.filter(o => o.qc_requerido === true && o.estado_reparacion === 'COMPLETADO (EN OFICINA)');
  console.log('S4Q qc_requerido+COMPLETADO:', qc.length, '| esQcColaOperativa:', qc.filter(o => P.esQcColaOperativa ? P.esQcColaOperativa(o) : false).length);
  // S5
  const us = (await db.collection('usuarios').get()).docs.map(d => ({ uid: d.id, ...d.data() }));
  for (const u of us.filter(x => /tecnico/.test(x.rol || ''))) {
    const mias = vivas.filter(o => o.tecnico_uid === u.uid && o.estado_reparacion === 'ASIGNADO');
    console.log('S5', u.email, '(' + u.rol + ') ASIGNADO vivas:', mias.length, '| >30d:', mias.filter(o => edadPA(o) > 30).length, '| completadas propias:', vivas.filter(o => o.tecnico_uid === u.uid && o.estado_reparacion === 'COMPLETADO (EN OFICINA)').length);
  }
  // Contratos
  const cts = (await db.collection('contratos').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const porEstado = cuenta(cts, c => c.estado);
  console.log('contratos por estado (todos):', JSON.stringify(porEstado), '| deleted:', cts.filter(c => c.deleted === true).length, '| aprobado y deleted:', cts.filter(c => c.estado === 'aprobado' && c.deleted === true).length, '| aprobado legacy/sin cliente_id:', cts.filter(c => c.estado === 'aprobado' && !c.cliente_id).length);
  console.log('   aprobado por codigo_tipo:', JSON.stringify(cuenta(cts.filter(c => c.estado === 'aprobado' && c.deleted !== true), c => c.codigo_tipo)), '| aprobado por seriales_estado:', JSON.stringify(cuenta(cts.filter(c => c.estado === 'aprobado' && c.deleted !== true), c => c.seriales_estado)), '| aprobado firmado==true:', cts.filter(c => c.estado === 'aprobado' && c.firmado === true).length, '| entrega_confirmada:', cts.filter(c => c.estado === 'aprobado' && c.entrega_confirmada === true).length);
  const apr = cts.filter(c => c.estado === 'aprobado' && c.seriales_estado === 'asignados');
  const lleva = (c) => !['REEMP', 'DEMO'].includes(c.codigo_tipo);
  const fir = apr.filter(c => c.deleted !== true && c.firmado !== true && c.entrega_confirmada !== true && lleva(c));
  const quien = (uid) => { const u = us.find(x => x.uid === uid); return u ? u.email.split('@')[0] : (uid || 'sin uid'); };
  console.log('FIR aprobado+asignados:', apr.length, '| por firmar (regla del home):', fir.length, '| con orden (os_count>0):', fir.filter(c => Number(c.os_count || 0) > 0).length, '| por vendedor:', JSON.stringify(cuenta(fir, c => quien(c.creado_por_uid))));
  console.log('   detalle:', fir.map(c => c.contrato_id + '(' + c.codigo_tipo + ',' + String(c.cliente_nombre || '').slice(0, 22) + ',' + dias(c.seriales_asignados_at || c.fecha_aprobacion || c.fecha_creacion) + 'd)').join(' | '));
  const s15 = cts.filter(c => c.seriales_estado === 'pendiente' && ['aprobado', 'activo'].includes(c.estado));
  console.log('S15 seriales pendiente & vigente:', s15.length, '| deleted entre ellos:', s15.filter(c => c.deleted === true).length, '| detalle:', s15.map(c => c.contrato_id + '(' + dias(c.fecha_aprobacion || c.fecha_creacion) + 'd)').join(' '));
  console.log('APR contratos pendiente_aprobacion (no deleted):', cts.filter(c => c.estado === 'pendiente_aprobacion' && c.deleted !== true).length);
  const ges = (await db.collection('gestiones').get()).docs.map(d => d.data());
  console.log('APR gestiones por estado:', JSON.stringify(cuenta(ges, g => g.estado)));
  const opc = cts.filter(c => c.seriales_estado === 'asignados' && ['aprobado', 'activo'].includes(c.estado) && c.deleted !== true);
  console.log('OPC candidatos (asignados, vigentes):', opc.length, '| sin os_count:', opc.filter(c => !Number(c.os_count || 0)).length, '| con marca de descarte:', opc.filter(c => !Number(c.os_count || 0) && (c.orden_prog_descarte || c.orden_programacion_descartada || c.descarte_orden)).length);
  // Pool
  const pool = (await db.collection('equipos_pool').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  console.log('pool por estado:', JSON.stringify(cuenta(pool, u => u.estado)));
  const edadU = (u) => dias(u.updated_at || u.created_at) || 0;
  const dr = pool.filter(u => u.estado === 'devuelto_revision');
  console.log('S13 devuelto_revision:', dr.length, '| >7d:', dr.filter(u => edadU(u) > 7).length, '| >30d:', dr.filter(u => edadU(u) > 30).length, '| >90d:', dr.filter(u => edadU(u) > 90).length);
  const pc = pool.filter(u => u.estado === 'por_clasificar');
  console.log('S14 por_clasificar:', pc.length, '| >30d:', pc.filter(u => edadU(u) > 30).length, '| >90d:', pc.filter(u => edadU(u) > 90).length, '| S12 verificado==false:', pool.filter(u => u.verificado === false).length);
  const piezas = (await db.collection('inventario_piezas').get()).docs.map(d => d.data());
  console.log('S9 piezas activas en 0 sin libre:', piezas.filter(p => p.activo === true && Number(p.cantidad) === 0 && p.sin_control_inventario !== true).length, '| total', piezas.length);
  const lotes = (await db.collection('poc_lotes_preparados').get()).docs.map(d => d.data());
  console.log('LPC lotes por estado:', JSON.stringify(cuenta(lotes, l => l.estado)));
  // Cotizaciones
  const cot = (await db.collection('cotizaciones').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  console.log('cotizaciones por estado (no deleted):', JSON.stringify(cuenta(cot.filter(c => c.deleted !== true), c => c.estado)), '| deleted:', cot.filter(c => c.deleted === true).length);
  console.log('SAP borrador+requiere_aprobacion:', cot.filter(c => c.deleted !== true && c.estado === 'borrador' && c.requiere_aprobacion === true).length);
  for (const u of us) { const n = cot.filter(c => c.deleted !== true && c.creado_por_uid === u.uid && ['borrador', 'enviada', 'aprobada'].includes(c.estado)).length; if (n) console.log('S7', u.email, n); }
  // Regularizacion
  const cl = (await db.collection('clientes').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const reg = cl.filter(c => !c.deleted && c.activo !== false && c.regularizacion && c.regularizacion.puntos > 0 && !c.regularizacion.solo_bodega);
  console.log('REGG cuentas por regularizar:', reg.length, '| sin vendedor:', reg.filter(c => !c.vendedor_email).length, '| por nivel:', JSON.stringify(cuenta(reg, c => c.regularizacion.nivel)), '| con puntos>0 (tope 400):', cl.filter(c => c.regularizacion && c.regularizacion.puntos > 0).length);
  for (const u of us.filter(x => ['vendedor', 'administrador'].includes(x.rol))) { const n = reg.filter(c => c.vendedor_asignado === u.uid).length; if (n) console.log('REGV', u.email, n); }
  // Admin KPIs
  const ab = vivas.filter(o => ['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO'].includes(o.estado_reparacion));
  console.log('ADMIN KPI ordenes abiertas (vivas, sin DEVOLUCION):', ab.filter(o => String(o.tipo_de_servicio || '').toUpperCase() !== 'DEVOLUCION').length, '| completadas vivas:', comp.length, '| entregadas vivas:', vivas.filter(o => o.estado_reparacion === 'ENTREGADO AL CLIENTE').length);
  console.log('ADMIN KPI contratos (count() sin filtrar deleted):', JSON.stringify({ pendiente_aprobacion: porEstado.pendiente_aprobacion || 0, aprobado: porEstado.aprobado || 0, activo: porEstado.activo || 0 }), '| sin deleted:', JSON.stringify({ pendiente_aprobacion: cts.filter(c => c.estado === 'pendiente_aprobacion' && c.deleted !== true).length, aprobado: cts.filter(c => c.estado === 'aprobado' && c.deleted !== true).length, activo: cts.filter(c => c.estado === 'activo' && c.deleted !== true).length }));
  const poc = (await db.collection('poc_devices').get()).docs.map(d => d.data());
  console.log('ADMIN KPI poc activos (activo==true, no deleted):', poc.filter(p => p.activo === true && p.deleted !== true).length, '| total no deleted:', poc.filter(p => p.deleted !== true).length, '| sin campo activo:', poc.filter(p => p.activo == null).length);
  const ea = cot.filter(c => c.deleted !== true && ['enviada', 'aprobada'].includes(c.estado));
  const dleft = (c) => { const f = c.fecha && c.fecha.toDate ? c.fecha.toDate() : new Date(c.fecha); const v = c.validezDias || c.validez_dias || 15; return Math.ceil((f.getTime() + v * 86400000 - now.getTime()) / 86400000); };
  console.log('ADMIN KPI cotizaciones enviadas/aprobadas:', ea.length, '| vencidas:', ea.filter(c => dleft(c) < 0).length, '| por vencer <=7d:', ea.filter(c => dleft(c) >= 0 && dleft(c) <= 7).length, '| aprobadas vencidas:', ea.filter(c => c.estado === 'aprobada' && dleft(c) < 0).length);
  console.log('usuarios sin rol:', us.filter(u => !u.rol).map(u => u.email).join(',') || 'ninguno', '| roles:', JSON.stringify(cuenta(us, u => u.rol)), '| correos fuera del dominio:', us.filter(u => !/@cecomunica\.com$/.test(u.email || '')).map(u => u.email + '(' + u.rol + ')').join(','));
  const uso = (await db.collection('uso_diario').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  console.log('uso_diario docs:', uso.map(u => u.id + ': ' + Object.keys(u.paginas || {}).length + ' pantallas, ' + Object.keys(u.usuarios || {}).length + ' usuarios').join(' ; '));
})().catch(e => { console.error(e); process.exit(1); });

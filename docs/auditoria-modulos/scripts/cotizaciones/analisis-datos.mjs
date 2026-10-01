// Auditoría de módulos 2026-09-30 · Cotizaciones · análisis de datos.
// Lee el export de producción (tools/emulador-almacen/emu-data.json, en
// .gitignore) SOLO LECTURA y saca los números del módulo: estados, origen,
// eliminadas (cuándo, quién, en qué estado, con qué contenido), borradores de
// taller, aperturas del enlace público y respuestas del cliente.
//   node docs/auditoria-modulos/scripts/cotizaciones/analisis-datos.mjs
import fs from 'node:fs';
const J = JSON.parse(fs.readFileSync('C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-data.json', 'utf8'));
const ts = (v) => (v && v.__ts) ? new Date(v.__ts) : null;
const HOY = new Date('2026-09-30T23:59:59-05:00');
const HACE30 = new Date(HOY.getTime() - 30 * 864e5);
const cnt = (arr, f) => { const m = {}; arr.forEach(x => { const k = f(x) ?? '(vacío)'; m[k] = (m[k] || 0) + 1; }); return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };

const cots = J.cotizaciones.map(d => ({ id: d.id, ...d.data }));
console.log('== cotizaciones totales:', cots.length);
console.log('estado:', cnt(cots, c => c.estado || 'borrador'));
console.log('origen:', cnt(cots, c => c.origen || 'comercial'));
console.log('deleted:', cnt(cots, c => String(!!c.deleted)));
console.log('creado_por_email:', cnt(cots, c => c.creado_por_email));
console.log('requiere_aprobacion:', cnt(cots, c => String(c.requiere_aprobacion)));
console.log('rechazo_origen:', cnt(cots.filter(c => c.estado === 'rechazada'), c => c.rechazo_origen));
console.log('respuesta_cliente presente:', cots.filter(c => c.respuesta_cliente).length);

const ult30 = cots.filter(c => ts(c.fecha_creacion) >= HACE30);
console.log('\n== creadas en los últimos 30 días:', ult30.length);
console.log('estado:', cnt(ult30, c => c.estado || 'borrador'));
console.log('origen:', cnt(ult30, c => c.origen || 'comercial'));
console.log('por quién:', cnt(ult30, c => c.creado_por_email));
console.log('deleted:', cnt(ult30, c => String(!!c.deleted)));
console.log('por semana:', cnt(ult30, c => ts(c.fecha_creacion).toISOString().slice(0, 10).replace(/-\d\d$/, m => '-' + String(Math.ceil(Number(m.slice(1)) / 7)).padStart(2, 'sem'))));

const del = cots.filter(c => c.deleted);
console.log('\n== ELIMINADAS (deleted=true):', del.length);
console.log('deleted_at en últimos 30 d:', del.filter(c => ts(c.deleted_at) >= HACE30).length);
console.log('estado al eliminar:', cnt(del, c => c.estado || 'borrador'));
console.log('origen:', cnt(del, c => c.origen || 'comercial'));
console.log('quién la creó:', cnt(del, c => c.creado_por_email));
console.log('n.º de renglones:', cnt(del, c => (c.items || []).length));
console.log('total = 0:', del.filter(c => !Number(c.total)).length);
console.log('sin cliente:', del.filter(c => !c.cliente_id).length);
console.log('tiene orden_id:', del.filter(c => c.orden_id).length);
console.log('tiene gestion_id (reposición):', del.filter(c => c.gestion_id).length);
console.log('fue enviada (enviada_en):', del.filter(c => c.enviada_en).length);
console.log('minutos entre creación y borrado (mediana/percentiles):');
const mins = del.filter(c => ts(c.deleted_at) && ts(c.fecha_creacion)).map(c => (ts(c.deleted_at) - ts(c.fecha_creacion)) / 6e4).sort((a, b) => a - b);
const pct = (p) => mins[Math.floor((mins.length - 1) * p)];
console.log('  n=', mins.length, 'p10=', pct(0.1)?.toFixed(1), 'p50=', pct(0.5)?.toFixed(1), 'p90=', pct(0.9)?.toFixed(1), 'max=', pct(1)?.toFixed(1));
console.log('  < 10 min:', mins.filter(m => m < 10).length, ' < 1 h:', mins.filter(m => m < 60).length, ' < 1 día:', mins.filter(m => m < 1440).length);
// ¿Se rehizo para el mismo cliente el mismo día? (hipótesis: se borra y se vuelve a hacer)
let rehechas = 0;
const detalleDel = [];
del.forEach(d => {
  const t = ts(d.fecha_creacion);
  const otra = cots.find(c => c.id !== d.id && !c.deleted && c.cliente_id && c.cliente_id === d.cliente_id && ts(c.fecha_creacion) && Math.abs(ts(c.fecha_creacion) - t) < 3 * 864e5);
  if (otra) rehechas++;
  detalleDel.push({
    cot: d.cotizacion_id, estado: d.estado || 'borrador', origen: d.origen || 'comercial', por: (d.creado_por_email || '').split('@')[0],
    creada: t ? t.toISOString().slice(0, 16) : '', borrada: ts(d.deleted_at) ? ts(d.deleted_at).toISOString().slice(0, 16) : '',
    items: (d.items || []).length, total: Number(d.total || 0).toFixed(0), orden: d.orden_id || '', rehecha: otra ? (otra.cotizacion_id + ' ' + (otra.estado || 'borrador')) : '',
  });
});
console.log('con otra cotización viva del mismo cliente a ±3 días:', rehechas);
console.table(detalleDel.sort((a, b) => (b.borrada || '').localeCompare(a.borrada || '')));
// Mismo número COT repetido (colisión del correlativo)
const porNum = cnt(cots, c => c.cotizacion_id);
const repetidos = Object.entries(porNum).filter(([, n]) => n > 1);
console.log('números COT repetidos:', repetidos.length, repetidos.slice(0, 15));

// Borradores de taller (subcolección) y consumos
const borr = (J['__group__/borradores_cotizacion'] || []).map(d => ({ path: d.path, ...d.data }));
console.log('\n== borradores_cotizacion vivos:', borr.length);
borr.forEach(b => console.log('  ', b.path, 'updated', ts(b.updated_at)?.toISOString().slice(0, 16), 'líneas', Object.values(b.lineas || {}).reduce((s, a) => s + (a || []).length, 0), 'cliente', !!b.form?.clienteId));
const cons = (J['__group__/consumos'] || []).map(d => ({ path: d.path, ...d.data }));
console.log('consumos registrados por técnicos:', cons.length, 'órdenes distintas:', new Set(cons.map(c => c.path.split('/')[1])).size, 'tipo:', cnt(cons, c => c.tipo), 'fuera_catalogo:', cons.filter(c => c.fuera_catalogo).length);
const cons30 = cons.filter(c => ts(c.added_at) >= HACE30);
console.log('consumos en últimos 30 d:', cons30.length, 'órdenes:', new Set(cons30.map(c => c.path.split('/')[1])).size, 'por quién:', cnt(cons30, c => c.added_by_email));
// ¿Cuánto se teclea en una cotización de taller? renglones de las creadas en 30 días.
const taller30 = cots.filter(c => c.origen === 'orden' && ts(c.fecha_creacion) >= HACE30);
const ren = taller30.map(c => (c.items || []).length).sort((a, b) => a - b);
console.log('taller creadas en 30 d:', taller30.length, 'renglones:', ren.join(','), 'suma:', ren.reduce((a, b) => a + b, 0), 'campos tecleables (4 por renglón):', ren.reduce((a, b) => a + b, 0) * 4);
console.log('  → 679 autoguardados / ' + taller30.length + ' cotizaciones = ' + (679 / taller30.length).toFixed(1) + ' guardados por cotización; con 600 ms de debounce eso es una pausa cada ~' + (ren.reduce((a, b) => a + b, 0) * 4 / 679).toFixed(1) + ' campos');
console.log('  → borrados de borradores_cotizacion en 30 d (uno por cotización generada + "Empezar de cero" + descartes por edad): al menos', taller30.length);
// Enviadas vivas: cuántos días llevan esperando
const HOY0 = new Date('2026-09-30T12:00:00Z');
const env = cots.filter(c => c.estado === 'enviada' && !c.deleted).map(c => Math.round((HOY0 - (ts(c.enviada_en) || ts(c.fecha_creacion))) / 864e5)).sort((a, b) => a - b);
console.log('enviadas vivas:', env.length, 'días esperando:', env.join(','), '| >14 días:', env.filter(d => d > 14).length);
console.log('vencidas por el cron (vencida_auto):', cots.filter(c => c.estado === 'vencida' && c.vencida_auto).length, 'a mano:', cots.filter(c => c.estado === 'vencida' && c.vencida_manual).length);
console.log('cerradas por una persona (convertida/rechazada/descartada, vivas):', cots.filter(c => !c.deleted && ['convertida', 'rechazada', 'descartada'].includes(c.estado)).length, 'de', cots.filter(c => !c.deleted).length);

// Taller: cotizaciones de orden
const taller = cots.filter(c => c.origen === 'orden');
console.log('\n== TALLER (origen=orden):', taller.length, 'vivas:', taller.filter(c => !c.deleted).length);
console.log('estado:', cnt(taller.filter(c => !c.deleted), c => c.estado || 'borrador'));
console.log('facturacion.estado:', cnt(taller, c => c.facturacion?.estado));
console.log('items por cotización (vivas):', cnt(taller.filter(c => !c.deleted), c => (c.items || []).length));
console.log('cliente aceptó vía enlace (respuesta_cliente):', taller.filter(c => c.respuesta_cliente).length, cnt(taller.filter(c => c.respuesta_cliente), c => c.respuesta_cliente?.decision || c.respuesta_cliente?.respuesta));
console.log('aceptación manual (aceptacion / cierre):', cnt(taller.filter(c => c.estado === 'convertida'), c => c.aceptacion?.via || c.aceptacion?.medio || (c.aceptacion ? 'con aceptacion' : 'sin aceptacion')));
const ords = J.ordenes_de_servicio.map(d => ({ id: d.id, ...d.data }));
const ordsConCot = ords.filter(o => o.cotizacion_doc_id);
console.log('órdenes con cotizacion_doc_id:', ordsConCot.length, 'con cotizaciones_ids>1:', ords.filter(o => (o.cotizaciones_ids || []).length > 1).length);
console.log('órdenes con cotizacion_emitida:', ords.filter(o => o.cotizacion_emitida).length);
// Orden → cuántas cotizaciones (vivas y borradas) tiene
const porOrden = {};
taller.forEach(c => { (porOrden[c.orden_id] = porOrden[c.orden_id] || []).push(c); });
const multi = Object.entries(porOrden).filter(([, l]) => l.length > 1);
console.log('órdenes con más de una cotización:', multi.length);
multi.slice(0, 12).forEach(([o, l]) => console.log('  ', o, l.map(c => `${c.cotizacion_id}:${c.estado || 'borrador'}${c.deleted ? '(del)' : ''}`).join(' · ')));

// Comercial
const com = cots.filter(c => c.origen !== 'orden' && !c.deleted);
console.log('\n== COMERCIAL vivas:', com.length, 'estado:', cnt(com, c => c.estado || 'borrador'));
console.log('descuentoPct:', cnt(com, c => Number(c.descuentoPct || 0)));
console.log('requiere_aprobacion:', cnt(com, c => String(c.requiere_aprobacion)));
console.log('total > 5000:', com.filter(c => Number(c.total) > 5000).length);
console.log('con adjuntos:', com.filter(c => (c.adjuntos || []).length).length, 'con total_mensual:', com.filter(c => Number(c.total_mensual) > 0).length, 'incluye_carta:', cnt(com, c => String(c.incluye_carta)));
console.log('fecha_aprobacion presente:', com.filter(c => c.fecha_aprobacion).length, 'enviada_en presente:', com.filter(c => c.enviada_en).length);

// Enlace público
const opens = J.cotizacion_opens.map(d => d.data);
console.log('\n== cotizacion_opens:', opens.length, 'cotizaciones distintas:', new Set(opens.map(o => o.cotizacion_doc_id || o.cotizacion_id || o.docId)).size);
const ver = J.cotizacion_verificaciones.map(d => ({ id: d.id, ...d.data }));
console.log('cotizacion_verificaciones:', ver.length, 'con estado espejado:', ver.filter(v => v.estado).length, 'estado:', cnt(ver, v => v.estado));
console.log('con respuesta del cliente en el espejo:', ver.filter(v => v.respuesta || v.respuesta_cliente).length);
// Campos de muestra
console.log('\ncampos de una cotización de taller:', Object.keys(taller.find(c => !c.deleted) || {}).sort().join(', '));
console.log('campos de una comercial:', Object.keys(com[0] || {}).sort().join(', '));
console.log('campos de respuesta_cliente:', JSON.stringify(cots.find(c => c.respuesta_cliente)?.respuesta_cliente || null));
console.log('campos de facturacion:', JSON.stringify(taller.find(c => c.facturacion)?.facturacion || null));
console.log('uso_diario:', JSON.stringify(J.uso_diario.map(d => ({ id: d.id, paginas: Object.entries(d.data.paginas || d.data || {}).filter(([k]) => /cotiz/.test(k)) }))).slice(0, 1500));

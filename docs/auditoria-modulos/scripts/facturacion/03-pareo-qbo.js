// ¿Qué tan bien pareó (o parearía) el match Clientes ↔ QuickBooks? Solo lectura sobre el EMULADOR.
// No hay lista de Customers de QBO (la callable no corre aquí): se usa lo que ya quedó guardado en
// clientes.qbo_customer_name para medir cuántos vínculos hechos a mano habría sugerido el algoritmo
// por nombre (misma función nombreParecido de facturacion-clientes-qbo.js), y cuántos clientes con
// contrato vivo siguen sin vínculo y con qué datos cuentan. No imprime nombres de clientes.
// Correr desde functions/:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/facturacion/03-pareo-qbo.js
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const STOP = new Set(['SA','S','A','INC','CORP','SRL','SL','LTD','DE','DEL','LA','EL','LOS','LAS','Y','CIA','COMPANIA','PH']);
const tokens = (s) => String(s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9\s]/g,' ').split(/\s+/).filter(t=>t.length>=3 && !STOP.has(t));
const parecido = (a,b) => { const ta=tokens(a), tb=tokens(b); if(!ta.length||!tb.length) return 0; const B=new Set(tb); const sh=ta.filter(t=>B.has(t)).length; return sh/Math.min(ta.length,tb.length); };
const norm = (s) => String(s||'').trim().toLowerCase();
(async () => {
  const cl = (await db.collection('clientes').get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.deleted !== true);
  const ct = (await db.collection('contratos').get()).docs.map(d => d.data()).filter(c => ['activo','aprobado'].includes(c.estado));
  const vivos = new Set(ct.map(c => c.cliente_id).filter(Boolean));
  const link = cl.filter(c => c.qbo_customer_id);
  let exacto = 0, tokens34 = 0, ninguno = 0, sinNombreQbo = 0; const porQuien = {}; const porMes = {};
  link.forEach(c => { const n = c.empresa || c.nombre; const q = c.qbo_customer_name;
    if (!q) { sinNombreQbo++; return; }
    if (norm(n) === norm(q)) exacto++; else if (parecido(n, q) >= 0.34) tokens34++; else ninguno++;
    porQuien[c.qbo_vinculado_por || '(sin rastro)'] = (porQuien[c.qbo_vinculado_por || '(sin rastro)'] || 0) + 1;
    const m = c.qbo_vinculado_at?.toDate ? c.qbo_vinculado_at.toDate().toISOString().slice(0,7) : '(sin fecha)'; porMes[m] = (porMes[m] || 0) + 1; });
  console.log('vinculados', link.length, { nombreExacto: exacto, nombreParecido34: tokens34, nombreNoParecido: ninguno, sinNombreQbo, porQuien, porMes });
  // Regla 1 a 1: ¿hay Customers repetidos en dos clientes?
  const rep = {}; link.forEach(c => { (rep[c.qbo_customer_id] = rep[c.qbo_customer_id] || []).push(c.id); });
  const dup = Object.values(rep).filter(a => a.length > 1);
  console.log('customers QBO usados por más de un cliente', dup.length, dup.map(a => a.length));
  // Clientes con contrato vivo sin vínculo: con qué datos cuentan
  const pend = cl.filter(c => vivos.has(c.id) && !c.qbo_customer_id);
  const conRuc = pend.filter(c => c.ruc || c.cedula).length;
  const activos = pend.filter(c => c.activo === true).length;
  console.log('con contrato vivo y SIN vínculo', pend.length, { conRuc, sinRuc: pend.length - conRuc, marcadosActivo: activos });
  // Clientes vivos con vínculo: ¿tienen RUC? (para estimar el pareo por RUC en QBO ~84% con RUC)
  const vl = cl.filter(c => vivos.has(c.id) && c.qbo_customer_id);
  console.log('con contrato vivo y CON vínculo', vl.length, { conRuc: vl.filter(c => c.ruc || c.cedula).length });
  // Muestra anónima de los "no parecidos" (solo tokens compartidos y largo), para juzgar el algoritmo
  const ej = link.filter(c => c.qbo_customer_name && norm(c.empresa||c.nombre) !== norm(c.qbo_customer_name) && parecido(c.empresa||c.nombre, c.qbo_customer_name) < 0.34)
    .slice(0, 8).map(c => ({ tokensApp: tokens(c.empresa||c.nombre).length, tokensQbo: tokens(c.qbo_customer_name).length, comparten: tokens(c.empresa||c.nombre).filter(t => new Set(tokens(c.qbo_customer_name)).has(t)).length, appEmpiezaIgual: norm(c.empresa||c.nombre).slice(0,6) === norm(c.qbo_customer_name).slice(0,6) }));
  console.log('muestra no parecidos (anónima)', ej);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

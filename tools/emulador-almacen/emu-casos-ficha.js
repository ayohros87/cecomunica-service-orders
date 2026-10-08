// Elige clientes del emulador para recorrer la ficha v3 (2026-10-08). Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../tools/emulador-almacen/emu-casos-ficha.js
const admin = require('firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('FALTA FIRESTORE_EMULATOR_HOST'); process.exit(2); }
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const n = async (col) => (await db.collection(col).count().get()).data().count;
  const conteo = { clientes: await n('clientes'), contratos: await n('contratos'), equipos_pool: await n('equipos_pool'), gestiones: await n('gestiones'), usuarios: await n('usuarios') };
  console.log('conteo', JSON.stringify(conteo));
  if (!conteo.clientes) { console.log('SIN_DATOS'); return; }
  const cli = (await db.collection('clientes').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const con = (await db.collection('contratos').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const ges = (await db.collection('gestiones').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const porCli = (id) => con.filter(c => c.cliente_id === id && !c.deleted);
  const buscar = (re) => cli.find(c => re.test(c.nombre || ''));
  const out = {};
  const pon = (k, c) => { if (!c) return; const cs = porCli(c.id); out[k] = { id: c.id, nombre: c.nombre, vendedor: c.vendedor_email, contratos: cs.length, estados: [...new Set(cs.map(x => x.estado))], gestiones: ges.filter(g => g.cliente_id === c.id).length }; };
  pon('agencia', buscar(/AGENCIA DE SEGURIDAD UNIDA/i));
  pon('seprosa', buscar(/SEPROSA/i));
  pon('ccomunica', cli.find(c => /^C COMUNICA$/i.test((c.nombre || '').trim())));
  // Un cliente de Karla con contratos vigentes y gestiones.
  const karla = cli.filter(c => c.vendedor_email === 'karla.ferrer@cecomunica.com' && porCli(c.id).some(x => x.estado === 'activo'))
    .sort((a, b) => ges.filter(g => g.cliente_id === b.id).length - ges.filter(g => g.cliente_id === a.id).length)[0];
  pon('karla', karla);
  // Un cliente sin contratos (cuenta nueva) y activo.
  pon('nuevo', cli.find(c => c.activo !== false && !c.deleted && porCli(c.id).length === 0 && c.vendedor_email));
  // Contrato pendiente de aprobación → su cliente.
  const pend = con.find(c => c.estado === 'pendiente_aprobacion' && !c.deleted);
  if (pend) pon('pendiente', cli.find(c => c.id === pend.cliente_id));
  // Un vendedor con cartera: para la vista de la vendedora.
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });

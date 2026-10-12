// Lee uso_diario de PRODUCCIÓN (solo lectura, Admin SDK con ADC) y agrega:
// páginas por día y por usuario, acciones, dispositivos y orígenes.
//   cd functions && NODE_PATH=./node_modules node ../tools/uso/leer-uso-diario.js [dias]
// Nunca escribe. No poner FIRESTORE_EMULATOR_HOST: aquí se quiere producción.
const admin = require('firebase-admin');
if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('Quita FIRESTORE_EMULATOR_HOST: este script lee producción'); process.exit(2); }
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const DIAS = Number(process.argv[2] || 14);

(async () => {
  // Los ids son fechas YYYY-MM-DD (Panamá): se piden por id, sin índice.
  const hoy = new Date(Date.now() - 5 * 3600 * 1000);
  const ids = Array.from({ length: DIAS }, (_, i) => { const d = new Date(hoy); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10); });
  const refs = ids.map(id => db.collection('uso_diario').doc(id));
  const docs = (await db.getAll(...refs)).filter(d => d.exists);
  const snap = { size: docs.length, docs };
  const usuarios = new Map((await db.collection('usuarios').get()).docs.map(d => [d.id, { email: d.data().email, rol: d.data().rol, nombre: d.data().nombre }]));
  const suma = (into, obj) => { for (const [k, v] of Object.entries(obj || {})) if (typeof v === 'number') into[k] = (into[k] || 0) + v; };
  const paginas = {}, acciones = {}, dispositivos = {}, origenes = {};
  const porUsuario = {}, porUsuarioAcc = {}, porDia = {};
  for (const d of snap.docs) {
    const x = d.data();
    porDia[d.id] = Object.values(x.paginas || {}).reduce((s, n) => s + (Number(n) || 0), 0);
    suma(paginas, x.paginas); suma(acciones, x.acciones); suma(dispositivos, x.dispositivos); suma(origenes, x.origenes);
    for (const [uid, pags] of Object.entries(x.usuarios || {})) { porUsuario[uid] = porUsuario[uid] || {}; suma(porUsuario[uid], pags); }
    for (const [uid, accs] of Object.entries(x.usuarios_acciones || {})) { porUsuarioAcc[uid] = porUsuarioAcc[uid] || {}; suma(porUsuarioAcc[uid], accs); }
  }
  const top = (o, n = 40) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const total = Object.values(paginas).reduce((s, n) => s + n, 0);
  console.log(`\n== ${snap.size} días (${snap.docs[snap.size - 1]?.id} → ${snap.docs[0]?.id}) · ${total} vistas de página`);
  console.log('\n-- por día'); Object.entries(porDia).sort().forEach(([d, n]) => console.log(`  ${d}  ${n}`));
  console.log('\n-- páginas (vistas · % · usuarios distintos)');
  for (const [p, n] of top(paginas, 45)) {
    const us = Object.entries(porUsuario).filter(([, pg]) => pg[p]).length;
    console.log(`  ${String(n).padStart(5)}  ${(100 * n / total).toFixed(1).padStart(5)}%  ${String(us).padStart(2)}u  ${p}`);
  }
  console.log('\n-- acciones (desde 2026-10-09)'); for (const [a, n] of top(acciones, 60)) console.log(`  ${String(n).padStart(5)}  ${a}`);
  console.log('\n-- dispositivos', JSON.stringify(dispositivos));
  console.log('\n-- orígenes (desde>hasta)'); for (const [o, n] of top(origenes, 40)) console.log(`  ${String(n).padStart(5)}  ${o}`);
  console.log('\n-- por usuario (rol · vistas · sus 6 páginas más vistas)');
  for (const [uid, pg] of Object.entries(porUsuario).sort((a, b) => Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0))) {
    const u = usuarios.get(uid) || {}; const tot = Object.values(pg).reduce((s, n) => s + n, 0);
    console.log(`  ${(u.email || uid).padEnd(36)} ${(u.rol || '?').padEnd(18)} ${String(tot).padStart(4)}  ${top(pg, 6).map(([p, n]) => `${p}:${n}`).join('  ')}`);
    const acc = porUsuarioAcc[uid]; if (acc) console.log(`  ${''.padEnd(36)} acciones: ${top(acc, 8).map(([a, n]) => `${a}:${n}`).join('  ')}`);
  }
})().catch(e => { console.error(e); process.exit(1); });

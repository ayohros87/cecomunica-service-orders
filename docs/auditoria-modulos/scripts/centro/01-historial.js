// ¿Qué se cambia en las fichas de clientes y quién? Lee clientes/*/historial (inmutable) de los últimos 30 días. Solo lectura, emulador.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../docs/auditoria-modulos/scripts/centro/01-historial.js  (desde functions/)
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collectionGroup('historial').get();
  const desde = Date.now() - 30 * 86400000;
  const porCampo = {}, porUsuario = {}, porDia = {}, campoUsuario = {};
  let n = 0, ejemplo = null;
  for (const d of snap.docs) {
    if (d.ref.parent.parent?.parent?.id !== 'clientes') continue;
    const h = d.data();
    const ts = h.fecha?.toMillis ? h.fecha.toMillis() : (h.at?.toMillis ? h.at.toMillis() : (h.timestamp?.toMillis ? h.timestamp.toMillis() : null));
    if (!ejemplo) ejemplo = h;
    if (!ts || ts < desde) continue;
    n++;
    const campos = Array.isArray(h.cambios) ? h.cambios.map(c => c.campo) : (h.campo ? [h.campo] : Object.keys(h.cambios || h.diff || {}));
    const u = h.usuario_email || h.por_email || h.by || h.usuario || h.uid || '?';
    porUsuario[u] = (porUsuario[u] || 0) + 1;
    porDia[new Date(ts).toISOString().slice(0, 10)] = (porDia[new Date(ts).toISOString().slice(0, 10)] || 0) + 1;
    for (const c of campos) { porCampo[c] = (porCampo[c] || 0) + 1; campoUsuario[`${c} | ${u}`] = (campoUsuario[`${c} | ${u}`] || 0) + 1; }
  }
  console.log('entradas de historial (30 días)', n, '| total', snap.size);
  console.log('ejemplo', JSON.stringify(ejemplo).slice(0, 600));
  console.log('por campo', porCampo);
  console.log('por usuario', porUsuario);
  console.log('campo|usuario top', Object.entries(campoUsuario).sort((a, b) => b[1] - a[1]).slice(0, 15));
  console.log('por día', porDia);
})();

// ¿Los cambios de activo/itbms/tags del historial son reales o "fantasma" (campo ausente → valor por defecto) y hay alguno dañino? Solo lectura.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
(async () => {
  const snap = await db.collectionGroup('historial').get();
  const desde = Date.now() - 30 * 86400000;
  const stats = {}; const ejemplos = {};
  for (const d of snap.docs) {
    if (d.ref.parent.parent?.parent?.id !== 'clientes') continue;
    const h = d.data(); const ts = h.at?.toMillis ? h.at.toMillis() : null; if (!ts || ts < desde) continue;
    for (const [campo, v] of Object.entries(h.cambios || {})) {
      if (!['activo', 'itbms_exento', 'tags', 'vendedor_asignado', 'ruc', 'dv', 'ruc_tipo', 'representante_doc_tipo'].includes(campo)) continue;
      const antes = v.antes, despues = v.despues;
      const clase = (antes === null || antes === undefined) ? 'ausente→valor' : (JSON.stringify(antes) === JSON.stringify(despues) ? 'igual' : 'cambio real');
      const k = `${campo} | ${clase} | ${h.por_email || 'sin usuario'}`;
      stats[k] = (stats[k] || 0) + 1;
      if (clase === 'cambio real' && !ejemplos[campo]) ejemplos[campo] = { cliente: d.ref.parent.parent.id, antes, despues, campos: h.campos, por: h.por_email };
    }
  }
  console.log(Object.entries(stats).sort());
  console.log(JSON.stringify(ejemplos).slice(0, 1200));
})();

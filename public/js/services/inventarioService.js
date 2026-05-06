const InventarioService = {

  async getInventarioActual() {
    const db = firebase.firestore();
    const snap = await db.collection('inventario_actual').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getHistorialModelo(modeloId) {
    const db = firebase.firestore();
    const snap = await db.collection('ultimo_inventario')
      .where('modelo_id', '==', modeloId)
      .orderBy('timestamp', 'desc')
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Write a full inventory count: for each entry { modeloId, cantidad } batch-writes
  // ultimo_inventario (new doc with timestamp) and inventario_actual (set with tracking fields).
  // Reads each inventario_actual doc first to preserve penultima_actualizacion.
  async guardarInventario(entries) {
    const db = firebase.firestore();
    const now = firebase.firestore.Timestamp.now();
    const batch = db.batch();

    for (const { modeloId, cantidad } of entries) {
      // Read previous value to track penultima_actualizacion
      const prevSnap = await db.collection('inventario_actual').doc(modeloId).get();
      const prev = prevSnap.exists ? prevSnap.data() : null;

      // Append to history
      const histRef = db.collection('ultimo_inventario').doc();
      batch.set(histRef, { modelo_id: modeloId, cantidad, timestamp: now });

      // Update current stock
      const actRef = db.collection('inventario_actual').doc(modeloId);
      batch.set(actRef, {
        modelo_id: modeloId,
        cantidad,
        ultima_actualizacion: now,
        penultima_actualizacion: prev?.ultima_actualizacion ?? null,
        cantidad_anterior: prev?.cantidad ?? null,
      });
    }

    return batch.commit();
  },
};

window.InventarioService = InventarioService;

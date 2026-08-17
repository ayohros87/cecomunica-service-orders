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

  // Mueve parte del conteo físico de una fila del catálogo a otra.
  //
  // NO es lo mismo que scripts/mueve-conteo-inventario.js, que traslada la fila
  // ENTERA tras un dedup de modelos: acá el lote es parcial por naturaleza (12
  // de 32 mal codificados) y las dos filas siguen vivas.
  //
  // Existe porque reclasificar sin tocar el conteo deja un fantasma: el
  // 2026-08-14 bodega pasó 32 seriales de VM686 a PD686 y la fila VM686 se
  // quedó contando 32 con una sola unidad viva — una diferencia de −31 que no
  // había forma de cerrar desde la UI.
  //
  // `restarOrigen` y `sumarDestino` van por separado a propósito: que las
  // unidades ya no estén en el origen es un hecho, pero que falten en el
  // destino NO — si quien contó ya las anotó bajo el código bueno, sumarlas las
  // contaría dos veces. Quien cuenta ve los dos números y decide.
  async moverConteo({ desde, hacia, cantidad, restarOrigen = true, sumarDestino = false }) {
    const n = Number(cantidad) || 0;
    if (n <= 0) return [];
    const db = firebase.firestore();
    const leer = async (id) => {
      if (!id) return null;
      const s = await db.collection('inventario_actual').doc(id).get();
      return s.exists ? s.data() : null;
    };
    const [o, d] = await Promise.all([leer(desde), leer(hacia)]);

    const entries = [];
    if (sumarDestino && hacia) {
      entries.push({ modeloId: hacia, cantidad: (Number(d?.cantidad) || 0) + n });
    }
    if (restarOrigen && desde && o) {
      // Nunca negativo: si el origen ya contaba menos que el lote, el conteo
      // viejo estaba mal y lo que queda es cero, no una deuda.
      entries.push({ modeloId: desde, cantidad: Math.max(0, (Number(o.cantidad) || 0) - n) });
    }
    if (!entries.length) return [];
    await this.guardarInventario(entries);
    return entries;
  },
};

window.InventarioService = InventarioService;

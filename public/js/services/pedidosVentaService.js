// Pedidos de venta facturada (Brenda, 2026-10-07) — `pedidos_venta`.
//
// Recepción factura en QuickBooks y registra aquí el pedido (cliente, factura,
// modelo y cantidad). Bodega lo ve en Almacén · Hoy, asigna los seriales con
// el asistente de venta (cada unidad queda `vendido` con venta.pedido_id) y lo
// marca 'asignada'. El resto —correo a bodega, OS de programación, correo a
// recepción con los seriales— lo hace onPedidoVentaWrite.
//
// Estados: pendiente_bodega → asignada | anulada. Las reglas cierran quién
// mueve cada transición.
window.PedidosVentaService = {

  _col() { return firebase.firestore().collection('pedidos_venta'); },

  async crear({ cliente_id, cliente_nombre, factura, lineas, requiere_programacion = true, notas = '' }, user) {
    const limpias = (lineas || [])
      .map(l => ({ modelo_id: l.modelo_id || null, modelo: String(l.modelo || '').trim(), cantidad: Number(l.cantidad || 0) }))
      .filter(l => l.modelo && l.cantidad > 0);
    const ref = await this._col().add({
      cliente_id: String(cliente_id || ''),
      cliente_nombre: String(cliente_nombre || '').trim(),
      factura: String(factura || '').trim(),
      lineas: limpias,
      requiere_programacion: !!requiere_programacion,
      notas: String(notas || '').trim(),
      estado: 'pendiente_bodega',
      creado_por_uid: user?.uid || null,
      creado_por_email: user?.email || null,
      creado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  },

  async listarPendientes() {
    const snap = await this._col().where('estado', '==', 'pendiente_bodega').limit(100).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.creado_at?.toMillis?.() || 0) - (b.creado_at?.toMillis?.() || 0));
  },

  async get(id) {
    const d = await this._col().doc(id).get();
    return d.exists ? { id: d.id, ...d.data() } : null;
  },

  totalPedido(p) {
    return (p?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
  },

  // Bodega: las unidades ya quedaron vendidas (EquiposPoolService.vender con
  // pedido_id); esto cierra el pedido y dispara la OS + el correo.
  async marcarAsignado(id, unidades, user) {
    return this._col().doc(id).update({
      estado: 'asignada',
      seriales: (unidades || []).map(u => ({
        pool_id: u.id,
        serial: u.serial || u.serial_norm || u.id,
        modelo_id: u.modelo_id || null,
        modelo: u.modelo_label || u.modelo || '',
      })),
      asignado_por_uid: user?.uid || null,
      asignado_por_email: user?.email || null,
      asignado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async anular(id, motivo, user) {
    return this._col().doc(id).update({
      estado: 'anulada',
      anulado_motivo: String(motivo || '').trim(),
      anulado_por_uid: user?.uid || null,
      anulado_por_email: user?.email || null,
      anulado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },
};

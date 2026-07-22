// Feed "Órdenes por crear" del home (home-feed-ordenes.js) — detecta órdenes
// de PROGRAMACIÓN que ya se pueden crear, desde dos fuentes:
//
//  · CONTRATOS con seriales listos y sin orden vinculada. El filtro
//    server-side (seriales_estado 'asignados' + estado vigente) acota el
//    conjunto y ya excluye legacy; el resto del predicado (entrega, os
//    vinculada, equipos activos) se evalúa client-side con el helper
//    compartido OrdenProgPendiente — mismo criterio que el CTA de la lista
//    de contratos.
//
//  · VENTAS directas del pool: unidades 'vendido' cuya venta aún no tiene
//    orden amarrada (venta.orden_programacion_id == null — lo estampa
//    vender(); lo llena vincularOrdenProgramacion al crear la orden).
//    Ventas anteriores al campo no aparecen (corte legacy). Se agrupan por
//    factura+cliente: una fila del feed = una venta, no una unidad.
//
// Solo lecturas que cualquier usuario autenticado ya tiene (contratos y
// equipos_pool: read isSignedIn) — el gating de QUIÉN ve el feed vive en
// home-feed-ordenes.js.
const FeedOrdenesService = {

  async contratosSinOrden() {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .where('seriales_estado', '==', 'asignados')
      .where('estado', 'in', ['aprobado', 'activo'])
      .limit(300)
      .get();
    const rows = [];
    snap.forEach(d => {
      const data = d.data() || {};
      if (!OrdenProgPendiente.contratoNecesitaOrden(data)) return;
      const totalEq = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
      rows.push({
        tipo: 'contrato',
        doc_id: d.id,
        contrato_id: data.contrato_id || d.id,
        cliente_id: data.cliente_id || '',
        cliente_nombre: data.cliente_nombre || '—',
        equipos: Math.max(0, totalEq - Number(data.baja_cancelado_total || 0)),
        estado: data.estado,
        at: data.fecha_creacion?.toDate ? data.fecha_creacion.toDate().getTime() : 0,
      });
    });
    return rows.sort((a, b) => b.at - a.at);
  },

  async ventasSinOrden() {
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool')
      .where('estado', '==', 'vendido')
      .where('venta.orden_programacion_id', '==', null)
      .limit(200)
      .get();
    // Una venta = varias unidades con la misma factura/cliente → una fila.
    const grupos = new Map();
    snap.forEach(d => {
      const u = d.data() || {};
      const v = u.venta || {};
      const key = `${v.factura || ''}|${v.cliente_id || v.cliente_nombre || ''}`;
      const g = grupos.get(key) || {
        tipo: 'venta',
        cliente_id: v.cliente_id || '',
        cliente_nombre: v.cliente_nombre || '—',
        factura: v.factura || '',
        excepcion: !!v.cliente_excepcion,
        seriales: [],
        at: 0,
      };
      g.seriales.push(u.serial || u.serial_norm || d.id);
      const t = v.at?.toDate ? v.at.toDate().getTime() : 0;
      if (t > g.at) g.at = t;
      grupos.set(key, g);
    });
    return [...grupos.values()].sort((a, b) => b.at - a.at);
  },

  // Ambas fuentes en paralelo; una fuente caída (permiso/índice) no tumba a
  // la otra — el feed muestra lo que sí se pudo leer.
  async ordenesPorCrear() {
    const [contratos, ventas] = await Promise.all([
      this.contratosSinOrden().catch(e => { console.warn('[FeedOrdenes] contratos:', e?.code || e); return []; }),
      this.ventasSinOrden().catch(e => { console.warn('[FeedOrdenes] ventas:', e?.code || e); return []; }),
    ]);
    return { contratos, ventas };
  },
};

window.FeedOrdenesService = FeedOrdenesService;

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
// DESCARTES: cuando la orden no se va a crear, recepción descarta la fila con
// un motivo y esta deja de contar. El descarte NO se filtra en la query (es un
// campo nuevo, y los docs siguen cumpliendo el filtro server-side): las filas
// se leen igual y se marcan `descartada`, así el feed puede mostrarlas aparte
// para revertir el descarte sin lecturas extra.
//   · contrato → campo `orden_prog_descartada` (caduca si cambian los equipos,
//     ver OrdenProgPendiente).
//   · venta    → `venta.orden_descartada` en CADA unidad del grupo; el grupo
//     cuenta como descartado solo si TODAS lo están (si entró una unidad nueva
//     a la misma factura, esa venta sí necesita orden).
//
// Solo lecturas que cualquier usuario autenticado ya tiene (contratos y
// equipos_pool: read isSignedIn) — el gating de QUIÉN ve el feed vive en
// home-feed-ordenes.js. Las ESCRITURAS del descarte también viven aquí, para
// que el feed tenga una sola ruta de datos: las del pool delegan en
// EquiposPoolService (dueño único de equipos_pool y su kardex).
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
      const { listo, descartada } = OrdenProgPendiente.evaluar(data);
      if (!listo) return;
      const totalEq = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
      const desc = data.orden_prog_descartada || null;
      rows.push({
        tipo: 'contrato',
        doc_id: d.id,
        contrato_id: data.contrato_id || d.id,
        cliente_id: data.cliente_id || '',
        cliente_nombre: data.cliente_nombre || '—',
        equipos: Math.max(0, totalEq - Number(data.baja_cancelado_total || 0)),
        estado: data.estado,
        at: data.fecha_creacion?.toDate ? data.fecha_creacion.toDate().getTime() : 0,
        descartada,
        descarte: descartada ? { motivo: desc?.motivo || 'otro', nota: desc?.nota || '',
                                 por_email: desc?.por_email || '' } : null,
        // Foto que el descarte guarda para caducar cuando el contrato cambie
        // (ver OrdenProgPendiente); `equipos` ya es el conteo de activos.
        seriales_resueltos: Number(data.seriales_count || 0) + Number(data.seriales_omitidos_count || 0),
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
        ids: [],
        descartadas: 0,
        descarte: null,
        at: 0,
      };
      g.seriales.push(u.serial || u.serial_norm || d.id);
      g.ids.push(d.id);
      if (v.orden_descartada) {
        g.descartadas++;
        g.descarte = g.descarte || {
          motivo: v.orden_descartada.motivo || 'otro',
          nota: v.orden_descartada.nota || '',
          por_email: v.orden_descartada.por_email || '',
        };
      }
      const t = v.at?.toDate ? v.at.toDate().getTime() : 0;
      if (t > g.at) g.at = t;
      grupos.set(key, g);
    });
    // Grupo descartado = TODAS sus unidades descartadas. Si a la factura entró
    // una unidad nueva, la venta vuelve a pedir su orden (y el descarte viejo
    // queda de contexto en el kardex de las otras).
    return [...grupos.values()]
      .map(g => ({ ...g, descartada: g.ids.length > 0 && g.descartadas === g.ids.length }))
      .map(g => ({ ...g, descarte: g.descartada ? g.descarte : null }))
      .sort((a, b) => b.at - a.at);
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

  // ── Descarte (recepción/admin) ──────────────────────────────────────────
  // "Esta orden no se va a crear". Queda el quién/cuándo/por qué en el propio
  // doc: la bandeja se limpia sin perder la razón, y el descarte se puede
  // revertir. Las reglas ponen el piso de rol.

  async descartarContrato(docId, { motivo = 'otro', nota = '', equipos_activos = null,
                                   seriales_resueltos = null } = {}, user) {
    const db = firebase.firestore();
    return db.collection('contratos').doc(docId).update({
      orden_prog_descartada: {
        motivo,
        nota: (nota || '').toString().trim(),
        at: firebase.firestore.FieldValue.serverTimestamp(),
        por: user?.uid || null,
        por_email: user?.email || null,
        // Foto que hace caducar el descarte si el contrato cambia.
        equipos_activos: equipos_activos == null ? null : Number(equipos_activos),
        seriales_resueltos: seriales_resueltos == null ? null : Number(seriales_resueltos),
      },
    });
  },

  async reactivarContrato(docId) {
    const db = firebase.firestore();
    return db.collection('contratos').doc(docId).update({
      orden_prog_descartada: firebase.firestore.FieldValue.delete(),
    });
  },

  // Una venta son N unidades del pool: el descarte se escribe en todas, por la
  // ruta de escritura del pool (kardex incluido).
  async descartarVenta(ids, opts, user) {
    for (const id of ids || []) await EquiposPoolService.descartarOrdenProgramacion(id, opts, user);
  },

  async reactivarVenta(ids, user) {
    for (const id of ids || []) await EquiposPoolService.reactivarOrdenProgramacion(id, user);
  },
};

window.FeedOrdenesService = FeedOrdenesService;

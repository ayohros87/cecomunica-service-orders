/**
 * senalesService.js
 * Conteos agregados para la fila de señales del home (y badges del rail).
 * PLAN_REDISENO_COMMAND_CENTER.md §3.
 *
 * Usa agregados count() del SDK compat (≥9.16): 1 lectura facturada por
 * cada 1,000 documentos contados, sin descargar documentos.
 *
 * Piso de permisos (firestore.rules, verificado 2026-07-13):
 *   ordenes_de_servicio / contratos / inventario_piezas → read isSignedIn()
 *   cotizaciones → list solo puedeCotizar (admin, vendedor, jefe_taller,
 *                  recepcion, gerente) + técnicos taller + supervisores.
 * El gating de QUÉ señal ve cada rol vive en js/pages/home-signals.js
 * (módulos visibles); este servicio solo ejecuta la consulta.
 *
 * Limitación v1: los conteos de órdenes incluyen soft-deleted
 * (eliminado=true, raros) porque count() no puede expresar
 * "campo ausente o != true". La bandeja los filtra client-side.
 */

const SenalesService = {

  /** ¿El SDK cargado soporta agregados count()? */
  aggregatesDisponibles() {
    const probe = firebase.firestore().collection('ordenes_de_servicio').limit(1);
    return typeof probe.count === 'function';
  },

  async _count(queryRef) {
    const snap = await queryRef.count().get();
    return snap.data().count;
  },

  countOrdenesPorEstado(estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('ordenes_de_servicio').where('estado_reparacion', '==', estado)
    );
  },

  /**
   * Órdenes completadas que el candado de QC no deja entregar (ordenes-qc.js).
   * NO usa count(): el criterio ("aprobado y además cubriendo los equipos
   * actuales") no se puede expresar en una query, así que trae los docs con la
   * marca —volumen bajo por el corte del 2026-07-21— y filtra en cliente.
   * @returns {Promise<number>}
   */
  async countOrdenesQcPendiente() {
    const db = firebase.firestore();
    // El filtro de estado va server-side (antes se bajaba TODO qc_requerido
    // sin limit y se filtraba aquí). limit(200) es techo de cordura: la señal
    // muestra un conteo, no una lista, y 200 pendientes de QC ya es incendio.
    // Índice compuesto: ordenes_de_servicio(qc_requerido ASC, estado_reparacion ASC).
    const snap = await db.collection('ordenes_de_servicio')
      .where('qc_requerido', '==', true)
      .where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
      .limit(200)
      .get();
    let n = 0;
    snap.forEach(doc => {
      const o = doc.data() || {};
      if (o.eliminado === true) return;
      if ((o.estado_reparacion || '') !== 'COMPLETADO (EN OFICINA)') return;
      // Las ENTRADA cierran sin QC ni entrega: no son cola de nadie.
      if ((o.tipo_de_servicio || '') === 'ENTRADA') return;
      const aprobado = o.qc?.resultado === 'aprobado';
      const eq = o.qc?.equipos_n;
      const caducado = aprobado && typeof eq === 'number'
        && eq !== (Array.isArray(o.equipos) ? o.equipos.length : 0);
      if (!aprobado || caducado) n++;
    });
    return n;
  },

  countMisOrdenes(uid, estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('ordenes_de_servicio')
        .where('tecnico_uid', '==', uid)
        .where('estado_reparacion', '==', estado)
    );
  },

  // Cotizaciones que piden aprobación interna (auditoría A10): borradores con
  // el flag `requiere_aprobacion` que la app estampa al guardar. La señal que
  // el plan del Command Center dejó pendiente por "no contable server-side" —
  // contable desde que el flag se persiste (2026-08-17). Índice compuesto:
  // cotizaciones(estado ASC, requiere_aprobacion ASC).
  countCotizacionesPorAprobar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('cotizaciones')
        .where('estado', '==', 'borrador')
        .where('requiere_aprobacion', '==', true)
    );
  },

  countCotizacionesPorEstado(estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('cotizaciones').where('estado', '==', estado)
    );
  },

  countMisCotizacionesActivas(uid) {
    const db = firebase.firestore();
    return this._count(
      db.collection('cotizaciones')
        .where('creado_por_uid', '==', uid)
        .where('estado', 'in', ['borrador', 'enviada'])
    );
  },

  countContratosPorEstado(estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('contratos').where('estado', '==', estado)
    );
  },

  // Cola de bodega: contratos vigentes esperando que inventario asigne los
  // seriales (la marca la estampa onContratoAprobadoSolicitaSeriales). Es el
  // conteo exacto de la primera cola de inventario/pendientes.html; las otras
  // dos colas de esa bandeja no entran aquí (la de transición necesita filtro
  // en cliente y no se puede contar con un agregado).
  countSerialesPorAsignar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('contratos')
        .where('seriales_estado', '==', 'pendiente')
        .where('estado', 'in', ['aprobado', 'activo'])
    );
  },

  countPiezasSinStock() {
    const db = firebase.firestore();
    return this._count(
      db.collection('inventario_piezas').where('cantidad', '<=', 0)
    );
  },

  // Pool de equipos serializados (equipos_pool — read isSignedIn()).
  countEquiposPoolPorEstado(estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('equipos_pool').where('estado', '==', estado)
    );
  },

  countEquiposPoolSinVerificar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('equipos_pool').where('verificado', '==', false)
    );
  },
};

window.SenalesService = SenalesService;

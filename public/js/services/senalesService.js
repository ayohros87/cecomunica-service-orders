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

  countMisOrdenes(uid, estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('ordenes_de_servicio')
        .where('tecnico_uid', '==', uid)
        .where('estado_reparacion', '==', estado)
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

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
    // Predicado compartido con el cron del correo (PendientesDomain: espejo
    // del servidor + test de sincronía). La copia local que vivía aquí ni
    // siquiera sabía detectar la sustitución de serial.
    let n = 0;
    snap.forEach(doc => {
      if (PendientesDomain.esQcColaOperativa(doc.data() || {})) n++;
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

  /* ══ Detectores con FILAS (bandeja de pendientes del home) ═════════════
     Los cuatro salen del cron del correo diario; los predicados viven en
     PendientesDomain (espejo del servidor + test de sincronia). Aqui solo
     van las queries y la proyeccion segura de campos para la UI.

     El conteo y las filas comparten UNA promesa memoizada (TTL 5 min): la
     senal cuenta y, si la persona expande, las filas ya estan en memoria —
     expandir no paga una segunda consulta.

     Cada fila trae `pospuesto`: la UI muestra las activas y resume las
     pospuestas. Los conteos excluyen las pospuestas — el mismo criterio
     que el correo diario. */

  _LIST_TTL_MS: 5 * 60 * 1000,
  _listMemo: new Map(),   // clave → { t, p: Promise<rows> }

  _memoList(clave, fn) {
    const hit = this._listMemo.get(clave);
    if (hit && Date.now() - hit.t < this._LIST_TTL_MS) return hit.p;
    const p = fn().catch(e => { this._listMemo.delete(clave); throw e; });
    this._listMemo.set(clave, { t: Date.now(), p });
    return p;
  },

  /** Tras posponer/reactivar: la proxima lectura vuelve al servidor. */
  invalidarListas() { this._listMemo.clear(); },

  // Umbrales de empresa/config con fallback a los defaults del dominio —
  // los MISMOS numeros que usa el cron, para que el correo y la bandeja
  // nunca cuenten distinto (que es el bug que origino todo esto).
  _cfgMemo: null,
  async _config() {
    if (this._cfgMemo) return this._cfgMemo;
    const D = PendientesDomain.DEFAULTS;
    let cfg = {};
    try {
      const snap = await firebase.firestore().collection('empresa').doc('config').get();
      cfg = snap.exists ? (snap.data() || {}) : {};
    } catch (e) { /* sin permiso o sin red: defaults */ }
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 1) ? Number(v) : d;
    const staleDias = num(cfg.orden_stale_dias, D.stale_dias);
    this._cfgMemo = {
      staleDias,
      staleMax:    Math.max(num(cfg.orden_stale_max_dias, D.stale_max_dias), staleDias + 1),
      entradaDias: num(cfg.entrada_recordatorio_dias, D.entrada_dias),
      entregaDias: num(cfg.entrega_recordatorio_dias, D.entrega_dias),
    };
    return this._cfgMemo;
  },

  _snooze(doc) {
    const activo = PendientesDomain.estaPospuesto(doc, new Date());
    return {
      pospuesto: activo,
      snooze_motivo: activo ? String(doc.pendiente_snooze?.motivo || '') : '',
      snooze_hasta: activo ? String(doc.pendiente_snooze?.hasta || '').slice(0, 10) : '',
    };
  },

  /** Terminadas con QC listo que nadie marco ENTREGADO (cron seccion E). */
  listListasParaEntregar() {
    return this._memoList('entregar', async () => {
      const { entregaDias } = await this._config();
      const now = new Date();
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
        .limit(500).get();
      const rows = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (!PendientesDomain.esListaParaEntregar(o, now, entregaDias)) return;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          tipo: o.tipo_de_servicio || '—',
          equipos: (o.equipos || []).filter(e => e && !e.eliminado).length,
          dias: Math.floor(PendientesDomain.edadDias(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion, now) || 0),
          ...this._snooze(o),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Abiertas sin movimiento dentro de la ventana accionable (cron A). */
  listEstancadas() {
    return this._memoList('estancadas', async () => {
      const { staleDias, staleMax } = await this._config();
      const now = new Date();
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('estado_reparacion', 'in', PendientesDomain.ESTADOS_ABIERTOS)
        .limit(600).get();
      const rows = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (!PendientesDomain.esOrdenEstancada(o, now, { staleDias, staleMax })) return;
        const base = o.fecha_modificacion || o.fecha_actualizacion || o.updatedAt || o.fecha_entrada || o.fecha_creacion;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          estado: o.estado_reparacion || '—',
          tecnico: o.tecnico_asignado || '',
          dias: Math.floor(PendientesDomain.edadDias(base, now) || 0),
          ...this._snooze(o),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Cola de QC con filas (mismo criterio que countOrdenesQcPendiente). */
  listQcCola() {
    return this._memoList('qc', async () => {
      const now = new Date();
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('qc_requerido', '==', true)
        .where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
        .limit(200).get();
      const rows = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (!PendientesDomain.esQcColaOperativa(o)) return;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          tipo: o.tipo_de_servicio || '—',
          motivo: PendientesDomain.qcCaducado(o) ? 'caduco (cambiaron los equipos)'
            : (o.qc?.resultado === 'rechazado' ? 'rechazado, esperando correccion' : 'sin firmar'),
          dias: Math.floor(PendientesDomain.edadDias(o.fecha_completado || o.fecha_modificacion, now) || 0),
          ...this._snooze(o),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Devueltos sin inspeccionar, con edad. TODOS, no solo los atascados: la
      señal S13 cuenta la cuarentena completa (agregado) y el panel tiene que
      listar lo mismo que el número promete. El umbral de "atascado N+ días"
      es del CORREO (cron sección B), que avisa; la bandeja muestra la cola. */
  listCuarentena() {
    return this._memoList('cuarentena', async () => {
      const now = new Date();
      const snap = await firebase.firestore().collection('equipos_pool')
        .where('estado', '==', 'devuelto_revision')
        .limit(400).get();
      const rows = [];
      snap.forEach(d => {
        const u = d.data() || {};
        rows.push({
          id: d.id, col: 'equipos_pool',
          serial: u.serial || d.id,
          modelo: u.modelo_label || '—',
          cliente: u.asignacion?.cliente_nombre || '—',
          dias: Math.floor(PendientesDomain.edadDias(u.updated_at || u.created_at, now) || 0),
          ...this._snooze(u),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Radios por recuperar SIN orden de devolucion que los reclame (cron C2).
      DEFINIDO pero sin senal asignada: se enciende cuando negocio decida como
      triar el atraso — mismo trato que la cola de transiciones de bodega. */
  listRecuperarSinOrden() {
    return this._memoList('recuperar', async () => {
      const db = firebase.firestore();
      const now = new Date();
      const [pend, devs] = await Promise.all([
        db.collection('equipos_pool').where('pendiente_devolucion', '==', true).limit(500).get(),
        db.collection('ordenes_de_servicio').where('tipo_de_servicio', '==', 'DEVOLUCION').limit(1000).get(),
      ]);
      const norm = v => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cubiertos = new Set();
      devs.forEach(d => {
        const o = d.data() || {};
        if (o.eliminado) return;
        if ((o.estado_reparacion || '').toUpperCase() === 'CERRADA (DEVOLUCION)') return;
        (o.devolucion?.esperados || []).forEach(e => { const sr = norm(e.serial); if (sr) cubiertos.add(sr); });
      });
      const rows = [];
      pend.forEach(d => {
        const u = d.data() || {};
        if (!['asignado_contrato', 'en_cliente'].includes(u.estado)) return;
        if (cubiertos.has(norm(u.serial_norm || u.serial || d.id))) return;
        rows.push({
          id: d.id, col: 'equipos_pool',
          serial: u.serial || d.id,
          modelo: u.modelo_label || '—',
          cliente: u.asignacion?.cliente_nombre || '—',
          dias: Math.floor(PendientesDomain.edadDias(u.updated_at, now) || 0),
          ...this._snooze(u),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  // Conteos derivados de las filas (excluyen pospuestas, como el correo).
  async countListasParaEntregar() { return (await this.listListasParaEntregar()).filter(r => !r.pospuesto).length; },
  async countEstancadas()         { return (await this.listEstancadas()).filter(r => !r.pospuesto).length; },

  /* ── Posponer (fase 3) ─────────────────────────────────────────────────
     Escribe pendiente_snooze EN EL DOCUMENTO FUENTE (orden o unidad del
     pool), nunca en una bandeja — mismo principio que el descarte de
     "Ordenes por crear". Lo respetan esta bandeja Y el correo diario.
     El piso de permisos es firestore.rules: ordenes las escriben los seis
     roles de ordenes; el pool, los roles de puedeGestionarSeriales. Si las
     reglas lo niegan, el error sube y la UI lo dice. */
  async posponerPendiente({ col, id, dias, motivo }) {
    const d = Math.max(1, Math.min(60, Number(dias) || 7));
    const razon = String(motivo || '').trim();
    if (!razon) throw new Error('El motivo es obligatorio: es lo que lee la siguiente persona.');
    const hasta = new Date(Date.now() + d * 86400000).toISOString();
    await firebase.firestore().collection(col).doc(id).update({
      pendiente_snooze: {
        hasta, motivo: razon,
        por_email: firebase.auth().currentUser?.email || '',
        at: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    this.invalidarListas();
    return hasta.slice(0, 10);
  },

  /** Deshace un posponer antes de que venza (vuelve a contar de una vez). */
  async reactivarPendiente({ col, id }) {
    await firebase.firestore().collection(col).doc(id).update({
      pendiente_snooze: firebase.firestore.FieldValue.delete(),
    });
    this.invalidarListas();
  },
};

window.SenalesService = SenalesService;

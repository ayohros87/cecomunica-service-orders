// Cola de trabajo de INVENTARIO — la bandeja de /inventario/pendientes.html.
//
// El rol `inventario` NO tiene el módulo Contratos (js/core/modulos.js), pero
// tres colas de trabajo suyas nacen DENTRO de un contrato y hasta ahora solo
// le llegaban por correo: si el correo se borraba, el trabajo desaparecía de
// su vista. Este servicio arma esa bandeja.
//
// Las tres colas:
//   1. `seriales`   — contrato aprobado esperando que inventario asigne los
//                     seriales (`seriales_estado == 'pendiente'`, lo estampa
//                     onContratoAprobadoSolicitaSeriales).
//   2. `cambio`     — solicitud de cambio de serial pendiente de reemplazo
//                     (`seriales_cambio_pendiente`, lo mantiene onSerialCambio;
//                     el detalle vive en la subcolección seriales_cambios).
//   3. `transicion` — renovación/adición/reemplazo sin mapeo registrado
//                     (predicado compartido: js/domain/transicionPendiente.js).
//
// PROYECCIÓN SEGURA: `_fila` copia solo lo operativo — número de contrato,
// cliente, acción, modelo+cantidad, progreso y antigüedad. Las líneas de
// `equipos[]` traen `precio` en el doc y NO se copia, para que la página nunca
// lo tenga a mano. Esto es acotar lo que la UI maneja, no un candado: el piso
// real sigue siendo firestore.rules, donde `contratos` es read isSignedIn().
// El candado de verdad (proyección server-side mantenida por trigger + cerrar
// el read de contratos por rol) es una fase aparte.
const ColaInventarioService = {

  ESTADOS_VIGENTES: ['aprobado', 'activo'],
  LIMITE: 200,
  // La cola de transición no se puede filtrar server-side (el criterio mira
  // `transicion_mapeos_count`, que NO existe en los docs sin mapeos, así que
  // `== 0` no los devolvería). Se trae el conjunto vigente con seriales ya
  // asignados y se filtra en cliente — mismo trato que el feed "Órdenes por
  // crear" del home (feedOrdenesService.js).
  LIMITE_TRANSICION: 300,
  // Detalle de las solicitudes de cambio: una lectura de subcolección por
  // fila. Se topa por si algún día la cola se dispara; hoy son 0-3.
  MAX_DETALLE_CAMBIOS: 50,

  _db() { return firebase.firestore(); },

  _ms(ts) { return ts?.toDate ? ts.toDate().getTime() : 0; },

  // Unidades que realmente requieren serial. Misma fórmula que el pill de
  // seriales de la lista de contratos (contratos-list.js) y que
  // unidadesSerializables en functions/src/triggers/contratos/onApproval.js.
  _unidades(d) {
    const total = (d.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    return Math.max(0, total - Number(d.baja_cancelado_total || 0));
  },

  // Resueltas = seriales reales + unidades marcadas "sin serial" (omitidas).
  _resueltos(d) {
    return Number(d.seriales_count || 0) + Number(d.seriales_omitidos_count || 0);
  },

  _accion(d) {
    if (d.accion) return d.accion;
    if (d.codigo_tipo === 'REEMP') return 'Reemplazo';
    return 'Nuevo';
  },

  // Proyección segura del contrato → fila de la bandeja. Ver nota de arriba:
  // aquí se decide QUÉ sale del doc, y el precio no sale.
  _fila(id, d, tipo) {
    return {
      tipo,
      doc_id: id,
      contrato_id: d.contrato_id || id,
      cliente_nombre: d.cliente_nombre || '—',
      accion: this._accion(d),
      equipos: (d.equipos || [])
        .filter(e => Number(e.cantidad || 0) > 0)
        .map(e => ({ modelo: e.modelo || '—', cantidad: Number(e.cantidad || 0) })),
      unidades: this._unidades(d),
      resueltos: this._resueltos(d),
      // Antigüedad de la cola: desde que se aprobó (que es cuando se pidió el
      // trabajo). Sin aprobación —contratos viejos— cae a la creación.
      at: this._ms(d.fecha_aprobacion) || this._ms(d.fecha_creacion),
    };
  },

  // ── Cola 1: seriales por asignar ────────────────────────────────────────
  async serialesPorAsignar() {
    const snap = await this._db().collection('contratos')
      .where('seriales_estado', '==', 'pendiente')
      .where('estado', 'in', this.ESTADOS_VIGENTES)
      .limit(this.LIMITE)
      .get();
    const rows = [];
    snap.forEach(doc => {
      const d = doc.data() || {};
      // Mismos descartes que el trigger que pide los seriales: sin unidades
      // serializables no hay nada que asignar (renovación sin equipo, o todo
      // dado de baja). Protege contra docs atascados en 'pendiente'.
      if (d.accion === 'Renovación' && d.renovacion_sin_equipo) return;
      if (this._unidades(d) <= 0) return;
      rows.push(this._fila(doc.id, d, 'seriales'));
    });
    return rows.sort((a, b) => a.at - b.at); // el más viejo primero: es cola
  },

  // ── Cola 2: cambios de serial solicitados ───────────────────────────────
  async cambiosDeSerial() {
    const snap = await this._db().collection('contratos')
      .where('seriales_cambio_pendiente', '==', true)
      .limit(this.LIMITE)
      .get();

    const docs = snap.docs.slice(0, this.MAX_DETALLE_CAMBIOS);
    const rows = await Promise.all(docs.map(async doc => {
      const fila = this._fila(doc.id, doc.data() || {}, 'cambio');
      // Sin el detalle la fila no dice QUÉ hay que reemplazar ni por qué.
      try {
        const qs = await doc.ref.collection('seriales_cambios')
          .where('estado', '==', 'pendiente').get();
        const reqs = qs.docs.map(d => d.data() || {});
        reqs.sort((a, b) => this._ms(b.solicitado_at) - this._ms(a.solicitado_at));
        const req = reqs[0] || {};
        fila.cambio = {
          items: Array.isArray(req.items) ? req.items : [],
          motivo_tipo: req.motivo_tipo || '',
          motivo: req.motivo || '',
        };
        // La antigüedad de ESTA cola es la de la solicitud, no la del contrato.
        fila.at = this._ms(req.solicitado_at) || fila.at;
      } catch (e) {
        console.warn('[ColaInventario] detalle de cambio no disponible:', e?.code || e);
        fila.cambio = { items: [], motivo_tipo: '', motivo: '' };
      }
      return fila;
    }));
    if (snap.size > docs.length) {
      console.warn(`[ColaInventario] ${snap.size - docs.length} cambios de serial fuera del tope de detalle.`);
    }
    return rows.sort((a, b) => a.at - b.at);
  },

  // ── Cola 3: transiciones de equipo sin registrar ────────────────────────
  // Solo se miran contratos con los seriales YA asignados: mientras estén
  // pendientes, el trabajo de inventario es la cola 1 y el contrato ya sale
  // ahí — no tiene sentido pedirle dos cosas a la vez por el mismo contrato.
  async transicionesPorRegistrar() {
    const snap = await this._db().collection('contratos')
      .where('seriales_estado', '==', 'asignados')
      .where('estado', 'in', this.ESTADOS_VIGENTES)
      .limit(this.LIMITE_TRANSICION)
      .get();
    const rows = [];
    snap.forEach(doc => {
      const d = doc.data() || {};
      if (!window.TransicionPendiente?.contratoNecesitaTransicion(d)) return;
      rows.push(this._fila(doc.id, d, 'transicion'));
    });
    return rows.sort((a, b) => a.at - b.at);
  },

  // Las tres colas en paralelo. Una caída (permiso, índice) no tumba a las
  // otras: la bandeja muestra lo que sí se pudo leer y avisa del hueco.
  async todo() {
    const [seriales, cambios, transiciones] = await Promise.all([
      this.serialesPorAsignar().catch(e => { console.warn('[ColaInventario] seriales:', e?.code || e); return null; }),
      this.cambiosDeSerial().catch(e => { console.warn('[ColaInventario] cambios:', e?.code || e); return null; }),
      this.transicionesPorRegistrar().catch(e => { console.warn('[ColaInventario] transiciones:', e?.code || e); return null; }),
    ]);
    return {
      seriales: seriales || [],
      cambios: cambios || [],
      transiciones: transiciones || [],
      // Qué colas fallaron — la página lo dice en vez de mostrar un 0 falso.
      fallidas: [
        seriales === null ? 'seriales' : null,
        cambios === null ? 'cambios' : null,
        transiciones === null ? 'transiciones' : null,
      ].filter(Boolean),
    };
  },

  // ── Badge del rail ──────────────────────────────────────────────────────
  // Cuenta SOLO las dos colas que se pueden contar server-side con agregados
  // count() (1 lectura por cada 1,000 docs). La cola de transición se queda
  // fuera a propósito: exige filtro en cliente y traer 300 docs para pintar
  // un número no vale el costo en cada carga de página. Por eso el badge
  // puede ser MENOR que el total de la bandeja; el tooltip lo dice.
  async contarParaBadge() {
    const db = this._db();
    const probe = db.collection('contratos').limit(1);
    if (typeof probe.count !== 'function') return 0; // SDK sin agregados
    const [a, b] = await Promise.all([
      db.collection('contratos')
        .where('seriales_estado', '==', 'pendiente')
        .where('estado', 'in', this.ESTADOS_VIGENTES)
        .count().get(),
      db.collection('contratos')
        .where('seriales_cambio_pendiente', '==', true)
        .count().get(),
    ]);
    return a.data().count + b.data().count;
  },

  // Pinta el badge del rail. Cache de 5 min en sessionStorage para no repetir
  // los agregados en cada navegación dentro del módulo. La llama renderRail
  // (js/core/layout.js) solo si el rol tiene el módulo 'pendientes' Y esta
  // página cargó el servicio — el resto del sistema no paga nada.
  TTL_BADGE_MS: 5 * 60 * 1000,

  async pintarBadgeRail() {
    if (typeof Layout === 'undefined' || !Layout.setRailBadge) return;
    const uid = firebase.auth().currentUser?.uid || 'anon';
    const key = `ccColaInv:v1:${uid}`;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.t < this.TTL_BADGE_MS) {
          Layout.setRailBadge('pendientes', cached.n);
          return;
        }
      }
    } catch { /* sin storage: se cuenta y ya */ }
    try {
      const n = await this.contarParaBadge();
      Layout.setRailBadge('pendientes', n);
      try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), n })); } catch { /* ok */ }
    } catch (e) {
      // Un badge nunca rompe una página.
      console.warn('[ColaInventario] badge:', e?.code || e);
    }
  },

  // Invalida el cache del badge (tras trabajar la cola en la propia bandeja).
  refrescarBadge(n) {
    const uid = firebase.auth().currentUser?.uid || 'anon';
    try { sessionStorage.setItem(`ccColaInv:v1:${uid}`, JSON.stringify({ t: Date.now(), n })); } catch { /* ok */ }
    if (typeof Layout !== 'undefined' && Layout.setRailBadge) Layout.setRailBadge('pendientes', n);
  },
};

window.ColaInventarioService = ColaInventarioService;

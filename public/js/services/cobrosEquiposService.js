// Equipos que el cliente NO devolvió y hay que cobrarle — colección
// `cobros_equipos`, un doc por renglón cobrable.
// Plan: docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md.
//
// Por qué colección propia y no una bandera en equipos_pool:
//   1. Un faltante puede NO tener serial. El pool está indexado por serial (el
//      doc ID *es* el serial), así que los 4 radios del finiquito de TIL PANAMA
//      —que nadie llegó a registrar— no caben ahí. El renglón sí: lleva
//      `modelo + cantidad` cuando no hay serial y apunta a la ficha con
//      `pool_doc_id` cuando sí lo hay.
//   2. El pool responde DÓNDE está el equipo; el renglón responde CÓMO va el
//      cobro. Meter la etapa de cobranza en el estado del pool habría obligado
//      a tocar chips, reglas y conciliación por un dato que no es de ubicación.
//
// El renglón NUNCA se borra ni se vacía solo: de la bandeja solo se sale por
// una de las cuatro acciones explícitas (facturar / condonar / recuperar /
// ajustar), y cada una apila su traza en `historial[]`. Ese es el punto entero
// del módulo — lo que se traspapeló en TIL fue justamente un dato sin dueño.
const CobrosEquiposService = {

  COL: 'cobros_equipos',

  // Etapas del renglón. `pendiente` y `en_cobranza` son las ABIERTAS (las que
  // salen en la bandeja y en el correo diario); las otras tres son cierres.
  ETAPAS: {
    PENDIENTE:   'pendiente',
    EN_COBRANZA: 'en_cobranza',
    FACTURADO:   'facturado',
    CONDONADO:   'condonado',
    RECUPERADO:  'recuperado',
  },

  ETAPA_LABELS: {
    pendiente:   'Pendiente',
    en_cobranza: 'En cobranza',
    facturado:   'Facturado',
    condonado:   'Condonado',
    recuperado:  'Recuperado',
  },

  ABIERTAS: ['pendiente', 'en_cobranza'],

  // Descuento que puede aplicar quien registra, sin pedirle permiso a nadie.
  // 15% es el MISMO umbral que ya usa el auto-envío de cotizaciones: el equipo
  // ya conoce el número y no hace falta enseñar dos reglas distintas.
  DESCUENTO_LIBRE_PCT: 15,

  // Días antes de escalar a cobranza (decidido con el usuario 2026-08-20).
  // El escalado real lo hace el cron recordatorioOperativo; esta constante está
  // aquí para que la bandeja pueda pintar "le quedan N días" sin adivinar.
  DIAS_A_COBRANZA: 10,

  _col() { return firebase.firestore().collection(this.COL); },

  _autoria() {
    const u = firebase.auth().currentUser;
    return { por_uid: u?.uid || '', por_email: u?.email || '' };
  },

  // Entrada del historial. serverTimestamp() NO vale dentro de un array, así
  // que la marca de tiempo va como ISO (mismo patrón que equiposDescartados).
  _traza(accion, detalle) {
    return { accion, detalle: (detalle || '').toString().trim(),
             fecha_iso: new Date().toISOString(), ...this._autoria() };
  },

  _redondear(n) { return Math.round((Number(n) || 0) * 100) / 100; },

  // ── Reglas de monto ──────────────────────────────────────────────────

  // Descuento implícito de cobrar `montoUnit` cuando el catálogo dice
  // `montoCatalogo`. Sin precio de catálogo no hay contra qué comparar: el
  // descuento es 0 y la línea queda marcada `sin_referencia` para que alguien
  // la mire (el monto lo tecleó una persona a ojo).
  descuentoPct(montoCatalogo, montoUnit) {
    const cat = Number(montoCatalogo) || 0;
    if (cat <= 0) return 0;
    const pct = ((cat - (Number(montoUnit) || 0)) / cat) * 100;
    return this._redondear(Math.max(0, pct));
  },

  // ¿Este monto necesita que alguien lo apruebe? Solo por encima del margen
  // libre. La condonación (100%) tiene su propia puerta y su propio permiso.
  requiereAprobacion(montoCatalogo, montoUnit) {
    return this.descuentoPct(montoCatalogo, montoUnit) > this.DESCUENTO_LIBRE_PCT;
  },

  // ── Permisos ─────────────────────────────────────────────────────────
  // Espejo de firestore.rules (match /cobros_equipos). La UI decide qué
  // botones pinta; las rules son las que mandan.

  // `window.userRole` lo deja Auth.guard() al arrancar la página (core/auth.js).
  _rol() { return window.userRole || ''; },

  esAdmin() { return this._rol() === 'administrador'; },

  // Registrar, ajustar montos y facturar: los mismos que gestionan seriales
  // (son quienes cierran devoluciones y quienes cobran).
  puedeGestionar() {
    return ['administrador', 'recepcion', 'vendedor', 'gerente', 'inventario']
      .includes(this._rol());
  },

  // Aprobar un descuento por encima del margen: decisión comercial → gerente
  // (mismo criterio que la aprobación de cotizaciones comerciales) o admin.
  puedeAprobarDescuento() {
    return ['administrador', 'gerente'].includes(this._rol());
  },

  // Condonar es perdonar plata: SOLO administrador (regla del usuario).
  puedeCondonar() { return this.esAdmin(); },

  // ── Alta ─────────────────────────────────────────────────────────────

  /**
   * Abre un renglón cobrable. Lo llaman dos flujos:
   *   · el cierre de una devolución cuando quedan faltantes sin lista
   *     (contrato de papel) — sin serial, con modelo + cantidad;
   *   · la resolución "No se devuelve" de una unidad concreta — con serial.
   *
   * Idempotente por (orden + serial): reabrir la misma unidad no duplica el
   * renglón. Sin serial no hay clave natural, así que el llamador decide.
   *
   * @returns {Promise<string>} id del renglón
   */
  async abrir({ cliente_id = '', cliente_nombre = '', orden_devolucion_id = '',
                serial = '', modelo_id = '', modelo_label = '', cantidad = 1,
                motivo_codigo = 'otro', motivo_detalle = '',
                monto_catalogo_unit = null, monto_unit = null } = {}) {
    const normalizar = (s) => (typeof EquiposPoolService !== 'undefined')
      ? EquiposPoolService.normalizarSerial(s)
      : (s ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    const serialNorm = serial ? normalizar(serial) : '';
    const qty = Math.max(1, Number(cantidad) || 1);

    // Ya abierto para esta misma unidad y esta misma orden → no se duplica.
    if (serialNorm && orden_devolucion_id) {
      const ya = await this._col()
        .where('serial_norm', '==', serialNorm)
        .where('orden_devolucion_id', '==', orden_devolucion_id)
        .limit(1).get();
      if (!ya.empty) return ya.docs[0].id;
    }

    const cat = (monto_catalogo_unit === null || monto_catalogo_unit === undefined)
      ? null : this._redondear(monto_catalogo_unit);
    // Sin monto explícito se arranca con el precio de catálogo. Sin catálogo se
    // arranca en 0 y la línea queda marcada: alguien tiene que ponerle precio.
    const unit = (monto_unit === null || monto_unit === undefined)
      ? (cat === null ? 0 : cat) : this._redondear(monto_unit);

    const ref = await this._col().add({
      cliente_id, cliente_nombre,
      orden_devolucion_id,
      serial: serialNorm ? String(serial).trim() : '',
      serial_norm: serialNorm || null,
      pool_doc_id: null,          // lo llena vincularFicha() si hay ficha
      modelo_id: modelo_id || '',
      modelo_label: modelo_label || '',
      cantidad: serialNorm ? 1 : qty,   // con serial siempre es una unidad
      motivo_codigo, motivo_detalle,
      monto_catalogo_unit: cat,
      monto_unit: unit,
      descuento_pct: this.descuentoPct(cat, unit),
      monto_total: this._redondear(unit * (serialNorm ? 1 : qty)),
      sin_referencia: cat === null,
      etapa: this.ETAPAS.PENDIENTE,
      requiere_aprobacion: this.requiereAprobacion(cat, unit),
      aprobado_por_email: '', aprobado_at: null,
      factura_ref: '', facturado_at: null, facturado_por_email: '',
      cerrado_motivo: '',
      desde: firebase.firestore.FieldValue.serverTimestamp(),
      escalado_at: null,
      historial: [this._traza('abierto',
        `${qty} × ${modelo_label || 'equipo'}${serialNorm ? ` (${serialNorm})` : ''}` +
        `${orden_devolucion_id ? ` — devolución ${orden_devolucion_id}` : ''}`)],
      created_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...this._autoria(),
    });
    return ref.id;
  },

  // Amarra el renglón con la ficha del pool (cuando la unidad sí tiene ficha).
  async vincularFicha(id, poolDocId) {
    await this._col().doc(id).update({
      pool_doc_id: poolDocId || null,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // ── Ajustes ──────────────────────────────────────────────────────────

  /**
   * Cambia lo que se va a cobrar. Recalcula el descuento contra el catálogo y
   * vuelve a evaluar si necesita aprobación — si el monto sube y baja del
   * umbral, la aprobación previa se limpia (no puede quedar un "aprobado" que
   * ya no corresponde a la cifra que se ve).
   */
  async ajustarMonto(id, montoUnit, motivo = '') {
    const snap = await this._col().doc(id).get();
    if (!snap.exists) throw new Error('El renglón no existe');
    const d = snap.data();
    if (!this.ABIERTAS.includes(d.etapa)) {
      throw new Error(`El renglón ya está ${this.ETAPA_LABELS[d.etapa] || d.etapa} — no se puede reprecificar.`);
    }
    const unit = this._redondear(montoUnit);
    if (!(unit >= 0)) throw new Error('El monto no puede ser negativo.');

    const pct = this.descuentoPct(d.monto_catalogo_unit, unit);
    const necesita = this.requiereAprobacion(d.monto_catalogo_unit, unit);
    const patch = {
      monto_unit: unit,
      descuento_pct: pct,
      monto_total: this._redondear(unit * (Number(d.cantidad) || 1)),
      requiere_aprobacion: necesita,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('monto', `$${unit.toFixed(2)} c/u (${pct}% de descuento)` +
          (motivo ? ` — ${motivo}` : ''))),
      ...this._autoria(),
    };
    // La aprobación es de una cifra, no del renglón: si la cifra cambia, la
    // aprobación se cae. Si no, bastaba con aprobar barato y luego editar.
    if (d.aprobado_at) { patch.aprobado_por_email = ''; patch.aprobado_at = null; }
    await this._col().doc(id).update(patch);
  },

  /** Aprueba el descuento vigente (gerente o admin). */
  async aprobarDescuento(id) {
    const a = this._autoria();
    await this._col().doc(id).update({
      requiere_aprobacion: false,
      aprobado_por_email: a.por_email,
      aprobado_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('aprobado', 'Descuento aprobado')),
      ...a,
    });
  },

  // ── Cierres ──────────────────────────────────────────────────────────

  /**
   * Se facturó. La factura NO se emite desde aquí (todavía): se emite en
   * QuickBooks y su número se teclea de vuelta, que es lo que cierra el
   * círculo entre el equipo perdido y el asiento contable.
   * La unidad, si tiene ficha, pasa a `vendido`: un equipo no devuelto que se
   * cobra ES una venta — el cliente se quedó con el radio y lo pagó.
   */
  async facturar(id, facturaRef, user) {
    const snap = await this._col().doc(id).get();
    if (!snap.exists) throw new Error('El renglón no existe');
    const d = snap.data();
    if (!this.ABIERTAS.includes(d.etapa)) throw new Error('El renglón ya está cerrado.');
    if (d.requiere_aprobacion) {
      throw new Error(`El descuento de ${d.descuento_pct}% supera el ${this.DESCUENTO_LIBRE_PCT}% libre: necesita aprobación antes de facturar.`);
    }
    const fact = (facturaRef || '').toString().trim();
    if (!fact) throw new Error('Escribe el número de la factura de QuickBooks.');

    await this._moverFicha(d, 'vendido', `No devuelto y facturado — factura QBO ${fact}`, user);

    const a = this._autoria();
    await this._col().doc(id).update({
      etapa: this.ETAPAS.FACTURADO,
      factura_ref: fact,
      facturado_at: firebase.firestore.FieldValue.serverTimestamp(),
      facturado_por_email: a.por_email,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('facturado', `Factura QBO ${fact} — $${Number(d.monto_total || 0).toFixed(2)}`)),
      ...a,
    });
  },

  /**
   * Se condona: no se le cobra al cliente y el equipo se asume como pérdida.
   * SOLO administrador. La ficha va a `baja` — no es una venta (no entró
   * plata) sino un castigo de inventario.
   */
  async condonar(id, motivo, user) {
    if (!this.puedeCondonar()) throw new Error('Solo un administrador puede condonar.');
    const det = (motivo || '').toString().trim();
    if (det.length < 10) throw new Error('Explica por qué se condona (mínimo 10 caracteres): es la justificación de no cobrar.');

    const snap = await this._col().doc(id).get();
    if (!snap.exists) throw new Error('El renglón no existe');
    const d = snap.data();
    if (!this.ABIERTAS.includes(d.etapa)) throw new Error('El renglón ya está cerrado.');

    await this._moverFicha(d, 'baja', `No devuelto y condonado: ${det}`, user);

    const a = this._autoria();
    await this._col().doc(id).update({
      etapa: this.ETAPAS.CONDONADO,
      cerrado_motivo: det,
      aprobado_por_email: a.por_email,
      aprobado_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('condonado', det)),
      ...a,
    });
  },

  /** El equipo apareció: vuelve a bodega y el renglón se cierra sin cobro. */
  async recuperar(id, motivo, user) {
    const snap = await this._col().doc(id).get();
    if (!snap.exists) throw new Error('El renglón no existe');
    const d = snap.data();
    if (!this.ABIERTAS.includes(d.etapa)) throw new Error('El renglón ya está cerrado.');

    await this._moverFicha(d, 'en_bodega',
      `Apareció: el equipo dado por no devuelto volvió${motivo ? ` — ${motivo}` : ''}`, user);

    await this._col().doc(id).update({
      etapa: this.ETAPAS.RECUPERADO,
      cerrado_motivo: (motivo || '').toString().trim(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('recuperado', motivo || 'El equipo apareció')),
      ...this._autoria(),
    });
  },

  // Mueve la ficha del pool que acompaña al renglón, si la hay. Best-effort a
  // propósito: un renglón SIN serial (los 4 de TIL) no tiene ficha que mover, y
  // que falle el pool no puede impedir que se registre el cobro — el renglón es
  // la fuente de verdad de la deuda, la ficha es el reflejo en inventario.
  async _moverFicha(d, aEstado, notas, user) {
    const docId = d.pool_doc_id || d.serial_norm;
    if (!docId || typeof EquiposPoolService === 'undefined') return;
    try {
      const extra = aEstado === 'vendido'
        ? { propiedad: 'cliente',
            venta: {
              factura: '', motivo: 'no_devuelto',
              cliente_id: d.cliente_id || '', cliente_nombre: d.cliente_nombre || '',
              cliente_excepcion: false, orden_programacion_id: null,
              at: firebase.firestore.FieldValue.serverTimestamp(),
            } }
        : (aEstado === 'baja'
          ? { baja_motivo: notas }
          : { asignacion: null, orden_actual_id: null, verificado: false });
      await EquiposPoolService.cambiarEstado(docId, aEstado, {
        tipo: aEstado === 'en_bodega' ? 'recuperacion' : 'cobro_no_devuelto',
        ref: d.orden_devolucion_id
          ? { tipo: 'orden', id: d.orden_devolucion_id, label: `DEVOLUCIÓN ${d.orden_devolucion_id}` }
          : null,
        notas, extra,
      }, user);
    } catch (e) {
      console.warn('[CobrosEquipos] no se pudo mover la ficha del pool:', e?.message || e);
    }
  },

  // ── Consulta ─────────────────────────────────────────────────────────

  /**
   * Listado de la bandeja. Por defecto solo lo ABIERTO, que es lo que hay que
   * perseguir; `incluirCerrados` lo trae todo para auditoría o para armar el
   * estado de cuenta histórico de un cliente.
   */
  async listar({ incluirCerrados = false, clienteId = '', limite = 500 } = {}) {
    let q = this._col().orderBy('desde', 'asc').limit(limite);
    if (clienteId) q = this._col().where('cliente_id', '==', clienteId).limit(limite);
    const snap = await q.get();
    const rows = [];
    snap.forEach((d) => {
      const data = { id: d.id, ...d.data() };
      if (!incluirCerrados && !this.ABIERTAS.includes(data.etapa)) return;
      rows.push(data);
    });
    // Con filtro por cliente el orderBy se cae (exigiría índice compuesto):
    // se ordena en memoria, que para el volumen de un cliente sobra.
    if (clienteId) {
      rows.sort((a, b) => (a.desde?.seconds || 0) - (b.desde?.seconds || 0));
    }
    return rows;
  },

  /** Días transcurridos desde que se abrió el renglón. */
  diasAbierto(row, ahora = new Date()) {
    const t = row?.desde?.toDate ? row.desde.toDate() : null;
    if (!t) return 0;
    return Math.floor((ahora - t) / 86400000);
  },
};

window.CobrosEquiposService = CobrosEquiposService;

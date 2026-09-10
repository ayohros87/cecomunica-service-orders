// @ts-nocheck
// facturacionAvisosService — lecturas y marcas de la bandeja "Facturación
// pendiente" (colección facturacion_avisos, creada SOLO por el servidor en
// G.avisoFacturacion). Desde aquí solo se escriben pasos, descarte, reenvío
// e historial: firestore.rules acota exactamente esos campos.
//
// El estado 'hecho' lo deriva también el servidor (onFacturacionAvisoWrite);
// aquí se escribe optimista para que la fila reaccione sin esperar el trigger.
window.FacturacionAvisosService = {
  COL: 'facturacion_avisos',
  // Need-to-know (Alberto 2026-09-04): recepción porque factura a mano en
  // QuickBooks; admin y contabilidad porque supervisan. Nadie más.
  ROLES: ['administrador', 'recepcion', 'contabilidad'],
  // Solo estos ven el espacio Finanzas completo (la barra de pestañas).
  ROLES_FINANZAS: ['administrador', 'contabilidad'],

  MOTIVOS_DESCARTE: [
    { codigo: 'ya_en_qbo',  label: 'Ya estaba en QuickBooks' },
    { codigo: 'no_factura', label: 'No se factura (demo, prueba, interno)' },
    { codigo: 'duplicado',  label: 'Aviso duplicado' },
    { codigo: 'otro',       label: 'Otro (explica en la nota)' },
  ],
  motivoLabel(codigo) {
    const m = this.MOTIVOS_DESCARTE.find(x => x.codigo === codigo);
    return m ? m.label : (codigo || '—');
  },

  puedeGestionar(rol) { return this.ROLES.includes(rol); },

  _col() { return db.collection(this.COL); },
  _autoria() {
    const u = firebase.auth().currentUser;
    return { por_uid: u?.uid || '', por_email: u?.email || '' };
  },
  // serverTimestamp() no vale dentro de arrays → ISO (mismo patrón que cobros).
  _traza(accion, detalle) {
    return { accion, detalle: (detalle || '').toString().trim(),
             fecha_iso: new Date().toISOString(), por_email: this._autoria().por_email };
  },

  // Pendientes = pendiente + esperando. 'in' sin orderBy no pide índice
  // compuesto; se ordena en el cliente (volumen: decenas).
  async listPendientes() {
    const snap = await this._col().where('estado', 'in', ['pendiente', 'esperando']).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async listCerrados(limite = 200) {
    const snap = await this._col().where('estado', 'in', ['hecho', 'descartado']).limit(limite).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // ── Comisiones (docs/plans/PLAN_COMISIONES.md F2) ─────────────────────────
  // Liberar una comisión es otra decisión (y otra plata) que marcar un paso de
  // facturación: rules solo dejan tocar `comision` a admin/contabilidad.
  ROLES_COMISION: ['administrador', 'contabilidad'],
  puedeComisionar(rol) { return this.ROLES_COMISION.includes(rol); },

  // La bandeja de comisiones lee la colección ENTERA (43 documentos hoy,
  // ~15 nuevos al mes). Un `where` sobre comision.estado pediría índice y no
  // ahorraría nada a esta escala; agrupar y filtrar se hace en el navegador.
  async listComisiones() {
    const snap = await this._col().get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => a.comision);
  },

  // Estado derivado — MISMO criterio que lib/facturacionAvisos.estadoComision.
  // Si cambias uno, cambia el otro.
  estadoComision(com = {}) {
    if (com.aplica === false) return 'no_aplica';
    if (com.liberada_at || com.periodo) return 'pagada';
    const req = Object.values(com.requisitos || {}).filter(x => x && x.aplica);
    return req.length && req.every(x => x.hecho) ? 'listo' : 'esperando';
  },

  // Requisitos que faltan, en texto, para que la fila diga POR QUÉ está
  // trancada en vez de mostrar un chip ámbar sin explicación.
  faltantes(com = {}) {
    return Object.entries(com.requisitos || {})
      .filter(([, r]) => r && r.aplica && !r.hecho)
      .map(([k, r]) => ({ paso: k, motivo: r.motivo || 'pendiente' }));
  },

  /**
   * Confirma el primer pago. `factura` es el DocNumber de QuickBooks y NO es
   * opcional a propósito: sin él, la verificación automática (F4) no tiene con
   * qué buscar y habría que adivinar cuál pago corresponde a cuál contrato.
   * El pago cuenta solo con la factura en CERO (decisión de Alberto
   * 2026-09-10): un abono parcial se guarda como saldo y no libera nada.
   */
  async marcarPago(aviso, { factura, fecha, monto = null, saldo = null } = {}) {
    const com = aviso?.comision;
    if (!com || com.aplica === false) throw new Error('Este evento no paga comisión.');
    if (com.estado === 'pagada') throw new Error('Esta comisión ya se cerró.');
    const num = (factura || '').toString().trim();
    if (!num) throw new Error('Escribe el número de la factura de QuickBooks.');
    const f = (fecha || '').toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('Escribe la fecha del pago.');
    const pendiente = Number(saldo || 0) > 0;
    const pago = {
      ...(com.requisitos?.pago || {}), aplica: true,
      hecho: !pendiente, at: firebase.firestore.Timestamp.fromDate(new Date(`${f}T12:00:00`)),
      factura: num, monto: monto == null ? null : Number(monto),
      saldo: pendiente ? Number(saldo) : 0,
      fuente: 'manual',
      motivo: pendiente ? `factura ${num}: quedan $${Number(saldo).toFixed(2)} por pagar` : null,
    };
    const estado = this.estadoComision({ ...com, requisitos: { ...(com.requisitos || {}), pago } });
    await this._col().doc(aviso.id).update({
      'comision.requisitos.pago': pago,
      'comision.estado': estado,
      historial: firebase.firestore.FieldValue.arrayUnion(this._traza('comision_pago',
        pendiente ? `Factura ${num} con saldo de $${Number(saldo).toFixed(2)} — la comisión NO se libera`
          : `Primer pago confirmado · factura ${num} · ${f}`)),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...this._autoria(),
    });
    return estado;
  },

  // Deshacer no borra: el historial dice quién marcó y quién deshizo.
  async deshacerPago(aviso, motivo = '') {
    const com = aviso?.comision;
    if (!com?.requisitos?.pago?.factura) throw new Error('Este pago no está marcado.');
    if (com.estado === 'pagada') throw new Error('Primero hay que reabrir el período.');
    const pago = { ...com.requisitos.pago, hecho: false, at: null, factura: null, monto: null,
      saldo: null, fuente: null, motivo: 'falta confirmar el primer pago (factura en cero)' };
    const estado = this.estadoComision({ ...com, requisitos: { ...com.requisitos, pago } });
    await this._col().doc(aviso.id).update({
      'comision.requisitos.pago': pago,
      'comision.estado': estado,
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('comision_pago_deshecho', motivo || 'Pago deshecho')),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...this._autoria(),
    });
    return estado;
  },

  /**
   * Cierra el período de una comisión LISTA. Esto es lo único que una persona
   * decide: el "listo" se prende solo cuando los tres hechos están escritos.
   * @param {string} periodo 'YYYY-MM'
   */
  async cerrarPeriodo(aviso, periodo, nota = '') {
    const com = aviso?.comision;
    if (!com || com.aplica === false) throw new Error('Este evento no paga comisión.');
    if (com.estado === 'pagada') throw new Error('Esta comisión ya se cerró.');
    if (this.estadoComision(com) !== 'listo') {
      const f = this.faltantes(com).map(x => x.paso).join(', ');
      throw new Error(`Todavía falta: ${f || 'algún requisito'}.`);
    }
    if (!/^\d{4}-\d{2}$/.test((periodo || '').toString().trim())) throw new Error('Elige el período (YYYY-MM).');
    const a = this._autoria();
    await this._col().doc(aviso.id).update({
      'comision.estado': 'pagada',
      'comision.periodo': periodo,
      'comision.liberada_por': a.por_email || null,
      'comision.liberada_at': firebase.firestore.FieldValue.serverTimestamp(),
      ...(nota ? { 'comision.nota': nota.toString().slice(0, 300) } : {}),
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('comision_liberada', `Comisión liberada en el período ${periodo}${nota ? ` · ${nota}` : ''}`)),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...a,
    });
  },

  // Reabrir: un cierre equivocado se corrige, y queda dicho quién lo reabrió.
  async reabrirPeriodo(aviso, motivo = '') {
    const com = aviso?.comision;
    if (!com || com.estado !== 'pagada') throw new Error('Esta comisión no está cerrada.');
    const estado = this.estadoComision({ ...com, periodo: null, liberada_at: null });
    await this._col().doc(aviso.id).update({
      'comision.estado': estado,
      'comision.periodo': null,
      'comision.liberada_por': null,
      'comision.liberada_at': null,
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('comision_reabierta', motivo || 'Período reabierto')),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...this._autoria(),
    });
    return estado;
  },
  async get(id) {
    const d = await this._col().doc(id).get();
    return d.exists ? { id: d.id, ...d.data() } : null;
  },

  // Estado optimista: hecho cuando todos los pasos que aplican están hechos.
  _estadoDe(aviso, pasosNuevos) {
    if (aviso.estado === 'esperando' || aviso.estado === 'descartado') return aviso.estado;
    const pasos = { ...(aviso.pasos || {}), ...pasosNuevos };
    const aplican = Object.values(pasos).filter(p => p && p.aplica);
    if (!aplican.length) return 'pendiente';
    return aplican.every(p => p.hecho) ? 'hecho' : 'pendiente';
  },

  /**
   * Marca un paso como hecho. QBO acepta { facturar_desde: 'YYYY-MM-DD', ref };
   * POC acepta { nota }.
   */
  async marcarPaso(aviso, paso, datos = {}) {
    if (!['qbo', 'poc'].includes(paso)) throw new Error('Paso desconocido.');
    const actual = aviso.pasos?.[paso];
    if (!actual || !actual.aplica) throw new Error('Ese paso no aplica a este aviso.');
    if (actual.hecho) throw new Error('Ese paso ya está marcado.');
    if (aviso.estado === 'esperando') throw new Error('Este aviso espera la entrega: todavía no hay nada que facturar.');
    const a = this._autoria();
    const ahora = firebase.firestore.Timestamp.now();
    const nuevo = { ...actual, hecho: true, at: ahora, por_email: a.por_email };
    let detalle;
    if (paso === 'qbo') {
      const desde = (datos.facturar_desde || '').toString().trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error('Escribe desde qué fecha se factura.');
      nuevo.facturar_desde = desde;
      nuevo.ref = (datos.ref || '').toString().trim() || null;
      detalle = `QuickBooks hecho · facturar desde ${desde}${nuevo.ref ? ` · ref. ${nuevo.ref}` : ''}`;
    } else {
      nuevo.nota = (datos.nota || '').toString().trim() || null;
      detalle = `POC hecho${nuevo.nota ? ` · ${nuevo.nota}` : ''}`;
    }
    const estado = this._estadoDe(aviso, { [paso]: nuevo });
    await this._col().doc(aviso.id).update({
      [`pasos.${paso}`]: nuevo,
      estado,
      historial: firebase.firestore.FieldValue.arrayUnion(this._traza(`${paso}_hecho`, detalle)),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...a,
    });
    return { paso: nuevo, estado };
  },

  // Deshacer no borra nada: el historial dice quién marcó y quién deshizo.
  async deshacerPaso(aviso, paso, motivo = '') {
    const actual = aviso.pasos?.[paso];
    if (!actual || !actual.hecho) throw new Error('Ese paso no está marcado.');
    const a = this._autoria();
    const nuevo = { ...actual, hecho: false, at: null, por_email: null, facturar_desde: null, ref: null, nota: null };
    const estado = this._estadoDe(aviso, { [paso]: nuevo });
    await this._col().doc(aviso.id).update({
      [`pasos.${paso}`]: nuevo,
      estado,
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza(`${paso}_deshecho`, `${paso.toUpperCase()} deshecho (antes: ${actual.por_email || '—'})${motivo ? ` · ${motivo}` : ''}`)),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...a,
    });
    return { paso: nuevo, estado };
  },

  async descartar(aviso, { motivo, nota = '' } = {}) {
    if (!this.MOTIVOS_DESCARTE.some(m => m.codigo === motivo)) throw new Error('Elige el motivo.');
    const txt = (nota || '').toString().trim();
    if (motivo === 'otro' && !txt) throw new Error('Con "Otro" la nota es obligatoria.');
    const a = this._autoria();
    await this._col().doc(aviso.id).update({
      estado: 'descartado',
      descarte: { motivo, nota: txt, at: firebase.firestore.Timestamp.now(), por_email: a.por_email },
      historial: firebase.firestore.FieldValue.arrayUnion(
        this._traza('descartado', `${this.motivoLabel(motivo)}${txt ? ` · ${txt}` : ''}`)),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...a,
    });
  },

  async reactivar(aviso) {
    if (aviso.estado !== 'descartado') throw new Error('Este aviso no está descartado.');
    const a = this._autoria();
    const estado = this._estadoDe({ ...aviso, estado: 'pendiente' }, {});
    await this._col().doc(aviso.id).update({
      estado,
      descarte: null,
      historial: firebase.firestore.FieldValue.arrayUnion(this._traza('reactivado', 'Vuelve a la bandeja')),
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...a,
    });
  },

  // El servidor (onFacturacionAvisoWrite) re-arma el doc de mail_queue.
  async solicitarReenvio(aviso) {
    if (!aviso.correo?.mail_queue_id) throw new Error('Este aviso no quedó enlazado a un correo.');
    const a = this._autoria();
    await this._col().doc(aviso.id).update({
      reenvio_solicitado: { at: firebase.firestore.Timestamp.now(), por_email: a.por_email },
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      ...a,
    });
  },
};

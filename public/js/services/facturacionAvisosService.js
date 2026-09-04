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
  ROLES: ['administrador', 'recepcion', 'gerente', 'contabilidad'],

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

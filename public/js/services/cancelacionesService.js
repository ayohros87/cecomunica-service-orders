// CancelacionesService — enmiendas/terminaciones de contrato.
// Flujo profesional: solicitud (vendedor/recepción, con aviso + motivo tipificado)
// → aprobación (admin/gerente, segregación de funciones) → cierre (equipos
// recuperados). El estado del contrato (unidades activas) se DERIVA de las
// enmiendas aprobadas; el facturador futuro usa fecha_fin_facturacion por evento.
const CancelacionesService = {
  // Tipos de enmienda. (suspensión/sustitución: futuro)
  TIPOS: [
    { codigo: 'terminacion_total', label: 'Terminación total del contrato' },
    { codigo: 'baja_parcial',      label: 'Baja parcial (devolución de unidades)' },
  ],

  // Motivos tipificados (para analítica de churn). 'otro' habilita el detalle.
  MOTIVOS: [
    { codigo: 'fin_necesidad',    label: 'Fin de la necesidad / proyecto' },
    { codigo: 'precio',           label: 'Precio / presupuesto' },
    { codigo: 'servicio',         label: 'Insatisfacción con el servicio' },
    { codigo: 'fallas_equipo',    label: 'Fallas recurrentes del equipo' },
    { codigo: 'cierre_operacion', label: 'Cierre / reducción de operación' },
    { codigo: 'morosidad',        label: 'Morosidad / falta de pago' },
    { codigo: 'cambio_proveedor', label: 'Cambio de proveedor' },
    { codigo: 'migracion',        label: 'Migración tecnológica' },
    { codigo: 'otro',             label: 'Otro' },
  ],

  tipoLabel(codigo)   { return (this.TIPOS.find(t => t.codigo === codigo)   || {}).label || codigo || '—'; },
  motivoLabel(codigo) { return (this.MOTIVOS.find(m => m.codigo === codigo) || {}).label || codigo || '—'; },

  async crear(data) {
    const db = firebase.firestore();
    return db.collection('solicitudes_cancelacion').add({
      ...data,
      estado: 'pendiente',
      fecha_solicitud: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Lista por estado (o todas). Trae las más recientes primero.
  async listar({ estado = null, limit = 200 } = {}) {
    const db = firebase.firestore();
    let q = db.collection('solicitudes_cancelacion');
    if (estado) q = q.where('estado', '==', estado);
    const snap = await q.limit(limit).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
    return rows;
  },

  // Conteo de solicitudes pendientes (para el badge del menú de aprobadores).
  // Usa la agregación count() del servidor; cae a un get acotado si no existe.
  async contarPendientes() {
    const db = firebase.firestore();
    const q = db.collection('solicitudes_cancelacion').where('estado', '==', 'pendiente');
    try {
      const snap = await q.count().get();
      return snap.data().count;
    } catch (_) {
      const snap = await q.limit(100).get();
      return snap.size;
    }
  },

  async listarDeContrato(contratoDocId) {
    const db = firebase.firestore();
    const snap = await db.collection('solicitudes_cancelacion')
      .where('contrato_doc_id', '==', contratoDocId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
  },

  async aprobar(id, aprobadoPorUid) {
    const db = firebase.firestore();
    return db.collection('solicitudes_cancelacion').doc(id).update({
      estado: 'aprobada',
      aprobado_por: aprobadoPorUid,
      fecha_aprobacion: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async rechazar(id, aprobadoPorUid, motivoRechazo = '') {
    const db = firebase.firestore();
    return db.collection('solicitudes_cancelacion').doc(id).update({
      estado: 'rechazada',
      aprobado_por: aprobadoPorUid,
      motivo_rechazo: motivoRechazo,
      fecha_aprobacion: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Cierre del circuito físico: equipos recuperados/inspeccionados. Solo sobre
  // enmiendas aprobadas. (La inspección detallada por serial llega con el registro.)
  async cerrar(id, cerradoPorUid, { equiposRecibidos = true, condicionNotas = '' } = {}) {
    const db = firebase.firestore();
    return db.collection('solicitudes_cancelacion').doc(id).update({
      estado: 'cerrada',
      cerrado_por: cerradoPorUid,
      equipos_recibidos: !!equiposRecibidos,
      condicion_notas: condicionNotas || '',
      fecha_cierre: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  // Calcula la fecha de fin de facturación según el término elegido.
  // fin_mes → último día del mes de la nota; 30/60 días → nota + N días; otro → manual.
  calcularFechaFin(termino, fechaNotaISO, fechaOtraISO) {
    const base = fechaNotaISO ? new Date(fechaNotaISO + 'T00:00:00') : new Date();
    if (termino === 'fin_mes') {
      return new Date(base.getFullYear(), base.getMonth() + 1, 0);
    }
    if (termino === '30_dias') { const d = new Date(base); d.setDate(d.getDate() + 30); return d; }
    if (termino === '60_dias') { const d = new Date(base); d.setDate(d.getDate() + 60); return d; }
    if (termino === 'otro' && fechaOtraISO) return new Date(fechaOtraISO + 'T00:00:00');
    return base;
  },
};
window.CancelacionesService = CancelacionesService;

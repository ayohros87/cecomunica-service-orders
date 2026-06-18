// CancelacionesService — solicitudes de baja de equipos de un contrato.
// Flujo: solicitud (vendedor/recepción) → cola → aprobación (admin). Registra
// la fecha de fin de facturación según el término; el facturador (futuro) la usa.
const CancelacionesService = {
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

  // Calcula la fecha de fin de facturación según el término elegido.
  // fin_mes → último día del mes de la nota; 30/60 días → nota + N días; otro → manual.
  calcularFechaFin(termino, fechaNotaISO, fechaOtraISO) {
    const base = fechaNotaISO ? new Date(fechaNotaISO + 'T00:00:00') : new Date();
    if (termino === 'fin_mes') {
      return new Date(base.getFullYear(), base.getMonth() + 1, 0); // día 0 del mes siguiente = último del actual
    }
    if (termino === '30_dias') { const d = new Date(base); d.setDate(d.getDate() + 30); return d; }
    if (termino === '60_dias') { const d = new Date(base); d.setDate(d.getDate() + 60); return d; }
    if (termino === 'otro' && fechaOtraISO) return new Date(fechaOtraISO + 'T00:00:00');
    return base;
  },
};
window.CancelacionesService = CancelacionesService;

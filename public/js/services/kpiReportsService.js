// Servicio de la colección kpi_reports (reporte ejecutivo de KPIs a la junta).
// Un doc por mes, ID "YYYY-MM". Solo admin puede leer/escribir (firestore.rules).
// Métricas base por mes; todo lo derivable (YTD, netas, ARPU, variaciones) se
// calcula en js/domain/kpiDerived.js — nunca se almacena.
const KpiReportsService = {

  async getMes(mes) {
    const db = firebase.firestore();
    const snap = await db.collection('kpi_reports').doc(mes).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  // Colección completa ordenada por mes ascendente (~12 docs/año — cargarla
  // entera es trivial y evita índices).
  async listAll() {
    const db = firebase.firestore();
    const snap = await db.collection('kpi_reports').get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  // Upsert de un mes. `data` trae solo métricas/comentarios; los metadatos de
  // rastro se estampan aquí. merge:true para no pisar campos que no vienen
  // (p.ej. un import de métricas conserva comentarios/estado existentes).
  async upsertMes(mes, data) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    return db.collection('kpi_reports').doc(mes).set({
      ...data,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: user ? user.uid : null,
    }, { merge: true });
  },

  // Import masivo (backfill / actualización mensual desde Excel).
  // `items` = [{ mes, data }]. Firestore limita batches a 500 ops; se trocea a 400.
  async upsertBatch(items) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    for (let i = 0; i < items.length; i += 400) {
      const batch = db.batch();
      for (const { mes, data } of items.slice(i, i + 400)) {
        batch.set(db.collection('kpi_reports').doc(mes), {
          ...data,
          updated_at: now,
          updated_by: user ? user.uid : null,
        }, { merge: true });
      }
      await batch.commit();
    }
  },

  async setEstado(mes, estado) {
    return this.upsertMes(mes, { estado });
  },

  async updateComentarios(mes, comentarios) {
    return this.upsertMes(mes, { comentarios });
  },
};

window.KpiReportsService = KpiReportsService;

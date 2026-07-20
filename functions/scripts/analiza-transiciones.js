/**
 * analiza-transiciones.js — SOLO LECTURA. Diagnóstico de por qué la transición
 * de equipos (renovación/adición/reemplazo) no se está registrando.
 *
 * Para cada contrato "transicionable" (activo/aprobado, accion Renovación/
 * Adición o codigo_tipo REEMP, sin renovacion_sin_equipo) mide los
 * prerequisitos reales de la página de transición:
 *   - ¿tiene mapeos registrados? (transicion_mapeos_count)
 *   - ¿tiene contrato_origen_id? (sin él se listan TODOS los equipos del cliente)
 *   - ¿tiene seriales registrados? (sin entrantes no hay nada que mapear)
 *   - ¿el cliente tiene unidades en el pool como salientes (asignado/en_cliente)?
 *   - edad desde la aprobación
 * Y del lado del pool: unidades pendiente_devolucion y su antigüedad.
 *
 * USAGE (desde functions/): node scripts/analiza-transiciones.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dias = (ts) => {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : null;
};

(async () => {
  const snap = await db.collection("contratos")
    .where("estado", "in", ["activo", "aprobado"]).get();

  const transicionables = [];
  snap.forEach((d) => {
    const c = d.data();
    if (c.deleted) return;
    const es = !c.renovacion_sin_equipo
      && (c.accion === "Renovación" || c.accion === "Adición" || c.codigo_tipo === "REEMP");
    if (es) transicionables.push({ id: d.id, ...c });
  });

  // Pool por cliente: unidades candidatas a saliente (asignado/en_cliente).
  const poolSnap = await db.collection("equipos_pool")
    .where("estado", "in", ["asignado_contrato", "en_cliente"]).get();
  const unidadesPorCliente = new Map();
  poolSnap.forEach((d) => {
    const u = d.data();
    const cid = u.asignacion?.cliente_id || null;
    if (!cid) return;
    unidadesPorCliente.set(cid, (unidadesPorCliente.get(cid) || 0) + 1);
  });

  const filas = [];
  for (const c of transicionables) {
    filas.push({
      contrato: c.contrato_id || c.id,
      cliente: (c.cliente_nombre || "").slice(0, 28),
      accion: c.accion || c.codigo_tipo || "",
      estado: c.estado,
      legacySer: c.seriales_estado === "legacy" ? "SI" : "",
      mapeos: Number(c.transicion_mapeos_count || 0),
      origen: c.contrato_origen_id ? "SI" : "NO",
      seriales: Number(c.seriales_count || 0),
      omitidos: Number(c.seriales_omitidos_count || 0),
      salientesPool: unidadesPorCliente.get(c.cliente_id) || 0,
      diasAprob: dias(c.fecha_aprobacion),
    });
  }
  filas.sort((a, b) => (b.diasAprob ?? -1) - (a.diasAprob ?? -1));

  const conMapeos = filas.filter(f => f.mapeos > 0);
  const sinMapeos = filas.filter(f => f.mapeos === 0);
  const sinOrigen = sinMapeos.filter(f => f.origen === "NO");
  const sinSeriales = sinMapeos.filter(f => f.seriales === 0);
  const sinSalientes = sinMapeos.filter(f => f.salientesPool === 0);

  console.log("=== CONTRATOS TRANSICIONABLES (activo/aprobado, Renovación/Adición/REEMP con equipo) ===");
  console.log(`total: ${filas.length} · con mapeos: ${conMapeos.length} · SIN mapeos: ${sinMapeos.length}`);
  console.log(`de los SIN mapeos → sin contrato_origen_id: ${sinOrigen.length} · sin seriales registrados: ${sinSeriales.length} · cliente sin salientes en pool: ${sinSalientes.length}`);
  console.log("");
  console.table(filas);

  // Pool: pendiente_devolucion
  const pendSnap = await db.collection("equipos_pool")
    .where("pendiente_devolucion", "==", true).get();
  const pend = [];
  pendSnap.forEach((d) => {
    const u = d.data();
    pend.push({
      serial: u.serial || d.id,
      modelo: (u.modelo_label || "").slice(0, 24),
      estado: u.estado,
      cliente: (u.asignacion?.cliente_nombre || "").slice(0, 28),
      diasFlag: dias(u.updated_at),
    });
  });
  pend.sort((a, b) => (b.diasFlag ?? -1) - (a.diasFlag ?? -1));
  console.log("\n=== POOL: unidades pendiente_devolucion (salientes mapeados aún con el cliente) ===");
  console.log(`total: ${pend.length}`);
  console.table(pend.slice(0, 40));

  // Cuarentena para contexto
  const cuar = await db.collection("equipos_pool").where("estado", "==", "devuelto_revision").count().get();
  console.log(`\ndevuelto_revision (cuarentena): ${cuar.data().count}`);
})();

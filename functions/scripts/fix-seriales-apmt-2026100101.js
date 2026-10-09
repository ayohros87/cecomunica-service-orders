/**
 * fix-seriales-apmt-2026100101.js
 *
 * OS 2026100101 (APMT PANAMA, "Reparación - Radios Alquiladas"). Solangel no
 * pudo proponer el reemplazo de los dos radios descartados en el QC: el
 * wizard decía "No adquirido en CECOMUNICA". Las dos filas de la orden se
 * transcribieron mal al recibirla, y como la orden no tiene contrato ligado,
 * onOrdenWritePool dio de alta fichas NUEVAS "del cliente, sin factura":
 *
 *   · B11000165 (NX-410-R) — sobra un 0. El radio es B1100165, NX-410-R del
 *     alquiler ALQ20260514-02 (los 16 NX-410-R del contrato cuadran con él).
 *   · B6C10768 se recibió como NX-410-R, pero es NX-420-R: así está en el
 *     contrato y en la programación 2026051802. Con el modelo cambiado, el
 *     pool partió la ficha fantasma B6C10768__nei7dzRnqyFgIrciPQql.
 *
 * Qué hace:
 *   1. borra las dos fichas fantasma (nadie más las cita: ni gestiones ni
 *      otras órdenes);
 *   2. B6C10768 real: en_cliente → en_taller con orden_actual_id (su fila no
 *      cambia de serial, así que el trigger no la vuelve a mirar);
 *   3. corrige la orden: fila y QC (por_equipo, descartados, seriales). El
 *      trigger ve B1100165 como equipo nuevo y lo pasa a en_taller con
 *      ingreso_taller — sobre la ficha existente no pisa propiedad ni contrato.
 *
 * B3900175 (también ficha nueva "del cliente") NO se toca: puede ser B3800175
 * del contrato, pero el serial es plausible — lo confirma el taller.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-seriales-apmt-2026100101.js          # dry-run
 *   node scripts/fix-seriales-apmt-2026100101.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const WRITE = process.argv.includes("--write");
const EMAIL = "script:fix-seriales-apmt-2026100101";
const ORDEN = "2026100101";
const NX420 = { modelo_id: "68N7zR5APzO3xIaJCZCU", modelo: "NX-420-R" };
const MAL = "B11000165", BIEN = "B1100165";
const FANTASMAS = ["B11000165", "B6C10768__nei7dzRnqyFgIrciPQql"];

async function borrar(ref) {
  const movs = await ref.collection("movimientos").get();
  const b = db.batch();
  movs.docs.forEach((m) => b.delete(m.ref));
  b.delete(ref);
  await b.commit();
}

(async () => {
  console.log(WRITE ? "*** ESCRIBIENDO ***\n" : "*** DRY-RUN ***\n");
  const ordenRef = db.collection("ordenes_de_servicio").doc(ORDEN);
  const o = (await ordenRef.get()).data();

  // ── Salvaguardas ────────────────────────────────────────────────────────
  const real768 = (await db.collection("equipos_pool").doc("B6C10768").get()).data();
  const real165 = (await db.collection("equipos_pool").doc(BIEN).get()).data();
  if (real768?.modelo_id !== NX420.modelo_id || real768?.asignacion?.contrato_id !== "ALQ20260514-02") throw new Error("B6C10768 real no es el esperado");
  if (real165?.asignacion?.contrato_id !== "ALQ20260514-02") throw new Error("B1100165 real no es el esperado");
  const gs = await db.collection("gestiones").where("seriales_norm", "array-contains-any", ["B11000165", "B6C10768"]).get();
  if (gs.size) throw new Error(`Hay gestiones que citan los seriales: ${gs.docs.map((d) => d.id)}`);

  // ── 1. Fantasmas ────────────────────────────────────────────────────────
  for (const id of FANTASMAS) {
    const ref = db.collection("equipos_pool").doc(id);
    const s = await ref.get();
    if (!s.exists) { console.log(`  pool ${id}: ya no existe`); continue; }
    const x = s.data();
    if (x.propiedad !== "cliente" || x.venta || x.origen !== "migracion_orden" || x.orden_actual_id !== ORDEN) {
      throw new Error(`${id} no tiene la forma de ficha fantasma`);
    }
    console.log(`  pool ${id}: BORRAR (${x.modelo_label}, ${x.propiedad}, ${x.estado})`);
    if (WRITE) await borrar(ref);
  }

  // ── 2. B6C10768 real al taller ──────────────────────────────────────────
  const ref768 = db.collection("equipos_pool").doc("B6C10768");
  console.log(`  pool B6C10768: ${real768.estado} → en_taller, orden_actual_id ${ORDEN}`);
  if (WRITE && real768.orden_actual_id !== ORDEN) {
    const b = db.batch();
    b.set(ref768, { estado: "en_taller", orden_actual_id: ORDEN, serial_compartido: false,
      updated_at: FV.serverTimestamp(), updated_by_email: EMAIL }, { merge: true });
    b.set(ref768.collection("movimientos").doc(), {
      tipo: "ingreso_taller", de_estado: real768.estado, a_estado: "en_taller",
      ref: { tipo: "orden", id: ORDEN, label: ORDEN },
      notas: `Entró al taller el 2026-10-01 en la OS ${ORDEN}, registrado como NX-410-R: eso partió una ficha aparte. Corregido 2026-10-09.`,
      at: FV.serverTimestamp(), por: "system", por_email: EMAIL,
    });
    await b.commit();
  }

  // ── 3. La orden ─────────────────────────────────────────────────────────
  const equipos = o.equipos.map((e) => {
    if (e.numero_de_serie === "B6C10768") return { ...e, ...NX420 };
    if (e.numero_de_serie === MAL) return { ...e, serial: BIEN, numero_de_serie: BIEN };
    return e;
  });
  const qc = JSON.parse(JSON.stringify(o.qc));
  for (const d of Object.values(qc.por_equipo || {})) {
    if (d.serial === "B6C10768") d.modelo = NX420.modelo;
    if (d.serial === MAL) d.serial = BIEN;
  }
  const sw = (arr) => (arr || []).map((s) => (s === MAL ? BIEN : s));
  qc.equipos_descartados = sw(qc.equipos_descartados);
  qc.seriales = sw(qc.seriales);
  if (qc.equipos_aprobados) qc.equipos_aprobados = sw(qc.equipos_aprobados);
  console.log("  orden filas:", equipos.map((e) => `${e.numero_de_serie} ${e.modelo}`).join(" · "));
  console.log("  qc descartados:", qc.equipos_descartados.join(", "));
  if (WRITE) {
    // qc contiene timestamps: reconstruirlos desde el original.
    const qcFinal = { ...o.qc, por_equipo: Object.fromEntries(Object.entries(o.qc.por_equipo || {}).map(([k, v]) =>
      [k, { ...v, serial: qc.por_equipo[k].serial, modelo: qc.por_equipo[k].modelo }])),
      equipos_descartados: qc.equipos_descartados, seriales: qc.seriales,
      ...(qc.equipos_aprobados ? { equipos_aprobados: qc.equipos_aprobados } : {}) };
    await ordenRef.update({
      equipos, qc: qcFinal,
      os_logs: FV.arrayUnion({ action: "CORREGIR_SERIALES", by: EMAIL, at_iso: new Date().toISOString(),
        nota: `${MAL} → ${BIEN} (sobraba un 0); B6C10768 es NX-420-R, no NX-410-R. Ambos del alquiler ALQ20260514-02.` }),
    });
  }
  console.log(WRITE ? "\nListo." : "\nDRY-RUN. Corre con --write.");
})().catch((e) => { console.error(e); process.exit(1); });

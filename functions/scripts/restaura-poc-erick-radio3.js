/**
 * restaura-poc-erick-radio3.js — reversa puntual del borrado accidental del
 * RADIO 3 de ERICK REYES (contrato PROP20260727-03), 2026-07-31.
 *
 * Qué pasó: 11:07 a.m. recepción cambió el serial del device POC 22806A0312 →
 * 26123A0793 (reemplazo por daño de display, correcto). 11:13 a.m. inventario
 * corrigió a bodega la ficha del serial SALIENTE con el check "desactivar el
 * device POC vinculado": ese vínculo estaba rancio y apuntaba al mismo device,
 * que ya era el RADIO 3 con el serial nuevo. Se desactivó el radio equivocado y
 * la programación del cliente quedó en 4 de 5 equipos.
 *
 * Reversa (el device nunca se borró de verdad, solo `deleted:true`):
 *   · deleted → false
 *   · la ficha del pool de 26123A0793 vuelve a enlazar poc_device_id (el
 *     trigger desplegado no rehace el enlace al restaurar; la rama `revivido`
 *     de onPocDeviceWritePool lo cubre de aquí en adelante)
 *   · entrada en poc_logs con accion 'restaurar' — el borrado original no dejó
 *     ninguna, por eso hubo que reconstruirlo desde el kardex del pool
 * La SIM (8950702501402280214 / 60058624) nunca se liberó: sigue en el device y
 * en sim_cards, así que no hay nada que reasignar.
 *
 * USAGE (desde functions/):
 *   node scripts/restaura-poc-erick-radio3.js            # dry-run
 *   node scripts/restaura-poc-erick-radio3.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const APLICAR = process.argv.includes("--aplicar");
const DEVICE_ID = "oUc2To84qIvKoWtuaS0D";
const SERIAL = "26123A0793";

(async () => {
  console.log(APLICAR ? "=== APLICANDO ===" : "=== DRY-RUN (usa --aplicar para escribir) ===");

  const ref = db.collection("poc_devices").doc(DEVICE_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error("El device no existe — abortando."); process.exit(1); }
  const d = snap.data();
  console.log(`\nDevice ${DEVICE_ID}: ${d.radio_name} · unit ${d.unit_id} · serial ${d.serial}`);
  console.log(`  cliente ${d.cliente_nombre} · contrato ${d.contrato_id}`);
  console.log(`  SIM ${d.sim_number || "—"} / ${d.sim_phone || "—"} · deleted=${d.deleted}`);

  if (pool.normSerial(d.serial || "") !== pool.normSerial(SERIAL)) {
    console.error(`\nEl serial no es ${SERIAL} — abortando por seguridad.`);
    process.exit(1);
  }
  if (d.deleted !== true) {
    console.log("\nYa está activo: nada que restaurar.");
  }

  const { ref: fichaRef, data: ficha } = await pool.resolver(
    SERIAL, d.modelo_id || null, d.modelo_label || d.modelo || "", { adoptarSiExiste: true });
  console.log(`\nFicha del pool ${fichaRef.id}: estado=${ficha?.estado || "(no existe)"}`
    + ` · poc_device_id=${ficha?.poc_device_id ?? "null"}`);
  const hayQueEnlazar = !!ficha && ficha.poc_device_id !== DEVICE_ID;

  if (!APLICAR) {
    console.log("\nSe haría: deleted→false"
      + (hayQueEnlazar ? `, ficha ${fichaRef.id}.poc_device_id → ${DEVICE_ID}` : "")
      + ", + poc_log 'restaurar'.");
    process.exit(0);
  }

  if (d.deleted === true) {
    await ref.update({
      deleted: false,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("\n✔ Device restaurado (deleted=false)");
  }
  if (hayQueEnlazar) {
    await fichaRef.set({
      poc_device_id: DEVICE_ID,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`✔ Ficha ${fichaRef.id} re-enlazada al device`);
  }
  await db.collection("poc_logs").add({
    equipo_id: DEVICE_ID,
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    usuario: "system",
    accion: "restaurar",
    origen: "script-restaura-poc-erick-radio3",
    cambios: { antes: { ...d }, despues: { deleted: false } },
  });
  console.log("✔ poc_log registrado");
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

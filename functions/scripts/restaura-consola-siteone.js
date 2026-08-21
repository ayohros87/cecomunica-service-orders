/**
 * restaura-consola-siteone.js — reversa del vaciado accidental de la CONSOLA
 * SITE ONE (poc_devices/Vw64vNE35qsnFjDYQb2n), 2026-06-30.
 *
 * Qué pasó: 30-jun-2026 3:46 p.m. (Panamá) recepción le asignó modelo CONSOLA
 * al device y 11 segundos después un segundo guardado escribió el formulario
 * en blanco: activo→false, serial "CONSOLA"→"", radio_name→"", grupos (32)→[],
 * operador→"", modelo_label→"". El doc nunca se borró (deleted=false), pero
 * quedó invisible: sin nombre ni serial no lo encuentra ninguna búsqueda y
 * con activo=false no cuenta como consola activa.
 *
 * Reversa: se restauran los campos con el estado "antes" del poc_log del
 * vaciado y se agregan los 3 grupos que pidió el cliente el 2026-08-21
 * (SO-TAPA COCO, SO-MAREA VERDE, SO-ASF MODIF). OJO: "ASF MODIF" (sin
 * prefijo) ya existía desde jun-2026 y se conserva — si SO-ASF MODIF es un
 * rename, quitar el viejo es decisión de recepción, no de este script.
 * El modelo NO se restaura: el doc "CONSOLA CONSOLA" que recepción le asignó
 * ese día ya no existe en `modelos` (fue borrado del catálogo) y las demás
 * consolas del POC viven sin modelo.
 *
 * USAGE (desde functions/):
 *   node scripts/restaura-consola-siteone.js            # dry-run
 *   node scripts/restaura-consola-siteone.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APLICAR = process.argv.includes("--aplicar");
const DEVICE_ID = "Vw64vNE35qsnFjDYQb2n";
const CLIENTE_ID = "WWauXBmXwo8LNoNu3J6M"; // SITE ONE SECURITY

// Estado "antes" del log del vaciado (2026-06-30T20:46:45Z) + rename cosmético
// del trailing space en radio_name.
const GRUPOS_RESTAURADOS = [
  "TACOS SAN FRANCISCO", "TACOS SELINA CASCO", "TACOS BOCAS DEL TORO",
  "TACOS VENAO", "TACOS BOQUETE", "BASE", "OPERACIONES", "PROYECTO",
  "SELINA", "TIGO", "SO-MECO BIQUE", "SO-MECO HOWARD", "SO-MECO GONZALILLO",
  "MECO PP STA ANA-SO-", "MECO Q STA ANA-SO-", "MECO PP Q RAFAEL-SO-",
  "MECO Q CIRUELAS-SO-", "MECO Q MARINA-SO-", "MECO Q FLORES-SO-",
  "TABOR-SO-", "NUMAR-SO-", "CIUDAD DEL ESTE", "LGC", "PLAZA VIVO",
  "MECO CENTENARIO - SO-", "AMERICAN TRAILERS", "PAPAGAYO", "APROCOSA -SO",
  "JDP", "SO-MECOCD", "ASF MODIF", "SO-CDP",
];
const GRUPOS_NUEVOS = ["SO-TAPA COCO", "SO-MAREA VERDE", "SO-ASF MODIF"];

const RESTAURA = {
  activo: true,
  serial: "CONSOLA",
  radio_name: "CONSOLA SITE ONE",
  operador: "MAS MOVIL",
  grupos: [...GRUPOS_RESTAURADOS, ...GRUPOS_NUEVOS],
};

(async () => {
  console.log(APLICAR ? "=== APLICANDO ===" : "=== DRY-RUN (usa --aplicar para escribir) ===");

  const ref = db.collection("poc_devices").doc(DEVICE_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error("El device no existe — abortando."); process.exit(1); }
  const d = snap.data();
  console.log(`\nDevice ${DEVICE_ID}: cliente=${d.cliente} · activo=${d.activo} · deleted=${d.deleted}`);
  console.log(`  serial="${d.serial}" · radio_name="${d.radio_name}" · grupos=${(d.grupos || []).length}`);

  if (d.cliente_id !== CLIENTE_ID) {
    console.error(`\ncliente_id no es ${CLIENTE_ID} — abortando por seguridad.`);
    process.exit(1);
  }
  if (d.activo === true && d.serial) {
    console.log("\nYa está restaurado: nada que hacer.");
    process.exit(0);
  }
  console.log("\nSe escribiría:");
  for (const [k, v] of Object.entries(RESTAURA)) {
    console.log(`  ${k}: ${JSON.stringify(v).slice(0, 400)}`);
  }
  console.log(`  (grupos: ${GRUPOS_RESTAURADOS.length} restaurados + ${GRUPOS_NUEVOS.length} nuevos)`);

  if (!APLICAR) process.exit(0);

  await ref.update({
    ...RESTAURA,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: null,
    updated_by_email: "script-restaura-consola-siteone",
  });
  console.log("\n✔ Consola restaurada");

  await db.collection("poc_logs").add({
    equipo_id: DEVICE_ID,
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    usuario: "system",
    accion: "restaurar",
    origen: "script-restaura-consola-siteone",
    cambios: { antes: { ...d }, despues: { ...RESTAURA } },
  });
  console.log("✔ poc_log registrado");
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

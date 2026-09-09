/**
 * fix-ip-arraijan-2026-09-09.js — corrige el IP (servidor POC) de la ficha de
 * MUNICIPIO DE ARRAIJAN.
 *
 * QUÉ PASABA
 *   La ficha traía "gob.cecomunica.com", que viene del import de POC del
 *   2025-07-17 (56 equipos legacy) y que ni siquiera está en la lista de
 *   empresa/IPs. Todos los lotes que recepción ha creado desde entonces
 *   —2025-09-08 (15), 2025-12-15 (10), 2026-03-09 (10)— van a
 *   "gob.cecomunica.net". Recepción corregía el campo a mano en cada batch y,
 *   al cargar el archivo del vendedor, la página lo devolvía al valor de la
 *   ficha ("se está borrando el servidor del cliente", Brenda 2026-09-09).
 *   El lado de la página quedó arreglado en nuevo-batch.js; esto arregla el dato.
 *
 * NO toca los 56 equipos legacy que quedaron con el .com: son fichas viejas e
 * inactivas y no son autoridad sobre nada.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-ip-arraijan-2026-09-09.js          # muestra qué haría
 *   node scripts/fix-ip-arraijan-2026-09-09.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const CLIENTE_ID = "TDdGDl3FD6nmKCONJLzV";   // MUNICIPIO DE ARRAIJAN
const IP_CORRECTO = "gob.cecomunica.net";
const APLICAR = process.argv.includes("--aplicar");

(async () => {
  const db = admin.firestore();
  const ref = db.collection("clientes").doc(CLIENTE_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No existe el cliente ${CLIENTE_ID}`);
  const antes = snap.data().ip || "(sin IP)";
  console.log(`${snap.data().nombre}: ip "${antes}" → "${IP_CORRECTO}"`);

  if (antes === IP_CORRECTO) return console.log("Ya está correcto — nada que hacer.");
  if (!APLICAR) return console.log("Simulación. Corre con --aplicar para escribirlo.");

  await ref.update({
    ip: IP_CORRECTO,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by_email: "script:fix-ip-arraijan-2026-09-09",
  });
  console.log("Listo.");
})().catch((e) => { console.error(e); process.exit(1); });

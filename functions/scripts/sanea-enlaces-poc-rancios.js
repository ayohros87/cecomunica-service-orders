/**
 * sanea-enlaces-poc-rancios.js — limpia los `poc_device_id` que apuntan a un
 * device POC que YA NO lleva ese serial.
 *
 * Cómo se ensucian: al device POC se le corrige el serial (typo del batch, o un
 * reemplazo de radio) y la ficha del serial VIEJO se quedaba apuntando al mismo
 * device, que a esas alturas ya representa OTRO radio. El trigger solo
 * desenlazaba al BORRAR el device — arreglado en onPocDeviceWritePool (b63127a
 * + rama de restauración); este script barre lo que quedó de antes.
 *
 * Por qué importa: el modal "Corregir estado → En bodega" ofrece desactivar
 * "el device POC vinculado" y seguía el enlace rancio. Así desapareció el
 * RADIO 3 de ERICK REYES el 2026-07-31 (se corrigió a bodega el serial saliente
 * 22806A0312 y el borrado cayó sobre el device que 6 minutos antes había pasado
 * al serial entrante 26123A0793). La pantalla ya valida el serial antes de
 * borrar; esto le quita la carga al dato.
 *
 * Qué hace por ficha:
 *   · device inexistente / borrado / con OTRO serial → poc_device_id = null.
 *   · si el device sigue vivo, su ficha REAL (la del serial que lleva hoy) se
 *     enlaza — solo cuando está vacía y ninguna otra ficha reclama ese device.
 *   · movimiento `correccion_migracion` en el kardex por cada ficha tocada.
 * El estado, la asignación y la condición NO se tocan: esto es reparación de
 * un puntero, no un movimiento físico.
 *
 * USAGE (desde functions/):
 *   node scripts/sanea-enlaces-poc-rancios.js            # dry-run (no escribe)
 *   node scripts/sanea-enlaces-poc-rancios.js --aplicar  # escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const APLICAR = process.argv.includes("--aplicar");

const movimiento = (notas) => ({
  at: admin.firestore.FieldValue.serverTimestamp(),
  por: "system", por_email: null,
  tipo: "correccion_migracion",
  de_estado: null, a_estado: null,
  ref: null,
  notas,
});

(async () => {
  console.log(APLICAR ? "=== APLICANDO CAMBIOS ===" : "=== DRY-RUN (usa --aplicar para escribir) ===");

  const devSnap = await db.collection("poc_devices").get();
  const devices = new Map();
  const fichaDeSerial = new Map();  // serial_norm del device → [deviceId]
  for (const d of devSnap.docs) {
    const p = d.data();
    devices.set(d.id, p);
    const n = pool.normSerial(p.serial || "");
    if (!n) continue;
    if (!fichaDeSerial.has(n)) fichaDeSerial.set(n, []);
    fichaDeSerial.get(n).push(d.id);
  }

  const poolSnap = await db.collection("equipos_pool").get();
  const fichas = poolSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const serialDeFicha = (f) => f.serial_norm || pool.normSerial(f.serial || "") || f.id.split("__")[0];
  // Quién reclama cada device hoy (para no enlazar dos fichas al mismo).
  const reclamantes = new Map();
  for (const f of fichas) {
    if (!f.poc_device_id) continue;
    if (!reclamantes.has(f.poc_device_id)) reclamantes.set(f.poc_device_id, []);
    reclamantes.get(f.poc_device_id).push(f);
  }

  const plan = [];   // { ficha, motivo, huerfano: deviceId|null }
  for (const f of fichas) {
    if (!f.poc_device_id) continue;
    const dev = devices.get(f.poc_device_id);
    const propio = serialDeFicha(f);
    if (!dev) { plan.push({ ficha: f, motivo: "device inexistente", huerfano: null }); continue; }
    if (dev.deleted === true) {
      plan.push({ ficha: f, motivo: `device borrado (${dev.serial || "?"})`, huerfano: null });
      continue;
    }
    const serialDev = pool.normSerial(dev.serial || "");
    if (serialDev !== propio) {
      plan.push({
        ficha: f,
        motivo: `el device hoy es ${dev.serial} (${dev.radio_name || dev.unit_id || "?"}`
          + ` · ${dev.cliente_nombre || dev.cliente || "sin cliente"})`,
        huerfano: f.poc_device_id,
      });
    }
  }

  console.log(`\nFichas con enlace POC: ${reclamantes.size} · RANCIAS: ${plan.length}\n`);
  if (!plan.length) { console.log("Nada que sanear. ✔"); process.exit(0); }

  // Re-enlaces seguros: el device vivo cuya ficha real quedó sin enlace.
  const reenlaces = [];
  for (const p of plan) {
    if (!p.huerfano) continue;
    const dev = devices.get(p.huerfano);
    const suSerial = pool.normSerial(dev.serial || "");
    // ¿alguien más (aparte de la ficha rancia) ya reclama este device?
    const otros = (reclamantes.get(p.huerfano) || []).filter((f) => f.id !== p.ficha.id);
    if (otros.length) continue;
    const candidatas = fichas.filter((f) => serialDeFicha(f) === suSerial && !f.poc_device_id);
    if (candidatas.length !== 1) continue;   // 0 = no existe ficha; >1 = ambiguo
    reenlaces.push({ ficha: candidatas[0], deviceId: p.huerfano, serial: dev.serial });
  }

  for (const p of plan) {
    console.log(`  ${p.ficha.id.padEnd(34)} serial ${String(p.ficha.serial || "").padEnd(12)}`
      + ` → desenlaza · ${p.motivo}`);
  }
  console.log(`\nRe-enlaces seguros (la ficha real del device estaba sin enlace): ${reenlaces.length}`);
  for (const r of reenlaces) console.log(`  ${r.ficha.id.padEnd(34)} ← device de ${r.serial}`);

  if (!APLICAR) { console.log("\nDry-run: no se escribió nada."); process.exit(0); }

  for (const p of plan) {
    await p.ficha.ref.set({
      poc_device_id: null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await p.ficha.ref.collection("movimientos").add(movimiento(
      `Enlace POC obsoleto limpiado: ${p.motivo} (sanea-enlaces-poc-rancios.js)`));
  }
  for (const r of reenlaces) {
    await r.ficha.ref.set({
      poc_device_id: r.deviceId,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await r.ficha.ref.collection("movimientos").add(movimiento(
      `Enlace POC restablecido con el device de ${r.serial} (sanea-enlaces-poc-rancios.js)`));
  }
  console.log(`\nListo: ${plan.length} desenlazadas, ${reenlaces.length} re-enlazadas.`);
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });

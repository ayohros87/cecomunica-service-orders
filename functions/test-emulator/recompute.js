// Prueba de INTEGRACIÓN de recomputarContadorTx contra el emulador de Firestore.
// Corre con: firebase emulators:exec --only firestore "node test-emulator/recompute.js"
// (emulators:exec exporta FIRESTORE_EMULATOR_HOST; usamos un projectId demo-* sin
// credenciales). Vive FUERA de test/ para que `node --test` (npm test) no lo levante
// —requiere el emulador y fallaría en un run de unit tests normal.
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "demo-recompute-test" });

// Requerir DESPUÉS de initializeApp (contractCache -> lib/admin llama admin.firestore()).
const { recomputarContadorTx } = require("../src/domain/contractCache");
const db = admin.firestore();

const assert = require("node:assert/strict");

async function seed(cid, ordenes) {
  await db.collection("contratos").doc(cid).set({ contrato_id: cid, os_count: 999, equipos_total: 999 });
  for (const [ordenId, data] of Object.entries(ordenes)) {
    await db.collection("contratos").doc(cid).collection("ordenes").doc(ordenId).set(data);
  }
}

async function leerContador(cid) {
  const d = (await db.collection("contratos").doc(cid).get()).data();
  return { os_count: d.os_count, equipos_total: d.equipos_total, tiene_os: d.tiene_os };
}

async function main() {
  // Caso 1: 3 vigentes (una eliminada no cuenta) → os_count=2, equipos_total=5
  await seed("C1", {
    o1: { equipos_count: 3 },
    o2: { equipos_count: 4, eliminado: true },
    o3: { equipos_count: 2 },
  });
  await recomputarContadorTx("C1");
  assert.deepEqual(await leerContador("C1"), { os_count: 2, equipos_total: 5, tiene_os: true });
  console.log("✔ caso 1: cuenta vigentes y excluye eliminadas");

  // Caso 2: todas eliminadas → ceros y tiene_os=false
  await seed("C2", { o1: { equipos_count: 3, eliminado: true } });
  await recomputarContadorTx("C2");
  assert.deepEqual(await leerContador("C2"), { os_count: 0, equipos_total: 0, tiene_os: false });
  console.log("✔ caso 2: todas eliminadas → ceros");

  // Caso 3: idempotencia — correrlo 2x da lo mismo
  await recomputarContadorTx("C1");
  assert.deepEqual(await leerContador("C1"), { os_count: 2, equipos_total: 5, tiene_os: true });
  console.log("✔ caso 3: idempotente");

  // Caso 4: concurrencia — 5 recomputes en paralelo sobre el mismo contrato no
  // se corrompen (las transacciones se serializan); el resultado sigue correcto.
  await seed("C4", { o1: { equipos_count: 1 }, o2: { equipos_count: 2 }, o3: { equipos_count: 3 } });
  await Promise.all(Array.from({ length: 5 }, () => recomputarContadorTx("C4")));
  assert.deepEqual(await leerContador("C4"), { os_count: 3, equipos_total: 6, tiene_os: true });
  console.log("✔ caso 4: 5 recomputes concurrentes → contador consistente");

  console.log("\nTODOS LOS CASOS DE INTEGRACIÓN PASARON");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e.message); process.exit(1); });

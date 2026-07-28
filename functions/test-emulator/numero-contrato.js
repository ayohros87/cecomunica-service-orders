// Integración del número de contrato ({TIPO}{YYYYMMDD}-{NN}) contra el emulador.
// Corre con: firebase emulators:exec --only firestore "node functions/test-emulator/numero-contrato.js"
//
// Congela las DOS regresiones que produjeron números repetidos en producción
// (ALQ20260723-01 en 3 contratos, PROP20260503-01 en 2):
//   1) el sello de fecha salía de toISOString() (UTC) mientras la ventana del
//      conteo se armaba a medianoche local — en Panamá (UTC-5) todo lo guardado
//      después de las 19:00 se fechaba al día siguiente y caía FUERA de su
//      propia ventana, así que no se contaba nunca y todos salían -01;
//   2) el sufijo era count()+1 leído fuera de transacción — dos guardados
//      simultáneos obtenían el mismo número, y un borrado reciclaba uno usado.
//
// Se ejercita el ContratosService REAL (public/js/services/contratosService.js)
// cargándolo en un vm con un shim `firebase` sobre el Admin SDK: la superficie
// que usa (collection/doc/where/get/runTransaction/FieldValue) es la misma.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-numero-contrato" });
const db = admin.firestore();

// Shim del namespace compat que usa el frontend.
const firebase = Object.assign(() => {}, { firestore: () => db });
firebase.firestore.FieldValue = admin.firestore.FieldValue;

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "services", "contratosService.js"), "utf8");
// runInThisContext y NO createContext: un contexto nuevo es otro realm, y el
// Admin SDK valida el callback de runTransaction con `instanceof Promise`, que
// falla entre realms ("You must return a Promise in your transaction()-callback").
// Los otros tests del frontend sí usan sandbox porque no cruzan promesas.
globalThis.window = globalThis;
globalThis.firebase = firebase;
vm.runInThisContext(SRC, { filename: "contratosService.js" });
const ContratosService = globalThis.window.ContratosService;
assert.ok(ContratosService, "no se pudo cargar ContratosService desde public/js");

// Reproduce el bloque de numeración de nc-guardar.js con un reloj inyectable.
async function numerar(tipo, ahora) {
  const fechaStr = ContratosService.fechaStrLocal(ahora);
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const fin = new Date(inicio); fin.setDate(fin.getDate() + 1);
  let piso = 0;
  try { piso = await ContratosService.maxSufijoPorTipoYFecha(tipo, inicio, fin); } catch { /* best-effort, igual que la página */ }
  const seq = await ContratosService.reservarSufijo(tipo, fechaStr, piso);
  return tipo + fechaStr + "-" + String(seq).padStart(2, "0");
}

const crear = (num, tipo, fecha) => db.collection("contratos").add({
  contrato_id: num, codigo_tipo: tipo, fecha_creacion: fecha,
});

async function main() {
  // ── 1) El sello es la fecha LOCAL, no la UTC ─────────────────────────────
  // 22-jul-2026 19:20 hora local: es el caso exacto de WILLY BUSINESS.
  const nocheDel22 = new Date(2026, 6, 22, 19, 20, 0);
  assert.equal(ContratosService.fechaStrLocal(nocheDel22), "20260722");
  // Y la trampa original: en UTC-5 ese instante ya es el 23 en UTC.
  if (nocheDel22.getTimezoneOffset() === 300) {
    assert.equal(nocheDel22.toISOString().slice(0, 10), "2026-07-23",
      "el fixture asume UTC-5; revisar si cambia la TZ del runner");
  }
  console.log("✔ caso 1: el sello usa la fecha local (19:20 del 22 → 20260722)");

  // ── 2) La noche anterior y el día siguiente NO comparten número ──────────
  // Tres contratos como los de producción: dos a las 19:xx del 22 y uno el 23.
  const n1 = await numerar("ALQ", new Date(2026, 6, 22, 19, 20, 0));
  await crear(n1, "ALQ", new Date(2026, 6, 22, 19, 20, 0));
  const n2 = await numerar("ALQ", new Date(2026, 6, 22, 19, 28, 0));
  await crear(n2, "ALQ", new Date(2026, 6, 22, 19, 28, 0));
  const n3 = await numerar("ALQ", new Date(2026, 6, 23, 16, 0, 0));
  await crear(n3, "ALQ", new Date(2026, 6, 23, 16, 0, 0));
  assert.deepEqual([n1, n2, n3], ["ALQ20260722-01", "ALQ20260722-02", "ALQ20260723-01"]);
  console.log("✔ caso 2: los dos de la noche del 22 y el del 23 quedan distintos");

  // ── 3) Concurrencia: 8 guardados simultáneos → 8 números distintos ───────
  const t = new Date(2026, 6, 30, 11, 0, 0);
  const lote = await Promise.all(Array.from({ length: 8 }, () => numerar("PROP", t)));
  assert.equal(new Set(lote).size, 8, `se repitieron números: ${lote.join(", ")}`);
  assert.deepEqual([...lote].sort(), Array.from({ length: 8 },
    (_, i) => `PROP20260730-${String(i + 1).padStart(2, "0")}`));
  console.log("✔ caso 3: 8 reservas concurrentes → 8 números consecutivos sin repetir");

  // ── 4) Un borrado no recicla un número ya emitido ────────────────────────
  const d = new Date(2026, 7, 3, 9, 0, 0);
  const a = await numerar("DEMO", d);
  const refA = await crear(a, "DEMO", d);
  const b = await numerar("DEMO", d);
  await crear(b, "DEMO", d);
  await refA.delete();                       // el count() viejo habría vuelto a 2
  const c = await numerar("DEMO", d);
  assert.deepEqual([a, b, c], ["DEMO20260803-01", "DEMO20260803-02", "DEMO20260803-03"]);
  console.log("✔ caso 4: borrar un contrato no recicla su número");

  // ── 5) El piso adopta contratos previos al contador ──────────────────────
  // Contratos viejos (creados por el método anterior) no dejaron contador.
  const e = new Date(2026, 8, 15, 10, 0, 0);
  await crear("TEMP20260915-01", "TEMP", e);
  await crear("TEMP20260915-02", "TEMP", e);
  assert.equal(await numerar("TEMP", e), "TEMP20260915-03");
  console.log("✔ caso 5: el contador se siembra del máximo existente, no reinicia en 01");

  // ── 6) Cada tipo lleva su propia serie ───────────────────────────────────
  const f = new Date(2026, 9, 1, 14, 0, 0);
  assert.equal(await numerar("ALQ", f), "ALQ20261001-01");
  assert.equal(await numerar("REEMP", f), "REEMP20261001-01");
  console.log("✔ caso 6: series independientes por codigo_tipo");

  // ── 7) resolverContrato: el doc ID manda sobre el número ─────────────────
  // La página de impresión resolvía SOLO por número con .limit(1), así que con
  // ALQ20260723-01 repartido en 3 contratos imprimía el de otro cliente.
  // Números propios de este caso (los de arriba ya existen sin cliente_nombre).
  const viejo = "ALQ20261123-01";
  const nuevo = "ALQ20261122-01";
  const refKeeper = await db.collection("contratos").add({
    contrato_id: viejo, cliente_nombre: "COPASECUVA", codigo_tipo: "ALQ",
  });
  const refRenumerado = await db.collection("contratos").add({
    contrato_id: nuevo, contrato_id_anterior: viejo,
    cliente_nombre: "WILLY BUSINESS", codigo_tipo: "ALQ",
  });

  const porDoc = await ContratosService.resolverContrato(refRenumerado.id);
  assert.equal(porDoc.cliente_nombre, "WILLY BUSINESS");
  const porNumero = await ContratosService.resolverContrato(nuevo);
  assert.equal(porNumero.cliente_nombre, "WILLY BUSINESS");
  // Un link viejo con el número reasignado cae en quien HOY lo tiene: el número
  // vigente gana sobre contrato_id_anterior. Por eso los links usan doc ID.
  const porViejo = await ContratosService.resolverContrato(viejo);
  assert.equal(porViejo.cliente_nombre, "COPASECUVA");
  assert.equal(porViejo.id, refKeeper.id);
  // Y si el número anterior ya no lo usa nadie, encuentra al renumerado.
  await refKeeper.delete();
  const porAnterior = await ContratosService.resolverContrato(viejo);
  assert.equal(porAnterior.cliente_nombre, "WILLY BUSINESS");
  assert.equal(await ContratosService.resolverContrato("NO-EXISTE-01"), null);
  console.log("✔ caso 7: resolverContrato prioriza doc ID > número vigente > número anterior");

  console.log("\nTODOS LOS CASOS DE NUMERACIÓN PASARON");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e.message); process.exit(1); });

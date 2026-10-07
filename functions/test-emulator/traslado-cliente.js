// Integración de trasladarContratoCliente y trasladarCuentaCliente (núcleos
// `ejecutar`) contra el emulador de Firestore (8080):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test-emulator/traslado-cliente.js
// Vive FUERA de test/ para que `npm test` no lo levante.
//
// Qué protege (plan de autoservicio 2026-10-07, P3):
//   B2 · el contrato cambia de ficha con sus filas, el pool (kardex), la PoC,
//        las órdenes ABIERTAS, las gestiones abiertas y los avisos; las órdenes
//        cerradas y el representante no se tocan; avisa a activaciones.
//   C1 · la cuenta se traslada: contratos vivos sí, anulados no; PoC activa sí,
//        inactiva NO (lección Moreno) y queda por confirmar; custodia del pool
//        solo con respaldo; la ficha vieja queda inactiva con trasladado_a;
//        historial en las dos fichas. Candados: destino inactivo, origen ya
//        trasladado, mismo id.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-traslado-cliente" });
const contrato = require("../src/callable/trasladarContratoCliente");
const cuenta = require("../src/callable/trasladarCuentaCliente");
const db = admin.firestore();

async function borrarColeccion(ref) {
  for (const d of (await ref.get()).docs) {
    for (const sub of await d.ref.listCollections()) await borrarColeccion(sub);
    await d.ref.delete();
  }
}
async function limpiar() {
  for (const c of ["contratos", "equipos_pool", "ordenes_de_servicio", "poc_devices", "poc_logs", "mail_queue", "clientes", "gestiones", "facturacion_avisos", "empresa"]) await borrarColeccion(db.collection(c));
}
const rechaza = async (fn, args, re) => {
  let err = null;
  try { await fn({ usuario: "test@x", ...args }); } catch (e) { err = e; }
  assert.ok(err, `debía rechazar: ${JSON.stringify(args)}`);
  assert.match(String(err.message), re);
};

async function sembrar() {
  await limpiar();
  await db.collection("clientes").doc("cli-a").set({ nombre: "ACODECO", ruc: "8-NT-1-21875", activo: true, poc_grupos: ["ACO-TRANSPORTE"], ip: "10.1.1.1" });
  await db.collection("clientes").doc("cli-b").set({ nombre: "AUTORIDAD DE PROTECCION AL CONSUMIDOR", ruc: "", activo: true, poc_grupos: ["APC-1"] });
  await db.collection("clientes").doc("cli-inactivo").set({ nombre: "VIEJA", activo: false });
  await db.collection("contratos").doc("c1").set({ contrato_id: "SERV20261007-02", estado: "aprobado", cliente_id: "cli-a", cliente_nombre: "ACODECO", cliente_ruc: "8-NT-1-21875",
    representante: "JUAN PEREZ", representante_cedula: "8-111-222", equipos: [{ modelo: "PNC360S-R", modelo_id: "m1", cantidad: 2 }] });
  await db.collection("contratos").doc("c1").collection("seriales").doc("AAA111").set({ serial: "AAA111", cliente_id: "cli-a", cliente_nombre: "ACODECO", contrato_doc_id: "c1" });
  await db.collection("contratos").doc("c-anulado").set({ contrato_id: "SERV-ANULADO", estado: "anulado", cliente_id: "cli-a", cliente_nombre: "ACODECO" });
  await db.collection("equipos_pool").doc("AAA111").set({ serial: "AAA111", serial_norm: "AAA111", estado: "en_cliente", asignacion: { contrato_doc_id: "c1", contrato_id: "SERV20261007-02", cliente_id: "cli-a", cliente_nombre: "ACODECO" } });
  // Custodia sin contrato: con PoC activa (se mueve) y sin nada (queda por confirmar).
  await db.collection("equipos_pool").doc("BBB222").set({ serial: "BBB222", serial_norm: "BBB222", estado: "en_cliente", asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: "cli-a", cliente_nombre: "ACODECO" } });
  await db.collection("equipos_pool").doc("CCC333").set({ serial: "CCC333", serial_norm: "CCC333", estado: "en_cliente", asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: "cli-a", cliente_nombre: "ACODECO" } });
  await db.collection("poc_devices").doc("p-aaa").set({ serial: "AAA111", cliente: "ACODECO", cliente_id: "cli-a", contrato_doc_id: "c1", activo: true });
  await db.collection("poc_devices").doc("p-bbb").set({ serial: "BBB222", cliente: "ACODECO", cliente_id: "cli-a", activo: true });
  await db.collection("poc_devices").doc("p-ddd").set({ serial: "DDD444", cliente: "ACODECO", cliente_id: "cli-a", activo: false });
  await db.collection("ordenes_de_servicio").doc("2026100701").set({ estado_reparacion: "ASIGNADO", cliente_id: "cli-a", cliente: "ACODECO", contrato: { aplica: true, contrato_doc_id: "c1", contrato_id: "SERV20261007-02" }, equipos: [] });
  await db.collection("ordenes_de_servicio").doc("2026090101").set({ estado_reparacion: "ENTREGADO AL CLIENTE", cliente_id: "cli-a", cliente: "ACODECO", contrato: { aplica: true, contrato_doc_id: "c1" }, equipos: [] });
  await db.collection("gestiones").doc("g1").set({ tipo: "aumento", estado: "pendiente_bodega", cliente_id: "cli-a", cliente_nombre: "ACODECO", contratos_afectados: ["c1"] });
  await db.collection("gestiones").doc("g2").set({ tipo: "baja", estado: "cerrada", cliente_id: "cli-a", cliente_nombre: "ACODECO", contratos_afectados: ["c1"] });
  await db.collection("facturacion_avisos").doc("fa1").set({ estado: "pendiente", cliente_id: "cli-a", cliente_nombre: "ACODECO", contrato_doc_id: "c1" });
  await db.collection("facturacion_avisos").doc("fa2").set({ estado: "facturada", cliente_id: "cli-a", cliente_nombre: "ACODECO", contrato_doc_id: "c-anulado" });
}

(async () => {
  // ── B2: trasladar UN contrato ──
  await sembrar();
  await rechaza(contrato.ejecutar, { contratoId: "c1", destinoClienteId: "cli-a" }, /ya está en esa ficha/);
  await rechaza(contrato.ejecutar, { contratoId: "c1", destinoClienteId: "cli-inactivo" }, /inactiva/);
  await rechaza(contrato.ejecutar, { contratoId: "c-anulado", destinoClienteId: "cli-b" }, /en trámite, aprobado o activo/);
  await rechaza(contrato.ejecutar, { contratoId: "c1", destinoClienteId: "cli-nope" }, /no existe/);
  console.log("  ok   B2 candados");

  const r = await contrato.ejecutar({ usuario: "admin@x", uid: "adm", contratoId: "c1", destinoClienteId: "cli-b", motivo: "se hizo a la sigla" });
  assert.equal(r.ok, true);
  const c1 = (await db.collection("contratos").doc("c1").get()).data();
  assert.equal(c1.cliente_id, "cli-b");
  assert.equal(c1.cliente_nombre, "AUTORIDAD DE PROTECCION AL CONSUMIDOR");
  assert.equal(c1.cliente_ruc, "", "la foto del cliente es la del destino");
  assert.equal(c1.representante, "JUAN PEREZ", "el representante (quien firmó) no se pisa");
  assert.ok(c1.searchTokens.includes("autoridad") && c1.searchTokens.includes("serv20261007-02"), "tokens de búsqueda del nombre nuevo");
  assert.equal(c1.traslado_cliente.de_id, "cli-a");
  assert.equal((await db.collection("contratos").doc("c1").collection("seriales").doc("AAA111").get()).data().cliente_id, "cli-b", "fila de serial");
  const pool = (await db.collection("equipos_pool").doc("AAA111").get()).data();
  assert.equal(pool.asignacion.cliente_id, "cli-b");
  assert.equal(pool.asignacion.contrato_doc_id, "c1", "conserva el contrato");
  const movs = (await db.collection("equipos_pool").doc("AAA111").collection("movimientos").get()).docs.map((d) => d.data());
  assert.equal(movs.length, 1); assert.equal(movs[0].tipo, "correccion_titular");
  assert.equal((await db.collection("poc_devices").doc("p-aaa").get()).data().cliente_id, "cli-b", "PoC del contrato");
  assert.equal((await db.collection("poc_devices").doc("p-bbb").get()).data().cliente_id, "cli-a", "PoC sin contrato no se toca en B2");
  assert.equal((await db.collection("ordenes_de_servicio").doc("2026100701").get()).data().cliente_id, "cli-b", "orden abierta");
  assert.equal((await db.collection("ordenes_de_servicio").doc("2026090101").get()).data().cliente_id, "cli-a", "orden cerrada es historia");
  assert.equal((await db.collection("gestiones").doc("g1").get()).data().cliente_id, "cli-b", "gestión abierta");
  assert.equal((await db.collection("gestiones").doc("g2").get()).data().cliente_id, "cli-a", "gestión cerrada");
  assert.equal((await db.collection("facturacion_avisos").doc("fa1").get()).data().cliente_id, "cli-b", "aviso del contrato");
  assert.equal((await db.collection("mail_queue").get()).size, 1, "correo a activaciones");
  assert.equal((await db.collection("clientes").doc("cli-b").collection("historial").get()).size, 1, "historial del destino");
  assert.equal((await db.collection("clientes").doc("cli-a").collection("historial").get()).size, 1, "historial del origen");
  assert.deepEqual([r.seriales, r.pool, r.poc, r.ordenes, r.gestiones, r.avisos], [1, 1, 1, 1, 1, 1]);
  console.log("  ok   B2 contrato trasladado con todo lo que cuelga");

  // ── C1: trasladar la cuenta ──
  await sembrar();
  await rechaza(cuenta.ejecutar, { origenClienteId: "cli-a", destinoClienteId: "cli-a" }, /misma ficha/);
  await rechaza(cuenta.ejecutar, { origenClienteId: "cli-a", destinoClienteId: "cli-inactivo" }, /inactiva/);
  console.log("  ok   C1 candados");
  const rc = await cuenta.ejecutar({ usuario: "admin@x", uid: "adm", origenClienteId: "cli-a", destinoClienteId: "cli-b", motivo: "cambio de razón social" });
  assert.equal(rc.ok, true);
  assert.deepEqual(rc.contratos.map((c) => c.contrato), ["SERV20261007-02"], "solo el contrato vivo");
  assert.equal((await db.collection("contratos").doc("c-anulado").get()).data().cliente_id, "cli-a", "el anulado es historia");
  assert.equal(rc.poc, 1, "la PoC activa sin contrato (BBB222) se mueve; la del contrato ya fue con él");
  assert.equal((await db.collection("poc_devices").doc("p-bbb").get()).data().cliente_id, "cli-b");
  assert.equal((await db.collection("poc_devices").doc("p-ddd").get()).data().cliente_id, "cli-a", "la PoC inactiva NO se mueve");
  assert.equal((await db.collection("equipos_pool").doc("BBB222").get()).data().asignacion.cliente_id, "cli-b", "custodia con PoC activa se mueve");
  assert.equal((await db.collection("equipos_pool").doc("CCC333").get()).data().asignacion.cliente_id, "cli-a", "custodia sin respaldo no se mueve");
  const pc = rc.por_confirmar.map((p) => p.serial).sort();
  assert.deepEqual(pc, ["CCC333", "DDD444"], "lo que no se movió vuelve por confirmar");
  const viejo = (await db.collection("clientes").doc("cli-a").get()).data();
  assert.equal(viejo.activo, false); assert.equal(viejo.trasladado_a, "cli-b");
  const nuevo = (await db.collection("clientes").doc("cli-b").get()).data();
  assert.deepEqual(nuevo.poc_grupos, ["ACO-TRANSPORTE", "APC-1"], "unión del catálogo PoC");
  assert.equal(nuevo.ip, "10.1.1.1", "hereda lo que no tenía");
  assert.equal(nuevo.activo, true);
  assert.equal((await db.collection("gestiones").doc("g1").get()).data().cliente_id, "cli-b");
  assert.equal((await db.collection("facturacion_avisos").doc("fa2").get()).data().cliente_id, "cli-a", "aviso facturado no se toca");
  assert.ok((await db.collection("clientes").doc("cli-a").collection("historial").get()).size >= 1);
  await rechaza(cuenta.ejecutar, { origenClienteId: "cli-a", destinoClienteId: "cli-b" }, /ya se trasladó/);
  console.log("  ok   C1 cuenta trasladada: vivo sí, historia no, inactivo por confirmar");

  await limpiar();
  console.log("\nTODO OK");
  process.exit(0);
})().catch((e) => { console.error("\nFALLA:", e); process.exit(1); });

// Integración de proponerModeloSinFicha y regularizarReemplazoOrden (núcleos
// `ejecutar`) contra el emulador de Firestore (8080):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test-emulator/p4-modelo-reemplazo.js
// Vive FUERA de test/ para que `npm test` no lo levante.
//
// Qué protege (plan de autoservicio 2026-10-07, P4):
//   D1 · la propuesta sale del contrato (alta), de las órdenes (alta, y
//        ambigua si se contradicen), o del prefijo del serial (media, solo con
//        ≥10 fichas y ≥90 %); "PNC360" se lee como PNC360S; la fila N/R sigue
//        la condición de la ficha; sin pista no se inventa nada.
//   E1 · el reemplazo a posteriori crea la gestión GR cerrada ligada a la
//        orden, el entrante queda con el cliente en el contrato del saliente
//        con reemplaza_a, el saliente sale a revisión (o pendiente de
//        devolución si el cliente se lo quedó); candados: orden con gestión,
//        serial fuera de la orden, entrante con otro cliente.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-p4-modelo-reemplazo" });
const proponer = require("../src/callable/proponerModeloSinFicha");
const regularizar = require("../src/callable/regularizarReemplazoOrden");
const { catalogo } = require("../src/domain/modeloCatalogo");
const db = admin.firestore();

async function borrarColeccion(ref) {
  for (const d of (await ref.get()).docs) {
    for (const sub of await d.ref.listCollections()) await borrarColeccion(sub);
    await d.ref.delete();
  }
}
async function limpiar() {
  for (const c of ["modelos", "equipos_pool", "contratos", "ordenes_de_servicio", "gestiones", "contadores"]) await borrarColeccion(db.collection(c));
}
const rechaza = async (fn, args, re) => {
  let err = null;
  try { await fn({ usuario: "test@x", ...args }); } catch (e) { err = e; }
  assert.ok(err, `debía rechazar: ${JSON.stringify(args)}`);
  assert.match(String(err.message), re);
};
const ficha = (id, extra = {}) => db.collection("equipos_pool").doc(id).set({ serial: id, serial_norm: id, modelo_id: null, modelo_label: "", estado: "en_cliente", origen: "migracion_poc", ...extra });

(async () => {
  await limpiar();
  // Catálogo: PNC360S (N) con su -R, y PNC460 (N).
  await db.collection("modelos").doc("m360").set({ modelo: "PNC360S", marca: "HYTERA", estado: "N", activo: true });
  await db.collection("modelos").doc("m360r").set({ modelo: "PNC360S-R", marca: "HYTERA", estado: "R", activo: true, variante_de: "m360" });
  await db.collection("modelos").doc("m460").set({ modelo: "PNC460", marca: "HYTERA", estado: "N", activo: true });
  await catalogo({ force: true });

  // ── D1 ──
  // A: evidencia del contrato (texto viejo "PNC360", condición reuso → fila R).
  await db.collection("contratos").doc("c1").set({ contrato_id: "ALQ-1", cliente_id: "cli" });
  await db.collection("contratos").doc("c1").collection("seriales").doc("x").set({ serial: "24220A0001", modelo: "PNC360", modelo_id: null });
  await ficha("24220A0001", { condicion: "reuso", asignacion: { contrato_doc_id: "c1", contrato_id: "ALQ-1", cliente_id: "cli" } });
  // B: evidencia de órdenes (dos órdenes, misma familia).
  await db.collection("ordenes_de_servicio").doc("2026010101").set({ searchTokens: ["24220a0002"], equipos: [{ numero_de_serie: "24220A0002", modelo: "HYTERA PNC360S" }] });
  await db.collection("ordenes_de_servicio").doc("2026010102").set({ searchTokens: ["24220a0002"], equipos: [{ numero_de_serie: "24220A0002", modelo: "PNC360S-R" }] });
  await ficha("24220A0002", { condicion: "nuevo" });
  // C: órdenes que se contradicen (familias distintas) → ambigua.
  await db.collection("ordenes_de_servicio").doc("2026010103").set({ searchTokens: ["24220a0003"], equipos: [{ numero_de_serie: "24220A0003", modelo: "PNC360S" }] });
  await db.collection("ordenes_de_servicio").doc("2026010104").set({ searchTokens: ["24220a0003"], equipos: [{ numero_de_serie: "24220A0003", modelo: "PNC460" }] });
  await ficha("24220A0003");
  // D: prefijo con mayoría: 12 fichas 25219A* con modelo PNC460 y una sin modelo.
  for (let i = 0; i < 12; i++) await db.collection("equipos_pool").doc(`25219A00${String(i).padStart(2, "0")}`).set({ serial: `25219A00${String(i).padStart(2, "0")}`, serial_norm: `25219A00${String(i).padStart(2, "0")}`, modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_bodega" });
  await ficha("25219A0099");
  // E: prefijo sin mayoría (pocas fichas) → sin pista.
  await ficha("ZZ999A0001");
  // F: ya tiene modelo → "ya tiene modelo".
  await ficha("24220A0009", { modelo_id: "m360", modelo_label: "HYTERA PNC360S" });

  const r = await proponer.ejecutar({ ids: ["24220A0001", "24220A0002", "24220A0003", "25219A0099", "ZZ999A0001", "24220A0009"] });
  const por = Object.fromEntries(r.propuestas.map((p) => [p.id, p]));
  assert.equal(por["24220A0001"].modelo_id, "m360r", "contrato + reuso → fila R (y PNC360 se lee como PNC360S)");
  assert.equal(por["24220A0001"].fuente, "contrato");
  assert.equal(por["24220A0002"].modelo_id, "m360", "órdenes de la misma familia + nuevo → fila N");
  assert.equal(por["24220A0002"].fuente, "orden");
  assert.ok(r.ambiguas.some((a) => a.id === "24220A0003"), "órdenes que se contradicen → ambigua");
  assert.equal(por["25219A0099"].modelo_id, "m460", "prefijo con mayoría → la familia");
  assert.equal(por["25219A0099"].confianza, "media");
  assert.ok(r.sinPista.some((s) => s.id === "ZZ999A0001"), "sin evidencia no se inventa");
  assert.ok(r.sinPista.some((s) => s.id === "24220A0009" && /ya tiene/.test(s.motivo)));
  assert.equal(proponer._textoConAlias("PNC360R"), "PNC360S-R");
  console.log("  ok   D1 propuestas: contrato, órdenes, ambigua, prefijo, sin pista");

  // ── E1 ──
  await db.collection("contratos").doc("c2").set({ contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" });
  await db.collection("equipos_pool").doc("SAL001").set({ serial: "SAL001", serial_norm: "SAL001", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente",
    asignacion: { contrato_doc_id: "c2", contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("ENT001").set({ serial: "ENT001", serial_norm: "ENT001", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_bodega" });
  await db.collection("equipos_pool").doc("AJENO1").set({ serial: "AJENO1", serial_norm: "AJENO1", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_cliente", asignacion: { cliente_id: "otro", cliente_nombre: "OTRO" } });
  await db.collection("ordenes_de_servicio").doc("2026092403").set({ estado_reparacion: "ENTREGADO AL CLIENTE", cliente_id: "cli", cliente_nombre: "LIGO", tipo_de_servicio: "PROGRAMACION",
    equipos: [{ id: "e1", numero_de_serie: "SAL001", modelo: "PNC360S" }, { id: "e2", numero_de_serie: "ENT001", modelo: "PNC460" }, { id: "e3", numero_de_serie: "AJENO1", modelo: "PNC460" }] });
  await db.collection("ordenes_de_servicio").doc("2026092404").set({ estado_reparacion: "ASIGNADO", cliente_id: "cli", gestion: { id: "GR-X" }, equipos: [] });

  await rechaza(regularizar.ejecutar, { ordenId: "2026092404", serialSaliente: "A", serialEntrante: "B" }, /ya pertenece a la gestión/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "NOPE" }, /no está en la orden/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "AJENO1" }, /figura con OTRO/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "SAL001" }, /mismo serial/);
  console.log("  ok   E1 candados");

  const re = await regularizar.ejecutar({ usuario: "recep@x", uid: "rec", ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "ENT001", salienteEnCasa: true, motivo: "falló en la programación" });
  assert.equal(re.ok, true);
  assert.match(re.gestion_id, /^GR\d{8}-01$/);
  assert.equal(re.cambio_modelo, true, "PNC360S → PNC460 es cambio de familia");
  const g = (await db.collection("gestiones").doc(re.gestion_id).get()).data();
  assert.equal(g.tipo, "reemplazo"); assert.equal(g.estado, "cerrada"); assert.equal(g.regularizada, true);
  assert.equal(g.ordenes.programacion_id, "2026092403");
  assert.equal(g.items[0].serial_saliente, "SAL001"); assert.equal(g.items[0].serial_nuevo, "ENT001");
  assert.equal(g.items[0].contrato_doc_id, "c2");
  assert.equal(g.cambio_modelo.SAL001.tarifa, "se_mantiene");
  assert.deepEqual(g.cierre, { aprobacion: true, asignacion: true, programacion: true, entrega: true, entrada: true });
  assert.equal((await db.collection("gestiones").doc(re.gestion_id).collection("mapeos").get()).size, 1);
  const o = (await db.collection("ordenes_de_servicio").doc("2026092403").get()).data();
  assert.equal(o.gestion.id, re.gestion_id); assert.equal(o.gestion.regularizada, true);
  const ent = (await db.collection("equipos_pool").doc("ENT001").get()).data();
  assert.equal(ent.estado, "en_cliente", "el entrante queda con el cliente");
  assert.equal(ent.asignacion.contrato_doc_id, "c2", "en el contrato del saliente");
  assert.equal(ent.reemplaza_a, "SAL001");
  assert.equal(ent.reemplazo_origen.gestion_id, re.gestion_id);
  const sal = (await db.collection("equipos_pool").doc("SAL001").get()).data();
  assert.equal(sal.estado, "devuelto_revision", "el saliente en casa sale a revisión");
  assert.equal(sal.asignacion, null, "y sale del contrato");
  const movs = (await db.collection("equipos_pool").doc("SAL001").collection("movimientos").get()).docs.map((d) => d.data().tipo);
  assert.deepEqual(movs, ["reemplazo"]);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "ENT001" }, /ya pertenece a la gestión/);
  console.log("  ok   E1 reemplazo a posteriori: gestión, orden, entrante y saliente");

  // Saliente que el cliente se quedó: pendiente de devolución, sin mover.
  await db.collection("equipos_pool").doc("SAL002").set({ serial: "SAL002", serial_norm: "SAL002", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("ENT002").set({ serial: "ENT002", serial_norm: "ENT002", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("ordenes_de_servicio").doc("2026092405").set({ estado_reparacion: "ENTREGADO AL CLIENTE", cliente_id: "cli", cliente_nombre: "LIGO", equipos: [{ numero_de_serie: "SAL002" }, { numero_de_serie: "ENT002" }] });
  const r2 = await regularizar.ejecutar({ usuario: "recep@x", ordenId: "2026092405", serialSaliente: "SAL002", serialEntrante: "ENT002", salienteEnCasa: false, motivo: "el cliente se quedó el dañado" });
  assert.equal(r2.cambio_modelo, false);
  const sal2 = (await db.collection("equipos_pool").doc("SAL002").get()).data();
  assert.equal(sal2.estado, "en_cliente"); assert.equal(sal2.pendiente_devolucion, true);
  assert.equal((await db.collection("equipos_pool").doc("ENT002").get()).data().reemplaza_a, "SAL002");
  console.log("  ok   E1 saliente con el cliente: pendiente de devolución");

  await limpiar();
  console.log("\nTODO OK");
  process.exit(0);
})().catch((e) => { console.error("\nFALLA:", e); process.exit(1); });

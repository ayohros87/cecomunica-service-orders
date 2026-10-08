// Integración de lib/reposicionAlquiler (aplicar + ligarOrden) contra el
// emulador de Firestore:
//   firebase emulators:exec --only firestore "node test-emulator/reposicion-alquiler.js"
// Vive FUERA de test/ para que `npm test` no lo levante.
//
// Qué protege (Goly, factura 11076, 2026-10-08): la "venta" que repone un radio
// alquilado deja el entrante de CECOMUNICA en el contrato del perdido, da de
// baja el perdido, crea la GR cerrada con saliente_en_casa (sin devolución), y
// lo que no se puede parear o validar sigue como venta.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-reposicion-alquiler" });
const R = require("../src/lib/reposicionAlquiler");
const db = admin.firestore();

async function borrarColeccion(ref) {
  for (const d of (await ref.get()).docs) {
    for (const sub of await d.ref.listCollections()) await borrarColeccion(sub);
    await d.ref.delete();
  }
}
const pool = (id) => db.collection("equipos_pool").doc(id);
const get = async (id) => (await pool(id).get()).data();

(async () => {
  for (const c of ["modelos", "equipos_pool", "gestiones", "contadores"]) await borrarColeccion(db.collection(c));
  await db.collection("modelos").doc("m460").set({ modelo: "PNC460", marca: "HYTERA", estado: "N", activo: true });
  await db.collection("modelos").doc("m460r").set({ modelo: "PNC460-R", marca: "HYTERA", estado: "R", activo: true, variante_de: "m460" });
  await db.collection("modelos").doc("m360").set({ modelo: "PNC360S", marca: "HYTERA", estado: "N", activo: true });

  const asig = { cliente_id: "GOLY", cliente_nombre: "COMPAÑÍA GOLY", contrato_doc_id: "ct1", contrato_id: "REEMP20260303-01" };
  await pool("ROBADO1").set({ serial: "ROBADO1", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_cliente", propiedad: "cecomunica", asignacion: asig });
  await pool("PROPIO1").set({ serial: "PROPIO1", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_cliente", propiedad: "cliente", asignacion: asig });
  await pool("ROBADO2").set({ serial: "ROBADO2", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", propiedad: "cecomunica", asignacion: asig });
  const venta = { factura: "11076", cliente_id: "GOLY", pedido_id: "pv1" };
  await pool("NUEVO1").set({ serial: "NUEVO1", modelo_id: "m460r", modelo_label: "HYTERA PNC460-R", estado: "vendido", propiedad: "cliente", venta, asignacion: { cliente_id: "GOLY", contrato_doc_id: null } });
  await pool("NUEVO2").set({ serial: "NUEVO2", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "vendido", propiedad: "cliente", venta, asignacion: { cliente_id: "GOLY", contrato_doc_id: null } });

  const pedido = {
    cliente_id: "GOLY", cliente_nombre: "COMPAÑÍA GOLY", factura: "11076", estado: "asignada", creado_por_email: "brenda@x",
    reposicion: { motivo: "robo", items: [{ serial_saliente: "robado1" }, { serial_saliente: "PROPIO1" }, { serial_saliente: "ROBADO2" }] },
    seriales: [{ pool_id: "NUEVO1", serial: "NUEVO1" }, { pool_id: "NUEVO2", serial: "NUEVO2" }],
  };
  const r = await R.aplicar("pv1", pedido);

  // Pareo: ROBADO1 (PNC460) con NUEVO1 (PNC460-R, misma familia) o NUEVO2 (exacto) — exacto primero.
  assert.ok(r.gid && /^GR\d{8}-01$/.test(r.gid), "crea la GR");
  assert.deepEqual(r.pares.map(x => `${x.saliente}>${x.entrante}`), ["ROBADO1>NUEVO2"]);
  assert.deepEqual(r.contrato, { doc_id: "ct1", id: "REEMP20260303-01" });
  assert.equal(r.rechazados.length, 1); assert.match(r.rechazados[0].motivo, /propio/);
  assert.deepEqual(r.perdidosSinPar.map(x => x.serial), ["ROBADO2"], "PNC360 sin entrante de su modelo");
  console.log("ok pareo y rechazos");

  const n2 = await get("NUEVO2");
  assert.equal(n2.estado, "asignado_contrato");
  assert.equal(n2.propiedad, "cecomunica");
  assert.equal(n2.venta, undefined);
  assert.equal(n2.venta_anulada.factura, "11076");
  assert.equal(n2.asignacion.contrato_doc_id, "ct1");
  assert.equal(n2.asignacion.gestion_doc_id, r.gid);
  assert.equal(n2.reemplaza_a, "ROBADO1");
  const r1 = await get("ROBADO1");
  assert.equal(r1.estado, "baja");
  assert.equal(r1.asignacion, null);
  assert.match(r1.baja_motivo, /Robo/);
  assert.equal((await get("NUEVO1")).estado, "vendido", "el que no se pareó sigue vendido");
  assert.equal((await get("PROPIO1")).estado, "en_cliente", "el propio no se toca");
  assert.equal((await get("ROBADO2")).estado, "en_cliente", "el que no tuvo par no se da de baja");
  console.log("ok pool");

  const g = (await db.collection("gestiones").doc(r.gid).get()).data();
  assert.equal(g.tipo, "reemplazo"); assert.equal(g.estado, "cerrada");
  assert.equal(g.items.length, 1);
  assert.equal(g.items[0].saliente_en_casa, true, "sin devolución al entregar");
  assert.equal(g.reposicion.factura_qbo, "11076");
  await R.ligarOrden(r, "2026100899");
  assert.equal((await db.collection("gestiones").doc(r.gid).get()).data().ordenes.programacion_id, "2026100899");
  assert.equal((await get("NUEVO2")).reemplazo_origen.orden_entrega_id, "2026100899");
  assert.equal((await get("NUEVO2")).reemplazo_origen.gestion_id, r.gid, "ligarOrden no borra el resto del linaje");
  console.log("ok gestión y orden");

  // Pedido sin reposición → null; nada que parear → sin GR.
  assert.equal(await R.aplicar("pv2", { cliente_id: "GOLY" }), null);
  const r2 = await R.aplicar("pv3", { ...pedido, reposicion: { items: [{ serial_saliente: "ROBADO2" }] }, seriales: [] });
  assert.equal(r2.gid, null);
  console.log("ok sin reposición / sin par");
  console.log("\nTODO OK");
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });

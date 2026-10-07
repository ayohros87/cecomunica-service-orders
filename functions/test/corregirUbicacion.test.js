// Corregir ubicación (bodega, 2026-10-07): EquiposPoolService.corregirUbicacion.
//
// Hasta hoy la única corrección era "a bodega"; con el radio en la calle eso
// lo dejaba disponible (LIGO, INNOVACIÓN, CEMENTO BAYANO, CONCORD). Aquí se
// protege lo que decide el destino:
//   · vendido / baja no se reubican por aquí;
//   · un radio colgado de una gestión viva manda al expediente;
//   · "con el cliente" conserva el contrato si es la misma cuenta y, si no,
//     deja custodia sin contrato; nunca inventa un contrato;
//   · "por revisar" suelta la asignación; "en taller" amarra la orden;
//   · el kardex es `reubicacion` (no `correccion_*`: SÍ mueve el radio).
//
// Corre con `npm test` (node --test), sin red: firebase es un doble mínimo.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DELETE = Symbol("delete");

function fakeFirebase(docs) {
  // docs: Map<path, data>. Soporta collection(c).doc(id).get(), runTransaction
  // con tx.get/update/set y la subcolección movimientos.
  const movimientos = [];
  const docRef = (col, id) => ({
    _path: `${col}/${id}`,
    get: async () => ({ exists: docs.has(`${col}/${id}`), id, data: () => docs.get(`${col}/${id}`) }),
    collection: (sub) => ({ doc: () => ({ _sub: `${col}/${id}/${sub}` }) }),
  });
  const db = {
    collection: (col) => ({
      doc: (id) => docRef(col, id),
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    runTransaction: async (fn) => fn({
      get: async (ref) => ref.get(),
      update: (ref, patch) => {
        const cur = { ...(docs.get(ref._path) || {}) };
        for (const [k, v] of Object.entries(patch)) { if (v === DELETE) delete cur[k]; else cur[k] = v; }
        docs.set(ref._path, cur);
      },
      set: (ref, data) => { movimientos.push({ sub: ref._sub, ...data }); },
    }),
  };
  return {
    firebase: {
      firestore: Object.assign(() => db, { FieldValue: { delete: () => DELETE, serverTimestamp: () => "ts" } }),
    },
    movimientos,
  };
}

function cargar(docs) {
  const fb = fakeFirebase(docs);
  const sandbox = { window: {}, firebase: fb.firebase, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "core", "serial.js"), "utf8"), sandbox, { filename: "serial.js" });
  sandbox.Serial = sandbox.window.Serial;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "services", "equiposPoolService.js"), "utf8"), sandbox, { filename: "equiposPoolService.js" });
  return { S: sandbox.window.EquiposPoolService, movs: fb.movimientos, docs };
}

// Los objetos nacen en el contexto del vm (otro Object.prototype): se comparan planos.
const plain = (x) => JSON.parse(JSON.stringify(x));
const user = { uid: "u1", email: "bodega@x.com" };
const ficha = (o) => new Map([["equipos_pool/A1", { serial: "A1", serial_norm: "A1", modelo_id: "m", modelo_label: "PNC360S", ...o }]]);

test("vendido y baja no se reubican desde aquí", async () => {
  for (const estado of ["vendido", "baja"]) {
    const { S } = cargar(ficha({ estado }));
    await assert.rejects(S.corregirUbicacion("A1", { destino: "en_bodega", motivo: "x" }, user), (e) => e.code === "estado-no-reubicable");
  }
});

test("colgado de una gestión viva → manda al expediente (gestion-viva)", async () => {
  const docs = ficha({ estado: "asignado_contrato", asignacion: { gestion_doc_id: "G1", contrato_doc_id: "C1", cliente_id: "CLI" } });
  docs.set("gestiones/G1", { numero: "GR20261007-01", estado: "en_proceso" });
  const { S } = cargar(docs);
  await assert.rejects(S.corregirUbicacion("A1", { destino: "devuelto_revision", motivo: "x" }, user),
    (e) => e.code === "gestion-viva" && e.gestion_numero === "GR20261007-01");
});

test("gestión cerrada no estorba", async () => {
  const docs = ficha({ estado: "asignado_contrato", asignacion: { gestion_doc_id: "G1", cliente_id: "CLI" } });
  docs.set("gestiones/G1", { numero: "GR1", estado: "cerrada" });
  const { S, docs: d } = cargar(docs);
  await S.corregirUbicacion("A1", { destino: "devuelto_revision", motivo: "se devolvió sin ENTRADA" }, user);
  assert.equal(d.get("equipos_pool/A1").estado, "devuelto_revision");
});

test("con el cliente: misma cuenta conserva el contrato; kardex reubicacion", async () => {
  const asignacion = { contrato_doc_id: "C1", contrato_id: "ALQ-1", cliente_id: "CLI", cliente_nombre: "CONCORD" };
  const { S, docs, movs } = cargar(ficha({ estado: "en_taller", orden_actual_id: "2026080705", asignacion }));
  const r = await S.corregirUbicacion("A1", { destino: "en_cliente", motivo: "el cliente los tiene desde agosto", cliente: { id: "CLI", nombre: "CONCORD" } }, user);
  const d = docs.get("equipos_pool/A1");
  assert.equal(d.estado, "en_cliente");
  assert.deepEqual(plain(d.asignacion), asignacion);
  assert.equal(d.orden_actual_id, null);
  assert.equal(d.verificado, false);
  assert.equal(r.con_contrato, true);
  assert.equal(movs[0].tipo, "reubicacion");
  assert.equal(movs[0].de_estado, "en_taller");
  assert.equal(movs[0].a_estado, "en_cliente");
  assert.match(movs[0].notas, /ALQ-1/);
});

test("con OTRO cliente: custodia sin contrato (no se inventa un contrato)", async () => {
  const { S, docs } = cargar(ficha({ estado: "en_bodega", asignacion: { contrato_doc_id: "C1", contrato_id: "ALQ-1", cliente_id: "CLI", cliente_nombre: "A" } }));
  const r = await S.corregirUbicacion("A1", { destino: "en_cliente", motivo: "lo tiene el otro cliente", cliente: { id: "CLI2", nombre: "B" } }, user);
  assert.deepEqual(plain(docs.get("equipos_pool/A1").asignacion), { contrato_doc_id: null, contrato_id: "", cliente_id: "CLI2", cliente_nombre: "B" });
  assert.equal(r.con_contrato, false);
});

test("con el cliente exige cliente", async () => {
  const { S } = cargar(ficha({ estado: "en_bodega" }));
  await assert.rejects(S.corregirUbicacion("A1", { destino: "en_cliente", motivo: "x" }, user), /Falta el cliente/);
});

test("por revisar suelta asignación y orden", async () => {
  const { S, docs } = cargar(ficha({ estado: "en_bodega", asignacion: { contrato_doc_id: "C1", cliente_id: "CLI" }, poc_device_id: "p" }));
  await S.corregirUbicacion("A1", { destino: "devuelto_revision", motivo: "salió por daño, lo decide el taller" }, user);
  const d = docs.get("equipos_pool/A1");
  assert.equal(d.estado, "devuelto_revision");
  assert.equal(d.asignacion, null);
  assert.equal(d.poc_device_id, null);
  assert.equal(d.orden_actual_id, null);
});

test("en taller amarra la orden y conserva la asignación", async () => {
  const asignacion = { contrato_doc_id: "C1", cliente_id: "CLI" };
  const { S, docs, movs } = cargar(ficha({ estado: "en_cliente", asignacion }));
  await S.corregirUbicacion("A1", { destino: "en_taller", motivo: "lo trajo el técnico", orden: { id: "2026100701", numero: "2026100701" } }, user);
  const d = docs.get("equipos_pool/A1");
  assert.equal(d.estado, "en_taller");
  assert.equal(d.orden_actual_id, "2026100701");
  assert.deepEqual(plain(d.asignacion), asignacion);
  assert.deepEqual(plain(movs[0].ref), { tipo: "orden", id: "2026100701", label: "2026100701" });
});

test("en taller exige la orden; destino desconocido falla", async () => {
  const { S } = cargar(ficha({ estado: "en_cliente" }));
  await assert.rejects(S.corregirUbicacion("A1", { destino: "en_taller", motivo: "x" }, user), /Falta la orden/);
  await assert.rejects(S.corregirUbicacion("A1", { destino: "marte", motivo: "x" }, user), /Destino desconocido/);
});

test("a bodega delega en corregirABodega (kardex correccion_migracion, verificado)", async () => {
  const { S, docs, movs } = cargar(ficha({ estado: "en_cliente", asignacion: { cliente_id: "CLI" } }));
  await S.corregirUbicacion("A1", { destino: "en_bodega", motivo: "está en el estante" }, user);
  const d = docs.get("equipos_pool/A1");
  assert.equal(d.estado, "en_bodega");
  assert.equal(d.verificado, true);
  assert.equal(d.asignacion, null);
  assert.equal(movs[0].tipo, "correccion_migracion");
});

// "Corregir a bodega" con un radio que un REEMPLAZO sacó de su contrato
// (EquiposPoolService.corregirABodega, 2026-10-01).
//
// El caso: SERV20260918-01. 22806A0291/0294 se reemplazaron por daño lógico y
// quedaron pegados al contrato; bodega los corrigió a mano a "en bodega" y
// pasaron 12 días DISPONIBLES para alquilar. Ahora la corrección los manda a
// revisión cuando el entrante prueba que salieron de ESE contrato.
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, "public", "js", rel), "utf8");

function montar(pool) {
  const docs = new Map(pool.map(d => [d.id, { ...d }]));
  const movs = [];
  const docRef = (id) => ({
    id,
    get: async () => ({ exists: docs.has(id), id, data: () => docs.get(id) }),
    collection: () => ({ doc: () => ({ _mov: true }) }),
  });
  const coleccion = () => ({
    doc: docRef,
    where: (campo, op, valor) => ({
      limit: () => ({
        get: async () => ({
          docs: [...docs.values()].filter(d => d[campo] === valor).map(d => ({ id: d.id, data: () => d })),
        }),
      }),
    }),
  });
  const firestore = () => ({
    collection: coleccion,
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(),
      update: (ref, patch) => docs.set(ref.id, { ...docs.get(ref.id), ...patch }),
      set: (ref, mov) => movs.push(mov),
    }),
  });
  firestore.FieldValue = { delete: () => "__delete__", serverTimestamp: () => "__ts__" };
  const ctxObj = {
    window: {}, console: { warn() {}, error() {}, log() {} },
    firebase: { firestore, auth: () => ({ currentUser: { uid: "u1" } }) },
    setTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  vm.runInContext(leer("services/equiposPoolService.js"), vm.createContext(ctxObj));
  return { S: ctxObj.window.EquiposPoolService, docs, movs };
}

const contrato = (cid) => ({ contrato_doc_id: cid, contrato_id: "SERV20260918-01", cliente_id: "cli-1" });
const SALIENTE = { id: "22806A0291", serial: "22806A0291", estado: "en_cliente", asignacion: contrato("C1") };
const ENTRANTE = { id: "24220A2196", serial: "24220A2196", estado: "en_cliente", asignacion: contrato("C1"),
  reemplaza_a: "22806A0291", reemplazo_origen: { gestion_id: "GR20260918-01", contrato_doc_id: "C1" } };
const user = { uid: "u1", email: "jose.solis@cecomunica.com" };

test("sustituido y pegado a su contrato → revisión, no bodega", async () => {
  const { S, docs, movs } = montar([SALIENTE, ENTRANTE]);
  const r = await S.corregirABodega("22806A0291", "FUE REEMPLAZADO DAÑO LOG.", user);
  assert.equal(r.a_revision, true);
  assert.equal(r.entrante, "24220A2196");
  assert.equal(docs.get("22806A0291").estado, "devuelto_revision");
  assert.equal(docs.get("22806A0291").asignacion, null);
  assert.match(movs[0].notas, /a revisión y no a bodega: lo sustituyó 24220A2196/);
});

test("sin reemplazo que lo pruebe → bodega como siempre", async () => {
  const { S, docs } = montar([SALIENTE]);
  const r = await S.corregirABodega("22806A0291", "conteo físico", user);
  assert.notEqual(r.a_revision, true);
  assert.equal(docs.get("22806A0291").estado, "en_bodega");
});

test("el reemplazo fue de OTRO contrato → bodega (no es este caso)", async () => {
  const { S, docs } = montar([{ ...SALIENTE, asignacion: contrato("C2") }, ENTRANTE]);
  await S.corregirABodega("22806A0291", "conteo físico", user);
  assert.equal(docs.get("22806A0291").estado, "en_bodega");
});

test("ya fuera del cliente (por clasificar) → bodega", async () => {
  const { S, docs } = montar([{ ...SALIENTE, estado: "por_clasificar" }, ENTRANTE]);
  await S.corregirABodega("22806A0291", "conteo físico", user);
  assert.equal(docs.get("22806A0291").estado, "en_bodega");
});

test("el modal individual dice a dónde fue", () => {
  const pag = leer("pages/inventario-equipos.js");
  assert.match(pag, /res\?\.a_revision\s*\n?\s*\? `Estado corregido — la unidad quedó POR REVISAR/);
});

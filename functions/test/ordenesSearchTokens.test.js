// Búsqueda de órdenes por prefijo (auditoría UX 2026-09-28, T6 / 4.2 #16).
//
// Antes el índice guardaba solo palabras completas: "hospi" no encontraba
// "Hospital Santo Tomás" y "202609" no encontraba las órdenes de septiembre.
// Estas pruebas fijan el builder que comparten el trigger y el backfill, y el
// espejo del cliente (OrdenesService.buscarOrdenes) que consulta con él.
//
// Corre con `npm test` (node --test). No necesita red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildOrderSearchTokens, prefijosDe, prefijoConsulta, tokensEqual, normalize,
  MAX_TOKENS_PER_DOC, PREFIX_MIN, PREFIX_MAX,
} = require("../src/lib/searchTokens");

const ORDEN = {
  cliente_nombre: "Hospital Santo Tomás",
  tecnico_asignado: "Luis Pérez",
  tipo_de_servicio: "REPARACIÓN",
  equipos: [{ numero_de_serie: "B7A12345678" }, { numero_de_serie: "X99", eliminado: true }],
};

test("prefijos 3..8 del cliente: 'hospi' y 'tom' encuentran", () => {
  const t = new Set(buildOrderSearchTokens("2026091503", ORDEN));
  for (const q of ["hos", "hosp", "hospi", "hospita", "hospital", "san", "sant", "santo", "tom", "tomas"]) {
    assert.ok(t.has(q), `falta '${q}'`);
  }
  assert.ok(!t.has("ho"), "prefijos de 2 son ruido");
});

test("prefijos del número de orden: '202609' y '20260915' encuentran", () => {
  const t = new Set(buildOrderSearchTokens("2026091503", ORDEN));
  for (const q of ["202", "2026", "202609", "2026091", "20260915", "2026091503"]) {
    assert.ok(t.has(q), `falta '${q}'`);
  }
  assert.ok(!t.has("202609150"), "más de 8 no se indexa (el cliente recorta a 8)");
});

test("prefijos del técnico y tokens de siempre (tipo, serial y sufijos)", () => {
  const t = new Set(buildOrderSearchTokens("2026091503", ORDEN));
  for (const q of ["lui", "luis", "per", "pere", "perez", "reparacion", "b7a12345678", "5678", "12345678"]) {
    assert.ok(t.has(q), `falta '${q}'`);
  }
  assert.ok(!t.has("x99"), "el equipo eliminado no se indexa");
  assert.ok(!t.has("rep"), "el tipo no lleva prefijos (serían ruido: 'rep', 'pro')");
});

test("salida ordenada, sin duplicados y estable (idempotencia del trigger)", () => {
  const a = buildOrderSearchTokens("2026091503", ORDEN);
  const b = buildOrderSearchTokens("2026091503", JSON.parse(JSON.stringify(ORDEN)));
  assert.deepEqual(a, [...a].sort());
  assert.equal(new Set(a).size, a.length);
  assert.ok(tokensEqual(a, b));
});

test("el tope recorta sufijos de serial, nunca cliente ni número", () => {
  const equipos = Array.from({ length: 120 }, (_, i) => ({ numero_de_serie: `SN${String(i).padStart(8, "0")}` }));
  const t = buildOrderSearchTokens("2026091503", { ...ORDEN, equipos });
  assert.ok(t.length <= MAX_TOKENS_PER_DOC);
  const s = new Set(t);
  for (const q of ["hospi", "tomas", "202609", "2026091503", "luis"]) assert.ok(s.has(q), `se perdió '${q}'`);
  // Todos los seriales completos caben antes que cualquier sufijo.
  for (const e of equipos) assert.ok(s.has(normalize(e.numero_de_serie)), `se perdió ${e.numero_de_serie}`);
});

test("prefijosDe / prefijoConsulta", () => {
  assert.deepEqual(prefijosDe("hospital"), ["hos", "hosp", "hospi", "hospit", "hospita"]);
  assert.deepEqual(prefijosDe("abc"), [], "la palabra de 3 ya es su propio token");
  assert.equal(prefijosDe("abcdefghijk").at(-1).length, PREFIX_MAX);
  assert.equal(prefijosDe("abcdefghijk")[0].length, PREFIX_MIN);
  assert.equal(prefijoConsulta("hospitalario"), "hospital");
  assert.equal(prefijoConsulta("hospi"), "hospi");
});

test("el trigger y los dos backfills usan el MISMO builder", () => {
  const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  for (const f of [
    ["src", "triggers", "ordenes", "onWriteSearchTokens.js"],
    ["scripts", "backfill-ordenes-search-tokens.js"],
    ["src", "callable", "runBackfill.js"],
  ]) {
    assert.match(leer(...f), /buildOrderSearchTokens/, `${f.join("/")} no usa el builder compartido`);
  }
  // El backfill nuevo es DRY-RUN salvo --apply explícito.
  assert.match(leer("scripts", "backfill-ordenes-search-tokens.js"), /const APPLY = process\.argv\.includes\("--apply"\)/);
});

test("el cliente consulta con el mismo recorte a 8 y verifica contra el texto", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "services", "ordenesService.js"), "utf8");
  const ini = src.indexOf("async buscarOrdenes(");
  const fin = src.indexOf("async searchOrders(", ini);
  assert.ok(ini > 0 && fin > ini, "no se encontró buscarOrdenes");
  const cuerpo = src.slice(ini, fin);
  assert.match(cuerpo, /const PREFIX_MAX = 8;/, "el recorte del cliente debe coincidir con PREFIX_MAX");
  assert.equal(PREFIX_MAX, 8);
  assert.match(cuerpo, /array-contains-any/);
  assert.match(cuerpo, /orderBy\("fecha_creacion", "desc"\)/);
  assert.match(cuerpo, /failed-precondition/, "sin índice debe caer a filtrar en cliente, no fallar");
});

test("firestore.indexes.json trae los índices de la búsqueda con estado y fecha", () => {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "firestore.indexes.json"), "utf8"));
  const firmas = j.indexes
    .filter(i => i.collectionGroup === "ordenes_de_servicio")
    .map(i => i.fields.map(f => `${f.fieldPath}:${f.order || f.arrayConfig}`).join(","));
  assert.ok(firmas.includes("searchTokens:CONTAINS,fecha_creacion:DESCENDING"));
  assert.ok(firmas.includes("searchTokens:CONTAINS,estado_reparacion:ASCENDING,fecha_creacion:DESCENDING"));
});

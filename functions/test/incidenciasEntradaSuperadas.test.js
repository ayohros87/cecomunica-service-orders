// Incidencia de cierre de ENTRADA que el kardex ya superó — caso 23905A0441
// (ENTRADA 2026082605 de GOLY; el radio terminó entregado a SEPROSA por el
// reemplazo GR20260928-01 y el correo diario seguía diciendo "no existe en el
// inventario"). Fija cuándo una incidencia deja de ser noticia y que ni el
// trigger ni el cron la reintenten a ciegas.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-incidencias-entrada" });
const { movidaDespues, ubicadaTrasEntrada } = require("../src/lib/incidenciasEntrada");

const ORDEN = "2026082605";
const CIERRE = Date.parse("2026-08-27T21:24:35Z");
const mov = (iso, refId) => ({ at: { toMillis: () => Date.parse(iso) }, ref: refId ? { id: refId } : null });

test("el caso real: corrección a bodega 20 min después del cierre → superada", () => {
  const kardex = [
    mov("2026-07-14T22:56:08Z", "cYbwj"),        // siembra
    mov("2026-08-27T21:44:08Z", null),           // José: correccion_migracion → en_bodega
    mov("2026-09-28T20:46:35Z", "GR20260928-01"),// asignación del reemplazo
  ];
  assert.equal(movidaDespues(kardex, { ordenId: ORDEN, desdeMs: CIERRE }), true);
});

test("solo historia anterior al cierre → sigue viva", () => {
  const kardex = [mov("2026-07-14T22:56:08Z", "x"), mov("2026-07-15T18:22:09Z", "y")];
  assert.equal(movidaDespues(kardex, { ordenId: ORDEN, desdeMs: CIERRE }), false);
});

test("un movimiento posterior de la MISMA orden no cuenta", () => {
  const kardex = [mov("2026-08-28T10:00:00Z", ORDEN)];
  assert.equal(movidaDespues(kardex, { ordenId: ORDEN, desdeMs: CIERRE }), false);
});

test("sin fecha de cierre no se da por superada", () => {
  assert.equal(movidaDespues([mov("2026-09-01T00:00:00Z", "z")], { ordenId: ORDEN, desdeMs: 0 }), false);
});

// ── 2026-11-20, correo de Brenda: ENTRADAs de julio cerradas en noviembre ──
// Lo que una persona decidió mientras la ENTRADA estuvo abierta no es aviso.
const m2 = (iso, tipo, de, a, { refId = null, email = null } = {}) => ({
  at: { toMillis: () => Date.parse(iso) }, tipo, de_estado: de, a_estado: a,
  ref: refId ? { id: refId } : null, por_email: email,
});
const ABIERTA = Date.parse("2026-07-10T12:54:56Z");

test("24708A1206: bodega lo dio de baja con la ENTRADA abierta → ubicada", () => {
  const kardex = [
    m2("2026-07-14T22:56:05Z", "migracion", null, "en_poc", { refId: "poc" }),
    m2("2026-07-24T22:10:56Z", "correccion_migracion", "en_poc", "devuelto_revision", { refId: "2026071001" }),
    m2("2026-08-19T22:35:35Z", "correccion_modelo", "devuelto_revision", "devuelto_revision", { email: "admin@x" }),
    m2("2026-10-05T15:38:03Z", "liberacion", "devuelto_revision", "en_bodega", { email: "bodega@x" }),
    m2("2026-10-05T15:39:06Z", "baja", "en_bodega", "baja", { email: "bodega@x" }),
  ];
  assert.equal(ubicadaTrasEntrada(kardex, { ordenId: "2026071001", desdeMs: ABIERTA }), true);
  // Sin los dos movimientos de bodega solo quedan migraciones y ajustes de dato.
  assert.equal(ubicadaTrasEntrada(kardex.slice(0, 3), { ordenId: "2026071001", desdeMs: ABIERTA }), false);
});

test("una corrección de estado hecha por una PERSONA cuenta; la del sistema no", () => {
  const persona = [m2("2026-11-17T14:34:03Z", "correccion_migracion", "en_taller", "en_bodega", { email: "bodega@x" })];
  const sistema = [m2("2026-11-17T14:34:03Z", "correccion_migracion", "en_taller", "en_bodega")];
  assert.equal(ubicadaTrasEntrada(persona, { ordenId: "x", desdeMs: ABIERTA }), true);
  assert.equal(ubicadaTrasEntrada(sistema, { ordenId: "x", desdeMs: ABIERTA }), false);
});

test("fusión de duplicados, condición y modelo no ubican al radio", () => {
  const kardex = [
    m2("2026-09-01T15:30:53Z", "fusion_duplicado", null, null, { email: "bodega@x" }),
    m2("2026-09-02T00:00:00Z", "cambio_condicion", "en_cliente", "en_cliente", { email: "bodega@x" }),
    m2("2026-09-03T00:00:00Z", "correccion_modelo", "en_cliente", "en_cliente", { email: "bodega@x" }),
  ];
  assert.equal(ubicadaTrasEntrada(kardex, { ordenId: "x", desdeMs: ABIERTA }), false);
});

test("lo anterior a la apertura y lo de la propia ENTRADA no cuentan", () => {
  const kardex = [
    m2("2026-02-01T00:00:00Z", "baja", "en_bodega", "baja", { email: "bodega@x" }),
    m2("2026-07-11T00:00:00Z", "ingreso_taller", "en_cliente", "en_taller", { refId: "2026071001" }),
  ];
  assert.equal(ubicadaTrasEntrada(kardex, { ordenId: "2026071001", desdeMs: ABIERTA }), false);
  assert.equal(ubicadaTrasEntrada(kardex, { ordenId: "2026071001", desdeMs: 0 }), false);
});

test("el cierre, el reintento y el cron miran desde que la ENTRADA abrió", () => {
  const trig = fs.readFileSync(path.join(__dirname, "../src/triggers/ordenes/onOrdenWritePool.js"), "utf8");
  assert.match(trig, /ubicadaTrasEntrada\(movs\.docs\.map\(\(d\) => d\.data\(\)\), \{ ordenId, desdeMs: abiertaMs \}\)/);
  assert.match(trig, /desde: after\.fecha_cierre_entrada, abierta: after\.fecha_creacion/);
  // "no existe" solo cuando de verdad no hay ficha de ese serial.
  assert.match(trig, /motivo: conOtroModelo \? "otro_modelo" : \(ahora\.ficha \? "no_movio" : "sin_ficha"\)/);
  assert.match(trig, /vieneDeEstaEntrada\(fila\.ficha\.data, ordenId, after\)/);
  const cron = fs.readFileSync(path.join(__dirname, "../src/triggers/scheduled/recordatorioOperativo.js"), "utf8");
  assert.match(cron, /desde: o\.fecha_cierre_entrada, abierta: o\.fecha_creacion/);
  assert.match(cron, /El serial existe con otro modelo/);
});

test("el reintento del trigger salta las superadas y el cron las limpia", () => {
  const trig = fs.readFileSync(path.join(__dirname, "../src/triggers/ordenes/onOrdenWritePool.js"), "utf8");
  assert.match(trig, /incidenciaSuperada\(e\.serial/);
  assert.match(trig, /aterrizarEntrada\(ordenId, after, aReintentar, \{ reintento: true \}\)/);
  const cron = fs.readFileSync(path.join(__dirname, "../src/triggers/scheduled/recordatorioOperativo.js"), "utf8");
  assert.match(cron, /incidenciaSuperada\(i\.serial/);
  assert.match(cron, /vivas\.forEach/);
});

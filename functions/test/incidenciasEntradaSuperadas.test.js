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
const { movidaDespues } = require("../src/lib/incidenciasEntrada");

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

test("el reintento del trigger salta las superadas y el cron las limpia", () => {
  const trig = fs.readFileSync(path.join(__dirname, "../src/triggers/ordenes/onOrdenWritePool.js"), "utf8");
  assert.match(trig, /incidenciaSuperada\(e\.serial/);
  assert.match(trig, /aterrizarEntrada\(ordenId, after, aReintentar, \{ reintento: true \}\)/);
  const cron = fs.readFileSync(path.join(__dirname, "../src/triggers/scheduled/recordatorioOperativo.js"), "utf8");
  assert.match(cron, /incidenciaSuperada\(i\.serial/);
  assert.match(cron, /vivas\.forEach/);
});

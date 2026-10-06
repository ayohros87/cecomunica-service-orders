// Cierre tardío de una ENTRADA que no saca del cliente a un radio ya reubicado
// — caso TROPICAL RESORTS / HOTEL GAMBOA (ALQ20260806-02, Brenda 2026-10-06).
// El radio 23411A1070 volvió de M.A.M. con la ENTRADA 2026071701 (17-jul), se
// asignó al hotel el 07-ago, se entregó el 13-ago, y el cierre de esa ENTRADA
// el 14-ago lo mandó a bodega. El 09-09 la limpieza de POC cerró su ficha viva.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-entrada-reubicado" });
const { reubicadaTrasEntrada } = require("../src/lib/incidenciasEntrada");

const ENTRADA = "2026071701";
const ABIERTA = Date.parse("2026-07-17T12:31:42Z");
const mov = (iso, tipo, de, a, refId) => ({
  at: { toMillis: () => Date.parse(iso) }, tipo, de_estado: de, a_estado: a, ref: refId ? { id: refId } : null,
});

test("el caso real: asignado a otro contrato y entregado tras abrir la ENTRADA → no se mueve", () => {
  const kardex = [
    mov("2026-07-14T22:56:00Z", "migracion", null, "en_cliente", "poc"),
    mov("2026-07-17T12:36:00Z", "ingreso_taller", "en_cliente", "en_taller", ENTRADA),
    mov("2026-07-27T14:35:00Z", "correccion_migracion", "en_taller", "en_bodega", null),
    mov("2026-07-29T20:40:00Z", "correccion_modelo", "en_bodega", "en_bodega", null),
    mov("2026-08-07T14:01:00Z", "asignacion_contrato", "en_bodega", "asignado_contrato", "Y2BUctodJnZMzbGp8Nqy"),
    mov("2026-08-07T15:50:00Z", "ingreso_taller", "asignado_contrato", "en_taller", "2026080703"),
    mov("2026-08-13T19:43:00Z", "salida_taller", "en_taller", "en_cliente", "2026080703"),
  ];
  assert.equal(reubicadaTrasEntrada(kardex, { ordenId: ENTRADA, desdeMs: ABIERTA }), true);
});

test("en el taller de OTRA orden (programación del contrato nuevo) → no se mueve", () => {
  const kardex = [
    mov("2026-08-07T14:01:00Z", "asignacion_contrato", "en_bodega", "asignado_contrato", "Y2Bu"),
    mov("2026-08-07T15:50:00Z", "ingreso_taller", "asignado_contrato", "en_taller", "2026080703"),
  ];
  assert.equal(reubicadaTrasEntrada(kardex, { ordenId: "2026070701", desdeMs: Date.parse("2026-07-07T12:33:00Z") }), true);
});

test("solo los movimientos de la propia ENTRADA → aterriza en bodega como siempre", () => {
  const kardex = [
    mov("2026-03-01T00:00:00Z", "asignacion_contrato", "en_bodega", "asignado_contrato", "viejo"),
    mov("2026-07-17T12:36:00Z", "ingreso_taller", "en_cliente", "en_taller", ENTRADA),
  ];
  assert.equal(reubicadaTrasEntrada(kardex, { ordenId: ENTRADA, desdeMs: ABIERTA }), false);
});

test("correcciones de dato posteriores no cuentan como reubicación", () => {
  const kardex = [
    mov("2026-07-27T14:35:00Z", "correccion_migracion", "en_bodega", "en_cliente", null),
    mov("2026-07-29T20:40:00Z", "cambio_condicion", "en_cliente", "en_cliente", null),
  ];
  assert.equal(reubicadaTrasEntrada(kardex, { ordenId: ENTRADA, desdeMs: ABIERTA }), false);
});

test("sin fecha de apertura no se frena el cierre", () => {
  const kardex = [mov("2026-08-07T14:01:00Z", "asignacion_contrato", "en_bodega", "asignado_contrato", "x")];
  assert.equal(reubicadaTrasEntrada(kardex, { ordenId: ENTRADA, desdeMs: 0 }), false);
});

test("el cierre de la ENTRADA consulta el kardex antes de mover", () => {
  const trig = fs.readFileSync(path.join(__dirname, "../src/triggers/ordenes/onOrdenWritePool.js"), "utf8");
  assert.match(trig, /reubicadaTrasEntrada\(movs\.docs\.map/);
  assert.match(trig, /desdeMs: after\.fecha_creacion/);
});

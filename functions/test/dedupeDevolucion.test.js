// Deduplicación de órdenes de DEVOLUCIÓN (src/domain/dedupeDevolucion.js).
//
// Caso que la originó: REEMP20260814-01 (Hotel Gamboa, 2026-08-14). Recepción
// abrió a mano la devolución del radio que tenía en el mostrador; dos horas
// después se confirmó la entrega y el trigger abrió OTRA persiguiendo el
// mismo radio. La regla debe dar el mismo resultado sin importar el orden.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-dedupe-devolucion" });

const { decidirDedupe, ESTADO_CERRADA } = require("../src/domain/dedupeDevolucion");

const AHORA = Date.parse("2026-09-07T12:00:00Z");
const hace = (dias) => new Date(AHORA - dias * 86400000);
const orden = (id, { estado = "POR ASIGNAR", dias = 1, esperados = [], origen = null, eliminado = false } = {}) => ({
  id, tipo_de_servicio: "DEVOLUCION", estado_reparacion: estado, eliminado,
  fecha_creacion: hace(dias),
  devolucion: { modo: "recuperacion", origen: origen || { tipo: "manual", ref_id: null }, esperados },
});
const esp = (serial, resolucion = null) => ({ id: `e-${serial}`, serial, resolucion });

test("sin coincidencia → crear con todas las unidades", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "B3400055" }],
    origen: { tipo: "renovacion", ref_id: "cidNuevo" },
    existentes: [orden("2026090101", { esperados: [esp("OTRO1")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "crear");
  assert.equal(r.motivo, "sin_coincidencia");
  assert.deepEqual(r.unidades.map((u) => u.serial), ["B3400055"]);
});

test("Gamboa: recepción ya lo recibió a mano en una orden ABIERTA → omitir, devuelve esa orden", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "B3400055" }],
    origen: { tipo: "renovacion", ref_id: "cidNuevo" },
    existentes: [orden("2026081402", { esperados: [esp("b3400055", "recibido")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "omitir");
  assert.equal(r.ordenId, "2026081402");
});

test("orden abierta con parte de los seriales → alimentar solo con los que faltan", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "A1" }, { serial: "A2" }, { serial: "A3" }],
    origen: { tipo: "baja", ref_id: "sol1" },
    existentes: [orden("2026090102", { esperados: [esp("A1")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "alimentar");
  assert.equal(r.ordenId, "2026090102");
  assert.deepEqual(r.unidades.map((u) => u.serial), ["A2", "A3"]);
});

test("mismo disparador (origen tipo+ref) sin serial en común → alimentar la abierta", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "A9" }],
    origen: { tipo: "renovacion", ref_id: "cidX" },
    existentes: [orden("2026090103", { origen: { tipo: "renovacion", ref_id: "cidX" }, esperados: [esp("A1")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "alimentar");
  assert.equal(r.motivo, "mismo_origen_abierta");
});

test("mismo contrato pero sin serial ni origen en común NO es coincidencia (baja parcial + renovación)", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "A9" }],
    origen: { tipo: "renovacion", ref_id: "cidX" },
    existentes: [orden("2026090104", { origen: { tipo: "baja", ref_id: "sol7" }, esperados: [esp("A1")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "crear");
});

test("cerrada que ya recibió todo → omitir", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "A1" }],
    existentes: [orden("2026090105", { estado: ESTADO_CERRADA, esperados: [esp("A1", "recibido")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "omitir");
  assert.equal(r.motivo, "ya_devueltas");
  assert.equal(r.ordenId, "2026090105");
});

test("cerrada que recibió una parte → crear solo con lo que no volvió", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "A1" }, { serial: "A2" }],
    existentes: [orden("2026090106", { estado: ESTADO_CERRADA, esperados: [esp("A1", "recibido"), esp("A2", "no_devuelve")] })],
    ahora: AHORA,
  });
  assert.equal(r.accion, "crear");
  assert.equal(r.motivo, "parcialmente_devueltas");
  // 'no_devuelve' no es "volvió": se vuelve a reclamar.
  assert.deepEqual(r.unidades.map((u) => u.serial), ["A2"]);
});

test("fuera de la ventana de 30 días, eliminadas y otros tipos no cuentan", () => {
  const r = decidirDedupe({
    unidades: [{ serial: "A1" }],
    existentes: [
      orden("vieja", { dias: 45, esperados: [esp("A1")] }),
      orden("borrada", { eliminado: true, esperados: [esp("A1")] }),
      { ...orden("entrada", { esperados: [esp("A1")] }), tipo_de_servicio: "ENTRADA" },
    ],
    ahora: AHORA,
  });
  assert.equal(r.accion, "crear");
  assert.equal(r.motivo, "sin_coincidencia");
});

test("sin seriales (baja por cantidad) no se deduplica", () => {
  const r = decidirDedupe({ unidades: [], existentes: [orden("x", { esperados: [esp("A1")] })], ahora: AHORA });
  assert.equal(r.accion, "crear");
  assert.equal(r.motivo, "sin_seriales");
});

// Cierre de ENTRADA → ¿marcar el contrato como "por cancelar"?
//
// Caso que lo originó (REEMP20260901-01, Hotel Gamboa, 2026-09-07): la ENTRADA
// de un reemplazo devuelve los radios SUSTITUIDOS, que no son equipo del REEMP.
// Marcar ese contrato es un falso positivo en el home. La regla vive en
// src/domain/cancelacionEntrada.js; aquí se congela.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-cancelacion-entrada" });

const { decidirMarcaCancelacion } = require("../src/domain/cancelacionEntrada");

test("reemplazo: vuelven los sustituidos, el contrato conserva los suyos → NO marcar", () => {
  const r = decidirMarcaCancelacion({
    devueltos: [{ serial: "B6C10688" }, { serial: "B8810100" }],
    propios: ["B5100031", "B4B00085"],
  });
  assert.equal(r.marcar, false);
  assert.equal(r.motivo, "equipo_ajeno");
});

test("devolución real: vuelve equipo propio del contrato → marcar", () => {
  const r = decidirMarcaCancelacion({
    devueltos: ["b5100031", "X999"],
    propios: ["B5100031", "B4B00085"],
  });
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "equipo_propio");
  assert.deepEqual(r.propiosDevueltos, ["b5100031"]);
});

test("la comparación es por serial normalizado (guiones, minúsculas, espacios)", () => {
  const r = decidirMarcaCancelacion({
    devueltos: [" b5-100031 "],
    propios: ["B5100031"],
  });
  assert.equal(r.marcar, true);
});

test("contrato sin seriales cargados (legacy): no hay con qué comparar → marcar", () => {
  const r = decidirMarcaCancelacion({ devueltos: ["B6C10688"], propios: [] });
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "sin_seriales_contrato");
});

test("lectura de la subcolección fallida → marcar (mejor una fila de más)", () => {
  const r = decidirMarcaCancelacion({ devueltos: ["B6C10688"], propios: null });
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "lectura_fallida");
});

test("filas sin serial y valores raros no rompen ni cuentan", () => {
  const r = decidirMarcaCancelacion({
    devueltos: [null, {}, { serial: "" }, "B4B00085"],
    propios: ["", null, "B4B00085"],
  });
  assert.equal(r.marcar, true);
  assert.deepEqual(r.propiosDevueltos, ["B4B00085"]);
});

// ── Reemplazo POR GESTIÓN sobre el MISMO contrato (ALQ20260902-01 /
// SilverKing, 2026-09-17). Aquí el saliente SÍ es equipo propio del contrato:
// la regla de "equipo ajeno" no lo cubría y el home pedía cancelar un alquiler
// vivo al que solo le habían cambiado un radio.
test("saliente de un reemplazo del propio contrato → NO marcar", () => {
  const r = decidirMarcaCancelacion({
    devueltos: [{ serial: "22806A0230" }],
    propios: ["22806A0230", "24220A2357", "24708A1168", "23706A0610"],
    sustituidos: ["22806A0230"],
  });
  assert.equal(r.marcar, false);
  assert.equal(r.motivo, "reemplazo_sustituido");
});

test("entra el saliente del reemplazo Y otro radio propio → marcar por el otro", () => {
  const r = decidirMarcaCancelacion({
    devueltos: ["22806A0230", "24708A1168"],
    propios: ["22806A0230", "24708A1168"],
    sustituidos: ["22806A0230"],
  });
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "equipo_propio");
  assert.deepEqual(r.propiosDevueltos, ["24708A1168"]);
});

test("sustituidos también manda sobre contrato sin seriales y lectura fallida", () => {
  for (const propios of [[], null]) {
    const r = decidirMarcaCancelacion({
      devueltos: ["22806A0230"], propios, sustituidos: [" 22806-a0230 "],
    });
    assert.equal(r.marcar, false, `propios=${JSON.stringify(propios)}`);
    assert.equal(r.motivo, "reemplazo_sustituido");
  }
});

test("sin sustituidos la regla es la de siempre (compatibilidad)", () => {
  const r = decidirMarcaCancelacion({ devueltos: ["B5100031"], propios: ["B5100031"] });
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "equipo_propio");
});

test("ENTRADA vacía con sustituidos declarados no se cuela como reemplazo", () => {
  const r = decidirMarcaCancelacion({ devueltos: [], propios: ["B5100031"], sustituidos: ["B5100031"] });
  assert.equal(r.marcar, false);
  assert.equal(r.motivo, "equipo_ajeno");
});

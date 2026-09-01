// planAmarre (lib/regularizacion.js) — la decisión pura de qué custodia se
// amarra a qué línea al activarse una renovación. Sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-regularizacion" });
const { planAmarre } = require("../src/lib/regularizacion");

const U = (serial, modelo_id, modelo_label) => ({ serial, serial_norm: serial, modelo_id, modelo_label });

test("amarra por modelo_id exacto hasta el cupo de la línea", () => {
  const contrato = { equipos: [{ modelo_id: "m1", modelo: "PNC360S", cantidad: 2 }] };
  const unidades = [U("A1", "m1", "HYTERA PNC360S"), U("A2", "m1", "HYTERA PNC360S"), U("A3", "m1", "HYTERA PNC360S")];
  const r = planAmarre(contrato, unidades, []);
  assert.equal(r.asignar.length, 2);
  assert.equal(r.sin_cupo.length, 1);
  assert.equal(r.sin_cupo[0].serial, "A3");
});

test("matching tolerante por label (marca por delante, -R por detrás)", () => {
  const contrato = { equipos: [{ modelo_id: "catX", modelo: "PNC360S", cantidad: 1 }] };
  const unidades = [U("B1", "otroId", "HYTERA PNC360S-R")];
  const r = planAmarre(contrato, unidades, []);
  assert.equal(r.asignar.length, 1);
  assert.equal(r.asignar[0].linea_idx, 0);
});

test("sin línea del modelo → sin_linea, nunca se fuerza", () => {
  const contrato = { equipos: [{ modelo_id: "m1", modelo: "PNC360S", cantidad: 5 }] };
  const r = planAmarre(contrato, [U("C1", "m9", "MOTOROLA DEP450")], []);
  assert.equal(r.asignar.length, 0);
  assert.equal(r.sin_linea.length, 1);
});

test("las filas existentes consumen cupo y deduplican por serial", () => {
  const contrato = { equipos: [{ modelo_id: "m1", modelo: "PNC360S", cantidad: 2 }] };
  const filas = [{ serial_norm: "D1", modelo_id: "m1", modelo: "PNC360S" }];
  const unidades = [U("D1", "m1", "PNC360S"), U("D2", "m1", "PNC360S"), U("D3", "m1", "PNC360S")];
  const r = planAmarre(contrato, unidades, filas);
  assert.equal(r.ya_listadas.length, 1);         // D1 ya está en el contrato
  assert.equal(r.asignar.length, 1);             // cupo 2 − 1 fila = 1 → D2
  assert.equal(r.asignar[0].unidad.serial, "D2");
  assert.equal(r.sin_cupo.length, 1);            // D3 no cabe
});

test("varias líneas: cada unidad cae en la línea de SU modelo", () => {
  const contrato = { equipos: [
    { modelo_id: "m1", modelo: "PNC360S", cantidad: 1 },
    { modelo_id: "m2", modelo: "PNC460", cantidad: 1 },
  ] };
  const r = planAmarre(contrato, [U("E1", "m2", "PNC460"), U("E2", "m1", "PNC360S")], []);
  assert.equal(r.asignar.length, 2);
  assert.equal(r.asignar.find((a) => a.unidad.serial === "E1").linea_idx, 1);
  assert.equal(r.asignar.find((a) => a.unidad.serial === "E2").linea_idx, 0);
});

test("contrato sin equipos → todo queda sin_linea", () => {
  const r = planAmarre({ equipos: [] }, [U("F1", "m1", "X")], []);
  assert.equal(r.sin_linea.length, 1);
});

test("prefiere el match exacto por modelo_id sobre el tolerante (caso PNC460 vs PNC460-R)", () => {
  const contrato = { equipos: [
    { modelo_id: "id460R", modelo: "PNC460-R", cantidad: 5 },
    { modelo_id: "id460", modelo: "PNC460", cantidad: 5 },
  ] };
  const r = planAmarre(contrato, [U("G1", "id460", "HYTERA PNC460")], []);
  assert.equal(r.asignar[0].linea_idx, 1);
});

test("línea preferida llena → cae a la siguiente compatible con cupo (bug SEPROSA)", () => {
  const contrato = { equipos: [
    { modelo_id: "id460", modelo: "PNC460", cantidad: 1 },
    { modelo_id: "id460R", modelo: "PNC460-R", cantidad: 2 },
  ] };
  const unidades = [U("H1", "id460", "PNC460"), U("H2", "id460", "PNC460"), U("H3", "id460", "PNC460"), U("H4", "id460", "PNC460")];
  const r = planAmarre(contrato, unidades, []);
  // 1 en la línea exacta + 2 en la tolerante; la cuarta sí queda sin cupo.
  assert.equal(r.asignar.length, 3);
  assert.equal(r.sin_cupo.length, 1);
});

// ── Modalidad por línea (SERV mixto, 2026-09-01) ──────────────────────────
// Un equipo PROPIEDAD DEL CLIENTE solo se amarra a líneas 'propio' (tarifa de
// servicio); uno de CECOMUNICA solo a líneas 'alquiler'. Línea sin modalidad =
// legacy: acepta cualquiera.
test("modalidad: el equipo del cliente solo toma la línea 'propio'", () => {
  const contrato = { equipos: [
    { modelo_id: "m1", modelo: "TB311XU", cantidad: 1, modalidad: "alquiler" },
    { modelo_id: "m1", modelo: "TB311XU", cantidad: 1, modalidad: "propio" },
  ] };
  const u = { ...U("G1", "m1", "LENOVO TB311XU"), propiedad: "cliente" };
  const r = planAmarre(contrato, [u], []);
  assert.equal(r.asignar.length, 1);
  assert.equal(r.asignar[0].linea_idx, 1);
});

test("modalidad: el equipo de CECOMUNICA no cabe en línea 'propio' → sin_linea", () => {
  const contrato = { equipos: [{ modelo_id: "m1", modelo: "TB311XU", cantidad: 3, modalidad: "propio" }] };
  const u = { ...U("G2", "m1", "LENOVO TB311XU"), propiedad: "cecomunica" };
  const r = planAmarre(contrato, [u], []);
  assert.equal(r.asignar.length, 0);
  assert.equal(r.sin_linea.length, 1);
});

test("modalidad: línea legacy sin modalidad acepta ambas propiedades", () => {
  const contrato = { equipos: [{ modelo_id: "m1", modelo: "TB311XU", cantidad: 2 }] };
  const r = planAmarre(contrato, [
    { ...U("G3", "m1", "LENOVO TB311XU"), propiedad: "cliente" },
    { ...U("G4", "m1", "LENOVO TB311XU"), propiedad: "cecomunica" },
  ], []);
  assert.equal(r.asignar.length, 2);
});

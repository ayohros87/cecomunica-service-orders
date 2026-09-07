// Sustitución del serial saliente en el check-in (src/domain/sustitucionSaliente.js).
//
// Caso Gamboa (REEMP20260814-01): el plan de venta nombró B3700355 y el radio
// que volvió fue B3400055. Estas transformaciones son las que el trigger
// aplica al contrato cuando recepción sustituye el esperado en el check-in.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-sustitucion-saliente" });

const {
  detectarSustituciones, corregirReemplazaSeriales, corregirPlanSerial,
  mapeoNombraOriginal, patchMapeo,
} = require("../src/domain/sustitucionSaliente");

const fila = (over) => ({ id: "e1", serial: "B3700355", pool_doc_id: "B3700355", modelo: "KENWOOD NX-420-R", modelo_id: "m420", resolucion: null, ...over });

test("detectarSustituciones: solo filas cuyo serial cambió en esta escritura", () => {
  const antes = new Map([["e1", fila()], ["e2", fila({ id: "e2", serial: "X1", serial_original: "X0" })]]);
  const despues = [
    fila({ serial: "B3400055", serial_original: "B3700355", pool_doc_id: "B3400055", resolucion: "recibido" }),
    fila({ id: "e2", serial: "X1", serial_original: "X0" }),          // ya estaba sustituida
    fila({ id: "e3", serial: "Z1", serial_original: "z-1" }),          // mismo serial normalizado: no es sustitución
  ];
  const s = detectarSustituciones(antes, despues);
  assert.equal(s.length, 1);
  assert.equal(s[0].serial, "B3400055");
  assert.equal(s[0].original_norm, "B3700355");
  assert.equal(s[0].pool_doc_id_original, "B3700355");
});

test("detectarSustituciones: hereda el pool_doc_id original de la fila previa si la nueva no lo trae", () => {
  const antes = new Map([["e1", fila({ pool_doc_id: "B3700355__x" })]]);
  const s = detectarSustituciones(antes, [fila({ serial: "B3400055", serial_original: "B3700355", pool_doc_id: null })]);
  assert.equal(s[0].pool_doc_id_original, "B3700355__x");
});

const S = {
  serial: "B3400055", serial_norm: "B3400055", serial_original: "B3700355", original_norm: "B3700355",
  pool_doc_id: "B3400055", pool_doc_id_original: "B3700355", modelo: "KENWOOD NX-420-R", modelo_id: "m420",
};

test("corregirReemplazaSeriales: reemplaza la entrada del serial errado y deja rastro", () => {
  const { lista, cambios } = corregirReemplazaSeriales([
    { serial: "B3700355", serial_norm: "B3700355", pool_id: "B3700355", modelo: "KENWOOD NX-420-R", modelo_id: "m420", contrato_id: "ALQ1", contrato_doc_id: "cidA" },
    { serial: "B8810100", serial_norm: "B8810100", pool_id: "B8810100" },
  ], S);
  assert.equal(cambios, 1);
  assert.equal(lista[0].serial, "B3400055");
  assert.equal(lista[0].pool_id, "B3400055");
  assert.equal(lista[0].contrato_id, "ALQ1");
  assert.equal(lista[0].corregido_de, "B3700355");
  assert.equal(lista[1].serial, "B8810100");
});

test("corregirPlanSerial: errado → continua, real → reemplaza, por_modelo recalculado", () => {
  const plan = {
    nivel: "serial",
    unidades: [
      { serial: "B3700355", serial_norm: "B3700355", modelo_id: "m420", modelo: "NX-420-R", destino: "reemplaza" },
      { serial: "B3400055", serial_norm: "B3400055", modelo_id: "m420", modelo: "NX-420-R", destino: "continua" },
      { serial: "B8810100", serial_norm: "B8810100", modelo_id: "m920", modelo: "NX-920-R", destino: "reemplaza" },
    ],
    por_modelo: [{ modelo_id: "m420", continuan: 1, reemplazan: 1, devuelven: 0, total: 2 }],
  };
  const { plan: p, cambios } = corregirPlanSerial(plan, S, "nota");
  assert.equal(cambios, 2);
  assert.equal(p.unidades.find((u) => u.serial === "B3700355").destino, "continua");
  assert.equal(p.unidades.find((u) => u.serial === "B3400055").destino, "reemplaza");
  const m420 = p.por_modelo.find((m) => m.modelo_id === "m420");
  assert.deepEqual({ c: m420.continuan, r: m420.reemplazan, t: m420.total }, { c: 1, r: 1, t: 2 });
  assert.equal(p.corregido_nota, "nota");
  // El plan original no se muta.
  assert.equal(plan.unidades[0].destino, "reemplaza");
});

test("corregirPlanSerial: el serial real no estaba en el plan → se agrega como reemplaza", () => {
  const plan = { nivel: "serial", unidades: [{ serial: "B3700355", serial_norm: "B3700355", modelo_id: "m420", destino: "reemplaza" }] };
  const { plan: p } = corregirPlanSerial(plan, S, "n");
  assert.equal(p.unidades.length, 2);
  assert.equal(p.unidades[1].serial, "B3400055");
  assert.equal(p.unidades[1].destino, "reemplaza");
});

test("corregirPlanSerial: plan por cantidades o ausente se deja igual", () => {
  assert.equal(corregirPlanSerial(null, S, "n").cambios, 0);
  assert.equal(corregirPlanSerial({ nivel: "cantidad", por_modelo: [] }, S, "n").cambios, 0);
});

test("mapeoNombraOriginal y patchMapeo", () => {
  assert.equal(mapeoNombraOriginal({ saliente: "b3700355" }, S), true);
  assert.equal(mapeoNombraOriginal({ saliente: "OTRO", saliente_pool_id: "B3700355" }, S), true);
  assert.equal(mapeoNombraOriginal({ saliente: "B8810100" }, S), false);
  const p = patchMapeo(S, "nota");
  assert.equal(p.saliente, "B3400055");
  assert.equal(p.saliente_pool_id, "B3400055");
  assert.equal(p.corregido_de, "B3700355");
});

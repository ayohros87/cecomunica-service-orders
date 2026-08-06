// Baja de contrato "Propio" con unidades de la flota CeComunica mezcladas.
//
// El caso que congela este test (PROP20260805-02, 2026-08-06): un contrato
// Propio recibió 4 radios que habían salido de bodega. Al aprobarse la baja,
// onCancelacionWrite decidía por TIPO DE CONTRATO —Propio ⇒ los equipos son del
// cliente ⇒ no hay nada que recuperar— y marcaba `devolucion_no_aplica`. Las 4
// unidades quedaron colgando de un contrato muerto y desaparecieron del
// inventario sin que nadie lo notara: la baja no las reclamó, la fecha de fin de
// facturación no mueve el pool, y solo la anulación (que sí decide por ficha)
// las rescató.
//
// Ahora la decisión es por ficha. Estas pruebas fijan el criterio: qué entra,
// qué no, y que el cupo de una baja parcial se respete.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-baja-propio" });

const { unidadesRecuperablesDeBaja, ESTADOS_COLGANDO } = require("../src/lib/devolucion");
const pool = require("../src/domain/equiposPool");

const CONTRATO = "contrato-propio-1";
const PD506 = "modelo-pd506u-r";
const PD606 = "modelo-pd606-r";

// Ficha de pool tal como la arma el trigger (serial del contrato + datos de la
// unidad). Por defecto: flota CeComunica colgando de ESTE contrato.
function ficha(serial, over = {}) {
  return {
    serial, modelo: "PD506U-R", modelo_id: PD506, pool_doc_id: serial,
    propiedad: "cecomunica", estado: "asignado_contrato", contrato_doc_id: CONTRATO,
    ...over,
  };
}
const seriales = (r) => r.map(u => u.serial);

// ── El criterio: propiedad de la ficha, no tipo de contrato ────────────────
test("una terminación total recupera las unidades de flota y deja las del cliente", () => {
  const fichas = [
    ficha("18617A0061"),
    ficha("18617A0063", { propiedad: "cliente" }),
    ficha("18612A0625"),
    ficha("18617A0068", { propiedad: "cliente" }),
  ];
  const r = unidadesRecuperablesDeBaja({ fichas, contratoDocId: CONTRATO, tipo: "terminacion_total" });
  assert.deepEqual(seriales(r), ["18612A0625", "18617A0061"]);
});

test("el caso real: 4 radios de bodega en un contrato Propio se recuperan todos", () => {
  const fichas = ["18617A0061", "18617A0063", "18612A0625", "18617A0068"].map(s => ficha(s));
  const r = unidadesRecuperablesDeBaja({
    fichas, contratoDocId: CONTRATO, tipo: "terminacion_total",
    items: [{ modelo: "PD506U-R", modelo_id: PD506, cantidad: 4 }],
  });
  assert.equal(r.length, 4);
});

test("un contrato Propio 100% del cliente sigue sin generar recuperación", () => {
  const fichas = ["A1", "A2", "A3"].map(s => ficha(s, { propiedad: "cliente" }));
  assert.deepEqual(unidadesRecuperablesDeBaja({ fichas, contratoDocId: CONTRATO, tipo: "terminacion_total" }), []);
});

test("propiedad desconocida se recupera (el check-in tiene la excepción, el olvido no)", () => {
  const fichas = [ficha("B1", { propiedad: "desconocida" }), ficha("B2", { propiedad: "" })];
  assert.equal(unidadesRecuperablesDeBaja({ fichas, contratoDocId: CONTRATO, tipo: "terminacion_total" }).length, 2);
});

// ── Qué unidades siguen colgando de ESTE contrato ──────────────────────────
test("no se reclama lo que ya está en otro contrato ni fuera del cliente", () => {
  const fichas = [
    ficha("C1"),
    ficha("C2", { contrato_doc_id: "otro-contrato" }),   // reasignada
    ficha("C3", { estado: "en_taller" }),                // ya en taller
    ficha("C4", { estado: "en_bodega" }),                // ya regresó
    ficha("C5", { estado: "en_cliente" }),               // entregada: sí cuenta
    ficha("", {}),                                       // serial vacío
  ];
  assert.deepEqual(seriales(unidadesRecuperablesDeBaja({ fichas, contratoDocId: CONTRATO, tipo: "terminacion_total" })),
    ["C1", "C5"]);
});

test("sin contratoDocId no se filtra por contrato (todas las fichas dadas cuentan)", () => {
  const fichas = [ficha("D1"), ficha("D2", { contrato_doc_id: "otro" })];
  assert.equal(unidadesRecuperablesDeBaja({ fichas, tipo: "terminacion_total" }).length, 2);
});

// ── Baja parcial: la enmienda cancela cantidades, no seriales ──────────────
test("una baja parcial respeta el cupo por modelo y es determinista", () => {
  const fichas = [ficha("E9"), ficha("E1"), ficha("E5"), ficha("E3")];
  const r = unidadesRecuperablesDeBaja({
    fichas, contratoDocId: CONTRATO, tipo: "baja_parcial",
    items: [{ modelo: "PD506U-R", modelo_id: PD506, cantidad: 2 }],
  });
  assert.deepEqual(seriales(r), ["E1", "E3"], "toma las 2 primeras por serial");
  // Repetir da lo mismo: el cupo se consume sobre una copia, no sobre `items`.
  assert.deepEqual(seriales(unidadesRecuperablesDeBaja({
    fichas, contratoDocId: CONTRATO, tipo: "baja_parcial",
    items: [{ modelo: "PD506U-R", modelo_id: PD506, cantidad: 2 }],
  })), ["E1", "E3"]);
});

test("el cupo es por modelo: no se arrastra de un modelo a otro", () => {
  const fichas = [
    ficha("F1"), ficha("F2"),
    ficha("F3", { modelo: "PD606-R", modelo_id: PD606 }),
    ficha("F4", { modelo: "PD606-R", modelo_id: PD606 }),
  ];
  const r = unidadesRecuperablesDeBaja({
    fichas, contratoDocId: CONTRATO, tipo: "baja_parcial",
    items: [{ modelo: "PD606-R", modelo_id: PD606, cantidad: 1 }],
  });
  assert.deepEqual(seriales(r), ["F3"]);
});

test("una baja parcial sin items no reclama nada", () => {
  const fichas = [ficha("G1"), ficha("G2")];
  assert.deepEqual(unidadesRecuperablesDeBaja({ fichas, contratoDocId: CONTRATO, tipo: "baja_parcial", items: [] }), []);
  assert.deepEqual(unidadesRecuperablesDeBaja({ fichas, contratoDocId: CONTRATO, tipo: "baja_parcial" }), []);
});

test("el cupo casa por nombre de modelo cuando la enmienda no trae modelo_id", () => {
  const fichas = [ficha("H1", { modelo_id: null }), ficha("H2", { modelo_id: null })];
  const r = unidadesRecuperablesDeBaja({
    fichas, contratoDocId: CONTRATO, tipo: "baja_parcial",
    items: [{ modelo: "pd506u r", cantidad: 1 }],   // normalización tolerante
  });
  assert.deepEqual(seriales(r), ["H1"]);
});

test("cantidades inválidas no otorgan cupo", () => {
  const fichas = [ficha("I1")];
  for (const cantidad of [0, -3, null, "x"]) {
    assert.deepEqual(unidadesRecuperablesDeBaja({
      fichas, contratoDocId: CONTRATO, tipo: "baja_parcial",
      items: [{ modelo: "PD506U-R", modelo_id: PD506, cantidad }],
    }), [], `cantidad ${cantidad}`);
  }
});

// ── Bordes ────────────────────────────────────────────────────────────────
test("entradas vacías no revientan", () => {
  assert.deepEqual(unidadesRecuperablesDeBaja(), []);
  assert.deepEqual(unidadesRecuperablesDeBaja({}), []);
  assert.deepEqual(unidadesRecuperablesDeBaja({ fichas: [null, undefined] }), []);
});

// ── La copia de estados no puede divergir del pool ─────────────────────────
test("ESTADOS_COLGANDO sigue siendo el par asignado/en_cliente de equiposPool", () => {
  assert.deepEqual(ESTADOS_COLGANDO, [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
    "equiposPool.ESTADOS cambió: actualiza ESTADOS_COLGANDO en lib/devolucion.js");
});

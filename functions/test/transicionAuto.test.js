// Candados del auto-reclamo de devolución (lib/transicionAuto.js). El caso que
// los motivó está reproducido tal cual al final: REEMP20260825-01 / SEGURIDAD
// IDEAL, que el 2026-08-27 abrió la orden 2026082705 pidiéndole al cliente dos
// radios de febrero que no tenían nada que ver con el reemplazo.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MOTIVOS, unidadesDeclaradas, evaluarOrigen, evaluarTope, evaluarAutoReclamo,
} = require("../src/lib/transicionAuto");

const reclamos = (n) => Array.from({ length: n }, (_, i) => ({ unidad: { serial: `S${i}` }, entrante: null }));

// ── unidadesDeclaradas ──────────────────────────────────────────────────
test("unidadesDeclaradas prefiere total_equipos y cae a equipos[]", () => {
  assert.equal(unidadesDeclaradas({ total_equipos: 3 }), 3);
  assert.equal(unidadesDeclaradas({ equipos: [{ cantidad: 2 }, { cantidad: 5 }] }), 7);
  assert.equal(unidadesDeclaradas({}), 0, "sin dato = 0, para que el tope no se aplique");
});

// ── Candado (a): origen de papel ────────────────────────────────────────
test("origen_tipo 'legacy' bloquea: el original no está en el sistema", () => {
  const v = evaluarOrigen({ origen_tipo: "legacy", origen_legacy_ref: "ALQ2024-10-30-01" });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, MOTIVOS.ORIGEN_PAPEL);
  assert.match(v.detalle, /ALQ2024-10-30-01/, "la referencia de papel va en el detalle");
});

test("origen_tipo 'legacy' bloquea AUNQUE traiga contrato_origen_ids — ahí está el bug", () => {
  // Es exactamente la forma del caso real: el vendedor declaró papel y un
  // script le amarró un origen interno igual.
  const v = evaluarOrigen({ origen_tipo: "legacy", contrato_origen_ids: ["xmvXytXlrN8ik5ECaKFp"] });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, MOTIVOS.ORIGEN_PAPEL);
});

test("origen_tipo 'interno' pasa: lo eligió la venta", () => {
  assert.equal(evaluarOrigen({ origen_tipo: "interno", contrato_origen_ids: ["abc"] }).ok, true);
});

// ── Candado (b): linaje inferido ────────────────────────────────────────
test("linaje_amarrado sin confirmar bloquea", () => {
  const v = evaluarOrigen({
    origen_tipo: "interno",
    linaje_amarrado: { por: "script:amarra-renovaciones", origen_contrato_id: "ALQ20260206-01" },
  });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, MOTIVOS.LINAJE_INFERIDO);
  assert.match(v.detalle, /ALQ20260206-01/);
});

test("linaje_amarrado CONFIRMADO por una persona pasa", () => {
  const v = evaluarOrigen({
    origen_tipo: "interno",
    linaje_amarrado: { por: "script:amarra-renovaciones", origen_contrato_id: "ALQ20260206-01" },
    linaje_confirmado: { por_uid: "u1", por_email: "brenda@cecomunica.com" },
  });
  assert.equal(v.ok, true);
});

test("sin linaje_amarrado no hay nada que confirmar", () => {
  assert.equal(evaluarOrigen({ origen_tipo: "interno" }).ok, true);
});

test("papel gana sobre linaje inferido — el motivo más específico primero", () => {
  const v = evaluarOrigen({ origen_tipo: "legacy", linaje_amarrado: { por: "script" } });
  assert.equal(v.motivo, MOTIVOS.ORIGEN_PAPEL);
});

// ── Candado (c): tope del reemplazo ─────────────────────────────────────
test("REEMP que entrega 1 y reclama 2 se bloquea entero, no se recorta", () => {
  const v = evaluarTope({ codigo_tipo: "REEMP", total_equipos: 1 }, reclamos(2));
  assert.equal(v.ok, false);
  assert.equal(v.motivo, MOTIVOS.EXCEDE_TOPE);
  assert.equal(v.tope, 1);
});

test("REEMP que entrega 2 y reclama 2 pasa", () => {
  assert.equal(evaluarTope({ codigo_tipo: "REEMP", total_equipos: 2 }, reclamos(2)).ok, true);
});

test("REEMP que reclama MENOS de lo que entrega pasa (el plan puede dejar unidades continuando)", () => {
  assert.equal(evaluarTope({ codigo_tipo: "REEMP", total_equipos: 5 }, reclamos(1)).ok, true);
});

test("REEMP sin conteo declarado no inventa tope", () => {
  assert.equal(evaluarTope({ codigo_tipo: "REEMP" }, reclamos(40)).ok, true);
});

test("una RENOVACIÓN no tiene tope: 2 líneas pueden renovar un contrato de 40", () => {
  const renov = { accion: "Renovación", codigo_tipo: "ALQ", total_equipos: 2 };
  assert.equal(evaluarTope(renov, reclamos(40)).ok, true);
});

test("codigoTipo se deriva de tipo_contrato cuando falta codigo_tipo", () => {
  const v = evaluarTope({ tipo_contrato: "Reemplazo", total_equipos: 1 }, reclamos(3));
  assert.equal(v.ok, false, "un REEMP viejo sin codigo_tipo también topa");
});

// ── El caso real, de punta a punta ──────────────────────────────────────
test("CASO REEMP20260825-01 (SEGURIDAD IDEAL): el auto-reclamo no debió correr", () => {
  const contrato = {
    contrato_id: "REEMP20260825-01",
    codigo_tipo: "REEMP",
    total_equipos: 1,
    origen_tipo: "legacy",
    origen_legacy_ref: "ALQ2024-10-30-01",
    contrato_origen_ids: ["xmvXytXlrN8ik5ECaKFp"],
    linaje_amarrado: { por: "script:amarra-renovaciones", origen_contrato_id: "ALQ20260206-01", criterio: "REEMP sin origen" },
    transicion_plan: null,
  };
  // Lo que decidirSalientes produjo ese día: los dos PNC360S de febrero.
  const v = evaluarAutoReclamo(contrato, reclamos(2));
  assert.equal(v.ok, false, "la orden 2026082705 nunca debió crearse");
  assert.equal(v.motivo, MOTIVOS.ORIGEN_PAPEL, "el vendedor ya había dicho que el original es de papel");
});

test("CASO REEMP20260825-01 — aun sin el candado de papel, el tope lo habría frenado", () => {
  const sinPapel = {
    codigo_tipo: "REEMP", total_equipos: 1,
    linaje_amarrado: { por: "script:amarra-renovaciones", origen_contrato_id: "ALQ20260206-01" },
    linaje_confirmado: { por_uid: "u1" },
  };
  const v = evaluarAutoReclamo(sinPapel, reclamos(2));
  assert.equal(v.ok, false);
  assert.equal(v.motivo, MOTIVOS.EXCEDE_TOPE, "1 entregado no puede reclamar 2");
});

test("CASO DECAMERON: REEMP de 2 unidades amarrado a un contrato de 146", () => {
  const contrato = {
    contrato_id: "REEMP20260624-01", codigo_tipo: "REEMP", total_equipos: 2,
    origen_tipo: "interno",
    linaje_amarrado: { por: "script:amarra-renovaciones", origen_contrato_id: "ALQ20260304-02" },
  };
  const v = evaluarAutoReclamo(contrato, reclamos(146));
  assert.equal(v.ok, false);
  assert.equal(v.motivo, MOTIVOS.LINAJE_INFERIDO, "el vínculo deducido se frena antes de mirar el pool");
});

test("el camino feliz sigue pasando: renovación declarada en la venta, con plan", () => {
  const contrato = {
    contrato_id: "ALQ20260812-01", accion: "Renovación", codigo_tipo: "ALQ",
    total_equipos: 5, origen_tipo: "interno", contrato_origen_ids: ["origen1"],
    transicion_plan: { nivel: "serial", unidades: [] },
  };
  assert.equal(evaluarAutoReclamo(contrato, reclamos(5)).ok, true);
});

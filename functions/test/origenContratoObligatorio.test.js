// El vínculo al contrato original dejó de ser opcional en Renovación y
// Reemplazo (2026-08-11).
//
// Diagnóstico que lo motivó — REEMP20260811-01 (FUNDACION BENEFICA MAGEN DAVID
// ACADEMY): el contrato decía "las radios HYTERA P50 se reemplazarán por INRICO
// T338" y guardaba `origen_tipo: 'ninguno'`, sin apuntar a ningún original. Sin
// ese vínculo onEntregaTransicion corta en `!origenIds.length` — es el único que
// crea los mapeos de devolución y la orden de recuperación — y la pantalla de
// transición cae a "todos los equipos del cliente", que ofrecía 3 radios de
// contratos ajenos y escondía los 10 P50 a reclamar.
//
// No era un caso aislado: 67 de 74 contratos transicionables no-legacy sin
// origen, 0 de 25 renovaciones con origen, y 0 contratos con `transicion_auto_at`
// en toda la base (el auto-registro nunca corrió).
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");

function cargarOrigenContrato() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "origenContrato.js"), "utf8"), ctx);
  return ctx.window.OrigenContrato;
}

// El caso real, tal como el vendedor lo dejó.
const REEMP_REAL = {
  accion: "No Aplica", codigo_tipo: "REEMP",
  legacy: false, origen_ids: [], legacy_ref: "", candidatos: 5,
};

test("aplica — solo a contratos que nacen de otro", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.aplica({ accion: "Renovación", codigo_tipo: "ALQ" }), true);
  assert.equal(O.aplica({ accion: "Adición", codigo_tipo: "PROP" }), true);
  assert.equal(O.aplica({ accion: "No Aplica", codigo_tipo: "REEMP" }), true);
  assert.equal(O.aplica({ accion: "Nuevo", codigo_tipo: "ALQ" }), false);
  assert.equal(O.aplica({ accion: "No Aplica", codigo_tipo: "DEMO" }), false);
  assert.equal(O.aplica(null), false);
});

test("obligatorio — Renovación y Reemplazo sí; Adición no", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.obligatorio({ accion: "Renovación", codigo_tipo: "ALQ" }), true);
  assert.equal(O.obligatorio({ accion: "No Aplica", codigo_tipo: "REEMP" }), true);
  // La adición AGREGA a un contrato vigente: el cliente conserva lo de antes,
  // no hay devolución. Exigirle origen abriría recuperaciones falsas (NADCAR
  // ALQ20260803-01, DESARROLLO ACQUA TRES — 2026-08-10).
  assert.equal(O.obligatorio({ accion: "Adición", codigo_tipo: "ALQ" }), false);
  assert.equal(O.obligatorio({ accion: "Nuevo", codigo_tipo: "ALQ" }), false);
});

test("la renovación SIN equipo también declara su origen", () => {
  const O = cargarOrigenContrato();
  // No mueve radios, pero renueva un contrato concreto y el vendedor sabe cuál.
  assert.equal(O.obligatorio({ accion: "Renovación", codigo_tipo: "ALQ", renovacion_sin_equipo: true }), true);
});

test("REEMP20260811-01 tal como se guardó — ahora se rechaza", () => {
  const O = cargarOrigenContrato();
  const r = O.validar(REEMP_REAL);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_origen");
  assert.equal(r.foco, "lista");
  assert.match(r.mensaje, /reemplaza/);
});

test("elegir el original desbloquea", () => {
  const O = cargarOrigenContrato();
  const r = O.validar({ ...REEMP_REAL, origen_ids: ["woFy1HX3FfTKliT7xkf0"] });
  assert.equal(r.ok, true);
});

test("multi-origen: una renovación puede consolidar varios contratos viejos", () => {
  const O = cargarOrigenContrato();
  const r = O.validar({
    accion: "Renovación", codigo_tipo: "ALQ", legacy: false,
    origen_ids: ["a1", "b2", "c3"], legacy_ref: "", candidatos: 6,
  });
  assert.equal(r.ok, true);
  assert.equal(O.tipoDe({ accion: "Renovación", origen_ids: ["a1", "b2"] }), "interno");
});

test("el escape de papel abre la puerta, pero exige su referencia", () => {
  const O = cargarOrigenContrato();
  const sinRef = O.validar({ ...REEMP_REAL, legacy: true });
  assert.equal(sinRef.ok, false);
  assert.equal(sinRef.motivo, "falta_ref_papel");
  assert.equal(sinRef.foco, "ref");

  const conRef = O.validar({ ...REEMP_REAL, legacy: true, legacy_ref: "Contrato 2019-114" });
  assert.equal(conRef.ok, true);
  assert.equal(O.tipoDe({ ...REEMP_REAL, legacy: true, legacy_ref: "Contrato 2019-114" }), "legacy");
});

test("espacios en blanco no cuentan como referencia de papel", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.validar({ ...REEMP_REAL, legacy: true, legacy_ref: "   " }).ok, false);
});

test("cliente sin contratos en el sistema — el mensaje manda al escape, no pide lo imposible", () => {
  const O = cargarOrigenContrato();
  const r = O.validar({ ...REEMP_REAL, candidatos: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "sin_candidatos");
  assert.equal(r.foco, "legacy");
  assert.match(r.mensaje, /papel/);
});

test("la adición sigue pasando sin origen — y se guarda como 'ninguno'", () => {
  const O = cargarOrigenContrato();
  const adicion = { accion: "Adición", codigo_tipo: "ALQ", legacy: false, origen_ids: [], legacy_ref: "", candidatos: 3 };
  assert.equal(O.validar(adicion).ok, true);
  assert.equal(O.tipoDe(adicion), "ninguno");
});

test("una adición que SÍ marca papel también debe dar la referencia", () => {
  const O = cargarOrigenContrato();
  // Si el vendedor declara la excepción, el rastro se le pide igual — si no,
  // 'legacy' entraría sin nada detrás y exime al contrato de la transición.
  const r = O.validar({ accion: "Adición", codigo_tipo: "ALQ", legacy: true, origen_ids: [], legacy_ref: "", candidatos: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_ref_papel");
});

test("tipoDe — vacío cuando la pregunta no aplica", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.tipoDe({ accion: "Nuevo", codigo_tipo: "ALQ", origen_ids: ["x"] }), "");
  assert.equal(O.tipoDe({ accion: "No Aplica", codigo_tipo: "DEMO" }), "");
  assert.equal(O.tipoDe(null), "");
});

test("ids vacíos o nulos no se cuentan como vínculo", () => {
  const O = cargarOrigenContrato();
  // El DOM puede entregar strings vacíos si un checkbox pierde su value.
  const r = O.validar({ ...REEMP_REAL, origen_ids: ["", null] });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_origen");
  assert.equal(O.tipoDe({ ...REEMP_REAL, origen_ids: ["", null] }), "ninguno");
});

// ── Cableado con el formulario: RETIRADO 2026-09-28 ───────────────────────
// Las pruebas que montaban NCForm (nc-form.js) sobre un DOM falso se fueron con
// el módulo viejo de contratos (nuevo-contrato.html redirige al Centro desde
// septiembre y nc-*.js no lo importaba ningún entry). El cableado vivo del
// origen obligatorio está en clientes-centro.js (wizContrato) y lo cubren
// los tests del Centro; el predicado puro sigue probado arriba.


test("origen_tipo 'ninguno' ya no puede salir de una Renovación o un Reemplazo", () => {
  const O = cargarOrigenContrato();
  // La invariante que cierra el hueco: si valida, o apunta a un contrato del
  // sistema o declara el papel. Nunca el silencio que dejó 67 contratos huérfanos.
  for (const sel of [
    { accion: "Renovación", codigo_tipo: "ALQ", candidatos: 4 },
    { accion: "No Aplica", codigo_tipo: "REEMP", candidatos: 4 },
  ]) {
    for (const variante of [
      { ...sel, legacy: false, origen_ids: [] },
      { ...sel, legacy: false, origen_ids: ["x1"] },
      { ...sel, legacy: true, legacy_ref: "" },
      { ...sel, legacy: true, legacy_ref: "papel 2018" },
    ]) {
      if (!O.validar(variante).ok) continue;
      assert.notEqual(O.tipoDe(variante), "ninguno");
    }
  }
});

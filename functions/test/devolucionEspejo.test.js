// Espejo del pendiente de devolución en el contrato.
//
// La lista de contratos no puede abrir la orden de DEVOLUCIÓN por cada fila,
// así que onOrdenDevolucionWrite denormaliza el conteo en el contrato. Este
// test congela las dos funciones puras que deciden qué dice el chip:
//
//   · resumenDevolucion(orden)       — contribución de UN tiquete
//   · derivarEstadoDevolucion(mapa)  — consolidación de VARIOS tiquetes
//
// Y verifica la pieza que más fácil se rompe: el predicado del navegador
// (public/js/domain/devolucionContrato.js) tiene que estar de acuerdo con lo
// que el backend estampa, sobre todo en el estado 'sin_registro', que NO viene
// de ningún campo — es la ausencia de espejo en un contrato que debería estar
// devolviendo.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-devolucion-espejo" });

const {
  pendientesDevolucion, esperadosDevolucion, resumenDevolucion,
  derivarEstadoDevolucion, ESTADO_CERRADA,
} = require("../src/lib/devolucion");
const { origenIdsDe } = require("../src/lib/linaje");

const RAIZ_PUBLIC = path.join(__dirname, "..", "..", "public");

// El módulo del navegador se cuelga de window; se evalúa en sandbox.
function cargarDevolucionContrato() {
  const src = fs.readFileSync(
    path.join(RAIZ_PUBLIC, "js", "domain", "devolucionContrato.js"), "utf8");
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.DevolucionContrato;
}

const ordenCon = (devolucion, cerrada = false) => ({
  tipo_de_servicio: "DEVOLUCION",
  estado_reparacion: cerrada ? ESTADO_CERRADA : "POR ASIGNAR",
  devolucion,
});

const serial = (s, resolucion = null) => ({ id: `id-${s}`, serial: s, resolucion });

// ── resumenDevolucion ──────────────────────────────────────────────────────

test("resumenDevolucion — recuperación por serial: cuenta lo no resuelto", () => {
  const orden = ordenCon({
    modo: "recuperacion",
    esperados: [serial("A1", "recibido"), serial("A2"), serial("A3")],
  });
  assert.deepEqual(resumenDevolucion(orden), { pendientes: 2, esperado: 3, abierta: true });
});

test("resumenDevolucion — 'no se devuelve' cuenta como RESUELTO, no como pendiente", () => {
  // Es una excepción registrada, no un olvido: el equipo ya no se persigue.
  const orden = ordenCon({
    modo: "recuperacion",
    esperados: [serial("A1", "recibido"), serial("A2", "no_devuelve")],
  });
  assert.deepEqual(resumenDevolucion(orden), { pendientes: 0, esperado: 2, abierta: true });
});

test("resumenDevolucion — baja por modelo: pendientes = cantidad - recibidos", () => {
  const orden = ordenCon({
    modo: "recuperacion",
    esperados: [],
    esperados_por_modelo: [
      { modelo: "TK-3000-R", cantidad: 5, recibidos: 2 },
      { modelo: "NX-420-R",  cantidad: 3, recibidos: 3 },
    ],
  });
  assert.deepEqual(resumenDevolucion(orden), { pendientes: 3, esperado: 8, abierta: true });
});

test("resumenDevolucion — contrato de papel: manda total_esperado", () => {
  // El caso que daba SIEMPRE 0 antes del campo: sin lista previa, todo lo que
  // existe en `esperados` ya está recibido.
  const orden = ordenCon({
    modo: "sin_contrato",
    total_esperado: 6,
    esperados: [serial("P1", "recibido"), serial("P2", "recibido")],
  });
  assert.deepEqual(resumenDevolucion(orden), { pendientes: 4, esperado: 6, abierta: true });
});

test("resumenDevolucion — papel con MÁS registrados que declarados: el total no miente", () => {
  const orden = ordenCon({
    modo: "sin_contrato",
    total_esperado: 2,
    esperados: [serial("P1", "recibido"), serial("P2", "recibido"), serial("P3", "recibido")],
  });
  const r = resumenDevolucion(orden);
  assert.equal(r.pendientes, 0);
  assert.equal(r.esperado, 3, "el esperado sube al conteo real, no se queda en 2");
});

test("resumenDevolucion — cerrada marca abierta:false", () => {
  const orden = ordenCon({ modo: "recuperacion", esperados: [serial("A1", "recibido")] }, true);
  assert.equal(resumenDevolucion(orden).abierta, false);
});

test("resumenDevolucion — usa exactamente pendientesDevolucion (sin copia divergente)", () => {
  const casos = [
    { modo: "recuperacion", esperados: [serial("A1"), serial("A2", "recibido")] },
    { modo: "sin_contrato", total_esperado: 9, esperados: [serial("B1", "recibido")] },
    { modo: "confirmacion", esperados: [], esperados_por_modelo: [{ cantidad: 4, recibidos: 1 }] },
    { modo: "recuperacion", esperados: [] },
    {},
  ];
  for (const dev of casos) {
    assert.equal(resumenDevolucion(ordenCon(dev)).pendientes, pendientesDevolucion(dev),
      `divergencia con la fórmula canónica en ${JSON.stringify(dev)}`);
    assert.equal(resumenDevolucion(ordenCon(dev)).esperado, esperadosDevolucion(dev));
  }
});

// ── derivarEstadoDevolucion ────────────────────────────────────────────────

test("derivarEstado — sin tiquetes: estado null (la fila no pinta chip por espejo)", () => {
  assert.deepEqual(derivarEstadoDevolucion({}), { pendientes: 0, esperado: 0, estado: null });
  assert.deepEqual(derivarEstadoDevolucion(null), { pendientes: 0, esperado: 0, estado: null });
});

test("derivarEstado — un tiquete abierto con faltantes: pendiente", () => {
  const r = derivarEstadoDevolucion({ "20260806-01": { pendientes: 3, esperado: 8, abierta: true } });
  assert.deepEqual(r, { pendientes: 3, esperado: 8, estado: "pendiente" });
});

test("derivarEstado — cerrado sin faltantes: completa", () => {
  const r = derivarEstadoDevolucion({ "20260806-01": { pendientes: 0, esperado: 8, abierta: false } });
  assert.equal(r.estado, "completa");
});

test("derivarEstado — cerrado CON faltantes: cerrada_con_faltantes", () => {
  const r = derivarEstadoDevolucion({ "20260806-01": { pendientes: 2, esperado: 8, abierta: false } });
  assert.deepEqual(r, { pendientes: 2, esperado: 8, estado: "cerrada_con_faltantes" });
});

test("derivarEstado — abierto pero ya todo resuelto: se lee como completa", () => {
  // Falta cerrarlo administrativamente; el cliente no debe nada. Marcarlo
  // 'pendiente' mandaría a alguien a perseguir equipos que ya regresaron.
  const r = derivarEstadoDevolucion({ "20260806-01": { pendientes: 0, esperado: 4, abierta: true } });
  assert.equal(r.estado, "completa");
});

test("derivarEstado — varios tiquetes: se SUMAN (multi-origen o baja + renovación)", () => {
  const r = derivarEstadoDevolucion({
    "20260806-01": { pendientes: 3, esperado: 8, abierta: true },
    "20260712-04": { pendientes: 1, esperado: 5, abierta: false },
  });
  assert.deepEqual(r, { pendientes: 4, esperado: 13, estado: "pendiente" });
});

test("derivarEstado — un tiquete limpio NO borra los faltantes de otro", () => {
  const r = derivarEstadoDevolucion({
    "20260806-01": { pendientes: 0, esperado: 4, abierta: false },
    "20260712-04": { pendientes: 2, esperado: 5, abierta: false },
  });
  assert.equal(r.estado, "cerrada_con_faltantes", "gana el que dejó equipos afuera");
  assert.equal(r.pendientes, 2);
});

test("derivarEstado — todos cerrados y limpios: completa con el total sumado", () => {
  const r = derivarEstadoDevolucion({
    "20260806-01": { pendientes: 0, esperado: 4, abierta: false },
    "20260712-04": { pendientes: 0, esperado: 5, abierta: false },
  });
  assert.deepEqual(r, { pendientes: 0, esperado: 9, estado: "completa" });
});

// ── origenIdsDe ────────────────────────────────────────────────────────────

test("origenIdsDe — prefiere el array, cae al campo simple, deduplica", () => {
  assert.deepEqual(origenIdsDe({ contrato_origen_ids: ["a", "b"] }), ["a", "b"]);
  assert.deepEqual(origenIdsDe({ contrato_origen_id: "a" }), ["a"]);
  assert.deepEqual(origenIdsDe({ contrato_origen_ids: ["a", "a", " b ", ""] }), ["a", "b"]);
  assert.deepEqual(origenIdsDe({ contrato_origen_ids: [], contrato_origen_id: "z" }), ["z"]);
  assert.deepEqual(origenIdsDe({}), []);
  assert.deepEqual(origenIdsDe(null), []);
});

// ── Predicado del navegador ────────────────────────────────────────────────

test("navegador — el espejo manda cuando existe", () => {
  const DC = cargarDevolucionContrato();
  assert.equal(DC.estado({ estado: "activo", devolucion_estado: "pendiente" }), "pendiente");
  assert.equal(DC.estado({ estado: "anulado", devolucion_estado: "completa" }), "completa");
  assert.equal(DC.estado({ estado: "anulado", devolucion_estado: "no_aplica" }), "no_aplica");
});

test("navegador — contrato vigente y sin espejo: SIN chip", () => {
  const DC = cargarDevolucionContrato();
  assert.equal(DC.estado({ estado: "activo" }), null);
  assert.equal(DC.estado({ estado: "aprobado", accion: "Renovación" }), null,
    "ser una renovación no significa que ESTE contrato deba devolver: devuelve su ORIGEN");
});

test("navegador — sin_registro: murió o fue renovado, pero nunca hubo tiquete", () => {
  const DC = cargarDevolucionContrato();
  assert.equal(DC.estado({ estado: "anulado" }), "sin_registro");
  assert.equal(DC.estado({ estado: "activo", baja_estado: "aprobada" }), "sin_registro");
  assert.equal(DC.estado({ estado: "activo", terminacion_total: true }), "sin_registro");
  assert.equal(DC.estado({ estado: "activo", renovado_por_ids: ["otro"] }), "sin_registro");
  assert.equal(DC.estado({ estado: "activo", renovado_por_ids: [] }), null,
    "un array vacío no es señal de nada");
});

test("navegador — la baja PENDIENTE todavía no obliga a devolver", () => {
  const DC = cargarDevolucionContrato();
  assert.equal(DC.estado({ estado: "activo", baja_estado: "pendiente" }), null);
});

test("navegador — ordenUnica solo enlaza cuando hay UN tiquete", () => {
  const DC = cargarDevolucionContrato();
  assert.equal(DC.ordenUnica({ devolucion_tiquetes: { "20260806-01": {} } }), "20260806-01");
  assert.equal(DC.ordenUnica({ devolucion_tiquetes: { a: {}, b: {} } }), null,
    "con dos tiquetes el enlace llevaría a media verdad");
  assert.equal(DC.ordenUnica({}), null);
});

test("navegador — los estados que produce el backend son TODOS reconocidos", () => {
  const DC = cargarDevolucionContrato();
  // Si derivarEstadoDevolucion gana un estado nuevo y nadie lo enseña en la
  // lista, la fila cae en el `else` de sin_registro y miente.
  const delBackend = new Set();
  for (const combo of [
    { p: 3, ab: true }, { p: 0, ab: false }, { p: 2, ab: false }, { p: 0, ab: true },
  ]) {
    const { estado } = derivarEstadoDevolucion({ x: { pendientes: combo.p, esperado: 8, abierta: combo.ab } });
    delBackend.add(estado);
  }
  delBackend.add("no_aplica");   // lo estampa onCancelacionWrite

  const conocidos = new Set(["pendiente", "completa", "cerrada_con_faltantes", "no_aplica"]);
  for (const e of delBackend) {
    assert.ok(conocidos.has(e), `estado '${e}' del backend sin tratamiento en la UI`);
    assert.equal(DC.estado({ estado: "activo", devolucion_estado: e }), e);
  }
});

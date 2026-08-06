// Colisión de modelo al recibir equipos (toma física / recepción masiva).
//
// Cuando un conteo ingresa un serial que ya existe en el pool con OTRO modelo,
// el sistema creaba una segunda ficha en silencio ("Alta con colisión de serial
// entre modelos") y solo lo mencionaba un toast de paso. Entre julio y agosto
// de 2026 entraron así 8 fichas duplicadas: 5 quedaron en circulación y una se
// facturó (25224A0001, PNC460 en cliente + SC780-R vendido).
//
// La colisión tiene dos causas que se ven idénticas:
//   · serie compartida de verdad (Kenwood NX-420 / NX-920) → dos radios, dos fichas
//   · modelo mal capturado en el conteo → un radio, y la ficha aparte lo duplica
// El sistema no puede distinguirlas; quien cuenta, sí. `clasificarColisiones`
// las separa de los seriales repetidos del mismo modelo para que la UI pregunte.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function cargarFrontend() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "services", "equiposPoolService.js"), "utf8");
  const sandbox = { window: {}, firebase: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "equiposPoolService.js" });
  return sandbox.window.EquiposPoolService;
}
const S = cargarFrontend();

const PD606 = "modelo-pd606-r";
const PD506 = "modelo-pd506u-r";
const item = (serial) => ({ raw: serial, norm: serial });
const mapa = (pares) => new Map(pares);
// El servicio corre en un contexto vm: sus objetos/arrays traen el prototipo de
// ESE realm y deepStrictEqual los rechaza aunque el contenido sea idéntico.
// Reconstruirlos en este realm hace la comparación honesta.
const plano = (v) => JSON.parse(JSON.stringify(v));

test("mismo modelo por modelo_id: repetido, no colisión", () => {
  const r = S.clasificarColisiones(
    [item("18617A0035")],
    mapa([["18617A0035", { modelo_id: PD606, modelo_label: "HYTERA PD606-R", estado: "en_cliente" }]]),
    PD606, "PD606-R");
  assert.equal(r.mismoModelo.length, 1);
  assert.equal(r.colisiones.length, 0);
});

test("el mismo modelo escrito distinto no se toma como colisión", () => {
  const casos = [
    ["HYTERA PD606-R", "PD606-R"],   // con marca vs sin marca
    ["PD606", "PD606-R"],            // nuevo vs refurbished: misma unidad física
    ["PNC360S", "HYTERA PNC360S"],
  ];
  for (const [enFicha, recibiendo] of casos) {
    const r = S.clasificarColisiones([item("X1")],
      mapa([["X1", { modelo_label: enFicha, estado: "en_bodega" }]]), null, recibiendo);
    assert.equal(r.colisiones.length, 0, `${enFicha} vs ${recibiendo}`);
    assert.equal(r.mismoModelo.length, 1);
  }
});

test("modelo distinto: colisión, con lo necesario para preguntar", () => {
  // El caso real: 18617A0035 estaba con un cliente como PD606-R y la toma
  // física del 31-jul lo ingresó como PD506U-R.
  const r = S.clasificarColisiones(
    [item("18617A0035")],
    mapa([["18617A0035", { modelo_id: PD606, modelo_label: "HYTERA PD606-R", estado: "en_cliente" }]]),
    PD506, "PD506U-R");
  assert.equal(r.mismoModelo.length, 0);
  assert.deepEqual(plano(r.colisiones), [{
    serial: "18617A0035", norm: "18617A0035",
    modelo_existente: "HYTERA PD606-R", estado_existente: "en_cliente",
  }]);
});

test("los duplicados reales de producción se detectan todos", () => {
  const REALES = [
    ["24O22A0034", "HYTERA PNC360S-R", "PNC460-R"],
    ["25224A0001", "HYTERA PNC460", "SC780-R"],      // la que terminó facturada
    ["23103A0622", "HYTERA PNC460", "PNC560"],
    ["B3700056", "KENWOOD NX-420-R", "NX-920-R"],    // colisión legítima
  ];
  for (const [serial, enFicha, recibiendo] of REALES) {
    const r = S.clasificarColisiones([item(serial)],
      mapa([[serial, { modelo_label: enFicha, estado: "en_bodega" }]]), null, recibiendo);
    assert.equal(r.colisiones.length, 1, `${serial}: ${enFicha} vs ${recibiendo}`);
  }
});

test("una ficha sin modelo se adopta en vez de partirse", () => {
  const r = S.clasificarColisiones([item("Y1")],
    mapa([["Y1", { modelo_label: "", modelo_id: null, estado: "en_bodega" }]]), PD606, "PD606-R");
  assert.equal(r.colisiones.length, 0);
  assert.equal(r.mismoModelo.length, 1);
});

test("ficha sin modelo_label pero con estado deja el texto de respaldo", () => {
  const r = S.clasificarColisiones([item("Z1")],
    mapa([["Z1", { modelo_id: PD606, modelo_label: "   ", estado: "en_taller" }]]), PD506, "PD506U-R");
  assert.equal(r.colisiones.length, 1);
  assert.equal(r.colisiones[0].modelo_existente, "(sin modelo)");
  assert.equal(r.colisiones[0].estado_existente, "en_taller");
});

test("un serial que no está en el mapa se ignora (no inventa colisiones)", () => {
  const r = S.clasificarColisiones([item("NOPE")], mapa([]), PD606, "PD606-R");
  assert.deepEqual(plano(r), { mismoModelo: [], colisiones: [] });
});

test("la colisión conserva el serial tal como se escribió", () => {
  // La UI reenvía `serial` en la segunda llamada: si perdiera el texto crudo,
  // el reintento no encontraría lo mismo.
  const r = S.clasificarColisiones(
    [{ raw: "  18617a0035  ", norm: "18617A0035" }],
    mapa([["18617A0035", { modelo_label: "PD606-R", estado: "en_cliente" }]]), PD506, "PD506U-R");
  assert.equal(r.colisiones[0].serial, "  18617a0035  ");
  assert.equal(r.colisiones[0].norm, "18617A0035");
});

test("entradas vacías no revientan", () => {
  assert.deepEqual(plano(S.clasificarColisiones([], mapa([]), null, "")), { mismoModelo: [], colisiones: [] });
  assert.deepEqual(plano(S.clasificarColisiones(null, mapa([]), null, "")), { mismoModelo: [], colisiones: [] });
});

// ── El diálogo que ve quien cuenta ────────────────────────────────────────
// El mensaje se inyecta como HTML dentro de un <p> (Modal.confirm), así que
// tiene que ir escapado y sin etiquetas de bloque.
function cargarPagina() {
  const noop = () => {};
  const ctx = {
    console, window: {},
    document: { addEventListener: noop, getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [] },
    firebase: { auth: () => ({ onAuthStateChanged: noop }), firestore: () => ({}) },
    ROLES: { ADMIN: "administrador", INVENTARIO: "inventario", GERENTE: "gerente", VISTA: "vista" },
    FMT: { esc: (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) },
    Toast: { show: noop },
    localStorage: { getItem: () => null, setItem: noop },
    EquiposPoolService: S,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "pages", "inventario-equipos.js"), "utf8"), ctx);
  return ctx.window.EquiposPool;
}

test("el diálogo nombra cada serial, su modelo actual y el que se recibe", () => {
  const msg = cargarPagina()._mensajeColisiones([
    { serial: "18617A0035", modelo_existente: "HYTERA PD606-R", estado_existente: "en_cliente" },
  ], "HYTERA PD506U-R");
  assert.match(msg, /18617A0035/);
  assert.match(msg, /HYTERA PD606-R/);
  assert.match(msg, /HYTERA PD506U-R/);
  // El estado sale en castellano, no como clave interna.
  assert.ok(!msg.includes("en_cliente"), "el estado debe mostrarse con su etiqueta");
  // Y advierte del riesgo real: contar dos veces el mismo radio.
  assert.match(msg, /dos veces/);
});

test("el diálogo escapa los datos y no mete bloques dentro del <p>", () => {
  const msg = cargarPagina()._mensajeColisiones([
    { serial: '<img src=x onerror=alert(1)>', modelo_existente: '"><b>ups', estado_existente: "" },
  ], "<script>");
  assert.ok(!msg.includes("<img"), "el serial debe ir escapado");
  assert.ok(!msg.includes("<script"), "el modelo debe ir escapado");
  assert.match(msg, /&lt;img/);
  assert.equal(/<(div|table|ul|p)\b/.test(msg), false, "solo <b>/<br> dentro del <p> de Modal.confirm");
});

test("sin un modelo único (import de Excel) el diálogo no inventa uno", () => {
  const msg = cargarPagina()._mensajeColisiones(
    [{ serial: "A1", modelo_existente: "PNC460", estado_existente: "en_bodega" }], null);
  assert.match(msg, /distinto al que estás recibiendo/);
  assert.ok(!msg.includes("(sin modelo)"), "no debe aparecer un modelo de relleno");
});

test("con muchas colisiones el diálogo corta la lista y dice cuántas faltan", () => {
  const muchas = Array.from({ length: 20 }, (_, i) => ({
    serial: `S${i}`, modelo_existente: "PNC460", estado_existente: "en_bodega" }));
  const msg = cargarPagina()._mensajeColisiones(muchas, "SC780-R");
  assert.match(msg, /20 seriales ya existen/);
  assert.match(msg, /y 8 más/);
  assert.ok(!msg.includes("S19"), "solo se listan las primeras 12");
});

test("una tanda mezclada se separa en sus dos grupos", () => {
  const r = S.clasificarColisiones(
    [item("A"), item("B"), item("C")],
    mapa([
      ["A", { modelo_id: PD606, modelo_label: "HYTERA PD606-R", estado: "en_bodega" }],
      ["B", { modelo_id: PD506, modelo_label: "HYTERA PD506U-R", estado: "en_cliente" }],
      ["C", { modelo_label: "PD606", estado: "en_bodega" }],
    ]),
    PD606, "PD606-R");
  assert.deepEqual(plano(r.mismoModelo).map(x => x.norm), ["A", "C"]);
  assert.deepEqual(plano(r.colisiones).map(x => x.norm), ["B"]);
});

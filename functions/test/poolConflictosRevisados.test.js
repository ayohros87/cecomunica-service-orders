// Cola de Conflictos del pool: los grupos YA RESUELTOS siguen siendo
// consultables.
//
// El reporte que la origina (2026-08-28): el serial B3900053 existe en
// NX-420-R y NX-920-R — correcto, son dos radios físicos que comparten
// numeración — pero "en la opción de conflictos este serial no aparece". No
// era un dato perdido: bodega ya lo había resuelto el 2026-08-11 y la cola
// solo mostraba pendientes. El chip "2+ modelos" mandaba a una pantalla donde
// el serial nunca iba a estar.
//
// Se congela aquí porque el filtro (dato) y el aviso que anuncia el destino
// (presentación) viven en archivos distintos y se desincronizan solos.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarPagina() {
  const noop = () => {};
  const ctx = {
    console,
    window: {},
    document: {
      addEventListener: noop,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    firebase: { auth: () => ({ onAuthStateChanged: noop }), firestore: () => ({}) },
    ROLES: { ADMIN: "administrador", INVENTARIO: "inventario", GERENTE: "gerente", VISTA: "vista" },
    FMT: { esc: (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) },
    EquiposPoolService: { chipEstadoHtml: (e) => `<span>${e}</span>` },
    Toast: { show: noop },
    localStorage: { getItem: () => null, setItem: noop },
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "pages", "inventario-equipos.js"), ctx);
  return ctx.window.EquiposPool;
}

// Dos radios distintos con la misma numeración (caso Kenwood real), ya
// resueltos; y un conflicto de verdad pendiente.
const POOL = [
  { id: "B3900053", serial_norm: "B3900053", modelo_label: "KENWOOD NX-920-R",
    estado: "en_bodega", serial_compartido: true, conflicto_revisado: true },
  { id: "B3900053__68N", serial_norm: "B3900053", modelo_label: "KENWOOD NX-420-R",
    estado: "en_bodega", serial_compartido: true, conflicto_revisado: true },
  { id: "Z9000001", serial_norm: "Z9000001", modelo_label: "HYTERA PD606",
    estado: "en_bodega", serial_compartido: true },
  { id: "Z9000001__PD6", serial_norm: "Z9000001", modelo_label: "HYTERA PD686",
    estado: "en_cliente", serial_compartido: true },
  { id: "UNICO1", serial_norm: "UNICO1", modelo_label: "HYTERA HP786", estado: "en_bodega" },
];

test("la cola trae solo pendientes; el historial se pide a propósito", () => {
  const page = cargarPagina();
  page._equipos = POOL;

  // .join(): los arrays nacen dentro del vm y no son reference-equal con los
  // de este realm, así que deepEqual los rechaza aunque digan lo mismo.
  const pendientes = page._gruposConflicto();
  assert.equal(pendientes.map((g) => g.norm).join(","), "Z9000001",
    "la cola de trabajo tiene que seguir mostrando SOLO lo que falta decidir");

  const todos = page._gruposConflicto({ incluirRevisados: true });
  assert.equal(todos.map((g) => g.norm).join(","), "Z9000001,B3900053",
    "con incluirRevisados hay que ver los dos, y los pendientes van primero");
  assert.equal(todos.find((g) => g.norm === "B3900053").revisado, true);
  assert.equal(todos.find((g) => g.norm === "Z9000001").revisado, false);

  // El contador de la tarjeta "Conflictos" es una bandeja de trabajo: no puede
  // inflarse con lo ya resuelto.
  assert.equal(page._gruposConflicto().length, 1);
});

test("con la cola vacía, el camino al historial sigue a la vista", () => {
  const page = cargarPagina();
  page._rol = "administrador";
  // Solo el par ya resuelto: nada pendiente que hacer.
  page._equipos = POOL.filter((e) => e.serial_norm !== "Z9000001");
  const tbody = { innerHTML: "" };

  page.renderConflictos(tbody);
  assert.match(tbody.innerHTML, /Ver (el 1 ya revisado|los \d+ ya revisados)/,
    "sin pendientes la pantalla queda muda: hay que ofrecer ver los resueltos");
  assert.match(tbody.innerHTML, /type="checkbox"/);
});

test("un grupo resuelto se muestra como decisión tomada, no como pendiente", () => {
  const page = cargarPagina();
  page._rol = "administrador";
  page._equipos = POOL;
  page._conflRevisados = true;
  const tbody = { innerHTML: "" };

  page.renderConflictos(tbody);
  const html = tbody.innerHTML;
  assert.match(html, /B3900053/);
  assert.match(html, /KENWOOD NX-420-R/);
  assert.match(html, /reabrirGrupo\('B3900053'\)/,
    "el único camino de vuelta de una decisión equivocada es reabrir el grupo");
  // Las acciones de decisión son del grupo pendiente, no del resuelto: si el
  // resuelto las ofreciera, "fusionar" borraría una de dos fichas correctas.
  const bloqueResuelto = html.slice(html.indexOf("B3900053"));
  assert.doesNotMatch(bloqueResuelto, /fusionarGrupo\('B3900053'\)/);
  assert.doesNotMatch(bloqueResuelto, /marcarDistintos\('B3900053'\)/);
});

test("el chip 2+ modelos no manda a la cola cuando ya hay decisión", () => {
  // Las tres puntas que pintan el aviso. Un chip que anuncia "se resuelve en
  // Conflictos" para un serial resuelto es exactamente el reporte que originó
  // este archivo: el usuario va, no lo encuentra y cree que se perdió el dato.
  const puntas = [
    ["public/js/pages/inventario-equipos.js", leer("public", "js", "pages", "inventario-equipos.js")],
    ["public/js/ui/equipo-ficha.js", leer("public", "js", "ui", "equipo-ficha.js")],
  ];
  for (const [nombre, src] of puntas) {
    const chips = src.match(/<span class="eqpool-compartido"[^>]*>/g) || [];
    assert.ok(chips.length >= 2,
      `${nombre}: el chip "2+ modelos" tiene que distinguir resuelto de pendiente`);
    const mandanALaCola = chips.filter((c) => /pestaña Conflictos\./.test(c));
    assert.equal(mandanALaCola.length, 1,
      `${nombre}: solo el chip del conflicto PENDIENTE puede mandar a la cola`);
  }
  // SerialField obliga a elegir en los dos casos, pero solo el pendiente tiene
  // algo que resolver.
  const sf = leer("public", "js", "ui", "serial-field.js");
  assert.match(sf, /conflicto_revisado === true/,
    "serial-field.js: el aviso al teclear el serial también distingue los dos casos");
});

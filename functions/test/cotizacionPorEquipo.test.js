// Cotización de taller desglosada POR EQUIPO + resumen de piezas a bodega.
//
// Reporte de la jefa de taller (2026-08-19), puntos 4 y 5:
//   · la cotización que ve el cliente era un solo bloque plano, con el contexto
//     del radio repetido en gris bajo CADA fila. Debe leerse radio por radio.
//   · al cerrar la cotización, bodega debe recibir el conteo de piezas usadas
//     sin esperar a que el técnico regrese con el papel.
//
// Lo que congela este archivo:
//   A — el agrupador entiende los DOS orígenes: `it.equipo` estructurado (desde
//       2026-08-20) y el `spec` de texto de las cotizaciones ya emitidas. Si el
//       fallback se rompe, todo el histórico se vuelve un bloque plano otra vez.
//   B — el documento del cliente sale agrupado, con numeración continua y sin
//       repetir el equipo en cada renglón.
//   C — una cotización comercial (sin equipos) se sigue viendo igual que antes.
//   D — el resumen a bodega cuenta también las piezas de GARANTÍA: no se le
//       cobran al cliente pero salieron de bodega igual, y ese era el hueco.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarTotales() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ctx.window.FMT = {
    round2: (n) => Math.round(Number(n || 0) * 100) / 100,
    money: (n) => "$" + Number(n || 0).toFixed(2),
    esc: (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])),
  };
  ctx.FMT = ctx.window.FMT;
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  return ctx.window.CotizacionTotales;
}

const linea = (nombre, extra = {}) => ({
  id: nombre, nombre, modelo: "SKU-" + nombre, cant: 1, precio: 10, desc: 0, ...extra,
});

// ── A — los dos orígenes de agrupación ────────────────────────────────────
test("A1 · agrupa por el objeto `equipo` cuando está presente", () => {
  const T = cargarTotales();
  const eqA = { id: "e1", serial: "AAA111", modelo: "HP786", intervencion: "cambio de batería" };
  const eqB = { id: "e2", serial: "BBB222", modelo: "PD606" };
  const grupos = T.agruparPorEquipo([
    linea("bateria", { equipo: eqA }),
    linea("antena", { equipo: eqB }),
    linea("clip", { equipo: eqA }),
  ]);
  assert.equal(grupos.length, 2);
  assert.equal(grupos[0].items.length, 2, "las dos líneas del mismo radio caen juntas");
  assert.equal(grupos[0].equipo.serial, "AAA111");
  // El orden es el de aparición: el técnico captura equipo por equipo.
  assert.equal(grupos[1].equipo.serial, "BBB222");
});

test("A2 · un equipo SIN id se agrupa por serial+modelo (órdenes viejas)", () => {
  const T = cargarTotales();
  const eq = { id: "", serial: "AAA111", modelo: "HP786" };
  const grupos = T.agruparPorEquipo([
    linea("bateria", { equipo: { ...eq } }),
    linea("antena", { equipo: { ...eq } }),
  ]);
  assert.equal(grupos.length, 1, "sin id, serial+modelo tiene que bastar para agrupar");
});

test("A3 · cotizaciones ya emitidas: cae al `spec` de texto", () => {
  const T = cargarTotales();
  const spec = "Equipo: Serie AAA111 · Modelo HP786 · Intervención: cambio de batería";
  const grupos = T.agruparPorEquipo([
    linea("bateria", { spec }),
    linea("clip", { spec }),
    linea("antena", { spec: "Equipo: Serie BBB222 · Modelo PD606" }),
  ]);
  assert.equal(grupos.length, 2);
  assert.equal(T.tituloEquipo(grupos[0]), "Serie AAA111 · Modelo HP786",
    "el título sale del spec, sin la intervención");
  assert.equal(T.trabajoEquipo(grupos[0]), "cambio de batería");
});

test("A4 · título y trabajo desde el objeto `equipo`", () => {
  const T = cargarTotales();
  const g = T.agruparPorEquipo([linea("bateria", {
    equipo: { id: "e1", serial: "AAA111", modelo: "HP786", marca: "Hytera", intervencion: "cambio de batería" },
  })])[0];
  assert.equal(T.tituloEquipo(g), "Hytera HP786 · Serie AAA111");
  assert.equal(T.trabajoEquipo(g), "cambio de batería");
});

test("A5 · sin equipo ni spec, un solo grupo sin título", () => {
  const T = cargarTotales();
  const grupos = T.agruparPorEquipo([linea("radio"), linea("cargador")]);
  assert.equal(grupos.length, 1);
  assert.equal(T.tituloEquipo(grupos[0]), "", "sin título → el grupo se pinta sin encabezado");
});

// ── B — el documento del cliente ──────────────────────────────────────────
test("B1 · sale un encabezado por equipo, con el trabajo realizado", () => {
  const T = cargarTotales();
  const html = T.filasPorEquipoHtml([
    linea("bateria", { equipo: { id: "e1", serial: "AAA111", modelo: "HP786", intervencion: "cambio de batería" } }),
    linea("antena", { equipo: { id: "e2", serial: "BBB222", modelo: "PD606", intervencion: "antena nueva" } }),
  ], { hayAlquiler: false });

  assert.equal((html.match(/cq-grp/g) || []).length >= 2, true, "un encabezado por equipo");
  assert.ok(html.includes("HP786 · Serie AAA111"));
  assert.ok(html.includes("Trabajo realizado:"));
  assert.ok(html.includes("cambio de batería"));
});

test("B2 · la numeración es continua a través de los grupos", () => {
  const T = cargarTotales();
  const html = T.filasPorEquipoHtml([
    linea("a", { equipo: { id: "e1", serial: "AAA111", modelo: "HP786" } }),
    linea("b", { equipo: { id: "e1", serial: "AAA111", modelo: "HP786" } }),
    linea("c", { equipo: { id: "e2", serial: "BBB222", modelo: "PD606" } }),
  ], { hayAlquiler: false });
  const idx = [...html.matchAll(/class="idx">(\d+)</g)].map((m) => m[1]);
  assert.deepEqual(idx.join(","), "01,02,03",
    "el tercer renglón es el 03 aunque abra otro equipo");
});

test("B3 · el renglón ya NO repite el equipo debajo de cada fila", () => {
  const T = cargarTotales();
  const html = T.filasPorEquipoHtml([
    linea("bateria", { equipo: { id: "e1", serial: "AAA111", modelo: "HP786", intervencion: "cambio" } }),
  ], { hayAlquiler: false });
  // "Serie AAA111" aparece UNA vez (en el encabezado), no una por renglón.
  assert.equal((html.match(/AAA111/g) || []).length, 1);
});

test("B4 · la columna de modalidad solo se emite si la propuesta mezcla", () => {
  const T = cargarTotales();
  const items = [linea("a", { equipo: { id: "e1", serial: "S1", modelo: "M1" } })];
  // La celda completa, no el fragmento "cq-mod": la clase del SKU es
  // `cq-model` y contiene esa subcadena.
  const celda = 'class="c cq-mod"';
  assert.ok(!T.filasPorEquipoHtml(items, { hayAlquiler: false }).includes(celda));
  assert.ok(T.filasPorEquipoHtml(items, { hayAlquiler: true }).includes(celda));
});

test("B5 · el colspan del encabezado cubre todas las columnas", () => {
  const T = cargarTotales();
  const items = [linea("a", { equipo: { id: "e1", serial: "S1", modelo: "M1" } })];
  assert.ok(T.filasPorEquipoHtml(items, { hayAlquiler: false }).includes('colspan="5"'));
  assert.ok(T.filasPorEquipoHtml(items, { hayAlquiler: true }).includes('colspan="6"'),
    "con la columna de modalidad el encabezado tiene que crecer también");
});

// Reporte de Zuleika (2026-09-02): el descuento por renglón se aplicaba al
// total pero no se veía por ninguna parte del documento — el cliente veía
// $200 de precio unitario y $480 de total sin explicación. La columna "Desc."
// lo hace visible, y solo existe cuando algún renglón trae descuento.
test("B7 · la columna Desc. aparece solo si algún renglón trae descuento", () => {
  const T = cargarTotales();
  const sinDesc = [linea("a"), linea("b")];
  const conDesc = [linea("a", { cant: 3, precio: 200, desc: 20 }), linea("b")];

  assert.equal(T.hayDescLineas(sinDesc), false);
  assert.equal(T.hayDescLineas(conDesc), true);

  assert.ok(!T.filasPorEquipoHtml(sinDesc, { hayAlquiler: false }).includes('class="num c"'),
    "sin descuentos la columna es puro ruido");
  const html = T.filasPorEquipoHtml(conDesc, { hayAlquiler: false });
  assert.ok(html.includes('class="num c">20%'), "el renglón enseña su porcentaje");
  assert.ok(html.includes('class="num c">—'), "el renglón sin descuento marca —");
  assert.ok(html.includes("$480.00"), "el total sigue saliendo con el precio rebajado");
});

test("B8 · el colspan del encabezado también crece con la columna Desc.", () => {
  const T = cargarTotales();
  const items = [linea("a", { desc: 10, equipo: { id: "e1", serial: "S1", modelo: "M1" } })];
  assert.ok(T.filasPorEquipoHtml(items, { hayAlquiler: false }).includes('colspan="6"'));
  assert.ok(T.filasPorEquipoHtml(items, { hayAlquiler: true }).includes('colspan="7"'),
    "modalidad y descuento suman columnas por separado");
});

test("B6 · el contenido va escapado (el cliente abre esto en su navegador)", () => {
  const T = cargarTotales();
  const html = T.filasPorEquipoHtml([
    linea("x", { equipo: { id: "e1", serial: "S1", modelo: '<img src=x onerror=alert(1)>', intervencion: "ok" } }),
  ], { hayAlquiler: false });
  assert.ok(!html.includes("<img src=x"), "el modelo no puede inyectar HTML");
  assert.ok(html.includes("&lt;img"));
});

// ── C — la cotización comercial no cambia ─────────────────────────────────
test("C1 · sin equipos no se pinta ningún encabezado de grupo", () => {
  const T = cargarTotales();
  const html = T.filasPorEquipoHtml([linea("radio"), linea("cargador")], { hayAlquiler: false });
  assert.ok(!html.includes("cq-grp"), "una propuesta comercial se ve como siempre");
  assert.equal([...html.matchAll(/class="idx">(\d+)</g)].length, 2);
});

// ── D — resumen de piezas a bodega ────────────────────────────────────────
// Se ejercita la agregación tal como la hace el trigger, con los consumos que
// escribe ordenes-equipos.js.
function cargarResumen() {
  const mod = leer("functions", "src", "triggers", "cotizaciones", "onEstadoChange.js");
  // Se extrae solo el agregador: cargar el módulo entero arrastraría
  // firebase-functions y el registro del trigger.
  const ini = mod.indexOf("async function resumenPiezasDeOrden");
  const fin = mod.indexOf("/**", ini);
  const cuerpo = mod.slice(ini, fin)
    .replace(/const snap = await db[\s\S]*?\.get\(\);/, "const snap = { forEach: (f) => CONSUMOS.forEach((c) => f({ data: () => c })) };");
  const ctx = { console, CONSUMOS: [] };
  vm.createContext(ctx);
  vm.runInContext(cuerpo + "\nglobalThis.__fn = resumenPiezasDeOrden;", ctx);
  return (consumos) => { ctx.CONSUMOS = consumos; return ctx.__fn("OS-1"); };
}

test("D1 · agrupa por pieza y separa cobro de garantía", async () => {
  const resumen = cargarResumen();
  const out = await resumen([
    { pieza_id: "p1", pieza_nombre: "Batería HP786", sku: "BAT-786", qty: 2, tipo: "cobro" },
    { pieza_id: "p1", pieza_nombre: "Batería HP786", sku: "BAT-786", qty: 1, tipo: "garantia" },
    { pieza_id: "p2", pieza_nombre: "Antena UHF", sku: "ANT-U", qty: 1, tipo: "cobro" },
  ]);
  assert.equal(out.length, 2);
  const bat = out.find((p) => p.sku === "BAT-786");
  assert.equal(bat.total, 3, "la garantía también cuenta: salió de bodega igual");
  assert.equal(bat.cobro, 2);
  assert.equal(bat.garantia, 1);
});

test("D2 · ordena por cantidad total, de mayor a menor", async () => {
  const resumen = cargarResumen();
  const out = await resumen([
    { pieza_id: "p1", pieza_nombre: "Clip", qty: 1, tipo: "cobro" },
    { pieza_id: "p2", pieza_nombre: "Batería", qty: 5, tipo: "cobro" },
  ]);
  assert.equal(out[0].nombre, "Batería");
});

test("D3 · una pieza fuera de catálogo (sin pieza_id) igual cuenta", async () => {
  const resumen = cargarResumen();
  const out = await resumen([
    { pieza_nombre: "Tornillo especial", qty: 4, tipo: "cobro" },
  ]);
  assert.equal(out.length, 1, "bodega igual tiene que reponerla");
  assert.equal(out[0].total, 4);
});

test("D4 · se ignoran las cantidades cero o negativas", async () => {
  const resumen = cargarResumen();
  const out = await resumen([
    { pieza_id: "p1", pieza_nombre: "Clip", qty: 0, tipo: "cobro" },
    { pieza_id: "p2", pieza_nombre: "Antena", qty: -1, tipo: "cobro" },
  ]);
  assert.equal(out.length, 0);
});

test("D5 · un consumo sin tipo cuenta como cobro (default histórico)", async () => {
  const resumen = cargarResumen();
  const out = await resumen([{ pieza_id: "p1", pieza_nombre: "Clip", qty: 2 }]);
  assert.equal(out[0].cobro, 2);
  assert.equal(out[0].garantia, 0);
});

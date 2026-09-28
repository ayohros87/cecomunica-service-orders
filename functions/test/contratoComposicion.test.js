// Composición del contrato (public/js/domain/contratoComposicion.js).
//
// Alberto, 2026-09-28: desde septiembre todo contrato nuevo es "Servicio" y la
// propiedad va por línea (`equipos[].modalidad`), así que la columna "Tipo"
// del archivo dice "Servicio" en todos y se perdió la lectura rápida que daban
// ALQ/PROP. La etiqueta se DERIVA de las líneas; los ALQ/PROP viejos siguen
// leyéndose por su tipo.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const FUENTE = leer("public", "js", "domain", "contratoComposicion.js");

// Como lo carga el navegador: script clásico, publica en window.
function montar() {
  const ctx = { window: {}, console, Number, String, Array, Object, RegExp };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(FUENTE, ctx);
  return ctx.window.ContratoComposicion;
}
const CC = montar();

const serv = (equipos, extra = {}) => ({ codigo_tipo: "SERV", tipo_contrato: "Servicio", equipos, ...extra });

test("publica window.ContratoComposicion SIEMPRE y también module.exports (patrón post-Rolldown)", () => {
  assert.equal(typeof CC.etiqueta, "function");
  const cjs = require("../../public/js/domain/contratoComposicion.js");
  assert.equal(typeof cjs.etiqueta, "function");
  assert.match(FUENTE, /root\.ContratoComposicion = api;/, "window se publica sin depender de `module`");
});

test("contar suma `cantidad` por línea y cuenta 1 cuando la línea no la trae", () => {
  const c = serv([
    { modelo: "NX-1300", cantidad: 10, modalidad: "alquiler" },
    { modelo: "NX-1300", cantidad: "2", modalidad: "alquiler" },
    { modelo: "TK-3000", cantidad: 3, modalidad: "propio" },
    { modelo: "PD506", modalidad: "propio" },          // sin cantidad → 1
    { modelo: "Consola", cantidad: 2 },                 // sin modalidad
    { modelo: "Vacía", cantidad: 0, modalidad: "alquiler" },
  ]);
  // Spread: el objeto nace en el realm del vm y deepEqual compara prototipos.
  assert.deepEqual({ ...CC.contar(c) }, { alquiler: 12, propio: 4, sin_modalidad: 2, total: 18 });
});

test("SERV mixto: código, etiqueta con cifras, resumen y chip", () => {
  const c = serv([{ cantidad: 12, modalidad: "alquiler" }, { cantidad: 3, modalidad: "propio" }]);
  assert.equal(CC.codigo(c), "mixto");
  assert.equal(CC.etiqueta(c), "Mixto · 12 alq / 3 prop");
  assert.equal(CC.resumen(c), "12 equipos en alquiler · 3 propios del cliente");
  assert.equal(CC.grupo(c), "mixto");
  assert.equal(CC.chipClass(c), "chip-comp chip-comp-mixto");
});

test("SERV todo alquiler / todo propio", () => {
  const alq = serv([{ cantidad: 5, modalidad: "alquiler" }]);
  assert.equal(CC.codigo(alq), "alquiler");
  assert.equal(CC.etiqueta(alq), "Alquiler");
  assert.equal(CC.resumen(alq), "5 equipos en alquiler");
  const pro = serv([{ cantidad: 1, modalidad: "propio" }]);
  assert.equal(CC.codigo(pro), "propio");
  assert.equal(CC.etiqueta(pro), "Propio");
  assert.equal(CC.resumen(pro), "1 equipo del cliente (propio)");
});

test("SERV con una línea sin modalidad entre líneas con modalidad se lee como alquiler (igual que el resto del sistema)", () => {
  const c = serv([{ cantidad: 4, modalidad: "propio" }, { cantidad: 1 }]);
  assert.equal(CC.codigo(c), "mixto");
  assert.equal(CC.etiqueta(c), "Mixto · 1 alq / 4 prop");
  // Sin modalidad en NINGUNA línea: alquiler, no "otro".
  assert.equal(CC.codigo(serv([{ cantidad: 2 }])), "alquiler");
});

test("legacy: ALQ/PROP sin modalidad por línea se leen por el tipo", () => {
  const alq = { codigo_tipo: "ALQ", tipo_contrato: "Alquiler", equipos: [{ cantidad: 6 }] };
  assert.equal(CC.codigo(alq), "legacy_alq");
  assert.equal(CC.etiqueta(alq), "Alquiler");
  assert.equal(CC.grupo(alq), "alquiler");
  assert.match(CC.resumen(alq), /formato anterior/);
  // Solo por nombre (docs viejos sin codigo_tipo) también.
  const pro = { tipo_contrato: "Propio", equipos: [{ cantidad: 2 }] };
  assert.equal(CC.codigo(pro), "legacy_prop");
  assert.equal(CC.etiqueta(pro), "Propio");
  assert.equal(CC.grupo(pro), "propio");
  // Un PROP que el editor ya rellenó con modalidad deja de ser legacy.
  const proEditado = { codigo_tipo: "PROP", equipos: [{ cantidad: 2, modalidad: "propio" }] };
  assert.equal(CC.codigo(proEditado), "propio");
  // PROP con una línea sin rellenar: esa línea es del cliente, no alquiler.
  assert.equal(CC.codigo({ codigo_tipo: "PROP", equipos: [{ cantidad: 2, modalidad: "propio" }, { cantidad: 1 }] }), "propio");
});

test("DEMO / TEMP / REEMP conservan su nombre y no entran al filtro", () => {
  for (const [codigo_tipo, nombre] of [["DEMO", "Demo"], ["TEMP", "Temporal"], ["REEMP", "Reemplazo"]]) {
    const c = { codigo_tipo, equipos: [{ cantidad: 2, modalidad: "alquiler" }] };
    assert.equal(CC.codigo(c), "otro", codigo_tipo);
    assert.equal(CC.etiqueta(c), nombre, codigo_tipo);
    assert.equal(CC.grupo(c), "", codigo_tipo);
    assert.equal(CC.chipClass(c), "chip-comp chip-comp-otro");
  }
  // El campo manda sobre el prefijo del número (REEMP numerado como ALQ por error).
  assert.equal(CC.etiqueta({ codigo_tipo: "REEMP", contrato_id: "ALQ20251024-01", equipos: [{ cantidad: 1 }] }), "Reemplazo");
  // Sin líneas que leer: se nombra por el tipo.
  assert.equal(CC.codigo(serv([])), "otro");
  assert.equal(CC.etiqueta(serv([])), "Servicio");
  assert.equal(CC.etiqueta(null), "—");
});

test("acepta las líneas como `lineas[]` además de `equipos[]`", () => {
  const c = { codigo_tipo: "SERV", lineas: [{ cantidad: 2, modalidad: "alquiler" }, { cantidad: 1, modalidad: "propio" }] };
  assert.equal(CC.codigo(c), "mixto");
});

test("filtro: coincide() y los sinónimos que se teclean en el buscador", () => {
  const mix = serv([{ cantidad: 1, modalidad: "alquiler" }, { cantidad: 1, modalidad: "propio" }]);
  assert.equal(CC.coincide(mix, ""), true);
  assert.equal(CC.coincide(mix, "todas"), true);
  assert.equal(CC.coincide(mix, "mixto"), true);
  assert.equal(CC.coincide(mix, "alquiler"), false);
  assert.equal(CC.sinonimoFiltro("alq"), "alquiler");
  assert.equal(CC.sinonimoFiltro(" ALQUILER "), "alquiler");
  assert.equal(CC.sinonimoFiltro("prop"), "propio");
  assert.equal(CC.sinonimoFiltro("Propios"), "propio");
  assert.equal(CC.sinonimoFiltro("mixto"), "mixto");
  assert.equal(CC.sinonimoFiltro("alquimia"), "", "una palabra que EMPIEZA por alq sigue siendo búsqueda");
  assert.equal(CC.sinonimoFiltro("SERV20260901-01"), "");
  assert.equal(CC.sinonimoFiltro(""), "");
});

// ── Guardias de integración: dónde se ve la etiqueta ────────────────────
test("las páginas que la pintan cargan el domain en su entry", () => {
  for (const entry of ["contratos-index.js", "clientes-centro.js"]) {
    assert.match(leer("public", "js", "entry", entry), /\/js\/domain\/contratoComposicion\.js/, entry);
  }
});

test("el archivo de contratos usa la etiqueta en la columna Tipo, la tarjeta y el CSV, y filtra sobre lo cargado", () => {
  const lista = leer("public", "js", "pages", "contratos-list.js");
  assert.match(lista, /ContratoComposicion/);
  assert.match(lista, /filtroComposicionChips/, "los chips del filtro viven en el archivo");
  assert.match(lista, /composicion:/, "el filtro se persiste con los demás (localStorage)");
  assert.match(lista, /sinonimoFiltro/, "'alq'/'prop' en el buscador aplican el filtro");
  const html = leer("public", "contratos", "index.html");
  assert.match(html, /id="filtroComposicionChips"/);
  for (const g of ["", "alquiler", "propio", "mixto"]) assert.match(html, new RegExp(`data-comp="${g}"`), g || "Todas");
});

test("el Centro pinta el chip junto al número del contrato y en el título del contrato abierto", () => {
  const { fuenteCentro } = require("./_helpers/centro");
  const src = fuenteCentro();
  assert.match(src, /_compChipHtml\(c\)/);
  assert.match(src, /ContratoComposicion/);
});

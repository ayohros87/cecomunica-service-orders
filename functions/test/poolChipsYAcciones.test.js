// Guardias de UI del pool de equipos por serial (auditoría 2026-08-04).
//
// Congela los dos invariantes que la auditoría encontró rotos y que se rompen
// solos con el tiempo, porque el dato y su presentación viven en archivos
// distintos:
//
//   A1 — TODO estado de EquiposPoolService.ESTADO_LABELS necesita su color
//        .eqpool-chip-<estado> en css/ceco-ui.css. Faltaban `por_clasificar` y
//        `en_poc`, así que chipEstadoHtml emitía una clase inexistente y esas
//        unidades salían SIN fondo en seis páginas — justo el estado que
//        significa "hay que ir a buscar el radio".
//
//   R1 — la columna de acciones de Inventario · Equipos no puede volver a ser
//        un muro de iconos sin texto: cada fila expone UNA CTA con etiqueta y
//        el resto va en el menú ⋯, también con etiqueta.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// ── Carga del servicio del pool (define const EquiposPoolService) ──────────
function cargarServicio() {
  const ctx = { firebase: { firestore: { FieldValue: {} } }, console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "equiposPoolService.js"), ctx);
  return ctx.window.EquiposPoolService;
}

// ── Carga de la página de inventario (define window.EquiposPool) ───────────
function cargarPagina() {
  const noop = () => {};
  const ctx = {
    console,
    window: {},
    document: { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [] },
    firebase: { auth: () => ({ onAuthStateChanged: noop }), firestore: () => ({}) },
    ROLES: { ADMIN: "administrador", INVENTARIO: "inventario", GERENTE: "gerente", VISTA: "vista" },
    FMT: { esc: (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) },
    Toast: { show: noop },
    localStorage: { getItem: () => null, setItem: noop },
  };
  ctx.window.EquiposPool = undefined;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "pages", "inventario-equipos.js"), ctx);
  return ctx.window.EquiposPool;
}

test("todo estado del pool tiene color de chip en ceco-ui.css", () => {
  const svc = cargarServicio();
  const css = leer("public", "css", "ceco-ui.css");
  const estados = Object.keys(svc.ESTADO_LABELS);
  assert.ok(estados.length >= 9, "se esperaban al menos los 9 estados conocidos");

  const sinColor = estados.filter((e) => !css.includes(`.eqpool-chip-${e} `)
                                      && !css.includes(`.eqpool-chip-${e}{`)
                                      && !css.includes(`.eqpool-chip-${e}  `));
  assert.deepEqual(sinColor, [],
    `estados sin .eqpool-chip-<estado> en ceco-ui.css: ${sinColor.join(", ")}. ` +
    "chipEstadoHtml emitiría una clase inexistente y el chip saldría sin fondo.");

  // El fallback también tiene que existir: chipEstadoHtml cae en 'desconocido'
  // para cualquier estado que no esté en ESTADO_LABELS.
  assert.match(css, /\.eqpool-chip-desconocido\s*\{/);
});

test("chipEstadoHtml usa siempre una clase con color", () => {
  const svc = cargarServicio();
  const css = leer("public", "css", "ceco-ui.css");
  for (const estado of Object.keys(svc.ESTADO_LABELS)) {
    const html = svc.chipEstadoHtml(estado);
    const cls = html.match(/eqpool-chip-([a-z_]+)/)[1];
    assert.ok(css.includes(`.eqpool-chip-${cls}`), `${estado} → clase ${cls} sin definir`);
  }
  // Estado desconocido (dato viejo o typo) no debe quedar sin estilo.
  assert.match(svc.chipEstadoHtml("estado_inventado"), /eqpool-chip-desconocido/);
});

test("la página de inventario ya no define su propia paleta de estados", () => {
  const html = leer("public", "inventario", "equipos.html");
  const js = leer("public", "js", "pages", "inventario-equipos.js");
  // .eq-badge era la copia desincronizada del kit; no debe volver. Se ignoran
  // los comentarios (HTML y CSS), que sí la nombran para explicar por qué se fue.
  const htmlSinComentarios = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.eq-badge-/.test(htmlSinComentarios),
    "equipos.html volvió a declarar .eq-badge-* (duplica los chips del kit)");
  assert.ok(!/class="eq-badge/.test(js),
    "inventario-equipos.js volvió a emitir .eq-badge (usa EquiposPoolService.chipEstadoHtml)");
});

test("cada fila expone UNA CTA con texto, nunca un muro de iconos", () => {
  const page = cargarPagina();
  assert.ok(page && typeof page._accionesHtml === "function", "no se cargó EquiposPool._accionesHtml");

  const casos = [
    { nombre: "devuelto por inspeccionar", eq: { id: "A1", estado: "devuelto_revision" }, cta: "Inspección OK" },
    { nombre: "por clasificar",            eq: { id: "A2", estado: "por_clasificar" },     cta: "Corregir estado" },
    // "Sin verificar" cubre 5,378 de 6,735 fichas: es el residuo de la
    // migración, no una cola. Va al menú, nunca a la CTA.
    { nombre: "sin verificar",             eq: { id: "A4", estado: "en_bodega", verificado: false }, cta: "Historia" },
    { nombre: "dada de baja",              eq: { id: "A5", estado: "baja" },               cta: "Historia" },
    { nombre: "en bodega, nada urgente",   eq: { id: "A6", estado: "en_bodega" },          cta: "Historia" },
    { nombre: "en cliente, nada urgente",  eq: { id: "A7", estado: "en_cliente" },         cta: "Historia" },
    // La regresión de 2026-08-04: una unidad migrada que está con su cliente es
    // el estado NORMAL del pool (3,646 de 6,735 fichas). Si vuelve a la
    // precedencia de la CTA, la columna se llena de ámbar y deja de leerse.
    { nombre: "migrada y con su cliente",  eq: { id: "A3", estado: "en_cliente", origen: "migracion_contrato" }, cta: "Historia" },
    { nombre: "migrada y en taller",       eq: { id: "A8", estado: "en_taller", origen: "migracion_orden" },     cta: "Historia" },
  ];

  for (const { nombre, eq, cta } of casos) {
    const html = page._accionesHtml(eq, true);
    // 1) La CTA es la esperada por precedencia.
    assert.ok(html.includes(`> ${cta}</button>`) || html.includes(`</i> ${cta}</button>`),
      `${nombre}: se esperaba la CTA "${cta}" — salió: ${html.slice(0, 200)}`);

    // 2) Ningún botón de la fila queda sin etiqueta de texto. Se exceptúa el
    //    disparador del menú, que es el "⋯" universal.
    const botones = html.match(/<button[\s\S]*?<\/button>/g) || [];
    for (const b of botones) {
      if (b.includes("overflow-menu-btn")) continue;
      const texto = b.replace(/<[^>]*>/g, "").trim();
      assert.ok(texto.length > 1, `${nombre}: botón sin etiqueta → ${b}`);
    }

    // 3) Fuera del menú hay exactamente UN botón (la CTA) + el "⋯".
    const antesDelMenu = html.split('<div class="overflow-menu">')[0];
    const ctas = (antesDelMenu.match(/<button/g) || []).length;
    assert.equal(ctas, 1, `${nombre}: se esperaba 1 sola CTA inline, hubo ${ctas}`);
  }
});

test("sin permiso de escritura la fila solo ofrece la Historia", () => {
  const page = cargarPagina();
  const html = page._accionesHtml({ id: "B1", estado: "devuelto_revision", verificado: false }, false);
  assert.ok(html.includes("Historia"), "el rol de solo lectura debe poder ver el kardex");
  for (const prohibido of ["Inspección OK", "Dar de baja", "Editar ficha", "Verificar", "Registrar venta"]) {
    assert.ok(!html.includes(prohibido), `se filtró una acción de escritura: ${prohibido}`);
  }
});

// CENSO REAL del pool — cruce estado × verificado, contado contra producción el
// 2026-08-04 (6,735 fichas). Está aquí porque una CTA de aviso solo comunica si
// es MINORÍA, y eso no se puede juzgar con casos sueltos: hay que pesarlos por
// cuántas fichas caen en cada forma. Dos veces seguidas una precedencia que
// parecía sensata resultó cubrir ~80% de la tabla.
//   1ª: "origen migración + en cliente/taller" → 5,224 filas (78%)
//   2ª: "verificado === false"                 → 5,378 filas (80%)
// Si el pool cambia de forma, actualiza estos números con una query real; no
// los inventes, que es justo lo que falló.
const CENSO_POOL = [
  // [estado, verificado, n, origen]
  ["en_cliente",        false, 3244, "migracion_poc"],
  ["por_clasificar",    false, 1575, "migracion_poc"],
  ["en_bodega",         true,  1204, "bodega"],
  ["en_taller",         false,  311, "migracion_orden"],
  ["devuelto_revision", false,  124, "migracion_contrato"],
  ["en_taller",         true,   107, "bodega"],
  ["en_bodega",         false,   97, "migracion_contrato"],
  ["en_cliente",        true,    35, "bodega"],
  ["asignado_contrato", false,   17, "migracion_contrato"],
  ["vendido",           false,   10, "venta"],
  ["baja",              true,     5, "bodega"],
  ["por_clasificar",    true,     3, "bodega"],
  ["asignado_contrato", true,     2, "bodega"],
  ["vendido",           true,     1, "venta"],
];

test("la CTA de aviso es minoría — no puede volver a inundar la tabla", () => {
  const page = cargarPagina();
  let total = 0, conCta = 0;
  const culpables = [];
  for (const [estado, verificado, n, origen] of CENSO_POOL) {
    const html = page._accionesHtml({ id: "x", estado, origen, verificado }, true);
    const esNeutra = /(?:>|<\/i>) Historia<\/button>/.test(html);
    total += n;
    if (!esNeutra) { conCta += n; culpables.push(`${estado}/${verificado ? "verif" : "noVerif"}=${n}`); }
  }
  assert.equal(total, 6735, "el censo debe sumar el total contado en producción");
  const pct = (conCta / total) * 100;
  assert.ok(pct < 35,
    `la CTA de aviso saldría en ${pct.toFixed(0)}% de las filas (${conCta}/${total}): ` +
    `${culpables.join(", ")}. Por encima de ~1 de cada 3 deja de leerse como aviso — ` +
    "esa condición es un FILTRO, no una CTA. La fila normal debe ser neutra (Historia).");
});

test("la acción destructiva va al final del menú y marcada como danger", () => {
  const page = cargarPagina();
  const html = page._accionesHtml({ id: "C1", estado: "en_bodega" }, true);
  const iBaja = html.indexOf("Dar de baja");
  assert.ok(iBaja > 0, "falta la baja en el menú");
  assert.ok(html.lastIndexOf("overflow-menu-divider") < iBaja,
    "la baja debe ir después del separador");
  assert.match(html.slice(iBaja - 200, iBaja), /overflow-menu-item danger/,
    "la baja debe llevar la clase danger");
});

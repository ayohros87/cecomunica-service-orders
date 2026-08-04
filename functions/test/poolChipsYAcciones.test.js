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
    { nombre: "entrada por inspeccionar", eq: { id: "A1", estado: "devuelto_revision" }, cta: "Inspección OK" },
    { nombre: "por clasificar",           eq: { id: "A2", estado: "por_clasificar" },     cta: "Corregir estado" },
    { nombre: "migración dudosa",         eq: { id: "A3", estado: "en_cliente", origen: "migracion_contrato" }, cta: "Corregir estado" },
    { nombre: "sin verificar",            eq: { id: "A4", estado: "en_bodega", verificado: false }, cta: "Verificar" },
    { nombre: "dada de baja",             eq: { id: "A5", estado: "baja" },               cta: "Revivir" },
    { nombre: "en bodega, nada urgente",  eq: { id: "A6", estado: "en_bodega" },          cta: "Historia" },
    { nombre: "en cliente, nada urgente", eq: { id: "A7", estado: "en_cliente" },         cta: "Historia" },
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

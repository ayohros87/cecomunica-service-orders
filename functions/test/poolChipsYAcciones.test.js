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
// `campos` permite simular los controles del DOM (búsqueda, selects, checks)
// para ejercitar el filtrado sin navegador.
function cargarPagina(campos = {}) {
  const noop = () => {};
  const nodo = (id) => {
    if (!(id in campos)) return null;
    const v = campos[id];
    return typeof v === "boolean"
      ? { type: "checkbox", checked: v, classList: { toggle: noop } }
      : { value: v, classList: { toggle: noop } };
  };
  const ctx = {
    console,
    window: {},
    document: {
      addEventListener: noop,
      getElementById: nodo,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
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

// ── Navegación (auditoría 2026-08-04, N1–N4) ───────────────────────────────

// El bug: `_filtrados` exigía `_enTab && filtros`, la página abría en una
// ubicación concreta, y buscar un serial que estuviera en OTRA devolvía "Sin
// resultados". La pregunta más frecuente de la página fallaba en silencio.
test("buscar un serial lo encuentra aunque esté en otra ubicación", () => {
  const pool = [
    { id: "1", serial: "25219A0801", serial_norm: "25219A0801", estado: "en_bodega" },
    { id: "2", serial: "24O31A0947", serial_norm: "24O31A0947", estado: "en_cliente" },
    { id: "3", serial: "B12345678",  serial_norm: "B12345678",  estado: "en_taller" },
  ];

  // Parado en Bodega, buscando un serial que está EN CLIENTE.
  const page = cargarPagina({ eqBusqueda: "24O31A0947" });
  page._equipos = pool;
  page._tab = "en_bodega";
  const hallados = page._filtrados();
  assert.equal(hallados.length, 1, "la búsqueda debe escapar de la pestaña activa");
  assert.equal(hallados[0].serial, "24O31A0947");

  // Sin búsqueda, la pestaña sí manda.
  const page2 = cargarPagina({ eqBusqueda: "" });
  page2._equipos = pool;
  page2._tab = "en_bodega";
  assert.deepEqual(page2._filtrados().map(e => e.serial), ["25219A0801"],
    "sin búsqueda la pestaña debe seguir restringiendo");
});

test("la búsqueda sigue respetando los filtros secundarios", () => {
  const page = cargarPagina({ eqBusqueda: "PNC360S", eqFiltroPropiedad: "cliente" });
  page._equipos = [
    { id: "1", serial: "A1", modelo_label: "HYTERA PNC360S", estado: "en_bodega", propiedad: "cecomunica" },
    { id: "2", serial: "A2", modelo_label: "HYTERA PNC360S", estado: "en_cliente", propiedad: "cliente" },
  ];
  page._tab = "en_bodega";
  const r = page._filtrados();
  assert.equal(r.length, 1, "propiedad=cliente debe seguir aplicando durante la búsqueda");
  assert.equal(r[0].serial, "A2");
});

test("la página aterriza en Bodega y sin filtro de propiedad impuesto", () => {
  const page = cargarPagina();
  assert.equal(page.FILTROS_DEFAULT.tab, "en_bodega",
    "abrir en 'en_cliente' dejaba al usuario en la lista más grande y menos accionable");
  assert.equal(page.FILTROS_DEFAULT.propiedad, "",
    "un filtro de propiedad que el usuario nunca escogió es estado oculto");
});

test("las pestañas son sólo ubicaciones; las colas viven en las tarjetas", () => {
  const html = leer("public", "inventario", "equipos.html");
  const tabs = [...html.matchAll(/class="eq-tab[^"]*"\s+data-tab="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs.sort(),
    ["asignado_contrato", "en_bodega", "en_cliente", "en_taller", "otros", "todos"].sort(),
    "las colas (devuelto_revision/por_clasificar/conflictos) no deben volver a la fila de pestañas");

  const colas = [...html.matchAll(/class="eq-cola"\s+data-cola="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(colas.sort(),
    ["conflictos", "devuelto_revision", "por_clasificar", "sin_verificar"].sort());

  const page = cargarPagina();
  // Toda cola declarada en el HTML tiene que existir en el mapa de la página.
  for (const c of colas) assert.ok(page.COLAS[c], `la tarjeta "${c}" no tiene entrada en COLAS`);
});

test("los deep-links de las señales del home siguen siendo válidos", () => {
  const page = cargarPagina();
  const señales = leer("public", "js", "pages", "home-signals.js");
  const destinos = [...señales.matchAll(/inventario\/equipos\.html\?tab=([a-z_]+)/g)].map(m => m[1]);
  assert.ok(destinos.length, "se esperaban señales apuntando al pool");
  for (const t of destinos) {
    const esCola = Object.values(page.COLAS).some(c => c.tab === t);
    const esUbicacion = ["en_bodega", "asignado_contrato", "en_cliente", "en_taller", "otros", "todos"].includes(t);
    assert.ok(esCola || esUbicacion, `?tab=${t} ya no lleva a ninguna vista`);
  }
});

// ── Acciones en lote ───────────────────────────────────────────────────────

test("cada acción de lote sólo aplica a las unidades que corresponden", () => {
  const page = cargarPagina();
  const A = page.LOTE_ACCIONES;
  const u = (o) => ({ id: "x", ...o });

  // Verificar: sólo fichas sin verificar, sin importar el estado.
  assert.ok(A.verificar.aplica(u({ estado: "en_bodega", verificado: false })));
  assert.ok(!A.verificar.aplica(u({ estado: "en_bodega", verificado: true })));
  assert.ok(!A.verificar.aplica(u({ estado: "en_bodega" })), "verificado indefinido no es 'sin verificar'");

  // Inspección OK: sólo lo devuelto y pendiente de revisar.
  assert.ok(A.inspeccion.aplica(u({ estado: "devuelto_revision" })));
  for (const e of ["en_bodega", "en_cliente", "en_taller", "por_clasificar", "baja", "vendido"]) {
    assert.ok(!A.inspeccion.aplica(u({ estado: e })), `inspección no debe aplicar a ${e}`);
  }

  // Corregir a bodega: por_clasificar, o migración con ubicación dudosa.
  assert.ok(A.corregir.aplica(u({ estado: "por_clasificar" })));
  assert.ok(A.corregir.aplica(u({ estado: "en_cliente", origen: "migracion_poc" })));
  assert.ok(!A.corregir.aplica(u({ estado: "en_cliente", origen: "bodega" })),
    "una unidad que NO viene de migración no tiene estado heredado que corregir");
  assert.ok(!A.corregir.aplica(u({ estado: "baja", origen: "migracion_poc" })),
    "una baja no se 'corrige' a bodega en lote: eso es revivir, y es individual");
  assert.ok(!A.corregir.aplica(u({ estado: "en_bodega", origen: "migracion_poc" })),
    "ya está en bodega");
});

test("la acción que afirma presencia física exige motivo", () => {
  const page = cargarPagina();
  assert.equal(page.LOTE_ACCIONES.corregir.pideMotivo, true,
    "mover a 'En bodega' es afirmar que el radio está ahí: sin motivo no hay rastro de por qué");
  // Y el texto del confirm tiene que decirlo, no sólo contar unidades.
  const cuerpo = page.LOTE_ACCIONES.corregir.cuerpo(40).toLowerCase();
  assert.match(cuerpo, /físicamente/, "el confirm debe decir que se afirma presencia física");
});

test("_enTandas no se detiene ante un fallo y reporta cuál falló", async () => {
  const page = cargarPagina();
  const items = [1, 2, 3, 4, 5];
  const res = await page._enTandas(items, async (n) => {
    if (n % 2 === 0) throw new Error("boom " + n);
  }, { concurrencia: 2 });

  assert.equal(res.length, 5, "todas las unidades deben intentarse");
  assert.equal(res.filter(r => r.ok).length, 3);
  const fallos = res.filter(r => !r.ok);
  // `res` viene del realm del vm, así que deepStrictEqual choca por prototipo:
  // se compara el contenido, no la identidad del Array.
  assert.equal(fallos.map(f => f.it).sort().join(","), "2,4");
  assert.ok(fallos.every(f => /boom/.test(f.error)), "el motivo del fallo debe conservarse por unidad");
});

test("_enTandas respeta la cancelación y dice cuántas quedaron sin intentar", async () => {
  const page = cargarPagina();
  const items = Array.from({ length: 50 }, (_, i) => i);
  let hechos = 0, cancelar = false;
  const res = await page._enTandas(items, async () => { hechos++; if (hechos >= 10) cancelar = true; },
    { concurrencia: 1, cancelado: () => cancelar });
  assert.ok(res.length >= 10 && res.length < 50,
    `debe parar a media lista (procesó ${res.length} de 50)`);
});

test("_enTandas informa progreso en cada unidad", async () => {
  const page = cargarPagina();
  const vistos = [];
  await page._enTandas([1, 2, 3], async () => {}, {
    concurrencia: 1, onProgreso: (hechos, total) => vistos.push(`${hechos}/${total}`),
  });
  assert.deepEqual(vistos, ["1/3", "2/3", "3/3"]);
});

test("el lote usa las MISMAS funciones de servicio que la fila", () => {
  // Si el lote se escribiera aparte, las dos rutas divergen (este repo ya paga
  // eso con la normalización duplicada front/functions). El guardia es textual
  // porque lo que importa es que no aparezca un `.update(` propio.
  const src = leer("public", "js", "pages", "inventario-equipos.js");
  const bloque = src.slice(src.indexOf("LOTE_ACCIONES:"), src.indexOf("_seleccionados()"));
  for (const m of ["EquiposPoolService.verificar", "EquiposPoolService.liberar", "EquiposPoolService.corregirABodega"]) {
    assert.ok(bloque.includes(m), `el lote debe delegar en ${m}`);
  }
  assert.ok(!/\.collection\(|\.update\(|batch\(/.test(bloque),
    "el lote no debe escribir a Firestore por su cuenta: delega en el servicio");
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

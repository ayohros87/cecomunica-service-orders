// Buscador de cliente en cotizaciones: que filtre de verdad y no ofrezca
// duplicados ya fusionados.
//
// Reporte de ventas (11-ago-2026): "en Clientes el buscador filtra bien; al
// crear una cotización el filtro solo funciona con las primeras letras — a la
// tercera deja de filtrar y se pierde la búsqueda. Además aparecen dos HOTEL
// LATINO, aunque ya fueron fusionados."
//
// Dos defectos distintos detrás de un mismo síntoma:
//   B1 — el campo era un <select> nativo. El navegador no filtra: hace
//        type-ahead por prefijo con un temporizador de ~1 s entre teclas, así
//        que "Hotel Gamboa" salta a la H y luego reinicia con letras sueltas.
//        Ahora hay un combo que filtra por subcadena, sin acentos, con todas
//        las palabras en cualquier orden y también por RUC.
//   B2 — bootstrapCatalogos metía en el selector TODOS los clientes, incluidos
//        los que Admin · Clientes duplicados dejó con deleted:true al fusionar
//        (HOTEL LATINO 4sWHCB… → W249uD…). El selector ya los excluye, pero
//        clientesById los conserva para que una cotización vieja que apunte a
//        uno fusionado siga resolviendo su RUC.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarCotState() {
  const ctx = {
    console,
    window: {},
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    firebase: { firestore: () => ({}) },
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  ctx.window.FMT = { round2: (n) => Math.round(Number(n || 0) * 100) / 100, ITBMS_RATE: 0.07, esc: String, money: (n) => "USD " + n };
  ctx.FMT = ctx.window.FMT;
  ctx.CotizacionTotales = ctx.window.CotizacionTotales;
  // El mapa de permisos real: requiereAprobacionPara consulta window.canRole,
  // y el test tiene que ejercitar la matriz de verdad, no una imitación.
  vm.runInContext(leer("public", "js", "core", "roles.js"), ctx);
  vm.runInContext(leer("public", "js", "pages", "cot-editor-state.js"), ctx);
  return ctx.window.CotState;
}

// Muestra tomada de la colección real (los 16 clientes con "HOTEL" al
// 11-ago-2026), reducida a lo que el combo necesita.
const CLIENTES = [
  { id: "ul09c5", razon: "AEROTEL., S.A. - HOTEL CROWNE PLAZA AEROPUERTO", ruc: "1740287-1-694190", representante: "" },
  { id: "MhZRnL", razon: "EVOLUTION HOTEL CORP", ruc: "155634826-2-2016", representante: "ABEL MENA BAUTISTA" },
  { id: "guXR9i", razon: "Hotel Gamboa", ruc: "", representante: "" },
  { id: "FadEfu", razon: "HOTEL GAMBOA RAINFOREST RESORT", ruc: "", representante: "" },
  { id: "W6H9hl", razon: "HOTEL LA COMPAÑÍA EL VALLE, S.A.", ruc: "155750868-2-2024", representante: "CRISTOPHER JAMES" },
  { id: "W249uD", razon: "HOTEL LATINO", ruc: "52744-50-325686", representante: "MIGUEL RAMON TABOADA" },
  { id: "aXJC4b", razon: "TROPICAL RESORTS INC - HOTEL GAMBOA RAINFOREST RESORT", ruc: "49063-111-313586", representante: "" },
  { id: "5jlpQ3", razon: "HOTELES DECAMERON, S.R.L.", ruc: "1111368-1-723", representante: "HECTOR PEREZ PORTILLO" },
];

// Array.from re-crea el arreglo en este realm: los que devuelve el vm tienen
// otro prototipo y deepEqual los rechazaría por identidad, no por contenido.
const razones = (r) => Array.from(r.items, (c) => c.razon);

test("B1 · el filtro sigue vivo pasada la tercera letra y en frases completas", () => {
  const { filtrarClientes } = cargarCotState();

  // Lo que rompía el <select>: escribir la frase entera.
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "Hotel Gamboa")), [
    "Hotel Gamboa",
    "HOTEL GAMBOA RAINFOREST RESORT",
    "TROPICAL RESORTS INC - HOTEL GAMBOA RAINFOREST RESORT",
  ]);

  // Y que el filtro se estreche letra a letra, no que se pierda.
  const conteos = ["h", "ho", "hot", "hote", "hotel l", "hotel la"].map(
    (q) => filtrarClientes(CLIENTES, q).total,
  );
  for (let i = 1; i < conteos.length; i++) {
    assert.ok(conteos[i] <= conteos[i - 1], `la consulta ${i} no debe ampliar el resultado`);
  }
  // El filtro es tolerante (cada palabra puede caer en cualquier parte: "la"
  // también está dentro de "PLAZA"), pero el orden manda: lo que empieza con
  // lo escrito va primero y el ruido queda al fondo.
  const hotelLa = razones(filtrarClientes(CLIENTES, "hotel la"));
  assert.deepEqual(hotelLa.slice(0, 2), [
    "HOTEL LA COMPAÑÍA EL VALLE, S.A.",
    "HOTEL LATINO",
  ]);
  assert.equal(hotelLa[hotelLa.length - 1], "AEROTEL., S.A. - HOTEL CROWNE PLAZA AEROPUERTO");
});

test("B1 · busca por subcadena, sin acentos, en cualquier orden y por RUC", () => {
  const { filtrarClientes } = cargarCotState();

  // Subcadena: "decameron" no es prefijo de nada, el select nativo no lo hallaba.
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "decameron")), ["HOTELES DECAMERON, S.R.L."]);

  // Palabras en cualquier orden.
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "gamboa tropical")), [
    "TROPICAL RESORTS INC - HOTEL GAMBOA RAINFOREST RESORT",
  ]);

  // Sin acentos: "compania" encuentra "COMPAÑÍA"… salvo la eñe, que no es tilde.
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "compañia el valle")), [
    "HOTEL LA COMPAÑÍA EL VALLE, S.A.",
  ]);

  // Por RUC y por representante (desempata homónimos).
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "52744")), ["HOTEL LATINO"]);
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "abel mena")), ["EVOLUTION HOTEL CORP"]);

  // Sin coincidencias: lista vacía, no la lista entera.
  assert.equal(filtrarClientes(CLIENTES, "zzzz").total, 0);

  // Una palabra de 1–2 letras solo cuenta contra el nombre: si no, la "g" de
  // "hotel g" calzaría con el MIGUEL del representante de HOTEL LATINO.
  assert.deepEqual(razones(filtrarClientes(CLIENTES, "hotel g")), [
    "Hotel Gamboa",
    "HOTEL GAMBOA RAINFOREST RESORT",
    "TROPICAL RESORTS INC - HOTEL GAMBOA RAINFOREST RESORT",
  ]);
});

test("B1 · el recorte no miente: informa el total que calzó", () => {
  const { filtrarClientes } = cargarCotState();
  const r = filtrarClientes(CLIENTES, "hotel", { limite: 3 });
  assert.equal(r.items.length, 3);
  assert.ok(r.total > 3, "total debe contar todo lo que calzó, no lo pintado");
});

test("B1 · las tres pantallas montan el combo, y teclear en él no ensucia el borrador", () => {
  const estado = leer("public", "js", "pages", "cot-editor-state.js");
  const editor = leer("public", "js", "pages", "cot-editor.js");
  const desdeOrden = leer("public", "js", "pages", "cotizar-orden.js");

  // Ningún <select> de cliente puede volver: es el que no filtra.
  for (const [nombre, src] of [["cot-editor.js", editor], ["cotizar-orden.js", desdeOrden]]) {
    assert.ok(!/id="selCliente"/.test(src), `${nombre} no debe volver al <select> nativo`);
    assert.match(src, /mountClienteCombo\('comboCliente'/, `${nombre} debe montar el combo`);
  }

  // El panel recorta con overflow:hidden; el combo tiene que destaparlo.
  assert.match(estado, /cc-panel-combo-abierto/, "el combo debe destapar el panel al abrir");
  assert.match(
    leer("public", "css", "cotizaciones-kit.css"),
    /\.cc-panel\.cc-panel-combo-abierto \{ overflow: visible; \}/,
    "falta la regla que deja salir la lista del panel",
  );

  // Teclear en el buscador es navegar, no editar: el aviso de "cambios sin
  // guardar" no puede dispararse por explorar la lista.
  assert.match(estado, /data-combo-busqueda="1"/, "el input del combo debe ser identificable");
  assert.match(editor, /dataset\?\.comboBusqueda/, "el marcador de sucio debe ignorar el buscador");
});

// Reporte del mismo día: llegó a ventas@ un correo "Nueva cotización creada …
// requiere aprobación" por COT-2026-0042 (CENTRAL AZUCARERA DE ALANJE,
// $160.50, sin descuento, vendedora). Resultó ser una COPIA de COT-2026-0035
// (ítems idénticos): Duplicar notificaba al aprobador SIEMPRE, sin consultar
// la política que sí aplica Guardar. Lo mismo con COT-2026-0022, copia de
// COT-2026-0021. Encima, el subtítulo de Nueva cotización era un texto fijo
// que afirmaba que siempre se pediría aprobación.
test("B3 · las tres puertas a borrador deciden la aprobación con la misma regla", () => {
  const estado = leer("public", "js", "pages", "cot-editor-state.js");
  const editor = leer("public", "js", "pages", "cot-editor.js");
  const detalle = leer("public", "js", "pages", "cot-detalle.js");
  const indice = leer("public", "js", "pages", "cotizaciones-index.js");

  // Nadie puede encolar la solicitud sin pasar antes por el predicado común.
  for (const [nombre, src] of [["cot-detalle.js", detalle], ["cotizaciones-index.js", indice]]) {
    const dup = src.slice(src.indexOf("async function duplicar"), src.indexOf("async function eliminar"));
    // El assert mira el predicado y su ARGUMENTO, no el formato: A10 partió la
    // expresión en dos líneas para persistir `requiere_aprobacion` antes de
    // escribir, y el regex viejo —que exigía `…policyCfg }).requiere` de una
    // sola pieza— llevaba fallando desde entonces sin que el comportamiento
    // tuviera nada malo. Lo que de verdad protege esta prueba es el orden que
    // se verifica abajo: consultar primero, notificar después.
    assert.match(dup, /requiereAprobacionPara\(\{\s*doc: copia, rol: userRol, policy: policyCfg\s*\}\)/,
      `${nombre}: duplicar debe consultar la política antes de notificar`);
    assert.match(dup, /requiere_aprobacion = pol\w*\.requiere/,
      `${nombre}: la copia debe nacer con el flag persistido`);
    assert.ok(
      dup.indexOf("requiereAprobacionPara") < dup.indexOf("enqueueAprobacionMail"),
      `${nombre}: el correo va DENTRO del if, no antes`);
  }
  assert.match(editor, /const pol = CotState\.requiereAprobacionPara\(\{ doc, rol: userRol, policy: policyCfg \}\)/,
    "Guardar debe usar el mismo predicado que Duplicar");

  // El subtítulo tampoco puede afirmar de antemano que se pedirá aprobación.
  assert.ok(
    !/'Al guardar se enviará una solicitud de aprobación a ventas@cecomunica\.com\.'/.test(editor),
    "el subtítulo no puede afirmar que siempre se pide aprobación",
  );
  assert.match(
    editor.slice(editor.indexOf("function subtituloNueva"), editor.indexOf("// ── Render principal")),
    /CotState\.requiereAprobacionPara\(/,
    "el subtítulo debe consultar la misma regla que Guardar",
  );

  assert.match(estado, /function requiereAprobacionPara/, "el predicado vive una sola vez, en CotState");
});

test("B3 · el predicado: umbral primero, rol después", () => {
  const CotState = cargarCotState();
  const dentro = { total: 160.5, descuentoPct: 0 };   // el caso COT-2026-0042
  const pol = { descuentoMaxPct: 15, totalMax: 5000 };

  // Vendedora, dentro de umbral → nadie tiene que aprobar nada.
  assert.equal(
    CotState.requiereAprobacionPara({ doc: dentro, rol: "vendedor", policy: pol }).requiere,
    false,
    "una copia de $160.50 sin descuento no puede pedir aprobación",
  );

  // Fuera de umbral por total o por descuento → sí.
  assert.equal(CotState.requiereAprobacionPara({ doc: { total: 6420, descuentoPct: 0 }, rol: "vendedor", policy: pol }).requiere, true);
  assert.equal(CotState.requiereAprobacionPara({ doc: { total: 508.6, descuentoPct: 30 }, rol: "vendedor", policy: pol }).requiere, true);

  // Dentro de umbral pero con un rol que no envía al cliente → también.
  const r = CotState.requiereAprobacionPara({ doc: dentro, rol: "recepcion", policy: pol });
  assert.equal(r.requiere, true);
  assert.match(r.motivos[0], /rol/, "y el motivo debe explicar que es por el rol");

  // El umbral por defecto que decide todo esto.
  assert.match(
    leer("public", "js", "domain", "cotizacionesTotales.js"),
    /POLICY_DEFAULT: \{ descuentoMaxPct: 15, totalMax: 5000 \}/,
  );
});

test("B2 · el selector no ofrece clientes fusionados; clientesById sí los resuelve", async () => {
  const ctx = {
    console,
    window: {},
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    firebase: { firestore: () => ({}) },
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  ctx.window.FMT = { round2: (n) => n, ITBMS_RATE: 0.07, esc: String };
  ctx.FMT = ctx.window.FMT;
  ctx.CotizacionTotales = ctx.window.CotizacionTotales;

  // El servicio devuelve el Map crudo de Firestore: incluye los borrados.
  const crudos = new Map([
    ["W249uD", { nombre: "HOTEL LATINO", ruc: "52744-50", deleted: false }],
    ["4sWHCB", { nombre: "HOTEL LATINO", ruc: "", deleted: true, merged_into: "W249uD" }],
    ["guXR9i", { nombre: "Hotel Gamboa" }], // sin el campo deleted (docs viejos)
  ]);
  ctx.ClientesService = { loadClientes: async () => crudos };
  ctx.ModelosService = { getModelos: async () => [] };
  ctx.UsuariosService = { getVendedores: async () => [] };
  ctx.EmpresaService = { getDoc: async () => null };

  vm.runInContext(leer("public", "js", "pages", "cot-editor-state.js"), ctx);
  const cat = await ctx.window.CotState.bootstrapCatalogos();

  const nombres = cat.clientes.map((c) => c.razon);
  assert.equal(nombres.filter((n) => n === "HOTEL LATINO").length, 1, "el fusionado no se ofrece");
  assert.ok(nombres.includes("Hotel Gamboa"), "sin el campo deleted = vivo");
  assert.equal(cat.clientes.length, 2);

  // Pero una cotización vieja que apunte al fusionado sigue mostrando sus datos.
  assert.equal(cat.clientesById["4sWHCB"].razon, "HOTEL LATINO");
});

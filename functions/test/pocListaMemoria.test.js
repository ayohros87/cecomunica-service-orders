// Lista de POC: ordenar no tira la memoria de la búsqueda (2026-09-25).
//
// La búsqueda de POC trae las ~4,600 fichas vivas con PocService.getAll() y
// las guarda en memoria (_allDocs) para que las teclas siguientes filtren sin
// volver a Firestore. Medido 2026-09-22→25: es el mayor consumidor que queda,
// ~36,000 lecturas/día, casi todo de recepción.
//
// ordenarPor() pasaba por refresh(), que es la ruta de las MUTACIONES y por
// eso tira la memoria. Pero filtrar() ordena EN MEMORIA (_ordenarDocs): el
// orden no cambia qué fichas hay. Cada clic en una columna estando buscando
// volvía a bajar las ~4,600 fichas.
//
//   M1 — ordenar mientras buscas NO vuelve a bajar las fichas, y el orden sí
//        cambia (se aplica en memoria).
//   M2 — refresh() —datos que cambiaron— SÍ las vuelve a bajar: una ficha
//        reabierta o cerrada tiene que verse.
//   M3 — ordenar SIN buscar pide la página ordenada al servidor, como siempre:
//        esa sí depende del orden.
//   M4 — marcar una casilla mientras buscas no vuelve a bajar las fichas.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, "public", "js", rel), "utf8");

const FICHAS = [
  { id: "f1", serial: "AB-300", unit_id_num: 300, cliente: "C", activo: true },
  { id: "f2", serial: "AB-100", unit_id_num: 100, cliente: "A", activo: true },
  { id: "f3", serial: "AB-200", unit_id_num: 200, cliente: "B", activo: true },
  { id: "f4", serial: "ZZ-999", unit_id_num: 999, cliente: "D", activo: true },   // no casa con "ab"
];

// Fichas cerradas (deleted:true) para "Incluir cerradas".
const CERRADAS = [
  { id: "c1", serial: "AB-900", unit_id_num: 900, cliente: "X", activo: false, deleted: true },
];

// conEscucha: el pocService trae escuchar() (suscripción viva). Sin él se
// simula un pocService.js VIEJO en caché, que solo tiene getAll/getCerradas.
// `subs` deja entregar snapshots a mano: (docs, delServidor) o un error.
function montar({ conEscucha = false, fichas = FICHAS } = {}) {
  const llamadas = { getAll: 0, getCerradas: 0, listPage: [], escuchar: 0 };
  const subs = [];
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id, value: "", checked: false, style: {}, innerHTML: "", children: [],
        get firstChild() { return this.children[0] || null; },
        removeChild(c) { this.children.splice(this.children.indexOf(c), 1); },
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      });
    }
    return els.get(id);
  };
  const ctxObj = {
    window: {},
    document: {
      getElementById: el, createElement: () => ({ appendChild() {}, style: {}, dataset: {}, addEventListener() {} }),
      querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    },
    console: { warn() {}, error() {}, log() {} },
    Toast: { show() {} }, Modal: { confirm: async () => true }, lucide: { createIcons() {} },
    FMT: { esc: (v) => String(v ?? "") },
    PocState: { nombreClienteDe: (d) => d.cliente || "", actualizarResumen() {}, esLectura: () => false },
    PocService: {
      getAll: async () => { llamadas.getAll++; return fichas.map(f => ({ ...f })); },
      getCerradas: async () => { llamadas.getCerradas++; return CERRADAS.map(f => ({ ...f })); },
      listPage: async (o) => { llamadas.listPage.push({ sortField: o.sortField, sortAsc: o.sortAsc }); return { docs: [], lastDoc: null }; },
      ...(conEscucha ? {
        escuchar(nombre, onDatos, onError) {
          llamadas.escuchar++;
          const s = { nombre, onDatos, onError, activa: true };
          subs.push(s);
          return () => { s.activa = false; };
        },
      } : {}),
    },
    setTimeout, clearTimeout, Promise, Map, Set, Date, JSON, Math, Array, Object, Number, String, Boolean, RegExp, Error,
  };
  // En el navegador window ES el global: poc-list.js define window.PocList y
  // luego lo usa como `PocList` a secas. Aquí igual.
  ctxObj.window = ctxObj;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(leer("pages/poc-list.js"), ctx);
  const P = ctxObj.PocList;
  // Lo que se prueba es QUÉ se carga y en QUÉ orden, no el HTML de cada fila.
  P._buildRow = (docId) => ({ docId });
  P._ofrecerCerradas = () => {};
  P.actualizarFlechitas = () => {};
  P._ESCUCHA_TOPE_MS = 60;   // el tope real es 15 s; aquí se prueba en ms
  el("filtroCampo").value = "serial";
  // Entrega un snapshot a la suscripción de `nombre`.
  const emitir = (nombre, docs, delServidor) => {
    const s = subs.filter(x => x.nombre === nombre && x.activa).pop();
    if (s) s.onDatos(docs.map(f => ({ ...f })), delServidor);
  };
  const fallar = (nombre, err) => {
    const s = subs.filter(x => x.nombre === nombre && x.activa).pop();
    if (s) s.onError(err || { code: "unavailable" });
  };
  return { P, llamadas, el, subs, emitir, fallar };
}
const esperar = () => new Promise(r => setTimeout(r, 0));
const pintado = (el) => el("devicesTable").children.map(c => c.docId);

test("M1 · ordenar mientras buscas no vuelve a bajar las fichas, y el orden cambia", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  assert.equal(llamadas.getAll, 1, "la primera búsqueda baja las fichas una vez");

  P.ordenarPor("unit_id"); await esperar();          // unit_id ascendente
  assert.equal(llamadas.getAll, 1, "ordenar NO puede volver a bajar las ~4,600 fichas");
  assert.deepEqual(pintado(el), ["f2", "f3", "f1"], "100, 200, 300: el orden se aplicó en memoria");

  P.ordenarPor("unit_id"); await esperar();          // mismo campo → descendente
  assert.equal(llamadas.getAll, 1);
  assert.deepEqual(pintado(el), ["f1", "f3", "f2"], "300, 200, 100");
});

test("M2 · refresh() —los datos cambiaron— sí vuelve a bajar las fichas", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  P.refresh(); await esperar();
  assert.equal(llamadas.getAll, 2, "una ficha reabierta o cerrada tiene que verse: la memoria se tira");
});

test("M3 · ordenar sin buscar pide la página ordenada al servidor, como siempre", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "";
  P.ordenarPor("unit_id"); await esperar();
  assert.equal(llamadas.getAll, 0, "sin búsqueda no hay barrido completo");
  const ultima = llamadas.listPage[llamadas.listPage.length - 1];
  assert.ok(ultima, "sin buscar, ordenar pide la página al servidor");
  assert.equal(ultima.sortField, "unit_id");
  assert.equal(ultima.sortAsc, true);
});

test("M4 · marcar una casilla mientras buscas no vuelve a bajar las fichas", async () => {
  const { P, llamadas, el } = montar();
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  // Segmento Todos/Activos/Inactivos (auditoría UX 2026-09-28) en vez de las
  // dos casillas excluyentes: el filtro sigue siendo en memoria.
  P.cambiarEstadoActivo("activos"); await esperar();
  assert.equal(el("soloActivos").checked, true, "el segmento prende la casilla oculta que lee la lista");
  el("soloIncompletos").checked = true;
  P.manejarCambioIncompletos(); await esperar();
  assert.equal(llamadas.getAll, 1, "las casillas filtran en memoria");
});

// ── Orden en pantalla y en papel (Brenda, 2026-10-13 y 2026-10-27) ────
// En PANTALLA la lista es cronológica: lo último registrado arriba y, dentro
// de un mismo lote (todas las fichas comparten created_at porque se graban
// en un solo batch), el Unit ID más alto primero. En PAPEL (Excel y hoja de
// imprimir) y en la columna Grupos, los radios salen por programación:
// cliente → grupo (FEPACI 1, FEPACI 2…) → Unit ID, sin grupo al final.
const ts = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000) });
const FEPACI = [
  { id: "p12", unit_id: "275706", unit_id_num: 275706, cliente: "FEPACI", activo: true, grupos: ["FEPACI 2"] },
  { id: "p03", unit_id: "275697", unit_id_num: 275697, cliente: "FEPACI", activo: true, grupos: ["FEPACI 1"] },
  { id: "p18", unit_id: "275712", unit_id_num: 275712, cliente: "FEPACI", activo: true, grupos: ["FEPACI 2"] },
  { id: "p01", unit_id: "275695", unit_id_num: 275695, cliente: "FEPACI", activo: true, grupos: ["FEPACI 1"] },
  { id: "pSG", unit_id: "275690", unit_id_num: 275690, cliente: "FEPACI", activo: true, grupos: [] },
  { id: "p11", unit_id: "275705", unit_id_num: 275705, cliente: "FEPACI", activo: true, grupos: ["FEPACI 2"] },
  { id: "otro", unit_id: "1", unit_id_num: 1, cliente: "ZETA", activo: true, grupos: ["A"] },
];
// Dos lotes de FETRATEDA: el viejo (273070–273071) y el de la renovación
// (275748–275750), como en la captura de Brenda del 2026-10-27.
const FETRATEDA = [
  { id: "v1", unit_id: "273070", unit_id_num: 273070, cliente: "FETRATEDA", activo: true, grupos: ["SEGURIDAD"], created_at: ts(1000) },
  { id: "v2", unit_id: "273071", unit_id_num: 273071, cliente: "FETRATEDA", activo: true, grupos: ["SEGURIDAD"], created_at: ts(1000) },
  { id: "n3", unit_id: "275750", unit_id_num: 275750, cliente: "FETRATEDA", activo: true, grupos: ["SEGURIDAD"], created_at: ts(5000) },
  { id: "n1", unit_id: "275748", unit_id_num: 275748, cliente: "FETRATEDA", activo: true, grupos: ["ADMIN"], created_at: ts(5000) },
  { id: "n2", unit_id: "275749", unit_id_num: 275749, cliente: "FETRATEDA", activo: true, grupos: [], created_at: ts(5000) },
  { id: "otro", unit_id: "1", unit_id_num: 1, cliente: "ZETA", activo: true, grupos: ["A"], created_at: ts(9000) },
];

test("G1 · buscar un cliente lo pinta cronológico: el lote nuevo arriba y, dentro del lote, el Unit ID más alto primero", async () => {
  const { P, el } = montar({ fichas: FETRATEDA });
  el("filtroCampo").value = "cliente";
  el("filtroValor").value = "fetrateda";
  P.filtrar(); await esperar();
  assert.deepEqual(pintado(el), ["n3", "n2", "n1", "v2", "v1"]);
});

test("G2 · ordenar por Grupos agrupa por programación y al revés invierte los grupos, pero los sin grupo siguen al final", async () => {
  const { P, el } = montar({ fichas: FEPACI });
  el("filtroCampo").value = "cliente";
  el("filtroValor").value = "fepaci";
  P.filtrar(); await esperar();
  assert.deepEqual(pintado(el), ["p18", "p12", "p11", "p03", "p01", "pSG"]);   // sin fecha: todo empata, Unit ID ↓
  P.ordenarPor("grupos"); await esperar();          // asc
  assert.deepEqual(pintado(el), ["p01", "p03", "p11", "p12", "p18", "pSG"]);
  P.ordenarPor("grupos"); await esperar();          // desc
  assert.deepEqual(pintado(el), ["p18", "p12", "p11", "p03", "p01", "pSG"]);
});

test("G3 · ordenar por Grupos sin buscar pide la página por cliente (Firestore no ordena por el array)", async () => {
  const { P, llamadas, el } = montar({ fichas: FEPACI });
  el("filtroValor").value = "";
  P.ordenarPor("grupos"); await esperar();
  const ultima = llamadas.listPage[llamadas.listPage.length - 1];
  assert.ok(ultima);
  assert.equal(ultima.sortField, "cliente");
});

test("G4 · la página del servidor (lo último primero) desempata el lote por Unit ID sin mover los lotes entre sí", () => {
  const { P } = montar({ fichas: FETRATEDA });
  // Como la trae Firestore: lote nuevo barajado por ID de documento, luego el viejo.
  const pagina = [FETRATEDA[3], FETRATEDA[2], FETRATEDA[4], FETRATEDA[1], FETRATEDA[0]];   // n1, n3, n2 | v2, v1
  assert.deepEqual([...P._ordenarPagina(pagina).map(d => d.id)], ["n3", "n2", "n1", "v2", "v1"]);
  P._direccionAsc = true;   // created_at ↑: del lote más viejo al más nuevo, Unit ID ↑
  assert.deepEqual([...P._ordenarPagina([FETRATEDA[1], FETRATEDA[0], FETRATEDA[3], FETRATEDA[2]]).map(d => d.id)], ["v1", "v2", "n1", "n3"]);
});

test("G5 · ordenar por Grupos en la página del servidor agrupa DENTRO de cada cliente sin mezclar clientes", () => {
  const { P } = montar({ fichas: FEPACI });
  P._campoOrden = "grupos"; P._direccionAsc = true;
  const pagina = [FEPACI[0], FEPACI[1], FEPACI[4], FEPACI[6]];   // p12, p03, pSG | otro
  assert.deepEqual([...P._ordenarPagina(pagina).map(d => d.id)], ["p03", "p12", "pSG", "otro"]);
});

test("G6 · el papel (Excel y hoja de imprimir) sale cliente → grupo → Unit ID, sin grupo al final", () => {
  const { P } = montar({ fichas: FETRATEDA });
  const hoja = [...FETRATEDA].sort((a, b) => P._cmpHoja(a, b)).map(d => d.id);
  assert.deepEqual(hoja, ["n1", "v1", "v2", "n3", "n2", "otro"]);
});

// ── Suscripción viva (2026-09-25) ────────────────────────────────────────
// La búsqueda mantiene los conjuntos con onSnapshot mientras la página está
// abierta. M1–M4 de arriba corren SIN escuchar() — un pocService viejo en
// caché — y por eso prueban el respaldo. Estas prueban la suscripción.
//
//   L1 — una suscripción, y las búsquedas siguientes no bajan nada.
//   L2 — un snapshot de CACHÉ incompleto NUNCA se toma como el conjunto: la
//        búsqueda espera al del servidor (si no, diría "no existe" de una
//        ficha que sí existe — el error N1).
//   L3 — lo que cambia en el servidor aparece en la siguiente búsqueda.
//   L4 — refresh() con la suscripción viva no rebaja el conjunto.
//   L5 — si la suscripción da error, cae al get de siempre.
//   L6 — si no sincroniza a tiempo, cae al get de siempre.
//   L7 — si falla DESPUÉS de haber entregado, la próxima búsqueda va al get
//        (no se queda con datos congelados para siempre).
//   L8 — el respaldo guarda 10 minutos, no 60 segundos.
//   L9 — una ficha que se cierra sale de las vivas y aparece en las cerradas.

test("L1 · una sola suscripción, y las búsquedas siguientes no bajan nada", async () => {
  const { P, llamadas, el, emitir } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  emitir("vivas", FICHAS, true); await esperar();
  assert.equal(llamadas.escuchar, 1);
  assert.deepEqual(pintado(el).sort(), ["f1", "f2", "f3"]);
  for (let i = 0; i < 5; i++) { P.filtrar(); await esperar(); }
  P.ordenarPor("unit_id"); await esperar();
  assert.equal(llamadas.escuchar, 1, "no se abre una suscripción por búsqueda");
  assert.equal(llamadas.getAll, 0, "con la suscripción viva no hay barridos por get");
});

test("L2 · un snapshot de caché incompleto nunca se toma como el conjunto", async () => {
  const { P, el, emitir } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  // Firestore entrega primero lo que tiene en IndexedDB: aquí, solo f1.
  emitir("vivas", [FICHAS[0]], false); await esperar();
  assert.deepEqual(pintado(el), [], "con solo la caché no se responde nada todavía");
  // Luego el servidor, con el conjunto real.
  emitir("vivas", FICHAS, true); await esperar();
  assert.deepEqual(pintado(el).sort(), ["f1", "f2", "f3"],
    "f2 y f3 existen: responder con la caché habría dicho que no");
});

test("L3 · lo que cambia en el servidor aparece en la siguiente búsqueda", async () => {
  const { P, llamadas, el, emitir } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  emitir("vivas", FICHAS, true); await esperar();
  // Otra persona (o un trigger) da de alta AB-400 mientras la página está abierta.
  emitir("vivas", [...FICHAS, { id: "f5", serial: "AB-400", unit_id_num: 400, cliente: "E", activo: true }], true);
  P.filtrar(); await esperar();
  assert.ok(pintado(el).includes("f5"), "la ficha nueva sale sin recargar la página");
  assert.equal(llamadas.getAll, 0, "y sin rebajar el conjunto");
});

test("L4 · refresh() con la suscripción viva no rebaja el conjunto", async () => {
  const { P, llamadas, el, emitir } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  emitir("vivas", FICHAS, true); await esperar();
  P.refresh(); await esperar();
  assert.equal(llamadas.getAll, 0, "el cambio que motivó el refresh ya llegó por la suscripción");
  assert.equal(llamadas.escuchar, 1);
});

test("L5 · si la suscripción da error, cae al get de siempre", async () => {
  const { P, llamadas, el, fallar } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  fallar("vivas", { code: "permission-denied" }); await esperar(); await esperar();
  assert.equal(llamadas.getAll, 1, "sin suscripción, la búsqueda usa el get");
  assert.deepEqual(pintado(el).sort(), ["f1", "f2", "f3"], "y encuentra lo mismo");
});

test("L6 · si no sincroniza a tiempo, cae al get de siempre", async () => {
  const { P, llamadas, el } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar();
  await new Promise(r => setTimeout(r, 120));      // pasa el tope sin snapshot del servidor
  await esperar();
  assert.equal(llamadas.getAll, 1, "sin red la búsqueda no se queda colgada");
  assert.deepEqual(pintado(el).sort(), ["f1", "f2", "f3"]);
});

test("L7 · si falla después de haber entregado, la próxima búsqueda va al get", async () => {
  const { P, llamadas, el, emitir, fallar } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  emitir("vivas", FICHAS, true); await esperar();
  fallar("vivas"); await esperar();                // la suscripción muere
  P.filtrar(); await esperar(); await esperar();
  assert.equal(llamadas.getAll, 1,
    "una suscripción caída ya no avisa: seguir con sus datos los dejaría congelados");
});

test("L8 · el respaldo guarda 10 minutos, no 60 segundos", async () => {
  const { P, llamadas, el } = montar();             // sin escuchar(): respaldo
  el("filtroValor").value = "ab";
  P.filtrar(); await esperar();
  P._allDocs.t -= 5 * 60 * 1000;                    // 5 min después
  P.filtrar(); await esperar();
  assert.equal(llamadas.getAll, 1, "a los 5 minutos el respaldo sigue sirviendo");
  P._allDocs.t -= 6 * 60 * 1000;                    // 11 min después
  P.filtrar(); await esperar();
  assert.equal(llamadas.getAll, 2, "pasados 10 minutos se vuelve a pedir");
});

test("L9 · una ficha que se cierra sale de las vivas y aparece en las cerradas", async () => {
  const { P, llamadas, el, emitir } = montar({ conEscucha: true });
  el("filtroValor").value = "ab";
  el("incluirCerradas").checked = true;
  P.filtrar(); await esperar();
  emitir("vivas", FICHAS, true);
  emitir("cerradas", CERRADAS, true); await esperar();
  assert.ok(pintado(el).includes("f2"));
  // Una devolución cierra f2 (del lado del servidor).
  const f2 = { ...FICHAS[1], deleted: true, activo: false };
  emitir("vivas", FICHAS.filter(f => f.id !== "f2"), true);
  emitir("cerradas", [...CERRADAS, f2], true);
  P.filtrar(); await esperar();
  const vistos = pintado(el);
  assert.ok(vistos.includes("f2"), "f2 sigue apareciendo, ahora entre las cerradas");
  assert.equal(vistos.filter(x => x === "f2").length, 1, "una sola vez");
  assert.equal(llamadas.getAll + llamadas.getCerradas, 0, "sin rebajar ningún conjunto");
});

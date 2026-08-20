// Deep-link `?ids=` de los correos operativos hacia la bandeja de órdenes.
//
// Tercer reporte seguido sobre lo mismo (jefa de taller, 19 y 20 de agosto):
// el correo enumera órdenes, la persona hace clic en "Ver órdenes" y ve su
// bandeja de siempre. La causa de fondo es estructural: la bandeja carga las 40
// órdenes MÁS RECIENTES por fecha_creacion, y todo lo que estos correos
// enumeran es viejo por definición (estancadas 10+ días, en cola de QC,
// esperando entrega hace días). Ninguna cabía en esa ventana.
//
// El arreglo es que el correo mande los IDs concretos y la bandeja los pida por
// nombre. Esto congela las dos mitades:
//   A — el CTA lleva los IDs, respeta el tope de filas y los codifica.
//   B — listByIds trocea en lotes de 30 (límite duro de `documentId() in [...]`
//       en Firestore), deduplica y no muestra órdenes borradas.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// ── A — idsCta, extraído del cron ─────────────────────────────────────────
// Se extrae la función sola: cargar el módulo entero registraría el scheduler.
function cargarIdsCta() {
  const mod = leer("functions", "src", "triggers", "scheduled", "recordatorioOperativo.js");
  const maxM = mod.match(/const MAX_FILAS = (\d+);/);
  assert.ok(maxM, "no se encontró MAX_FILAS en el cron");
  const ini = mod.indexOf("function idsCta(");
  const fin = mod.indexOf("\n}", ini) + 2;
  assert.ok(ini > 0, "no se encontró idsCta en el cron");
  const ctx = { console, MAX_FILAS: Number(maxM[1]), encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(mod.slice(ini, fin) + "\nglobalThis.__fn = idsCta;", ctx);
  return { idsCta: ctx.__fn, MAX_FILAS: ctx.MAX_FILAS };
}

test("A1 · el CTA lleva los IDs de las órdenes que el correo enumera", () => {
  const { idsCta } = cargarIdsCta();
  assert.equal(idsCta([{ id: "OS-1" }, { id: "OS-2" }]), "?ids=OS-1%2COS-2");
});

test("A2 · sin órdenes el CTA queda pelado (lista normal, sin filtro vacío)", () => {
  const { idsCta } = cargarIdsCta();
  assert.equal(idsCta([]), "", "un ?ids= vacío escondería TODA la bandeja");
});

test("A3 · nunca manda más IDs que filas muestra la tabla", () => {
  const { idsCta, MAX_FILAS } = cargarIdsCta();
  const muchas = Array.from({ length: MAX_FILAS + 25 }, (_, i) => ({ id: `OS-${i}` }));
  const n = decodeURIComponent(idsCta(muchas).replace("?ids=", "")).split(",").length;
  assert.equal(n, MAX_FILAS,
    "el enlace prometería órdenes que el correo ni siquiera lista");
});

test("A4 · las órdenes sin id no ensucian el enlace", () => {
  const { idsCta } = cargarIdsCta();
  assert.equal(idsCta([{ id: "OS-1" }, {}, { id: "" }, { id: "OS-2" }]), "?ids=OS-1%2COS-2");
});

// ── B — listByIds ─────────────────────────────────────────────────────────
// Firestore limita `documentId() in [...]` a 30 valores. Con 31 IDs la consulta
// lanza; sin trocear, el enlace fallaría justo cuando hay mucho atrasado.
function cargarService({ docs = {} } = {}) {
  const lotes = [];
  const col = {
    where: (_campo, _op, lote) => {
      lotes.push(lote);
      return {
        get: async () => ({
          forEach: (f) => lote
            .filter((id) => id in docs)
            .forEach((id) => f({ id, data: () => docs[id] })),
        }),
      };
    },
  };
  const ctx = {
    console, window: {},
    firebase: {
      firestore: Object.assign(() => ({ collection: () => col }), {
        FieldValue: { serverTimestamp: () => "TS", arrayUnion: (...v) => ({ __arrayUnion: v }) },
        FieldPath: { documentId: () => "__name__" },
      }),
      auth: () => ({ currentUser: { uid: "u1", email: "x@y.com" } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "ordenesService.js"), ctx);
  // El servicio se declara como `const OrdenesService` en el scope del módulo.
  const svc = vm.runInContext("OrdenesService", ctx);
  return { svc, lotes };
}

test("B1 · trocea en lotes de 30 (límite de `documentId() in`)", async () => {
  const docs = {};
  const ids = Array.from({ length: 31 }, (_, i) => `OS-${i}`);
  ids.forEach((id) => { docs[id] = { cliente_nombre: "X" }; });
  const { svc, lotes } = cargarService({ docs });

  const out = await svc.listByIds(ids);
  assert.equal(lotes.length, 2, "31 IDs tienen que salir en dos consultas");
  assert.ok(lotes.every((l) => l.length <= 30));
  assert.equal(out.length, 31, "y las 31 órdenes tienen que volver");
});

test("B2 · deduplica IDs repetidos y descarta vacíos", async () => {
  const { svc, lotes } = cargarService({ docs: { "OS-1": {} } });
  await svc.listByIds(["OS-1", "OS-1", "  ", "", "OS-1"]);
  assert.equal(lotes[0].length, 1);
});

test("B3 · una orden borrada no se muestra aunque el correo la nombrara", async () => {
  const { svc } = cargarService({
    docs: { "OS-1": { eliminado: true }, "OS-2": { cliente_nombre: "X" } },
  });
  const out = await svc.listByIds(["OS-1", "OS-2"]);
  assert.equal(out.length, 1, "el correo es una foto del día anterior");
  assert.equal(out[0].ordenId, "OS-2");
});

test("B4 · un ID inexistente no es error, simplemente no vuelve", async () => {
  const { svc } = cargarService({ docs: { "OS-2": {} } });
  const out = await svc.listByIds(["OS-1", "OS-2"]);
  assert.equal(out.length, 1);
});

test("B5 · sin IDs no se consulta nada", async () => {
  const { svc, lotes } = cargarService();
  // Por longitud y no con deepEqual: el array viene de otro realm (vm) y la
  // comparación estricta falla por identidad de prototipo aunque esté vacío.
  assert.equal((await svc.listByIds([])).length, 0);
  assert.equal((await svc.listByIds(null)).length, 0);
  assert.equal(lotes.length, 0, "ni una consulta de más");
});

test("B6 · el resultado trae ordenId, que es por donde filtra la bandeja", async () => {
  const { svc } = cargarService({ docs: { "OS-7": { cliente_nombre: "Acme" } } });
  const out = await svc.listByIds(["OS-7"]);
  assert.equal(out[0].ordenId, "OS-7");
  assert.equal(out[0].cliente_nombre, "Acme");
});

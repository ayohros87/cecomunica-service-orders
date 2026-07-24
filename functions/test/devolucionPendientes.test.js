// Guardias de la devolución de equipos (contrato de papel incluido).
//
// Tres cosas que se rompieron en producción y que este test congela:
//
//  1. CONTEO DE LA ENTRADA. La orden de inspección nace en la PRIMERA tanda
//     del check-in y las siguientes se le agregan; `observaciones` se escribía
//     una sola vez, así que 6 equipos se imprimían como "inspección de 1
//     equipo(s) devuelto(s)". Se valida que el texto se regenere con el conteo
//     real, que reconozca el formato viejo, y que NO pise notas manuales.
//
//  2. PENDIENTES POR DEVOLVER. La fórmula vive DUPLICADA a propósito (no hay
//     build step que comparta código entre navegador y functions):
//       · functions/src/lib/devolucion.js        (trigger + cron)
//       · public/js/pages/ordenes-state.js       (navegador)
//     Igual que poolNormalizacion.test.js, aquí se evalúa el archivo del
//     frontend en un sandbox y se comparan las dos sobre el mismo corpus. Si
//     tocas una, este test te obliga a tocar la otra.
//
//  3. SANEO AL IMPRIMIR. Las órdenes creadas antes del arreglo siguen con el
//     conteo viejo en Firestore; imprimir-orden.js lo corrige contra el array
//     de equipos. Se valida el sanitizador real del archivo del navegador.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Requerir los libs arrastra lib/admin, que exige una app inicializada.
// projectId dummy: nada toca la red mientras no se use Firestore.
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-devolucion" });

const { frasePiezas, obsEntradaAuto, RE_OBS_AUTO } = require("../src/lib/ordenEntrada");
const { pendientesDevolucion } = require("../src/lib/devolucion");

const RAIZ_PUBLIC = path.join(__dirname, "..", "..", "public");

// ── Sandboxes del navegador ────────────────────────────────────────────────
// ordenes-state.js declara funciones sueltas en el scope global del script y
// toca window.location al cargar; con los stubs mínimos basta.
function cargarOrdenesState() {
  const src = fs.readFileSync(path.join(RAIZ_PUBLIC, "js", "pages", "ordenes-state.js"), "utf8");
  const sandbox = {
    console,
    location: { hostname: "test", pathname: "/ordenes/index.html" },
    document: { getElementById: () => null },
  };
  vm.createContext(sandbox);
  // En el navegador `window` ES el objeto global: el archivo asigna
  // `window.APP = {...}` y después lee `APP` suelto. Apuntar window al propio
  // contexto reproduce eso; con un objeto aparte el script revienta.
  sandbox.window = sandbox;
  vm.runInContext(src, sandbox, { filename: "ordenes-state.js" });
  return sandbox;
}

// imprimir-orden.js corre a nivel de módulo (lee el DOM y arma listeners), así
// que se extrae solo el sanitizador —el regex y su función— y se evalúa suelto.
function cargarSanitizadorImpresion() {
  const src = fs.readFileSync(path.join(RAIZ_PUBLIC, "js", "pages", "imprimir-orden.js"), "utf8");
  const i = src.indexOf("const RE_INSPECCION");
  const j = src.indexOf("function renderOrden");
  assert.ok(i !== -1 && j > i, "imprimir-orden.js ya no expone RE_INSPECCION/corregirConteoInspeccion antes de renderOrden");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src.slice(i, j) + "\nglobalThis.__corregir = corregirConteoInspeccion;", sandbox, { filename: "imprimir-orden-slice.js" });
  return sandbox.__corregir;
}

// ── 1. Conteo de la ENTRADA ────────────────────────────────────────────────
test("frasePiezas usa singular/plural real, nunca 'equipo(s)'", () => {
  assert.equal(frasePiezas(1), "1 equipo devuelto");
  assert.equal(frasePiezas(6), "6 equipos devueltos");
  assert.equal(frasePiezas(0), "0 equipos devueltos");
  assert.ok(!frasePiezas(3).includes("(s)"));
});

test("el conteo de la ENTRADA sigue al array de equipos al agregar tandas", () => {
  // Réplica exacta de la reescritura de crearOAlimentarEntrada.
  const reescribir = (obs, total) =>
    RE_OBS_AUTO.test(obs)
      ? obs.replace(RE_OBS_AUTO, `Orden creada automáticamente: inspección de ${frasePiezas(total)}.`)
      : obs;

  // Tanda 1 crea la orden con 1 unidad; 5 tandas más la llevan a 6.
  const obs1 = obsEntradaAuto(1, "Devolución 2026072401 (contrato_papel)", "carpeta 2019");
  assert.match(obs1, /inspección de 1 equipo devuelto\./);
  const obs6 = reescribir(obs1, 6);
  assert.match(obs6, /inspección de 6 equipos devueltos\./);
  // El resto de la observación (motivo y contrato) sobrevive intacto.
  assert.ok(obs6.endsWith("Devolución 2026072401 (contrato_papel) — contrato carpeta 2019."));

  // Docs creados antes del arreglo, con el literal "equipo(s) devuelto(s)".
  const legacy = "Orden creada automáticamente: inspección de 1 equipo(s) devuelto(s). Anulación de contrato — contrato C-123.";
  assert.match(reescribir(legacy, 4), /inspección de 4 equipos devueltos\./);

  // Reescribir es idempotente: aplicarlo dos veces da lo mismo.
  assert.equal(reescribir(obs6, 6), obs6);
});

test("no se pisan observaciones escritas a mano", () => {
  const manual = "Cliente pasó a dejar radios. Revisar antena del 25725A0542.";
  assert.equal(RE_OBS_AUTO.test(manual), false);
  // Aunque el operador mencione una inspección, el encabezado no es el auto.
  const conTexto = "Nota: inspección de 2 equipos devueltos pendiente de agendar.";
  assert.equal(RE_OBS_AUTO.test(conTexto), false);
});

// ── 2. Pendientes por devolver ─────────────────────────────────────────────
const CORPUS = [
  ["papel: 6 de 9 recibidos (caso reportado)", { modo: "sin_contrato", total_esperado: 9, esperados: recibidos(6) }, 3],
  ["papel: 9 de 9", { modo: "sin_contrato", total_esperado: 9, esperados: recibidos(9) }, 0],
  ["papel: trajo de más (10 de 9) no da negativo", { modo: "sin_contrato", total_esperado: 9, esperados: recibidos(10) }, 0],
  ["papel: 0 recibidos", { modo: "sin_contrato", total_esperado: 4, esperados: [] }, 4],
  ["papel legacy sin total_esperado no inventa pendientes", { modo: "sin_contrato", esperados: recibidos(6) }, 0],
  ["papel: total_esperado como string", { modo: "sin_contrato", total_esperado: "9", esperados: recibidos(6) }, 3],
  ["papel: excepciones no cuentan como recibidas", { modo: "sin_contrato", total_esperado: 5, esperados: [...recibidos(2), { resolucion: "no_devuelve" }] }, 3],
  ["contrato: 2 esperados sin resolver", { esperados: [{ resolucion: "recibido" }, {}, {}] }, 2],
  ["contrato: todo resuelto", { esperados: [{ resolucion: "recibido" }, { resolucion: "no_devuelve" }] }, 0],
  ["por modelo: 5 de 8", { esperados: [], esperados_por_modelo: [{ cantidad: 8, recibidos: 5 }] }, 3],
  ["por modelo: recibidos > cantidad no da negativo", { esperados: [], esperados_por_modelo: [{ cantidad: 2, recibidos: 5 }] }, 0],
  ["mixto serial + modelo", { esperados: [{}, { resolucion: "recibido" }], esperados_por_modelo: [{ cantidad: 3, recibidos: 1 }] }, 3],
  ["confirmación (anulación) sin resolver", { modo: "confirmacion", esperados: [{}, {}] }, 2],
  ["devolucion vacía", {}, 0],
  ["devolucion undefined", undefined, 0],
];
function recibidos(n) {
  return Array.from({ length: n }, (_, i) => ({ serial: "S" + i, resolucion: "recibido" }));
}

test("pendientesDevolucion cubre serial, modelo y contrato de papel", () => {
  for (const [nombre, dev, esperado] of CORPUS) {
    assert.equal(pendientesDevolucion(dev), esperado, nombre);
  }
});

test("el navegador y el backend cuentan los pendientes igual", () => {
  const front = cargarOrdenesState();
  assert.equal(typeof front.pendientesDevolucion, "function",
    "ordenes-state.js dejó de exponer pendientesDevolucion en el scope global");
  for (const [nombre, dev, esperado] of CORPUS) {
    // El del navegador recibe la ORDEN completa; el backend, el subdocumento.
    const r = front.pendientesDevolucion(dev === undefined ? undefined : { devolucion: dev });
    assert.equal(r, esperado, `frontend — ${nombre}`);
    assert.equal(r, pendientesDevolucion(dev), `divergencia front/backend — ${nombre}`);
  }
});

// ── 3. Saneo al imprimir ───────────────────────────────────────────────────
test("la orden impresa corrige el conteo de las ENTRADAS ya creadas", () => {
  const corregir = cargarSanitizadorImpresion();
  // El caso reportado: doc con "1 equipo(s)" y 6 equipos reales en el array.
  assert.match(
    corregir("Orden creada automáticamente: inspección de 1 equipo(s) devuelto(s). Devolución 2026072301 — contrato —.", 6),
    /inspección de 6 equipos devueltos\./);
  // Baja a 1: singular correcto.
  assert.match(corregir("inspección de 4 equipos devueltos.", 1), /inspección de 1 equipo devuelto\./);
  // Sin tilde y con mayúscula inicial (variantes que existen en datos viejos).
  assert.match(corregir("Inspeccion de 1 equipo devuelto tras la baja.", 3), /Inspeccion de 3 equipos devueltos/);
  // Texto sin el patrón queda intacto; vacío/nulo no revienta.
  assert.equal(corregir("Cliente pasó a dejar radios.", 6), "Cliente pasó a dejar radios.");
  assert.equal(corregir("", 6), "");
  assert.equal(corregir(null, 6), null);
});

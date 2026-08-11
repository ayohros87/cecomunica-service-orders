// "El cliente abrió tu cotización" tiene que ser verdad.
//
// El vendedor va en CC del MISMO correo que recibe el cliente (y la supervisión
// en BCC), así que su copia trae el mismo link público. Cada apertura escribe en
// cotizacion_opens y el trigger onCotizacionOpened le manda al vendedor un
// "📬 Cotización X abierta por <cliente>" afirmando que fue el cliente. Revisar
// la propia cotización inflaba la métrica y mandaba un aviso falso: COT-2026-0040
// figura "abierta" 24 segundos después de enviarse (11-ago-2026).
//
// Corte: la sesión de Firebase. Todo interno la tiene, ningún cliente la tiene.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

test("A1 · la apertura de un interno no se registra", () => {
  const src = leer("public", "js", "pages", "verify-cotizacion.js");
  const log = src.slice(src.indexOf("async function logOpen"), src.indexOf("(async () => {"));

  assert.match(log, /if \(await esVisitaInterna\(\)\) \{ marcarVistaInterna\(\); return; \}/,
    "logOpen debe cortar ANTES de escribir en cotizacion_opens");
  // El corte va antes del add(): si se cuela debajo, el aviso ya salió.
  assert.ok(
    log.indexOf("esVisitaInterna") < log.indexOf("cotizacion_opens"),
    "la comprobación tiene que preceder a la escritura",
  );
});

test("A2 · un auth lento o caído no puede tragarse una apertura real", () => {
  const src = leer("public", "js", "pages", "verify-cotizacion.js");
  const fn = src.slice(src.indexOf("function esVisitaInterna"), src.indexOf("function marcarVistaInterna"));

  assert.match(fn, /setTimeout\(\(\) => listo\(false\), \d+\)/, "necesita timeout con default 'no interno'");
  assert.match(fn, /if \(!window\.firebase \|\| typeof firebase\.auth !== 'function'\) return resolve\(false\)/,
    "sin SDK de auth la visita cuenta como del cliente");
  assert.match(fn, /\(\) => listo\(false\)/, "un error de auth también cae a 'no interno'");
});

test("A3 · el log público sigue con las claves exactas que permiten las reglas", () => {
  const src = leer("public", "js", "pages", "verify-cotizacion.js");
  const reglas = leer("firestore.rules");
  const permitidas = reglas
    .slice(reglas.indexOf("match /cotizacion_opens"), reglas.indexOf("match /cotizacion_opens") + 400)
    .match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ""));

  const add = src.slice(src.indexOf("cotizacion_opens').add({"), src.indexOf("sessionStorage.setItem(key, '1')"));
  const escritas = [...add.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(escritas.length >= 6, "no se pudieron leer los campos del log");
  for (const campo of escritas) {
    assert.ok(permitidas.includes(campo), `el campo '${campo}' no está permitido por firestore.rules`);
  }
});

test("A4 · el aviso al vendedor sigue saliendo de un doc de cotizacion_opens", () => {
  const trigger = leer("functions", "src", "triggers", "cotizaciones", "onOpened.js");
  assert.match(trigger, /document: "cotizacion_opens\/\{logId\}"/);
  assert.match(trigger, /abierta por/, "el asunto afirma que abrió el cliente: por eso el filtro vive antes del log");
});

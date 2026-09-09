// Nota de ENTREGA PARCIAL — el papel que se lleva el cliente y su copia por
// correo (F2 del plan de entrega parcial).
//
// Lo que se protege: la nota tiene que decir las DOS cosas. Qué se llevó hoy
// —eso es obvio— y QUÉ LE FALTA, que es la pregunta con la que el cliente se
// va del mostrador. Una nota que solo liste lo entregado deja al cliente sin
// saber por qué la orden sigue abierta, y es la mitad del motivo por el que
// esta función existe.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  emailNotaTanda, numeroDeTanda, pendientesTrasTanda, LEYENDA_TANDA,
} = require("../src/lib/notaTandaEntrega");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const eq = (id, serial, modelo = "NX-420-R") => ({
  id, numero_de_serie: serial, serial, modelo, eliminado: false,
});
const tanda = (n, ...ids) => ({
  n, numero: `2026090812-E${n}`,
  fecha: new Date("2026-09-09T15:30:00Z"),
  receptor_nombre: "Luis Pérez", receptor_cedula: "8-888-8888",
  firma_url: "https://f/firma.png",
  equipos: ids.map(i => ({ id: i, serial: "S" + i, modelo: "NX-420-R" })),
});
const orden = (...tandas) => ({
  cliente_nombre: "ACME, S.A.",
  equipos: [eq("1", "S1"), eq("2", "S2"), eq("3", "S3"), eq("4", "S4")],
  entrega: { tandas },
});

test("numeroDeTanda respeta el número guardado y sabe derivarlo", () => {
  assert.equal(numeroDeTanda("O1", [], { numero: "O1-E7" }), "O1-E7");
  assert.equal(numeroDeTanda("O1", [], { n: 3 }), "O1-E3");
  const t = {};
  assert.equal(numeroDeTanda("O1", [t], t), "O1-E1");
});

test("pendientesTrasTanda cuenta lo que queda DESPUÉS de esa tanda", () => {
  const t1 = tanda(1, "1");
  const t2 = tanda(2, "2");
  const o = orden(t1, t2);
  // En la nota de la PRIMERA tanda faltan 3 (la segunda aún no ocurrió).
  assert.deepEqual(pendientesTrasTanda(o, t1).map(e => e.id), ["2", "3", "4"]);
  // En la de la segunda, 2.
  assert.deepEqual(pendientesTrasTanda(o, t2).map(e => e.id), ["3", "4"]);
});

test("una tanda vieja no muestra como pendiente lo que ya se había llevado", () => {
  // El caso que rompe una implementación ingenua: reimprimir la nota E1 seis
  // meses después no puede decir que falta lo que salió en E2 — el papel
  // tiene que seguir diciendo lo que decía el día que se firmó.
  const t1 = tanda(1, "1");
  const o = orden(t1, tanda(2, "2"), tanda(3, "3"));
  const ids = pendientesTrasTanda(o, t1).map(e => e.id);
  assert.deepEqual(ids, ["2", "3", "4"]);
});

test("el correo dice lo que se llevó Y lo que queda", () => {
  const t = tanda(1, "1", "2");
  const o = orden(t);
  const m = emailNotaTanda("2026090812", o, t);

  assert.match(m.subject, /Nota de entrega 2026090812-E1/);
  assert.match(m.subject, /orden 2026090812/);
  assert.match(m.bodyContent, /S1/);
  assert.match(m.bodyContent, /S2/);
  assert.match(m.bodyContent, /Queda[n]? en el taller \(2\)/);
  assert.match(m.bodyContent, /S3/);
  assert.match(m.bodyContent, /S4/);
  assert.match(m.bodyContent, /Luis Pérez/);
  assert.match(m.bodyContent, /ACME/);
  assert.ok(m.bodyContent.includes(LEYENDA_TANDA.slice(0, 40)), "falta la leyenda");
  assert.match(m.preheader, /2 equipo\(s\) retirados · 2 quedan en el taller/);
});

test("cuando no queda nada, la nota lo dice en vez de callarse", () => {
  const t = tanda(1, "1", "2", "3", "4");
  const m = emailNotaTanda("2026090812", orden(t), t);
  assert.match(m.bodyContent, /no queda ningún equipo pendiente/i);
  assert.doesNotMatch(m.bodyContent, /Queda[n]? en el taller/);
});

test("escapa el HTML de los datos del cliente", () => {
  const t = tanda(1, "1");
  t.receptor_nombre = '<script>alert(1)</script>';
  const o = orden(t);
  o.cliente_nombre = 'ACME & <b>Cía</b>';
  const m = emailNotaTanda("O1", o, t);
  assert.doesNotMatch(m.bodyContent, /<script>/);
  assert.match(m.bodyContent, /&lt;script&gt;/);
  assert.match(m.bodyContent, /ACME &amp; &lt;b&gt;/);
});

test("sin firma no inventa un bloque de firma vacío", () => {
  const t = tanda(1, "1");
  delete t.firma_url;
  const m = emailNotaTanda("O1", orden(t), t);
  assert.doesNotMatch(m.bodyContent, /<img/);
});

test("el correo y el documento imprimible dicen la MISMA leyenda", () => {
  // Son dos plantillas a propósito (el correo necesita estilos inline), pero
  // el cliente no puede recibir dos textos distintos de lo mismo.
  const front = leer("public", "js", "pages", "ordenes-entrega-parcial.js");
  const frase = "Los equipos que aún no se retiran permanecen en nuestro taller";
  assert.ok(LEYENDA_TANDA.includes(frase), "cambió la leyenda del correo");
  assert.ok(front.includes(frase), "el documento imprimible quedó con otra leyenda");
});

test("el envío se reclama antes de encolar (nada de correos duplicados)", () => {
  const src = leer("functions", "src", "triggers", "ordenes", "onOrdenEntregada.js");
  const fn = src.slice(src.indexOf("async function procesarEnviosTandas"));
  assert.match(fn, /runTransaction/, "el reclamo tiene que ser transaccional");
  // El reclamo va ANTES del set() de mail_queue: al revés, dos instancias
  // procesando la misma escritura mandan el correo dos veces.
  assert.ok(fn.indexOf("runTransaction") < fn.indexOf("mailRef.set"),
    "se encola antes de reclamar");
  assert.match(fn, /status !== "solicitado"\) return null/,
    "solo se reclama lo que está en 'solicitado'");
  assert.match(fn, /source: "entrega-parcial"/);
});

test("los envíos de tandas corren ANTES del corte de ENTREGADO", () => {
  // Una tanda ocurre con la orden en COMPLETADO. Si el envío se procesara
  // después del `return null` que filtra la transición a ENTREGADO, el correo
  // no saldría jamás — y el fallo sería silencioso.
  const src = leer("functions", "src", "triggers", "ordenes", "onOrdenEntregada.js");
  const cuerpo = src.slice(src.indexOf("async (event) =>"));
  assert.ok(cuerpo.indexOf("procesarEnviosTandas(event.params.ordenId") <
    cuerpo.indexOf("!== ENTREGADO"), "el envío quedó detrás del corte de ENTREGADO");
});

test("onMailQueued espeja el resultado real en la tanda", () => {
  const src = leer("functions", "src", "triggers", "mail", "onMailQueued.js");
  assert.match(src, /async function mirrorNotaTanda/);
  assert.match(src, /meta\.source !== "entrega-parcial"/);
  // Se llama en los DOS desenlaces: si solo se espejara el éxito, una tanda
  // cuyo correo falló se quedaría en "Enviando…" para siempre.
  assert.equal((src.match(/await mirrorNotaTanda\(/g) || []).length, 2);
  assert.match(src, /!== "encolado"\) return/,
    "un reenvío posterior no puede quedar pisado por un correo viejo");
});

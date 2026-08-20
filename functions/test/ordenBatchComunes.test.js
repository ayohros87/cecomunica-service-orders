// Órdenes · Nuevo batch de equipos (public/js/pages/ordenes-nuevo-batch.js).
//
// Dos observaciones de recepción (ago-2026), ambas sobre el mismo flujo — crear
// la orden desde el panel de "órdenes por crear" y cargarle los equipos:
//
//  1. La orden nacía y aterrizaba en la captura manual (un serial por vez), aun
//     teniendo contrato vinculado con los seriales ya decididos. Ahora la orden
//     de PROGRAMACIÓN aterriza aquí con ?jalar=contrato y la tabla se llena sola.
//  2. "Aplicar a todas las filas" solo escribía la observación en filas vacías:
//     corregir la descripción obligaba a borrarla fila por fila. Ahora se
//     reescribe lo que puso la propia herramienta y se respeta lo tecleado.
//
// Se corre el archivo real en un sandbox con un DOM mínimo (mismo enfoque que
// nuevoBatchContrato.test.js: sin navegador ni red). El DOM falso parsea el
// markup real de la fila, así que si cambian las clases del template el test lo
// nota. Corre con `npm test` (node --test).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "pages", "ordenes-nuevo-batch.js"), "utf8");

// ── DOM mínimo ────────────────────────────────────────────────────────────
class FakeEl {
  constructor(classes = [], id = "") {
    this.id = id;
    this._classes = new Set(classes);
    this.dataset = {};
    this.style = {};
    this.value = "";
    this.checked = false;
    this.textContent = "";
    this._html = "";
    this.title = "";
    this.disabled = false;
    this._kids = [];
    this._handlers = {};
    this.classList = {
      contains: (c) => this._classes.has(c),
      add: (...c) => c.forEach(x => this._classes.add(x)),
      remove: (...c) => c.forEach(x => this._classes.delete(x)),
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  set innerHTML(html) { this._html = html; this._kids = parseControles(html); }
  get innerHTML() { return this._html; }
  addEventListener(ev, fn) { (this._handlers[ev] ||= []).push(fn); }
  dispatch(ev, e) { (this._handlers[ev] || []).forEach(fn => fn(e)); }
  appendChild(el) { this._kids.push(el); return el; }
  // Selector simple: basta con la última clase del selector (".serie",
  // ".batch-num .num"), que es todo lo que usa la página.
  querySelector(sel) {
    const cls = sel.trim().split(/\s+/).pop().replace(/^\./, "");
    return this._kids.find(k => k._classes.has(cls)) || null;
  }
  querySelectorAll(sel) {
    const cls = sel.trim().split(/\s+/).pop().replace(/^\./, "");
    return this._kids.filter(k => k._classes.has(cls));
  }
  focus() {}
  remove() {}
  closest() { return null; }
}

// Convierte el markup de la fila en elementos consultables por clase.
function parseControles(html) {
  const els = [];
  let resto = String(html);

  resto = resto.replace(/<select class="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g, (_m, cls, inner) => {
    const el = new FakeEl(cls.split(/\s+/).filter(Boolean));
    const sel = inner.match(/<option value="([^"]*)"\s+selected>/);
    el.value = sel ? sel[1] : "";
    els.push(el);
    return "";
  });

  for (const m of resto.matchAll(/<input([^>]*)>/g)) {
    const attrs = m[1];
    const cls = (attrs.match(/class="([^"]*)"/) || [, ""])[1];
    const el = new FakeEl(cls.split(/\s+/).filter(Boolean));
    el.value = (attrs.match(/value="([^"]*)"/) || [, ""])[1];
    el.checked = /\schecked(\s|$|>)/.test(attrs);
    els.push(el);
  }

  for (const m of resto.matchAll(/<(?:td|span|button|div|label)([^>]*)>/g)) {
    const cls = (m[1].match(/class="([^"]*)"/) || [, ""])[1];
    if (cls) els.push(new FakeEl(cls.split(/\s+/).filter(Boolean)));
  }
  return els;
}

// ── Datos de prueba ───────────────────────────────────────────────────────
const MODELOS = [
  { id: "mPD606", modelo: "PD606-R" },
  { id: "mPD686", modelo: "PD686-R" },
];

// Contrato de la observación de recepción: 2 seriales PD606-R listos.
const SERIALES_CONTRATO = [
  { serial: "18607A0481", modelo_id: "mPD606", modelo: "PD606-R" },
  { serial: "18607A0496", modelo_id: "mPD606", modelo: "PD606-R" },
];

function montar({ search = "?orden_id=2026081801", seriales = SERIALES_CONTRATO,
  contratoAplica = true } = {}) {
  const els = new Map();
  const filas = [];
  const get = (id) => {
    if (!els.has(id)) els.set(id, new FakeEl([], id));
    return els.get(id);
  };
  const filasBatch = get("filasBatch");
  filasBatch.appendChild = (tr) => { filas.push(tr); return tr; };

  const toasts = [];
  const doc = {
    getElementById: get,
    createElement: () => new FakeEl(),
    querySelectorAll: (sel) => (sel === "#filasBatch tr" ? filas : []),
    querySelector: () => null,
    addEventListener: () => {},
    body: new FakeEl(),
  };

  const sandbox = {
    console,
    document: doc,
    location: { search },
    URLSearchParams,
    Map, Set, Array, Object, Number, String, Boolean, JSON, RegExp, Promise,
    crypto: { randomUUID: () => "uuid" },
    Toast: { show: (msg, tipo) => toasts.push({ msg, tipo }) },
    ModelosService: { getModelos: async () => MODELOS },
    ClientesService: { getCliente: async () => ({ nombre: "FEDERACION PANAMEÑA DE CICLISMO" }) },
    OrdenesService: {
      getOrder: async () => ({
        cliente_id: "CLI1",
        tipo_de_servicio: "PROGRAMACIÓN",
        contrato: contratoAplica
          ? { aplica: true, contrato_doc_id: "docALQ", contrato_id: "ALQ20260812-01" }
          : { aplica: false },
        equipos: [],
      }),
      updateOrder: async () => {},
    },
    ContratosService: {
      _serialKey: (s) => String(s || "").trim().toUpperCase(),
      getSerialesManual: async () => seriales,
      getModeloPorSerial: async () => new Map(
        seriales.map(s => [s.serial.toUpperCase(), s])),
    },
    firebase: { auth: () => ({ onAuthStateChanged: () => {} }) },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC, sandbox, { filename: "ordenes-nuevo-batch.js" });
  return { sandbox, el: get, filas, toasts, filasBatch };
}

const obsDe = (h) => h.filas.map(tr => tr.querySelector(".observaciones").value);

// Escribir a mano en la observación de una fila (dispara el listener del body).
function tecleaObservacion(h, i, texto) {
  const input = h.filas[i].querySelector(".observaciones");
  input.value = texto;
  h.filasBatch.dispatch("input", { target: input });
}

function ponerComunes(h, obs) {
  h.el("comunObs").value = obs;
}

// ── Aplicar a todas las filas: la observación ─────────────────────────────
test("la observación común corregida se re-aplica a las filas que la traían", async () => {
  const h = montar();
  await h.sandbox.init();

  ponerComunes(h, "PROP20260818-01: ADICIÓN");
  h.el("pegarSeriales").value = "18607A0481\n18607A0496";
  h.sandbox.agregarDesdePegado();
  assert.deepEqual(obsDe(h), ["PROP20260818-01: ADICIÓN", "PROP20260818-01: ADICIÓN"]);

  // Recepción corrige el texto y vuelve a aplicar: antes había que borrar la
  // observación de cada fila para que entrara la nueva.
  ponerComunes(h, "ADICIÓN: PROP20260818-01");
  h.sandbox.aplicarComunes();

  assert.deepEqual(obsDe(h), ["ADICIÓN: PROP20260818-01", "ADICIÓN: PROP20260818-01"]);
  assert.ok(h.toasts.some(t => /2 observación\(es\) actualizada\(s\)/.test(t.msg)),
    "el cambio en masa tiene que ser visible");
});

test("una observación escrita a mano no se pisa al re-aplicar", async () => {
  const h = montar();
  await h.sandbox.init();

  ponerComunes(h, "PROP20260818-01: ADICIÓN");
  h.el("pegarSeriales").value = "18607A0481\n18607A0496";
  h.sandbox.agregarDesdePegado();
  tecleaObservacion(h, 1, "PANTALLA RAYADA");

  ponerComunes(h, "ADICIÓN: PROP20260818-01");
  h.sandbox.aplicarComunes();

  assert.deepEqual(obsDe(h), ["ADICIÓN: PROP20260818-01", "PANTALLA RAYADA"],
    "lo tecleado en la fila manda sobre el valor común");
  assert.ok(h.toasts.some(t => /1 con observación propia sin tocar/.test(t.msg)));
});

test("vaciar la observación común no borra en masa las ya puestas", async () => {
  const h = montar();
  await h.sandbox.init();

  ponerComunes(h, "PROP20260818-01: ADICIÓN");
  h.el("pegarSeriales").value = "18607A0481";
  h.sandbox.agregarDesdePegado();

  ponerComunes(h, "");
  h.sandbox.aplicarComunes();

  assert.deepEqual(obsDe(h), ["PROP20260818-01: ADICIÓN"],
    "borrar el campo común no puede vaciar las filas de golpe");
});

test("la observación llega también a las filas jaladas del contrato (que van vacías)", async () => {
  const h = montar();
  await h.sandbox.init();          // ?jalar=contrato NO está en el search por defecto
  await h.sandbox.jalarSerialesDesdeContrato();
  assert.deepEqual(obsDe(h), ["", ""], "precondición: el contrato no trae observaciones");

  ponerComunes(h, "ENTREGA EN SITIO");
  h.sandbox.aplicarComunes();
  ponerComunes(h, "ENTREGA EN OFICINA");
  h.sandbox.aplicarComunes();

  assert.deepEqual(obsDe(h), ["ENTREGA EN OFICINA", "ENTREGA EN OFICINA"],
    "una vez puestas por la herramienta, se pueden corregir");
});

// ── Jalado automático al aterrizar desde "Guardar orden" ──────────────────
test("?jalar=contrato llena la tabla sola con los seriales del contrato", async () => {
  const h = montar({ search: "?orden_id=2026081801&jalar=contrato" });

  await h.sandbox.init();

  assert.equal(h.filas.length, 2, "los 2 seriales del contrato entran sin teclear nada");
  assert.deepEqual(h.filas.map(tr => tr.querySelector(".serie").value),
    ["18607A0481", "18607A0496"]);
  assert.deepEqual(h.filas.map(tr => tr.querySelector(".modelo").value),
    ["mPD606", "mPD606"], "el modelo lo pone el contrato, no la mano");
  assert.ok(h.toasts.some(t => /revisa y guarda/.test(t.msg)),
    "el jalado automático debe anunciarse: nadie lo pidió con un click");
});

test("sin el parámetro no se jala nada (la carga manual sigue igual)", async () => {
  const h = montar();

  await h.sandbox.init();

  assert.equal(h.filas.length, 0);
});

test("contrato sin seriales asignados: avisa y deja capturar a mano", async () => {
  const h = montar({ search: "?orden_id=2026081801&jalar=contrato", seriales: [] });

  await h.sandbox.init();

  assert.equal(h.filas.length, 0);
  assert.ok(h.toasts.some(t => /captura los equipos aquí/.test(t.msg)),
    "el aviso automático orienta, no regaña");
});

test("orden sin contrato vinculado: el jalado automático no se dispara", async () => {
  const h = montar({ search: "?orden_id=2026081801&jalar=contrato", contratoAplica: false });

  await h.sandbox.init();

  assert.equal(h.filas.length, 0);
  assert.ok(!h.toasts.some(t => /contrato vinculado/.test(t.msg)),
    "no puede quejarse de algo que la propia URL pidió por defecto");
});

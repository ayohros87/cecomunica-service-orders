// El batch de POC no se tranca cuando el radio arrastra una ficha vieja
// (public/js/pages/nuevo-batch.js).
//
// Municipio de Arraiján, 9-sep-2026: 20 radios de un evento vuelven, se
// re-programan y el lote NUEVO trae otros Unit ID y otros SIM. La ficha del
// registro anterior nunca se cerró, así que el serial seguía figurando "con el
// cliente" y el guardado se paraba en seco: "borra o edita el equipo
// existente", una por una desde POC. El vendedor quedaba trancado.
//
// Lo que se exige aquí:
//   · se puede continuar (una confirmación, no un hard-stop);
//   · el lote se crea NUEVO — nada se actualiza en sitio;
//   · las fichas viejas quedan CERRADAS en el mismo guardado, para que el radio
//     no quede con dos registros abiertos en la plataforma;
//   · el SIM viejo pasa por el módulo de liberación (que respeta el pool si ese
//     SIM ya se reasignó a otro radio);
//   · el Unit ID de una ficha que se cierra no cuenta como choque;
//   · cancelar no crea ni cierra nada.
//
// Corre el archivo real en un sandbox con un DOM mínimo, sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(path.join(RAIZ, "public", "js", "pages", "nuevo-batch.js"), "utf8");
const SRC_SERIAL = fs.readFileSync(path.join(RAIZ, "public", "js", "core", "serial.js"), "utf8");
const SRC_CONSOLAS = fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "consolasContrato.js"), "utf8");

class FakeOption {
  constructor(value, text) { this.value = value; this.textContent = text; this.dataset = {}; }
  getAttribute() { return null; }
}

class FakeSelect {
  constructor(id) { this.id = id; this._value = ""; this.dataset = {}; this.options = []; this._html = ""; }
  set innerHTML(html) {
    this._html = html;
    this.options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)]
      .map(m => new FakeOption(m[1], m[2]));
    this._value = this.options.length ? this.options[0].value : "";
  }
  get innerHTML() { return this._html; }
  set value(v) { this._value = this.options.some(o => o.value === v) ? v : ""; }
  get value() { return this._value; }
  get selectedOptions() { const o = this.options.find(x => x.value === this._value); return o ? [o] : []; }
  appendChild(opt) { this.options.push(opt); return opt; }
  addEventListener() {}
}

class FakeEl {
  constructor(id) {
    this.id = id; this.innerHTML = ""; this.value = ""; this.textContent = "";
    this.hidden = true; this.style = {}; this.disabled = false; this.handlers = {};
    this.dataset = {};
  }
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  closest() { return null; }
}

// Timestamp de Firestore, lo justo para ordenar y para imprimir la fecha.
const ts = (iso) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });

// Las dos fichas del evento anterior de Arraiján: inactivas, sin contrato, con
// el SIM de entonces (el que probablemente ya se reasignó o se canceló).
const FICHAS_VIEJAS = [
  { id: "devViejo1", serial: "21814A0123", unit_id: "273826", unit_id_num: 273826, ip: "gob.cecomunica.net",
    cliente_id: "CLI1", cliente_nombre: "MUNICIPIO DE ARRAIJAN", activo: false, deleted: false,
    sim_number: "8950702902411531805", grupos: ["MUNICIPIO ARRAIJAN"], created_at: ts("2025-09-08T15:00:00Z") },
  { id: "devViejo2", serial: "21N18A0318", unit_id: "273816", unit_id_num: 273816, ip: "gob.cecomunica.net",
    cliente_id: "CLI1", cliente_nombre: "MUNICIPIO DE ARRAIJAN", activo: false, deleted: false,
    sim_number: "8950702902411531904", grupos: ["MUNICIPIO ARRAIJAN"], created_at: ts("2025-09-08T15:00:00Z") },
];

function montar({ existentes = FICHAS_VIEJAS, confirmar = () => true } = {}) {
  const els = new Map();
  const selects = new Set(["cliente", "ip", "contratoJalar"]);
  const get = (id) => {
    if (!els.has(id)) els.set(id, selects.has(id) ? new FakeSelect(id) : new FakeEl(id));
    return els.get(id);
  };
  ["cliente", "ip", "contratoJalar", "seriales", "unit_id_inicial", "notas", "previewContrato",
    "previewVendedor", "avisoSinContrato", "avisoSinContratoExtra", "btnJalarContrato",
    "filtroModelos", "avisoConsolas", "ipSinInfo", "ultimosUnitIDs", "addCliente", "addIP",
    "vendorJson", "batchForm"].forEach(get);
  get("cliente").innerHTML = '<option value="CLI1">MUNICIPIO DE ARRAIJAN</option>';

  const registro = { creados: [], cerrados: [], logs: [], simLiberar: [], modales: [], toasts: [] };
  const doc = {
    _dcl: null,
    getElementById: get,
    addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") doc._dcl = fn; },
    querySelector: () => null,
    createElement: () => new FakeEl("tmp"),
  };

  const sandbox = {
    console: { ...console, warn: () => {}, error: () => {} },
    document: doc,
    Option: class { constructor(v, t) { this.value = v; this.textContent = t ?? v; this.dataset = {}; } },
    Toast: { show: (msg, tipo) => registro.toasts.push({ msg, tipo }) },
    Modal: {
      confirm: async (opts) => { registro.modales.push(opts); return confirmar(opts); },
      prompt: async () => null,
    },
    FMT: { normalize: (s) => String(s || "").trim().toLowerCase(), normalizeGrupo: (s) => s, dedupGrupos: (a) => a, esc: (s) => s },
    ModelosService: { getModelos: async () => [{ id: "mPNC370", marca: "HYTERA", modelo: "PNC370-R" }] },
    ClientesService: {
      listClientes: async () => ({ docs: [{ id: "CLI1", nombre: "MUNICIPIO DE ARRAIJAN", ip: "gob.cecomunica.net" }] }),
      existsByNorm: async () => true,
      updateCliente: async () => {},
    },
    EmpresaService: { getDoc: async () => ({ list: ["gob.cecomunica.net"] }) },
    ContratosService: {
      _serialKey: (s) => String(s || "").trim().toUpperCase(),
      getContratosActivosPorCliente: async () => [],
      getModeloPorSerial: async () => new Map(),
    },
    PocService: {
      getCatalogoGrupos: async () => [],
      getRecent: async () => [],
      getByCliente: async () => existentes,
      addPocDevice: async (data) => { registro.creados.push(data); },
      softDeletePocDevice: async (id, opts) => { registro.cerrados.push({ id, ...opts }); },
      addLog: async (entrada) => { registro.logs.push(entrada); },
      stripSentinels: (o) => o,
    },
    SimLiberar: { procesarDesactivados: async (cambios) => { registro.simLiberar.push(...cambios); return new Set(); } },
    firebase: {
      auth: () => ({
        // El arranque real vive dentro de este callback: se guarda su promesa
        // para que la prueba espere a que la página termine de cargar.
        onAuthStateChanged: (fn) => { registro.init = fn({ uid: "uBrenda", email: "cecrecep@cecomunica.com" }); },
        currentUser: { uid: "uBrenda", email: "cecrecep@cecomunica.com" },
      }),
      firestore: Object.assign(() => ({
        collection: (nombre) => ({
          // Duplicados: poc_devices.where('serial','in',[…])
          where: () => ({
            get: async () => ({ forEach: (fn) => (nombre === "poc_devices" ? existentes : [])
              .forEach(d => fn({ id: d.id, data: () => d })) }),
            limit: () => ({ get: async () => ({ docs: [] }) }),
          }),
          // proponerProximoUnitId
          orderBy: () => ({ limit: () => ({ get: async () => ({ forEach: () => {} }) }) }),
        }),
      }), { FieldValue: { serverTimestamp: () => "TS" } }),
    },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC_SERIAL, sandbox, { filename: "serial.js" });
  vm.runInContext(SRC_CONSOLAS, sandbox, { filename: "consolasContrato.js" });
  vm.runInContext(SRC, sandbox, { filename: "nuevo-batch.js" });
  return { sandbox, el: get, doc, registro };
}

// Arranca la página (DOMContentLoaded → onAuthStateChanged) y deja el
// formulario como lo tiene recepción: cliente, seriales y Unit ID inicial.
async function conFormularioLleno(h, { seriales, unitIdInicial }) {
  await h.doc._dcl();
  await h.registro.init;
  h.el("cliente").value = "CLI1";
  h.el("ip").value = "gob.cecomunica.net";
  h.el("seriales").value = seriales.join("\n");
  h.el("unit_id_inicial").value = String(unitIdInicial);
}

const guardar = (h) => h.el("batchForm").handlers.submit({ preventDefault() {} });

test("un radio con ficha vieja del mismo cliente ya no tranca el lote", async () => {
  const h = montar();
  await conFormularioLleno(h, { seriales: ["21814A0123", "21N18A0318"], unitIdInicial: 274600 });

  await guardar(h);

  assert.equal(h.registro.creados.length, 2, "el lote nuevo se crea completo");
  assert.deepEqual(h.registro.creados.map(d => d.unit_id), ["274600", "274601"],
    "con los Unit ID del lote nuevo, no los de la ficha vieja");
  assert.ok(!h.registro.toasts.some(t => /ya existen en POC/i.test(t.msg)),
    "el hard-stop ya no existe");
});

test("las fichas viejas quedan cerradas en el mismo guardado", async () => {
  const h = montar();
  await conFormularioLleno(h, { seriales: ["21814A0123", "21N18A0318"], unitIdInicial: 274600 });

  await guardar(h);

  assert.deepEqual(h.registro.cerrados.map(c => c.id).sort(), ["devViejo1", "devViejo2"]);
  assert.equal(h.registro.cerrados[0].origen, "nuevo-batch", "el cierre deja rastro de quién lo hizo");
  assert.equal(h.registro.simLiberar.length, 2,
    "el SIM viejo pasa por la liberación (que respeta el pool si ya se reasignó)");
});

test("el Unit ID de una ficha que se cierra no cuenta como choque", async () => {
  const h = montar();
  // El lote nuevo arranca justo en el Unit ID que ocupa la ficha vieja.
  await conFormularioLleno(h, { seriales: ["21814A0123"], unitIdInicial: 273826 });

  await guardar(h);

  assert.ok(!h.registro.toasts.some(t => /Unit ID ya están en uso/i.test(t.msg)),
    "ese Unit ID se libera en el mismo guardado");
  assert.equal(h.registro.creados.length, 1);
});

test("cancelar el aviso no crea ni cierra nada", async () => {
  const h = montar({ confirmar: (o) => !/ficha abierta/i.test(o.title || "") });
  await conFormularioLleno(h, { seriales: ["21814A0123"], unitIdInicial: 274600 });

  await guardar(h);

  assert.equal(h.registro.creados.length, 0);
  assert.equal(h.registro.cerrados.length, 0);
});

test("el aviso dice qué se cierra: SIM, Unit ID y si la ficha sigue activa", async () => {
  const h = montar({
    existentes: [{ ...FICHAS_VIEJAS[0], activo: true }],
  });
  await conFormularioLleno(h, { seriales: ["21814A0123"], unitIdInicial: 274600 });

  await guardar(h);

  const aviso = h.registro.modales.find(m => /ficha abierta/i.test(m.title || ""));
  assert.ok(aviso, "tiene que haber un aviso antes de cerrar nada");
  assert.match(aviso.message, /273826/, "el Unit ID de la ficha vieja");
  assert.match(aviso.message, /8950702902411531805/, "el SIM que arrastra");
  assert.match(aviso.message, /ACTIVA/, "y que esa ficha sigue activa en la plataforma");
  assert.match(aviso.confirmLabel, /cerrar/i);
});

test("un serial sin ficha previa no dispara ningún aviso", async () => {
  const h = montar({ existentes: [] });
  await conFormularioLleno(h, { seriales: ["25D10A9999"], unitIdInicial: 274600 });

  await guardar(h);

  assert.equal(h.registro.creados.length, 1);
  assert.equal(h.registro.cerrados.length, 0);
  assert.ok(!h.registro.modales.some(m => /ficha abierta/i.test(m.title || "")));
});

// ── Fichas de OTROS clientes ───────────────────────────────────────────────
// Nunca trancaron el lote (solo avisaban), pero el aviso mandaba a borrarlas a
// mano en POC y nadie lo hacía: al 2026-09-09 había 817 seriales vivos en dos
// o tres cuentas a la vez. Ahora se pueden cerrar sin salir del lote — y sin
// obligar: un serial mal tecleado cae en la misma lista.
const FICHA_AJENA = {
  id: "devBalboa", serial: "21814A0123", unit_id: "274089", ip: "main.cecomunica.net",
  cliente_id: "CLI9", cliente_nombre: "BALBOA LOGISTICS", activo: false, deleted: false,
  sim_number: "8950702902411381722", created_at: ts("2025-11-11T15:00:00Z"),
};

// Igual que `montar`, pero con Modal.sheet (los 3 botones del aviso).
function montarConSheet(opts, accion) {
  const h = montar(opts);
  h.sandbox.Modal.sheet = async (o) => { h.registro.modales.push(o); return accion; };
  return h;
}

test("las fichas de otros clientes se pueden cerrar desde el mismo lote", async () => {
  const h = montarConSheet({ existentes: [FICHA_AJENA] }, "cerrar");
  await conFormularioLleno(h, { seriales: ["21814A0123"], unitIdInicial: 274600 });

  await guardar(h);

  assert.equal(h.registro.creados.length, 1, "el lote entra");
  assert.deepEqual(h.registro.cerrados.map(c => c.id), ["devBalboa"],
    "y la ficha del cliente anterior queda cerrada");
});

test("«crear sin tocarlas» crea el lote y no cierra nada", async () => {
  const h = montarConSheet({ existentes: [FICHA_AJENA] }, "seguir");
  await conFormularioLleno(h, { seriales: ["21814A0123"], unitIdInicial: 274600 });

  await guardar(h);

  assert.equal(h.registro.creados.length, 1);
  assert.equal(h.registro.cerrados.length, 0, "quien no está seguro no borra nada");
});

test("cancelar en el aviso de otro cliente no crea el lote", async () => {
  const h = montarConSheet({ existentes: [FICHA_AJENA] }, "cancelar");
  await conFormularioLleno(h, { seriales: ["21814A0123"], unitIdInicial: 274600 });

  await guardar(h);

  assert.equal(h.registro.creados.length, 0);
  assert.equal(h.registro.cerrados.length, 0);
});

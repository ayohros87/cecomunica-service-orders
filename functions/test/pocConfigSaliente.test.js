// Un reemplazo se registra en POC sin subir ningún archivo.
//
// El radio nuevo hereda el NOMBRE, los GRUPOS y el GPS del radio al que
// sustituye. Ese dato ya está escrito —en la ficha POC del saliente, que es
// justo lo que la OS de programación le manda copiar al técnico— y sin embargo
// alguien tenía que armar un JSON a mano para volver a teclearlo.
//
// Lo que se exige aquí:
//   · PocService.configDelSaliente encuentra la ficha del saliente aunque el
//     serial venga escrito distinto (la query por `serial` es EXACTA y
//     `poc_devices` no tiene `serial_norm`: un guión la dejaba en cero);
//   · sirve también si la ficha ya se cerró (la devolución la cierra sola),
//     pero lo dice;
//   · con más de una ficha viva toma la última y lo dice;
//   · NO devuelve modelo (el del radio que entra lo manda la gestión);
//   · en el lote, jalar del contrato/gestión trae la configuración solo, y el
//     Unit ID sigue siendo el consecutivo del lote y el SIM no se hereda
//     (Alberto, 2026-09-10).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, "public", "js", ...p), "utf8");
const SRC_SERIAL = leer("core", "serial.js");
const SRC_POCSERVICE = leer("services", "pocService.js");
const SRC_BATCH = leer("pages", "nuevo-batch.js");
const SRC_CONSOLAS = leer("domain", "consolasContrato.js");

const ts = (iso) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });

/* ═════════ 1) El servicio: de la ficha del saliente ═════════ */

function montarServicio(fichas) {
  const sandbox = {
    console: { ...console, warn: () => {} },
    firebase: {
      firestore: Object.assign(() => ({
        collection: (nombre) => ({
          where: (campo, _op, valor) => ({
            get: async () => ({
              docs: (nombre === "poc_devices" ? fichas : [])
                .filter(f => (f[campo] ?? null) === valor)
                .map(f => ({ id: f.id, data: () => f })),
              get empty() { return this.docs.length === 0; },
            }),
          }),
        }),
      }), { FieldValue: { serverTimestamp: () => "TS" } }),
    },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC_SERIAL, sandbox, { filename: "serial.js" });
  vm.runInContext(SRC_POCSERVICE, sandbox, { filename: "pocService.js" });
  return sandbox.PocService;
}

const FICHA_VIVA = {
  id: "dev1", serial: "21814A0123", cliente_id: "CLI1", cliente_nombre: "MUNICIPIO DE ARRAIJAN",
  radio_name: "PATRULLA 12", grupos: ["SEGURIDAD", "SUPERVISORES"], gps: true,
  unit_id: "273826", sim_number: "8950702902411531805", deleted: false,
  created_at: ts("2026-02-10T15:00:00Z"),
};

test("la configuración del saliente sale de su ficha POC", async () => {
  const poc = montarServicio([FICHA_VIVA]);
  const mapa = await poc.configDelSaliente({ clienteId: "CLI1", salientes: ["21814A0123"] });

  const cfg = mapa.get("21814A0123");
  assert.ok(cfg, "el saliente tiene que aparecer");
  assert.equal(cfg.radio_name, "PATRULLA 12");
  assert.deepEqual(cfg.grupos, ["SEGURIDAD", "SUPERVISORES"]);
  assert.equal(cfg.gps, true);
  assert.equal(cfg.cerrada, false);
  assert.equal(cfg.ambigua, false);
});

test("el modelo NO viaja: el del radio que entra lo manda la gestión", async () => {
  const poc = montarServicio([{ ...FICHA_VIVA, modelo: "PNC360S-R", modelo_id: "mViejo" }]);
  const cfg = (await poc.configDelSaliente({ clienteId: "CLI1", salientes: ["21814A0123"] })).get("21814A0123");

  assert.equal(cfg.modelo, undefined, "un reemplazo bien puede traer otro modelo");
  assert.equal(cfg.modelo_id, undefined);
});

test("el serial escrito distinto igual encuentra la ficha", async () => {
  // La query por `serial` es exacta y poc_devices no tiene serial_norm: con
  // where('serial','==','21-814a0123') esto devolvía cero.
  const poc = montarServicio([FICHA_VIVA]);
  const mapa = await poc.configDelSaliente({ clienteId: "CLI1", salientes: ["21-814a0123"] });

  assert.equal(mapa.get("21814A0123")?.radio_name, "PATRULLA 12");
});

test("si el saliente ya se devolvió, su ficha cerrada sirve igual — pero lo dice", async () => {
  const poc = montarServicio([{ ...FICHA_VIVA, deleted: true }]);
  const cfg = (await poc.configDelSaliente({ clienteId: "CLI1", salientes: ["21814A0123"] })).get("21814A0123");

  assert.equal(cfg.radio_name, "PATRULLA 12", "el nombre y los grupos siguen ahí");
  assert.equal(cfg.cerrada, true, "y la pantalla tiene que poder decirlo");
});

test("con varias fichas vivas toma la última y lo marca", async () => {
  const poc = montarServicio([
    { ...FICHA_VIVA, id: "viejo", radio_name: "PATRULLA 12 (2024)", created_at: ts("2024-01-05T15:00:00Z") },
    { ...FICHA_VIVA, id: "nuevo", radio_name: "PATRULLA 12", created_at: ts("2026-02-10T15:00:00Z") },
  ]);
  const cfg = (await poc.configDelSaliente({ clienteId: "CLI1", salientes: ["21814A0123"] })).get("21814A0123");

  assert.equal(cfg.radio_name, "PATRULLA 12");
  assert.equal(cfg.ambigua, true);
});

test("un saliente sin ficha en POC simplemente no está", async () => {
  const poc = montarServicio([FICHA_VIVA]);
  const mapa = await poc.configDelSaliente({ clienteId: "CLI1", salientes: ["21814A0123", "NOEXISTE9"] });

  assert.equal(mapa.size, 1);
  assert.equal(mapa.has("NOEXISTE9"), false);
});

/* ═════════ 2) El lote: jalar sin archivo ═════════ */

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
    this.hidden = true; this.style = {}; this.disabled = false; this.handlers = {}; this.dataset = {};
  }
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  setAttribute() {}
  getAttribute() { return null; }
  querySelector() { return null; }
  closest() { return null; }
}

// La gestión de reemplazo como la deja bodega: el saliente lo declaró el
// vendedor, el entrante lo asignó bodega, y ya hay OS de programación.
const GESTION_GR = {
  id: "GR20260910-01", tipo: "reemplazo", estado: "pendiente_programacion",
  cliente_id: "CLI1", cliente_nombre: "MUNICIPIO DE ARRAIJAN",
  ordenes: { programacion_ids: ["2026091001"] },
  items: [{
    serial_saliente: "21814A0123", serial_nuevo: "24813A0527",
    modelo: "PNC370-R", modelo_id: "mPNC370",
    modelo_solicitado: "PNC370-R", modelo_solicitado_id: "mPNC370",
    motivo_codigo: "dano_no_reparable",
  }],
};

function montarLote({ gestion = GESTION_GR, config = null } = {}) {
  const els = new Map();
  const selects = new Set(["cliente", "ip", "contratoJalar"]);
  const get = (id) => {
    if (!els.has(id)) els.set(id, selects.has(id) ? new FakeSelect(id) : new FakeEl(id));
    return els.get(id);
  };
  ["cliente", "ip", "contratoJalar", "seriales", "unit_id_inicial", "notas", "previewContrato",
    "previewVendedor", "avisoSinContrato", "avisoSinContratoExtra", "btnJalarContrato",
    "filtroModelos", "avisoConsolas", "ipSinInfo", "ultimosUnitIDs", "addCliente", "addIP",
    "vendorJson", "batchForm", "nbSalienteBox", "btnJalarSaliente"].forEach(get);
  get("cliente").innerHTML = '<option value="CLI1">MUNICIPIO DE ARRAIJAN</option>';

  const registro = { creados: [], toasts: [], modales: [], salientesPedidos: [] };
  const doc = {
    _dcl: null,
    getElementById: get,
    addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") doc._dcl = fn; },
    querySelector: () => null,
    createElement: () => new FakeEl("tmp"),
  };

  // Por defecto, la ficha del saliente tal cual la tiene POC.
  const porDefecto = new Map([["21814A0123", {
    radio_name: "PATRULLA 12", grupos: ["SEGURIDAD"], gps: true,
    unit_id: "273826", sim_number: "8950702902411531805", serial: "21814A0123",
    ficha_id: "dev1", cerrada: false, ambigua: false, fecha: new Date("2026-02-10T15:00:00Z"),
  }]]);

  const sandbox = {
    console: { ...console, warn: () => {}, error: () => {} },
    document: doc,
    Option: class { constructor(v, t) { this.value = v; this.textContent = t ?? v; this.dataset = {}; } },
    Toast: { show: (msg, tipo) => registro.toasts.push({ msg, tipo }) },
    Modal: { confirm: async (o) => { registro.modales.push(o); return true; }, prompt: async () => null },
    FMT: { normalize: (s) => String(s || "").trim().toLowerCase(), normalizeGrupo: (s) => s, dedupGrupos: (a) => a, esc: (s) => s },
    ModelosService: { getModelos: async () => [{ id: "mPNC370", marca: "HYTERA", modelo: "PNC370-R" }] },
    ClientesService: {
      listClientes: async () => ({ docs: [{ id: "CLI1", nombre: "MUNICIPIO DE ARRAIJAN", ip: "gob.cecomunica.net" }] }),
      existsByNorm: async () => true,
      updateCliente: async () => {},
    },
    EmpresaService: { getDoc: async () => ({ list: ["gob.cecomunica.net"] }) },
    ContratosService: {
      _serialKey: (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""),
      getContratosActivosPorCliente: async () => [],
      getModeloPorSerial: async () => new Map(),
    },
    PocService: {
      getCatalogoGrupos: async () => [],
      getRecent: async () => [],
      getByCliente: async () => [],
      addPocDevice: async (data) => { registro.creados.push(data); },
      softDeletePocDevice: async () => {},
      addLog: async () => {},
      stripSentinels: (o) => o,
      configDelSaliente: async ({ salientes }) => {
        registro.salientesPedidos.push(...salientes);
        return config === null ? porDefecto : config;
      },
    },
    firebase: {
      auth: () => ({
        onAuthStateChanged: (fn) => { registro.init = fn({ uid: "uBrenda", email: "cecrecep@cecomunica.com" }); },
        currentUser: { uid: "uBrenda", email: "cecrecep@cecomunica.com" },
      }),
      firestore: Object.assign(() => ({
        collection: (nombre) => ({
          where: () => ({
            get: async () => ({ forEach: () => {} }),
            // Gestiones del cliente con OS de programación.
            limit: () => ({ get: async () => ({
              docs: (nombre === "gestiones" && gestion ? [gestion] : [])
                .map(g => ({ id: g.id, data: () => g })),
            }) }),
          }),
          orderBy: () => ({ limit: () => ({ get: async () => ({ forEach: () => {} }) }) }),
        }),
      }), { FieldValue: { serverTimestamp: () => "TS" } }),
    },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC_SERIAL, sandbox, { filename: "serial.js" });
  vm.runInContext(SRC_CONSOLAS, sandbox, { filename: "consolasContrato.js" });
  vm.runInContext(SRC_BATCH, sandbox, { filename: "nuevo-batch.js" });
  return { sandbox, el: get, doc, registro };
}

// Arranca la página, elige el cliente y la gestión de reemplazo, y pulsa
// "Jalar" — que es todo lo que recepción hace.
async function conReemplazoJalado(h) {
  await h.doc._dcl();
  await h.registro.init;
  h.el("cliente").value = "CLI1";
  await h.sandbox.onClienteChange();
  h.el("contratoJalar").value = "g:GR20260910-01";
  await h.sandbox.jalarSerialesDesdeContrato();
}

const guardar = (h) => h.el("batchForm").handlers.submit({ preventDefault() {} });

test("jalar de una gestión de reemplazo trae el serial Y la configuración del saliente", async () => {
  const h = montarLote();
  await conReemplazoJalado(h);

  assert.equal(h.el("seriales").value.trim(), "24813A0527", "el serial que entra sale de la gestión");
  assert.deepEqual(h.registro.salientesPedidos, ["21814A0123"], "y se pregunta por el que sale");
  assert.match(h.el("previewVendedor").innerHTML, /PATRULLA 12/, "el nombre heredado se ve en el preview");
  assert.match(h.el("previewVendedor").innerHTML, /21814A0123/, "y de qué radio salió");
});

test("el radio nuevo se crea con el nombre, los grupos y el GPS del saliente", async () => {
  const h = montarLote();
  await conReemplazoJalado(h);
  h.el("unit_id_inicial").value = "5001";

  await guardar(h);

  assert.equal(h.registro.creados.length, 1);
  const d = h.registro.creados[0];
  assert.equal(d.serial, "24813A0527");
  assert.equal(d.radio_name, "PATRULLA 12");
  assert.deepEqual(d.grupos, ["SEGURIDAD"]);
  assert.equal(d.gps, true);
});

test("el Unit ID es el consecutivo del lote y el SIM no se hereda", async () => {
  const h = montarLote();
  await conReemplazoJalado(h);
  h.el("unit_id_inicial").value = "5001";

  await guardar(h);

  const d = h.registro.creados[0];
  assert.equal(d.unit_id, "5001", "el del lote, no el 273826 del saliente");
  assert.equal(d.unit_id_num, 5001);
  assert.equal(d.sim_number, undefined, "el SIM puede cambiar: se define aparte");
});

test("el modelo lo manda la gestión, no la ficha del saliente", async () => {
  const h = montarLote();
  await conReemplazoJalado(h);
  h.el("unit_id_inicial").value = "5001";

  await guardar(h);

  assert.equal(h.registro.creados[0].modelo_id, "mPNC370");
  assert.equal(h.registro.creados[0].modelo, "HYTERA PNC370-R");
});

test("un saliente sin ficha en POC no tranca: la fila queda para llenar a mano", async () => {
  const h = montarLote({ config: new Map() });
  await conReemplazoJalado(h);
  h.el("unit_id_inicial").value = "5001";

  assert.match(h.el("previewVendedor").innerHTML, /sin ficha en POC/);
  await guardar(h);

  assert.equal(h.registro.creados.length, 1, "el lote se crea igual");
  assert.equal(h.registro.creados[0].radio_name, "");
});

test("el detalle va POR SERIAL: reordenar el pegado no cruza los nombres", async () => {
  const dos = {
    ...GESTION_GR,
    items: [
      { ...GESTION_GR.items[0], serial_saliente: "21814A0123", serial_nuevo: "24813A0527" },
      { ...GESTION_GR.items[0], serial_saliente: "21N18A0318", serial_nuevo: "24813A0999" },
    ],
  };
  const h = montarLote({
    gestion: dos,
    config: new Map([
      ["21814A0123", { radio_name: "PATRULLA 12", grupos: ["SEGURIDAD"], gps: true, cerrada: false, ambigua: false, fecha: null }],
      ["21N18A0318", { radio_name: "GRUA 3", grupos: ["OBRAS"], gps: false, cerrada: false, ambigua: false, fecha: null }],
    ]),
  });
  await conReemplazoJalado(h);

  // Recepción reordena el pegado a mano (o lo pega al revés).
  h.el("seriales").value = "24813A0999\n24813A0527";
  h.el("unit_id_inicial").value = "5001";
  await guardar(h);

  const porSerial = Object.fromEntries(h.registro.creados.map(d => [d.serial, d.radio_name]));
  assert.equal(porSerial["24813A0527"], "PATRULLA 12");
  assert.equal(porSerial["24813A0999"], "GRUA 3", "cada nombre sigue a SU serial, no a su posición");
});

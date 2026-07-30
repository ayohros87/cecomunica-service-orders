// Guardia del vínculo POC ↔ contrato en POC · Nuevo batch
// (public/js/pages/nuevo-batch.js).
//
// Regresión de 2026-07-30: recepción llenaba cliente + IP + contrato y DESPUÉS
// cargaba el archivo del vendedor. Ese archivo re-dispara la cascada
// (autoSeleccionarCliente → onClienteChange → cargarContratosDelCliente), que
// reconstruía el <select> de contratos desde cero — y un <select> reconstruido
// vuelve a su primera opción, o sea "Sin vincular a contrato". El re-enganche
// automático (autoJalarContrato) solo elige cuando es inequívoco: un único
// contrato vigente, o el único cuyo número de seriales cuadra con las filas del
// archivo. UDELAS tenía 3 contratos vigentes y el archivo traía 10 filas contra
// un contrato de 14 → nadie re-eligió y los 10 equipos se crearon sueltos; no
// hay forma de re-vincularlos desde la UI (hizo falta un script). Fortaleza
// Security se salvó porque el usuario lo notó a tiempo.
//
// Aquí se corre el archivo real en un sandbox con un DOM mínimo. El FakeSelect
// imita las dos conductas del navegador que causaron el bug: reconstruir
// innerHTML resetea la selección, y asignar un value inexistente la deja vacía.
// Corre con `npm test` (node --test), sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "pages", "nuevo-batch.js"), "utf8");

class FakeOption {
  constructor(value, text, ref) { this.value = value; this.textContent = text; this._ref = ref || null; }
  getAttribute(n) { return n === "data-ref" ? this._ref : null; }
}

// <select> con la semántica que importa: al re-pintar innerHTML la selección
// vuelve a la primera opción, y `value = "x"` con x fuera de la lista queda "".
class FakeSelect {
  constructor(id) { this.id = id; this._value = ""; this.dataset = {}; this.options = []; this._html = ""; }
  set innerHTML(html) {
    this._html = html;
    this.options = [...html.matchAll(/<option value="([^"]*)"(?:\s+data-ref="([^"]*)")?>([^<]*)</g)]
      .map(m => new FakeOption(m[1], m[3], m[2]));
    this._value = this.options.length ? this.options[0].value : "";
  }
  get innerHTML() { return this._html; }
  set value(v) { this._value = this.options.some(o => o.value === v) ? v : ""; }
  get value() { return this._value; }
  get selectedOptions() { const o = this.options.find(x => x.value === this._value); return o ? [o] : []; }
  addEventListener() {}
}

class FakeEl {
  constructor(id) { this.id = id; this.innerHTML = ""; this.value = ""; this.textContent = ""; this.hidden = true; this.style = {}; this.disabled = false; }
  addEventListener() {}
  setAttribute() {}
  querySelector() { return null; }
  closest() { return null; }
  split() { return []; }
}

// Contratos de UDELAS el día del incidente: 3 vigentes, ninguno de 10 seriales.
const CONTRATOS = [
  { id: "docALQ",   contrato_id: "ALQ20260226-01",   tipo_contrato: "Alquiler",  estado: "aprobado", seriales: 4 },
  { id: "docREEMP", contrato_id: "REEMP20260728-02", tipo_contrato: "Reemplazo", estado: "aprobado", seriales: 14 },
  { id: "docDEMO",  contrato_id: "DEMO20260129-01",  tipo_contrato: "Demo",      estado: "aprobado", seriales: 4 },
];

function montar({ contratos = CONTRATOS } = {}) {
  const els = new Map();
  const get = (id) => {
    if (!els.has(id)) els.set(id, id === "contratoJalar" || id === "cliente" || id === "ip" ? new FakeSelect(id) : new FakeEl(id));
    return els.get(id);
  };
  // Precrea los que el código consulta y el cliente, que necesita opciones.
  ["contratoJalar", "cliente", "seriales", "previewContrato", "previewVendedor",
    "avisoSinContrato", "avisoSinContratoExtra", "btnJalarContrato"].forEach(get);
  get("cliente").innerHTML =
    '<option value="CLI1">UNIVERSIDAD ESPECIALIZADA DE LAS AMERICAS</option>' +
    '<option value="CLI2">FORTALEZA SECURITY, S.A</option>';

  const toasts = [];
  const doc = {
    getElementById: get,
    addEventListener: () => {},           // DOMContentLoaded — no se ejecuta aquí
    querySelector: () => null,
    createElement: () => new FakeEl("tmp"),
  };
  const sandbox = {
    console,
    document: doc,
    Toast: { show: (msg, tipo) => toasts.push({ msg, tipo }) },
    Modal: { confirm: async () => true },
    FMT: { normalize: (s) => String(s || "").trim().toLowerCase(), normalizeGrupo: (s) => s, dedupGrupos: (a) => a, esc: (s) => s },
    ModelosService: { getModelos: async () => [] },
    ClientesService: { listClientes: async () => ({ docs: [] }) },
    PocService: { getCatalogoGrupos: async () => [] },
    ContratosService: {
      _serialKey: (s) => String(s || "").trim().toUpperCase(),
      getContratosActivosPorCliente: async (clienteId) => (clienteId === "CLI1" ? contratos : []),
      // Mapa serial→modelo del tamaño declarado por cada contrato.
      getModeloPorSerial: async (docId) => {
        const c = contratos.find(x => x.id === docId);
        const m = new Map();
        for (let i = 0; i < (c?.seriales || 0); i++) {
          const s = `${c.contrato_id}-S${i}`;
          m.set(s.toUpperCase(), { serial: s, modelo: "PNC460-R", modelo_id: "mid" });
        }
        return m;
      },
    },
    firebase: { auth: () => ({ onAuthStateChanged: () => {}, currentUser: { uid: "u", email: "e" } }) },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC, sandbox, { filename: "nuevo-batch.js" });
  return { sandbox, el: get, toasts };
}

// Estado "recepción ya llenó el formulario": cliente elegido y contrato vinculado.
async function conContratoElegido(h, contratoDocId = "docREEMP") {
  h.el("cliente").value = "CLI1";
  await h.sandbox.cargarContratosDelCliente();
  h.el("contratoJalar").value = contratoDocId;
  assert.equal(h.el("contratoJalar").value, contratoDocId, "precondición: el contrato quedó elegido");
}

// ── Regresión principal ────────────────────────────────────────────────────
test("cargar el archivo del vendedor NO desvincula el contrato ya elegido", async () => {
  const h = montar();
  await conContratoElegido(h);

  // Lo que hace procesarArchivoJSON: re-selecciona el MISMO cliente y recarga
  // sus contratos. Antes, aquí se perdía la vinculación.
  await h.sandbox.cargarContratosDelCliente();

  assert.equal(h.el("contratoJalar").value, "docREEMP",
    "el contrato elegido a mano debe sobrevivir a la recarga del archivo");
});

test("cambiar de cliente sí limpia el contrato del cliente anterior", async () => {
  const h = montar();
  await conContratoElegido(h);

  h.el("cliente").value = "CLI2";           // otro cliente, sin contratos vigentes
  await h.sandbox.cargarContratosDelCliente();

  assert.equal(h.el("contratoJalar").value, "",
    "un contrato de otro cliente jamás debe quedar seleccionado");
});

test("un contrato que ya no está vigente no se restaura", async () => {
  const h = montar();
  await conContratoElegido(h, "docALQ");

  // El contrato desaparece de la lista (se anuló entre una carga y otra).
  h.sandbox.ContratosService.getContratosActivosPorCliente =
    async () => CONTRATOS.filter(c => c.id !== "docALQ");
  await h.sandbox.cargarContratosDelCliente();

  assert.equal(h.el("contratoJalar").value, "", "no puede quedar apuntando a un contrato fuera de lista");
});

// ── Auto-elección: no debe pisar la decisión de recepción ──────────────────
test("autoJalarContrato respeta el contrato elegido a mano", async () => {
  const h = montar();
  await conContratoElegido(h, "docREEMP");

  // 4 filas en el archivo: por cantidad "cuadrarían" ALQ y DEMO — antes uno de
  // esos podía sustituir al que recepción eligió.
  const ref = await h.sandbox.autoJalarContrato(4);

  assert.equal(h.el("contratoJalar").value, "docREEMP", "la elección manual manda");
  assert.equal(ref, "REEMP20260728-02");
  assert.ok(h.el("seriales").value.includes("REEMP20260728-02-S0"),
    "debe jalar los seriales del contrato elegido");
});

test("sin elección previa y con varios contratos ambiguos, no adivina", async () => {
  const h = montar();
  h.el("cliente").value = "CLI1";
  await h.sandbox.cargarContratosDelCliente();

  // El caso UDELAS: archivo de 10 filas, ningún contrato de 10 seriales.
  assert.equal(await h.sandbox.autoJalarContrato(10), null);
  // Y el de 4 filas: empatan ALQ y DEMO, sigue siendo ambiguo.
  assert.equal(await h.sandbox.autoJalarContrato(4), null);
});

test("con un único contrato vigente sí auto-elige", async () => {
  const h = montar({ contratos: [CONTRATOS[1]] });
  h.el("cliente").value = "CLI1";
  await h.sandbox.cargarContratosDelCliente();

  assert.equal(await h.sandbox.autoJalarContrato(10), "REEMP20260728-02");
});

// ── Aviso (no bloqueante) ─────────────────────────────────────────────────
test("el aviso sin-contrato dice cuántos contratos vigentes hay sin elegir", async () => {
  const h = montar();
  h.el("cliente").value = "CLI1";
  await h.sandbox.cargarContratosDelCliente();
  h.el("seriales").value = "24O22A0041\n25220A0503";   // ya hay material que crear

  h.sandbox.actualizarAvisoSinContrato();

  assert.equal(h.el("avisoSinContrato").hidden, false, "el aviso debe verse");
  assert.match(h.el("avisoSinContratoExtra").textContent, /3 contrato\(s\) vigente\(s\)/);
});

test("con el contrato vinculado el aviso desaparece", async () => {
  const h = montar();
  await conContratoElegido(h);
  h.el("seriales").value = "24O22A0041";

  h.sandbox.actualizarAvisoSinContrato();

  assert.equal(h.el("avisoSinContrato").hidden, true);
  assert.equal(h.el("avisoSinContratoExtra").textContent, "");
});

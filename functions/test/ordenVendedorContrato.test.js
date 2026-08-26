// El vendedor de la orden sale del CONTRATO (public/js/pages/nueva-orden.js).
//
// Reporte de recepción (26-ago-2026, P.H. PLAZA DEL ESTE): al crear la orden de
// PROGRAMACIÓN el vendedor había que elegirlo de memoria — "la única manera de
// saber qué vendedor es de ese cliente/contrato es abriendo el correo del
// contrato aprobado, ya que ahí también se copia al vendedor". Se eligió al
// vendedor equivocado, se rehízo la orden y quedó una duplicada (2026082602)
// sin seriales.
//
// El dato ya existía: contratos.creado_por_uid es quien elaboró el contrato, y
// es exactamente el uid que onApproval.js pone en CC de ese correo. Ahora la
// pantalla lo usa: cada contrato de la lista muestra a su elaborador y elegirlo
// preselecciona al vendedor (editable, por si no corresponde).
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "pages", "nueva-orden.js"), "utf8");

class FakeOption {
  constructor(value = "", text = "") { this.value = value; this.textContent = text; this.dataset = {}; }
}

// <select> con lo que importa del navegador: repintar innerHTML borra las
// opciones (y la selección), y `value = "x"` fuera de la lista queda en "".
class FakeSelect {
  constructor(id) { this.id = id; this._value = ""; this.options = []; this.dataset = {}; this.disabled = false; this.required = false; this.style = {}; this._listeners = {}; }
  set innerHTML(html) {
    this.options = [...String(html).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)]
      .map(m => new FakeOption(m[1], m[2]));
    this._value = this.options.length ? this.options[0].value : "";
  }
  get innerHTML() { return ""; }
  appendChild(opt) { this.options.push(opt); }
  set value(v) { this._value = this.options.some(o => o.value === v) ? v : ""; }
  get value() { return this._value; }
  get selectedOptions() { const o = this.options.find(x => x.value === this._value); return o ? [o] : []; }
  addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }
  async dispatch(ev) { for (const fn of (this._listeners[ev] || [])) await fn(); }
  classList = { add() {}, remove() {} };
}

class FakeEl {
  constructor(id) { this.id = id; this.innerHTML = ""; this.value = ""; this.textContent = ""; this.hidden = false; this.style = {}; this.disabled = false; this.checked = false; this.required = false; this.classList = { add() {}, remove() {} }; }
  addEventListener() {}
  setAttribute() {}
  querySelector() { return null; }
}

// Los cuatro vendedores reales del catálogo (usuarios con rol vendedor/admin).
const VENDEDORES = [
  { id: "uKarla",   nombre: "Karla Ferrer",    email: "karla.ferrer@cecomunica.com" },
  { id: "uAlondra", nombre: "Alondra Acevedo", email: "alondra.acevedo@cecomunica.com" },
  { id: "uSalomon", nombre: "Salomon Arauz",   email: "salomon.arauz@cecomunica.com" },
  { id: "uElvia",   nombre: "Elvia Onodera",   email: "elvia.onodera@cecomunica.com" },
];

// El contrato del incidente + uno elaborado por alguien que no es vendedor
// (recepción, o un usuario dado de baja) para el camino degradado.
const CONTRATOS = [
  { id: "docALQ", contrato_id: "ALQ20260825-01", tipo_contrato: "Alquiler", estado: "aprobado", total_equipos: 18, creado_por_uid: "uElvia" },
  { id: "docVIEJO", contrato_id: "ALQ20250110-03", tipo_contrato: "Alquiler", estado: "activo", total_equipos: 4, creado_por_uid: "uRecepcion" },
  { id: "docSinUid", contrato_id: "ALQ20240902-07", tipo_contrato: "Alquiler", estado: "activo", total_equipos: 2 },
];

function montar({ contratos = CONTRATOS, cliente = { vendedor_asignado: null } } = {}) {
  const SELECTS = new Set(["cliente", "tipo", "vendedor", "contratoSelect"]);
  const els = new Map();
  const get = (id) => {
    if (!els.has(id)) els.set(id, SELECTS.has(id) ? new FakeSelect(id) : new FakeEl(id));
    return els.get(id);
  };
  ["ordenForm", "mensaje", "cliente", "tipo", "numero", "vendedor", "vendedorHint",
    "contratoBlock", "contratoSelect", "contratoNoAplica", "contratoMotivo",
    "contratoMotivoField", "contratoLabel", "visitaBlock", "visitaSitio",
    "visitaContacto", "crearCliente", "observaciones"].forEach(get);

  const sandbox = {
    console,
    document: {
      getElementById: get,
      createElement: (tag) => (tag === "option" ? new FakeOption() : new FakeEl("tmp")),
      addEventListener: () => {},
      querySelector: () => null,
    },
    location: { search: "" },
    Toast: { show: () => {} },
    Modal: { confirm: async () => true },
    UsuariosService: { getVendedores: async () => VENDEDORES },
    ClientesService: { listClientes: async () => ({ docs: [] }), getCliente: async () => cliente },
    ContratosService: { getContratosActivosPorCliente: async () => contratos },
    EmpresaService: { getDoc: async () => null },
    firebase: { auth: () => ({ onAuthStateChanged: () => {} }) },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC, sandbox, { filename: "nueva-orden.js" });
  return { sandbox, el: get };
}

// Lo que hace recepción: elegir el contrato en el select y soltarlo.
async function elegirContrato(h, docId) {
  await h.sandbox.cargarContratosDelCliente("CLI1");
  h.el("contratoSelect").value = docId;
  await h.el("contratoSelect").dispatch("change");
}

test("elegir el contrato preselecciona al vendedor que lo elaboró", async () => {
  const h = montar();
  await elegirContrato(h, "docALQ");

  assert.equal(h.el("vendedor").value, "uElvia",
    "el vendedor debe salir de contratos.creado_por_uid, no de la memoria de recepción");
  assert.match(h.el("vendedorHint").textContent, /Elvia Onodera/);
  assert.match(h.el("vendedorHint").textContent, /ALQ20260825-01/);
  assert.equal(h.el("vendedorHint").hidden, false);
});

test("la lista de contratos nombra a su elaborador", async () => {
  const h = montar();
  await h.sandbox.cargarContratosDelCliente("CLI1");

  const opt = h.el("contratoSelect").options.find(o => o.value === "docALQ");
  assert.match(opt.textContent, /ALQ20260825-01/);
  assert.match(opt.textContent, /Elvia Onodera/,
    "el vendedor tiene que verse SIN abrir el contrato — ese era el reclamo");
  assert.equal(opt.dataset.ref, "ALQ20260825-01");
});

test("contrato elaborado por alguien que no es vendedor: no inventa una selección", async () => {
  const h = montar();
  await elegirContrato(h, "docVIEJO");

  assert.equal(h.el("vendedor").value, "", "no puede quedar seleccionado un vendedor cualquiera");
  assert.match(h.el("vendedorHint").textContent, /no está en la lista de vendedores/);
});

test("contrato sin creado_por_uid: lo dice y deja elegir a mano", async () => {
  const h = montar();
  await elegirContrato(h, "docSinUid");

  assert.equal(h.el("vendedor").value, "");
  assert.match(h.el("vendedorHint").textContent, /no registra quién lo elaboró/);
});

test("cambiar de contrato cambia el vendedor", async () => {
  const h = montar();
  await elegirContrato(h, "docALQ");
  assert.equal(h.el("vendedor").value, "uElvia");

  h.el("contratoSelect").value = "docVIEJO";
  await h.el("contratoSelect").dispatch("change");
  assert.equal(h.el("vendedor").value, "", "el vendedor del contrato anterior no puede quedarse pegado");
});

test("repoblar el select sin preselección conserva lo ya elegido a mano", async () => {
  const h = montar();
  await h.sandbox.poblarVendedores("uSalomon");
  await h.sandbox.poblarVendedores("");   // p. ej. otra carga de la pantalla

  assert.equal(h.el("vendedor").value, "uSalomon",
    "una corrección manual del vendedor no debe perderse al re-armar el select");
});

test("soltar el contrato limpia el aviso", async () => {
  const h = montar();
  await elegirContrato(h, "docALQ");

  h.el("contratoSelect").value = "";       // 'No aplica' / cambio de tipo
  await h.el("contratoSelect").dispatch("change");
  assert.equal(h.el("vendedorHint").hidden, true);
});

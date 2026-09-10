// Editor de contrato DENTRO del Centro (Centro.editarContrato /
// guardarContratoEditado, clientes-centro.js).
//
// Vivía en contratos/editar-contrato.html. Este test existe porque la mudanza
// se puede hacer mal de dos formas: perdiendo un candado (el contrato activo,
// el enlace de firma) o perdiendo la REAPROBACIÓN — que un contrato ya
// aprobado, editado en lo económico, vuelva a pendiente y se le avise a
// ventas. Las dos cosas se comprueban sobre la escritura real que se manda a
// Firestore.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// DOM de mentira: solo lo que el editor toca. Los campos se declaran por id y
// las líneas/cargos por los data-attrs que lee _lineasModelo/_aumCargos.
function fakeDom({ campos = {}, lineas = [], cargos = [] } = {}) {
  const el = (v, extra = {}) => ({ value: v, checked: v, textContent: v, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, innerHTML: "", ...extra });
  const byId = {};
  for (const [k, v] of Object.entries(campos)) byId[k] = el(v);
  const sel = (q) => {
    const m = /data-(\w+)-(\w+)/.exec(q);
    if (!m) return [];
    const [, pref, campo] = m;
    if (pref !== "wem") return [];
    return lineas.map((l) => {
      if (campo === "modelo") return { value: l.modelo_id, selectedOptions: [{ textContent: l.modelo }], dataset: { label: l.modelo } };
      if (campo === "cant") return { value: String(l.cantidad) };
      if (campo === "precio") return { value: String(l.precio) };
      if (campo === "modalidad") return { value: l.modalidad || "" };
      return { value: "" };
    });
  };
  return {
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: (q) => {
      if (q === ".wa-cargo") {
        return cargos.map((c) => ({
          dataset: {},
          querySelector: (s) => {
            if (s === "[data-wac-sel]") return { value: c.cargo_id, selectedOptions: [{ textContent: c.concepto }] };
            if (s === "[data-wac-cant]") return { value: String(c.cantidad ?? 1) };
            if (s === "[data-wac-monto]") return { value: String(c.monto) };
            if (s === "[data-wac-tipo]") return { value: c.recurrente ? "recurrente" : "unico" };
            return null;
          },
        }));
      }
      return sel(q);
    },
    addEventListener() {}, removeEventListener() {}, createElement: () => el(""),
  };
}

// Monta el Centro con los dominios reales y captura lo que se escribiría.
function montar({ contrato, dom }) {
  const escrituras = [];
  const correos = [];
  const ctx = {
    window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp,
    setTimeout, encodeURIComponent, isNaN, parseFloat, parseInt,
    document: dom,
    location: { origin: "https://app.test" },
    Toast: { show(m, t) { ctx.__toasts.push([m, t]); } },
    Modal: {},
    canRole: () => true,
    ROLES: { ADMIN: "administrador", GERENTE: "gerente", VENDEDOR: "vendedor", RECEPCION: "recepcion", INVENTARIO: "inventario" },
    ContratosService: {
      getContrato: async () => contrato,
      updateContrato: async (id, campos) => { escrituras.push({ id, campos }); },
    },
    firebase: {
      auth: () => ({ currentUser: { uid: "adm", email: "x@c.com" } }),
      firestore: Object.assign(() => ({ collection: () => ({ add: async (d) => { correos.push(d); } }) }),
        { FieldValue: { serverTimestamp: () => "TS" } }),
    },
  };
  ctx.__toasts = [];
  vm.createContext(ctx);
  for (const f of [["core", "formatting.js"], ["domain", "totales.js"], ["domain", "contratoTarifario.js"],
    ["domain", "contratoAnulacion.js"], ["domain", "contratoEdicion.js"], ["services", "gestionesService.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { FMT: ctx.window.FMT, ContractTotals: ctx.window.ContractTotals,
    ContratoTarifario: ctx.window.ContratoTarifario, ContratoAnulacion: ctx.window.ContratoAnulacion,
    ContratoEdicion: ctx.window.ContratoEdicion, GestionesService: ctx.window.GestionesService });
  vm.runInContext(leer("public", "js", "pages", "clientes-centro.js"), ctx);
  const C = ctx.window.Centro;
  C.rol = "administrador"; C.uid = "adm"; C.email = "x@c.com";
  C.cliente = { id: "cli1", nombre: "CLIENTE DEMO" };
  C.contratos = [contrato];
  // _modeloDeSelect resuelve el <select> contra el catálogo cargado.
  C.modelos = [{ id: "m1", label: "PD606-R" }, { id: "m2", label: "NX-420-R" }];
  C._weC = contrato;
  C._wePlan = null;
  C._cerrarModal = () => {};
  C.abrir = async () => {};
  return { C, escrituras, correos, toasts: ctx.__toasts };
}

const BASE = {
  id: "c1", contrato_id: "SERV20260901-01", cliente_id: "cli1", cliente_nombre: "CLIENTE DEMO",
  codigo_tipo: "SERV", tipo_contrato: "Servicio", accion: "Nuevo", estado: "aprobado",
  duracion: "18 meses", duracion_meses: 18, itbms_aplica: true, total_mensual: 200,
  equipos: [{ modelo_id: "m1", modelo: "PD606-R", cantidad: 10, precio: 20, modalidad: "alquiler" }],
  cargos: [],
};

const CAMPOS = (over = {}) => ({ weMeses: "18", weDurUnidad: "meses", weTipo: "SERV",
  weItbms: true, weObs: "", weGuardar: "", weTot: "", ...over });

test("guarda las líneas con su modalidad y los totales recalculados", async () => {
  const dom = fakeDom({ campos: CAMPOS(), lineas: BASE.equipos });
  const { C, escrituras } = montar({ contrato: BASE, dom });
  await C.guardarContratoEditado();

  assert.equal(escrituras.length, 1);
  const w = escrituras[0].campos;
  assert.equal(w.equipos[0].modalidad, "alquiler", "la modalidad por línea no se puede perder");
  assert.equal(w.total_equipos, 10);
  assert.equal(w.subtotal_equipos, 200);
  assert.equal(w.total_mensual, 214, "200 + 7% de ITBMS");
  assert.ok(w.fecha_modificacion instanceof Date);
});

test("una línea sin modalidad no se guarda", async () => {
  const dom = fakeDom({ campos: CAMPOS(), lineas: [{ ...BASE.equipos[0], modalidad: "" }] });
  const { C, escrituras, toasts } = montar({ contrato: BASE, dom });
  await C.guardarContratoEditado();
  assert.equal(escrituras.length, 0, "no debió escribir");
  assert.match(toasts.at(-1)[0], /alquiler o del cliente/i);
});

test("no se guarda un contrato que dejó de admitir cambios mientras el modal estaba abierto", async () => {
  const dom = fakeDom({ campos: CAMPOS(), lineas: BASE.equipos });
  // El modal se abrió sobre un 'aprobado'; al guardar, ya está activo.
  const { C, escrituras, toasts } = montar({ contrato: { ...BASE, estado: "activo" }, dom });
  C._weC = BASE;
  await C.guardarContratoEditado();
  assert.equal(escrituras.length, 0);
  assert.match(toasts.at(-1)[0], /activo ya no se edita/i);
});

test("editar el PRECIO de un aprobado lo devuelve a aprobación y avisa a ventas", async () => {
  const caro = [{ ...BASE.equipos[0], precio: 25 }];
  const dom = fakeDom({ campos: CAMPOS(), lineas: caro });
  const { C, escrituras, correos } = montar({ contrato: BASE, dom });
  await C.guardarContratoEditado();

  const w = escrituras[0].campos;
  assert.equal(w.estado, "pendiente_aprobacion");
  assert.match(w.reaprobacion.motivo, /equipos/);
  assert.equal(w.reaprobacion.total_mensual_anterior, 200);
  assert.equal(correos.length, 1, "ventas tiene que enterarse");
  assert.equal(correos[0].to, "ventas@cecomunica.com");
  assert.match(correos[0].subject, /requiere nueva aprobación/i);
});

// El bug que la página vieja tenía: mandaba a requiereReaprobacion solo el
// string de la duración, sin duracion_meses. Como el comparador mira los tres
// campos, TODO contrato del Centro (que sí trae duracion_meses) salía con
// "cambió la duración" — y corregir una observación lo devolvía a aprobación
// con correo a ventas.
test("corregir SOLO las observaciones no mueve el contrato ni manda correo", async () => {
  const dom = fakeDom({ campos: CAMPOS({ weObs: "Entregar en la sucursal de Colón" }), lineas: BASE.equipos });
  const { C, escrituras, correos } = montar({ contrato: BASE, dom });
  await C.guardarContratoEditado();

  const w = escrituras[0].campos;
  assert.equal(w.observaciones, "Entregar en la sucursal de Colón");
  assert.equal(w.estado, undefined, "no debió volver a pendiente de aprobación");
  assert.equal(w.reaprobacion, undefined);
  assert.equal(correos.length, 0, "no había nada que aprobar de nuevo");
});

test("cambiar el plazo sí lo devuelve a aprobación", async () => {
  const dom = fakeDom({ campos: CAMPOS({ weMeses: "24" }), lineas: BASE.equipos });
  const { C, escrituras } = montar({ contrato: BASE, dom });
  await C.guardarContratoEditado();
  const w = escrituras[0].campos;
  assert.equal(w.estado, "pendiente_aprobacion");
  assert.match(w.reaprobacion.motivo, /duracion/);
  assert.equal(w.duracion, "24 meses");
  assert.equal(w.duracion_meses, 24);
});

test("un borrador (pendiente_aprobacion) se edita sin reaprobación ni correo", async () => {
  const dom = fakeDom({ campos: CAMPOS({ weMeses: "24" }), lineas: BASE.equipos });
  const { C, escrituras, correos } = montar({ contrato: { ...BASE, estado: "pendiente_aprobacion" }, dom });
  await C.guardarContratoEditado();
  assert.equal(escrituras[0].campos.reaprobacion, undefined);
  assert.equal(correos.length, 0);
});

test("la duración en días se guarda como días, no como meses", async () => {
  const dom = fakeDom({ campos: CAMPOS({ weMeses: "7", weDurUnidad: "dias", weTipo: "TEMP" }), lineas: BASE.equipos });
  const { C, escrituras } = montar({ contrato: { ...BASE, estado: "pendiente_aprobacion" }, dom });
  await C.guardarContratoEditado();
  const w = escrituras[0].campos;
  assert.equal(w.duracion, "7 días");
  assert.equal(w.duracion_dias, 7);
  assert.equal(w.codigo_tipo, "TEMP");
  assert.equal(w.tipo_contrato, "Temporal");
});

// ── Cableado ──────────────────────────────────────────────────────────────
test("el Centro dejó de mandar a la página vieja para editar", () => {
  const centro = leer("public", "js", "pages", "clientes-centro.js");
  assert.ok(centro.includes("Centro.editarContrato("),
    "la acción Editar… debe abrir el editor del Centro");
  // Sin comentarios: el bloque del editor MENCIONA la página vieja para decir
  // de dónde viene, y eso no es un enlace.
  const codigo = centro.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/editar-contrato\.html/.test(codigo),
    "el Centro sigue enlazando la página vieja de edición");
});

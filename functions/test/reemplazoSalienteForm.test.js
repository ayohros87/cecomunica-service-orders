// Render del bloque "equipo que se reemplaza" en el formulario de venta
// (nc-form.refreshReempUI). El dominio lo cubre reemplazoSaliente.test.js;
// esto verifica el pegamento con el DOM, que es donde se rompe en silencio:
// que el bloque aparezca SOLO en un REEMP, que liste la flota del cliente y
// que el escape "no se identifica" deshabilite la lista en vez de esconderla.
//
// DOM falso mínimo (no hay jsdom en el proyecto): un mapa de elementos por id.
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function el(extra = {}) {
  return {
    style: {}, dataset: {}, innerHTML: "", value: "", checked: false, textContent: "",
    addEventListener() {}, focus() {}, scrollIntoView() {},
    querySelectorAll: () => [], querySelector: () => null,
    classList: { contains: () => false },
    ...extra,
  };
}

// Monta nc-form.js sobre el DOM falso y devuelve { NCForm, ids }.
function montar(ids = {}) {
  const nodos = {
    tipo_contrato: el(), accion: el(), cliente: el(), duracion: el(),
    reempBox: el(), reempList: el(), reempSinIdentificarChk: el(), reempHint: el(),
    origenBox: el(), origenContratosList: el(), origenLegacyChk: el(), origenLegacyRef: el(),
    origenReq: el(), origenHint: el(), planBox: el(), planBody: el(), planHint: el(),
    ...ids,
  };
  // Los checkboxes que pinta refreshReempUI se leen con este selector; el DOM
  // falso los deriva del HTML generado, que es justo lo que se quiere probar.
  const chksDelHtml = () => {
    const html = nodos.reempList.innerHTML || "";
    return [...html.matchAll(/class="reemp-chk" value="([^"]+)"([^>]*)/g)].map(m => ({
      value: m[1], checked: /\schecked/.test(m[2]), disabled: /\sdisabled/.test(m[2]),
    }));
  };
  const document = {
    getElementById: (id) => nodos[id] || null,
    querySelectorAll: (sel) => (sel.includes("reemp-chk") ? chksDelHtml() : []),
    addEventListener() {},
  };
  // El contexto ES el `window` de la página: nc-form.js escribe `window.NCForm`
  // y al final llama a `NCForm.init()` a secas. Con un window aparte, ese
  // segundo acceso no encuentra nada.
  const ctx = {
    console, document,
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    NC: { escapeHtml: (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])) },
    Toast: { show() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "origenContrato.js"), ctx);
  vm.runInContext(leer("public", "js", "domain", "transicionPlan.js"), ctx);
  vm.runInContext(leer("public", "js", "domain", "reemplazoSalientes.js"), ctx);
  vm.runInContext(leer("public", "js", "pages", "nc-form.js"), ctx);
  return { NCForm: ctx.NCForm, nodos };
}

const u = (serial, extra = {}) => ({
  id: serial, serial, serial_norm: serial, estado: "en_cliente", propiedad: "cecomunica",
  modelo_label: "HYTERA PNC360S", modelo_id: "m1",
  asignacion: { contrato_id: "ALQ20260206-01", contrato_doc_id: "xmv" }, ...extra,
});

test("el bloque solo aparece en un REEMPLAZO", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "ALQ";
  NCForm.refreshReempUI();
  assert.equal(nodos.reempBox.style.display, "none");

  nodos.tipo_contrato.value = "REEMP";
  NCForm.refreshReempUI();
  assert.equal(nodos.reempBox.style.display, "block");
});

test("sin cliente elegido pide el cliente primero", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  NCForm.refreshReempUI();
  assert.match(nodos.reempList.innerHTML, /Selecciona el cliente primero/);
});

test("con la flota cargada lista cada radio con su serial, modelo y contrato", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  nodos.cliente.value = "j8hyhxo46v2dHOtiizUv";
  NCForm._unidadesCliente = [
    u("25O10A2994"), u("25O10A2995"),
    u("24813A0527", { estado: "en_taller", modelo_label: "HYTERA PNC360S-R" }),
  ];
  NCForm.refreshReempUI();
  const html = nodos.reempList.innerHTML;
  for (const s of ["25O10A2994", "25O10A2995", "24813A0527"]) {
    assert.ok(html.includes(s), `falta ${s} en la lista`);
  }
  assert.match(html, /ALQ20260206-01/, "no se ve de qué contrato viene cada radio");
  assert.match(html, /en taller/, "el radio en reparación debe marcarse — suele ser el que se reemplaza");
  assert.match(nodos.reempHint.textContent, /3 equipo/);
});

test("el equipo del cliente y el de bodega no se ofrecen como salientes", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  nodos.cliente.value = "c1";
  NCForm._unidadesCliente = [
    u("PROPIO", { propiedad: "cliente" }),
    u("BODEGA", { estado: "en_bodega" }),
    u("VALIDA"),
  ];
  NCForm.refreshReempUI();
  assert.ok(nodos.reempList.innerHTML.includes("VALIDA"));
  assert.ok(!nodos.reempList.innerHTML.includes("PROPIO"));
  assert.ok(!nodos.reempList.innerHTML.includes("BODEGA"));
});

test("leerReemp devuelve lo marcado y validarReemp lo acepta", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  nodos.cliente.value = "c1";
  NCForm._unidadesCliente = [u("24813A0527"), u("25O10A2994")];
  NCForm.refreshReempUI();
  // Marcar el primero: el DOM falso deriva los checkboxes del HTML, así que se
  // simula el clic reescribiendo ese atributo.
  nodos.reempList.innerHTML = nodos.reempList.innerHTML
    .replace('class="reemp-chk" value="24813A0527" ', 'class="reemp-chk" value="24813A0527" checked ');

  const sel = NCForm.leerReemp();
  // `[...]` re-crea el array en este realm: el del vm tiene otro Array.prototype
  // y deepEqual estricto compara prototipos.
  assert.deepEqual([...sel.seriales], ["24813A0527"]);
  assert.equal(sel.candidatos, 2);
  assert.equal(NCForm.validarReemp({ silencioso: true }).ok, true);

  const guardado = NCForm.unidadesReempSeleccionadas();
  assert.deepEqual([...guardado].map(x => x.serial), ["24813A0527"],
    "solo el radio marcado viaja al contrato — no la flota");
});

test("sin marcar nada no valida: es lo que impedía la orden falsa", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  nodos.cliente.value = "c1";
  NCForm._unidadesCliente = [u("A1"), u("A2")];
  NCForm.refreshReempUI();
  const v = NCForm.validarReemp({ silencioso: true });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, "falta_saliente");
});

test("el escape deshabilita la lista sin esconderla, y deja pasar", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  nodos.cliente.value = "c1";
  NCForm._unidadesCliente = [u("A1")];
  nodos.reempSinIdentificarChk.checked = true;
  NCForm.refreshReempUI();
  assert.equal(nodos.reempBox.style.display, "block", "el bloque sigue visible");
  assert.equal(nodos.reempList.style.opacity, "0.45");
  assert.match(nodos.reempList.innerHTML, /disabled/);
  assert.equal(NCForm.validarReemp({ silencioso: true }).ok, true);
  assert.match(nodos.reempHint.textContent, /No se abrirá devolución automática/);
});

test("cliente sin equipos nuestros manda al escape en vez de trabar la venta", () => {
  const { NCForm, nodos } = montar();
  nodos.tipo_contrato.value = "REEMP";
  nodos.cliente.value = "c1";
  NCForm._unidadesCliente = [];
  NCForm.refreshReempUI();
  assert.match(nodos.reempList.innerHTML, /no tiene equipos nuestros/);
  const v = NCForm.validarReemp({ silencioso: true });
  assert.equal(v.motivo, "sin_candidatos");
});

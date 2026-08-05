// Guardia del borrado de devices POC desde "Corregir estado → En bodega"
// (incidente ERICK REYES, 2026-07-31).
//
// Qué pasó: el modal ofrece desactivar "el device POC vinculado" leyendo
// `ficha.poc_device_id`. Ese puntero se quedaba rancio cuando al device le
// cambiaban el serial: 11:07 a.m. recepción pasó el device del serial saliente
// (22806A0312) al entrante (26123A0793) por un reemplazo de radio, y 11:13 a.m.
// inventario corrigió a bodega el serial SALIENTE con el check marcado. El
// borrado siguió el enlace viejo y se llevó el RADIO 3 del cliente, que para
// entonces ya era otro radio. La programación quedó en 4 de 5 equipos.
//
// El puntero rancio se cerró en el trigger (onPocDeviceWritePool desenlaza la
// ficha anterior al cambiar el serial), pero la pantalla no puede confiar en
// que el dato esté sano: antes de ofrecer el borrado compara el serial del
// device contra el de la ficha. Esto congela esa comparación.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// DOM mínimo: los tres nodos que toca la verificación del vínculo POC.
function cargarPagina(device) {
  const noop = () => {};
  const nodos = {
    corrPocRow:       { style: {} },
    corrPocDetalle:   { style: {}, textContent: "", innerHTML: "" },
    corrDesactivarPoc: { type: "checkbox", checked: false, disabled: true },
    corrSerialLabel:  { textContent: "", style: {} },
    corrEstadoActual: { innerHTML: "" },
    corrIntro:        { innerHTML: "" },
    corrAvisos:       { innerHTML: "", style: {} },
    corrMotivo:       { value: "" },
  };
  const ctx = {
    console,
    window: {},
    document: {
      addEventListener: noop,
      getElementById: (id) => nodos[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    firebase: { auth: () => ({ onAuthStateChanged: noop, currentUser: null }), firestore: () => ({}) },
    ROLES: { ADMIN: "administrador", INVENTARIO: "inventario", GERENTE: "gerente", VISTA: "vista" },
    FMT: { esc: (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])) },
    Toast: { show: noop },
    Modal: { open: noop, close: noop },
    localStorage: { getItem: () => null, setItem: noop },
    PocService: { getPocDevice: async () => device },
    EquiposPoolService: {
      normalizarSerial: (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      chipEstadoHtml: () => "",
    },
  };
  ctx.window.EquiposPool = undefined;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "pages", "inventario-equipos.js"), ctx);
  return { pagina: ctx.window.EquiposPool, nodos };
}

// La ficha que se está corrigiendo: el serial SALIENTE del reemplazo.
const FICHA = { id: "22806A0312", serial: "22806A0312", serial_norm: "22806A0312",
  poc_device_id: "oUc2To84qIvKoWtuaS0D", estado: "en_cliente" };

test("no ofrece borrar el device POC cuando el vínculo está rancio", async () => {
  // El device ya lleva el serial ENTRANTE: es el RADIO 3 del cliente.
  const { pagina, nodos } = cargarPagina({
    id: "oUc2To84qIvKoWtuaS0D", serial: "26123A0793", radio_name: "RADIO 3",
    unit_id: "275341", cliente_nombre: "ERICK REYES", deleted: false,
  });
  pagina._corrigiendoId = FICHA.id;
  await pagina._verificarPocVinculado(FICHA);

  assert.equal(nodos.corrDesactivarPoc.checked, false, "el check no puede quedar marcado");
  assert.equal(nodos.corrDesactivarPoc.disabled, true, "el check tiene que quedar bloqueado");
  assert.equal(pagina._corrPocDevice, null,
    "sin device verificado, guardarCorreccion no debe borrar nada");
  assert.match(nodos.corrPocDetalle.innerHTML, /desactualizado/i);
  assert.match(nodos.corrPocDetalle.innerHTML, /RADIO 3/,
    "hay que decir a qué radio apunta el enlace viejo");
  assert.match(nodos.corrPocDetalle.innerHTML, /ERICK REYES/,
    "y de quién es, para que se note que no es esta unidad");
});

test("sí ofrece borrar cuando el device sigue siendo el mismo serial", async () => {
  const device = { id: "dev123", serial: "22806A0312", radio_name: "ARRPTA01",
    unit_id: "1061", cliente_nombre: "COMPAÑÍA GOLY, S.A", deleted: false,
    sim_number: "8950701000002367253" };
  const { pagina, nodos } = cargarPagina(device);
  pagina._corrigiendoId = FICHA.id;
  await pagina._verificarPocVinculado(FICHA);

  assert.equal(nodos.corrDesactivarPoc.checked, true);
  assert.equal(nodos.corrDesactivarPoc.disabled, false);
  assert.equal(pagina._corrPocDevice, device);
  assert.match(nodos.corrPocDetalle.innerHTML, /ARRPTA01/);
});

test("un device ya borrado no se ofrece para borrar de nuevo", async () => {
  const { pagina, nodos } = cargarPagina({
    id: "dev123", serial: "22806A0312", radio_name: "ARRPTA01", deleted: true,
  });
  pagina._corrigiendoId = FICHA.id;
  await pagina._verificarPocVinculado(FICHA);

  assert.equal(nodos.corrDesactivarPoc.checked, false);
  assert.equal(pagina._corrPocDevice, null);
  assert.match(nodos.corrPocDetalle.textContent, /no está activo/i);
});

test("si el modal ya pasó a otra unidad, la verificación tardía no toca nada", async () => {
  const { pagina, nodos } = cargarPagina({
    id: "dev123", serial: "22806A0312", deleted: false,
  });
  pagina._corrigiendoId = "OTRA_FICHA";   // el usuario cerró y abrió otra
  await pagina._verificarPocVinculado(FICHA);

  assert.equal(nodos.corrDesactivarPoc.checked, false,
    "una respuesta que llega tarde no puede marcar el check de otra unidad");
  assert.equal(pagina._corrPocDevice, null);
});

test("el borrado de un device POC deja rastro en poc_logs", () => {
  // El borrado era la única operación de POC sin log: cuando se desactivó el
  // device equivocado no hubo dónde verlo y hubo que reconstruirlo desde el
  // kardex del pool. PocService.softDeletePocDevice tiene que loguear siempre.
  const svc = leer("public", "js", "services", "pocService.js");
  const cuerpo = svc.slice(svc.indexOf("async softDeletePocDevice"),
    svc.indexOf("async restorePocDevice"));
  assert.match(cuerpo, /_logBorrado/,
    "softDeletePocDevice tiene que registrar el borrado en poc_logs");

  // Y ningún llamador puede borrar sin identificarse (antes/user/origen).
  for (const [dir, archivo] of [["pages", "poc-list.js"], ["pages", "inventario-equipos.js"]]) {
    const js = leer("public", "js", dir, archivo);
    // Ventana de texto tras cada llamada (los argumentos traen paréntesis
    // anidados —firebase.auth()— así que no sirve un match por paréntesis).
    const llamadas = [];
    for (let i = js.indexOf("softDeletePocDevice("); i !== -1;
      i = js.indexOf("softDeletePocDevice(", i + 1)) {
      llamadas.push(js.slice(i, i + 220));
    }
    assert.ok(llamadas.length > 0, `${archivo} debería borrar devices POC`);
    for (const ll of llamadas) {
      assert.match(ll, /origen:/, `${archivo}: borrado sin \`origen\` → log anónimo (${ll})`);
    }
  }
});

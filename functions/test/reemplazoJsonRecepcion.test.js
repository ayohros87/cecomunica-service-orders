// El vendedor descarga el JSON del reemplazo para recepción.
//
// Pedido de los vendedores (2026-09-10): al crear la solicitud de reemplazo,
// poder bajarse la información de los radios que SALEN y mandársela a
// recepción. Es el mismo dato que el lote de POC jala solo de la ficha del
// saliente, pero en archivo, para el que lo necesita por adelantado o por
// fuera del sistema.
//
// Lo que se exige aquí:
//   · el archivo sale en el formato que el lote de POC ya sabe leer
//     (cliente_id/cliente_nombre para auto-elegir cliente, radio_name, gps,
//     grupos, modelo_label);
//   · el MODELO es el que ENTRA (el solicitado), no el del saliente;
//   · no lleva serial del radio nuevo ni Unit ID: el serial lo pone bodega y
//     el Unit ID lo asigna el lote (consecutivo propio, Alberto 2026-09-10);
//   · un saliente sin ficha en POC no rompe el archivo, pero se avisa antes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const GR = {
  id: "GR20260910-01", tipo: "reemplazo", estado: "pendiente_bodega",
  cliente_id: "cli1", cliente_nombre: "MUNICIPIO DE ARRAIJAN",
  items: [
    { serial_saliente: "21814A0123", modelo: "PNC360S-R", modelo_id: "mViejo",
      modelo_solicitado: "HYTERA PNC370-R", modelo_solicitado_id: "mPNC370" },
    { serial_saliente: "21N18A0318", modelo: "PNC360S-R", modelo_id: "mViejo",
      modelo_solicitado: "HYTERA PNC370-R", modelo_solicitado_id: "mPNC370" },
  ],
};

const CONFIG = new Map([
  ["21814A0123", { radio_name: "PATRULLA 12", grupos: ["SEGURIDAD"], gps: true, cerrada: false, ambigua: false }],
  ["21N18A0318", { radio_name: "GRUA 3", grupos: ["OBRAS", "SUPERVISORES"], gps: false, cerrada: true, ambigua: false }],
]);

function montarCentro({ gestion = GR, config = CONFIG, confirmar = true } = {}) {
  const cap = { descargas: [], toasts: [], modales: [] };
  const anchor = { href: "", download: "", click() { cap.descargas.push({ href: this.href, nombre: this.download }); }, remove() {} };
  const ctx = {
    window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp, Promise,
    setTimeout, encodeURIComponent, isNaN, parseFloat, parseInt,
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => anchor,
      body: { appendChild() {} },
      addEventListener() {}, removeEventListener() {},
    },
    // Blob de mentira que conserva el texto para poder leer el JSON.
    Blob: class { constructor(partes) { this.texto = partes.join(""); } },
    URL: { createObjectURL: (b) => { cap.blob = b; return "blob:x"; }, revokeObjectURL() {} },
    Toast: { show: (msg, t) => cap.toasts.push({ msg, t }) },
    Modal: { async confirm(o) { cap.modales.push(o); return confirmar; }, async prompt() { return null; } },
    ROLES: { ADMIN: "administrador", GERENTE: "gerente", VENDEDOR: "vendedor", RECEPCION: "recepcion", INVENTARIO: "inventario" },
    firebase: { auth: () => ({ currentUser: { uid: "u1", email: "v@c.com" } }) },
    PocService: {
      configDelSaliente: async ({ salientes }) => {
        cap.pedidos = salientes;
        return config;
      },
    },
  };
  vm.createContext(ctx);
  for (const f of [["core", "serial.js"], ["core", "formatting.js"], ["domain", "totales.js"], ["domain", "contratoTarifario.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { Serial: ctx.window.Serial, FMT: ctx.window.FMT,
    ContractTotals: ctx.window.ContractTotals, ContratoTarifario: ctx.window.ContratoTarifario });
  vm.runInContext(leer("public", "js", "services", "gestionesService.js"), ctx);
  ctx.GestionesService = ctx.window.GestionesService;
  vm.runInContext(leer("public", "js", "pages", "clientes-centro.js"), ctx);

  const Centro = ctx.window.Centro;
  Centro.rol = "vendedor";
  Centro.cliente = { id: "cli1", nombre: "MUNICIPIO DE ARRAIJAN" };
  Centro.gestiones = gestion ? [gestion] : [];
  return { Centro, cap, leerJson: () => JSON.parse(cap.blob.texto) };
}

test("el JSON trae lo que el radio nuevo hereda del saliente", async () => {
  const h = montarCentro();
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  assert.deepEqual(h.cap.pedidos, ["21814A0123", "21N18A0318"]);
  const filas = h.leerJson();
  assert.equal(filas.length, 2);
  assert.equal(filas[0].radio_name, "PATRULLA 12");
  assert.deepEqual(filas[0].grupos, ["SEGURIDAD"]);
  assert.equal(filas[0].gps, true);
  assert.equal(filas[1].radio_name, "GRUA 3");
  assert.deepEqual(filas[1].grupos, ["OBRAS", "SUPERVISORES"]);
  assert.equal(filas[1].gps, false);
});

test("va en el formato que el lote de POC ya sabe leer", async () => {
  const h = montarCentro();
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  const f = h.leerJson()[0];
  // cliente_id/cliente_nombre son los que el lote usa para auto-elegir cliente.
  assert.equal(f.cliente_id, "cli1");
  assert.equal(f.cliente_nombre, "MUNICIPIO DE ARRAIJAN");
  assert.ok("radio_name" in f && "gps" in f && "grupos" in f && "modelo_label" in f);
  assert.equal(h.cap.descargas[0].nombre, "reemplazo-GR20260910-01.json");
});

test("el modelo es el que ENTRA, no el del saliente", async () => {
  const h = montarCentro();
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  const f = h.leerJson()[0];
  assert.equal(f.modelo_label, "HYTERA PNC370-R");
  assert.equal(f.modelo_id, "mPNC370");
});

test("no lleva el serial del radio nuevo ni Unit ID", async () => {
  const h = montarCentro();
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  const f = h.leerJson()[0];
  assert.equal(f.serial, undefined, "el serial que entra lo pone bodega al asignar");
  assert.equal(f.unit_id, undefined, "el Unit ID lo asigna el lote (consecutivo propio)");
  assert.equal(f.sim_number, undefined, "el SIM puede cambiar");
  assert.equal(f.serial_saliente, "21814A0123", "el saliente sí, como referencia para el humano");
});

test("la ficha cerrada del saliente queda anotada en el archivo", async () => {
  const h = montarCentro();
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  const filas = h.leerJson();
  assert.equal(filas[0].ficha_saliente, "viva");
  assert.equal(filas[1].ficha_saliente, "cerrada");
});

test("un saliente sin ficha en POC avisa antes de descargar", async () => {
  const h = montarCentro({ config: new Map() });
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  const aviso = h.cap.modales.find(m => /sin ficha/i.test(m.title || ""));
  assert.ok(aviso, "recepción no puede recibir un archivo vacío sin que nadie lo sepa");
  assert.match(aviso.message, /2 de 2/);
  const filas = h.leerJson();
  assert.equal(filas[0].radio_name, "", "se descarga igual, para llenarlo a mano");
  assert.equal(filas[0].ficha_saliente, "sin ficha en POC");
});

test("cancelar el aviso no descarga nada", async () => {
  const h = montarCentro({ config: new Map(), confirmar: false });
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  assert.equal(h.cap.descargas.length, 0);
});

test("una gestión que no es reemplazo no descarga nada", async () => {
  const h = montarCentro({ gestion: { ...GR, tipo: "aumento" } });
  await h.Centro.jsonReemplazoRecepcion("GR20260910-01");

  assert.equal(h.cap.descargas.length, 0);
  assert.match(h.cap.toasts.at(-1).msg, /No se encontró/i);
});

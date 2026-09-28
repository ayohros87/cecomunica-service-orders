// Piezas: la señal S9 cuenta lo mismo que la página, el stock deja kardex y
// los precios se editan solo en Finanzas (auditoría UX 2026-09-28, P2 §4.6).
//
//   S9a — countPiezasSinStock con agregados: activas en 0 menos las "Libre".
//   S9b — sin agregados cae al scan con el mismo predicado.
//   S9c — piezas.js usa el mismo criterio en KPI y filtro (activa, controlada, 0).
//   K1  — ajustarDelta deja cada ±N en inventario_piezas/{id}/kardex, con motivo,
//         antes/después, quién y origen; y NO dentro de la transacción (a
//         prueba de rules).
//   K2  — la página lo muestra (botón por fila + enlace en la ficha).
//   P1  — precio y costo son de lectura en piezas.html/piezas.js: el guardado
//         no los manda, al crear nacen en 0 y el enlace a Finanzas es solo
//         para admin.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// SenalesService en un vm con Firestore de mentira: la consulta registra sus
// wheres y devuelve `docs`; FbAgg (agregados) cuenta con un predicado local.
function cargarSenales({ docs = [], conAgregados = true } = {}) {
  const consultas = [];
  const q = (col, wheres = []) => ({
    where: (f, op, v) => q(col, [...wheres, [f, op, v]]),
    limit: () => q(col, wheres),
    async get() {
      consultas.push({ col, wheres, scan: true });
      const cumple = (d) => wheres.every(([f, op, v]) => op === "==" ? d[f] === v : true);
      const hits = docs.filter(cumple);
      return { size: hits.length, forEach: (fn) => hits.forEach(d => fn({ data: () => d })) };
    },
  });
  const cuentaAgg = (col, wheres) => {
    consultas.push({ col, wheres, agg: true });
    return docs.filter(d => wheres.every(([f, , v]) => d[f] === v)).length;
  };
  const ctx = {
    console: { warn() {}, error() {}, log() {} },
    window: conAgregados ? { FbAgg: { disponible: true, count: async (col, wheres) => cuentaAgg(col, wheres) } } : {},
    firebase: { firestore: () => ({ collection: (col) => q(col) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "senalesService.js"), ctx);
  return { S: ctx.window.SenalesService, consultas };
}

// Catálogo chico con todos los casos: activas en 0 controladas (cuentan),
// activa en 0 "Libre" (no), inactiva en 0 (no), activa con stock (no).
const PIEZAS = [
  { id: "a", activo: true, cantidad: 0 },
  { id: "b", activo: true, cantidad: 0, sin_control_inventario: false },
  { id: "c", activo: true, cantidad: 0, sin_control_inventario: true },   // Libre
  { id: "d", activo: false, cantidad: 0 },                                 // inactiva
  { id: "e", activo: true, cantidad: 3 },
];

test("S9a · con agregados: activas en 0 menos las 'Libre' — solo igualdades, sin índice compuesto", async () => {
  const { S, consultas } = cargarSenales({ docs: PIEZAS });
  assert.equal(await S.countPiezasSinStock(), 2);
  assert.equal(consultas.length, 2, "dos conteos: total y 'Libre'");
  // JSON: los arrays nacen en el realm del vm y deepEqual los rechaza por prototipo.
  const j = (x) => JSON.stringify(x);
  assert.equal(j(consultas[0].wheres), j([["activo", "==", true], ["cantidad", "==", 0]]));
  assert.equal(j(consultas[1].wheres), j([["activo", "==", true], ["cantidad", "==", 0], ["sin_control_inventario", "==", true]]));
  assert.ok(consultas.every(c => c.wheres.every(w => w[1] === "==")), "ningún rango: el count no necesita índice compuesto");
});

test("S9b · sin agregados cae al scan con el mismo predicado", async () => {
  const { S, consultas } = cargarSenales({ docs: PIEZAS, conAgregados: false });
  assert.equal(await S.countPiezasSinStock(), 2);
  assert.ok(consultas.some(c => c.scan), "sin FbAgg se lee la consulta");
  assert.equal(JSON.stringify(consultas[0].wheres), JSON.stringify([["activo", "==", true], ["cantidad", "==", 0]]));
});

test("S9c · la página usa el mismo criterio (activa, controlada, en 0)", () => {
  const src = sinComentarios(leer("public", "js", "pages", "piezas.js"));
  assert.match(src, /const esSinStock = \(p\) => p\.activo === true && !p\.sin_control_inventario && Number\(p\.cantidad \|\| 0\) <= 0;/,
    "esSinStock excluye inactivas y 'Libre' — es lo que cuenta S9");
  assert.match(src, /const criticas = piezas\.filter\(esSinStock\)\.length;/, "el KPI usa el predicado");
  assert.match(src, /if \(on\('chkSinStock'\)\) data = data\.filter\(esSinStock\);/, "y el filtro también");
});

test("K1 · cada ±N queda en el kardex de la pieza, fuera de la transacción", () => {
  const svc = sinComentarios(leer("public", "js", "services", "piezasService.js"));
  const fn = svc.slice(svc.indexOf("async ajustarDelta("), svc.indexOf("async getKardex("));
  const iTx = fn.indexOf("runTransaction(");
  const iFinTx = fn.indexOf("if (res?.recortado)");
  const iKardex = fn.indexOf("collection('kardex').add(");
  assert.ok(iTx > 0 && iFinTx > iTx && iKardex > iFinTx,
    "el kardex se escribe DESPUÉS de la transacción: si rules lo niega, el stock se ajusta igual");
  const kardex = fn.slice(iKardex, iKardex + 500);
  for (const campo of ["delta", "antes: res.antes", "despues: res.despues", "motivo", "origen", "por:", "por_email", "fecha:"]) {
    assert.ok(kardex.includes(campo), `el movimiento lleva ${campo}`);
  }
  assert.match(fn.slice(iKardex - 80, iKardex + 600), /try \{[\s\S]*catch \(e\) \{\s*console\.warn\('\[Piezas\] kardex no registrado/,
    "a prueba de fallos");
  assert.match(svc, /async getKardex\(id, \{ limite = 100 \} = \{\}\)/, "y se puede leer, más reciente primero");
  assert.match(svc.slice(svc.indexOf("async getKardex(")), /orderBy\('fecha', 'desc'\)/);
});

test("K2 · la página muestra el kardex por fila y desde la ficha", () => {
  const src = leer("public", "js", "pages", "piezas.js");
  assert.match(src, /onclick="verKardex\('\$\{p\.id\}'\)"/, "botón por fila");
  assert.match(src, /async function verKardex\(id\)/, "abre una hoja con los movimientos");
  assert.match(src, /PiezasService\.getKardex\(id\)/);
  assert.match(src, /verKardex\('\$\{id\}'\)/, "enlace desde la ficha (modal de edición)");
  assert.match(src, /onTogglePiezas, sortBy, toggleActivo, verKardex/, "publicado en window para el onclick");
});

test("P1 · precio y costo son de lectura en Piezas: se editan solo en Finanzas", () => {
  const html = leer("public", "inventario", "piezas.html");
  assert.match(html, /id="f-precio"[^>]*readonly/, "precio de lectura");
  assert.match(html, /id="f-costo"[^>]*readonly/, "costo de lectura");
  assert.match(html, /id="f-precio-hint"/, "con la explicación al lado");
  const js = sinComentarios(leer("public", "js", "pages", "piezas.js"));
  const guardar = js.slice(js.indexOf("async function guardarPieza("), js.indexOf("async function ajustarStock("));
  assert.doesNotMatch(guardar, /precio_venta: precio|costo_unitario: costo|f-precio|f-costo/,
    "el guardado no lee ni manda precio/costo: no pisa lo que fijó Finanzas");
  assert.match(guardar, /addPieza\(\{ \.\.\.payload, precio_venta: 0, costo_unitario: 0,/, "al crear nacen en 0 (Finanzas los ve '⚠ sin precio')");
  assert.doesNotMatch(guardar, /Marca y Precio son requeridos/, "el precio ya no es requisito para dar de alta stock");
  const modal = js.slice(js.indexOf("function abrirModal("), js.indexOf("async function verKardex("));
  assert.match(modal, /rolActual === ROLES\.ADMIN\s*\?\s*`<a href="\/inventario\/piezas-tarifas\.html">Editar en Finanzas/,
    "el enlace 'Editar en Finanzas' es solo para admin (contabilidad no entra a esta página)");
});

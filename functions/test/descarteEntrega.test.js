// Descartados del QC y la entrega (petición Solangel 2026-10-08).
//
// Antes el cliente firmaba la entrega por TODOS los radios de la orden,
// incluido el que el QC descartó y que no se lleva. Recepción lo arreglaba
// eliminando el serial y abriendo una ENTRADA — y el radio terminaba
// disponible en bodega (ANATI 24O31A0889). Ahora el QC dice el destino del
// descartado y la entrega lo respeta. Este archivo congela:
//
//   A — el criterio vive en dos espejos (navegador y servidor) y tienen que
//       decir lo mismo sobre la misma orden;
//   B — un descarte viejo, sin destino, se lee como "se queda" (el caso normal);
//   C — la entrega parcial no cuenta como pendiente lo que se queda: si no,
//       la orden quedaría con "1 pendiente" para siempre;
//   D — el correo de la nota marca "se devuelve sin reparar";
//   E — el modal de QC exige destino y causa para resolver un descartado.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const servidor = require("../src/domain/descarteEntrega");

function cargarNavegador() {
  const ctx = { window: {}, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "descarteEntrega.js"), ctx);
  vm.runInContext(leer("public", "js", "domain", "entregaTandas.js"), ctx);
  return { DE: ctx.window.DescarteEntrega, ET: ctx.window.EntregaTandas };
}

const orden = (porEquipo, equipos) => ({
  tipo_de_servicio: "REPARACIÓN",
  equipos,
  qc: { resultado: "aprobado", por_equipo: porEquipo },
});
const EQ = [
  { id: "a", numero_de_serie: "24O31A0888", modelo: "PNC360S" },
  { id: "b", numero_de_serie: "24O31A0889", modelo: "PNC360S" },
  { id: "c", numero_de_serie: "B5100260", modelo: "PD606" },
];
const PE = {
  a: { equipo_id: "a", serial: "24O31A0888", resultado: "aprobado" },
  b: { equipo_id: "b", serial: "24O31A0889", resultado: "descartado", nota: "Daño lógico", destino: "cecomunica", causa: "garantia" },
  c: { equipo_id: "c", serial: "B5100260", resultado: "descartado", nota: "No quiere repararlo", destino: "cliente", causa: "dano_cliente" },
};

test("A: navegador y servidor dicen lo mismo de la misma orden", () => {
  const { DE } = cargarNavegador();
  const o = orden(PE, EQ);
  const { salen, seQuedan } = DE.separar(o);
  assert.equal(salen.map((e) => e.id).join(), "a,c");
  assert.equal(seQuedan.map((e) => e.id).join(), "b");
  assert.equal(DE.sinReparar(o, EQ[2]), true);
  assert.equal(DE.sinReparar(o, EQ[0]), false);
  assert.deepEqual([...servidor.serialesQueSeQuedan(o)], ["24O31A0889"]);
  assert.equal(servidor.descartesPorSerial(o).get("B5100260").destino, "cliente");
});

test("A: el equipo sin id (legacy) se casa por serial normalizado", () => {
  const { DE } = cargarNavegador();
  const o = orden({ x: { serial: "24o31a-0889", resultado: "descartado", nota: "x" } },
    [{ numero_de_serie: "24O31A0889" }]);
  assert.equal(DE.seQueda(o, o.equipos[0]), true);
  assert.ok(servidor.serialesQueSeQuedan(o).has("24O31A0889"));
});

test("B: un descarte anterior al 2026-10-08 (sin destino) se queda en Cecomunica", () => {
  const { DE } = cargarNavegador();
  const viejo = { b: { equipo_id: "b", serial: "24O31A0889", resultado: "descartado", nota: "viejo" } };
  const o = orden(viejo, EQ.slice(0, 2));
  assert.equal(DE.seQueda(o, EQ[1]), true);
  assert.ok(servidor.serialesQueSeQuedan(o).has("24O31A0889"));
});

test("B: sin QC, o con equipos aprobados/denegados, todo sale", () => {
  const { DE } = cargarNavegador();
  assert.equal(DE.equiposQueSalen({ equipos: EQ }).length, 3);
  const o = orden({ a: { equipo_id: "a", serial: "24O31A0888", resultado: "denegado", nota: "x" } }, EQ);
  assert.equal(DE.equiposQueSalen(o).length, 3);
  assert.equal(servidor.serialesQueSeQuedan(o).size, 0);
});

test("C: la entrega parcial no cuenta el descartado que se queda como pendiente", () => {
  const { ET } = cargarNavegador();
  const o = orden(PE, EQ);
  const r = ET.resumen(o);
  assert.equal(r.total, 2);
  assert.equal(r.pendientes, 2);
  // Entregado "c" en una tanda, el único pendiente es "a" — no "b".
  o.entrega = { tandas: [{ numero: "X-E1", equipos: [{ id: "c", serial: "B5100260" }] }] };
  assert.equal(ET.equiposPendientes(o).map((e) => e.id).join(), "a");
  assert.equal(ET.puedeEntregarParcial(o), false);
});

test("descartados de la revisión de ENTRADA: el servidor los aparta del aterrizaje", () => {
  const o = { equipos: [
    { numero_de_serie: "AAA111", descartado_revision: true },
    { numero_de_serie: "BBB222" },
    { numero_de_serie: "CCC333", descartado_revision: true, eliminado: true },
  ] };
  assert.deepEqual([...servidor.serialesDescartadosEnRevision(o)], ["AAA111"]);
});

test("D: el correo de la nota marca el radio que se devuelve sin reparar", () => {
  const { buildBodyNotaEntrega } = require("../src/domain/emailRenderer");
  const html = buildBodyNotaEntrega({
    orden: { equipos: [
      { modelo: "PD606", numero_de_serie: "B5100260", sin_reparar: true, trabajo_tecnico: "Sin arreglo" },
      { modelo: "PNC360S", numero_de_serie: "24O31A0888", trabajo_tecnico: "Programado" },
    ] },
    ordenId: "2026100605", opts: { receptorNombre: "X" },
  });
  assert.match(html, /Se devuelve sin reparar/);
  assert.equal(html.match(/Se devuelve sin reparar/g).length, 1);
});

test("E: el QC exige destino y causa para resolver un descartado, y los guarda", () => {
  const qc = leer("public", "js", "pages", "ordenes-qc.js");
  assert.match(qc, /st\.resultado === 'descartado'\) return !!st\.nota\.trim\(\) && !!st\.destino && !!st\.causa/);
  assert.match(qc, /destino: st\.destino, causa: st\.causa/);
  assert.match(qc, /destino: d\.destino,\s*causa: d\.causa/);
});

test("las páginas que entregan cargan el módulo ANTES de entregaTandas", () => {
  const { scriptsDePagina } = require("./_helpers/entryScripts");
  const s = scriptsDePagina("ordenes/index.html");
  const iD = s.findIndex((x) => /domain\/descarteEntrega\.js$/.test(x));
  const iT = s.findIndex((x) => /domain\/entregaTandas\.js$/.test(x));
  assert.ok(iD >= 0 && iT > iD, "descarteEntrega.js debe cargar antes que entregaTandas.js");
  assert.ok(scriptsDePagina("ordenes/imprimir-orden.html").some((x) => /domain\/descarteEntrega\.js$/.test(x)));
});

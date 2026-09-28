// Estados de orden del panel de administración (public/js/domain/adminMetrics.js).
//
// Auditoría UX 2026-09-28: la portada, las alertas, Operación e Integridad
// tenían cada uno su lista de estados con strings que NO existen ('EN PROCESO',
// 'COMPLETADA', 'ENTREGADA'…). El KPI "Órdenes abiertas" contaba solo POR
// ASIGNAR y el chequeo "entregadas sin firma" nunca fallaba. Este test amarra
// la lista del panel a los estados reales: los abiertos de PendientesDomain y
// la máquina completa de APP.ESTADOS (ordenes-state.js).
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PUB = path.join(__dirname, "..", "..", "public", "js");

function cargar(rel, global) {
  const src = fs.readFileSync(path.join(PUB, ...rel.split("/")), "utf8");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: rel });
  return sandbox.window[global];
}

const AM = cargar("domain/adminMetrics.js", "AdminMetrics");
const PD = cargar("domain/pendientes.js", "PendientesDomain");

// Valores de APP.ESTADOS leídos del fuente (ordenes-state.js toca el DOM al
// cargar; basta con los literales del bloque ESTADOS).
function estadosCanonicos() {
  const src = fs.readFileSync(path.join(PUB, "pages", "ordenes-state.js"), "utf8");
  const bloque = src.slice(src.indexOf("ESTADOS: {"), src.indexOf("},", src.indexOf("ESTADOS: {")));
  return [...bloque.matchAll(/^\s*[A-Z_]+:\s*'([^']+)'/gm)].map((m) => m[1]);
}

const o = (estado, extra) => Object.assign({ estado_reparacion: estado }, extra || {});

test("los abiertos del panel son los mismos que PendientesDomain", () => {
  assert.deepEqual([...AM.ESTADOS_ABIERTOS], [...PD.ESTADOS_ABIERTOS]);
  assert.equal(AM.ESTADO_COMPLETADO, PD.COMPLETADO);
});

test("abiertos + completado + cerrados cubren exactamente APP.ESTADOS", () => {
  const panel = [...AM.ESTADOS_ABIERTOS, AM.ESTADO_COMPLETADO, ...AM.ESTADOS_CERRADOS].sort();
  const canon = estadosCanonicos().sort();
  assert.ok(canon.length >= 10, "se leyeron los estados canónicos");
  assert.deepEqual(panel, canon);
});

test("esAbierta reconoce los estados reales (y no los inventados)", () => {
  for (const e of ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO", "asignado"]) {
    assert.equal(AM.esAbierta(o(e)), true, e);
  }
  for (const e of ["COMPLETADO (EN OFICINA)", "ENTREGADO AL CLIENTE", "CERRADA (VISITA)", "ANULADA",
                   "EN PROCESO", "DIAGNÓSTICO", "LISTA", "RECEPCIONADA", "", undefined]) {
    assert.equal(AM.esAbierta(o(e)), false, String(e));
  }
});

test("esEntregada y esCompletadaSinEntregar usan los strings reales", () => {
  assert.equal(AM.esEntregada(o("ENTREGADO AL CLIENTE")), true);
  assert.equal(AM.esEntregada(o("ENTREGADA")), false);
  assert.equal(AM.esCompletadaSinEntregar(o("COMPLETADO (EN OFICINA)")), true);
  assert.equal(AM.esCompletadaSinEntregar(o("COMPLETADA")), false);
  assert.equal(AM.esCerrada(o("CERRADA (SIN RETIRAR)")), true);
  assert.equal(AM.esFueraDeTaller(o("COMPLETADO (EN OFICINA)")), true);
  assert.equal(AM.esFueraDeTaller(o("ASIGNADO")), false);
});

test("contarOrdenesAbiertas omite eliminadas y DEVOLUCION", () => {
  const n = AM.contarOrdenesAbiertas([
    o("POR ASIGNAR"), o("RECIBIDO EN MOSTRADOR"), o("ASIGNADO"),
    o("ASIGNADO", { eliminado: true }),
    o("POR ASIGNAR", { tipo_de_servicio: "DEVOLUCION" }),
    o("COMPLETADO (EN OFICINA)"), o("ENTREGADO AL CLIENTE"),
  ]);
  assert.equal(n, 3);
});

test("cotizaciones por vencer no incluye las vencidas", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const hace = (d) => new Date(now.getTime() - d * 864e5).toISOString();
  const r = AM.contarCotizacionesPorVencer([
    { estado: "enviada", fecha: hace(10), validezDias: 15 },  // vence en 5
    { estado: "aprobada", fecha: hace(20), validezDias: 15 }, // vencida
    { estado: "enviada", fecha: hace(1), validezDias: 30 },   // lejos
    { estado: "borrador", fecha: hace(14), validezDias: 15 },
    { estado: "enviada", fecha: hace(14), validezDias: 15, deleted: true },
  ], now);
  assert.deepEqual({ ...r }, { porVencer: 1, vencidas: 1, enviadas: 2 });
});

test("mensaje de alerta legible", () => {
  const [t] = AM.evaluateAlertas(
    [{ id: "a", kind: "ordenes_abiertas_gt", threshold: 50 }], { ordenes_abiertas: 52 });
  assert.equal(t.message, "Hay 52 órdenes abiertas; el máximo es 50.");
});

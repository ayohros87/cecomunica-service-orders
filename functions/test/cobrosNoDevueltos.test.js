// Guardia del módulo de equipos no devueltos.
// Plan: docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md.
//
// Las reglas de negocio existen DUPLICADAS a propósito (no hay build step que
// comparta código entre navegador y functions):
//   · functions/src/lib/cobrosEquipos.js              (trigger + cron)
//   · public/js/services/cobrosEquiposService.js      (bandeja)
// Si divergen, el MISMO renglón se lee distinto según quién lo mire: el trigger
// lo abre con un umbral y la bandeja lo cobra con otro. Este test evalúa el
// archivo del navegador en un sandbox y compara ambas implementaciones.
//
// También fija el estado nuevo del pool en sus dos copias: un equipo no
// devuelto que quede como `en_cliente` en un lado y `pendiente_cobro` en el
// otro es exactamente el agujero que este módulo vino a tapar.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-sync" });
const backend = require("../src/lib/cobrosEquipos");
const pool = require("../src/domain/equiposPool");

function cargarFrontend(rel, global) {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", ...rel), "utf8");
  const sandbox = { window: {}, firebase: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: rel[rel.length - 1] });
  return sandbox.window[global];
}
const front = cargarFrontend(["services", "cobrosEquiposService.js"], "CobrosEquiposService");
const poolFront = cargarFrontend(["services", "equiposPoolService.js"], "EquiposPoolService");

test("el estado pendiente_cobro existe en las dos copias del pool", () => {
  assert.equal(pool.ESTADOS.PENDIENTE_COBRO, "pendiente_cobro");
  assert.equal(poolFront.ESTADOS.PENDIENTE_COBRO, "pendiente_cobro");
  // Sin etiqueta el chip se pinta con el valor crudo del campo.
  assert.ok(poolFront.ESTADO_LABELS.pendiente_cobro,
    "pendiente_cobro necesita etiqueta en ESTADO_LABELS");
});

test("el umbral de descuento y el plazo a cobranza no divergen", () => {
  assert.equal(backend.DESCUENTO_LIBRE_PCT, front.DESCUENTO_LIBRE_PCT);
  assert.equal(backend.DIAS_A_COBRANZA, front.DIAS_A_COBRANZA);
  // Reglas decididas con el usuario el 2026-08-20: cambiarlas es una decisión
  // de negocio, no un refactor.
  assert.equal(backend.DESCUENTO_LIBRE_PCT, 15);
  assert.equal(backend.DIAS_A_COBRANZA, 10);
});

test("las etapas del renglón son las mismas de los dos lados", () => {
  assert.deepEqual(Object.keys(backend.ETAPAS).sort(), Object.keys(front.ETAPAS).sort());
  for (const k of Object.keys(backend.ETAPAS)) {
    assert.equal(backend.ETAPAS[k], front.ETAPAS[k], `etapa ${k}`);
  }
  assert.deepEqual([...backend.ABIERTAS].sort(), [...front.ABIERTAS].sort());
  // Una etapa sin etiqueta sale cruda en la bandeja.
  for (const v of Object.values(front.ETAPAS)) {
    assert.ok(front.ETAPA_LABELS[v], `la etapa ${v} necesita etiqueta`);
  }
});

test("el descuento se calcula igual en el navegador y en el servidor", () => {
  const casos = [
    [100, 100, 0],      // sin descuento
    [100, 85, 15],      // justo en el margen libre
    [100, 84, 16],      // un peso más ya lo pasa
    [200, 0, 100],      // condonación total
    [0, 50, 0],         // sin precio de catálogo no hay contra qué comparar
    [null, 50, 0],
    [100, 120, 0],      // cobrar de MÁS no es descuento negativo
    [99.99, 50, 49.99],
  ];
  for (const [cat, unit, esperado] of casos) {
    assert.equal(backend.descuentoPct(cat, unit), esperado, `backend ${cat}→${unit}`);
    assert.equal(front.descuentoPct(cat, unit), esperado, `front ${cat}→${unit}`);
  }
});

test("solo pasa el umbral lo que de verdad lo pasa", () => {
  assert.equal(front.requiereAprobacion(100, 85), false, "15% es el margen libre");
  assert.equal(front.requiereAprobacion(100, 84.99), true, "por encima del 15% pide aprobación");
  assert.equal(front.requiereAprobacion(100, 0), true, "condonar por monto pide aprobación");
  // Sin precio de catálogo el descuento es 0: no se puede exigir aprobación
  // contra una referencia que no existe (la línea se marca sin_referencia).
  assert.equal(front.requiereAprobacion(null, 0), false);
});

test("parcial y vendido no son deudas; perdido y otro sí", () => {
  assert.deepEqual([...backend.MOTIVOS_COBRABLES].sort(), ["otro", "perdido"]);
  assert.equal(backend.MOTIVOS_COBRABLES.includes("parcial"), false,
    "renovación parcial: el equipo sigue en servicio, no hay nada que cobrar");
  assert.equal(backend.MOTIVOS_COBRABLES.includes("vendido"), false,
    "ya se vendió: la venta ocurrió, no es una deuda que perseguir");
});

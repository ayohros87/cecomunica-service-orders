// Modalidad de servicio en las cotizaciones (pedido de Elvia, 2026-11-25).
//
// La cotización solo conocía Venta (pago único) y Alquiler (mensual). La
// activación salía "Venta", los renglones de texto a $0 también, y los
// servicios mensuales (GPS, consola, frecuencia) se cotizaban como venta y se
// sumaban como un pago único. Ahora hay cuatro modalidades, en el mismo idioma
// del contrato (equipo vs. otros conceptos Único/Mensual):
//   venta · alquiler · servicio_unico · servicio_mensual
//
// Lo que congela este archivo:
//   A — cada modalidad cae en el bucket correcto (único vs. mensual) y lo viejo
//       calcula igual.
//   B — rótulos: "Incluido" para $0 con cantidad, nada para renglones de texto.
//   C — el documento del cliente: columna de modalidad, renglones de texto
//       limpios, "/mes" en el servicio mensual.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");

function cargarTotales() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ctx.window.FMT = {
    round2: (n) => Math.round(Number(n || 0) * 100) / 100,
    money: (n) => "$" + Number(n || 0).toFixed(2),
    esc: (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])),
  };
  ctx.FMT = ctx.window.FMT;
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "cotizacionesTotales.js"), "utf8"), ctx);
  return ctx.window.CotizacionTotales;
}
const T = cargarTotales();
const Back = require("../src/domain/cotizacionesTotales.js");

// La cotización del hotel de la captura de Elvia, con la activación ya como
// servicio y un monitoreo mensual para cubrir los cuatro casos.
const HOTEL = {
  itbmsPct: 0, plazoMeses: 36,
  items: [
    { nombre: "RADIOS KENWOOD NX-420", cant: 45, precio: 30, modalidad: "alquiler" },
    { nombre: "ACTIVACION", cant: 45, precio: 30, modalidad: "servicio_unico" },
    { nombre: "Sistema de repetidoras NXR-800", cant: 0, precio: 0, modalidad: "venta" },
    { nombre: "SERVICIO INCLUYE: mantenimiento…", cant: 0, precio: 0, modalidad: "venta" },
    { nombre: "Monitoreo remoto", cant: 1, precio: 50, modalidad: "servicio_mensual" },
    { nombre: "Cargador (INCLUIDO)", cant: 45, precio: 0, modalidad: "venta" },
  ],
};

// ── A — buckets ───────────────────────────────────────────────────────────
test("A1 · servicio único suma al pago único; servicio mensual a la mensualidad", () => {
  const t = T.calcTotales(HOTEL);
  assert.equal(t.venta.total, 1350, "activación 45 × $30, una vez");
  assert.equal(t.alquiler.total, 1400, "radios $1,350 + monitoreo $50, cada mes");
  assert.equal(t.hayAlquiler, true);
  assert.equal(t.conModalidad, true);
});

test("A2 · un servicio mensual SOLO también se proyecta a 12 meses en la política", () => {
  const t = T.calcTotales({ itbmsPct: 0, items: [{ cant: 1, precio: 12, modalidad: "servicio_mensual" }] });
  assert.equal(t.alquiler.total, 12);
  assert.equal(t.total, 144, "12 × $12: antes, como 'venta', valía $12 para la política");
});

test("A3 · modalidad ausente o desconocida = venta (lo viejo no cambia)", () => {
  assert.equal(T.modalidadDe({}), "venta");
  assert.equal(T.modalidadDe({ modalidad: "otros" }), "venta");
  assert.equal(T.modalidadDe({ modalidad: "servicio_unico" }), "servicio_unico");
  assert.equal(T.esMensual({ modalidad: "servicio_mensual" }), true);
  assert.equal(T.esMensual({ modalidad: "servicio_unico" }), false);
  assert.equal(T.esAlquiler({ modalidad: "servicio_mensual" }), true, "alias histórico = mensual");
});

test("A4 · navegador y functions dan el mismo veredicto con servicios", () => {
  const POL = { descuentoMaxPct: 20, totalMax: 15000 };
  const casos = [
    HOTEL,
    { itbmsPct: 7, items: [{ cant: 100, precio: 120, modalidad: "servicio_mensual" }] },
    { itbmsPct: 7, items: [{ cant: 1, precio: 14000, modalidad: "servicio_unico" }, { cant: 1, precio: 100, modalidad: "servicio_mensual" }] },
  ];
  for (const c of casos) {
    const a = T.evaluarPolitica(c, POL);
    const b = Back.evaluarPolitica(c, POL);
    assert.equal(a.requiere, b.requiere);
    assert.equal(a.totales.total, b.totales.total);
  }
});

test("A5 · una cotización de pura venta no lleva columna de modalidad", () => {
  assert.equal(T.conModalidad([{ cant: 1, precio: 10 }, { cant: 0, precio: 0, modalidad: "servicio_mensual" }]), false,
    "un renglón de texto no cuenta, aunque traiga modalidad");
  assert.equal(T.conModalidad([{ cant: 1, precio: 10 }, { cant: 1, precio: 25, modalidad: "servicio_unico" }]), true);
});

// ── B — rótulos ───────────────────────────────────────────────────────────
test("B1 · rótulos de cada modalidad, Incluido y texto", () => {
  assert.equal(T.etiquetaModalidad({ cant: 1, precio: 5 }), "Venta");
  assert.equal(T.etiquetaModalidad({ cant: 1, precio: 5, modalidad: "alquiler" }), "Alquiler");
  assert.equal(T.etiquetaModalidad({ cant: 1, precio: 5, modalidad: "servicio_unico" }), "Servicio único");
  assert.equal(T.etiquetaModalidad({ cant: 1, precio: 5, modalidad: "servicio_mensual" }), "Servicio mensual");
  assert.equal(T.etiquetaModalidad({ cant: 3, precio: 0 }), "Incluido");
  assert.equal(T.etiquetaModalidad({ cant: 0, precio: 0 }), "");
  assert.equal(T.claseModalidad({ cant: 3, precio: 0, modalidad: "alquiler" }), "es-incluido");
  assert.equal(T.claseModalidad({ cant: 3, precio: 9, modalidad: "servicio_mensual" }), "es-servicio_mensual");
});

// ── C — documento del cliente ─────────────────────────────────────────────
test("C1 · el documento rotula cada renglón y deja limpios los de texto", () => {
  const html = T.filasPorEquipoHtml(HOTEL.items, { conModalidad: true });
  assert.ok(html.includes('class="c cq-mod">Servicio único<'), "la activación ya no dice Venta");
  assert.ok(html.includes('class="c cq-mod">Servicio mensual<'));
  assert.ok(html.includes('class="c cq-mod">Incluido<'));
  assert.ok(!/cq-mod">Venta</.test(html), "ningún renglón de la captura dice Venta");
  // Los dos renglones de texto: sin cantidad, sin $0.00 y sin modalidad.
  const textos = html.split("<tr").filter((f) => f.startsWith(' class="cq-texto"'));
  assert.equal(textos.length, 2);
  textos.forEach((f) => {
    assert.ok(!f.includes("$0.00"));
    assert.ok(f.includes('class="c cq-mod"></td>'));
  });
});

test("C2 · el servicio mensual lleva /mes; el único no", () => {
  const html = T.filasPorEquipoHtml([
    { nombre: "GPS", cant: 2, precio: 12, modalidad: "servicio_mensual" },
    { nombre: "Instalación", cant: 2, precio: 25, modalidad: "servicio_unico" },
  ], { conModalidad: true });
  const [, gps, inst] = html.split("<tr");
  assert.ok(gps.includes("/mes"));
  assert.ok(!inst.includes("/mes"));
});

test("C3 · sin columna de modalidad, el incluido dice Incluido en el total", () => {
  const html = T.filasPorEquipoHtml([{ nombre: "Batería", cant: 6, precio: 0 }], { conModalidad: false });
  assert.ok(html.includes(">Incluido<"));
  assert.ok(!html.includes("cq-mod"));
});

test("C4 · `hayAlquiler` sigue sirviendo de interruptor (espejos públicos viejos)", () => {
  const items = [{ nombre: "x", cant: 1, precio: 1 }];
  assert.ok(T.filasPorEquipoHtml(items, { hayAlquiler: true }).includes("cq-mod"));
  assert.ok(!T.filasPorEquipoHtml(items, { hayAlquiler: false }).includes("cq-mod"));
});

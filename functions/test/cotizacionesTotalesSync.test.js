// Guardia de sincronía de la política de envío de cotizaciones.
//
// El dominio existe DUPLICADO a propósito (no hay build step que comparta
// código entre navegador y functions):
//   · public/js/domain/cotizacionesTotales.js    (editor, detalle, lista, rules vía flag)
//   · functions/src/domain/cotizacionesTotales.js (trigger onCotizacionPolitica)
// Si divergen, el navegador estampa un `requiere_aprobacion` y el servidor lo
// "corrige" con otra regla: cada guardado se pelearía con el trigger. Este
// test exige que el objeto literal sea byte a byte igual (solo la cabecera, el
// FMT local y el export cambian) y además evalúa el archivo del frontend en un
// sandbox y compara veredictos sobre un corpus. Si tocas uno, toca los dos.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BACK_PATH = path.join(__dirname, "..", "src", "domain", "cotizacionesTotales.js");
const FRONT_PATH = path.join(__dirname, "..", "..", "public", "js", "domain", "cotizacionesTotales.js");

const lf = (s) => s.replace(/\r\n/g, "\n");

// Objeto literal: desde la línea "…CotizacionTotales = {" hasta el "};" que lo
// cierra (el último del archivo en ambos casos).
function cuerpo(src, marca) {
  const s = lf(src);
  const i = s.indexOf(marca);
  assert.ok(i >= 0, `no encontré "${marca}"`);
  const desde = i + marca.length;
  const fin = s.lastIndexOf("\n};");
  assert.ok(fin > desde, "no encontré el cierre del objeto");
  return s.slice(desde, fin);
}

test("S1 · el objeto CotizacionTotales es byte a byte igual en functions y public", () => {
  const back = cuerpo(fs.readFileSync(BACK_PATH, "utf8"), "const CotizacionTotales = {\n");
  const front = cuerpo(fs.readFileSync(FRONT_PATH, "utf8"), "window.CotizacionTotales = {\n");
  assert.equal(back, front,
    "functions/src/domain/cotizacionesTotales.js y public/js/domain/cotizacionesTotales.js divergen: copia el objeto completo");
});

// ── Veredictos iguales sobre un corpus ────────────────────────────────────
const backend = require("../src/domain/cotizacionesTotales");

function cargarFrontend() {
  const src = fs.readFileSync(FRONT_PATH, "utf8");
  // El frontend toma FMT del global (core/formatting.js); aquí se le presta el
  // mismo trío que lleva la copia de functions.
  const FMT = {
    esc: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    money: (n) => Number(n || 0).toLocaleString("es-PA", { style: "currency", currency: "USD" }),
    round2: (n) => Math.round(Number(n || 0) * 100) / 100,
  };
  const sandbox = { window: {}, FMT, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "cotizacionesTotales.js" });
  return sandbox.window.CotizacionTotales;
}
const front = cargarFrontend();

const POLICIES = [
  undefined,
  { descuentoMaxPct: 15, totalMax: 5000 },
  { descuentoMaxPct: 0, totalMax: 0 },
  { descuentoMaxPct: 50, totalMax: 100000 },
  backend.policyFromConfig({ cotizacion_descuento_max_pct: "10", cotizacion_total_max: "2500" }),
  backend.policyFromConfig({}),
  backend.policyFromConfig(null),
];

const COTS = [
  null, {}, { items: [] },
  { items: [{ cant: 1, precio: 100 }], itbmsPct: 7 },
  { items: [{ cant: 1, precio: 100, desc: 40 }], itbmsPct: 7 },                 // desc por línea
  { items: [{ cant: 2, precio: 3000 }], descuentoPct: 20, itbmsPct: 7 },        // desc global + total
  { items: [{ cant: 10, precio: 1000 }], itbmsPct: 7 },                         // total
  { items: [{ cant: 1, precio: 400, modalidad: "alquiler" }], itbmsPct: 7 },   // alquiler sin plazo → 12 meses
  { items: [{ cant: 1, precio: 400, modalidad: "alquiler" }], plazoMeses: 36, itbmsPct: 7 },
  { items: [{ cant: 1, precio: 100, modalidad: "alquiler" }, { cant: 1, precio: 3000 }], plazoMeses: 6, itbmsPct: 7 },
  { total: 9999 },                                                              // sin items: manda el total del doc
  { items: [{ cant: 1, precio: 100 }], total: 9999, itbmsPct: 7 },              // total del doc mayor que el recalculado
  { items: [{ cant: "3", precio: "12.5", desc: "16" }], descuentoPct: "0", itbmsPct: "7" },
];

test("S2 · mismos veredictos y totales en functions y public sobre el corpus", () => {
  for (const pol of POLICIES) {
    for (const cot of COTS) {
      const a = backend.evaluarPolitica(cot, pol);
      const b = front.evaluarPolitica(cot, pol);
      // JSON de por medio: el sandbox tiene su propio Array, y deepEqual
      // estricto distingue realms aunque el contenido sea idéntico.
      const plano = (r) => JSON.parse(JSON.stringify(
        { requiere: r.requiere, motivos: r.motivos, total: r.totales.total, meses: r.totales.mesesComputables }));
      assert.deepEqual(plano(a), plano(b),
        `divergen para ${JSON.stringify(cot)} con ${JSON.stringify(pol)}`);
    }
  }
});

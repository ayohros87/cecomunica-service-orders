// Totales y política de envío de cotizaciones — el módulo puro que decide si
// un vendedor manda la propuesta al cliente él mismo o si necesita aprobación.
//
// Hasta esta ola el módulo no tenía pruebas, y acumulaba tres reglas que se
// pisan entre sí:
//   A10 — el descuento POR RENGLÓN cuenta para el umbral, no solo el global.
//         (40% en cada línea con total bajo el techo salía sin aprobación.)
//   Modalidad por renglón — venta (pago único) y alquiler (mensualidad) en el
//         mismo documento, con DOS totales que no se pueden sumar.
//   Techo a 12 meses — el número comparable proyecta el alquiler a un máximo
//         de 12 meses: 36 meses de flota no debe mandar todo a aprobación,
//         pero una mensualidad grande sí tiene que caer.
//
// La invariante que protege todo lo anterior: una cotización SIN modalidad en
// sus renglones (todas las que existen hoy) tiene que calcular exactamente
// igual que antes del cambio. Si eso se rompe, el listado, los KPI de Finanzas
// y firestore.rules empiezan a leer otro número sin que nadie migre nada.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarTotales() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  ctx.window.FMT = {
    round2: (n) => Math.round(Number(n || 0) * 100) / 100,
    money: (n) => "$" + Number(n || 0).toFixed(2),
  };
  ctx.FMT = ctx.window.FMT;
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  return ctx.window.CotizacionTotales;
}

const T = cargarTotales();

// Política viva en empresa/config al 18-ago-2026.
const POL = { descuentoMaxPct: 20, totalMax: 15000 };

const alq = (o) => ({ ...o, modalidad: "alquiler" });

// ── Retrocompatibilidad ────────────────────────────────────────────────────

test("una cotización sin modalidad calcula igual que antes del cambio", () => {
  const cot = { items: [{ cant: 4, precio: 985, desc: 0 }], descuentoPct: 0, itbmsPct: 7 };
  const t = T.calcTotales(cot);
  assert.equal(t.subtotal, 3940);
  assert.equal(t.base, 3940);
  assert.equal(t.itbms, 275.8);
  assert.equal(t.total, 4215.8);
  // No hay alquiler: nada que proyectar, el plazo es irrelevante.
  assert.equal(t.hayAlquiler, false);
  assert.equal(t.mesesComputables, 0);
  assert.equal(t.valorEvaluado, t.total);
});

test("un renglón sin `modalidad` es venta, no alquiler", () => {
  const t = T.calcTotales({ items: [{ cant: 1, precio: 100 }], itbmsPct: 0 });
  assert.equal(t.venta.n, 1);
  assert.equal(t.alquiler.n, 0);
  assert.equal(T.modalidadDe({}), "venta");
  assert.equal(T.esAlquiler({ modalidad: "alquiler" }), true);
});

test("el descuento global sigue aplicando y el plazo no lo altera", () => {
  const cot = { items: [{ cant: 1, precio: 1000 }], descuentoPct: 10, itbmsPct: 7, plazoMeses: 36 };
  const t = T.calcTotales(cot);
  assert.equal(t.descGlobal, 100);
  assert.equal(t.base, 900);
  assert.equal(t.total, 963);
});

// ── Los dos buckets ────────────────────────────────────────────────────────

test("venta y alquiler se separan y el mensual no se suma al de una vez", () => {
  const cot = {
    items: [
      { cant: 4, precio: 985 },
      alq({ cant: 18, precio: 28 }),
      alq({ cant: 1, precio: 240, desc: 10 }),
    ],
    descuentoPct: 0, itbmsPct: 7, plazoMeses: 36,
  };
  const t = T.calcTotales(cot);

  assert.equal(t.venta.total, 4215.8);      // pago único
  assert.equal(t.alquiler.subtotal, 720);   // 504 + 216
  assert.equal(t.alquiler.descLineas, 24);  // el 10% del renglón de 240
  assert.equal(t.alquiler.total, 770.4);    // POR MES
  assert.equal(t.esMixta, true);
});

test("el compromiso usa el plazo REAL; el valor evaluado corta en 12 meses", () => {
  const cot = { items: [alq({ cant: 1, precio: 1000 })], itbmsPct: 0, plazoMeses: 36 };
  const t = T.calcTotales(cot);
  assert.equal(t.plazoMeses, 36);
  assert.equal(t.compromiso, 36000);       // informativo
  assert.equal(t.mesesComputables, 12);    // tope
  assert.equal(t.valorEvaluado, 12000);    // lo que compara la política
});

test("un plazo menor a 12 meses se cuenta completo", () => {
  const t = T.calcTotales({ items: [alq({ cant: 1, precio: 1400 })], itbmsPct: 0, plazoMeses: 6 });
  assert.equal(t.mesesComputables, 6);
  assert.equal(t.valorEvaluado, 8400);
  assert.equal(t.compromiso, 8400);
});

test("alquiler sin plazo declarado se evalúa al tope, no en cero", () => {
  // Falla CERRADO: olvidar el plazo no puede abrir un hueco por el que pase
  // cualquier mensualidad sin aprobación.
  const t = T.calcTotales({ items: [alq({ cant: 1, precio: 2000 })], itbmsPct: 0 });
  assert.equal(t.plazoMeses, 0);
  assert.equal(t.mesesComputables, 12);
  assert.equal(t.valorEvaluado, 24000);
});

test("los campos planos mantienen base + itbms = total", () => {
  const cot = {
    items: [{ cant: 4, precio: 985 }, alq({ cant: 18, precio: 28 }), alq({ cant: 1, precio: 240, desc: 10 })],
    descuentoPct: 0, itbmsPct: 7, plazoMeses: 36,
  };
  const t = T.calcTotales(cot);
  assert.equal(t.base, 12580);      // 3940 + 720×12
  assert.equal(t.itbms, 880.6);     // 275.80 + 50.40×12
  assert.equal(t.total, 13460.6);
  assert.equal(Math.round((t.base + t.itbms) * 100) / 100, t.total);
});

// ── Política de envío ──────────────────────────────────────────────────────

test("la tabla de casos del techo de $15,000", () => {
  const casos = [
    ["venta de 12 bases",      { items: [{ cant: 1, precio: 12400 }], itbmsPct: 0 },                             12400,  false],
    ["flota chica 36 meses",   { items: [alq({ cant: 1, precio: 400 })], itbmsPct: 0, plazoMeses: 36 },           4800,  false],
    ["flota grande 36 meses",  { items: [alq({ cant: 1, precio: 1400 })], itbmsPct: 0, plazoMeses: 36 },         16800,   true],
    ["evento 6 meses",         { items: [alq({ cant: 1, precio: 1400 })], itbmsPct: 0, plazoMeses: 6 },           8400,  false],
    ["mixta grande",           { items: [{ cant: 1, precio: 9000 }, alq({ cant: 1, precio: 700 })], itbmsPct: 0, plazoMeses: 24 }, 17400, true],
  ];
  for (const [nombre, cot, esperado, requiere] of casos) {
    const r = T.evaluarPolitica(cot, POL);
    assert.equal(r.totales.valorEvaluado, esperado, `${nombre}: valor evaluado`);
    assert.equal(r.requiere, requiere, `${nombre}: ¿requiere aprobación?`);
  }
});

test("el motivo del techo enseña la cuenta cuando hay alquiler", () => {
  const r = T.evaluarPolitica(
    { items: [{ cant: 1, precio: 9000 }, alq({ cant: 1, precio: 700 })], itbmsPct: 0, plazoMeses: 24 }, POL);
  const m = r.motivos.join(" ");
  assert.match(m, /\$700\.00\/mes × 12 meses/);
  assert.match(m, /\$9000\.00 de venta/);
});

test("una venta pura no habla de meses en el motivo", () => {
  const r = T.evaluarPolitica({ items: [{ cant: 1, precio: 20000 }], itbmsPct: 0 }, POL);
  assert.equal(r.requiere, true);
  assert.doesNotMatch(r.motivos.join(" "), /mes/);
});

test("A10 · el descuento por renglón manda aunque el total sea chico", () => {
  const r = T.evaluarPolitica({ items: [{ cant: 2, precio: 200, desc: 25 }], itbmsPct: 7 }, POL);
  assert.equal(r.requiere, true);
  assert.match(r.motivos[0], /25% de descuento/);
});

test("A10 · exactamente en el umbral NO requiere aprobación", () => {
  const r = T.evaluarPolitica({ items: [{ cant: 2, precio: 200, desc: 20 }], itbmsPct: 7 }, POL);
  assert.equal(r.requiere, false);
});

test("el descuento por renglón de un alquiler también cuenta", () => {
  const r = T.evaluarPolitica(
    { items: [alq({ cant: 1, precio: 100, desc: 30 })], itbmsPct: 0, plazoMeses: 12 }, POL);
  assert.equal(r.requiere, true);
  assert.match(r.motivos[0], /30% de descuento/);
});

test("evaluarPolitica pasa los items solo — no se le puede olvidar", () => {
  // Regresión: los llamadores armaban el input a mano y tres de ellos omitían
  // `items`, así que el listado y el detalle ofrecían "Enviar al cliente" para
  // un borrador que el editor ya había mandado a aprobación.
  const cot = { items: [{ cant: 1, precio: 10, desc: 40 }], itbmsPct: 0 };
  assert.equal(T.evaluarPolitica(cot, POL).requiere, true);
});

test("los defaults fallan CERRADO si Firestore no responde", () => {
  // Sin política explícita se usan los literales del módulo (15% / $5,000),
  // más estrictos que los valores vivos: una caída no puede soltar aprobaciones.
  const r = T.evaluarPolitica({ items: [{ cant: 1, precio: 8000 }], itbmsPct: 0 }, null);
  assert.equal(r.requiere, true);
});

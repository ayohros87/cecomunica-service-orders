// Cuadro "Trámite" del correo de OS de programación (Brenda, 2026-09-08):
// recepción debe poder leer qué trámite es, a qué contrato y de qué tipo.
// Corre con: node --test (desde functions/).
const test = require("node:test");
const assert = require("node:assert/strict");

// lib/admin inicializa firebase-admin al cargarse; tramiteResumen es puro,
// así que basta con un stub (mismo patrón que facturacionAvisos.test.js).
const Module = require("module");
const origLoad = Module._load;
Module._load = function (req, parent) {
  // gestiones, inventario y mailRecipients cargan ./admin: se stubea para todos.
  if (req === "./admin" && parent && /[\\/]src[\\/]lib[\\/]/.test(parent.filename)) {
    return { admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} };
  }
  return origLoad.apply(this, arguments);
};
const G = require("../src/lib/gestiones");
Module._load = origLoad;

test("tipoContratoDeNumero: el prefijo del número dice el tipo", () => {
  // Los contratos del Centro nacen SERV: la modalidad va por línea.
  assert.equal(G.tipoContratoDeNumero("SERV20260908-01"), "Servicio (la modalidad va por línea)");
  assert.equal(G.tipoContratoDeNumero("ALQ20230529-01"), "Alquiler (histórico)");
  assert.equal(G.tipoContratoDeNumero("PROP20260727-02"), "Equipos propios del cliente (histórico)");
  assert.equal(G.tipoContratoDeNumero("temp20260901-01"), "Temporal (evento)");
  assert.equal(G.tipoContratoDeNumero("ALQ 2019-044"), "Alquiler (histórico)");
  assert.equal(G.tipoContratoDeNumero("2019-044"), null);
  assert.equal(G.tipoContratoDeNumero(""), null);
  assert.equal(G.tipoContratoDeNumero(null), null);
});

test("aumento a contrato vigente: adición + contrato con tipo + modalidad + vigencia", () => {
  const r = G.tramiteResumen("GA20260902-04", {
    tipo: "aumento", cliente_id: "c1",
    aumento: { contrato_id: "ALQ20260701-01", contrato_doc_id: "abc", duracion_meses: 18,
      lineas: [{ modelo: "HYTERA PNC360S", cantidad: 3, modalidad: "alquiler" }] },
  });
  assert.match(r.titulo, /ADICIÓN DE EQUIPOS — anexo a contrato vigente/);
  const filas = Object.fromEntries(r.filas);
  assert.equal(filas.Contrato, "ALQ20260701-01 — Alquiler (histórico)");
  assert.equal(filas.Modalidad, "3 equipo(s) nuevo(s) en alquiler");
  assert.equal(filas["Vigencia del tramo"], "18 meses desde la entrega");
  assert.match(r.html, /Trámite: ADICIÓN DE EQUIPOS/);
  assert.match(r.html, /g=GA20260902-04/);
});

test("adenda a contrato en papel: se dice explícito y no se inventa el tipo", () => {
  const r = G.tramiteResumen("GA20260907-01", {
    tipo: "aumento",
    aumento: { contrato_papel: true, contrato_doc_id: null, contrato_id: "2019-044",
      lineas: [{ modelo: "PNC360S-R", cantidad: 1 }] },
  });
  assert.match(r.titulo, /adenda a contrato en papel/);
  const filas = Object.fromEntries(r.filas);
  assert.equal(filas.Contrato, "2019-044 (contrato en papel, fuera del sistema)");
  assert.equal(filas.Modalidad, "1 equipo(s) nuevo(s) en alquiler");
  assert.equal("Vigencia del tramo" in filas, false);
});

test("aumento mixto: alquiler y equipos propios del cliente se cuentan aparte", () => {
  const r = G.tramiteResumen("GA1", {
    tipo: "aumento",
    aumento: { contrato_id: "PROP20260727-02", contrato_doc_id: "x",
      lineas: [{ cantidad: 2, modalidad: "propio" }, { cantidad: 1, modalidad: "alquiler" }] },
  });
  const filas = Object.fromEntries(r.filas);
  assert.equal(filas.Contrato, "PROP20260727-02 — Equipos propios del cliente (histórico)");
  assert.equal(filas.Modalidad, "1 en alquiler + 2 propio(s) del cliente");
  const r2 = G.tramiteResumen("GA2", { tipo: "aumento",
    aumento: { contrato_id: "PROP1", contrato_doc_id: "x", lineas: [{ cantidad: 2, modalidad: "propio" }] } });
  assert.equal(Object.fromEntries(r2.filas).Modalidad, "2 equipo(s) propio(s) del cliente (servicio)");
});

test("reemplazo: contratos únicos de los ítems; custodia cuando no hay", () => {
  const r = G.tramiteResumen("GR1", { tipo: "reemplazo", items: [
    { contrato_id: "ALQ20230529-01" }, { contrato_id: "ALQ20230529-01" }, { contrato_id: "PROP20260727-02" },
  ] });
  assert.match(r.titulo, /REEMPLAZO/);
  const filas = Object.fromEntries(r.filas);
  assert.equal(filas["Contrato(s)"], "ALQ20230529-01 — Alquiler (histórico), PROP20260727-02 — Equipos propios del cliente (histórico)");
  assert.equal(filas.Equipos, "3 radio(s) sustituido(s) — cada uno indica el serial saliente");
  const r2 = G.tramiteResumen("GR2", { tipo: "reemplazo", items: [{}] });
  assert.equal(Object.fromEntries(r2.filas)["Contrato(s)"], "sin contrato interno (equipo en custodia)");
});

test("cuenta_regularizacion (plan F1): fila Cuenta solo cuando hay deuda", () => {
  const base = { tipo: "aumento", aumento: { contrato_id: "SERV1", contrato_doc_id: "x", lineas: [{ cantidad: 1 }] } };
  assert.equal("Cuenta" in Object.fromEntries(G.tramiteResumen("GA1", base).filas), false);
  assert.equal("Cuenta" in Object.fromEntries(G.tramiteResumen("GA1", { ...base, cuenta_regularizacion: { nivel: "al_dia", puntos: 0 } }).filas), false);
  const r = G.tramiteResumen("GA1", { ...base, cuenta_regularizacion: { nivel: "por_regularizar", puntos: 131, puntual_n: 3 } });
  assert.equal(Object.fromEntries(r.filas).Cuenta, "POR REGULARIZAR · 131 punto(s) · gestión puntual #3");
  const r2 = G.tramiteResumen("GA1", { ...base, cuenta_regularizacion: { nivel: "critica", puntos: 120 } });
  assert.equal(Object.fromEntries(r2.filas).Cuenta, "SIN REGULARIZAR (crítica) · 120 punto(s)");
});

test("demo: sin contrato ni facturación; escapa HTML de los datos", () => {
  const r = G.tramiteResumen("GD1", { tipo: "demo", demo: { fecha_devolucion_estimada: "2026-09-20" } });
  assert.match(r.titulo, /DEMO — sin contrato ni facturación/);
  assert.equal(Object.fromEntries(r.filas)["Devolución estimada"], "2026-09-20");
  const r2 = G.tramiteResumen("GA3", { tipo: "aumento", aumento: { contrato_id: "<b>x</b>", contrato_doc_id: "d" } });
  assert.doesNotMatch(r2.html, /<b>x<\/b>/);
  assert.match(r2.html, /&lt;b&gt;x&lt;\/b&gt;/);
});

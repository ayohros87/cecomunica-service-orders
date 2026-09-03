// Validación del representante legal al confeccionar contratos (Zuleika,
// 2026-09-03): contratos confeccionados y luego ANULADOS porque el
// representante registrado ya no era el vigente. La vista previa del
// formulario clásico exige marcar que se validó con el cliente, con una línea
// de contexto (última validación / último cambio en el historial de la ficha).
//
// Aquí se prueba la lógica PURA (public/js/domain/repValidacion.js) y, como
// espejo de sincronía, que las tres puntas del candado sigan existiendo:
// el check en la vista previa, el segundo candado en nc-guardar y el campo
// opcional en contratoTarifario.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarRepValidacion() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "repValidacion.js"), ctx);
  return ctx.window.RepValidacion;
}

const DIA = 86400000;
const AHORA = 1756900000000; // fijo: los textos "hace N" no dependen del reloj

test("ultimoCambio: encuentra la edición más reciente que tocó al representante", () => {
  const RV = cargarRepValidacion();
  const hist = [
    { tipo: "edicion", campos: ["telefono"], por_email: "a@x.com", at: AHORA - 1 * DIA },
    { tipo: "edicion", campos: ["representante", "representante_cedula"], por_email: "b@x.com", at: AHORA - 5 * DIA },
    { tipo: "edicion", campos: ["representante"], por_email: "c@x.com", at: AHORA - 90 * DIA },
    { tipo: "alta", nombre: "ACME", at: AHORA - 400 * DIA },
  ];
  const c = RV.ultimoCambio(hist);
  assert.equal(c.por_email, "b@x.com");
  assert.equal(c.atMs, AHORA - 5 * DIA);
});

test("ultimoCambio: sin ediciones del representante no inventa nada", () => {
  const RV = cargarRepValidacion();
  assert.equal(RV.ultimoCambio([]), null);
  assert.equal(RV.ultimoCambio([{ tipo: "edicion", campos: ["email"], at: AHORA }]), null);
  assert.equal(RV.ultimoCambio([{ tipo: "alta", at: AHORA }]), null);
  assert.equal(RV.ultimoCambio(null), null);
});

test("ultimoCambio: acepta Timestamp de Firestore (toMillis)", () => {
  const RV = cargarRepValidacion();
  const at = { toMillis: () => AHORA - 3 * DIA };
  const c = RV.ultimoCambio([{ tipo: "edicion", campos: ["representante"], at }]);
  assert.equal(c.atMs, AHORA - 3 * DIA);
});

test("ultimaValidacion: solo cuenta si validó EL MISMO nombre registrado hoy", () => {
  const RV = cargarRepValidacion();
  const base = { representante: "MIGUEL RAMON TABOADA" };
  // Mismo nombre (espacios y mayúsculas no importan) → cuenta.
  const ok = RV.ultimaValidacion({
    ...base,
    representante_validacion: { valor: "  miguel ramon  taboada ", por_email: "v@x.com", at: AHORA - 10 * DIA },
  });
  assert.equal(ok.por_email, "v@x.com");
  // El representante cambió después de la validación → NO cuenta.
  assert.equal(RV.ultimaValidacion({
    ...base,
    representante_validacion: { valor: "OTRO NOMBRE", at: AHORA - 10 * DIA },
  }), null);
  assert.equal(RV.ultimaValidacion(base), null);
  assert.equal(RV.ultimaValidacion(null), null);
});

test("haceTexto: hoy / ayer / días / meses / años", () => {
  const RV = cargarRepValidacion();
  assert.equal(RV.haceTexto(AHORA, AHORA), "hoy");
  assert.equal(RV.haceTexto(AHORA - 1 * DIA, AHORA), "ayer");
  assert.equal(RV.haceTexto(AHORA - 15 * DIA, AHORA), "hace 15 días");
  assert.equal(RV.haceTexto(AHORA - 95 * DIA, AHORA), "hace 3 meses");
  assert.equal(RV.haceTexto(AHORA - 800 * DIA, AHORA), "hace 2 años");
  assert.equal(RV.haceTexto(null, AHORA), "");
});

test("resumen: la validación vigente manda sobre el cambio del historial", () => {
  const RV = cargarRepValidacion();
  const cliente = {
    representante: "ABEL MENA",
    representante_validacion: { valor: "ABEL MENA", por_email: "v@x.com", at: AHORA - 20 * DIA },
  };
  const hist = [{ tipo: "edicion", campos: ["representante"], por_email: "e@x.com", at: AHORA - 5 * DIA }];
  const r = RV.resumen(cliente, hist, AHORA);
  assert.equal(r.tono, "ok");
  assert.match(r.texto, /Validado por última vez hace 20 días \(v@x\.com\)/);
});

test("resumen: sin validación vigente cae al último cambio, y sin nada lo dice claro", () => {
  const RV = cargarRepValidacion();
  const soloCambio = RV.resumen(
    { representante: "ABEL MENA" },
    [{ tipo: "edicion", campos: ["representante"], por_email: "e@x.com", at: AHORA - 5 * DIA }],
    AHORA,
  );
  assert.equal(soloCambio.tono, "info");
  assert.match(soloCambio.texto, /Último cambio en la ficha: hace 5 días/);
  assert.match(soloCambio.texto, /Nadie lo ha validado/);

  const nada = RV.resumen({ representante: "ABEL MENA" }, [], AHORA);
  assert.equal(nada.tono, "info");
  assert.match(nada.texto, /Sin validaciones previas/);
});

test("construir: arma el objeto que viaja al contrato y a la ficha", () => {
  const RV = cargarRepValidacion();
  const v = RV.construir(
    { representante: " ABEL MENA ", representante_cedula: " 8-123-456 " },
    { uid: "u1", email: "v@x.com" },
  );
  // JSON round-trip: los objetos nacen dentro del vm y su Object.prototype
  // no es el del test — deepEqual estricto los rechazaría por eso.
  const plano = (o) => JSON.parse(JSON.stringify(o));
  assert.deepEqual(plano(v), { valor: "ABEL MENA", cedula: "8-123-456", por_uid: "u1", por_email: "v@x.com" });
  assert.deepEqual(plano(RV.construir(null, null)), { valor: "", cedula: "", por_uid: null, por_email: null });
});

// ── Espejo de sincronía: las tres puntas del candado existen ────────────────
// Si alguien quita el check de la vista previa, el segundo candado de
// nc-guardar o el passthrough del doc, este test lo grita.
test("espejo: vista previa, segundo candado y campo del doc siguen cableados", () => {
  const preview = leer("public", "js", "pages", "nc-preview.js");
  assert.match(preview, /chkRepValidado/, "nc-preview debe renderizar el check");
  assert.match(preview, /RepValidacion\.resumen/, "nc-preview debe pintar la línea de contexto");

  const guardar = leer("public", "js", "pages", "nc-guardar.js");
  assert.match(guardar, /chkRepValidado/, "nc-guardar debe re-verificar el check (segundo candado)");
  assert.match(guardar, /representante_validacion/, "nc-guardar debe pasar la validación al doc y a la ficha");

  const tarifario = leer("public", "js", "domain", "contratoTarifario.js");
  assert.match(tarifario, /representante_validacion/, "construirDoc debe aceptar el campo opcional");

  const html = leer("public", "contratos", "nuevo-contrato.html");
  assert.match(html, /repValidacion\.js/, "nuevo-contrato.html debe cargar el módulo de dominio");
});

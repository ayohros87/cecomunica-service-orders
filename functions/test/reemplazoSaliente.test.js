// Un REEMPLAZO se define por el RADIO que sustituye, no por el contrato de
// donde ese radio venía (js/domain/reemplazoSalientes.js, 2026-08-27).
//
// Caso que lo motivó — REEMP20260825-01 (SEGURIDAD IDEAL): el contrato decía en
// observaciones "Se reemplaza la radio con número de serie 24813A0527", texto
// que ningún proceso lee. El sistema solo guardaba el contrato de origen —y ese
// se lo había inventado un script— así que al confirmarse la entrega reclamó
// las DOS unidades de ese contrato (25O10A2994 y 25O10A2995, adicionadas en
// febrero) en vez del único radio sustituido, que además ya había vuelto.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargar() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "reemplazoSalientes.js"), ctx);
  return ctx.window.ReemplazoSalientes;
}

const u = (serial, extra = {}) => ({
  id: serial, serial, serial_norm: serial,
  estado: "en_cliente", propiedad: "cecomunica",
  modelo_label: "HYTERA PNC360S", modelo_id: "m1",
  asignacion: { contrato_id: "ALQ20260206-01", contrato_doc_id: "xmv" },
  ...extra,
});

// ── aplica ──────────────────────────────────────────────────────────────
test("aplica solo al REEMPLAZO", () => {
  const R = cargar();
  assert.equal(R.aplica({ codigo_tipo: "REEMP" }), true);
  assert.equal(R.aplica({ codigo_tipo: "ALQ", accion: "Renovación" }), false,
    "la renovación usa el plan de transición, no esta pregunta");
  assert.equal(R.aplica({ codigo_tipo: "ALQ", accion: "Adición" }), false);
  assert.equal(R.aplica(null), false);
});

// ── candidatas ──────────────────────────────────────────────────────────
test("candidatas — toda la flota nuestra del cliente, no solo la del original", () => {
  const R = cargar();
  const cands = R.candidatas([
    u("A1"),
    u("B2", { asignacion: { contrato_id: "OTRO-01", contrato_doc_id: "otro" } }),
    u("C3", { asignacion: {} }),   // sin contrato: el caso del original en papel
  ]);
  assert.deepEqual(cands.map(x => x.serial), ["A1", "B2", "C3"]);
});

test("candidatas incluye 'en_taller' — el radio dañado suele estar ya en reparación", () => {
  const R = cargar();
  // 24813A0527 llevaba 6 días en la OS 2026081905 cuando se vendió el reemplazo.
  const cands = R.candidatas([u("24813A0527", { estado: "en_taller" })]);
  assert.equal(cands.length, 1);
});

test("candidatas excluye bodega, descartadas y el equipo del cliente", () => {
  const R = cargar();
  const cands = R.candidatas([
    u("EN_BODEGA", { estado: "en_bodega" }),
    u("PROPIO", { propiedad: "cliente" }),
    u("VALIDA"),
  ]);
  assert.deepEqual(cands.map(x => x.serial), ["VALIDA"]);
});

// ── validar ─────────────────────────────────────────────────────────────
test("un REEMP sin saliente marcado no pasa", () => {
  const R = cargar();
  const v = R.validar({ codigo_tipo: "REEMP", seriales: [], candidatos: 4 });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, "falta_saliente");
});

test("con saliente marcado pasa", () => {
  const R = cargar();
  assert.equal(R.validar({ codigo_tipo: "REEMP", seriales: ["24813A0527"], candidatos: 4 }).ok, true);
});

test("el escape 'no se identifica' pasa — pero es una respuesta, no el default", () => {
  const R = cargar();
  assert.equal(R.validar({ codigo_tipo: "REEMP", sin_identificar: true, seriales: [], candidatos: 4 }).ok, true);
});

test("sin candidatos manda al escape en vez de exigir lo imposible", () => {
  const R = cargar();
  const v = R.validar({ codigo_tipo: "REEMP", seriales: [], candidatos: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.motivo, "sin_candidatos");
  assert.match(v.mensaje, /No se identifica/);
});

test("una renovación no pasa por esta validación", () => {
  const R = cargar();
  assert.equal(R.validar({ codigo_tipo: "ALQ", accion: "Renovación", seriales: [] }).ok, true);
});

// ── construir ───────────────────────────────────────────────────────────
test("construir guarda serial normalizado, ficha y modelo", () => {
  const R = cargar();
  const [x] = R.construir([u("24813A0527", { modelo_label: "HYTERA PNC360S-R", modelo_id: "x7h" })]);
  assert.equal(x.serial, "24813A0527");
  assert.equal(x.serial_norm, "24813A0527");
  assert.equal(x.pool_id, "24813A0527");
  assert.equal(x.modelo_id, "x7h");
  assert.equal(x.contrato_id, "ALQ20260206-01");
});

test("construir descarta filas sin serial y normaliza el ruido", () => {
  const R = cargar();
  const out = R.construir([{ serial: " 25o10a-2994 " }, { serial: "" }, {}]);
  assert.equal(out.length, 1);
  assert.equal(out[0].serial_norm, "25O10A2994");
});

// ── El caso real ────────────────────────────────────────────────────────
test("CASO SEGURIDAD IDEAL: el saliente correcto es el radio dañado, no la flota", () => {
  const R = cargar();
  // Lo que el cliente tenía el 2026-08-25, cuando se vendió el reemplazo.
  const flota = [
    u("25O10A2994"),                                  // adición de febrero
    u("25O10A2995"),                                  // adición de febrero
    u("24813A0527", { estado: "en_taller", modelo_label: "HYTERA PNC360S-R" }), // el dañado
  ];
  assert.equal(R.candidatas(flota).length, 3, "los tres se le ofrecen al vendedor");

  // Marcando solo el dañado, que es lo que decía la observación del contrato.
  const guardado = R.construir([flota[2]]);
  assert.deepEqual(guardado.map(x => x.serial), ["24813A0527"]);
  assert.equal(guardado.length, 1, "la devolución habría reclamado UN radio, no dos");
});

// ── Cableado ────────────────────────────────────────────────────────────
test("el formulario carga el dominio y usa su criterio", () => {
  const html = leer("public", "contratos", "nuevo-contrato.html");
  assert.ok(html.includes("domain/reemplazoSalientes.js"),
    "nuevo-contrato.html no carga js/domain/reemplazoSalientes.js");
  assert.ok(html.includes('id="reempBox"'), "falta el bloque del equipo saliente");

  const form = leer("public", "js", "pages", "nc-form.js");
  assert.ok(form.includes("ReemplazoSalientes.candidatas"), "nc-form no usa el dominio para las candidatas");
  const guardar = leer("public", "js", "pages", "nc-guardar.js");
  assert.ok(guardar.includes("reemplaza_seriales"), "nc-guardar no persiste reemplaza_seriales");
  assert.ok(guardar.includes("ReemplazoSalientes.validar"),
    "nc-guardar no revalida el saliente antes de reservar el correlativo");
  const preview = leer("public", "js", "pages", "nc-preview.js");
  assert.ok(preview.includes("validarReemp"), "nc-preview no bloquea el guardado sin saliente");

  const trigger = leer("functions", "src", "triggers", "contratos", "onEntregaTransicion.js");
  assert.ok(trigger.includes("reemplaza_seriales"),
    "onEntregaTransicion no consume el serial saliente — seguiría reclamando el contrato entero");
});

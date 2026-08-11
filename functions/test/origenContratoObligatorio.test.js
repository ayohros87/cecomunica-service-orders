// El vínculo al contrato original dejó de ser opcional en Renovación y
// Reemplazo (2026-08-11).
//
// Diagnóstico que lo motivó — REEMP20260811-01 (FUNDACION BENEFICA MAGEN DAVID
// ACADEMY): el contrato decía "las radios HYTERA P50 se reemplazarán por INRICO
// T338" y guardaba `origen_tipo: 'ninguno'`, sin apuntar a ningún original. Sin
// ese vínculo onEntregaTransicion corta en `!origenIds.length` — es el único que
// crea los mapeos de devolución y la orden de recuperación — y la pantalla de
// transición cae a "todos los equipos del cliente", que ofrecía 3 radios de
// contratos ajenos y escondía los 10 P50 a reclamar.
//
// No era un caso aislado: 67 de 74 contratos transicionables no-legacy sin
// origen, 0 de 25 renovaciones con origen, y 0 contratos con `transicion_auto_at`
// en toda la base (el auto-registro nunca corrió).
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");

function cargarOrigenContrato() {
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "origenContrato.js"), "utf8"), ctx);
  return ctx.window.OrigenContrato;
}

// El caso real, tal como el vendedor lo dejó.
const REEMP_REAL = {
  accion: "No Aplica", codigo_tipo: "REEMP",
  legacy: false, origen_ids: [], legacy_ref: "", candidatos: 5,
};

test("aplica — solo a contratos que nacen de otro", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.aplica({ accion: "Renovación", codigo_tipo: "ALQ" }), true);
  assert.equal(O.aplica({ accion: "Adición", codigo_tipo: "PROP" }), true);
  assert.equal(O.aplica({ accion: "No Aplica", codigo_tipo: "REEMP" }), true);
  assert.equal(O.aplica({ accion: "Nuevo", codigo_tipo: "ALQ" }), false);
  assert.equal(O.aplica({ accion: "No Aplica", codigo_tipo: "DEMO" }), false);
  assert.equal(O.aplica(null), false);
});

test("obligatorio — Renovación y Reemplazo sí; Adición no", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.obligatorio({ accion: "Renovación", codigo_tipo: "ALQ" }), true);
  assert.equal(O.obligatorio({ accion: "No Aplica", codigo_tipo: "REEMP" }), true);
  // La adición AGREGA a un contrato vigente: el cliente conserva lo de antes,
  // no hay devolución. Exigirle origen abriría recuperaciones falsas (NADCAR
  // ALQ20260803-01, DESARROLLO ACQUA TRES — 2026-08-10).
  assert.equal(O.obligatorio({ accion: "Adición", codigo_tipo: "ALQ" }), false);
  assert.equal(O.obligatorio({ accion: "Nuevo", codigo_tipo: "ALQ" }), false);
});

test("la renovación SIN equipo también declara su origen", () => {
  const O = cargarOrigenContrato();
  // No mueve radios, pero renueva un contrato concreto y el vendedor sabe cuál.
  assert.equal(O.obligatorio({ accion: "Renovación", codigo_tipo: "ALQ", renovacion_sin_equipo: true }), true);
});

test("REEMP20260811-01 tal como se guardó — ahora se rechaza", () => {
  const O = cargarOrigenContrato();
  const r = O.validar(REEMP_REAL);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_origen");
  assert.equal(r.foco, "lista");
  assert.match(r.mensaje, /reemplaza/);
});

test("elegir el original desbloquea", () => {
  const O = cargarOrigenContrato();
  const r = O.validar({ ...REEMP_REAL, origen_ids: ["woFy1HX3FfTKliT7xkf0"] });
  assert.equal(r.ok, true);
});

test("multi-origen: una renovación puede consolidar varios contratos viejos", () => {
  const O = cargarOrigenContrato();
  const r = O.validar({
    accion: "Renovación", codigo_tipo: "ALQ", legacy: false,
    origen_ids: ["a1", "b2", "c3"], legacy_ref: "", candidatos: 6,
  });
  assert.equal(r.ok, true);
  assert.equal(O.tipoDe({ accion: "Renovación", origen_ids: ["a1", "b2"] }), "interno");
});

test("el escape de papel abre la puerta, pero exige su referencia", () => {
  const O = cargarOrigenContrato();
  const sinRef = O.validar({ ...REEMP_REAL, legacy: true });
  assert.equal(sinRef.ok, false);
  assert.equal(sinRef.motivo, "falta_ref_papel");
  assert.equal(sinRef.foco, "ref");

  const conRef = O.validar({ ...REEMP_REAL, legacy: true, legacy_ref: "Contrato 2019-114" });
  assert.equal(conRef.ok, true);
  assert.equal(O.tipoDe({ ...REEMP_REAL, legacy: true, legacy_ref: "Contrato 2019-114" }), "legacy");
});

test("espacios en blanco no cuentan como referencia de papel", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.validar({ ...REEMP_REAL, legacy: true, legacy_ref: "   " }).ok, false);
});

test("cliente sin contratos en el sistema — el mensaje manda al escape, no pide lo imposible", () => {
  const O = cargarOrigenContrato();
  const r = O.validar({ ...REEMP_REAL, candidatos: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "sin_candidatos");
  assert.equal(r.foco, "legacy");
  assert.match(r.mensaje, /papel/);
});

test("la adición sigue pasando sin origen — y se guarda como 'ninguno'", () => {
  const O = cargarOrigenContrato();
  const adicion = { accion: "Adición", codigo_tipo: "ALQ", legacy: false, origen_ids: [], legacy_ref: "", candidatos: 3 };
  assert.equal(O.validar(adicion).ok, true);
  assert.equal(O.tipoDe(adicion), "ninguno");
});

test("una adición que SÍ marca papel también debe dar la referencia", () => {
  const O = cargarOrigenContrato();
  // Si el vendedor declara la excepción, el rastro se le pide igual — si no,
  // 'legacy' entraría sin nada detrás y exime al contrato de la transición.
  const r = O.validar({ accion: "Adición", codigo_tipo: "ALQ", legacy: true, origen_ids: [], legacy_ref: "", candidatos: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_ref_papel");
});

test("tipoDe — vacío cuando la pregunta no aplica", () => {
  const O = cargarOrigenContrato();
  assert.equal(O.tipoDe({ accion: "Nuevo", codigo_tipo: "ALQ", origen_ids: ["x"] }), "");
  assert.equal(O.tipoDe({ accion: "No Aplica", codigo_tipo: "DEMO" }), "");
  assert.equal(O.tipoDe(null), "");
});

test("ids vacíos o nulos no se cuentan como vínculo", () => {
  const O = cargarOrigenContrato();
  // El DOM puede entregar strings vacíos si un checkbox pierde su value.
  const r = O.validar({ ...REEMP_REAL, origen_ids: ["", null] });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_origen");
  assert.equal(O.tipoDe({ ...REEMP_REAL, origen_ids: ["", null] }), "ninguno");
});

// ── Cableado con el formulario ────────────────────────────────────────────
// El predicado puro puede ser perfecto y el formulario seguir dejando pasar el
// contrato si lee mal el DOM. Estas pruebas montan NCForm sobre un DOM falso
// mínimo y ejercitan el camino real: leerOrigen → validarOrigen.

function domFalso(campos) {
  const nodos = new Map();
  const nuevo = (props = {}) => ({
    value: "", checked: false, textContent: "", innerHTML: "",
    style: {}, dataset: {}, options: [],
    scrollIntoView() {}, focus() {},
    querySelectorAll: () => [],
    ...props,
  });
  for (const [id, props] of Object.entries(campos)) nodos.set(id, nuevo(props));
  return {
    nodos, nuevo,
    addEventListener() {},
    getElementById: (id) => nodos.get(id) || null,
    querySelectorAll: (sel) => (sel === "#origenContratosList .origen-chk"
      ? (nodos.get("origenContratosList")?._chks || []) : []),
  };
}

// `responder(n)` decide qué devuelve la consulta n-ésima: una lista, o lanzar.
function cargarNCForm(campos, responder = () => []) {
  const doc = domFalso(campos);
  const avisos = [];
  const consultas = { n: 0 };
  const ctx = {
    console, document: doc,
    addEventListener() {},           // nc-form.js engancha DOMContentLoaded al cargar
    Toast: { show: (m, t) => avisos.push({ m, t }) },
    NC: { escapeHtml: String },
    ContratosService: {
      async getContratosActivosPorCliente() { return responder(++consultas.n); },
    },
  };
  // `window` ES el objeto global, igual que en el navegador: sin esto
  // `window.NCForm = {...}` no define el global `NCForm` y el `NCForm.init()`
  // del final del archivo revienta.
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "domain", "origenContrato.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "pages", "nc-form.js"), "utf8"), ctx);
  return { NCForm: ctx.NCForm, doc, avisos, consultas };
}

// El bloque tal como vive en nuevo-contrato.html, con la lista ya cargada.
const camposReemp = (chks = [], extra = {}) => ({
  accion: { value: "No Aplica" },
  tipo_contrato: { value: "REEMP" },
  origenBox: {},
  origenReq: { style: { display: "none" } },
  origenHint: {},
  origenLegacyChk: { checked: false },
  origenLegacyRef: { value: "", style: { display: "none" } },
  origenContratosList: {
    dataset: { estado: "listo" },
    _chks: chks,
    querySelectorAll: () => chks,
    ...extra,
  },
  cliente: { value: "eyFXRKaN5EDtKEwcta51" },
});

const chk = (id, ref, checked) => ({
  value: id, checked, disabled: false, style: {},
  getAttribute: (a) => (a === "data-ref" ? ref : null),
});

test("cableado · el formulario bloquea el REEMP sin original y dice por qué", () => {
  const { NCForm, avisos } = cargarNCForm(camposReemp([
    chk("woFy1HX3", "ALQ20260720-03", false),
    chk("LvoaZ9zy", "ALQ20260720-02", false),
  ]));
  const r = NCForm.validarOrigen();
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "falta_origen");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].m, /Marca el original en la lista/);
});

test("cableado · marcar el original deja pasar y lo entrega con su referencia", () => {
  const { NCForm } = cargarNCForm(camposReemp([
    chk("woFy1HX3", "ALQ20260720-03", true),
    chk("LvoaZ9zy", "ALQ20260720-02", false),
  ]));
  assert.equal(NCForm.validarOrigen().ok, true);
  const sel = NCForm.leerOrigen();
  assert.deepEqual(Array.from(sel.origen_ids), ["woFy1HX3"]);
  assert.deepEqual(Array.from(sel.origen_refs), ["ALQ20260720-03"]);
  assert.equal(sel.candidatos, 2);
});

test("cableado · con el escape de papel marcado se ignora lo que quedó tildado", () => {
  const campos = camposReemp([chk("woFy1HX3", "ALQ20260720-03", true)]);
  campos.origenLegacyChk.checked = true;
  campos.origenLegacyRef.value = "Contrato 2019-114";
  const { NCForm } = cargarNCForm(campos);
  const sel = NCForm.leerOrigen();
  assert.equal(sel.legacy, true);
  assert.deepEqual(Array.from(sel.origen_ids), []);
  assert.equal(NCForm.validarOrigen().ok, true);
});

test("cableado · lista todavía cargando: no acusa al cliente de no tener contratos", () => {
  // La lista vacía es ambigua. Decir "este cliente no tiene contratos vigentes"
  // mientras la consulta viaja empujaría a marcar papel de más — y ese marcado
  // exime al contrato de la transición para siempre.
  const campos = camposReemp([]);
  campos.origenContratosList.dataset = { estado: "cargando" };
  const { NCForm, avisos } = cargarNCForm(campos);
  const r = NCForm.validarOrigen();
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "lista_no_cargada");
  assert.match(avisos[0].m, /Espera a que carguen/);
});

test("cableado · lista cargada y vacía: ahí sí manda al escape de papel", () => {
  const { NCForm } = cargarNCForm(camposReemp([]));
  const r = NCForm.validarOrigen();
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "sin_candidatos");
});

test("cableado · el asterisco aparece en Reemplazo y desaparece en Adición", () => {
  const campos = camposReemp([chk("a1", "ALQ1", false)]);
  const { NCForm, doc } = cargarNCForm(campos);
  NCForm.refreshOrigenUI();
  assert.equal(doc.getElementById("origenReq").style.display, "");
  assert.match(doc.getElementById("origenHint").textContent, /Obligatorio/);

  doc.getElementById("accion").value = "Adición";
  doc.getElementById("tipo_contrato").value = "ALQ";
  NCForm.refreshOrigenUI();
  assert.equal(doc.getElementById("origenReq").style.display, "none");
  assert.match(doc.getElementById("origenHint").textContent, /opcional/);
});

test("cableado · cargar la lista repinta UNA vez, no gira en seco", async () => {
  // cargarContratosOrigen termina llamando a refreshOrigenUI para que el hint
  // refleje la lista ya cargada, y refreshOrigenUI vuelve a llamar a
  // cargarContratosOrigen. La cache por cliente es lo único que corta el ciclo:
  // si alguien la quita, esta prueba se cuelga en vez de pasar en silencio.
  const { NCForm, consultas } = cargarNCForm(camposReemp([]), () => [
    { id: "woFy1HX3", contrato_id: "ALQ20260720-03", tipo_contrato: "Alquiler", estado: "activo" },
  ]);
  await NCForm.cargarContratosOrigen();
  assert.equal(consultas.n, 1);
  await NCForm.cargarContratosOrigen();
  assert.equal(consultas.n, 1, "la segunda vuelta sale por cache");
});

test("cableado · si la consulta falla, el siguiente refresh reintenta", async () => {
  // Al fallar NO se repinta (sería recursión con un fallo persistente), pero sí
  // se suelta la marca del cliente: sin eso la cache dejaría al vendedor con la
  // lista vacía para siempre y sin forma de elegir el original.
  const { NCForm, doc, consultas } = cargarNCForm(camposReemp([]), (n) => {
    if (n === 1) throw new Error("red caída");
    return [{ id: "woFy1HX3", contrato_id: "ALQ20260720-03", tipo_contrato: "Alquiler", estado: "activo" }];
  });
  const lista = doc.getElementById("origenContratosList");

  await NCForm.cargarContratosOrigen();
  assert.equal(consultas.n, 1);
  assert.equal(lista.dataset.estado, "error");
  assert.equal(NCForm._origenClienteCargado, null, "la marca queda suelta para reintentar");

  await NCForm.cargarContratosOrigen();
  assert.equal(consultas.n, 2, "reintenta");
  assert.equal(lista.dataset.estado, "listo");
});

test("cableado · un contrato Nuevo ni siquiera ve el bloque", () => {
  const campos = camposReemp([]);
  campos.accion.value = "Nuevo";
  campos.tipo_contrato.value = "ALQ";
  const { NCForm, doc } = cargarNCForm(campos);
  NCForm.refreshOrigenUI();
  assert.equal(doc.getElementById("origenBox").style.display, "none");
  assert.equal(NCForm.validarOrigen().ok, true);
});

test("origen_tipo 'ninguno' ya no puede salir de una Renovación o un Reemplazo", () => {
  const O = cargarOrigenContrato();
  // La invariante que cierra el hueco: si valida, o apunta a un contrato del
  // sistema o declara el papel. Nunca el silencio que dejó 67 contratos huérfanos.
  for (const sel of [
    { accion: "Renovación", codigo_tipo: "ALQ", candidatos: 4 },
    { accion: "No Aplica", codigo_tipo: "REEMP", candidatos: 4 },
  ]) {
    for (const variante of [
      { ...sel, legacy: false, origen_ids: [] },
      { ...sel, legacy: false, origen_ids: ["x1"] },
      { ...sel, legacy: true, legacy_ref: "" },
      { ...sel, legacy: true, legacy_ref: "papel 2018" },
    ]) {
      if (!O.validar(variante).ok) continue;
      assert.notEqual(O.tipoDe(variante), "ninguno");
    }
  }
});

// Formalización por ORDEN DE COMPRA (2026-11-18, Alberto).
//
// Clientes de gobierno y corporativos no firman nuestro contrato: lo
// formalizan con su orden de compra (o un contrato de la entidad), y en
// gobierno esa OC se refrenda en la Contraloría. Decisiones:
//  · se marca por CLIENTE y el contrato la copia al nacer; override puntual;
//  · subir la OC = la misma vía que el firmado (firmado=true → activo), así
//    el candado de la entrega y la facturación no cambian;
//  · se entrega sin refrendo — el refrendo queda pendiente aparte;
//  · el monto de la OC debe cuadrar con el contrato;
//  · 90 días para dormirse (no 45);
//  · la sube el vendedor (o administración); renovaciones también.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const { fuenteCentro } = require("./_helpers/centro");
const back = require("../src/domain/contratoFirma");
const D = require("../src/domain/contratoDormido");

function montar(rol = "vendedor", uid = "v1") {
  const ctx = {
    window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp,
    setTimeout, encodeURIComponent, isNaN, parseFloat, parseInt,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {} },
    Toast: { show() {} }, Modal: {},
    ROLES: { ADMIN: "administrador", GERENTE: "gerente", VENDEDOR: "vendedor", RECEPCION: "recepcion", INVENTARIO: "inventario" },
    firebase: { auth: () => ({ currentUser: { uid, email: "x@c.com" } }) },
  };
  vm.createContext(ctx);
  for (const f of [["core", "formatting.js"], ["domain", "totales.js"], ["domain", "contratoTarifario.js"],
    ["domain", "contratoAnulacion.js"], ["domain", "contratoCierre.js"], ["domain", "contratoEdicion.js"],
    ["domain", "contratoFirma.js"], ["services", "gestionesService.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { FMT: ctx.window.FMT, ContractTotals: ctx.window.ContractTotals,
    ContratoTarifario: ctx.window.ContratoTarifario, ContratoAnulacion: ctx.window.ContratoAnulacion,
    ContratoCierre: ctx.window.ContratoCierre, ContratoEdicion: ctx.window.ContratoEdicion,
    ContratoFirma: ctx.window.ContratoFirma, GestionesService: ctx.window.GestionesService });
  vm.runInContext(fuenteCentro(), ctx);
  const C = ctx.window.Centro;
  C.rol = rol; C.uid = uid;
  C.cliente = { id: "cli1", nombre: "MINISTERIO DE PRUEBA", formalizacion_contrato: "oc_gobierno" };
  C.contratos = []; C.equipos = []; C.gestiones = [];
  return { C, front: ctx.window.ContratoFirma };
}

const GOB = { tipo: "orden_compra", sector: "gobierno", origen: "cliente" };
const CORP = { tipo: "orden_compra", sector: "corporativo", origen: "cliente" };
const base = (extra = {}) => ({
  id: "c1", contrato_id: "ALQ20261118-01", codigo_tipo: "ALQ", tipo_contrato: "Alquiler",
  estado: "aprobado", accion: "Nuevo", fecha_creacion: new Date(), seriales_estado: "asignados",
  equipos: [{ cantidad: 10, precio: 20 }], total_mensual: 214, primer_pago: 214,
  duracion: "12 meses", duracion_meses: 12, ...extra,
});

test("OC1 · front y back: quién se formaliza con OC (REEMP/DEMO nunca)", () => {
  const { front } = montar();
  const casos = [base({ formalizacion: GOB }), base({ formalizacion: CORP }), base(),
    base({ formalizacion: { tipo: "firma", origen: "contrato" } }),
    { codigo_tipo: "REEMP", formalizacion: GOB }, { codigo_tipo: "DEMO", formalizacion: CORP }, {}, null];
  for (const c of casos) {
    assert.equal(front.esOC(c), back.formalizaConOC(c), `esOC difiere en ${JSON.stringify(c)}`);
    assert.equal(front.esGobierno(c), back.esOCGobierno(c), `esGobierno difiere en ${JSON.stringify(c)}`);
    assert.equal(front.requisito(c), back.requisitoFormalizacion(c));
  }
  assert.equal(front.esOC({ codigo_tipo: "REEMP", formalizacion: GOB }), false, "un reemplazo no lleva nada");
  assert.equal(front.esGobierno(base({ formalizacion: GOB })), true);
  assert.equal(front.esGobierno(base({ formalizacion: CORP })), false);
});

test("OC2 · el contrato nace con lo que dice la ficha del cliente", () => {
  const { front } = montar();
  assert.deepEqual({ ...front.formalizacionDeCliente({ formalizacion_contrato: "oc_gobierno" }) },
    { tipo: "orden_compra", sector: "gobierno", origen: "cliente" });
  assert.deepEqual({ ...front.formalizacionDeCliente({ formalizacion_contrato: "oc_corporativo" }) },
    { tipo: "orden_compra", sector: "corporativo", origen: "cliente" });
  assert.equal(front.formalizacionDeCliente({ formalizacion_contrato: "firma" }), null);
  assert.equal(front.formalizacionDeCliente({}), null);
  assert.equal(front.claveFormalizacion(base({ formalizacion: GOB })), "oc_gobierno");
  assert.equal(front.claveFormalizacion(base()), "firma");
  // El wizard de contrato/renovación la estampa (guardia sobre el fuente).
  assert.match(fuenteCentro(), /formalizacionDeCliente\(cli\)[\s\S]{0,120}contrato\.formalizacion = formalizacion/);
});

test("OC3 · el monto de la OC tiene que cuadrar con el contrato", () => {
  const { front } = montar();
  const c = base();
  assert.equal(front.montoEsperadoOC(c).monto, 2568, "12 × 214");
  assert.equal(front.cuadraOC(c, 2568).ok, true);
  assert.equal(front.cuadraOC(c, 2568.6).ok, true, "redondeo del ITBMS dentro de la tolerancia");
  const r = front.cuadraOC(c, 2140);
  assert.equal(r.ok, false);
  assert.equal(r.diferencia, -428);
  // Cargos únicos: primer pago distinto a la mensualidad.
  const conCargo = base({ primer_pago: 314 });
  assert.equal(front.montoEsperadoOC(conCargo).monto, 314 + 11 * 214);
  // Duración en texto, sin el derivado.
  assert.equal(front.montoEsperadoOC(base({ duracion_meses: undefined, duracion: "24 meses" })).monto, 24 * 214);
  // Temporal por días: el total del contrato es el primer pago.
  assert.equal(front.montoEsperadoOC(base({ duracion_dias: 7, duracion: "7 días", duracion_meses: undefined, primer_pago: 150 })).monto, 150);
  // Sin plazo: no hay contra qué comparar (no inventa un monto).
  assert.equal(front.cuadraOC(base({ duracion_meses: undefined, duracion: "Otro" }), 100).ok, null);
});

test("OC4 · dormido: 90 días con OC, 45 con firma", () => {
  const HOY = new Date("2026-11-18T12:00:00Z");
  const hace = (d) => new Date(HOY.getTime() - d * 86400000);
  const firma = base({ fecha_aprobacion: hace(60) });
  const oc = base({ fecha_aprobacion: hace(60), formalizacion: GOB });
  assert.equal(D.decidirDormir({ contrato: firma, now: HOY }).dormir, true, "firma: 60 días ya duerme");
  assert.equal(D.decidirDormir({ contrato: oc, now: HOY }).dormir, false, "OC: 60 días todavía no");
  assert.equal(D.decidirDormir({ contrato: { ...oc, fecha_aprobacion: hace(89) }, now: HOY }).dormir, false);
  assert.equal(D.decidirDormir({ contrato: { ...oc, fecha_aprobacion: hace(90) }, now: HOY }).dormir, true);
  const { front } = montar();
  assert.equal(front.diasDormido(oc), 90);
  assert.equal(front.diasDormido(firma), 45);
});

test("OC5 · menú: la OC reemplaza 'Enviar para firma' y 'Subir el firmado'", () => {
  const { C } = montar("vendedor");
  const c = base({ formalizacion: GOB });
  C.contratos = [c];
  const ids = C._accionesContrato(c).map(a => a.id);
  assert.ok(ids.includes("orden_compra"), "se ofrece subir la OC");
  assert.ok(!ids.includes("firma"), "no se manda a firmar");
  assert.ok(!ids.includes("subir_firmado"), "no se sube un firmado");
  assert.ok(ids.includes("formalizacion"), "se puede cambiar en este contrato");
  assert.ok(ids.includes("documento"), "nuestro contrato sigue a la vista (términos de referencia)");
  const accOC = C._accionesContrato(c).find(a => a.id === "orden_compra");
  assert.equal(accOC.ok, true, "el vendedor la sube");
  // Recepción no la sube.
  const { C: R } = montar("recepcion");
  R.contratos = [c];
  assert.equal(R._accionesContrato(c).find(a => a.id === "orden_compra").ok, false);
  // Un contrato con firma sigue igual que siempre.
  const idsF = C._accionesContrato(base()).map(a => a.id);
  assert.ok(idsF.includes("firma") && idsF.includes("subir_firmado") && !idsF.includes("orden_compra"));
});

test("OC6 · gobierno: el refrendo queda pendiente sin frenar nada", () => {
  const { C, front } = montar("vendedor");
  const activo = base({ formalizacion: GOB, estado: "activo", firmado: true, firmado_tipo: "orden_compra",
    firmado_url: "https://x/oc.pdf", orden_compra: { numero: "OC-1", monto: 2568, refrendo: null } });
  assert.equal(front.refrendoPendiente(activo), true);
  assert.equal(front.esperando(activo), false, "ya no espera nada para la entrega");
  C.contratos = [activo];
  const ids = C._accionesContrato(activo).map(a => a.id);
  assert.ok(ids.includes("refrendo"), "se ofrece registrar el refrendo");
  assert.ok(!ids.includes("orden_compra"), "la OC ya está");
  assert.ok(!ids.includes("formalizacion"), "formalizado: ya no se cambia");
  const refrendado = { ...activo, orden_compra: { ...activo.orden_compra, refrendo: { numero: "R-9" } } };
  assert.equal(front.refrendoPendiente(refrendado), false);
  assert.ok(!C._accionesContrato(refrendado).map(a => a.id).includes("refrendo"));
  // Corporativo no lleva refrendo.
  assert.equal(front.refrendoPendiente({ ...activo, formalizacion: CORP }), false);
  // La fila del expediente lo dice.
  assert.match(C._firmadoTxt(activo), /OC-1[\s\S]*refrendo pendiente/);
  assert.match(C._firmadoTxt(refrendado), /refrendada \(R-9\)/);
});

test("OC7 · el registro de la OC escribe lo que exige rules::esActivacionPorFirmado", () => {
  // aprobado → activo solo si el MISMO write trae firmado=true + firmado_url
  // (admin o vendedor). Guardia sobre el fuente: si alguien cambia la vía, que
  // lo vea aquí antes que en producción.
  const src = leer("public", "js", "pages", "centro-orden-compra.js");
  const m = src.match(/async _guardarOrdenCompra[\s\S]*?updateContrato\(id, \{([\s\S]*?)\}\);/);
  assert.ok(m, "no se encontró el write de la OC");
  for (const k of ["firmado: true", "firmado_url", "estado: 'activo'", "fecha_activacion", "orden_compra"]) {
    assert.ok(m[1].includes(k), `el write de la OC no trae ${k}`);
  }
  const rules = leer("firestore.rules");
  assert.match(rules, /function esActivacionPorFirmado\(\)[\s\S]*?firmado_url[\s\S]*?\["administrador", "vendedor"\]/);
});

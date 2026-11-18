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

// ── Segunda vuelta (2026-11-18): no dañar lo que existe, OC parcial, anexos ──

test("OC8 · cambiar el perfil del cliente NO toca el histórico ni lo formalizado", () => {
  const { front } = montar();
  // Formas reales de producción (conteo del 18-nov-2026).
  const legacy = base({ seriales_estado: "legacy" });                       // 149 así
  const entregadoViejo = base({ entrega_confirmada: true });                  // 27 así
  const entregadoConMarca = base({ entrega_confirmada: true, entrega_sin_firma: { orden_id: "OS1" } });
  const sinCircuito = base({ seriales_estado: undefined });
  const enTramite = base();
  const pendiente = base({ estado: "pendiente_aprobacion", seriales_estado: undefined });
  const firmado = base({ firmado: true, estado: "activo" });
  const validando = base({ firmado_pendiente_validacion: true });
  const reemp = base({ codigo_tipo: "REEMP", tipo_contrato: "Reemplazo" });
  assert.equal(front.enTramiteFormalizacion(legacy), false, "el histórico legacy no se toca");
  assert.equal(front.enTramiteFormalizacion(entregadoViejo), false, "lo entregado antes de la marca no se toca");
  assert.equal(front.enTramiteFormalizacion(sinCircuito), false);
  assert.equal(front.enTramiteFormalizacion(firmado), false);
  assert.equal(front.enTramiteFormalizacion(validando), false);
  assert.equal(front.enTramiteFormalizacion(reemp), false);
  assert.equal(front.enTramiteFormalizacion(enTramite), true);
  assert.equal(front.enTramiteFormalizacion(pendiente), true);
  assert.equal(front.enTramiteFormalizacion(entregadoConMarca), true, "entregado con la firma pendiente sí está en trámite");
});

test("OC9 · el plan del perfil: quién cambia y quién no (y por qué)", () => {
  const ctx = { window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp, parseInt, isNaN };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "contratoFirma.js"), ctx);
  vm.runInContext(leer("public", "js", "services", "clientesService.js"), ctx);
  const S = ctx.window.ClientesService;
  const cs = [
    base({ id: "a", contrato_id: "ALQ-A" }),                                         // en trámite → cambia
    base({ id: "b", contrato_id: "ALQ-B", seriales_estado: "legacy" }),              // histórico → no
    base({ id: "c", contrato_id: "ALQ-C", estado: "activo", firmado: true }),        // firmado → no
    base({ id: "d", contrato_id: "ALQ-D", firma_solicitud_estado: "pendiente" }),    // enlace enviado → no
    base({ id: "e", contrato_id: "ALQ-E", formalizacion: { tipo: "firma", origen: "contrato" } }), // a mano → no
    base({ id: "f", contrato_id: "REEMP-F", codigo_tipo: "REEMP" }),                 // sin firma → ni se nombra
  ];
  const p = S.planFormalizacion(cs, "oc_gobierno");
  assert.deepEqual([...p.cambian.map(x => x.id)], ["a"]);
  assert.deepEqual([...p.quedan.map(x => x.id)].sort(), ["b", "c", "d", "e"]);
  assert.match(p.quedan.find(x => x.id === "d").porQue, /enlace de firma enviado/);
  assert.match(p.quedan.find(x => x.id === "b").porQue, /histórico/);
  // Volver a firma: solo el que estaba con OC por el cliente.
  const conOC = [base({ id: "g", formalizacion: GOB }), base({ id: "h", formalizacion: { ...GOB, origen: "contrato" } })];
  assert.deepEqual([...S.planFormalizacion(conOC, "firma").cambian.map(x => x.id)], ["g"]);
  // La ficha muestra el plan ANTES de guardar y no cancela enlaces.
  const ficha = leer("public", "js", "pages", "clientes-ficha.js");
  assert.match(ficha, /planFormalizacion\([\s\S]*?Modal\.confirm\([\s\S]*?updateCliente/);
  assert.ok(!/firma_solicitudes/.test(ficha), "cambiar el perfil no retira enlaces de firma");
});

test("OC10 · OC parcial (año fiscal) y OC siguiente", () => {
  const { front, C } = montar("vendedor");
  const c = base({ duracion_meses: 36, duracion: "36 meses" });
  assert.equal(front.montoEsperadoOC(c, { meses: 12 }).monto, 12 * 214, "la primera cubre 12 meses");
  assert.equal(front.cuadraOC(c, 12 * 214, { meses: 12 }).ok, true);
  assert.equal(front.cuadraOC(c, 12 * 214).ok, false, "sin decir los meses, se compara contra los 36");
  assert.equal(front.montoEsperadoOC(base({ primer_pago: 314, duracion_meses: 36 }), { meses: 12 }).monto, 314 + 11 * 214);
  assert.equal(front.montoEsperadoOC(c, { meses: 12, siguiente: true }).monto, 12 * 214, "la siguiente: solo mensualidades");
  const activo = base({ duracion_meses: 36, estado: "activo", firmado: true, formalizacion: GOB, firmado_tipo: "orden_compra",
    orden_compra: { numero: "OC-1", monto: 2568, cubre_hasta: "2027-11-18", refrendo: { numero: "R" } }, oc_meses_cubiertos: 12 });
  assert.equal(front.ocParcial(activo), true);
  assert.equal(front.ocParcial({ ...activo, oc_meses_cubiertos: 36 }), false, "cubierto todo el plazo");
  C.contratos = [activo];
  assert.ok(C._accionesContrato(activo).map(a => a.id).includes("oc_siguiente"));
  assert.equal(front.diasOCVigente(activo, new Date("2027-11-08T12:00:00-05:00")), 10);
  assert.equal(front.sumarMeses(new Date("2026-01-31T12:00:00-05:00"), 1), "2026-02-28", "fin de mes sin desbordarse");
});

test("OC11 · anexo de aumento: OC en vez del anexo firmado", () => {
  const { front, C } = montar("vendedor");
  const g = { id: "GA1", tipo: "aumento", estado: "pendiente_firma", formalizacion: CORP, cierre: {},
    aumento: { contrato_id: "ALQ-1", duracion_meses: 12, totales: { total_mensual: 107, primer_pago: 107 }, lineas: [{ cantidad: 5 }] } };
  assert.equal(front.anexoEsOC(g), true);
  assert.equal(front.montoEsperadoAnexoOC(g).monto, 12 * 107);
  assert.equal(front.cuadraAnexoOC(g, 1284).ok, true);
  assert.equal(front.anexoEsOC({ ...g, aumento: { ...g.aumento, es_regularizacion: true } }), false, "la actualización de seriales no lleva");
  C.gestiones = [g];
  const ids = C._accionesGestion(g).map(a => a.id);
  assert.ok(ids.includes("orden_compra"), "se ofrece la OC del anexo");
  assert.ok(!ids.includes("firma") && !ids.includes("subir_firmado"), "no se manda a firmar el anexo");
  // Gobierno ya con OC: refrendo pendiente.
  const gG = { ...g, formalizacion: GOB, estado: "pendiente_bodega", orden_compra: { numero: "OC-9", monto: 1284, refrendo: null } };
  assert.equal(front.anexoRefrendoPendiente(gG), true);
  assert.ok(C._accionesGestion(gG).map(a => a.id).includes("refrendo"));
  // Dormido a los 90 días también.
  assert.equal(D.umbralDormirAnexo(g), 90);
  assert.equal(D.umbralDormirAnexo({ ...g, formalizacion: undefined }), 45);
  // El wizard del aumento estampa la formalización del cliente.
  assert.match(leer("public", "js", "pages", "centro-wiz-aumento.js"), /formalizacionDeCliente\(this\.cliente\)[\s\S]{0,200}formalizacion: formalizacionA/);
});

test("OC12 · el cliente se marca desde el Centro (vendedor incluido)", () => {
  const { C } = montar("vendedor");
  assert.equal(C._puedeFormalizacionCliente(), true);
  const { C: T } = montar("tecnico");
  assert.equal(T._puedeFormalizacionCliente(), false);
  // Override puntual: solo en trámite (el histórico no se ofrece).
  assert.equal(C._puedeCambiarFormalizacion(base({ seriales_estado: "legacy" })), false);
  assert.equal(C._puedeCambiarFormalizacion(base()), true);
});

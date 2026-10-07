// Plan de autoservicio 2026-10-07, P2 (vendedor): el Centro ofrece "Declarar
// el contrato sustituto…" en un anulado sin sustituto o con el traspaso a
// medias, y al crear un contrato nuevo detecta uno VIVO con los mismos
// equipos (huella familia+modalidad+cantidad), que es la marca de "rehecho sin
// anular el viejo" (MAGEN DAVID 2026-10-05).
//
// Corre con `npm test` (node --test): monta el Centro en un vm, sin red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const { fuenteCentro } = require("./_helpers/centro");

function montar(rol = "vendedor", uid = "vend") {
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
    ["domain", "contratoFirma.js"], ["domain", "modeloFamilia.js"], ["services", "gestionesService.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { FMT: ctx.window.FMT, ContractTotals: ctx.window.ContractTotals,
    ContratoTarifario: ctx.window.ContratoTarifario, ContratoAnulacion: ctx.window.ContratoAnulacion,
    ContratoCierre: ctx.window.ContratoCierre, ContratoEdicion: ctx.window.ContratoEdicion,
    ContratoFirma: ctx.window.ContratoFirma, GestionesService: ctx.window.GestionesService,
    ModeloFamilia: ctx.window.ModeloFamilia });
  vm.runInContext(fuenteCentro(), ctx);
  const C = ctx.window.Centro;
  C.rol = rol; C.uid = uid;
  C.cliente = { id: "cli1", nombre: "MAGEN DAVID" };
  C.contratos = []; C.equipos = []; C.gestiones = [];
  return C;
}
const porId = (acc) => Object.fromEntries(acc.map(a => [a.id, a]));
const L = (modelo, cantidad, modalidad = "alquiler", modelo_id = null) => ({ modelo, modelo_id, cantidad, precio: 25, modalidad });

test("anulado por sustitución SIN sustituto → 'Declarar el contrato sustituto…' primaria para el vendedor", () => {
  const C = montar("vendedor");
  const c = { id: "c-viejo", contrato_id: "ALQ20260720-02", estado: "anulado", anulacion_tipo: "sustitucion", cliente_id: "cli1", equipos: [L("PNC460-R", 22)] };
  C.contratos = [c];
  const a = porId(C._accionesContrato(c));
  assert.ok(a.declarar_sustituto, "falta la acción");
  assert.equal(a.declarar_sustituto.ok, true);
  assert.equal(a.declarar_sustituto.primaria, true);
  assert.match(a.declarar_sustituto.label, /Declarar/);
});

test("anulado con sustituto pero traspaso pendiente → 'Reintentar…'; sin pendiente y con sustituto → nada", () => {
  const C = montar("administrador");
  const pend = { id: "c1", estado: "anulado", sustituido_por_id: "c2", sustitucion_vinculo_pendiente: true, sustitucion_vinculo_motivo: "2 unidad(es) sin traspasar", equipos: [] };
  const ok = { id: "c3", estado: "anulado", sustituido_por_id: "c2", equipos: [] };
  C.contratos = [pend, ok];
  const a1 = porId(C._accionesContrato(pend));
  assert.match(a1.declarar_sustituto.label, /Reintentar/);
  assert.match(a1.declarar_sustituto.hint, /2 unidad/);
  const a2 = porId(C._accionesContrato(ok));
  assert.equal(a2.declarar_sustituto, undefined, "ya está resuelto: no se ofrece");
});

test("un rol sin mando ve la acción deshabilitada con motivo", () => {
  const C = montar("tecnico");
  const c = { id: "c1", estado: "anulado", anulacion_tipo: "sustitucion", equipos: [] };
  C.contratos = [c];
  const a = porId(C._accionesContrato(c));
  assert.equal(a.declarar_sustituto.ok, false);
  assert.ok(a.declarar_sustituto.motivo.length > 5);
});

test("huella: mismas líneas (familia + modalidad + cantidad) = contrato vivo igual; distinto en algo = ninguno", () => {
  const C = montar("vendedor");
  const vivo = { id: "c-vivo", contrato_id: "ALQ20260720-02", estado: "activo", cliente_id: "cli1", equipos: [L("PNC460-R", 22)], fecha_creacion: { seconds: 100 } };
  const anulado = { id: "c-x", estado: "anulado", equipos: [L("PNC460-R", 22)] };
  C.contratos = [vivo, anulado];
  // Mismo modelo escrito distinto (sin -R, sin marca) y misma cantidad.
  assert.equal(C._wcContratoVivoIgual([L("PNC460", 22)])?.id, "c-vivo", "la familia iguala N y -R");
  // Otra cantidad, otra modalidad u otro modelo: no es el mismo paquete.
  assert.equal(C._wcContratoVivoIgual([L("PNC460-R", 21)]), null);
  assert.equal(C._wcContratoVivoIgual([L("PNC460-R", 22, "propio")]), null);
  assert.equal(C._wcContratoVivoIgual([L("PNC360S", 22)]), null);
  // Dos líneas que suman lo mismo que una: huella distinta (otro modelo).
  assert.equal(C._wcContratoVivoIgual([L("PNC460-R", 11), L("PNC360S", 11)]), null);
  // Sin líneas con cantidad: nada que comparar.
  assert.equal(C._wcContratoVivoIgual([]), null);
});

test("huella: el contrato ya renovado por otro no cuenta como vivo", () => {
  const C = montar("vendedor");
  const viejo = { id: "c-viejo", estado: "activo", equipos: [L("PNC460-R", 22)], renovado_por_ids: ["c-ren"], fecha_creacion: { seconds: 1 } };
  const ren = { id: "c-ren", estado: "aprobado", accion: "Renovación", contrato_origen_ids: ["c-viejo"], equipos: [L("PNC460-R", 22)], fecha_creacion: { seconds: 2 } };
  C.contratos = [viejo, ren];
  const hit = C._wcContratoVivoIgual([L("PNC460-R", 22)]);
  assert.equal(hit?.id, "c-ren", "gana el vivo más reciente; el renovado queda fuera");
});

test("el resumen de aprobación avisa cuando el contrato sustituye a otro", () => {
  const C = montar("administrador");
  const c = { id: "c-nuevo", contrato_id: "ALQ20260812-02", estado: "pendiente_aprobacion", equipos: [L("PNC460-R", 22)], total_mensual: 550,
    sustituye_a_pendiente_id: "c-viejo", sustituye_a_pendiente_contrato_id: "ALQ20260720-02" };
  C.contratos = [c];
  const html = C._resumenAprobacionHtml(c);
  assert.match(html, /Sustituye a/);
  assert.match(html, /ALQ20260720-02/);
  assert.match(html, /se anula por sustitución/);
});

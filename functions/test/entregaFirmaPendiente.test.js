// Entrega con la firma del CONTRATO pendiente (2026-11-11).
//
// Pedido de Brenda — SERVICIOS DE INSPECCIÓN Y ASISTENCIA VEHICULAR, 2-nov: el
// cliente llegó a retirar sus radios con el contrato sin firmar y el candado
// de la entrega (2026-09-03, Zuleika) no dejaba abrir la firma digital de
// recibido. Quedó una nota en papel con una firma ilegible.
//
// Ahora recepción puede entregar dejando la firma digital de quien recibe. Eso
// NO firma ni activa el contrato: lo marca (`entrega_sin_firma`), lo deja a la
// vista como "Entregado · firma pendiente" y le manda al vendedor un
// recordatorio DIARIO hasta que el contrato firmado esté en la plataforma. El
// candado del ANEXO de un aumento no se toca.
//
// Las rules se prueban contra el emulador en
// functions/test-emulator/rules-entrega-firma-pendiente.js.
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

function front() {
  const ctx = { window: {}, Date, Math, Number, String };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "contratoFirma.js"), ctx);
  return ctx.window.ContratoFirma;
}

function montarCentro() {
  const ctx = {
    window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp,
    setTimeout, encodeURIComponent, isNaN, parseFloat, parseInt,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {} },
    Toast: { show() {} }, Modal: {},
    ROLES: { ADMIN: "administrador", GERENTE: "gerente", VENDEDOR: "vendedor", RECEPCION: "recepcion", INVENTARIO: "inventario" },
    firebase: { auth: () => ({ currentUser: { uid: "adm", email: "x@c.com" } }) },
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
  C.rol = "administrador"; C.uid = "adm";
  C.cliente = { id: "cli1", nombre: "SIAV" };
  C.contratos = []; C.equipos = []; C.gestiones = [];
  return C;
}

const ENTREGA = new Date("2026-11-02T15:30:00-05:00");
const MARCA = { orden_id: "2026110207", fecha_entrega: ENTREGA, via: "recepcion", por_email: "recepcion@c.com" };
const SERV = { id: "c1", contrato_id: "SERV20261030-02", codigo_tipo: "SERV", tipo_contrato: "Servicio",
  estado: "aprobado", accion: "Nuevo", seriales_estado: "asignados", fecha_creacion: new Date(),
  equipos: [{ cantidad: 4, precio: 22 }] };
const ENTREGADO = { ...SERV, entrega_confirmada: true, entrega_sin_firma: MARCA };

test("P1 · el estado se DERIVA: se enciende con la marca y se apaga solo al firmarse", () => {
  const F = front();
  for (const es of [F.entregadoSinFirma.bind(F), back.entregadoSinFirma]) {
    assert.equal(es(ENTREGADO), true, "entregado, aprobado y sin firmar");
    assert.equal(es({ ...ENTREGADO, firmado: true }), false, "ya subieron el firmado");
    assert.equal(es({ ...ENTREGADO, estado: "activo", firmado: true }), false, "activo");
    assert.equal(es({ ...ENTREGADO, estado: "anulado" }), false, "anulado: ya no hay nada que firmar");
    assert.equal(es({ ...ENTREGADO, deleted: true }), false, "borrado");
    // Lo entregado ANTES de esta marca es histórico: no se persigue.
    assert.equal(es({ ...SERV, entrega_confirmada: true }), false, "sin marca no cuenta");
    assert.equal(es(SERV), false, "sin entregar");
    // Un reemplazo o un demo no llevan firma: nunca "esperan" una.
    assert.equal(es({ ...ENTREGADO, codigo_tipo: "REEMP" }), false);
    assert.equal(es({ ...ENTREGADO, codigo_tipo: "DEMO" }), false);
    assert.equal(es(null), false);
  }
});

test("P2 · los días son de CALENDARIO en Panamá, iguales en la pantalla y en el correo", () => {
  const F = front();
  for (const dias of [F.diasEntregadoSinFirma.bind(F), back.diasEntregadoSinFirma]) {
    // El cron corre a las 07:15: entregado ayer a las 3:30 pm es "hace 1 día".
    assert.equal(dias(ENTREGADO, new Date("2026-11-03T07:15:00-05:00")), 1);
    assert.equal(dias(ENTREGADO, new Date("2026-11-02T17:00:00-05:00")), 0);
    assert.equal(dias(ENTREGADO, new Date("2026-11-11T07:15:00-05:00")), 9);
    assert.equal(dias({ ...SERV, entrega_sin_firma: {} }, new Date()), null, "sin fecha no inventa");
    // Timestamp de Firestore.
    const ts = { toDate: () => ENTREGA };
    assert.equal(dias({ ...ENTREGADO, entrega_sin_firma: { fecha_entrega: ts } }, new Date("2026-11-04T08:00:00-05:00")), 2);
  }
});

test("P3 · la hoja del candado ofrece la entrega a recepción y la marca viaja en el write", () => {
  const flujo = leer("public", "js", "pages", "ordenes-flujo.js");
  const i = flujo.indexOf("function abrirModalFirmaPendiente");
  const hoja = flujo.slice(i, flujo.indexOf("function abrirModalContratoMuerto"));
  assert.match(hoja, /esRecepcion \? \[\{ action: 'pendiente', label: 'Entregar con la firma del contrato pendiente' \}\]/);
  assert.match(hoja, /contratoSinFirma: \{ \.\.\.marca, via: 'recepcion' \}/);
  // El override de admin ya no pasa sin rastro.
  assert.match(hoja, /contratoSinFirma: \{ \.\.\.marca, via: 'admin' \}/);
  // Un contrato anulado o vencido no entra a esta hoja: no hay nada que firmar.
  assert.ok(hoja.indexOf("abrirModalContratoMuerto(orden, contrato") < hoja.indexOf("'pendiente'"));
  // El write de la entrega lleva la marca con el contrato al que aplica.
  assert.match(flujo, /firestoreData\.entrega_contrato_sin_firma = \{\s*contrato_doc_id: _contratoSinFirma\.contrato_doc_id/);
  // …y por la puerta de recepción la firma de quien recibe es digital.
  assert.match(flujo, /if \(noRecibido && _contratoSinFirma\.via !== 'admin'\)/);
  assert.match(flujo, /_contratoSinFirma\.via !== 'admin'\) \{\s*document\.getElementById\('modalEntrega'\)\?\.querySelector\('\.modal-entrega__alert'\)\?\.classList\.add\('hidden'\)/);
  // La marca no sobrevive al modal (es compartido entre órdenes).
  const cerrar = flujo.slice(flujo.indexOf("window.cerrarModalEntrega"), flujo.indexOf("window.abrirModalRecepcion"));
  assert.match(cerrar, /_contratoSinFirma = null;/);
  assert.match(leer("public", "ordenes", "index.html"), /id="entregaAvisoContratoSinFirma" class="hidden"/);
});

test("P4 · el candado del ANEXO de un aumento no se tocó", () => {
  const flujo = leer("public", "js", "pages", "ordenes-flujo.js");
  const anexo = flujo.slice(flujo.indexOf("function abrirModalFirmaAnexoPendiente"), flujo.indexOf("async function contratoSinFacturaParaEntrega"));
  assert.ok(!/contratoSinFirma|'pendiente'/.test(anexo), "la hoja del anexo no ofrece la excepción");
  const rules = leer("firestore.rules");
  const fn = rules.slice(rules.indexOf("function anexoFirmadoParaEntregar()"), rules.indexOf("function facturaVentaParaEntregar()"));
  assert.ok(!/entrega_contrato_sin_firma/.test(fn), "rules: el anexo sigue exigiendo cierre.firma");
});

test("P5 · rules: solo recepción, solo al ENTREGAR y solo para ESE contrato", () => {
  const rules = leer("firestore.rules");
  const fn = rules.slice(rules.indexOf("function contratoFirmadoParaEntregar()"), rules.indexOf("function anexoFirmadoParaEntregar()"));
  assert.match(fn, /userRole\(\) == "recepcion"/);
  assert.match(fn, /request\.resource\.data\.get\("estado_reparacion", ""\) == "ENTREGADO AL CLIENTE"/);
  assert.match(fn, /request\.resource\.data\.get\("entrega_contrato_sin_firma", \{\}\)\.get\("contrato_doc_id", ""\) == cid/);
  // Va de última: la entrega normal corta antes (presupuesto de 1000 expresiones).
  assert.ok(fn.indexOf('"estado", "") == "activo"') < fn.indexOf("entrega_contrato_sin_firma"));
  // La marca del contrato es del backend.
  const cf = rules.slice(rules.indexOf("function touchesCFOwnedFields()"), rules.indexOf("function touchesCFOwnedFields()") + 3000);
  assert.match(cf, /"entrega_sin_firma"/);
});

test("P6 · la entrega marca el contrato sin firmarlo ni activarlo", () => {
  const src = leer("functions", "src", "triggers", "ordenes", "onOrdenEntregada.js");
  assert.match(src, /!c\.entrega_sin_firma && esperandoFirma\(c\)/, "solo si de verdad espera firma, y una sola vez");
  assert.match(src, /\.\.\.\(marcaSinFirma \? \{ entrega_sin_firma: marcaSinFirma \} : \{\}\)/);
  // Orden dividida: la marca sale con la primera hermana, no con la última.
  const i = src.indexOf("if (pendientes.length) {");
  assert.match(src.slice(i, i + 300), /set\(\{ entrega_sin_firma: marcaSinFirma \}, \{ merge: true \}\)/);
  // Nada de esto firma o activa.
  const bloque = src.slice(src.indexOf("let marcaSinFirma = null;"));
  assert.ok(!/firmado:\s*true|estado:\s*"activo"/.test(bloque), "la entrega no firma ni activa el contrato");
});

test("P7 · firmar después de entregar no abre una segunda alta de facturación", () => {
  const src = leer("functions", "src", "triggers", "contratos", "onApproval.js");
  assert.match(src, /FA0\.avisoId\("contrato_entregado", contratoId\)/);
  assert.match(src, /if \(transitionedToActivo && !yaAvisadoPorEntrega\) \{/);
});

test("P8 · recordatorio DIARIO al vendedor, que se apaga solo", () => {
  const cron = leer("functions", "src", "triggers", "scheduled", "recordatorioOperativo.js");
  const i = cron.indexOf("── L) Entregado con la firma del contrato pendiente");
  assert.ok(i > 0, "la sección L está en el cron");
  const bloque = cron.slice(i);
  assert.match(bloque, /\.where\("estado", "==", "aprobado"\)/);
  assert.match(bloque, /if \(!CF\.entregadoSinFirma\(c\)\) continue;/);
  // Diario: no hay contador ni "último aviso" que lo espacie o que limpiar.
  assert.ok(!/recordatorio_at|\.update\(/.test(bloque), "la sección no escribe contadores");
  // Al vendedor que elaboró el contrato; con respaldo, nunca al vacío.
  assert.match(bloque, /c\.creado_por_uid/);
  assert.match(bloque, /if \(!to\) to = await G\.vendedorEmailDeCliente\(c\.cliente_id\);/);
  // Cliente, número, fecha de entrega y días.
  assert.match(bloque, /subject: `Contrato sin firmar: equipos entregados \$\{hace \|\| "al cliente"\} — \$\{c\.cliente_nombre \|\| "Cliente"\} \(\$\{legible\}\)`/);
  assert.match(bloque, /se entregaron\$\{cuando \?/);
  assert.match(bloque, /se detiene solo cuando el contrato firmado esté en la plataforma/);
  assert.match(bloque, /seccion: "entregado_sin_firma"/);
  // No se pisa con el aviso del anexo: aquel mira gestiones, este contratos.
  const j = cron.slice(cron.indexOf("── J) Aumentos esperando la firma del anexo"), cron.indexOf("── K)"));
  assert.match(j, /collection\("gestiones"\)/);
  assert.ok(!/collection\("gestiones"\)\s*\.where/.test(bloque));
});

test("P9 · queda a la vista: señal del home, archivo y Centro", () => {
  const sen = leer("public", "js", "services", "senalesService.js");
  assert.match(sen, /if \(c\.entrega_confirmada === true && !entregado\) return;/);
  assert.match(leer("public", "js", "pages", "home-signals.js"), /ya entregado, firma pendiente/);
  const lista = leer("public", "js", "pages", "contratos-list.js");
  assert.equal((lista.match(/ContratosLista\.entregaSinFirmaPill\(data\)/g) || []).length, 2, "fila y tarjeta");
  assert.match(leer("public", "js", "entry", "contratos-index.js"), /domain\/contratoFirma\.js/);

  const C = montarCentro();
  assert.equal(C._estadoLabel(ENTREGADO), "Entregado · firma pendiente");
  // Lo entregado antes de la marca sigue leyéndose como histórico.
  assert.equal(C._estadoLabel({ ...SERV, entrega_confirmada: true }), "Aprobado · histórico");
  // Sigue EN TRÁMITE: esa firma sí se espera…
  C.contratos = [{ ...ENTREGADO }];
  assert.equal(C._tramitesContrato().length, 1);
  assert.match(C._entregaTxt(ENTREGADO), /con la firma del contrato pendiente/);
  // …y sale del trámite solo cuando el contrato se firma.
  C.contratos = [{ ...ENTREGADO, firmado: true }];
  assert.equal(C._tramitesContrato().length, 0);
  // El entregado sin marca (histórico) no volvió al trámite (cf515cc).
  C.contratos = [{ ...SERV, entrega_confirmada: true }];
  assert.equal(C._tramitesContrato().length, 0);
});

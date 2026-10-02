// Bandeja "Facturación pendiente" — helpers puros de lib/facturacionAvisos.
// Corre con: node --test (desde functions/).
const test = require("node:test");
const assert = require("node:assert/strict");

// lib/admin inicializa firebase-admin al cargarse; las funciones que probamos
// no tocan Firestore, así que basta con un stub.
const Module = require("module");
const origLoad = Module._load;
Module._load = function (req, parent) {
  if (req === "./admin" && parent && parent.filename.includes("facturacionAvisos")) {
    return { admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} };
  }
  return origLoad.apply(this, arguments);
};
const FA = require("../src/lib/facturacionAvisos");
Module._load = origLoad;

test("mensualDeContrato: suma líneas × precio y cargos recurrentes; ITBMS 7% salvo exento", () => {
  // Riba Smith Multiplaza (real): 6 × PNC360S a $20 → $120 / $128.40
  const m = FA.mensualDeContrato({ equipos: [{ modelo: "PNC360S", cantidad: 6, precio: 20 }] });
  assert.equal(m.mensual, 120);
  assert.equal(m.con_itbms, 128.4);
  assert.equal(m.exento, false);
  assert.equal(m.equipos_n, 6);

  const c = FA.mensualDeContrato({
    equipos: [{ cantidad: 2, precio: 35 }],
    cargos: [{ concepto: "Consola", monto: 15, recurrente: true, cantidad: 1 },
             { concepto: "Activación", monto: 50, recurrente: false }],
    itbms_aplica: false,
  });
  assert.equal(c.mensual, 85);
  assert.equal(c.unico, 50);
  assert.equal(c.exento, true);
  assert.equal(c.con_itbms, 85);
});

test("mensualDeContrato: contrato sin total_mensual (pre-jun-2026) igual da monto", () => {
  // Brisas del Golf (real): total=192.6 ya trae ITBMS; las líneas dicen 9 × $20.
  const m = FA.mensualDeContrato({ total: 192.6, total_con_itbms: 192.6, equipos: [{ cantidad: 9, precio: 20 }] });
  assert.equal(m.mensual, 180);
  assert.equal(m.con_itbms, 192.6);
});

test("equiposTexto: '6 × PNC360S, 1 × Consola'; ignora cantidad 0", () => {
  assert.equal(FA.equiposTexto([{ modelo: "PNC360S", cantidad: 6 }, { modelo: "Consola", cantidad: 1 }, { modelo: "X", cantidad: 0 }]),
    "6 × PNC360S, 1 × Consola");
  assert.equal(FA.equiposTexto(null), "");
});

test("avisoId: determinista y seguro como id de doc", () => {
  assert.equal(FA.avisoId("renovacion_activa", "AUaYMEuSieavrOcZ9aQe"), "renovacion_activa__AUaYMEuSieavrOcZ9aQe");
  assert.equal(FA.avisoId("terminacion_completada", "g1__c/2"), "terminacion_completada__g1__c_2");
});

test("pasosIniciales: POC no aplica en ajuste de tarifa ni en baja aprobada", () => {
  assert.equal(FA.pasosIniciales("ajuste_tarifa").poc.aplica, false);
  assert.equal(FA.pasosIniciales("baja_aprobada").poc.aplica, false);
  assert.equal(FA.pasosIniciales("renovacion_activa").poc.aplica, true);
  assert.equal(FA.pasosIniciales("renovacion_activa").qbo.hecho, false);
});

test("estadoDerivado: hecho solo cuando TODOS los pasos que aplican están hechos", () => {
  const base = (qbo, poc, pocAplica = true) => ({
    estado: "pendiente",
    pasos: { qbo: { aplica: true, hecho: qbo }, poc: { aplica: pocAplica, hecho: poc } },
  });
  assert.equal(FA.estadoDerivado(base(false, false)), "pendiente");
  assert.equal(FA.estadoDerivado(base(true, false)), "pendiente");
  assert.equal(FA.estadoDerivado(base(true, true)), "hecho");
  assert.equal(FA.estadoDerivado(base(true, false, false)), "hecho", "POC no aplica → basta QBO");
  // Deshacer un paso regresa a pendiente
  assert.equal(FA.estadoDerivado({ ...base(false, true), estado: "hecho" }), "pendiente");
  // esperando y descartado no dependen de los pasos
  assert.equal(FA.estadoDerivado({ ...base(true, true), estado: "esperando" }), "esperando");
  assert.equal(FA.estadoDerivado({ ...base(true, true), estado: "descartado" }), "descartado");
});

test("TIPOS: cada tipo tiene efecto válido", () => {
  for (const [k, v] of Object.entries(FA.TIPOS)) {
    assert.ok(["arranca", "cambia", "termina"].includes(v.efecto), k);
    assert.ok(v.titulo, k);
  }
});

// ── numeroFactura: rescatar el DocNumber de lo que escribe una persona ──────
// El campo decía "N.° de factura o nota" —pedía dos cosas— y Recepción escribió
// tres formatos en cuatro registros. Estas cuatro cadenas son las REALES de
// producción al 2026-09-14.
test("numeroFactura: saca el DocNumber de las cuatro cadenas reales", () => {
  const n = (s) => FA.numeroFactura(s).numero;
  assert.equal(n("Factura N° 10791"), "10791");
  assert.equal(n("Factura N° 10776"), "10776");
  assert.equal(n("Factura N° 10527"), "10527");
  // La palabra FACTURA abre la frase y el número real cuelga del N° del final:
  // por eso manda el ÚLTIMO marcador, no el primero.
  assert.equal(n("FACTURA SIN FISCALIZAR CREADA EN QUICKBOOK BAJO EL N° 10429."), "10429");
});

test("numeroFactura: el campo nuevo escribe limpio y eso no se toca", () => {
  const r = FA.numeroFactura("10791");
  assert.equal(r.numero, "10791");
  assert.equal(r.fuente, "limpio");
  // QuickBooks acepta letras en DocNumber: no se fuerza solo-dígitos.
  assert.equal(FA.numeroFactura("10791-A").numero, "10791-A");
});

test("numeroFactura: variantes que van a aparecer tarde o temprano", () => {
  const n = (s) => FA.numeroFactura(s).numero;
  assert.equal(n("#10791"), "10791");
  assert.equal(n("Fact. 10791"), "10791");
  assert.equal(n("NRO 10791"), "10791");
  assert.equal(n("  10791  "), "10791");
  // Un año suelto no le gana a un número de factura de 5 dígitos.
  assert.equal(n("factura del 2026 por 10791"), "10791");
  assert.equal(n("emitida 2026, documento 10791"), "10791");
});

test("numeroFactura: sin número no inventa nada", () => {
  for (const s of ["", null, undefined, "pendiente", "se factura en octubre", "N/A"]) {
    const r = FA.numeroFactura(s);
    assert.equal(r.numero, null, `"${s}" no debería dar número`);
    assert.equal(r.fuente, "ninguno");
  }
});

test("numeroFactura: expone los candidatos para que la pantalla pregunte", () => {
  // Dos números sin marcador: elige, pero DICE que había más de uno — quien
  // mira puede corregir en vez de tragarse una adivinanza silenciosa.
  const r = FA.numeroFactura("consolidada 10791 y 10792");
  assert.ok(r.candidatos.includes("10791") && r.candidatos.includes("10792"));
  assert.equal(r.candidatos.length, 2);
  // Con marcador hay una sola respuesta correcta y la fuente lo dice.
  const m = FA.numeroFactura("Factura N° 10791 del 2026");
  assert.equal(m.numero, "10791");
  assert.equal(m.fuente, "marcador");
});

// ── R3 (auditoría de módulos 2026-09-30): el contrato murió → sus avisos ──
const fs = require("node:fs");
const path = require("node:path");
const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");
const av = (id, estado, extra = {}) => ({ id, data: { estado, ...extra } });

test("planCierreAvisos: cierra pendiente y esperando; hecho y descartado no se tocan", () => {
  const p = FA.planCierreAvisos([
    av("a", "pendiente"), av("b", "esperando"), av("c", "hecho"), av("d", "descartado"),
  ]);
  assert.deepEqual(p.cerrar.map(x => x.id), ["a", "b"]);
  assert.deepEqual(p.intactos.map(x => x.id), ["c", "d"]);
  // Idempotente: lo que ya se cerró queda fuera en la segunda pasada.
  const otra = FA.planCierreAvisos(p.cerrar.map(x => ({ ...x, data: { ...x.data, estado: "descartado" } })));
  assert.equal(otra.cerrar.length, 0);
});

test("planCierreAvisos: vencido POR FECHA (contrato que sigue operando) solo cierra lo que espera entrega", () => {
  const p = FA.planCierreAvisos([av("a", "pendiente"), av("b", "esperando")], { soloEsperando: true });
  assert.deepEqual(p.cerrar.map(x => x.id), ["b"]);
  assert.deepEqual(p.intactos.map(x => x.id), ["a"]);
});

test("MOTIVOS_AUTO: el navegador lleva las mismas etiquetas y son distintas de los motivos humanos", () => {
  assert.deepEqual(FA.MOTIVOS_AUTO, { contrato_anulado: "Contrato anulado", contrato_vencido: "Contrato vencido" });
  const front = leer("public", "js", "services", "facturacionAvisosService.js");
  for (const [k, v] of Object.entries(FA.MOTIVOS_AUTO)) {
    assert.ok(front.includes(`${k}: '${v}'`), `facturacionAvisosService.MOTIVOS_AUTO no trae ${k}`);
  }
  assert.ok(!front.includes("codigo: 'contrato_anulado'"), "el motivo automático no debe ofrecerse en el select");
});

test("R3 · onContratoActivado cierra los avisos al anular, al vencer y al vencer por fecha (solo esperando)", () => {
  const src = leer("functions", "src", "triggers", "contratos", "onApproval.js");
  assert.ok(src.includes('cerrarAvisosDelContratoMuerto(event.params.docId, after, "contrato_vencido", { soloEsperando: true })'),
    "vencimiento_estado → vencido debe cerrar solo lo que espera entrega");
  assert.ok(src.includes('estadoAfter === "anulado" ? "contrato_anulado" : "contrato_vencido"'),
    "anulado / vencido terminal deben cerrar los avisos abiertos");
  assert.ok(src.includes("FA.cerrarAvisosDeContrato("), "el helper debe delegar en la lib");
  // La bandeja acusa el correo en error en la fila y en el chip.
  const bandeja = leer("public", "js", "pages", "facturacion-bandeja.js");
  assert.ok(bandeja.includes('data-act="reenviar"') && bandeja.includes("[data-err]"));
});

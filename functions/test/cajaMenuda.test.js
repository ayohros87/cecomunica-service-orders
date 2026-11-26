// Caja menuda (2026-11-26) — la lógica que comparten las pantallas
// (public/js/domain/cajaMenuda.js) y los avisos por correo
// (src/domain/cajaMenudaAviso.js). Las reglas vienen del cuestionario de
// Cheila (contabilidad). Lo que protegen estas pruebas:
//
//   C1 — Un reembolso que pasa del tope por factura ($20) se devuelve por
//        ACH; un anticipo siempre es efectivo.
//   C2 — Aprueba el jefe asignado o administración; nadie aprueba lo suyo.
//   C3 — Cada quien ve solo los botones que las reglas le van a aceptar.
//   C4 — El formulario: un reembolso sin factura no sale; un anticipo sí.
//   C5 — Rendición: vuelto positivo se devuelve, negativo se le debe.
//   C6 — Efectivo que salió del fondo: el ACH no cuenta; al cerrar un
//        anticipo vuelve el vuelto (o sale la diferencia).
//   C7 — La configuración guardada manda; lo que falte cae a los valores
//        del cuestionario.
//   A1 — El correo le llega a quien tiene que hacer algo, y a quien pidió
//        cuando ya hay respuesta. El eco del trigger (mismo estado) no avisa.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../public/js/domain/cajaMenuda.js");
const { avisos, numero } = require("../src/domain/cajaMenudaAviso");

const tecnico = { uid: "tec", rol: "tecnico" };
const jefa = { uid: "jefa", rol: "jefe_taller" };
const conta = { uid: "conta", rol: "contabilidad" };
const admin = { uid: "adm", rol: "administrador" };
const g = (extra = {}) => ({ id: "g1", solicitante_uid: "tec", solicitante_nombre: "Marcos", aprobador_uid: "jefa",
  aprobador_nombre: "Solangel", tipo: "reembolso", via: "efectivo", estado: "solicitado", monto: 12.5,
  concepto: "Peaje", categoria: "Peaje", ...extra });

test("C1 — por dónde se devuelve la plata", () => {
  assert.equal(C.via("reembolso", 20, {}), "efectivo");
  assert.equal(C.via("reembolso", 20.01, {}), "ach");
  assert.equal(C.via("reembolso", "35,50", {}), "ach");
  assert.equal(C.via("anticipo", 80, {}), "efectivo");
  assert.equal(C.via("reembolso", 30, { tope_recibo: 50 }), "efectivo");
});

test("C2 — quién aprueba", () => {
  assert.equal(C.esAprobador(g(), jefa), true);
  assert.equal(C.esAprobador(g(), admin), true);
  assert.equal(C.esAprobador(g(), conta), false);
  assert.equal(C.esAprobador(g(), tecnico), false);
  assert.equal(C.esAprobador(g({ solicitante_uid: "adm", aprobador_uid: null }), admin), false);
  assert.equal(C.esAprobador(g({ aprobador_uid: null }), jefa), false);
  assert.equal(C.esAprobador(g({ solicitante_uid: "jefa", aprobador_uid: "jefa" }), jefa), false);
});

test("C3 — los botones de cada quien, por estado", () => {
  assert.deepEqual(C.acciones(g(), tecnico), ["editar", "anular"]);
  assert.deepEqual(C.acciones(g(), jefa), ["aprobar", "rechazar"]);
  assert.deepEqual(C.acciones(g(), conta), []);
  assert.deepEqual(C.acciones(g({ estado: "aprobado" }), conta), ["pagar", "rechazar"]);
  assert.deepEqual(C.acciones(g({ estado: "aprobado", tipo: "anticipo" }), conta), ["entregar", "rechazar"]);
  assert.deepEqual(C.acciones(g({ estado: "aprobado" }), jefa), []);
  assert.deepEqual(C.acciones(g({ estado: "aprobado" }), tecnico), []);
  assert.deepEqual(C.acciones(g({ estado: "entregado", tipo: "anticipo" }), tecnico), ["rendir"]);
  assert.deepEqual(C.acciones(g({ estado: "entregado", tipo: "anticipo" }), conta), []);
  assert.deepEqual(C.acciones(g({ estado: "rendido", tipo: "anticipo" }), conta), ["cerrar", "devolver_rendicion"]);
  for (const estado of ["pagado", "cerrado", "rechazado", "anulado"]) {
    for (const yo of [tecnico, jefa, conta, admin]) assert.deepEqual(C.acciones(g({ estado }), yo), [], `${estado}/${yo.rol}`);
  }
  // Administración que pide: corrige lo suyo, no lo aprueba; ya aprobado, lo paga.
  assert.deepEqual(C.acciones(g({ solicitante_uid: "adm" }), admin), ["editar", "anular"]);
  assert.deepEqual(C.acciones(g({ solicitante_uid: "adm", estado: "aprobado" }), admin), ["pagar", "rechazar"]);
});

test("C4 — el formulario", () => {
  const base = { tipo: "reembolso", monto: "12.50", categoria: "Peaje", concepto: "Peaje corredor", fecha_gasto: "2026-11-25", recibos: [{ path: "x" }] };
  assert.deepEqual(C.validar(base, {}, { hoyISO: "2026-11-26" }), []);
  assert.match(C.validar({ ...base, recibos: [] }, {})[0], /foto de la factura/);
  assert.match(C.validar({ ...base, fecha_gasto: "2026-11-27" }, {}, { hoyISO: "2026-11-26" })[0], /futura/);
  assert.match(C.validar({ ...base, monto: "0" }, {})[0], /monto/);
  assert.match(C.validar({ ...base, monto: "abc" }, {})[0], /monto/);
  assert.match(C.validar({ ...base, categoria: "Otra" }, {})[0], /categoría/);
  assert.match(C.validar({ ...base, concepto: "x" }, {})[0], /para qué/);
  assert.deepEqual(C.validar({ tipo: "anticipo", monto: 20, categoria: "Combustible", concepto: "Gasolina para la visita", recibos: [] }, {}), []);
  assert.ok(C.validar(null, {}).length >= 3);
});

test("C5 — rendición de un anticipo", () => {
  assert.deepEqual(C.rendicion(20, "17.25"), { monto_gastado: 17.25, vuelto: 2.75 });
  assert.deepEqual(C.rendicion(20, 20), { monto_gastado: 20, vuelto: 0 });
  assert.deepEqual(C.rendicion(20, 23.1), { monto_gastado: 23.1, vuelto: -3.1 });
  assert.equal(C.rendicion(20, ""), null);
  assert.equal(C.rendicion(20, -1), null);
});

test("C6 — efectivo que salió del fondo", () => {
  assert.equal(C.efectivoFuera(g({ estado: "aprobado" })), 0);
  assert.equal(C.efectivoFuera(g({ estado: "pagado", entrega: { monto: 12.5 } })), 12.5);
  assert.equal(C.efectivoFuera(g({ estado: "pagado", via: "ach", monto: 80, entrega: { monto: 80 } })), 0);
  assert.equal(C.efectivoFuera(g({ tipo: "anticipo", estado: "entregado", entrega: { monto: 20 } })), 20);
  assert.equal(C.efectivoFuera(g({ tipo: "anticipo", estado: "cerrado", entrega: { monto: 20 }, cierre: { vuelto_recibido: 2.75 } })), 17.25);
  assert.equal(C.efectivoFuera(g({ tipo: "anticipo", estado: "cerrado", entrega: { monto: 20 }, cierre: { vuelto_recibido: 0, diferencia_pagada: 3.1 } })), 23.1);
  assert.equal(C.efectivoFuera(g({ estado: "rechazado" })), 0);
});

test("C7 — configuración", () => {
  assert.deepEqual(C.config(null), C.CONFIG_DEFECTO);
  const c = C.config({ fondo: 300, tope_recibo: "25", categorias: [" Taxi ", ""], dias_rendir: 0 });
  assert.equal(c.fondo, 300);
  assert.equal(c.tope_recibo, 25);
  assert.deepEqual(c.categorias, ["Taxi"]);
  assert.equal(c.dias_rendir, C.CONFIG_DEFECTO.dias_rendir);
  assert.equal(c.minimo_reposicion, 50);
});

test("A1 — a quién se le avisa", () => {
  const para = (antes, despues) => avisos(antes, despues, "g1").map(a => a.para);
  assert.deepEqual(para(null, g()), ["aprobador"]);
  assert.deepEqual(para(g(), g({ estado: "aprobado", aprobacion: { por_nombre: "Solangel" } })), ["custodios", "solicitante"]);
  assert.deepEqual(para(g(), g({ estado: "rechazado", rechazo: { motivo: "No aplica" } })), ["solicitante"]);
  assert.deepEqual(para(g({ estado: "aprobado" }), g({ estado: "rechazado", rechazo: { motivo: "Factura no fiscal" } })), ["solicitante"]);
  assert.deepEqual(para(g({ estado: "aprobado" }), g({ estado: "pagado", entrega: { monto: 12.5 } })), []);
  assert.deepEqual(para(g({ estado: "aprobado", via: "ach" }), g({ estado: "pagado", via: "ach", entrega: { monto: 80, referencia: "123" } })), ["solicitante"]);
  assert.deepEqual(para(g({ estado: "aprobado", tipo: "anticipo" }), g({ estado: "entregado", tipo: "anticipo" })), []);
  assert.deepEqual(para(g({ estado: "entregado", tipo: "anticipo" }), g({ estado: "rendido", tipo: "anticipo", rendicion: { monto_gastado: 17, vuelto: 3 } })), ["custodios"]);
  assert.deepEqual(para(g({ estado: "rendido", tipo: "anticipo" }), g({ estado: "entregado", tipo: "anticipo", rendicion_devuelta: { motivo: "Falta" } })), ["solicitante"]);
  assert.deepEqual(para(g({ estado: "rendido" }), g({ estado: "cerrado" })), []);
  assert.deepEqual(para(g(), g({ estado: "anulado" })), []);
  // El eco de poner el número: mismo estado, no se avisa otra vez.
  assert.deepEqual(para(g(), g({ numero: "CM-0001" })), []);
  assert.deepEqual(para(g(), null), []);

  const [a] = avisos(null, g(), "abc");
  assert.match(a.asunto, /Marcos pide \$12\.50 \(reembolso\)/);
  assert.equal(a.cta.path, "/caja/index.html?g=abc");
  const [c] = avisos(g(), g({ estado: "aprobado", via: "ach", monto: 80 }), "abc");
  assert.match(c.intro, /ACH/);
  assert.equal(c.cta.path, "/caja/contabilidad.html?g=abc");
  const [r] = avisos(g(), g({ estado: "rechazado", rechazo: { por_nombre: "Solangel", motivo: "No es de la empresa" } }), "abc");
  assert.deepEqual(r.filas[0], ["Motivo", "No es de la empresa"]);

  assert.equal(numero(7), "CM-0007");
  assert.equal(numero(12345), "CM-12345");
});

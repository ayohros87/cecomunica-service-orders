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

// ── Fondo, arqueo y reposición (2026-11-26) ────────────────────────────────
// De las muestras de Cheila: su "Informe de caja menuda y arqueo" de los
// recibos 15235 al 15258 ($183.18) y el conteo con el que cuadró $16.82.
//
//   F1 — Por reponer: solo lo que ya sacó efectivo del fondo y no ha entrado
//        en una reposición. El ACH y lo que sigue abierto no cuentan.
//   F2 — El arqueo de Cheila cuadra al centavo (147 monedas de 1¢ no dan
//        1.4700000000000002).
//   F3 — En caja debe haber: fondo − recibos − anticipos en la calle −
//        reposiciones cuyo cheque no ha vuelto.
//   F4 — El conteo solo admite enteros y denominaciones de la lista.
//   F5 — El informe sale en el formato de su Excel: una columna por
//        categoría, totales, cuadre y arqueo.
//   F6 — El servidor usa LA MISMA lógica: src/domain/cajaMenuda.js es copia
//        exacta de public/js/domain/cajaMenuda.js.
const fs = require("node:fs");
const path = require("node:path");

const pagado = (n, monto, categoria, extra = {}) => g({ id: `p${n}`, numero: `CM-${String(n).padStart(4, "0")}`,
  estado: "pagado", monto, categoria, entrega: { monto, at: new Date("2026-11-18T15:00:00Z") }, ...extra });
const CONTEO_CHEILA = { m1: 147, m5: 2, m10: 0, m25: 1, m50: 0, m100: 5, b1: 0, b5: 2, b10: 0, b20: 0 };

test("F1 — qué está por reponer", () => {
  assert.equal(C.porReponer(pagado(1, 8, "Peaje")), true);
  assert.equal(C.porReponer(pagado(1, 35, "Combustible", { via: "ach" })), false, "el ACH no sale del fondo");
  assert.equal(C.porReponer(pagado(1, 8, "Peaje", { reposicion_id: "r1" })), false, "ya entró en una reposición");
  assert.equal(C.porReponer(g({ estado: "aprobado" })), false);
  const anticipo = g({ tipo: "anticipo", estado: "entregado", entrega: { monto: 20 } });
  assert.equal(C.porReponer(anticipo), false, "el anticipo en la calle todavía no tiene recibo");
  assert.equal(C.enLaCalle(anticipo), 20);
  assert.equal(C.enLaCalle({ ...anticipo, estado: "rendido" }), 20);
  const cerrado = { ...anticipo, estado: "cerrado", cierre: { vuelto_recibido: 7.5, diferencia_pagada: 0 } };
  assert.equal(C.porReponer(cerrado), true);
  assert.equal(C.enLaCalle(cerrado), 0);
  assert.equal(C.porReponer({ ...anticipo, estado: "cerrado", cierre: { vuelto_recibido: 20 } }), false, "devolvió todo: no hay nada que reponer");
});

test("F2 — el arqueo de Cheila cuadra al centavo", () => {
  const a = C.arqueo(CONTEO_CHEILA);
  assert.equal(a.efectivo, 16.82);
  assert.equal(a.lineas.find((l) => l.id === "m1").monto, 1.47);
  assert.equal(a.lineas.find((l) => l.id === "b5").monto, 10);
  assert.equal(C.arqueo(null).efectivo, 0);
  assert.equal(C.arqueo({ m1: -3, b5: 1.5 }).efectivo, 0, "lo que no es un entero positivo no suma");
});

test("F3 — cuánto debe haber en caja", () => {
  const recibos = [pagado(1, 1.05, "Transporte y estacionamiento"), pagado(2, 5, "Vales y viáticos"), pagado(3, 177.13, "Misceláneo")];
  const q = C.cuadre({ fondo: 200, gastos: recibos, conteo: CONTEO_CHEILA });
  assert.deepEqual(q, { fondo: 200, n: 3, gastado: 183.18, anticipos: 0, por_cobrar: 0, esperado: 16.82, efectivo: 16.82, diferencia: 0 });

  const conAnticipo = [...recibos.slice(0, 2), g({ id: "a1", tipo: "anticipo", estado: "entregado", entrega: { monto: 20 } }),
    pagado(9, 50, "Combustible", { via: "ach" })];
  const q2 = C.cuadre({ fondo: 200, gastos: conAnticipo,
    reposiciones: [{ tipo: "reposicion", estado: "preparada", total: 100 }, { tipo: "reposicion", estado: "repuesta", total: 80 },
      { tipo: "arqueo", estado: "hecho", total: 60 }] });
  assert.equal(q2.gastado, 6.05);
  assert.equal(q2.anticipos, 20);
  assert.equal(q2.por_cobrar, 100, "solo la reposición cuyo cheque no ha vuelto");
  assert.equal(q2.esperado, 73.95);
  assert.equal("diferencia" in q2, false, "sin conteo no hay diferencia");
  assert.equal(C.cuadre({ fondo: 200, gastos: [], conteo: { b20: 9, b10: 1 } }).diferencia, -10, "faltan $10");
  assert.equal(C.cuadre({ fondo: 200, gastos: [], conteo: { b20: 10, m25: 1 } }).diferencia, 0.25, "sobran 25 centavos");
});

test("F4 — el conteo", () => {
  assert.equal(C.conteoValido(CONTEO_CHEILA), true);
  assert.equal(C.conteoValido({}), true, "caja vacía");
  assert.equal(C.conteoValido({ b5: 1.5 }), false);
  assert.equal(C.conteoValido({ b5: -1 }), false);
  assert.equal(C.conteoValido({ b50: 1 }), false, "denominación que no existe");
  assert.equal(C.conteoValido({ b5: "2" }), false);
  assert.equal(C.conteoValido(null), false);
  assert.equal(C.conteoValido([1, 2]), false);
});

test("F5 — el informe en el formato del Excel de Cheila", () => {
  const recibos = [pagado(2, 5, "Vales y viáticos", { concepto: "Viático Campana" }), pagado(1, 1.05, "Transporte y estacionamiento"),
    pagado(3, 8, "Regalos", { solicitante_nombre: "Elvia" }), pagado(4, 30, "Combustible", { via: "ach" })];
  const items = C.itemsInforme(recibos);
  assert.deepEqual(items.map((i) => i.numero), ["CM-0001", "CM-0002", "CM-0003"], "en orden de número y sin el ACH");
  assert.equal(items[0].fecha, "2026-11-18", "la fecha del pago, en hora de Panamá");
  assert.equal(C.fechaPanama(Date.UTC(2026, 10, 19, 3, 0, 0)), "2026-11-18", "las 10 p. m. en Panamá siguen siendo el 18");

  const conteo = { b20: 9, b5: 1, m25: 3, m10: 2 };
  const q = C.cuadre({ fondo: 200, gastos: recibos, conteo });
  const { filas, columnas } = C.informe({ tipo: "reposicion", numero: "REP-0001", fecha: "2026-11-18", fondo: 200, items,
    desde: "CM-0001", hasta: "CM-0003", esperado: q.esperado, arqueo: { conteo }, created_by_nombre: "Cheila" },
  C.CONFIG_DEFECTO.categorias);
  const cab = filas.find((f) => f[0] === "COMP");
  assert.deepEqual(cab.slice(0, 4), ["COMP", "FECHA", "BENEFICIARIO", "VALES Y VIÁTICOS"]);
  assert.equal(cab[cab.length - 3], "REGALOS", "una categoría que ya no está en la lista igual tiene su columna");
  assert.equal(cab.length, columnas);
  const f2 = filas.find((f) => f[0] === "CM-0002");
  assert.equal(f2[1], "18/11/2026");
  assert.equal(f2[3], 5, "el monto va en la columna de su categoría");
  assert.equal(f2[f2.length - 1], 5);
  const totales = filas[filas.indexOf(filas.find((f) => f[0] === "CM-0003")) + 1];
  assert.equal(totales[totales.length - 1], 14.05);
  const linea = (txt) => filas.find((f) => f[2] === txt);
  assert.equal(linea("FONDO DE CAJA")[3], 200);
  assert.equal(linea("REEMBOLSO:")[3], 14.05);
  assert.equal(linea("TOTAL EN CAJA:")[3], 185.95);
  assert.equal(filas.find((f) => f[0] === "Efectivo en Caja")[3], 185.95);
  assert.equal(filas.some((f) => f[0] === "Faltante" || f[0] === "Sobrante"), false, "cuadra: no hay renglón de diferencia");
  assert.ok(filas.some((f) => f[0] === "Preparado por: Cheila"));

  // Un arqueo suelto: sin lista de recibos, con lo que falta.
  const arq = C.informe({ tipo: "arqueo", numero: "ARQ-0001", fondo: 200, total: 14.05, items: [], esperado: 185.95,
    arqueo: { conteo: { b20: 9 } } }, C.CONFIG_DEFECTO.categorias).filas;
  assert.equal(arq.some((f) => f[0] === "COMP"), false);
  assert.equal(arq.find((f) => f[2] === "RECIBOS SIN REPONER:")[3], 14.05);
  assert.deepEqual(arq.find((f) => f[0] === "Faltante"), ["Faltante", "", "", 5.95]);
  assert.equal(C.numeroReposicion("reposicion", 7), "REP-0007");
  assert.equal(C.numeroReposicion("arqueo", 12), "ARQ-0012");
});

test("F6 — el servidor usa la misma lógica que la pantalla", () => {
  const publico = fs.readFileSync(path.join(__dirname, "../../public/js/domain/cajaMenuda.js"), "utf8");
  const servidor = fs.readFileSync(path.join(__dirname, "../src/domain/cajaMenuda.js"), "utf8");
  assert.equal(servidor, publico, "copia public/js/domain/cajaMenuda.js a functions/src/domain/cajaMenuda.js");
});

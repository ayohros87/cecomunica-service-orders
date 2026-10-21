// Totales de señales del home (empresa/senales_totales, 2026-10-21).
//
// El home pinta "Cuentas por regularizar" y "Comisiones listas" desde un
// documento que escribe el servidor. Si el predicado del servidor se aparta
// del que usa la lista del cliente (senalesService), el número de la tarjeta
// y las filas del panel dejan de cuadrar. Estos guardias congelan el predicado:
//
//   T1 — regularizar: puntos > 0 cuenta; 0, sin bloque, borrada o inactiva no.
//   T2 — regularizar: "solo bodega" y pospuesta (snooze vigente) no cuentan;
//        un snooze vencido vuelve a contar.
//   T3 — comisión lista: aplica + vendedor + solo falta `pago`.
//   T4 — comisión NO lista: no aplica, ya pagada/periodo, sin vendedor,
//        falta otro requisito además del pago, o no falta nada.
//
// Corre con `npm test` (node --test). No necesita emulador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const fbAdmin = require("firebase-admin");
if (!fbAdmin.apps.length) fbAdmin.initializeApp({ projectId: "test-senales-totales" });

const ST = require("../src/lib/senalesTotales");

const now = new Date("2026-10-21T12:00:00Z");
const cuenta = (extra = {}) => ({ nombre: "X", regularizacion: { puntos: 3 }, ...extra });

test("T1 — regularizar: puntos > 0 cuenta; 0, sin bloque, borrada o inactiva no", () => {
  assert.equal(ST.cuentaParaRegularizar(cuenta(), now), true);
  assert.equal(ST.cuentaParaRegularizar(cuenta({ regularizacion: { puntos: 0 } }), now), false);
  assert.equal(ST.cuentaParaRegularizar({ nombre: "sin bloque" }, now), false);
  assert.equal(ST.cuentaParaRegularizar(cuenta({ deleted: true }), now), false);
  assert.equal(ST.cuentaParaRegularizar(cuenta({ activo: false }), now), false);
  assert.equal(ST.cuentaParaRegularizar(null, now), false);
});

test("T2 — regularizar: solo bodega y pospuesta no cuentan; snooze vencido sí", () => {
  assert.equal(ST.cuentaParaRegularizar(cuenta({ regularizacion: { puntos: 2, solo_bodega: true } }), now), false);
  assert.equal(ST.cuentaParaRegularizar(cuenta({ pendiente_snooze: { hasta: "2026-12-01", motivo: "en trámite" } }), now), false);
  assert.equal(ST.cuentaParaRegularizar(cuenta({ pendiente_snooze: { hasta: "2026-01-01", motivo: "vencido" } }), now), true);
});

const aviso = (com) => ({ cliente_nombre: "Y", comision: com });
const req = (o) => Object.fromEntries(Object.entries(o).map(([k, hecho]) => [k, { aplica: true, hecho }]));

test("T3 — comisión lista: aplica, con vendedor y solo falta el pago", () => {
  assert.equal(ST.comisionLista(aviso({ aplica: true, vendedor_email: "v@x", requisitos: req({ factura: true, entrega: true, pago: false }) })), true);
  // Un requisito que no aplica no estorba.
  assert.equal(ST.comisionLista(aviso({ aplica: true, vendedor_email: "v@x", requisitos: { ...req({ pago: false }), activacion: { aplica: false, hecho: false } } })), true);
});

test("T4 — comisión NO lista: no aplica, pagada, sin vendedor, falta otro requisito o no falta nada", () => {
  const base = { aplica: true, vendedor_email: "v@x", requisitos: req({ factura: true, pago: false }) };
  assert.equal(ST.comisionLista(aviso({ ...base, aplica: false })), false);
  assert.equal(ST.comisionLista(aviso({ ...base, liberada_at: "2026-10-01" })), false);
  assert.equal(ST.comisionLista(aviso({ ...base, periodo: "2026-09" })), false);
  assert.equal(ST.comisionLista(aviso({ ...base, vendedor_email: null })), false);
  assert.equal(ST.comisionLista(aviso({ ...base, requisitos: req({ factura: false, pago: false }) })), false);
  assert.equal(ST.comisionLista(aviso({ ...base, requisitos: req({ factura: true, pago: true }) })), false);
  assert.equal(ST.comisionLista(aviso({ aplica: true, vendedor_email: "v@x", requisitos: {} })), false);
  assert.equal(ST.comisionLista({}), false);
});

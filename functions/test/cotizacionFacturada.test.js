// Cotización de taller → factura (2026-09-14, pedido de Solangel).
//
// LO QUE PROTEGE
//   El circuito nuevo tiene tres piezas que se pisan si una cambia sola:
//     1. lib/cotizacionServicio  — qué cotización entra a facturarse y con qué
//        números. Si `esFacturable` se ablanda, a Recepción le caen borradores
//        y trabajos que el cliente rechazó.
//     2. `periodo: false` en el paso QBO — una reparación se cobra UNA vez.
//        Si el flag se pierde, la bandeja vuelve a exigir "facturar desde",
//        que es una pregunta de contrato mensual, y Recepción no puede marcar
//        la fila.
//     3. El resumen NO lleva `mensual` — si lo llevara en 0, la fila diría
//        "$0.00/mes" sobre una reparación de $104.22.
//
// Datos tomados de la COT-2026-0091 real (SKY CHEFS, orden 2026090701).
// Corre con: node --test (desde functions/).
const test = require("node:test");
const assert = require("node:assert/strict");

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

const CS = require("../src/lib/cotizacionServicio");

// COT-2026-0091: 7 renglones sobre un solo radio, subtotal 97.40 + ITBMS 6.82.
const COT = {
  cotizacion_id: "COT-2026-0091",
  origen: "orden", orden_id: "2026090701", estado: "enviada", deleted: false,
  cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", clienteId: "KDDQ7nRrOlbDlIOAAkmm",
  creado_por_email: "solangel.hosang@cecomunica.com",
  itbms_aplica: true, subtotal: 97.4, itbms_monto: 6.82, total: 104.22, total_con_itbms: 104.22,
  items: [
    { nombre: "Flex Vol/Sel NX-420", modelo: "J87-0040-05", cant: 1, precio: 8.95, desc: 0,
      equipo: { serial: "B6810431", modelo: "NX-420-R" } },
    { nombre: "Front Cover 4 Teclas", modelo: "A02-4131-13", cant: 1, precio: 40, desc: 0,
      equipo: { serial: "B6810431", modelo: "NX-420-R" } },
    { nombre: "Belt Clip", modelo: "KBH-12", cant: 1, precio: 10, desc: 0,
      equipo: { serial: "B6810431", modelo: "NX-420-R" } },
  ],
};

test("esFacturable: solo las de taller que de verdad salieron al cliente", () => {
  assert.equal(CS.esFacturable(COT), true);
  assert.equal(CS.esFacturable({ ...COT, estado: "aprobada" }), true);
  assert.equal(CS.esFacturable({ ...COT, estado: "convertida" }), true);

  // Un borrador nunca se envió; rechazada/vencida son un "no" del cliente.
  assert.equal(CS.esFacturable({ ...COT, estado: "borrador" }), false);
  assert.equal(CS.esFacturable({ ...COT, estado: "rechazada" }), false);
  assert.equal(CS.esFacturable({ ...COT, estado: "vencida" }), false);
  // La prueba que Solangel se mandó a sí misma (COT-2026-0090) quedó eliminada.
  assert.equal(CS.esFacturable({ ...COT, deleted: true }), false);
  // Una cotización comercial no se factura por esta vía: no nace de una orden.
  assert.equal(CS.esFacturable({ ...COT, origen: "comercial", orden_id: null }), false);
});

test("resumenCotizacion: el total es ÚNICO, no mensual", () => {
  const r = CS.resumenCotizacion(COT);
  assert.equal(r.total, 104.22);
  assert.equal(r.unico, 104.22);
  assert.equal(r.subtotal, 97.4);
  assert.equal(r.itbms, 6.82);
  assert.equal(r.exento, false);
  // La invariante que evita el "$0.00/mes" en la fila de la bandeja.
  assert.equal(r.mensual, null);
  assert.equal(r.delta_mensual, null);
  assert.deepEqual(r.seriales, ["B6810431"]);
  assert.equal(r.renglones_n, 3);
});

test("resumenCotizacion: cliente exento no arrastra ITBMS", () => {
  const r = CS.resumenCotizacion({ ...COT, itbms_aplica: false, itbms_monto: 0, total: 97.4, total_con_itbms: 97.4 });
  assert.equal(r.exento, true);
  assert.equal(r.total, 97.4);
});

test("renglones: importe = cant × precio menos el descuento de la línea", () => {
  const rs = CS.renglones(COT);
  assert.equal(rs.length, 3);
  assert.equal(rs[0].nombre, "Flex Vol/Sel NX-420");
  // `modelo` de un renglón de servicio es el número de PARTE, no el del radio.
  assert.equal(rs[0].parte, "J87-0040-05");
  assert.equal(rs[0].serial, "B6810431");
  assert.equal(rs[1].importe, 40);

  const conDesc = CS.renglones({ items: [{ nombre: "X", cant: 2, precio: 50, desc: 10 }] });
  assert.equal(conDesc[0].importe, 90);

  // Renglón en cero (borrado a medias en el editor) no entra a la factura.
  assert.equal(CS.renglones({ items: [{ nombre: "X", cant: 0, precio: 50 }] }).length, 0);
});

test("pasosIniciales: la cotización de taller no pide período, el contrato sí", () => {
  const cot = FA.pasosIniciales("cotizacion_servicio");
  assert.equal(cot.qbo.aplica, true);
  assert.equal(cot.qbo.periodo, false);   // no se pregunta "facturar desde"
  assert.equal(cot.poc.aplica, false);    // el radio es del cliente: no se activa nada

  const contrato = FA.pasosIniciales("contrato_activo");
  assert.equal(contrato.qbo.aplica, true);
  assert.equal(contrato.poc.aplica, true);
  // Los tipos de siempre NO estampan el flag → el navegador los lee como true
  // y sigue exigiendo la fecha, igual que antes del cambio.
  assert.equal(contrato.qbo.periodo, undefined);
});

test("una reparación de taller no paga comisión, y lo dice", () => {
  const com = FA.bloqueComision("cotizacion_servicio", {});
  assert.equal(com.aplica, false);
  assert.equal(com.estado, "no_aplica");
  assert.match(com.motivo, /no paga comisión/);
});

test("estadoDerivado: con POC fuera, marcar QBO cierra la fila", () => {
  const aviso = { estado: "pendiente", pasos: FA.pasosIniciales("cotizacion_servicio") };
  assert.equal(FA.estadoDerivado(aviso), "pendiente");
  aviso.pasos.qbo.hecho = true;
  assert.equal(FA.estadoDerivado(aviso), "hecho");
});

test("el id del aviso es determinista: re-entregar no duplica la fila", () => {
  assert.equal(
    FA.avisoId("cotizacion_servicio", "whtwQl5eKnnbj3Jj0N9a"),
    "cotizacion_servicio__whtwQl5eKnnbj3Jj0N9a"
  );
});

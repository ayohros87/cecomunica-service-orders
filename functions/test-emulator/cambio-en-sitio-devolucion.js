// Cambio de radio en sitio → DEVOLUCIÓN abierta sola → recepción la recibe →
// ENTRADA del taller (2026-11-18). Recorre el circuito completo con el núcleo
// del callable y el trigger REAL de devoluciones, contra el emulador:
//
//   npx firebase emulators:exec --only firestore --project demo-p4 "node functions/test-emulator/cambio-en-sitio-devolucion.js"
//
// Lo que congela: el tiquete nace con el cliente de la VISITA (recepción ya no
// lo elige a mano — así nació la devolución de EUROLATIN a nombre de MENZIES);
// queda abierto mientras nadie reciba el radio; y al recibirlo, el radio que
// ya estaba "por revisar" no se mueve dos veces, el kardex dice cuándo llegó a
// recepción y la ENTRADA sale a nombre del mismo cliente.
"use strict";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-p4";
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { catalogo } = require("../src/domain/modeloCatalogo");
const regularizar = require("../src/callable/regularizarReemplazoOrden");
const trigger = require("../src/triggers/ordenes/onOrdenDevolucionWrite");

const VISITA = "2026111850";
const snapDe = (data) => ({ exists: !!data, data: () => data });
// Escribe la orden y corre el trigger con el antes/después reales.
async function escribir(ordenId, cambios) {
  const ref = db.collection("ordenes_de_servicio").doc(ordenId);
  const before = (await ref.get()).data() || null;
  await ref.set(cambios, { merge: true });
  const after = (await ref.get()).data();
  await trigger.run({ params: { ordenId }, data: { before: snapDe(before), after: snapDe(after) } });
  return (await ref.get()).data();
}

(async () => {
  for (const c of ["modelos", "equipos_pool", "ordenes_de_servicio", "gestiones", "contadores", "mail_queue", "usuarios", "clientes", "contratos"]) {
    await db.recursiveDelete(db.collection(c));
  }
  await db.collection("modelos").doc("m360").set({ modelo: "PNC360S", marca: "HYTERA", estado: "N", activo: true });
  await catalogo({ force: true });
  await db.collection("clientes").doc("euro").set({ nombre: "EUROLATIN DE PRUEBA" });
  await db.collection("contratos").doc("c9").set({ contrato_id: "ALQ-9", cliente_id: "euro", estado: "activo" });
  const asig = { contrato_doc_id: "c9", contrato_id: "ALQ-9", cliente_id: "euro", cliente_nombre: "EUROLATIN DE PRUEBA" };
  const ficha = (id, extra) => db.collection("equipos_pool").doc(id).set({ serial: id, serial_norm: id, modelo_id: "m360", modelo_label: "HYTERA PNC360S", ...extra });
  await ficha("CSVIEJO1", { estado: "en_cliente", asignacion: asig });
  await ficha("CSNUEVO1", { estado: "en_bodega" });
  await db.collection("ordenes_de_servicio").doc(VISITA).set({ tipo_de_servicio: "VISITA TECNICA", estado_reparacion: "ASIGNADO",
    cliente_id: "euro", cliente_nombre: "EUROLATIN DE PRUEBA", tecnico_asignado: "Ovidio Adames",
    equipos: [{ id: "e1", numero_de_serie: "CSVIEJO1", modelo: "PNC360S" }] });

  // 1) El técnico registra el cambio y dice que se trajo el radio.
  const r = await regularizar.ejecutar({ usuario: "tec@x.com", nombre: "Ovidio Adames", ordenId: VISITA,
    serialSaliente: "CSVIEJO1", serialEntrante: "CSNUEVO1", salienteEnCasa: true, motivo: "no encendía; se cambió en sitio" });
  assert.ok(r.devolucion_id, "abre la devolución");
  const DEV = r.devolucion_id;
  let dev = await escribir(DEV, {});   // el eco de la creación
  assert.equal(dev.cliente_id, "euro", "el cliente sale de la visita, no de la memoria de recepción");
  assert.equal(dev.estado_reparacion, "POR ASIGNAR", "queda abierta mientras nadie reciba el radio");
  assert.equal(dev.orden_entrada_id || null, null, "sin recibo no hay ENTRADA");
  assert.equal(dev.devolucion.esperados.length, 1);
  assert.equal((await db.collection("equipos_pool").doc("CSVIEJO1").get()).data().estado, "devuelto_revision");
  console.log("  ok   el cambio en sitio abre la devolución del cliente de la visita, pendiente de recibir");

  // 2) Recepción recibe el radio (check-in).
  const e0 = dev.devolucion.esperados[0];
  dev = await escribir(DEV, { devolucion: { esperados: [{ ...e0, resolucion: "recibido", resuelto_por: "recep",
    accesorios: { bateria: true, antena: true }, dano_visible: "pantalla rayada" }] } });
  const pool = (await db.collection("equipos_pool").doc("CSVIEJO1").get()).data();
  assert.equal(pool.estado, "devuelto_revision", "ya estaba por revisar: el recibo no lo mueve otra vez");
  const movs = (await db.collection("equipos_pool").doc("CSVIEJO1").collection("movimientos").get()).docs.map(d => d.data().notas || "");
  assert.ok(movs.some(n => new RegExp(`Recibido en recepción \\(devolución ${DEV}\\)`).test(n)), "el kardex dice cuándo llegó a recepción");
  assert.ok(dev.orden_entrada_id, "el recibo crea la ENTRADA del taller");
  const ent = (await db.collection("ordenes_de_servicio").doc(dev.orden_entrada_id).get()).data();
  assert.equal(ent.tipo_de_servicio, "ENTRADA"); assert.equal(ent.cliente_id, "euro");
  assert.deepEqual(ent.equipos.map(e => e.numero_de_serie || e.serial), ["CSVIEJO1"]);
  console.log("  ok   recepción recibe: kardex anotado, ENTRADA a nombre del mismo cliente");

  // 3) El radio nuevo sigue con el cliente, en el contrato del viejo.
  const nuevo = (await db.collection("equipos_pool").doc("CSNUEVO1").get()).data();
  assert.equal(nuevo.estado, "en_cliente"); assert.equal(nuevo.asignacion.contrato_doc_id, "c9");

  // 4) Radio del cliente SIN ficha (2026-11-24, DECAMERON: 125 de 146 radios de
  //    la visita no estaban en el inventario). El cambio no rebota: se crea la
  //    ficha con la propiedad por definir, y un entrante inválido no deja ficha.
  await db.collection("usuarios").doc("u-bodega").set({ rol: "inventario", email: "bodega@x.com", activo: true });
  await ficha("CSNUEVO2", { estado: "con_tecnico", salida_visita: { orden_id: VISITA } });
  await ficha("CSOTRAVISITA", { estado: "con_tecnico", salida_visita: { orden_id: "otra" } });
  await db.collection("ordenes_de_servicio").doc(VISITA).set({
    equipos: [{ id: "e1", numero_de_serie: "CSVIEJO1", modelo: "PNC360S" }, { id: "e2", numero_de_serie: "CSSINFICHA1", modelo: "PNC360S", modelo_id: "m360" }],
    radios_salida: { CSNUEVO2: { estado: "llevado", serial: "CSNUEVO2" } },
  }, { merge: true });
  await assert.rejects(regularizar.ejecutar({ usuario: "tec@x.com", ordenId: VISITA, serialSaliente: "CSSINFICHA1", serialEntrante: "CSOTRAVISITA", motivo: "no transmitía" }), /salió de bodega con la visita/);
  assert.equal((await db.collection("equipos_pool").doc("CSSINFICHA1").get()).exists, false, "el cambio rechazado no deja una ficha suelta");
  const r4 = await regularizar.ejecutar({ usuario: "tec@x.com", nombre: "Marcos Perez", ordenId: VISITA,
    serialSaliente: "CSSINFICHA1", serialEntrante: "CSNUEVO2", salienteEnCasa: true, motivo: "no transmitía; se cambió en sitio" });
  assert.equal(r4.saliente_sin_ficha, true);
  const sinFicha = (await db.collection("equipos_pool").doc("CSSINFICHA1").get()).data();
  assert.equal(sinFicha.estado, "devuelto_revision", "el radio recibido queda por revisar");
  assert.equal(sinFicha.propiedad, "desconocida", "la propiedad no se inventa");
  assert.equal(sinFicha.verificado, false);
  assert.equal(sinFicha.asignacion, null, "ya no está con el cliente");
  const movs4 = (await db.collection("equipos_pool").doc("CSSINFICHA1").collection("movimientos").get()).docs.map(d => d.data().notas || "");
  assert.ok(movs4.some(n => /no estaba en el inventario/.test(n)), "el kardex dice de dónde salió la ficha");
  const nuevo2 = (await db.collection("equipos_pool").doc("CSNUEVO2").get()).data();
  assert.equal(nuevo2.estado, "en_cliente"); assert.equal(nuevo2.asignacion.cliente_id, "euro");
  assert.equal(nuevo2.asignacion.contrato_doc_id, null, "sin contrato conocido: custodia del cliente");
  assert.equal(nuevo2.reemplaza_a, "CSSINFICHA1");
  const visita4 = (await db.collection("ordenes_de_servicio").doc(VISITA).get()).data();
  assert.equal(visita4.radios_salida.CSNUEVO2.estado, "dejado");
  assert.equal(visita4.reemplazos_regularizados.CSSINFICHA1.gestion_id, r4.gestion_id);
  const correos4 = (await db.collection("mail_queue").get()).docs.map(d => JSON.stringify(d.data()));
  assert.ok(correos4.some(c => /CSSINFICHA1/.test(c) && /no estaba en el inventario/.test(c)), "bodega se entera de que hay que clasificarlo");
  assert.ok(r4.devolucion_id, "también abre la devolución del radio recibido");
  console.log("  ok   radio del cliente sin ficha: se da de alta por definir, el cambio sigue y bodega se entera");

  console.log("\nTODO OK");
  process.exit(0);
})().catch((e) => { console.error("\nFALLA:", e); process.exit(1); });

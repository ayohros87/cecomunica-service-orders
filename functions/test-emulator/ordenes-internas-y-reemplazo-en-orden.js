// Dos cambios del 2026-11-20 (correos de Brenda y de Solangel), contra
// Firestore real y con los triggers de verdad.
//
// A) REEMPLAZO DENTRO DE LA ORDEN DE ORIGEN (Brenda, caso MENZIES).
//    El taller revisa los radios de un contrato que aún no se entrega, uno
//    falla y propone el reemplazo. Antes el entrante nacía en una OS aparte
//    (4 radios en la 2026111701 y 1 en la 2026112001: dos órdenes, dos firmas).
//    Congela:
//      1) el entrante entra en la orden de origen en el lugar del saliente,
//         con sus accesorios y su descripción; NO se crea otra orden;
//      2) la orden completada vuelve al técnico;
//      3) el saliente sale de la orden y del contrato → devuelto_revision;
//      4) al entregarse la orden, el expediente registra entrega y entrada,
//         sin orden de devolución, y el entrante queda con su linaje;
//      5) origen ya entregado, o una REPARACIÓN → la OS propia de siempre;
//      6) anular el reemplazo NO elimina la orden del contrato.
//
// B) DEVOLVER A BODEGA una orden interna (Solangel, maquillaje de C COMUNICA).
//    Congela:
//      1) solo lo que SIGUE en la orden vuelve a bodega, sin custodia; lo que
//         ya salió no se toca; el reservado a un contrato vuelve a "asignado";
//      2) la orden queda CERRADA (A BODEGA) con motivo y la foto de qué volvió;
//      3) no aplica a órdenes de clientes, visitas, cerradas ni sin motivo;
//      4) un radio que entra a una orden interna NO recibe custodia de
//         C COMUNICA (el arrastre del caso APMT, 2026-10-28).
//
// C) La salida de radios a una visita le avisa a recepción.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-internas \
//     "node functions/test-emulator/ordenes-internas-y-reemplazo-en-orden.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-internas";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const G = require("../src/lib/gestiones");
const onGestionWrite = require("../src/triggers/gestiones/onGestionWrite");
const onOrdenWriteGestion = require("../src/triggers/gestiones/onOrdenWriteGestion");
const onOrdenWritePool = require("../src/triggers/ordenes/onOrdenWritePool");
const devolver = require("../src/callable/devolverOrdenABodega");
const salida = require("../src/callable/salidaRadiosVisita");
const { ID_POR_DEFECTO: INTERNO } = require("../src/domain/clienteInterno");

let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
const MOD = { id: "x7hlVuYhyf22JhzR4hqz", label: "HYTERA PNC360S-R" };
const CLI = "cli-menzies";
const CID = "cto-temp";
const CONTRATO = "TEMP20261116-02";
const GID = "GR20261118-03";
const OS = "2026111701";
const SALIENTE = "22806A0281";
const ENTRANTE = "22806A0255";
const OTROS = ["24522A0545", "24708A1169"];

const asig = () => ({ contrato_doc_id: CID, contrato_id: CONTRATO, cliente_id: CLI, cliente_nombre: "MENZIES AVIATION" });
const ficha = (serial, estado, extra = {}) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, modelo_id: MOD.id, modelo_label: MOD.label,
  estado, propiedad: "cecomunica", verificado: true, ...extra,
});
const leer = async (serial) => (await db.doc(`equipos_pool/${serial}`).get()).data();
const orden = async (id) => (await db.doc(`ordenes_de_servicio/${id}`).get()).data();
const eq = (serial, extra = {}) => ({
  id: `eq-${serial}`, serial, numero_de_serie: serial, modelo: "PNC360S-R", modelo_id: MOD.id,
  bateria: true, clip: true, cargador: true, fuente: false, antena: true, cubrepolvo: true,
  observaciones: CONTRATO, trabajo_tecnico: "Programación aplicada.", eliminado: false, ...extra,
});

async function limpiar() {
  for (const c of ["equipos_pool", "gestiones", "contratos", "ordenes_de_servicio", "mail_queue", "sistema"]) {
    const s = await db.collection(c).get();
    for (const d of s.docs) {
      for (const sub of await d.ref.listCollections()) {
        const ss = await sub.get(); await Promise.all(ss.docs.map((x) => x.ref.delete()));
      }
      await d.ref.delete();
    }
  }
}

const gestionBase = () => ({
  tipo: "reemplazo", estado: "pendiente_bodega", cliente_id: CLI, cliente_nombre: "MENZIES AVIATION",
  responsable_uid: "vend-1", responsable_email: "ventas@cecomunica.com",
  contratos_afectados: [CID], cierre: { aprobacion: true },
  origen: { tipo: "taller", orden_id: OS, equipo_id: `eq-${SALIENTE}`, serial: SALIENTE, saliente_en_casa: true,
    tecnico_email: "solangel.hosang@cecomunica.com" },
  items: [{
    serial_saliente: SALIENTE, pool_doc_id_saliente: SALIENTE, saliente_en_casa: true,
    modelo: MOD.label, modelo_id: MOD.id, modelo_solicitado: MOD.label, modelo_solicitado_id: MOD.id,
    contrato_id: CONTRATO, contrato_doc_id: CID, motivo_codigo: "otro", motivo_detalle: "no le funciona el teclado",
    elegibilidad: "alquiler",
  }],
});
const conSerial = () => {
  const g = gestionBase();
  Object.assign(g.items[0], { serial_nuevo: ENTRANTE, pool_doc_id_nuevo: ENTRANTE, modelo_nuevo: MOD.label, modelo_id_nuevo: MOD.id, asignado_at: new Date().toISOString() });
  return g;
};
async function eventoGestion(antes, despues) {
  const ref = db.doc(`gestiones/${GID}`);
  await ref.set(antes); const before = await ref.get();
  await ref.set(despues); const after = await ref.get();
  return { data: { before, after }, params: { gid: GID } };
}
// Corre un trigger de órdenes con el antes/después REAL de una escritura.
async function conTriggerOrden(trigger, id, escribir) {
  const ref = db.doc(`ordenes_de_servicio/${id}`);
  const before = await ref.get();
  await escribir(ref);
  const after = await ref.get();
  await trigger.run({ data: { before, after }, params: { ordenId: id } });
}
const ordenesVivas = async () => (await db.collection("ordenes_de_servicio").get()).docs.filter((d) => !d.data().eliminado).map((d) => d.id);

async function sembrarOrigen({ estado = "COMPLETADO (EN OFICINA)", tipo = "PROGRAMACIÓN" } = {}) {
  await limpiar();
  await db.doc(`clientes/${CLI}`).set({ nombre: "MENZIES AVIATION", vendedor_asignado: "vend-1", activo: true });
  await db.doc("usuarios/recep-1").set({ rol: "recepcion", email: "cecrecep@cecomunica.com" });
  await db.doc("usuarios/taller-1").set({ rol: "jefe_taller", email: "solangel.hosang@cecomunica.com" });
  await db.doc("usuarios/bodega-1").set({ rol: "inventario", email: "jose.solis@cecomunica.com" });
  await db.doc(`contratos/${CID}`).set({ contrato_id: CONTRATO, estado: "aprobado", cliente_id: CLI });
  for (const s of [...OTROS, SALIENTE]) await ficha(s, "en_taller", { asignacion: asig(), orden_actual_id: OS });
  await ficha(ENTRANTE, "en_bodega");
  await db.doc(`ordenes_de_servicio/${OS}`).set({
    cliente_id: CLI, cliente_nombre: "MENZIES AVIATION", tipo_de_servicio: tipo, estado_reparacion: estado,
    tecnico_asignado: "Jesus Santos", tecnico_uid: "tec-1", eliminado: false, qc_requerido: true,
    contrato: { aplica: true, contrato_doc_id: CID, contrato_id: CONTRATO, motivo_no_aplica: null },
    equipos: [eq(OTROS[0]), eq(SALIENTE, { fuente: true, observaciones: `${CONTRATO} · jefe de rampa` }), eq(OTROS[1])],
  });
}

async function parteA() {
  console.log("A) reemplazo dentro de la orden de origen");
  await sembrarOrigen();
  const oRef = db.doc(`ordenes_de_servicio/${OS}`);
  const antesOrden = await oRef.get();
  await onGestionWrite.run(await eventoGestion(gestionBase(), conSerial()));

  let o = await orden(OS);
  assert.deepEqual(await ordenesVivas(), [OS], "no se crea una segunda orden");
  const vivos = o.equipos.filter((e) => !e.eliminado);
  assert.deepEqual(vivos.map((e) => e.serial), [OTROS[0], ENTRANTE, OTROS[1]], "el entrante ocupa el lugar del saliente");
  const nuevo = vivos[1];
  assert.equal(nuevo.fuente, true, "hereda los accesorios del saliente");
  assert.equal(nuevo.cubrepolvo, true);
  assert.match(nuevo.observaciones, /REEMPLAZA al serial 22806A0281/);
  assert.match(nuevo.observaciones, /jefe de rampa/, "y su descripción");
  assert.ok(!nuevo.trabajo_tecnico, "sin intervención: falta programarlo");
  assert.equal(o.equipos.find((e) => e.serial === SALIENTE).eliminado, true);
  ok("el entrante entra en la orden de origen con accesorios y descripción; sin orden nueva");

  assert.equal(o.estado_reparacion, "ASIGNADO", "la orden completada vuelve al técnico");
  assert.equal(o.reemplazos_absorbidos[GID].entrante, ENTRANTE);
  assert.equal(o.gestion, undefined, "la orden del contrato NO pasa a ser 'de la gestión' (sus candados de firma siguen)");
  ok("la orden completada vuelve al técnico y recuerda qué reemplazo absorbió");

  let g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.ordenes.programacion_id, OS);
  assert.equal(g.ordenes.en_orden_origen, true);
  assert.equal(g.estado, "en_proceso");
  const mails = (await db.collection("mail_queue").get()).docs.map((d) => d.data());
  const aviso = mails.find((m) => /Reemplazo en la orden 2026111701/.test(m.subject || m.message?.subject || ""));
  assert.ok(aviso, `sale el aviso con los dos seriales (asuntos: ${mails.map((m) => m.subject || m.message?.subject).join(" | ")})`);
  ok("el expediente apunta a la orden de origen y recepción recibe el aviso de siempre");

  let s = await leer(SALIENTE);
  assert.equal(s.estado, "devuelto_revision", `el saliente queda por revisar, quedó ${s.estado}`);
  assert.equal(s.asignacion, null, "y fuera del contrato");
  // El trigger del pool, con la escritura real de la orden: mete al entrante
  // al taller y NO resucita al saliente.
  const despuesOrden = await oRef.get();
  await onOrdenWritePool.run({ data: { before: antesOrden, after: despuesOrden }, params: { ordenId: OS } });
  s = await leer(SALIENTE);
  assert.equal(s.estado, "devuelto_revision", "el trigger del pool no lo devuelve al contrato");
  const e = await leer(ENTRANTE);
  assert.equal(e.estado, "en_taller");
  assert.equal(e.orden_actual_id, OS);
  assert.equal(e.asignacion?.contrato_doc_id, CID);
  ok("el saliente sale de la orden y del contrato; el entrante queda en taller en esa orden");

  // Entrega de la orden de origen → el expediente se entera solo.
  await conTriggerOrden(onOrdenWriteGestion, OS, (ref) => ref.update({ estado_reparacion: "ENTREGADO AL CLIENTE" }));
  g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.cierre.entrega, true);
  assert.equal(g.cierre.entrada, true, "el saliente ya estaba en casa: sin devolución");
  assert.equal(g.ordenes.devolucion_id, undefined);
  assert.deepEqual(await ordenesVivas(), [OS], "tampoco nace una orden de devolución");
  assert.equal((await leer(ENTRANTE)).reemplaza_a, SALIENTE);
  ok("al entregar la orden, el reemplazo registra entrega y entrada, con linaje y sin devolución");

  // Anular el reemplazo no puede llevarse la orden del contrato.
  await sembrarOrigen({ estado: "ASIGNADO" });
  await onGestionWrite.run(await eventoGestion(gestionBase(), conSerial()));
  o = await orden(OS);
  assert.equal(o.estado_reparacion, "ASIGNADO", "una orden en curso se queda donde está");
  g = (await db.doc(`gestiones/${GID}`).get()).data();
  const acciones = await G.limpiarAnulacion(GID, g);
  assert.notEqual((await orden(OS)).eliminado, true, "la orden del contrato sigue viva");
  assert.ok(acciones.some((a) => /no se elimina/.test(a)), `lo deja dicho: ${acciones.join(" · ")}`);
  ok("anular el reemplazo no elimina la orden del contrato");

  // Caminos de siempre.
  await sembrarOrigen({ estado: "ENTREGADO AL CLIENTE" });
  await onGestionWrite.run(await eventoGestion(gestionBase(), conSerial()));
  let vivas = await ordenesVivas();
  assert.equal(vivas.length, 2, "origen ya entregado → OS propia");
  assert.equal((await orden(OS)).equipos.filter((x) => !x.eliminado).length, 3, "y la orden entregada no se toca");
  await sembrarOrigen({ tipo: "REPARACIÓN" });
  await onGestionWrite.run(await eventoGestion(gestionBase(), conSerial()));
  vivas = await ordenesVivas();
  assert.equal(vivas.length, 2, "origen REPARACIÓN → OS propia");
  ok("origen entregado o de reparación: el reemplazo sigue con su propia OS");

  // Recepción ya había quitado el saliente a mano (lo que hizo Brenda).
  const plan = G.planAbsorcionEnOrigen({
    cliente_id: CLI, tipo_de_servicio: "PROGRAMACION", estado_reparacion: "POR ASIGNAR",
    contrato: { aplica: true, contrato_doc_id: CID },
    equipos: [eq(OTROS[0]), eq(SALIENTE, { eliminado: true, fuente: true })],
  }, conSerial(), GID, { nuevoId: "nuevo" });
  assert.deepEqual(plan.equipos.filter((x) => !x.eliminado).map((x) => x.serial), [OTROS[0], ENTRANTE]);
  assert.equal(plan.equipos.at(-1).fuente, true, "hereda de la fila que se quitó");
  assert.equal(plan.regresa, false);
  assert.equal(G.planAbsorcionEnOrigen({ cliente_id: "otro", tipo_de_servicio: "PROGRAMACIÓN", estado_reparacion: "ASIGNADO", equipos: [] }, conSerial(), GID), null, "otro cliente → no");
  ok("si recepción ya había quitado el saliente, el entrante entra igual y hereda de esa fila");
}

async function parteB() {
  console.log("B) devolver a bodega una orden interna");
  await limpiar();
  const OI = "2026111202";
  const [A, B, C, D] = ["22N22A0229", "23914A1066", "24522A0604", "B6210643"];
  const custodia = { contrato_doc_id: null, contrato_id: "", cliente_id: INTERNO, cliente_nombre: "C COMUNICA, S.A." };
  await ficha(A, "en_taller", { asignacion: custodia, orden_actual_id: OI });
  await ficha(B, "en_bodega");
  await ficha(C, "en_taller", { asignacion: asig(), orden_actual_id: OI });
  await ficha(D, "con_tecnico", { salida_visita: { orden_id: "2026111905" } });
  const base = {
    cliente_id: INTERNO, cliente_nombre: "C COMUNICA, S.A.", tipo_de_servicio: "PROGRAMACIÓN",
    estado_reparacion: "COMPLETADO (EN OFICINA)", eliminado: false, observaciones: "RADIOS PARA MAQUILLAJE",
    contrato: { aplica: false, contrato_doc_id: null, contrato_id: null, motivo_no_aplica: "PARA MAQUILLAJE" },
    equipos: [A, B, C, D].map((s) => eq(s, { observaciones: "" })),
  };
  await db.doc(`ordenes_de_servicio/${OI}`).set(base);
  await db.doc("usuarios/bodega-1").set({ rol: "inventario", email: "jose.solis@cecomunica.com" });
  await db.doc("usuarios/recep-1").set({ rol: "recepcion", email: "cecrecep@cecomunica.com" });

  const falla = async (args, patron) => assert.rejects(() => devolver.ejecutar({ usuario: "x@cecomunica.com", ...args }), patron);
  await falla({ ordenId: OI, motivo: "corto" }, /mínimo 10/);
  await db.doc("ordenes_de_servicio/cliente-1").set({ ...base, cliente_id: "cli-real", cliente_nombre: "ACME" });
  await falla({ ordenId: "cliente-1", motivo: "ya fueron maquillados todos" }, /Solo las órdenes de C COMUNICA/);
  await db.doc("ordenes_de_servicio/visita-1").set({ ...base, tipo_de_servicio: "VISITA TÉCNICA" });
  await falla({ ordenId: "visita-1", motivo: "ya fueron maquillados todos" }, /propio cierre/);
  ok("no aplica a órdenes de clientes, a visitas, ni sin motivo");

  let res;
  await conTriggerOrden(onOrdenWritePool, OI, async () => {
    res = await devolver.ejecutar({ usuario: "jose.solis@cecomunica.com", uid: "bodega-1", ordenId: OI, motivo: "Maquillados; salen a la visita de Decameron" });
  });
  assert.deepEqual(res.vuelven.map((u) => u.serial), [A, C]);
  assert.deepEqual(res.ya_no_estaban.map((u) => u.serial), [B, D]);
  const o = await orden(OI);
  assert.equal(o.estado_reparacion, "CERRADA (A BODEGA)");
  assert.equal(o.devuelta_bodega.motivo, "Maquillados; salen a la visita de Decameron");
  assert.equal(o.estado_antes_de_bodega, "COMPLETADO (EN OFICINA)");
  ok("la orden queda CERRADA (A BODEGA) con el motivo y la foto de qué volvió");

  const a = await leer(A);
  assert.equal(a.estado, "en_bodega");
  assert.equal(a.asignacion, null, "sin la custodia de C COMUNICA");
  assert.equal(a.orden_actual_id, null);
  assert.equal((await leer(B)).estado, "en_bodega");
  const c = await leer(C);
  assert.equal(c.estado, "asignado_contrato", "el reservado a un contrato vuelve a asignado, no pierde su reserva");
  assert.equal(c.asignacion.contrato_doc_id, CID);
  assert.equal((await leer(D)).estado, "con_tecnico", "el que salió con un técnico no se toca");
  ok("vuelve a bodega solo lo que seguía en la orden; lo que ya salió no se toca");

  await falla({ ordenId: OI, motivo: "otra vez la misma orden" }, /ya está cerrada/);
  const mail = (await db.collection("mail_queue").get()).docs.map((d) => d.data())
    .find((m) => /devuelta a bodega/.test(m.subject || m.message?.subject || ""));
  assert.ok(mail, "bodega recibe el aviso");
  ok("una orden ya devuelta no se devuelve dos veces; sale el aviso a bodega");

  // Ingreso a una orden interna: sin custodia de C COMUNICA.
  const NUEVO = "24813A0555";
  await ficha(NUEVO, "en_bodega");
  await db.doc("ordenes_de_servicio/interna-2").set({ ...base, estado_reparacion: "POR ASIGNAR", equipos: [] });
  await conTriggerOrden(onOrdenWritePool, "interna-2", (ref) => ref.update({ equipos: [eq(NUEVO)] }));
  const nu = await leer(NUEVO);
  assert.equal(nu.estado, "en_taller");
  assert.ok(!nu.asignacion, `sin custodia de C COMUNICA, quedó ${JSON.stringify(nu.asignacion)}`);
  // …y a la de un cliente, la custodia de siempre.
  const DEL = "19999A0001";
  await db.doc("ordenes_de_servicio/cliente-2").set({ ...base, cliente_id: "cli-real", cliente_nombre: "ACME", estado_reparacion: "POR ASIGNAR", equipos: [] });
  await conTriggerOrden(onOrdenWritePool, "cliente-2", (ref) => ref.update({ equipos: [eq(DEL)] }));
  assert.equal((await leer(DEL)).asignacion?.cliente_id, "cli-real");
  ok("un radio que entra a una orden interna no recibe custodia; el de un cliente sí");
}

async function parteC() {
  console.log("C) la salida a una visita le avisa a recepción");
  await limpiar();
  await db.doc("usuarios/recep-1").set({ rol: "recepcion", email: "cecrecep@cecomunica.com" });
  await ficha("B3900440", "en_bodega");
  await db.doc("ordenes_de_servicio/2026111905").set({
    tipo_de_servicio: "VISITA TÉCNICA", estado_reparacion: "ASIGNADO", tecnico_asignado: "Marcos Perez",
    cliente_id: "cli-dec", cliente_nombre: "HOTELES DECAMERON", eliminado: false, equipos: [],
  });
  const r = await salida.ejecutar({ usuario: "jose.solis@cecomunica.com", accion: "sacar", ordenId: "2026111905", seriales: ["B3900440"] });
  assert.ok(r.aviso_mail_id, "devuelve el id del correo");
  const m = (await db.collection("mail_queue").get()).docs.map((d) => d.data())
    .find((x) => /Salieron 1 radio/.test(x.subject || x.message?.subject || ""));
  assert.ok(m, "correo a recepción");
  assert.match(JSON.stringify(m), /cecrecep@cecomunica\.com/);
  ok("al registrar la salida, recepción recibe el aviso con los seriales");
}

(async () => {
  await parteA();
  await parteB();
  await parteC();
  console.log(`\n${n} comprobaciones OK`);
  process.exit(0);
})().catch((e) => { console.error("\nFALLÓ:", e); process.exit(1); });

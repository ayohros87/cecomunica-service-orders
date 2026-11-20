// Cierre de ENTRADA: qué es incidencia y qué no (correo de Brenda, 2026-11-20,
// "Equipos que no llegaron a bodega al cerrar su ENTRADA: 3").
//
// Dos ENTRADAs de julio se cerraron el 17-nov y el correo diario empezó a
// pedirle a recepción que resolviera tres radios que no tenían nada que
// resolver:
//   · 24708A1206 (PANAMA JET, 2026071001): bodega lo había dado de baja el
//     5-oct, facturado al cliente. "No se pudo mover (está baja)".
//   · 25725A0543 y 25725A0542 (MUNICIPIO, 2026071304): la fila decía
//     "PNC460S-R" y las fichas son PNC460 / PNC460-R. "No existe en
//     inventario" — con la ficha ahí, uno con otro cliente y el otro en bodega.
//
// Congela, contra Firestore real y el trigger onOrdenWritePool:
//   A) los tres casos reales cierran SIN incidencia y sin mover las fichas;
//   B) otro modelo en la fila + ficha en cuarentena → aterriza igual en bodega;
//   C) otro modelo + ficha con OTRO cliente desde antes → no se toca y se avisa
//      como `otro_modelo` (con el modelo de la ficha), no como "no existe";
//      al corregir el modelo de la fila, el reintento lo aterriza y se limpia;
//   D) lo que sigue siendo incidencia: serial que de verdad no existe
//      (`sin_ficha`) y baja ANTERIOR a la ENTRADA (`no_movio`);
//   E) el cron: `incidenciaSuperada` da por superadas las tres anotaciones
//      viejas mirando desde que la ENTRADA abrió, no desde que cerró.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-cierre-entrada \
//     "node functions/test-emulator/cierre-entrada-incidencias.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-cierre-entrada";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onOrdenWritePool = require("../src/triggers/ordenes/onOrdenWritePool");
const { incidenciaSuperada } = require("../src/lib/incidenciasEntrada");

const T = (iso) => admin.firestore.Timestamp.fromDate(new Date(iso));
const M360R = { id: "mod-360sr", label: "PNC360S-R" };
const M460 = { id: "mod-460", label: "HYTERA PNC460" };
const M460R = { id: "mod-460r", label: "HYTERA PNC460-R" };
const JOSE = "bodega@demo.test";
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const ficha = (serial, modelo, estado, extra = {}) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, serial_compartido: false, modelo_id: modelo.id, modelo_label: modelo.label,
  estado, propiedad: "cecomunica", verificado: true, asignacion: null, orden_actual_id: null, ...extra,
});
const mov = (serial, iso, tipo, de, a, { ref = null, email = null } = {}) =>
  db.collection(`equipos_pool/${serial}/movimientos`).add({
    at: T(iso), tipo, de_estado: de, a_estado: a, ref, por: email ? "uid" : "system", por_email: email, notas: "",
  });
const leerFicha = async (s) => (await db.doc(`equipos_pool/${s}`).get()).data();
const movsDe = async (s) => (await db.collection(`equipos_pool/${s}/movimientos`).get()).docs.map((d) => d.data());
const leerOrden = async (id) => (await db.doc(`ordenes_de_servicio/${id}`).get()).data();
// La fila tal como quedó en la orden real de MUNICIPIO: texto "PNC460S-R" con
// el id de la fila PNC360S-R del catálogo.
const filaMal = (serial) => ({ id: `eq-${serial}`, serial, modelo: "PNC460S-R", modelo_id: M360R.id });
const filaDe = (serial, modelo) => ({ id: `eq-${serial}`, serial, modelo: modelo.label, modelo_id: modelo.id });

async function limpiar() {
  for (const col of ["equipos_pool", "ordenes_de_servicio"]) {
    const s = await db.collection(col).get();
    for (const d of s.docs) {
      const m = await d.ref.collection("movimientos").get();
      for (const x of m.docs) await x.ref.delete();
      await d.ref.delete();
    }
  }
}

const entrada = (creadaIso, equipos, extra = {}) => ({
  tipo_de_servicio: "ENTRADA", estado_reparacion: "POR ASIGNAR",
  cliente_id: "cli-origen", cliente_nombre: "CLIENTE QUE DEVUELVE",
  fecha_creacion: T(creadaIso), equipos, ...extra,
});

// Escribe `antes`, luego `despues`, y corre el trigger con ese par.
async function escribir(ordenId, antes, despues) {
  const ref = db.doc(`ordenes_de_servicio/${ordenId}`);
  if (antes) await ref.set(antes);
  const before = await ref.get();
  await ref.set(despues, { merge: true });
  const after = await ref.get();
  await onOrdenWritePool.run({ data: { before, after }, params: { ordenId } });
}
const cerrar = (ordenId, orden, cierreIso = "2026-11-17T15:11:04Z") =>
  escribir(ordenId, orden, { estado_reparacion: "CERRADA (ENTRADA)", fecha_cierre_entrada: T(cierreIso) });

async function casosReales() {
  await limpiar();
  // 24708A1206: en cuarentena por la ENTRADA; José lo libera y lo da de baja
  // el 5-oct, con la ENTRADA todavía abierta.
  await ficha("24708A1206", M360R, "baja", { baja_motivo: "facturado 10053 daño causado" });
  await mov("24708A1206", "2026-07-14T22:56:05Z", "migracion", null, "en_poc", { ref: { tipo: "poc", id: "dev1" } });
  await mov("24708A1206", "2026-07-24T22:10:56Z", "correccion_migracion", "en_poc", "devuelto_revision", { ref: { tipo: "orden", id: "2026071001" } });
  await mov("24708A1206", "2026-10-05T15:38:03Z", "liberacion", "devuelto_revision", "en_bodega", { email: JOSE });
  await mov("24708A1206", "2026-10-05T15:39:06Z", "baja", "en_bodega", "baja", { email: JOSE });
  await cerrar("2026071001", entrada("2026-07-10T12:54:56Z", [filaDe("24708A1206", M360R)]));
  let o = await leerOrden("2026071001");
  assert.equal(o.cierre_entrada_con_incidencias, undefined, "la baja decidida por bodega no es incidencia");
  assert.equal((await leerFicha("24708A1206")).estado, "baja");
  ok("A1 · radio dado de baja por bodega con la ENTRADA abierta: cierra sin aviso y sigue de baja");

  // 25725A0543: con otro cliente por un contrato posterior a la ENTRADA.
  const asig = { cliente_id: "cli-shevet", cliente_nombre: "SHEVET", contrato_id: "ALQ20260826-01", contrato_doc_id: "c3" };
  await ficha("25725A0543", M460, "en_cliente", { asignacion: asig });
  await mov("25725A0543", "2026-07-15T17:48:42Z", "asignacion_contrato", "en_bodega", "en_cliente", { ref: { tipo: "contrato", id: "c1" } });
  await mov("25725A0543", "2026-09-18T13:44:45Z", "reasignacion", "en_cliente", "en_cliente", { ref: { tipo: "contrato", id: "c3" } });
  // 25725A0542: mismo camino, y bodega lo devolvió al estante el 17-nov.
  await ficha("25725A0542", M460R, "en_bodega");
  await mov("25725A0542", "2026-07-15T17:48:41Z", "asignacion_contrato", "en_bodega", "en_cliente", { ref: { tipo: "contrato", id: "c1" } });
  await mov("25725A0542", "2026-11-17T14:34:03Z", "correccion_migracion", "en_taller", "en_bodega", { email: JOSE });
  await cerrar("2026071304", entrada("2026-07-13T15:13:40Z", [filaMal("25725A0543"), filaMal("25725A0542")]), "2026-11-17T15:11:31Z");
  o = await leerOrden("2026071304");
  assert.equal(o.cierre_entrada_con_incidencias, undefined, "radios que siguieron su vida: sin incidencia");
  const f3 = await leerFicha("25725A0543");
  assert.equal(f3.estado, "en_cliente");
  assert.equal(f3.asignacion.cliente_id, "cli-shevet", "el cierre no lo saca del cliente que lo tiene");
  assert.equal((await leerFicha("25725A0542")).estado, "en_bodega");
  assert.equal((await db.collection("equipos_pool").get()).size, 3, "no nace ninguna ficha fantasma por el modelo");
  ok("A2 · fila con otro modelo y radios ya reubicados: cierra sin aviso y no los mueve");
}

async function otroModeloEnCuarentena() {
  await limpiar();
  await ficha("25725A0600", M460R, "devuelto_revision", { asignacion: { cliente_id: "cli-origen", cliente_nombre: "CLIENTE QUE DEVUELVE" } });
  await ficha("25725A0601", M460R, "devuelto_revision");
  await cerrar("2026110001", entrada("2026-11-01T12:00:00Z", [filaMal("25725A0600"), filaDe("25725A0601", M460R)]));
  const o = await leerOrden("2026110001");
  assert.equal(o.cierre_entrada_con_incidencias, undefined);
  for (const s of ["25725A0600", "25725A0601"]) {
    const f = await leerFicha(s);
    assert.equal(f.estado, "en_bodega", `${s} aterriza`);
    assert.equal(f.asignacion, null);
    assert.equal(f.verificado, true);
  }
  const m = (await movsDe("25725A0600")).find((x) => x.tipo === "cierre_entrada");
  assert.ok(m && m.ref.id === "2026110001");
  assert.match(m.notas, /la fila de la orden dice "PNC460S-R"; la ficha es HYTERA PNC460-R/);
  assert.equal((await leerFicha("25725A0600")).modelo_label, M460R.label, "el modelo de la ficha no lo pisa la fila");
  ok("B · otro modelo en la fila + ficha en cuarentena: aterriza en bodega y el kardex lo cuenta");
}

async function otroModeloConOtroCliente() {
  await limpiar();
  const ajeno = { cliente_id: "cli-otro", cliente_nombre: "OTRO CLIENTE", contrato_id: "ALQ-X", contrato_doc_id: "cx" };
  await ficha("25725A0700", M460, "en_cliente", { asignacion: ajeno });
  await mov("25725A0700", "2026-03-01T00:00:00Z", "asignacion_contrato", "en_bodega", "en_cliente", { ref: { tipo: "contrato", id: "cx" } });
  const OS = "2026110002";
  await cerrar(OS, entrada("2026-11-01T12:00:00Z", [filaMal("25725A0700")]));
  let o = await leerOrden(OS);
  assert.equal(o.cierre_entrada_con_incidencias, true);
  assert.deepEqual(o.cierre_entrada_incidencias, [{
    serial: "25725A0700", modelo: "PNC460S-R", motivo: "otro_modelo", estado: "en_cliente", modelo_ficha: "HYTERA PNC460",
  }]);
  assert.equal((await leerFicha("25725A0700")).asignacion.cliente_id, "cli-otro", "no se toca");
  ok("C1 · otro modelo y la ficha con OTRO cliente: no se mueve y el aviso dice `otro_modelo`, no \"no existe\"");

  // Recepción corrige el modelo de la fila → el reintento lo aterriza.
  const antes = await leerOrden(OS);
  await escribir(OS, null, { equipos: [filaDe("25725A0700", M460)] });
  o = await leerOrden(OS);
  assert.equal(o.cierre_entrada_con_incidencias, undefined, "la anotación se limpia sola");
  assert.equal((await leerFicha("25725A0700")).estado, "en_bodega");
  assert.ok(antes.cierre_entrada_incidencias.length === 1);
  ok("C2 · al corregir el modelo en la orden, el radio aterriza y el aviso desaparece");
}

async function loQueSigueSiendoIncidencia() {
  await limpiar();
  // Baja ANTERIOR a la ENTRADA: el sistema dice que no existe y el radio volvió.
  await ficha("24708A0001", M360R, "baja");
  await mov("24708A0001", "2026-02-01T00:00:00Z", "baja", "en_bodega", "baja", { email: JOSE });
  await ficha("24708A0002", M360R, "devuelto_revision");
  await cerrar("2026110003", entrada("2026-11-01T12:00:00Z", [
    filaDe("24708A0001", M360R), filaDe("24708A0002", M360R), filaDe("24708A9999", M360R),
  ]));
  const o = await leerOrden("2026110003");
  assert.equal(o.cierre_entrada_con_incidencias, true);
  const porSerial = Object.fromEntries(o.cierre_entrada_incidencias.map((i) => [i.serial, i]));
  assert.deepEqual(Object.keys(porSerial).sort(), ["24708A0001", "24708A9999"]);
  assert.equal(porSerial["24708A0001"].motivo, "no_movio");
  assert.equal(porSerial["24708A0001"].estado, "baja");
  assert.equal(porSerial["24708A9999"].motivo, "sin_ficha");
  assert.equal(porSerial["24708A9999"].modelo_ficha, undefined);
  assert.equal((await leerFicha("24708A0002")).estado, "en_bodega", "el sano aterriza como siempre");
  ok("D · siguen avisándose: serial que no existe (`sin_ficha`) y baja anterior a la ENTRADA (`no_movio`)");
}

async function cronLimpiaLasViejas() {
  await limpiar();
  // Las tres anotaciones tal como están hoy en producción: el cierre viejo las
  // dejó, y todo lo que les pasó a los radios fue ANTES del cierre.
  await ficha("24708A1206", M360R, "baja");
  await mov("24708A1206", "2026-10-05T15:39:06Z", "baja", "en_bodega", "baja", { email: JOSE });
  await ficha("25725A0543", M460, "en_cliente", { asignacion: { cliente_id: "cli-shevet" } });
  await mov("25725A0543", "2026-07-15T17:48:42Z", "asignacion_contrato", "en_bodega", "en_cliente", { ref: { tipo: "contrato", id: "c1" } });
  await ficha("24708A0050", M360R, "devuelto_revision");
  await mov("24708A0050", "2026-07-24T22:10:56Z", "correccion_migracion", "en_poc", "devuelto_revision");
  await mov("24708A0050", "2026-08-19T22:35:35Z", "correccion_modelo", "devuelto_revision", "devuelto_revision", { email: JOSE });

  const abierta = T("2026-07-10T12:54:56Z");
  const cierre = T("2026-11-17T15:11:04Z");
  assert.equal(await incidenciaSuperada("24708A1206", { ordenId: "2026071001", desde: cierre }), false, "la regla vieja no la veía");
  assert.equal(await incidenciaSuperada("24708A1206", { ordenId: "2026071001", desde: cierre, abierta }), true);
  assert.equal(await incidenciaSuperada("25725A0543", { ordenId: "2026071304", desde: cierre, abierta }), true);
  // Solo migraciones del sistema y ajustes de dato: nadie lo ubicó → sigue viva.
  assert.equal(await incidenciaSuperada("24708A0050", { ordenId: "2026071001", desde: cierre, abierta }), false);
  assert.equal(await incidenciaSuperada("24708A9999", { ordenId: "2026071001", desde: cierre, abierta }), false, "sin ficha no se supera sola");
  ok("E · el cron da por superado lo que alguien ubicó desde que la ENTRADA abrió");
}

(async () => {
  console.log("Cierre de ENTRADA — incidencias");
  await casosReales();
  await otroModeloEnCuarentena();
  await otroModeloConOtroCliente();
  await loQueSigueSiendoIncidencia();
  await cronLimpiaLasViejas();
  console.log(`\n${n} recorridos OK`);
  process.exit(0);
})().catch((e) => { console.error("\nFALLÓ:", e); process.exit(1); });

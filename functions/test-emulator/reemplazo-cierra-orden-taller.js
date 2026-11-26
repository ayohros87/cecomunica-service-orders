// La orden de taller cuyo radio se reemplazó (correo de Brenda, 2026-11-26).
//
// El taller propone el reemplazo de un radio que entró a REPARACIÓN; el radio
// malo ya está en la casa, así que la gestión no abre devolución. Antes, la
// orden de reparación se quedaba en COMPLETADO con "Entregar" para siempre
// (Asamblea Nacional 2026111104, SEPROSA 2026112002) y entregarla mandaba al
// cliente, en inventario, el radio que ya se le cambió. Congela:
//   1) al entregarse el reemplazo, la fila del saliente sale de la orden
//      (eliminado + reemplazado_por) y el radio queda por revisar;
//   2) si no queda nada por entregar, la orden cierra: CERRADA (REEMPLAZADO);
//   3) el trigger del pool, con esa escritura, NO manda el radio al cliente;
//   4) con otro radio del cliente todavía en la orden, la orden sigue abierta
//      solo por él y su QC no caduca;
//   5) un descarte que se queda en Cecomunica o algo ya entregado en una tanda
//      no cuentan como pendientes;
//   6) orden ya entregada, de otro cliente o sin el saliente → no se toca.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-reemp \
//     "node functions/test-emulator/reemplazo-cierra-orden-taller.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-reemp";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const G = require("../src/lib/gestiones");
const onOrdenWriteGestion = require("../src/triggers/gestiones/onOrdenWriteGestion");
const onOrdenWritePool = require("../src/triggers/ordenes/onOrdenWritePool");
const PendientesDomain = require("../src/domain/pendientes");

let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
const MOD = { id: "6tdGBjLOmq567GJRTMbQ", label: "HYTERA PNC460-R" };
const CLI = "cli-asamblea";
const GID = "GR20261111-01";
const OS = "2026111104";       // reparación
const PROG = "2026111204";     // programación del entrante
const SALIENTE = "23O05A4464";
const ENTRANTE = "23O05A4466";
const OTRO = "23O05A4470";

const ficha = (serial, estado, extra = {}) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, modelo_id: MOD.id, modelo_label: MOD.label,
  estado, propiedad: "cecomunica", verificado: true, ...extra,
});
const leer = async (serial) => (await db.doc(`equipos_pool/${serial}`).get()).data();
const orden = async (id) => (await db.doc(`ordenes_de_servicio/${id}`).get()).data();
const eq = (serial, extra = {}) => ({
  id: `eq-${serial}`, serial, numero_de_serie: serial, modelo: "PNC460-R", modelo_id: MOD.id,
  bateria: true, cubrepolvo: true, eliminado: false, ...extra,
});
const qcAprobado = (seriales, extra = {}) => ({
  resultado: "aprobado", equipos_n: seriales.length,
  por_equipo: Object.fromEntries(seriales.map((s) => [`eq-${s}`, { serial: s, resultado: "aprobado", ...(extra[s] || {}) }])),
});

async function limpiar() {
  for (const c of ["equipos_pool", "gestiones", "ordenes_de_servicio", "mail_queue"]) {
    const s = await db.collection(c).get();
    for (const d of s.docs) {
      for (const sub of await d.ref.listCollections()) {
        const ss = await sub.get(); await Promise.all(ss.docs.map((x) => x.ref.delete()));
      }
      await d.ref.delete();
    }
  }
}

const gestion = () => ({
  tipo: "reemplazo", estado: "en_proceso", cliente_id: CLI, cliente_nombre: "ASAMBLEA NACIONAL",
  responsable_email: "solangel.hosang@cecomunica.com", contratos_afectados: [],
  cierre: { aprobacion: true, asignacion: true },
  origen: { tipo: "taller", orden_id: OS, equipo_id: `eq-${SALIENTE}`, serial: SALIENTE, saliente_en_casa: true },
  ordenes: { programacion_id: PROG, programacion_ids: [PROG] },
  items: [{
    serial_saliente: SALIENTE, pool_doc_id_saliente: SALIENTE, saliente_en_casa: true,
    serial_nuevo: ENTRANTE, pool_doc_id_nuevo: ENTRANTE,
    modelo: MOD.label, modelo_id: MOD.id, modelo_nuevo: MOD.label, modelo_id_nuevo: MOD.id,
    contrato_id: null, contrato_doc_id: null, elegibilidad: "alquiler",
  }],
});

async function sembrar({ equipos, qc, estado = "COMPLETADO (EN OFICINA)", cliente = CLI, extra = {} }) {
  await limpiar();
  await ficha(SALIENTE, "en_taller", { orden_actual_id: OS });
  await ficha(OTRO, "en_taller", { orden_actual_id: OS });
  await ficha(ENTRANTE, "en_taller", { orden_actual_id: PROG });
  await db.doc(`ordenes_de_servicio/${OS}`).set({
    cliente_id: cliente, cliente_nombre: "ASAMBLEA NACIONAL", tipo_de_servicio: "REPARACIÓN",
    estado_reparacion: estado, eliminado: false, qc_requerido: true, qc, equipos, ...extra,
  });
  await db.doc(`ordenes_de_servicio/${PROG}`).set({
    cliente_id: CLI, cliente_nombre: "ASAMBLEA NACIONAL", tipo_de_servicio: "PROGRAMACIÓN",
    estado_reparacion: "COMPLETADO (EN OFICINA)", eliminado: false,
    gestion: { id: GID, tipo: "reemplazo" }, equipos: [eq(ENTRANTE)],
  });
  await db.doc(`gestiones/${GID}`).set(gestion());
}

// Entrega la programación del entrante con los dos triggers reales, y después
// corre el trigger del pool sobre la escritura que le hicieron a la orden de taller.
async function entregarReemplazo() {
  const oRef = db.doc(`ordenes_de_servicio/${OS}`);
  const antesTaller = await oRef.get();
  const pRef = db.doc(`ordenes_de_servicio/${PROG}`);
  const before = await pRef.get();
  await pRef.update({ estado_reparacion: "ENTREGADO AL CLIENTE" });
  const after = await pRef.get();
  await onOrdenWriteGestion.run({ data: { before, after }, params: { ordenId: PROG } });
  const despuesTaller = await oRef.get();
  await onOrdenWritePool.run({ data: { before: antesTaller, after: despuesTaller }, params: { ordenId: OS } });
}

async function main() {
  console.log("Reemplazo entregado → la orden de taller del saliente");

  // 1–3) Asamblea: un solo radio, se reemplaza y la orden cierra.
  await sembrar({ equipos: [eq(SALIENTE)], qc: qcAprobado([SALIENTE]) });
  await entregarReemplazo();
  let o = await orden(OS);
  const fila = o.equipos.find((e) => e.serial === SALIENTE);
  assert.equal(fila.eliminado, true);
  assert.equal(fila.reemplazado_por, ENTRANTE);
  assert.equal(fila.reemplazo_gestion, GID);
  ok("la fila del saliente sale de la orden y dice por quién se reemplazó");
  assert.equal(o.estado_reparacion, "CERRADA (REEMPLAZADO)");
  assert.equal(o.cerrada_reemplazo.gestion_id, GID);
  assert.equal(o.cerrada_reemplazo.orden_entrega_id, PROG);
  assert.deepEqual(o.reemplazos_entregados[GID].salientes, [SALIENTE]);
  ok("sin nada más por entregar, la orden queda CERRADA (REEMPLAZADO)");
  let s = await leer(SALIENTE);
  assert.equal(s.estado, "devuelto_revision", `el saliente queda por revisar, quedó ${s.estado}`);
  assert.ok(!s.orden_actual_id);
  ok("el trigger del pool no lo manda al cliente: queda por revisar en Cecomunica");
  const g = (await db.doc(`gestiones/${GID}`).get()).data();
  assert.equal(g.cierre.entrega, true);
  assert.equal(g.cierre.entrada, true);
  assert.equal((await leer(ENTRANTE)).reemplaza_a, SALIENTE);
  ok("el expediente registra entrega y entrada como antes");

  // Idempotente: otra vez no hace nada.
  assert.equal(await G.cerrarSalienteEnOrdenOrigen(GID, gestion(), { ordenEntregaId: PROG }), null);
  ok("correrlo otra vez no toca una orden ya cerrada");

  // 4) Otro radio del cliente en la orden: sigue abierta por él, QC vigente.
  await sembrar({ equipos: [eq(OTRO), eq(SALIENTE)], qc: qcAprobado([OTRO, SALIENTE]) });
  await entregarReemplazo();
  o = await orden(OS);
  assert.equal(o.estado_reparacion, "COMPLETADO (EN OFICINA)");
  assert.deepEqual(o.equipos.filter((e) => !e.eliminado).map((e) => e.serial), [OTRO]);
  assert.equal(PendientesDomain.qcCaducado(o), false, "quitar el saliente no caduca el QC del otro radio");
  assert.equal((await leer(OTRO)).estado, "en_taller");
  assert.equal((await leer(SALIENTE)).estado, "devuelto_revision");
  ok("con otro radio del cliente, la orden sigue abierta solo por él y su QC sigue vigente");

  // 5a) El otro radio fue descartado y se queda en Cecomunica → cierra.
  await sembrar({
    equipos: [eq(OTRO), eq(SALIENTE)],
    qc: qcAprobado([OTRO, SALIENTE], { [OTRO]: { resultado: "descartado", destino: "cecomunica" } }),
  });
  await entregarReemplazo();
  assert.equal((await orden(OS)).estado_reparacion, "CERRADA (REEMPLAZADO)");
  // 5b) El otro radio ya salió en una tanda → cierra.
  await sembrar({
    equipos: [eq(OTRO), eq(SALIENTE)], qc: qcAprobado([OTRO, SALIENTE]),
    extra: { entrega: { tandas: [{ numero: "E1", equipos: [{ serial: OTRO }] }] } },
  });
  await entregarReemplazo();
  assert.equal((await orden(OS)).estado_reparacion, "CERRADA (REEMPLAZADO)");
  ok("un descarte que se queda o un radio ya entregado en tanda no dejan la orden abierta");

  // 5c) Recepción ya había quitado el saliente a mano → igual cierra.
  await sembrar({ equipos: [eq(SALIENTE, { eliminado: true })], qc: qcAprobado([SALIENTE]) });
  await entregarReemplazo();
  assert.equal((await orden(OS)).estado_reparacion, "CERRADA (REEMPLAZADO)");
  ok("si recepción ya había quitado el saliente, la orden vacía cierra igual");

  // 6) Caminos que no se tocan.
  await sembrar({ equipos: [eq(SALIENTE)], qc: qcAprobado([SALIENTE]), estado: "ENTREGADO AL CLIENTE" });
  await entregarReemplazo();
  o = await orden(OS);
  assert.equal(o.estado_reparacion, "ENTREGADO AL CLIENTE");
  assert.equal(o.equipos[0].eliminado, false);
  await sembrar({ equipos: [eq(SALIENTE)], qc: qcAprobado([SALIENTE]), cliente: "otro-cliente" });
  await entregarReemplazo();
  assert.equal((await orden(OS)).estado_reparacion, "COMPLETADO (EN OFICINA)");
  assert.equal(G.planSalienteEnOrdenOrigen({
    cliente_id: CLI, tipo_de_servicio: "REPARACIÓN", estado_reparacion: "COMPLETADO (EN OFICINA)",
    equipos: [eq(OTRO)],
  }, gestion(), GID), null, "orden sin el saliente → no");
  assert.equal(G.planSalienteEnOrdenOrigen({
    cliente_id: CLI, tipo_de_servicio: "REPARACIÓN", estado_reparacion: "COMPLETADO (EN OFICINA)",
    equipos: [eq(SALIENTE)],
  }, { ...gestion(), ordenes: { en_orden_origen: true } }, GID), null, "reemplazo absorbido → no");
  ok("orden ya entregada, de otro cliente, sin el saliente o absorbida: no se toca");

  console.log(`\n${n} comprobaciones OK`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

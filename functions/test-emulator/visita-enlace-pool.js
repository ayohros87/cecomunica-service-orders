// VISITA TÉCNICA e inspección de entrada ↔ pool, con el trigger de verdad.
//
// Tripwire de backend del 2026-11-24 (visita 2026111905, DECAMERON, 146
// radios): onOrdenWritePool buscaba TODOS los seriales en cada guardado de la
// orden. El técnico registra el trabajo radio por radio, así que 60 guardados
// fueron 8,760 consultas para no cambiar nada.
//
// Congela:
//   1) al armar la visita, cada radio queda enlazado a la orden y NO cambia de
//      estado (la visita no mueve inventario);
//   2) guardar el trabajo de un radio no va al pool;
//   3) un radio agregado o un serial corregido se enlaza él solo;
//   4) el cambio de estado repasa todos (así se enlaza una ficha que nació
//      después de armar la orden);
//   5) al cerrar la visita se sueltan todos los enlaces, y una edición
//      posterior no va al pool;
//   6) lo mismo para la inspección de entrada: los radios siguen en cuarentena.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-visita \
//     "node functions/test-emulator/visita-enlace-pool.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-visita";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const pool = require("../src/domain/equiposPool");
const onOrdenWritePool = require("../src/triggers/ordenes/onOrdenWritePool");

let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
const MOD = { id: "mod-nx420r", label: "KENWOOD NX-420-R" };
const VISITA = "2026111905";
const INSP = "2026112499";

// Cuenta las idas al pool: el trigger llama a pool.resolver por el objeto del módulo.
let consultas = 0;
const resolverReal = pool.resolver;
pool.resolver = (...a) => { consultas++; return resolverReal(...a); };

const ficha = (serial, estado, extra = {}) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, modelo_id: MOD.id, modelo_label: MOD.label,
  estado, propiedad: "cecomunica", verificado: true, ...extra,
});
const leer = async (serial) => (await db.doc(`equipos_pool/${serial}`).get()).data();
const eq = (serial, extra = {}) => ({
  id: `eq-${serial}`, serial, numero_de_serie: serial, modelo: "NX-420-R", modelo_id: MOD.id,
  observaciones: "sin observaciones", eliminado: false, ...extra,
});
// Corre el trigger con el antes/después REAL de una escritura y dice cuántas consultas hizo.
async function escribir(id, cambio) {
  const ref = db.doc(`ordenes_de_servicio/${id}`);
  const before = await ref.get();
  await cambio(ref);
  const after = await ref.get();
  consultas = 0;
  await onOrdenWritePool.run({ data: { before, after }, params: { ordenId: id } });
  return consultas;
}
async function limpiar() {
  for (const c of ["equipos_pool", "ordenes_de_servicio", "modelos"]) {
    for (const d of (await db.collection(c).get()).docs) {
      for (const sub of await d.ref.listCollections()) await Promise.all((await sub.get()).docs.map((x) => x.ref.delete()));
      await d.ref.delete();
    }
  }
}

(async () => {
  await limpiar();
  await db.doc(`modelos/${MOD.id}`).set({ modelo: "NX-420-R", marca: "KENWOOD", estado: "R", activo: true });
  for (const s of ["BZ1", "BZ2", "BZ3", "BZ4"]) await ficha(s, "en_cliente", { asignacion: { cliente_id: "cli-1", cliente_nombre: "HOTELES", contrato_doc_id: "ct1", contrato_id: "ALQ1" } });

  // 1) Se arma la visita con 3 radios.
  const base = { tipo_de_servicio: "VISITA TECNICA", estado_reparacion: "ASIGNADO", cliente_id: "cli-1", cliente_nombre: "HOTELES", numero_orden: VISITA, tecnico_asignado: "Marcos Perez" };
  let c = await escribir(VISITA, (ref) => ref.set({ ...base, equipos: [eq("BZ1"), eq("BZ2"), eq("BZ3")] }));
  assert.equal(c, 3);
  for (const s of ["BZ1", "BZ2", "BZ3"]) {
    const d = await leer(s);
    assert.equal(d.orden_actual_id, VISITA); assert.equal(d.estado, "en_cliente", "la visita no mueve inventario");
  }
  ok("al armar la visita cada radio queda enlazado y sigue con el cliente");

  // 2) El técnico guarda el trabajo radio por radio.
  for (const s of ["BZ1", "BZ2", "BZ3"]) {
    c = await escribir(VISITA, async (ref) => {
      const equipos = (await ref.get()).data().equipos.map((e) => (e.serial === s ? { ...e, trabajo_tecnico: "Revisión general", bateria: true } : e));
      await ref.update({ equipos });
    });
    assert.equal(c, 0, `guardar el trabajo del ${s} no va al pool`);
  }
  ok("guardar el trabajo de un radio no hace consultas al pool");

  // 3) Un radio agregado en sitio se enlaza él solo; un serial corregido también.
  c = await escribir(VISITA, async (ref) => ref.update({ equipos: [...(await ref.get()).data().equipos, eq("BZ4")] }));
  assert.equal(c, 1);
  assert.equal((await leer("BZ4")).orden_actual_id, VISITA);
  await ficha("BZ5", "en_cliente");
  c = await escribir(VISITA, async (ref) => {
    const equipos = (await ref.get()).data().equipos.map((e) => (e.serial === "BZ3" ? { ...e, serial: "BZ5", numero_de_serie: "BZ5" } : e));
    await ref.update({ equipos });
  });
  assert.equal(c, 1);
  assert.equal((await leer("BZ5")).orden_actual_id, VISITA);
  ok("un radio agregado o un serial corregido se enlaza solo él");

  // 4) Una ficha que nació después de armar la orden se enlaza en el siguiente cambio de estado.
  await db.doc("equipos_pool/BZ2").update({ orden_actual_id: null });
  c = await escribir(VISITA, (ref) => ref.update({ estado_reparacion: "EN PROGRESO" }));
  assert.equal(c, 4);
  assert.equal((await leer("BZ2")).orden_actual_id, VISITA);
  ok("el cambio de estado repasa todos los radios");

  // 5) Cierre: se sueltan los enlaces; una edición posterior no va al pool.
  c = await escribir(VISITA, (ref) => ref.update({ estado_reparacion: "CERRADA (VISITA)" }));
  assert.equal(c, 4);
  for (const s of ["BZ1", "BZ2", "BZ4", "BZ5"]) {
    const d = await leer(s);
    assert.equal(d.orden_actual_id, null); assert.equal(d.estado, "en_cliente");
  }
  c = await escribir(VISITA, (ref) => ref.update({ nota_interna: "firmada" }));
  assert.equal(c, 0);
  ok("al cerrar se sueltan todos los enlaces y editar después no consulta");

  // 6) Inspección de entrada: mismo trato, y los radios siguen en cuarentena.
  for (const s of ["IN1", "IN2"]) await ficha(s, "devuelto_revision");
  c = await escribir(INSP, (ref) => ref.set({ tipo_de_servicio: "ENTRADA", estado_reparacion: "POR ASIGNAR", entrada_inspeccion: true, cliente_id: "cli-1", cliente_nombre: "HOTELES", numero_orden: INSP, equipos: [eq("IN1"), eq("IN2")] }));
  assert.equal(c, 2);
  c = await escribir(INSP, async (ref) => {
    const equipos = (await ref.get()).data().equipos.map((e) => ({ ...e, trabajo_tecnico: "Revisado" }));
    await ref.update({ equipos });
  });
  assert.equal(c, 0);
  for (const s of ["IN1", "IN2"]) {
    const d = await leer(s);
    assert.equal(d.orden_actual_id, INSP); assert.equal(d.estado, "devuelto_revision");
  }
  ok("la inspección de entrada enlaza al nacer, no consulta al guardar el trabajo y deja los radios en cuarentena");

  console.log(`\nTODO OK (${n} bloques)`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });

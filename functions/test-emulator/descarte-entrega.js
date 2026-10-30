// Descartados y el inventario (petición Solangel 2026-10-08).
//
// Caso real ANATI: el QC de la reparación 2026100605 descartó 24O31A0889.
// Recepción eliminó el serial para que el cliente no firmara por él, abrió la
// ENTRADA 2026100804 sin la marca de descarte, y al cerrarla el radio cayó
// DISPONIBLE en bodega y repuntado a refurbished.
//
// Congela, contra Firestore real y el trigger onOrdenWritePool:
//   1) al ENTREGAR la orden, el descartado que se queda en Cecomunica pasa a
//      cuarentena (devuelto_revision, movimiento descarte_qc), no a en_cliente;
//      el aprobado sí sale a en_cliente;
//   2) el descartado que se devuelve sin reparar sale a en_cliente;
//   3) un descarte viejo sin destino se queda (caso normal);
//   4) al CERRAR una ENTRADA, el descartado en la revisión se queda en
//      cuarentena (aunque viniera de en_cliente) y no se marca refurbished; el
//      sano aterriza en bodega;
//   5) al cerrar SIN RETIRAR, el descartado que se queda va a cuarentena y el
//      resto a no_retirado;
//   6) al FIRMAR el QC (orden viva) el descartado que se queda pasa a
//      cuarentena de una vez (Solangel 2026-10-30, SKY CHEFS B3600302); la
//      entrega no lo mueve dos veces; un QC repetido que lo apruebe lo
//      devuelve al taller, salvo que bodega ya lo haya dado de baja.
//
// Corre con (desde la raíz del repo):
//   firebase emulators:exec --only firestore --project demo-descarte-entrega \
//     "node functions/test-emulator/descarte-entrega.js"
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-descarte-entrega";
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { db } = require("../src/lib/admin");
const onOrdenWritePool = require("../src/triggers/ordenes/onOrdenWritePool");

const MOD = { id: "mod-pnc", label: "HYTERA PNC360S" };
let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

const ficha = (serial, estado, extra = {}) => db.doc(`equipos_pool/${serial}`).set({
  serial, serial_norm: serial, modelo_id: MOD.id, modelo_label: MOD.label,
  estado, propiedad: "cecomunica", verificado: true, asignacion: null, ...extra,
});
const leerFicha = async (s) => (await db.doc(`equipos_pool/${s}`).get()).data();
const movs = async (s) => (await db.collection(`equipos_pool/${s}/movimientos`).get()).docs.map((d) => d.data());
const eq = (id, serial, extra = {}) => ({ id, numero_de_serie: serial, modelo: MOD.label, modelo_id: MOD.id, ...extra });

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

async function correr(ordenId, antes, despues) {
  const ref = db.doc(`ordenes_de_servicio/${ordenId}`);
  await ref.set(antes);
  const before = await ref.get();
  await ref.set(despues);
  const after = await ref.get();
  await onOrdenWritePool.run({ data: { before, after }, params: { ordenId } });
}

const reparacion = (equipos, porEquipo, estado) => ({
  tipo_de_servicio: "REPARACIÓN", estado_reparacion: estado,
  cliente_id: "cli-anati", cliente_nombre: "AUTORIDAD NACIONAL DE ADMINISTRACION DE TIERRAS",
  equipos, qc: { resultado: "aprobado", equipos_n: equipos.length, por_equipo: porEquipo },
});

async function entregaReparacion() {
  await limpiar();
  const OS = "2026100605";
  for (const s of ["24O31A0888", "24O31A0889", "B5100260", "LEGACY01"]) {
    await ficha(s, "en_taller", { orden_actual_id: OS });
  }
  const equipos = [eq("a", "24O31A0888"), eq("b", "24O31A0889"), eq("c", "B5100260"), eq("d", "LEGACY01")];
  const pe = {
    a: { equipo_id: "a", serial: "24O31A0888", resultado: "aprobado" },
    b: { equipo_id: "b", serial: "24O31A0889", resultado: "descartado", nota: "Daño lógico", destino: "cecomunica", causa: "garantia" },
    c: { equipo_id: "c", serial: "B5100260", resultado: "descartado", nota: "No lo quiere reparar", destino: "cliente", causa: "dano_cliente" },
    d: { equipo_id: "d", serial: "LEGACY01", resultado: "descartado", nota: "Viejo, sin destino" },
  };
  await correr(OS, reparacion(equipos, pe, "COMPLETADO (EN OFICINA)"),
    reparacion(equipos, pe, "ENTREGADO AL CLIENTE"));

  assert.equal((await leerFicha("24O31A0888")).estado, "en_cliente");
  ok("1) el aprobado sale a en_cliente");

  const b = await leerFicha("24O31A0889");
  assert.equal(b.estado, "devuelto_revision");
  assert.equal(b.orden_actual_id, null);
  const mb = (await movs("24O31A0889")).find((m) => m.tipo === "descarte_qc");
  assert.ok(mb, "falta el movimiento descarte_qc");
  assert.match(mb.notas, /se queda en Cecomunica \(garantía\): Daño lógico/);
  ok("1) el descartado que se queda va a cuarentena, con kardex que dice por qué");

  assert.equal((await leerFicha("B5100260")).estado, "en_cliente");
  ok("2) el que se devuelve sin reparar sale a en_cliente");

  assert.equal((await leerFicha("LEGACY01")).estado, "devuelto_revision");
  ok("3) el descarte viejo sin destino se queda");
}

async function cierreEntrada() {
  await limpiar();
  const OS = "2026100804";
  await ficha("24O31A0889", "devuelto_revision");
  await ficha("SANO0001", "devuelto_revision");
  await ficha("ENCLI0002", "en_cliente");
  const equipos = [
    eq("x", "24O31A0889", { descartado_revision: true, descarte_motivo: "Daño lógico" }),
    eq("y", "SANO0001"),
    eq("z", "ENCLI0002", { descartado_revision: true, descarte_motivo: "Pantalla rota" }),
  ];
  const base = { tipo_de_servicio: "ENTRADA", cliente_nombre: "ANATI", equipos };
  await correr(OS, { ...base, estado_reparacion: "COMPLETADO (EN OFICINA)" },
    { ...base, estado_reparacion: "CERRADA (ENTRADA)" });

  const x = await leerFicha("24O31A0889");
  assert.equal(x.estado, "devuelto_revision");
  assert.ok(!(await movs("24O31A0889")).some((m) => m.tipo === "cambio_condicion" || m.tipo === "cierre_entrada"),
    "el descartado no debe aterrizar ni repuntarse a refurbished");
  ok("4) el descartado de la revisión se queda en cuarentena, sin refurbished");

  assert.equal((await leerFicha("SANO0001")).estado, "en_bodega");
  ok("4) el sano aterriza en bodega");

  assert.equal((await leerFicha("ENCLI0002")).estado, "devuelto_revision");
  assert.ok((await movs("ENCLI0002")).some((m) => m.tipo === "descarte_revision"));
  ok("4) el descartado que venía de en_cliente también queda en cuarentena");

  const o = (await db.doc(`ordenes_de_servicio/${OS}`).get()).data();
  assert.ok(!o.cierre_entrada_con_incidencias, "un descartado en cuarentena no es incidencia");
  ok("4) sin incidencias de cierre");
}

async function cierreSinRetirar() {
  await limpiar();
  const OS = "2026090101";
  await ficha("QUEDA0001", "en_taller", { orden_actual_id: OS });
  await ficha("OTRO0002", "en_taller", { orden_actual_id: OS });
  const equipos = [eq("q", "QUEDA0001"), eq("o", "OTRO0002")];
  const pe = {
    q: { equipo_id: "q", serial: "QUEDA0001", resultado: "descartado", nota: "x", destino: "cecomunica", causa: "garantia" },
    o: { equipo_id: "o", serial: "OTRO0002", resultado: "aprobado" },
  };
  await correr(OS, reparacion(equipos, pe, "COMPLETADO (EN OFICINA)"),
    { ...reparacion(equipos, pe, "CERRADA (SIN RETIRAR)"), sin_retirar: { motivo: "El cliente nunca vino" } });
  assert.equal((await leerFicha("QUEDA0001")).estado, "devuelto_revision");
  assert.equal((await leerFicha("OTRO0002")).estado, "no_retirado");
  ok("5) sin retirar: el descartado a cuarentena, el resto a no_retirado");
}

// 6) La cuarentena no espera a la ENTREGA (Solangel 2026-10-30, SKY CHEFS
//    B3600302): al FIRMAR el QC el descartado que se queda ya pasa a
//    devuelto_revision; la entrega posterior no lo mueve dos veces; el que se
//    devuelve al cliente sigue en taller hasta entregarse; y si el QC se repite
//    y el radio pasa, vuelve al taller.
async function firmaQc() {
  await limpiar();
  const OS = "2026102208";
  for (const s of ["B3600460", "B3600302", "DEVUELVE01"]) await ficha(s, "en_taller", { orden_actual_id: OS });
  const equipos = [eq("a", "B3600460"), eq("b", "B3600302"), eq("c", "DEVUELVE01")];
  const sinQc = { tipo_de_servicio: "REPARACIÓN", estado_reparacion: "COMPLETADO (EN OFICINA)",
    cliente_id: "cli-sky", cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", equipos };
  const pe = {
    a: { equipo_id: "a", serial: "B3600460", resultado: "aprobado" },
    b: { equipo_id: "b", serial: "B3600302", resultado: "descartado", nota: "Los valores IFR varían", destino: "cecomunica", causa: "garantia" },
    c: { equipo_id: "c", serial: "DEVUELVE01", resultado: "descartado", nota: "No lo repara", destino: "cliente", causa: "dano_cliente" },
  };
  // Firma del QC: misma orden, mismo estado, aparece qc.por_equipo.
  await correr(OS, sinQc, reparacion(equipos, pe, "COMPLETADO (EN OFICINA)"));

  const b = await leerFicha("B3600302");
  assert.equal(b.estado, "devuelto_revision");
  assert.equal(b.orden_actual_id, null);
  const mb = (await movs("B3600302")).filter((m) => m.tipo === "descarte_qc");
  assert.equal(mb.length, 1);
  assert.match(mb[0].notas, /se queda en Cecomunica \(garantía\): Los valores IFR varían/);
  ok("6) al firmar el QC el descartado que se queda pasa a cuarentena con su motivo");

  assert.equal((await leerFicha("B3600460")).estado, "en_taller");
  assert.equal((await leerFicha("DEVUELVE01")).estado, "en_taller");
  ok("6) el aprobado y el que se devuelve sin reparar siguen en taller hasta la entrega");

  // Entrega: no se mueve dos veces; los otros dos salen al cliente.
  await correr(OS, reparacion(equipos, pe, "COMPLETADO (EN OFICINA)"), reparacion(equipos, pe, "ENTREGADO AL CLIENTE"));
  assert.equal((await leerFicha("B3600302")).estado, "devuelto_revision");
  assert.equal((await movs("B3600302")).filter((m) => m.tipo === "descarte_qc").length, 1);
  assert.equal((await leerFicha("B3600460")).estado, "en_cliente");
  assert.equal((await leerFicha("DEVUELVE01")).estado, "en_cliente");
  ok("6) la entrega no repite el movimiento y entrega el resto");

  // QC repetido en otra orden viva: el radio descartado ahora pasa → vuelve al taller.
  const OS2 = "2026102209";
  await ficha("REPITE01", "en_taller", { orden_actual_id: OS2 });
  const eq2 = [eq("r", "REPITE01")];
  const peMal = { r: { equipo_id: "r", serial: "REPITE01", resultado: "descartado", nota: "x", destino: "cecomunica", causa: "garantia" } };
  const peBien = { r: { equipo_id: "r", serial: "REPITE01", resultado: "aprobado" } };
  await correr(OS2, { ...sinQc, equipos: eq2 }, reparacion(eq2, peMal, "COMPLETADO (EN OFICINA)"));
  assert.equal((await leerFicha("REPITE01")).estado, "devuelto_revision");
  await correr(OS2, reparacion(eq2, peMal, "COMPLETADO (EN OFICINA)"), reparacion(eq2, peBien, "COMPLETADO (EN OFICINA)"));
  const r = await leerFicha("REPITE01");
  assert.equal(r.estado, "en_taller");
  assert.equal(r.orden_actual_id, OS2);
  ok("6) si el QC se repite y el radio pasa, vuelve al taller");

  // Pero si bodega ya lo dio de baja, el QC repetido no lo resucita.
  await ficha("BAJA01", "en_taller", { orden_actual_id: OS2 });
  const eq3 = [eq("z", "BAJA01")];
  const peZmal = { z: { equipo_id: "z", serial: "BAJA01", resultado: "descartado", destino: "cecomunica", causa: "garantia" } };
  const peZbien = { z: { equipo_id: "z", serial: "BAJA01", resultado: "aprobado" } };
  await correr(OS2, { ...sinQc, equipos: eq3 }, reparacion(eq3, peZmal, "COMPLETADO (EN OFICINA)"));
  await db.doc("equipos_pool/BAJA01").set({ estado: "baja" }, { merge: true });
  await correr(OS2, reparacion(eq3, peZmal, "COMPLETADO (EN OFICINA)"), reparacion(eq3, peZbien, "COMPLETADO (EN OFICINA)"));
  assert.equal((await leerFicha("BAJA01")).estado, "baja");
  ok("6) un radio ya dado de baja no vuelve al taller por un QC repetido");
}

(async () => {
  await entregaReparacion();
  await cierreEntrada();
  await cierreSinRetirar();
  await firmaQc();
  console.log(`\n${n} PASS`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });

// Tests de las reglas de Firestore contra el emulador (rules-unit-testing).
// Corre con: firebase emulators:exec --only firestore "node functions/test-emulator/rules.js"
// Valida el scoping por rol (ordenes_de_servicio, inventario_*, tecnico_stats,
// delete de poc_devices) y que los flujos dejados abiertos NO se rompan.
const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require("@firebase/rules-unit-testing");

const ROLES = ["administrador", "gerente", "vendedor", "recepcion", "tecnico",
  "tecnico_operativo", "jefe_taller", "inventario", "contabilidad", "vista"];

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"),
      host: "127.0.0.1", port: 8080,
    },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ROLES) await db.doc(`usuarios/${r}`).set({ rol: r });
    await db.doc("ordenes_de_servicio/o1").set({ x: 0 });
    await db.doc("ordenes_de_servicio/oDel").set({ x: 0 });
    await db.doc("inventario_actual/m1").set({ cantidad: 0 });
    await db.doc("tecnico_stats/t1").set({ total: 0 });
    await db.doc("poc_devices/pDel").set({ x: 0 });
  });

  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

  const ordenRoles = ["administrador","vendedor","recepcion","tecnico","tecnico_operativo","jefe_taller"];
  const noOrden    = ["gerente","inventario","contabilidad","vista"];

  // ── ordenes_de_servicio ───────────────────────────────────────────────────
  for (const r of ordenRoles) await assertSucceeds(as(r).doc("ordenes_de_servicio/n_"+r).set({ x: 1 }));
  for (const r of ordenRoles) await assertSucceeds(as(r).doc("ordenes_de_servicio/o1").set({ x: 2 }, { merge: true }));
  ok("ordenes: los 6 roles de órdenes pueden create/update");
  for (const r of noOrden) await assertFails(as(r).doc("ordenes_de_servicio/bad_"+r).set({ x: 1 }));
  ok("ordenes: gerente/inventario/contabilidad/vista NO pueden create/update");
  await assertSucceeds(as("vista").doc("ordenes_de_servicio/o1").get());
  ok("ordenes: read sigue abierto (vista puede leer)");
  await assertFails(as("tecnico").doc("ordenes_de_servicio/oDel").delete());
  await assertFails(as("vista").doc("ordenes_de_servicio/oDel").delete());
  await assertSucceeds(as("administrador").doc("ordenes_de_servicio/oDel").delete());
  ok("ordenes: delete solo admin/gerente (técnico/vista no) — ahora efectivo");
  // Subcolecciones: siguen escribibles por el flujo (NO se rompieron).
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/o1/consumos/c1").set({ x: 1 }));
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/o1/equipos_meta/e1").set({ x: 1 }));
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/o1/borradores_cotizacion/b1").set({ x: 1 }));
  ok("ordenes: subcolecciones (consumos/equipos_meta/borradores) siguen escribibles");

  // ── inventario_actual / ultimo_inventario: solo admin/inventario ──────────
  for (const r of ["administrador","inventario"]) {
    await assertSucceeds(as(r).doc("inventario_actual/m1").set({ cantidad: 5 }, { merge: true }));
    await assertSucceeds(as(r).doc("ultimo_inventario/h_"+r).set({ cantidad: 5 }));
  }
  ok("inventario_actual/ultimo_inventario: admin/inventario pueden escribir");
  for (const r of ["tecnico","vendedor","gerente","vista","contabilidad"]) {
    await assertFails(as(r).doc("inventario_actual/m1").set({ cantidad: 9 }, { merge: true }));
  }
  ok("inventario_actual: otros roles NO pueden escribir");
  await assertSucceeds(as("vista").doc("inventario_actual/m1").get());
  ok("inventario_actual: read sigue abierto");

  // ── tecnico_stats: write cerrado para todos (solo CF) ─────────────────────
  await assertFails(as("administrador").doc("tecnico_stats/t1").set({ total: 99 }, { merge: true }));
  await assertFails(as("tecnico").doc("tecnico_stats/t2").set({ total: 1 }));
  await assertFails(as("administrador").doc("tecnico_stats/t1/mensual/2026-07").set({ count: 1 }));
  ok("tecnico_stats: write denegado para todos (incl. admin); solo CF");
  await assertSucceeds(as("tecnico").doc("tecnico_stats/t1").get());
  ok("tecnico_stats: read sigue abierto");

  // ── poc_devices: delete solo admin (ahora efectivo tras quitar sub=** write) ─
  await assertFails(as("recepcion").doc("poc_devices/pDel").delete());
  await assertSucceeds(as("administrador").doc("poc_devices/pDel").delete());
  ok("poc_devices: delete solo admin (recepción no) — ahora efectivo");

  // ── poc_devices: unit_id SIEMPRE string + espejo unit_id_num int|null ──────
  // (el import de Excel escribía numbers y Firestore ordena por tipo — la
  // lista quedaba partida en dos bloques; saneado por backfill 2026-07-21)
  await assertFails(as("recepcion").doc("poc_devices/pTipo1").set({ unit_id: 1234 }));
  await assertFails(as("recepcion").doc("poc_devices/pTipo2").set({ unit_id: "1234", unit_id_num: "1234" }));
  await assertSucceeds(as("recepcion").doc("poc_devices/pTipo3").set({ unit_id: "1234", unit_id_num: 1234 }));
  await assertSucceeds(as("recepcion").doc("poc_devices/pTipo4").set({ unit_id: "CONSOLA_DSI", unit_id_num: null }));
  ok("poc_devices: unit_id numérico rechazado; string + espejo int|null pasa");

  // ── ordenes: máquina de estados (transiciones ilegales bloqueadas) ────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "POR ASIGNAR" });
    await db.doc("ordenes_de_servicio/oTerm").set({ estado_reparacion: "ENTREGADO AL CLIENTE" });
    await db.doc("ordenes_de_servicio/oLegacy").set({ estado_reparacion: "EN TALLER (LEGACY)" });
    await db.doc("ordenes_de_servicio/oVisita").set({ estado_reparacion: "ASIGNADO" });
  });
  await assertFails(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("ordenes: POR ASIGNAR → ENTREGADO directo bloqueado (no-admin)");
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "RECIBIDO EN MOSTRADOR" }, { merge: true }));
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "ASIGNADO" }, { merge: true }));
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "COMPLETADO (EN OFICINA)" }, { merge: true }));
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("ordenes: cadena recibir→asignar→completar→entregar pasa");
  await assertFails(as("recepcion").doc("ordenes_de_servicio/oTerm").set({ estado_reparacion: "ASIGNADO" }, { merge: true }));
  ok("ordenes: reabrir ENTREGADO bloqueado para no-admin");
  await assertSucceeds(as("administrador").doc("ordenes_de_servicio/oTerm").set({ estado_reparacion: "ASIGNADO" }, { merge: true }));
  ok("ordenes: admin puede revertir (corrección manual)");
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/oLegacy").set({ estado_reparacion: "ASIGNADO" }, { merge: true }));
  ok("ordenes: estado legacy fuera del enum puede regularizarse");
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oVisita").set({ estado_reparacion: "CERRADA (VISITA)" }, { merge: true }));
  ok("ordenes: ASIGNADO → CERRADA (VISITA) pasa");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("ordenes_de_servicio/oDev").set({ estado_reparacion: "POR ASIGNAR", tipo_de_servicio: "DEVOLUCION" });
  });
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/oDev").set({ estado_reparacion: "CERRADA (DEVOLUCION)" }, { merge: true }));
  ok("ordenes: POR ASIGNAR → CERRADA (DEVOLUCION) pasa (check-in cerrado)");
  await assertFails(as("recepcion").doc("ordenes_de_servicio/oDev").set({ estado_reparacion: "ASIGNADO" }, { merge: true }));
  ok("ordenes: CERRADA (DEVOLUCION) es terminal para no-admin");
  // ENTRADA (inspección de devueltos): terminal propio sin entrega ni QC —
  // COMPLETADO → CERRADA (ENTRADA) pasa aunque haya qc_requerido, pero
  // COMPLETADO → ENTREGADO sigue exigiendo el QC aprobado.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("ordenes_de_servicio/oEnt").set({ estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "ENTRADA", qc_requerido: true });
  });
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/oEnt").set({ estado_reparacion: "CERRADA (ENTRADA)" }, { merge: true }));
  ok("ordenes: COMPLETADO → CERRADA (ENTRADA) pasa (cierre de inspección)");
  await assertFails(as("recepcion").doc("ordenes_de_servicio/oEnt").set({ estado_reparacion: "ASIGNADO" }, { merge: true }));
  ok("ordenes: CERRADA (ENTRADA) es terminal para no-admin");

  // ── cotizaciones: umbral de envío ENFORCED (antes solo-UI) ────────────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("empresa/config").set({ cotizacion_descuento_max_pct: 15, cotizacion_total_max: 5000 });
    await db.doc("cotizaciones/cDentro").set({ estado: "borrador", creado_por_uid: "vendedor", total: 1200, descuentoPct: 10 });
    await db.doc("cotizaciones/cFuera").set({ estado: "borrador", creado_por_uid: "vendedor", total: 9000, descuentoPct: 0 });
    await db.doc("cotizaciones/cAprobada").set({ estado: "aprobada", creado_por_uid: "vendedor", total: 9000, descuentoPct: 0, fecha_aprobacion: new Date() });
  });
  await assertSucceeds(as("vendedor").doc("cotizaciones/cDentro").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: vendedor envía la suya dentro de política");
  await assertFails(as("vendedor").doc("cotizaciones/cFuera").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: envío fuera de política bloqueado para vendedor");
  await assertSucceeds(as("vendedor").doc("cotizaciones/cAprobada").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: con aprobación previa el dueño sí puede marcar enviada");
  await assertSucceeds(as("gerente").doc("cotizaciones/cFuera").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: gerente (aprobador comercial) envía fuera de política");

  // ── Regresión: flujos que DEBEN seguir abiertos ───────────────────────────
  await assertSucceeds(as("tecnico").doc("inventario_piezas/p1").set({ cantidad: 3 }));
  await assertSucceeds(as("tecnico").doc("analytics_piezas_modelo/a1").set({ usos: 1 }));
  await assertSucceeds(as("recepcion").doc("poc_devices/d1").set({ x: 1 }));
  await assertSucceeds(as("vendedor").doc("clientes/cli1").set({ nombre: "X" }));
  ok("REGRESIÓN: inventario_piezas/analytics/poc_devices/clientes siguen abiertos");

  await testEnv.cleanup();
  console.log(`\nTODOS LOS TESTS DE REGLAS PASARON (${n} grupos)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e && e.message ? e.message : e); process.exit(1); });

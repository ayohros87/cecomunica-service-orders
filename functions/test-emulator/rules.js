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

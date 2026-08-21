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
  // Completar estampa qc_requerido:true — es lo que hace completeOrder, y las
  // reglas ahora lo exigen (si no, se podía completar apagando el control).
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "COMPLETADO (EN OFICINA)", qc_requerido: true }, { merge: true }));
  // …y con la marca puesta, la entrega pasa por el QC del jefe de taller.
  await assertFails(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  await assertSucceeds(as("jefe_taller").doc("ordenes_de_servicio/oFlow").set({
    qc: { resultado: "aprobado", tipo: "reparacion", checklist: { a: "ok", b: "ok", c: "ok", d: "ok" } },
  }, { merge: true }));
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/oFlow").set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("ordenes: cadena recibir→asignar→completar→QC→entregar pasa");
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

  // ── DEVOLUCIÓN: el acuse firmado no se puede borrar para volver a editar ──
  // Recepción corrige accesorios de una unidad recibida MIENTRAS no haya
  // firma (candado por unidad en la UI). Lo que las reglas cierran es el
  // atajo: recortar acuses[] o esperados[] para desbloquearla.
  const devBase = {
    estado_reparacion: "POR ASIGNAR", tipo_de_servicio: "DEVOLUCION",
    devolucion: {
      modo: "recuperacion",
      esperados: [
        { id: "e1", serial: "AAA111", resolucion: "recibido", acuse_id: "a1",
          accesorios: { bateria: true, cargador: true } },
        { id: "e2", serial: "BBB222", resolucion: "recibido",
          accesorios: { bateria: true } },
      ],
      acuses: [{ id: "a1", seriales: ["AAA111"], firma_url: "x" }],
    },
  };
  const resetDev = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("ordenes_de_servicio/oAcuse")
        .set(JSON.parse(JSON.stringify(devBase)));
    });
  };
  const clon = (dev) => JSON.parse(JSON.stringify(dev));

  await resetDev();
  // Corrección legítima: misma cantidad de unidades y de acuses, cambia solo
  // el checklist de la unidad SIN firmar.
  {
    const dev = clon(devBase.devolucion);
    dev.esperados[1].accesorios = { bateria: true, cargador: false };
    dev.esperados[1].corregido_at = new Date();
    await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/oAcuse")
      .set({ devolucion: dev }, { merge: true }));
  }
  ok("devolucion: recepcion corrige accesorios de una unidad sin firmar");

  await resetDev();
  // Borrar el acuse firmado para "desbloquear" la unidad: prohibido.
  {
    const dev = clon(devBase.devolucion);
    dev.acuses = [];
    await assertFails(as("recepcion").doc("ordenes_de_servicio/oAcuse")
      .set({ devolucion: dev }, { merge: true }));
  }
  ok("devolucion: NO se puede borrar el acuse firmado (acuses[] no se recorta)");

  await resetDev();
  // Borrar la unidad recibida para volver a registrarla: prohibido.
  {
    const dev = clon(devBase.devolucion);
    dev.esperados = [dev.esperados[1]];
    await assertFails(as("recepcion").doc("ordenes_de_servicio/oAcuse")
      .set({ devolucion: dev }, { merge: true }));
  }
  ok("devolucion: NO se puede borrar una unidad de esperados[]");

  await resetDev();
  // Agregar unidades y acuses (check-in por tanda) sigue pasando.
  {
    const dev = clon(devBase.devolucion);
    dev.esperados.push({ id: "e3", serial: "CCC333", resolucion: "recibido", accesorios: {} });
    dev.acuses.push({ id: "a2", seriales: ["BBB222", "CCC333"], firma_url: "y" });
    await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/oAcuse")
      .set({ devolucion: dev }, { merge: true }));
  }
  ok("devolucion: agregar unidades y acuses (tanda nueva) sigue pasando");

  await resetDev();
  // Admin sí puede recortar: correcciones manuales de datos.
  {
    const dev = clon(devBase.devolucion);
    dev.acuses = [];
    await assertSucceeds(as("administrador").doc("ordenes_de_servicio/oAcuse")
      .set({ devolucion: dev }, { merge: true }));
  }
  ok("devolucion: admin queda exento (corrección manual)");

  // Una orden que no es devolución no se ve afectada por el candado.
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/o1")
    .set({ observaciones: "sin devolucion" }, { merge: true }));
  ok("devolucion: el candado no estorba a las órdenes sin devolucion");
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

  // Una ENTRADA no se entrega al cliente: el equipo vuelve, no sale. Ni con el
  // QC aprobado. Las 191 ENTRADAs mal cerradas como ENTREGADO AL CLIENTE (todas
  // anteriores a que existiera CERRADA (ENTRADA)) empujaron sus unidades a
  // en_cliente vía onOrdenWritePool; esta regla cierra esa puerta.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("ordenes_de_servicio/oEntQc").set({
      estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "ENTRADA",
      qc_requerido: true, qc: { resultado: "aprobado" } });
    await db.doc("ordenes_de_servicio/oRepQc").set({
      estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "REPARACIÓN",
      qc_requerido: true, qc: { resultado: "aprobado" } });
  });
  await assertFails(as("recepcion").doc("ordenes_de_servicio/oEntQc").set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("ordenes: ENTRADA NO puede entregarse al cliente ni con QC aprobado");
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/oRepQc").set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("ordenes: REPARACIÓN con QC aprobado sí se entrega (no se rompió el flujo)");

  // ── QC: los cuatro huecos de la auditoría del 2026-08-04 ──────────────────
  const COMPLETADO = "COMPLETADO (EN OFICINA)";
  const seedOrden = (id, data) => testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("ordenes_de_servicio/" + id).set({
      estado_reparacion: COMPLETADO, tipo_de_servicio: "REPARACIÓN", qc_requerido: true, ...data });
  });

  // A1 — el candado se apagaba en DOS escrituras: primero qc_requerido:false
  // con el estado intacto, después la entrega (la regla lee resource.data, ya
  // sin la marca). Ahora la marca solo puede encenderse.
  await seedOrden("qcA1", {});
  await assertFails(as("tecnico").doc("ordenes_de_servicio/qcA1").set({ qc_requerido: false }, { merge: true }));
  ok("qc: qc_requerido NO se puede apagar (cierra el bypass de dos escrituras)");
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/qcA1").set({ observaciones: "x" }, { merge: true }));
  ok("qc: el guard no estorba a los demás campos de la orden");
  // La excepción legítima: una ENTRADA completa con qcRequerido:false.
  await seedOrden("qcA1Ent", { tipo_de_servicio: "ENTRADA" });
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/qcA1Ent").set({ qc_requerido: false }, { merge: true }));
  ok("qc: ENTRADA sí puede completar con qc_requerido:false (cierra sin entrega)");

  // A1bis — el mismo bypass en UN write: completar desactivando el control.
  // qcRequeridoNoSeApaga mira el doc PREVIO (que aún no traía la marca), así
  // que hacía falta exigirla en la propia transición a COMPLETADO.
  await seedOrden("qcA1uno", { estado_reparacion: "ASIGNADO", qc_requerido: false });
  await assertFails(as("tecnico").doc("ordenes_de_servicio/qcA1uno")
    .set({ estado_reparacion: COMPLETADO, qc_requerido: false }, { merge: true }));
  ok("qc: no se puede completar desactivando el control en el mismo write");
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/qcA1uno")
    .set({ estado_reparacion: COMPLETADO, qc_requerido: true }, { merge: true }));
  ok("qc: completar con la marca encendida (completeOrder) pasa");
  await seedOrden("qcA1unoEnt", { estado_reparacion: "ASIGNADO", tipo_de_servicio: "ENTRADA", qc_requerido: false });
  await assertSucceeds(as("tecnico").doc("ordenes_de_servicio/qcA1unoEnt")
    .set({ estado_reparacion: COMPLETADO, qc_requerido: false }, { merge: true }));
  ok("qc: una ENTRADA sí completa sin marca (cierra sin entrega)");
  // Las completadas ANTES del corte no tienen la marca y se siguen editando.
  await seedOrden("qcA1legacy", { qc_requerido: false });
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/qcA1legacy")
    .set({ observaciones: "edición sobre legacy" }, { merge: true }));
  ok("qc: las completadas legacy (sin marca) se siguen editando");

  // A2 — "aprobado" con checklist vacío: la exigencia vivía solo en el botón.
  await seedOrden("qcA2", {});
  await assertFails(as("jefe_taller").doc("ordenes_de_servicio/qcA2")
    .set({ qc: { resultado: "aprobado", tipo: "reparacion", checklist: {} } }, { merge: true }));
  ok("qc: aprobar con checklist vacío se rechaza");
  await assertFails(as("jefe_taller").doc("ordenes_de_servicio/qcA2")
    .set({ qc: { resultado: "aprobado", tipo: "programacion",
      checklist: { a: "ok", b: "ok", c: "ok", d: "ok" } } }, { merge: true }));
  ok("qc: programación exige sus 5 ítems (4 no alcanzan)");
  await assertSucceeds(as("jefe_taller").doc("ordenes_de_servicio/qcA2")
    .set({ qc: { resultado: "aprobado", tipo: "reparacion",
      checklist: { a: "ok", b: "ok", c: "na", d: "ok" } } }, { merge: true }));
  ok("qc: reparación con sus 4 ítems se aprueba");

  // A3 — la reversa exigía qc.resultado='rechazado' en request.resource, pero
  // un `merge` arrastra el rechazo VIEJO: cualquier rol devolvía la orden al
  // técnico sin nueva pasada. Ahora el write tiene que TOCAR qc.
  await seedOrden("qcA3", { qc: { resultado: "rechazado" } });
  await assertFails(as("recepcion").doc("ordenes_de_servicio/qcA3")
    .set({ observaciones: "y", estado_reparacion: "ASIGNADO" }, { merge: true }));
  ok("qc: un rechazo viejo ya no permite devolver la orden a ASIGNADO");
  await assertSucceeds(as("jefe_taller").doc("ordenes_de_servicio/qcA3")
    .set({ estado_reparacion: "ASIGNADO",
      qc: { resultado: "rechazado", tipo: "reparacion", motivos: ["gps"] } }, { merge: true }));
  ok("qc: el jefe de taller sí rechaza y devuelve la orden en el mismo write");

  // A4 — el QC aprobado cubre los equipos que había al firmar: agregar un
  // batch después lo caduca. equipos_n ausente = firmado antes del cambio.
  await seedOrden("qcA4", { equipos: [{ s: 1 }, { s: 2 }],
    qc: { resultado: "aprobado", equipos_n: 2 } });
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/qcA4")
    .set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("qc: con el conteo de equipos intacto la entrega pasa");
  await seedOrden("qcA4b", { equipos: [{ s: 1 }, { s: 2 }, { s: 3 }],
    qc: { resultado: "aprobado", equipos_n: 2 } });
  await assertFails(as("recepcion").doc("ordenes_de_servicio/qcA4b")
    .set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("qc: agregar equipos después de aprobar CADUCA el QC y bloquea la entrega");
  await seedOrden("qcA4c", { equipos: [{ s: 1 }], qc: { resultado: "aprobado" } });
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/qcA4c")
    .set({ estado_reparacion: "ENTREGADO AL CLIENTE" }, { merge: true }));
  ok("qc: las aprobadas sin equipos_n (corte legacy) siguen entregándose");

  // ── equipos_descartados: registro de radios que el QC declaró inservibles ─
  // Escribe quien firma QC (jefe_taller/admin), NO puedeGestionarSeriales():
  // jefe_taller no está en esa lista y es precisamente quien descarta. Lee
  // cualquier autenticado porque la alerta al teclear un serial tiene que salir
  // en todos los puntos de captura — el primero, bodega.
  await assertSucceeds(as("jefe_taller").doc("equipos_descartados/ABC123")
    .set({ serial_norm: "ABC123", motivo: "placa quemada", revocado: false }));
  ok("descartados: jefe_taller registra un descarte");
  await assertSucceeds(as("administrador").doc("equipos_descartados/ABC124").set({ serial_norm: "ABC124" }));
  ok("descartados: admin también");
  for (const r of ["tecnico", "recepcion", "inventario", "vendedor", "vista"]) {
    await assertFails(as(r).doc("equipos_descartados/bad_" + r).set({ serial_norm: "X" }));
  }
  ok("descartados: técnico/recepción/inventario/vendedor/vista NO pueden descartar");
  // Bodega (rol inventario) es la que MÁS necesita leerlo antes de recibir.
  for (const r of ["inventario", "tecnico", "recepcion", "vista"]) {
    await assertSucceeds(as(r).doc("equipos_descartados/ABC123").get());
  }
  ok("descartados: lectura abierta a todo autenticado (la alerta es para bodega y taller)");
  await assertSucceeds(as("jefe_taller").doc("equipos_descartados/ABC123")
    .set({ revocado: true, revocado_motivo: "sí servía" }, { merge: true }));
  ok("descartados: revocar es un update, no un borrado (la traza se conserva)");
  await assertFails(as("jefe_taller").doc("equipos_descartados/ABC124").delete());
  await assertFails(as("inventario").doc("equipos_descartados/ABC124").delete());
  await assertSucceeds(as("administrador").doc("equipos_descartados/ABC124").delete());
  ok("descartados: delete solo admin — desde la UI se revoca, nunca se borra");

  // ── pendiente_snooze: posponer desde la bandeja del home ──────────────────
  // El posponer escribe EN el documento fuente (orden o unidad del pool) SIN
  // regla nueva: viaja por los caminos de update existentes. Estos casos
  // congelan ese supuesto — si un refactor de reglas lo rompe, la bandeja
  // falla en producción sin que ningún test unitario lo vea.
  const SNZ = { pendiente_snooze: { hasta: "2027-01-01T00:00:00.000Z", motivo: "cliente recibe el lunes", por_email: "x@y.com" } };
  await seedOrden("snzEnt", {});   // COMPLETADO — la cola "listas para entregar" (recepción)
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/snzEnt").set(SNZ, { merge: true }));
  ok("snooze: recepción pospone una orden COMPLETADA (cola de entrega)");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("ordenes_de_servicio/snzEst").set({ estado_reparacion: "ASIGNADO" });
  });
  await assertSucceeds(as("jefe_taller").doc("ordenes_de_servicio/snzEst").set(SNZ, { merge: true }));
  ok("snooze: jefe_taller pospone una orden ASIGNADA (sin movimiento)");
  await assertFails(as("inventario").doc("ordenes_de_servicio/snzEst").set(SNZ, { merge: true }));
  ok("snooze: inventario NO puede posponer órdenes (no es rol de órdenes)");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("equipos_pool/snzU1").set({ estado: "devuelto_revision", serial_norm: "SNZ111" });
  });
  await assertSucceeds(as("recepcion").doc("equipos_pool/snzU1").set(SNZ, { merge: true }));
  ok("snooze: recepción pospone una unidad del pool (puedeGestionarSeriales)");
  await assertFails(as("jefe_taller").doc("equipos_pool/snzU1").set(SNZ, { merge: true }));
  ok("snooze: jefe_taller NO escribe el pool — por eso la cuarentena no ofrece posponer");

  // ── cotizaciones: umbral de envío ENFORCED (antes solo-UI) ────────────────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("empresa/config").set({ cotizacion_descuento_max_pct: 15, cotizacion_total_max: 5000 });
    await db.doc("cotizaciones/cDentro").set({ estado: "borrador", creado_por_uid: "vendedor", total: 1200, descuentoPct: 10 });
    await db.doc("cotizaciones/cFuera").set({ estado: "borrador", creado_por_uid: "vendedor", total: 9000, descuentoPct: 0 });
    await db.doc("cotizaciones/cAprobada").set({ estado: "aprobada", creado_por_uid: "vendedor", total: 9000, descuentoPct: 0, fecha_aprobacion: new Date() });
    // Flag estampado por la app (auditoría A10): totales DENTRO de umbral pero
    // con descuento por línea fuera — rules no puede recorrer renglones, así
    // que manda requiere_aprobacion.
    await db.doc("cotizaciones/cLinea").set({ estado: "borrador", creado_por_uid: "vendedor", total: 4900, descuentoPct: 0, requiere_aprobacion: true });
    await db.doc("cotizaciones/cFlagOk").set({ estado: "borrador", creado_por_uid: "vendedor", total: 1200, descuentoPct: 10, requiere_aprobacion: false });
  });
  await assertSucceeds(as("vendedor").doc("cotizaciones/cDentro").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: vendedor envía la suya dentro de política");
  await assertFails(as("vendedor").doc("cotizaciones/cFuera").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: envío fuera de política bloqueado para vendedor");
  await assertSucceeds(as("vendedor").doc("cotizaciones/cAprobada").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: con aprobación previa el dueño sí puede marcar enviada");
  await assertSucceeds(as("gerente").doc("cotizaciones/cFuera").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: gerente (aprobador comercial) envía fuera de política");
  await assertFails(as("vendedor").doc("cotizaciones/cLinea").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: requiere_aprobacion=true bloquea el envío directo (descuento por línea)");
  await assertSucceeds(as("vendedor").doc("cotizaciones/cFlagOk").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: flag en false no estorba el envío dentro de política");
  await assertSucceeds(as("gerente").doc("cotizaciones/cLinea").set({ estado: "enviada" }, { merge: true }));
  ok("cotizaciones: el aprobador del tipo envía aunque el flag pida aprobación");

  // ── contadores: correlativos de cotizaciones y contratos ──────────────────
  // El número de contrato se RESERVA en contadores/contratos_{TIPO}_{YYYYMMDD}
  // (contratosService.reservarSufijo). Si las reglas bloquearan a quien crea
  // contratos, guardar reventaría con permission-denied.
  for (const r of ["administrador","vendedor","recepcion","gerente","jefe_taller"]) {
    await assertSucceeds(as(r).doc(`contadores/contratos_ALQ_2026072${ROLES.indexOf(r)}`).set({ seq: 1 }));
  }
  ok("contadores: los roles que crean contratos pueden reservar el sufijo");
  await assertSucceeds(as("administrador").doc("contadores/contratos_ALQ_20260728").set({ seq: 2 }, { merge: true }));
  ok("contadores: el incremento (update) pasa");
  for (const r of ["inventario","contabilidad","vista"]) {
    await assertFails(as(r).doc(`contadores/contratos_ALQ_bad_${r}`).set({ seq: 1 }));
  }
  ok("contadores: inventario/contabilidad/vista NO escriben correlativos");
  await assertFails(as("administrador").doc("contadores/contratos_ALQ_20260728").delete());
  ok("contadores: nadie borra un contador (borrarlo recicla números)");

  // ── Regresión: flujos que DEBEN seguir abiertos ───────────────────────────
  await assertSucceeds(as("tecnico").doc("inventario_piezas/p1").set({ cantidad: 3 }));
  await assertSucceeds(as("tecnico").doc("analytics_piezas_modelo/a1").set({ usos: 1 }));
  await assertSucceeds(as("recepcion").doc("poc_devices/d1").set({ x: 1 }));
  await assertSucceeds(as("vendedor").doc("clientes/cli1").set({ nombre: "X" }));
  ok("REGRESIÓN: inventario_piezas/analytics/poc_devices/clientes siguen abiertos");

  // ── H8 (propuesta Almacén/Finanzas 2026-08): candados de facturación ──────
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("contratos/cFact").set({ estado: "activo", facturacion_estado: "pendiente", notas: "" });
    await db.doc("empresa/facturacion_config").set({ auto_activar: false });
    await db.doc("empresa/estado_de_reparacion").set({ x: 1 });
    await db.doc("clientes/cliQbo").set({ nombre: "Y" });
    await db.doc("inventario_piezas/pPrecio").set({ cantidad: 1, precio_venta: 10 });
    await db.doc("inventario_piezas/pDel").set({ cantidad: 0 });
  });

  // contratos: los campos de facturación son del callable/las CF, no del cliente.
  for (const r of ["vendedor", "recepcion", "administrador"]) {
    await assertFails(as(r).doc("contratos/cFact").set({ facturacion_estado: "activa" }, { merge: true }));
    await assertFails(as(r).doc("contratos/cFact").set({ entrega_confirmada: true }, { merge: true }));
    await assertFails(as(r).doc("contratos/cFact").set({ facturable: false }, { merge: true }));
  }
  ok("contratos: facturacion_estado/entrega_confirmada/facturable bloqueados al cliente");
  await assertSucceeds(as("vendedor").doc("contratos/cFact").set({ notas: "edición normal" }, { merge: true }));
  ok("contratos: la edición normal (sin campos CF) sigue pasando");

  // empresa/facturacion_config: toggles de auto-activación/alertas por rol.
  await assertFails(as("tecnico").doc("empresa/facturacion_config").set({ auto_activar: true }, { merge: true }));
  await assertFails(as("vendedor").doc("empresa/facturacion_config").set({ alertas_off: true }, { merge: true }));
  await assertSucceeds(as("contabilidad").doc("empresa/facturacion_config").set({ auto_activar: true }, { merge: true }));
  await assertSucceeds(as("administrador").doc("empresa/facturacion_config").set({ alertas_off: true }, { merge: true }));
  ok("empresa: facturacion_config solo admin/contabilidad");
  await assertSucceeds(as("recepcion").doc("empresa/estado_de_reparacion").set({ x: 2 }, { merge: true }));
  ok("empresa: el resto de docs de config operativa sigue abierto al staff");

  // clientes: el vínculo QBO decide a quién se factura.
  await assertFails(as("vendedor").doc("clientes/cliQbo").set({ qbo_customer_id: "99" }, { merge: true }));
  await assertSucceeds(as("contabilidad").doc("clientes/cliQbo").set({ qbo_customer_id: "99", qbo_customer_name: "Q" }, { merge: true }));
  await assertSucceeds(as("vendedor").doc("clientes/cliQbo").set({ nombre: "Z" }, { merge: true }));
  ok("clientes: qbo_customer_* solo admin/contabilidad; edición normal abierta");

  // inventario_piezas: stock abierto (flujo de órdenes), precio/QBO por rol.
  await assertFails(as("tecnico").doc("inventario_piezas/pPrecio").set({ precio_venta: 99 }, { merge: true }));
  await assertSucceeds(as("tecnico").doc("inventario_piezas/pPrecio").set({ cantidad: 2 }, { merge: true }));
  await assertSucceeds(as("contabilidad").doc("inventario_piezas/pPrecio").set({ precio_venta: 99 }, { merge: true }));
  await assertSucceeds(as("inventario").doc("inventario_piezas/pPrecio").set({ costo_unitario: 5 }, { merge: true }));
  await assertFails(as("tecnico").doc("inventario_piezas/pDel").delete());
  await assertSucceeds(as("administrador").doc("inventario_piezas/pDel").delete());
  ok("inventario_piezas: precio/costo/QBO gated; stock sigue abierto; delete solo admin");

  // contratos: descarte de la orden de programación ("no se va a crear"). Lo
  // escribe quien ve la bandeja del home — recepción/admin. Es el campo que
  // apaga el CTA "Crear orden" de la lista de contratos, así que no puede
  // ponerlo cualquier autenticado.
  for (const r of ["vendedor", "tecnico", "inventario", "gerente"]) {
    await assertFails(as(r).doc("contratos/cFact")
      .set({ orden_prog_descartada: { motivo: "no_aplica" } }, { merge: true }));
  }
  await assertSucceeds(as("recepcion").doc("contratos/cFact")
    .set({ orden_prog_descartada: { motivo: "entregado", equipos_activos: 2 } }, { merge: true }));
  await assertSucceeds(as("administrador").doc("contratos/cFact")
    .set({ orden_prog_descartada: { motivo: "otro", nota: "x" } }, { merge: true }));
  ok("contratos: orden_prog_descartada solo recepción/admin");

  // ── contratos: activación por firmado + reemplazo del PDF ────────────────
  // Subir el firmado de un contrato APROBADO lo activa (esActivacionPorFirmado);
  // corregir el archivo de uno YA ACTIVO (se subió el contrato sin firmar) es un
  // write activo→activo que solo repunta firmado_*. La UI lo bloqueaba y las
  // reglas no: este caso fija que el backend siga permitiendo la corrección y que
  // el salto a 'activo' siga cerrado para quien no tiene el firmado.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("contratos/cApro").set({ estado: "aprobado", contrato_id: "TEMP20260817-01" });
    await db.doc("contratos/cFirmado").set({
      estado: "activo", contrato_id: "TEMP20260817-02",
      firmado: true, firmado_url: "https://x/viejo.pdf", firmado_nombre: "viejo.pdf",
    });
  });
  // Sin firmado_url, el vendedor NO puede activar un aprobado.
  await assertFails(as("vendedor").doc("contratos/cApro").set({ estado: "activo" }, { merge: true }));
  await assertSucceeds(as("vendedor").doc("contratos/cApro")
    .set({ estado: "activo", firmado: true, firmado_url: "https://x/f.pdf" }, { merge: true }));
  ok("contratos: activación por firmado permitida al vendedor; sin firmado_url, no");
  // Reemplazo sobre contrato vivo: repuntar el archivo sin tocar estado.
  await assertSucceeds(as("vendedor").doc("contratos/cFirmado").set({
    firmado_url: "https://x/nuevo.pdf", firmado_nombre: "nuevo.pdf",
    firmado_historial: [{ firmado_url: "https://x/viejo.pdf", firmado_nombre: "viejo.pdf" }],
  }, { merge: true }));
  ok("contratos: reemplazo del PDF firmado en contrato activo (corrección del archivo)");
  // Borrar el rastro del reemplazo (dejar el historial más corto) no pasa.
  await assertFails(as("vendedor").doc("contratos/cFirmado")
    .set({ firmado_historial: [] }, { merge: true }));
  await assertSucceeds(as("administrador").doc("contratos/cFirmado")
    .set({ firmado_historial: [] }, { merge: true }));
  ok("contratos: firmado_historial solo crece (admin exento para correcciones)");

  // ── ordenes: `eliminado` (borrado lógico) — auditoría órdenes P2 ──────────
  // Solo recepción lo enciende (admin queda exento por isAdmin()), con motivo
  // ≥10 chars, nunca sobre una orden terminal y nunca en reversa true→false.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("ordenes_de_servicio/eDel1").set({ estado_reparacion: "POR ASIGNAR" });
    await db.doc("ordenes_de_servicio/eDel2").set({ estado_reparacion: "POR ASIGNAR" });
    await db.doc("ordenes_de_servicio/eDelTerm").set({ estado_reparacion: "ENTREGADO AL CLIENTE" });
    await db.doc("ordenes_de_servicio/eDelRev").set({ estado_reparacion: "POR ASIGNAR", eliminado: true, eliminado_motivo: "duplicada por error" });
  });
  await assertSucceeds(as("recepcion").doc("ordenes_de_servicio/eDel1")
    .set({ eliminado: true, eliminado_motivo: "duplicada — se creó dos veces" }, { merge: true }));
  ok("eliminado: recepción borra (lógico) una POR ASIGNAR con motivo");
  await assertFails(as("recepcion").doc("ordenes_de_servicio/eDel2")
    .set({ eliminado: true, eliminado_motivo: "corta" }, { merge: true }));
  ok("eliminado: sin motivo suficiente (≥10 chars) NO pasa");
  await assertFails(as("tecnico").doc("ordenes_de_servicio/eDel2")
    .set({ eliminado: true, eliminado_motivo: "duplicada por error" }, { merge: true }));
  ok("eliminado: técnico NO puede marcar eliminado");
  await assertFails(as("recepcion").doc("ordenes_de_servicio/eDelTerm")
    .set({ eliminado: true, eliminado_motivo: "duplicada por error" }, { merge: true }));
  ok("eliminado: una orden ENTREGADA no se borra (historial del cliente)");
  await assertFails(as("recepcion").doc("ordenes_de_servicio/eDelRev")
    .set({ eliminado: false }, { merge: true }));
  ok("eliminado: la reversa true→false NO pasa para roles no-admin");
  await assertSucceeds(as("administrador").doc("ordenes_de_servicio/eDelRev")
    .set({ eliminado: false }, { merge: true }));
  ok("eliminado: admin sí revierte (corrección manual)");

  await testEnv.cleanup();
  console.log(`\nTODOS LOS TESTS DE REGLAS PASARON (${n} grupos)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e && e.message ? e.message : e); process.exit(1); });

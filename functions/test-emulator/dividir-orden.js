// Test de OrdenesService.dividirOrden (front) contra el emulador de Firestore
// con las reglas REALES: una ENTRADA de 34 equipos se reparte en 4 órdenes
// (madre + 3 hijas) como recepción; los candados (orden tomada, equipo
// ajeno, madre vacía) rechazan.
// Corre con:
//   firebase emulators:exec --only firestore --project demo-rules-test "node functions/test-emulator/dividir-orden.js"
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const compat = require("firebase/compat/app");
require("firebase/compat/firestore");

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"),
      host: "127.0.0.1", port: 8080,
    },
  });
  await testEnv.clearFirestore();

  // Servicio del front cargado tal cual (script clásico) con `firebase` global.
  const src = fs.readFileSync(path.join(__dirname, "../../public/js/services/ordenesService.js"), "utf8");
  // En el MISMO realm (no vm.createContext): los objetos que arma el servicio
  // deben tener el Object.prototype del SDK, si no `set()` los rechaza como
  // "custom Object".
  const ctxGlobal = globalThis;
  ctxGlobal.window = ctxGlobal;
  vm.runInThisContext(src + "\n;globalThis.OrdenesService = OrdenesService;");
  const OrdenesService = ctxGlobal.OrdenesService;

  const comoUsuario = (uid, email) => {
    const db = testEnv.authenticatedContext(uid).firestore();
    const fb = () => db;
    fb.firestore = fb;
    fb.firestore.FieldValue = compat.firestore.FieldValue;
    fb.firestore.Timestamp = compat.firestore.Timestamp;
    fb.firestore.FieldPath = compat.firestore.FieldPath;
    fb.auth = () => ({ currentUser: { uid, email } });
    ctxGlobal.firebase = fb;
    return db;
  };

  const equipos = Array.from({ length: 34 }, (_, i) => ({
    id: `eq${i}`, modelo_id: "m1", modelo: "NX-420-R",
    serial: `S${1000 + i}`, numero_de_serie: `S${1000 + i}`,
    bateria: true, clip: true, cargador: false, fuente: false, antena: false, cubrepolvo: true,
    observaciones: "Inspección de entrada — Devolución 2026090805 (contrato_papel).", eliminado: false,
  }));
  const madre = {
    cliente_id: "cli1", cliente_nombre: "TROPICAL RESORTS", vendedor_asignado: "",
    tipo_de_servicio: "ENTRADA", estado_reparacion: "POR ASIGNAR",
    contrato: { aplica: true, contrato_doc_id: null, contrato_id: null, motivo_no_aplica: null },
    entrada_inspeccion: { tipo: "devolucion", ref_id: "2026090805" },
    fecha_recepcion: compat.firestore.Timestamp.fromDate(new Date("2026-09-08T18:55:23Z")),
    recepcion_por_uid: "uRecep", recepcion_por_email: null,
    receptor_recepcion_nombre: "Juan Pérez", firma_recepcion_url: "https://x/firma.png",
    recepcion_sin_firma: false, recepcion_sin_firma_motivo: null,
    observaciones: "Orden creada automáticamente: inspección de 34 equipos devueltos. Devolución 2026090805 (contrato_papel) — contrato —.",
    equipos: [...equipos, { id: "eqDel", serial: "SDEL", numero_de_serie: "SDEL", modelo: "NX-420-R", eliminado: true }],
    creado_por_uid: "system", creado_por_email: null, eliminado: false,
    os_logs: [{ action: "CREAR", by: "system:orden-entrada" }],
    nota_tecnica: "no debe heredarse",
  };

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ["recepcion", "jefe_taller", "administrador", "tecnico", "vista"]) await db.doc(`usuarios/${r}`).set({ rol: r });
    await db.doc("ordenes_de_servicio/2026090806").set(madre);
    await db.doc("ordenes_de_servicio/2026090807").set({ ...madre, tecnico_asignado: "Jesus", tecnico_uid: "t1", estado_reparacion: "ASIGNADO" });
    await db.doc("ordenes_de_servicio/2026090809").set({ ...madre });
  });

  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
  const ids = equipos.map(e => e.id);
  const grupos = [ids.slice(9, 18), ids.slice(18, 26), ids.slice(26, 34)]; // madre se queda con 9

  // ── Caso feliz: recepción divide 34 en 9 + 9 + 8 + 8 ─────────────────────
  const dbR = comoUsuario("recepcion", "r@ceco.com");
  const r = await OrdenesService.dividirOrden("2026090806", grupos);
  assert.strictEqual(r.nuevas.length, 3);
  assert.strictEqual(r.restantes, 9);
  ok(`dividirOrden devuelve 3 hijas ${r.nuevas.join(",")} y 9 restantes`);

  const m = (await dbR.doc("ordenes_de_servicio/2026090806").get()).data();
  assert.strictEqual(m.equipos.filter(e => !e.eliminado).length, 9);
  assert.ok(m.equipos.some(e => e.id === "eqDel"), "el eliminado se queda en la madre");
  assert.deepStrictEqual(m.dividida_en, r.nuevas);
  assert.strictEqual(m.estado_reparacion, "POR ASIGNAR");
  assert.ok(/^Orden creada automáticamente: inspección de 9 equipos devueltos\. Devolución 2026090805/.test(m.observaciones), m.observaciones);
  assert.ok(m.observaciones.endsWith(`Dividida: 25 equipos pasaron a las órdenes ${r.nuevas.join(", ")}.`), m.observaciones);
  assert.ok(m.os_logs.some(l => l.action === "DIVIDIR" && l.equipos_movidos === 25 && l.by === "recepcion"));
  ok("madre: 9 activos + el eliminado, dividida_en, observación reescrita, os_log DIVIDIR");

  const esperados = [9, 8, 8];
  for (let i = 0; i < 3; i++) {
    const h = (await dbR.doc(`ordenes_de_servicio/${r.nuevas[i]}`).get()).data();
    assert.strictEqual(h.equipos.length, esperados[i]);
    assert.deepStrictEqual(h.equipos.map(e => e.id), grupos[i]);
    assert.strictEqual(h.tipo_de_servicio, "ENTRADA");
    assert.strictEqual(h.estado_reparacion, "POR ASIGNAR");
    assert.strictEqual(h.dividida_de, "2026090806");
    assert.deepStrictEqual(h.entrada_inspeccion, madre.entrada_inspeccion);
    assert.deepStrictEqual(h.contrato, madre.contrato);
    assert.strictEqual(h.cliente_id, "cli1");
    assert.strictEqual(h.receptor_recepcion_nombre, "Juan Pérez");
    assert.strictEqual(h.firma_recepcion_url, "https://x/firma.png");
    assert.strictEqual(h.recepcion_sin_firma, false);
    assert.ok(h.fecha_recepcion.isEqual(madre.fecha_recepcion), "fecha_recepcion heredada");
    assert.strictEqual(h.eliminado, false);
    assert.strictEqual(h.creado_por_uid, "recepcion");
    assert.strictEqual(h.nota_tecnica, undefined);
    assert.strictEqual(h.tecnico_uid, undefined);
    assert.ok(h.fecha_creacion, "fecha_creacion estampada");
    assert.ok(new RegExp(`^Orden creada automáticamente: inspección de ${esperados[i]} equipos devueltos\\. Devolución 2026090805 .* Dividida de la orden 2026090806 para repartir`).test(h.observaciones), h.observaciones);
    assert.ok(h.os_logs[0].action === "CREAR" && h.os_logs[0].dividida_de === "2026090806");
  }
  ok("hijas: equipos exactos, herencia (cliente/devolución/contrato/acuse), sin nota ni técnico, observación propia");

  // Numeración: hoy + correlativo por contador, sin chocar con las que existen.
  const f = new Date(); const p2 = (x) => String(x).padStart(2, "0");
  const hoy = `${f.getFullYear()}${p2(f.getMonth() + 1)}${p2(f.getDate())}`;
  for (const id of r.nuevas) assert.ok(id.startsWith(hoy), id);
  assert.strictEqual(new Set(r.nuevas).size, 3);
  ok("numeración del día sin duplicados");

  // ── Candados ──────────────────────────────────────────────────────────────
  await assert.rejects(() => OrdenesService.dividirOrden("2026090807", [["eq0"]]), /ya fue tomada/);
  ok("orden ASIGNADA con técnico: rechaza");
  await assert.rejects(() => OrdenesService.dividirOrden("2026090809", [["noExiste"]]), /ya no está en la orden/);
  ok("equipo ajeno a la orden: rechaza");
  await assert.rejects(() => OrdenesService.dividirOrden("2026090809", [["eqDel"]]), /ya no está en la orden/);
  ok("equipo eliminado: no se mueve");
  await assert.rejects(() => OrdenesService.dividirOrden("2026090809", [ids]), /al menos un equipo/);
  ok("mover todos: la madre no puede quedar vacía");
  await assert.rejects(() => OrdenesService.dividirOrden("2026090809", [["eq0"], ["eq0"]]), /dos órdenes/);
  ok("mismo equipo en dos grupos: rechaza");
  await assert.rejects(() => OrdenesService.dividirOrden("2026090809", []), /Nada que dividir/);
  ok("sin grupos: rechaza");
  const antes = (await dbR.doc("ordenes_de_servicio/2026090809").get()).data();
  assert.strictEqual(antes.equipos.length, 35);
  assert.strictEqual(antes.dividida_en, undefined);
  ok("los rechazos no tocan la orden");

  // ── Reglas: jefe_taller también puede; vista no ───────────────────────────
  comoUsuario("jefe_taller", "j@ceco.com");
  const r2 = await OrdenesService.dividirOrden("2026090809", [ids.slice(0, 5)]);
  assert.strictEqual(r2.nuevas.length, 1);
  ok("jefe_taller divide (rules OK)");
  const dbV = comoUsuario("vista", "v@ceco.com");
  await assertFails(dbV.doc("ordenes_de_servicio/2026090809").update({ equipos: [] }));
  await assert.rejects(() => OrdenesService.dividirOrden("2026090809", [ids.slice(5, 8)]));
  ok("vista no puede (rules)");

  // Segunda división de la misma madre (dividir a mano en varias vueltas).
  comoUsuario("recepcion", "r@ceco.com");
  const r3 = await OrdenesService.dividirOrden("2026090809", [ids.slice(5, 8)]);
  const m2 = (await dbR.doc("ordenes_de_servicio/2026090809").get()).data();
  assert.deepStrictEqual(m2.dividida_en, [...r2.nuevas, ...r3.nuevas]);
  assert.strictEqual(m2.equipos.filter(e => !e.eliminado).length, 26);
  ok("segunda vuelta acumula dividida_en y descuenta equipos");

  console.log(`\n${n} checks OK`);
  await testEnv.cleanup();
}

main().catch((e) => { console.error("FAIL", e); process.exit(1); });

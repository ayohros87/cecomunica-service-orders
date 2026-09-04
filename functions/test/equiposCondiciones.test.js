// Registro de equipos con CONDICIÓN PARTICULAR (petición Solangel 2026-09-04).
//
// Un radio que funciona pero arrastra una limitación que el taller no puede
// resolver (auricular dañado que pide microsoldadura). La condición vive por
// SERIAL en `equipos_condiciones`, aparte de la orden, para que la vea quien
// firma el QC, quien asigna en bodega y el técnico que lo vuelva a recibir.
//
// Este archivo congela lo que se rompe solo porque dato, alerta y regla viven
// en archivos distintos:
//   C1-C2 — sin serial válido o sin texto no se escribe nada.
//   C3    — el doc-ID es el serial NORMALIZADO y `vigente: true` (la regla de
//           Firestore deja al técnico escribir SOLO con vigente == true).
//   C4    — re-registrar limpia un levantamiento previo (la alerta vuelve).
//   C5    — la misma condición vigente no re-escribe (la firma del QC pasa por
//           aquí cada vez que el radio sale de taller).
//   C6-C7 — buscar() ignora las levantadas y encuentra las vigentes normalizando.
//   C8    — levantar() no borra: deja la traza y marca vigente: false.
//   C9    — la normalización es la MISMA que la del pool (si divergen, el chip
//           nunca encuentra el doc).
//   C10   — la regla de Firestore existe y exige vigente == true al técnico.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// ── Carga del servicio con un Firestore de mentira ─────────────────────────
function cargar({ docs = {} } = {}) {
  const escrituras = [];
  const col = () => ({
    doc: (id) => ({
      get: async () => ({ exists: id in docs, id, data: () => docs[id] }),
      set: async (data, opts) => { escrituras.push({ id, data, opts }); docs[id] = { ...(docs[id] || {}), ...data }; },
      update: async (data) => { escrituras.push({ id, data }); docs[id] = { ...(docs[id] || {}), ...data }; },
    }),
  });
  const ctx = {
    console, window: {},
    firebase: {
      firestore: Object.assign(() => ({ collection: col }), {
        FieldValue: { serverTimestamp: () => "TS", arrayUnion: (...v) => ({ __arrayUnion: v }) },
      }),
      auth: () => ({ currentUser: { uid: "u1", email: "solangel@cecomunica.com" } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "equiposCondicionesService.js"), ctx);
  return { svc: ctx.window.EquiposCondicionesService, escrituras, docs };
}

test("C1 · un serial sin dígitos NO entra al registro", async () => {
  const { svc, escrituras } = cargar();
  const r = await svc.registrar({ serial: "CONSOLA", condicion: "sin auricular" });
  assert.equal(r, null);
  assert.equal(escrituras.length, 0);
});

test("C2 · sin texto de condición no se escribe nada", async () => {
  const { svc, escrituras } = cargar();
  const r = await svc.registrar({ serial: "ABC123", condicion: "   " });
  assert.equal(r, null);
  assert.equal(escrituras.length, 0);
});

test("C3 · el doc se guarda con el serial NORMALIZADO como id y vigente: true", async () => {
  const { svc, escrituras } = cargar();
  const r = await svc.registrar({ serial: " nx-420 1234 ", condicion: "conector de auricular dañado", orden_id: "OS-1", origen: "qc" });
  assert.equal(r, "NX4201234");
  assert.equal(escrituras[0].id, "NX4201234");
  assert.equal(escrituras[0].data.serial_norm, "NX4201234");
  assert.equal(escrituras[0].data.serial, "nx-420 1234", "se conserva lo que se tecleó");
  assert.equal(escrituras[0].data.vigente, true, "la regla solo deja al técnico escribir con vigente == true");
  assert.equal(escrituras[0].data.condicion, "conector de auricular dañado");
  assert.equal(escrituras[0].data.origen, "qc");
  assert.equal(escrituras[0].opts.merge, true, "re-registrar no puede duplicar el doc");
  assert.ok(escrituras[0].data.historial.__arrayUnion, "cada registro se apila en el historial");
});

test("C4 · re-registrar limpia un levantamiento previo (la alerta vuelve)", async () => {
  const { svc, escrituras } = cargar({
    docs: { ABC123: { serial_norm: "ABC123", condicion: "sin auricular", vigente: false, levantado_motivo: "se reparó" } },
  });
  await svc.registrar({ serial: "ABC123", condicion: "otra vez el auricular" });
  assert.equal(escrituras.length, 1);
  assert.equal(escrituras[0].data.vigente, true);
  assert.equal(escrituras[0].data.levantado_motivo, "");
});

test("C5 · la MISMA condición vigente no re-escribe", async () => {
  const { svc, escrituras } = cargar({
    docs: { ABC123: { serial_norm: "ABC123", condicion: "sin auricular", vigente: true } },
  });
  const r = await svc.registrar({ serial: "abc-123", condicion: " sin auricular " });
  assert.equal(r, "ABC123", "devuelve el serial igual: para el llamador quedó registrada");
  assert.equal(escrituras.length, 0, "la firma del QC pasa por aquí cada vez — no debe apilar historial repetido");
});

test("C6 · buscar() ignora las levantadas (el aviso deja de salir)", async () => {
  const { svc } = cargar({ docs: { ABC123: { serial_norm: "ABC123", vigente: false } } });
  assert.equal(await svc.buscar("abc-123"), null);
});

test("C7 · buscar() devuelve la vigente normalizando el serial; buscarVarios agrupa", async () => {
  const { svc } = cargar({
    docs: {
      ABC123: { serial_norm: "ABC123", condicion: "sin auricular", vigente: true },
      DEF456: { serial_norm: "DEF456", condicion: "x", vigente: false },
    },
  });
  const d = await svc.buscar("abc-123");
  assert.ok(d);
  assert.equal(d.condicion, "sin auricular");
  const m = await svc.buscarVarios(["abc-123", "def 456", "CONSOLA", "ZZZ999"]);
  assert.deepEqual([...m.keys()], ["ABC123"], "solo las vigentes; inválidos y ausentes fuera");
});

test("C8 · levantar() no borra: deja la traza y marca vigente: false", async () => {
  const { svc, escrituras } = cargar({ docs: { ABC123: { serial_norm: "ABC123", vigente: true } } });
  await svc.levantar("ABC123", "se cambió el conector");
  const w = escrituras[0].data;
  assert.equal(w.vigente, false);
  assert.equal(w.levantado_motivo, "se cambió el conector");
  assert.equal(w.levantado_por_email, "solangel@cecomunica.com");
  assert.ok(w.historial.__arrayUnion, "el levantamiento se apila en el historial");
  assert.equal(w.historial.__arrayUnion[0].tipo, "levantamiento");
});

test("C9 · la normalización es la MISMA que la del pool", () => {
  const { svc } = cargar();
  const poolCtx = { firebase: { firestore: { FieldValue: {} } }, console, window: {} };
  vm.createContext(poolCtx);
  vm.runInContext(leer("public", "js", "services", "equiposPoolService.js"), poolCtx);
  const pool = poolCtx.window.EquiposPoolService;
  for (const s of [" nx-420 1234 ", "abc123", "A-1_B/2", "25725A0542"]) {
    assert.equal(svc.normalizar(s), pool.normalizarSerial(s), `divergen en "${s}"`);
    assert.equal(svc.esSerialValido(svc.normalizar(s)),
      pool.esSerialValido(pool.normalizarSerial(s)), `validez divergente en "${s}"`);
  }
  assert.equal(svc.resumen("línea uno\nlínea dos", 60), "línea uno", "el resumen es la primera línea");
  assert.equal(svc.resumen("x".repeat(80), 20).length, 20);
});

test("C10 · firestore.rules tiene la colección y exige vigente == true al técnico", () => {
  const rules = leer("firestore.rules");
  const m = rules.match(/match \/equipos_condiciones\/\{docId\}\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(m, "falta match /equipos_condiciones en firestore.rules");
  const bloque = m[1];
  assert.match(bloque, /"tecnico"/, "el técnico tiene que poder registrar la condición desde su intervención");
  assert.match(bloque, /get\("vigente", false\) == true/, "el técnico solo escribe con vigente == true (no puede levantar)");
  assert.match(bloque, /allow delete: if isAdmin\(\)/, "nunca se borra desde la UI");
});

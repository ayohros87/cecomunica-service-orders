// Control de calidad POR EQUIPO + registro de equipos descartados.
//
// Reporte de la jefa de taller (2026-08-19): el OK de calidad era UNA revisión
// por orden, así que una firma sobre 10 radios no podía decir qué se revisó en
// cada uno ni cuáles se descartaron. Este archivo congela los invariantes que
// se rompen solos porque el dato, su presentación y su regla viven en archivos
// distintos:
//
//   A — el checklist de ORDEN (qc.checklist) se deriva del de cada equipo, y
//       firestore.rules cuenta SUS CLAVES contra un mínimo fijo (5 programación,
//       4 reparación). Si el roll-up emite menos claves, la regla rechaza la
//       firma en producción y en local no se nota.
//   B — los mínimos de la regla tienen que seguir siendo los tamaños reales de
//       QC_CHECKLISTS. Ya había un comentario pidiéndolo a mano; aquí se exige.
//   C — la caducidad del QC ahora también detecta SUSTITUCIÓN de seriales, no
//       solo cambio de conteo (cambiar un radio por otro dejaba viva una firma
//       que no cubría lo que iba a salir).
//   D — el registro de descartados: seriales inválidos no entran, y un descarte
//       revocado deja de alertar sin perder la traza.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// ── Carga de ordenes-qc.js (IIFE que publica window.OrdenesQC) ─────────────
// El módulo solo necesita estos globales al DEFINIRSE; los que usa el modal
// (Toast, Modal, OrdenesService…) solo se tocan al abrirlo, y aquí no se abre.
function cargarQc() {
  const noop = () => {};
  const ctx = {
    console, window: {},
    escapeHtml: (v) => String(v ?? ""),
    ROLES: { ADMIN: "administrador", JEFE_TALLER: "jefe_taller" },
    APP: { state: {}, utils: { lucideRefresh: noop } },
    document: { addEventListener: noop, getElementById: () => null },
    firebase: { auth: () => ({ currentUser: null }), firestore: () => ({}) },
  };
  vm.createContext(ctx);
  // ordenes-qc delega el estado del QC en PendientesDomain (fase 1 del plan
  // Pendientes, 2026-08-21): el dominio se evalúa primero, igual que en la
  // página (js/domain/pendientes.js va antes en el orden de <script>).
  vm.runInContext(leer("public", "js", "domain", "pendientes.js"), ctx);
  ctx.PendientesDomain = ctx.window.PendientesDomain;
  vm.runInContext(leer("public", "js", "pages", "ordenes-qc.js"), ctx);
  return ctx.window.OrdenesQC;
}

// ── Carga de equiposDescartadosService.js con un Firestore de mentira ──────
function cargarDescartados({ docs = {} } = {}) {
  const escrituras = [];
  const col = () => ({
    doc: (id) => ({
      get: async () => ({
        exists: id in docs,
        id,
        data: () => docs[id],
      }),
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
      auth: () => ({ currentUser: { uid: "u1", email: "jefa@cecomunica.com" } }),
    },
    // El servicio prefiere la normalización del pool si está cargada; aquí no
    // lo está, así que ejercita su propio fallback (que debe ser idéntico).
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "equiposDescartadosService.js"), ctx);
  return { svc: ctx.window.EquiposDescartadosService, escrituras, docs };
}

// Mínimos declarados en firestore.rules → qcAprobadoTraeChecklist().
function minimosDeLasReglas() {
  const rules = leer("firestore.rules");
  const m = rules.match(/qc\.get\("tipo",\s*""\)\s*==\s*"programacion"\s*\?\s*n\s*>=\s*(\d+)\s*:\s*n\s*>=\s*(\d+)/);
  assert.ok(m, "no se encontró el conteo mínimo de checklist en firestore.rules — ¿cambió qcAprobadoTraeChecklist?");
  return { programacion: Number(m[1]), reparacion: Number(m[2]) };
}

// ── B — los mínimos de la regla siguen siendo los tamaños reales ───────────
test("B · el mínimo de checklist de firestore.rules coincide con QC_CHECKLISTS", () => {
  const QC = cargarQc();
  const min = minimosDeLasReglas();
  assert.equal(QC.QC_CHECKLISTS.programacion.length, min.programacion,
    "programación: agregaste o quitaste un ítem sin mover el mínimo de la regla");
  assert.equal(QC.QC_CHECKLISTS.reparacion.length, min.reparacion,
    "reparación: agregaste o quitaste un ítem sin mover el mínimo de la regla");
});

// ── A — el roll-up siempre satisface a la regla ────────────────────────────
test("A1 · el roll-up emite una clave por ítem aunque NINGÚN equipo se marque", () => {
  const QC = cargarQc();
  const items = QC.QC_CHECKLISTS.reparacion;
  const eqs = [{ key: "a" }, { key: "b" }];
  const porEquipo = { a: { checklist: {} }, b: { checklist: {} } };

  const roll = QC._rollupChecklist(items, porEquipo, eqs);
  // Caso real: los dos equipos se descartaron sin tocar el checklist. La regla
  // sigue exigiendo ≥4 claves, así que el roll-up no puede salir vacío.
  assert.equal(Object.keys(roll).length, items.length);
  assert.ok(Object.values(roll).every((v) => v === "na"));
});

test("A2 · un solo 'ok' entre varios equipos manda sobre los N/A", () => {
  const QC = cargarQc();
  const items = QC.QC_CHECKLISTS.reparacion;
  const eqs = [{ key: "a" }, { key: "b" }];
  const porEquipo = {
    a: { checklist: { limpieza: "na" } },
    b: { checklist: { limpieza: "ok" } },
  };
  const roll = QC._rollupChecklist(items, porEquipo, eqs);
  assert.equal(roll.limpieza, "ok", "si alguien verificó el punto, el resumen no puede decir N/A");
});

test("A3 · el roll-up nunca deja una clave sin valor (la regla las cuenta)", () => {
  const QC = cargarQc();
  for (const tipo of ["programacion", "reparacion"]) {
    const items = QC.QC_CHECKLISTS[tipo];
    const roll = QC._rollupChecklist(items, { x: { checklist: {} } }, [{ key: "x" }]);
    for (const it of items) {
      assert.ok(roll[it.key] === "ok" || roll[it.key] === "na",
        `${tipo}/${it.key} salió sin valor`);
    }
  }
});

// ── Los tres desenlaces por equipo son los que pidió el reporte ────────────
test("los desenlaces por equipo son aprobado / denegado / descartado", () => {
  const QC = cargarQc();
  // Comparado como texto: el array viene de otro realm (vm) y deepEqual falla
  // por identidad de prototipo aunque el contenido sea idéntico.
  assert.equal(QC.RESULTADOS_EQUIPO.map((r) => r.key).join(","),
    "aprobado,denegado,descartado");
});

// ── C — caducidad por sustitución de serial ────────────────────────────────
const ordenConQc = (seriales, firmados) => ({
  equipos: seriales.map((s, i) => ({ id: `e${i}`, numero_de_serie: s })),
  qc: {
    resultado: "aprobado",
    equipos_n: seriales.length,
    por_equipo: Object.fromEntries(
      firmados.map((s, i) => [`e${i}`, { serial: s, resultado: "aprobado" }])),
  },
});

test("C1 · cambiar un serial por otro SIN cambiar el conteo caduca el QC", () => {
  const QC = cargarQc();
  // Firmado sobre A y B; ahora la orden lleva A y C. El conteo no se movió, así
  // que la regla de Firestore (que solo sabe contar) dejaría entregar los dos.
  const orden = ordenConQc(["AAA111", "CCC333"], ["AAA111", "BBB222"]);
  assert.equal(QC.qcCaducado(orden), true);
});

test("C2 · los mismos seriales NO caducan", () => {
  const QC = cargarQc();
  assert.equal(QC.qcCaducado(ordenConQc(["AAA111", "BBB222"], ["AAA111", "BBB222"])), false);
});

test("C3 · sin por_equipo (firma vieja) se conserva el corte legacy", () => {
  const QC = cargarQc();
  const orden = {
    equipos: [{ numero_de_serie: "ZZZ999" }],
    qc: { resultado: "aprobado", equipos_n: 1 },
  };
  assert.equal(QC.qcCaducado(orden), false,
    "una firma anterior al checklist por equipo no puede caducar de golpe");
});

test("C4 · el cambio de conteo sigue caducando", () => {
  const QC = cargarQc();
  const orden = ordenConQc(["AAA111", "BBB222"], ["AAA111", "BBB222"]);
  orden.equipos.push({ id: "e9", numero_de_serie: "DDD444" });
  assert.equal(QC.qcCaducado(orden), true);
});

// ── D — registro de descartados ────────────────────────────────────────────
test("D1 · un serial sin dígitos NO entra al registro", async () => {
  const { svc, escrituras } = cargarDescartados();
  // Mismo criterio que el pool: el campo serial se usa de cajón de sastre
  // ("CONSOLA", "GPS") y eso no es una unidad identificable.
  const r = await svc.registrar({ serial: "CONSOLA", motivo: "no enciende" });
  assert.equal(r, null);
  assert.equal(escrituras.length, 0, "no debe escribirse nada");
});

test("D2 · el doc se guarda con el serial NORMALIZADO como id", async () => {
  const { svc, escrituras } = cargarDescartados();
  const r = await svc.registrar({ serial: " nx-420 1234 ", motivo: "placa quemada", orden_id: "OS-1" });
  assert.equal(r, "NX4201234");
  assert.equal(escrituras[0].id, "NX4201234");
  assert.equal(escrituras[0].data.serial_norm, "NX4201234");
  assert.equal(escrituras[0].data.serial, "nx-420 1234", "se conserva lo que se tecleó");
  assert.equal(escrituras[0].data.revocado, false);
  assert.equal(escrituras[0].opts.merge, true, "re-descartar no puede duplicar el doc");
});

test("D3 · re-descartar limpia una revocación previa", async () => {
  const { svc, escrituras } = cargarDescartados({
    docs: { ABC123: { revocado: true, revocado_motivo: "fue error" } },
  });
  await svc.registrar({ serial: "ABC123", motivo: "ahora sí" });
  assert.equal(escrituras[0].data.revocado, false);
  assert.equal(escrituras[0].data.revocado_motivo, "",
    "si vuelve a descartarse, la alerta tiene que volver a salir");
});

test("D4 · buscar() ignora los revocados (la alerta deja de salir)", async () => {
  const { svc } = cargarDescartados({
    docs: { ABC123: { serial_norm: "ABC123", revocado: true } },
  });
  assert.equal(await svc.buscar("abc-123"), null);
});

test("D5 · buscar() sí devuelve un descarte vigente, normalizando el serial", async () => {
  const { svc } = cargarDescartados({
    docs: { ABC123: { serial_norm: "ABC123", motivo: "placa quemada", revocado: false } },
  });
  const d = await svc.buscar("abc-123");
  assert.ok(d, "el serial se busca normalizado, como el doc-ID");
  assert.equal(d.motivo, "placa quemada");
});

test("D6 · revocar() no borra: deja la traza y marca revocado", async () => {
  const { svc, escrituras } = cargarDescartados({
    docs: { ABC123: { serial_norm: "ABC123", revocado: false } },
  });
  await svc.revocar("ABC123", "el radio sí servía");
  const w = escrituras[0].data;
  assert.equal(w.revocado, true);
  assert.equal(w.revocado_motivo, "el radio sí servía");
  assert.equal(w.revocado_por_email, "jefa@cecomunica.com");
  assert.ok(w.historial.__arrayUnion, "la revocación se apila en el historial");
});

test("D7 · la normalización del registro es la MISMA que la del pool", () => {
  const { svc } = cargarDescartados();
  const poolCtx = { firebase: { firestore: { FieldValue: {} } }, console, window: {} };
  vm.createContext(poolCtx);
  vm.runInContext(leer("public", "js", "services", "equiposPoolService.js"), poolCtx);
  const pool = poolCtx.window.EquiposPoolService;

  // El doc-ID del registro es el serial normalizado y SerialField lo busca con
  // la normalización del pool: si divergen, la alerta nunca encuentra el doc.
  for (const s of [" nx-420 1234 ", "abc123", "A-1_B/2", "25725A0542"]) {
    assert.equal(svc.normalizar(s), pool.normalizarSerial(s), `divergen en "${s}"`);
    assert.equal(svc.esSerialValido(svc.normalizar(s)),
      pool.esSerialValido(pool.normalizarSerial(s)), `validez divergente en "${s}"`);
  }
});

// Guardia de sincronía de los predicados de PENDIENTE.
//
// Los predicados existen DUPLICADOS a propósito (no hay build step que
// comparta código entre navegador y functions):
//   · functions/src/domain/pendientes.js   (cron del correo diario)
//   · public/js/domain/pendientes.js       (bandeja del home, QC, colas)
// Una divergencia reproduce el bug que motivó todo esto: el correo anuncia
// N pendientes y la pantalla muestra otra cosa (reporte de la jefa de taller,
// 19 y 20 de agosto de 2026 — dos veces). Este test evalúa el archivo del
// frontend en un sandbox y compara ambas implementaciones sobre un corpus de
// documentos reales y adversariales. Si tocas una, te obliga a tocar las dos.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backend = require("../src/domain/pendientes");

function cargarFrontend() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "domain", "pendientes.js"),
    "utf8"
  );
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "pendientes.js" });
  return sandbox.window.PendientesDomain;
}
const front = cargarFrontend();

// ── Corpus ────────────────────────────────────────────────────────────────
// Fechas fijas: los predicados reciben `now` explícito, así que el corpus es
// determinista (Date.now no participa).
const NOW = new Date("2026-08-21T12:00:00Z");
const hace = (dias) => new Date(NOW.getTime() - dias * 864e5).toISOString();

const eq = (serial, extra) => Object.assign({ id: "e" + serial, numero_de_serie: serial }, extra || {});

const ORDENES = [
  // vacíos y basura
  null, undefined, {}, { qc: null }, { qc: {} },
  // QC aprobado vigente
  { qc_requerido: true, qc: { resultado: "aprobado", equipos_n: 2 }, equipos: [eq("A1"), eq("B2")] },
  // caducado por conteo
  { qc_requerido: true, qc: { resultado: "aprobado", equipos_n: 2 }, equipos: [eq("A1"), eq("B2"), eq("C3")] },
  // caducado por SUSTITUCIÓN de serial (conteo intacto)
  { qc_requerido: true, equipos: [eq("A1"), eq("C3")],
    qc: { resultado: "aprobado", equipos_n: 2,
      por_equipo: { eA1: { serial: "A1", resultado: "aprobado" }, eB2: { serial: "B2", resultado: "aprobado" } } } },
  // firma legacy sin equipos_n → nunca caduca
  { qc_requerido: true, qc: { resultado: "aprobado" }, equipos: [eq("Z9")] },
  // rechazado
  { qc_requerido: true, qc: { resultado: "rechazado", equipos_n: 1 }, equipos: [eq("A1")] },
  // sin marca de QC (corte legacy)
  { qc: { resultado: "aprobado", equipos_n: 1 }, equipos: [eq("A1")] },
  // equipos eliminados no cuentan para la sustitución
  { qc_requerido: true, equipos: [eq("A1"), eq("X7", { eliminado: true })],
    qc: { resultado: "aprobado", equipos_n: 2,
      por_equipo: { eA1: { serial: "A1", resultado: "aprobado" } } } },

  // listas para entregar (y sus contraejemplos)
  { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "REPARACIÓN",
    fecha_completado: hace(10), qc_requerido: true,
    qc: { resultado: "aprobado", equipos_n: 1 }, equipos: [eq("A1")] },
  { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "PROGRAMACIÓN",
    fecha_completado: hace(1) },                                    // muy joven
  { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "ENTRADA",
    fecha_completado: hace(10) },                                   // tipo excluido
  { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "REPARACIÓN",
    fecha_completado: hace(10), qc_requerido: true,
    qc: { resultado: "rechazado" } },                               // QC lo bloquea
  { estado_reparacion: "ENTREGADO AL CLIENTE", tipo_de_servicio: "REPARACIÓN",
    fecha_completado: hace(10) },                                   // ya entregada
  { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "REPARACIÓN",
    fecha_modificacion: hace(5) },                                  // sin fecha_completado → fallback
  { estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "REPARACIÓN",
    fecha_completado: hace(10), eliminado: true },

  // estancadas
  { estado_reparacion: "ASIGNADO", fecha_modificacion: hace(15) },
  { estado_reparacion: "ASIGNADO", fecha_modificacion: hace(5) },   // aún fresca
  { estado_reparacion: "ASIGNADO", fecha_creacion: hace(45) },      // pasó el tope → legacy
  { estado_reparacion: "ASIGNADO", tipo_de_servicio: "DEVOLUCION", fecha_creacion: hace(15) },
  { estado_reparacion: "POR ASIGNAR", updatedAt: hace(12) },        // cadena de fallbacks
  { estado_reparacion: "POR ASIGNAR" },                             // sin ninguna fecha

  // pospuestas
  { estado_reparacion: "ASIGNADO", fecha_modificacion: hace(15),
    pendiente_snooze: { hasta: hace(-3), motivo: "cliente de viaje" } },   // vigente (futuro)
  { estado_reparacion: "ASIGNADO", fecha_modificacion: hace(15),
    pendiente_snooze: { hasta: hace(2), motivo: "venció" } },              // vencida
  { pendiente_snooze: { motivo: "sin fecha" } },
  { pendiente_snooze: { hasta: "no-es-fecha" } },
];

const UNIDADES = [
  null, {},
  { updated_at: hace(10) },
  { updated_at: hace(2) },
  { created_at: hace(30) },                       // fallback a created_at
  { updated_at: hace(10), pendiente_snooze: { hasta: hace(-5), motivo: "x" } },
];

// ── Paridad conductual ────────────────────────────────────────────────────
const PREDICADOS_ORDEN = ["qcCaducado", "qcAprobado", "qcPendiente", "esQcColaOperativa"];

test("predicados de QC: front == functions sobre el corpus", () => {
  for (const fn of PREDICADOS_ORDEN) {
    ORDENES.forEach((o, i) => {
      assert.equal(front[fn](o), backend[fn](o), `${fn} divergió en el doc #${i}`);
    });
  }
});

test("esListaParaEntregar: front == functions (umbral default y explícito)", () => {
  ORDENES.forEach((o, i) => {
    assert.equal(front.esListaParaEntregar(o, NOW, 3), backend.esListaParaEntregar(o, NOW, 3), `doc #${i}`);
    assert.equal(front.esListaParaEntregar(o, NOW), backend.esListaParaEntregar(o, NOW), `doc #${i} (default)`);
  });
});

test("esOrdenEstancada: front == functions (ventana default y explícita)", () => {
  for (const opts of [undefined, { staleDias: 10, staleMax: 30 }, { staleDias: 3, staleMax: 90 }]) {
    ORDENES.forEach((o, i) => {
      assert.equal(front.esOrdenEstancada(o, NOW, opts), backend.esOrdenEstancada(o, NOW, opts),
        `doc #${i} opts=${JSON.stringify(opts)}`);
    });
  }
});

test("esCuarentenaAtascada y estaPospuesto: front == functions", () => {
  UNIDADES.forEach((u, i) => {
    assert.equal(front.esCuarentenaAtascada(u, NOW, 7), backend.esCuarentenaAtascada(u, NOW, 7), `unidad #${i}`);
  });
  [...ORDENES, ...UNIDADES].forEach((d, i) => {
    assert.equal(front.estaPospuesto(d, NOW), backend.estaPospuesto(d, NOW), `doc #${i}`);
  });
});

test("los DEFAULTS y las constantes son idénticos", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(front.DEFAULTS)), backend.DEFAULTS);
  assert.equal(JSON.stringify([...front.ESTADOS_ABIERTOS]), JSON.stringify(backend.ESTADOS_ABIERTOS));
  assert.equal(front.COMPLETADO, backend.COMPLETADO);
});

// El comportamiento esperado en sí (no solo la paridad): los casos que
// motivaron cada regla, congelados contra el backend.
test("comportamiento: los casos que motivaron cada regla", () => {
  const b = backend;
  assert.equal(b.qcCaducado(ORDENES[7]), true, "sustitución de serial caduca");
  assert.equal(b.qcCaducado(ORDENES[8]), false, "firma legacy no caduca");
  assert.equal(b.esListaParaEntregar(ORDENES[12], NOW), true, "10 días con QC ok → lista");
  assert.equal(b.esListaParaEntregar(ORDENES[14], NOW), false, "ENTRADA nunca es lista");
  assert.equal(b.esOrdenEstancada(ORDENES[21], NOW), false, "45 días = legacy, fuera de la ventana");
  assert.equal(b.estaPospuesto(ORDENES[25], NOW), true, "snooze con fecha futura pospone");
  assert.equal(b.estaPospuesto(ORDENES[26], NOW), false, "snooze vencido ya no");
});

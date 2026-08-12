// Ejecutor del plan de transición (informe tracking 2026-08-12, P1): al
// confirmarse la entrega, qué unidades del origen se reclaman y con qué
// entrante se parea cada reemplazo. El pareo es lo que produce el linaje
// `reemplaza_a` vía onMapeoWrite — que hasta hoy estaba en 0 en toda la base.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { decidirSalientes } = require("../src/lib/transicionPlanExec");

const u = (serial, modelo, extra = {}) => ({
  id: serial, serial, serial_norm: serial,
  modelo_id: null, modelo_label: modelo,
  estado: "en_cliente", propiedad: "cecomunica", ...extra,
});
const planSerial = (unidades) => ({ nivel: "serial", unidades });

test("sin plan → comportamiento clásico: todo el alquiler se reclama, sin pareo", () => {
  const r = decidirSalientes(null, [u("A1", "P50"), u("A2", "P50")], [u("N1", "T338")]);
  assert.equal(r.reclamar.length, 2);
  assert.ok(r.reclamar.every((x) => x.entrante === null));
  assert.equal(r.continuan.length, 0);
});

test("plan por cantidades → también clásico (los que continúan ya se movieron por reasignación)", () => {
  const plan = { nivel: "cantidad", por_modelo: [{ modelo: "P50", continuan: 6, devuelven: 4, reemplazan: 0, total: 10 }] };
  const r = decidirSalientes(plan, [u("A1", "P50")], []);
  assert.equal(r.reclamar.length, 1);
});

test("propiedad del cliente NUNCA se reclama, con o sin plan", () => {
  const propio = u("P1", "P50", { propiedad: "cliente" });
  assert.equal(decidirSalientes(null, [propio], []).reclamar.length, 0);
  const plan = planSerial([{ serial: "P1", serial_norm: "P1", destino: "devuelve" }]);
  assert.equal(decidirSalientes(plan, [propio], []).reclamar.length, 0);
});

test("'continua' no se reclama aunque siga asignada al origen", () => {
  const plan = planSerial([
    { serial: "A1", serial_norm: "A1", destino: "continua" },
    { serial: "A2", serial_norm: "A2", destino: "devuelve" },
  ]);
  const r = decidirSalientes(plan, [u("A1", "P50"), u("A2", "P50")], []);
  assert.equal(r.reclamar.length, 1);
  assert.equal(r.reclamar[0].unidad.serial, "A2");
  assert.equal(r.continuan.length, 1);
  assert.equal(r.continuan[0].serial, "A1");
});

test("'reemplaza' se parea con un entrante del MISMO modelo, FIFO y sin repetir", () => {
  const plan = planSerial([
    { serial: "A1", serial_norm: "A1", destino: "reemplaza" },
    { serial: "A2", serial_norm: "A2", destino: "reemplaza" },
  ]);
  const entrantes = [u("N2", "T338"), u("N1", "T338"), u("X1", "NX-420")];
  const r = decidirSalientes(plan, [u("A1", "T338"), u("A2", "T338")], entrantes);
  const porSaliente = new Map(r.reclamar.map((x) => [x.unidad.serial, x.entrante?.serial || null]));
  assert.equal(porSaliente.get("A1"), "N1"); // orden estable por serial
  assert.equal(porSaliente.get("A2"), "N2");
});

test("reemplazo sin entrante disponible queda sin sustituto (se devuelve igual)", () => {
  const plan = planSerial([{ serial: "A1", serial_norm: "A1", destino: "reemplaza" }]);
  const r = decidirSalientes(plan, [u("A1", "P50")], [u("N1", "T338")]);
  // El entrante es de otro modelo… pero P50 vs T338 sin modelo_id: labels
  // distintos sin contención → no parea.
  assert.equal(r.reclamar.length, 1);
  assert.equal(r.reclamar[0].entrante, null);
});

test("el pareo tolera el sufijo -R y la marca en el texto", () => {
  const plan = planSerial([{ serial: "A1", serial_norm: "A1", destino: "reemplaza" }]);
  const r = decidirSalientes(plan, [u("A1", "HYTERA PNC360S")], [u("N1", "PNC360S-R")]);
  assert.equal(r.reclamar[0].entrante.serial, "N1");
});

test("unidad del origen FUERA del plan → se devuelve (la regla de fondo no cambia)", () => {
  const plan = planSerial([{ serial: "A1", serial_norm: "A1", destino: "continua" }]);
  const r = decidirSalientes(plan, [u("A1", "P50"), u("Z9", "P50")], []);
  assert.equal(r.reclamar.length, 1);
  assert.equal(r.reclamar[0].unidad.serial, "Z9");
});

test("serial del plan normalizado: 'a-1' matchea 'A1'", () => {
  const plan = planSerial([{ serial: "a-1", serial_norm: "", destino: "continua" }]);
  const r = decidirSalientes(plan, [u("A1", "P50")], []);
  assert.equal(r.continuan.length, 1);
});

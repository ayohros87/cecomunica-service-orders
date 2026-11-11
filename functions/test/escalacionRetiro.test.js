// Escalación semanal "sin retirar" (lib/escalacionRetiro): qué entra, qué no, y
// qué dice el correo. Sin Firestore.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const RET = require("../src/lib/escalacionRetiro");

const NOW = new Date("2026-11-30T12:00:00Z");
const hace = (d) => new Date(NOW.getTime() - d * 864e5).toISOString();
const lista = (extra) => Object.assign({
  estado_reparacion: "COMPLETADO (EN OFICINA)", tipo_de_servicio: "REPARACIÓN",
  qc_requerido: true, qc: { resultado: "aprobado", equipos_n: 1 }, equipos: [{ id: "e1", numero_de_serie: "A1" }],
  fecha_completado: hace(20), cliente_nombre: "ACME",
}, extra || {});

test("leerConfig: defaults, umbral, fecha de arranque y lista extra (array o string)", () => {
  assert.deepEqual(RET.leerConfig({}), { dias: 15, desde: null, extra: "" });
  const c = RET.leerConfig({ retiro_escalacion_dias: "20", retiro_escalacion_desde: "2026-11-11", email_retiro_escalacion: ["a@x.com", "b@x.com"] });
  assert.equal(c.dias, 20);
  assert.equal(c.desde.toISOString().slice(0, 10), "2026-11-11");
  assert.equal(c.extra, "a@x.com,b@x.com");
  assert.equal(RET.leerConfig({ retiro_escalacion_dias: 0, email_retiro_escalacion: " c@x.com " }).extra, "c@x.com");
  assert.equal(RET.leerConfig({ retiro_escalacion_dias: 0 }).dias, 15);
});

test("esEscalable: edad, arranque, posponer y tipos que no se entregan", () => {
  const cfg = { dias: 15, desde: new Date("2026-11-01T00:00:00Z") };
  assert.equal(RET.esEscalable(lista(), NOW, cfg), true);
  assert.equal(RET.esEscalable(lista({ fecha_completado: hace(10) }), NOW, cfg), false, "aún no cumple los días");
  assert.equal(RET.esEscalable(lista({ fecha_completado: hace(40) }), NOW, cfg), false, "completada antes del arranque");
  assert.equal(RET.esEscalable(lista({ fecha_completado: hace(40) }), NOW, { dias: 15, desde: null }), true, "sin arranque: entra");
  assert.equal(RET.esEscalable(lista({ pendiente_snooze: { hasta: hace(-5) } }), NOW, cfg), false, "pospuesta");
  assert.equal(RET.esEscalable(lista({ tipo_de_servicio: "ENTRADA" }), NOW, cfg), false);
  assert.equal(RET.esEscalable(lista({ qc: { resultado: "rechazado", equipos_n: 1 } }), NOW, cfg), false, "QC pendiente es cola del taller");
  assert.equal(RET.esEscalable(lista({ estado_reparacion: "ENTREGADO AL CLIENTE" }), NOW, cfg), false);
});

test("esDiaDeEnvio: lunes en Panamá", () => {
  assert.equal(RET.esDiaDeEnvio(new Date("2026-11-16T12:15:00Z")), true);   // lunes 07:15 Panamá
  assert.equal(RET.esDiaDeEnvio(new Date("2026-11-17T12:15:00Z")), false);
  // Domingo 23:30 Panamá (lunes 04:30 UTC): sigue siendo domingo allá.
  assert.equal(RET.esDiaDeEnvio(new Date("2026-11-16T04:30:00Z")), false);
});

test("fila + armarCorreo: vendedor, días, nota impresa y seguimiento en la tabla", () => {
  const f1 = RET.fila("2026110101", lista({
    vendedor_asignado: "uidV", nota_entrega_impresa: { at: hace(3) },
    seguimiento_retiro: { nota: "Pasa el <viernes>", por_email: "karla@x.com", at: hace(1) },
  }), NOW);
  f1.vendedor = "Karla";
  const f2 = RET.fila("2026110202", lista({ fecha_completado: hace(16), cliente_nombre: "BETA" }), NOW);
  assert.equal(f1.dias, 20);
  assert.equal(f1.vendedor_uid, "uidV");
  assert.equal(f2.seguimiento, "");
  const m = RET.armarCorreo([f2, f1], 15, "https://app");
  assert.equal(m.subject, "Sin retirar: 2 orden(es) listas hace 15+ días");
  assert.ok(m.bodyContent.indexOf("2026110101") < m.bodyContent.indexOf("2026110202"), "la más vieja primero");
  assert.match(m.bodyContent, /Karla/);
  assert.match(m.bodyContent, /Pasa el &lt;viernes&gt;/, "la nota va escapada");
  assert.match(m.bodyContent, /karla /, "quién anotó");
  assert.match(m.bodyContent, /<b>sí<\/b>/, "nota impresa");
  assert.match(m.bodyContent, /sin nota/);
  assert.equal(m.ctaUrl, "https://app/ordenes/index.html?ids=" + encodeURIComponent("2026110101,2026110202"));
});

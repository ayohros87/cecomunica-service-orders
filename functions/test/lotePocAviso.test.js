// Aviso "Lote PoC por cargar" a recepción (2026-11-25, Brenda): la línea
// "Contrato" del correo sale de los contratos y gestiones del cliente que
// siguen en trámite. Lo que protegen estas pruebas:
//
//   A1 — Contrato en trámite = pendiente de aprobación, o aprobado con
//        circuito de seriales vivo y sin entrega. El histórico 'aprobado'
//        (legacy / sin circuito), lo entregado, lo activo y lo borrado no.
//   A2 — Gestión en trámite = estado abierto y no dormida.
//   A3 — Contratos primero, más recientes primero; tope de 4.
//   A4 — Sin trámites, el correo lo dice (la programación llegó antes que
//        el contrato).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contratoEnTramite, gestionEnTramite, tramitesDelCliente, lineaContrato } = require("../src/domain/lotePocAviso");

test("A1 — qué contrato cuenta como en trámite", () => {
  assert.equal(contratoEnTramite({ estado: "pendiente_aprobacion" }), true);
  assert.equal(contratoEnTramite({ estado: "aprobado", seriales_estado: "pendiente" }), true);
  assert.equal(contratoEnTramite({ estado: "aprobado", seriales_estado: "asignados", firmado: true }), true);
  assert.equal(contratoEnTramite({ estado: "aprobado", seriales_estado: "asignados", entrega_confirmada: true }), false);
  assert.equal(contratoEnTramite({ estado: "aprobado", seriales_estado: "legacy" }), false);
  assert.equal(contratoEnTramite({ estado: "aprobado" }), false);
  assert.equal(contratoEnTramite({ estado: "activo", seriales_estado: "pendiente" }), false);
  assert.equal(contratoEnTramite({ estado: "pendiente_aprobacion", deleted: true }), false);
  assert.equal(contratoEnTramite(null), false);
});

test("A2 — qué gestión cuenta como en trámite", () => {
  assert.equal(gestionEnTramite({ estado: "pendiente_bodega" }), true);
  assert.equal(gestionEnTramite({ estado: "pendiente_firma" }), true);
  assert.equal(gestionEnTramite({ estado: "pendiente_firma", dormido: true }), false);
  assert.equal(gestionEnTramite({ estado: "cerrada" }), false);
  assert.equal(gestionEnTramite({ estado: "anulada" }), false);
});

test("A3 — orden y tope", () => {
  const t = (n) => ({ toMillis: () => n });
  const contratos = [
    { id: "a", contrato_id: "ALQ20261101-01", estado: "pendiente_aprobacion", fecha_creacion: t(1) },
    { id: "b", contrato_id: "SERV20261120-02", estado: "aprobado", seriales_estado: "pendiente", fecha_creacion: t(5) },
    { id: "c", contrato_id: "ALQ20250101-01", estado: "activo", fecha_creacion: t(9) },
  ];
  const gestiones = [
    { id: "GA20261124-01", tipo: "aumento", estado: "pendiente_bodega", contrato_id: "ALQ20251211-03", creado_at: t(3) },
    { id: "GR20261001-01", tipo: "reemplazo", estado: "cerrada", creado_at: t(4) },
  ];
  const r = tramitesDelCliente(contratos, gestiones);
  assert.deepEqual(r.map(x => x.codigo), ["SERV20261120-02", "ALQ20261101-01", "GA20261124-01"]);
  assert.equal(r[0].detalle, "contrato aprobado, por entregar");
  assert.equal(r[2].detalle, "aumento de equipos del contrato ALQ20251211-03");
  const muchos = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, estado: "pendiente_aprobacion" }));
  assert.equal(tramitesDelCliente(muchos, []).length, 4);
});

test("A4 — línea del correo", () => {
  assert.equal(lineaContrato([]), "Sin contrato ni gestión en trámite todavía");
  assert.equal(lineaContrato([{ codigo: "ALQ1", detalle: "contrato pendiente de aprobación" }]), "ALQ1 (contrato pendiente de aprobación)");
});

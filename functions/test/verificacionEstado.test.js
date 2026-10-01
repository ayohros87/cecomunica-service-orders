// Verificación pública (QR) — qué estado debe decir el espejo verificaciones/
// y qué parche lo cuadra con el contrato (auditoría de módulos 2026-09-30,
// Contratos R1 + B2). Corre con `npm test` (node --test), sin red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { estadoEsperado, patchVerificacion } = require("../src/domain/verificacionEstado");

const AHORA = "__ts__";

test("un contrato anulado se certifica como anulado aunque la verificación diga aprobado", () => {
  assert.equal(estadoEsperado({ estado: "anulado" }), "anulado");
  const p = patchVerificacion({ verificacion: { estado: "aprobado", contrato_id: "ALQ20260618-04" },
    contrato: { estado: "anulado", contrato_id: "ALQ20260618-04", anulado_fecha: "F" }, docId: "doc1", ahora: AHORA });
  assert.equal(p.estado, "anulado");
  assert.equal(p.anulado_fecha, "F");
  assert.equal(p.estado_actualizado_at, AHORA);
});

test("activo vencido por fecha → vencido (el cron conserva estado activo)", () => {
  assert.equal(estadoEsperado({ estado: "activo", vencimiento_estado: "vencido" }), "vencido");
  assert.equal(estadoEsperado({ estado: "aprobado", vencimiento_estado: "vencido" }), "vencido");
  assert.equal(estadoEsperado({ estado: "activo", vencimiento_estado: "por_vencer" }), "activo");
  const p = patchVerificacion({ verificacion: { estado: "activo" },
    contrato: { estado: "activo", vencimiento_estado: "vencido", fecha_vencimiento: "FV" }, docId: "d", ahora: AHORA });
  assert.equal(p.estado, "vencido");
  assert.equal(p.vencido_fecha, "FV");
});

test("un anulado que ya tenía vencimiento_estado=vencido sigue siendo anulado", () => {
  assert.equal(estadoEsperado({ estado: "anulado", vencimiento_estado: "vencido" }), "anulado");
});

test("contrato borrado (soft) → inactivo: la página dice 'no vigente'", () => {
  assert.equal(estadoEsperado({ estado: "activo", deleted: true }), "inactivo");
});

test("si ya cuadra no hay parche (idempotente)", () => {
  const p = patchVerificacion({ verificacion: { estado: "activo", contrato_id: "SERV20260930-01", contrato_doc_id: "d" },
    contrato: { estado: "activo", contrato_id: "SERV20260930-01" }, docId: "d", ahora: AHORA });
  assert.equal(p, null);
});

test("B2: el número de contrato reemplaza al ID interno y se guarda el docId aparte", () => {
  const p = patchVerificacion({ verificacion: { estado: "activo", contrato_id: "0tvyC3iqszzPIVmJQFTv" },
    contrato: { estado: "activo", contrato_id: "ALQ20260902-01" }, docId: "0tvyC3iqszzPIVmJQFTv", ahora: AHORA });
  assert.deepEqual(p, { contrato_id: "ALQ20260902-01", contrato_doc_id: "0tvyC3iqszzPIVmJQFTv" });
});

test("sin número en el contrato no se inventa: solo el docId", () => {
  const p = patchVerificacion({ verificacion: { estado: "activo", contrato_id: "d" },
    contrato: { estado: "activo" }, docId: "d", ahora: AHORA });
  assert.deepEqual(p, { contrato_doc_id: "d" });
});

test("no pisa una fecha de anulación ya escrita", () => {
  const p = patchVerificacion({ verificacion: { estado: "aprobado", anulado_fecha: "VIEJA", contrato_doc_id: "d", contrato_id: "X" },
    contrato: { estado: "anulado", contrato_id: "X", anulado_fecha: "NUEVA" }, docId: "d", ahora: AHORA });
  assert.equal(p.estado, "anulado");
  assert.equal(p.anulado_fecha, undefined);
});

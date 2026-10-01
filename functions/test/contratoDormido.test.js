// Contrato dormido: aprobado sin firmar a los 45 días (decisión 7 de Alberto,
// 1-oct-2026). Corre con `npm test` (node --test), sin red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const D = require("../src/domain/contratoDormido");

const HOY = new Date("2026-10-01T12:00:00Z");
const hace = (dias) => new Date(HOY.getTime() - dias * 86400000);
const base = { estado: "aprobado", seriales_estado: "asignados", tipo_contrato: "Servicio", codigo_tipo: "SERV" };

test("aprobado con seriales, 50 días sin firma → se duerme", () => {
  const r = D.decidirDormir({ contrato: { ...base, fecha_aprobacion: hace(50) }, now: HOY });
  assert.equal(r.dormir, true);
  assert.equal(r.dias, 50);
});

test("a los 44 días todavía no; a los 45 sí", () => {
  assert.equal(D.decidirDormir({ contrato: { ...base, fecha_aprobacion: hace(44) }, now: HOY }).dormir, false);
  assert.equal(D.decidirDormir({ contrato: { ...base, fecha_aprobacion: hace(45) }, now: HOY }).dormir, true);
});

test("el reloj corre desde lo ÚLTIMO que acercó el contrato a la firma", () => {
  // Seriales de hace 50 días pero enlace enviado hace 5: no está abandonado.
  const c = { ...base, fecha_aprobacion: hace(60), seriales_asignados_at: hace(50), firma_solicitud_creada_at: hace(5) };
  assert.equal(D.decidirDormir({ contrato: c, now: HOY }).dormir, false);
  // La solicitud vieja (sin firma_solicitud_creada_at en el contrato) también cuenta.
  const c2 = { ...base, fecha_aprobacion: hace(60), seriales_asignados_at: hace(50) };
  assert.equal(D.decidirDormir({ contrato: c2, solicitud: { created_at: hace(3) }, now: HOY }).dormir, false);
  // Una reactivación reciente reinicia la espera.
  const c3 = { ...base, fecha_aprobacion: hace(90), seriales_asignados_at: hace(80), dormido_reactivado_at: hace(2) };
  assert.equal(D.decidirDormir({ contrato: c3, now: HOY }).dormir, false);
});

test("no se duermen: legacy, sin seriales, REEMP/DEMO, firmados, entregados, borrados, ya dormidos, activos", () => {
  const viejo = { fecha_aprobacion: hace(200) };
  for (const c of [
    { ...base, ...viejo, seriales_estado: "legacy" },
    { ...base, ...viejo, seriales_estado: "pendiente" },
    { ...base, ...viejo, tipo_contrato: "Reemplazo", codigo_tipo: "REEMP" },
    { ...base, ...viejo, tipo_contrato: "Demo", codigo_tipo: "DEMO" },
    { ...base, ...viejo, firmado: true },
    { ...base, ...viejo, entrega_confirmada: true },
    { ...base, ...viejo, deleted: true },
    { ...base, ...viejo, dormido: true },
    { ...base, ...viejo, estado: "activo" },
  ]) {
    assert.equal(D.decidirDormir({ contrato: c, now: HOY }).dormir, false, JSON.stringify(c));
  }
});

test("el parche marca dormido y caduca el enlace del contrato solo si lo tenía", () => {
  const con = D.patchDormir({ contrato: { firma_solicitud_estado: "pendiente" }, dias: 50, ahora: "__ts__" });
  assert.equal(con.dormido, true);
  assert.equal(con.dormido_motivo, "sin_firma_45d");
  assert.equal(con.dormido_dias, 50);
  assert.equal(con.firma_solicitud_estado, "caducado");
  const sin = D.patchDormir({ contrato: {}, dias: 50, ahora: "__ts__" });
  assert.equal(sin.firma_solicitud_estado, undefined);
  assert.deepEqual(D.patchCaducarSolicitud("__ts__"), { estado: "caducado", caducado_at: "__ts__", caducado_motivo: "sin_firma_45d" });
});

test("reactivar apaga la marca y deja rastro de quién y cuándo", () => {
  const p = D.patchReactivar({ ahora: "__ts__", uid: "u1" });
  assert.equal(p.dormido, false);
  assert.equal(p.dormido_reactivado_por_uid, "u1");
  assert.equal(p.dormido_reactivado_at, "__ts__");
});

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

test("el reloj corre desde la APROBACIÓN: seriales y enlace posteriores no lo reinician", () => {
  // Alberto, 2-oct-2026. Antes (9c93b13) un enlace reenviado reiniciaba la cuenta.
  const c = { ...base, fecha_aprobacion: hace(60), seriales_asignados_at: hace(50), firma_solicitud_creada_at: hace(5) };
  const r = D.decidirDormir({ contrato: c, now: HOY });
  assert.equal(r.dormir, true);
  assert.equal(r.dias, 60);
  assert.equal(D.decidirDormir({ contrato: { ...base, fecha_aprobacion: hace(30), seriales_asignados_at: hace(1) }, now: HOY }).dias, 30);
});

test("la reactivación es la nueva fecha base: no se vuelve a dormir al día siguiente", () => {
  const c = { ...base, fecha_aprobacion: hace(90), seriales_asignados_at: hace(80), dormido_reactivado_at: hace(2) };
  assert.equal(D.decidirDormir({ contrato: c, now: HOY }).dormir, false);
  assert.equal(D.diasEsperando(c, HOY), 2);
  // A los 45 días de reactivado, sin firma, vuelve a dormirse.
  assert.equal(D.decidirDormir({ contrato: { ...c, dormido_reactivado_at: hace(45) }, now: HOY }).dormir, true);
});

test("sin fecha de aprobación (histórico) cuenta desde la creación", () => {
  assert.equal(D.diasEsperando({ ...base, fecha_creacion: hace(70) }, HOY), 70);
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

// ── Anexos de aumento (Alberto, 2-oct-2026) ──
const anexo = { tipo: "aumento", estado: "pendiente_firma", aumento: { lineas: [{ modelo: "NX-1300", cantidad: 1 }] } };

test("anexo de aumento: a los 45 días de su aprobación sin firma se duerme", () => {
  assert.equal(D.decidirDormirAnexo({ gestion: { ...anexo, aprobacion: { at: hace(44) } }, now: HOY }).dormir, false);
  const r = D.decidirDormirAnexo({ gestion: { ...anexo, fecha_solicitud: hace(60), aprobacion: { at: hace(45) } }, now: HOY });
  assert.equal(r.dormir, true);
  assert.equal(r.dias, 45);
  // Sin aprobación registrada, desde la solicitud.
  assert.equal(D.diasEsperandoAnexo({ ...anexo, fecha_solicitud: hace(50) }, HOY), 50);
});

test("anexo reactivado: la reactivación reinicia los 45 días", () => {
  const g = { ...anexo, aprobacion: { at: hace(100) }, dormido_reactivado_at: hace(10) };
  assert.equal(D.decidirDormirAnexo({ gestion: g, now: HOY }).dormir, false);
  assert.equal(D.diasEsperandoAnexo(g, HOY), 10);
});

test("no se duermen: regularización, ya firmado, validando firmante, otro estado u otro tipo, borrado, ya dormido", () => {
  const viejo = { aprobacion: { at: hace(200) } };
  for (const g of [
    { ...anexo, ...viejo, aumento: { es_regularizacion: true } },
    { ...anexo, ...viejo, cierre: { firma: true } },
    { ...anexo, ...viejo, firma_pendiente_validacion: true },
    { ...anexo, ...viejo, estado: "pendiente_bodega" },
    { ...anexo, ...viejo, estado: "pendiente_aprobacion" },
    { ...anexo, ...viejo, tipo: "reemplazo" },
    { ...anexo, ...viejo, deleted: true },
    { ...anexo, ...viejo, dormido: true },
  ]) {
    assert.equal(D.decidirDormirAnexo({ gestion: g, now: HOY }).dormir, false, JSON.stringify(g));
  }
  // El ajuste de tarifa sí se firma: sí se duerme.
  assert.equal(D.decidirDormirAnexo({ gestion: { ...anexo, ...viejo, aumento: { es_ajuste: true } }, now: HOY }).dormir, true);
});

test("el parche del anexo solo marca (el estado no cambia) y caduca el enlace si lo tenía", () => {
  const con = D.patchDormirAnexo({ gestion: { firma_solicitud_estado: "pendiente" }, dias: 46, ahora: "__ts__" });
  assert.deepEqual(con, { dormido: true, dormido_at: "__ts__", dormido_motivo: "sin_firma_45d", dormido_dias: 46, firma_solicitud_estado: "caducado" });
  assert.equal(D.patchDormirAnexo({ gestion: {}, dias: 46, ahora: "__ts__" }).firma_solicitud_estado, undefined);
  // Todo lo que escriben dormir/reactivar es eco para onGestionWrite.
  for (const k of [...Object.keys(con), ...Object.keys(D.patchReactivar({ ahora: 1, uid: "u", esGestion: true }))]) {
    assert.ok(D.CAMPOS_GESTION.includes(k), k);
  }
  assert.equal("fecha_modificacion" in D.patchReactivar({ ahora: 1, uid: "u", esGestion: true }), false);
});

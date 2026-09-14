// Cierre de contrato — cuándo un TEMP/DEMO muere solo al volver el equipo.
//
// Caso que lo originó (FANLYC / TEMP20260902-01, 2026-09-14): la ENTRADA
// 2026090810 devolvió los 12 radios del temporal y el contrato quedó 'activo',
// pidiendo en el home una cancelación que ninguna pantalla sabía hacer.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { decidirCierreTrasEntrada, buildCierre, terminaPorDevolucion } = require("../src/domain/cierreContrato");

// FieldValue de mentira: solo hace falta que las marcas sean distinguibles.
const FV = { serverTimestamp: () => "__ts__", delete: () => "__del__" };

test("TEMP sin nada en campo → se cierra solo", () => {
  const r = decidirCierreTrasEntrada({
    contrato: { estado: "activo", codigo_tipo: "TEMP" },
    unidadesEnCampo: 0,
  });
  assert.equal(r.cerrar, true);
  assert.equal(r.marcar, false);
  assert.equal(r.motivo, "devuelto_completo");
});

test("DEMO sin nada en campo → se cierra solo (mismo trato que el TEMP)", () => {
  const r = decidirCierreTrasEntrada({
    contrato: { estado: "aprobado", contrato_id: "DEMO20260203-01" },
    unidadesEnCampo: 0,
  });
  assert.equal(r.cerrar, true);
});

test("TEMP con radios todavía en campo → NO se cierra, se marca", () => {
  const r = decidirCierreTrasEntrada({
    contrato: { estado: "activo", codigo_tipo: "TEMP" },
    unidadesEnCampo: 3,
  });
  assert.equal(r.cerrar, false);
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "quedan_en_campo");
});

test("ALQ vacío → NUNCA se cierra solo: puede ser renovación o terminación", () => {
  const r = decidirCierreTrasEntrada({
    contrato: { estado: "activo", codigo_tipo: "ALQ" },
    unidadesEnCampo: 0,
  });
  assert.equal(r.cerrar, false);
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "tipo_con_vigencia");
});

test("conteo desconocido → en la duda NO se cierra (cortar la facturación es peor)", () => {
  const r = decidirCierreTrasEntrada({
    contrato: { estado: "activo", codigo_tipo: "TEMP" },
    unidadesEnCampo: null,
  });
  assert.equal(r.cerrar, false);
  assert.equal(r.marcar, true);
  assert.equal(r.motivo, "conteo_desconocido");
});

test("contrato ya cerrado → ni se cierra ni se marca", () => {
  const r = decidirCierreTrasEntrada({
    contrato: { estado: "vencido", codigo_tipo: "TEMP" },
    unidadesEnCampo: 0,
  });
  assert.equal(r.cerrar, false);
  assert.equal(r.marcar, false);
});

test("el tipo se infiere del contrato_id cuando no hay codigo_tipo (histórico)", () => {
  assert.equal(terminaPorDevolucion({ contrato_id: "TEMP20260902-01" }), true);
  assert.equal(terminaPorDevolucion({ contrato_id: "ALQ20260226-01" }), false);
  assert.equal(terminaPorDevolucion({ tipo_contrato: "Demo" }), true);
});

test("buildCierre: terminal 'vencido', retira la marca y guarda de dónde venía", () => {
  const u = buildCierre({ estado: "activo" }, { motivo: "equipo devuelto", por_uid: "u1", FieldValue: FV });
  assert.equal(u.estado, "vencido");
  assert.equal(u.estado_previo, "activo");
  assert.equal(u.vencido_motivo, "equipo devuelto");
  assert.equal(u.vencido_por_uid, "u1");
  assert.equal(u.cancelacion_pendiente, "__del__");
  assert.equal(u.fecha_fin, "__ts__");
});

// ── Cliente desactivado → sus contratos vigentes se cierran ─────────────────
// Regla de Alberto (2026-09-14): desactivar es el acto que declara terminada
// la cuenta. Hasta hoy 24 de los 96 clientes inactivos tenían contrato vigente
// y/o radios en campo, invisibles en el Centro (el toggle "Solo activos" viene
// encendido) pero contando para vencimientos, comisiones y pendientes.
const { esDesactivacion } = require("../src/domain/cierreContrato");

test("desactivación: solo el cruce true → false", () => {
  assert.equal(esDesactivacion({ activo: true }, { activo: false }), true);
  // Sin el campo cuenta como activo (el backfill de 2026-09-09 los puso todos).
  assert.equal(esDesactivacion({}, { activo: false }), true);
  // Ya estaba inactivo y se vuelve a guardar: no re-dispara.
  assert.equal(esDesactivacion({ activo: false }, { activo: false }), false);
  // Reactivar no resucita nada.
  assert.equal(esDesactivacion({ activo: false }, { activo: true }), false);
  // Otros campos del cliente no disparan el cierre de contratos.
  assert.equal(esDesactivacion({ activo: true, ruc: "1" }, { activo: true, ruc: "2" }), false);
  // Un cliente borrado ya no cierra nada (el borrado tiene su propio camino).
  assert.equal(esDesactivacion({ activo: true }, { activo: false, deleted: true }), false);
});

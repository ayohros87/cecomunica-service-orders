// Anexo dormido: qué pasa con los equipos que aparta (Alberto, 5-oct-2026).
// Corre con `npm test` (node --test), sin red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const A = require("../src/domain/anexoDormido");
const D = require("../src/domain/contratoDormido");

const DORMIDO_AT = new Date("2026-10-05T10:45:00Z");
const dia = (n) => new Date(DORMIDO_AT.getTime() + n * 86400000);
const base = {
  tipo: "aumento", estado: "pendiente_firma", dormido: true, dormido_at: DORMIDO_AT,
  responsable_uid: "vend1", ordenes: { programacion_id: "OS1", programacion_ids: ["OS1"] },
  aumento: { seriales_asignados: [{ serial: "A1" }] },
};
const osLibre = { id: "OS1", data: { estado_reparacion: "POR ASIGNAR", equipos: [{ serial: "A1" }] } };

test("el plazo es dormido_at + 15 días; la retención lo reemplaza", () => {
  assert.equal(A.plazoSoltar(base).getTime(), dia(15).getTime());
  assert.equal(A.plazoSoltar({ ...base, dormido_retener_hasta: dia(45) }).getTime(), dia(45).getTime());
  assert.equal(A.plazoSoltar({ ...base, dormido: false }), null, "reactivado: el plazo deja de correr");
});

test("retener suma 30 días al plazo vigente (o a hoy, si ya pasó)", () => {
  assert.equal(A.retenerHasta(base, dia(3)).getTime(), dia(45).getTime());
  assert.equal(A.retenerHasta({ ...base, dormido_retener_hasta: dia(45) }, dia(40)).getTime(), dia(75).getTime());
  assert.equal(A.retenerHasta(base, dia(20)).getTime(), dia(50).getTime());
});

test("primera retención: vendedor, gerencia o admin; la segunda solo admin", () => {
  for (const rol of ["vendedor", "gerente", "administrador"]) assert.equal(A.puedeRetener(base, rol).ok, true, rol);
  assert.equal(A.puedeRetener(base, "inventario").ok, false);
  const una = { ...base, dormido_retencion: { n: 1 } };
  assert.equal(A.puedeRetener(una, "vendedor").ok, false);
  assert.equal(A.puedeRetener(una, "gerente").ok, false);
  assert.equal(A.puedeRetener(una, "administrador").ok, true);
  assert.equal(A.puedeRetener({ ...base, dormido_bodega: { ordenes: ["OS1"] } }, "administrador").ok, false);
});

test("soltar: vendedor responsable, admin, gerencia; bodega solo cuando le toca", () => {
  assert.equal(A.puedeSoltar(base, "vendedor", "vend1").ok, true);
  assert.equal(A.puedeSoltar(base, "vendedor", "otro").ok, false);
  assert.equal(A.puedeSoltar(base, "gerente", "x").ok, true);
  assert.equal(A.puedeSoltar(base, "inventario", "x").ok, false);
  assert.equal(A.puedeSoltar({ ...base, dormido_bodega: { ordenes: ["OS1"] } }, "inventario", "x").ok, true);
  assert.equal(A.puedeSoltar({ ...base, dormido: false }, "administrador", "x").ok, false);
});

test("orden trabajada: cualquier rastro del taller cuenta", () => {
  assert.equal(A.ordenTrabajada(osLibre.data), false);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "ASIGNADO" }), true);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "POR ASIGNAR", tecnico_asignado: "Marcos" }), true);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "POR ASIGNAR", qc: { estado: "pendiente" } }), true);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "POR ASIGNAR", equipos: [{ serial: "A1", trabajo_tecnico: "programado" }] }), true);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "POR ASIGNAR", equipos: [{ serial: "A1", consumos: [{ pieza: "x" }] }] }), true);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "POR ASIGNAR", equipos: [{ serial: "A1", trabajo_tecnico: "x", eliminado: true }] }), false);
  assert.equal(A.ordenTrabajada({ estado_reparacion: "COMPLETADO (EN OFICINA)", eliminado: true }), false, "eliminada no cuenta");
});

test("día 9: nada; día 10: aviso; ya avisado: nada", () => {
  assert.equal(A.decidir({ gestion: base, now: dia(9) }).accion, "nada");
  assert.equal(A.decidir({ gestion: base, now: dia(10) }).accion, "aviso_10");
  assert.equal(A.decidir({ gestion: { ...base, dormido_aviso_10_at: dia(10) }, now: dia(11) }).accion, "nada");
  assert.equal(A.decidir({ gestion: { ...base, dormido_retencion: { n: 1 }, dormido_retener_hasta: dia(45) }, now: dia(11) }).accion,
    "nada", "retenido: el aviso de los 10 días sobra");
});

test("un día antes de soltarse: aviso previo, una vez por plazo", () => {
  const g = { ...base, dormido_aviso_10_at: dia(10) };
  const r = A.decidir({ gestion: g, now: dia(14) });
  assert.equal(r.accion, "aviso_previo");
  const p = A.patchAviso({ accion: r.accion, ahora: "TS", plazo: r.plazo });
  assert.equal(p.dormido_aviso_previo_para, A.diaPanama(dia(15)));
  assert.equal(A.decidir({ gestion: { ...g, ...p }, now: dia(14.5) }).accion, "nada");
  // Retenido: el previo vuelve a tocar antes del fin de la retención.
  const ret = { ...g, ...p, dormido_retencion: { n: 1 }, dormido_retener_hasta: dia(45) };
  assert.equal(A.decidir({ gestion: ret, now: dia(30) }).accion, "nada");
  assert.equal(A.decidir({ gestion: ret, now: dia(44) }).accion, "aviso_previo");
});

test("vencido sin orden trabajada → soltar (anula con motivo)", () => {
  const r = A.decidir({ gestion: base, ordenes: [osLibre], now: dia(15) });
  assert.equal(r.accion, "soltar");
  const p = A.patchSoltarAuto({ ahora: "TS", porQue: r.porQue });
  assert.equal(p.estado, "anulada");
  assert.equal(p.anulada_motivo, A.MOTIVO_AUTO);
  assert.equal(p.anulada_por_uid, "system");
  assert.equal(p.dormido_soltado.modo, "auto");
  // Sin orden (los seriales nunca se completaron) también se suelta.
  assert.equal(A.decidir({ gestion: { ...base, ordenes: {} }, ordenes: [], now: dia(16) }).accion, "soltar");
});

test("vencido CON orden trabajada → bodega decide; después el cron no insiste", () => {
  const os = { id: "OS1", data: { estado_reparacion: "COMPLETADO (EN OFICINA)", tecnico_asignado: "Ovidio" } };
  const r = A.decidir({ gestion: base, ordenes: [os], now: dia(16) });
  assert.equal(r.accion, "bodega");
  assert.deepEqual(r.trabajadas, ["OS1"]);
  const g = { ...base, ...A.patchBodega({ ahora: "TS", trabajadas: r.trabajadas, porQue: r.porQue }) };
  assert.equal(A.esperaBodega(g), true);
  assert.equal(A.decidir({ gestion: g, ordenes: [os], now: dia(40) }).accion, "nada");
});

test("retención vigente: no se suelta al día 15; sí al vencer la retención", () => {
  const g = { ...base, dormido_retencion: { n: 1 }, dormido_retener_hasta: dia(45) };
  assert.equal(A.decidir({ gestion: g, ordenes: [osLibre], now: dia(16) }).accion, "nada");
  const r = A.decidir({ gestion: g, ordenes: [osLibre], now: dia(45) });
  assert.equal(r.accion, "soltar");
  assert.match(r.porQue, /retención vencida/);
});

test("reactivado, entregado o no-aumento: nada", () => {
  assert.equal(A.decidir({ gestion: { ...base, dormido: false }, now: dia(30) }).accion, "nada");
  assert.equal(A.decidir({ gestion: { ...base, cierre: { entrega: true } }, now: dia(30) }).accion, "nada");
  assert.equal(A.decidir({ gestion: { ...base, tipo: "demo" }, now: dia(30) }).accion, "nada");
  assert.equal(A.decidir({ gestion: { ...base, estado: "anulada" }, now: dia(30) }).accion, "nada");
});

test("volver a dormirse borra la retención, los avisos y la marca de bodega del ciclo anterior", () => {
  const viejo = { ...base, dormido: false, dormido_retencion: { n: 2 }, dormido_retener_hasta: dia(75),
    dormido_aviso_10_at: dia(10), dormido_bodega: { ordenes: ["OS1"] } };
  const p = D.patchDormirAnexo({ gestion: viejo, dias: 45, ahora: "TS", teniaEnlace: false, borrar: "DEL" });
  for (const k of ["dormido_retencion", "dormido_retener_hasta", "dormido_aviso_10_at", "dormido_bodega"]) assert.equal(p[k], "DEL", k);
  assert.equal("dormido_aviso_previo_para" in p, false, "lo que no estaba no se toca");
  // Los campos del ciclo son eco para onGestionWrite.
  for (const k of A.CAMPOS_ECO) assert.ok(D.CAMPOS_GESTION.includes(k), k);
  assert.equal(D.CAMPOS_GESTION.includes("dormido_soltado"), false);
});

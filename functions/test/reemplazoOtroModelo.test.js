// Reemplazo con un radio de OTRO modelo (2026-09-29, GR20260923-01 / LIGO).
//
// Dos agujeros en cadena dejaron un radio "en bodega" estando con el cliente:
//   1. El entrante viajaba con el modelo PEDIDO (PNC550-R) y no con el de su
//      ficha (PNC460-R): resolver() no lo casaba y la OS partía una ficha
//      fantasma en taller.
//   2. Al fusionar el conflicto, la ficha conservada (la real, en bodega) no
//      tomó el flujo de la fantasma (en taller, con la orden y el cliente), y
//      la entrega rebotó en silencio.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-reemplazo-otro-modelo" });
const G = require("../src/lib/gestiones");
const { flujoAHeredar } = require("../src/domain/fusionPool");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const PNC550 = "h71xBSqhTKCGX1zkOrzC";
const PNC460 = "6tdGBjLOmq567GJRTMbQ";

test("modeloEntrante: manda el modelo de la ficha del radio asignado", () => {
  const it = {
    modelo_id: PNC550, modelo: "PNC550-R",
    modelo_solicitado_id: PNC550, modelo_solicitado: "HYTERA PNC550-R",
    serial_nuevo: "23905A0437", modelo_id_nuevo: PNC460, modelo_nuevo: "HYTERA PNC460-R",
  };
  assert.deepEqual(G.modeloEntrante(it), { modelo_id: PNC460, modelo: "HYTERA PNC460-R" });
});

test("modeloEntrante: sin ficha estampada, cae al solicitado y luego al del ítem", () => {
  assert.deepEqual(G.modeloEntrante({ modelo_id: PNC550, modelo: "PNC550-R", modelo_solicitado_id: PNC460, modelo_solicitado: "PNC460" }),
    { modelo_id: PNC460, modelo: "PNC460" });
  assert.deepEqual(G.modeloEntrante({ modelo_id: PNC550, modelo: "PNC550-R" }), { modelo_id: PNC550, modelo: "PNC550-R" });
  assert.deepEqual(G.modeloEntrante({}), { modelo_id: null, modelo: "" });
});

test("ningún consumidor del entrante vuelve a leer el modelo pedido a mano", () => {
  // El patrón viejo `modelo_solicitado_id || modelo_id` para el ENTRANTE es
  // justo el bug; en el backend todo pasa por G.modeloEntrante.
  for (const f of ["src/triggers/gestiones/onGestionWrite.js", "src/triggers/gestiones/onOrdenWriteGestion.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.doesNotMatch(src, /modelo_id:\s*it\.modelo_solicitado_id\s*\|\|/, f);
  }
  // El navegador estampa el modelo de la ficha al asignar.
  assert.match(leer("public", "js", "pages", "almacen-asignar.js"), /it\.modelo_id_nuevo = u\?\.modelo_id/);
});

test("fusión: la conservada en bodega toma el flujo de la absorbida en taller (caso LIGO)", () => {
  const keeper = { estado: "en_bodega", orden_actual_id: null, asignacion: null, poc_device_id: null };
  const fantasma = {
    id: `23905A0437__${PNC550}`, estado: "en_taller", orden_actual_id: "2026092403",
    asignacion: { cliente_id: "y4v9", cliente_nombre: "TRANSPORTE LIGO, S.A.", gestion_doc_id: "GR20260923-01" },
  };
  const h = flujoAHeredar(keeper, [fantasma]);
  assert.equal(h.estado, "en_taller");
  assert.equal(h.orden_actual_id, "2026092403");
  assert.equal(h.asignacion.cliente_nombre, "TRANSPORTE LIGO, S.A.");
  assert.equal(h.de_ficha, fantasma.id);
});

test("fusión: no hereda si la conservada ya tiene ubicación real, o si la absorbida está en reposo", () => {
  const viva = { id: "x", estado: "en_cliente", asignacion: { cliente_nombre: "A" } };
  assert.equal(flujoAHeredar({ estado: "en_cliente" }, [viva]), null);
  assert.equal(flujoAHeredar({ estado: "en_taller", orden_actual_id: "1" }, [viva]), null);
  assert.equal(flujoAHeredar({ estado: "en_bodega" }, [{ id: "y", estado: "en_bodega" }]), null);
  assert.equal(flujoAHeredar({ estado: "en_bodega" }, [{ id: "z", estado: "baja" }]), null);
});

test("fusión: entre varias vivas gana la que tiene orden abierta", () => {
  const h = flujoAHeredar({ estado: "por_clasificar" }, [
    { id: "a", estado: "en_cliente", asignacion: { cliente_nombre: "A" } },
    { id: "b", estado: "en_taller", orden_actual_id: "2026092403" },
  ]);
  assert.equal(h.de_ficha, "b");
});

// ── Cambio de modelo = decisión de administración (2026-09-29) ─────────────
// "Si se hizo un contrato o una gestión con un modelo se le incluyó el precio
// de ese modelo; si luego bodega decide cambiar el modelo, ¿quién dice que el
// precio es el mismo?" — Alberto.
const itLigo = (extra = {}) => ({
  serial_saliente: "21708A0008", modelo: "PNC550-R", modelo_id: PNC550,
  modelo_solicitado: "HYTERA PNC550-R", modelo_solicitado_id: PNC550,
  serial_nuevo: "23905A0437", modelo_id_nuevo: PNC460, modelo_nuevo: "HYTERA PNC460-R",
  cambio_modelo_motivo: "no hay PNC550 en buen estado", ...extra,
});

test("cambiosDeModelo: detecta el PNC460-R puesto por un PNC550-R", () => {
  const c = G.cambiosDeModelo({ tipo: "reemplazo", items: [itLigo()] });
  assert.equal(c.length, 1);
  assert.equal(c[0].clave, "23905A0437");
  assert.equal(c[0].de_id, PNC550);
  assert.equal(c[0].a_id, PNC460);
  assert.equal(c[0].motivo, "no hay PNC550 en buen estado");
});

test("cambiosDeModelo: N/R de la misma familia NO es cambio (caso SEPROSA GR20260928-01)", () => {
  const it = { serial_nuevo: "23905A0441", modelo_solicitado: "HYTERA PNC460", modelo_solicitado_id: "DbCw",
    modelo_id_nuevo: PNC460, modelo_nuevo: "HYTERA PNC460-R" };
  assert.deepEqual(G.cambiosDeModelo({ tipo: "reemplazo", items: [it] }), []);
  // Sin modelo real estampado no se inventa un cambio; y solo aplica a reemplazos.
  assert.deepEqual(G.cambiosDeModelo({ tipo: "reemplazo", items: [itLigo({ modelo_id_nuevo: null })] }), []);
  assert.deepEqual(G.cambiosDeModelo({ tipo: "demo", items: [itLigo()] }), []);
});

test("estadoCambiosModelo: una decisión vale para ESE serial con ESE modelo", () => {
  const base = { tipo: "reemplazo", items: [itLigo()] };
  assert.equal(G.estadoCambiosModelo(base).sinDecidir.length, 1);
  const pend = { ...base, cambio_modelo: { "23905A0437": { estado: "pendiente", a_id: PNC460 } } };
  assert.equal(G.estadoCambiosModelo(pend).sinDecidir.length, 1, "pendiente sigue sin decidir");
  assert.equal(G.cambioModeloEnEspera(pend), true);
  const ok = { ...base, cambio_modelo: { "23905A0437": { estado: "aprobado", a_id: PNC460, tarifa: "se_mantiene" } } };
  assert.equal(G.estadoCambiosModelo(ok).aprobados.length, 1);
  assert.equal(G.estadoCambiosModelo(ok).sinDecidir.length, 0);
  assert.equal(G.cambioModeloEnEspera(ok), false);
  const no = { ...base, cambio_modelo: { "23905A0437": { estado: "rechazado", a_id: PNC460 } } };
  assert.equal(G.estadoCambiosModelo(no).rechazados.length, 1);
  // Aprobado para OTRO modelo con el mismo serial: se decide de nuevo.
  const otro = { ...base, cambio_modelo: { "23905A0437": { estado: "aprobado", a_id: "otroModelo" } } };
  assert.equal(G.estadoCambiosModelo(otro).sinDecidir.length, 1);
});

test("rules: la decisión (cambio_modelo) solo la escribe administración al aprobar; bodega solo toca items", () => {
  const rules = leer("firestore.rules");
  const aprob = rules.slice(rules.indexOf("function esAprobacionGestion()"), rules.indexOf("function gestionBlanda()"));
  assert.match(aprob, /userRole\(\) in \["administrador","gerente"\]/);
  assert.match(aprob, /"cambio_modelo"/);
  const asig = rules.slice(rules.indexOf("function esAsignacionGestion()"), rules.indexOf("function esMarcaTallerGestion()"));
  assert.doesNotMatch(asig, /cambio_modelo/);
});

test("asignador: contrato, aumento y corrección no fuerzan otro modelo; reemplazo lo propone", () => {
  const src = leer("public", "js", "pages", "almacen-asignar.js");
  assert.match(src, /permitir: permitirContrato\(c\), modeloDistinto: 'bloquear'/);
  assert.match(src, /if \(g\.tipo === 'reemplazo'\) return 'aprobacion';/);
  assert.match(src, /if \(g\.tipo === 'demo'\) return 'forzar';/);
  assert.doesNotMatch(src, /exigirEnBodega\([^)]*\{\}\)/, "ningún llamado sin política");
  const asg = leer("public", "js", "ui", "asignador-seriales.js");
  assert.match(asg, /const puedeForzar = soloModelo && modeloDistinto !== 'bloquear';/);
});

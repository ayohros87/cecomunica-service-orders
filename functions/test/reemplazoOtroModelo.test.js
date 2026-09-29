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

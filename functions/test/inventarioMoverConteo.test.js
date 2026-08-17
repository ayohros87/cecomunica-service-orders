// InventarioService.moverConteo — el conteo físico cuando un lote cambia de
// fila del catálogo (public/js/services/inventarioService.js).
//
// POR QUÉ EXISTE. El 2026-08-14 bodega pasó 32 seriales de VM686 a PD686 y el
// conteo no se movió: la fila VM686 se quedó marcando 32 con UNA unidad viva,
// una diferencia de −31 que no había forma de cerrar desde la UI y que hubo que
// arreglar a mano tres días después.
//
// La parte delicada es que restar y sumar NO son simétricos. Que las unidades
// ya no estén en el origen es un hecho; que falten en el destino no lo es, y en
// el caso real bodega YA había fijado PD686 en 32 antes de tocar las fichas —
// sumar habría dejado 64. Por eso van en dos casillas y la suma viene apagada.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Firestore de mentira: solo `inventario_actual` y lo que guardarInventario
// escribe. Devuelve lo que se guardó para poder afirmarlo.
function cargar(conteos) {
  const guardado = [];
  const docs = new Map(Object.entries(conteos));
  // guardarInventario usa db.collection(...).doc(...) como ref del batch; se le
  // cuelga __id para poder identificar qué fila se escribió. Los docs de
  // `ultimo_inventario` no llevan __id, así que el historial no ensucia lo que
  // se afirma acá (que igual se escribe: es el kardex del conteo).
  const firebase = {};
  firebase.firestore = Object.assign(() => ({
    collection: (col) => ({
      doc: (id) => ({
        __id: col === "inventario_actual" ? id : null,
        get: async () => ({
          exists: col === "inventario_actual" && docs.has(id),
          data: () => docs.get(id),
        }),
      }),
    }),
    batch: () => ({
      set: (ref, data) => { if (ref.__id) guardado.push({ modeloId: ref.__id, cantidad: data.cantidad }); },
      commit: async () => {},
    }),
  }), { Timestamp: { now: () => "T0" } });

  const sandbox = { window: {}, firebase, console };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "services", "inventarioService.js"), "utf8"),
    sandbox, { filename: "inventarioService.js" });
  return { svc: sandbox.window.InventarioService, guardado };
}

const VM686 = "mVM", PD686 = "mPD";

test("el caso real: restar del origen deja de contar lo que ya no está ahí", async () => {
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 32 }, [PD686]: { cantidad: 32 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 32, restarOrigen: true, sumarDestino: false });
  assert.deepEqual(guardado, [{ modeloId: VM686, cantidad: 0 }],
    "solo se toca el origen: bodega ya había contado los 32 como PD686");
});

test("sumar al destino se pide aparte y sí suma", async () => {
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 32 }, [PD686]: { cantidad: 0 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 32, restarOrigen: true, sumarDestino: true });
  assert.deepEqual(guardado.find(g => g.modeloId === PD686), { modeloId: PD686, cantidad: 32 });
  assert.deepEqual(guardado.find(g => g.modeloId === VM686), { modeloId: VM686, cantidad: 0 });
});

test("marcar las dos cuando el destino YA los contaba es lo que produce el doble conteo", async () => {
  // No es un bug: es la razón de que la suma venga apagada y con los números
  // a la vista. Si alguien la marca igual, esto es lo que pasa.
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 32 }, [PD686]: { cantidad: 32 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 32, restarOrigen: true, sumarDestino: true });
  assert.equal(guardado.find(g => g.modeloId === PD686).cantidad, 64);
});

test("lote parcial: 12 de 32 mueven 12, no la fila entera", async () => {
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 32 }, [PD686]: { cantidad: 5 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 12, restarOrigen: true, sumarDestino: true });
  assert.equal(guardado.find(g => g.modeloId === VM686).cantidad, 20);
  assert.equal(guardado.find(g => g.modeloId === PD686).cantidad, 17);
});

test("el origen nunca queda negativo", async () => {
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 5 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 32, restarOrigen: true });
  assert.equal(guardado.find(g => g.modeloId === VM686).cantidad, 0,
    "si el conteo viejo ya estaba mal, lo que queda es cero, no una deuda");
});

test("sin fila de conteo en el origen no se inventa una", async () => {
  const { svc, guardado } = cargar({ [PD686]: { cantidad: 3 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 4, restarOrigen: true, sumarDestino: false });
  assert.equal(guardado.length, 0);
});

test("sin origen declarado solo puede sumarse al destino", async () => {
  const { svc, guardado } = cargar({ [PD686]: { cantidad: 3 } });
  await svc.moverConteo({ desde: "", hacia: PD686, cantidad: 4, restarOrigen: true, sumarDestino: true });
  assert.deepEqual(guardado, [{ modeloId: PD686, cantidad: 7 }]);
});

test("sin casillas marcadas no se escribe nada", async () => {
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 32 }, [PD686]: { cantidad: 0 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 32, restarOrigen: false, sumarDestino: false });
  assert.equal(guardado.length, 0);
});

test("cantidad cero o negativa no toca nada", async () => {
  const { svc, guardado } = cargar({ [VM686]: { cantidad: 32 } });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: 0, restarOrigen: true, sumarDestino: true });
  await svc.moverConteo({ desde: VM686, hacia: PD686, cantidad: -5, restarOrigen: true, sumarDestino: true });
  assert.equal(guardado.length, 0);
});

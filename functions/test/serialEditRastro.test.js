// Editar el serial de un equipo tiene que dejar rastro.
//
// Incidente del 2026-08 (TIL PANAMA): la tanda de una devolución creó la fila
// con "B8C10597", alguien la editó a "B8C1697" desde el lápiz de la orden, y al
// cerrar la ENTRADA el radio se quedó en cuarentena porque ese serial no existe
// en el pool. Estuvo nueve días fuera del inventario.
//
// `updateEquipmentField` hacía un `update({equipos})` pelado: sin
// `fecha_modificacion` y sin `os_logs`. El cambio era INDEMOSTRABLE — hubo que
// reconstruirlo por descarte contra el kardex, y aun así nunca se supo quién.
//
// Lo que se congela aquí:
//   R1 — editar el serial escribe una entrada EDITAR_SERIAL con valor viejo,
//        nuevo, quién y cuándo.
//   R2 — editar el serial refresca `fecha_modificacion` (antes se quedaba
//        clavada en el instante de la tanda, que fue lo que despistó).
//   R3 — las dos claves del serial se siguen sincronizando.
//   R4 — editar modelo/observaciones NO ensucia la bitácora: son cambios
//        rutinarios y llenarían os_logs de ruido.
//
// Corre con `npm test` (node --test). Sin red ni navegador.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");

const EQUIPO = { id: "e1", serial: "B8C10597", numero_de_serie: "B8C10597", modelo: "NX-420-R" };

// Monta ordenesService.js con un Firestore de mentira. Devuelve el servicio y
// el objeto `update` que recibió la orden.
function montar() {
  const capturado = { update: null };
  const orden = { equipos: [ { ...EQUIPO } ] };

  const sentinela = (tipo, valor) => ({ __sentinela: tipo, valor });
  const firebase = {
    firestore: Object.assign(() => ({
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => orden }),
          update: async (patch) => { capturado.update = patch; },
        }),
      }),
    }), {
      FieldValue: {
        serverTimestamp: () => sentinela("serverTimestamp"),
        arrayUnion: (v) => sentinela("arrayUnion", v),
        delete: () => sentinela("delete"),
      },
    }),
    auth: () => ({ currentUser: { uid: "u-jesus", email: "jesus@cecomunica.com" } }),
  };

  const ctx = { window: {}, firebase, console, document: { addEventListener() {} } };
  ctx.window.firebase = firebase;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "public", "js", "services", "ordenesService.js"), "utf8"),
    ctx, { filename: "ordenesService.js" });
  return { svc: ctx.window.OrdenesService || ctx.OrdenesService, capturado };
}

test("R1 · editar el serial deja quién, cuándo y de qué a qué", async () => {
  const { svc, capturado } = montar();
  await svc.updateEquipmentField("2026081103", "e1", "numero_de_serie", "B8C1697");

  const log = capturado.update.os_logs;
  assert.ok(log, "tiene que escribirse una entrada en os_logs");
  assert.equal(log.__sentinela, "arrayUnion", "os_logs se apila, no se pisa");
  const e = log.valor;
  assert.equal(e.action, "EDITAR_SERIAL");
  assert.equal(e.de, "B8C10597", "el valor VIEJO es la mitad que faltaba para reconstruir el caso");
  assert.equal(e.a,  "B8C1697");
  assert.equal(e.by, "u-jesus");
  assert.equal(e.by_email, "jesus@cecomunica.com");
  assert.ok(e.at_iso && !isNaN(Date.parse(e.at_iso)), "la marca de tiempo va como ISO");
  // serverTimestamp() no se admite dentro de un array: si alguien lo "arregla"
  // así, Firestore rechaza la escritura entera y se pierde el rastro Y la edición.
  assert.equal(typeof e.at_iso, "string");
});

test("R2 · editar el serial refresca fecha_modificacion", async () => {
  const { svc, capturado } = montar();
  await svc.updateEquipmentField("2026081103", "e1", "numero_de_serie", "B8C1697");
  assert.equal(capturado.update.fecha_modificacion?.__sentinela, "serverTimestamp",
    "sin esto la orden sigue diciendo que su último cambio fue el de la tanda");
});

test("R3 · las dos claves del serial siguen sincronizadas", async () => {
  const { svc, capturado } = montar();
  await svc.updateEquipmentField("2026081103", "e1", "numero_de_serie", "B8C10697");
  const eq = capturado.update.equipos[0];
  assert.equal(eq.serial, "B8C10697");
  assert.equal(eq.numero_de_serie, "B8C10697");
});

test("R4 · modelo y observaciones no ensucian la bitácora", async () => {
  for (const campo of ["modelo", "observaciones"]) {
    const { svc, capturado } = montar();
    await svc.updateEquipmentField("2026081103", "e1", campo, "lo que sea");
    assert.equal(capturado.update.os_logs, undefined, `${campo} no debe registrarse`);
    assert.equal(capturado.update.fecha_modificacion, undefined, `${campo} no debe tocar la fecha`);
    assert.ok(capturado.update.equipos, "el cambio sí se guarda");
  }
});

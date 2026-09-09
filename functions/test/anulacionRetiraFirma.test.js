// Anular una gestión retira el enlace de firma que el cliente todavía tiene
// (lib/gestiones.limpiarAnulacion, paso 0 — 2026-09-09).
//
// El hueco: una gestión anulada con el enlace en la calle se podía firmar
// igual. onFirmaContrato estampaba la firma y le mandaba al cliente la
// constancia de un anexo que ya no existe. La página lo retira al anular
// (respuesta inmediata); esto es el candado del backend, que cubre cualquier
// otra vía y tiene que ser idempotente.
//
// Corre con `npm test` (node --test). No necesita red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

// limpiarAnulacion carga domain/equiposPool EN CALIENTE (dentro de la función),
// cuando el doble de `./admin` ya no está puesto: sin una app inicializada,
// firebase-admin revienta al pedir Firestore. Se inicializa una de mentira —
// ese db real nunca se usa: las gestiones de este test no tienen seriales.
const fbAdmin = require("firebase-admin");
if (!fbAdmin.apps.length) fbAdmin.initializeApp({ projectId: "test-anulacion-firma" });

// lib/admin inicializa firebase-admin al cargarse: se cambia por un doble que
// apunta cada escritura. Lo mismo para domain/equiposPool, que limpiarAnulacion
// carga aunque no lo use cuando la gestión no tiene seriales.
function cargarLib() {
  const ops = [];
  const docs = new Map();      // "col/id" → data (null = no existe)
  const ref = (col, id) => ({
    get: async () => {
      const k = `${col}/${id}`;
      return { exists: docs.has(k), id, ref: ref(col, id), data: () => docs.get(k) };
    },
    update: async (u) => { ops.push({ op: "update", col, id, ...u }); },
    set: async (u) => { ops.push({ op: "set", col, id, ...u }); },
    collection: (sub) => ({ add: async (d) => { ops.push({ op: "add", col, id, sub, detalle: d.detalle }); } }),
  });
  const db = { collection: (col) => ({ doc: (id) => ref(col, id) }) };
  const admin = { firestore: {
    FieldValue: { serverTimestamp: () => "TS", delete: () => "DEL", arrayUnion: (x) => ["AU", x], arrayRemove: (x) => ["AR", x] },
    Timestamp: { now: () => "NOW" },
  } };

  // Mientras se carga el árbol de gestiones.js, TODO `./admin` es el doble:
  // sus dependencias (inventario, mailRecipients, equiposPool) también lo
  // piden y si no, firebase-admin pide un initializeApp que aquí no existe.
  const orig = Module._load;
  Module._load = function (req) {
    if (req === "./admin" || req === "../lib/admin") return { admin, db };
    return orig.apply(this, arguments);
  };
  for (const m of ["../src/lib/gestiones", "../src/lib/inventario", "../src/lib/mailRecipients",
    "../src/domain/equiposPool", "../src/lib/bajas"]) {
    try { delete require.cache[require.resolve(m)]; } catch (e) { /* no está: da igual */ }
  }
  const G = require("../src/lib/gestiones");
  Module._load = orig;
  return { G, ops, docs };
}

const anexo = (extra = {}) => ({
  tipo: "aumento", estado: "anulada", cliente_id: "cli1", items: [],
  ordenes: {}, cierre: {}, aumento: { contrato_doc_id: "c1", lineas: [] }, ...extra,
});

test("el enlace pendiente se retira: primero la solicitud, después el expediente", async () => {
  const { G, ops, docs } = cargarLib();
  docs.set("firma_solicitudes/sol1", { estado: "pendiente", tipo: "anexo_aumento" });
  const acciones = await G.limpiarAnulacion("GA1", anexo({
    firma_solicitud_id: "sol1", firma_solicitud_estado: "pendiente",
  }));

  const escrituras = ops.filter(o => o.op === "update");
  assert.equal(escrituras[0].col, "firma_solicitudes");
  assert.equal(escrituras[0].id, "sol1");
  assert.equal(escrituras[0].estado, "cancelado");
  assert.equal(escrituras[1].col, "gestiones");
  assert.equal(escrituras[1].firma_solicitud_estado, "cancelado");
  assert.ok(acciones.some(a => /enlace de firma retirado/.test(a)), "la acción tiene que quedar dicha");
  // Y la bitácora del expediente lo cuenta.
  const evento = ops.find(o => o.op === "add" && o.sub === "eventos");
  assert.match(evento.detalle, /enlace de firma retirado/);
});

test("idempotente: si el enlace ya no está pendiente, no se toca nada", async () => {
  for (const estado of ["firmado", "cancelado", "validacion", "activado"]) {
    const { G, ops, docs } = cargarLib();
    docs.set("firma_solicitudes/sol1", { estado });
    await G.limpiarAnulacion("GA1", anexo({ firma_solicitud_id: "sol1", firma_solicitud_estado: "pendiente" }));
    assert.equal(ops.filter(o => o.op === "update" && o.col === "firma_solicitudes").length, 0,
      `una solicitud '${estado}' no se cancela`);
  }
});

test("sin enlace no hay paso 0 (y la anulación sigue su curso)", async () => {
  const { G, ops } = cargarLib();
  const acciones = await G.limpiarAnulacion("GA1", anexo());
  assert.equal(ops.filter(o => o.col === "firma_solicitudes").length, 0);
  assert.ok(!acciones.some(a => /enlace de firma/.test(a)));

  // Ni cuando el expediente dice que el enlace ya se retiró antes.
  const b = cargarLib();
  await b.G.limpiarAnulacion("GA1", anexo({ firma_solicitud_id: "sol1", firma_solicitud_estado: "cancelado" }));
  assert.equal(b.ops.filter(o => o.col === "firma_solicitudes").length, 0);
});

test("un fallo al retirar el enlace no tumba el resto de la limpieza", async () => {
  const { G, ops, docs } = cargarLib();
  docs.set("firma_solicitudes/sol1", { estado: "pendiente" });
  // La solicitud revienta al escribir (p. ej. el cliente firmó en ese segundo).
  const orig = db_update_falla(ops);
  const acciones = await G.limpiarAnulacion("GA1", anexo({
    firma_solicitud_id: "sol1", firma_solicitud_estado: "pendiente",
  }));
  orig();
  assert.ok(Array.isArray(acciones), "limpiarAnulacion devuelve sus acciones igual");
  assert.ok(ops.some(o => o.op === "add" && o.sub === "eventos"), "la bitácora se escribe igual");
});

// Hace que la PRÓXIMA escritura a firma_solicitudes lance; devuelve el
// restaurador. (El doble de db se arma por test, así que basta con marcar.)
function db_update_falla(ops) {
  const push = ops.push.bind(ops);
  ops.push = (o) => { if (o.col === "firma_solicitudes") throw new Error("firmó primero"); return push(o); };
  return () => { ops.push = push; };
}

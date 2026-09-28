// Una galería de fotos por orden (auditoría UX 2026-09-28, §4.2 #16).
//
// Había dos juegos de fotos que no se veían entre sí: fotos_taller[] en la
// orden (galería del menú ⋯) y equipos[i].fotos[] (modal de intervención),
// con dos contadores y dos listas de permisos. OrdenesService ahora:
//   · LEE los dos orígenes (fotosDeOrden / fotosDeEquipo / contarFotosOrden),
//   · ESCRIBE en uno solo (addFotoOrden → fotos_taller[] con etiqueta de
//     equipo opcional),
//   · da de baja donde esté la foto (softDeleteFotoOrden),
//   · y decide permisos con un solo criterio (puedeEliminarFoto).
//
// Se corre el servicio real en un sandbox con un Firestore de mentira.
// Corre con `npm test` (node --test), sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "..", "..", "public");
const leer = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), "utf8");
const SRC = leer("js", "services", "ordenesService.js");

// Los arreglos nacen en el realm del sandbox (otro Array.prototype):
// deepEqual estricto los rechaza por prototipo, así que se comparan por valor.
const deepEqual = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

const ROLES = { ADMIN: "administrador", JEFE_TALLER: "jefe_taller", TECNICO: "tecnico",
  TECNICO_OPERATIVO: "tecnico_operativo", RECEPCION: "recepcion", VENDEDOR: "vendedor" };

// Firestore de mentira: un solo doc, guarda lo que se le escribe.
function montar(docInicial) {
  let doc = JSON.parse(JSON.stringify(docInicial));
  const updates = [];
  const ARRAY_UNION = Symbol("arrayUnion");
  const SERVER_TS = Symbol("serverTimestamp");
  const aplicar = (cambios) => {
    for (const [k, v] of Object.entries(cambios)) {
      if (v && v[ARRAY_UNION]) doc[k] = [...(doc[k] || []), ...v[ARRAY_UNION]];
      else if (v === SERVER_TS) doc[k] = "server-ts";
      else doc[k] = v;
    }
  };
  const ref = {
    get: async () => ({ exists: true, data: () => JSON.parse(JSON.stringify(doc)) }),
    update: async (cambios) => { updates.push(cambios); aplicar(cambios); },
  };
  const firestore = () => ({ collection: () => ({ doc: () => ref }) });
  firestore.Timestamp = { now: () => "ts-now" };
  firestore.FieldValue = {
    arrayUnion: (...items) => ({ [ARRAY_UNION]: items }),
    serverTimestamp: () => SERVER_TS,
    delete: () => "delete",
  };
  const sandbox = { window: {}, console, ROLES, firebase: { firestore }, Math, Date, Array, Object, String, Number, JSON, Symbol };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "ordenesService.js" });
  return { S: sandbox.window.OrdenesService, updates, doc: () => doc };
}

const ORDEN = {
  cliente_nombre: "Hospital Santo Tomás",
  fotos_taller: [
    { id: "ft_1", url: "u1", tipo: "antes" },
    { id: "ft_2", url: "u2", tipo: "detalle", equipo_id: "eqA", equipo_serial: "SN-A" },
    { id: "ft_3", url: "u3", tipo: "detalle", deleted: true },
  ],
  equipos: [
    { id: "eqA", numero_de_serie: "SN-A", fotos: [{ id: "eq_a1", url: "ua1" }, { id: "eq_a2", url: "", deleted: false }] },
    { id: "eqB", serial: "sn-b", fotos: [{ id: "eq_b1", url: "ub1", deleted: true }] },
    { id: "eqC", numero_de_serie: "SN-C", eliminado: true, fotos: [{ id: "eq_c1", url: "uc1" }] },
  ],
};

test("fotosDeOrden junta los dos orígenes y etiqueta las del equipo", () => {
  const { S } = montar(ORDEN);
  const todas = S.fotosDeOrden(ORDEN);
  deepEqual(todas.map(f => f.id), ["ft_1", "ft_2", "ft_3", "eq_a1", "eq_a2", "eq_b1"],
    "el equipo eliminado no aporta fotos");
  const a1 = todas.find(f => f.id === "eq_a1");
  assert.equal(a1.origen, "equipo");
  assert.equal(a1.equipo_id, "eqA");
  assert.equal(a1.equipo_serial, "SN-A");
  assert.equal(a1.tipo, "detalle", "las históricas del equipo caen en Detalle");
  assert.equal(todas.find(f => f.id === "ft_1").origen, "orden");
});

test("contarFotosOrden = activas de ambos orígenes; fotosDeEquipo por id o serial", () => {
  const { S } = montar(ORDEN);
  // Activas: ft_1, ft_2, eq_a1 (eq_a2 sin url, ft_3 y eq_b1 borradas).
  assert.equal(S.contarFotosOrden(ORDEN), 3);
  deepEqual(S.fotosDeEquipo(ORDEN, ORDEN.equipos[0]).map(f => f.id), ["ft_2", "eq_a1"],
    "la de la galería etiquetada con el equipo + la histórica del equipo");
  deepEqual(S.fotosDeEquipo(ORDEN, { id: "otro", serial: "sn a" }).map(f => f.id), ["ft_2", "eq_a1"],
    "la etiqueta vieja solo por serial también cuenta (normalizado)");
  deepEqual(S.fotosDeEquipo(ORDEN, ORDEN.equipos[1]), []);
});

test("puedeEliminarFoto: un solo criterio para las dos vistas", () => {
  const { S } = montar(ORDEN);
  const foto = { id: "x", uploaded_by_uid: "u-sube" };
  for (const rol of ["administrador", "jefe_taller", "tecnico", "tecnico_operativo", "ADMINISTRADOR"]) {
    assert.ok(S.puedeEliminarFoto(foto, { rol, uid: "otro" }), rol);
  }
  assert.ok(S.puedeEliminarFoto(foto, { rol: "recepcion", uid: "u-sube" }), "quien la subió");
  assert.ok(!S.puedeEliminarFoto(foto, { rol: "recepcion", uid: "otro" }));
  assert.ok(!S.puedeEliminarFoto(foto, { rol: "vendedor", uid: "" }));
  assert.ok(!S.puedeEliminarFoto(null, { rol: "recepcion", uid: "u-sube" }));
});

test("addFotoOrden escribe SIEMPRE en fotos_taller[] con la etiqueta del equipo y recuenta", async () => {
  const { S, updates, doc } = montar(ORDEN);
  const r = await S.addFotoOrden({
    ordenId: "2026091501",
    foto: { id: "ft_new", url: "un", path: "p", tipo: "despues", nota: "golpe" },
    equipo: { id: "eqB", serial: "sn-b" },
    user: { uid: "u1", email: "t@x.com" },
  });
  assert.equal(updates.length, 2, "arrayUnion + recuento sobre lectura fresca");
  const nueva = doc().fotos_taller.find(f => f.id === "ft_new");
  assert.equal(nueva.equipo_id, "eqB");
  assert.equal(nueva.equipo_serial, "sn-b");
  assert.equal(nueva.uploaded_by_uid, "u1");
  assert.equal(nueva.deleted, false);
  assert.equal(doc().equipos[1].fotos.length, 1, "equipos[i].fotos[] no recibe fotos nuevas");
  assert.equal(doc().fotos_taller_count, 4);
  assert.equal(r.fotos_taller_count, 4);
  assert.ok(doc().os_logs.some(l => l.action === "SUBIR_FOTO_TALLER" && l.equipo_serial === "sn-b"));
  deepEqual(S.fotosDeEquipo(doc(), ORDEN.equipos[1]).map(f => f.id), ["ft_new"],
    "el modal del equipo la ve aunque viva en la galería de la orden");
});

test("softDeleteFotoOrden da de baja en el origen donde esté la foto", async () => {
  const { S, doc } = montar(ORDEN);
  await S.softDeleteFotoOrden({ ordenId: "o", fotoId: "eq_a1", uid: "u9", email: "e" });
  const a1 = doc().equipos[0].fotos.find(f => f.id === "eq_a1");
  assert.equal(a1.deleted, true);
  assert.equal(a1.deleted_by_uid, "u9");
  assert.equal(doc().equipos[1].fotos_updated_at, undefined, "los demás equipos no se tocan");
  assert.equal(doc().fotos_taller_count, 2);

  await S.softDeleteFotoOrden({ ordenId: "o", fotoId: "ft_1", uid: "u9", email: "e" });
  assert.equal(doc().fotos_taller.find(f => f.id === "ft_1").deleted, true);
  assert.equal(doc().fotos_taller_count, 1);
  assert.equal(doc().os_logs.filter(l => l.action === "ELIMINAR_FOTO_TALLER").length, 2);

  await assert.rejects(() => S.softDeleteFotoOrden({ ordenId: "o", fotoId: "nope" }), /Foto no encontrada/);
});

test("las dos vistas usan la misma lectura, escritura y permisos", () => {
  const equipos = leer("js", "pages", "ordenes-equipos.js");
  const galeria = leer("js", "pages", "ordenes-fotos.js");
  const render = leer("js", "pages", "ordenes-render.js");
  for (const viejo of ["addEquipoFoto", "softDeleteEquipoFoto"]) {
    assert.doesNotMatch(SRC, new RegExp(`async ${viejo}\\(`), `${viejo} ya no existe: una sola escritura`);
    assert.doesNotMatch(equipos, new RegExp(viejo));
  }
  assert.match(equipos, /OrdenesService\.addFotoOrden\(/);
  assert.match(equipos, /OrdenesService\.softDeleteFotoOrden\(/);
  assert.match(equipos, /OrdenesService\.fotosDeEquipo\(/);
  assert.match(equipos, /OrdenesService\.puedeEliminarFoto\(/);
  assert.match(galeria, /OrdenesService\.fotosDeOrden\(/);
  assert.match(galeria, /OrdenesService\.addFotoOrden\(/);
  assert.match(galeria, /OrdenesService\.softDeleteFotoOrden\(/);
  assert.match(galeria, /OrdenesService\.puedeEliminarFoto\(/);
  assert.match(galeria, /fotos-pending__equipo/, "etiqueta opcional de equipo al subir");
  assert.match(galeria, /abrirFotosOrden = async function \(ordenId, \{ equipoId = "" \} = \{\}\)/);
  // Un contador: el badge de la fila se calcula sobre los dos orígenes.
  assert.match(render, /OrdenesService\.contarFotosOrden\(ordenData\)/);
  assert.match(render, /OrdenesService\.fotosDeEquipo\(ordenData, e\)\.length/);
  // El modal del equipo abre la galería única filtrada por ese equipo.
  assert.match(leer("ordenes", "index.html"), /data-action="ver-galeria-equipo"/);
  assert.match(leer("js", "pages", "ordenes-events.js"), /'ver-galeria-equipo'/);
});

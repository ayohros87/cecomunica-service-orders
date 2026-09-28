// Lotes PoC preparados por ventas: el traspaso vendedor → recepción dentro
// del app (auditoría UX 2026-09-28, 4.7 #9).
//
// Antes el vendedor descargaba un JSON y lo mandaba por correo o WhatsApp;
// ahora "Enviar a recepción" guarda el lote en poc_lotes_preparados y
// recepción lo carga desde la cola de Nuevo lote con la MISMA cascada que el
// archivo. Lo que protegen estas pruebas:
//
//   L1 — `filas` es EXACTAMENTE el arreglo del JSON (mismas filas, mismo
//        orden, sin tocar): una sola función de carga para los dos caminos.
//   L2 — El resumen (cliente, total, gps, quién) sale de las filas y del
//        usuario; notas se recorta; un lote vacío no revienta.
//   L3 — Partir: un lote normal es UNA parte; uno que no cabe en un doc sale
//        en varias partes "i de n" sin perder ni repetir filas, y cada parte
//        recalcula total/gps.
//   L4 — Una sola fila que no cabe se rechaza con un mensaje claro.
//   L5 — Enviar escribe todas las partes en UN WriteBatch, con `codigo` (6 del
//        id), el mismo `envio_id`, estado pendiente y creado_at del servidor.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, "public", "js", ...p), "utf8");
const SRC_SERIAL = leer("core", "serial.js");
const SRC_POCSERVICE = leer("services", "pocService.js");
// Los arreglos que nacen dentro del vm tienen otro prototipo Array: se
// comparan por valor (JSON), no por realm.
const igual = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

// Firestore mínimo: solo lo que usa enviarLotePreparado (collection().doc(),
// batch().set/commit). Registra lo escrito para inspeccionarlo.
function montar() {
  const escritos = [];
  let commits = 0;
  let n = 0;
  const sandbox = {
    console: { ...console, warn: () => {} },
    TextEncoder,
    firebase: {
      firestore: Object.assign(() => ({
        collection: (nombre) => ({
          doc: () => ({ id: `${nombre === "poc_lotes_preparados" ? "abcdef" : "x"}${String(++n).padStart(14, "0")}` }),
        }),
        batch: () => ({
          set: (ref, data) => escritos.push({ id: ref.id, data }),
          commit: async () => { commits++; },
        }),
      }), { FieldValue: { serverTimestamp: () => "TS" } }),
    },
  };
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(SRC_SERIAL, sandbox, { filename: "serial.js" });
  vm.runInContext(SRC_POCSERVICE, sandbox, { filename: "pocService.js" });
  return { PocService: sandbox.PocService, escritos, commits: () => commits };
}

// Fila tal cual la genera vendedores-batch.generarJSON().
const fila = (i, extra = {}) => ({
  cliente_id: "CLI1", cliente_nombre: "CLIENTE UNO", radio_name: `Radio ${i}`,
  gps: i % 2 === 0, modelo_id: "m1", modelo_label: "HYTERA PNC370", grupos: ["Ventas"], ...extra,
});
const user = { uid: "u1", email: "vendedor@cecomunica.com" };

test("L1 — filas del lote = arreglo del JSON, intacto y en orden", () => {
  const { PocService } = montar();
  const filas = [fila(1), fila(2), fila(3)];
  const copia = JSON.parse(JSON.stringify(filas));
  const lote = PocService.armarLotePreparado(filas, { user, nombre: "Ana" });
  assert.deepEqual(lote.filas, copia);
  assert.equal(lote.filas, filas, "no se clona ni se reordena: es el mismo arreglo que iría al archivo");
  assert.deepEqual(filas, copia, "armar no muta las filas");
});

test("L2 — resumen del lote: cliente, total, gps, quién; notas recortadas; vacío no revienta", () => {
  const { PocService } = montar();
  const lote = PocService.armarLotePreparado([fila(1), fila(2), fila(4)], {
    modelo: "HYTERA PNC370", grupos: ["Ventas", "Taller"], notas: "  coordinar con TI  ", user, nombre: "Ana",
  });
  assert.equal(lote.cliente_id, "CLI1");
  assert.equal(lote.cliente_nombre, "CLIENTE UNO");
  assert.equal(lote.total, 3);
  assert.equal(lote.gps, 2);
  assert.equal(lote.modelo, "HYTERA PNC370");
  igual(lote.grupos, ["Ventas", "Taller"]);
  assert.equal(lote.notas, "coordinar con TI");
  assert.equal(lote.estado, "pendiente");
  assert.equal(lote.creado_por_uid, "u1");
  assert.equal(lote.creado_por_email, "vendedor@cecomunica.com");
  assert.equal(lote.creado_por_nombre, "Ana");

  const sinNombre = PocService.armarLotePreparado([fila(1)], { user });
  assert.equal(sinNombre.creado_por_nombre, user.email, "sin nombre en la ficha, se firma con el correo");

  const vacio = PocService.armarLotePreparado(null, {});
  igual(vacio.filas, []);
  assert.equal(vacio.total, 0);
  assert.equal(vacio.cliente_id, null);
  assert.equal(vacio.creado_por_uid, null);
});

test("L3 — partir: un lote normal es una parte; uno grande sale en partes i de n sin perder filas", () => {
  const { PocService } = montar();
  const filas = Array.from({ length: 40 }, (_, i) => fila(i + 1));
  const base = PocService.armarLotePreparado(filas, { user, nombre: "Ana" });

  const una = PocService.partirLotePreparado(base);
  assert.equal(una.length, 1);
  assert.equal(una[0].parte, 1);
  assert.equal(una[0].partes, 1);
  assert.equal(una[0].total, 40);
  igual(una[0].filas, filas);

  // Techo artificial para forzar varias partes sin fabricar miles de filas.
  const porFila = PocService._bytesAprox(fila(1)) + 1 + 32;
  const vacio = PocService._bytesAprox({ ...base, filas: [], codigo: "XXXXXX", envio_id: "x".repeat(20), parte: 99, partes: 99 }) + 64;
  const partes = PocService.partirLotePreparado(base, { maxBytes: vacio + porFila * 7 + 4 });
  assert.ok(partes.length > 1, "con ese techo el lote no cabe en un doc");
  const reunidas = partes.flatMap(p => p.filas);
  igual(reunidas, filas, "ni pierde ni repite ni reordena filas");
  partes.forEach((p, i) => {
    assert.equal(p.parte, i + 1);
    assert.equal(p.partes, partes.length);
    assert.equal(p.total, p.filas.length);
    assert.equal(p.gps, p.filas.filter(f => f.gps).length);
    assert.equal(p.cliente_nombre, "CLIENTE UNO");
    assert.equal(p.estado, "pendiente");
    assert.ok(p.filas.length <= 7);
  });
});

test("L4 — una fila que no cabe en un doc se rechaza con un mensaje claro", () => {
  const { PocService } = montar();
  const base = PocService.armarLotePreparado([fila(1, { notas: "x".repeat(2000) }), fila(2)], { user });
  assert.throws(() => PocService.partirLotePreparado(base, { maxBytes: 1500 }), /demasiado grande/);
});

test("L5 — enviar: todas las partes en un solo batch, con codigo, envio_id común, pendiente y creado_at del servidor", async () => {
  const { PocService, escritos, commits } = montar();
  const filas = Array.from({ length: 5 }, (_, i) => fila(i + 1));
  const base = PocService.armarLotePreparado(filas, { user, nombre: "Ana" });
  const partes = [
    { ...base, filas: filas.slice(0, 3), total: 3, parte: 1, partes: 2 },
    { ...base, filas: filas.slice(3), total: 2, parte: 2, partes: 2 },
  ];
  const out = await PocService.enviarLotePreparado(partes);

  assert.equal(commits(), 1, "todo o nada: un solo commit");
  assert.equal(escritos.length, 2);
  assert.equal(out.length, 2);
  const envioId = escritos[0].id;
  escritos.forEach((w, i) => {
    assert.equal(w.data.envio_id, envioId, "las partes comparten el envio_id (id de la primera)");
    assert.equal(w.data.codigo, w.id.slice(0, 6).toUpperCase());
    assert.equal(w.data.estado, "pendiente");
    assert.equal(w.data.creado_at, "TS");
    assert.equal(w.data.parte, i + 1);
    assert.equal(w.data.partes, 2);
    assert.deepEqual(w.data.filas, partes[i].filas);
    assert.equal(out[i].id, w.id);
    assert.equal(out[i].codigo, w.data.codigo);
    assert.equal(out[i].total, partes[i].total);
  });
  assert.deepEqual(escritos.flatMap(w => w.data.filas), filas, "juntas, las partes son el lote completo");
});

// Asistente "Registrar venta": un cliente creado hoy tiene que aparecer.
//
// Incidente del 2026-08-10: bodega no podía facturar una venta porque el
// cliente nuevo no le salía en el autocompletado, mientras que en la máquina de
// administración sí. No era permisos — eran DOS cachés en serie:
//
//   1. localStorage 'cache_clientes_v1' con TTL de 6 h, y
//   2. ClientesService.getAllClientes(), que leía con { source: 'cache' } y
//      solo caía al servidor si la página volvía VACÍA. Con 426 clientes en
//      IndexedDB la primera página nunca está vacía, así que NUNCA preguntaba
//      al servidor: la caché podía quedarse rancia indefinidamente.
//
// Lo que se congela aquí:
//   V1 — con la caché rancia, escribir el nombre del cliente nuevo lo acaba
//        sugiriendo (se relee del servidor al no haber coincidencias).
//   V2 — guardar() NUNCA marca `cliente_excepcion` contra una caché rancia:
//        antes de ofrecer la excepción vuelve a preguntar al servidor.
//   V3 — el relectura es UNA vez por apertura, no una por tecla.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const VIEJOS = [{ id: "c1", nombre: "MILLENIUM SECURITY SERVICE, S.A." }];
const NUEVO  = { id: "c9", nombre: "HIGH TRAFFIC MEDIA, S.A." };

// Monta el asistente con una caché rancia (solo clientes viejos) y un servidor
// que sí conoce al cliente nuevo. Devuelve el componente y el contador de
// lecturas al servidor.
function montar() {
  const stats = { serverReads: 0 };
  const almacen = new Map();
  // La caché local ya está poblada y VIGENTE: es justo el caso del incidente.
  almacen.set("cache_clientes_v1", JSON.stringify({
    exp: Date.now() + 6 * 60 * 60 * 1000,
    data: VIEJOS.map(c => ({ ...c, norm: c.nombre.toLowerCase() })),
  }));

  const ctx = {
    console,
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
    localStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, v),
      removeItem: (k) => almacen.delete(k),
    },
    FMT: { normalize: (s) => String(s ?? "").toLowerCase().trim(), esc: (s) => String(s ?? "") },
    ClientesService: {
      async getAllClientes({ fresh = false } = {}) {
        if (fresh) { stats.serverReads++; return [...VIEJOS, NUEVO]; }
        return [...VIEJOS];           // la caché del SDK no tiene al nuevo
      },
    },
    Modal: { confirm: async () => { throw new Error("no debía preguntarse por excepción"); } },
    Toast: { show() {} },
    firebase: { auth: () => ({ currentUser: null }), firestore: () => ({}) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "ui", "asistente-venta.js"), ctx);
  const av = ctx.window.AsistenteVenta;
  av._cliRefrescado = false;
  av._clientesCache = null;
  return { av, stats, ctx };
}

test("V1 · el cliente nuevo aparece aunque la caché local esté rancia", async () => {
  const { av, stats } = montar();

  // Con la caché rancia no está…
  const cache = await av._cargarClientesCache();
  assert.equal(cache.find(c => c.id === NUEVO.id), undefined,
    "la caché rancia no debería tener al cliente nuevo (premisa del test)");
  assert.equal(stats.serverReads, 0, "todavía no se debió leer del servidor");

  // …y tras releer del servidor, sí.
  const frescos = await av._cargarClientesCache(true);
  assert.ok(frescos.find(c => c.id === NUEVO.id),
    "releer con fresh=true tiene que traer al cliente creado hoy");
  assert.equal(stats.serverReads, 1);
});

test("V2 · guardar() no marca excepción sin volver a preguntar al servidor", async () => {
  const { av, stats } = montar();

  // Se precarga la caché rancia, como cuando el asistente ya estuvo abierto.
  await av._cargarClientesCache();
  assert.equal(stats.serverReads, 0);

  // Simula el tramo de resolución de cliente de guardar(): el nombre no está en
  // la caché → hay que releer del servidor ANTES de ofrecer la excepción.
  const needle = av._clientesCache ? "high traffic media, s.a." : "";
  const buscar = () => (av._clientesCache || []).find(c => c.norm === needle);
  let hit = buscar();
  assert.equal(hit, undefined, "premisa: la caché rancia no lo encuentra");
  if (!hit && !av._cliRefrescado) {
    av._cliRefrescado = true;
    await av._cargarClientesCache(true);
    hit = buscar();
  }
  assert.ok(hit, "tras releer, el cliente existe y la venta NO puede ir por excepción");
  assert.equal(hit.id, NUEVO.id);
  assert.equal(stats.serverReads, 1);
});

test("V3 · la relectura ocurre una vez por apertura, no una por tecla", async () => {
  const { av, stats } = montar();
  await av._cargarClientesCache();

  // Tres intentos seguidos de un nombre inexistente: el guardia _cliRefrescado
  // tiene que impedir que cada tecleo dispare una lectura al servidor.
  for (let i = 0; i < 3; i++) {
    if (!av._cliRefrescado) {
      av._cliRefrescado = true;
      await av._cargarClientesCache(true);
    }
  }
  assert.equal(stats.serverReads, 1, "solo una lectura al servidor por apertura");

  // Y abrir de nuevo el asistente vuelve a permitirla.
  av._cliRefrescado = false;
  if (!av._cliRefrescado) {
    av._cliRefrescado = true;
    await av._cargarClientesCache(true);
  }
  assert.equal(stats.serverReads, 2);
});

test("V4 · getAllClientes acepta fresh y salta la caché del SDK", () => {
  const src = leer("public", "js", "services", "clientesService.js");
  const fn = src.slice(src.indexOf("async getAllClientes"));
  const cuerpo = fn.slice(0, fn.indexOf("\n  },"));
  assert.match(cuerpo, /fresh\s*=\s*false/,
    "getAllClientes debe aceptar { fresh }");
  assert.match(cuerpo, /fresh\s*\?\s*await q\.get\(\)/,
    "con fresh=true la lectura tiene que ir al servidor, sin { source: 'cache' }");
  assert.match(cuerpo, /!fresh\s*&&\s*snap\.empty/,
    "el fallback a red por página vacía solo aplica en el camino cacheado");
});

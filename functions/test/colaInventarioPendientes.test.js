// Bandeja de trabajo de bodega — hoy vive en Almacén · Hoy
// (public/almacen/index.html + js/pages/almacen-hoy.js; absorbe a la vieja
// inventario/pendientes.html, propuesta Almacén/Finanzas 2026-08 E1).
//
// La bandeja existe para que el rol `inventario` vea el trabajo que nace
// dentro de un contrato SIN darle el módulo Contratos. Ese contrato con la
// operación es fácil de romper sin darse cuenta —basta con volcar el doc
// entero en una fila— así que aquí se congelan los tres invariantes:
//
//   P1 — la proyección NO copia precios ni totales del contrato. Las líneas
//        de `equipos[]` traen `precio` en el doc; a la fila solo pasan modelo
//        y cantidad.
//   P2 — `inventario` gana el módulo 'almacen' pero NO 'contratos'
//        (js/core/modulos.js), y el rail tiene la entrada correspondiente.
//   P3 — el predicado de transición vive en UN solo lugar
//        (js/domain/transicionPendiente.js): la lista de contratos y la
//        bandeja no pueden volver a tener criterios distintos.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const noop = () => {};

// Contrato de ejemplo tal como sale de Firestore: con precios por línea y
// totales comerciales, que es justo lo que la bandeja no debe propagar.
const CONTRATO_SERIALES = {
  contrato_id: "ALQ20260805-01",
  cliente_nombre: "CLIENTE DEMO",
  cliente_id: "cli-1",
  estado: "aprobado",
  accion: "Nuevo",
  seriales_estado: "pendiente",
  equipos: [
    { modelo: "TC-508U", modelo_id: "m1", cantidad: 6, precio: 1250 },
    { modelo: "HP606", modelo_id: "m2", cantidad: 2, precio: 990 },
  ],
  seriales_count: 3,
  seriales_omitidos_count: 0,
  total_mensual: 8490,
  fecha_aprobacion: { toDate: () => new Date(Date.now() - 4 * 86400000) },
};

// ── Stub de Firestore: cadena collection().where().limit().get() ───────────
// Devuelve el snapshot que corresponda según el primer where de la query.
function fakeFirestore(porCampo) {
  const snap = (docs) => ({
    size: docs.length,
    docs,
    forEach: (cb) => docs.forEach(cb),
  });
  const doc = (id, data, subs = {}) => ({
    id,
    data: () => data,
    ref: {
      collection: (nombre) => ({
        where: () => ({ get: async () => snap(subs[nombre] || []) }),
        get: async () => snap(subs[nombre] || []),
      }),
    },
  });
  // `campo` = el primer where de la cadena; es la llave con la que el test
  // decide qué snapshot devolver.
  const query = (campo) => {
    const filas = () => porCampo[campo] || [];
    const q = {
      where: () => q,
      limit: () => q,
      get: async () => snap(filas().map((d) => doc(d.id, d.data, d.subs))),
      count: () => ({ get: async () => ({ data: () => ({ count: filas().length }) }) }),
    };
    return q;
  };
  return {
    collection: () => ({
      where: (c) => query(c),
      limit: () => query(""),
    }),
  };
}

function cargarServicio(porCampo = {}) {
  const ctx = {
    console,
    window: {},
    firebase: {
      firestore: () => fakeFirestore(porCampo),
      auth: () => ({ currentUser: { uid: "u1" } }),
    },
    sessionStorage: { getItem: () => null, setItem: noop },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "transicionPendiente.js"), ctx);
  vm.runInContext(leer("public", "js", "services", "colaInventarioService.js"), ctx);
  return ctx.window.ColaInventarioService;
}

// Los objetos nacen dentro del vm (otro realm): deepEqual los ve estructural-
// mente iguales pero no reference-equal. Se comparan por su forma serializada.
const plano = (v) => JSON.parse(JSON.stringify(v));

// ── P1: la proyección no lleva dinero ──────────────────────────────────────
test("la fila de la bandeja no copia precios ni totales del contrato", async () => {
  const svc = cargarServicio({
    seriales_estado: [{ id: "c1", data: CONTRATO_SERIALES }],
  });
  const filas = await svc.serialesPorAsignar();
  assert.equal(filas.length, 1);

  const fila = filas[0];
  const crudo = JSON.stringify(fila);
  assert.ok(!/precio/i.test(crudo), `la fila arrastró un precio: ${crudo}`);
  assert.ok(!crudo.includes("1250"), "la fila arrastró el precio unitario");
  assert.ok(!crudo.includes("8490"), "la fila arrastró el total del contrato");
  assert.ok(!/total/i.test(crudo), "la fila arrastró un total comercial");

  // Y sí lleva lo operativo.
  assert.equal(fila.contrato_id, "ALQ20260805-01");
  assert.deepEqual(plano(fila.equipos), [
    { modelo: "TC-508U", cantidad: 6 },
    { modelo: "HP606", cantidad: 2 },
  ]);
  assert.equal(fila.unidades, 8);
  assert.equal(fila.resueltos, 3);
});

test("unidades descuenta las canceladas por baja parcial", async () => {
  const svc = cargarServicio({
    seriales_estado: [{
      id: "c1",
      data: { ...CONTRATO_SERIALES, baja_cancelado_total: 3 },
    }],
  });
  const [fila] = await svc.serialesPorAsignar();
  assert.equal(fila.unidades, 5); // 8 - 3
});

test("no entra a la cola lo que no tiene nada que serializar", async () => {
  const svc = cargarServicio({
    seriales_estado: [
      { id: "sinEquipo", data: { ...CONTRATO_SERIALES, accion: "Renovación", renovacion_sin_equipo: true } },
      { id: "todoDeBaja", data: { ...CONTRATO_SERIALES, baja_cancelado_total: 8 } },
    ],
  });
  assert.equal((await svc.serialesPorAsignar()).length, 0);
});

test("la cola de cambios trae los seriales a reemplazar y su motivo", async () => {
  const svc = cargarServicio({
    seriales_cambio_pendiente: [{
      id: "c9",
      data: { ...CONTRATO_SERIALES, seriales_estado: "asignados" },
      subs: {
        seriales_cambios: [{
          id: "r1",
          data: () => ({
            estado: "pendiente",
            items: [{ serial: "25725A0542", modelo: "TC-508U" }],
            motivo_tipo: "equipo defectuoso",
            solicitado_at: { toDate: () => new Date(Date.now() - 86400000) },
          }),
        }],
      },
    }],
  });
  const [fila] = await svc.cambiosDeSerial();
  assert.equal(fila.tipo, "cambio");
  assert.deepEqual(plano(fila.cambio.items), [{ serial: "25725A0542", modelo: "TC-508U" }]);
  assert.equal(fila.cambio.motivo_tipo, "equipo defectuoso");
});

// ── P3: un solo predicado de transición ────────────────────────────────────
test("el predicado de transición es el compartido de js/domain", () => {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "transicionPendiente.js"), ctx);
  const TP = ctx.window.TransicionPendiente;

  const base = { estado: "activo", accion: "Renovación" };
  assert.equal(TP.contratoNecesitaTransicion(base), true);
  assert.equal(TP.contratoNecesitaTransicion({ ...base, transicion_mapeos_count: 1 }), false);
  assert.equal(TP.contratoNecesitaTransicion({ ...base, seriales_estado: "legacy" }), false);
  assert.equal(TP.contratoNecesitaTransicion({ ...base, renovacion_sin_equipo: true }), false);
  // El formulario pregunta si el original es de papel (origenLegacyChk): si la
  // respuesta es que sí, el equipo viejo no tiene ficha en el pool y la
  // pantalla de transición no tendría un solo saliente que ofrecer. Ignorar
  // esa respuesta dejaba 10 contratos pidiendo un paso imposible.
  assert.equal(TP.contratoNecesitaTransicion({ ...base, origen_tipo: "legacy" }), false);
  assert.equal(TP.contratoNecesitaTransicion({ ...base, origen_tipo: "ninguno" }), true);
  assert.equal(TP.contratoNecesitaTransicion({ ...base, origen_tipo: "interno" }), true);
  assert.equal(TP.contratoNecesitaTransicion({ ...base, estado: "borrador" }), false);
  assert.equal(TP.contratoNecesitaTransicion({ estado: "activo", codigo_tipo: "REEMP" }), true);
  assert.equal(TP.contratoNecesitaTransicion({ estado: "activo", accion: "Nuevo" }), false);

  // La lista de contratos ya no puede tener su propia copia del criterio.
  const lista = leer("public", "js", "pages", "contratos-list.js");
  assert.ok(lista.includes("TransicionPendiente.contratoNecesitaTransicion"),
    "contratos-list.js dejó de usar el predicado compartido");
  assert.ok(!/transicion_mapeos_count/.test(lista.replace(/\/\/.*$/gm, "")),
    "contratos-list.js volvió a inlinear el criterio de transición");
  // Y la página tiene que cargarlo, o el CTA truena en runtime.
  assert.ok(leer("public", "contratos", "index.html").includes("domain/transicionPendiente.js"),
    "contratos/index.html no carga js/domain/transicionPendiente.js");
});

// ── P2: visibilidad de módulos ─────────────────────────────────────────────
test("inventario ve el espacio Almacén pero no el módulo de contratos", () => {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "modulos.js"), ctx);
  const M = ctx.window.MODULOS;

  assert.ok(M.puedeVer("inventario", "almacen"), "inventario perdió el espacio Almacén");
  assert.ok(!M.puedeVer("inventario", "contratos"),
    "inventario ganó el módulo Contratos — la bandeja existe justo para evitarlo");
  assert.ok(M.puedeVer("administrador", "almacen"));
  // Roles comerciales: la bandeja es de bodega, no de ventas.
  assert.ok(!M.puedeVer("vendedor", "almacen"));
  assert.ok(!M.puedeVer("contabilidad", "almacen"));

  // El rail necesita la entrada o el módulo visible no lleva a ningún lado.
  const layout = leer("public", "js", "core", "layout.js");
  assert.ok(layout.includes("id: 'almacen'"), "el rail no tiene la entrada Almacén");
  assert.ok(layout.includes("/almacen/index.html"), "la entrada del rail no apunta al espacio");
});

test("la señal del home y la tarjeta apuntan al mismo módulo que existe", () => {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "modulos.js"), ctx);
  const M = ctx.window.MODULOS;

  const senales = leer("public", "js", "pages", "home-signals.js");
  // S15 se muestra solo si algún módulo de sig.modulo (string o lista — está
  // migrando de 'pendientes' a 'almacen') es visible para el rol.
  const s15 = senales.split("S15:")[1].split("},")[0];
  const modulos = [...s15.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    .filter((m) => ["almacen", "pendientes"].includes(m));
  assert.ok(modulos.length > 0, "S15 no declara módulo de gate");
  assert.ok(modulos.some((m) => M.puedeVer("inventario", m)),
    `S15 se gatea por '${modulos}', que inventario no tiene`);
  assert.ok(s15.includes("almacen/index.html"), "S15 no aterriza en el espacio Almacén");
  assert.match(senales, /inventario:\s*\['S15'/,
    "S15 salió de la fila de señales de inventario");
  assert.ok(senales.includes("countSerialesPorAsignar"), "S15 sin su conteo");
  assert.ok(leer("public", "js", "services", "senalesService.js").includes("countSerialesPorAsignar()"),
    "senalesService no expone el conteo que usa S15");

  // La tarjeta del home usa un módulo visible para inventario.
  assert.ok(leer("public", "index.html").includes('data-mod="almacen"'),
    "el home no tiene la tarjeta del espacio Almacén");
});

// ── Render de la bandeja (Almacén · Hoy) ───────────────────────────────────
function cargarPagina(datos, transicionesActivas = true) {
  const nodos = {};
  const nodo = (id) => (nodos[id] = nodos[id] || { innerHTML: "", textContent: "", style: {} });
  ["hoyGrupos", "hoyVacio", "avisoFallidas", "bodyAlmacen", "loader",
    "tab-hoy", "tab-existencias", "wsTabs-mount"].forEach(nodo);

  const ctx = {
    console,
    window: {},
    Date,
    URLSearchParams,
    location: { search: "", href: "https://app.local/almacen/index.html" },
    history: { replaceState: noop },
    URL,
    document: {
      addEventListener: (ev, cb) => { if (ev === "DOMContentLoaded") ctx._onReady = cb; },
      getElementById: (id) => nodos[id] || null,
      querySelector: () => ({ classList: { toggle: noop }, style: {} }),
      querySelectorAll: () => [],
    },
    ColaInventarioService: {
      todo: async () => datos,
      refrescarBadge: noop,
      COLA_TRANSICIONES_ACTIVA: transicionesActivas,
    },
    // Cargas del pool/conteos de la bandeja: vacías (los invariantes de esas
    // colas se prueban en sus propios suites del pool).
    EquiposPoolService: {
      listar: async () => [],
      contarBodegaPorModelo: async () => new Map(),
    },
    ModelosService: { getModelos: async () => [] },
    InventarioService: { getInventarioActual: async () => [] },
    StockAgg: { build: () => [], diferencias: () => [] },
    WorkspaceTabs: { render: noop, setActive: noop, setBadge: noop },
    firebase: {
      firestore: () => ({
        collection: () => ({
          limit: () => ({}),   // sin .count → contarSinVerificar devuelve null
          where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
        }),
      }),
      auth: () => ({ currentUser: { uid: "u1" } }),
    },
    ROLES: { ADMIN: "administrador", INVENTARIO: "inventario", GERENTE: "gerente" },
    Toast: { show: noop },
    canRole: (rol) => ["administrador", "inventario", "recepcion", "vendedor", "gerente"].includes(rol),
    verificarAccesoYAplicarVisibilidad: (cb) => { ctx._init = cb; },
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "pages", "almacen-hoy.js"), ctx);
  // DOMContentLoaded → verificarAccesoYAplicarVisibilidad(init) → ctx._init.
  if (ctx._onReady) ctx._onReady();
  return { api: ctx.window.AlmacenHoy, nodos, init: ctx._init, ctx };
}

test("la bandeja muestra contrato y progreso, nunca el precio", async () => {
  const svc = cargarServicio({ seriales_estado: [{ id: "c1", data: CONTRATO_SERIALES }] });
  const filas = await svc.serialesPorAsignar();
  const { api, nodos } = cargarPagina({ seriales: filas.map(plano), cambios: [], transiciones: [], fallidas: [] });

  await api.recargar();
  const html = nodos.hoyGrupos.innerHTML;
  assert.match(html, /ALQ20260805-01/);
  assert.match(html, /CLIENTE DEMO/);
  assert.match(html, /3\/8/);              // progreso de seriales
  assert.match(html, /4 días/);            // antigüedad de la cola
  assert.match(html, /contratos\/seriales\.html\?id=c1/);
  assert.ok(!html.includes("1250"), "la bandeja pintó el precio unitario");
  assert.ok(!html.includes("8490"), "la bandeja pintó el total del contrato");
});

test("sin trabajo pendiente la bandeja lo dice en vez de mostrar grupos vacíos", async () => {
  const { api, nodos } = cargarPagina({ seriales: [], cambios: [], transiciones: [], fallidas: [] });
  await api.recargar();
  assert.equal(nodos.hoyVacio.style.display, "");
  assert.equal(nodos.hoyGrupos.innerHTML, "");
});

test("una cola que falló se avisa en vez de contarse como cero", async () => {
  const { api, nodos } = cargarPagina({
    seriales: [], cambios: [], transiciones: [], fallidas: ["cambios"],
  });
  await api.recargar();
  assert.equal(nodos.avisoFallidas.style.display, "");
  assert.match(nodos.avisoFallidas.innerHTML, /cambios/);
});

// La cola de transiciones va apagada mientras se tría el atraso (42 contratos
// que nadie ha trabajado nunca). Apagada = ni se consulta ni se ve.
test("con la cola de transiciones apagada no se consulta ni se cuenta", async () => {
  const svc = cargarServicio({
    seriales_estado: [{ id: "c1", data: CONTRATO_SERIALES }],
    seriales_cambio_pendiente: [],
  });
  assert.equal(svc.COLA_TRANSICIONES_ACTIVA, false,
    "la cola de transiciones se encendió sin triar el atraso");

  let llamada = false;
  svc.transicionesPorRegistrar = async () => { llamada = true; return [{ tipo: "transicion" }]; };
  const datos = await svc.todo();
  assert.equal(llamada, false, "se consultó la cola apagada (300 docs por carga)");
  assert.equal(datos.transiciones.length, 0);
  assert.equal(datos.fallidas.length, 0, "una cola apagada no es una cola caída");

  // Y encendida vuelve a entrar, sin tocar nada más.
  svc.COLA_TRANSICIONES_ACTIVA = true;
  const conCola = await svc.todo();
  assert.equal(conCola.transiciones.length, 1);
});

test("sin permiso de bodega la bandeja no se carga", () => {
  const { nodos, init, ctx } = cargarPagina({ seriales: [], cambios: [], transiciones: [], fallidas: [] });
  ctx.canRole = () => false;   // tecnico tampoco gestiona seriales
  init("tecnico");
  assert.match(nodos.bodyAlmacen.innerHTML, /administración e inventario/);
});

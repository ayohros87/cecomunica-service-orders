// Bandeja "Pendientes de inventario" (public/inventario/pendientes.html).
//
// La bandeja existe para que el rol `inventario` vea el trabajo que nace
// dentro de un contrato SIN darle el módulo Contratos. Ese contrato con la
// operación es fácil de romper sin darse cuenta —basta con volcar el doc
// entero en una fila— así que aquí se congelan los tres invariantes:
//
//   P1 — la proyección NO copia precios ni totales del contrato. Las líneas
//        de `equipos[]` traen `precio` en el doc; a la fila solo pasan modelo
//        y cantidad.
//   P2 — `inventario` gana el módulo 'pendientes' pero NO 'contratos'
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
test("inventario ve la bandeja pero no el módulo de contratos", () => {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "modulos.js"), ctx);
  const M = ctx.window.MODULOS;

  assert.ok(M.puedeVer("inventario", "pendientes"), "inventario perdió la bandeja");
  assert.ok(!M.puedeVer("inventario", "contratos"),
    "inventario ganó el módulo Contratos — la bandeja existe justo para evitarlo");
  assert.ok(M.puedeVer("administrador", "pendientes"));
  // Roles comerciales: la bandeja es de bodega, no de ventas.
  assert.ok(!M.puedeVer("vendedor", "pendientes"));
  assert.ok(!M.puedeVer("contabilidad", "pendientes"));

  // El rail necesita la entrada o el módulo visible no lleva a ningún lado.
  const layout = leer("public", "js", "core", "layout.js");
  assert.ok(layout.includes("id: 'pendientes'"), "el rail no tiene la entrada Pendientes");
  assert.ok(layout.includes("/inventario/pendientes.html"), "la entrada del rail no apunta a la página");
});

test("la señal del home y la tarjeta apuntan al mismo módulo que existe", () => {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "modulos.js"), ctx);
  const M = ctx.window.MODULOS;

  const senales = leer("public", "js", "pages", "home-signals.js");
  // S15 se muestra solo si MODULOS.puedeVer(rol, sig.modulo): un módulo que
  // nadie tiene la deja invisible en silencio.
  const s15 = senales.split("S15:")[1].split("},")[0];
  const modulo = s15.match(/modulo:\s*'([^']+)'/)[1];
  assert.ok(M.puedeVer("inventario", modulo),
    `S15 se gatea por el módulo '${modulo}', que inventario no tiene`);
  assert.match(senales, /inventario:\s*\['S15'/,
    "S15 salió de la fila de señales de inventario");
  assert.ok(senales.includes("countSerialesPorAsignar"), "S15 sin su conteo");
  assert.ok(leer("public", "js", "services", "senalesService.js").includes("countSerialesPorAsignar()"),
    "senalesService no expone el conteo que usa S15");

  // La tarjeta del home usa el mismo id de módulo para su visibilidad.
  assert.ok(leer("public", "index.html").includes(`data-mod="${modulo}"`),
    "el home no tiene tarjeta para la bandeja");
});

// ── Render de la tabla ─────────────────────────────────────────────────────
function cargarPagina(datos) {
  const nodos = {};
  const nodo = (id) => (nodos[id] = nodos[id] || { innerHTML: "", textContent: "", style: {} });
  ["tablaPendientes", "estadoVacio", "wrapTabla", "resumenPendientes", "loader",
    "avisoFallidas", "bodyPendientes", "cola-todas", "cola-seriales", "cola-cambio",
    "cola-transicion"].forEach(nodo);

  let onReady = null;
  const ctx = {
    console,
    window: {},
    Date,
    document: {
      addEventListener: (ev, cb) => { if (ev === "DOMContentLoaded") onReady = cb; },
      getElementById: (id) => nodos[id] || null,
      querySelector: () => ({ classList: { toggle: noop } }),
      querySelectorAll: () => [],
    },
    ColaInventarioService: { todo: async () => datos, refrescarBadge: noop },
    Toast: { show: noop },
    canRole: (rol) => ["administrador", "inventario", "recepcion", "vendedor", "gerente"].includes(rol),
    verificarAccesoYAplicarVisibilidad: (cb) => { ctx._init = cb; },
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "pages", "inventario-pendientes.js"), ctx);
  if (onReady) onReady();
  return { api: ctx.window.ColaInventario, nodos, init: ctx._init };
}

test("la tabla muestra modelo y cantidad, nunca el precio", async () => {
  const svc = cargarServicio({ seriales_estado: [{ id: "c1", data: CONTRATO_SERIALES }] });
  const filas = await svc.serialesPorAsignar();
  const { api, nodos } = cargarPagina({ seriales: filas, cambios: [], transiciones: [], fallidas: [] });

  await api.recargar();
  const html = nodos.tablaPendientes.innerHTML;
  assert.match(html, /ALQ20260805-01/);
  assert.match(html, /TC-508U/);
  assert.match(html, /×6/);
  assert.match(html, /3\/8/);              // progreso de seriales
  assert.match(html, /4 días/);            // antigüedad de la cola
  assert.match(html, /contratos\/seriales\.html\?id=c1/);
  assert.ok(!html.includes("1250"), "la tabla pintó el precio unitario");
  assert.ok(!html.includes("8490"), "la tabla pintó el total del contrato");
  assert.equal(nodos.resumenPendientes.textContent, "1 pendiente");
});

test("cada tarjeta de cola filtra la tabla y se puede soltar", async () => {
  const datos = {
    seriales: [{ tipo: "seriales", doc_id: "s1", contrato_id: "ALQ-SER", cliente_nombre: "A",
      accion: "Nuevo", equipos: [{ modelo: "TC-508U", cantidad: 1 }], unidades: 1, resueltos: 0, at: Date.now() }],
    cambios: [{ tipo: "cambio", doc_id: "k1", contrato_id: "ALQ-CAM", cliente_nombre: "B",
      accion: "Nuevo", equipos: [], unidades: 1, resueltos: 1, at: Date.now(),
      cambio: { items: [{ serial: "ABC123", modelo: "TC-508U" }], motivo_tipo: "defectuoso", motivo: "" } }],
    transiciones: [{ tipo: "transicion", doc_id: "t1", contrato_id: "ALQ-TRA", cliente_nombre: "C",
      accion: "Renovación", equipos: [{ modelo: "TK-3000", cantidad: 2 }], unidades: 2, resueltos: 2, at: Date.now() }],
    fallidas: [],
  };
  const { api, nodos } = cargarPagina(datos);
  await api.recargar();
  assert.equal(nodos.resumenPendientes.textContent, "3 pendientes");
  assert.equal(nodos["cola-todas"].textContent, "3");

  api.setCola("cambio");
  assert.match(nodos.tablaPendientes.innerHTML, /ALQ-CAM/);
  assert.ok(!nodos.tablaPendientes.innerHTML.includes("ALQ-SER"));
  assert.equal(nodos.resumenPendientes.textContent, "1 pendiente");

  api.setCola("cambio"); // segundo clic = soltar el filtro
  assert.equal(nodos.resumenPendientes.textContent, "3 pendientes");
});

test("sin trabajo pendiente la bandeja lo dice en vez de mostrar una tabla vacía", async () => {
  const { api, nodos } = cargarPagina({ seriales: [], cambios: [], transiciones: [], fallidas: [] });
  await api.recargar();
  assert.equal(nodos.wrapTabla.style.display, "none");
  assert.match(nodos.estadoVacio.innerHTML, /Bodega al día/);
});

test("una cola que falló se avisa en vez de contarse como cero", async () => {
  const { api, nodos } = cargarPagina({
    seriales: [], cambios: [], transiciones: [], fallidas: ["cambios"],
  });
  await api.recargar();
  assert.equal(nodos.avisoFallidas.style.display, "");
  assert.match(nodos.avisoFallidas.innerHTML, /cambios/);
});

test("sin permiso de gestionar seriales la bandeja no se carga", () => {
  const { nodos, init } = cargarPagina({ seriales: [], cambios: [], transiciones: [], fallidas: [] });
  init("tecnico");
  assert.match(nodos.bodyPendientes.innerHTML, /Acceso restringido/);
});

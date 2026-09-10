const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const leer = file => fs.readFileSync(path.join(__dirname, '../../public/js', file), 'utf8');

function servicio(registros, agg) {
  const consultas = [];
  const firestore = () => ({ collection: col => query(col) });
  firestore.FieldPath = { documentId: () => '__name__' };
  function query(col, filtros = [], cursor = null, limite = Infinity) {
    return {
      where: (...f) => query(col, [...filtros, f], cursor, limite),
      orderBy: () => query(col, filtros, cursor, limite),
      startAfter: c => query(col, filtros, c, limite),
      limit: n => query(col, filtros, cursor, n),
      async get(opts) {
        consultas.push({ col, filtros, opts });
        const docs = registros.filter(r => r.col === col && (!cursor || r.id > cursor.id)
          && filtros.every(([f, op, v]) => op === 'in' ? v.includes(r[f]) : r[f] === v))
          .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limite)
          .map(r => ({ id: r.id, data: () => r }));
        return { docs, size: docs.length };
      },
    };
  }
  const ctx = vm.createContext({ window: { FbAgg: agg }, firebase: { firestore }, URLSearchParams,
    sessionStorage: {}, console: { warn() {} } });
  vm.runInContext(leer('services/aprobacionesService.js'), ctx);
  return { S: ctx.window.AprobacionesService, consultas };
}

test('conteo completo, sin límite de 50, excluye eliminados y otros estados; incluye docs antiguos sin deleted', async () => {
  const registros = Array.from({ length: 123 }, (_, i) => ({ col: 'gestiones', id: `g${String(i).padStart(3, '0')}`,
    estado: 'pendiente_aprobacion', tipo: 'baja', ...(i < 10 ? { deleted: true } : {}) }));
  registros.push({ col: 'gestiones', id: 'firma', estado: 'pendiente_firma' });
  registros.push({ col: 'gestiones', id: 'anulada', estado: 'anulada' });
  const { S, consultas } = servicio(registros);
  assert.equal(await S.contar('gestiones'), 113);
  assert.equal(consultas.length, 3);
  assert.ok(consultas.every(c => c.opts.source === 'server'));
});

// 2026-09-10: la cola ya no se recorta por rol. Las reglas dejan aprobar
// CUALQUIER gestión a administración y gerencia (esAprobacionGestion), y desde
// que TODO reemplazo pasa por aprobación —no solo la excepción de equipo
// propio sin garantía— esconderle los reemplazos a gerencia dejaba media cola
// invisible para quien sí podía despacharla.
test('la cola trae todas las gestiones pendientes, sea quien sea el que mira', async () => {
  const registros = ['baja', 'aumento', 'reemplazo'].map(tipo => ({ col: 'gestiones', id: tipo, tipo, estado: 'pendiente_aprobacion' }));
  const { S } = servicio(registros);
  assert.equal(await S.contar('gestiones', 'gerente'), 3);
  assert.equal(await S.contar('gestiones', 'administrador'), 3);
  assert.deepEqual((await S.listar('gestiones', { rol: 'gerente' })).docs.map(d => d.tipo),
    ['aumento', 'baja', 'reemplazo']);
});

test('agregados restan deleted true y no descargan documentos', async () => {
  const calls = [];
  const { S, consultas } = servicio([], { disponible: true, count: async (col, filtros) => {
    calls.push({ col, filtros }); return filtros.some(f => f[0] === 'deleted') ? 4 : 19;
  } });
  assert.equal(await S.contar('contratos'), 15);
  assert.equal(consultas.length, 0);
  assert.equal(calls.length, 2);
});

test('si falla el agregado, cuenta la cola paginada; enlaces conservan cliente, expediente y cola', async () => {
  const { S } = servicio([{ col: 'contratos', id: 'c1', estado: 'pendiente_aprobacion' }],
    { disponible: true, count: async () => { throw new Error('sin agregado'); } });
  assert.equal(await S.contar('contratos'), 1);
  const enlace = new URLSearchParams(S.enlace('gestiones', { id: 'g&1', cliente_id: 'cli 1' }).slice(1));
  assert.equal(enlace.get('id'), 'cli 1');
  assert.equal(enlace.get('g'), 'g&1');
  assert.equal(enlace.get('aprobaciones'), 'gestiones');
  assert.equal(S.enlace('contratos', { id: 'c1' }), null);
});

test('la carga inicial de ficha recibe gestiones, aunque el catálogo devuelva un objeto', async () => {
  const gestiones = [{ id: 'g1', estado: 'pendiente_aprobacion' }];
  const nodos = new Map();
  const elemento = id => {
    if (!nodos.has(id)) nodos.set(id, { innerHTML: '', classList: { add() {}, remove() {} } });
    return nodos.get(id);
  };
  const errores = [];
  const ctx = vm.createContext({ window: { scrollTo() {}, ModelosService: {} }, console,
    document: { getElementById: elemento },
    ClientesService: { getCliente: async () => ({ id: 'cli', nombre: 'Cliente' }) },
    EquiposPoolService: { listarPorCliente: async () => [] },
    GestionesService: { listarPorCliente: async () => gestiones },
    ModelosService: { catalogo: async () => ({ modelos: ['X'] }) },
    firebase: { firestore: () => ({ collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) }) },
    Toast: { show: msg => errores.push(msg) },
    ROLES: { VENDEDOR: 'vendedor' },
  });
  ctx.window.ModelosService = ctx.ModelosService;
  vm.runInContext(leer('pages/clientes-centro.js'), ctx);
  const C = ctx.window.Centro;
  for (const fn of ['_pintarEncabezado', 'pintarKpis', 'pintarSenales', 'pintarAcciones', 'pintarContratos',
    'pintarEquipos', 'pintarGestiones', 'armarMenu', '_abrirBloques', '_escucharGestiones', '_escucharCliente']) C[fn] = () => {};
  await C.abrir('cli', { push: false });
  assert.deepEqual(errores, []);
  assert.equal(C.gestiones, gestiones);
});

// Home · señales de cotizaciones: una cotización eliminada (soft delete,
// `deleted: true`) no cuenta en "por aprobar", "enviadas" ni "mis activas".
// Nació el 2026-09-29: COT-2026-0117 llevaba una semana borrada y el home
// seguía pidiendo su visto bueno. Se prueban las dos rutas de _count(): el
// agregado del servidor (window.FbAgg) y el scan compat de respaldo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REGISTROS = [
  { id: 'c1', estado: 'borrador', requiere_aprobacion: true, deleted: false, creado_por_uid: 'u1' },
  { id: 'c2', estado: 'borrador', requiere_aprobacion: true, deleted: true, creado_por_uid: 'u1' }, // la COT-2026-0117
  { id: 'c3', estado: 'enviada', deleted: false, creado_por_uid: 'u1' },
  { id: 'c4', estado: 'enviada', deleted: true, creado_por_uid: 'u1' },
  { id: 'c5', estado: 'aprobada', deleted: false, creado_por_uid: 'u2' },
];

const cumple = (r, [campo, op, valor]) => (op === 'in' ? valor.includes(r[campo]) : r[campo] === valor);

function montar({ agregados }) {
  const specs = [];
  function query(filtros = []) {
    return {
      where: (...f) => query([...filtros, f]),
      limit: () => query(filtros),
      get: async () => {
        const docs = REGISTROS.filter(r => filtros.every(f => cumple(r, f))).map(r => ({ id: r.id, data: () => r }));
        return { docs, size: docs.length, forEach: fn => docs.forEach(fn) };
      },
    };
  }
  const ctx = vm.createContext({ console, firebase: { firestore: () => ({ collection: () => query() }) } });
  ctx.window = ctx;
  if (agregados) {
    ctx.FbAgg = {
      disponible: true,
      count: async (col, wheres) => { specs.push(wheres); return REGISTROS.filter(r => wheres.every(f => cumple(r, f))).length; },
    };
  }
  for (const file of ['domain/pendientes.js', 'services/senalesService.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js', file), 'utf8'), ctx);
  }
  return { service: ctx.SenalesService, specs };
}

for (const agregados of [true, false]) {
  const ruta = agregados ? 'agregado del servidor' : 'scan compat';
  test(`las cotizaciones eliminadas no cuentan en el home (${ruta})`, async () => {
    const { service, specs } = montar({ agregados });
    assert.equal(await service.countCotizacionesPorAprobar(), 1, 'por aprobar: solo la viva');
    assert.equal(await service.countCotizacionesPorEstado('enviada'), 1, 'enviadas: solo la viva');
    assert.equal(await service.countMisCotizacionesActivas('u1'), 2, 'mis activas: borrador + enviada vivas');
    if (agregados) {
      assert.equal(specs.length, 3, 'un solo agregado por señal: sin restas ni backfill');
      assert.ok(specs.every(w => w.some(([c, op, v]) => c === 'deleted' && op === '==' && v === false)),
        'cada agregado filtra deleted == false');
    }
  });
}

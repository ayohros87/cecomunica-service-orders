const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function montar(registros, fallo = false) {
  const lecturas = [];
  function query(filtros = [], cursor = null, limit = Infinity) {
    return {
      where: (...f) => query([...filtros, f], cursor, limit),
      orderBy: () => query(filtros, cursor, limit),
      startAfter: c => query(filtros, c, limit),
      limit: n => query(filtros, cursor, n),
      get: async opts => {
        if (fallo) throw new Error('sin red');
        lecturas.push(opts);
        const docs = registros.filter(r => (!cursor || r.id > cursor.id)
          && filtros.every(([campo, , valor]) => r[campo] === valor))
          .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit)
          .map(r => ({ id: r.id, data: () => r }));
        return { docs, size: docs.length };
      },
    };
  }
  const firestore = () => ({ collection: () => query() });
  firestore.FieldPath = { documentId: () => '__name__' };
  const ctx = vm.createContext({ console, firebase: { firestore } });
  ctx.window = ctx;
  for (const file of ['domain/pendientes.js', 'services/senalesService.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js', file), 'utf8'), ctx);
  }
  return { service: ctx.SenalesService, lecturas };
}

test('lista por asignar atraviesa páginas excluidas y ordena las vivas por espera', async () => {
  const registros = Array.from({ length: 100 }, (_, i) => ({
    id: `a${String(i).padStart(3, '0')}`, estado_reparacion: 'POR ASIGNAR',
    ...(i < 50 ? { eliminado: true } : { tipo_de_servicio: 'DEVOLUCION' }),
  }));
  registros.push(
    { id: 'b1', estado_reparacion: 'POR ASIGNAR', cliente: 'Reciente', fecha_creacion: new Date(Date.now() - 2 * 86400000) },
    { id: 'b2', estado_reparacion: 'POR ASIGNAR', cliente_nombre: 'Antigua', tipo_de_servicio: 'REPARACION', fecha_entrada: new Date(Date.now() - 10 * 86400000) },
    { id: 'b3', estado_reparacion: 'ASIGNADO', cliente_nombre: 'Ya asignada' },
  );
  const { service, lecturas } = montar(registros);
  const rows = await service.listOrdenesPorAsignar();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'b2');
  assert.equal(rows[0].cliente, 'Antigua');
  assert.equal(rows[0].tipo, 'REPARACION');
  assert.equal(rows[0].dias, 10);
  assert.equal(rows[1].cliente, 'Reciente');
  assert.equal(rows[1].dias, 2);
  assert.equal(lecturas.length, 2);
  assert.ok(lecturas.every(o => o.source === 'server'));
});

test('lista vacía y fallo de red son resultados distintos', async () => {
  assert.equal((await montar([]).service.listOrdenesPorAsignar()).length, 0);
  await assert.rejects(montar([], true).service.listOrdenesPorAsignar(), /sin red/);
});

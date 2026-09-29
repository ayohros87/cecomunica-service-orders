// Home · "Contratos por firmar" (FIR/FIRV): reemplaza a "Contratos por
// activar", que contaba TODO contrato en 'aprobado' (203 el 2026-09-29) y no
// pedía nada. Solo cuenta la cola real: seriales asignados, lleva firma, sin
// firmar, sin entregar y vivo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REGISTROS = [
  { id: 'a1', contrato_id: 'ALQ20260826-02', estado: 'aprobado', seriales_estado: 'asignados', tipo_contrato: 'Alquiler', codigo_tipo: 'ALQ', os_count: 1, cliente_id: 'k1', creado_por_uid: 'u1' },
  { id: 'a2', contrato_id: 'PROP20260820-01', estado: 'aprobado', seriales_estado: 'asignados', tipo_contrato: 'Propio', os_count: 0, cliente_id: 'k2', creado_por_uid: 'u2' },
  { id: 'l1', estado: 'aprobado', seriales_estado: 'legacy', tipo_contrato: 'Alquiler' },             // histórico
  { id: 'r1', estado: 'aprobado', seriales_estado: 'asignados', tipo_contrato: 'Reemplazo', codigo_tipo: 'REEMP' }, // no lleva firma
  { id: 'd1', estado: 'aprobado', seriales_estado: 'asignados', tipo_contrato: 'Demo' },               // no lleva firma
  { id: 'e1', estado: 'aprobado', seriales_estado: 'asignados', tipo_contrato: 'Alquiler', entrega_confirmada: true }, // ya entregado
  { id: 'x1', estado: 'aprobado', seriales_estado: 'asignados', tipo_contrato: 'Alquiler', deleted: true },
  { id: 'p1', estado: 'aprobado', seriales_estado: 'pendiente', tipo_contrato: 'Alquiler' },          // es de bodega (S15)
  { id: 'v1', estado: 'activo', seriales_estado: 'asignados', tipo_contrato: 'Alquiler', firmado: true },
];

function montar({ usuarios } = {}) {
  function query(filtros = []) {
    return {
      where: (campo, op, valor) => query([...filtros, [campo, op, valor]]),
      limit: () => query(filtros),
      get: async () => {
        const docs = REGISTROS.filter(r => filtros.every(([c, , v]) => r[c] === v)).map(r => ({ id: r.id, data: () => r }));
        return { docs, size: docs.length, forEach: fn => docs.forEach(fn) };
      },
    };
  }
  const ctx = vm.createContext({ console, firebase: { firestore: () => ({ collection: () => query() }) } });
  ctx.window = ctx;
  if (usuarios) ctx.UsuariosService = { getUsuariosByIds: usuarios };
  for (const file of ['domain/pendientes.js', 'domain/contratoFirma.js', 'services/senalesService.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js', file), 'utf8'), ctx);
  }
  return vm.runInContext('SenalesService', ctx);
}

test('solo cuenta los contratos que de verdad esperan la firma del cliente', async () => {
  const s = montar();
  const filas = await s.listContratosPorFirmar();
  assert.deepEqual([...filas.map(f => f.id)].sort(), ['a1', 'a2']);
  assert.equal(await s.countContratosPorFirmar(), 2);
  const a1 = filas.find(f => f.id === 'a1');
  assert.equal(a1.con_orden, true, 'con orden: la firma tranca la entrega');
  assert.equal(a1.cliente_id, 'k1', 'la fila sabe a qué ficha del Centro ir');
});

test('el vendedor solo ve los contratos que elaboró', async () => {
  const s = montar();
  assert.deepEqual([...(await s.listContratosPorFirmar({ uid: 'u2' })).map(f => f.id)], ['a2']);
  assert.equal(await s.countContratosPorFirmar({ uid: 'u1' }), 1);
});


// La firma la pide el vendedor: en la vista de supervisión (gerencia, sin uid)
// cada fila dice de quién es; un fallo leyendo usuarios no tumba la cola.
test('la vista de supervisión nombra al vendedor de cada contrato', async () => {
  const s = montar({ usuarios: async () => [{ id: 'u1', nombre: 'Elvia Onodera' }, { id: 'u2', email: 'salomon@x.com' }] });
  const filas = await s.listContratosPorFirmar();
  assert.equal(filas.find(f => f.id === 'a1').vendedor, 'Elvia Onodera');
  assert.equal(filas.find(f => f.id === 'a2').vendedor, 'salomon');
});

test('si no se pueden leer los usuarios, la cola sale igual sin nombres', async () => {
  const s = montar({ usuarios: async () => { throw new Error('sin permiso'); } });
  const filas = await s.listContratosPorFirmar();
  assert.equal(filas.length, 2);
  assert.ok(filas.every(f => !f.vendedor));
});

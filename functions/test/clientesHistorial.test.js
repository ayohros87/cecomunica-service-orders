// Historial de la ficha del cliente: diff de campos auditados y atribución
// del editor (domain/clientesHistorial). Sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diffCliente, atribucion, CAMPOS_AUDITADOS } = require("../src/domain/clientesHistorial");

const ts = (ms) => ({ toMillis: () => ms });

test("cambio de representante legal: antes y después quedan en el diff", () => {
  const d = diffCliente(
    { representante: "Juan Pérez", representante_cedula: "8-111-111" },
    { representante: "María Gómez", representante_cedula: "8-222-222" },
  );
  assert.deepEqual(d, {
    representante: { antes: "Juan Pérez", despues: "María Gómez" },
    representante_cedula: { antes: "8-111-111", despues: "8-222-222" },
  });
});

test("los derivados NO se auditan: solo tokens/norm/updated_* → null", () => {
  const base = { nombre: "ACME", representante: "Juan" };
  const d = diffCliente(
    { ...base, searchTokens: ["ac"], nombre_norm: "acme", updated_at: ts(1), updated_by: "u1" },
    { ...base, searchTokens: ["ac", "acm"], nombre_norm: "acme", updated_at: ts(2), updated_by: "u2" },
  );
  assert.equal(d, null);
  assert.ok(!CAMPOS_AUDITADOS.includes("searchTokens"));
  assert.ok(!CAMPOS_AUDITADOS.includes("updated_by"));
});

test("undefined, null y '' son el mismo vacío — no cuentan como cambio", () => {
  assert.equal(diffCliente({ nombre: "ACME" }, { nombre: "ACME", representante: "" }), null);
  assert.equal(diffCliente({ nombre: "ACME", email: null }, { nombre: "ACME", email: "" }), null);
});

test("vacío → valor sí es cambio, con antes:null", () => {
  const d = diffCliente({ nombre: "ACME" }, { nombre: "ACME", representante: "Ana Ruiz" });
  assert.deepEqual(d, { representante: { antes: null, despues: "Ana Ruiz" } });
});

test("booleanos y arrays: itbms_exento y tags se comparan bien", () => {
  const d = diffCliente(
    { itbms_exento: false, tags: ["vip"] },
    { itbms_exento: true, tags: ["vip", "gob"] },
  );
  assert.deepEqual(d.itbms_exento, { antes: false, despues: true });
  assert.deepEqual(d.tags, { antes: ["vip"], despues: ["vip", "gob"] });
  // mismo array → sin cambio
  assert.equal(diffCliente({ tags: ["a", "b"] }, { tags: ["a", "b"] }), null);
});

test("alta (before null): todo campo con valor aparece con antes:null", () => {
  const d = diffCliente(null, { nombre: "ACME", ruc: "123" });
  assert.deepEqual(d.nombre, { antes: null, despues: "ACME" });
  assert.deepEqual(d.ruc, { antes: null, despues: "123" });
});

test("atribución: updated_by vale solo si ESTA escritura estampó updated_at", () => {
  // La UI estampa: updated_at cambió → se le atribuye a u2.
  assert.equal(atribucion(
    { representante: "Juan", updated_at: ts(1000), updated_by: "u1" },
    { representante: "María", updated_at: ts(2000), updated_by: "u2" },
  ), "u2");
  // Script admin que NO estampa: updated_at idéntico → el u1 viejo NO carga
  // con la culpa; atribución desconocida.
  assert.equal(atribucion(
    { representante: "Juan", updated_at: ts(1000), updated_by: "u1" },
    { representante: "María", updated_at: ts(1000), updated_by: "u1" },
  ), null);
});

test("atribución del soft-delete: deleted_by manda sobre updated_by", () => {
  assert.equal(atribucion(
    { deleted: false, updated_at: ts(1), updated_by: "u1" },
    { deleted: true, deleted_by: "u9", updated_at: ts(2), updated_by: "u1" },
  ), "u9");
});

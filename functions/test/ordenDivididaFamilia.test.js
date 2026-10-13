// lib/ordenDividida.familiaDe: sube a la raíz por `dividida_de` y baja por
// `dividida_en` (una hija puede volver a dividirse). Firestore se simula
// sobre la instancia real de `db` (solo `collection().doc().get()`), sin red.
//
// Corre con `npm test` (node --test).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-orden-dividida" });
const { db } = require("../src/lib/admin");

function simularOrdenes(docs) {
  const lecturas = [];
  db.collection = (col) => ({
    doc: (id) => ({
      get: async () => {
        lecturas.push(`${col}/${id}`);
        const d = docs[id];
        return { exists: !!d, data: () => d };
      },
    }),
  });
  return lecturas;
}

test("familiaDe · sin dividir: [] y cero lecturas", async () => {
  const lecturas = simularOrdenes({});
  const { familiaDe } = require("../src/lib/ordenDividida");
  assert.deepEqual(await familiaDe("X", { tipo_de_servicio: "PROGRAMACIÓN" }), []);
  assert.equal(lecturas.length, 0);
});

test("familiaDe · desde una nieta sube a la raíz y trae a toda la familia una sola vez", async () => {
  const docs = {
    M:  { estado_reparacion: "POR ASIGNAR", dividida_en: ["H1", "H2"] },
    H1: { estado_reparacion: "ENTREGADO AL CLIENTE", dividida_de: "M", dividida_en: ["N1"] },
    H2: { estado_reparacion: "ASIGNADO", dividida_de: "M" },
    N1: { estado_reparacion: "ENTREGADO AL CLIENTE", dividida_de: "H1" },
  };
  const lecturas = simularOrdenes(docs);
  const { familiaDe, hermanasPendientes } = require("../src/lib/ordenDividida");
  const fam = await familiaDe("N1", docs.N1);
  assert.deepEqual(fam.map(f => f.id).sort(), ["H1", "H2", "M", "N1"]);
  assert.equal(new Set(lecturas).size, lecturas.length, "cada doc se lee una sola vez");
  assert.ok(!lecturas.includes("ordenes_de_servicio/N1"), "la orden en mano no se relee");
  const { pendientes } = await hermanasPendientes("N1", docs.N1);
  assert.deepEqual(pendientes.sort(), ["H2", "M"]);
});

test("familiaDe · una madre cuya hija ya no existe no se cae", async () => {
  const docs = { M: { estado_reparacion: "ENTREGADO AL CLIENTE", dividida_en: ["H1", "borrada"] }, H1: { estado_reparacion: "ENTREGADO AL CLIENTE", dividida_de: "M" } };
  simularOrdenes(docs);
  const { hermanasPendientes } = require("../src/lib/ordenDividida");
  const { familia, pendientes } = await hermanasPendientes("M", docs.M);
  assert.equal(familia.length, 3);
  assert.deepEqual(pendientes, []);
});

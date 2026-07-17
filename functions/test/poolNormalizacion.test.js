// Guardia de sincronía de la normalización del pool de equipos.
//
// La normalización de seriales/modelos existe DUPLICADA a propósito (no hay
// build step que comparta código entre navegador y functions):
//   · functions/src/domain/equiposPool.js       (Admin SDK, triggers)
//   · public/js/services/equiposPoolService.js  (navegador)
// Una divergencia produce docs duplicados del mismo equipo físico en
// equipos_pool. Este test evalúa el archivo del frontend en un sandbox y
// compara ambas implementaciones sobre un corpus de entradas reales y
// adversariales. Si tocas una, este test te obliga a tocar las dos.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Requerir equiposPool arrastra lib/admin, que exige una app inicializada.
// projectId dummy: nada toca la red mientras no se use Firestore.
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-sync" });
const backend = require("../src/domain/equiposPool");

// El servicio del navegador se evalúa en un sandbox con stubs mínimos. Los
// métodos que tocan `firebase` no se llaman aquí — solo la normalización pura.
function cargarFrontend() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "services", "equiposPoolService.js"),
    "utf8"
  );
  const sandbox = { window: {}, firebase: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "equiposPoolService.js" });
  return sandbox.window.EquiposPoolService;
}
const front = cargarFrontend();

const SERIALES = [
  "ABC123", "abc123", "  abc-123  ", "AB C1 23", "NX·420·X1", "áéí-123-XyZ",
  "12345678901234567890123456789012345", // >30 (inválido)
  "AB", "", null, undefined, 12345, "SER/IAL_2024#7",
];

const LABELS = [
  "NX-420", "NX 420", "NX420", "HYTERA PNC360S", "PNC360S", "PNC360S-R",
  "PD606", "PD606G", "PD6", "Motorola DEP-450", "", null, undefined,
  "ÑANDÚ-1", "radio genérico", "NX920",
];

test("normalizarSerial (front) == normSerial (functions) sobre el corpus", () => {
  for (const s of SERIALES) {
    assert.equal(front.normalizarSerial(s), backend.normSerial(s), `serial: ${JSON.stringify(s)}`);
  }
});

test("esSerialValido coincide sobre el corpus normalizado", () => {
  for (const s of SERIALES) {
    const norm = backend.normSerial(s);
    assert.equal(front.esSerialValido(norm), backend.esSerialValido(norm), `serial: ${JSON.stringify(s)}`);
  }
});

test("modeloKey coincide (con y sin modelo_id)", () => {
  for (const label of LABELS) {
    assert.equal(front.modeloKey(null, label), backend.modeloKey(null, label), `label: ${JSON.stringify(label)}`);
    assert.equal(front.modeloKey("mod_1", label), backend.modeloKey("mod_1", label), `id+label: ${JSON.stringify(label)}`);
  }
});

test("_mismoModelo (front) == mismoModelo (functions) en todas las combinaciones", () => {
  const ids = [null, "mod_1", "mod_2"];
  for (const dataId of ids) {
    for (const dataLabel of LABELS) {
      for (const qId of ids) {
        for (const qLabel of LABELS) {
          const data = { modelo_id: dataId, modelo_label: dataLabel };
          assert.equal(
            front._mismoModelo(data, qId, qLabel),
            backend.mismoModelo(data, qId, qLabel),
            `data=${JSON.stringify(data)} q=${JSON.stringify({ qId, qLabel })}`
          );
        }
      }
    }
  }
});

// Casos de negocio que NO deben cambiar sin decisión explícita (el comentario
// de ambos archivos los documenta): sufijo -R de reuso, marca opcional,
// truncados con contención ≥3, y la colisión Kenwood sin contención.
test("invariantes de negocio de mismoModelo", () => {
  const casos = [
    [{ modelo_label: "PNC360S" }, null, "PNC360S-R", true],
    [{ modelo_label: "HYTERA PNC360S" }, null, "PNC360S", true],
    [{ modelo_label: "PD606" }, null, "PD606G", true],
    [{ modelo_label: "NX420" }, null, "NX920", false],
    [{ modelo_id: "a", modelo_label: "X" }, "a", "Y", true],   // mismo id manda
    [{}, null, "PD606", true],                                  // sin dato → adoptar
  ];
  for (const [data, id, label, esperado] of casos) {
    assert.equal(backend.mismoModelo(data, id, label), esperado,
      `backend ${JSON.stringify([data, id, label])}`);
    assert.equal(front._mismoModelo(data, id, label), esperado,
      `front ${JSON.stringify([data, id, label])}`);
  }
});

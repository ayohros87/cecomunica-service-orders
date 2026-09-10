// Resumen del pool por modelo (auditoría de consumo 2026-09-10).
//
// Existencias barría las 7,592 fichas del pool en CADA apertura: ~197,000
// lecturas al día, el mayor consumidor del proyecto. El resumen vive ahora en
// `agregados_pool`, alimentado por deltas desde el trigger. Un resumen que se
// corre es peor que no tenerlo — pinta números falsos con cara de verdad —,
// así que estos guardias congelan lo que lo mantiene honesto:
//
//   A1 — la clave de agrupación es la MISMA que usa el front (modeloKey), o el
//        resumen no casa con las filas que la página pinta.
//   A2 — solo cuentan los cambios que mueven un conteo; tocar `notas` o
//        `verificado` no puede costar dos escrituras.
//   A3 — alta, baja y mudanza de estado producen exactamente los deltas que
//        cuadran; una mudanza descuenta de un lado y suma del otro.
//   A4 — cambiar de modelo mueve el conteo ENTRE documentos, no dentro de uno.
//   A5 — una ficha sin estado no se pierde en silencio.
//
// Corre con `npm test` (node --test). No necesita emulador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

// domain/equiposPool carga lib/admin, que llama a admin.firestore() al
// requerirse; sin una app inicializada firebase-admin revienta. Se levanta una
// de mentira: este test no toca Firestore, escribe contra un doble.
const fbAdmin = require("firebase-admin");
if (!fbAdmin.apps.length) fbAdmin.initializeApp({ projectId: "test-agregado-pool" });

const AG = require("../src/domain/agregadoPool");
const { modeloKey } = require("../src/domain/equiposPool");

const ficha = (o) => ({ modelo_id: null, modelo_label: "", estado: "en_bodega", ...o });

// Doble de Firestore: registra los `set` sin salir a la red. Solo necesita
// entender la forma { est: { estado: increment } } que emite aplicarDelta.
function dbFalso() {
  const escrituras = [];
  return {
    escrituras,
    collection(col) {
      return {
        doc(id) {
          return {
            set(data, opts) { escrituras.push({ col, id, data, opts }); return Promise.resolve(); },
          };
        },
      };
    },
  };
}

// Extrae el delta numérico que aplicarDelta pidió para (doc, estado).
function delta(esc, id, estado) {
  const w = esc.find(x => x.id === id && x.data.est && estado in x.data.est);
  if (!w) return 0;
  const v = w.data.est[estado];
  // FieldValue.increment no expone el operando; se reconoce por su forma.
  return v && typeof v === "object" ? (v.operand ?? v._delta ?? null) : v;
}

test("A1 · la clave de agrupación es la misma modeloKey del front", () => {
  // Con id de catálogo manda el id; sin id, la etiqueta normalizada.
  assert.equal(AG.claveDe(ficha({ modelo_id: "abc123" })).key, "abc123");
  assert.equal(AG.claveDe(ficha({ modelo_label: "HYTERA PD-606" })).key, modeloKey(null, "HYTERA PD-606"));
  // Dos etiquetas que solo difieren en separadores caen en el MISMO grupo,
  // igual que en la página — si no, el resumen partiría filas que el front une.
  assert.equal(
    AG.claveDe(ficha({ modelo_label: "PD 606" })).key,
    AG.claveDe(ficha({ modelo_label: "pd-606" })).key,
  );
  // Sin ningún dato de modelo hay una casilla explícita, no una clave vacía.
  assert.equal(AG.claveDe(ficha({})).key, "sinmodelo");
});

test("A2 · solo los cambios que mueven un conteo cuentan", () => {
  const a = AG.claveDe(ficha({ modelo_id: "m1", estado: "en_bodega" }));
  // Mismo modelo y mismo estado: da igual qué otro campo cambió.
  assert.equal(AG.afecta(a, AG.claveDe(ficha({ modelo_id: "m1", estado: "en_bodega" }))), false);
  // Mudanza de estado y cambio de modelo sí afectan.
  assert.equal(AG.afecta(a, AG.claveDe(ficha({ modelo_id: "m1", estado: "en_taller" }))), true);
  assert.equal(AG.afecta(a, AG.claveDe(ficha({ modelo_id: "m2", estado: "en_bodega" }))), true);
  // Alta y baja de la ficha siempre afectan.
  assert.equal(AG.afecta(null, a), true);
  assert.equal(AG.afecta(a, null), true);
});

test("A2b · una escritura que no toca modelo ni estado no escribe nada", async () => {
  const db = dbFalso();
  const tocado = await AG.aplicarDelta(db, {
    antes:   ficha({ modelo_id: "m1", estado: "en_bodega", notas: "" }),
    despues: ficha({ modelo_id: "m1", estado: "en_bodega", notas: "revisado", verificado: true }),
  });
  assert.equal(tocado, false);
  assert.equal(db.escrituras.length, 0, "tocar notas no puede costar escrituras en el resumen");
});

test("A3 · alta, baja y mudanza producen los deltas que cuadran", async () => {
  // Alta: +1 y nada más.
  let db = dbFalso();
  await AG.aplicarDelta(db, { antes: null, despues: ficha({ modelo_id: "m1", estado: "en_bodega" }) });
  assert.equal(db.escrituras.length, 1);
  assert.equal(delta(db.escrituras, "m1", "en_bodega"), 1);

  // Baja: −1 y nada más.
  db = dbFalso();
  await AG.aplicarDelta(db, { antes: ficha({ modelo_id: "m1", estado: "en_bodega" }), despues: null });
  assert.equal(db.escrituras.length, 1);
  assert.equal(delta(db.escrituras, "m1", "en_bodega"), -1);

  // Mudanza dentro del mismo modelo: descuenta de un estado y suma al otro.
  db = dbFalso();
  await AG.aplicarDelta(db, {
    antes:   ficha({ modelo_id: "m1", estado: "en_bodega" }),
    despues: ficha({ modelo_id: "m1", estado: "en_taller" }),
  });
  assert.equal(delta(db.escrituras, "m1", "en_bodega"), -1);
  assert.equal(delta(db.escrituras, "m1", "en_taller"), 1);
});

test("A4 · cambiar de modelo mueve el conteo entre documentos", async () => {
  const db = dbFalso();
  await AG.aplicarDelta(db, {
    antes:   ficha({ modelo_id: "m1", estado: "en_bodega" }),
    despues: ficha({ modelo_id: "m2", estado: "en_bodega" }),
  });
  const ids = db.escrituras.map(w => w.id).sort();
  assert.deepEqual(ids, ["m1", "m2"], "tiene que tocar los DOS documentos");
  assert.equal(delta(db.escrituras, "m1", "en_bodega"), -1);
  assert.equal(delta(db.escrituras, "m2", "en_bodega"), 1);
  // El doc que recibe la unidad refresca la etiqueta; el que la pierde no la toca.
  const gana = db.escrituras.find(w => w.id === "m2");
  assert.ok("modelo_label" in gana.data);
  const pierde = db.escrituras.find(w => w.id === "m1");
  assert.ok(!("modelo_label" in pierde.data));
  // Siempre con merge: un `set` plano borraría los demás estados del modelo.
  for (const w of db.escrituras) assert.equal(w.opts && w.opts.merge, true);
});

test("A5 · una ficha sin estado cae en su propia casilla, no se pierde", async () => {
  assert.equal(AG.claveDe(ficha({ modelo_id: "m1", estado: undefined })).estado, "sin_estado");
  const db = dbFalso();
  await AG.aplicarDelta(db, { antes: null, despues: { modelo_id: "m1" } });
  assert.equal(delta(db.escrituras, "m1", "sin_estado"), 1);
});

test("A6 · el resumen se escribe en su propia colección, nunca en el pool", async () => {
  const db = dbFalso();
  await AG.aplicarDelta(db, {
    antes:   ficha({ modelo_id: "m1", estado: "en_bodega" }),
    despues: ficha({ modelo_id: "m1", estado: "vendido" }),
  });
  assert.ok(db.escrituras.length > 0);
  for (const w of db.escrituras) {
    assert.equal(w.col, AG.COL);
    assert.notEqual(w.col, "equipos_pool", "escribir en el pool realimentaría el trigger");
  }
});

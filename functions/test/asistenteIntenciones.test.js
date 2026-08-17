// Las intenciones del asistente de bodega (public/js/ui/asistente-importar.js).
//
// El caso que las motivó: el 2026-08-14 bodega tenía que pasar 32 seriales de
// VM686 a PD686 y el asistente los marcó a los 32 como COLISIÓN de serial,
// cuya única casilla creaba 32 fichas duplicadas. "El serial existe bajo otro
// modelo" son DOS cosas distintas —el mismo radio mal codificado, o dos radios
// que comparten numeración— y en los datos se ven idénticas. Estas pruebas
// fijan que la diferencia la ponga la intención declarada y no una heurística.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function cargar() {
  const raiz = path.join(__dirname, "..", "..");
  const sandbox = { window: {}, firebase: {}, console, document: undefined };
  vm.createContext(sandbox);
  for (const rel of [["public", "js", "services", "equiposPoolService.js"],
                     ["public", "js", "domain", "serialPatron.js"],
                     ["public", "js", "ui", "asistente-importar.js"]]) {
    vm.runInContext(fs.readFileSync(path.join(raiz, ...rel), "utf8"), sandbox,
      { filename: rel[rel.length - 1] });
  }
  return sandbox.window.AsistenteImportar;
}
const AI = cargar();
const I = AI._intenciones;

const VM686 = "mVM", PD686 = "mPD", PD686R = "mPDR";

// Entorno como el que arma `entorno()` tras el paso 1.
function env(extra = {}) {
  return {
    modeloId: PD686, label: "HYTERA PD686", cond: "nuevo",
    origenId: "", origenLabel: "",
    ubicacion: "en_bodega", nota: "", archivo: "hoja.csv",
    contratos: new Map(),
    ...extra,
  };
}

// Ficha del pool, con lo mínimo que miran las intenciones.
const ficha = (o = {}) => ({
  id: o.id || "f1", serial: "20323A0111", serial_norm: "20323A0111",
  modelo_id: o.modelo_id || VM686, modelo_label: o.modelo_label || "HYTERA VM686",
  condicion: o.condicion || "nuevo", estado: o.estado || "en_bodega",
  propiedad: o.propiedad || "cecomunica", notas: o.notas || "",
  asignacion: o.asignacion || null,
});

const item = (todas, extra = {}) => ({ norm: "20323A0111", nota: "", todas, ...extra });

// ── El caso VM686 ───────────────────────────────────────────────────────

test("mismo serial bajo otro modelo: 'conteo' lo llama colisión, 'reclasificar' lo reclasifica", () => {
  const todas = [ficha()];

  const a = item(todas);
  I.conteo.clasificar(a, env());
  assert.equal(a.clase, "colision", "sin declarar intención sigue siendo el caso Kenwood");
  assert.equal(a.acciones.colision, false, "y NUNCA viene marcado: crea una ficha duplicada");

  const b = item(todas);
  I.reclasificar.clasificar(b, env());
  assert.equal(b.clase, "reclasificar");
  assert.equal(b.acciones.modelo, true, "declarada la intención, es el trabajo a hacer");
  assert.equal(b.ficha.id, "f1");
});

test("reclasificar entre familias queda marcado como decisión manual", () => {
  const x = item([ficha()]);
  I.reclasificar.clasificar(x, env());
  assert.equal(x.entreFamilias, true, "VM686 → PD686 no es una variante -R");
});

test("reclasificar a la variante -R NO es cambio entre familias", () => {
  const x = item([ficha({ modelo_id: PD686, modelo_label: "HYTERA PD686", condicion: "nuevo" })]);
  I.reclasificar.clasificar(x, env({ modeloId: PD686R, label: "HYTERA PD686-R", cond: "reuso" }));
  assert.equal(x.clase, "reclasificar");
  assert.equal(x.entreFamilias, false, "PD686 → PD686-R es la misma familia");
});

test("el que ya está en el código destino no se toca", () => {
  const x = item([ficha({ modelo_id: PD686, modelo_label: "HYTERA PD686", condicion: "nuevo" })]);
  I.reclasificar.clasificar(x, env());
  assert.equal(x.clase, "ya_esta");
  assert.equal(x.acciones.modelo, false);
});

// ── Los candados ────────────────────────────────────────────────────────

test("candado: no se reclasifica un radio con contrato VIGENTE", () => {
  const f = ficha({ estado: "en_cliente", asignacion: { contrato_doc_id: "c1", contrato_id: "ALQ-1", cliente_nombre: "EXOLUM" } });
  const x = item([f]);
  I.reclasificar.clasificar(x, env({ contratos: new Map([["c1", { id: "c1", contrato_id: "ALQ-1", estado: "activo" }]]) }));
  assert.equal(x.clase, "contrato_vivo");
  assert.equal(x.acciones.modelo, false, "cambiar el modelo cambia lo que se factura");
});

test("un contrato muerto no bloquea la reclasificación", () => {
  const f = ficha({ estado: "en_cliente", asignacion: { contrato_doc_id: "c1", contrato_id: "ALQ-1" } });
  const x = item([f]);
  I.reclasificar.clasificar(x, env({ contratos: new Map([["c1", { id: "c1", estado: "anulado" }]]) }));
  assert.equal(x.clase, "reclasificar");
});

test("serial con varias fichas y sin origen declarado: no se adivina cuál", () => {
  const x = item([ficha({ id: "a" }), ficha({ id: "b", modelo_id: "mNX920", modelo_label: "KENWOOD NX-920" })]);
  I.reclasificar.clasificar(x, env());
  assert.equal(x.clase, "ambigua");
  assert.equal(x.acciones.modelo, false);
});

test("declarando el origen se elige la ficha correcta entre varias", () => {
  const x = item([ficha({ id: "a" }), ficha({ id: "b", modelo_id: "mNX920", modelo_label: "KENWOOD NX-920" })]);
  I.reclasificar.clasificar(x, env({ origenId: VM686, origenLabel: "HYTERA VM686" }));
  assert.equal(x.clase, "reclasificar");
  assert.equal(x.ficha.id, "a", "la de VM686, no la Kenwood");
});

test("el que no viene del origen declarado se deja fuera", () => {
  const x = item([ficha({ modelo_id: "mOtro", modelo_label: "HYTERA HP786" })]);
  I.reclasificar.clasificar(x, env({ origenId: VM686, origenLabel: "HYTERA VM686" }));
  assert.equal(x.clase, "no_es_origen");
  assert.equal(x.acciones.modelo, false);
});

test("sin ficha no hay nada que reclasificar", () => {
  const x = item([]);
  I.reclasificar.clasificar(x, env());
  assert.equal(x.clase, "sin_ficha");
  assert.equal(x.acciones.modelo, false);
});

// ── Colisión declarada ──────────────────────────────────────────────────

test("colisión: declarada la intención, la casilla SÍ viene marcada", () => {
  const x = item([ficha({ modelo_id: "mNX420", modelo_label: "KENWOOD NX-420-R" })]);
  I.colision.clasificar(x, env({ modeloId: "mNX920", label: "KENWOOD NX-920-R" }));
  assert.equal(x.clase, "confirmar");
  assert.equal(x.acciones.colision, true, "bodega ya dijo que son radios distintos");
});

test("colisión: si ya hay ficha del MISMO modelo no se puede distinguir", () => {
  const x = item([ficha({ modelo_id: PD686, modelo_label: "HYTERA PD686" })]);
  I.colision.clasificar(x, env());
  assert.equal(x.clase, "ya_esta");
  assert.equal(x.acciones.colision, false);
});

// ── Ubicación ───────────────────────────────────────────────────────────

test("ubicación: se trae a bodega lo que está en un estado reubicable", () => {
  const x = item([ficha({ estado: "en_cliente" })]);
  I.ubicacion.clasificar(x, env({ ubicacion: "en_bodega" }));
  assert.equal(x.clase, "mover");
  assert.equal(x.acciones.mover, true);
});

test("ubicación: un estado terminal no se mueve", () => {
  const x = item([ficha({ estado: "baja" })]);
  I.ubicacion.clasificar(x, env({ ubicacion: "por_clasificar" }));
  assert.equal(x.clase, "bloqueada");
  assert.equal(x.acciones.mover, false);
});

test("ubicación: lo vendido no se manda a por_clasificar", () => {
  const x = item([ficha({ estado: "vendido" })]);
  I.ubicacion.clasificar(x, env({ ubicacion: "por_clasificar" }));
  assert.equal(x.clase, "bloqueada");
});

test("ubicación: el que ya está en el destino no se toca", () => {
  const x = item([ficha({ estado: "en_bodega" })]);
  I.ubicacion.clasificar(x, env({ ubicacion: "en_bodega" }));
  assert.equal(x.clase, "ya_esta");
});

// ── Nota libre ──────────────────────────────────────────────────────────

test("anotar: nota libre, no solo DAÑADA", () => {
  const x = item([ficha()]);
  I.anotar.clasificar(x, env({ nota: "SIN BATERÍA — revisar en taller" }));
  assert.equal(x.clase, "anotar");
  assert.equal(x.acciones.nota, true);
});

test("anotar: no reescribe la nota que ya dice lo mismo", () => {
  const x = item([ficha({ notas: "SIN BATERÍA" })]);
  I.anotar.clasificar(x, env({ nota: "SIN BATERÍA" }));
  assert.equal(x.clase, "ya_esta");
  assert.equal(x.acciones.nota, false);
});

// ── Modo revisión ───────────────────────────────────────────────────────

test("revisar clasifica igual que conteo pero no deja ninguna acción marcada", () => {
  const todas = [ficha({ modelo_id: PD686, modelo_label: "HYTERA PD686", estado: "en_cliente", propiedad: "cliente" })];

  const a = item(todas);
  I.conteo.clasificar(a, env());
  assert.equal(a.clase, "reubicar");
  assert.ok(Object.values(a.acciones).some(Boolean), "conteo sí propone trabajo");

  const b = item(todas);
  I.revisar.clasificar(b, env());
  assert.equal(b.clase, "reubicar", "misma lectura");
  assert.ok(Object.values(b.acciones).every(v => v === false), "pero no escribe nada");
});

test("revisar es de solo lectura y no define aplicar()", () => {
  assert.equal(I.revisar.soloLectura, true);
  assert.equal(typeof I.revisar.aplicar, "undefined");
});

// ── Contrato entre intenciones ──────────────────────────────────────────

test("toda intención que escribe declara aplicar() y resumen()", () => {
  for (const [k, it] of Object.entries(I)) {
    if (it.soloLectura) continue;
    assert.equal(typeof it.aplicar, "function", `${k} necesita aplicar()`);
    assert.equal(typeof it.resumen, "function", `${k} necesita resumen()`);
  }
});

test("toda intención declara clasificar, clases y qué pregunta el paso 1", () => {
  const preguntas = ["modelo", "origen_destino", "ubicacion", "nota"];
  for (const [k, it] of Object.entries(I)) {
    assert.equal(typeof it.clasificar, "function", `${k} necesita clasificar()`);
    assert.ok(it.clases && Object.keys(it.clases).length, `${k} necesita clases`);
    assert.ok(preguntas.includes(it.pregunta), `${k} pregunta algo desconocido: ${it.pregunta}`);
    assert.ok(it.titulo && it.sub && it.icono, `${k} necesita titulo/sub/icono para el paso 0`);
  }
});

test("solo 'conteo' fija el conteo y solo 'reclasificar' lo mueve", () => {
  assert.equal(I.conteo.conteo, "fijar");
  assert.equal(I.reclasificar.conteo, "mover");
  for (const k of ["colision", "ubicacion", "anotar", "revisar"]) {
    assert.ok(!I[k].conteo, `${k} no debe tocar el conteo físico`);
  }
});

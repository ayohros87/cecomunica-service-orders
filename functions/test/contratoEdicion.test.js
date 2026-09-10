// ¿Se puede editar este contrato? — criterio único (js/domain/contratoEdicion.js).
//
// El criterio estaba escrito TRES veces con tres respuestas distintas
// (editar-contrato.js, clientes-centro.js, contratos-list.js), así que el
// Centro ofrecía "Editar…" y la página devolvía al usuario con un aviso. Este
// test congela la respuesta y prohíbe que vuelvan a aparecer copias.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargar() {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "contratoEdicion.js"), ctx);
  return ctx.window.ContratoEdicion;
}

const CE = cargar();

test("un borrador y un aprobado sí se editan", () => {
  assert.equal(CE.ok({ estado: "pendiente_aprobacion" }), true);
  // El aprobado es el caso que la lista vieja escondía y el editor sí permitía.
  assert.equal(CE.ok({ estado: "aprobado" }), true);
});

test("un contrato ACTIVO no se edita: los cambios van por anexo o renovación", () => {
  const r = CE.puedeEditarse({ estado: "activo" });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "activo");
  assert.match(r.texto, /anexo|renovación/i);
  assert.equal(r.salida, null); // no hay nada que el usuario pueda destrabar
});

test("con enlace de firma abierto no se edita — pero hay salida", () => {
  const r = CE.puedeEditarse({ estado: "aprobado", firma_solicitud_estado: "pendiente" });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "firma_pendiente");
  assert.equal(r.salida, "retirar_firma");
});

test("el enlace ya retirado o firmado deja de estorbar", () => {
  assert.equal(CE.ok({ estado: "aprobado", firma_solicitud_estado: "cancelado" }), true);
  assert.equal(CE.ok({ estado: "aprobado", firma_solicitud_estado: "firmado" }), true);
});

test("'activo' gana sobre el enlace: el motivo que se muestra es el que no tiene salida", () => {
  const r = CE.puedeEditarse({ estado: "activo", firma_solicitud_estado: "pendiente" });
  assert.equal(r.motivo, "activo");
});

test("sin contrato no revienta", () => {
  assert.equal(CE.ok(null), false);
  assert.equal(CE.puedeEditarse(undefined).motivo, "inexistente");
});

test("la reaprobación solo aplica a un contrato ya aprobado", () => {
  assert.equal(CE.aplicaReaprobacion({ estado: "aprobado" }), true);
  assert.equal(CE.aplicaReaprobacion({ estado: "pendiente_aprobacion" }), false);
  assert.equal(CE.aplicaReaprobacion(null), false);
});

// ── La guarda: un solo dueño del criterio ─────────────────────────────────
test("nadie vuelve a tener su propia copia del criterio", () => {
  // Patrones ESPECÍFICOS de las dos copias que existían. A propósito no se
  // busca `firma_solicitud_estado === 'pendiente'` a secas: el Centro lo usa
  // legítimamente en otros diez sitios (mostrar "enlace enviado", retirar el
  // enlace, la firma de una GESTIÓN) y una guarda con falsos positivos se
  // termina desactivando.
  const COPIAS = [
    // clientes-centro.js: const edOk = c.estado !== 'activo' && !conEnlace;
    /estado\s*!==?\s*['"]activo['"]\s*&&\s*!con/,
    // editar-contrato.js: if (c.estado === "aprobado" && c.firma_solicitud_estado === "pendiente")
    /c\.estado\s*===?\s*['"]aprobado['"]\s*&&\s*c\.firma_solicitud_estado/,
  ];
  // editar-contrato.js quedó RETIRADO (su HTML es un reenvío): el único dueño
  // vivo del criterio es el Centro.
  for (const f of [
    ["public", "js", "pages", "clientes-centro.js"],
  ]) {
    const src = leer(...f).replace(/\/\/.*$/gm, "");   // sin comentarios
    assert.ok(src.includes("ContratoEdicion."),
      `${f.at(-1)} dejó de usar el criterio compartido`);
    for (const re of COPIAS) {
      assert.ok(!re.test(src), `${f.at(-1)} volvió a inlinear el criterio de edición (${re})`);
    }
  }
  // Y la página tiene que cargarlo, o truena en runtime.
  assert.ok(leer("public", "clientes", "centro.html").includes("domain/contratoEdicion.js"),
    "clientes/centro.html no carga js/domain/contratoEdicion.js");
});

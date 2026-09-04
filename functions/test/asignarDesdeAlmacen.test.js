// "Asignar desde Almacén" (propuesta 2026-09-03): bodega asigna los seriales
// de contratos y gestiones desde la pestaña Asignar de /almacen/, con UN
// formulario compartido (js/ui/asignador-seriales.js) y una sola política de
// validación. Antes lo hacía en dos pantallas ajenas (contratos/seriales.html
// y la ficha 360 del cliente), cada una con su formulario y su validación.
//
// Estos guardias congelan lo que se rompe sin que nadie lo note:
//   G1 — todo correo que le pide seriales a bodega apunta a Almacén · Asignar
//        (con el contrato o la gestión ya abiertos), nunca a /contratos/ ni al
//        Centro.
//   G2 — el rol `inventario` tiene 'almacen' y NO tiene 'centro' ni 'contratos'.
//   G3 — la bandeja Hoy no ruta la asignación fuera de /almacen/.
//   G4 — el expediente del Centro ya no tiene inputs de bodega (data-gaum /
//        data-gdemo / data-gitem) ni su propio validador del pool.
//   G5 — el formulario vive UNA vez: el picker del pool y la validación dura
//        se definen en el componente, no en las páginas que lo montan.
//   G6 — la página de contratos redirige al rol inventario a Almacén.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const sinComentarios = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const ALMACEN_ASIGNAR = /almacen\/index\.html\?tab=asignar&(contrato|g)=/;

test("G1 · los correos a bodega apuntan a Almacén · Asignar", () => {
  const casos = [
    ["functions/src/triggers/contratos/onApproval.js", "contrato"],
    ["functions/src/triggers/scheduled/recordatorioSeriales.js", "contrato"],
    ["functions/src/triggers/contratos/onSerialCambio.js", "contrato"],
    ["functions/src/lib/sustitucionContrato.js", "contrato"],
  ];
  for (const [archivo] of casos) {
    const src = sinComentarios(leer(...archivo.split("/")));
    assert.ok(ALMACEN_ASIGNAR.test(src), `${archivo}: falta el enlace a almacen/index.html?tab=asignar`);
    assert.ok(!/contratos\/seriales\.html/.test(src), `${archivo}: sigue enlazando a contratos/seriales.html`);
  }
  // Gestiones: el correo de bodega usa urlBodegaGestion (Almacén), no el
  // expediente del Centro (urlGestion) que reciben vendedor y recepción.
  const lib = sinComentarios(leer("functions", "src", "lib", "gestiones.js"));
  assert.ok(/function urlBodegaGestion\(/.test(lib) && ALMACEN_ASIGNAR.test(lib), "lib/gestiones.js: falta urlBodegaGestion → Almacén");
  const ogw = sinComentarios(leer("functions", "src", "triggers", "gestiones", "onGestionWrite.js"));
  const correoBodega = ogw.slice(ogw.indexOf("async function correoBodega"), ogw.indexOf("async function", ogw.indexOf("async function correoBodega") + 10));
  assert.ok(/urlBodegaGestion\(/.test(correoBodega), "correoBodega debe enlazar a Almacén (urlBodegaGestion)");
  assert.ok(!/urlGestion\(/.test(correoBodega), "correoBodega no debe mandar a bodega al Centro");
});

test("G2 · el rol inventario tiene almacen y no tiene centro ni contratos", () => {
  const ctx = { window: {}, location: { search: "" }, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "modulos.js"), ctx);
  const inv = ctx.window.MODULOS.deRol("inventario");
  assert.ok(inv.includes("almacen"), "inventario debe ver 'almacen'");
  assert.ok(!inv.includes("centro"), "inventario ya no trabaja en el Centro");
  assert.ok(!inv.includes("contratos"), "inventario no debe ver 'contratos'");
});

test("G3 · la bandeja Hoy no manda la asignación fuera de /almacen/", () => {
  const hoy = sinComentarios(leer("public", "js", "pages", "almacen-hoy.js"));
  assert.ok(!/contratos\/seriales\.html/.test(hoy), "Hoy sigue enlazando a contratos/seriales.html");
  assert.ok(!/clientes\/centro\.html/.test(hoy), "Hoy sigue enlazando al Centro");
  assert.ok(/tab=asignar/.test(hoy), "Hoy debe abrir la pestaña Asignar");
  const html = leer("public", "almacen", "index.html");
  assert.ok(/id: 'asignar'/.test(html) && /id="tab-asignar"/.test(html), "almacen/index.html: falta la pestaña Asignar");
  assert.ok(/asignador-seriales\.js/.test(html) && /almacen-asignar\.js/.test(html), "almacen/index.html: faltan los scripts de Asignar");
});

test("G4 · el Centro muestra la asignación de bodega, no la captura", () => {
  const centro = sinComentarios(leer("public", "js", "pages", "clientes-centro.js"));
  for (const marca of ["data-gaum", "data-gdemo", "data-gitem", "_validarSerialBodega", "_decorarAsignacion", "guardarAsignacionAumento", "guardarAsignacionDemo"]) {
    assert.ok(!centro.includes(marca), `clientes-centro.js todavía contiene ${marca}`);
  }
  assert.ok(ALMACEN_ASIGNAR.test(centro), "el Centro debe enlazar a Almacén · Asignar");
});

test("G5 · el picker del pool y la validación dura viven solo en el componente", () => {
  const comp = sinComentarios(leer("public", "js", "ui", "asignador-seriales.js"));
  assert.ok(/function abrirPickerPool\(/.test(comp) && /function validarDuro\(/.test(comp), "el componente debe definir picker y validación dura");
  for (const pagina of [["public", "js", "pages", "contrato-seriales-page.js"], ["public", "js", "pages", "almacen-asignar.js"]]) {
    const src = sinComentarios(leer(...pagina));
    assert.ok(!/function abrirPickerPool\(/.test(src), `${pagina.at(-1)}: no debe tener su propio picker`);
    assert.ok(!/function advertenciasPool\(/.test(src), `${pagina.at(-1)}: no debe tener su propia validación del pool`);
    assert.ok(/AsignadorSeriales\.crear\(/.test(src), `${pagina.at(-1)}: debe montar el componente`);
  }
  // La política dura exige bodega + modelo: la página de Almacén la usa, la de
  // contratos (recepción/vendedores) conserva la suave.
  const alm = sinComentarios(leer("public", "js", "pages", "almacen-asignar.js"));
  assert.ok(/politica: 'dura'/.test(alm), "Almacén · Asignar debe correr con la política dura");
  assert.ok(/exigirEnBodega\(/.test(alm), "Almacén · Asignar debe bloquear seriales fuera de bodega");
});

test("G6 · contratos/seriales.html redirige al rol inventario a Almacén", () => {
  const src = sinComentarios(leer("public", "js", "pages", "contrato-seriales-page.js"));
  assert.ok(/rol === 'inventario'[\s\S]{0,200}almacen\/index\.html\?tab=asignar&contrato=/.test(src), "falta la redirección del rol inventario");
});

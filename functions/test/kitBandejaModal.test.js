// Kit de bandeja + hoja de modal (propuesta "Bandejas y pickers" 2026-09-04,
// F1 ejecutada 2026-09-07). Guardias:
//   K1 — el kit (js/ui/bandeja.js) carga sin DOM y sus helpers devuelven la
//        fila con chip de tono, antigüedad con el semáforo de la clase y CTA
//        sin onclick inline.
//   K2 — Almacén · Hoy y Almacén · Asignar pintan sus filas/ítems con el kit:
//        no definen su propio markup de fila (.hy-row/.as-item) ni onclick
//        inline en los CTAs.
//   K3 — ceco-ui.css tiene UNA sola definición de .modal-backdrop, con
//        z-index ≥ 1500 (antes 800: quedaba debajo de cualquier .overlay) y la
//        anatomía en columna (cuerpo con scroll, encabezado y pie fijos).
//   K4 — las hojas de asignación (revisión, bloqueo, confirmar envío, listo
//        para programar, picker del estante, conflicto) van por Modal.sheet:
//        ninguna construye su overlay a mano.
//   K5 — Modal.sheet existe en modal.js y resuelve con la acción del botón.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const sinComentarios = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

function cargarBandeja() {
  const ctx = { window: {}, Date };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "ui", "bandeja.js"), ctx);
  return ctx.window.Bandeja;
}

test("K1 · el kit pinta la fila con tono, semáforo por clase y CTA sin onclick", () => {
  const B = cargarBandeja();
  const hace5 = Date.now() - 5 * 86400000;
  const fila = B.fila({ chip: "Seriales", tono: "aviso", txt: "<b>CT-1</b> · Cliente", at: hace5,
    ctaHtml: B.cta({ href: "index.html?tab=asignar&contrato=c1", label: "Asignar", data: { asignar: "1", contrato: "c1" } }) });
  assert.match(fila, /class="bj-row"/);
  assert.match(fila, /bj-chip bj-chip--aviso/);
  assert.match(fila, /bj-age warn/, "5 días en una cola (3/7) es ámbar");
  assert.match(fila, /data-asignar="1"/);
  assert.ok(!/onclick=/.test(fila), "el CTA del kit no lleva onclick inline");
  // Misma edad en una señal de seguimiento (10/30) no es ámbar.
  assert.ok(!/warn|bad/.test(B.edad(hace5, { clase: "senal" })));
  assert.match(B.edad(Date.now() - 40 * 86400000, { clase: "senal" }), /bj-age bad/);
  // Un tono inventado cae a neutro; el texto del chip se escapa.
  assert.match(B.chip("<x>", "rosa"), /bj-chip--neutro/);
  assert.match(B.chip("<x>", "rosa"), /&lt;x&gt;/);
  // Grupo vacío no se pinta; con nota sí.
  assert.equal(B.grupo({ titulo: "Nada", n: 0 }), "");
  assert.match(B.grupo({ titulo: "Del pool", n: 2, notaHtml: B.nota("x") }), /bj-grupo-t/);
  // Lista seleccionable.
  const it = B.item({ titulo: "CT-1", n: "0 / 5", sub: "Nuevo · Cliente", sel: true, data: { tipo: "contrato", id: "c1" } });
  assert.match(it, /class="bj-item is-on"/);
  assert.match(it, /data-id="c1"/);
});

test("K2 · Almacén Hoy y Asignar usan el kit, sin fila propia ni onclick inline", () => {
  for (const archivo of [["public", "js", "pages", "almacen-hoy.js"], ["public", "js", "pages", "almacen-asignar.js"]]) {
    const src = sinComentarios(leer(...archivo));
    const nombre = archivo.at(-1);
    assert.ok(/Bandeja\./.test(src), `${nombre}: debe usar el kit`);
    assert.ok(!/hy-row|as-item-t|class="hy-|class="as-item/.test(src), `${nombre}: no debe pintar su propia fila`);
    assert.ok(!/onclick=/.test(src.replace(/AlmacenPage\.setTab\('existencias'\)/g, "")) || nombre === "almacen-hoy.js",
      `${nombre}: sin onclick inline en las filas`);
  }
  const html = leer("public", "almacen", "index.html");
  assert.ok(/bandeja\.css/.test(html) && /ui\/bandeja\.js/.test(html), "almacen/index.html debe cargar el kit");
  assert.ok(!/\.hy-row\s*\{|\.as-item\s*\{/.test(html), "almacen/index.html no debe redefinir la fila");
});

test("K3 · una sola .modal-backdrop, encima de los overlays y en columna", () => {
  const css = leer("public", "css", "ceco-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const defs = css.match(/^\.modal-backdrop\s*\{[^}]*\}/gm) || [];
  assert.equal(defs.length, 1, `esperaba UNA definición de .modal-backdrop, hay ${defs.length}`);
  const z = Number((defs[0].match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z >= 1500, `.modal-backdrop z-index ${z} debe ser ≥ 1500 (los .overlay van en 1500)`);
  assert.match(css, /\.modal-backdrop\s*>\s*\.modal\s*\{[^}]*flex-direction:\s*column/, "el cuadro debe ir en columna");
  assert.match(css, /\.modal-body\s*\{[^}]*overflow-y:\s*auto/, "el cuerpo debe scrollear solo");
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.modal-backdrop\s*\{[^}]*align-items:\s*flex-end/, "en móvil la hoja baja al fondo");
});

test("K4 · las hojas de asignación van por Modal.sheet, no por overlays a mano", () => {
  for (const archivo of [
    ["public", "js", "ui", "asignador-seriales.js"],
    ["public", "js", "pages", "contrato-seriales-page.js"],
    ["public", "js", "pages", "almacen-asignar.js"],
    ["public", "js", "pages", "almacen-hoy.js"],
  ]) {
    const src = sinComentarios(leer(...archivo));
    const nombre = archivo.at(-1);
    assert.ok(/Modal\.sheet\(/.test(src), `${nombre}: debe usar Modal.sheet`);
    assert.ok(!/className\s*=\s*['"](overlay|modal-backdrop)/.test(src), `${nombre}: no debe construir su overlay a mano`);
    assert.ok(!/document\.body\.style\.overflow/.test(src), `${nombre}: el bloqueo de scroll es de modal.js`);
    assert.ok(!/\bconfirm\(`|\bwindow\.confirm\(/.test(src), `${nombre}: sin confirm() nativo`);
  }
});

test("K6 · el home (panel de señales y feeds) pinta con el kit: sin CSS inyectado ni filas propias", () => {
  const senales = sinComentarios(leer("public", "js", "pages", "home-signals.js"));
  assert.ok(!/createElement\(['"]style['"]\)/.test(senales), "home-signals.js no debe inyectar CSS");
  assert.ok(!/pend-fila|pend-dias|pend-cta|pend-head/.test(senales), "home-signals.js no debe pintar su propia fila");
  assert.ok(/Bandeja\.fila\(/.test(senales) && /clase: 'senal'/.test(senales), "el panel usa la fila del kit con semáforo de señal");
  for (const f of ["home-feed-ordenes.js", "home-feed-devoluciones.js"]) {
    const src = sinComentarios(leer("public", "js", "pages", f));
    assert.ok(/Bandeja\.fila\(/.test(src), `${f}: filas del kit`);
    assert.ok(!/function hace\(/.test(src), `${f}: 'hace' ya no se duplica`);
    assert.ok(!/fo-skel/.test(src), `${f}: esqueleto del kit`);
  }
  const html = leer("public", "index.html");
  assert.ok(/bandeja\.css/.test(html) && /ui\/bandeja\.js/.test(html), "index.html carga el kit");
  const css = leer("public", "css", "ceco-command.css");
  assert.ok(!/\.fo-row\s*\{/.test(css) && !/\.fo-skel\s*\{/.test(css), "ceco-command.css ya no define la fila ni el esqueleto del feed");
});

test("K7 · la cola de Conflictos vive una sola vez (ConflictosPoolService)", () => {
  const svc = leer("public", "js", "services", "conflictosPoolService.js");
  assert.ok(/agrupar\(/.test(svc) && /fusionarPoolFicha/.test(svc) && /conflicto_revisado/.test(svc));
  for (const f of [["public", "js", "pages", "almacen-hoy.js"], ["public", "js", "pages", "inventario-equipos.js"]]) {
    const src = sinComentarios(leer(...f));
    assert.ok(/ConflictosPoolService\./.test(src), `${f.at(-1)}: usa el servicio`);
    assert.ok(!/fusionarPoolFicha/.test(src), `${f.at(-1)}: el callable se invoca solo desde el servicio`);
    assert.ok(!/conflicto_revisado:\s*(true|valor)/.test(src), `${f.at(-1)}: la marca la escribe solo el servicio`);
  }
  for (const h of [["public", "almacen", "index.html"], ["public", "inventario", "equipos.html"]]) {
    assert.ok(/conflictosPoolService\.js/.test(leer(...h)), `${h.at(-1)} carga el servicio`);
  }
});

test("K5 · Modal.sheet resuelve con la acción del botón y respeta onAction=false", async () => {
  // DOM mínimo para modal.js: createElement con innerHTML, querySelector
  // sobre botones marcados con data-sheet-action.
  const listeners = {};
  const mkBtn = (action) => ({ getAttribute: (k) => k === "data-sheet-action" ? action : null, focus() {}, hasAttribute: () => false, offsetParent: {} , closest(sel) { return sel === "[data-sheet-action]" ? this : null; } });
  const botones = [];
  const overlay = {
    className: "", style: {}, _html: "",
    setAttribute() {}, remove() { overlay._removed = true; },
    set innerHTML(v) { overlay._html = v; [...v.matchAll(/data-sheet-action="([^"]+)"/g)].forEach(m => botones.push(mkBtn(m[1]))); },
    get innerHTML() { return overlay._html; },
    addEventListener: (ev, cb) => { listeners[ev] = cb; },
    querySelector: (sel) => sel.includes("btn-primary") ? botones.find(b => b.getAttribute("data-sheet-action") === "ok") || null : null,
    querySelectorAll: () => botones,
  };
  const ctx = {
    window: { lucide: null },
    document: {
      createElement: () => overlay, body: { appendChild() {}, style: {} },
      addEventListener() {}, removeEventListener() {}, activeElement: null, querySelector: () => null,
    },
    requestAnimationFrame: (cb) => cb(), console, Array, String, Number, Math, Promise, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "ui", "modal.js"), ctx);
  const Modal = ctx.window.Modal;
  assert.equal(typeof Modal.sheet, "function");

  let intentos = 0;
  const p = Modal.sheet({
    title: "Prueba", html: "<p>x</p>",
    buttons: [{ action: "cancel", label: "No" }, { action: "ok", label: "Sí", primary: true }],
    onAction: (a) => { intentos++; return intentos < 2 ? false : undefined; },
  });
  assert.match(overlay._html, /modal-header/);
  assert.match(overlay._html, /data-sheet-action="ok"/);
  const click = (action) => listeners.click({ target: botones.find(b => b.getAttribute("data-sheet-action") === action) });
  await click("ok");                // onAction → false: sigue abierta
  assert.ok(!overlay._removed, "con onAction=false la hoja sigue abierta");
  await click("ok");                // segunda vez: resuelve con 'ok'
  assert.equal(await p, "ok");
  assert.ok(overlay._removed);
});

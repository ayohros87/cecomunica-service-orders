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

test("K8 · F3: una identidad de serial, un picker, un combo y un select filtrado", () => {
  // Serial.norm es la única regla en el navegador; nadie conserva su copia.
  const serial = leer("public", "js", "core", "serial.js");
  assert.match(serial, /window\.Serial/);
  for (const f of [["public", "js", "services", "equiposPoolService.js"], ["public", "js", "services", "contratosService.js"],
    ["public", "js", "ui", "asignador-seriales.js"], ["public", "js", "pages", "almacen-asignar.js"],
    ["public", "js", "pages", "ordenes-render.js"], ["public", "js", "pages", "ordenes-equipos.js"], ["public", "js", "pages", "contratos-seriales-cambio.js"]]) {
    const src = sinComentarios(leer(...f));
    assert.ok(!/toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\/g/.test(src), `${f.at(-1)}: conserva una copia de la normalización de serial`);
    assert.ok(!/toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g/.test(src), `${f.at(-1)}: normaliza en minúsculas (divergente)`);
    assert.ok(/Serial\.(norm|clave|valido)\(/.test(src), `${f.at(-1)}: debe usar Serial`);
  }
  // Toda página que carga los servicios de seriales carga core/serial.js antes.
  const fs2 = require("node:fs"), path2 = require("node:path");
  const htmls = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); } else if (e.name.endsWith(".html")) htmls.push(p); } })(path2.join(RAIZ, "public"));
  for (const h of htmls) {
    const s = fs2.readFileSync(h, "utf8");
    if (!/services\/(equiposPoolService|contratosService)\.js/.test(s)) continue;
    const iSerial = s.indexOf("core/serial.js"), iSvc = s.search(/services\/(equiposPoolService|contratosService)\.js/);
    assert.ok(iSerial >= 0 && iSerial < iSvc, `${path2.relative(RAIZ, h)}: core/serial.js debe ir antes de los servicios de seriales`);
  }
  // EntityPicker: el picker del estante y el cambio de serial ya no arman su lista.
  assert.match(leer("public", "js", "ui", "entity-picker.js"), /Modal\.sheet\(/);
  for (const f of [["public", "js", "ui", "asignador-seriales.js"], ["public", "js", "pages", "contratos-seriales-cambio.js"]]) {
    const src = sinComentarios(leer(...f));
    assert.ok(/EntityPicker\.abrir\(/.test(src), `${f.at(-1)}: usa EntityPicker`);
    assert.ok(!/pp-check|scmb-check/.test(src), `${f.at(-1)}: no debe pintar su propia lista de checkboxes`);
  }
  // EntityCombo: cuatro combos de cliente sobre uno.
  for (const f of [["public", "js", "pages", "cot-editor-state.js"], ["public", "js", "pages", "nc-combo.js"],
    ["public", "js", "ui", "asistente-venta.js"], ["public", "js", "pages", "vendedores-batch.js"]]) {
    const src = sinComentarios(leer(...f));
    assert.ok(/EntityCombo\.(montar|filtrar)\(/.test(src), `${f.at(-1)}: usa EntityCombo`);
    assert.ok(!/suggest-list|class="combo-item/.test(src), `${f.at(-1)}: no debe pintar su propia lista`);
  }
  const css = leer("public", "css", "ceco-ui.css");
  assert.equal((css.match(/^\.combo-list\s*\{/gm) || []).length, 1, ".combo-list debe definirse una sola vez en ceco-ui.css");
  // FilteredSelect: tres copias del filtro con auto-selección sobre una.
  for (const f of [["public", "js", "pages", "nueva-orden.js"], ["public", "js", "pages", "poc-nueva-consola.js"], ["public", "js", "ui", "asistente-recibir.js"]]) {
    const src = sinComentarios(leer(...f));
    assert.ok(/FilteredSelect\.montar\(/.test(src), `${f.at(-1)}: usa FilteredSelect`);
    assert.ok(!/lista\.length === 1\)/.test(src), `${f.at(-1)}: conserva su copia del auto-select`);
  }
});

test("K9 · F4: sin confirm/prompt/alert nativos, sin CSS muerto, modales ocultos por el kit", () => {
  const fs2 = require("node:fs"), path2 = require("node:path");
  const js = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); } else if (e.name.endsWith(".js")) js.push(p); } })(path2.join(RAIZ, "public", "js"));
  for (const f of js) {
    if (/ui[\\/]modal\.js$/.test(f)) continue;
    const src = sinComentarios(fs2.readFileSync(f, "utf8"));
    const nativos = src.match(/(^|[^.\w])(window\.)?(confirm|prompt|alert)\(/g) || [];
    assert.equal(nativos.length, 0, `${path2.relative(RAIZ, f)}: quedan diálogos nativos (${nativos.length}) — usa Modal.confirm/prompt/alert`);
  }
  assert.match(leer("public", "js", "ui", "modal.js"), /\n  alert\(\{/, "modal.js debe ofrecer Modal.alert");
  // CSS muerto fuera; .badge una sola vez; modal-backdrop oculto por defecto.
  const cmd = leer("public", "css", "ceco-command.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.sig--/.test(cmd), ".sig--* no tenía consumidores y debe estar fuera");
  const ui = leer("public", "css", "ceco-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((ui.match(/^\.badge\s*\{/gm) || []).length, 1, ".badge debe definirse una sola vez");
  for (const h of [["public", "almacen", "index.html"], ["public", "inventario", "piezas.html"], ["public", "POC", "vendedores-batch.html"]]) {
    assert.ok(!/^\s*\.badge\s*\{/m.test(leer(...h)), `${h.at(-1)}: no debe redefinir .badge`);
  }
  assert.match(ui, /\.modal-backdrop\s*\{[^}]*display:\s*none/, ".modal-backdrop oculto por defecto");
  assert.match(ui, /\.modal-backdrop\.open\s*\{\s*display:\s*flex/, ".modal-backdrop.open lo muestra");
  const html = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); } else if (e.name.endsWith(".html")) html.push(p); } })(path2.join(RAIZ, "public"));
  for (const h of html) {
    const s = fs2.readFileSync(h, "utf8");
    const malos = (s.match(/<div[^>]*class="modal-backdrop[^"]*"[^>]*style="display:\s*none/g) || []).length;
    assert.equal(malos, 0, `${path2.relative(RAIZ, h)}: modal estático con display:none inline (ya lo oculta el CSS)`);
  }
  // Chips del asignador con clase del kit, no con color inline.
  assert.ok(!/eqpool-chip" style="/.test(leer("public", "js", "ui", "asignador-seriales.js")), "chips del asignador con clase, no inline");
});

test("K10 · los overlays construidos a mano se fueron a Modal.sheet (salvo lightbox, galería, render de devolución y paleta)", () => {
  const fs2 = require("node:fs"), path2 = require("node:path");
  // Lo que se queda a mano, con motivo: lightbox de imagen (no es un
  // diálogo), la galería de fotos, la pantalla completa de la devolución y
  // la paleta de búsqueda. modal.js es el kit mismo.
  const PERMITIDOS = {
    "ui/modal.js": Infinity,
    "pages/ordenes-fotos.js": Infinity,
    "pages/ordenes-events.js": 1,      // _entregaLightbox
    "pages/ordenes-devolucion.js": 1,  // OrdenesDevolucion.render (_overlay, pantalla completa)
    "ui/search-palette.js": Infinity,
  };
  const js = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); } else if (e.name.endsWith(".js")) js.push(p); } })(path2.join(RAIZ, "public", "js"));
  for (const f of js) {
    const rel = path2.relative(path2.join(RAIZ, "public", "js"), f).replace(/\\/g, "/");
    const src = sinComentarios(fs2.readFileSync(f, "utf8"));
    const aMano = (src.match(/\.className\s*=\s*['"](overlay|modal-backdrop)(\s+open)?['"]/g) || []).length;
    const tope = PERMITIDOS[rel] ?? 0;
    assert.ok(aMano <= tope, `${rel}: ${aMano} overlay(s) construidos a mano — usa Modal.sheet (footerHtml/closable si hace falta)`);
  }
  // El kit ofrece lo que las migraciones necesitan.
  const modal = leer("public", "js", "ui", "modal.js");
  assert.match(modal, /footerHtml = ''/, "Modal.sheet acepta footerHtml");
  assert.match(modal, /typeof closable === 'function'/, "closable puede ser una función (asistentes ocupados)");
  // formKit ya no tiene respaldo nativo y la única página que lo cargaba sin
  // modal.js ahora lo carga.
  assert.ok(!/window\.confirm/.test(sinComentarios(leer("public", "js", "ui", "formKit.js"))), "formKit sin window.confirm");
  assert.match(leer("public", "ordenes", "editar-orden.html"), /ui\/modal\.js/, "editar-orden.html carga modal.js");
  // La página pública de firma valida inline, sin alert().
  const firmar = sinComentarios(leer("public", "firmar", "index.html"));
  assert.ok(!/[^.\w]alert\(/.test(firmar), "firmar/index.html sin alert()");
  assert.match(firmar, /id="fMsg"[^>]*role="alert"/, "firmar/index.html con el aviso inline #fMsg");
});

test("K11 · ninguna página se declara su propio backdrop ni arma diálogos a mano", () => {
  const fs2 = require("node:fs"), path2 = require("node:path");
  // Por qué existe esta guardia: el fondo, el centrado y el z-index del modal
  // son del kit (.modal-backdrop en ceco-ui.css, con pruebas). Cuando una
  // página se declara el suyo en un <style> propio nadie lo prueba — en el
  // Centro un resto de declaración huérfano invalidó esa regla entre el
  // 26-ago y el 9-sep-2026 y los modales salieron al PIE de la página, sin
  // fondo ni centrado: había que hacer scroll para verlos. K10 no lo vio
  // porque ese overlay nunca asignaba className: se escribía con innerHTML
  // dentro de un div ya presente en el HTML.
  // Vacío desde 2026-09-10: no queda ninguna página con backdrop propio.
  // El cajón lateral tampoco es una excepción — es la variante `.is-drawer`
  // del kit, con el mismo fondo y el mismo ciclo de vida.
  const CSS_PERMITIDO = {};
  const htmls = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); } else if (e.name.endsWith(".html")) htmls.push(p); } })(path2.join(RAIZ, "public"));
  for (const f of htmls) {
    const rel = path2.relative(path2.join(RAIZ, "public"), f).replace(/\\/g, "/");
    const src = fs2.readFileSync(f, "utf8");
    for (const bloque of src.match(/<style[\s\S]*?<\/style>/g) || []) {
      for (const regla of bloque.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+\{[^{}]*\}/g) || []) {
        const sel = regla.slice(0, regla.indexOf("{")).trim();
        const cuerpo = regla.slice(regla.indexOf("{"));
        if (!/modal|overlay|backdrop/i.test(sel)) continue;
        if (!/position\s*:\s*fixed/.test(cuerpo) || !/(inset\s*:\s*0|top\s*:\s*0)/.test(cuerpo)) continue;
        assert.equal(CSS_PERMITIDO[rel], sel,
          `${rel}: la regla ${sel} es un backdrop propio — el fondo y el centrado los pone .modal-backdrop del kit`);
      }
    }
  }
  // Diálogos armados a mano: la firma es un innerHTML con role="dialog".
  // Solo el kit puede hacerlo. Ojo: un panel que deja pasar el puntero y no
  // atrapa el foco NO es un diálogo — el catálogo de piezas del cotizador
  // perdió ese role porque era incorrecto, no porque estorbara la guardia.
  const JS_PERMITIDO = new Set(["ui/modal.js"]);
  const js = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); } else if (e.name.endsWith(".js")) js.push(p); } })(path2.join(RAIZ, "public", "js"));
  for (const f of js) {
    const rel = path2.relative(path2.join(RAIZ, "public", "js"), f).replace(/\\/g, "/");
    if (JS_PERMITIDO.has(rel)) continue;
    const src = sinComentarios(fs2.readFileSync(f, "utf8"));
    assert.ok(!/role="dialog"/.test(src),
      `${rel}: arma un diálogo a mano (role="dialog") — usa Modal.sheet, que ya trae la anatomía`);
  }
  // El Centro quedó sobre el kit: sus dos helpers son hojas y el div estático
  // con su CSS suelto ya no existe.
  const centro = leer("public", "js", "pages", "clientes-centro.js");
  assert.match(centro, /Modal\.sheet\(\{/, "clientes-centro.js debe abrir sus modales con Modal.sheet");
  assert.ok(!/cg-modal|cg-overlay/.test(sinComentarios(centro)), "clientes-centro.js sin la familia .cg-modal");
  assert.ok(!/cg-overlay/.test(leer("public", "clientes", "centro.html")), "centro.html sin el overlay propio");
  assert.ok(!/\.cg-modal/.test(sinComentarios(leer("public", "css", "ceco-gestion.css"))), "ceco-gestion.css sin CSS de modal");
  const ui = leer("public", "css", "ceco-ui.css");
  assert.match(ui, /\.modal-footer \.sep \{ margin-left: auto; \}/, "el pie del kit conserva el separador .sep");
  assert.match(leer("public", "js", "ui", "modal.js"), /titleHtml = ''/, "Modal.sheet acepta titleHtml");

  // Escape y bloqueo de scroll con diálogos encimados: solo responde el de
  // encima y el scroll vuelve cuando la pila queda vacía.
  const modalJs = leer("public", "js", "ui", "modal.js");
  assert.match(modalJs, /function _esTope\(/, "modal.js lleva la pila de diálogos");
  assert.equal((modalJs.match(/_esTope\(/g) || []).length, 5,
    "los cuatro caminos (open, sheet, confirm, prompt) consultan la pila");
  assert.equal((modalJs.match(/if \(!_pila\.length\) document\.body\.style\.overflow = '';/g) || []).length, 3,
    "close, confirm y prompt solo devuelven el scroll si no queda nada debajo");

  // Cajón lateral: variante del kit, no una familia aparte.
  assert.match(ui, /\.modal-backdrop\.is-drawer \{/, "el kit define la variante de cajón lateral");
  assert.match(leer("public", "POC", "index.html"), /id="editDrawerOverlay" class="modal-backdrop is-drawer"/,
    "el cajón de POC usa la variante del kit");
  assert.match(leer("public", "js", "pages", "poc-edit.js"), /Modal\.open\('editDrawerOverlay'\)/,
    "poc-edit abre el cajón con el kit");

  // admin/grupos: los 5 modales estáticos son del kit.
  const grupos = leer("public", "admin", "grupos.html");
  assert.equal((grupos.match(/class="modal-backdrop"/g) || []).length, 5, "los 5 modales de grupos son del kit");
  assert.ok(!/gp-modal/.test(grupos), "grupos.html sin la familia .gp-modal");
  const gruposJs = leer("public", "js", "pages", "admin-grupos.js");
  assert.ok(!/Overlay'\)\.style\.display/.test(gruposJs), "admin-grupos abre y cierra con Modal.open/close");

  // Cotizador: la vista previa es una hoja; la impresión apunta al nodo del kit.
  const cotHtml = leer("public", "ordenes", "cotizar-orden.html");
  assert.ok(!/\.co-preview-ov|\.co-preview-card/.test(cotHtml), "cotizar-orden sin su overlay propio");
  assert.match(cotHtml, /body\.co-previewing > \*:not\(\.modal-backdrop\)/, "la impresión de la vista previa apunta al kit");

  // Todo fondo estático se anuncia como diálogo. Modal.open da Escape, trampa
  // de foco y bloqueo de scroll, pero el rol hay que declararlo en el HTML: sin
  // él un lector de pantalla no dice que se abrió un diálogo (2026-09-10).
  for (const f of htmls) {
    const rel = path2.relative(path2.join(RAIZ, "public"), f).replace(/\\/g, "/");
    for (const tag of (fs2.readFileSync(f, "utf8").match(/<div[^>]*class="[^"]*modal-backdrop[^"]*"[^>]*>/g) || [])) {
      assert.ok(/role="dialog"/.test(tag),
        `${rel}: fondo sin role="dialog" → ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }

  // Todo fondo estático se abre y se cierra por el kit. Hacerlo a mano con
  // style.display funciona a la vista (el inline gana sobre el CSS) pero deja
  // fuera Escape, la trampa de foco y el bloqueo del scroll, y el kit no se
  // entera de que hay un diálogo: la pila de Escape falla con dos encimados.
  const fuentes = [];
  (function walk(d) { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const p = path2.join(d, e.name);
    if (e.isDirectory()) { if (!/vendor|node_modules/.test(e.name)) walk(p); }
    else if (e.name.endsWith(".js") || e.name.endsWith(".html")) fuentes.push(fs2.readFileSync(p, "utf8")); } })(path2.join(RAIZ, "public"));
  for (const f of htmls) {
    const rel = path2.relative(path2.join(RAIZ, "public"), f).replace(/\\/g, "/");
    const src = fs2.readFileSync(f, "utf8");
    const fondos = (src.match(/<div[^>]*class="[^"]*modal-backdrop[^"]*"[^>]*>/g) || []);
    if (!fondos.length) continue;
    assert.match(src, /ui\/modal\.js/, `${rel}: tiene modales del kit pero no carga ui/modal.js`);
    for (const tag of fondos) {
      const id = (tag.match(/id="([^"]+)"/) || [])[1];
      assert.ok(id, `${rel}: fondo sin id, no se puede abrir con Modal.open`);
      for (const verbo of ["open", "close"]) {
        const re = new RegExp(`Modal\\.${verbo}\\(\\s*['"]${id}['"]`);
        assert.ok(fuentes.some(s => re.test(s)),
          `${rel}#${id}: nadie lo ${verbo === "open" ? "abre" : "cierra"} con Modal.${verbo} — hacerlo a mano pierde Escape, foco y bloqueo de scroll`);
      }
    }
  }

  // Sin <meta viewport> el teléfono maqueta a 980px y las @media de la página
  // nunca aplican: le pasaba al cajón de POC. tools/ son scripts internos.
  for (const f of htmls) {
    const rel = path2.relative(path2.join(RAIZ, "public"), f).replace(/\\/g, "/");
    if (rel.startsWith("tools/")) continue;
    assert.match(fs2.readFileSync(f, "utf8"), /name="viewport"/,
      `${rel}: sin <meta name="viewport"> — el teléfono la maqueta a 980px`);
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

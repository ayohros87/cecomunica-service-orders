// Envío frenado = motivo fijo en el modal + registro (2026-10-05).
//
// Caso COMPAÑÍA GOLY: Elvia "hizo" una gestión que nunca existió. El wizard la
// frenó con un aviso de 4 segundos y no quedó rastro. IntentoEnvio.vigilar
// (public/js/ui/intento.js), enganchado por withBusy con opts.intento, deja el
// motivo fijo encima de los botones y lo registra en intentos_fallidos.
//
// Se corre el código real en un vm con un DOM mínimo (sin jsdom).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fuenteCentro } = require("./_helpers/centro");

const PUBLIC = path.join(__dirname, "..", "..", "public");
const leer = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), "utf8");

// ── DOM mínimo: un modal con cuerpo + pie, y el botón dentro del pie ──
function nodo(cls = "") {
  const n = {
    className: cls, children: [], parentNode: null, style: {}, innerHTML: "", attrs: {},
    classList: { contains: (c) => n.className.split(/\s+/).includes(c) },
    setAttribute(k, v) { n.attrs[k] = v; },
    remove() { const p = n.parentNode; if (p) { p.children.splice(p.children.indexOf(n), 1); n.parentNode = null; } },
    insertBefore(nuevo, ref) { nuevo.parentNode = n; n.children.splice(n.children.indexOf(ref), 0, nuevo); },
    appendChild(h) { h.parentNode = n; n.children.push(h); return h; },
    get previousElementSibling() { const p = n.parentNode; if (!p) return null; const i = p.children.indexOf(n); return i > 0 ? p.children[i - 1] : null; },
    closest(sel) { let x = n; while (x) { if (sel === ".modal-footer" && x.classList.contains("modal-footer")) return x; x = x.parentNode; } return null; },
    scrollIntoView() {},
  };
  return n;
}

function montar({ conAuth = true } = {}) {
  const modal = nodo("modal");
  const body = modal.appendChild(nodo("modal-body"));
  const pie = modal.appendChild(nodo("modal-footer"));
  const btn = pie.appendChild(nodo("btn btn-primary"));
  btn.dataset = {}; btn.disabled = false; btn.removeAttribute = () => {};
  btn.classList.add = () => {}; btn.classList.remove = () => {};
  btn.querySelector = () => null; btn.innerHTML = "Enviar a aprobación";
  const escritos = [];
  const toasts = [];
  const ctx = {
    console: { error() {}, warn() {}, log() {} },
    location: { pathname: "/clientes/centro.html" },
    document: {
      createElement: () => nodo(),
      createTextNode: (t) => ({ t }),
      querySelectorAll: (sel) => (sel === ".modal-footer" ? [pie] : []),
      querySelector: () => null,
    },
    Toast: { show(msg, type = "ok") { toasts.push([msg, type]); }, persist(msg, type = "ok") { toasts.push([msg, type]); return nodo(); } },
    firebase: {
      auth: () => ({ currentUser: conAuth ? { uid: "u1", email: "elvia@x" } : null }),
      firestore: Object.assign(() => ({ collection: (c) => ({ add: async (d) => { escritos.push([c, d]); } }) }),
        { FieldValue: { serverTimestamp: () => "TS" } }),
    },
    setTimeout, Promise, Error, String, Array, Object, Set,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer("js", "ui", "busy.js"), ctx);
  vm.runInContext(leer("js", "ui", "intento.js"), ctx);
  const aviso = () => pie.previousElementSibling && pie.previousElementSibling.classList.contains("intento-aviso") ? pie.previousElementSibling : null;
  return { ctx, btn, pie, body, escritos, toasts, aviso };
}

const tick = () => new Promise((r) => setImmediate(r));
const INTENTO = { accion: "crearAumento", etiqueta: "Aumento de equipos", contexto: () => ({ cliente_id: "goly", cliente_nombre: "COMPAÑÍA GOLY, S.A" }) };

test("un aviso de validación queda FIJO encima de los botones y se registra como 'frenado'", async () => {
  const m = montar();
  await m.ctx.withBusy(m.btn, async () => { m.ctx.Toast.show("Cada línea necesita su precio mensual", "warn"); }, { rethrow: false, intento: INTENTO });
  await tick();
  assert.ok(m.aviso(), "el aviso vive entre el cuerpo y el pie del modal");
  assert.match(m.aviso().innerHTML, /Cada línea necesita su precio mensual/);
  assert.match(m.aviso().innerHTML, /No se envió todavía/);
  assert.equal(m.toasts.length, 1, "el toast sigue saliendo igual");
  assert.equal(m.escritos.length, 1);
  const [col, d] = m.escritos[0];
  assert.equal(col, "intentos_fallidos");
  assert.equal(d.resultado, "frenado");
  assert.deepEqual([...d.mensajes], ["Cada línea necesita su precio mensual"]);
  assert.equal(d.cliente_id, "goly");
  assert.equal(d.uid, "u1");
  assert.equal(d.accion, "crearAumento");
  assert.equal(d.error, null);
});

test("si el envío sale bien ('ok'), no hay aviso ni registro — aunque antes hubiera un warn", async () => {
  const m = montar();
  await m.ctx.withBusy(m.btn, async () => { m.ctx.Toast.show("ojo con esto", "warn"); m.ctx.Toast.show("Aumento GA-1 enviado", "ok"); }, { rethrow: false, intento: INTENTO });
  await tick();
  assert.equal(m.aviso(), null);
  assert.equal(m.escritos.length, 0);
});

test("el éxito por Toast.persist (contrato creado · Ver documento) también cuenta", async () => {
  const m = montar();
  await m.ctx.withBusy(m.btn, async () => { m.ctx.Toast.persist("✅ Contrato creado", "ok"); }, { rethrow: false, intento: INTENTO });
  await tick();
  assert.equal(m.escritos.length, 0);
});

test("un error atrapado por el wizard se registra con el detalle real de console.error", async () => {
  const m = montar();
  await m.ctx.withBusy(m.btn, async () => {
    const e = new Error("Missing or insufficient permissions."); e.code = "permission-denied";
    m.ctx.console.error(e); m.ctx.Toast.show("No se pudo crear el aumento", "bad");
  }, { rethrow: false, intento: INTENTO });
  await tick();
  assert.match(m.aviso().innerHTML, /hubo un error/);
  const d = m.escritos[0][1];
  assert.equal(d.resultado, "error");
  assert.equal(d.error, "permission-denied: Missing or insufficient permissions.");
  assert.deepEqual([...d.mensajes], ["No se pudo crear el aumento"]);
});

test("una excepción que escapa la atrapa withBusy y también queda registrada", async () => {
  const m = montar();
  await m.ctx.withBusy(m.btn, async () => { throw new Error("se cayó la red"); }, { rethrow: false, intento: INTENTO });
  await tick();
  const d = m.escritos[0][1];
  assert.equal(d.resultado, "error");
  assert.match(d.error, /se cayó la red/);
  assert.ok(m.aviso());
});

test("el siguiente intento limpia el aviso anterior; Toast y console vuelven a su sitio", async () => {
  const m = montar();
  const showOrig = m.ctx.Toast.show;
  const errOrig = m.ctx.console.error;
  await m.ctx.withBusy(m.btn, async () => { m.ctx.Toast.show("Falta X", "warn"); }, { rethrow: false, intento: INTENTO });
  assert.ok(m.aviso());
  await m.ctx.withBusy(m.btn, async () => { m.ctx.Toast.show("Listo", "ok"); }, { rethrow: false, intento: INTENTO });
  assert.equal(m.aviso(), null);
  assert.equal(m.ctx.Toast.show, showOrig);
  assert.equal(m.ctx.console.error, errOrig);
});

test("sin opts.intento withBusy se comporta como siempre (ni aviso ni registro)", async () => {
  const m = montar();
  await m.ctx.withBusy(m.btn, async () => { m.ctx.Toast.show("Falta X", "warn"); }, { rethrow: false });
  await tick();
  assert.equal(m.aviso(), null);
  assert.equal(m.escritos.length, 0);
});

test("los wizards de gestión y el de contrato del Centro van vigilados", () => {
  const src = fuenteCentro();
  for (const acc of ["crearAumento", "crearAjuste", "crearBaja", "crearReemplazo", "crearDemo", "crearCambioSerial"]) {
    assert.match(src, new RegExp(`key: '${acc}'[^}]*intento: this\\._intento\\('${acc}'`), `${acc} pasa opts.intento`);
  }
  assert.match(src, /IntentoEnvio\.vigilar\(\{ \.\.\.this\._intento\('crearContrato'/, "crearContrato va vigilado");
  assert.match(leer("js", "entry", "clientes-centro.js"), /import '\/js\/ui\/intento\.js';/);
});

test("las reglas: cada quien crea los suyos, solo admin lee, nadie edita", () => {
  const r = fs.readFileSync(path.join(PUBLIC, "..", "firestore.rules"), "utf8");
  const bloque = r.slice(r.indexOf("match /intentos_fallidos/{id}"), r.indexOf("match /intentos_fallidos/{id}") + 900);
  assert.match(bloque, /allow read: if isAdmin\(\);/);
  assert.match(bloque, /request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(bloque, /allow update, delete: if false;/);
});

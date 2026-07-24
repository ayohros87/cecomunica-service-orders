// Guardia de la captura de firma (public/js/ui/firmaPad.js).
//
// El helper anterior (copiado en ordenes-devolucion / ordenes-visita /
// ordenes-flujo) solo escuchaba mouse+touch SIN captura de puntero. Con el
// dedo en una tablet funcionaba; en escritorio el trazo moría en `mouseleave`
// —el recuadro mide 140 px de alto y el mouse se sale todo el tiempo—, un
// clic sin arrastre no pintaba ni un pixel, y un PAD de firma USB entra como
// `pointerType: 'pen'`, que ese código no atendía. El operador terminaba
// marcando "Registrar sin firma" para poder guardar.
//
// Aquí se monta el componente contra un canvas falso y se le disparan eventos
// sintéticos para congelar ese comportamiento. No necesita navegador ni red.
// Corre con `npm test` (node --test).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "ui", "firmaPad.js"), "utf8");

// Contexto 2D falso: registra las operaciones de dibujo en orden para poder
// afirmar qué trazos llegaron al lienzo.
class CtxFalso {
  constructor() { this.ops = []; }
  setTransform(...a) { this.ops.push(["setTransform", ...a]); }
  fillRect(...a) { this.ops.push(["fillRect", ...a]); }
  clearRect(...a) { this.ops.push(["clearRect", ...a]); }
  beginPath() { this.ops.push(["beginPath"]); }
  moveTo(x, y) { this.ops.push(["moveTo", x, y]); }
  lineTo(x, y) { this.ops.push(["lineTo", x, y]); }
  stroke() { this.ops.push(["stroke"]); }
  arc(x, y, r) { this.ops.push(["arc", x, y, r]); }
  fill() { this.ops.push(["fill"]); }
  drawImage(...a) { this.ops.push(["drawImage", ...a]); }
  save() { this.ops.push(["save"]); }
  restore() { this.ops.push(["restore"]); }
  puntos(tipo) { return this.ops.filter(o => o[0] === tipo).map(o => [o[1], o[2]]); }
}

// El canvas vive a 100,50 en la página: si el componente usara offsetX/offsetY
// en vez del rect, las coordenadas saldrían corridas justo por este offset.
const RECT = { left: 100, top: 50 };

class CanvasFalso extends EventTarget {
  constructor(w = 300, h = 140) {
    super();
    this.clientWidth = w; this.clientHeight = h;
    this.width = 0; this.height = 0;
    this.capturados = []; this.liberados = [];
    this._ctx = new CtxFalso();
    this.listeners = [];
  }
  addEventListener(tipo, fn, op) { this.listeners.push(tipo); super.addEventListener(tipo, fn, op); }
  getContext() { return this._ctx; }
  getBoundingClientRect() { return { left: RECT.left, top: RECT.top, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture(id) { this.capturados.push(id); }
  releasePointerCapture(id) { this.liberados.push(id); }
  toDataURL() { return "data:image/png;base64,FIRMA"; }
  toBlob(cb) { cb({ size: 42, type: "image/png" }); }
}

// Evento de puntero sintético en coordenadas de PÁGINA (clientX/clientY),
// como los entrega el navegador.
function evento(tipo, { x, y, pointerId = 1, pointerType = "mouse", pressure = 0.5, button = 0 } = {}) {
  const ev = new Event(tipo, { cancelable: true });
  Object.assign(ev, { clientX: RECT.left + x, clientY: RECT.top + y, pointerId, pointerType, pressure, button });
  return ev;
}

// Monta FirmaPad en un sandbox con los mínimos que el archivo toca.
// conPointerEvents=false ejercita la rama de respaldo (mouse/touch).
function montar({ conPointerEvents = true, canvas = new CanvasFalso() } = {}) {
  const doc = new EventTarget();
  doc.listeners = [];
  const addDoc = doc.addEventListener.bind(doc);
  doc.addEventListener = (t, f, o) => { doc.listeners.push(t); addDoc(t, f, o); };

  const sandbox = {
    console,
    devicePixelRatio: 2,
    document: doc,
    requestAnimationFrame: (fn) => fn(),
    addEventListener: () => {},      // window.resize
    removeEventListener: () => {},
    Image: class { set src(v) { this._src = v; if (this.onload) this.onload(); } },
  };
  if (conPointerEvents) sandbox.PointerEvent = class {};
  vm.createContext(sandbox);
  sandbox.window = sandbox; // en el navegador window ES el objeto global
  vm.runInContext(SRC, sandbox, { filename: "firmaPad.js" });

  assert.equal(typeof sandbox.FirmaPad?.mount, "function", "firmaPad.js no expuso window.FirmaPad.mount");
  return { pad: sandbox.FirmaPad.mount(canvas, { alto: 140 }), canvas, ctx: canvas._ctx, doc };
}

// ── Regresión principal ────────────────────────────────────────────────────
test("el trazo continúa cuando el puntero se sale del recuadro", () => {
  const { pad, canvas, ctx } = montar();
  assert.equal(pad.isEmpty(), true, "arranca vacío");

  canvas.dispatchEvent(evento("pointerdown", { x: 10, y: 10 }));
  assert.deepEqual(canvas.capturados, [1], "debe pedir setPointerCapture: sin captura el trazo se corta al salir");

  canvas.dispatchEvent(evento("pointermove", { x: 60, y: 40 }));
  // Fuera del canvas (300x140): con el helper viejo, mouseleave ya habría
  // puesto drawing=false y este tramo no se dibujaba.
  canvas.dispatchEvent(evento("pointermove", { x: 520, y: 300 }));
  canvas.dispatchEvent(evento("pointermove", { x: 180, y: 90 }));
  canvas.dispatchEvent(evento("pointerup", { x: 180, y: 90 }));

  const trazos = ctx.puntos("lineTo");
  assert.deepEqual(trazos, [[60, 40], [520, 300], [180, 90]],
    "los tres tramos deben llegar al lienzo, incluido el de fuera del recuadro");
  assert.equal(pad.isEmpty(), false, "tras firmar ya no puede reportarse vacío");
  assert.deepEqual(canvas.liberados, [1], "debe soltar la captura al terminar");
});

test("las coordenadas salen del rect del canvas, no del offset del evento", () => {
  const { canvas, ctx } = montar();
  // El canvas está a (100,50) en la página; el punto de página (110,60) es el
  // (10,10) del lienzo. Un cálculo con offsetX daría otra cosa bajo captura.
  canvas.dispatchEvent(evento("pointerdown", { x: 10, y: 10 }));
  canvas.dispatchEvent(evento("pointermove", { x: 25, y: 30 }));
  assert.deepEqual(ctx.puntos("moveTo")[0], [10, 10]);
  assert.deepEqual(ctx.puntos("lineTo")[0], [25, 30]);
});

test("un clic sin arrastre deja un punto", () => {
  const { pad, canvas, ctx } = montar();
  canvas.dispatchEvent(evento("pointerdown", { x: 40, y: 40 }));
  canvas.dispatchEvent(evento("pointerup", { x: 40, y: 40 }));
  const puntos = ctx.ops.filter(o => o[0] === "arc");
  assert.equal(puntos.length, 1, "sin arrastre el helper viejo no pintaba nada");
  assert.deepEqual([puntos[0][1], puntos[0][2]], [40, 40]);
  assert.equal(pad.isEmpty(), false);
});

test("un PAD de firma / lápiz entra por el mismo camino y su presión modula el trazo", () => {
  const { pad, canvas, ctx } = montar();
  canvas.dispatchEvent(evento("pointerdown", { x: 10, y: 10, pointerType: "pen", pressure: 0.9 }));
  canvas.dispatchEvent(evento("pointermove", { x: 50, y: 50, pointerType: "pen", pressure: 0.9 }));
  const fuerte = ctx.lineWidth;
  canvas.dispatchEvent(evento("pointermove", { x: 60, y: 60, pointerType: "pen", pressure: 0.1 }));
  assert.ok(ctx.lineWidth < fuerte, "menos presión debe adelgazar el trazo");
  assert.ok(ctx.lineWidth > 0, "el trazo nunca desaparece");
  assert.equal(pad.isEmpty(), false);
});

test("el botón secundario del mouse no dibuja", () => {
  const { pad, canvas } = montar();
  canvas.dispatchEvent(evento("pointerdown", { x: 10, y: 10, button: 2 }));
  canvas.dispatchEvent(evento("pointermove", { x: 90, y: 90 }));
  assert.equal(pad.isEmpty(), true);
  assert.deepEqual(canvas.capturados, []);
});

// ── Ciclo de vida ──────────────────────────────────────────────────────────
test("clear vacía, snapshot/restore conservan la firma entre re-renders", async () => {
  const { pad, canvas } = montar();
  canvas.dispatchEvent(evento("pointerdown", { x: 10, y: 10 }));
  canvas.dispatchEvent(evento("pointermove", { x: 80, y: 60 }));
  canvas.dispatchEvent(evento("pointerup", { x: 80, y: 60 }));

  const firma = pad.snapshot();
  assert.match(firma, /^data:image\/png/);
  assert.ok(await pad.toBlob(), "con firma debe entregar un blob para subir");

  pad.clear();
  assert.equal(pad.isEmpty(), true);
  assert.equal(pad.snapshot(), null, "sin firma no se sube un PNG en blanco");
  assert.equal(await pad.toBlob(), null);

  // El modal se re-renderiza en cada check-in: la firma se restaura al canvas
  // nuevo en vez de perderse en silencio.
  const otro = montar();
  otro.pad.restore(firma);
  assert.equal(otro.pad.isEmpty(), false);
  assert.ok(otro.ctx.ops.some(o => o[0] === "drawImage"));
});

test("el backing store escala por devicePixelRatio", () => {
  const { canvas, ctx } = montar();
  assert.equal(canvas.width, 600, "300 css * dpr 2");
  assert.equal(canvas.height, 280, "140 css * dpr 2");
  assert.deepEqual(ctx.ops[0], ["setTransform", 2, 0, 0, 2, 0, 0],
    "el trazo se dibuja en coordenadas CSS");
});

test("destroy suelta los listeners", () => {
  const { pad, canvas, ctx } = montar();
  pad.destroy();
  const antes = ctx.ops.length;
  canvas.dispatchEvent(evento("pointerdown", { x: 10, y: 10 }));
  canvas.dispatchEvent(evento("pointermove", { x: 80, y: 60 }));
  assert.equal(ctx.ops.length, antes, "tras destroy no debe dibujar nada");
});

// ── Respaldo sin Pointer Events ────────────────────────────────────────────
test("sin Pointer Events, move/up van al documento para no cortar el trazo", () => {
  const { canvas, doc } = montar({ conPointerEvents: false });
  assert.ok(canvas.listeners.includes("mousedown"));
  assert.ok(canvas.listeners.includes("touchstart"));
  assert.ok(doc.listeners.includes("mousemove"),
    "en el canvas se perdería el trazo al salir del recuadro");
  assert.ok(doc.listeners.includes("mouseup"));
  assert.ok(!canvas.listeners.includes("mouseleave"),
    "mouseleave era justo lo que abortaba la firma en escritorio");
});

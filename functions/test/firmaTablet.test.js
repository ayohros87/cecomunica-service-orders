// Protocolo de la tablet de firmas del mostrador (public/js/ui/firmaTablet.js).
//
// Por qué existe el módulo: el ida y vuelta con `firmas_tablet` estaba copiado
// en el modal de entrega y en el acuse de devolución, y al aparecer un tercer
// punto de firma —la tanda de entrega parcial— la copia dejó de sostenerse.
// Son tres sitios donde acordarse de cancelar la solicitud pendiente, soltar
// el listener y no pisar una firma vieja.
//
// La trampa que estas guardias cierran: la tablet solo pinta los `tipo` de su
// lista blanca. Uno que no esté ahí crea la solicitud igual, la tablet NO la
// muestra, y el operador se queda mirando "esperando la firma" para siempre.
//
// Corre con `npm test` (node --test), sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargar(matchMedia) {
  const ctx = {
    window: {},
    matchMedia: matchMedia || (() => ({ matches: false })),
    firebase: {
      auth: () => ({ currentUser: { uid: "u1", email: "r@x.com" } }),
      firestore: Object.assign(() => ({
        collection: () => ({
          add: async (d) => { ctx.__add = d; return { id: "sol1" }; },
          doc: () => ({
            onSnapshot: (cb) => { ctx.__cb = cb; return () => { ctx.__soltado = true; }; },
            update: async (p) => { ctx.__update = p; },
          }),
        }),
      }), { FieldValue: { serverTimestamp: () => "TS" } }),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "ui", "firmaTablet.js"), ctx);
  return ctx;
}

test("los tipos son EXACTAMENTE los que la tablet sabe pintar", () => {
  const { window: { FirmaTablet } } = cargar();
  const tablet = leer("public", "firmar", "tablet.html");
  // La lista blanca de la página del mostrador, leída del propio archivo:
  // si alguien agrega un tipo allá o acá, esto obliga a tocar el otro.
  const m = tablet.match(/const TIPOS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "no se encontró la lista de tipos en tablet.html");
  const deLaTablet = m[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
  assert.deepEqual([...FirmaTablet.TIPOS].sort(), deLaTablet.sort());
});

test("un tipo fuera de la lista se rechaza antes de escribir nada", async () => {
  const ctx = cargar();
  await assert.rejects(
    () => ctx.window.FirmaTablet.solicitar({ tipo: "entrega_parcial", ordenId: "O1" }),
    /no sabe mostrar el tipo/);
  assert.equal(ctx.__add, undefined, "no debió crear la solicitud");
});

test("sin orden no se crea la solicitud", async () => {
  const ctx = cargar();
  await assert.rejects(() => ctx.window.FirmaTablet.solicitar({ tipo: "entrega" }),
    /Falta la orden/);
  assert.equal(ctx.__add, undefined);
});

test("la solicitud nace pendiente y con lo que la tablet necesita pintar", async () => {
  const ctx = cargar();
  const id = await ctx.window.FirmaTablet.solicitar({
    tipo: "entrega", ordenId: "O1", numero: "O1-E2",
    titulo: "Entrega parcial de equipos", nombreLabel: "Nombre de quien recibe",
    unidades: [{ serial: "S1", modelo: "NX", detalle: "Clip" }],
    clienteNombre: "ACME", contratoId: "ALQ-1",
  });
  assert.equal(id, "sol1");
  const d = ctx.__add;
  assert.equal(d.estado, "pendiente");
  assert.equal(d.tipo, "entrega");
  assert.equal(d.orden_id, "O1");
  assert.equal(d.numero, "O1-E2");
  assert.equal(d.titulo, "Entrega parcial de equipos");
  assert.equal(d.nombre_label, "Nombre de quien recibe");
  assert.equal(d.unidades.length, 1);
  assert.equal(d.leyenda, null);
});

test("escuchar avisa de la firma y de la cancelación, y nada más", () => {
  const ctx = cargar();
  let firmada = null, cancelada = 0, otros = 0;
  ctx.window.FirmaTablet.escuchar("sol1", {
    onFirmada: (f) => { firmada = f; },
    onCancelada: () => { cancelada++; },
  });
  const emitir = (d) => ctx.__cb({ exists: true, data: () => d });
  emitir({ estado: "pendiente" });
  otros += firmada || cancelada ? 1 : 0;
  emitir({ estado: "firmada", firma: { url: "u", nombre: "Ana", cedula: "8-1" } });
  emitir({ estado: "cancelada" });
  assert.equal(otros, 0, "un estado intermedio no puede disparar nada");
  // Campo a campo: el objeto viene del vm, así que su prototipo es de otro
  // realm y deepEqual lo rechazaría por identidad, no por contenido.
  assert.equal(firmada.url, "u");
  assert.equal(firmada.nombre, "Ana");
  assert.equal(firmada.cedula, "8-1");
  assert.equal(cancelada, 1);
});

test("cancelar es silencioso: una solicitud ya firmada no es un error", async () => {
  const ctx = cargar();
  ctx.window.firebase.firestore = Object.assign(() => ({
    collection: () => ({ doc: () => ({ update: async () => { throw new Error("no existe"); } }) }),
  }), { FieldValue: { serverTimestamp: () => "TS" } });
  await ctx.window.FirmaTablet.cancelar("sol1");   // no debe tirar
  await ctx.window.FirmaTablet.cancelar(null);
});

test("la tablet es del MOSTRADOR: en móvil o táctil no se ofrece", () => {
  assert.equal(cargar(() => ({ matches: false })).window.FirmaTablet.disponible(), true);
  assert.equal(cargar(() => ({ matches: true })).window.FirmaTablet.disponible(), false);
  // Un navegador sin matchMedia no puede dejar sin firma al mostrador.
  const roto = cargar(() => { throw new Error("no soportado"); });
  assert.equal(roto.window.FirmaTablet.disponible(), true);
});

test("las unidades llevan los accesorios que el cliente revisa antes de firmar", () => {
  const { window: { FirmaTablet } } = cargar();
  const u = FirmaTablet.unidadesDeEquipos([
    { numero_de_serie: "S1", modelo: "NX-420-R", bateria: true, clip: true },
    { numero_de_serie: "S2", modelo: "PD606-R" },
    { numero_de_serie: "S3", eliminado: true },
  ]);
  assert.equal(u.length, 2, "un equipo eliminado no va a la tablet");
  assert.equal(u[0].detalle, "Batería, Clip");
  assert.equal(u[1].detalle, "Sin accesorios");
});

test("el modal de entrega ya NO habla con firmas_tablet por su cuenta", () => {
  // El punto del refactor. Si vuelve a aparecer una escritura directa aquí,
  // vuelven los tres sitios donde acordarse de cancelar la pendiente.
  const flujo = leer("public", "js", "pages", "ordenes-flujo.js");
  const codigo = flujo.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /collection\(['"]firmas_tablet['"]\)/,
    "ordenes-flujo debe delegar en FirmaTablet");
  assert.match(codigo, /FirmaTablet\.solicitar/);
  assert.match(codigo, /FirmaTablet\.escuchar/);
  assert.match(codigo, /FirmaTablet\.cancelar/);
});

test("la hoja de entrega parcial usa el mismo protocolo", () => {
  const hoja = leer("public", "js", "pages", "ordenes-entrega-parcial.js");
  const codigo = hoja.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /collection\(['"]firmas_tablet['"]\)/);
  assert.match(codigo, /FirmaTablet\.solicitar/);
  // La tablet muestra SOLO lo que se lleva hoy: firmar una lista con los que
  // se quedan en el taller sería hacerle firmar de más al cliente.
  assert.match(codigo, /unidadesDeEquipos\(salen\)/);
});

test("el acuse de devolución también dejó de hablar con firmas_tablet", () => {
  // La tercera copia, y la última: era la que sobrevivía al modal y por eso
  // tenía además su propia consulta de solicitudes vivas.
  const dev = leer("public", "js", "pages", "ordenes-devolucion.js");
  const codigo = dev.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /collection\(['"]firmas_tablet['"]\)/,
    "el acuse debe delegar en FirmaTablet");
  for (const fn of ["solicitar", "escuchar", "cancelar", "actualizarCopia", "vivasDeOrden"]) {
    assert.ok(codigo.includes("FirmaTablet." + fn), `falta FirmaTablet.${fn}`);
  }
  // Su forma de unidades es PROPIA (accesorios + daño): la tablet la detecta
  // y pinta el checklist por unidad. No debe pasar por unidadesDeEquipos.
  assert.match(codigo, /accesorios: e\.accesorios/);
});

test("retomar solicitudes vivas: solo las de la orden, y la firmada solo si es fresca", async () => {
  const ctx = cargar();
  const ahora = Date.now();
  const doc = (id, estado, horas) => ({
    id,
    data: () => ({ estado, creado_at: { toDate: () => new Date(ahora - horas * 3600000) } }),
  });
  let filtros = [];
  const q = (docs) => ({
    where(c, op, v) { filtros.push([c, op, v]); return q(docs); },
    get: async () => ({ docs }),
  });
  const docs = [doc("vieja", "firmada", 9), doc("fresca", "firmada", 1),
                doc("pend", "pendiente", 2), doc("yaAplicada", "pendiente", 1)];
  ctx.window.firebase.firestore = Object.assign(
    () => ({ collection: () => q(docs) }), { FieldValue: { serverTimestamp: () => "TS" } });

  const r = await ctx.window.FirmaTablet.vivasDeOrden("O1", "acuse_devolucion",
    { excluir: ["yaAplicada"] });
  assert.equal(r.pendiente.id, "pend", "una ya aplicada no se retoma");
  assert.equal(r.firmada.id, "fresca",
    "una firma de hace 9 h es de otra tanda: pegarla aquí sería una constancia falsa");
  // Solo igualdades + in: si alguien mete un rango, hace falta índice compuesto.
  assert.deepEqual(filtros.map(f => f[1]).sort(), ["==", "==", "in"].sort());
});

test("sin orden o sin tipo, retomar no consulta nada", async () => {
  const ctx = cargar();
  let consultó = false;
  ctx.window.firebase.firestore = Object.assign(
    () => ({ collection: () => { consultó = true; return {}; } }),
    { FieldValue: { serverTimestamp: () => "TS" } });
  const a = await ctx.window.FirmaTablet.vivasDeOrden(null, "entrega");
  const b = await ctx.window.FirmaTablet.vivasDeOrden("O1", null);
  assert.equal(consultó, false);
  assert.equal(a.pendiente, null);
  assert.equal(b.firmada, null);
});

test("un fallo al retomar no tumba la pantalla", async () => {
  // Sin permiso o con la colección recién creada: el operador simplemente
  // vuelve a mandar la solicitud; lo que no puede es reventar el modal.
  const ctx = cargar();
  ctx.window.firebase.firestore = Object.assign(
    () => ({ collection: () => ({ where() { throw new Error("sin permiso"); } }) }),
    { FieldValue: { serverTimestamp: () => "TS" } });
  const r = await ctx.window.FirmaTablet.vivasDeOrden("O1", "entrega");
  assert.deepEqual([r.pendiente, r.firmada], [null, null]);
});

test("la ventana de frescura es la MISMA que la de la tablet", () => {
  const { window: { FirmaTablet } } = cargar();
  const tablet = leer("public", "firmar", "tablet.html");
  // La tablet la escribe como `4 * 60 * 60 * 1000`; si alguien mueve una,
  // esto obliga a mover la otra.
  assert.match(tablet, /4 \* 60 \* 60 \* 1000/);
  assert.equal(FirmaTablet.VENTANA_FRESCA_MS, 4 * 60 * 60 * 1000);
});

test("corregir el correo de la copia no puede tocar nada más", async () => {
  const ctx = cargar();
  await ctx.window.FirmaTablet.actualizarCopia("sol1", "otro@acme.com");
  assert.deepEqual(Object.keys(ctx.__update), ["copia_a"],
    "solo copia_a: un update amplio podría pisar el estado de la solicitud");
  assert.equal(ctx.__update.copia_a, "otro@acme.com");
  await ctx.window.FirmaTablet.actualizarCopia("sol1", "");
  assert.equal(ctx.__update.copia_a, null, "vaciarlo lo deja en null, no en cadena vacía");
});

test("firmaTablet.js se carga en la página de órdenes", () => {
  // ordenes-flujo.js NO es diferido: si el módulo no está en el HTML, el
  // botón de tablet revienta con ReferenceError en el primer clic.
  const html = leer("public", "ordenes", "index.html");
  assert.match(html, /js\/ui\/firmaTablet\.js/);
  const iTablet = html.indexOf("js/ui/firmaTablet.js");
  const iFlujo = html.indexOf("js/pages/ordenes-flujo.js");
  assert.ok(iTablet < iFlujo, "firmaTablet debe cargarse antes que ordenes-flujo");
});

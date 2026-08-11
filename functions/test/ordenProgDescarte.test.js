// Descarte de "Órdenes por crear" (bandeja del home, 2026-08-11).
//
// La bandeja sugiere crear la orden de PROGRAMACIÓN, pero a veces la orden NO
// se va a crear (la entrega se hizo a mano, el cliente paró, el contrato era de
// muestra…). Sin salida, esos casos se acumulaban y la bandeja dejaba de
// significar "esto hay que hacerlo". Recepción los descarta con motivo.
//
// Lo que congela este test:
//
//   D1 — un descarte vigente saca al contrato de "necesita orden" (feed + CTA
//        ámbar de la lista de contratos, que comparten predicado) y lo mueve a
//        "descartado", que es lo que la bandeja muestra bajo "ver descartadas".
//
//   D2 — el descarte CADUCA si cambian los equipos del contrato: se descartó
//        ESA foto, no el contrato para siempre. Si le agregan equipo o seriales
//        después, la orden vuelve a pedirse (mismo criterio que el QC del
//        taller). Sin esto, un descarte tapaba trabajo real para siempre.
//
//   D3 — el descarte no puede resucitar filas que el predicado base ya
//        descartaba (entrega confirmada, orden vinculada, legacy).
//
//   D4 — el motivo se ofrece desde una lista cerrada y la UI del feed expone la
//        acción con su estilo: el botón (.fo-x) y el panel (.fo-descarte) tienen
//        que existir en el CSS del home, o la salida queda invisible.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarDominio() {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "ordenProgPendiente.js"), ctx);
  return ctx.window.OrdenProgPendiente;
}

// Contrato listo para su orden: 2 equipos, 2 seriales resueltos, sin entrega
// confirmada y sin orden vinculada.
const listo = (extra = {}) => ({
  estado: "activo",
  seriales_estado: "asignados",
  equipos: [{ cantidad: 2 }],
  seriales_count: 2,
  ...extra,
});

const descarte = (extra = {}) => ({
  motivo: "entregado", nota: "", por_email: "recepcion@cecomunica.com",
  equipos_activos: 2, seriales_resueltos: 2,
  ...extra,
});

test("D1 — el descarte saca el contrato de la bandeja, pero no lo esconde", () => {
  const OPP = cargarDominio();
  const base = listo();
  assert.equal(OPP.contratoNecesitaOrden(base), true, "sin descarte, la bandeja lo pide");
  assert.equal(OPP.contratoDescartado(base), false);

  const conDescarte = listo({ orden_prog_descartada: descarte() });
  assert.equal(OPP.contratoNecesitaOrden(conDescarte), false, "descartado no cuenta");
  assert.equal(OPP.contratoDescartado(conDescarte), true, "pero sigue listado aparte");
});

test("D2 — el descarte caduca si cambian los equipos del contrato", () => {
  const OPP = cargarDominio();

  // Le agregan un equipo (3 en vez de 2) y su serial: la foto del descarte ya
  // no cuadra, así que la orden vuelve a pedirse.
  const masEquipo = listo({
    equipos: [{ cantidad: 3 }], seriales_count: 3,
    orden_prog_descartada: descarte(),
  });
  assert.equal(OPP.contratoNecesitaOrden(masEquipo), true, "equipos nuevos reviven la fila");
  assert.equal(OPP.contratoDescartado(masEquipo), false);

  // Una baja reduce los activos: también cambia la foto.
  const conBaja = listo({
    equipos: [{ cantidad: 2 }], baja_cancelado_total: 1, seriales_count: 2,
    orden_prog_descartada: descarte(),
  });
  assert.equal(OPP.contratoNecesitaOrden(conBaja), true);

  // Misma foto = el descarte sigue vigente.
  const igual = listo({ orden_prog_descartada: descarte() });
  assert.equal(OPP.contratoNecesitaOrden(igual), false);
});

test("D3 — el descarte no resucita lo que el predicado base ya excluía", () => {
  const OPP = cargarDominio();
  const casos = [
    ["entrega confirmada", listo({ entrega_confirmada: true })],
    ["orden ya vinculada", listo({ os_count: 1 })],
    ["contrato legacy", listo({ seriales_estado: "legacy" })],
    ["contrato anulado", listo({ estado: "anulado" })],
    ["seriales incompletos", listo({ seriales_count: 1 })],
  ];
  for (const [nombre, data] of casos) {
    const conDescarte = { ...data, orden_prog_descartada: descarte() };
    assert.equal(OPP.contratoNecesitaOrden(conDescarte), false, `${nombre}: no la pide`);
    assert.equal(OPP.contratoDescartado(conDescarte), false,
      `${nombre}: tampoco sale como descartada (nunca estuvo en la bandeja)`);
  }
});

test("D4 — motivos cerrados y salida visible en la UI del home", () => {
  const OPP = cargarDominio();
  assert.ok(OPP.MOTIVOS.length >= 3, "hay motivos para elegir");
  assert.ok(OPP.MOTIVOS.some((m) => m.codigo === "otro"), "existe 'otro' (con nota obligatoria)");
  for (const m of OPP.MOTIVOS) {
    assert.equal(OPP.motivoLabel(m.codigo), m.label);
  }
  assert.equal(OPP.motivoLabel("inventado"), "inventado", "un motivo viejo no rompe el pintado");

  const feed = leer("public", "js", "pages", "home-feed-ordenes.js");
  assert.match(feed, /data-act="descartar"/, "la fila ofrece descartar");
  assert.match(feed, /data-act="reactivar"/, "y el descarte se puede revertir");

  // Clases del descarte con estilo propio: sin ellas el botón queda invisible
  // (mismo tipo de guardia que .eqpool-chip-<estado> en el pool).
  const css = leer("public", "css", "ceco-command.css");
  for (const cls of [".fo-x", ".fo-descarte", ".fo-row--off", ".fo-btn--danger"]) {
    assert.ok(css.includes(cls), `falta el estilo ${cls} en ceco-command.css`);
  }
});

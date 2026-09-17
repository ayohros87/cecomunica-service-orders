// El acuse deja de ser opcional en el check-in (2026-09-17).
//
// Medido en producción antes de este cambio: de 403 unidades recibidas en
// devoluciones, 210 (52 %) quedaron SIN acuse — ni firma del cliente ni una
// línea diciendo por qué no la hay. La entrega, en cambio, llegó a 100 %
// documentada, y la diferencia no es la gente: la entrega no deja confirmar
// sin firma (o sin motivo escrito), y el check-in sí.
//
// Lo que este cambio congela:
//   · motivos de "sin firma" ELEGIDOS de una lista (contables), con la
//     persona que hizo la entrega en campo propio — antes todo era texto
//     libre y la persona vivía dentro de la frase;
//   · la firma deja de esconderse en el scroll: salta sola al registrar una
//     unidad y el pie del modal la reclama;
//   · salir del check-in dejando unidades sin acuse exige decidirlo.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ui = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "pages", "ordenes-devolucion.js"), "utf8");

test("los motivos salen de una lista cerrada, no de texto libre", () => {
  assert.match(ui, /const MOTIVOS_SIN_FIRMA = \[/);
  // El caso dominante real: el radio lo trajo un vendedor o técnico nuestro.
  assert.match(ui, /'vendedor_trajo'/);
  assert.match(ui, /'cliente_no_firma'/);
  assert.match(ui, /'mensajeria'/);
  assert.match(ui, /'otro'/);
  assert.match(ui, /<select class="form-input" id="acuseSinFirmaCodigo"/);
});

test("los motivos de entrega por terceros piden nombrar a la persona", () => {
  assert.match(ui, /const MOTIVO_PIDE_QUIEN = new Set/);
  assert.match(ui, /if \(MOTIVO_PIDE_QUIEN\.has\(codigo\) && !quien\)/,
    "sin el nombre de quien entregó, el motivo no dice nada");
  assert.match(ui, /if \(codigo === 'otro' && !detalle\)/);
  assert.match(ui, /if \(!codigo\) \{ Toast\.show\('Elige por qué no hay firma del cliente\.'/);
});

test("el motivo se guarda desarmado, además del texto que se imprime", () => {
  assert.match(ui, /sin_firma_codigo: sin \? \(sinFirmaCodigo \|\| null\) : null,/);
  assert.match(ui, /sin_firma_quien: sin \? \(sinFirmaQuien \|\| null\) : null,/);
  assert.match(ui, /sin_firma_detalle: sin \? \(sinFirmaDetalle \|\| null\) : null,/);
  // El texto compuesto sigue existiendo: es lo que ya leen el documento
  // imprimible y el correo al cliente.
  assert.match(ui, /sin_firma_motivo: sin \? \(motivo \|\| ''\) : null,/);
});

test("la firma se busca sola al registrar una unidad", () => {
  assert.match(ui, /function _irAFirma\(\)/);
  assert.match(ui, /id="devAcuseBloque"/, "el bloque tiene ancla para el salto");
  assert.match(ui, /setTimeout\(\(\) => _irAFirma\(\), 0\);/);
  assert.match(ui, /scrollIntoView\(\{ behavior: 'smooth'/);
});

test("el pie del modal reclama el acuse mientras falte", () => {
  assert.match(ui, /Falta el acuse de \$\{sinAcuse\.length\} unidad/);
  assert.match(ui, /id="devIrAFirma"/);
});

test("salir dejando unidades sin acuse es una decisión, no un descuido", () => {
  assert.match(ui, /async function intentarCerrar\(\)/);
  assert.match(ui, /querySelector\('#devCerrarModal'\)\?\.addEventListener\('click', intentarCerrar\)/,
    "la X pasa por la pregunta");
  // Se puede salir igual: a recepción no se le tranca el mostrador.
  assert.match(ui, /if \(r === 'salir'\) \{ cerrarModal\(\); return; \}/);
  // Y sin unidades pendientes no estorba a nadie.
  assert.match(ui, /if \(!sinAcuse\.length \|\| !puedeOperar\(\)/);
});

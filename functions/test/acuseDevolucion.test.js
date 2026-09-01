// Acuse de recibo al cliente (2026-09-01) — congela el contenido del correo
// que arma functions/src/lib/acuseDevolucion.js y su sincronía con la UI:
//
//   · numeroDeAcuse: el correlativo {ordenId}-A{n} respeta el `numero`
//     estampado al firmar y lo DERIVA de la posición para los acuses viejos
//     (append-only por reglas → la posición es estable).
//   · emailAcuse: el documento dice lo que el cliente firmó — seriales,
//     accesorios, daño, leyenda legal y la firma (o la constancia sin firma).
//   · Sincronía con ordenes-devolucion.js: el checklist de accesorios y la
//     leyenda del documento imprimible tienen que decir lo mismo en las dos
//     puntas (correo del backend y doc del navegador).
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { emailAcuse, numeroDeAcuse, LEYENDA_ACUSE, ACC_LABELS } =
  require("../src/lib/acuseDevolucion");

const ORDEN_ID = "2026090112";

const acuseBase = {
  id: "ac-2",
  at: null,
  nombre_entrega: "Luis Camarena",
  firma_url: "https://storage.example.com/ordenes_firmas/f.png",
  sin_firma: false,
  sin_firma_motivo: null,
  seriales: ["25219A0944", "24O31A0947"],
  unidades: [
    { serial: "25219A0944", modelo: "Hytera HP786",
      accesorios: { bateria: true, antena: true, clip: true, cargador: true, fuente: true, cubrepolvo: true },
      dano_visible: null },
    { serial: "24O31A0947", modelo: "Hytera PD606-R",
      accesorios: { bateria: true, antena: false, clip: false, cargador: false, fuente: false, cubrepolvo: false },
      dano_visible: "Carcasa rajada" },
  ],
  envio: { status: "solicitado", to: "operaciones@cliente.com" },
};

const orden = {
  cliente_nombre: "TRANSPORTES DEL ISTMO, S.A.",
  contrato: { contrato_id: "ALQ-2026-0459" },
  devolucion: { acuses: [{ id: "ac-1" }, acuseBase] },
};

test("numeroDeAcuse respeta el numero estampado y deriva el de los viejos", () => {
  // Estampado al firmar: manda.
  assert.equal(
    numeroDeAcuse(ORDEN_ID, orden.devolucion.acuses, { ...acuseBase, numero: "X-A9" }),
    "X-A9");
  // Acuse viejo sin numero: posición en el array (base 1).
  assert.equal(numeroDeAcuse(ORDEN_ID, orden.devolucion.acuses, { id: "ac-1" }), `${ORDEN_ID}-A1`);
  assert.equal(numeroDeAcuse(ORDEN_ID, orden.devolucion.acuses, acuseBase), `${ORDEN_ID}-A2`);
});

test("emailAcuse: el correo dice lo que el cliente firmó", () => {
  const { subject, bodyContent } = emailAcuse(ORDEN_ID, orden, acuseBase);
  assert.match(subject, new RegExp(`${ORDEN_ID}-A2`));
  // Unidades con su registro del check-in.
  assert.match(bodyContent, /25219A0944/);
  assert.match(bodyContent, /Hytera PD606-R/);
  assert.match(bodyContent, />Completo</);          // checklist completo
  assert.match(bodyContent, /Batería</);            // checklist parcial: lista lo entregado
  assert.match(bodyContent, /Carcasa rajada/);
  // Cliente, contrato, leyenda y firma.
  assert.match(bodyContent, /TRANSPORTES DEL ISTMO/);
  assert.match(bodyContent, /ALQ-2026-0459/);
  assert.match(bodyContent, /no constituye la inspección técnica final/);
  assert.match(bodyContent, /ordenes_firmas\/f\.png/);
  assert.match(bodyContent, /Luis Camarena/);
});

test("emailAcuse: sin firma muestra la constancia, no un recuadro vacío", () => {
  const sinFirma = {
    ...acuseBase, firma_url: null, nombre_entrega: null,
    sin_firma: true, sin_firma_motivo: "equipos recogidos por el técnico en sitio",
  };
  const { bodyContent } = emailAcuse(ORDEN_ID, orden, sinFirma);
  assert.match(bodyContent, /sin firma del cliente/i);
  assert.match(bodyContent, /recogidos por el técnico/);
  assert.doesNotMatch(bodyContent, /<img/);
});

test("emailAcuse: acuse legacy solo con seriales no revienta", () => {
  const legacy = { id: "ac-1", seriales: ["TC123456"], sin_firma: true, sin_firma_motivo: "x" };
  const { bodyContent } = emailAcuse(ORDEN_ID, orden, legacy);
  assert.match(bodyContent, /TC123456/);
});

test("sincronía con la UI: accesorios y leyenda dicen lo mismo en las dos puntas", () => {
  const ui = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "pages", "ordenes-devolucion.js"), "utf8");
  // El checklist de la UI (ACCESORIOS) y el del correo (ACC_LABELS) deben
  // tener las mismas claves y etiquetas.
  for (const [clave, etiqueta] of Object.entries(ACC_LABELS)) {
    assert.match(ui, new RegExp(`\\['${clave}',\\s*'${etiqueta}'\\]`),
      `la UI perdió el accesorio ${clave} (${etiqueta})`);
  }
  // La leyenda del documento imprimible (frontend) y la del correo (backend)
  // comparten el cierre distintivo.
  assert.match(LEYENDA_ACUSE, /no constituye la inspección técnica final/);
  assert.match(ui, /no constituye la inspección técnica final/);
  // La página de la tablet también existe y lleva la leyenda corta del acuse.
  const tablet = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "firmar", "tablet.html"), "utf8");
  assert.match(tablet, /ingresarán al taller para su revisión/);
  assert.match(tablet, /firmas_tablet/);
});

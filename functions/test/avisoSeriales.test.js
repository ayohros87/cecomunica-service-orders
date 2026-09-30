// La decisión del cron de seriales: nada / recordatorio a bodega / escalación.
//
// El caso que originó el escalamiento es CONCORD ALQ20260810-01: aprobado el
// 26-ago, cuatro recordatorios a bodega hasta el 17-ago y después silencio
// absoluto — 38 días con la cuenta activa y sin seriales. Estas pruebas fijan
// que ese silencio ya no es posible.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { decideAviso, MAX_RECORDATORIOS } = require("../src/domain/avisoSeriales");

const ts = (iso) => ({ toDate: () => new Date(iso) });   // Timestamp de Firestore
const HOY = new Date("2026-09-17T12:00:00Z");

// ── Recordatorios a bodega ───────────────────────────────────────────────────

test("A1 · contrato recién aprobado y sin recordatorios: espera la cadencia", () => {
  const d = decideAviso({ fecha_aprobacion: ts("2026-09-16T12:00:00Z") }, { ahora: HOY });
  assert.equal(d.accion, "nada");
});

test("A2 · pasada la cadencia sale el primer recordatorio a bodega", () => {
  const d = decideAviso({ fecha_aprobacion: ts("2026-09-10T12:00:00Z") }, { ahora: HOY });
  assert.equal(d.accion, "recordatorio");
  assert.equal(d.intento, 1);
  assert.equal(d.diasAprobado, 7);
});

test("A3 · los recordatorios se numeran sobre el contador guardado", () => {
  const d = decideAviso({
    fecha_aprobacion: ts("2026-08-26T12:00:00Z"),
    seriales_recordatorio_count: 2,
    seriales_recordatorio_at: ts("2026-09-10T12:00:00Z"),
  }, { ahora: HOY });
  assert.equal(d.accion, "recordatorio");
  assert.equal(d.intento, 3);
});

test("A4 · sin fecha de aprobación no se inventa un aviso", () => {
  assert.equal(decideAviso({}, { ahora: HOY }).accion, "nada");
});

test("A5 · un contrato borrado no recibe nada", () => {
  const d = decideAviso({ deleted: true, fecha_aprobacion: ts("2026-01-01T12:00:00Z") }, { ahora: HOY });
  assert.equal(d.accion, "nada");
});

// ── Escalación (lo que antes era silencio) ───────────────────────────────────

test("B1 · CONCORD: pasado el tope de 4 recordatorios, escala en vez de callarse", () => {
  const concord = {
    contrato_id: "ALQ20260810-01",
    cliente_nombre: "CONCORD SECURITY, S.A.",
    estado: "activo",
    fecha_aprobacion: ts("2026-08-26T21:32:53Z"),
    seriales_recordatorio_count: MAX_RECORDATORIOS,
    seriales_recordatorio_at: ts("2026-08-17T12:00:50Z"),
  };
  const d = decideAviso(concord, { ahora: HOY });
  assert.equal(d.accion, "escalacion", "con el código viejo esto era un `continue` mudo");
  assert.equal(d.intento, 1);
  assert.equal(d.diasAprobado, 21);
});

test("B2 · la primera escalación no sale el mismo día del cuarto recordatorio", () => {
  const base = {
    fecha_aprobacion: ts("2026-09-01T12:00:00Z"),
    seriales_recordatorio_count: MAX_RECORDATORIOS,
    seriales_recordatorio_at: ts("2026-09-15T12:00:00Z"),   // hace 2 días
  };
  assert.equal(decideAviso(base, { ahora: HOY }).accion, "nada");
});

test("B3 · la escalación se repite cada semana, numerada", () => {
  const base = {
    fecha_aprobacion: ts("2026-07-01T12:00:00Z"),
    seriales_recordatorio_count: MAX_RECORDATORIOS,
    seriales_recordatorio_at: ts("2026-07-20T12:00:00Z"),
    seriales_escalado_count: 3,
  };
  // Escalada ayer: todavía no.
  assert.equal(decideAviso({ ...base, seriales_escalado_at: ts("2026-09-16T12:00:00Z") }, { ahora: HOY }).accion, "nada");
  // Escalada hace 7 días: toca la cuarta.
  const d = decideAviso({ ...base, seriales_escalado_at: ts("2026-09-10T12:00:00Z") }, { ahora: HOY });
  assert.equal(d.accion, "escalacion");
  assert.equal(d.intento, 4);
});

test("B4 · la cadencia de escalación es configurable", () => {
  const c = {
    fecha_aprobacion: ts("2026-07-01T12:00:00Z"),
    seriales_recordatorio_count: MAX_RECORDATORIOS,
    seriales_escalado_count: 1,
    seriales_escalado_at: ts("2026-09-14T12:00:00Z"),       // hace 3 días
  };
  assert.equal(decideAviso(c, { ahora: HOY }).accion, "nada");
  assert.equal(decideAviso(c, { ahora: HOY, diasEsc: 2 }).accion, "escalacion");
});

test("B5 · la escalación nunca se apaga sola: a los 6 meses sigue saliendo", () => {
  const d = decideAviso({
    fecha_aprobacion: ts("2026-03-17T12:00:00Z"),
    seriales_recordatorio_count: MAX_RECORDATORIOS,
    seriales_escalado_count: 20,
    seriales_escalado_at: ts("2026-09-01T12:00:00Z"),
  }, { ahora: HOY });
  assert.equal(d.accion, "escalacion");
  assert.equal(d.intento, 21);
});

// ── Destinatarios y contenido (lectura del fuente del cron) ──────────────────

const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("C1 · la escalación sale de bodega: va a activaciones con copia al vendedor", () => {
  const src = leer("src", "triggers", "scheduled", "recordatorioSeriales.js");
  assert.ok(/activacionesEmailTo/.test(src), "la escalación debe ir al buzón de activaciones");
  assert.ok(/emailDeUid\(c\.creado_por_uid/.test(src), "debe copiar al vendedor que elaboró el contrato");
  assert.ok(/seriales_escalado_count/.test(src), "debe guardar el contador de escalaciones");
  assert.ok(!/if \(count >= MAX_RECORDATORIOS\) continue;/.test(src), "el `continue` mudo al llegar al tope no debe volver");
});

test("C3 · el correo explica por qué le llegó a cada uno de los tres", () => {
  const src = leer("src", "triggers", "scheduled", "recordatorioSeriales.js");
  const bloque = src.slice(src.indexOf("Por qué te llegó este correo"), src.indexOf("Aviso ${intento} de escalamiento"));
  assert.ok(bloque, "falta el bloque que explica los destinatarios");
  for (const quien of ["activaciones", "bodega", "vendedor del contrato"]) {
    assert.ok(bloque.includes(quien), `el bloque debe decir por qué lo recibe ${quien}`);
  }
  assert.ok(/basta con que uno lo resuelva/.test(bloque), "debe aclarar que es el mismo correo para los tres");
});

test("C2 · el correo de seriales asignados dice desde cuándo está viva la cuenta", () => {
  const src = leer("src", "triggers", "contratos", "onApproval.js");
  assert.ok(/esTramiteViejo/.test(src), "debe distinguir el trámite viejo del recién aprobado");
  assert.ok(/Esta cuenta NO se activó hoy/.test(src), "debe advertir que no es una activación de hoy");
  assert.ok(/Seriales asignados hoy · contrato APROBADO el/.test(src), "el asunto debe decir lo que pasó hoy");
  assert.ok(/Cuenta activa desde/.test(src), "el cuerpo debe mostrar la fecha de activación real");
  assert.ok(/APROBADO/.test(src), "el asunto debe conservar la palabra por la que activaciones filtra");
});

// ── Contrato que ya no vive (2026-09-30, DEMO20260814-01 Tocumen) ────────────

test("D1 · un contrato anulado con la marca pendiente no recibe más escalaciones", () => {
  const tocumen = {
    contrato_id: "DEMO20260814-01", estado: "anulado",
    fecha_aprobacion: ts("2026-08-14T19:56:00Z"),
    seriales_recordatorio_count: MAX_RECORDATORIOS,
    seriales_recordatorio_at: ts("2026-08-20T12:00:00Z"),
    seriales_escalado_count: 2, seriales_escalado_at: ts("2026-09-25T12:00:00Z"),
  };
  assert.equal(decideAviso(tocumen, { ahora: new Date("2026-10-02T12:00:00Z") }).accion, "nada");
  assert.equal(decideAviso({ ...tocumen, estado: "vencido" }, { ahora: new Date("2026-10-02T12:00:00Z") }).accion, "nada");
  assert.equal(decideAviso({ ...tocumen, estado: "aprobado" }, { ahora: new Date("2026-10-02T12:00:00Z") }).accion, "escalacion");
});

// ── Gestiones esperando a bodega (2026-09-30, GR20260917-03 BALBOA) ─────────

const { decideAvisoGestion, baseBodegaGestion, pendienteGestion, pedidoSeriales } = require("../src/domain/avisoSeriales");

test("E1 · BALBOA: reemplazo 13 días en bodega sin serial recibe recordatorio", () => {
  const balboa = {
    tipo: "reemplazo", estado: "pendiente_bodega",
    fecha_solicitud: ts("2026-09-17T21:27:00Z"),
    aprobacion: { at: ts("2026-09-17T21:29:00Z") },
    items: [{ serial_saliente: "24O31A0882", modelo: "PNC360S-R", serial_nuevo: null }],
  };
  const d = decideAvisoGestion(balboa, { ahora: new Date("2026-09-30T12:00:00Z") });
  assert.equal(d.accion, "recordatorio");
  assert.equal(d.intento, 1);
  assert.equal(d.diasAprobado, 12);
  const p = pendienteGestion(balboa);
  assert.deepEqual([p.total, p.asignados, p.faltan.length], [1, 0, 1]);
});

test("E2 · fuera de pendiente_bodega, o si es baja, no se avisa", () => {
  const base = { fecha_solicitud: ts("2026-08-01T12:00:00Z"), items: [{}] };
  for (const estado of ["pendiente_aprobacion", "pendiente_firma", "pendiente_cliente", "cerrada", "anulada"]) {
    assert.equal(decideAvisoGestion({ ...base, tipo: "reemplazo", estado }, { ahora: HOY }).accion, "nada", estado);
  }
  assert.equal(decideAvisoGestion({ ...base, tipo: "baja", estado: "pendiente_bodega" }, { ahora: HOY }).accion, "nada");
  assert.equal(decideAvisoGestion({ ...base, tipo: "reemplazo", estado: "pendiente_bodega", deleted: true }, { ahora: HOY }).accion, "nada");
});

test("E3 · la espera cuenta desde la entrada MÁS RECIENTE a bodega (cliente aceptó / cambio de modelo)", () => {
  const g = {
    fecha_solicitud: ts("2026-09-01T12:00:00Z"),
    aprobacion: { at: ts("2026-09-02T12:00:00Z") },
    cobro: { aceptada_at: ts("2026-09-10T12:00:00Z") },
    cambio_modelo: { a: { decidido_at: ts("2026-09-15T12:00:00Z") } },
  };
  assert.equal(baseBodegaGestion(g).toISOString(), "2026-09-15T12:00:00.000Z");
});

test("E4 · pasado el tope, la gestión escala con sus propios contadores", () => {
  const g = {
    tipo: "demo", estado: "pendiente_bodega", fecha_solicitud: ts("2026-08-01T12:00:00Z"),
    demo: { lineas: [{ modelo: "HYT-P50", cantidad: 3 }], seriales_asignados: [{ serial: "A1" }] },
    bodega_aviso: { recordatorio_count: MAX_RECORDATORIOS, recordatorio_at: ts("2026-08-20T12:00:00Z") },
  };
  const d = decideAvisoGestion(g, { ahora: HOY });
  assert.equal(d.accion, "escalacion");
  assert.equal(d.intento, 1);
  const p = pendienteGestion(g);
  assert.deepEqual([p.total, p.asignados], [3, 1]);
});

// ── El recordatorio pide lo mismo que la solicitud ──────────────────────────

test("F1 · renovación sin equipo con reemplazos: el pedido es SOLO lo que entra, sin avance", () => {
  const c = { accion: "Renovación", renovacion_sin_equipo: true, equipos: [{ modelo: "PNC360S-R", cantidad: 20 }] };
  const p = pedidoSeriales(c, [{ modelo: "PNC460-R", cantidad: 2 }]);
  assert.deepEqual(p.filas, [{ modelo: "PNC460-R", cantidad: 2 }]);
  assert.equal(p.total, null);
});

test("F2 · contrato normal: todas las líneas y el total descuenta las bajas", () => {
  const p = pedidoSeriales({ equipos: [{ modelo: "HYT-P50", cantidad: 14 }, { modelo: "X", cantidad: 0 }, { modelo: "PNC460-R", cantidad: 2 }], baja_cancelado_total: 1 }, []);
  assert.equal(p.filas.length, 2);
  assert.equal(p.total, 15);
});

test("F3 · la solicitud y el recordatorio usan la misma definición del pedido", () => {
  assert.ok(/pedidoSeriales\(after, reemplazos\)/.test(leer("src", "triggers", "contratos", "onApproval.js")));
  assert.ok(/pedidoSeriales\(c, reemplazos\)/.test(leer("src", "triggers", "scheduled", "recordatorioSeriales.js")));
});

test("F4 · el eco de los contadores de aviso no vuelve a correr la máquina de la gestión", () => {
  const src = leer("src", "triggers", "gestiones", "onGestionWrite.js");
  assert.ok(/"bodega_aviso", "firma_recordatorio_at"\]/.test(src));
});

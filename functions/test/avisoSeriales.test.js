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

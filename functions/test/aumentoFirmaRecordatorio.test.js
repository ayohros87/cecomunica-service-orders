// Aviso de los aumentos que llevan días esperando la firma del anexo.
//
// Por qué (auditoría 2026-09-17): 6 aumentos esperando firma, el más viejo con
// 14 días y el radio ya preparado en oficina. Cuesta doble —el equipo queda
// apartado sin poder asignarse a otro, y el tramo no se factura porque arranca
// desde la entrega— y nada avisaba.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cron = fs.readFileSync(
  path.join(__dirname, "..", "src", "triggers", "scheduled", "recordatorioOperativo.js"), "utf8");
const i = cron.indexOf("── J) Aumentos esperando la firma del anexo");
const bloque = cron.slice(i, i + 4200);

test("la sección existe y mira solo aumentos en pendiente_firma", () => {
  assert.ok(i > 0, "la sección J está en el cron");
  assert.match(bloque, /\.where\("estado", "==", "pendiente_firma"\)/);
  assert.match(bloque, /if \(g\.deleted \|\| g\.tipo !== "aumento"\) continue;/);
});

test("el reloj corre desde la aprobación, que es cuando la firma queda pendiente", () => {
  assert.match(bloque, /const base = aDate\(g\.aprobacion\?\.at\) \|\| aDate\(g\.fecha_solicitud\);/);
  assert.match(bloque, /if \(edad < dias\) continue;/);
});

test("el umbral es configurable y tiene default sensato", () => {
  assert.match(bloque, /let dias = 5;/);
  assert.match(bloque, /cfg\.aumento_firma_recordatorio_dias/);
});

test("el aviso SE REPITE: un solo recordatorio se olvida igual que ninguno", () => {
  assert.match(bloque, /const ultimo = aDate\(g\.firma_recordatorio_at\);/);
  assert.match(bloque, /if \(ultimo && \(now - ultimo\) \/ 86400000 < dias\) continue;/);
  assert.match(bloque, /firma_recordatorio_at: admin\.firestore\.FieldValue\.serverTimestamp\(\)/);
});

test("el correo dice lo que cuesta esperar, no solo que falta una firma", () => {
  assert.match(bloque, /siguen apartados/);
  assert.match(bloque, /no se factura/);
  assert.match(bloque, /anula la gestión para soltar los equipos/,
    "y ofrece la salida cuando el cliente ya no lo quiere");
});

test("va al responsable de la gestión, con ventas en copia", () => {
  assert.match(bloque, /g\.responsable_email \|\| await G\.vendedorEmailDeCliente\(g\.cliente_id\)/);
  assert.match(bloque, /const cc = await G\.aprobacionesTo\(\);/);
});

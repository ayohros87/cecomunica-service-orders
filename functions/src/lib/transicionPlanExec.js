// Ejecuta el plan de transición al confirmarse la entrega del contrato nuevo.
// Función PURA (test/transicionPlanExec.test.js) — onEntregaTransicion le pasa
// las unidades y aplica el resultado.
//
// El plan lo escribe el vendedor en la VENTA (public/js/domain/transicionPlan.js,
// informe docs/INFORME_TRACKING_SERIAL_2026-08-12.md P1): destino por unidad
// ('serial') o cantidades por modelo ('cantidad'). Aquí se decide qué unidades
// del origen se RECLAMAN (devolución) y con qué entrante se parea cada
// reemplazo — el pareo produce el mapeo con entrante, y onMapeoWrite estampa
// el linaje `reemplaza_a` que hasta hoy nunca se generó (0 en toda la base).
//
// REGLAS:
//   · propiedad 'cliente' NUNCA se reclama (son radios del cliente).
//   · plan nivel 'serial':
//       - 'continua'  → NO se reclama. Si sigue asignada al origen es que la
//                       página de seriales aún no la movió — se respeta el plan
//                       y se deja quieta (la reasignación la adopta después).
//       - 'reemplaza' → se reclama, pareada con un entrante del MISMO modelo
//                       (FIFO); sin entrante disponible queda sin sustituto.
//       - 'devuelve'  → se reclama sin sustituto.
//       - 'no_tiene'  → NO se reclama: el cliente declaró que no tiene ese
//                       equipo y la ficha ya se soltó al aprobar
//                       (lib/planRenovacion.js). Reclamarla abriría una
//                       recuperación de algo que nadie tiene.
//       - unidad FUERA del plan → 'devuelve' (la regla de fondo no cambia:
//         todo el alquiler del origen se devuelve salvo decisión explícita).
//         EXCEPCIÓN `soloDeclaradas` (renovación SIN equipo): ahí el plan es
//         la lista completa que revisó el vendedor y lo que no aparece
//         CONTINÚA — una renovación sin equipo no devuelve nada por omisión.
//   · plan nivel 'cantidad' o SIN plan → comportamiento clásico: se reclama
//     todo el alquiler aún asignado al origen. Es correcto también con plan
//     por cantidades: las unidades que "continúan" se mueven al contrato nuevo
//     cuando recepción asigna seriales (reasignación), así que lo que siga
//     colgando del origen a la hora de la entrega ES el conjunto a devolver.
"use strict";

const norm = (s) => (s ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const labelKey = (s) => (s || "").toString().toLowerCase()
  .normalize("NFD").replace(/[^a-z0-9]+/g, "").replace(/r$/, "");

// ¿El entrante puede sustituir a esta unidad? Misma fila del catálogo o mismo
// texto de modelo (tolerante al sufijo -R, versión ligera de mismoModelo).
function _mismoModelo(unidad, entrante) {
  if (unidad.modelo_id && entrante.modelo_id) return unidad.modelo_id === entrante.modelo_id;
  const a = labelKey(unidad.modelo_label || unidad.modelo);
  const b = labelKey(entrante.modelo_label || entrante.modelo);
  if (a && b) return a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
  return true; // sin datos de modelo: no bloquear el pareo
}

/**
 * @param {Object|null} plan — contrato.transicion_plan (o null)
 * @param {Array} unidadesOrigen — unidades del pool aún asignadas a los orígenes
 *   [{ id, serial, serial_norm, modelo_id, modelo_label, estado, propiedad }]
 * @param {Array} entrantesNuevo — unidades del pool asignadas al contrato NUEVO
 * @param {{soloDeclaradas?: boolean}} [opts] — soloDeclaradas: lo que no está
 *   en el plan continúa (renovación sin equipo); sin plan por serial no aplica.
 * @returns {{ reclamar: Array<{unidad, entrante|null}>, continuan: Array, noTienen: Array }}
 */
function decidirSalientes(plan, unidadesOrigen, entrantesNuevo, opts = {}) {
  const alquiler = (unidadesOrigen || []).filter((u) => u.propiedad !== "cliente");

  const esSerial = plan && plan.nivel === "serial" && Array.isArray(plan.unidades);
  if (!esSerial) {
    return { reclamar: alquiler.map((u) => ({ unidad: u, entrante: null })), continuan: [], noTienen: [] };
  }

  const destinoDe = new Map();
  for (const u of plan.unidades) {
    const k = norm(u.serial_norm || u.serial);
    if (k) destinoDe.set(k, u.destino);
  }
  const fueraDelPlan = opts.soloDeclaradas ? "continua" : "devuelve";

  const continuan = [];
  const noTienen = [];
  const aParear = [];
  const reclamar = [];
  for (const u of alquiler) {
    const destino = destinoDe.get(norm(u.serial_norm || u.serial)) || fueraDelPlan;
    if (destino === "continua") { continuan.push(u); continue; }
    if (destino === "no_tiene") { noTienen.push(u); continue; }
    if (destino === "reemplaza") { aParear.push(u); continue; }
    reclamar.push({ unidad: u, entrante: null });
  }

  // Pareo FIFO por modelo: cada 'reemplaza' toma el primer entrante libre del
  // mismo modelo. El orden estable (serial) hace el resultado reproducible.
  const libres = [...(entrantesNuevo || [])]
    .sort((a, b) => String(a.serial || a.serial_norm || "").localeCompare(String(b.serial || b.serial_norm || "")));
  const usados = new Set();
  for (const u of aParear.sort((a, b) => String(a.serial || "").localeCompare(String(b.serial || "")))) {
    const ent = libres.find((e) => !usados.has(e.id) && _mismoModelo(u, e));
    if (ent) usados.add(ent.id);
    reclamar.push({ unidad: u, entrante: ent || null });
  }

  return { reclamar, continuan, noTienen };
}

module.exports = { decidirSalientes };

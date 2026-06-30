const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const { buildOrderSearchTokens, tokensEqual } = require("../lib/searchTokens");

/**
 * runBackfill — admin-only callable to run one-shot data migrations
 * (formerly stand-alone scripts in functions/backfill-*.js) from the UI.
 *
 * Single entry point with action discriminator so the frontend has one
 * callable to wire. Each action mirrors the script of the same name.
 *
 * Actions:
 *   { action: "searchTokens", dryRun? }
 *     - Mirrors functions/backfill-search-tokens.js
 *     - Populates `searchTokens` on existing ordenes_de_servicio.
 *     - Idempotent (compares computed vs stored before writing).
 *   { action: "normalizeGrupos", dryRun? }
 *     - Trims + collapses whitespace, accent+case-insensitive dedups the
 *       grupos[] string array on every non-deleted poc_devices doc.
 *     - Mirrors FMT.normalizeGrupo / FMT.dedupGrupos in core/formatting.js.
 *     - Idempotent (only writes when the computed array differs).
 *   { action: "linkClienteId", dryRun? }
 *     - Adds stable `cliente_id` to legacy ordenes/poc_devices linked by name.
 *   { action: "clienteIp", dryRun? }
 *     - Derives each client's assigned `ip` from existing poc_devices (mode when
 *       several) and writes it to clientes/<id>.ip when the client has no IP yet.
 *     - Idempotent: never overwrites an existing IP. Reports `ambiguos` (clients
 *       with 2+ distinct device IPs) and `huerfanos` (no derivable IP).
 *
 * Returns {action, dryRun, scanned, ...counters}. All actions are
 * idempotent — safe to re-run.
 */

const BATCH_SIZE = 400;

async function requireAdmin(callerUid) {
  if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db.collection("usuarios").doc(callerUid).get();
  if (!snap.exists || snap.data().rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo administradores.");
  }
}

// ─────────── searchTokens ───────────

async function backfillSearchTokens(dryRun) {
  const startedAt = Date.now();
  const snap = await db.collection("ordenes_de_servicio").get();

  let scanned = 0, skippedDeleted = 0, skippedUnchanged = 0;
  let toWrite = 0, written = 0, errors = 0;

  let batch = db.batch();
  let opsInBatch = 0;

  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) {
      written += opsInBatch;
      batch = db.batch();
      opsInBatch = 0;
      return;
    }
    try {
      await batch.commit();
      written += opsInBatch;
    } catch (err) {
      logger.error("[runBackfill.searchTokens] batch commit failed", { err: err.message });
      errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data();
    if (data.eliminado === true) { skippedDeleted++; continue; }

    const newTokens     = buildOrderSearchTokens(doc.id, data);
    const currentTokens = Array.isArray(data.searchTokens) ? data.searchTokens : [];
    if (tokensEqual(newTokens, currentTokens)) { skippedUnchanged++; continue; }

    toWrite++;
    batch.update(doc.ref, { searchTokens: newTokens });
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { scanned, skippedDeleted, skippedUnchanged, toWrite, written, errors, elapsedSec };
}

// ─────────── normalizeGrupos ───────────
//
// Mirrors FMT.normalizeGrupo + FMT.dedupGrupos from public/js/core/formatting.js.
// Kept inline (not extracted to lib/) because the function-side rule set is
// tiny and the consumers (callable + frontend) live in different runtimes.

function normalizeGrupoName(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ");
}

function normalizeForDedup(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim();
}

function dedupGrupos(arr) {
  const seen = new Set();
  const out = [];
  for (const g of (arr || [])) {
    const norm = normalizeGrupoName(g);
    if (!norm) continue;
    const k = normalizeForDedup(norm);
    if (seen.has(k)) continue;
    seen.add(k); out.push(norm);
  }
  return out;
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function backfillNormalizeGrupos(dryRun) {
  const startedAt = Date.now();
  const snap = await db.collection("poc_devices").get();

  let scanned = 0, skippedDeleted = 0, skippedUnchanged = 0;
  let toWrite = 0, written = 0, errors = 0;

  let batch = db.batch();
  let opsInBatch = 0;

  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) {
      written += opsInBatch;
      batch = db.batch();
      opsInBatch = 0;
      return;
    }
    try {
      await batch.commit();
      written += opsInBatch;
    } catch (err) {
      logger.error("[runBackfill.normalizeGrupos] batch commit failed", { err: err.message });
      errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data();
    if (data.deleted === true) { skippedDeleted++; continue; }

    const current = Array.isArray(data.grupos) ? data.grupos : [];
    const next    = dedupGrupos(current);
    if (arraysEqual(current, next)) { skippedUnchanged++; continue; }

    toWrite++;
    batch.update(doc.ref, { grupos: next });
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { scanned, skippedDeleted, skippedUnchanged, toWrite, written, errors, elapsedSec };
}

// ─────────── linkClienteId ───────────
//
// Enlaza órdenes y equipos POC legacy a su cliente por `cliente_id` (estable),
// usando match NORMALIZADO del nombre actual (`cliente`) contra los clientes
// activos. Aditivo: solo agrega `cliente_id` donde falta; no toca el nombre.
// Idempotente (salta los que ya tienen id). Reporta ambiguos (nombre que mapea
// a 2+ clientes) y huérfanos (nombre que no resuelve a ningún cliente).

function _normNombre(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

async function backfillLinkClienteId(dryRun) {
  const startedAt = Date.now();

  // Mapa nombre_norm -> [ids] de clientes activos.
  const cliSnap = await db.collection("clientes").where("deleted", "==", false).get();
  const nameToIds = new Map();
  for (const doc of cliSnap.docs) {
    const n = _normNombre(doc.data().nombre);
    if (!n) continue;
    if (!nameToIds.has(n)) nameToIds.set(n, []);
    nameToIds.get(n).push(doc.id);
  }

  let batch = db.batch();
  let opsInBatch = 0;
  const flushBatch = async () => {
    if (opsInBatch === 0 || dryRun) { batch = db.batch(); opsInBatch = 0; return; }
    try { await batch.commit(); }
    catch (err) { logger.error("[runBackfill.linkClienteId] commit failed", { err: err.message }); }
    batch = db.batch();
    opsInBatch = 0;
  };

  const detalle = {};
  for (const [col, delField] of [["ordenes_de_servicio", "eliminado"], ["poc_devices", "deleted"]]) {
    const snap = await db.collection(col).get();
    let scanned = 0, skippedDeleted = 0, yaLinked = 0, linked = 0, ambiguos = 0, huerfanos = 0;
    const muestraHuerfanos = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d[delField] === true) { skippedDeleted++; continue; }
      scanned++;
      if ((d.cliente_id || "").toString().trim()) { yaLinked++; continue; }
      const n = _normNombre(d.cliente);
      const ids = n ? nameToIds.get(n) : null;
      if (!ids || ids.length === 0) {
        huerfanos++;
        if (muestraHuerfanos.length < 25 && d.cliente) muestraHuerfanos.push(d.cliente);
        continue;
      }
      if (ids.length > 1) { ambiguos++; continue; }  // nombre duplicado entre clientes → resolver con dedup primero
      linked++;
      if (!dryRun) {
        batch.update(doc.ref, { cliente_id: ids[0] });
        opsInBatch++;
        if (opsInBatch >= BATCH_SIZE) await flushBatch();
      }
    }
    detalle[col] = { scanned, skippedDeleted, yaLinked, linked, ambiguos, huerfanos, muestraHuerfanos };
  }
  await flushBatch();

  const sum = k => (detalle.ordenes_de_servicio[k] || 0) + (detalle.poc_devices[k] || 0);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    elapsedSec,
    scanned: sum("scanned"),
    yaLinked: sum("yaLinked"),
    linked: sum("linked"),
    ambiguos: sum("ambiguos"),
    huerfanos: sum("huerfanos"),
    written: sum("linked"),
    detalle,
  };
}

// ─────────── clienteIp ───────────
//
// Deriva el IP asignado de cada cliente a partir de los equipos PoC existentes y
// lo escribe en `clientes/<id>.ip` cuando el cliente aún no tiene IP. Por device
// se resuelve el cliente vía `cliente_id` (estable) o, si falta, por nombre
// normalizado contra los clientes activos (solo si resuelve a 1). Cuando un cliente
// tiene equipos con IPs distintos se elige el más frecuente (modo) y se reporta
// como `ambiguos` para revisión. Idempotente: nunca sobrescribe un IP existente.

async function backfillClienteIp(dryRun) {
  const startedAt = Date.now();

  // Mapa nombre_norm -> [ids] de clientes activos (para resolver devices legacy
  // que solo guardan `cliente` por nombre).
  const cliSnap = await db.collection("clientes").where("deleted", "==", false).get();
  const nameToIds = new Map();
  for (const doc of cliSnap.docs) {
    const n = _normNombre(doc.data().nombre);
    if (!n) continue;
    if (!nameToIds.has(n)) nameToIds.set(n, []);
    nameToIds.get(n).push(doc.id);
  }

  // Tally de IPs por cliente: Map<clienteId, Map<ip, count>>.
  const ipTally = new Map();
  const devSnap = await db.collection("poc_devices").get();
  for (const doc of devSnap.docs) {
    const d = doc.data();
    if (d.deleted === true) continue;
    const ip = (d.ip || "").toString().trim();
    if (!ip) continue;
    let cid = (d.cliente_id || "").toString().trim();
    if (!cid) {
      const ids = nameToIds.get(_normNombre(d.cliente));
      if (!ids || ids.length !== 1) continue; // sin id y nombre ausente/ambiguo → no se puede atribuir
      cid = ids[0];
    }
    if (!ipTally.has(cid)) ipTally.set(cid, new Map());
    const m = ipTally.get(cid);
    m.set(ip, (m.get(ip) || 0) + 1);
  }

  // IP más frecuente + flag de conflicto (2+ IPs distintos).
  const pickMode = (m) => {
    let best = null, bestCount = -1;
    for (const [ip, c] of m) if (c > bestCount) { best = ip; bestCount = c; }
    return { ip: best, conflict: m.size > 1 };
  };

  let scanned = 0, skippedUnchanged = 0, toWrite = 0, written = 0, ambiguos = 0, huerfanos = 0, errors = 0;
  const muestraHuerfanos = [];

  let batch = db.batch();
  let opsInBatch = 0;
  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) {
      written += opsInBatch;
      batch = db.batch();
      opsInBatch = 0;
      return;
    }
    try {
      await batch.commit();
      written += opsInBatch;
    } catch (err) {
      logger.error("[runBackfill.clienteIp] batch commit failed", { err: err.message });
      errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of cliSnap.docs) {
    scanned++;
    const current = (doc.data().ip || "").toString().trim();
    if (current) { skippedUnchanged++; continue; } // ya tiene IP → no tocar
    const tally = ipTally.get(doc.id);
    if (!tally || tally.size === 0) {
      huerfanos++;
      if (muestraHuerfanos.length < 25 && doc.data().nombre) muestraHuerfanos.push(doc.data().nombre);
      continue;
    }
    const { ip, conflict } = pickMode(tally);
    if (conflict) ambiguos++;
    toWrite++;
    batch.update(doc.ref, { ip });
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    scanned, skippedUnchanged, toWrite, written, ambiguos, huerfanos, errors, elapsedSec,
    detalle: { clientes: { huerfanos, muestraHuerfanos } },
  };
}

// ─────────── marcarSerialesLegacy ───────────
//
// Corte del flujo de seriales (reemplazos/renovaciones). Marca como "legacy"
// todo contrato que HOY esté en activo/aprobado y que NO tenga aún un estado de
// seriales. Los saca del nuevo flujo: la lista no los muestra como "Seriales
// pendientes", el recordatorio diario los ignora (solo busca "pendiente"), el
// trigger de solicitud no los re-pide (idempotencia por `seriales_estado`), y el
// correo a activaciones queda bloqueado (backstop en onSerialesAsignadasSendPdf).
// Idempotente: salta los que ya tienen `seriales_estado` (pendiente/asignados/
// legacy) y los que no están en activo/aprobado.

async function backfillMarcarSerialesLegacy(dryRun) {
  const startedAt = Date.now();
  const snap = await db.collection("contratos").get();

  let scanned = 0, skippedDeleted = 0, skippedEstado = 0, skippedYaEstado = 0;
  let toWrite = 0, written = 0, errors = 0;

  let batch = db.batch();
  let opsInBatch = 0;

  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) { written += opsInBatch; batch = db.batch(); opsInBatch = 0; return; }
    try { await batch.commit(); written += opsInBatch; }
    catch (err) {
      logger.error("[runBackfill.marcarSerialesLegacy] batch commit failed", { err: err.message });
      errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const doc of snap.docs) {
    scanned++;
    const d = doc.data() || {};
    if (d.deleted === true) { skippedDeleted++; continue; }
    if (!["activo", "aprobado"].includes(d.estado)) { skippedEstado++; continue; }
    if (d.seriales_estado) { skippedYaEstado++; continue; } // ya en el flujo (pendiente/asignados/legacy)

    toWrite++;
    batch.update(doc.ref, {
      seriales_estado: "legacy",
      seriales_legacy_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { scanned, skippedDeleted, skippedEstado, skippedYaEstado, toWrite, written, errors, elapsedSec };
}

// ─────────── dispatcher ───────────

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 540 },
  async (request) => {
    const callerUid = request.auth?.uid;
    await requireAdmin(callerUid);

    const data   = request.data || {};
    const action = data.action;
    const dryRun = !!data.dryRun;

    logger.info("[runBackfill] start", { action, dryRun, by: callerUid });

    let result;
    switch (action) {
      case "searchTokens":
        result = await backfillSearchTokens(dryRun);
        break;
      case "normalizeGrupos":
        result = await backfillNormalizeGrupos(dryRun);
        break;
      case "linkClienteId":
        result = await backfillLinkClienteId(dryRun);
        break;
      case "clienteIp":
        result = await backfillClienteIp(dryRun);
        break;
      case "marcarSerialesLegacy":
        result = await backfillMarcarSerialesLegacy(dryRun);
        break;
      default:
        throw new HttpsError("invalid-argument", `Acción desconocida: ${action}`);
    }

    logger.info("[runBackfill] done", { action, dryRun, ...result });
    return { action, dryRun, ...result };
  }
);

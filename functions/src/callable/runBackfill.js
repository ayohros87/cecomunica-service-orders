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
 *   { action: "organizacionesPorRuc", dryRun? }
 *     - Propone una organización por cada RUC compartido por 2+ clientes y
 *       asigna esas cuentas (organizacionId). Reutiliza orgs existentes por
 *       ruc_norm; salta cuentas ya asignadas. Devuelve `groups` (preview).
 *     - Idempotente. No toca contratos, órdenes ni POC.
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

// ─────────── organizacionesPorRuc ───────────
//
// Propone una organización por cada RUC compartido por 2+ clientes y asigna
// esas cuentas a la organización. Idempotente: reutiliza la organización
// existente con el mismo `ruc_norm` y salta cuentas ya asignadas a ella.
// En dry-run no escribe; devuelve un preview de los grupos propuestos.

function orgNorm(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().trim();
}

function orgSearchTokens(nombre, rucNorm) {
  const toks = new Set();
  for (const p of orgNorm(nombre).split(/[^a-z0-9]+/).filter(Boolean)) {
    for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
  }
  if (rucNorm) toks.add(rucNorm);
  return Array.from(toks).slice(0, 200);
}

function mostCommon(arr) {
  const m = new Map();
  let best = null, bestN = 0;
  for (const x of arr) {
    const k = (x || "").trim();
    if (!k) continue;
    const n = (m.get(k) || 0) + 1;
    m.set(k, n);
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}

async function backfillOrganizacionesPorRuc(dryRun) {
  const startedAt = Date.now();

  // 1) Cargar clientes y agrupar por ruc_norm.
  const snap = await db.collection("clientes").get();
  let scanned = 0, skippedDeleted = 0, errors = 0;
  const buckets = new Map(); // ruc_norm -> [{ id, ref, nombre, organizacionId, ruc }]
  for (const doc of snap.docs) {
    scanned++;
    const d = doc.data();
    if (d.deleted === true) { skippedDeleted++; continue; }
    const ruc = (d.ruc_norm || "").trim();
    if (!ruc) continue;
    if (!buckets.has(ruc)) buckets.set(ruc, []);
    buckets.get(ruc).push({
      id: doc.id, ref: doc.ref,
      nombre: d.nombre || "",
      organizacionId: (d.organizacionId || "").trim(),
      ruc: d.ruc || "",
    });
  }

  // 2) Indexar organizaciones existentes por ruc_norm (reuse / idempotencia).
  const orgsSnap = await db.collection("organizaciones").where("deleted", "==", false).get();
  const orgByRuc = new Map();
  for (const o of orgsSnap.docs) {
    const r = (o.data().ruc_norm || "").trim();
    if (r && !orgByRuc.has(r)) orgByRuc.set(r, { id: o.id, nombre: o.data().nombre || "" });
  }

  let gruposPropuestos = 0, orgsCreadas = 0, cuentasAsignadas = 0, skippedYaAsignados = 0;
  const groups = []; // preview (capped)

  let batch = db.batch();
  let opsInBatch = 0;
  const flushBatch = async () => {
    if (opsInBatch === 0 || dryRun) { batch = db.batch(); opsInBatch = 0; return; }
    try { await batch.commit(); }
    catch (err) { logger.error("[runBackfill.organizacionesPorRuc] commit failed", { err: err.message }); errors += opsInBatch; }
    batch = db.batch();
    opsInBatch = 0;
  };

  for (const [ruc, members] of buckets) {
    if (members.length < 2) continue; // solo multi-cuenta
    gruposPropuestos++;

    let org = orgByRuc.get(ruc) || null;
    const nombreOrg = (org && org.nombre) || mostCommon(members.map(m => m.nombre)) || members[0].nombre || "Organización";
    const rucDisplay = (members.find(m => m.ruc) || {}).ruc || ruc;

    // Cuentas que faltan por asignar al destino.
    const targetId = org ? org.id : null;
    const pendientes = members.filter(m => !m.organizacionId || (targetId && m.organizacionId !== targetId));
    const accion = org ? (pendientes.length ? "reuse" : "skip") : "create";

    if (accion === "skip") {
      skippedYaAsignados += members.length;
      if (groups.length < 200) groups.push({ ruc: rucDisplay, orgNombre: nombreOrg, accion, miembros: members.length, asignar: 0 });
      continue;
    }

    // Crear organización si no existe (pre-generamos id para asignar en el mismo lote).
    let orgId = targetId;
    if (!org) {
      const orgRef = db.collection("organizaciones").doc();
      orgId = orgRef.id;
      if (!dryRun) {
        batch.set(orgRef, {
          nombre: nombreOrg, nombre_norm: orgNorm(nombreOrg),
          ruc: rucDisplay, ruc_norm: ruc,
          searchTokens: orgSearchTokens(nombreOrg, ruc),
          activo: true, deleted: false,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          created_by: "backfill",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: "backfill",
        });
        opsInBatch++;
      }
      orgsCreadas++;
      orgByRuc.set(ruc, { id: orgId, nombre: nombreOrg });
      if (opsInBatch >= BATCH_SIZE) await flushBatch();
    }

    // Asignar cuentas pendientes.
    const orgTokens = orgSearchTokens(nombreOrg, ruc);
    for (const m of pendientes) {
      if (!dryRun) {
        batch.update(m.ref, {
          organizacionId: orgId,
          organizacion_nombre: nombreOrg,
          organizacion_norm: orgNorm(nombreOrg),
          searchTokens: admin.firestore.FieldValue.arrayUnion(...orgTokens),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: "backfill",
        });
        opsInBatch++;
        if (opsInBatch >= BATCH_SIZE) await flushBatch();
      }
      cuentasAsignadas++;
    }

    if (groups.length < 200) {
      groups.push({ ruc: rucDisplay, orgNombre: nombreOrg, accion, miembros: members.length, asignar: pendientes.length });
    }
  }
  await flushBatch();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    scanned, skippedDeleted, gruposPropuestos, orgsCreadas,
    cuentasAsignadas, skippedYaAsignados, errors, elapsedSec,
    written: cuentasAsignadas + orgsCreadas,
    groups,
  };
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
      case "organizacionesPorRuc":
        result = await backfillOrganizacionesPorRuc(dryRun);
        break;
      default:
        throw new HttpsError("invalid-argument", `Acción desconocida: ${action}`);
    }

    logger.info("[runBackfill] done", { action, dryRun, ...result });
    return { action, dryRun, ...result };
  }
);

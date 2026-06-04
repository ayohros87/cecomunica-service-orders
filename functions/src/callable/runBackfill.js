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
 *     - Migración: crea una organización por cada RUC (org-de-uno para RUC
 *       único), con la ficha fiscal del cliente más completo, y la espeja a las
 *       cuentas. Solo asigna cuentas con organizacionId vacío; reutiliza orgs
 *       existentes sin pisarlas; nunca toca cliente.nombre. Devuelve `groups`.
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

function orgSearchTokens(nombre, rucNorm, rucdvNorm, representante) {
  const toks = new Set();
  const add = (text) => {
    for (const p of orgNorm(text).split(/[^a-z0-9]+/).filter(Boolean)) {
      for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
    }
  };
  add(nombre); add(representante);
  if (rucNorm) toks.add(rucNorm);
  if (rucdvNorm) toks.add(rucdvNorm);
  return Array.from(toks).slice(0, 200);
}

// Nº de campos fiscales no vacíos (para elegir el cliente "canónico" del grupo).
function fiscalScore(d) {
  let s = 0;
  if ((d.ruc || "").trim()) s++;
  if ((d.dv || "").trim()) s++;
  if ((d.representante || "").trim()) s++;
  if ((d.representante_cedula || d.cedula_representante || "").trim()) s++;
  if (d.itbms_exento === true) s++;
  return s;
}

// Ficha fiscal de la organización derivada del cliente canónico (sin `nombre` de cuenta).
function buildOrgFiscal(c) {
  const ruc = (c.ruc || "").trim();
  const dv = (c.dv || "").trim();
  const ruc_norm = ruc.replace(/\D/g, "");
  const dv_norm = dv.replace(/\D/g, "");
  const rucdv_norm = ruc_norm + (dv_norm ? ("-" + dv_norm) : "");
  const itbms = c.itbms_exento === true;
  const nombre = (c.nombre || "").trim() || "Organización";
  const representante = (c.representante || "").trim();
  const representante_cedula = (c.representante_cedula || c.cedula_representante || "").trim();
  return {
    nombre, nombre_norm: orgNorm(nombre),
    ruc, dv, ruc_norm, dv_norm, rucdv_norm,
    representante, representante_cedula,
    itbms_exento: itbms,
    itbms_motivo_exencion: itbms ? (c.itbms_motivo_exencion || "").trim() : "",
    searchTokens: orgSearchTokens(nombre, ruc_norm, rucdv_norm, representante),
    activo: true, deleted: false,
  };
}

// Ficha fiscal que la organización espeja hacia cada cuenta. NO incluye `nombre`
// (el nombre es propio de cada cuenta).
function fiscalMirror(org) {
  return {
    ruc: org.ruc || "", dv: org.dv || "",
    ruc_norm: org.ruc_norm || "", dv_norm: org.dv_norm || "", rucdv_norm: org.rucdv_norm || "",
    representante: org.representante || "",
    representante_cedula: org.representante_cedula || "",
    itbms_exento: !!org.itbms_exento,
    itbms_motivo_exencion: org.itbms_motivo_exencion || "",
    organizacion_nombre: org.nombre || "",
    organizacion_norm: org.nombre_norm || "",
  };
}

// ¿El espejo cambiaría algún dato fiscal de usuario del cliente? Solo mira los
// campos visibles (no los derivados *_norm ni los nuevos organizacion_*), para
// reportar de forma fiable cuántas cuentas cambian de verdad.
const FISCAL_KEYS = ["ruc", "dv", "representante", "representante_cedula",
  "itbms_exento", "itbms_motivo_exencion"];
function mirrorCambiaFiscal(memberData, mirror) {
  for (const k of FISCAL_KEYS) {
    if (k === "itbms_exento") { if (!!memberData[k] !== !!mirror[k]) return true; continue; }
    if ((memberData[k] || "") !== (mirror[k] || "")) return true;
  }
  return false;
}

// Migración a "toda cuenta tiene organización". Crea una organización por cada RUC
// (org-de-uno para RUC único), eligiendo la ficha fiscal del cliente más completo,
// y la espeja a las cuentas. SALVAGUARDAS:
//   - Solo escribe en `clientes` y `organizaciones` (no toca contratos/órdenes/POC).
//   - Nunca sobrescribe `cliente.nombre`.
//   - Solo asigna cuentas con `organizacionId` vacío (respeta asignaciones previas).
//   - Reutiliza organizaciones existentes sin pisar sus datos.
//   - Idempotente; salta eliminados y clientes sin RUC.
async function backfillOrganizacionesPorRuc(dryRun) {
  const startedAt = Date.now();

  const snap = await db.collection("clientes").get();
  let scanned = 0, skippedDeleted = 0, skippedSinRuc = 0, errors = 0;
  const buckets = new Map(); // ruc_norm -> [{ id, ref, data }]
  for (const doc of snap.docs) {
    scanned++;
    const d = doc.data();
    if (d.deleted === true) { skippedDeleted++; continue; }
    const ruc = (d.ruc_norm || "").trim();
    if (!ruc) { skippedSinRuc++; continue; }
    if (!buckets.has(ruc)) buckets.set(ruc, []);
    buckets.get(ruc).push({ id: doc.id, ref: doc.ref, data: d });
  }

  // Organizaciones existentes por ruc_norm (se reutilizan; NO se pisan sus datos).
  const orgsSnap = await db.collection("organizaciones").where("deleted", "==", false).get();
  const orgByRuc = new Map();
  for (const o of orgsSnap.docs) {
    const r = (o.data().ruc_norm || "").trim();
    if (r && !orgByRuc.has(r)) orgByRuc.set(r, { id: o.id, ...o.data() });
  }

  let orgsTocadas = 0, orgsCreadas = 0, cuentasAsignadas = 0;
  let skippedYaAsignados = 0, cuentasConCambioFiscal = 0;
  const groups = [];

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
    const pendientes = members.filter(m => !(m.data.organizacionId || "").trim());
    skippedYaAsignados += (members.length - pendientes.length);

    const existedOrg = orgByRuc.get(ruc) || null;
    if (!existedOrg && pendientes.length === 0) continue; // nada que hacer
    orgsTocadas++;

    let org = existedOrg;
    if (!org) {
      // Cliente canónico: el de ficha fiscal más completa del grupo.
      const canonical = members.slice().sort((a, b) => fiscalScore(b.data) - fiscalScore(a.data))[0];
      const fiscal = buildOrgFiscal(canonical.data);
      const orgRef = db.collection("organizaciones").doc();
      org = { id: orgRef.id, ...fiscal };
      if (!dryRun) {
        batch.set(orgRef, {
          ...fiscal,
          created_at: admin.firestore.FieldValue.serverTimestamp(), created_by: "backfill",
          updated_at: admin.firestore.FieldValue.serverTimestamp(), updated_by: "backfill",
        });
        opsInBatch++;
        if (opsInBatch >= BATCH_SIZE) await flushBatch();
      }
      orgsCreadas++;
      orgByRuc.set(ruc, org);
    }

    const mirror = fiscalMirror(org);
    const orgTokens = orgSearchTokens(org.nombre, org.ruc_norm, org.rucdv_norm, org.representante);
    for (const m of pendientes) {
      if (mirrorCambiaFiscal(m.data, mirror)) cuentasConCambioFiscal++;
      if (!dryRun) {
        batch.update(m.ref, {
          organizacionId: org.id,
          ...mirror,
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
      groups.push({
        ruc: org.ruc || ruc, orgNombre: org.nombre,
        accion: existedOrg ? "reuse" : "create",
        miembros: members.length, asignar: pendientes.length,
      });
    }
  }
  await flushBatch();

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    scanned, skippedDeleted, skippedSinRuc,
    gruposPropuestos: orgsTocadas, orgsCreadas,
    cuentasAsignadas, skippedYaAsignados, cuentasConCambioFiscal,
    errors, elapsedSec,
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

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
 *   { action: "linkModeloIdPoc", dryRun? }
 *     - Links legacy poc_devices to their catalog model: writes `modelo_id` (FK)
 *       + `modelo_label` (snapshot) by NORMALIZED match of the free-text modelo
 *       against the `modelos` collection. The POC drawer/bulk now use a <select>
 *       bound to the catalog (PocState.obtenerModeloId) that only pre-selects on
 *       an exact label match, so devices holding the old free-text stopped
 *       resolving. Additive (never deletes the legacy text) and idempotent
 *       (skips docs that already have a modelo FK). Reports `ambiguos` (text that
 *       maps to 2+ models) and `huerfanos` (text with no catalog match).
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

// ─────────── linkModeloIdPoc ───────────
//
// Enlaza equipos POC legacy a su modelo del catálogo por `modelo_id` (estable) +
// `modelo_label` (snapshot), haciendo match NORMALIZADO del texto libre (`modelo`
// y sus alias) contra la colección `modelos`. El drawer/edición-masiva del POC
// ahora usan un <select> ligado al catálogo (PocState.obtenerModeloId), que solo
// pre-selecciona con match exacto del label `${marca} ${modelo}`; los equipos
// viejos guardaban el modelo como texto libre y dejaron de pre-seleccionarse.
// Aditivo: agrega el FK donde falta y hay match único; NO borra el texto libre
// (la lista lo sigue mostrando vía obtenerModeloTexto). Idempotente: salta los
// que ya tienen un FK de modelo. Incluye modelos inactivos en el match.
//
// El match tiene varios niveles, del más estricto al más laxo, y SIEMPRE exige
// unicidad (2+ candidatos → `ambiguo`, no adivina):
//   1. exacto: label `${marca} ${modelo}`, o `modelo`/`nombre` solo, o su forma
//      "apretada" (solo alfanuméricos) que iguala variantes de espaciado/guiones
//      ("PNC 360" == "PNC-360" == "PNC360"). Se prueba el texto crudo Y sin la
//      marca (el catálogo la lleva, "Hytera PNC360S", pero el texto viejo no).
//   2. prefijo: el código del equipo es prefijo de UN solo código del catálogo,
//      con un sufijo faltante de ≤2 chars ("PNC360" → "PNC360S"). Estos se marcan
//      aparte (linkedPrefijo) y el dry-run los lista para revisión.
// Reporta `ambiguos` (texto que mapea a 2+ modelos — normalmente catálogo
// duplicado) y `huerfanos` (texto sin correspondencia — crear/renombrar).

function _normModelo(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// Clave "apretada": solo alfanuméricos (sin espacios/guiones/acentos). Reconcilia
// las variantes de un mismo código de modelo escrito distinto ("PNC 360" /
// "PNC-360" / "PNC360" → "pnc360"). Se usa como último recurso de match.
function _tightModelo(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Label visible del modelo, idéntico al que arma PocState.cargarModelosMap.
function _modeloLabel(m) {
  const label = `${(m.marca || "").trim()} ${(m.modelo || "").trim()}`.trim();
  return label || m.modelo || m.marca || m.nombre || "";
}

// FK de modelo ya presente en un doc POC (cualquier variante). Si hay uno, el
// equipo ya está enlazado y se salta.
function _modeloFk(d) {
  return (d.modelo_id || d.modeloId || d.model_id || d.modelId || "").toString().trim();
}

// Texto libre legacy del modelo (mismos alias que revisa el frontend), sin las
// claves FK que ya se evaluaron aparte.
function _modeloTextoLegacy(d) {
  return (d.modelo_label || d.modeloLabel || d.Modelo || d.modelo ||
          d.model_label  || d.modelLabel  || d.model || "").toString().trim();
}

async function backfillLinkModeloIdPoc(dryRun) {
  const startedAt = Date.now();

  // Índices del catálogo (valor = Set de ids para detectar ambigüedad; incluye
  // modelos inactivos):
  //   byLabel  norm(`${marca} ${modelo}`) — el label completo que muestra el UI.
  //   byBare   norm(modelo) / norm(nombre) — el código solo, sin marca.
  //   byTight  alfanumérico del label completo, del modelo solo y del nombre.
  //   tightList {tight,id} del código de modelo (sin marca) para match por prefijo.
  //   brands   marcas normalizadas, para quitar la marca del texto libre viejo.
  const modSnap = await db.collection("modelos").get();
  const byLabel = new Map();
  const byBare  = new Map();
  const byTight = new Map();
  const labelById = new Map();
  const tightList = [];
  const brands = new Set();
  const add = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const doc of modSnap.docs) {
    const m = doc.data() || {};
    labelById.set(doc.id, _modeloLabel(m));
    add(byLabel, _normModelo(`${(m.marca || "").trim()} ${(m.modelo || "").trim()}`), doc.id);
    add(byBare,  _normModelo(m.modelo), doc.id);
    add(byBare,  _normModelo(m.nombre), doc.id);
    add(byTight, _tightModelo(`${m.marca || ""} ${m.modelo || ""}`), doc.id);
    add(byTight, _tightModelo(m.modelo), doc.id);
    add(byTight, _tightModelo(m.nombre), doc.id);
    // Aliases opcionales del catálogo (array `aliases` o string `alias`): grafías
    // conocidas del texto libre viejo, resueltas al modelo por el admin. Resuelven
    // los irregulares que el match automático no puede ("PNC360R" → PNC360S-R,
    // "TM7"/"TM-07 INTRICO" → Inrico TM7PlusSR). Match exacto/apretado, prioritario.
    const aliasArr = Array.isArray(m.aliases) ? m.aliases : (m.alias ? [m.alias] : []);
    for (const a of aliasArr) {
      add(byBare,  _normModelo(a), doc.id);
      add(byTight, _tightModelo(a), doc.id);
    }
    const tModelo = _tightModelo(m.modelo);
    if (tModelo.length >= 4) tightList.push({ tight: tModelo, id: doc.id });
    // Marcas: tokens de `marca` con ≥3 letras (no quitar "s", números, etc.).
    for (const tok of _normModelo(m.marca).split(" ")) {
      if (tok.length >= 3 && /[a-z]/.test(tok)) brands.add(tok);
    }
  }

  // Quita tokens de marca del texto libre ("hytera pnc360s" → "pnc360s"). Nunca
  // deja el texto vacío (si todo era marca, devuelve el normalizado original).
  const stripBrand = (texto) => {
    const toks = _normModelo(texto).split(" ").filter(Boolean);
    const keep = toks.filter(t => !brands.has(t));
    return keep.length ? keep.join(" ") : _normModelo(texto);
  };

  // Resuelve un texto libre → { ids, tipo }. Prueba el texto crudo y sin marca en
  // los tres niveles exactos; si nada, intenta prefijo (código del equipo == inicio
  // de UN código del catálogo con ≤2 chars extra). Devuelve null si no hay match.
  const resolver = (texto) => {
    const formas = [texto, stripBrand(texto)];
    for (const f of formas) {
      const n = _normModelo(f);
      const ids = byLabel.get(n) || byBare.get(n) || byTight.get(_tightModelo(f));
      if (ids && ids.size) return { ids, tipo: ids.size > 1 ? "ambiguo" : "exacto" };
    }
    // Se prefiere el candidato con el sufijo faltante MÁS corto: "PNC360" →
    // "PNC360S" (falta "S", 1 char) antes que "PNC360S-R" (falta "SR", 2). Así el
    // código base no se conflaciona con su variante -R. Ambiguo solo si el sufijo
    // mínimo empata entre 2+ modelos (p.ej. duplicados aún sin consolidar).
    const claves = [...new Set(formas.map(f => _tightModelo(f)).filter(t => t.length >= 5))];
    let mejorExtra = Infinity;
    let mejor = new Set();
    for (const dt of claves) {
      for (const c of tightList) {
        if (c.tight.length <= dt.length || !c.tight.startsWith(dt)) continue;
        const extra = c.tight.length - dt.length;
        if (extra > 2) continue;
        if (extra < mejorExtra) { mejorExtra = extra; mejor = new Set([c.id]); }
        else if (extra === mejorExtra) mejor.add(c.id);
      }
    }
    if (mejor.size === 1) return { ids: mejor, tipo: "prefijo" };
    if (mejor.size > 1)   return { ids: mejor, tipo: "ambiguo" };
    return null;
  };

  let scanned = 0, skippedDeleted = 0, yaLinked = 0, skippedUnchanged = 0;
  let linked = 0, linkedExacto = 0, linkedPrefijo = 0;
  let ambiguos = 0, huerfanos = 0, written = 0, errors = 0;
  // Texto libre distinto -> nº de equipos, para reportar la lista accionable
  // (qué modelos crear/renombrar, qué duplicados dedup-ear, y qué enlaces por
  // prefijo revisar antes de escribir).
  const huerfanoCount = new Map();
  const ambiguoCount  = new Map();
  const ambiguoInfo   = new Map();   // texto -> [labels de los modelos candidatos]
  const prefijoCount  = new Map();   // "texto → label" -> nº equipos

  let batch = db.batch();
  let opsInBatch = 0;
  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) { written += opsInBatch; batch = db.batch(); opsInBatch = 0; return; }
    try { await batch.commit(); written += opsInBatch; }
    catch (err) {
      logger.error("[runBackfill.linkModeloIdPoc] batch commit failed", { err: err.message });
      errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  const snap = await db.collection("poc_devices").get();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (d.deleted === true) { skippedDeleted++; continue; }
    scanned++;
    if (_modeloFk(d)) { yaLinked++; continue; }          // ya enlazado

    const texto = _modeloTextoLegacy(d);
    if (!texto) { skippedUnchanged++; continue; }         // sin modelo que enlazar

    const r = resolver(texto);
    if (!r) {                                              // sin match en el catálogo
      huerfanos++;
      huerfanoCount.set(texto, (huerfanoCount.get(texto) || 0) + 1);
      continue;
    }
    if (r.tipo === "ambiguo") {                            // texto mapea a 2+ modelos
      ambiguos++;
      ambiguoCount.set(texto, (ambiguoCount.get(texto) || 0) + 1);
      if (!ambiguoInfo.has(texto)) {
        ambiguoInfo.set(texto, [...r.ids].map(id => labelById.get(id) || id));
      }
      continue;
    }

    const modeloId = [...r.ids][0];
    const label = labelById.get(modeloId) || texto;
    linked++;
    if (r.tipo === "prefijo") {
      linkedPrefijo++;
      const k = `${texto} → ${label}`;
      prefijoCount.set(k, (prefijoCount.get(k) || 0) + 1);
    } else {
      linkedExacto++;
    }
    batch.update(doc.ref, { modelo_id: modeloId, modelo_label: label });
    opsInBatch++;
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  // Muestra distinta ordenada por frecuencia: la lista de trabajo real.
  const top = (m, n) => [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t, c]) => `${t} (×${c})`);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    scanned, skippedDeleted, yaLinked, skippedUnchanged,
    linked, linkedExacto, linkedPrefijo, ambiguos, huerfanos, written, errors, elapsedSec,
    huerfanosDistintos: huerfanoCount.size,
    ambiguosDistintos:  ambiguoCount.size,
    detalle: {
      enlaces_prefijo: {
        titulo: `Enlaces por prefijo (REVISAR antes de escribir) — ${linkedPrefijo} equipos`,
        muestraHuerfanos: top(prefijoCount, 40),
      },
      ambiguos: {
        titulo: `Ambiguos (catálogo duplicado / código repetido) — ${ambiguos} equipos, ${ambiguoCount.size} distintos`,
        // Muestra los modelos candidatos de cada texto y marca (DUPLICADO) cuando
        // 2+ candidatos comparten el mismo label (= filas repetidas en el catálogo).
        muestraHuerfanos: [...ambiguoCount.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([t, c]) => {
            const labels = ambiguoInfo.get(t) || [];
            const uniq = [...new Set(labels)];
            const dup = uniq.length < labels.length ? " (DUPLICADO)" : "";
            return `${t} (×${c}) → ${labels.length} modelos${dup}: ${uniq.join(" | ")}`;
          }),
      },
      poc_devices: {
        titulo: `Huérfanos (crear/renombrar en catálogo) — ${huerfanos} equipos, ${huerfanoCount.size} distintos`,
        huerfanos,
        muestraHuerfanos: top(huerfanoCount, 40),
      },
    },
  };
}

// ─────────── seedPoolEquipos ───────────
//
// Carga inicial del pool de equipos serializados (equipos_pool) desde las tres
// fuentes existentes, en orden de precedencia contrato > POC > orden (plan
// docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md §4.3):
//   1. contratos/*/seriales (collectionGroup) de contratos activos/aprobados →
//      en_cliente si entrega confirmada o contrato legacy, si no asignado_contrato.
//   2. poc_devices con serial (no deleted) → en_poc (si la unidad ya existe por
//      un contrato, solo se enlaza poc_device_id sin tocar estado).
//   3. órdenes vivas (< 365 días, no ENTREGADO, no eliminadas) → en_taller.
// Todos los docs nacen verificado:false (origen migracion_*). Failsafe de
// colisión entre modelos: mismo criterio que domain/equiposPool.js (doc sufijado
// + serial_compartido en ambos). Mismo serial con GRAFÍA distinta entre fuentes
// se reporta como "sospechoso" (no bloquea: gana la primera grafía).
// Idempotente: los serial+modelo ya presentes en el pool se saltan.

const poolLib = require("../domain/equiposPool");

async function backfillSeedPoolEquipos(dryRun) {
  const startedAt = Date.now();
  const r = {
    creados: { contratos: 0, poc: 0, ordenes: 0 },
    yaExistia: 0, invalidos: 0, colisiones: 0,
    pocEnlazados: 0, ordenesViejasSaltadas: 0, errors: 0,
  };
  const sospechosos = new Map();   // serial_norm → Set<grafías>
  const muestraColisiones = [];

  // Estado actual del pool en memoria: serial_norm → [{id, modelo_id, modelo_label, serial}]
  const poolSnap = await db.collection("equipos_pool").get();
  const enPool = new Map();
  poolSnap.forEach((d) => {
    const data = d.data();
    const arr = enPool.get(data.serial_norm) || [];
    arr.push({ id: d.id, modelo_id: data.modelo_id, modelo_label: data.modelo_label, serial: data.serial });
    enPool.set(data.serial_norm, arr);
  });

  let batch = db.batch();
  let opsInBatch = 0;
  const flushBatch = async () => {
    if (opsInBatch === 0) return;
    if (dryRun) { batch = db.batch(); opsInBatch = 0; return; }
    try { await batch.commit(); }
    catch (err) {
      logger.error("[runBackfill.seedPoolEquipos] batch commit failed", { err: err.message });
      r.errors += opsInBatch;
    }
    batch = db.batch();
    opsInBatch = 0;
  };

  const anotarGrafia = (norm, raw) => {
    const set = sospechosos.get(norm) || new Set();
    set.add(raw);
    sospechosos.set(norm, set);
  };

  // Resuelve contra el mapa en memoria (espejo de poolLib.resolver, sin queries).
  // poolLib.mismoModelo es tolerante a datos desparejos (id vs label del mismo
  // modelo, lados sin modelo) — solo una diferencia REAL de modelo colisiona.
  // Retorna { existente | null, docId, colision }.
  const resolverLocal = (norm, modeloId, modeloLabel) => {
    const docs = enPool.get(norm) || [];
    if (!docs.length) return { existente: null, docId: norm, colision: false };
    const exacto = docs.find((d) => poolLib.mismoModelo(d, modeloId, modeloLabel));
    if (exacto) return { existente: exacto, docId: exacto.id, colision: false };
    return { existente: null, docId: `${norm}__${poolLib.modeloKey(modeloId, modeloLabel)}`, colision: true };
  };

  const crear = ({ norm, serial, modeloId, modeloLabel, estado, origen, asignacion = null,
                   pocDeviceId = null, ordenActualId = null, refMov, fuente }) => {
    const { existente, docId, colision } = resolverLocal(norm, modeloId, modeloLabel);
    if (existente) {
      if ((existente.serial || "") !== serial) {
        anotarGrafia(norm, existente.serial || "");
        anotarGrafia(norm, serial);
      }
      r.yaExistia++;
      return existente;
    }
    const ref = db.collection("equipos_pool").doc(docId);
    batch.set(ref, {
      serial, serial_norm: norm, serial_compartido: colision,
      modelo_id: modeloId || null, modelo_label: modeloLabel || "",
      condicion: "reuso", estado,
      asignacion, poc_device_id: pocDeviceId, orden_actual_id: ordenActualId,
      origen, verificado: false, ingreso_bodega_at: null,
      proveedor: "", notas: "", baja_motivo: null,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      creado_por_uid: null, creado_por_email: null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_by: null, updated_by_email: null,
    });
    batch.set(ref.collection("movimientos").doc(), {
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null,
      tipo: "migracion", de_estado: null, a_estado: estado,
      ref: refMov, notas: "Backfill seedPoolEquipos",
    });
    opsInBatch += 2;
    if (colision) {
      // Marca el doc con ID limpio como compartido (existe: por eso hay colisión).
      batch.set(db.collection("equipos_pool").doc(norm), { serial_compartido: true }, { merge: true });
      opsInBatch++;
      r.colisiones++;
      if (muestraColisiones.length < 25) {
        const contra = (enPool.get(norm) || [])
          .map((d) => d.modelo_label || d.modelo_id || "sin modelo").join(" / ");
        muestraColisiones.push(`${norm}: ${modeloLabel || modeloId} vs ${contra}`);
      }
    }
    r.creados[fuente]++;
    const nuevo = { id: docId, modelo_id: modeloId || null, modelo_label: modeloLabel || "", serial };
    enPool.set(norm, [...(enPool.get(norm) || []), nuevo]);
    return null;
  };

  // ── Fuente 1: contratos/*/seriales ──
  const contratosSnap = await db.collection("contratos").get();
  const contratos = new Map();
  contratosSnap.forEach((d) => contratos.set(d.id, d.data()));

  const serialesSnap = await db.collectionGroup("seriales").get();
  let scannedContratos = 0;
  for (const doc of serialesSnap.docs) {
    // collectionGroup matchea cualquier subcol "seriales"; valida que sea de contratos.
    const parentContrato = doc.ref.parent.parent;
    if (!parentContrato || doc.ref.parent.parent.parent.id !== "contratos") continue;
    scannedContratos++;
    const s = doc.data();
    const serial = (s.serial || "").toString().trim();
    const norm = poolLib.normSerial(serial);
    if (!poolLib.esSerialValido(norm)) { r.invalidos++; continue; }
    const c = contratos.get(parentContrato.id) || {};
    if (c.deleted === true || !["activo", "aprobado"].includes(c.estado)) continue;
    const entregado = c.entrega_confirmada === true || c.seriales_estado === "legacy";
    crear({
      norm, serial,
      modeloId: s.modelo_id || null, modeloLabel: s.modelo || "",
      estado: entregado ? poolLib.ESTADOS.EN_CLIENTE : poolLib.ESTADOS.ASIGNADO,
      origen: "migracion_contrato",
      asignacion: {
        contrato_doc_id: parentContrato.id,
        contrato_id: s.contrato_id || c.contrato_id || "",
        cliente_id: s.cliente_id || c.cliente_id || "",
        cliente_nombre: s.cliente_nombre || c.cliente_nombre || "",
      },
      refMov: { tipo: "contrato", id: parentContrato.id, label: s.contrato_id || c.contrato_id || "" },
      fuente: "contratos",
    });
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }

  // ── Fuente 2: poc_devices ──
  const pocSnap = await db.collection("poc_devices").get();
  let scannedPoc = 0;
  for (const doc of pocSnap.docs) {
    const d = doc.data();
    if (d.deleted === true) continue;
    const serial = (d.serial || "").toString().trim();
    const norm = poolLib.normSerial(serial);
    if (!serial) continue;
    scannedPoc++;
    if (!poolLib.esSerialValido(norm)) { r.invalidos++; continue; }
    const existente = crear({
      norm, serial,
      modeloId: d.modelo_id || null, modeloLabel: d.modelo_label || d.modelo || "",
      estado: poolLib.ESTADOS.EN_POC,
      origen: "migracion_poc",
      pocDeviceId: doc.id,
      refMov: { tipo: "poc", id: doc.id, label: d.radio_name || d.unit_id || "" },
      fuente: "poc",
    });
    // Ya existía por contrato → solo enlaza el device (sin tocar estado).
    if (existente) {
      batch.set(db.collection("equipos_pool").doc(existente.id), { poc_device_id: doc.id }, { merge: true });
      opsInBatch++;
      r.pocEnlazados++;
      r.yaExistia--; // ya contado dentro de crear(); aquí es un enlace, no un skip
    }
    if (opsInBatch >= BATCH_SIZE) await flushBatch();
  }

  // ── Fuente 3: órdenes vivas ──
  const ordenesSnap = await db.collection("ordenes_de_servicio").get();
  const hace365 = Date.now() - 365 * 24 * 60 * 60 * 1000;
  let scannedOrdenes = 0;
  for (const doc of ordenesSnap.docs) {
    const d = doc.data();
    if (d.eliminado === true) continue;
    const estado = String(d.estado_reparacion || "").trim().toUpperCase();
    if (estado === "ENTREGADO AL CLIENTE") continue;
    const creada = d.fecha_creacion?.toDate ? d.fecha_creacion.toDate().getTime() : null;
    if (creada && creada < hace365) { r.ordenesViejasSaltadas++; continue; }
    for (const e of (d.equipos || [])) {
      if (!e || e.eliminado) continue;
      const serial = (e.serial || e.SERIAL || e.numero_de_serie || "").toString().trim();
      if (!serial) continue;
      scannedOrdenes++;
      const norm = poolLib.normSerial(serial);
      if (!poolLib.esSerialValido(norm)) { r.invalidos++; continue; }
      crear({
        norm, serial,
        modeloId: e.modelo_id || null,
        modeloLabel: (e.modelo || e.MODEL || e.modelo_nombre || "").toString().trim(),
        estado: poolLib.ESTADOS.EN_TALLER,
        origen: "migracion_orden",
        ordenActualId: doc.id,
        refMov: { tipo: "orden", id: doc.id, label: d.numero_orden || doc.id },
        fuente: "ordenes",
      });
      if (opsInBatch >= BATCH_SIZE) await flushBatch();
    }
  }
  await flushBatch();

  const grafias = [...sospechosos.entries()].filter(([, set]) => set.size > 0);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return {
    scanned: scannedContratos + scannedPoc + scannedOrdenes,
    ...r,
    written: r.creados.contratos + r.creados.poc + r.creados.ordenes,
    elapsedSec,
    detalle: {
      fuentes: { contratos: scannedContratos, poc: scannedPoc, ordenes: scannedOrdenes },
      colisiones: { titulo: `Seriales compartidos entre modelos — ${r.colisiones}`, muestra: muestraColisiones },
      sospechosos: {
        titulo: `Mismo serial con grafía distinta entre fuentes — ${grafias.length}`,
        muestra: grafias.slice(0, 25).map(([norm, set]) => `${norm}: ${[...set].join(" | ")}`),
      },
    },
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
      case "linkClienteId":
        result = await backfillLinkClienteId(dryRun);
        break;
      case "clienteIp":
        result = await backfillClienteIp(dryRun);
        break;
      case "marcarSerialesLegacy":
        result = await backfillMarcarSerialesLegacy(dryRun);
        break;
      case "linkModeloIdPoc":
        result = await backfillLinkModeloIdPoc(dryRun);
        break;
      case "seedPoolEquipos":
        result = await backfillSeedPoolEquipos(dryRun);
        break;
      default:
        throw new HttpsError("invalid-argument", `Acción desconocida: ${action}`);
    }

    logger.info("[runBackfill] done", { action, dryRun, ...result });
    return { action, dryRun, ...result };
  }
);

// Para scripts one-off locales (functions/scripts/*): misma lógica que la
// acción del callable, sin pasar por auth de onCall.
module.exports.backfillSeedPoolEquipos = backfillSeedPoolEquipos;

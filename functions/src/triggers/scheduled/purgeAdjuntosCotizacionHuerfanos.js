// Limpieza de adjuntos de cotización huérfanos (auditoría UX 2026-09-28 §4.5 #12).
//
// El editor sube el brochure a Storage en cuanto se elige el archivo
// (CotizacionesService.uploadAdjunto → cotizaciones_adjuntos/adj_xxx.ext), antes
// de guardar. Si luego se quita de la lista, o el vendedor sale sin guardar, el
// archivo queda en Storage sin que ningún documento lo nombre, para siempre.
//
// Este job, semanal, borra lo que NINGUNA cotización referencia (adjuntos[].path
// o la URL de descarga) y tiene más de 7 días. Los 7 días cubren el respaldo
// local del editor (3 días), una edición abierta y el correo en cola, que
// adjunta por URL.
//
// Dry-run por defecto: solo registra lo que borraría. Para borrar de verdad,
// empresa/config.adjuntos_huerfanos_borrar = true (se cambia sin desplegar).
// Cada corrida deja su resumen en admin_reportes/adjuntos_cotizacion_huerfanos.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

const PREFIJO = "cotizaciones_adjuntos/";
const EDAD_MIN_DIAS = 7;

// La ruta de Storage dentro de una download URL de Firebase
// (…/o/cotizaciones_adjuntos%2Fadj_x.pdf?alt=media&token=…). Los adjuntos
// viejos podrían traer solo la URL.
function pathDeUrl(url) {
  const m = String(url || "").match(/\/o\/([^?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (_) { return null; }
}

// Set de rutas referenciadas por cualquier cotización, borrada lógicamente o
// no: una eliminada se puede restaurar y sus adjuntos tienen que seguir ahí.
function rutasReferenciadas(docs) {
  const set = new Set();
  for (const d of docs) {
    const adj = Array.isArray(d?.adjuntos) ? d.adjuntos : [];
    for (const a of adj) {
      if (a?.path) set.add(String(a.path));
      const p = pathDeUrl(a?.url);
      if (p) set.add(p);
    }
  }
  return set;
}

/**
 * Decide qué archivos son huérfanos. Puro: se prueba sin Storage.
 * @param {{name:string, timeCreated:string}[]} archivos
 */
function huerfanos(archivos, referenciadas, ahoraMs, edadMinDias = EDAD_MIN_DIAS) {
  const corte = ahoraMs - edadMinDias * 24 * 60 * 60 * 1000;
  return archivos.filter((f) => {
    if (!f?.name || !f.name.startsWith(PREFIJO) || f.name.endsWith("/")) return false;
    if (referenciadas.has(f.name)) return false;
    const t = Date.parse(f.timeCreated || "");
    // Sin fecha legible no se borra: ante la duda, se conserva.
    return Number.isFinite(t) && t < corte;
  });
}

const fn = onSchedule(
  {
    schedule: "every sunday 04:30",
    timeZone: "America/Panama",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 540,
    retryCount: 0,
  },
  async () => {
    const cfgSnap = await db.collection("empresa").doc("config").get();
    const borrar = cfgSnap.exists && cfgSnap.data().adjuntos_huerfanos_borrar === true;

    // Solo el campo adjuntos: la colección se lee entera, pero liviana.
    const cotSnap = await db.collection("cotizaciones").select("adjuntos").get();
    const referenciadas = rutasReferenciadas(cotSnap.docs.map((d) => d.data()));

    const bucket = admin.storage().bucket();
    // getFiles trae la metadata (timeCreated) en el listado: no hace falta un
    // getMetadata por archivo.
    const [files] = await bucket.getFiles({ prefix: PREFIJO });
    const lista = files.map((f) => ({ name: f.name, timeCreated: f.metadata?.timeCreated, size: Number(f.metadata?.size || 0), file: f }));
    const candidatos = huerfanos(lista, referenciadas, Date.now());

    let borrados = 0, errores = 0, bytes = 0;
    for (const c of candidatos) {
      bytes += c.size;
      if (!borrar) continue;
      try { await c.file.delete(); borrados++; }
      catch (e) {
        errores++;
        logger.warn("[purgeAdjuntosCotizacionHuerfanos] no se pudo borrar", { file: c.name, error: e.message });
      }
    }

    const resumen = {
      modo: borrar ? "borrar" : "dry-run",
      archivos: lista.length,
      referenciadas: referenciadas.size,
      huerfanos: candidatos.length,
      borrados, errores, bytes,
      muestra: candidatos.slice(0, 50).map((c) => ({ file: c.name, creado: c.timeCreated || null })),
      corrido_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    logger.info("[purgeAdjuntosCotizacionHuerfanos] resumen", { ...resumen, muestra: resumen.muestra.length, corrido_at: undefined });
    try {
      await db.collection("admin_reportes").doc("adjuntos_cotizacion_huerfanos").set(resumen);
    } catch (e) {
      logger.warn("[purgeAdjuntosCotizacionHuerfanos] no se guardó el resumen", { error: e.message });
    }
    return null;
  }
);

fn._interno = { pathDeUrl, rutasReferenciadas, huerfanos, PREFIJO, EDAD_MIN_DIAS };
module.exports = fn;

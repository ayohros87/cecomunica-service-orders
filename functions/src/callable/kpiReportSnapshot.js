const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");

/**
 * kpiReportSnapshot — admin-only callable del módulo "Reporte KPIs Junta".
 *
 * Congela lo que se presenta a la junta: un PDF inmutable por mes en Storage
 * y el respaldo del Excel fuente importado. Storage está cerrado a clientes
 * (storage.rules read/write:false) — los bytes solo se alcanzan por las URLs
 * firmadas de corta vida que emite este callable.
 *
 * Actions:
 *   { action: "generate", mes, html }         → { url, path, expiresAt }
 *       Renderiza el HTML a PDF (Puppeteer, carta) y lo guarda en
 *       kpi_reports/{mes}/…pdf; estampa pdf_path/pdf_generated_at/_by en el
 *       doc del mes. El HTML viene del frontend (la página del reporte es la
 *       única fuente de verdad del render y ya está validada contra el
 *       diseño); se acepta porque el caller es admin y el resultado es solo
 *       un archivo en un path admin-only — no se sirve a terceros.
 *   { action: "url", mes }                    → { url, path, expiresAt }
 *       URL firmada del snapshot existente.
 *   { action: "archiveSource", fileName, dataBase64 } → { path }
 *       Respalda el workbook fuente (xlsx) en kpi_reports_fuentes/.
 *
 * IAM: la firma de URLs v4 requiere que el runtime SA tenga
 * roles/iam.serviceAccountTokenCreator sobre sí mismo (ya concedido para
 * getIdentificacionUrl — ver ese callable).
 */

const SIGNED_URL_TTL_MS = 10 * 60 * 1000;   // 10 minutos
const MAX_HTML_BYTES = 3 * 1024 * 1024;     // el reporte real pesa ~100 KB
const MAX_XLSX_BYTES = 15 * 1024 * 1024;

async function requireAdmin(callerUid) {
  if (!callerUid) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db.collection("usuarios").doc(callerUid).get();
  const data = snap.exists ? snap.data() : null;
  if (!data || data.rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo administradores.");
  }
  if (data.activo === false) {
    throw new HttpsError("permission-denied", "Usuario desactivado.");
  }
}

function validarMes(mes) {
  if (typeof mes !== "string" || !/^\d{4}-\d{2}$/.test(mes)) {
    throw new HttpsError("invalid-argument", "mes debe ser YYYY-MM.");
  }
  return mes;
}

async function signedUrl(file) {
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
  return { url, expiresAt };
}

async function generate({ mes, html, uid }) {
  if (typeof html !== "string" || !html.trim()) {
    throw new HttpsError("invalid-argument", "html requerido.");
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new HttpsError("invalid-argument", "html demasiado grande.");
  }
  const docRef = db.collection("kpi_reports").doc(mes);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError("not-found", `No existe kpi_reports/${mes}.`);

  let pdfBuffer;
  const puppeteer = require("puppeteer-core");
  const chromium = require("@sparticuz/chromium");
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 45000 });
    // El CSS del reporte trae @page (letter portrait, margen 0.65in):
    // preferCSSPageSize lo respeta tal cual se ve al imprimir del navegador.
    pdfBuffer = await page.pdf({
      format: "letter",
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    // Cierra Chromium aunque falle setContent/pdf (mismo criterio que
    // sendContractPdf: una instancia caliente con procesos vivos termina en OOM).
    await browser.close();
  }

  const path = `kpi_reports/${mes}/Reporte Ejecutivo KPIs ${mes}.pdf`;
  const file = admin.storage().bucket().file(path);
  await file.save(Buffer.from(pdfBuffer), {
    contentType: "application/pdf",
    resumable: false,
    metadata: { metadata: { generated_by: uid, mes } },
  });

  await docRef.update({
    pdf_path: path,
    pdf_generated_at: admin.firestore.FieldValue.serverTimestamp(),
    pdf_generated_by: uid,
  });

  logger.info("kpiReportSnapshot generate", { mes, uid, bytes: pdfBuffer.length });
  return { path, ...(await signedUrl(file)) };
}

async function getUrl({ mes }) {
  const snap = await db.collection("kpi_reports").doc(mes).get();
  const path = snap.exists ? snap.data().pdf_path : null;
  if (!path) throw new HttpsError("not-found", "Este mes no tiene PDF archivado.");
  const file = admin.storage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("not-found", "El PDF referenciado ya no existe en Storage.");
  return { path, ...(await signedUrl(file)) };
}

async function archiveSource({ fileName, dataBase64, uid }) {
  if (typeof dataBase64 !== "string" || !dataBase64) {
    throw new HttpsError("invalid-argument", "dataBase64 requerido.");
  }
  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length || buf.length > MAX_XLSX_BYTES) {
    throw new HttpsError("invalid-argument", "Archivo vacío o demasiado grande.");
  }
  // Un xlsx es un zip: magic "PK".
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new HttpsError("invalid-argument", "El archivo no parece un xlsx.");
  }
  const safeName = String(fileName || "fuente.xlsx")
    .replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "fuente.xlsx";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const path = `kpi_reports_fuentes/${stamp} ${safeName}`;
  await admin.storage().bucket().file(path).save(buf, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    resumable: false,
    metadata: { metadata: { uploaded_by: uid } },
  });
  logger.info("kpiReportSnapshot archiveSource", { path, uid, bytes: buf.length });
  return { path };
}

module.exports = onCall(
  { timeoutSeconds: 120, memory: "1GiB" },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdmin(uid);

    const { action } = request.data || {};
    try {
      switch (action) {
        case "generate":
          return await generate({ mes: validarMes(request.data.mes), html: request.data.html, uid });
        case "url":
          return await getUrl({ mes: validarMes(request.data.mes) });
        case "archiveSource":
          return await archiveSource({ fileName: request.data.fileName, dataBase64: request.data.dataBase64, uid });
        default:
          throw new HttpsError("invalid-argument", `Acción desconocida: ${action}`);
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("kpiReportSnapshot error", { action, message: err.message, stack: err.stack });
      throw new HttpsError("internal", "Error interno generando el snapshot.");
    }
  }
);

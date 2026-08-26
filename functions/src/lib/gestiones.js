// Gestiones por cliente — helpers compartidos de la Ola 2 (reemplazo y demo).
// docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md §4.4.
//
// Una gestión (gestiones/{gid}) es el expediente del CLIENTE; el contrato es
// solo la envoltura de facturación de cada ítem. La cadena completa:
//   crear → correo a Bodega → Bodega asigna serial → OS PROGRAMACIÓN (correo a
//   Recepción + CC vendedor) → entrega desde la OS → orden DEVOLUCIÓN del
//   saliente → check-in → ENTRADA (cadena existente) → cierre automático 4/4.
// Todo el avance es por triggers: nadie "regresa" a la gestión a apretar nada.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { configEmailTo, bodegaEmailTo } = require("./mailRecipients");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

const TIPO_LABEL = { reemplazo: "Reemplazo", demo: "Demo", baja: "Baja de equipos", aumento: "Aumento de equipos" };

// Deep-link al expediente dentro del Centro de gestión.
function urlGestion(g, gid) {
  return `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(g.cliente_id || "")}&g=${encodeURIComponent(gid)}`;
}

// Número de orden AAAAMMDDNN (misma aritmética que ordenEntrada/ordenDevolucion;
// tercera copia consciente — extraerla a lib común es limpieza pendiente).
async function _siguienteOrdenId() {
  const hoy = new Date();
  const local = new Date(hoy.getTime() - 5 * 60 * 60 * 1000); // Panamá UTC-5 sin DST
  const fechaBase = `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
  const snap = await db.collection("ordenes_de_servicio")
    .where(admin.firestore.FieldPath.documentId(), ">=", `${fechaBase}00`)
    .where(admin.firestore.FieldPath.documentId(), "<=", `${fechaBase}99`)
    .get();
  const usados = snap.docs.map(d => parseInt(d.id.slice(-2), 10)).filter(n => !Number.isNaN(n));
  return { fechaBase, siguiente: usados.length ? Math.max(...usados) + 1 : 1 };
}

// Recepción (config o rol) + vendedor asignado del cliente. Nunca lanza.
async function destinatariosRecepcionVendedor(clienteId) {
  const emails = new Set();
  try {
    const cfg = await configEmailTo("recepcion", "");
    if (cfg) cfg.split(",").map(s => s.trim().toLowerCase()).filter(isEmail).forEach(e => emails.add(e));
  } catch (e) { /* fallback abajo */ }
  if (!emails.size) {
    try {
      const snap = await db.collection("usuarios").where("rol", "==", "recepcion").get();
      snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
    } catch (e) { logger.warn("[gestiones] usuarios de recepción ilegibles", { error: e.message }); }
  }
  try {
    if (clienteId) {
      const cli = await db.collection("clientes").doc(clienteId).get();
      const vendUid = cli.exists ? cli.data().vendedor_asignado : null;
      if (vendUid) {
        const v = await db.collection("usuarios").doc(vendUid).get();
        const e = v.exists ? v.data().email : null;
        if (isEmail(e)) emails.add(e.trim().toLowerCase());
      }
    }
  } catch (e) { logger.warn("[gestiones] vendedor del cliente ilegible", { clienteId, error: e.message }); }
  return [...emails];
}

// Administradores (para la aprobación de la excepción por servicio al cliente).
async function adminEmails() {
  const emails = new Set();
  try {
    const snap = await db.collection("usuarios").where("rol", "==", "administrador").get();
    snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
  } catch (e) { logger.warn("[gestiones] usuarios admin ilegibles", { error: e.message }); }
  return [...emails];
}

// Aprobadores de bajas: administración y gerencia (mismo criterio que las
// enmiendas clásicas de solicitudes_cancelacion).
async function aprobadoresEmails() {
  const emails = new Set();
  try {
    const snap = await db.collection("usuarios").where("rol", "in", ["administrador", "gerente"]).get();
    snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
  } catch (e) { logger.warn("[gestiones] usuarios aprobadores ilegibles", { error: e.message }); }
  return [...emails];
}

async function encolarCorreo({ to, cc, subject, preheader, bodyContent, ctaUrl, ctaLabel, meta }) {
  await db.collection("mail_queue").add({
    to,
    cc: cc || null,
    subject, preheader, bodyContent,
    ctaUrl, ctaLabel,
    meta: { created_at: admin.firestore.FieldValue.serverTimestamp(), source: "gestiones", ...(meta || {}) },
    status: "queued",
  });
}

function tablaHtml(headers, rows) {
  const th = headers.map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">${escapeHtml(h)}</th>`).join("");
  const trs = rows.map(cols =>
    `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${c}</td>`).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
    <thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// Bitácora del expediente (append-only, autor system).
async function registrarEvento(gid, accion, detalle) {
  try {
    await db.collection("gestiones").doc(gid).collection("eventos").add({
      accion, detalle: detalle || "",
      at: admin.firestore.FieldValue.serverTimestamp(),
      por_uid: "system", por_email: null,
    });
  } catch (e) { logger.warn("[gestiones] evento no registrado", { gid, accion, error: e.message }); }
}

/**
 * Crea la(s) orden(es) de PROGRAMACIÓN de una gestión con seriales asignados.
 * Reemplazo: UNA orden por contrato afectado (los ítems pueden cruzar
 * contratos y la orden lleva el vínculo de facturación del suyo); cada equipo
 * indica el serial saliente cuya configuración se toma de referencia.
 * Demo: una sola orden sin contrato (motivo_no_aplica: 'demo').
 * Devuelve la lista de ids creadas.
 */
async function crearOrdenesProgramacion(gid, g) {
  const ordenes = [];
  const grupos = [];
  if (g.tipo === "reemplazo") {
    const porContrato = new Map();
    for (const it of (g.items || [])) {
      const k = it.contrato_doc_id || "__sin__";
      if (!porContrato.has(k)) porContrato.set(k, []);
      porContrato.get(k).push(it);
    }
    for (const [cid, items] of porContrato) grupos.push({ contratoDocId: cid === "__sin__" ? null : cid, items });
  } else if (g.tipo === "aumento") {
    // Aumento por enmienda firmada: todas las unidades van al contrato destino
    // del anexo; la vigencia del tramo la estampa onOrdenWriteGestion al entregar.
    grupos.push({
      contratoDocId: g.aumento?.contrato_doc_id || null,
      contratoIdForzado: g.aumento?.contrato_id || null,
      items: (g.aumento?.seriales_asignados || []).map(s => ({ ...s, esLinea: true })),
    });
  } else {
    grupos.push({ contratoDocId: null, items: (g.demo?.seriales_asignados || []).map(s => ({ ...s, esDemo: true })) });
  }

  for (const grupo of grupos) {
    const contratoId = grupo.contratoIdForzado || grupo.items.find(i => i.contrato_id)?.contrato_id || null;
    const equipos = grupo.items.map(it => {
      const serial = String((it.esDemo || it.esLinea) ? it.serial : it.serial_nuevo || "").trim();
      return {
        id: crypto.randomUUID(),
        modelo_id: ((it.esDemo || it.esLinea) ? it.modelo_id : (it.modelo_solicitado_id || it.modelo_id)) || null,
        modelo: String((it.esDemo || it.esLinea) ? it.modelo : (it.modelo_solicitado || it.modelo || "")).trim(),
        serial,
        numero_de_serie: serial,
        observaciones: it.esDemo
          ? `Programación para DEMO (gestión ${gid}).`
          : it.esLinea
            ? `Programación de AUMENTO (enmienda ${gid}) — equipo nuevo del contrato ${contratoId || "—"} con vigencia propia.`
            : `REEMPLAZA al serial ${it.serial_saliente || "—"}: copiar su configuración, colocar su ID y confirmar. Motivo: ${it.motivo_detalle || it.motivo_codigo || "reemplazo"}.`,
        eliminado: false,
      };
    }).filter(e => e.serial);
    if (!equipos.length) continue;

    const data = {
      cliente_id: g.cliente_id || "",
      cliente_nombre: g.cliente_nombre || "",
      vendedor_asignado: "",
      tipo_de_servicio: "PROGRAMACIÓN",
      estado_reparacion: "POR ASIGNAR",
      fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
      observaciones: g.tipo === "reemplazo"
        ? `Orden creada automáticamente por la gestión ${gid} (reemplazo): programar ${equipos.length} equipo(s). Cada equipo indica el serial que sustituye — la programación toma como referencia la configuración del radio reemplazado.`
        : g.tipo === "aumento"
          ? `Orden creada automáticamente por la enmienda de aumento ${gid}: programar ${equipos.length} equipo(s) nuevos del contrato ${contratoId || "—"} (vigencia propia del tramo).`
          : `Orden creada automáticamente por la gestión ${gid} (demo): programar ${equipos.length} equipo(s) para demostración.`,
      equipos,
      contrato: grupo.contratoDocId
        ? { aplica: true, contrato_doc_id: grupo.contratoDocId, contrato_id: contratoId, motivo_no_aplica: null }
        : { aplica: false, contrato_doc_id: null, contrato_id: null, motivo_no_aplica: g.tipo === "demo" ? "demo" : "gestion" },
      gestion: { id: gid, tipo: g.tipo },
      creado_por_uid: "system",
      creado_por_email: null,
      eliminado: false,
      os_logs: [{ action: "CREAR", by: "system:gestiones" }],
    };

    let ordenId = null;
    const { fechaBase, siguiente } = await _siguienteOrdenId();
    for (let i = 0; i < 5 && !ordenId; i++) {
      const candidato = `${fechaBase}${String(siguiente + i).padStart(2, "0")}`;
      try {
        await db.collection("ordenes_de_servicio").doc(candidato).create(data);
        ordenId = candidato;
      } catch (e) {
        if (e.code !== 6 && !/already exists/i.test(e.message || "")) throw e;
      }
    }
    if (ordenId) {
      ordenes.push(ordenId);
      logger.info("[gestiones] OS de programación creada", { gid, ordenId, equipos: equipos.length });
    } else {
      logger.error("[gestiones] no se pudo reservar número para la OS de programación", { gid });
    }
  }
  return ordenes;
}

module.exports = {
  TIPO_LABEL, escapeHtml, isEmail, urlGestion, tablaHtml,
  destinatariosRecepcionVendedor, adminEmails, aprobadoresEmails, encolarCorreo,
  registrarEvento, crearOrdenesProgramacion,
  bodegaEmailTo,
};

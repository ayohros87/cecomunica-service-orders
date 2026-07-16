// Orden de servicio de ENTRADA (inspección de equipos devueltos) — creada
// automáticamente cuando un cliente devuelve equipos: cierre de enmienda con
// entradas u anulación de contrato (PLAN_CICLO_VIDA_EQUIPOS.md). Así el taller
// recibe el trabajo en su cola normal (POR ASIGNAR → asignar técnico →
// intervención por equipo → COMPLETADO) en vez de una lista pasiva.
//
// El pool NO cambia de estado por estas órdenes (los equipos siguen "Entrada —
// por inspeccionar"): onOrdenWritePool las detecta por el campo
// `entrada_inspeccion` y solo enlaza orden_actual_id. La disposición final
// (Inspección OK → bodega / baja) sigue siendo por unidad en Equipos por serial.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { configEmailTo } = require("./mailRecipients");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// Número de orden con el formato de la app (AAAAMMDD + secuencia de 2 dígitos,
// ej. 2026071604). create() falla si el ID ya existe → reintenta con el
// siguiente consecutivo (carrera con una creación manual simultánea).
async function _siguienteOrdenId() {
  const hoy = new Date();
  // Zona horaria de Panamá (UTC-5, sin DST) — el formato del ID es por fecha local.
  const local = new Date(hoy.getTime() - 5 * 60 * 60 * 1000);
  const fechaBase = `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
  const snap = await db.collection("ordenes_de_servicio")
    .where(admin.firestore.FieldPath.documentId(), ">=", `${fechaBase}00`)
    .where(admin.firestore.FieldPath.documentId(), "<=", `${fechaBase}99`)
    .get();
  const usados = snap.docs
    .map(d => parseInt(d.id.slice(-2), 10))
    .filter(n => !Number.isNaN(n));
  const siguiente = usados.length ? Math.max(...usados) + 1 : 1;
  return { fechaBase, siguiente };
}

// Destinatarios: recepción (empresa/config.email_recepcion o todos los usuarios
// con rol recepcion) + el vendedor asignado del cliente. Nunca lanza.
async function _destinatarios(clienteId) {
  const emails = new Set();
  try {
    const cfg = await configEmailTo("recepcion", "");
    if (cfg) cfg.split(",").map(s => s.trim().toLowerCase()).filter(isEmail).forEach(e => emails.add(e));
  } catch (e) { /* fallback abajo */ }
  if (!emails.size) {
    try {
      const snap = await db.collection("usuarios").where("rol", "==", "recepcion").get();
      snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
    } catch (e) {
      logger.warn("[ordenEntrada] No se pudieron leer usuarios de recepción", { message: e.message });
    }
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
  } catch (e) {
    logger.warn("[ordenEntrada] No se pudo resolver el vendedor del cliente", { clienteId, message: e.message });
  }
  return [...emails];
}

/**
 * Crea la orden de ENTRADA y encola el correo a recepción + vendedor.
 * @param {Object} p
 * @param {string} p.clienteId / p.clienteNombre — cliente del contrato
 * @param {string} p.contratoDocId / p.contratoId — contrato de origen
 * @param {Array}  p.unidades — [{ serial, modelo, modelo_id?, condicion? }]
 * @param {string} p.motivo — texto para observaciones y correo
 *                 ("Baja de contrato (enmienda)" | "Anulación de contrato")
 * @param {Object} p.refEntrada — { tipo: 'cancelacion'|'anulacion', id }
 * @returns {string|null} ordenId creada, o null si falló (best-effort).
 */
async function crearOrdenEntrada({ clienteId, clienteNombre, contratoDocId, contratoId, unidades, motivo, refEntrada }) {
  const lista = (unidades || []).filter(u => (u.serial || "").toString().trim());
  if (!lista.length) return null;

  const COND = { bueno: "buen estado", danado: "DAÑADO" };
  const equipos = lista.map(u => ({
    id: crypto.randomUUID(),
    modelo_id: u.modelo_id || null,
    modelo: (u.modelo || "").toString().trim(),
    serial: (u.serial || "").toString().trim(),
    numero_de_serie: (u.serial || "").toString().trim(),
    bateria: false, clip: false, cargador: false, fuente: false, antena: false, cubrepolvo: false,
    observaciones: `Inspección de entrada — ${motivo}. Condición reportada: ${COND[u.condicion] || u.condicion || "sin registrar"}.`,
    eliminado: false,
  }));

  const observaciones = `Orden creada automáticamente: inspección de ${lista.length} equipo(s) devuelto(s). ${motivo} — contrato ${contratoId || contratoDocId || "—"}.`;

  const data = {
    cliente_id: clienteId || "",
    cliente_nombre: clienteNombre || "",
    vendedor_asignado: "",
    tipo_de_servicio: "ENTRADA",
    estado_reparacion: "POR ASIGNAR",
    fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
    observaciones,
    equipos,
    contrato: {
      aplica: true,
      contrato_doc_id: contratoDocId || null,
      contrato_id: contratoId || null,
      motivo_no_aplica: null,
    },
    // Marca de orden de INSPECCIÓN de entrada: onOrdenWritePool no mueve el
    // estado del pool para estas órdenes (los equipos siguen en cuarentena).
    entrada_inspeccion: { tipo: refEntrada?.tipo || "entrada", ref_id: refEntrada?.id || null },
    creado_por_uid: "system",
    creado_por_email: null,
    eliminado: false,
    os_logs: [{ action: "CREAR", by: "system:orden-entrada" }],
  };

  // Intenta hasta 5 consecutivos por si hay carrera con una creación manual.
  let ordenId = null;
  const { fechaBase, siguiente } = await _siguienteOrdenId();
  for (let i = 0; i < 5 && !ordenId; i++) {
    const candidato = `${fechaBase}${String(siguiente + i).padStart(2, "0")}`;
    try {
      await db.collection("ordenes_de_servicio").doc(candidato).create(data);
      ordenId = candidato;
    } catch (e) {
      if (e.code !== 6 && !/already exists/i.test(e.message || "")) throw e; // 6 = ALREADY_EXISTS
    }
  }
  if (!ordenId) {
    logger.error("[ordenEntrada] No se pudo reservar un número de orden", { fechaBase, contratoId });
    return null;
  }
  logger.info("[ordenEntrada] Orden de entrada creada", { ordenId, contratoId, unidades: lista.length });

  // Correo a recepción + vendedor del cliente (best-effort).
  try {
    const destinatarios = await _destinatarios(clienteId);
    if (destinatarios.length) {
      const filas = lista.map(u => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(u.serial)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(u.modelo || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(COND[u.condicion] || u.condicion || "—")}</td>
        </tr>`).join("");
      await db.collection("mail_queue").add({
        to: destinatarios[0],
        cc: destinatarios.length > 1 ? destinatarios.slice(1).join(",") : null,
        subject: `Nueva orden de ENTRADA ${ordenId} – ${clienteNombre || "Cliente"}`,
        preheader: `${lista.length} equipo(s) devuelto(s) para inspección · ${motivo}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden de entrada creada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Se creó automáticamente la orden <b>${escapeHtml(ordenId)}</b> por <b>${escapeHtml(motivo)}</b>
            del contrato <b>${escapeHtml(contratoId || contratoDocId || "—")}</b> de
            <b>${escapeHtml(clienteNombre || "—")}</b>. El taller debe inspeccionar los equipos devueltos;
            al terminar, inventario los regresa a bodega o los da de baja.
          </p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Condición reportada</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>`,
        ctaUrl: `${APP_BASE_URL}/ordenes/index.html`,
        ctaLabel: "Ver órdenes de servicio",
        meta: {
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          source: "orden-entrada",
          orden_id: ordenId,
          contrato_id: contratoId || contratoDocId || null,
        },
        status: "queued",
      });
      logger.info("[ordenEntrada] Correo encolado", { ordenId, to: destinatarios[0], cc: destinatarios.length - 1 });
    } else {
      logger.warn("[ordenEntrada] Sin destinatarios (recepción/vendedor) — orden creada sin correo", { ordenId });
    }
  } catch (e) {
    logger.warn("[ordenEntrada] No se pudo encolar el correo (no crítico)", { ordenId, message: e.message });
  }

  return ordenId;
}

module.exports = { crearOrdenEntrada };

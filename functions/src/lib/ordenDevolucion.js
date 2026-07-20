// Orden de servicio de DEVOLUCIÓN — el tiquete de RECUPERAR equipos que
// siguen con el cliente (o de CONFIRMAR si de verdad salieron, caso
// anulación). Es la etapa previa a la ENTRADA: DEVOLUCIÓN = perseguir /
// confirmar (dueño: vendedor+recepción); ENTRADA = inspeccionar lo que ya
// llegó (dueño: taller). El check-in por serial vive en el modal de órdenes
// (ordenes-devolucion.js) y el trigger onOrdenDevolucionWrite aplica cada
// resolución al pool:
//   recibido    → devuelto_revision (cuarentena; al cerrar la orden se crea
//                 la ENTRADA de inspección con los recibidos)
//   nunca_salio → en_bodega directo (anulación por error: el equipo jamás
//                 salió — no hay nada que inspeccionar)
//   no_devuelve → devolucion_excepcion en la unidad (parcial/vendido/perdido)
//
// La orden NO usa `equipos[]` (usa devolucion.esperados[]) para que
// onOrdenWritePool no la confunda con equipos entrando al taller.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { recepcionEmails } = require("./mailRecipients");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// Mismo formato de número de orden que ordenEntrada (AAAAMMDDNN, hora Panamá).
async function _siguienteOrdenId() {
  const hoy = new Date();
  const local = new Date(hoy.getTime() - 5 * 60 * 60 * 1000);
  const fechaBase = `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
  const snap = await db.collection("ordenes_de_servicio")
    .where(admin.firestore.FieldPath.documentId(), ">=", `${fechaBase}00`)
    .where(admin.firestore.FieldPath.documentId(), "<=", `${fechaBase}99`)
    .get();
  const usados = snap.docs.map(d => parseInt(d.id.slice(-2), 10)).filter(n => !Number.isNaN(n));
  return { fechaBase, siguiente: usados.length ? Math.max(...usados) + 1 : 1 };
}

async function _destinatarios(clienteId) {
  const emails = new Set();
  try {
    if (clienteId) {
      const cli = await db.collection("clientes").doc(clienteId).get();
      const vendUid = cli.exists ? cli.data().vendedor_asignado : null;
      if (vendUid) {
        const v = await db.collection("usuarios").doc(vendUid).get();
        const e = v.exists ? v.data().email : null;
        if (isEmail(e)) emails.add(String(e).trim().toLowerCase());
      }
    }
  } catch (e) { /* sin vendedor */ }
  try { (await recepcionEmails()).forEach(e => emails.add(e)); } catch (e) { /* sin recepción */ }
  return [...emails];
}

/**
 * Crea la orden de DEVOLUCIÓN y encola el correo a vendedor + recepción.
 * @param {Object} p
 * @param {string} p.clienteId / p.clienteNombre
 * @param {string} p.contratoDocId / p.contratoId — el contrato que dispara
 * @param {'recuperacion'|'confirmacion'} p.modo — recuperación (renovación/
 *        baja: el cliente los tiene) vs confirmación (anulación: probablemente
 *        nunca salieron — cada unidad se confirma "recibido" o "nunca salió").
 * @param {Object} p.origen — { tipo: 'renovacion'|'anulacion'|'baja', ref_id }
 * @param {Array}  p.unidades — [{ serial, modelo, modelo_id?, pool_doc_id? }]
 * @param {Array}  [p.porModelo] — [{ modelo, modelo_id?, cantidad }] (bajas por
 *        cantidad, sin serial conocido: el check-in captura el serial al llegar)
 * @param {string} p.motivo — texto para observaciones y correo
 * @returns {string|null} ordenId, o null (best-effort).
 */
async function crearOrdenDevolucion({ clienteId, clienteNombre, contratoDocId, contratoId, modo, origen, unidades, porModelo, motivo }) {
  const lista = (unidades || []).filter(u => (u.serial || "").toString().trim());
  const modelos = (porModelo || []).filter(m => Number(m.cantidad || 0) > 0);
  if (!lista.length && !modelos.length) return null;

  const esperados = lista.map(u => ({
    id: crypto.randomUUID(),
    serial: (u.serial || "").toString().trim(),
    modelo: (u.modelo || "").toString().trim(),
    modelo_id: u.modelo_id || null,
    pool_doc_id: u.pool_doc_id || null,
    resolucion: null,          // 'recibido' | 'nunca_salio' | 'no_devuelve'
    motivo_codigo: null,
    motivo_detalle: null,
    resuelto_at: null,
    resuelto_por: null,
  }));

  const totalUnidades = lista.length + modelos.reduce((s, m) => s + Number(m.cantidad || 0), 0);
  const observaciones = `Orden creada automáticamente: ${modo === "confirmacion"
    ? `confirmar la devolución de ${totalUnidades} equipo(s) (anulación — verificar si salieron del taller)`
    : `recuperar ${totalUnidades} equipo(s) que están con el cliente`}. ${motivo} — contrato ${contratoId || contratoDocId || "—"}.`;

  const data = {
    cliente_id: clienteId || "",
    cliente_nombre: clienteNombre || "",
    vendedor_asignado: "",
    tipo_de_servicio: "DEVOLUCION",
    estado_reparacion: "POR ASIGNAR",
    fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
    observaciones,
    // Sin `equipos[]` a propósito: onOrdenWritePool no debe tratar estas
    // unidades como "en taller" — siguen con el cliente hasta el check-in.
    devolucion: {
      modo: modo || "recuperacion",
      origen: { tipo: origen?.tipo || "manual", ref_id: origen?.ref_id || null },
      esperados,
      // Bajas por cantidad (sin serial conocido): el check-in captura el
      // serial al llegar y lo agrega a `esperados` con su resolución.
      esperados_por_modelo: modelos.map(m => ({
        modelo: (m.modelo || "").toString().trim(),
        modelo_id: m.modelo_id || null,
        cantidad: Number(m.cantidad || 0),
        recibidos: 0,
      })),
    },
    contrato: {
      aplica: true,
      contrato_doc_id: contratoDocId || null,
      contrato_id: contratoId || null,
      motivo_no_aplica: null,
    },
    creado_por_uid: "system",
    creado_por_email: null,
    eliminado: false,
    os_logs: [{ action: "CREAR", by: "system:orden-devolucion" }],
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
  if (!ordenId) {
    logger.error("[ordenDevolucion] No se pudo reservar un número de orden", { fechaBase, contratoId });
    return null;
  }
  logger.info("[ordenDevolucion] Orden de devolución creada", { ordenId, contratoId, modo, unidades: totalUnidades });

  // Correo (best-effort).
  try {
    const destinatarios = await _destinatarios(clienteId);
    if (destinatarios.length) {
      const filas = lista.slice(0, 40).map(u => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(u.serial)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(u.modelo || "—")}</td>
        </tr>`).join("")
        + modelos.map(m => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#6b7280;">(${Number(m.cantidad || 0)} sin serial registrado)</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(m.modelo || "—")}</td>
        </tr>`).join("");
      const intro = modo === "confirmacion"
        ? `Se anuló el contrato <b>${escapeHtml(contratoId || "—")}</b> de <b>${escapeHtml(clienteNombre || "—")}</b>.
           Lo usual es que los equipos <b>nunca hayan salido del taller</b> (anulación por error en el contrato):
           confirma unidad por unidad con el check-in — "nunca salió" los regresa a bodega directo;
           "recibido" los manda a inspección.`
        : `Estos equipos están <b>con el cliente</b> y deben recuperarse (${escapeHtml(motivo || "")}).
           Registra cada unidad con el check-in al recibirla; cada tanda recibida alimenta al
           instante la orden de ENTRADA de inspección del taller.`;
      await db.collection("mail_queue").add({
        to: destinatarios[0],
        cc: destinatarios.length > 1 ? destinatarios.slice(1).join(",") : null,
        subject: `${modo === "confirmacion" ? "Confirmar devolución" : "Equipos por recuperar"}: orden ${ordenId} – ${clienteNombre || "Cliente"}`,
        preheader: `${totalUnidades} equipo(s) · ${motivo || ""}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Orden de devolución ${escapeHtml(ordenId)}</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${intro}</p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>`,
        ctaUrl: `${APP_BASE_URL}/ordenes/index.html`,
        ctaLabel: "Abrir órdenes de servicio",
        meta: {
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          source: "orden-devolucion",
          orden_id: ordenId,
          contrato_id: contratoId || contratoDocId || null,
          modo,
        },
        status: "queued",
      });
    } else {
      logger.warn("[ordenDevolucion] Sin destinatarios — orden creada sin correo", { ordenId });
    }
  } catch (e) {
    logger.warn("[ordenDevolucion] No se pudo encolar el correo (no crítico)", { ordenId, message: e.message });
  }

  return ordenId;
}

module.exports = { crearOrdenDevolucion };

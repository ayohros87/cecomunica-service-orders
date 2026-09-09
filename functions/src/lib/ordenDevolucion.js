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
const { decidirDedupe } = require("../domain/dedupeDevolucion");
const pool = require("../domain/equiposPool");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// Devoluciones recientes del cliente para el dedupe. Índice compuesto:
// ordenes_de_servicio(tipo_de_servicio ASC, cliente_id ASC, fecha_creacion DESC).
// `eliminado` y la ventana de días los filtra decidirDedupe.
async function _devolucionesRecientes(clienteId) {
  const snap = await db.collection("ordenes_de_servicio")
    .where("tipo_de_servicio", "==", "DEVOLUCION")
    .where("cliente_id", "==", clienteId)
    .orderBy("fecha_creacion", "desc")
    .limit(40)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

const _filaEsperada = (u) => ({
  id: crypto.randomUUID(),
  serial: (u.serial || "").toString().trim(),
  modelo: (u.modelo || "").toString().trim(),
  modelo_id: u.modelo_id || null,
  pool_doc_id: u.pool_doc_id || null,
  resolucion: null, motivo_codigo: null, motivo_detalle: null,
  resuelto_at: null, resuelto_por: null,
});

// Agrega a una devolución ABIERTA las unidades que le faltan (misma idea que
// crearOAlimentarEntrada). Une los contratos de origen para que el espejo
// marque también la fila del contrato que ahora reclama. Devuelve false si la
// orden ya no está abierta (carrera): el llamante crea aparte.
async function _alimentarDevolucion(ordenId, unidades, { contratoDocId, contratoId, contratoOrigenIds, motivo, clienteId, clienteNombre }) {
  const ref = db.collection("ordenes_de_servicio").doc(ordenId);
  const nuevas = unidades.map(_filaEsperada);
  const ok = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const o = snap.data();
    if (o.eliminado === true || String(o.estado_reparacion || "").toUpperCase() === "CERRADA (DEVOLUCION)") return false;
    const dev = o.devolucion || {};
    const ya = new Set((dev.esperados || []).map(e => pool.normSerial(e && e.serial)).filter(Boolean));
    const agregar = nuevas.filter(n => !ya.has(pool.normSerial(n.serial)));
    if (!agregar.length) return true;
    const c = o.contrato || {};
    const origenes = new Set([...(Array.isArray(c.contrato_origen_ids) ? c.contrato_origen_ids : []), ...(contratoOrigenIds || [])].filter(Boolean));
    const update = {
      "devolucion.esperados": [...(dev.esperados || []), ...agregar],
      "contrato.contrato_origen_ids": [...origenes],
      observaciones: `${o.observaciones || ""}\n\nSe agregaron ${agregar.length} equipo(s) a este tiquete en vez de abrir otro: ${motivo} — contrato ${contratoId || contratoDocId || "—"}.`.trim(),
      fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
      os_logs: admin.firestore.FieldValue.arrayUnion({ action: "DEVOLUCION_ALIMENTAR", by: "system:orden-devolucion", contrato: contratoId || null }),
    };
    // Un tiquete de papel al que se le suman unidades de un contrato del
    // sistema queda ligado a ese contrato (el espejo y la cancelación lo
    // necesitan); si ya tenía contrato, se respeta el suyo.
    if (!c.aplica && contratoDocId) {
      update["contrato.aplica"] = true;
      update["contrato.contrato_doc_id"] = contratoDocId;
      update["contrato.contrato_id"] = contratoId || null;
      update["contrato.motivo_no_aplica"] = null;
    }
    tx.update(ref, update);
    return true;
  });
  if (!ok) return false;

  // Correo corto (best-effort): el vendedor y recepción ya conocen el tiquete.
  try {
    const destinatarios = await _destinatarios(clienteId);
    if (destinatarios.length) {
      await db.collection("mail_queue").add({
        to: destinatarios[0],
        cc: destinatarios.length > 1 ? destinatarios.slice(1).join(",") : null,
        subject: `Equipos agregados a la devolución ${ordenId} – ${clienteNombre || "Cliente"}`,
        preheader: `${nuevas.length} equipo(s) más por recuperar · ${motivo || ""}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Devolución ${escapeHtml(ordenId)}</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            El cliente <b>${escapeHtml(clienteNombre || "—")}</b> ya tenía este tiquete abierto, así que
            <b>${nuevas.length} equipo(s)</b> se agregaron ahí en vez de abrir otra orden (${escapeHtml(motivo || "")}).
          </p>
          <p style="margin:0;font:13px/1.5 Arial,sans-serif;font-family:monospace;">${nuevas.map(u => escapeHtml(u.serial)).join("<br>")}</p>`,
        ctaUrl: `${APP_BASE_URL}/ordenes/index.html`,
        ctaLabel: "Abrir órdenes de servicio",
        meta: { created_at: admin.firestore.FieldValue.serverTimestamp(), source: "orden-devolucion-alimentar", orden_id: ordenId, contrato_id: contratoId || contratoDocId || null },
        status: "queued",
      });
    }
  } catch (e) {
    logger.warn("[ordenDevolucion] No se pudo encolar el correo de unidades agregadas (no crítico)", { ordenId, message: e.message });
  }
  return true;
}

// Deja constancia en el tiquete que ya cubría la devolución de que otro
// disparador la reclamó (y liga el contrato si el tiquete era de papel).
async function _anotarDuplicado(ordenId, contratoId, contratoDocId, contratoOrigenIds, lista, motivo) {
  try {
    const ref = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const o = snap.data();
    const c = o.contrato || {};
    const origenes = new Set([...(Array.isArray(c.contrato_origen_ids) ? c.contrato_origen_ids : []), ...(contratoOrigenIds || [])].filter(Boolean));
    const update = {
      "contrato.contrato_origen_ids": [...origenes],
      observaciones: `${o.observaciones || ""}\n\nEste tiquete ya cubre la devolución que pedía: ${motivo} — contrato ${contratoId || contratoDocId || "—"} (${lista.map(u => u.serial).join(", ")}). No se abrió otra orden.`.trim(),
      os_logs: admin.firestore.FieldValue.arrayUnion({ action: "DEVOLUCION_YA_CUBIERTA", by: "system:orden-devolucion", contrato: contratoId || null }),
    };
    if (!c.aplica && contratoDocId) {
      update["contrato.aplica"] = true;
      update["contrato.contrato_doc_id"] = contratoDocId;
      update["contrato.contrato_id"] = contratoId || null;
      update["contrato.motivo_no_aplica"] = null;
    }
    await ref.update(update);
  } catch (e) {
    logger.warn("[ordenDevolucion] No se pudo anotar el duplicado (no crítico)", { ordenId, message: e.message });
  }
}

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
async function crearOrdenDevolucion({ clienteId, clienteNombre, contratoDocId, contratoId, contratoOrigenIds, modo, origen, unidades, porModelo, motivo }) {
  let lista = (unidades || []).filter(u => (u.serial || "").toString().trim());
  const modelos = (porModelo || []).filter(m => Number(m.cantidad || 0) > 0);
  if (!lista.length && !modelos.length) return null;

  // ── Deduplicación (2026-09-07) ─────────────────────────────────────────
  // ¿Ya hay un tiquete del cliente que reclama estos mismos radios? Caso
  // Gamboa: recepción abrió la devolución a mano con el radio en el mostrador
  // y dos horas después la confirmación de la entrega abrió OTRA. La regla
  // (domain/dedupeDevolucion.js) da el mismo resultado sin importar el orden:
  // abierta que coincide → se alimenta; todo ya cubierto → no se crea; una
  // parte ya volvió → se crea solo con el resto. Best-effort: si la consulta
  // falla se crea como siempre (peor un duplicado que una devolución perdida).
  if (clienteId && lista.length && !modelos.length) {
    try {
      const existentes = await _devolucionesRecientes(clienteId);
      const d = decidirDedupe({ unidades: lista, origen, existentes });
      if (d.accion === "omitir") {
        logger.info("[ordenDevolucion] Devolución ya cubierta por otro tiquete — no se crea",
          { ordenId: d.ordenId, contratoId, motivo: d.motivo, unidades: lista.length });
        if (d.ordenId) await _anotarDuplicado(d.ordenId, contratoId, contratoDocId, contratoOrigenIds, lista, motivo);
        return d.ordenId;
      }
      if (d.accion === "alimentar") {
        const ok = await _alimentarDevolucion(d.ordenId, d.unidades, { contratoDocId, contratoId, contratoOrigenIds, motivo, clienteId, clienteNombre });
        if (ok) {
          logger.info("[ordenDevolucion] Unidades agregadas a una devolución abierta del cliente",
            { ordenId: d.ordenId, contratoId, motivo: d.motivo, agregadas: d.unidades.length });
          return d.ordenId;
        }
        // La abierta se cerró entre la lectura y la escritura: se crea aparte.
      }
      if (d.unidades.length < lista.length) {
        logger.info("[ordenDevolucion] Parte de las unidades ya volvió en otro tiquete; se reclama el resto",
          { contratoId, antes: lista.length, ahora: d.unidades.length });
        lista = d.unidades;
      }
    } catch (e) {
      logger.warn("[ordenDevolucion] Dedupe no disponible — se crea la orden como siempre", { clienteId, message: e.message });
    }
  }

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
      // Contratos ORIGEN del titular (renovación/reemplazo). Los equipos que
      // este tiquete reclama son físicamente de ELLOS, así que el espejo
      // (onOrdenDevolucionWrite) también marca su fila. Se denormaliza aquí
      // para que el trigger no tenga que hacer la consulta inversa.
      contrato_origen_ids: Array.isArray(contratoOrigenIds) ? contratoOrigenIds : [],
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
          </table>
          <p style="margin:10px 0 0;font:12.5px/1.5 Arial,sans-serif;color:#6b7280;">
            Esta lista trae <b>solo los equipos de la flota</b>. Los que son <b>propiedad del cliente</b>
            no se recuperan y por eso no aparecen, aunque estén en el mismo contrato: de quién es cada
            radio se ve en la ficha del cliente, columna “De quién es”.</p>`,
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

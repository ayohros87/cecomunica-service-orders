const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");
const { unidadesRecuperablesDeBaja } = require("../../lib/devolucion");
const { origenIdsDe } = require("../../lib/linaje");
const pool = require("../../domain/equiposPool");

// Notifica y deriva el estado del contrato cuando una enmienda (baja/terminación)
// se crea / aprueba / rechaza / cierra. Usa admin SDK: las escrituras al contrato
// NO pasan por reglas (esquiva el guard touchesCFOwnedFields).
const TIPO_LABEL = { terminacion_total: "Terminación total", baja_parcial: "Baja parcial" };
const MOTIVO_LABEL = {
  fin_necesidad: "Fin de la necesidad / proyecto",
  precio: "Precio / presupuesto",
  servicio: "Insatisfacción con el servicio",
  fallas_equipo: "Fallas recurrentes del equipo",
  cierre_operacion: "Cierre / reducción de operación",
  morosidad: "Morosidad / falta de pago",
  cambio_proveedor: "Cambio de proveedor",
  migracion: "Migración tecnológica",
  otro: "Otro",
};

module.exports = onDocumentWritten(
  {
    document: "solicitudes_cancelacion/{id}",
    region: "us-central1",
    secrets: ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
  },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after) return null;

    const id = event.params.id;
    const eb = before?.estado || null;
    const ea = after.estado   || null;

    const created  = !before;
    const approved = eb === "pendiente" && ea === "aprobada";
    const rejected = eb === "pendiente" && ea === "rechazada";
    const closed   = eb === "aprobada"  && ea === "cerrada";
    if (!created && !approved && !rejected && !closed) return null;
    const evento = created ? "created" : approved ? "approved" : rejected ? "rejected" : "closed";

    const escapeHtml = (v) => String(v ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
    const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
    const money = (n) => "$" + Number(n || 0).toFixed(2);

    const getUserInfo = async (uid) => {
      if (!uid) return { uid: null, nombre: "", email: "" };
      try {
        const snap = await db.collection("usuarios").doc(uid).get();
        if (!snap.exists) return { uid, nombre: uid, email: "" };
        const d = snap.data() || {};
        return { uid, nombre: d.nombre || d.email || uid, email: d.email || "" };
      } catch (e) {
        logger.warn("[onCancelacionWrite] No se pudo leer usuario", { uid, message: e.message });
        return { uid, nombre: uid, email: "" };
      }
    };

    const getApproverEmails = async () => {
      try {
        const snap = await db.collection("usuarios").where("rol", "in", ["administrador", "gerente"]).get();
        const emails = [];
        snap.forEach((d) => { const e = d.data()?.email; if (isEmail(e)) emails.push(e.trim().toLowerCase()); });
        return [...new Set(emails)];
      } catch (e) {
        logger.warn("[onCancelacionWrite] No se pudieron leer aprobadores", { message: e.message });
        return [];
      }
    };

    const contratoDocId = after.contrato_doc_id || null;
    const contratoId    = after.contrato_id || contratoDocId || "—";
    const cliente       = after.cliente_nombre || "—";
    const items         = Array.isArray(after.items) ? after.items : [];
    const itemsTxt      = items.map((i) => `${i.modelo || "—"} ×${Number(i.cantidad || 0)}`).join(", ") || "—";
    const finTs         = after.fecha_fin_facturacion || null;
    const finStr        = finTs?.toDate ? finTs.toDate().toLocaleDateString("es-PA") : "—";
    const tipoLabel     = TIPO_LABEL[after.tipo] || "Baja parcial";
    const motivoLabel   = MOTIVO_LABEL[after.motivo_codigo] || (after.motivo_codigo || "—");

    // El contrato se lee UNA vez (cacheado): su tipo decide CÓMO se evalúa la
    // recuperación de equipos. Un contrato "Propio" es una venta con servicio
    // —los radios suelen ser del cliente— así que terminar el servicio no
    // genera un tiquete para ir a buscarlos. Sin ese guard el taller recibía
    // una orden para recuperar equipos ajenos, y el check-in los habría metido
    // a cuarentena y de ahí a bodega como si fueran flota propia.
    //
    // Pero "Propio" NO implica que todas las unidades sean del cliente: la
    // propiedad de la ficha manda (2026-08-06). Un contrato Propio puede
    // llevar radios de la flota CeComunica mezclados —salidos de bodega y
    // nunca reclasificados— y saltarse la orden entera los dejaba colgando de
    // un contrato muerto, fuera del inventario. Ahora se decide ficha por
    // ficha, igual que onAnnulment (que ya saltaba solo propiedad === "cliente").
    let _contrato;
    const getContrato = async () => {
      if (_contrato === undefined) {
        _contrato = null;
        if (contratoDocId) {
          try {
            const c = await db.collection("contratos").doc(contratoDocId).get();
            if (c.exists) _contrato = c.data();
          } catch (e) {
            logger.warn("[onCancelacionWrite] No se pudo leer el contrato", { contratoDocId, message: e.message });
          }
        }
      }
      return _contrato;
    };
    const esContratoPropio = (c) => !!c && (c.tipo_contrato === "Propio" || c.codigo_tipo === "PROP");
    // Cuántas unidades de flota resultaron recuperables en un contrato Propio.
    // null = todavía no se evaluó (eventos distintos de "aprobada"); el correo
    // usa los campos ya persistidos en esos casos.
    let recuperadasPropio = null;

    // ── 1) Derivar el estado del contrato (admin SDK) ───────────────────────
    if (contratoDocId) {
      try {
        const ref = db.collection("contratos").doc(contratoDocId);
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (created) {
          await ref.set({ baja_estado: "pendiente", baja_solicitud_id: id, baja_actualizado_at: now }, { merge: true });
        } else if (approved) {
          // Recalcula lo cancelado por modelo desde TODAS las enmiendas aprobadas/cerradas
          // del contrato (idempotente). Detecta si alguna es terminación total.
          const sols = await db.collection("solicitudes_cancelacion")
            .where("contrato_doc_id", "==", contratoDocId).get();
          const map = {};
          let terminacionTotal = false;
          let terminacionFin = null;
          sols.forEach((s) => {
            const sd = s.data();
            if (sd.estado !== "aprobada" && sd.estado !== "cerrada") return;
            (sd.items || []).forEach((it) => {
              const key = String(it.modelo_id || it.modelo || "").trim();
              const q = Number(it.cantidad || 0);
              if (!key || q <= 0) return;
              map[key] = Number(map[key] || 0) + q;
            });
            if (sd.tipo === "terminacion_total") { terminacionTotal = true; terminacionFin = sd.fecha_fin_facturacion || terminacionFin; }
          });
          const total = Object.values(map).reduce((s, v) => s + Number(v || 0), 0);
          const payload = {
            baja_estado: "aprobada",
            baja_solicitud_id: id,
            baja_fecha_fin: finTs,
            baja_cancelado: map,
            baja_cancelado_total: total,
            baja_actualizado_at: now,
          };
          if (terminacionTotal) { payload.terminacion_total = true; payload.terminacion_fin = terminacionFin; }
          await ref.set(payload, { merge: true });
        } else if (rejected) {
          await ref.set({
            baja_estado: admin.firestore.FieldValue.delete(),
            baja_solicitud_id: admin.firestore.FieldValue.delete(),
            baja_actualizado_at: now,
          }, { merge: true });
        } else if (closed) {
          await ref.set({ baja_cerrada_at: now }, { merge: true });
        }
      } catch (e) {
        logger.warn("[onCancelacionWrite] No se pudo derivar el contrato", { contratoDocId, message: e.message });
      }
    }

    // ── 1c) Tiquete de DEVOLUCIÓN al APROBARSE la baja ──────────────────────
    // Alquiler/Temporal/Demo: la baja lista modelos+cantidades (sin serial), así
    // que la orden nace "por modelo" y el check-in captura el serial de cada
    // unidad al llegar; de ahí salen pool → cuarentena y la ENTRADA de
    // inspección (onOrdenDevolucionWrite). Propio: los seriales YA están en el
    // contrato, así que la orden nace con las unidades exactas — solo las que no
    // son del cliente. El cierre de la enmienda es solo administrativo.
    if (approved && contratoDocId && !after.orden_devolucion_id && !after.devolucion_no_aplica) {
      try {
        const c = await getContrato();
        if (esContratoPropio(c)) {
          // Se resuelve la ficha de cada serial del contrato y se recuperan
          // SOLO las unidades que no son del cliente.
          const serialesSnap = await db.collection("contratos").doc(contratoDocId)
            .collection("seriales").get();
          const fichas = [];
          const sinFicha = [];
          for (const d of serialesSnap.docs) {
            const s = d.data() || {};
            const serial = (s.serial || "").toString().trim();
            if (!serial) continue;
            try {
              // adoptarSiExiste: igual que onAnnulment — un desacuerdo de modelo
              // entre contrato y ficha no puede esconder la unidad.
              const { ref, data } = await pool.resolver(serial, s.modelo_id, s.modelo, { adoptarSiExiste: true });
              if (!data) { sinFicha.push(serial); continue; }
              fichas.push({
                serial, modelo: s.modelo || "", modelo_id: s.modelo_id || null,
                pool_doc_id: ref.id, ref,
                propiedad: data.propiedad, estado: data.estado,
                contrato_doc_id: data.asignacion?.contrato_doc_id || null,
              });
            } catch (e) {
              sinFicha.push(`${serial} (error: ${e.message})`);
            }
          }
          if (sinFicha.length) {
            logger.warn("[onCancelacionWrite] Seriales del contrato sin ficha resoluble en el pool",
              { id, contratoId, seriales: sinFicha.slice(0, 20) });
          }
          const recuperables = unidadesRecuperablesDeBaja({
            fichas, contratoDocId, items: after.items || [], tipo: after.tipo,
          });
          recuperadasPropio = recuperables.length;

          if (!recuperables.length) {
            // Todo es del cliente: la enmienda solo corta servicio y facturación.
            // Se deja la marca para que la cola y el correo lo expliquen (y para
            // que este bloque sea idempotente si el doc se vuelve a escribir).
            await db.collection("solicitudes_cancelacion").doc(id)
              .set({ devolucion_no_aplica: "propio" }, { merge: true });
            // El contrato también lo marca: su fila debe decir "no aplica" en vez
            // de "sin registro", que mandaría a alguien a perseguir equipos ajenos.
            await db.collection("contratos").doc(contratoDocId).set({
              devolucion_estado: "no_aplica",
              devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            logger.info("[onCancelacionWrite] Contrato Propio: sin orden de recuperación", { id, contratoId });
          } else {
            // Modo según la entrega: sin entrega confirmada lo usual es que los
            // equipos nunca salieron de bodega, y "nunca salió" —el check-in que
            // los regresa directo, sin inspección— solo existe en confirmación.
            const modo = c && c.entrega_confirmada === true ? "recuperacion" : "confirmacion";
            for (const u of recuperables) {
              await u.ref.set({
                pendiente_devolucion: true,
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
            }
            const ordenId = await crearOrdenDevolucion({
              clienteId: after.cliente_id || (c && c.cliente_id) || null,
              clienteNombre: cliente,
              contratoDocId,
              contratoId,
              contratoOrigenIds: origenIdsDe(c),
              modo,
              origen: { tipo: "baja", ref_id: id },
              unidades: recuperables.map(u => ({
                serial: u.serial, modelo: u.modelo, modelo_id: u.modelo_id, pool_doc_id: u.pool_doc_id,
              })),
              motivo: `${tipoLabel} aprobada — contrato ${contratoId} (unidades de flota CeComunica)`,
            });
            if (ordenId) {
              await db.collection("solicitudes_cancelacion").doc(id)
                .set({ orden_devolucion_id: ordenId }, { merge: true });
            }
            logger.info("[onCancelacionWrite] Contrato Propio con unidades de flota: orden creada",
              { id, contratoId, unidades: recuperables.length, modo, ordenId });
          }
        } else {
          const clienteIdDev = after.cliente_id || (c && c.cliente_id) || null;
          const ordenId = await crearOrdenDevolucion({
            clienteId: clienteIdDev,
            clienteNombre: cliente,
            contratoDocId,
            contratoId,
            contratoOrigenIds: origenIdsDe(c),
            modo: "recuperacion",
            origen: { tipo: "baja", ref_id: id },
            unidades: [],
            porModelo: (after.items || []).map(it => ({
              modelo: it.modelo || "", modelo_id: it.modelo_id || null, cantidad: Number(it.cantidad || 0),
            })),
            motivo: `${tipoLabel} aprobada — contrato ${contratoId}`,
          });
          if (ordenId) {
            await db.collection("solicitudes_cancelacion").doc(id)
              .set({ orden_devolucion_id: ordenId }, { merge: true });
          }
        }
      } catch (e) {
        logger.warn("[onCancelacionWrite] Orden de devolución falló (no crítico)", { id, message: e.message });
      }
    }

    // ── 2) Correo ───────────────────────────────────────────────────────────
    const baseUrl = "https://app.cecomunica.net/contratos/cancelaciones.html";
    const filaTabla = `
      <table role="presentation" width="100%" style="font:14px Arial,sans-serif; margin:12px 0 16px;">
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Contrato</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(contratoId)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(cliente)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(tipoLabel)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Equipos</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(itemsTxt)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Motivo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(motivoLabel)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Fin de facturación</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(finStr)}</td></tr>
      </table>`;
    const liquidHtml = (after.aplica_penalidad && Number(after.penalidad_monto || 0) > 0) || (after.deposito_accion && after.deposito_accion !== "na")
      ? `<p style="margin:0 0 12px;font:13px/1.5 Arial,sans-serif;color:#374151;">
           ${after.aplica_penalidad && Number(after.penalidad_monto || 0) > 0 ? `Penalidad: <b>${money(after.penalidad_monto)}</b>. ` : ""}
           ${after.deposito_accion && after.deposito_accion !== "na" ? `Depósito: ${after.deposito_accion === "devolver" ? "devolver" : "retener"} <b>${money(after.deposito_monto)}</b>.` : ""}
         </p>`
      : "";

    // Contrato Propio: los correos NO deben pedir recuperar equipos del cliente,
    // pero sí deben avisar de las unidades de flota que sí se recuperan.
    const propio = esContratoPropio(await getContrato());
    const sinRecuperacion = propio && (after.devolucion_no_aplica === "propio" || recuperadasPropio === 0);
    const conFlota = propio && (recuperadasPropio > 0 || (!!after.orden_devolucion_id && !after.devolucion_no_aplica));
    const notaPropio = !propio ? "" : conFlota
      ? `<div style="margin:0 0 14px;padding:11px 14px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;font:14px/1.5 Arial,sans-serif;color:#1e40af;">
           <b>Contrato Propio con equipos de flota.</b> Los radios del cliente se quedan con él, pero
           ${recuperadasPropio ? `<b>${recuperadasPropio}</b> unidad(es)` : "una o más unidades"} son de la flota CeComunica:
           se generó su <b>orden de devolución</b>.
         </div>`
      : sinRecuperacion
        ? `<div style="margin:0 0 14px;padding:11px 14px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;font:14px/1.5 Arial,sans-serif;color:#1e40af;">
             <b>Contrato Propio — equipos del cliente.</b> La enmienda termina el servicio y la facturación;
             <b>no hay recuperación de equipos</b> (los radios son propiedad del cliente).
           </div>`
        : `<div style="margin:0 0 14px;padding:11px 14px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;font:14px/1.5 Arial,sans-serif;color:#1e40af;">
             <b>Contrato Propio.</b> Los equipos del cliente no se recuperan. Si el contrato lleva unidades
             de la flota CeComunica, su orden de devolución se genera al aprobar la enmienda.
           </div>`;

    let subject, preheader, bodyHtml, ctaLabel, recipients;

    if (created) {
      const [approvers, solicitante] = await Promise.all([getApproverEmails(), getUserInfo(after.solicitado_por || null)]);
      recipients = [...approvers];
      if (isEmail(solicitante.email)) recipients.push(solicitante.email.trim().toLowerCase());
      subject   = `Enmienda (${tipoLabel}): ${contratoId} – ${cliente}`;
      preheader = `Nueva enmienda pendiente de aprobación · ${cliente}`;
      ctaLabel  = "Revisar enmienda";
      bodyHtml  = `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Enmienda de contrato</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">Hay una nueva enmienda <b>pendiente de aprobación</b>.</p>
        ${notaPropio}${filaTabla}${liquidHtml}
        ${after.motivo_detalle ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#374151;"><b>Observaciones:</b> ${escapeHtml(after.motivo_detalle)}</p>` : ""}
        <p style="margin:0 0 12px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">Solicitó: ${escapeHtml(after.solicitado_por_nombre || "—")}</p>`;
    } else {
      const [solicitante, aprobador] = await Promise.all([getUserInfo(after.solicitado_por || null), getUserInfo(after.aprobado_por || after.cerrado_por || null)]);
      recipients = [];
      if (isEmail(solicitante.email)) recipients.push(solicitante.email.trim().toLowerCase());
      if (isEmail(aprobador.email))   recipients.push(aprobador.email.trim().toLowerCase());
      if (approved) {
        subject   = `Enmienda APROBADA: ${contratoId} – ${cliente}`;
        preheader = `Aprobada · se factura hasta ${finStr}`;
        ctaLabel  = "Ver enmiendas";
        bodyHtml  = `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065f46;">Enmienda aprobada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">La enmienda fue <b>aprobada</b>. Se facturará hasta <b>${escapeHtml(finStr)}</b> (último tramo prorrateado).${
            !propio ? " Procede la recuperación de los equipos."
              : conFlota ? " Procede la recuperación de las unidades de flota CeComunica." : ""}</p>
          ${notaPropio}${filaTabla}${liquidHtml}`;
      } else if (closed) {
        subject   = `Enmienda CERRADA: ${contratoId} – ${cliente}`;
        preheader = sinRecuperacion ? `Enmienda cerrada · sin recuperación de equipos` : `Equipos recuperados · enmienda cerrada`;
        ctaLabel  = "Ver enmiendas";
        bodyHtml  = `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#1e40af;">Enmienda cerrada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${sinRecuperacion
            ? "La enmienda quedó <b>cerrada</b>. No hubo recuperación de equipos: son propiedad del cliente."
            : conFlota
              ? "Las unidades de flota CeComunica fueron recuperadas y la enmienda quedó <b>cerrada</b>. Los equipos del cliente se quedan con él."
              : "Los equipos fueron recuperados y la enmienda quedó <b>cerrada</b>."}</p>
          ${notaPropio}${filaTabla}
          ${after.condicion_notas ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#374151;"><b>Condición:</b> ${escapeHtml(after.condicion_notas)}</p>` : ""}`;
      } else {
        subject   = `Enmienda RECHAZADA: ${contratoId} – ${cliente}`;
        preheader = `Enmienda rechazada · ${cliente}`;
        ctaLabel  = "Ver enmiendas";
        bodyHtml  = `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991b1b;">Enmienda rechazada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">La enmienda fue <b>rechazada</b>.</p>
          ${filaTabla}
          ${after.motivo_rechazo ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #b91c1c;border-radius:10px;background:#fef2f2;font:700 14px Arial,sans-serif;color:#991b1b;">Motivo: ${escapeHtml(after.motivo_rechazo)}</div>` : ""}`;
      }
    }

    const unique = [...new Set(recipients)];
    if (!unique.length) {
      logger.warn("[onCancelacionWrite] Sin destinatarios válidos", { id, evento });
      return null;
    }

    await db.collection("mail_queue").add({
      to: unique[0],
      cc: unique.length > 1 ? unique.slice(1).join(",") : null,
      subject,
      preheader,
      bodyContent: bodyHtml,
      ctaUrl: baseUrl,
      ctaLabel,
      meta: {
        created_at:   admin.firestore.FieldValue.serverTimestamp(),
        source:       "cancelacion-notify",
        evento,
        solicitud_id: id,
        contrato_id:  contratoId,
      },
      status: "queued",
    });

    logger.info("[onCancelacionWrite] Correo encolado", { id, to: unique[0], evento });
    return null;
  }
);

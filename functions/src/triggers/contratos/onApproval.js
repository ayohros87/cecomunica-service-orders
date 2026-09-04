const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger     = require("firebase-functions/logger");
const crypto     = require("crypto");
const puppeteer  = require("puppeteer-core");
const { admin, db }                                         = require("../../lib/admin");
const { sendEmail, recordSendFailure }                      = require("../../lib/mail");
const { buildEmailFromBase, escapeHtml }                    = require("../../domain/emailRenderer");
const { attachVerificationFromMirror, buildContractHtmlForPdf } = require("../../domain/pdfRenderer");
const { APP_BASE_URL, inventarioEmailTo } = require("../../lib/inventario");
const { activacionesEmailTo, ccContratoAprobado } = require("../../lib/mailRecipients");
const vigencia = require("../../lib/vigencia");
const { planAmarre } = require("../../lib/regularizacion");
const poolDom = require("../../domain/equiposPool");
const G = require("../../lib/gestiones");

const HMAC_SECRET = process.env.FIRMA_SECRET || "MISSING_SECRET";

// SERV mixto (2026-09-01, pedido de Alberto: "no está jalando los seriales del
// cliente automáticamente en almacén"): al APROBARSE el contrato, las líneas
// modalidad 'propio' jalan sus seriales de la CUSTODIA del cliente (unidades
// en_cliente propiedad 'cliente' sin contrato) — así el Anexo A ya los trae
// cuando el cliente firma, y a Bodega solo le queda el stock de las líneas de
// alquiler. Solo crea FILAS en contratos/{cid}/seriales: onSerialWrite hace el
// sync al pool (con en_cliente y la propiedad protegidos). Idempotente:
// planAmarre deduplica por filas existentes y la custodia ya amarrada sale
// del filtro.
async function jalarSerialesPropios(contratoRef, contrato, cid) {
  const lineasPropio = (contrato.equipos || []).filter((l) => l.modalidad === "propio");
  if (!lineasPropio.length || !contrato.cliente_id) return;
  try {
    const poolSnap = await db.collection("equipos_pool")
      .where("asignacion.cliente_id", "==", contrato.cliente_id)
      .where("estado", "==", "en_cliente").get();
    const custodia = poolSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => !u.asignacion?.contrato_doc_id && u.propiedad === "cliente");
    if (!custodia.length) return;
    const filasSnap = await contratoRef.collection("seriales").get();
    const filas = filasSnap.docs.map((d) => {
      const x = d.data() || {};
      return { serial_norm: poolDom.normSerial(x.serial || ""), modelo_id: x.modelo_id || null, modelo: x.modelo || "" };
    });
    const plan = planAmarre({ equipos: lineasPropio }, custodia, filas);
    for (const { unidad } of plan.asignar) {
      await contratoRef.collection("seriales").add({
        serial: unidad.serial || unidad.id,
        modelo: unidad.modelo_label || "",
        modelo_id: unidad.modelo_id || null,
        contrato_doc_id: cid,
        contrato_id: contrato.contrato_id || "",
        cliente_id: contrato.cliente_id || "",
        cliente_nombre: contrato.cliente_nombre || "",
        source: "regularizacion_aprobacion",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        created_by: "trigger:regularizacion_aprobacion",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: "trigger:regularizacion_aprobacion",
      });
    }
    if (plan.asignar.length) {
      logger.info("[onContratoActivado] seriales del cliente jalados a las líneas propio",
        { cid, jalados: plan.asignar.length });
    }
  } catch (e) {
    logger.error("[onContratoActivado] jalado de seriales propios falló (no crítico)", { cid, message: e.message });
  }
}

// Resuelve el email del vendedor (creador) del contrato para CC. Nunca lanza.
async function vendedorEmail(uid) {
  if (!uid) return null;
  try {
    const snap = await db.collection("usuarios").doc(uid).get();
    return snap.exists ? (snap.data().email || null) : null;
  } catch (e) {
    logger.warn("[seriales] No se pudo leer email del vendedor.", { uid, message: e.message });
    return null;
  }
}

// Unidades del contrato que requieren serial (descontando bajas/cancelaciones).
// Misma fórmula que el botón de seriales en la lista (contratos-list.js:24-26).
function unidadesSerializables(contrato) {
  const total = (contrato.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
  return Math.max(0, total - Number(contrato.baja_cancelado_total || 0));
}

const onContratoActivado = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    secrets: ["FIRMA_SECRET"]
  },
  async (event) => {
    const beforeSnap = event.data.before;
    const afterSnap  = event.data.after;
    if (!beforeSnap || !afterSnap) return null;

    const before = beforeSnap.data();
    const after  = afterSnap.data();
    if (!before || !after) return null;

    const estadoBefore = before.estado || null;
    const estadoAfter  = after.estado  || null;

    if (!["activo", "aprobado"].includes(estadoAfter)) return null;

    const contratoId = event.params.docId;
    const verificRef = admin.firestore().collection("verificaciones").doc(contratoId);

    const transitionedToActivo   = (estadoBefore !== "activo"   && estadoAfter === "activo");
    const transitionedToAprobado = (estadoBefore !== "aprobado" && estadoAfter === "aprobado");

    // La marca verificacion_ok vive en el contrato y la estampa este mismo
    // trigger DESPUÉS de escribir la verificación (2026-09-02). Antes se leía
    // verificaciones/ en cada escritura de un contrato activo solo para saber
    // si hacía falta reparar — una lectura por escritura, multiplicada por
    // todos los triggers que tocan contratos. Contratos anteriores a la marca
    // se auto-sanan en su próxima escritura, una sola vuelta.
    const needsRepair =
      after.verificacion_ok !== true ||
      !after.firma_codigo ||
      !after.firma_hash   ||
      !after.firma_url;

    if (!transitionedToActivo && !transitionedToAprobado && !needsRepair) {
      return null;
    }

    if (transitionedToAprobado || transitionedToActivo) {
      await jalarSerialesPropios(afterSnap.ref, after, contratoId);
    }

    const aprobadoPor  = after.aprobado_por_uid || "desconocido";
    const codigoCorto  = after.firma_codigo || crypto.randomBytes(5).toString("hex").toUpperCase();
    const payload      = `${contratoId}|${aprobadoPor}`;
    const hmac         = after.firma_hash || crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
    const firmaUrl     = after.firma_url || `https://verify.cecomunica.net/c/${encodeURIComponent(contratoId)}?v=${codigoCorto}`;

    // Vigencia del tramo inicial (Ola 1, gestiones por cliente): al quedar
    // ACTIVO se calcula fecha_vencimiento desde `duracion` — hasta hoy nadie
    // escribía ese campo. Idempotente: si ya existe (backfill o pasada
    // anterior) no se recalcula; la renovación por tramos escribirá la suya.
    // El estado por_vencer/vencido lo mantiene la sección H del cron.
    // 'aprobado' también opera (la mayoría del histórico nunca pasa a
    // 'activo'): el tramo se estampa desde el primer estado operativo.
    // Solo ALQ/PROP: los DEMO/TEMP terminan (no renuevan) y el REEMP cabalga
    // sobre la vigencia de su origen (deep-dive 2026-08-26).
    let vigenciaPatch = {};
    if (["activo", "aprobado"].includes(estadoAfter) && !after.fecha_vencimiento
        && vigencia.aplicaVencimiento(after)) {
      const meses = vigencia.parseDuracionMeses(after.duracion);
      if (meses) {
        const inicioInfo = vigencia.mejorFechaInicio(after);
        const inicio = inicioInfo.fecha || new Date();
        const fv = vigencia.calcularVencimiento(inicio, meses);
        if (fv) {
          vigenciaPatch = {
            fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
            vencimiento_estado: vigencia.estadoVencimiento(fv, new Date()),
            vigencia: {
              fecha_inicio: admin.firestore.Timestamp.fromDate(inicio),
              duracion_meses: meses,
              fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
              fuente_inicio: inicioInfo.fuente || "activacion",
              estampado_por: "onContratoActivado",
            },
          };
        }
      } else if (vigencia.codigoTipo(after) === "REEMP") {
        // REEMP sin duración propia: HEREDA la vigencia del contrato de origen
        // (decisión 2026-08-26) — el reemplazo cabalga sobre el período que ya
        // corre. Requiere el linaje (contrato_origen_ids).
        const origenIds = Array.isArray(after.contrato_origen_ids) && after.contrato_origen_ids.length
          ? after.contrato_origen_ids
          : (after.contrato_origen_id ? [after.contrato_origen_id] : []);
        if (origenIds.length) {
          try {
            const oSnap = await db.collection("contratos").doc(origenIds[0]).get();
            const o = oSnap.exists ? oSnap.data() : null;
            if (o?.fecha_vencimiento) {
              vigenciaPatch = {
                fecha_vencimiento: o.fecha_vencimiento,
                vencimiento_estado: vigencia.estadoVencimiento(o.fecha_vencimiento, new Date()),
                vigencia: {
                  fecha_inicio: o.vigencia?.fecha_inicio || null,
                  duracion_meses: o.vigencia?.duracion_meses || null,
                  fecha_vencimiento: o.fecha_vencimiento,
                  fuente_inicio: "heredada_de_origen",
                  origen_contrato_doc_id: origenIds[0],
                  estampado_por: "onContratoActivado",
                },
              };
            }
          } catch (e) {
            logger.warn("[vigencia] no se pudo heredar la vigencia del origen", { contratoId, origen: origenIds[0], message: e.message });
          }
        } else {
          logger.info("[vigencia] REEMP sin duración ni origen — sin vencimiento hasta amarrar el linaje", { contratoId });
        }
      } else {
        // Sin duración parseable no hay señal — no es error: contratos viejos
        // con texto libre quedan fuera hasta que alguien fije la duración.
        logger.info("[vigencia] duración no parseable, contrato sin vencimiento", { contratoId, duracion: after.duracion || null });
      }
    }

    // Verificación ANTES que el contrato (2026-09-02): la marca
    // verificacion_ok solo puede existir si la verificación quedó escrita. En
    // el orden viejo (contrato → correo → verificación) un fallo a mitad
    // dejaba needsRepair encendido para siempre y este bloque completo corría
    // en CADA escritura posterior del contrato.
    let aprobNombre = "—";
    let aprobEmail  = "—";
    let aprobRol    = "—";

    if (aprobadoPor && aprobadoPor !== "desconocido") {
      try {
        const aprSnap = await admin.firestore().collection("usuarios").doc(aprobadoPor).get();
        if (aprSnap.exists) {
          const u = aprSnap.data() || {};
          aprobNombre = u.nombre || (u.email ? u.email.split("@")[0] : "—");
          aprobEmail  = u.email  || "—";
          aprobRol    = u.cargo  || u.rol || "Administrador";
        }
      } catch (e) {
        console.warn("[onContratoActivado] No se pudo leer usuarios/", aprobadoPor, e.message);
      }
    }

    await verificRef.set({
      contrato_id: contratoId,
      cliente_nombre: after.cliente_nombre || null,
      total_con_itbms: (typeof after.total_con_itbms === "number" ? after.total_con_itbms : (after.total ?? null)),
      aprobado_por_uid: aprobadoPor,
      fecha_aprobacion: after.fecha_aprobacion || admin.firestore.FieldValue.serverTimestamp(),
      firma_codigo: codigoCorto,
      firma_hash: hmac,
      firma_url: firmaUrl,
      estado: estadoAfter,
      aprobado_por_nombre: aprobNombre,
      aprobado_por_email:  aprobEmail,
      aprobado_por_rol:    aprobRol,
      creado_en: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await afterSnap.ref.set({
      firma_codigo: codigoCorto,
      firma_hash: hmac,
      firma_url: firmaUrl,
      verificacion_ok: true,
      ...vigenciaPatch,
      ...(transitionedToActivo || transitionedToAprobado || !after.fecha_aprobacion ? {
        fecha_aprobacion: admin.firestore.FieldValue.serverTimestamp(),
      } : {}),
    }, { merge: true });

    // ── Aviso de facturación a RECEPCIÓN al pasar a ACTIVO (2026-09-02) ──
    // El contrato ya es real: crear/actualizar en QuickBooks y POC. Si lleva
    // equipo por entregar, la facturación arranca en la fecha de ENTREGA (la
    // OS le llega a recepción por su flujo normal).
    if (transitionedToActivo) {
      const conEquipo = (after.equipos || []).some(e => Number(e.cantidad || 0) > 0)
        && !after.renovacion_sin_equipo;
      await G.avisoFacturacion({
        subject: `FACTURACIÓN: ${after.accion === "Renovación" ? "renovación" : "contrato"} ACTIVO — ${after.cliente_nombre || "Cliente"} (${after.contrato_id || contratoId})`,
        titulo: `${after.accion === "Renovación" ? "Renovación activa" : "Contrato activo"} — alta de facturación y servicio`,
        cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            El contrato <b>${escapeHtml(after.contrato_id || contratoId)}</b>
            (${escapeHtml(after.tipo_contrato || "—")} · ${escapeHtml(after.duracion || "—")}) de
            <b>${escapeHtml(after.cliente_nombre || "—")}</b> quedó <b>activo</b>${after.firmado_tipo === "digital" ? " con firma digital" : ""}.
            ${conEquipo && after.entrega_confirmada !== true
              ? "Lleva equipo por entregar: <b>la facturación arranca en la fecha de entrega</b> (la orden de servicio te llegará por el flujo normal)."
              : "<b>La facturación arranca de una vez</b> — no hay entrega pendiente."}</p>
          ${G.detalleAumentoHtml({ lineas: after.equipos || [], cargos: after.cargos || [],
            totales: { total_mensual: after.total_mensual, cargos_uni: after.cargos_unico, primer_pago: after.primer_pago } })}`,
        cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
        responsable_uid: after.creado_por_uid || null,
        ctaUrl: `${APP_BASE_URL}/contratos/documento.html?id=${encodeURIComponent(contratoId)}`,
        ctaLabel: "Ver el documento del contrato",
        meta: { source: "onContratoActivado_facturacion", contrato_id: after.contrato_id || contratoId },
      });
    }

    return null;
  }
);

// Al aprobar un contrato, en vez de mandar el correo a activaciones de una vez,
// se pide a INVENTARIO que asigne los seriales primero. Si el contrato no tiene
// unidades serializables (p.ej. renovación sin equipo), se auto-completa la
// señal de seriales para que el correo a activaciones salga igual (sin seriales).
const onContratoAprobadoSolicitaSeriales = onDocumentUpdated(
  { document: "contratos/{docId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!before || !after) return null;

    const pasoAAprobado = (before.estado !== "aprobado" && after.estado === "aprobado");
    if (!pasoAAprobado) return null;

    // ── Correo AL VENDEDOR (2026-09-02, pregunta de Alberto: "¿le llega un
    // email al vendedor para que busque la firma?" — no llegaba: solo iba de
    // CC en la tarea de bodega, y en renovación sin equipo no salía NADA).
    // Su siguiente acción es la firma del cliente: CTA directo a la ficha.
    try {
      const vend = await vendedorEmail(after.creado_por_uid);
      if (vend) {
        const filas = [
          ...(after.equipos || []).filter(e => Number(e.cantidad || 0) > 0).map(e =>
            `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;">${escapeHtml(e.modelo || "—")}${e.modalidad === "propio" ? " — equipo del cliente" : ""}</td>
             <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(e.cantidad || 0)}</td>
             <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(e.precio || 0).toFixed(2)}/mes</td></tr>`),
          ...(after.cargos || []).map(cg =>
            `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;">${escapeHtml(cg.concepto || "—")}</td>
             <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(cg.cantidad || 1)}</td>
             <td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(cg.monto || 0).toFixed(2)}${cg.recurrente ? "/mes" : ""}</td></tr>`),
        ].join("");
        await db.collection("mail_queue").add({
          to: vend,
          subject: `Contrato ${after.contrato_id || event.params.docId} APROBADO — sigue la firma del cliente`,
          preheader: "Envíale el enlace de firma digital desde la ficha del cliente",
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Tu contrato fue aprobado</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              El contrato <b>${escapeHtml(after.contrato_id || "")}</b> de
              <b>${escapeHtml(after.cliente_nombre || "—")}</b> quedó <b>aprobado</b>.
              El siguiente paso es tuyo: desde la ficha del cliente, usa
              <b>Enviar para firma</b> — el cliente lee el contrato completo en su celular y firma
              con el dedo. Bodega prepara los seriales en paralelo.</p>
            <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
              <thead><tr><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #e5e7eb;">Detalle</th>
                <th style="text-align:center;padding:5px 8px;border-bottom:2px solid #e5e7eb;">Cant.</th>
                <th style="text-align:right;padding:5px 8px;border-bottom:2px solid #e5e7eb;">Precio</th></tr></thead>
              <tbody>${filas}</tbody></table>
            <p style="margin:8px 0 0;font:14px Arial,sans-serif;">Total mensual: <b>$${Number(after.total_mensual || 0).toFixed(2)}</b></p>`,
          ctaUrl: `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(after.cliente_id || "")}`,
          ctaLabel: "Abrir la ficha y enviar para firma",
          meta: { source: "onContratoAprobado_vendedor", contrato_id: after.contrato_id || "" },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info("[onContratoAprobadoSolicitaSeriales] correo al vendedor (firma) encolado",
          { contrato: after.contrato_id, vendedor: vend });
      } else {
        logger.info("[onContratoAprobadoSolicitaSeriales] vendedor sin email — sin aviso de firma",
          { contrato: after.contrato_id, uid: after.creado_por_uid || null });
      }
    } catch (e) {
      logger.warn("[onContratoAprobadoSolicitaSeriales] correo al vendedor falló", { message: e.message });
    }

    // Idempotencia: si el flujo de seriales ya arrancó, no repetir.
    if (after.seriales_estado) return null;

    const docId       = event.params.docId;
    const contratoRef = event.data.after.ref;
    const unidades    = unidadesSerializables(after);

    // Renovación sin equipo: las líneas de equipos son renglones de alquiler
    // (cantidad > 0) pero NO se entrega equipo físico — no hay seriales que
    // asignar. Pedirlos a inventario solo confunde a bodega y deja el contrato
    // trabado sin llegar nunca a activaciones (caso Silverking ALQ20260713-04).
    const esRenovSinEquipo = after.accion === "Renovación" && !!after.renovacion_sin_equipo;

    // Sin equipos que serializar → completa la señal y deja que el trigger de
    // activaciones envíe el correo (sin seriales, con la modalidad de renovación).
    if (unidades <= 0 || esRenovSinEquipo) {
      await contratoRef.collection("seriales_estado").doc("current").set({
        estado: "asignados",
        omisiones: [],
        por: "system",
        at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("[onContratoAprobadoSolicitaSeriales] Sin seriales que pedir — directo a activaciones", {
        contratoId: after.contrato_id || docId, unidades, esRenovSinEquipo
      });
      return null;
    }

    // Marca pendiente (para el botón de la lista) y solicita seriales a inventario.
    await contratoRef.set({ seriales_estado: "pendiente" }, { merge: true });

    const equiposRows = (after.equipos || [])
      .filter(e => Number(e.cantidad || 0) > 0)
      .map(e => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(e.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${Number(e.cantidad || 0)}</td></tr>`)
      .join("");

    const bodyContent = `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Solicitud de seriales</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        El contrato <b>${escapeHtml(after.contrato_id || docId)}</b> de
        <b>${escapeHtml(after.cliente_nombre || "—")}</b> fue aprobado. Asigna los
        seriales de los siguientes equipos para continuar el proceso.
      </p>
      <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
          <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Cantidad</th>
        </tr></thead>
        <tbody>${equiposRows}</tbody>
      </table>`;

    const to = await inventarioEmailTo();
    const cc = await vendedorEmail(after.creado_por_uid); // visibilidad al vendedor
    await db.collection("mail_queue").add({
      to,
      ...(cc ? { cc } : {}), // Firestore no admite undefined; se omite si no hay vendedor
      subject:     `Solicitud de seriales: ${after.contrato_id || docId} – ${after.cliente_nombre || ""}`,
      preheader:   `Asigna los seriales del contrato ${after.contrato_id || docId}`,
      bodyContent,
      // Bodega asigna desde Almacén · Asignar (2026-09-03): el enlace cae en
      // la pestaña con el contrato ya abierto.
      ctaUrl:      `${APP_BASE_URL}/almacen/index.html?tab=asignar&contrato=${encodeURIComponent(docId)}`,
      ctaLabel:    "Asignar seriales",
      meta:        { source: "onContratoAprobadoSolicitaSeriales", contrato_id: after.contrato_id || docId },
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("[onContratoAprobadoSolicitaSeriales] Solicitud de seriales encolada", {
      contratoId: after.contrato_id || docId, unidades
    });
    return null;
  }
);

const onSerialesAsignadasSendPdf = onDocumentWritten(
  {
    document: "contratos/{cid}/seriales_estado/{sid}",
    // Puppeteer + @sparticuz/chromium requieren memoria generosa para
    // que el bootstrap del binario de Chrome quepa sin caer en el
    // timeout interno de 30s para el WebSocket endpoint. Con 1 GiB
    // estaba fallando en cold starts (PROP20260604-01 — 2026-06-04).
    memory: "2GiB",
    timeoutSeconds: 180,
    secrets: [
      "FIRMA_SECRET",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return null; // borrado de la señal — nada que hacer

    // Solo en la transición de la señal de seriales a "asignados".
    const justAsignado = after.estado === "asignados" && before?.estado !== "asignados";
    if (!justAsignado) return null;

    const cid = event.params.cid;
    const contratoRef = db.collection("contratos").doc(cid);

    // Backstop del corte legacy: si el contrato es histórico, no participa del
    // nuevo flujo — no espejar ni reenviar a activaciones (por si alguien llega
    // por link directo a seriales.html de un contrato viejo). Ver backfill
    // `marcarSerialesLegacy` y el guard en contrato-seriales-page.js.
    try {
      const cSnap = await contratoRef.get();
      const cData = cSnap.exists ? (cSnap.data() || {}) : {};
      if (cData.seriales_estado === "legacy") {
        logger.info("[onSerialesAsignadasSendPdf] Contrato legacy — omitido (sin correo a activaciones)", { cid });
        return null;
      }
      // Idempotencia: los triggers de Firestore son at-least-once. Si ya se envió
      // el PDF a activaciones para este contrato, no reenviar en una re-entrega
      // del evento (ni al re-editar seriales, que es admin-only y no debe reenviar).
      if (cData.seriales_pdf_enviado_at) {
        logger.info("[onSerialesAsignadasSendPdf] PDF ya enviado antes — se omite reenvío", { cid });
        return null;
      }
    } catch (e) {
      logger.warn("[onSerialesAsignadasSendPdf] No se pudo verificar estado legacy/idempotencia", { cid, message: e.message });
    }

    const omisiones = Array.isArray(after.omisiones) ? after.omisiones : [];

    logger.info("[onSerialesAsignadasSendPdf] Seriales asignados", { cid, omisiones: omisiones.length });

    // Espeja el estado al documento del contrato (para el botón de la lista).
    try {
      await contratoRef.set({
        seriales_estado:         "asignados",
        seriales_omitidos_count: omisiones.length,
        seriales_asignados_at:   admin.firestore.FieldValue.serverTimestamp(),
        seriales_asignados_por:  after.por || null,
      }, { merge: true });
    } catch (e) {
      logger.warn("[onSerialesAsignadasSendPdf] No se pudo espejar seriales_estado", { cid, message: e.message });
    }

    // Captura el contexto del envío para que el catch externo pueda
    // registrarlo en mail_queue (visibilidad en admin/salud) si algo
    // falla — antes solo quedaba en CF logs.
    let mailContext = { source: "onSerialesAsignadasSendPdf" };

    try {
      const contratoSnap = await contratoRef.get();
      if (!contratoSnap.exists) {
        logger.warn("[onSerialesAsignadasSendPdf] Contrato no existe", { cid });
        return null;
      }
      const contrato = contratoSnap.data();

      let vendedorInfo = { nombre: "Vendedor", cargo: "Vendedor", email: "" };
      if (contrato.creado_por_uid) {
        const vendSnap = await db.collection("usuarios").doc(contrato.creado_por_uid).get();
        if (vendSnap.exists) {
          const u = vendSnap.data();
          vendedorInfo = {
            nombre: u.nombre || vendedorInfo.nombre,
            cargo:  u.cargo  || (u.rol || vendedorInfo.cargo),
            email:  u.email  || ""
          };
        }
      }

      let aprobadorInfo = {};
      try {
        aprobadorInfo = await attachVerificationFromMirror(contrato, cid);
      } catch (e) {
        if (e.code === "VERIF_NOT_FOUND") {
          logger.warn("[onSerialesAsignadasSendPdf] Verificación no disponible; generando PDF sin firma interna.", {
            contratoId: contrato.contrato_id
          });
          aprobadorInfo = { nombre: "", cargo: "", email: "" };
        } else {
          throw e;
        }
      }

      const htmlForPdf = buildContractHtmlForPdf(contrato, vendedorInfo, aprobadorInfo);
      const chromium   = require("@sparticuz/chromium");
      const browser    = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      let pdfBuffer;
      try {
        const page = await browser.newPage();
        await page.setContent(htmlForPdf, { waitUntil: "networkidle0" });
        pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "10mm", bottom: "12mm", left: "10mm", right: "10mm" }
        });
      } finally {
        // Cierra Chromium aunque falle setContent/pdf; si no, la instancia
        // caliente acumula procesos de 1-2 GiB y termina en OOM.
        await browser.close();
      }

      const equiposHtml = (contrato.equipos || []).map(e =>
        `<li>${e.modelo || "—"} – ${Number(e.cantidad||0)} × $${Number(e.precio || 0).toFixed(2)}</li>`
      ).join("");

      // Seriales asignados (subcolección) agrupados por modelo.
      const serialesSnap = await contratoRef.collection("seriales").get();
      const serialesPorModelo = {};
      serialesSnap.forEach(d => {
        const s = d.data() || {};
        const serial = String(s.serial || "").trim();
        if (!serial) return;
        const m = s.modelo || "—";
        (serialesPorModelo[m] = serialesPorModelo[m] || []).push(serial);
      });
      const serialesRows = Object.keys(serialesPorModelo).sort().map(m =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(m)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;">${serialesPorModelo[m].map(escapeHtml).join("<br>")}</td></tr>`
      ).join("");
      const serialesTable = serialesRows
        ? `<h4 style="margin:16px 0 8px;font:600 16px Arial,sans-serif;">Seriales asignados</h4>
           <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:0 0 16px;">
             <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th></tr></thead>
             <tbody>${serialesRows}</tbody></table>`
        : "";

      // Equipos que inventario marcó SIN serial (override manual) + motivo.
      const omisionesRows = omisiones.map(o =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(o.modelo || "—")}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(o.motivo || "—")}</td></tr>`
      ).join("");
      const omisionesTable = omisionesRows
        ? `<h4 style="margin:16px 0 8px;font:600 16px Arial,sans-serif;color:#92400e;">Equipos sin serial</h4>
           <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:0 0 16px;">
             <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Motivo</th></tr></thead>
             <tbody>${omisionesRows}</tbody></table>`
        : "";

      const total    = Number((contrato.total_con_itbms ?? contrato.total) || 0);
      const preheader = `Contrato ${contrato.contrato_id} – seriales asignados (${contrato.cliente_nombre})`;
      const renovacionHighlightHtml = contrato.accion === "Renovación"
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? "RENOVACIÓN SIN EQUIPO" : "RENOVACIÓN CON EQUIPO"}</div>`
        : "";
      const aplicaRefurbished  = (contrato.accion === "Renovación")
        && (contrato.renovacion_sin_equipo || contrato.renovacion_refurbished_componentes);
      const refurbishedIncluido = !!contrato.renovacion_refurbished_componentes;
      const refurbishedHighlightHtml = aplicaRefurbished
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid ${refurbishedIncluido ? "#0f766e" : "#b91c1c"};border-radius:10px;background:${refurbishedIncluido ? "#f0fdfa" : "#fef2f2"};font:700 15px Arial,sans-serif;color:${refurbishedIncluido ? "#115e59" : "#991b1b"};">Refurbished batería, antena, clip y piezas: ${refurbishedIncluido ? "INCLUIDO" : "NO INCLUIDO"}</div>`
        : "";

      const bodyHtml = `
        <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#111827;">Contrato aprobado</h2>
        <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
          El contrato <b>${contrato.contrato_id}</b> ha sido aprobado.
        </p>
        ${renovacionHighlightHtml}
        ${refurbishedHighlightHtml}
        <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.cliente_nombre || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Elaborador del contrato</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${vendedorInfo?.nombre || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.tipo_contrato || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.accion || "—"}</td></tr>
          ${contrato.accion === "Renovación" ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? "Sin equipo" : "Con equipo"}</td></tr>` : ""}
          ${aplicaRefurbished ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Refurbished batería/antena/clip/piezas</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;color:${refurbishedIncluido ? "#115e59" : "#991b1b"};font-weight:700;">${refurbishedIncluido ? "Sí" : "No"}</td></tr>` : ""}
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${(contrato.observaciones || "—").replace(/[<>&]/g, s => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[s]))}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">$${total.toFixed(2)}</td></tr>
        </table>
        ${equiposHtml ? `<h4 style="margin:0 0 8px; font:600 16px Arial, sans-serif;">Equipos</h4><ul style="margin:0 0 16px; padding-left:18px; font:14px/1.5 Arial, sans-serif;">${equiposHtml}</ul>` : ""}
        ${serialesTable}
        ${omisionesTable}
      `;

      // Enlace por DOC ID, no por número: el número es mutable y no fue único
      // hasta el 2026-07-28 — un correo viejo con ALQ20260723-01 hoy abre el
      // contrato de otro cliente. El doc ID nunca cambia.
      const contratoUrl = `https://app.cecomunica.net/contratos/imprimir-contrato.html?id=${encodeURIComponent(cid)}`;
      const htmlEmail   = buildEmailFromBase({
        preheader,
        bodyHtml,
        ctaUrl:   contratoUrl,
        ctaLabel: "Ver contrato"
      });

      mailContext = {
        ...mailContext,
        to:      await activacionesEmailTo(),
        // CC: vendedor + copias del panel (empresa/config.mail_cc_contrato_aprobado)
        cc:      [vendedorInfo?.email, ...(await ccContratoAprobado())].filter(Boolean).join(",") || undefined,
        subject: `Contrato APROBADO: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
      };

      await sendEmail({
        to:      mailContext.to,
        cc:      mailContext.cc,
        subject: mailContext.subject,
        html: htmlEmail,
        attachments: [{
          filename:    `${contrato.contrato_id || "contrato"}.pdf`,
          content:     pdfBuffer,
          contentType: "application/pdf"
        }]
      });

      logger.info("[onSerialesAsignadasSendPdf] Correo enviado con PDF", {
        contratoId: contrato.contrato_id,
        cliente:    contrato.cliente_nombre
      });

      // Marca de idempotencia: bloquea reenvíos ante re-entregas del trigger.
      // Best-effort — si esta escritura falla, una re-entrega podría reenviar
      // (ventana estrecha aceptada), pero el correo ya salió correctamente.
      await contratoRef.set({
        seriales_pdf_enviado_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      logger.error("[onSerialesAsignadasSendPdf] Error en proceso", { message: err.message, stack: err.stack });
      // Registra el fallo en mail_queue para que aparezca en admin/salud.
      // Best-effort: si Firestore también está caído, el log de CF ya queda.
      await recordSendFailure(mailContext, err);
    }

    return null;
  }
);


// onContratoActivadoSendPdf (envío al APROBAR) fue retirada 2026-07-17: llevaba
// deshabilitada desde que onSerialesAsignadasSendPdf asumió el envío post-seriales.
// Al desplegar functions, aceptar el borrado del CF huérfano cuando el deploy lo pregunte.
module.exports = {
  onContratoActivado,
  onContratoAprobadoSolicitaSeriales,
  onSerialesAsignadasSendPdf,
};

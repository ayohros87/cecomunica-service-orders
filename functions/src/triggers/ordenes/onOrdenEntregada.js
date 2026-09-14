const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");

// Lo que cuelga de una ENTREGA. Tres cosas, en este mismo trigger para no
// sumar un séptimo onDocumentWritten sobre ordenes_de_servicio:
//
//   1) Entrega COMPLETA → propaga la señal al contrato (readiness de
//      facturación): estampa `entrega_confirmada` + `fecha_entrega_ultima`.
//      NO activa facturación — solo registra la señal para que el módulo
//      calcule readiness sin leer subcolecciones. La activación es una acción
//      explícita aparte (callable gestionarFacturacion).
//   2) Entrega PARCIAL → encola la copia de la nota de tanda al cliente,
//      cuando la UI la pidió (entrega.tandas[].envio.status === 'solicitado').
//      Mismo circuito que el acuse de devolución: reclamar en transacción,
//      encolar, y que onMailQueued espeje el resultado real del SMTP.
//   3) Entrega COMPLETA con cotización de taller → abre la fila en
//      "Facturación pendiente" para que Recepción emita la factura y el
//      taller se entere cuando salga (2026-09-14, pedido de Solangel).
const ENTREGADO = "ENTREGADO AL CLIENTE";
// "El trabajo SALIÓ" — el momento en que una reparación cotizada se puede
// facturar. No es un solo estado: una reparación de taller termina cuando el
// radio se entrega, pero una VISITA TÉCNICA cierra EN SITIO y nunca pasa por
// "ENTREGADO AL CLIENTE" (ver lib/visitas: el técnico cierra con el informe
// delante del cliente). Sin esta segunda puerta, las cotizaciones de visita
// —3 de las 5 que existen hoy— no llegarían nunca a facturarse.
// ENTRADA y DEVOLUCIÓN quedan FUERA a propósito: recibir equipo no es trabajo
// facturable; la reparación que salga de ahí abre su propia orden.
const CERRADA_VISITA = "CERRADA (VISITA)";
const TRABAJO_SALIO = [ENTREGADO, CERRADA_VISITA];
const norm = (s) => String(s || "").trim().toUpperCase();
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
const { emailNotaTanda, numeroDeTanda } = require("../../lib/notaTandaEntrega");
const CS = require("../../lib/cotizacionServicio");

// ── Copia de la nota de entrega parcial al cliente ────────────────────────
// La UI marca entrega.tandas[].envio = {status:'solicitado', to} y aquí se
// reclama la solicitud antes de encolar: si dos instancias procesan la misma
// escritura, solo una gana la transición y solo esa manda el correo. El
// reclamo se hace por `numero` ({ordenId}-E{n}), que es único dentro de la
// orden y estable — el array es append-only.
async function procesarEnviosTandas(ordenId, after) {
  const tandas = (after.entrega || {}).tandas || [];
  const solicitados = tandas.filter(t =>
    t && t.envio && t.envio.status === "solicitado");
  if (!solicitados.length) return;

  const ref = db.collection("ordenes_de_servicio").doc(ordenId);
  for (const t of solicitados) {
    const numero = numeroDeTanda(ordenId, tandas, t);
    const to = String(t.envio.to || "").trim().toLowerCase();
    const valido = isEmail(to);
    const mailRef = db.collection("mail_queue").doc();
    try {
      const claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const arr = ((snap.data().entrega || {}).tandas || []).map(x => ({ ...x }));
        const i = arr.findIndex(x => x && numeroDeTanda(ordenId, arr, x) === numero);
        if (i < 0 || !arr[i].envio || arr[i].envio.status !== "solicitado") return null;
        arr[i].envio = valido
          ? { ...arr[i].envio, to, status: "encolado", mail_id: mailRef.id,
              at: admin.firestore.Timestamp.now(), error: null }
          : { ...arr[i].envio, status: "fallo",
              at: admin.firestore.Timestamp.now(),
              error: "El correo del destinatario no es válido" };
        // update() con ruta de puntos, no set(merge): `entrega` es un mapa y
        // un merge podría dejarlo a medias (regla de la casa).
        tx.update(ref, { "entrega.tandas": arr });
        return valido ? arr[i] : null;
      });
      if (!claim) {
        if (!valido) logger.warn("[onOrdenEntregada] tanda con correo inválido", { ordenId, numero, to });
        continue;
      }
      const payload = emailNotaTanda(ordenId, after, claim);
      await mailRef.set({
        to,
        subject: payload.subject,
        preheader: payload.preheader,
        bodyContent: payload.bodyContent,
        meta: {
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          source: "entrega-parcial",
          orden_id: ordenId,
          tanda_numero: numero,
        },
        status: "queued",
      });
      logger.info("[onOrdenEntregada] Nota de tanda encolada para el cliente", { ordenId, numero, to, mailId: mailRef.id });
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo encolar la nota de tanda (no crítico)", { ordenId, numero, error: e.message });
    }
  }
}

// ── La cotización de taller entra a "Facturación pendiente" ───────────────
// Una reparación se factura cuando el radio SALE, no cuando se cotiza: si la
// fila naciera al enviar la cotización, la bandeja de Recepción se llenaría de
// trabajos que el cliente todavía no aprobó (decisión de Alberto 2026-09-14).
//
// Idempotente por partida doble: el id del aviso es determinista
// (`cotizacion_servicio__<docId>`, ver FA.avisoId) y además se estampa
// `facturacion.aviso_id` en la cotización, que es lo que hace que una
// re-entrega no vuelva a encolar el correo.
async function abrirFacturacionDeCotizaciones(ordenId, after) {
  const snap = await db.collection("cotizaciones").where("orden_id", "==", ordenId).get();
  const cots = snap.docs.filter((d) => CS.esFacturable(d.data()));
  if (!cots.length) return;

  const G = require("../../lib/gestiones");
  const FA = require("../../lib/facturacionAvisos");
  const esc = G.escapeHtml;
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  // El día en que salió el trabajo: la entrega en taller, o el cierre en sitio
  // de una visita (`fecha_cierre_visita`). Es la fecha con la que la bandeja
  // cuenta los días de antigüedad de la fila.
  const salida = after.fecha_entrega || after.fecha_cierre_visita || after.fecha_completado || null;
  const fechaEntrega = salida?.toDate ? salida.toDate() : new Date();
  // Una visita cerró EN SITIO; una reparación se entregó en el taller. El
  // correo lo dice como ocurrió: "ya se entregó" sobre una visita técnica
  // suena a que alguien llevó algo, y Recepción pierde el hilo de qué cobrar.
  const esVisita = norm(after.tipo_de_servicio) === "VISITA TECNICA"
    || norm(after.estado_reparacion) === CERRADA_VISITA;
  const salioTxt = esVisita ? "la visita ya se cerró en sitio" : "el equipo ya se entregó";
  const tituloTxt = esVisita ? "Visita cerrada — hay que facturarla" : "Reparación entregada — hay que facturarla";
  const asuntoTxt = esVisita ? "visita cerrada" : "reparación entregada";

  for (const d of cots) {
    const cot = d.data();
    const legible = cot.cotizacion_id || d.id;
    if (cot.facturacion?.aviso_id) {
      logger.info("[onOrdenEntregada] La cotización ya tiene fila de facturación", { ordenId, cotizacion: legible });
      continue;
    }
    const r = CS.resumenCotizacion(cot);
    const rs = CS.renglones(cot);
    const filas = rs.map((x) => `
      <tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${x.cant}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(x.nombre)}${x.parte ? ` <span style="font-family:monospace;color:#6b7280;">${esc(x.parte)}</span>` : ""}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${money(x.importe)}</td></tr>`).join("");

    await G.avisoFacturacion({
      subject: `FACTURAR: ${asuntoTxt} — ${cot.cliente_nombre || "Cliente"} (${legible})`,
      titulo: tituloTxt,
      cuerpo: `
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          En la orden <b>${esc(ordenId)}</b> de <b>${esc(cot.cliente_nombre || "—")}</b>, ${salioTxt}.
          La cotización <b>${esc(legible)}</b> que se le envió al cliente queda
          <b>pendiente de facturar</b>.</p>
        ${filas ? `<table role="presentation" width="100%" style="border-collapse:collapse;font:13px Arial,sans-serif;margin:8px 0;">
          <thead><tr>
            <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #e5e7eb;">Cant.</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #e5e7eb;">Concepto</th>
            <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #e5e7eb;">Importe</th>
          </tr></thead><tbody>${filas}</tbody></table>` : ""}
        <p style="margin:8px 0 0;font:14px Arial,sans-serif;">
          Total a facturar: <b>${money(r.total)}</b>${r.exento ? " (exento de ITBMS)"
            : ` · subtotal ${money(r.subtotal)} + ITBMS ${money(r.itbms)}`}</p>
        <p style="margin:10px 0 0;font:13px/1.5 Arial,sans-serif;color:#40525f;">
          Al marcar <b>QBO</b> con el número de factura, ${esc(cot.creado_por_email || "el taller")}
          recibe el aviso de que ya quedó facturada.</p>`,
      cliente_id: cot.clienteId || null,
      cliente_nombre: cot.cliente_nombre || "",
      responsable_uid: cot.creado_por_uid || null,
      responsable_email: cot.creado_por_email || null,
      ctaUrl: `${APP_BASE_URL}/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(d.id)}`,
      ctaLabel: "Ver la cotización",
      meta: { source: "onOrdenEntregada", orden_id: ordenId, cotizacion_id: legible, paso: "facturar_cotizacion" },
      aviso: {
        tipo: "cotizacion_servicio",
        origen_col: "cotizaciones", origen_id: d.id,
        orden_id: ordenId,
        fecha_efectiva: fechaEntrega,
        esperando: false,
        contexto: {
          cotizacion_id: legible,
          cotizacion_doc_id: d.id,
          cotizado_por: cot.creado_por_email || null,
          orden: ordenId,
          es_visita: esVisita,
          origen_texto: `${esVisita ? "Visita cerrada" : "Reparación entregada"} · cotización ${legible}`,
        },
        resumen: r,
        detalle: { renglones: rs },
      },
    });
    // El puntero en la cotización es lo que pinta el chip "Por facturar" en el
    // listado — el control que Solangel llevaba a mano.
    await d.ref.set({
      facturacion: {
        aviso_id: FA.avisoId("cotizacion_servicio", d.id),
        estado: "pendiente",
        abierta_at: admin.firestore.FieldValue.serverTimestamp(),
        factura: null, facturada_at: null, facturada_por: null,
      },
    }, { merge: true });
    logger.info("[onOrdenEntregada] Cotización de taller enviada a facturar", { ordenId, cotizacion: legible });
  }
}

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after) return null;

    // Copias de notas de entrega parcial pedidas por la UI. Va ANTES del corte
    // de abajo a propósito: una tanda ocurre mientras la orden sigue en
    // COMPLETADO, así que si esperáramos a la transición a ENTREGADO el correo
    // no saldría nunca. Best-effort — un fallo aquí no frena la propagación
    // al contrato.
    try {
      await procesarEnviosTandas(event.params.ordenId, after);
    } catch (e) {
      logger.warn("[onOrdenEntregada] Envíos de tandas fallaron (no crítico)", {
        ordenId: event.params.ordenId, message: e.message,
      });
    }

    const antes = norm(before?.estado_reparacion);
    const ahora = norm(after.estado_reparacion);

    // La facturación de una cotización de taller se abre cuando el trabajo
    // SALIÓ, que es una puerta más ancha que la entrega: una visita técnica
    // cierra en sitio. Va antes del corte de abajo y antes del corte por
    // contrato — una reparación cotizada se factura exista o no un contrato de
    // alquiler detrás (las de taller casi nunca lo tienen). Best-effort y en
    // su propio try: el trabajo ya salió y no se puede deshacer; se registra
    // fuerte porque un fallo implica una factura que nadie va a emitir.
    if (!TRABAJO_SALIO.includes(antes) && TRABAJO_SALIO.includes(ahora)) {
      try {
        await abrirFacturacionDeCotizaciones(event.params.ordenId, after);
      } catch (e) {
        logger.error("[onOrdenEntregada] Cotización de taller NO enviada a facturar", {
          ordenId: event.params.ordenId, error: e.message,
        });
      }
    }

    // De aquí abajo, solo la TRANSICIÓN a ENTREGADO (no en cada escritura ya
    // entregada): la señal que el CONTRATO espera es la entrega de equipos,
    // que una visita técnica no produce.
    if (antes === ENTREGADO || ahora !== ENTREGADO) return null;

    const contrato = after.contrato || {};
    if (!contrato.aplica || !contrato.contrato_doc_id) return null; // orden sin contrato

    const contratoDocId = contrato.contrato_doc_id;
    try {
      await db.collection("contratos").doc(contratoDocId).set({
        entrega_confirmada: true,
        fecha_entrega_ultima: after.fecha_entrega || admin.firestore.FieldValue.serverTimestamp(),
        facturacion_entrega_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("[onOrdenEntregada] Entrega propagada al contrato", {
        ordenId: event.params.ordenId, contratoDocId,
      });
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo propagar la entrega", {
        contratoDocId, message: e.message,
      });
    }
    return null;
  }
);

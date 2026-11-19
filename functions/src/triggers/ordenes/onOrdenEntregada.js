const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

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
//   4) Entrega con el CONTRATO SIN FIRMAR (2026-11-11, pedido de Brenda) →
//      marca el contrato con `entrega_sin_firma`. No lo firma ni lo activa:
//      es lo que pinta "Entregado · firma pendiente" y lo que el cron
//      (recordatorioOperativo, sección L) le recuerda al vendedor cada día.
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
const { esperandoFirma } = require("../../domain/contratoFirma");

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
  // La reposición por daño (cotización con `gestion_id`) NO se abre aquí: se
  // factura cuando el cliente la ACEPTA, y hasta entonces bodega ni siquiera
  // asigna el radio que la sustituye. Si la orden del radio dañado se entrega
  // antes de que el cliente conteste, facturarla sería cobrar algo que el
  // cliente no aceptó.
  const cots = snap.docs.filter((d) => CS.esFacturable(d.data()) && !CS.gestionesDe(d.data()).length);
  if (!cots.length) return;
  // Una sola implementación para las dos puertas (entrega y aceptación):
  // lib/facturacionCotizacion. Idempotente — si la cotización ya se pasó a
  // facturar con el clic de "El cliente aceptó", aquí no pasa nada.
  const { abrirFacturacionCotizacion } = require("../../lib/facturacionCotizacion");
  for (const d of cots) {
    await abrirFacturacionCotizacion(d, { momento: "entrega", orden: after });
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

    // ¿Salieron radios con el contrato todavía sin firmar? Pasa por la puerta
    // de recepción ("Entregar con la firma del contrato pendiente", que deja
    // `entrega_contrato_sin_firma` en la orden) o por el override de admin; la
    // marca se decide mirando el CONTRATO, así que cubre las dos. Se estampa
    // una sola vez (la primera entrega) y va ANTES del corte de la orden
    // dividida: el vendedor tiene que enterarse con la primera hermana que
    // sale, no con la última. Reemplazo/demo no llevan firma y un aumento
    // cuelga de un contrato ya activo: `esperandoFirma` los deja pasar.
    let marcaSinFirma = null;
    try {
      const cSnap = await db.collection("contratos").doc(contrato.contrato_doc_id).get();
      const c = cSnap.exists ? cSnap.data() : null;
      if (c && c.deleted !== true && !c.entrega_sin_firma && esperandoFirma(c)) {
        const d = after.entrega_contrato_sin_firma || {};
        marcaSinFirma = {
          orden_id: event.params.ordenId,
          fecha_entrega: after.fecha_entrega || admin.firestore.FieldValue.serverTimestamp(),
          via: d.via || null,
          por_email: d.por_email || after.entrega_por_email || null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo leer el contrato para la marca de firma pendiente", {
        ordenId: event.params.ordenId, message: e.message,
      });
    }

    // Orden DIVIDIDA (Brenda, 2026-10-13): el contrato se da por entregado
    // con la ÚLTIMA hermana, no con la primera — si no, facturación recibiría
    // "contrato entregado" con la mitad de los radios todavía en el taller.
    // Ver domain/ordenDividida.js. Best-effort: si la familia no se puede
    // leer, se sigue como si no estuviera dividida (el comportamiento de
    // siempre), que es preferible a dejar un contrato sin señal de entrega.
    try {
      const { hermanasPendientes } = require("../../lib/ordenDividida");
      const { pendientes } = await hermanasPendientes(event.params.ordenId, after);
      if (pendientes.length) {
        if (marcaSinFirma) {
          await db.collection("contratos").doc(contrato.contrato_doc_id)
            .set({ entrega_sin_firma: marcaSinFirma }, { merge: true });
        }
        logger.info("[onOrdenEntregada] Entrega de una orden dividida: el contrato espera a las hermanas", {
          ordenId: event.params.ordenId, contratoDocId: contrato.contrato_doc_id, pendientes,
        });
        return null;
      }
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo leer la familia de la orden dividida", {
        ordenId: event.params.ordenId, message: e.message,
      });
    }

    const contratoDocId = contrato.contrato_doc_id;
    try {
      await db.collection("contratos").doc(contratoDocId).set({
        entrega_confirmada: true,
        fecha_entrega_ultima: after.fecha_entrega || admin.firestore.FieldValue.serverTimestamp(),
        facturacion_entrega_at: admin.firestore.FieldValue.serverTimestamp(),
        // Qué entregó: onEntregaFacturacion no abre "contrato entregado"
        // cuando lo que salió fue un aumento (ese ya tiene su aviso).
        entrega_gestion_id: after.gestion?.id || null,
        entrega_gestion_tipo: after.gestion?.tipo || null,
        ...(marcaSinFirma ? { entrega_sin_firma: marcaSinFirma } : {}),
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

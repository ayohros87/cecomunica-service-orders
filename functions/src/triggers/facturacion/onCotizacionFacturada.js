// La factura le contesta al taller — 2026-09-14, pedido de Solangel.
//
// EL HUECO QUE CIERRA
//   El taller cotiza la reparación, la envía y ahí se queda sin saber nada:
//   quien factura es Recepción, en QuickBooks, fuera del sistema. Solangel
//   llevaba a mano la lista de "cuáles ya se facturaron y cuáles no" porque
//   nadie le avisaba. Este trigger cierra el círculo: cuando Recepción marca
//   el paso QBO de una fila `cotizacion_servicio`, el correo sale solo hacia
//   quien elaboró la cotización, con el número de factura.
//
// DOS MOMENTOS, PORQUE EL NÚMERO PUEDE LLEGAR DESPUÉS
//   El número de factura NO es obligatorio al marcar el paso — trancar a
//   Recepción por un dato que a veces no tiene a mano rompe la bandeja que sí
//   usan. Por eso hay dos avisos: el de "ya se facturó" (con o sin número) y,
//   si el número se anota más tarde con anotarFactura(), uno corto que lo
//   agrega. Cada uno con su propio candado.
//
// CANDADO ANTES DEL EFECTO: el `correo_*_at` se reserva en una transacción
// ANTES de encolar el correo, no después. Un reintento del mismo evento pierde
// la carrera y no manda un segundo correo. Escribir esa marca vuelve a
// disparar este trigger, pero el guard de transición de arriba corta la
// re-entrada porque `pasos.qbo` no cambió (ver memoria: eco de triggers).

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const G = require("../../lib/gestiones");

const esc = G.escapeHtml;
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtFecha = (d) => {
  const x = d?.toDate ? d.toDate() : (d ? new Date(d) : null);
  return x && !isNaN(x) ? x.toLocaleDateString("es-PA", { day: "2-digit", month: "long", year: "numeric" }) : null;
};

/**
 * Reserva el candado. Devuelve true solo para quien lo gana.
 */
async function reservar(ref, campo) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()[campo]) return false;
    tx.update(ref, { [campo]: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
}

module.exports = onDocumentUpdated(
  { document: "facturacion_avisos/{avisoId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    if (after.tipo !== "cotizacion_servicio") return null;

    const qb = before.pasos?.qbo || {};
    const qa = after.pasos?.qbo  || {};
    const reciénFacturada = !qb.hecho && qa.hecho === true;
    const númeroAnotado   = qb.hecho === true && qa.hecho === true && !qb.factura && !!qa.factura;
    const deshecho        = qb.hecho === true && qa.hecho !== true;

    const avisoId = event.params.avisoId;
    const ref = event.data.after.ref;

    // Recepción deshizo el paso (se facturó por error, o hay que rehacerla).
    // Se sueltan los candados para que el próximo marcado SÍ vuelva a avisar,
    // y la cotización regresa a "por facturar": si el chip se quedara en
    // "Facturada", el control de Solangel mentiría.
    if (deshecho) {
      const cotId = after.contexto?.cotizacion_doc_id || after.origen?.id || null;
      try {
        await ref.update({
          correo_facturada_at: admin.firestore.FieldValue.delete(),
          correo_numero_at: admin.firestore.FieldValue.delete(),
        });
        if (cotId) {
          await db.collection("cotizaciones").doc(cotId).set({
            facturacion: { estado: "pendiente", factura: null, facturada_at: null, facturada_por: null },
          }, { merge: true });
        }
        logger.info("[onCotizacionFacturada] Paso deshecho: la cotización vuelve a por facturar", { avisoId, cotId });
      } catch (e) {
        logger.warn("[onCotizacionFacturada] No se pudo revertir el estado de facturación", { avisoId, error: e.message });
      }
      return null;
    }

    if (!reciénFacturada && !númeroAnotado) return null;
    const c = after.contexto || {};
    const r = after.resumen || {};
    const legible = c.cotizacion_id || avisoId;
    const cotDocId = c.cotizacion_doc_id || after.origen?.id || null;

    // Destinatario: quien elaboró la cotización. Sin él, el jefe de taller
    // (empresa/config.email_taller o el rol) — el aviso no se pierde.
    let to = String(c.cotizado_por || "").trim().toLowerCase();
    if (!to || to.endsWith("@sin.email.cecomunica.com")) {
      to = await require("../../lib/mailRecipients").tallerEmailTo();
    }
    if (!to) {
      logger.warn("[onCotizacionFacturada] sin destinatario: no se avisa", { avisoId, cotizacion: legible });
      return null;
    }

    const campo = reciénFacturada ? "correo_facturada_at" : "correo_numero_at";
    if (!(await reservar(ref, campo))) {
      logger.info("[onCotizacionFacturada] candado ya reservado: no se repite el correo", { avisoId, campo });
      return null;
    }

    const cuando = fmtFecha(qa.at) || fmtFecha(new Date());
    const quien = qa.por_email || "—";
    const numTxt = qa.factura
      ? `<p style="margin:0 0 4px;font:14px Arial,sans-serif;">Factura N.° <b>${esc(qa.factura)}</b></p>`
      : `<p style="margin:0 0 4px;font:14px Arial,sans-serif;color:#92400e;">Todavía <b>sin número de factura</b> anotado — llegará en cuanto se registre.</p>`;

    try {
      const mailId = await G.encolarCorreo({
        to,
        cc: after.vendedor_email || null,
        subject: reciénFacturada
          ? `FACTURADA: ${legible} — ${after.cliente_nombre || "Cliente"}${qa.factura ? ` · Factura ${qa.factura}` : ""}`
          : `Factura ${qa.factura} — ${legible} · ${after.cliente_nombre || "Cliente"}`,
        preheader: reciénFacturada
          ? "La reparación cotizada ya se facturó"
          : "Se anotó el número de factura de la cotización",
        bodyContent: reciénFacturada ? `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">La cotización ya se facturó</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            La cotización <b>${esc(legible)}</b> de <b>${esc(after.cliente_nombre || "—")}</b>
            ${c.orden ? `(orden <b>${esc(c.orden)}</b>) ` : ""}quedó facturada
            ${cuando ? `el <b>${esc(cuando)}</b> ` : ""}por ${esc(quien)}.</p>
          ${numTxt}
          <p style="margin:0 0 4px;font:14px Arial,sans-serif;">Monto cotizado: <b>${money(r.total)}</b></p>
          <p style="margin:12px 0 0;font:13px/1.5 Arial,sans-serif;color:#40525f;">
            En el listado de cotizaciones esta ya aparece como <b>Facturada</b>.</p>` : `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Número de factura de ${esc(legible)}</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            La cotización <b>${esc(legible)}</b> de <b>${esc(after.cliente_nombre || "—")}</b> se facturó con la
            <b>factura N.° ${esc(qa.factura)}</b>${quien !== "—" ? ` (anotada por ${esc(quien)})` : ""}.</p>
          <p style="margin:0 0 4px;font:14px Arial,sans-serif;">Monto cotizado: <b>${money(r.total)}</b></p>`,
        ctaUrl: cotDocId
          ? `${APP_BASE_URL}/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(cotDocId)}`
          : `${APP_BASE_URL}/facturacion/bandeja.html?aviso=${encodeURIComponent(avisoId)}`,
        ctaLabel: cotDocId ? "Ver la cotización" : "Abrir en Facturación pendiente",
        meta: {
          source: "onCotizacionFacturada", aviso_id: avisoId,
          cotizacion_id: legible, orden_id: after.orden_id || null,
          paso: reciénFacturada ? "cotizacion_facturada" : "cotizacion_numero_factura",
        },
      });
      logger.info("[onCotizacionFacturada] Aviso de factura encolado", { avisoId, cotizacion: legible, to, mailId });
    } catch (e) {
      logger.error("[onCotizacionFacturada] El aviso de factura no salió", { avisoId, error: e.message });
    }

    // El espejo en la cotización es lo que pinta el chip del listado. Va
    // después del correo y en su propio try: si falla, el aviso ya se mandó y
    // la bandeja sigue siendo la fuente de verdad.
    if (cotDocId) {
      try {
        await db.collection("cotizaciones").doc(cotDocId).set({
          facturacion: {
            aviso_id: avisoId,
            estado: "facturada",
            factura: qa.factura || null,
            facturada_at: qa.at || admin.firestore.FieldValue.serverTimestamp(),
            facturada_por: qa.por_email || null,
          },
        }, { merge: true });
      } catch (e) {
        logger.warn("[onCotizacionFacturada] La cotización no quedó marcada como facturada", {
          cotDocId, error: e.message,
        });
      }
    }
    return null;
  }
);

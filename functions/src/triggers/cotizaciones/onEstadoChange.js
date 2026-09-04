// Candado de materiales del taller: cuando una cotización nacida de una orden
// (origen='orden') se ENVÍA o APRUEBA, la orden se marca cotizacion_emitida →
// el modal de materiales (ordenes-equipos) y el flujo de consumos quedan
// bloqueados para que lo cotizado no diverja de lo registrado. Si la
// cotización se RECHAZA o VENCE, el candado se reabre (equivale al viejo
// "desbloquear cotización" de trabajar-orden, eliminada en b4cefac).
// Server-side y con dueño único porque el estado cambia por varios caminos:
// aprobación por deep-link, edición, y el scheduled markCotizacionesVencidas.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { db } = require("../../lib/admin");
const { bodegaEmailTo } = require("../../lib/mailRecipients");
const { APP_BASE_URL } = require("../../lib/inventario");

const ESTADOS_BLOQUEAN = ["enviada", "aprobada"];
const ESTADOS_REABREN  = ["rechazada", "vencida"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

/**
 * Resumen de piezas usadas en la orden, agregado por pieza.
 *
 * La fuente es la subcolección `consumos` de la orden — lo que el técnico
 * registró como usado — y NO los renglones de la cotización: al cliente solo se
 * le cobran los consumos de tipo 'cobro', pero bodega tiene que reponer también
 * lo que salió por garantía. Ese era justo el hueco: las piezas de garantía no
 * aparecían en ningún papel que llegara a bodega.
 */
async function resumenPiezasDeOrden(ordenId) {
  const snap = await db.collection("ordenes_de_servicio").doc(ordenId)
    .collection("consumos").get();

  const porPieza = new Map();
  snap.forEach((d) => {
    const c = d.data() || {};
    const qty = Number(c.qty || 0);
    if (!(qty > 0)) return;
    // Clave: el id de catálogo si lo hay; si no, sku o nombre. Una pieza fuera
    // de catálogo (escrita a mano) sigue contando — bodega igual la repone.
    const key = String(c.pieza_id || c.sku || c.pieza_nombre || "").trim().toLowerCase();
    if (!key) return;
    if (!porPieza.has(key)) {
      porPieza.set(key, {
        nombre: c.pieza_nombre || c.sku || "(sin nombre)",
        sku: c.sku || "",
        // Escrita a mano por el técnico porque el catálogo no la tiene
        // (ordenes-equipos: modo "fuera de catálogo"). Bodega la ve señalada
        // para cargarla a inventario_piezas, además de reponerla.
        fuera_catalogo: c.fuera_catalogo === true,
        total: 0, cobro: 0, garantia: 0,
      });
    }
    const p = porPieza.get(key);
    if (c.fuera_catalogo === true) p.fuera_catalogo = true;
    p.total += qty;
    if (String(c.tipo || "") === "garantia") p.garantia += qty;
    else p.cobro += qty;
  });

  return [...porPieza.values()].sort((a, b) => b.total - a.total);
}

/**
 * Encola el resumen interno de piezas para bodega. Se envía UNA sola vez por
 * cotización (`resumen_bodega_at`): el estado cruza a 'enviada' y después a
 * 'aprobada', y sin la marca bodega recibiría el mismo conteo dos veces.
 */
async function enviarResumenABodega(docId, cot) {
  const ordenId = String(cot.orden_id);
  const piezas = await resumenPiezasDeOrden(ordenId);
  if (!piezas.length) {
    logger.info("[onCotizacionEstadoChange] sin consumos: no se envía resumen", { ordenId });
    return false;
  }

  const to = await bodegaEmailTo();
  if (!to) {
    logger.warn("[onCotizacionEstadoChange] sin buzón de bodega configurado", { ordenId });
    return false;
  }

  const totalUnidades = piezas.reduce((n, p) => n + p.total, 0);
  const fueraCat = piezas.filter((p) => p.fuera_catalogo);
  const tagFc = `<span style="display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:#fef3c7;color:#92400e;font:600 11px Arial,sans-serif;">fuera de catálogo</span>`;
  const filas = piezas.map((p) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(p.nombre)}${p.fuera_catalogo ? tagFc : ""}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${esc(p.sku || "—")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;"><b>${p.total}</b></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${p.cobro || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${p.garantia || "—"}</td>
    </tr>`).join("");

  await db.collection("mail_queue").add({
    to,
    subject: `Piezas usadas — Orden ${ordenId} (${totalUnidades} unidad(es))`,
    preheader: `${piezas.length} tipo(s) de pieza para reponer, sin esperar al técnico`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Piezas usadas en la orden ${esc(ordenId)}</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La cotización <b>${esc(cot.cotizacion_id || docId)}</b> de esta orden ya salió,
        así que el consumo de piezas está cerrado. Este es el conteo total para
        reponer o ajustar inventario.
      </p>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#374151;">
        <b>Cliente:</b> ${esc(cot.cliente_nombre || "—")}
      </p>
      <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Pieza</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">SKU</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Total</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Cobradas</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Garantía</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <p style="margin:10px 0 0;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
        Las de <b>garantía</b> no se le cobran al cliente, pero salieron de bodega igual.
      </p>
      ${fueraCat.length ? `
      <div style="margin:14px 0 0;padding:10px 12px;border-left:3px solid #B45309;background:#FFFBEB;font:13px/1.5 Arial,sans-serif;">
        <b>${fueraCat.length} pieza(s) fuera de catálogo.</b> El técnico las escribió a mano porque
        no existen en Piezas y tarifas, así que no descontaron stock. Hay que cargarlas al
        catálogo (nombre, número de parte y precio) para que la próxima vez se elijan de la lista:
        <ul style="margin:6px 0 0;padding-left:18px;">
          ${fueraCat.map((p) => `<li>${esc(p.nombre)}${p.sku ? ` <span style="font-family:monospace;">(${esc(p.sku)})</span>` : ""} — ${p.total} unidad(es)</li>`).join("")}
        </ul>
      </div>` : ""}`,
    ctaUrl: `${APP_BASE_URL}/ordenes/editar-orden.html?id=${encodeURIComponent(ordenId)}`,
    ctaLabel: "Ver la orden",
    meta: { source: "onCotizacionEstadoChange", seccion: "piezas_a_bodega", ordenId, tipos: piezas.length, unidades: totalUnidades, fuera_catalogo: fueraCat.length },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return true;
}

module.exports = onDocumentUpdated(
  {
    document: "cotizaciones/{docId}",
    region: "us-central1",
  },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};

    if ((after.origen || "") !== "orden" || !after.orden_id) return null;

    const estadoAntes   = String(before.estado || "");
    const estadoDespues = String(after.estado  || "");
    if (estadoAntes === estadoDespues) return null;

    let emitida = null;
    if (ESTADOS_BLOQUEAN.includes(estadoDespues)) emitida = true;
    else if (ESTADOS_REABREN.includes(estadoDespues)) emitida = false;
    if (emitida === null) return null; // borrador/convertida no tocan el candado

    try {
      await db.collection("ordenes_de_servicio").doc(String(after.orden_id)).set(
        { cotizacion_emitida: emitida },
        { merge: true }
      );
      logger.info("[onCotizacionEstadoChange] candado actualizado", {
        ordenId: after.orden_id,
        cotizacionId: event.params.docId,
        estado: estadoDespues,
        emitida,
      });
    } catch (e) {
      logger.error("[onCotizacionEstadoChange] error actualizando la orden", {
        message: e.message,
        ordenId: after.orden_id,
        cotizacionId: event.params.docId,
      });
    }

    // Resumen interno de piezas a bodega, en el mismo momento en que se cierra
    // el consumo de la orden. Antes bodega se enteraba cuando el técnico volvía
    // con el papel; ahora sale solo. Va en su propio try: si falla, el candado
    // de arriba —que es lo que protege la integridad de la orden— ya quedó.
    if (emitida === true && !after.resumen_bodega_at) {
      try {
        const enviado = await enviarResumenABodega(event.params.docId, after);
        if (enviado) {
          // La marca evita el duplicado en borrador→enviada→aprobada. Escribir
          // aquí no recursa: el guard `estadoAntes === estadoDespues` de arriba
          // corta la re-entrada porque este update no toca `estado`.
          await event.data.after.ref.set(
            { resumen_bodega_at: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      } catch (e) {
        logger.error("[onCotizacionEstadoChange] resumen a bodega falló", {
          message: e.message,
          ordenId: after.orden_id,
          cotizacionId: event.params.docId,
        });
      }
    }
    return null;
  }
);

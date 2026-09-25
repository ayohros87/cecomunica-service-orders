// La cotización de taller entra a "Facturación pendiente".
//
// DOS PUERTAS, UNA FILA (2026-09-25). Hasta hoy la fila de Brenda nacía SOLO
// cuando el trabajo salía (entrega de la orden o cierre de la visita,
// triggers/ordenes/onOrdenEntregada). Solangel pidió poder pasarla a facturar
// con un clic apenas el cliente acepta, y Alberto decidió que la fila se abre
// en ese momento aunque el radio siga en el taller: Recepción decide si cobra
// por adelantado o al retirar, y para eso la fila dice dónde está el equipo.
//
// Las dos puertas llaman a esta misma función. Es idempotente por partida
// doble: el id del aviso es determinista (`cotizacion_servicio__<docId>`) y la
// cotización queda con `facturacion.aviso_id`, que es lo que hace que la
// segunda puerta —la entrega, que casi siempre llega después— no vuelva a
// abrir nada ni a mandar un segundo correo.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const CS = require("./cotizacionServicio");

const norm = (s) => String(s || "").trim().toUpperCase();
const TRABAJO_SALIO = ["ENTREGADO AL CLIENTE", "CERRADA (VISITA)"];

const MEDIOS = {
  correo: "por correo",
  verbal: "verbalmente",
  pagina: "desde el enlace de la cotización",
  otro: "por otro medio",
};

/**
 * Abre la fila de facturación de UNA cotización de taller.
 *
 * @param {FirebaseFirestore.DocumentSnapshot|{id,ref,data}} d  la cotización
 * @param {object} opts
 * @param {'entrega'|'aceptacion'} opts.momento  qué puerta la abre
 * @param {object} [opts.orden]  la orden ya leída (si no, se lee)
 * @returns {Promise<boolean>} true si abrió la fila; false si ya la tenía
 */
async function abrirFacturacionCotizacion(d, { momento = "entrega", orden = null } = {}) {
  const cot = typeof d.data === "function" ? d.data() : d.data;
  const legible = cot.cotizacion_id || d.id;
  if (cot.facturacion?.aviso_id) {
    logger.info("[facturacionCotizacion] La cotización ya tiene fila de facturación", { cotizacion: legible, momento });
    return false;
  }
  const ordenId = String(cot.orden_id || "");
  let o = orden;
  if (!o && ordenId) {
    const snap = await db.collection("ordenes_de_servicio").doc(ordenId).get().catch(() => null);
    o = snap?.exists ? snap.data() : {};
  }
  o = o || {};

  const G = require("./gestiones");
  const FA = require("./facturacionAvisos");
  const esc = G.escapeHtml;
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  const esVisita = norm(o.tipo_de_servicio) === "VISITA TECNICA"
    || norm(o.estado_reparacion) === "CERRADA (VISITA)";
  // ¿El trabajo ya salió? En la puerta de la aceptación casi nunca: el radio
  // sigue en el taller. La fila lo dice para que Recepción no busque una
  // entrega que todavía no pasó.
  const salio = TRABAJO_SALIO.includes(norm(o.estado_reparacion));
  const esReposicion = !!cot.gestion_id;

  let tituloTxt, asuntoTxt, queTxt, origenTxt, fechaEfectiva;
  if (momento === "aceptacion") {
    const ac = cot.aceptacion || {};
    const como = MEDIOS[ac.medio] || "";
    fechaEfectiva = ac.at?.toDate ? ac.at.toDate() : new Date();
    if (esReposicion) {
      tituloTxt = "Reposición por daño aceptada — hay que facturarla";
      asuntoTxt = "reposición por daño aceptada";
      queTxt = `el cliente aceptó ${como ? `(${esc(como)}) ` : ""}pagar la <b>reposición del radio que dañó</b>. Bodega ya recibió el aviso para asignar el equipo que lo sustituye`;
      origenTxt = `Reposición por daño aceptada · cotización ${legible}`;
    } else {
      tituloTxt = "Cotización de taller aceptada — hay que facturarla";
      asuntoTxt = "cotización de taller aceptada";
      queTxt = `el cliente aceptó la cotización ${como ? `${esc(como)} ` : ""}y el taller la pasó a facturar. `
        + (salio ? (esVisita ? "La visita ya se cerró en sitio." : "El equipo ya se entregó.")
          : "<b>El equipo sigue en el taller</b>: decide si se factura ya o al retirarlo");
      origenTxt = `Aceptada por el cliente · ${salio ? "trabajo entregado" : "equipo en el taller"} · cotización ${legible}`;
    }
  } else {
    const salida = o.fecha_entrega || o.fecha_cierre_visita || o.fecha_completado || null;
    fechaEfectiva = salida?.toDate ? salida.toDate() : new Date();
    tituloTxt = esVisita ? "Visita cerrada — hay que facturarla" : "Reparación entregada — hay que facturarla";
    asuntoTxt = esVisita ? "visita cerrada" : "reparación entregada";
    queTxt = esVisita ? "la visita ya se cerró en sitio" : "el equipo ya se entregó";
    origenTxt = `${esVisita ? "Visita cerrada" : "Reparación entregada"} · cotización ${legible}`;
  }
  const nota = momento === "aceptacion" && cot.aceptacion?.nota
    ? `<p style="margin:8px 0 0;font:13px/1.5 Arial,sans-serif;color:#40525f;">Nota de la aceptación: ${esc(cot.aceptacion.nota)}</p>` : "";

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
        En la orden <b>${esc(ordenId || "—")}</b> de <b>${esc(cot.cliente_nombre || "—")}</b>, ${queTxt}.
        La cotización <b>${esc(legible)}</b> queda <b>pendiente de facturar</b>.</p>
      ${nota}
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
    meta: {
      source: momento === "aceptacion" ? "onCotizacionEstadoChange" : "onOrdenEntregada",
      orden_id: ordenId, cotizacion_id: legible, paso: "facturar_cotizacion",
    },
    aviso: {
      tipo: "cotizacion_servicio",
      origen_col: "cotizaciones", origen_id: d.id,
      orden_id: ordenId || null,
      fecha_efectiva: fechaEfectiva,
      esperando: false,
      contexto: {
        cotizacion_id: legible,
        cotizacion_doc_id: d.id,
        cotizado_por: cot.creado_por_email || null,
        orden: ordenId || null,
        es_visita: esVisita,
        momento,
        // Dónde está el equipo al abrirse la fila: la pregunta que Recepción
        // se hace antes de facturar una reparación que todavía no se retira.
        equipo_en_taller: momento === "aceptacion" && !salio && !esReposicion,
        ...(momento === "aceptacion" ? {
          aceptacion_medio: cot.aceptacion?.medio || null,
          aceptacion_nota: cot.aceptacion?.nota || null,
        } : {}),
        ...(esReposicion ? { gestion_id: cot.gestion_id, reposicion_dano: true } : {}),
        origen_texto: origenTxt,
      },
      resumen: r,
      detalle: { renglones: rs },
    },
  });
  // El puntero en la cotización es lo que pinta el chip "Por facturar" en el
  // listado — el control que Solangel llevaba a mano.
  const ref = d.ref || db.collection("cotizaciones").doc(d.id);
  await ref.set({
    facturacion: {
      aviso_id: FA.avisoId("cotizacion_servicio", d.id),
      estado: "pendiente",
      momento,
      abierta_at: admin.firestore.FieldValue.serverTimestamp(),
      factura: null, facturada_at: null, facturada_por: null,
    },
  }, { merge: true });
  logger.info("[facturacionCotizacion] Cotización de taller enviada a facturar", { ordenId, cotizacion: legible, momento });
  return true;
}

module.exports = { abrirFacturacionCotizacion, TRABAJO_SALIO, MEDIOS };

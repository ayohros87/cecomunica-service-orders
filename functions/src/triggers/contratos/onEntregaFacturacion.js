// La ENTREGA le avisa a facturación — F1 de docs/plans/PLAN_COMISIONES.md.
//
// EL HUECO QUE CIERRA
//   onApproval crea el aviso de facturación con `esperando: true` cuando el
//   contrato queda activo pero lleva equipo por entregar, y el correo que sale
//   dice, con todas sus letras: "la facturación arranca en la fecha de entrega
//   (te avisaremos cuando se entregue)". Ese aviso NO EXISTÍA. Al entregarse,
//   onOrdenEntregada estampaba `entrega_confirmada` en el contrato y nadie más
//   se enteraba: la fila se quedaba en "Espera" para siempre en la bandeja de
//   Recepción, así que nadie iba a facturarlo (la app no factura sola: la
//   emisión es manual en QuickBooks).
//
// LO QUE HACE
//   Al pasar `entrega_confirmada` de falso a true:
//     1. PROMUEVE el aviso que ya está esperando (no crea uno nuevo — sería
//        contar dos veces el mismo hecho, y en comisiones eso es pagar dos
//        veces). Si no hay ninguno esperando (contrato anterior al 2026-09-04),
//        crea el `contrato_entregado` con id determinista.
//     2. Manda el correo prometido, con CTA a la fila de la bandeja.
//
// Idempotente por los dos lados: la promoción solo mueve avisos 'esperando' y
// crearAviso usa id determinista.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { APP_BASE_URL } = require("../../lib/inventario");
const G = require("../../lib/gestiones");
const FA = require("../../lib/facturacionAvisos");

const esc = G.escapeHtml;
const fmt = (d) => {
  const x = d?.toDate ? d.toDate() : (d ? new Date(d) : null);
  return x && !isNaN(x) ? x.toLocaleDateString("es-PA", { day: "2-digit", month: "long", year: "numeric" }) : null;
};

module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    if (before.entrega_confirmada === true || after.entrega_confirmada !== true) return null;
    if (after.deleted === true) return null;

    const cid = event.params.cid;
    const legible = after.contrato_id || cid;
    const fechaEntrega = after.fecha_entrega_ultima?.toDate ? after.fecha_entrega_ultima.toDate() : new Date();
    const cuando = fmt(after.fecha_entrega_ultima) || fmt(fechaEntrega);
    const m = FA.mensualDeContrato(after);
    const montoTxt = `Total mensual: <b>$${m.mensual.toFixed(2)}</b>${m.exento
      ? " (exento de ITBMS)" : ` · $${m.con_itbms.toFixed(2)} con ITBMS`}${m.unico > 0
      ? ` · Cargos únicos: <b>$${m.unico.toFixed(2)}</b>` : ""}`;

    try {
      const promovido = await FA.promoverPorEntrega(cid, {
        fechaEntrega,
        detalle: `Equipos entregados${cuando ? ` el ${cuando}` : ""} — ya se puede facturar`,
      });

      // Ya había aviso y NO estaba esperando: reintento del mismo evento, o un
      // contrato que arrancó a facturar sin esperar la entrega. No se crea
      // nada — crear aquí sería el doble conteo que este trigger existe para
      // no cometer.
      if (promovido && !promovido.promovido) {
        logger.info("[onEntregaFacturacion] El contrato ya tenía aviso: nada que promover", { cid, avisoId: promovido.id });
        return null;
      }

      // Camino normal: el aviso ya existía esperando. Se movió; ahora hay que
      // cumplir la promesa del correo de activación.
      if (promovido) {
        const to = await require("../../lib/mailRecipients").activacionesEmailTo();
        const cc = await G.vendedorEmailDeCliente(after.cliente_id);
        await G.encolarCorreo({
          to, cc: cc || null,
          subject: `FACTURACIÓN: equipos ENTREGADOS — ${after.cliente_nombre || "Cliente"} (${legible})`,
          preheader: "Ya se puede facturar este contrato",
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Equipos entregados — ya se puede facturar</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Los equipos del contrato <b>${esc(legible)}</b> de <b>${esc(after.cliente_nombre || "—")}</b>
              ya se entregaron${cuando ? ` el <b>${esc(cuando)}</b>` : ""}. Cuando este contrato se activó te
              avisamos que <b>la facturación arrancaba en la fecha de entrega</b>: es hoy.</p>
            ${G.detalleAumentoHtml({ lineas: after.equipos || [], cargos: after.cargos || [] })}
            <p style="margin:8px 0 0;font:14px Arial,sans-serif;">${montoTxt}</p>`,
          ctaUrl: `${APP_BASE_URL}/facturacion/bandeja.html?aviso=${encodeURIComponent(promovido.id)}`,
          ctaLabel: "Abrir en Facturación pendiente",
          meta: { source: "onEntregaFacturacion", contrato_id: legible, aviso_id: promovido.id, paso: "facturacion_entrega" },
        });
        logger.info("[onEntregaFacturacion] Aviso promovido por entrega", { cid, avisoId: promovido.id });
        return null;
      }

      // No había aviso esperando. Puede ser un contrato anterior a la colección
      // (2026-09-04) o uno que ya arrancó a facturar sin esperar entrega — en
      // ese segundo caso NO hay nada que avisar, así que se exige que el
      // contrato estuviera realmente esperando equipo.
      const conEquipo = (after.equipos || []).some((e) => Number(e.cantidad || 0) > 0);
      const esRenov = after.accion === "Renovación";
      if (!conEquipo || esRenov || after.renovacion_sin_equipo) return null;

      await G.avisoFacturacion({
        subject: `FACTURACIÓN: equipos ENTREGADOS — ${after.cliente_nombre || "Cliente"} (${legible})`,
        titulo: "Equipos entregados — ya se puede facturar",
        cuerpo: `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Los equipos del contrato <b>${esc(legible)}</b> de <b>${esc(after.cliente_nombre || "—")}</b>
            ya se entregaron${cuando ? ` el <b>${esc(cuando)}</b>` : ""}.</p>
          ${G.detalleAumentoHtml({ lineas: after.equipos || [], cargos: after.cargos || [] })}
          <p style="margin:8px 0 0;font:14px Arial,sans-serif;">${montoTxt}</p>`,
        cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
        responsable_uid: after.creado_por_uid || null,
        ctaUrl: `${APP_BASE_URL}/contratos/documento.html?id=${encodeURIComponent(cid)}`,
        ctaLabel: "Ver el documento del contrato",
        meta: { source: "onEntregaFacturacion", contrato_id: legible, paso: "facturacion_entrega" },
        aviso: {
          tipo: "contrato_entregado",
          origen_col: "contratos", origen_id: cid,
          contrato_id: legible, contrato_doc_id: cid,
          fecha_efectiva: fechaEntrega,
          esperando: false,
          contexto: {
            entrega_pendiente: false,
            tipo_contrato: after.tipo_contrato || null,
            duracion: after.duracion || null,
            origen_texto: `Equipos entregados${cuando ? ` el ${cuando}` : ""}`,
          },
          resumen: {
            equipos: FA.equiposTexto(after.equipos), equipos_n: m.equipos_n,
            mensual: m.mensual, con_itbms: m.con_itbms, exento: m.exento, unico: m.unico,
            delta_mensual: m.mensual,
          },
          detalle: { lineas: after.equipos || [], cargos: after.cargos || [] },
        },
      });
      logger.info("[onEntregaFacturacion] Aviso contrato_entregado creado", { cid });
    } catch (e) {
      // No crítico: la entrega ya quedó estampada en el contrato. Se registra
      // fuerte porque implica una factura que nadie va a emitir.
      logger.error("[onEntregaFacturacion] Aviso de entrega NO generado", { cid, error: e.message });
    }
    return null;
  }
);

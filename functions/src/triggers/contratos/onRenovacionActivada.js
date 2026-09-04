// Regularización automática de la cuenta al activarse una RENOVACIÓN (Ola 7,
// decisión de Alberto 2026-08-28: "el proceso debe ser fácil" — el vendedor
// renueva y la cuenta amanece regularizada sola).
//
// Dispara sobre contratos/{cid} cuando una RENOVACIÓN recibe su señal de
// entrega (`entrega_confirmada` false→true, la estampa onOrdenEntregada al
// entregarse la OS) — o, si es RENOVACIÓN SIN EQUIPO (nada que entregar: los
// radios siguen con el cliente), cuando pasa a 'activo': ahí este trigger
// estampa él mismo la entrega, y esa escritura re-dispara el flujo completo
// (onEntregaPool, onEntregaTransicion con el plan "continúa", y este trigger
// de nuevo — ya con el flip real).
//
// Qué hace con el flip: toma la CUSTODIA del cliente (unidades en_cliente SIN
// contrato — la deuda histórica que el barrido 2026-08-28 dejó medida y con
// vigencia) y la amarra a las líneas del contrato nuevo hasta el cupo de cada
// modelo (lib/regularizacion.planAmarre, pura y testeada). El amarre es una
// fila en contratos/{cid}/seriales: onSerialWrite hace el resto (pool →
// asignación, en_cliente se conserva porque la entrega ya está confirmada).
// Lo que no quepa o no tenga línea queda REPORTADO en `regularizacion` del
// contrato — nunca silencio. El documento impreso no se toca (los seriales
// jamás se infieren en el papel).
//
// Idempotente: `regularizacion.at` en el contrato corta re-ejecuciones.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { planAmarre } = require("../../lib/regularizacion");
const { serialesExcluidosPorPlan } = require("../../lib/planRenovacion");

const SOURCE = "regularizacion_renovacion";

module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    const cid = event.params.cid;
    if (after.deleted) return null;
    if (after.accion !== "Renovación") return null;
    if (after.regularizacion?.at) return null;   // ya corrió

    const entregaFlip = before.entrega_confirmada !== true && after.entrega_confirmada === true;
    const activoSinEquipo = before.estado !== "activo" && after.estado === "activo"
      && after.renovacion_sin_equipo === true && after.entrega_confirmada !== true;

    // Renovación sin equipo: no habrá entrega física — la activación ES la
    // señal. Se estampa la entrega y el write re-dispara la cadena completa.
    if (activoSinEquipo) {
      try {
        await event.data.after.ref.update({
          entrega_confirmada: true,
          entrega_confirmada_fuente: "renovacion_sin_equipo",
          fecha_entrega_ultima: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info("[onRenovacionActivada] Renovación sin equipo activada — entrega estampada", { cid });
      } catch (e) {
        logger.error("[onRenovacionActivada] No se pudo estampar la entrega", { cid, message: e.message });
      }
      return null;
    }
    if (!entregaFlip) return null;
    if (!after.cliente_id) return null;

    try {
      // Custodia del cliente: en_cliente sin contrato.
      const poolSnap = await db.collection("equipos_pool")
        .where("asignacion.cliente_id", "==", after.cliente_id)
        .where("estado", "==", "en_cliente")
        .get();
      // Lo que el vendedor declaró en el plan de la venta con destino distinto
      // de 'continúa' (se devuelve / no lo tiene) NO se amarra por cupo
      // (2026-09-04): la declaración explícita manda sobre el automatismo.
      const excluidos = serialesExcluidosPorPlan(after.transicion_plan);
      const custodia = poolSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => !u.asignacion?.contrato_doc_id)
        .filter((u) => !excluidos.has(u.serial_norm || pool.normSerial(u.serial || "")));

      const filasSnap = await event.data.after.ref.collection("seriales").get();
      const filas = filasSnap.docs.map((d) => {
        const x = d.data() || {};
        return { serial_norm: pool.normSerial(x.serial || ""), modelo_id: x.modelo_id || null, modelo: x.modelo || "" };
      });

      const plan = planAmarre(after, custodia, filas);

      for (const { unidad } of plan.asignar) {
        await event.data.after.ref.collection("seriales").add({
          serial: unidad.serial || unidad.id,
          modelo: unidad.modelo_label || "",
          modelo_id: unidad.modelo_id || null,
          contrato_doc_id: cid,
          contrato_id: after.contrato_id || "",
          cliente_id: after.cliente_id || "",
          cliente_nombre: after.cliente_nombre || "",
          source: SOURCE,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          created_by: `trigger:${SOURCE}`,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: `trigger:${SOURCE}`,
        });
      }

      const resumen = {
        at: admin.firestore.FieldValue.serverTimestamp(),
        amarradas: plan.asignar.length,
        custodia_total: custodia.length,
        sin_cupo: plan.sin_cupo.length,
        sin_cupo_seriales: plan.sin_cupo.slice(0, 25).map((u) => u.serial || u.id),
        sin_linea: plan.sin_linea.length,
        sin_linea_seriales: plan.sin_linea.slice(0, 25).map((u) => u.serial || u.id),
        por: `trigger:${SOURCE}`,
      };
      await event.data.after.ref.update({ regularizacion: resumen });
      logger.info("[onRenovacionActivada] Cuenta regularizada", {
        cid, contrato: after.contrato_id, cliente: after.cliente_nombre,
        amarradas: plan.asignar.length, sin_cupo: plan.sin_cupo.length, sin_linea: plan.sin_linea.length,
      });
    } catch (e) {
      logger.error("[onRenovacionActivada] Regularización falló (no crítico — la custodia queda como estaba)",
        { cid, message: e.message });
    }
    return null;
  }
);

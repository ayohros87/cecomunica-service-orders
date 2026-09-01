const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");

// Mantiene `seriales_count` en el contrato cuando cambia su subcolección de
// seriales. Con admin SDK (esquiva el guard touchesCFOwnedFields). El índice usa
// este conteo + las unidades activas para el estado del botón de seriales.
//
// Además sincroniza el POOL de equipos (equipos_pool) — "migración por
// contacto" del plan docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md:
//   · serial agregado/editado → upsert: la unidad pasa a asignado_contrato
//     (o en_cliente si el contrato ya tiene entrega confirmada / es legacy);
//     si no existe en el pool se crea con origen migracion_contrato y
//     verificado:false. Si está en_taller solo se actualiza la asignación.
//   · serial removido/reemplazado → la unidad vuelve a en_bodega marcada
//     verificado:false ("verificar físicamente": pudo ser typo o devolución).
//     Si su estado no admite la vuelta a bodega (en_taller por una orden viva,
//     vendido…) al menos se SUELTA la asignación: el estado es real, la
//     pertenencia al contrato ya no.
module.exports = onDocumentWritten(
  { document: "contratos/{cid}/seriales/{sid}", region: "us-central1" },
  async (event) => {
    const cid = event.params.cid;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;

    // 1) Recuento + set de seriales vigentes (post-escritura). El conteo es de
    //    seriales DISTINTOS por serial_norm (L7 2026-07-27): filas duplicadas
    //    de la misma unidad ya no inflan seriales_count (readiness de
    //    facturación). El set alimenta el guard de liberación de abajo.
    let normsVigentes = null; // Set<serial_norm> | null si la lectura falló
    try {
      const snap = await db.collection("contratos").doc(cid).collection("seriales").get();
      normsVigentes = new Set();
      let sinNorm = 0;
      snap.forEach((d) => {
        const s = d.data()?.serial;
        if (typeof s !== "string" || !s.trim()) return;
        const n = pool.normSerial(s);
        if (n) normsVigentes.add(n); else sinNorm++;
      });
      await db.collection("contratos").doc(cid).set({
        seriales_count: normsVigentes.size + sinNorm,
        seriales_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      logger.warn("[onSerialWrite] No se pudo contar seriales", { cid, message: e.message });
    }

    // 2) Sincronización del pool de equipos.
    try {
      const serialAntes   = (before?.serial || "").toString().trim();
      const serialDespues = (after?.serial  || "").toString().trim();
      const mismo = pool.normSerial(serialAntes) === pool.normSerial(serialDespues);

      let contrato = null;
      const getContrato = async () => {
        if (contrato === null) {
          const cSnap = await db.collection("contratos").doc(cid).get();
          contrato = cSnap.exists ? cSnap.data() : {};
        }
        return contrato;
      };

      // Serial removido o reemplazado → liberar la unidad vieja de ESTE contrato.
      // GUARD (L7 2026-07-27): si OTRA fila del contrato aún lista el mismo
      // serial (fila duplicada que se está deduplicando), NO se libera — la
      // unidad sigue contratada. Sin este guard, borrar el duplicado mandaba
      // la ficha a bodega con el contrato vigente. Si el snapshot de arriba
      // falló (normsVigentes null), se prefiere NO liberar: un residuo lo
      // reporta la conciliación semanal; una liberación errónea des-asigna.
      const normAntes = pool.normSerial(serialAntes);
      const sigueVigente = normsVigentes === null || (normAntes && normsVigentes.has(normAntes));
      if (serialAntes && (!after || !mismo) && !sigueVigente) {
        const refMovLib = { tipo: "contrato", id: cid, label: before.contrato_id || "" };
        const r = await pool.transicionar(serialAntes, before.modelo_id, before.modelo, {
          aEstado: pool.ESTADOS.EN_BODEGA,
          soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
          condicion: (d) => d.asignacion?.contrato_doc_id === cid,
          tipo: "liberacion",
          refMov: refMovLib,
          notas: "Serial removido del contrato — verificar físicamente (posible typo o devolución)",
          extra: { asignacion: null, verificado: false },
        });
        if (r === "transicion") {
          logger.info("[onSerialWrite] Pool: serial liberado", { cid, serial: serialAntes });
        } else {
          // No volvió a bodega porque su estado no lo permite: en_taller con una
          // orden viva, vendido, por_clasificar, o ya en bodega. El ESTADO es
          // real y no se toca — pero la ASIGNACIÓN sí es falsa: el serial ya no
          // está en el contrato. Sin soltarla la unidad quedaba contratada para
          // siempre, y encima seguía apareciendo en las consultas por contrato
          // (onAnnulment, onEntregaTransicion). Es lo que dejó a
          // PROP20260731-01 con 24 fichas para 12 radios el 2026-08-03:
          // corrigieron los seriales con la orden de programación ya abierta y
          // los 12 viejos estaban en_taller, fuera del soloDesde de arriba.
          const d = await pool.desasignarContrato(serialAntes, before.modelo_id, before.modelo, {
            cid,
            refMov: refMovLib,
            notas: "Serial removido del contrato — la unidad conserva su estado (orden o venta en curso)",
          });
          if (d === "liberado") {
            logger.info("[onSerialWrite] Pool: asignación liberada sin mover el estado",
              { cid, serial: serialAntes });
          }
        }
      }

      // Serial agregado o editado → asignar/crear la unidad en el pool.
      if (serialDespues && (!before || !mismo)) {
        const c = await getContrato();
        const entregado = c.entrega_confirmada === true || c.seriales_estado === "legacy";
        // Propiedad de la unidad según el tipo de contrato: "Propio" (venta con
        // contrato de servicio) = equipo del cliente; Alquiler/Temporal/Demo/
        // Reemplazo = flota Cecomunica.
        const propiedad = (c.tipo_contrato === "Propio" || c.codigo_tipo === "PROP")
          ? "cliente" : "cecomunica";
        const r = await pool.upsertContacto({
          serial: serialDespues,
          modelo_id: after.modelo_id || null,
          modelo_label: after.modelo || "",
          estado: entregado ? pool.ESTADOS.EN_CLIENTE : pool.ESTADOS.ASIGNADO,
          // EN_CLIENTE también se protege (2026-09-01, SERV mixto): una fila
          // de un equipo que YA está con el cliente (línea "propio" jalada de
          // la custodia) solo gana el vínculo al contrato — no se "des-entrega"
          // a asignado. La propiedad existente nunca se pisa (upsertContacto).
          noTocarDesde: [pool.ESTADOS.EN_TALLER, pool.ESTADOS.EN_CLIENTE],
          tipo: "asignacion_contrato",
          refMov: { tipo: "contrato", id: cid, label: after.contrato_id || "" },
          origen: "migracion_contrato",
          extra: {
            propiedad,
            asignacion: {
              contrato_doc_id: cid,
              contrato_id:     after.contrato_id || c.contrato_id || "",
              cliente_id:      after.cliente_id || c.cliente_id || "",
              cliente_nombre:  after.cliente_nombre || c.cliente_nombre || "",
            },
          },
        });
        logger.info("[onSerialWrite] Pool sync", { cid, serial: serialDespues, resultado: r });
      }
    } catch (e) {
      logger.warn("[onSerialWrite] Pool sync falló (no crítico)", { cid, message: e.message });
    }
    return null;
  }
);

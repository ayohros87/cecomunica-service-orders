const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const pool = require("../../domain/equiposPool");
const { admin, db } = require("../../lib/admin");

// Pool de equipos ↔ órdenes de servicio ("migración por contacto", plan
// docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md §3.4):
//   · equipo agregado a una orden viva → la unidad pasa a en_taller (si el
//     serial no existe en el pool se crea con origen migracion_orden). NO
//     aplica a las órdenes que no mueven inventario — inspección y VISITA
//     TÉCNICA, que ocurre en las instalaciones del cliente.
//   · orden pasa a "ENTREGADO AL CLIENTE" (o se soft-elimina) → sus unidades
//     en_taller regresan a en_cliente.
//   · equipo removido de la orden → su unidad sale del taller (en_cliente).
// El serial de la orden es texto libre: nunca bloquea, solo registra.
const ENTREGADO = "ENTREGADO AL CLIENTE";
// Terminal propio de las ENTRADA: no se entregan al cliente, se cierran.
const CERRADA_ENTRADA = "CERRADA (ENTRADA)";
// Terminal de la VISITA TÉCNICA (se cierra en sitio, con firma del cliente).
const CERRADA_VISITA = "CERRADA (VISITA)";
const norm = (s) => String(s || "").trim().toUpperCase();
// Contratos que siguen vivos: solo esos vale la pena marcar para cancelar.
const VIGENTES = new Set(["activo", "aprobado"]);

function equiposDe(data) {
  if (!data || data.eliminado === true) return [];
  return (data.equipos || [])
    .filter((e) => e && !e.eliminado)
    .map((e) => ({
      serial: (e.serial || e.SERIAL || e.numero_de_serie || "").toString().trim(),
      modelo_id: e.modelo_id || null,
      modelo: (e.modelo || e.MODEL || e.modelo_nombre || "").toString().trim(),
    }))
    .filter((e) => e.serial);
}

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const ordenId = event.params.ordenId;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after && !before) return null;

    try {
      const antes   = equiposDe(before);
      const despues = after ? equiposDe(after) : [];
      const keysDespues = new Set(despues.map((e) => pool.normSerial(e.serial)));
      const keysAntes   = new Set(antes.map((e) => pool.normSerial(e.serial)));

      // ── Cierre de una ENTRADA ────────────────────────────────────────────
      // La ENTRADA es el regreso físico del equipo. Mientras está abierta las
      // unidades siguen en cuarentena (devuelto_revision) porque el taller las
      // está revisando; al CERRARLA esa revisión terminó, así que aterrizan en
      // bodega y sueltan la asignación — misma convención que cualquier otra
      // entrada a bodega del sistema (onSerialWrite, onOrdenDevolucionWrite).
      // Va ANTES del bloque de inspección para que aplique también a las
      // ENTRADAs nacidas de una DEVOLUCIÓN, que si no se quedaban en cuarentena
      // para siempre.
      // `correccion_terminal` marca el backfill de estados históricos
      // (scripts/fix-entradas-mal-cerradas.js): esas ENTRADAs son de 2025 y se
      // cerraron mal como "ENTREGADO AL CLIENTE" porque CERRADA (ENTRADA) aún
      // no existía. Corregir el terminal NO debe mover inventario: dónde está
      // hoy ese equipo no se deduce de una orden de hace un año.
      const cerroEntrada = after
        && after.correccion_terminal !== true
        && norm(after.tipo_de_servicio) === "ENTRADA"
        && norm(after.estado_reparacion) === CERRADA_ENTRADA
        && norm(before?.estado_reparacion) !== CERRADA_ENTRADA;

      if (cerroEntrada) {
        const refMovE = { tipo: "orden", id: ordenId, label: after.numero_orden || ordenId };
        for (const e of despues) {
          try {
            await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
              aEstado: pool.ESTADOS.EN_BODEGA,
              // VENDIDO y BAJA quedan fuera a propósito: son hechos de
              // propiedad, no de ubicación, y no los revierte una entrada.
              soloDesde: [pool.ESTADOS.DEVUELTO, pool.ESTADOS.EN_TALLER,
                          pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.ASIGNADO],
              tipo: "cierre_entrada",
              refMov: refMovE,
              notas: "Entrada cerrada: el equipo queda disponible en bodega",
              // verificado:true — la ENTRADA ES la orden de inspección del
              // equipo devuelto: el taller lo tuvo en la mano y lo revisó, así
              // que eso YA es la confirmación humana. Otras vueltas a bodega
              // (p.ej. quitar un serial de un contrato, onSerialWrite) sí
              // dejan verificado:false porque nadie miró la unidad.
              extra: { orden_actual_id: null, asignacion: null, verificado: true },
            });
          } catch (err) { /* best-effort por unidad */ }
        }

        // El equipo volvió, pero el contrato sigue vivo: se marca para que
        // ventas lo cancele. NO se cancela solo — una ENTRADA también puede ser
        // una reparación o un reemplazo, y cancelar factura de por medio es
        // decisión humana (decidido con el usuario 2026-07-28).
        const c = after.contrato || {};
        if (c.aplica && c.contrato_doc_id) {
          try {
            const ref = db.collection("contratos").doc(c.contrato_doc_id);
            const snap = await ref.get();
            const estado = String(snap.exists ? (snap.data().estado || "") : "").toLowerCase();
            if (snap.exists && VIGENTES.has(estado)) {
              await ref.set({
                cancelacion_pendiente: {
                  orden_entrada_id: ordenId,
                  orden_numero: after.numero_orden || ordenId,
                  cliente_nombre: after.cliente_nombre || "",
                  seriales: despues.map((e) => e.serial),
                  at: admin.firestore.FieldValue.serverTimestamp(),
                },
              }, { merge: true });
              logger.info("[onOrdenWritePool] Contrato marcado para cancelar tras ENTRADA",
                { ordenId, contrato: c.contrato_id || c.contrato_doc_id, unidades: despues.length });
            }
          } catch (err) {
            logger.warn("[onOrdenWritePool] No se pudo marcar el contrato", { ordenId, err: String(err) });
          }
        }
        return null;
      }

      // Órdenes que NO mueven inventario — solo enlazan/limpian orden_actual_id:
      //
      //   · INSPECCIÓN de entrada (creadas al cerrar una enmienda o anular un
      //     contrato — lib/ordenEntrada.js): sus equipos están en cuarentena
      //     (devuelto_revision) y DEBEN seguir ahí durante la inspección.
      //   · VISITA TÉCNICA: el técnico va a las instalaciones del cliente, el
      //     radio nunca sale de ahí (decisión del usuario 2026-07-28). Antes
      //     caía en el flujo normal y agregar equipos lo mandaba a en_taller;
      //     como el terminal de una visita es CERRADA (VISITA) y el retorno
      //     solo miraba ENTREGADO AL CLIENTE, la unidad se quedaba "en taller"
      //     para siempre. Las 8 de la orden 2026072701 eran justo eso.
      const esInspeccion = !!(after?.entrada_inspeccion || before?.entrada_inspeccion);
      const esVisita = /VISITA/.test(norm(after?.tipo_de_servicio || before?.tipo_de_servicio));
      if (esInspeccion || esVisita) {
        // Cada tipo cierra con su propio terminal; sin contemplarlos todos, el
        // link a la orden quedaba colgando en el pool para siempre.
        const cerrada = !after || after.eliminado === true
          || norm(after.estado_reparacion) === ENTREGADO
          || norm(after.estado_reparacion) === CERRADA_ENTRADA
          || norm(after.estado_reparacion) === CERRADA_VISITA;
        const equiposRef = (despues.length ? despues : antes);
        for (const e of equiposRef) {
          try {
            const { ref, data } = await pool.resolver(e.serial, e.modelo_id, e.modelo);
            if (!data) continue;
            if (cerrada) {
              if (data.orden_actual_id === ordenId) {
                await ref.set({ orden_actual_id: null }, { merge: true });
              }
            } else if (data.orden_actual_id !== ordenId) {
              await ref.set({ orden_actual_id: ordenId }, { merge: true });
            }
          } catch (err) { /* best-effort por unidad */ }
        }
        return null;
      }

      const entregadaAhora = after && norm(after.estado_reparacion) === ENTREGADO
        && norm(before?.estado_reparacion) !== ENTREGADO;
      const yaEntregada = after && norm(after.estado_reparacion) === ENTREGADO;
      const eliminada = !after || after.eliminado === true;

      const refMov = { tipo: "orden", id: ordenId, label: after?.numero_orden || before?.numero_orden || ordenId };
      // Custodia del cliente de la orden — se estampa solo si la unidad no
      // tiene ya una asignación (nunca pisa la de un contrato).
      const fuente = after || before || {};
      const custodiaCliente = (fuente.cliente_nombre || fuente.cliente_id) ? {
        contrato_doc_id: null, contrato_id: "",
        cliente_id: fuente.cliente_id || "", cliente_nombre: fuente.cliente_nombre || "",
      } : null;

      // Venta ↔ orden de PROGRAMACIÓN (fix 2026-07-27): el feed del home
      // sugiere "crear orden" mientras venta.orden_programacion_id esté vacío,
      // pero ese enlace solo lo estampaba el CTA venta→orden. Una orden creada
      // a mano (o ANTES de registrar la venta) dejaba la sugerencia viva para
      // siempre. Aquí se amarra por contacto: unidad VENDIDA del MISMO cliente
      // en una PROGRAMACIÓN viva → se estampa el enlace.
      const esProgramacion = String(after?.tipo_de_servicio || "")
        .toUpperCase().includes("PROGRAMA");
      const amarrarVenta = async (e) => {
        if (!esProgramacion) return;
        try {
          const { ref, data } = await pool.resolver(e.serial, e.modelo_id, e.modelo);
          if (!data || data.estado !== pool.ESTADOS.VENDIDO) return;
          if (!data.venta || data.venta.orden_programacion_id) return;
          const cv = data.venta.cliente_id || "";
          if (cv && after.cliente_id && cv !== after.cliente_id) return; // venta de otro cliente
          await ref.set({ venta: { orden_programacion_id: ordenId } }, { merge: true });
          logger.info("[onOrdenWritePool] Venta amarrada a orden de programación", { ordenId, serial: e.serial });
        } catch (err) { /* best-effort por unidad */ }
      };

      // Una unidad VENDIDA conserva su estado (la venta es un hecho de
      // propiedad, no de ubicación) — al cerrar la orden solo se limpia el
      // enlace orden_actual_id, que transicionar() no toca por soloDesde.
      const soltarVendido = async (e) => {
        try {
          const { ref, data } = await pool.resolver(e.serial, e.modelo_id, e.modelo);
          if (data && data.estado === pool.ESTADOS.VENDIDO && data.orden_actual_id === ordenId) {
            await ref.set({ orden_actual_id: null }, { merge: true });
          }
        } catch (err) { /* best-effort por unidad */ }
      };

      // Salida de taller: entrega de la orden, soft-delete, o borrado del doc.
      if (entregadaAhora || (eliminada && before?.eliminado !== true)) {
        const equiposFuente = despues.length ? despues : antes;
        for (const e of equiposFuente) {
          await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
            aEstado: pool.ESTADOS.EN_CLIENTE,
            soloDesde: [pool.ESTADOS.EN_TALLER],
            condicion: (d) => d.orden_actual_id === ordenId,
            tipo: "salida_taller",
            refMov,
            notas: entregadaAhora ? "" : "Orden eliminada",
            extra: { orden_actual_id: null, ...(custodiaCliente ? { asignacionSiFalta: custodiaCliente } : {}) },
          });
          if (entregadaAhora) await amarrarVenta(e);
          await soltarVendido(e);
        }
        return null;
      }
      if (yaEntregada || eliminada) return null;

      // Equipos removidos de una orden viva → salen del taller.
      for (const e of antes.filter((x) => !keysDespues.has(pool.normSerial(x.serial)))) {
        await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
          aEstado: pool.ESTADOS.EN_CLIENTE,
          soloDesde: [pool.ESTADOS.EN_TALLER],
          condicion: (d) => d.orden_actual_id === ordenId,
          tipo: "salida_taller",
          refMov,
          notas: "Equipo removido de la orden",
          extra: { orden_actual_id: null, ...(custodiaCliente ? { asignacionSiFalta: custodiaCliente } : {}) },
        });
        await soltarVendido(e);
      }

      // Equipos nuevos en la orden → entran al taller (upsert por contacto).
      const nuevos = despues.filter((x) => !keysAntes.has(pool.normSerial(x.serial)));
      for (const e of nuevos) {
        const contrato = after.contrato || {};
        // Serial que aparece por primera vez en una orden SIN contrato: es
        // equipo del cliente (la flota propia ya existiría en el pool vía POC
        // o contrato). Con contrato vinculado, onSerialWrite refina después.
        const extra = { orden_actual_id: ordenId };
        if (!(contrato.aplica && contrato.contrato_doc_id)) {
          extra.propiedad = "cliente";
          if (custodiaCliente) extra.asignacionSiFalta = custodiaCliente;
        }
        if (contrato.aplica && contrato.contrato_doc_id) {
          extra.asignacion = {
            contrato_doc_id: contrato.contrato_doc_id,
            contrato_id:     contrato.contrato_id || "",
            cliente_id:      after.cliente_id || "",
            cliente_nombre:  after.cliente_nombre || "",
          };
        }
        const r = await pool.upsertContacto({
          serial: e.serial,
          modelo_id: e.modelo_id,
          modelo_label: e.modelo,
          estado: pool.ESTADOS.EN_TALLER,
          // Un radio VENDIDO que vuelve por servicio no pierde su venta: el
          // estado se conserva y solo se enlaza la orden (extra).
          noTocarDesde: [pool.ESTADOS.VENDIDO],
          tipo: "ingreso_taller",
          refMov,
          origen: "migracion_orden",
          extra,
        });
        if (r === "creado") logger.info("[onOrdenWritePool] Serial nuevo en pool desde orden", { ordenId, serial: e.serial });
      }

      // Amarre de ventas: al agregar equipos o al cambiar el estado de la
      // orden. El segundo caso cubre la venta registrada DESPUÉS de crear la
      // orden — el próximo avance de la orden la amarra y la sugerencia del
      // home muere sola.
      const estadoCambio = norm(before?.estado_reparacion) !== norm(after.estado_reparacion);
      if (esProgramacion && (nuevos.length || estadoCambio)) {
        for (const e of despues) await amarrarVenta(e);
      }
    } catch (e) {
      logger.warn("[onOrdenWritePool] Pool sync falló (no crítico)", { ordenId, message: e.message });
    }
    return null;
  }
);

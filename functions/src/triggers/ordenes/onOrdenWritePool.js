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
//   · orden pasa a "ENTREGADO AL CLIENTE" → sus unidades en_taller pasan a
//     en_cliente (eso sí es una entrega).
//   · equipo removido de la orden, u orden eliminada → la unidad sale del
//     taller SIN entregarse: vuelve al estado del que salió (bodega, asignada
//     al contrato o con el cliente), nunca a en_cliente por defecto.
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

// Aterriza en bodega los equipos de una ENTRADA que se cierra, y DEJA CONSTANCIA
// de lo que no pudo aterrizar.
//
// El bug que cierra (caso TIL PANAMA, 2026-08): `transicionar` devuelve
// "no-existe" cuando el serial de la fila no tiene ficha en el pool — un dígito
// mal tecleado basta. Antes ese retorno se ignoraba y el `catch` estaba vacío:
// el radio real se quedaba en cuarentena mientras sus 13 compañeros de tanda
// pasaban a bodega, y NADA lo decía. Estuvo nueve días fuera del inventario
// disponible sin que saltara un solo aviso.
//
// Ahora cada unidad que no aterriza queda anotada en la propia orden
// (`cierre_entrada_incidencias`) con el motivo, y la bandera
// `cierre_entrada_con_incidencias` la hace consultable — el correo diario la
// lee de ahí (recordatorioOperativo §G) en vez de barrer todas las órdenes.
//
// Motivos:
//   · sin_ficha  — el serial no existe en el pool. Casi siempre está mal
//                  escrito. Es el caso grave: hay un radio físico sin rastro.
//   · no_movio   — la ficha existe pero no estaba en un estado que el cierre
//                  pueda mover (vendida, de baja, o ya en bodega). Puede ser
//                  benigno; se anota igual para que alguien lo mire.
//
// `reintento` la usa la re-evaluación de abajo: al corregir el serial de una
// ENTRADA ya cerrada, esto vuelve a correr y el equipo aterriza tarde pero
// aterriza — que es exactamente lo que hubo que hacer a mano con el radio de TIL.
async function aterrizarEntrada(ordenId, after, equipos, { reintento = false } = {}) {
  const refMovE = { tipo: "orden", id: ordenId, label: after.numero_orden || ordenId };
  const incidencias = [];
  let aterrizados = 0;

  for (const e of equipos) {
    let r = null;
    try {
      r = await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
        aEstado: pool.ESTADOS.EN_BODEGA,
        // VENDIDO y BAJA quedan fuera a propósito: son hechos de
        // propiedad, no de ubicación, y no los revierte una entrada.
        soloDesde: [pool.ESTADOS.DEVUELTO, pool.ESTADOS.EN_TALLER,
                    pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.ASIGNADO],
        tipo: "cierre_entrada",
        refMov: refMovE,
        notas: reintento
          ? "Entrada ya cerrada: el equipo aterriza en bodega al corregirse su serial"
          : "Entrada cerrada: el equipo queda disponible en bodega",
        // verificado:true — la ENTRADA ES la orden de inspección del
        // equipo devuelto: el taller lo tuvo en la mano y lo revisó, así
        // que eso YA es la confirmación humana. Otras vueltas a bodega
        // (p.ej. quitar un serial de un contrato, onSerialWrite) sí
        // dejan verificado:false porque nadie miró la unidad.
        extra: { orden_actual_id: null, asignacion: null, verificado: true },
      });
    } catch (err) {
      r = "error";
      logger.warn("[onOrdenWritePool] transicionar falló al cerrar ENTRADA",
        { ordenId, serial: e.serial, error: err.message });
    }
    if (r === "transicion") { aterrizados++; continue; }
    // "sin-cambio" con la ficha YA en bodega es el caso idempotente (el trigger
    // corrió dos veces): no es incidencia. Se distingue releyendo la ficha.
    let estadoActual = null;
    try {
      const { data } = await pool.resolver(e.serial, e.modelo_id, e.modelo);
      estadoActual = data ? data.estado : null;
    } catch (err) { /* si no se puede releer, se anota igual */ }
    if (estadoActual === pool.ESTADOS.EN_BODEGA) continue;
    incidencias.push({
      serial: e.serial,
      modelo: e.modelo || "",
      motivo: r === "no-existe" ? "sin_ficha" : "no_movio",
      estado: estadoActual,
    });
  }
  return { incidencias, aterrizados };
}

// Dos listas de incidencias son "la misma" si anotan los mismos hechos, sin
// importar el orden. El timestamp queda fuera a propósito: es lo único que
// cambiaría en una reescritura idéntica.
const claveInc = (i) => [pool.normSerial(i.serial), i.motivo || "", i.estado || "", i.modelo || ""].join("|");
const mismasIncidencias = (a, b) =>
  a.length === b.length && a.map(claveInc).sort().join("\n") === b.map(claveInc).sort().join("\n");

// Escribe (o limpia) el rastro de incidencias del cierre en la propia orden.
// Se limpia solo: cuando ya no queda ninguna, la bandera desaparece y la orden
// deja de salir en el correo — sin que nadie tenga que "marcar como resuelto".
async function anotarIncidencias(ordenId, after, incidencias) {
  const teniaAntes = !!after.cierre_entrada_con_incidencias;
  // Candado anti-bucle (2026-09-02): este trigger escucha la misma colección
  // que escribe. Si la lista no cambió, reescribirla solo refresca el
  // serverTimestamp, y ese "cambio" re-dispara el trigger, que reintenta,
  // vuelve a fallar igual y reescribe — para siempre. Así giró la orden
  // 2026082605 a ~14 vueltas/segundo del 27-ago al 1-sep (19.5M invocaciones,
  // $60+ de factura). Sin cambio real, no hay escritura.
  if (incidencias.length && teniaAntes
      && mismasIncidencias(incidencias, Array.isArray(after.cierre_entrada_incidencias) ? after.cierre_entrada_incidencias : [])) {
    return;
  }
  if (!incidencias.length) {
    if (!teniaAntes) return;
    await db.collection("ordenes_de_servicio").doc(ordenId).set({
      cierre_entrada_con_incidencias: admin.firestore.FieldValue.delete(),
      cierre_entrada_incidencias: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    logger.info("[onOrdenWritePool] incidencias de cierre resueltas", { ordenId });
    return;
  }
  await db.collection("ordenes_de_servicio").doc(ordenId).set({
    cierre_entrada_con_incidencias: true,
    cierre_entrada_incidencias: incidencias,
    cierre_entrada_incidencias_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  // error y no warn: un radio que se cierra sin aterrizar es inventario que
  // desaparece en silencio, no un detalle de log.
  logger.error("[onOrdenWritePool] ENTRADA cerrada con equipos que NO aterrizaron", {
    ordenId, total: incidencias.length,
    sinFicha: incidencias.filter((i) => i.motivo === "sin_ficha").map((i) => i.serial),
  });
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

      // ── ENTRADA ya cerrada que se corrige ────────────────────────────────
      // La otra mitad del arreglo. Si una ENTRADA cerró dejando equipos sin
      // aterrizar (serial mal tecleado), corregir ese serial tenía que
      // rescatarse a mano: el bloque de arriba solo corre en el INSTANTE del
      // cierre y ya nunca vuelve a mirar. Con el radio de TIL hubo que
      // renombrar la ficha y aplicar la transición perdida con un script.
      //
      // Ahora, mientras la orden tenga incidencias anotadas, cualquier
      // escritura la vuelve a evaluar: en cuanto el serial corregido resuelve
      // a una ficha real, el equipo aterriza en bodega y la anotación se
      // limpia sola. Solo entra si YA hay incidencias, así que no cuesta nada
      // en las órdenes sanas.
      if (after && after.cierre_entrada_con_incidencias === true
          && norm(after.tipo_de_servicio) === "ENTRADA"
          && norm(after.estado_reparacion) === CERRADA_ENTRADA
          && after.eliminado !== true
          && !cerroEntrada) {
        const seriales = new Set((after.cierre_entrada_incidencias || []).map((i) => pool.normSerial(i.serial)));
        // Solo se reintentan las filas problemáticas y las que las sustituyeron
        // (un serial corregido es una fila NUEVA a ojos del serial viejo), no
        // toda la orden: las demás ya están donde tienen que estar.
        const candidatos = despues.filter((e) => {
          const k = pool.normSerial(e.serial);
          return seriales.has(k) || !keysAntes.has(k);
        });
        if (candidatos.length) {
          const { incidencias, aterrizados } = await aterrizarEntrada(ordenId, after, candidatos, { reintento: true });
          // Lo que ya no falla sale de la lista; lo que sigue fallando se queda.
          const resueltos = new Set(candidatos.map((e) => pool.normSerial(e.serial)));
          const restantes = (after.cierre_entrada_incidencias || [])
            .filter((i) => !resueltos.has(pool.normSerial(i.serial)))
            .concat(incidencias);
          await anotarIncidencias(ordenId, after, restantes);
          if (aterrizados) {
            logger.info("[onOrdenWritePool] equipos rescatados de una ENTRADA ya cerrada",
              { ordenId, aterrizados, quedan: restantes.length });
          }
        }
        return null;
      }

      if (cerroEntrada) {
        const { incidencias, aterrizados } = await aterrizarEntrada(ordenId, after, despues);
        await anotarIncidencias(ordenId, after, incidencias);
        logger.info("[onOrdenWritePool] cierre de ENTRADA", {
          ordenId, unidades: despues.length, aterrizados, incidencias: incidencias.length });

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

      // Salida del taller SIN entrega (se quitó el equipo de la orden, o la
      // orden se eliminó): el radio nunca llegó al cliente, así que no puede
      // quedar en_cliente — eso lo saca del inventario disponible en silencio.
      // Vuelve a de donde salió: el kardex guarda el estado previo en el
      // movimiento ingreso_taller de esta misma orden.
      const devolverAlOrigen = async (e, notas) => {
        let destino = null;
        try {
          const r = await pool.resolver(e.serial, e.modelo_id, e.modelo);
          if (r.data) {
            const previo = await pool.estadoPrevioAOrden(r.ref, ordenId);
            destino = pool.destinoAlSalirDeOrden(r.data, previo);
          }
        } catch (err) { /* best-effort por unidad: se cae al destino por defecto */ }
        const aEstado = destino || pool.ESTADOS.EN_CLIENTE;
        await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
          aEstado,
          soloDesde: [pool.ESTADOS.EN_TALLER],
          condicion: (d) => d.orden_actual_id === ordenId,
          tipo: "salida_taller",
          refMov,
          notas,
          extra: {
            orden_actual_id: null,
            // Nadie miró la unidad al volver al estante: entra a la cola de
            // "verificar" (misma convención que onSerialWrite).
            ...(aEstado === pool.ESTADOS.EN_BODEGA ? { verificado: false } : {}),
            ...(aEstado === pool.ESTADOS.EN_CLIENTE && custodiaCliente
              ? { asignacionSiFalta: custodiaCliente } : {}),
          },
        });
        await soltarVendido(e);
      };

      // Salida de taller: entrega de la orden, soft-delete, o borrado del doc.
      if (entregadaAhora || (eliminada && before?.eliminado !== true)) {
        const equiposFuente = despues.length ? despues : antes;
        for (const e of equiposFuente) {
          // Entrega: el radio SÍ llegó al cliente. Orden eliminada: no.
          if (entregadaAhora) {
            await pool.transicionar(e.serial, e.modelo_id, e.modelo, {
              aEstado: pool.ESTADOS.EN_CLIENTE,
              soloDesde: [pool.ESTADOS.EN_TALLER],
              condicion: (d) => d.orden_actual_id === ordenId,
              tipo: "salida_taller",
              refMov,
              notas: "",
              extra: { orden_actual_id: null, ...(custodiaCliente ? { asignacionSiFalta: custodiaCliente } : {}) },
            });
            await amarrarVenta(e);
            await soltarVendido(e);
          } else {
            await devolverAlOrigen(e, "Orden eliminada");
          }
        }
        return null;
      }
      if (yaEntregada || eliminada) return null;

      // Equipos removidos de una orden viva → salen del taller.
      for (const e of antes.filter((x) => !keysDespues.has(pool.normSerial(x.serial)))) {
        await devolverAlOrigen(e, "Equipo removido de la orden");
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

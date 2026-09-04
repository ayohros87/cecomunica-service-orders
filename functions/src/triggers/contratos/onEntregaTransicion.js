// Auto-registro de la transición de equipos al CONFIRMARSE LA ENTREGA del
// contrato nuevo (renovación / adición / reemplazo con origen vinculado).
//
// Regla de negocio (2026-07-20): en una renovación, TODO equipo de ALQUILER
// de los contratos originales se devuelve — la acción humana es la excepción,
// no la devolución. Momento elegido: la entrega del contrato nuevo (el
// cliente ya recibió los radios nuevos; ahora debe entregar los viejos).
//
// Qué hace: por cada contrato de origen vinculado, toma sus unidades del pool
// aún con el cliente (asignado_contrato / en_cliente) cuya propiedad NO sea
// del cliente, y crea mapeos de devolución en contratos/{cid}/mapeos.
// onMapeoWrite hace el resto (pendiente_devolucion + contador + kardex) y el
// recordatorio semanal de transiciones engancha solo. Se avisa por correo al
// vendedor del cliente + recepción con la lista a recuperar.
//
// La página de transición queda para las EXCEPCIONES (justificar no
// devoluciones, linaje opcional) y para contratos sin origen vinculado.
//
// Idempotencia: `transicion_auto_at` en el contrato + solo corre si aún no
// hay mapeos (transicion_mapeos_count == 0). Los equipos PROPIOS del cliente
// se omiten (son suyos). Contratos legacy quedan fuera (mismo corte que la CTA).

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");
const { origenIdsDe } = require("../../lib/linaje");
const { decidirSalientes } = require("../../lib/transicionPlanExec");
const { evaluarOrigen, evaluarTope } = require("../../lib/transicionAuto");

// El auto-reclamo se frena y deja rastro en vez de crear una orden dudosa
// (lib/transicionAuto.js explica los tres candados y el caso que los motivó).
// No se estampa `transicion_auto_at`: el contrato queda elegible para correr
// de nuevo en cuanto alguien confirme el origen.
async function _bloquear(cid, contratoId, veredicto, candidatas) {
  await db.collection("contratos").doc(cid).set({
    transicion_auto_bloqueada: {
      motivo: veredicto.motivo,
      detalle: veredicto.detalle || "",
      unidades_candidatas: Number(candidatas || 0),
      tope: veredicto.tope == null ? null : Number(veredicto.tope),
      at: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });
  logger.warn("[onEntregaTransicion] Auto-reclamo BLOQUEADO — requiere confirmación humana", {
    contratoId, motivo: veredicto.motivo, candidatas: Number(candidatas || 0),
  });
}

module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data();
    const after  = event.data.after?.data();
    if (!before || !after) return null;

    // DOS flancos de entrada, no uno:
    //   1. la entrega del contrato nuevo — el momento original y el normal;
    //   2. la confirmación humana del origen, para los que quedaron frenados
    //      por un candado de transicionAuto. Sin este segundo flanco,
    //      confirmar el vínculo no haría nada: el trigger solo mira la entrega
    //      y esa ya pasó, así que la devolución legítima nunca se crearía.
    const entregaConfirmada = !before.entrega_confirmada && after.entrega_confirmada === true;
    const origenConfirmado = !before.linaje_confirmado && !!after.linaje_confirmado
      && after.entrega_confirmada === true && !!after.transicion_auto_bloqueada;
    if (!entregaConfirmada && !origenConfirmado) return null;

    const cid = event.params.cid;
    const contratoId = after.contrato_id || cid;

    // Solo REEMPLAZOS: renovación y reemplazo SUSTITUYEN el equipo del origen,
    // así que lo viejo se devuelve.
    //
    // "Adición" queda FUERA a propósito (2026-08-10). Una adición AGREGA
    // unidades a un contrato que sigue vigente — el cliente se queda con las de
    // antes y con las nuevas. Tratarla como renovación abrió órdenes de
    // recuperación falsas pidiendo equipo que el cliente tiene con todo derecho
    // (NADCAR ALQ20260803-01: 8 radios añadidos y el sistema reclamó los 10 del
    // contrato original, que sigue activo; también DESARROLLO ACQUA TRES).
    //
    // OJO: "Adición" SÍ sigue en js/domain/transicionPendiente.js — ese
    // predicado es el del CTA, y una adición pura necesita poder cerrarse con
    // `cerrarSinReemplazos()`. Los dos predicados divergen a propósito: uno
    // decide "¿hay que registrar algo?", este decide "¿se devuelve el origen?".
    //
    // Renovación SIN EQUIPO (2026-09-04): antes quedaba fuera del todo. Ahora
    // entra SOLO si el plan por serial de la venta declaró unidades que se
    // devuelven o se reemplazan — y en ese caso se reclaman ÚNICAMENTE esas
    // (soloDeclaradas): lo que el vendedor no nombró continúa con el cliente.
    const planSerial = (after.transicion_plan?.nivel === "serial" && Array.isArray(after.transicion_plan.unidades))
      ? after.transicion_plan : null;
    const declaradasSalientes = planSerial
      ? planSerial.unidades.filter((u) => ["devuelve", "reemplaza"].includes(u.destino)) : [];
    const sinEquipo = !!after.renovacion_sin_equipo;
    const esTransicionable = (after.accion === "Renovación" || after.codigo_tipo === "REEMP")
      && (!sinEquipo || declaradasSalientes.length > 0);
    if (!esTransicionable) return null;
    if (after.seriales_estado === "legacy") return null;
    if (Number(after.transicion_mapeos_count || 0) > 0) return null; // ya hay registro manual
    if (after.transicion_auto_at) return null;                        // ya corrió

    // ¿Por SERIAL o por CONTRATO? Un REEMPLAZO que declaró qué radio sustituye
    // (js/domain/reemplazoSalientes.js, desde 2026-08-27) no necesita contrato
    // de origen: reclama ESE radio y nada más. Es la vía precisa, y la única
    // que funciona cuando el original está en papel — que es justo el caso
    // donde el contrato de origen se inventaba y salían órdenes falsas.
    const porSerial = Array.isArray(after.reemplaza_seriales);
    const origenIds = origenIdsDe(after);

    if (porSerial && !after.reemplaza_seriales.length) {
      // Respuesta explícita del vendedor: "no se identifica el equipo saliente".
      // No es un hueco — es una decisión, y adivinar la contradice.
      logger.info("[onEntregaTransicion] REEMP sin equipo saliente identificado; no se reclama nada", { contratoId });
      return null;
    }
    if (!porSerial && !origenIds.length && !declaradasSalientes.length) return null;

    // Candados (a) y (b): ¿el origen es un hecho declarado o una suposición?
    // Va ANTES de leer el pool — si el vínculo no es confiable, las unidades
    // que cuelguen de él dan igual. La vía por serial se los salta: no depende
    // del contrato de origen, así que no puede heredar su error. Lo mismo un
    // plan por serial sin contrato de origen en el sistema (origen en papel):
    // cada saliente lo nombró el vendedor, no se dedujo de nada.
    if (!porSerial && origenIds.length) {
      const vOrigen = evaluarOrigen(after);
      if (!vOrigen.ok) {
        await _bloquear(cid, contratoId, vOrigen, 0);
        return null;
      }
    }

    // Unidades a considerar. La propiedad y el plan de la venta los aplica
    // decidirSalientes (lib/transicionPlanExec.js).
    const unidadesOrigen = [];
    if (porSerial) {
      // Por serial: se leen las fichas nombradas por la venta. Las que ya no
      // están con el cliente se omiten — si el radio dañado ya volvió (entró
      // al taller y se le dio entrada), no hay nada que recuperar.
      for (const r of after.reemplaza_seriales) {
        const poolId = r.pool_id || r.serial_norm || r.serial;
        if (!poolId) continue;
        try {
          const d = await db.collection("equipos_pool").doc(String(poolId)).get();
          if (!d.exists) {
            logger.warn("[onEntregaTransicion] Serial saliente sin ficha en el pool", { contratoId, serial: r.serial });
            continue;
          }
          const u = d.data();
          if (!["asignado_contrato", "en_cliente"].includes(u.estado)) {
            logger.info("[onEntregaTransicion] Saliente ya no está con el cliente; no se reclama",
              { contratoId, serial: r.serial, estado: u.estado });
            continue;
          }
          if (unidadesOrigen.some(x => x.id === d.id)) continue;
          unidadesOrigen.push({ id: d.id, origenId: u.asignacion?.contrato_doc_id || null, ...u });
        } catch (e) {
          logger.warn("[onEntregaTransicion] No se pudo leer la ficha del saliente", { contratoId, serial: r.serial, message: e.message });
        }
      }
    } else {
      for (const origenId of origenIds) {
        try {
          const snap = await db.collection("equipos_pool")
            .where("asignacion.contrato_doc_id", "==", origenId).get();
          snap.forEach((d) => {
            const u = d.data();
            if (!["asignado_contrato", "en_cliente"].includes(u.estado)) return;
            if (unidadesOrigen.some(x => x.id === d.id)) return;
            unidadesOrigen.push({ id: d.id, origenId, ...u });
          });
        } catch (e) {
          logger.warn("[onEntregaTransicion] No se pudo leer el pool del origen", { cid, origenId, message: e.message });
        }
      }
    }

    // Salientes DECLARADOS en el plan que no cuelgan de un origen del sistema
    // (custodia sin contrato, migración, contrato en papel): se leen por ficha
    // y entran si siguen con ESTE cliente. Sin esto, "se devuelve" sobre una
    // unidad en custodia no producía ninguna orden de recuperación.
    if (!porSerial && declaradasSalientes.length) {
      for (const r of declaradasSalientes) {
        const poolId = r.pool_id || r.serial_norm || r.serial;
        if (!poolId || unidadesOrigen.some((x) => x.id === String(poolId))) continue;
        try {
          const d = await db.collection("equipos_pool").doc(String(poolId)).get();
          if (!d.exists) continue;
          const u = d.data();
          if (!["asignado_contrato", "en_cliente"].includes(u.estado)) continue;
          if ((u.asignacion?.cliente_id || null) !== (after.cliente_id || null)) continue;
          if (u.asignacion?.contrato_doc_id === cid) continue; // ya es del contrato nuevo
          if (unidadesOrigen.some((x) => x.id === d.id)) continue;
          unidadesOrigen.push({ id: d.id, origenId: u.asignacion?.contrato_doc_id || null, ...u });
        } catch (e) {
          logger.warn("[onEntregaTransicion] No se pudo leer la ficha declarada en el plan", { contratoId, serial: r.serial, message: e.message });
        }
      }
    }

    // Entrantes del contrato nuevo — para parear los 'reemplaza' del plan y
    // producir el linaje (onMapeoWrite estampa reemplaza_a cuando el mapeo
    // trae entrante Y saliente).
    let entrantesNuevo = [];
    try {
      const snap = await db.collection("equipos_pool")
        .where("asignacion.contrato_doc_id", "==", cid).get();
      entrantesNuevo = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      logger.warn("[onEntregaTransicion] No se pudo leer el pool del contrato nuevo", { cid, message: e.message });
    }

    // El plan decidido en la venta (P1 informe 2026-08-12). Sin plan —o con
    // plan por cantidades— aplica la regla clásica: todo el alquiler colgado
    // del origen se devuelve.
    const { reclamar, continuan, noTienen } = decidirSalientes(after.transicion_plan || null, unidadesOrigen, entrantesNuevo,
      { soloDeclaradas: sinEquipo });
    if (continuan.length) {
      logger.info("[onEntregaTransicion] Unidades que CONTINÚAN según el plan (no se reclaman)",
        { contratoId, continuan: continuan.map((u) => u.serial || u.id) });
    }
    if (noTienen && noTienen.length) {
      logger.info("[onEntregaTransicion] Unidades que el cliente declaró NO tener (no se reclaman; se soltaron al aprobar)",
        { contratoId, noTienen: noTienen.map((u) => u.serial || u.id) });
    }

    if (!reclamar.length) {
      // Origen vinculado pero sin unidades nuestras colgando: o son del cliente
      // (Propio), o ya volvieron, o el origen es legacy sin seriales. En los
      // tres casos NO hay nada que recuperar, y eso es una respuesta — no un
      // hueco. Se estampa en el origen para que su fila diga "no aplica"
      // VERIFICADO en vez de "sin registro" (que significa "no se sabe").
      // La revisión manual sigue disponible en la página de transición.
      const marca = {
        devolucion_estado: "no_aplica",
        // Con plan de venta puede no haber NADA que devolver porque todo
        // continúa en el contrato nuevo — eso no es "sin unidades", es una
        // renovación completa por continuidad.
        devolucion_no_aplica_motivo: continuan.length ? "continuan_en_renovacion" : "sin_unidades",
        devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      for (const origenId of origenIds) {
        try {
          await db.collection("contratos").doc(origenId).set(marca, { merge: true });
        } catch (e) {
          logger.warn("[onEntregaTransicion] No se pudo marcar el origen sin unidades", { origenId, message: e.message });
        }
      }
      // "No hay nada que recuperar" también resuelve un intento frenado.
      try {
        await db.collection("contratos").doc(cid).set({
          transicion_auto_bloqueada: admin.firestore.FieldValue.delete(),
        }, { merge: true });
      } catch (e) {
        logger.warn("[onEntregaTransicion] No se pudo limpiar transicion_auto_bloqueada", { contratoId, message: e.message });
      }
      logger.info("[onEntregaTransicion] Origen sin unidades en el pool; marcado no_aplica", { contratoId, origenIds });
      return null;
    }

    // Candado (c): un REEMPLAZO no puede reclamar más de lo que entrega. Va
    // aquí porque necesita el resultado del plan — con un plan por serial bien
    // llenado el conteo cuadra solo y este candado nunca se activa.
    //
    // No aplica a la vía por serial: ahí cada saliente lo marcó una persona en
    // la venta. El tope existe para atajar un reclamo DEDUCIDO que se desborda,
    // no para discutirle a un vendedor que dijo exactamente qué radios salen.
    if (!porSerial) {
      const vTope = evaluarTope(after, reclamar);
      if (!vTope.ok) {
        await _bloquear(cid, contratoId, vTope, reclamar.length);
        return null;
      }
    }

    // Mapeos de devolución (batch). onMapeoWrite marca pendiente_devolucion,
    // incrementa el contador, escribe el kardex — y cuando el mapeo trae
    // ENTRANTE (pareo del plan) estampa el linaje reemplaza_a en la unidad
    // nueva. Es la primera vía que produce linaje de forma automática.
    const batch = db.batch();
    const col = db.collection("contratos").doc(cid).collection("mapeos");
    reclamar.forEach(({ unidad: u, entrante }) => batch.set(col.doc(), {
      saliente: u.serial || u.serial_norm || u.id,
      saliente_pool_id: u.id,
      entrante: entrante ? (entrante.serial || entrante.serial_norm || entrante.id) : null,
      entrante_pool_id: entrante ? entrante.id : null,
      modelo: u.modelo_label || "",
      modelo_id: u.modelo_id || null,
      contrato_id: contratoId,
      contrato_origen_id: u.origenId,
      auto: true,
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system",
    }));
    batch.set(db.collection("contratos").doc(cid), {
      transicion_auto_at: admin.firestore.FieldValue.serverTimestamp(),
      transicion_auto_unidades: reclamar.length,
      // Corrió bien: se borra la marca del intento frenado (este contrato pudo
      // llegar aquí por el segundo flanco, tras confirmarse el origen).
      transicion_auto_bloqueada: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    await batch.commit();
    logger.info("[onEntregaTransicion] Devolución auto-registrada", {
      contratoId, unidades: reclamar.length,
      pareadas: reclamar.filter((r) => r.entrante).length,
      continuan: continuan.length,
    });

    // Tiquete de trabajo: orden de DEVOLUCIÓN (modo recuperación) con las
    // unidades a recuperar — asignable, medible (aging) y con check-in por
    // serial. El correo a vendedor+recepción lo encola el propio creador.
    try {
      const ordenId = await crearOrdenDevolucion({
        clienteId: after.cliente_id || null,
        clienteNombre: after.cliente_nombre || "",
        contratoDocId: cid,
        contratoId,
        contratoOrigenIds: origenIds,
        modo: "recuperacion",
        origen: { tipo: "renovacion", ref_id: cid },
        unidades: reclamar.map(({ unidad: u }) => ({
          serial: u.serial || u.serial_norm || u.id,
          modelo: u.modelo_label || "",
          modelo_id: u.modelo_id || null,
          pool_doc_id: u.id,
        })),
        motivo: porSerial
          ? `Reemplazo ${contratoId} entregado — recuperar el/los equipos sustituidos`
          : sinEquipo
            ? `Renovación ${contratoId} (sin equipo) activada — recuperar los equipos que el vendedor declaró devueltos`
            : `Renovación ${contratoId} entregada — recuperar los equipos del contrato anterior`,
      });
      if (ordenId) {
        await db.collection("contratos").doc(cid).set({ orden_devolucion_id: ordenId }, { merge: true });
      }
    } catch (e) {
      logger.warn("[onEntregaTransicion] No se pudo crear la orden de devolución (no crítico)", { contratoId, message: e.message });
    }

    return null;
  }
);

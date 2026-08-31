// Avance "seamless" de las gestiones desde las órdenes de servicio (Ola 2).
// Requisito explícito de Alberto (2026-08-25): "todos los pasos deben ser
// seamless sin tener que regresar a apretar un botón cuando se completó un
// paso". Recepción y el vendedor trabajan sobre la OS; este trigger propaga
// cada hito al expediente:
//
//   · OS PROGRAMACIÓN (gestion.id) pasa a ENTREGADO AL CLIENTE →
//     cierre.programacion + cierre.entrega. Reemplazo: crea la orden de
//     DEVOLUCIÓN del saliente (el trámite avanza AUNQUE el radio no esté
//     físicamente — decisión §5 del correo 2026-08-25) y estampa el linaje
//     (reemplaza_a en el entrante, pendiente_devolucion en el saliente,
//     mapeo bajo la gestión). Demo: estado 'en_demo' + DEVOLUCIÓN de retorno.
//   · Orden de DEVOLUCIÓN (gestion.id) sin pendientes → cierre.entrada.
//     El check-in existente ya mueve el pool (devuelto_revision → ENTRADA de
//     inspección) — el radio no vuelve a alquiler hasta disposición de taller.
//
// El cierre 4/4 lo consuma onGestionWrite cuando ve los flags completos.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { pendientesDevolucion } = require("../../lib/devolucion");
const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");
const G = require("../../lib/gestiones");

const ENTREGADO = "ENTREGADO AL CLIENTE";
const norm = (s) => String(s || "").trim().toUpperCase();

// Linaje del reemplazo, directo al pool (espejo del patrón onMapeoWrite pero
// colgado de la gestión): entrante.reemplaza_a = saliente; saliente queda
// pendiente_devolucion. Deja además el registro en gestiones/{gid}/mapeos.
async function estamparLinaje(gid, g) {
  for (const it of (g.items || [])) {
    const saliente = String(it.serial_saliente || "").trim();
    const entrante = String(it.serial_nuevo || "").trim();
    if (!saliente || !entrante) continue;
    const movimiento = (notas) => ({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null,
      tipo: "reemplazo", de_estado: null, a_estado: null,
      ref: { tipo: "gestion", id: gid, label: gid },
      notas,
    });
    try {
      const rEnt = await pool.resolver(entrante, it.modelo_solicitado_id || it.modelo_id || null, it.modelo_solicitado || it.modelo || "");
      if (rEnt.data) {
        await rEnt.ref.set({
          reemplaza_a: pool.normSerial(saliente),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await rEnt.ref.collection("movimientos").add(movimiento(`Reemplaza a ${saliente} (gestión ${gid})`));
      }
    } catch (e) {
      logger.warn("[onOrdenWriteGestion] linaje del entrante falló", { gid, entrante, message: e.message });
    }
    try {
      const rSal = await pool.resolver(saliente, it.modelo_id || null, it.modelo || "");
      if (rSal.data) {
        await rSal.ref.set({
          pendiente_devolucion: true,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await rSal.ref.collection("movimientos").add(movimiento(`Reemplazada por ${entrante} — pendiente de devolución (gestión ${gid})`));
      }
    } catch (e) {
      logger.warn("[onOrdenWriteGestion] marca del saliente falló", { gid, saliente, message: e.message });
    }
    try {
      await db.collection("gestiones").doc(gid).collection("mapeos").add({
        saliente, entrante,
        modelo: it.modelo_solicitado || it.modelo || null,
        modelo_id: it.modelo_solicitado_id || it.modelo_id || null,
        contrato_doc_id: it.contrato_doc_id || null,
        contrato_id: it.contrato_id || null,
        auto: true,
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system",
      });
    } catch (e) {
      logger.warn("[onOrdenWriteGestion] mapeo no registrado", { gid, saliente, message: e.message });
    }
  }
}

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const ordenId = event.params.ordenId;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after || after.eliminado) return null;
    const gid = after.gestion?.id;
    if (!gid) return null;

    const gRef = db.collection("gestiones").doc(gid);

    // ── PROGRAMACIÓN entregada → entrega registrada en el expediente ─────
    const esProg = norm(after.tipo_de_servicio).startsWith("PROGRAMA");
    const entregadaAhora = esProg
      && norm(before?.estado_reparacion) !== ENTREGADO
      && norm(after.estado_reparacion) === ENTREGADO;
    if (entregadaAhora) {
      try {
        const gSnap = await gRef.get();
        if (!gSnap.exists) return null;
        const g = gSnap.data();

        const patch = {
          cierre: { ...(g.cierre || {}), programacion: true, entrega: true },
        };

        if (g.tipo === "reemplazo" && !g.ordenes?.devolucion_id) {
          const salientes = (g.items || [])
            .map(it => ({
              serial: it.serial_saliente,
              modelo: it.modelo || "",
              modelo_id: it.modelo_id || null,
              pool_doc_id: it.pool_doc_id_saliente || null,
            }))
            .filter(u => String(u.serial || "").trim());
          const contratos = Array.isArray(g.contratos_afectados) ? g.contratos_afectados : [];
          const devId = await crearOrdenDevolucion({
            clienteId: g.cliente_id,
            clienteNombre: g.cliente_nombre || "",
            contratoDocId: contratos[0] || null,
            contratoId: (g.items || []).find(i => i.contrato_id)?.contrato_id || null,
            contratoOrigenIds: contratos,
            modo: "recuperacion",
            origen: { tipo: "gestion_reemplazo", ref_id: gid },
            unidades: salientes,
            motivo: `Reemplazo ${gid} — recuperar el radio sustituido (el trámite avanza aunque el equipo no esté físicamente)`,
          });
          if (devId) {
            // La orden nace del creador genérico: se le cuelga el vínculo a la
            // gestión para que este mismo trigger cierre `entrada` al check-in.
            await db.collection("ordenes_de_servicio").doc(devId).set({
              gestion: { id: gid, tipo: "reemplazo" },
            }, { merge: true });
            patch.ordenes = { ...(g.ordenes || {}), devolucion_id: devId };
          }
          await estamparLinaje(gid, g);
          await G.registrarEvento(gid, "entrega",
            `Entrega registrada desde la OS ${ordenId}. Orden de devolución ${devId || "—"} creada para recuperar el/los saliente(s); linaje reemplaza_a estampado.`);
        } else if (g.tipo === "demo" && !g.ordenes?.devolucion_id) {
          patch.estado = "en_demo";
          // Fecha de salida del demo: es la base del recordatorio de retorno
          // cuando no hay fecha estimada (cron recordatorioOperativo sección I).
          patch.demo = { ...(g.demo || {}), fecha_entrega: new Date().toISOString() };
          const unidades = (g.demo?.seriales_asignados || [])
            .map(s => ({ serial: s.serial, modelo: s.modelo || "", modelo_id: s.modelo_id || null }))
            .filter(u => String(u.serial || "").trim());
          const devId = await crearOrdenDevolucion({
            clienteId: g.cliente_id,
            clienteNombre: g.cliente_nombre || "",
            contratoDocId: null, contratoId: null, contratoOrigenIds: [],
            modo: "recuperacion",
            origen: { tipo: "gestion_demo", ref_id: gid },
            unidades,
            motivo: `Demo ${gid} — retorno estimado ${g.demo?.fecha_devolucion_estimada || "sin fecha"}`,
          });
          if (devId) {
            await db.collection("ordenes_de_servicio").doc(devId).set({
              gestion: { id: gid, tipo: "demo" },
            }, { merge: true });
            patch.ordenes = { ...(g.ordenes || {}), devolucion_id: devId };
          }
          await G.registrarEvento(gid, "entrega",
            `Demo entregado desde la OS ${ordenId}; equipos en demo con el cliente. Orden de retorno ${devId || "—"} creada.`);
        } else if (g.tipo === "aumento") {
          // El tramo corre DESDE LA ENTREGA (decisión §8.2): aquí se estampan
          // fecha de inicio y vencimiento en las líneas del contrato que llevan
          // esta enmienda. El vencimiento del contrato-nivel (tramo original)
          // no se toca: cada tramo vence por su lado (decisión §8.3).
          const a = g.aumento || {};
          const meses = Number(a.duracion_meses || 0);
          if (a.contrato_doc_id && meses > 0) {
            try {
              const cRef = db.collection("contratos").doc(a.contrato_doc_id);
              await db.runTransaction(async (tx) => {
                const cSnap = await tx.get(cRef);
                if (!cSnap.exists) return;
                const equipos = Array.isArray(cSnap.data().equipos) ? [...cSnap.data().equipos] : [];
                const inicio = new Date();
                const fv = new Date(inicio.getTime());
                fv.setMonth(fv.getMonth() + meses);
                let tocadas = 0;
                for (const l of equipos) {
                  if (l.enmienda_id !== gid) continue;
                  l.vigencia = {
                    fecha_inicio: admin.firestore.Timestamp.fromDate(inicio),
                    duracion_meses: meses,
                    fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
                    estado: "vigente",
                    enmienda_id: gid,
                  };
                  tocadas++;
                }
                if (tocadas) tx.set(cRef, { equipos }, { merge: true });
              });
              await G.registrarEvento(gid, "entrega",
                `Entrega registrada desde la OS ${ordenId}. El tramo del aumento arranca hoy: ${meses} meses de vigencia propia en el contrato ${a.contrato_id || a.contrato_doc_id}.`);
            } catch (e) {
              logger.warn("[onOrdenWriteGestion] vigencia del tramo no estampada", { gid, message: e.message });
            }
          } else {
            await G.registrarEvento(gid, "entrega", `Entrega registrada desde la OS ${ordenId}.`);
          }
        } else {
          await G.registrarEvento(gid, "entrega", `Entrega registrada desde la OS ${ordenId}.`);
        }

        await gRef.set(patch, { merge: true });
        logger.info("[onOrdenWriteGestion] entrega propagada a la gestión", { gid, ordenId });
      } catch (e) {
        logger.error("[onOrdenWriteGestion] propagación de entrega falló", { gid, ordenId, message: e.message });
      }
      return null;
    }

    // ── DEVOLUCIÓN de la gestión sin pendientes → entrada completada ─────
    if (norm(after.tipo_de_servicio) === "DEVOLUCION") {
      try {
        const esperados = after.devolucion?.esperados || [];
        if (!esperados.length) return null;
        const pendientes = pendientesDevolucion(after.devolucion);
        const antes = before ? pendientesDevolucion(before.devolucion) : null;
        if (pendientes === 0 && antes !== 0) {
          const gSnap = await gRef.get();
          if (!gSnap.exists) return null;
          const g = gSnap.data();
          if (g.cierre?.entrada === true) return null;
          await gRef.set({
            cierre: { ...(g.cierre || {}), entrada: true },
            ...(g.tipo === "demo" ? { estado: "retorno" } : {}),
          }, { merge: true });
          await G.registrarEvento(gid, "entrada",
            g.tipo === "demo"
              ? `Retorno del demo resuelto en la devolución ${ordenId}; los equipos pasan por inspección antes de volver a Disponible.`
              : `Check-in de la devolución ${ordenId} completo: el/los saliente(s) quedaron resueltos (recibido / excepción). La ENTRADA de inspección sigue su cadena normal.`);
          logger.info("[onOrdenWriteGestion] entrada propagada a la gestión", { gid, ordenId });

          // ── TERMINACIÓN TOTAL: con la flota recuperada, el contrato se
          // CIERRA de verdad (2026-08-31, caso C COMUNICA: la devolución
          // completó pero el contrato quedaba 'activo' y la ficha del Centro
          // seguía mostrando la cuenta viva). Terminal 'vencido' — el mismo
          // de los cierres por recuperación (DEMO/TEMP/drenados). La custodia
          // residual (equipos PROPIOS del cliente, que no se recuperan)
          // suelta el vínculo al contrato: quedan como equipos del cliente.
          if (g.tipo === "baja" && Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length) {
            for (const cDocId of g.terminacion_total_de) {
              try {
                const cRef = db.collection("contratos").doc(cDocId);
                const cSnap = await cRef.get();
                if (!cSnap.exists) continue;
                const c = cSnap.data();
                if (["activo", "aprobado"].includes(c.estado)) {
                  await cRef.update({
                    estado: "vencido",
                    estado_previo: c.estado,
                    vencido_at: admin.firestore.FieldValue.serverTimestamp(),
                    vencido_motivo: `Terminación total ${gid}: flota recuperada en la devolución ${ordenId}`,
                    fecha_fin: admin.firestore.FieldValue.serverTimestamp(),
                    fecha_modificacion: new Date(),
                  });
                }
                // Jerarquía del linaje (2026-08-31): los ORÍGENES que esta
                // renovación consumió mueren con ella — sin esto, un origen
                // 'aprobado' escondido tras renovado_por_ids resucitaba como
                // contrato operativo al terminar la cuenta.
                let origCerrados = 0;
                const origenes = await db.collection("contratos")
                  .where("renovado_por_ids", "array-contains", cDocId).get();
                for (const od of origenes.docs) {
                  const oc = od.data();
                  if (!["activo", "aprobado"].includes(oc.estado)) continue;
                  origCerrados++;
                  await od.ref.update({
                    estado: "vencido",
                    estado_previo: oc.estado,
                    vencido_at: admin.firestore.FieldValue.serverTimestamp(),
                    vencido_motivo: `Terminación total ${gid}: era origen renovado por ${c.contrato_id || cDocId} — el linaje cierra con la cuenta`,
                    fecha_modificacion: new Date(),
                  }).catch((e2) => logger.warn("[onOrdenWriteGestion] origen no cerrado", { gid, origen: od.id, message: e2.message }));
                }
                const poolSnap = await db.collection("equipos_pool")
                  .where("asignacion.contrato_doc_id", "==", cDocId).get();
                let sueltos = 0;
                for (const pd of poolSnap.docs) {
                  try {
                    await pd.ref.update({
                      "asignacion.contrato_doc_id": null,
                      "asignacion.contrato_id": "",
                    });
                    sueltos++;
                  } catch (e2) {
                    logger.warn("[onOrdenWriteGestion] no soltó custodia residual", { gid, serial: pd.id, message: e2.message });
                  }
                }
                await G.registrarEvento(gid, "terminacion",
                  `Terminación total: el contrato ${c.contrato_id || cDocId} pasa a CERRADO (vencido) con la flota recuperada${origCerrados ? `; ${origCerrados} contrato(s) origen del linaje cierran con él` : ""}${sueltos ? `; ${sueltos} equipo(s) propios del cliente sueltan el vínculo al contrato` : ""}.`);
                logger.info("[onOrdenWriteGestion] terminación total aplicada", { gid, contrato: cDocId, sueltos });
              } catch (e2) {
                logger.error("[onOrdenWriteGestion] terminación total falló", { gid, contrato: cDocId, message: e2.message });
              }
            }
          }
        }
      } catch (e) {
        logger.error("[onOrdenWriteGestion] propagación de entrada falló", { gid, ordenId, message: e.message });
      }
    }

    return null;
  }
);

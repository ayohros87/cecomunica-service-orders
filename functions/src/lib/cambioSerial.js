/* =============================================================
   Cambio de serial — aplicar la corrección (gestión tipo GC).

   Qué corrige: el sistema dice que el cliente tiene el serial X y en
   realidad tiene el Y. Pasa por un dígito mal tecleado al asignar, o
   porque bodega cambió el radio en el mostrador antes de entregarlo y
   nadie lo dijo. NO es un reemplazo: no sale nada del estante ni hay
   que ir a buscar el radio viejo a donde el cliente — el radio ya está
   donde tiene que estar; lo que está mal es el papel.

   Cómo se aplica: reescribiendo el serial EN LA FILA del contrato
   (`contratos/{cid}/seriales/{sid}`). Ese es el camino de siempre y
   `onSerialWrite` ya sabe hacer el intercambio completo: suelta el
   viejo a bodega marcado "verificar físicamente" y asigna el nuevo con
   el estado que corresponda (en_cliente si el contrato ya tuvo
   entrega, asignado si no). Un solo dueño del camino pool←contrato.

   Equipos sin contrato (custodia declarada): no hay fila que reescribir,
   así que ahí sí se mueve el pool directo.

   Nace de la Ola 5 de docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md
   y sustituye a `contratos/{cid}/seriales_cambios` (canal viejo, cerrado
   el 2026-09-15: vivía colgado del contrato y exigía estado 'aprobado').
   ============================================================= */
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const pool = require("../domain/equiposPool");
// Las preguntas puras viven en domain/ para poder probarse sin credenciales.
const { itemsAplicables, asignacionCompleta } = require("../domain/cambioSerial");

// ¿El contrato que dice el ítem es de ESTE cliente? El `contrato_doc_id` viaja
// en el ítem, o sea que lo escribe el navegador, y aplicar la corrección
// reescribe una fila de seriales de ese contrato. Sin esta comprobación, una
// gestión mal armada (o armada a mano) le cambiaría los seriales al contrato
// de otro cliente en silencio. Las reglas no lo pueden mirar —tendrían que
// leer el contrato—, así que el candado vive aquí.
async function contratoEsDelCliente(cid, clienteId) {
  const snap = await db.collection("contratos").doc(cid).get();
  if (!snap.exists) return { ok: false, motivo: `el contrato ${cid} no existe` };
  const dueno = snap.data()?.cliente_id || "";
  if (!clienteId || dueno !== clienteId) {
    return { ok: false, motivo: `el contrato ${cid} no es de este cliente` };
  }
  return { ok: true, motivo: "" };
}

// La fila del contrato que lista ESE serial. Se busca por identidad
// normalizada (Serial.norm) porque la fila guarda el serial tal como se
// tecleó — con guiones, espacios o minúsculas.
async function filaDelSerial(cid, serialViejo) {
  const norm = pool.normSerial(serialViejo);
  if (!norm) return null;
  const snap = await db.collection("contratos").doc(cid).collection("seriales").get();
  return snap.docs.find((d) => pool.normSerial(d.data()?.serial) === norm) || null;
}

/**
 * Aplica la corrección de una gestión `cambio_serial`.
 * Idempotente por ítem: si la fila del contrato ya lista el serial nuevo
 * (o el viejo ya no aparece), ese ítem se da por aplicado y sigue.
 *
 * @returns {{aplicados: Array, fallidos: Array}}
 */
async function aplicar(gid, g) {
  const aplicados = [];
  const fallidos = [];

  for (const it of itemsAplicables(g)) {
    const anterior = String(it.serial || "").trim();
    const nuevo = String(it.serial_nuevo || "").trim();
    const modelo = it.modelo || "";
    const modeloId = it.modelo_id || null;
    const cid = it.contrato_doc_id || null;

    try {
      if (cid) {
        const dueno = await contratoEsDelCliente(cid, g.cliente_id || "");
        if (!dueno.ok) {
          logger.error("[cambioSerial] contrato ajeno al cliente de la gestión", { gid, cid, cliente: g.cliente_id });
          fallidos.push({ anterior, nuevo, motivo: dueno.motivo });
          continue;
        }
        const fila = await filaDelSerial(cid, anterior);
        if (!fila) {
          // O ya se aplicó (reintento del trigger) o el serial nunca estuvo
          // en ese contrato. Se distingue mirando si el nuevo ya está ahí.
          const yaEsta = await filaDelSerial(cid, nuevo);
          if (yaEsta) {
            aplicados.push({ anterior, nuevo, modelo, contrato_id: it.contrato_id || "", via: "ya_aplicado" });
            continue;
          }
          fallidos.push({ anterior, nuevo, motivo: `el contrato ${it.contrato_id || cid} no lista ese serial` });
          continue;
        }
        // Reescribir la fila: onSerialWrite hace el intercambio en el pool.
        await fila.ref.set({
          serial: nuevo,
          ...(modelo ? { modelo } : {}),
          ...(modeloId ? { modelo_id: modeloId } : {}),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: null,
          corregido_por_gestion: gid,
        }, { merge: true });
        // Auditoría en el mismo sitio donde vive el historial de seriales del
        // contrato: sobrescribir una fila borra el valor anterior.
        await db.collection("contratos").doc(cid).collection("seriales_historial").add({
          origen: "gestion_cambio_serial",
          gestion_id: gid,
          agregados: [{ serial: nuevo, modelo }],
          eliminados: [{ serial: anterior, modelo }],
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system",
        });
        aplicados.push({ anterior, nuevo, modelo, contrato_id: it.contrato_id || "", via: "contrato" });
      } else {
        // Sin contrato hay dos mundos distintos y solo uno se corrige aquí.
        // El que NO: un radio que salió en un DEMO (caso R. SMITH ALTA PLAZA,
        // 2026-09-15). Corregirlo dejaría el expediente del demo y su orden de
        // programación diciendo los seriales viejos — media corrección, que es
        // peor que ninguna. Para cambiar los radios de un demo se anula y se
        // abre con los correctos. La página ya no los ofrece; esto es el
        // candado de verdad, porque el ítem lo arma el navegador.
        const { data: ficha } = await pool.resolver(anterior, modeloId, modelo);
        if (ficha?.asignacion?.gestion_doc_id && !ficha.asignacion.contrato_doc_id) {
          fallidos.push({ anterior, nuevo,
            motivo: `el equipo está tomado por la gestión ${ficha.asignacion.gestion_doc_id} (demo): ahí se cambia anulándola, no corrigiendo el serial` });
          continue;
        }
        // Custodia sin contrato: no hay fila que reescribir. El vínculo del
        // viejo se suelta y el nuevo nace/queda en poder del cliente.
        await pool.soltarDelCliente(anterior, modeloId, modelo, {
          cliente_id: g.cliente_id || "",
          refMov: { tipo: "gestion", id: gid, label: gid },
          notas: `Serial corregido por la gestión ${gid} — el equipo real es ${nuevo}`,
          motivo: "corregido_por_cambio_serial",
        });
        await pool.upsertContacto({
          serial: nuevo,
          modelo_id: modeloId,
          modelo_label: modelo,
          estado: pool.ESTADOS.EN_CLIENTE,
          noTocarDesde: [pool.ESTADOS.EN_TALLER],
          tipo: "correccion_serial",
          refMov: { tipo: "gestion", id: gid, label: gid },
          origen: "correccion_serial",
          notas: `Corrección de la gestión ${gid}: el cliente tenía este equipo, no ${anterior}`,
          extra: {
            asignacionSiFalta: {
              contrato_doc_id: null, contrato_id: "",
              cliente_id: g.cliente_id || "", cliente_nombre: g.cliente_nombre || "",
            },
          },
        });
        aplicados.push({ anterior, nuevo, modelo, contrato_id: "", via: "custodia" });
      }

      // Equipo defectuoso: el saliente no es stock bueno — entra en
      // cuarentena de inspección en vez de quedarse en el estante. Converge
      // sin importar el orden con la liberación de onSerialWrite: en_bodega
      // también está en soloDesde.
      if (it.motivo_codigo === "defectuoso") {
        try {
          const res = await pool.transicionar(anterior, modeloId, modelo, {
            aEstado: pool.ESTADOS.DEVUELTO,
            soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.EN_BODEGA],
            condicion: (d) => !d.asignacion || !d.asignacion.contrato_doc_id || d.asignacion.contrato_doc_id === cid,
            tipo: "devolucion",
            refMov: { tipo: "gestion", id: gid, label: gid },
            notas: `Entrada por cambio de serial (equipo defectuoso) — gestión ${gid}, pendiente de inspección`,
            extra: { asignacion: null, verificado: false, entrada: { condicion: "danado", gestion_id: gid } },
          });
          logger.info("[cambioSerial] saliente defectuoso a inspección", { gid, serial: anterior, res });
        } catch (e) {
          logger.warn("[cambioSerial] cuarentena del saliente falló (no crítico)", { gid, serial: anterior, message: e.message });
        }
      }
    } catch (e) {
      logger.error("[cambioSerial] ítem no aplicado", { gid, anterior, nuevo, message: e.message });
      fallidos.push({ anterior, nuevo, motivo: e.message });
    }
  }

  return { aplicados, fallidos };
}

module.exports = { aplicar, asignacionCompleta, itemsAplicables };

/* =============================================================
   Corregir los seriales de una gestión ya asignada (2026-09-16).

   El hueco que tapa: una vez que bodega asigna los seriales de un
   aumento, un demo o un reemplazo, la OS de programación sale sola y
   el expediente deja de ser editable. Si bodega tecleó mal un serial,
   cambió el radio en el mostrador, o simplemente hay que mandar otros
   — caso R. SMITH ALTA PLAZA, 2026-09-15 — no había forma de
   arreglarlo: tocaba anular la gestión entera y rehacerla.

   La otra puerta (editar el serial DENTRO de la orden) existía y era
   peor: cambiaba la orden, dejaba la gestión diciendo el serial viejo,
   y el pool daba de alta una ficha por contacto — un dedazo creaba un
   equipo inventado. De ahí salieron las tres fichas fantasma de
   R. SMITH. Esa puerta ahora manda para acá.

   La regla de oro: **el nuevo toma el lugar EXACTO del viejo**. Hereda
   su estado, su asignación y su orden — así no hay que enumerar casos
   (en taller, asignado, con el cliente) ni inventar a dónde va cada
   uno. Y el viejo sale al estante.

   Lo único que cambia según el momento es la MARCA del que sale: si la
   gestión ya se entregó, el radio anduvo fuera y vuelve marcado
   "verificar físicamente"; si nunca salió, estaba en el estante y ahí
   sigue.
   ============================================================= */
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const pool = require("../domain/equiposPool");

const norm = (s) => pool.normSerial(s);

// Las órdenes que tocó la gestión: la corrección tiene que llegar a
// TODAS, no solo a la de programación. Una devolución que espera el
// serial viejo deja al cliente devolviendo un radio que el sistema no
// reconoce (y el check-in cae en cuarentena).
function ordenesDe(g) {
  const o = g?.ordenes || {};
  return [...new Set([
    ...(o.programacion_ids || (o.programacion_id ? [o.programacion_id] : [])),
    ...(o.devolucion_id ? [o.devolucion_id] : []),
    ...(o.entrada_id ? [o.entrada_id] : []),
  ].filter(Boolean))];
}

// Dónde vive el serial según el tipo. Devuelve el patch de la gestión
// con los reemplazos aplicados, o null si ese par no aparece.
function patchGestion(g, mapa) {
  const cambia = (s) => mapa.get(norm(s)) || null;
  if (g.tipo === "reemplazo") {
    let toco = false;
    const items = (g.items || []).map((it) => {
      const n = cambia(it.serial_nuevo);
      if (!n) return it;
      toco = true;
      return {
        ...it, serial_nuevo: n.nuevo, pool_doc_id_nuevo: n.pool_doc_id || it.pool_doc_id_nuevo || null,
        // El modelo del entrante es el de su ficha (lib/gestiones.modeloEntrante).
        ...(n.modelo_id_nuevo ? { modelo_id_nuevo: n.modelo_id_nuevo, modelo_nuevo: n.modelo_nuevo || "" } : {}),
      };
    });
    return toco ? { items } : null;
  }
  const clave = g.tipo === "demo" ? "demo" : g.tipo === "aumento" ? "aumento" : null;
  if (!clave) return null;
  const lista = g[clave]?.seriales_asignados || [];
  let toco = false;
  const nuevos = lista.map((s) => {
    const n = cambia(s.serial);
    if (!n) return s;
    toco = true;
    return { ...s, serial: n.nuevo, pool_doc_id: n.pool_doc_id || n.nuevo };
  });
  return toco ? { [`${clave}.seriales_asignados`]: nuevos } : null;
}

// El serial en la orden vive bajo DOS claves (`serial` lo leen los
// triggers del pool y los renders; `numero_de_serie` es el alias legacy
// de escritura). Editar una sola deja al pool rastreando la otra — la
// misma trampa que ya documenta ordenesService.updateEquipmentField.
async function corregirOrden(ordenId, mapa, gid) {
  const ref = db.collection("ordenes_de_servicio").doc(ordenId);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const o = snap.data();
  let tocados = 0;
  const logs = [];

  const equipos = (o.equipos || []).map((e) => {
    const n = mapa.get(norm(e.serial || e.numero_de_serie));
    if (!n) return e;
    tocados++;
    logs.push({
      action: "CORREGIR_SERIAL", by: "system:gestiones", by_email: null,
      at_iso: new Date().toISOString(), de: String(e.serial || ""), a: n.nuevo,
      motivo: `Corrección de seriales de la gestión ${gid}`,
    });
    return { ...e, serial: n.nuevo, numero_de_serie: n.nuevo };
  });

  // Devolución: los esperados se persiguen por serial.
  let devolucion = o.devolucion;
  if (devolucion?.esperados?.length) {
    const esperados = devolucion.esperados.map((x) => {
      const n = mapa.get(norm(x.serial));
      if (!n) return x;
      tocados++;
      return { ...x, serial: n.nuevo, pool_doc_id: n.pool_doc_id || x.pool_doc_id || null };
    });
    devolucion = { ...devolucion, esperados };
  }

  if (!tocados) return 0;
  await ref.update({
    equipos,
    ...(devolucion ? { devolucion } : {}),
    fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
    ...(logs.length ? { os_logs: admin.firestore.FieldValue.arrayUnion(...logs) } : {}),
  });
  return tocados;
}

/**
 * Aplica los pares {anterior, nuevo} sobre una gestión, sus órdenes y el pool.
 * @returns {{aplicados: Array, fallidos: Array}}
 */
async function aplicar(gid, g, pares) {
  const aplicados = [];
  const fallidos = [];
  // ¿El radio llegó a salir? Decide la marca del que vuelve al estante.
  const entregado = g.cierre?.entrega === true;

  for (const par of pares || []) {
    const anterior = String(par?.anterior || "").trim();
    const nuevo = String(par?.nuevo || "").trim();
    const modelo = par?.modelo || "";
    const modeloId = par?.modelo_id || null;
    if (!anterior || !nuevo || norm(anterior) === norm(nuevo)) continue;

    try {
      const { data: viejo } = await pool.resolver(anterior, modeloId, modelo);
      if (!viejo) { fallidos.push({ anterior, nuevo, motivo: `${anterior} no existe en el inventario` }); continue; }

      const { data: entrante } = await pool.resolver(nuevo, modeloId, modelo);
      if (!entrante) { fallidos.push({ anterior, nuevo, motivo: `${nuevo} no existe en el inventario — dalo de alta antes de corregir` }); continue; }
      if (entrante.estado !== pool.ESTADOS.EN_BODEGA) {
        fallidos.push({ anterior, nuevo, motivo: `${nuevo} no está en bodega (${entrante.estado})` });
        continue;
      }

      // El entrante toma el lugar exacto del saliente: mismo estado, misma
      // asignación, misma orden. Sin esto habría que adivinar a dónde va
      // según en qué punto del flujo esté la gestión.
      const r1 = await pool.transicionar(nuevo, modeloId, modelo, {
        aEstado: viejo.estado,
        soloDesde: [pool.ESTADOS.EN_BODEGA],
        tipo: "correccion_serial",
        refMov: { tipo: "gestion", id: gid, label: gid },
        notas: `Corrección de la gestión ${gid}: toma el lugar de ${anterior}`,
        extra: {
          asignacion: viejo.asignacion || null,
          ...(viejo.orden_actual_id ? { orden_actual_id: viejo.orden_actual_id } : {}),
        },
      });
      if (r1 !== "transicion") {
        fallidos.push({ anterior, nuevo, motivo: `no se pudo mover ${nuevo} en el inventario (${r1})` });
        continue;
      }

      // Y el saliente vuelve al estante. Solo se marca "por verificar" si de
      // verdad anduvo fuera: si la gestión nunca se entregó, el radio estaba
      // en bodega y sigue estando.
      await pool.transicionar(anterior, modeloId, modelo, {
        aEstado: pool.ESTADOS.EN_BODEGA,
        soloDesde: [viejo.estado],
        tipo: "correccion_serial",
        refMov: { tipo: "gestion", id: gid, label: gid },
        notas: entregado
          ? `Corregido en la gestión ${gid}: el radio que salió fue ${nuevo} — verificar físicamente`
          : `Corregido en la gestión ${gid}: sale ${nuevo} en su lugar`,
        extra: { asignacion: null, orden_actual_id: null, ...(entregado ? { verificado: false } : {}) },
      });

      aplicados.push({ anterior, nuevo, modelo, modelo_id: modeloId,
        pool_doc_id: entrante.id || pool.normSerial(nuevo), hereda_estado: viejo.estado,
        modelo_id_nuevo: entrante.modelo_id || null, modelo_nuevo: entrante.modelo_label || "" });
    } catch (e) {
      logger.error("[correccionGestion] par no aplicado", { gid, anterior, nuevo, error: e.message });
      fallidos.push({ anterior, nuevo, motivo: e.message });
    }
  }

  if (!aplicados.length) return { aplicados, fallidos, ordenes: 0 };

  // El mapa va por identidad de serial, no por texto: la gestión guarda el
  // serial como lo tecleó bodega y la orden puede tenerlo con otro formato.
  const mapa = new Map(aplicados.map((a) => [norm(a.anterior), a]));

  const patch = patchGestion(g, mapa);
  if (patch) await db.collection("gestiones").doc(gid).update(patch);

  let ordenes = 0;
  for (const oid of ordenesDe(g)) {
    try {
      ordenes += await corregirOrden(oid, mapa, gid);
    } catch (e) {
      logger.error("[correccionGestion] orden no corregida", { gid, orden: oid, error: e.message });
      fallidos.push({ anterior: "—", nuevo: "—", motivo: `la orden ${oid} no se pudo corregir: ${e.message}` });
    }
  }

  return { aplicados, fallidos, ordenes };
}

module.exports = { aplicar, ordenesDe, patchGestion };

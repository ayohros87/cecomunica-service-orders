// Traspaso de equipo entre un contrato ANULADO y el contrato que lo SUSTITUYE.
//
// Una anulación por sustitución (el papel se rehace: precio mal calculado,
// representante legal equivocado, modelo mal escrito) no mueve un solo radio.
// Lo único que cambia es de qué contrato cuelga la ficha. Sin este traspaso las
// unidades se quedan colgando de un contrato muerto y el contrato vivo nace sin
// equipos ligados — que es exactamente como quedó ALQ20260715-01 /
// ALQ20260806-03 (SOCIEDAD ISRAELITA, 32 radios) el 2026-08-06.
//
// El traspaso NO escribe el pool a mano: copia las filas de serial a la
// subcolección del contrato nuevo y deja que onSerialWrite haga el resto
// (upsertContacto → asignación nueva + movimiento `reasignacion` en el kardex).
// Un solo camino, y el historial queda contado por el mismo código que cuenta
// todos los demás.
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL, inventarioEmailTo } = require("./inventario");

// Clave de modelo para casar un serial con el renglón que le corresponde en el
// contrato sustituto: el id del modelo cuando lo hay, y si no el nombre
// apretado (mismo criterio que devolucion.js — "PNC360S-R" == "pnc360s r").
const claveModelo = (modeloId, modelo) => modeloId
  || String(modelo == null ? "" : modelo).trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  || "";

/**
 * Cupo de seriales por modelo del contrato: cuántas unidades admite cada
 * renglón. Un contrato puede repetir el mismo modelo en varios renglones
 * (precios distintos por tramo) — ALQ20260812-01 lleva "3x HYT-P50" y "2x
 * HYT-P50" separados—, así que se suman por modelo, no por renglón.
 * @returns {Map<string, {label:string, cantidad:number}>|null} null si el
 *          contrato no declara equipos
 */
function cupoPorModelo(contrato) {
  const lineas = (contrato && contrato.equipos) || [];
  if (!Array.isArray(lineas) || !lineas.length) return null;
  const cupo = new Map();
  for (const l of lineas) {
    const n = Number((l && l.cantidad) || 0);
    if (n <= 0) continue;
    const k = claveModelo(l.modelo_id, l.modelo);
    if (!k) continue;
    const prev = cupo.get(k);
    if (prev) prev.cantidad += n;
    else cupo.set(k, { label: (l.modelo || k), cantidad: n });
  }
  return cupo.size ? cupo : null;
}

/**
 * Pasa al contrato sustituto las unidades que siguen con el cliente.
 *
 * Es deliberadamente cobarde: ante cualquier duda no hace nada y devuelve el
 * motivo, porque escribir en un contrato que NO es el que se está anulando es
 * una acción con consecuencias (dispara onSerialWrite, mueve el pool, habilita
 * facturación). Prefiere dejar el trabajo a la vista de un humano antes que
 * adivinar.
 *
 * El sustituto NO tiene por qué ser un calco del anulado: rehacer el papel es
 * también la vía para corregir la cantidad. ALQ20260812-01 (MAGEN DAVID) nació
 * con 10 unidades donde el anulado tenía 5. Por eso el traspaso es PARCIAL por
 * diseño: cada serial entra por el renglón de SU modelo y hasta el cupo de ese
 * renglón; lo que no cabe se reporta en `pendientes` en vez de colarse, y el
 * contrato solo se marca "asignados" cuando de verdad quedó completo — si no,
 * la pantalla de seriales se cerraría con la mitad del contrato sin cargar.
 *
 * @param {Object} p
 * @param {string} p.origenId — doc id del contrato anulado
 * @param {Object} p.origen — datos del contrato anulado
 * @param {string} p.sustitutoId — doc id del contrato que lo sustituye
 * @param {Array}  p.unidades — fichas que continúan con el cliente
 *        [{ serial, modelo, modelo_id, pool_doc_id }]
 * @returns {Promise<{ok:boolean, motivo?:string, copiados?:number,
 *          faltan?:number, completo?:boolean,
 *          pendientes?:Array<{serial:string, motivo:string}>}>}
 */
async function traspasarASustituto({ origenId, origen, sustitutoId, unidades }) {
  if (!sustitutoId)        return { ok: false, motivo: "sin contrato sustituto indicado" };
  if (sustitutoId === origenId) return { ok: false, motivo: "el sustituto es el mismo contrato" };
  if (!unidades || !unidades.length) return { ok: false, motivo: "sin unidades que traspasar" };

  const ref  = db.collection("contratos").doc(sustitutoId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, motivo: "el contrato sustituto no existe" };
  const s = snap.data() || {};

  // Candados. Cada uno tapa una forma distinta de hacer daño:
  if (s.deleted === true)  return { ok: false, motivo: "el sustituto está borrado" };
  if (s.estado === "anulado") return { ok: false, motivo: "el sustituto también está anulado" };
  // Traspasar a OTRO cliente no es una sustitución, es un traslado de equipo —
  // y ese sí necesita decisión humana (y probablemente otro contrato).
  if (s.cliente_id !== origen.cliente_id) {
    return { ok: false, motivo: "el sustituto es de otro cliente" };
  }
  // Seriales YA CONFIRMADOS en el sustituto: alguien cerró esa pantalla a
  // conciencia y el contrato quedó bajo el candado de solo-lectura. Escribir
  // encima sería pisar una decisión humana por la puerta de atrás.
  // (Un sustituto con seriales a medio cargar SÍ se completa: es justo lo que
  // pasa cuando el contrato nuevo crece y le cargan a mano los renglones que el
  // anulado no cubría.)
  if (s.seriales_estado === "asignados") {
    return { ok: false, motivo: "el sustituto ya tiene sus seriales confirmados" };
  }

  // El sustituto hereda la ENTREGA del original: el cliente ya tiene los radios
  // en la mano, y sin esta marca onSerialWrite los degradaría a
  // `asignado_contrato` — diciendo que están apartados en bodega.
  const patch = {
    sustituye_a_id: origenId,
    sustituye_a_contrato_id: origen.contrato_id || origenId,
    sustitucion_at: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (origen.entrega_confirmada === true) {
    patch.entrega_confirmada = true;
    patch.fecha_entrega_ultima = origen.fecha_entrega_ultima || null;
    // Candado contra onEntregaTransicion: si el sustituto quedó vinculado al
    // anulado como contrato ORIGEN (el flujo de contrato nuevo lo hace desde el
    // 2026-08-11), confirmar la entrega le haría reclamar como devolución el
    // equipo del origen — el mismo tiquete falso que esta rama existe para
    // evitar, entrando por la puerta de atrás. `transicion_auto_at` es el guard
    // que ese trigger ya consulta.
    patch.transicion_auto_at = admin.firestore.FieldValue.serverTimestamp();
    patch.transicion_auto_motivo = "sustitucion_de_contrato";
  }
  await ref.set(patch, { merge: true });

  // Cupo del sustituto, descontando lo que ya tenga cargado. Sin renglones de
  // equipo declarados no hay con qué casar: se copia todo (comportamiento
  // anterior) y que el humano revise.
  const cupo = cupoPorModelo(s);
  const yaCargados = await ref.collection("seriales").get();
  const yaSeriales = new Set();
  for (const d of yaCargados.docs) {
    const y = d.data() || {};
    const ser = String(y.serial || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (ser) yaSeriales.add(ser);
    if (!cupo) continue;
    const l = cupo.get(claveModelo(y.modelo_id, y.modelo));
    if (l) l.cantidad = Math.max(0, l.cantidad - 1);
  }

  // Las filas de serial, una por una: cada `set` dispara onSerialWrite, que
  // reapunta la ficha del pool. En lote sería igual de correcto pero mucho más
  // difícil de leer en los logs cuando algo falla.
  let copiados = 0;
  const pendientes = [];
  for (const u of unidades) {
    const serial = String(u.serial || "").trim();
    if (!serial) continue;
    // Idempotencia: re-ejecutar el traspaso (o completarlo tras arreglar el
    // cupo) no debe duplicar la fila ni volver a disparar el pool.
    if (yaSeriales.has(serial.toUpperCase().replace(/[^A-Z0-9]/g, ""))) continue;
    if (cupo) {
      const k = claveModelo(u.modelo_id, u.modelo);
      const linea = cupo.get(k);
      if (!linea || linea.cantidad <= 0) {
        // O el modelo no está en el contrato nuevo, o su renglón ya se llenó.
        // Las dos son decisión de negocio, no un detalle que taparle al humano:
        // el radio se queda ligado al contrato anulado y sale en el aviso.
        pendientes.push({
          serial,
          motivo: linea
            ? `el renglón de ${u.modelo || k} ya está completo en el sustituto`
            : `el sustituto no tiene renglón para ${u.modelo || "ese modelo"}`,
        });
        continue;
      }
      linea.cantidad--;
    }
    await ref.collection("seriales").add({
      serial,
      modelo: u.modelo || "",
      modelo_id: u.modelo_id || null,
      contrato_doc_id: sustitutoId,
      contrato_id: s.contrato_id || "",
      cliente_id: origen.cliente_id || "",
      cliente_nombre: origen.cliente_nombre || "",
      source: "sustitucion_contrato",
      migrado_de_contrato: origenId,
      created_by: "system:sustitucion",
      updated_by: "system:sustitucion",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    copiados++;
  }

  // ¿Quedó completo? El cupo restante lo dice: si sobra alguna unidad por
  // cargar, el contrato NO se marca como asignado.
  const restantes = cupo
    ? [...cupo.values()].filter((l) => l.cantidad > 0).map((l) => ({ modelo: l.label, cantidad: l.cantidad }))
    : [];
  const faltan = restantes.reduce((a, l) => a + l.cantidad, 0);
  const completo = faltan === 0;

  if (completo) {
    // Contrato completo: se escribe la SEÑAL (`seriales_estado/current`), no el
    // campo del padre. La señal es la que dispara onSerialesAsignadasSendPdf —
    // el correo de aprobación a activaciones con el PDF—, que es justo lo que
    // debe pasar: para activaciones este contrato ya tiene todos sus seriales,
    // llegaran de donde llegaran. El propio trigger espeja `seriales_estado` en
    // el padre, y su candado de idempotencia (`seriales_pdf_enviado_at`) evita
    // el reenvío si a este contrato ya se le había mandado.
    await ref.collection("seriales_estado").doc("current").set({
      estado: "asignados",
      omisiones: [],
      por: "system:sustitucion",
      origen_sustitucion: origen.contrato_id || origenId,
      at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await ref.set({
      seriales_estado: "asignados",
      seriales_asignados_at: admin.firestore.FieldValue.serverTimestamp(),
      seriales_asignados_por: "system:sustitucion",
      seriales_omitidos_count: 0,
      sustitucion_seriales_faltan: admin.firestore.FieldValue.delete(),
    }, { merge: true });
  } else {
    // El sustituto creció (5 → 10 en MAGEN DAVID): el traspaso resolvió la
    // parte que venía del contrato anulado y el resto lo carga inventario por
    // la pantalla de siempre. Marcarlo "asignados" aquí habría echado el
    // candado de solo-lectura sobre un contrato a medio llenar, y solo un
    // administrador habría podido reabrirlo.
    await ref.set({
      sustitucion_seriales_faltan: faltan,
      sustitucion_seriales_desde: origen.contrato_id || origenId,
    }, { merge: true });
  }

  // Bodega se entera SIEMPRE: unos seriales aparecieron solos en un contrato
  // que ellos no tocaron. Sin este aviso, el traspaso automático es justo el
  // tipo de magia que hace que nadie confíe en la pantalla de seriales.
  await avisarBodega({
    sustitutoId, sustituto: s, origen, origenId,
    copiados, restantes, completo, pendientes,
  }).catch((e) => logger.warn("[sustitucionContrato] Aviso a bodega no encolado (no crítico)",
    { sustitutoId, message: e.message }));

  logger.info("[sustitucionContrato] Equipo traspasado al contrato sustituto", {
    origenId, sustitutoId, copiados, faltan, sinCupo: pendientes.length,
  });
  return { ok: true, copiados, faltan, completo, pendientes, restantes };
}

const esc = (v) => String(v ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

/**
 * Encola el aviso a inventario/bodega del traspaso automático: qué seriales
 * entraron solos al contrato nuevo, de qué contrato venían y qué falta todavía.
 * Nunca lanza hacia afuera (el caller lo envuelve): un correo no puede tumbar
 * un traspaso que ya escribió en Firestore.
 */
async function avisarBodega({ sustitutoId, sustituto, origen, origenId, copiados, restantes, completo, pendientes }) {
  const nuevoId  = sustituto.contrato_id || sustitutoId;
  const viejoId  = origen.contrato_id || origenId;
  const cliente  = sustituto.cliente_nombre || origen.cliente_nombre || "Cliente";
  const urlSeriales = `${APP_BASE_URL}/almacen/index.html?tab=asignar&contrato=${encodeURIComponent(sustitutoId)}`;

  const filasFaltan = restantes.map((l) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;">${esc(l.modelo)}</td>
         <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;"><b>${l.cantidad}</b></td></tr>`).join("");

  const bloqueEstado = completo
    ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #059669;border-radius:10px;background:#ECFDF5;font:600 15px Arial,sans-serif;color:#065F46;">
         El contrato quedó COMPLETO con este traspaso. No hay nada pendiente por asignar —
         ya salió el correo de aprobación a activaciones.
       </div>`
    : `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #D97706;border-radius:10px;background:#FFFBEB;font:600 15px Arial,sans-serif;color:#92400E;">
         Faltan ${restantes.reduce((a, l) => a + l.cantidad, 0)} serial(es) por asignar en ${esc(nuevoId)}.
         El correo a activaciones sale cuando se completen.
       </div>
       <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:0 0 16px;">
         <tr><td style="padding:6px 0;border-bottom:2px solid #ddd;"><b>Modelo</b></td>
             <td style="padding:6px 0;border-bottom:2px solid #ddd;text-align:right;"><b>Faltan</b></td></tr>
         ${filasFaltan}
       </table>`;

  const bloqueSinCupo = (pendientes || []).length
    ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#991B1B;">
         <b>${pendientes.length} unidad(es) del contrato anulado no cupieron</b> en ningún renglón del
         contrato nuevo y siguen ligadas a ${esc(viejoId)}:
         ${esc(pendientes.map((p) => p.serial).join(", "))}.
       </p>`
    : "";

  await db.collection("mail_queue").add({
    to: await inventarioEmailTo(),
    subject: `Seriales traspasados automáticamente: ${nuevoId} – ${cliente}`,
    preheader: completo
      ? `${nuevoId} quedó completo con ${copiados} serial(es) del contrato anulado ${viejoId}`
      : `${nuevoId}: ${copiados} serial(es) traspasados, faltan ${restantes.reduce((a, l) => a + l.cantidad, 0)}`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#1F2937;">Seriales traspasados por anulación</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        El contrato <b>${esc(viejoId)}</b> se anuló por SUSTITUCIÓN y sus equipos pasaron solos al contrato
        <b>${esc(nuevoId)}</b> (${esc(cliente)}). Los radios no se movieron de sitio: solo cambió de qué
        contrato cuelgan.
      </p>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        <b>${copiados}</b> serial(es) se asignaron automáticamente.
      </p>
      ${bloqueEstado}
      ${bloqueSinCupo}
    `,
    ctaUrl: urlSeriales,
    ctaLabel: completo ? "Ver seriales del contrato" : "Asignar los seriales que faltan",
    meta: {
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      source: "sustitucion-contrato-bodega",
      contrato_id: nuevoId,
      contrato_doc_id: sustitutoId,
      origen_contrato_id: viejoId,
      copiados, completo,
    },
    status: "queued",
  });
  logger.info("[sustitucionContrato] Aviso a bodega encolado", { sustitutoId, copiados, completo });
}

module.exports = { traspasarASustituto, cupoPorModelo };

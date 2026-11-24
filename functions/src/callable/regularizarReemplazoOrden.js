// regularizarReemplazoOrden — el taller cambió el radio del cliente en una
// orden de PROGRAMACIÓN/REPARACIÓN sin abrir gestión de reemplazo (LIGO
// 23905A0437, CEMENTO BAYANO 22610A4066) y después nadie podía ligar saliente
// y entrante: el entrante quedaba "en bodega" estando con el cliente y el
// saliente seguía en el contrato. Aquí se crea la gestión REEMP a posteriori
// con la orden ya hecha como su orden de programación, y el pool queda como
// lo habría dejado la entrega normal (plan de autoservicio 2026-10-07, P4/E1).
//
// Qué escribe:
//   · gestiones/{GR…}: tipo reemplazo, estado cerrada, origen regularizacion,
//     items[{serial_saliente, serial_nuevo, modelo…}], ordenes.programacion_id,
//     cierre completo, cambio_modelo aprobado "se mantiene" si cambió la familia;
//   · gestiones/{gid}/mapeos + eventos;
//   · la orden: gestion {id, tipo, regularizada};
//   · pool: entrante → en_cliente con la asignación del saliente (contrato) o
//     la custodia del cliente de la orden, reemplaza_a + reemplazo_origen,
//     kardex `reemplazo`; saliente → a revisión si quedó en casa (sale del
//     contrato), o pendiente_devolucion si el cliente se lo quedó.
// No crea órdenes: la entrega ya ocurrió. Desde el 2026-11-18 (Brenda, Solís y
// Solangel probando el caso MACELLO) SÍ avisa por correo a bodega, con copia a
// recepción y al taller: un radio salió de bodega sin que bodega lo asignara y
// nadie se enteraba. Y lo que se escribe en "¿Qué pasó?" queda en el kardex de
// los dos radios, no solo en la gestión.
//
// Radio recibido del cliente en una VISITA (2026-11-18): se abre sola la orden
// de DEVOLUCIÓN con el cliente y el serial ya puestos. Antes recepción la
// creaba a mano cuando el técnico llegaba con el radio — eligiendo el cliente
// de memoria (así nació la devolución de EUROLATIN a nombre de MENZIES) — y
// si el técnico no lo entregaba, nadie lo sabía. Ahora el tiquete queda
// abierto hasta que recepción hace el check-in (y de ahí sale la ENTRADA del
// taller, como siempre). Varios cambios de la misma visita caen en el mismo
// tiquete (dedupe por origen cambio_en_sitio + visita). En una orden de
// TALLER no se abre: ahí el radio ya está dentro, en esa misma orden.
//
// VISITA TÉCNICA (2026-11-18, MACELLO): el técnico cambia el radio EN SITIO
// con uno que lleva consigo. Ese entrante nunca está en la orden (la visita
// lista los radios del cliente), así que se escribe a mano; la visita no se
// "entrega", así que el entrante pasa a en_cliente igual (se dejó en sitio).
// Una visita suele cambiar varios radios: cada par es su propia gestión GR y
// el candado es por SERIAL (`reemplazos_regularizados`), no por orden. A la
// visita no se le escribe `gestion` — no es programación de nadie.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const pool = require("../domain/equiposPool");
const { catalogo, ModeloFamilia } = require("../domain/modeloCatalogo");

const ROLES = new Set(["administrador", "recepcion", "jefe_taller", "inventario", "gerente", "tecnico", "tecnico_operativo"]);
const esVisitaOrden = (o) => String(o?.tipo_de_servicio || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().includes("VISITA");
const FV = admin.firestore.FieldValue;

function fechaStrPanama(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Panama" }).replace(/-/g, "");
}
async function reservarNumero() {
  const fechaStr = fechaStrPanama();
  const ref = db.collection("contadores").doc(`gestiones_GR_${fechaStr}`);
  const seq = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const siguiente = (snap.exists ? Number(snap.data().seq || 0) : 0) + 1;
    t.set(ref, { seq: siguiente, prefijo: "GR", fecha: fechaStr, actualizado_en: FV.serverTimestamp() }, { merge: true });
    return siguiente;
  });
  return `GR${fechaStr}-${String(seq).padStart(2, "0")}`;
}
const equipoDe = (orden, serial) => (orden.equipos || []).find((e) => e && !e.eliminado
  && pool.normSerial(e.numero_de_serie || e.serial || "") === pool.normSerial(serial));

// Aviso a bodega (corto: resultado primero, una sola acción). Nunca lanza: el
// cambio ya quedó registrado y un correo caído no lo deshace.
async function avisarBodega({ gid, ordenId, esVisita, cliente, sal, ent, modSal, modEnt, contratoId, salienteEnCasa, motivo, quien, sinSalida = false, salSinFicha = false, devolucionId = null }) {
  try {
    const G = require("../lib/gestiones");
    const { bodegaEmailTo, recepcionEmails, tallerEmailTo } = require("../lib/mailRecipients");
    const { APP_BASE_URL } = require("../lib/inventario");
    const [bodega, recepcion, taller] = await Promise.all([bodegaEmailTo(), recepcionEmails(), tallerEmailTo()]);
    const copia = [...new Set([...recepcion, ...String(taller || "").split(",")].map((e) => String(e).trim().toLowerCase()).filter(G.isEmail))];
    const to = bodega || copia.join(", ");
    if (!to) { logger.warn("[regularizarReemplazoOrden] sin destinatarios para el aviso", { gid }); return null; }
    const cc = bodega ? copia.filter((e) => !bodega.toLowerCase().includes(e)).join(", ") : "";
    const e = G.escapeHtml;
    const p = (html) => `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${html}</p>`;
    const donde = esVisita ? `en la visita <b>${e(ordenId)}</b>` : `en la orden <b>${e(ordenId)}</b>`;
    return await G.encolarCorreo({
      to, cc: cc || null,
      subject: `Cambio de radio${esVisita ? " en sitio" : ""}: ${sal} → ${ent} · ${cliente}`,
      preheader: `Ya quedó registrado en inventario (gestión ${gid})`,
      bodyContent: `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Cambio de radio ${esVisita ? "en sitio" : "registrado"}</h2>
        ${p(`<b>${e(cliente)}</b> — ${donde}. Ya quedó registrado en inventario; no hay que asignar nada.`)}
        ${p(`<b>Se dejó con el cliente:</b> ${e(ent)}${modEnt ? ` · ${e(modEnt)}` : ""}${contratoId ? ` (contrato ${e(contratoId)})` : ""}<br>
             <b>Se recibió del cliente:</b> ${e(sal)}${modSal ? ` · ${e(modSal)}` : ""}`)}
        ${p(`<b>Qué pasó:</b> ${e(motivo || "—")}<br><b>Lo registró:</b> ${e(quien)}`)}
        ${sinSalida ? p(`<b style="color:#B45309;">Ojo:</b> el radio <b>${e(ent)}</b> figuraba en bodega: salió sin registrarse la salida a la visita. Las próximas veces, entrégalo desde Almacén → Hoy → "Salida a visita".`) : ""}
        ${salSinFicha ? p(`<b style="color:#B45309;">Ojo:</b> el radio <b>${e(sal)}</b> no estaba en el inventario: se creó su ficha con la propiedad <b>por definir</b> y el radio que se dejó quedó con el cliente <b>sin contrato</b>. Cuando llegue, clasifícalo (¿de CECOMUNICA o del cliente?).`) : ""}
        ${p(salienteEnCasa
          ? `El radio <b>${e(sal)}</b> se entrega en <b>recepción</b> para su revisión de taller${devolucionId ? `: recepción lo recibe en la devolución <b>${e(devolucionId)}</b>, que ya está abierta` : ""}.`
          : `El radio <b>${e(sal)}</b> se quedó con el cliente: queda <b>pendiente de devolución</b>${devolucionId ? ` (devolución <b>${e(devolucionId)}</b>)` : ""}.`)}`,
      ctaUrl: `${APP_BASE_URL}/almacen/index.html`,
      ctaLabel: "Abrir Almacén",
      meta: { source: "regularizarReemplazoOrden", gestion_id: gid, orden_id: ordenId },
    });
  } catch (err) {
    logger.error("[regularizarReemplazoOrden] aviso a bodega no enviado", { gid, message: err.message });
    return null;
  }
}

async function ejecutar({ usuario, nombre = "", uid = null, ordenId, serialSaliente, serialEntrante, salienteEnCasa = true, motivo = "" }) {
  if (!ordenId || typeof ordenId !== "string") throw new HttpsError("invalid-argument", "Falta la orden.");
  const sal = String(serialSaliente || "").trim(); const ent = String(serialEntrante || "").trim();
  if (!sal || !ent) throw new HttpsError("invalid-argument", "Falta el serial saliente o el entrante.");
  if (pool.normSerial(sal) === pool.normSerial(ent)) throw new HttpsError("invalid-argument", "Saliente y entrante son el mismo serial.");
  const oSnap = await db.collection("ordenes_de_servicio").doc(ordenId).get();
  if (!oSnap.exists) throw new HttpsError("not-found", "La orden no existe.");
  const orden = oSnap.data() || {};
  if (orden.eliminado === true || String(orden.estado_reparacion || "") === "ANULADA") throw new HttpsError("failed-precondition", "La orden está anulada o eliminada.");
  const esVisita = esVisitaOrden(orden);
  if (orden.gestion?.id && !esVisita) throw new HttpsError("failed-precondition", `La orden ya pertenece a la gestión ${orden.gestion.id}: el reemplazo se registra allá.`);
  if (!orden.cliente_id) throw new HttpsError("failed-precondition", "La orden no tiene cliente registrado.");
  const previo = (orden.reemplazos_regularizados || {})[pool.normSerial(sal)];
  if (previo) throw new HttpsError("failed-precondition", `El reemplazo de ${sal} ya se registró (gestión ${previo.gestion_id}).`);
  const eSal = equipoDe(orden, sal);
  const eEnt = equipoDe(orden, ent) || (esVisita ? { modelo_id: null, modelo: "" } : null);
  if (!eSal) throw new HttpsError("failed-precondition", `El saliente ${sal} no está en la orden.`);
  if (!eEnt) throw new HttpsError("failed-precondition", `El entrante ${ent} no está en la orden.`);

  await catalogo();
  let rSal = await pool.resolver(sal, eSal.modelo_id || null, eSal.modelo || "", { adoptarSiExiste: true });
  const rEnt = await pool.resolver(ent, eEnt.modelo_id || null, eEnt.modelo || "", { adoptarSiExiste: true });
  // En una visita el saliente sin ficha no tranca (ver más abajo): se le crea.
  if (!rSal.data && !esVisita) throw new HttpsError("failed-precondition", `El saliente ${sal} no existe en el inventario.`);
  if (!rEnt.data) throw new HttpsError("failed-precondition", `El entrante ${ent} no existe en el inventario (recíbelo primero en Almacén).`);
  if (rEnt.data.reemplaza_a) throw new HttpsError("failed-precondition", `${ent} ya figura como reemplazo de ${rEnt.data.reemplaza_a}.`);
  if ([pool.ESTADOS.BAJA, pool.ESTADOS.VENDIDO].includes(rEnt.data.estado)) throw new HttpsError("failed-precondition", `El entrante está ${rEnt.data.estado}.`);
  const entConOtro = rEnt.data.asignacion?.cliente_id && rEnt.data.asignacion.cliente_id !== orden.cliente_id && rEnt.data.estado === pool.ESTADOS.EN_CLIENTE;
  if (entConOtro) throw new HttpsError("failed-precondition", `El entrante ${ent} figura con ${rEnt.data.asignacion.cliente_nombre || "otro cliente"}. Corrige su ubicación primero.`);
  // En la visita el serial se escribe a mano: un dígito mal puesto no puede
  // sacar del taller o de revisión un radio que nunca salió de la casa.
  // Salida de radios a la visita (2026-11-18): lo normal es que el entrante
  // haya salido de bodega con ESTA visita (con_tecnico). Si salió con otra,
  // es un dígito mal puesto o un radio que se pasó de visita: que lo vea
  // bodega. Uno que sigue "en bodega" se acepta (no trancar al técnico en el
  // sitio), pero el correo a bodega lo dice: salió sin registrarse.
  const salioConOtra = rEnt.data.estado === pool.ESTADOS.CON_TECNICO && rEnt.data.salida_visita?.orden_id !== ordenId;
  if (salioConOtra) throw new HttpsError("failed-precondition", `El entrante ${ent} salió de bodega con la visita ${rEnt.data.salida_visita?.orden_id || "?"}, no con esta. Revisa el serial o pídele a bodega que lo corrija.`);
  const salioConEsta = rEnt.data.estado === pool.ESTADOS.CON_TECNICO;
  const okVisita = salioConEsta || [pool.ESTADOS.EN_BODEGA, pool.ESTADOS.POR_CLASIFICAR].includes(rEnt.data.estado)
    || (rEnt.data.estado === pool.ESTADOS.EN_CLIENTE && rEnt.data.asignacion?.cliente_id === orden.cliente_id);
  if (esVisita && !okVisita) throw new HttpsError("failed-precondition", `El entrante ${ent} figura "${rEnt.data.estado}", no en bodega. Revisa el serial o corrige su ubicación primero.`);
  const sinSalida = esVisita && !salioConEsta && rEnt.data.estado !== pool.ESTADOS.EN_CLIENTE;

  // Saliente sin ficha (2026-11-24, visita 2026111905 de DECAMERON: 125 de sus
  // 146 radios no estaban en el inventario y los 7 cambios en sitio habrían
  // rebotado con "no existe"). El técnico tiene el radio en la mano: se da de
  // alta como lo que es — un radio que tenía ese cliente, de propiedad POR
  // DEFINIR y sin verificar — y el cambio sigue. Bodega lo clasifica cuando
  // llegue; el correo se lo dice. Va después de validar el entrante para no
  // dejar una ficha suelta si el cambio se rechaza.
  let salSinFicha = false;
  if (!rSal.data) {
    await pool.upsertContacto({
      serial: sal, modelo_id: eSal.modelo_id || null, modelo_label: eSal.modelo || "",
      estado: pool.ESTADOS.EN_CLIENTE, tipo: "migracion", origen: "migracion_orden",
      refMov: { tipo: "orden", id: ordenId, label: orden.numero_orden || ordenId },
      notas: `Alta al registrar un cambio de radio en sitio (visita ${ordenId}): lo tenía el cliente y no estaba en el inventario. Propiedad por definir.`,
      extra: { asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "" } },
    });
    rSal = await pool.resolver(sal, eSal.modelo_id || null, eSal.modelo || "", { adoptarSiExiste: true });
    if (!rSal.data) throw new HttpsError("failed-precondition", `El saliente ${sal} no existe en el inventario y no se pudo dar de alta: revisa el serial.`);
    salSinFicha = true;
  }

  const asigSal = rSal.data.asignacion || {};
  const contratoDocId = asigSal.cliente_id === orden.cliente_id ? (asigSal.contrato_doc_id || null) : null;
  const contratoId = contratoDocId ? (asigSal.contrato_id || "") : "";
  const modSal = { modelo_id: rSal.data.modelo_id || eSal.modelo_id || null, modelo: rSal.data.modelo_label || eSal.modelo || "" };
  const modEnt = { modelo_id: rEnt.data.modelo_id || eEnt.modelo_id || null, modelo: rEnt.data.modelo_label || eEnt.modelo || "" };
  const cambioModelo = (modSal.modelo_id || modSal.modelo) && (modEnt.modelo_id || modEnt.modelo) && !pool.mismoModelo(modSal, modEnt.modelo_id, modEnt.modelo)
    && !ModeloFamilia.mismaFamilia(modSal, modEnt);
  // En una visita el radio se dejó en sitio: cuenta como entregado aunque la
  // orden siga abierta o haya cerrado como CERRADA (VISITA).
  const entregada = esVisita || /^ENTREGAD/.test(String(orden.estado_reparacion || "").toUpperCase());
  const gid = await reservarNumero();
  const now = FV.serverTimestamp();
  const serialKey = pool.normSerial(sal);
  const item = {
    serial_saliente: sal, pool_doc_id_saliente: rSal.ref.id, modelo: modSal.modelo, modelo_id: modSal.modelo_id,
    contrato_doc_id: contratoDocId, contrato_id: contratoId,
    serial_nuevo: ent, pool_doc_id_nuevo: rEnt.ref.id, modelo_id_nuevo: modEnt.modelo_id, modelo_nuevo: modEnt.modelo,
    saliente_en_casa: !!salienteEnCasa, elegibilidad: "regularizacion", motivo_codigo: "regularizacion",
    ...(esVisita ? { salida_bodega: salioConEsta ? "registrada" : (sinSalida ? "sin_registrar" : "ya_con_cliente") } : {}),
    motivo_detalle: String(motivo || "").slice(0, 300),
  };
  const g = {
    tipo: "reemplazo", numero: gid, estado: "cerrada", regularizada: true,
    cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "",
    causa: "regularizacion", notas: String(motivo || "").slice(0, 500),
    origen: { tipo: "regularizacion", orden_id: ordenId, por_uid: uid, por_email: usuario, at: now },
    aprobacion: { requiere: false, aprobado_por_email: usuario, at: now, motivo: "Regularización: el reemplazo ya se hizo en el taller" },
    items: [item], contratos_afectados: contratoDocId ? [contratoDocId] : [],
    ordenes: esVisita ? { visita_id: ordenId } : { programacion_id: ordenId, programacion_ids: [ordenId] },
    cierre: { aprobacion: true, asignacion: true, programacion: true, entrega: entregada, entrada: !!salienteEnCasa || !entregada },
    cerrada_at: now, cerrada_por: usuario, cerrada_motivo: "regularizacion",
    responsable_uid: uid, creado_por_uid: uid, creado_por_email: usuario, fecha_creacion: now, updated_at: now,
  };
  if (cambioModelo) {
    g.cambio_modelo = { [serialKey]: { estado: "aprobado", serial: ent, saliente: sal, de: modSal.modelo, de_id: modSal.modelo_id, a: modEnt.modelo, a_id: modEnt.modelo_id,
      motivo: "Regularizado a posteriori", tarifa: "se_mantiene", contrato_doc_id: contratoDocId, decidido_por_email: usuario, decidido_at: now, regularizado: true } };
  }
  const gref = db.collection("gestiones").doc(gid);
  await gref.set(g);
  await gref.collection("mapeos").add({ saliente: sal, entrante: ent, modelo: modEnt.modelo, modelo_id: modEnt.modelo_id, contrato_doc_id: contratoDocId, contrato_id: contratoId, auto: false, regularizado: true, at: now, por: usuario });
  await gref.collection("eventos").add({ accion: "regularizacion", detalle: `Reemplazo registrado a posteriori desde la orden ${ordenId}: ${sal} → ${ent}${cambioModelo ? ` (cambio de modelo ${modSal.modelo} → ${modEnt.modelo}, tarifa se mantiene)` : ""}.${salSinFicha ? ` El saliente no estaba en el inventario: se le creó la ficha, propiedad por definir.` : ""} ${motivo || ""}`.trim(), at: now, por_uid: uid, por_email: usuario });

  // La orden.
  await oSnap.ref.set({
    ...(esVisita ? {} : { gestion: { id: gid, tipo: "reemplazo", regularizada: true } }),
    // Mapa anidado: con set+merge una clave con punto NO es ruta, sería un campo literal.
    reemplazos_regularizados: { [serialKey]: { gestion_id: gid, saliente: sal, entrante: ent, at: now, por_email: usuario } },
    // La línea de la salida de bodega queda cerrada: este radio se dejó en sitio.
    ...(salioConEsta ? { radios_salida: { [pool.normSerial(ent)]: { estado: "dejado", dejado_at: now, gestion_id: gid, reemplaza_a: sal } } } : {}),
    os_logs: FV.arrayUnion({ action: "REGULARIZAR_REEMPLAZO", by: uid || usuario, at: admin.firestore.Timestamp.now(), nota: `${sal} → ${ent} (gestión ${gid})` }),
  }, { merge: true });

  // Pool: entrante.
  const refMov = { tipo: "gestion", id: gid, label: gid };
  // "¿Qué pasó?" va también al kardex: bodega mira el movimiento del radio,
  // no la gestión (Solís, 2026-11-18).
  const quePaso = String(motivo || "").trim() ? ` — Qué pasó: ${String(motivo).trim().slice(0, 300)}` : "";
  const asignacionEnt = contratoDocId
    ? { contrato_doc_id: contratoDocId, contrato_id: contratoId, cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "", gestion_doc_id: gid }
    : { contrato_doc_id: null, contrato_id: "", cliente_id: orden.cliente_id, cliente_nombre: orden.cliente_nombre || orden.cliente || "", gestion_doc_id: gid };
  const linaje = { reemplaza_a: pool.normSerial(sal), reemplazo_origen: { gestion_id: gid, saliente: pool.normSerial(sal), orden_entrega_id: ordenId, contrato_doc_id: contratoDocId, contrato_id: contratoId, at: now, regularizado: true } };
  let entRes = "sin-cambio";
  if (entregada && rEnt.data.estado !== pool.ESTADOS.EN_CLIENTE) {
    entRes = await pool.transicionarPorId(rEnt.ref.id, { aEstado: pool.ESTADOS.EN_CLIENTE, tipo: "reemplazo", refMov,
      notas: `Reemplaza a ${sal} (gestión ${gid}) — regularizado: ${esVisita ? `dejado en sitio en la visita ${ordenId}` : `entregado con la orden ${ordenId}`}${quePaso}`,
      extra: { asignacion: asignacionEnt, orden_actual_id: null, verificado: false, ...linaje,
        ...(salioConEsta ? { salida_visita: FV.delete() } : {}) } });
  } else {
    await rEnt.ref.set({ ...linaje, ...(rEnt.data.asignacion?.cliente_id ? {} : { asignacion: asignacionEnt }), updated_at: now }, { merge: true });
    await rEnt.ref.collection("movimientos").add({ at: now, por: usuario, por_email: usuario, tipo: "reemplazo", de_estado: null, a_estado: null, ref: refMov, notas: `Reemplaza a ${sal} (gestión ${gid}) — regularizado desde la orden ${ordenId}${quePaso}` });
  }
  // Pool: saliente.
  let salRes = "sin-cambio";
  if (salienteEnCasa) {
    salRes = await pool.transicionarPorId(rSal.ref.id, { aEstado: pool.ESTADOS.DEVUELTO, soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.EN_TALLER, pool.ESTADOS.EN_BODEGA],
      tipo: "reemplazo", refMov, notas: `Sustituido por ${ent} en la orden ${ordenId} (gestión ${gid}): quedó en CECOMUNICA — sale del contrato y queda por revisar${quePaso}`,
      extra: { asignacion: null, orden_actual_id: null } });
  } else {
    await rSal.ref.set({ pendiente_devolucion: true, updated_at: now }, { merge: true });
    await rSal.ref.collection("movimientos").add({ at: now, por: usuario, por_email: usuario, tipo: "reemplazo", de_estado: null, a_estado: null, ref: refMov, notas: `Reemplazado por ${ent} (gestión ${gid}) — el cliente se lo quedó: pendiente de devolución${quePaso}` });
  }
  // Devolución del radio recibido del cliente (solo visitas; ver cabecera).
  // Best-effort: si falla, el cambio ya quedó y recepción la abre a mano.
  let devolucionId = null;
  if (esVisita) {
    try {
      const { crearOrdenDevolucion } = require("../lib/ordenDevolucion");
      devolucionId = await crearOrdenDevolucion({
        clienteId: orden.cliente_id, clienteNombre: orden.cliente_nombre || orden.cliente || "",
        contratoDocId, contratoId, contratoOrigenIds: [],
        modo: "recuperacion", origen: { tipo: "cambio_en_sitio", ref_id: ordenId },
        unidades: [{ serial: sal, modelo: modSal.modelo, modelo_id: modSal.modelo_id, pool_doc_id: rSal.ref.id }],
        motivo: `Cambio de radio en sitio en la visita ${ordenId}: ${sal} se reemplazó por ${ent} (gestión ${gid})${quePaso}`,
        enCamino: salienteEnCasa ? (nombre || orden.tecnico_asignado || "el técnico") : "",
      });
      if (devolucionId) {
        await oSnap.ref.set({ reemplazos_regularizados: { [serialKey]: { devolucion_id: devolucionId } } }, { merge: true });
        await gref.set({ ordenes: { devolucion_id: devolucionId } }, { merge: true });
      }
    } catch (err) {
      logger.error("[regularizarReemplazoOrden] no se abrió la devolución del radio recibido", { gid, ordenId, sal, message: err.message });
    }
  }
  const mailId = await avisarBodega({ gid, ordenId, esVisita, devolucionId, cliente: orden.cliente_nombre || orden.cliente || "", sal, ent,
    modSal: modSal.modelo, modEnt: modEnt.modelo, contratoId, salienteEnCasa: !!salienteEnCasa, motivo: String(motivo || "").trim(),
    quien: nombre ? `${nombre} (${usuario})` : usuario, sinSalida, salSinFicha });
  logger.info("[regularizarReemplazoOrden]", { ordenId, gid, sal, ent, usuario, entRes, salRes, cambioModelo: !!cambioModelo, salSinFicha });
  return { ok: true, gestion_id: gid, entrante: entRes, saliente: salRes, cambio_modelo: !!cambioModelo, contrato: contratoId || null, aviso_mail_id: mailId, devolucion_id: devolucionId, saliente_sin_ficha: salSinFicha };
}

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) throw new HttpsError("permission-denied", "Tu rol no registra reemplazos a posteriori.");
    const { ordenId, serialSaliente, serialEntrante, salienteEnCasa = true, motivo = "" } = request.data || {};
    return ejecutar({ usuario: u.email || uid, nombre: u.nombre || u.displayName || "", uid, ordenId, serialSaliente, serialEntrante, salienteEnCasa: !!salienteEnCasa, motivo });
  },
);
module.exports.ejecutar = ejecutar;

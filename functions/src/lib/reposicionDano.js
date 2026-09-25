// Reemplazo por DAÑO CAUSADO POR EL CLIENTE (2026-09-25, Alberto).
//
// EL PROBLEMA. El taller solo podía proponer un reemplazo por GARANTÍA: un
// radio de alquiler que el cliente rompió (golpe, líquido, carcasa partida)
// se reponía igual, gratis, por el mismo camino. Ese reemplazo se cotiza y se
// factura, y el proceso tiene que ser distinto.
//
// EL CAMINO (reusa las dos máquinas que ya existen, no inventa una tercera):
//   1. El técnico propone desde la fila del radio eligiendo "Daño causado por
//      el cliente", con fotos. Nace la MISMA gestión GR, con `causa:
//      'dano_cliente'` y `cobro.monto_referencia` = valor de reposición del
//      catálogo (decisión de Alberto: el precio de venta del catálogo, el
//      mismo del Anexo A).
//   2. Administración aprueba CON CARGO (fija el monto) → la gestión queda
//      `pendiente_cliente` y este módulo arma sola la COTIZACIÓN DE TALLER de
//      la reposición, en borrador, para que la jefa de taller la envíe.
//      (Aprobar SIN cargo —cortesía— sigue el camino de garantía de siempre.)
//   3. El cliente acepta —por correo o de palabra, casi nunca por la página—
//      y el taller lo anota con "El cliente aceptó" en la cotización: se abre
//      la fila de facturación (lib/facturacionCotizacion) y la gestión pasa a
//      `pendiente_bodega`, que es lo que le manda el correo a Bodega. Bodega
//      NO se entera antes: no se saca un radio del estante por un cobro que el
//      cliente no aceptó (decisión de Alberto).
//   4. El cliente NO acepta: la gestión se CIERRA sin reemplazo y el daño
//      pasa a cobranza (renglón en `cobros_equipos`, la bandeja que ya se
//      persigue a diario). El caso nunca queda colgando: si el cliente no
//      contesta, administración lo pasa a cobranza desde el expediente.
//
// Las funciones puras (renglón, totales, documento) van exportadas para los
// tests; las que escriben reciben ids y releen en transacción.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { ITBMS_RATE } = require("./constants");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TIPOS_DANO = {
  golpe: "Golpe o caída",
  liquido: "Líquido o humedad",
  carcasa: "Carcasa, pantalla o antena rota",
  manipulacion: "Manipulación o sellos violados",
  otro: "Otro daño físico",
};

// ¿Esta gestión es un reemplazo por daño que se le cobra al cliente?
function esReposicionDano(g) {
  return g?.tipo === "reemplazo" && g?.causa === "dano_cliente";
}
function cobraCargo(g) {
  return esReposicionDano(g) && g?.cobro?.requiere === true;
}

// El monto que se cobra: el que fijó administración al aprobar; si no, el de
// referencia del catálogo. null = nadie le puso precio (no se inventa uno).
function montoReposicion(g) {
  const a = Number(g?.cobro?.monto);
  if (Number.isFinite(a) && a > 0) return r2(a);
  const ref = Number(g?.cobro?.monto_referencia);
  return Number.isFinite(ref) && ref > 0 ? r2(ref) : null;
}

function totalesReposicion(monto, { exento = false, tasa = ITBMS_RATE } = {}) {
  const subtotal = r2(monto);
  const itbms = exento ? 0 : r2(subtotal * tasa);
  return { subtotal, itbms, total: r2(subtotal + itbms) };
}

// El renglón que ve el cliente. Mismo formato que los de cotizar-orden
// (`equipo` estructurado + `spec` de texto), así el documento se agrupa por
// equipo igual que una reparación.
function renglonReposicion(g, monto) {
  const it = (g.items || [])[0] || {};
  const dano = g.dano || {};
  const tipoTxt = TIPOS_DANO[dano.tipo] || dano.tipo_label || "Daño físico";
  const modelo = it.modelo || "equipo";
  const intervencion = `Reposición por daño: ${tipoTxt}${g.origen?.diagnostico ? ` — ${g.origen.diagnostico}` : ""}`;
  return {
    id: "rep1",
    modelo: String(it.modelo_codigo || it.modelo || "").slice(0, 60),
    nombre: `Reposición de equipo ${modelo}`,
    spec: `Equipo: Serie ${it.serial_saliente || "—"} · Modelo ${modelo} · Intervención: ${intervencion}`,
    equipo: {
      id: g.origen?.equipo_id || null,
      serial: it.serial_saliente || "",
      modelo,
      marca: "",
      intervencion,
    },
    cant: 1,
    precio: r2(monto),
    desc: 0,
    modalidad: "venta",
  };
}

/**
 * La cotización de la reposición, lista para escribir (sin timestamps del
 * servidor — los pone quien escribe). Es una cotización de TALLER: origen
 * 'orden' + la orden del radio dañado, así la imprime, la envía y la factura
 * el mismo circuito que una reparación.
 */
function docCotizacionReposicion({ gid, g, cliente = {}, firmante = {}, cotizacionId, fechaIso, validezDias = 15, monto }) {
  const exento = cliente.itbms_exento === true;
  const t = totalesReposicion(monto, { exento });
  const it = (g.items || [])[0] || {};
  const ordenId = g.origen?.orden_id || "";
  return {
    cotizacion_id: cotizacionId,
    estado: "borrador",
    origen: "orden",
    orden_id: ordenId,
    gestion_id: gid,
    generada_por: "sistema:reposicion_dano",
    clienteId: g.cliente_id || "",
    cliente_nombre: g.cliente_nombre || cliente.nombre || "",
    cliente_ruc: [cliente.ruc, cliente.dv].filter(Boolean).join(" DV "),
    cliente_email: cliente.email || "",
    cliente_representante: cliente.representante || "",
    cliente_itbms_exento: exento,
    dirigido_a: cliente.representante || "",
    dirigido_email: cliente.email || "",
    ejecutivoId: firmante.uid || "",
    ejecutivo_nombre: firmante.nombre || "",
    ejecutivo_cargo: firmante.cargo || "",
    ejecutivo_email: firmante.email || "",
    fecha: fechaIso,
    validezDias: Number(validezDias) || 15,
    moneda: "USD",
    descuentoPct: 0,
    itbms_aplica: !exento,
    itbms_porcentaje: ITBMS_RATE,
    itbms_monto: t.itbms,
    total_con_itbms: t.total,
    itbmsPct: exento ? 0 : Math.round(ITBMS_RATE * 100),
    intro: `Cotización de la reposición del radio ${it.serial_saliente || ""} (${it.modelo || "—"}), `
      + `recibido en la orden de servicio ${ordenId || "—"} con daño físico que no cubre la garantía. `
      + "Al aceptarla se entrega un equipo de reposición en su lugar.",
    items: [renglonReposicion(g, monto)],
    plazoMeses: 0,
    condiciones: [],
    adjuntos: [],
    subtotal: t.subtotal,
    descuento_global: 0,
    total: t.total,
    total_venta: t.total,
    total_mensual: 0,
    compromiso_plazo: 0,
    incluye_carta: true,
    requiere_aprobacion: false,
    creado_por_uid: firmante.uid || null,
    creado_por_email: firmante.email || null,
    deleted: false,
  };
}

// Fecha de hoy en Panamá (YYYY-MM-DD): la cotización se fecha como la vería
// quien la firma, no en UTC — a las 8 p. m. de Panamá UTC ya es mañana.
function hoyPanamaIso(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Correlativo COT-YYYY-NNNN: el MISMO contador que usa la app
// (contadores/cotizaciones_{año}), en transacción. Si el contador del año no
// existe todavía, se siembra con el mayor número emitido.
async function siguienteCotizacionId() {
  const y = Number(hoyPanamaIso().slice(0, 4));
  const prefix = `COT-${y}-`;
  let piso = 0;
  try {
    const snap = await db.collection("cotizaciones")
      .where("cotizacion_id", ">=", prefix).where("cotizacion_id", "<", prefix + "\uf8ff")
      .orderBy("cotizacion_id", "desc").limit(1).get();
    snap.forEach((d) => {
      const n = parseInt(String(d.data().cotizacion_id || "").slice(prefix.length), 10);
      if (!isNaN(n)) piso = Math.max(piso, n);
    });
  } catch (e) { logger.warn("[reposicionDano] piso del correlativo no leído", { error: e.message }); }
  const ref = db.collection("contadores").doc(`cotizaciones_${y}`);
  const seq = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const actual = s.exists ? Number(s.data().seq || 0) : 0;
    const sig = Math.max(actual, piso) + 1;
    tx.set(ref, { seq: sig, anio: y, actualizado_en: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return sig;
  });
  return prefix + String(seq).padStart(4, "0");
}

// Quien firma la cotización de reposición: la jefatura de taller (es una
// cotización de taller). Su cargo sale de su ficha.
async function firmanteTaller() {
  const snap = await db.collection("usuarios").where("rol", "==", "jefe_taller").get();
  const vivos = snap.docs.filter((d) => d.data()?.activo !== false && d.data()?.deleted !== true);
  const d = vivos[0] || snap.docs[0];
  if (!d) return {};
  const u = d.data() || {};
  return {
    uid: d.id,
    nombre: u.nombre || u.name || u.email || "",
    email: String(u.email || "").trim().toLowerCase(),
    cargo: u.cargo || "Jefe(a) de Taller",
  };
}

/**
 * Administración aprobó CON CARGO → se arma la cotización de la reposición.
 * Idempotente: el candado `cobro.cotizacion_en_curso` se reserva en
 * transacción ANTES de crear nada (el eco del trigger sobre la misma gestión
 * no puede crear una segunda cotización).
 * @returns {Promise<{docId, cotizacionId}|null>}
 */
async function crearCotizacionReposicion(gid) {
  const gRef = db.collection("gestiones").doc(gid);
  const g = await db.runTransaction(async (tx) => {
    const s = await tx.get(gRef);
    if (!s.exists) return null;
    const d = s.data();
    if (!cobraCargo(d) || d.estado !== "pendiente_cliente") return null;
    if (d.cobro?.cotizacion_doc_id || d.cobro?.cotizacion_en_curso) return null;
    tx.update(gRef, { "cobro.cotizacion_en_curso": true });
    return d;
  });
  if (!g) return null;

  const G = require("./gestiones");
  try {
    const monto = montoReposicion(g);
    if (!monto) throw new Error("La gestión no tiene monto de reposición");
    const [cliSnap, cfgSnap, firmante, cotizacionId] = await Promise.all([
      db.collection("clientes").doc(g.cliente_id).get().catch(() => null),
      db.collection("empresa").doc("config").get().catch(() => null),
      firmanteTaller(),
      siguienteCotizacionId(),
    ]);
    const cliente = cliSnap?.exists ? cliSnap.data() : {};
    const validez = Number(cfgSnap?.exists ? cfgSnap.data().cotizacion_validez_dias : 0) || 15;
    const doc = docCotizacionReposicion({
      gid, g, cliente, firmante, cotizacionId, fechaIso: hoyPanamaIso(), validezDias: validez, monto,
    });
    const ref = await db.collection("cotizaciones").add({
      ...doc,
      fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
      fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
    });
    await gRef.update({
      "cobro.cotizacion_doc_id": ref.id,
      "cobro.cotizacion_id": cotizacionId,
      "cobro.estado": "cotizada",
      "cobro.cotizacion_en_curso": admin.firestore.FieldValue.delete(),
    });
    // Enlace en la orden del radio: la pantalla de cotizar la orden y la lista
    // de cotizaciones de la orden la ven como una más.
    if (g.origen?.orden_id) {
      await db.collection("ordenes_de_servicio").doc(String(g.origen.orden_id)).set({
        cotizaciones_ids: admin.firestore.FieldValue.arrayUnion(ref.id),
      }, { merge: true }).catch((e) => logger.warn("[reposicionDano] orden sin enlace a la cotización", { gid, error: e.message }));
    }
    await G.registrarEvento(gid, "cotizacion_reposicion",
      `Cotización ${cotizacionId} de la reposición creada en borrador ($${monto.toFixed(2)} + ITBMS si aplica). La envía la jefatura de taller.`);
    await correoCotizacionLista(gid, g, { docId: ref.id, cotizacionId, monto, firmante });
    return { docId: ref.id, cotizacionId };
  } catch (e) {
    // Se suelta el candado: un reintento del evento puede volver a intentarlo.
    await gRef.update({ "cobro.cotizacion_en_curso": admin.firestore.FieldValue.delete() }).catch(() => {});
    logger.error("[reposicionDano] cotización de reposición NO creada", { gid, error: e.message });
    await G.registrarEvento(gid, "cotizacion_reposicion_error",
      `No se pudo armar la cotización de la reposición: ${e.message}. Hay que cotizarla a mano desde la orden.`);
    return null;
  }
}

async function correoCotizacionLista(gid, g, { docId, cotizacionId, monto, firmante }) {
  const G = require("./gestiones");
  const { tallerEmailTo } = require("./mailRecipients");
  const it = (g.items || [])[0] || {};
  const to = firmante?.email || await tallerEmailTo();
  if (!to) return;
  const cc = [g.origen?.tecnico_email, await G.vendedorEmailDeCliente(g.cliente_id)]
    .filter(Boolean).filter((e) => e !== to).join(",") || null;
  await G.encolarCorreo({
    to, cc,
    subject: `Enviar al cliente: reposición por daño ${cotizacionId} — radio ${it.serial_saliente || "—"} · ${g.cliente_nombre || "Cliente"}`,
    preheader: "Administración aprobó el reemplazo con cargo — la cotización está lista en borrador",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Cotización de reposición lista para enviar</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Administración aprobó <b>con cargo</b> el reemplazo del radio <b><code>${G.escapeHtml(it.serial_saliente || "—")}</code></b>
        (${G.escapeHtml(it.modelo || "—")}) de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>, dañado por el cliente
        (gestión <b>${G.escapeHtml(gid)}</b>, orden <b>${G.escapeHtml(g.origen?.orden_id || "—")}</b>).</p>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La cotización <b>${G.escapeHtml(cotizacionId)}</b> por <b>$${Number(monto).toFixed(2)}</b> (más ITBMS si aplica) quedó
        en borrador. <b>Revísala y envíala al cliente.</b> Cuando el cliente responda —por correo, por teléfono o en persona—
        márcalo con <b>Respuesta del cliente</b>: si acepta, Bodega recibe el aviso para asignar el radio de reposición y
        Recepción la fila para facturar; si no acepta, el caso se cierra y pasa a cobranza.</p>`,
    ctaUrl: `${APP_BASE_URL}/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(docId)}`,
    ctaLabel: "Abrir la cotización",
    meta: { gestion_id: gid, paso: "cotizacion_reposicion", cotizacion_id: cotizacionId },
  });
}

/**
 * El cliente ACEPTÓ la cotización de reposición → la gestión sigue a bodega.
 * Solo si sigue esperando al cliente; una gestión anulada o ya liberada no se
 * toca. Acepta cualquier cotización de la gestión (una rehecha con Duplicar
 * también sirve) y deja apuntada la que se aceptó.
 */
async function alAceptarse(docId, cot) {
  const gid = String(cot?.gestion_id || "");
  if (!gid) return null;
  const gRef = db.collection("gestiones").doc(gid);
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(gRef);
    if (!s.exists) return { ok: false, motivo: "no_existe" };
    const g = s.data();
    if (g.estado !== "pendiente_cliente") return { ok: false, motivo: g.estado };
    tx.update(gRef, {
      estado: "pendiente_bodega",
      "cierre.cotizacion": true,
      "cobro.estado": "aceptada",
      "cobro.cotizacion_doc_id": docId,
      "cobro.cotizacion_id": cot.cotizacion_id || docId,
      "cobro.aceptada_at": admin.firestore.FieldValue.serverTimestamp(),
      "cobro.aceptacion": {
        medio: cot.aceptacion?.medio || null,
        nota: cot.aceptacion?.nota || "",
        por_email: cot.aceptacion?.por_email || null,
      },
    });
    return { ok: true };
  });
  const G = require("./gestiones");
  await G.registrarEvento(gid, r.ok ? "reposicion_aceptada" : "reposicion_aceptada_ignorada", r.ok
    ? `El cliente aceptó la cotización ${cot.cotizacion_id || docId}: pasa a Bodega para asignar el radio de reposición, y a Facturación pendiente.`
    : `La cotización ${cot.cotizacion_id || docId} se marcó aceptada, pero la gestión ya estaba "${r.motivo}": no se movió nada.`);
  return r;
}

/**
 * El cliente NO aceptó → el reemplazo no se hace, la gestión se CIERRA y el
 * daño pasa a cobranza. Solo con la cotización VIGENTE de la gestión: rechazar
 * una copia vieja no puede cerrar un caso que sigue vivo con otra.
 */
async function alRechazarse(docId, cot) {
  const gid = String(cot?.gestion_id || "");
  if (!gid) return null;
  const gRef = db.collection("gestiones").doc(gid);
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(gRef);
    if (!s.exists) return { ok: false, motivo: "no_existe" };
    const g = s.data();
    if (g.estado !== "pendiente_cliente") return { ok: false, motivo: g.estado };
    if (g.cobro?.cotizacion_doc_id && g.cobro.cotizacion_doc_id !== docId) return { ok: false, motivo: "otra_cotizacion" };
    tx.update(gRef, {
      estado: "cerrada",
      resultado: "sin_reemplazo_cobranza",
      cerrada_motivo: cot.cierre_motivo || "El cliente no aceptó la cotización de la reposición",
      cerrada_at: admin.firestore.FieldValue.serverTimestamp(),
      "cobro.estado": "cobranza",
      "cobro.rechazada_at": admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, g };
  });
  const G = require("./gestiones");
  if (!r.ok) {
    if (r.motivo !== "otra_cotizacion") {
      await G.registrarEvento(gid, "reposicion_rechazada_ignorada",
        `La cotización ${cot.cotizacion_id || docId} se marcó rechazada, pero la gestión ya estaba "${r.motivo}": no se movió nada.`);
    }
    return r;
  }
  const g = r.g;
  const it = (g.items || [])[0] || {};
  let cobroId = null;
  try {
    const CE = require("./cobrosEquipos");
    cobroId = await CE.abrirCobro({
      cliente_id: g.cliente_id || "", cliente_nombre: g.cliente_nombre || "",
      serial: it.serial_saliente || "", serial_norm: it.serial_saliente || "",
      pool_doc_id: it.pool_doc_id_saliente || null,
      modelo_id: it.modelo_id || "", modelo_label: it.modelo || "",
      motivo_codigo: "dano_cliente",
      motivo_detalle: `Daño causado por el cliente — no aceptó la reposición (${cot.cotizacion_id || docId}).`
        + (cot.cierre_motivo ? ` ${cot.cierre_motivo}` : ""),
      por_email: "system:reposicion_dano",
      gestion_id: gid, orden_id: g.origen?.orden_id || "", cotizacion_id: cot.cotizacion_id || "",
      monto_unit_aprobado: montoReposicion(g),
    });
    if (cobroId) await gRef.update({ "cobro.cobro_equipo_id": cobroId });
  } catch (e) {
    logger.error("[reposicionDano] renglón de cobranza NO abierto", { gid, error: e.message });
  }
  await G.registrarEvento(gid, "reposicion_rechazada",
    `El cliente no aceptó la cotización ${cot.cotizacion_id || docId}. El reemplazo no se hace; la gestión se cierra`
    + ` y el daño pasa a cobranza${cobroId ? " (Almacén · No devueltos / cobros)" : " — el renglón de cobranza NO se abrió: revisar a mano"}.`);
  await correoRechazo(gid, g, cot, cobroId).catch((e) =>
    logger.warn("[reposicionDano] correo de rechazo no encolado", { gid, error: e.message }));
  return { ok: true, cobroId };
}

async function correoRechazo(gid, g, cot, cobroId) {
  const G = require("./gestiones");
  const { tallerEmailTo } = require("./mailRecipients");
  const it = (g.items || [])[0] || {};
  const cc = [g.origen?.tecnico_email, await G.vendedorEmailDeCliente(g.cliente_id), await tallerEmailTo()]
    .flatMap((e) => String(e || "").split(",")).map((e) => e.trim()).filter(Boolean);
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: [...new Set(cc)].join(",") || null,
    subject: `Reposición no aceptada → cobranza: radio ${it.serial_saliente || "—"} — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: "El cliente no aceptó pagar la reposición del radio que dañó",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991B1B;">El cliente no aceptó la reposición</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> no aceptó la cotización <b>${G.escapeHtml(cot.cotizacion_id || "—")}</b>
        por la reposición del radio <b><code>${G.escapeHtml(it.serial_saliente || "—")}</code></b> (${G.escapeHtml(it.modelo || "—")}).</p>
      <ul style="margin:0 0 12px;padding-left:18px;font:14px/1.6 Arial,sans-serif;">
        <li><b>No se repone el radio</b>: Bodega no recibió ni recibirá el aviso.</li>
        <li>La gestión <b>${G.escapeHtml(gid)}</b> quedó <b>cerrada</b>.</li>
        <li>El daño ${cobroId ? "quedó abierto en <b>cobranza</b> por $" + Number(montoReposicion(g) || 0).toFixed(2) + " (más ITBMS si aplica)" : "debe abrirse a mano en cobranza (el sistema no pudo hacerlo)"}.</li>
        <li>El radio dañado sigue su curso en la orden <b>${G.escapeHtml(g.origen?.orden_id || "—")}</b>.</li>
      </ul>`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Ver el expediente",
    meta: { gestion_id: gid, paso: "reposicion_rechazada", cotizacion_id: cot.cotizacion_id || "" },
  });
}

/**
 * La gestión se ANULÓ con la cotización todavía viva → la cotización se
 * descarta con el motivo, para que nadie la envíe ni la marque aceptada.
 */
async function alAnularse(gid, g) {
  const docId = g?.cobro?.cotizacion_doc_id;
  if (!docId) return false;
  const ref = db.collection("cotizaciones").doc(docId);
  const s = await ref.get();
  if (!s.exists) return false;
  const c = s.data();
  if (!["borrador", "enviada", "aprobada", "vencida"].includes(String(c.estado || ""))) return false;
  await ref.update({
    estado: "descartada",
    cierre_motivo: `Se anuló la gestión ${gid}${g.anulada_motivo ? `: ${g.anulada_motivo}` : ""}`.slice(0, 300),
    fecha_descarte: admin.firestore.Timestamp.now(),
    descartada_por_uid: "system",
  });
  return true;
}

module.exports = {
  TIPOS_DANO, esReposicionDano, cobraCargo, montoReposicion, totalesReposicion,
  renglonReposicion, docCotizacionReposicion, hoyPanamaIso,
  siguienteCotizacionId, firmanteTaller,
  crearCotizacionReposicion, alAceptarse, alRechazarse, alAnularse,
};

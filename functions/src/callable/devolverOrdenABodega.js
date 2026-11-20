// devolverOrdenABodega — cierra una orden del cliente INTERNO (C COMUNICA:
// maquillaje, revisión general, radios para stock) devolviendo sus radios a
// bodega de un golpe (Solangel, 2026-11-20).
//
// Antes esas órdenes no tenían cierre: se quedaban en "Completado" con el
// botón "Entregar", y para usar los radios con un cliente o en una visita el
// Sr. Solís los liberaba uno por uno desde la ficha (más de 40 en noviembre).
// La orden nunca decía que los radios ya no estaban.
//
// Quién: recepción, jefa de taller, bodega y administración (decisión de
// Alberto, 2026-11-20).
// Qué hace: valida y deja la orden en CERRADA (A BODEGA) con el motivo. El
// inventario lo mueve onOrdenWritePool en esa transición — un solo lugar,
// igual que la anulación: solo lo que SIGUE en la orden vuelve a bodega; lo
// que ya salió por otro lado no se toca.
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const pool = require("../domain/equiposPool");
const { esOrdenInterna } = require("../domain/clienteInterno");

const ROLES = new Set(["administrador", "recepcion", "jefe_taller", "inventario"]);
const VIVOS = new Set(["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO", "COMPLETADO (EN OFICINA)"]);
const CERRADA_A_BODEGA = "CERRADA (A BODEGA)";
const FV = admin.firestore.FieldValue;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const serialDe = (e) => String((e && (e.numero_de_serie || e.serial || e.SERIAL)) || "").trim();

// Tipos con cierre propio: la visita se cierra en sitio, la ENTRADA aterriza
// con su inspección y la DEVOLUCIÓN con su check-in.
function tipoAdmite(orden) {
  const t = sinTildes(orden.tipo_de_servicio);
  return !(t.includes("VISITA") || t.includes("ENTRADA") || t.includes("DEVOLUCION")) && !orden.entrada_inspeccion;
}

// Por qué no se puede (o null). Pura: la comparte la prueba.
function motivoRechazo(orden, { interna, motivo }) {
  if (!orden || orden.eliminado === true) return "La orden no existe o fue eliminada.";
  if (!interna) return "Solo las órdenes de C COMUNICA (maquillaje, revisión interna) se devuelven a bodega. Una orden de un cliente se entrega o se cierra por su flujo.";
  if (!tipoAdmite(orden)) return `Una orden de ${orden.tipo_de_servicio || "este tipo"} tiene su propio cierre.`;
  const estado = sinTildes(orden.estado_reparacion || "POR ASIGNAR");
  if (!VIVOS.has(estado)) return `La orden ya está cerrada (${orden.estado_reparacion}).`;
  if (String(motivo || "").trim().length < 10) return "Di en una frase por qué vuelven a bodega (mínimo 10 caracteres).";
  return null;
}

// Aviso corto a bodega, copia a recepción y taller. Nunca lanza.
async function avisar({ ordenId, orden, motivo, usuario, vuelven, yaNo }) {
  try {
    const G = require("../lib/gestiones");
    const { bodegaEmailTo, recepcionEmails, tallerEmailTo } = require("../lib/mailRecipients");
    const { APP_BASE_URL } = require("../lib/inventario");
    const [bodega, recepcion, taller] = await Promise.all([bodegaEmailTo(), recepcionEmails(), tallerEmailTo()]);
    const copia = [...new Set([...recepcion, ...String(taller || "").split(",")].map((x) => String(x).trim().toLowerCase()).filter(G.isEmail))];
    const to = bodega || copia.join(", ");
    if (!to) { logger.warn("[devolverOrdenABodega] sin destinatarios para el aviso", { ordenId }); return null; }
    const cc = bodega ? copia.filter((x) => !bodega.toLowerCase().includes(x)).join(", ") : "";
    const e = G.escapeHtml;
    const p = (html) => `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${html}</p>`;
    const li = (u) => `<li><code>${e(u.serial)}</code>${u.modelo ? ` · ${e(u.modelo)}` : ""}${u.donde ? ` — ${e(u.donde)}` : ""}</li>`;
    return await G.encolarCorreo({
      to, cc: cc || null,
      subject: `Orden ${ordenId} devuelta a bodega: ${vuelven.length} radio(s)`,
      preheader: "Ya están disponibles en el inventario",
      bodyContent: `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Orden interna devuelta a bodega</h2>
        ${p(`La orden <b>${e(ordenId)}</b> (${e(orden.tipo_de_servicio || "")}) se cerró y ${vuelven.length
          ? `<b>${vuelven.length}</b> radio(s) ya figuran <b>en bodega</b>, disponibles. No hay que liberarlos uno por uno.`
          : "no quedaba ningún radio en ella: todos habían salido antes."}`)}
        ${vuelven.length ? `<ul style="margin:0 0 12px 18px;padding:0;font:14px/1.6 Arial,sans-serif;">${vuelven.map(li).join("")}</ul>` : ""}
        ${yaNo.length ? p(`<b>Ya no estaban en la orden</b> (no se tocaron):`) + `<ul style="margin:0 0 12px 18px;padding:0;font:14px/1.6 Arial,sans-serif;">${yaNo.map(li).join("")}</ul>` : ""}
        ${p(`<b>Motivo:</b> ${e(motivo)}<br><b>Lo registró:</b> ${e(usuario)}`)}`,
      ctaUrl: `${APP_BASE_URL}/almacen/index.html`,
      ctaLabel: "Abrir Almacén",
      meta: { source: "devolverOrdenABodega", orden_id: ordenId },
    });
  } catch (err) {
    logger.error("[devolverOrdenABodega] aviso no enviado", { ordenId, message: err.message });
    return null;
  }
}

const DONDE = {
  en_bodega: "ya en bodega", en_cliente: "con un cliente", asignado_contrato: "asignado a un contrato",
  con_tecnico: "con un técnico en una visita", vendido: "vendido", baja: "de baja",
  devuelto_revision: "en revisión de devueltos", en_taller: "en otra orden de taller",
};

async function ejecutar({ usuario, uid = null, ordenId, motivo, correo = true }) {
  if (!ordenId || typeof ordenId !== "string") throw new HttpsError("invalid-argument", "Falta la orden.");
  const texto = String(motivo || "").trim();
  const oRef = db.collection("ordenes_de_servicio").doc(ordenId);
  const oSnap = await oRef.get();
  if (!oSnap.exists) throw new HttpsError("not-found", `La orden ${ordenId} no existe.`);
  const orden = oSnap.data() || {};
  const rechazo = motivoRechazo(orden, { interna: await esOrdenInterna(orden), motivo: texto });
  if (rechazo) throw new HttpsError("failed-precondition", rechazo);

  // Foto de lo que hay: qué vuelve y qué ya no estaba. Es informativa (va a la
  // orden y al correo); el movimiento lo hace el trigger con sus candados.
  const vuelven = [];
  const yaNo = [];
  for (const e of (orden.equipos || [])) {
    if (!e || e.eliminado) continue;
    const serial = serialDe(e);
    if (!serial) continue;
    let ficha = null;
    try { ficha = (await pool.resolver(serial, e.modelo_id || null, e.modelo || "")).data || null; } catch { /* se trata como sin ficha */ }
    const fila = { serial, modelo: String(e.modelo || (ficha && ficha.modelo_label) || "").trim() };
    if (ficha && ficha.estado === pool.ESTADOS.EN_TALLER && ficha.orden_actual_id === ordenId) vuelven.push(fila);
    else {
      const con = ficha && ficha.asignacion && ficha.asignacion.cliente_nombre;
      yaNo.push({ ...fila, donde: !ficha ? "sin ficha en el inventario"
        : `${DONDE[ficha.estado] || ficha.estado}${con && ficha.estado !== "en_bodega" ? ` (${con})` : ""}` });
    }
  }

  const ahora = admin.firestore.Timestamp.now();
  await db.runTransaction(async (tx) => {
    const s = await tx.get(oRef);
    const d = s.exists ? s.data() : null;
    const r = motivoRechazo(d, { interna: true, motivo: texto });
    if (r) throw new HttpsError("failed-precondition", r);
    tx.update(oRef, {
      estado_reparacion: CERRADA_A_BODEGA,
      estado_antes_de_bodega: d.estado_reparacion || "POR ASIGNAR",
      devuelta_bodega: {
        motivo: texto, por_email: usuario, por_uid: uid, at: ahora,
        vuelven: vuelven.map((u) => u.serial),
        ya_no_estaban: yaNo,
      },
      fecha_devuelta_bodega: FV.serverTimestamp(),
      os_logs: FV.arrayUnion({ action: "DEVOLVER_A_BODEGA", by: uid || usuario, at: ahora,
        nota: `${vuelven.length} a bodega · ${yaNo.length} ya no estaban` }),
    });
  });
  logger.info("[devolverOrdenABodega]", { ordenId, usuario, vuelven: vuelven.length, ya_no: yaNo.length });
  const mailId = correo ? await avisar({ ordenId, orden, motivo: texto, usuario, vuelven, yaNo }) : null;
  return { ok: true, orden_id: ordenId, vuelven, ya_no_estaban: yaNo, aviso_mail_id: mailId };
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) {
      throw new HttpsError("permission-denied", "Solo recepción, taller (jefatura), bodega y administración devuelven una orden a bodega.");
    }
    const { ordenId, motivo } = request.data || {};
    return ejecutar({ usuario: u.email || uid, uid, ordenId, motivo });
  },
);
module.exports.ejecutar = ejecutar;
module.exports.motivoRechazo = motivoRechazo;
module.exports.tipoAdmite = tipoAdmite;

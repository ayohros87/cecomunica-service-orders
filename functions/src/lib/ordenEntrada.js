// Orden de servicio de ENTRADA (inspección de equipos devueltos) — creada
// automáticamente cuando un cliente devuelve equipos: cierre de enmienda con
// entradas u anulación de contrato (PLAN_CICLO_VIDA_EQUIPOS.md). Así el taller
// recibe el trabajo en su cola normal (POR ASIGNAR → asignar técnico →
// intervención por equipo → COMPLETADO) en vez de una lista pasiva.
//
// El pool NO cambia de estado por estas órdenes (los equipos siguen "Entrada —
// por inspeccionar"): onOrdenWritePool las detecta por el campo
// `entrada_inspeccion` y solo enlaza orden_actual_id. La disposición final
// (Inspección OK → bodega / baja) sigue siendo por unidad en Equipos por serial.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { configEmailTo } = require("./mailRecipients");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

const COND = { bueno: "buen estado", danado: "DAÑADO" };

// Equipo de la orden a partir de una unidad devuelta. Los booleanos de
// accesorios reflejan lo que el cliente entregó según el checklist del
// check-in de la devolución (acuse firmado); sin checklist quedan en false
// (no consta que lo haya entregado).
function equipoDeEntrada(u, observaciones) {
  const acc = u.accesorios || {};
  const serial = (u.serial || "").toString().trim();
  return {
    id: crypto.randomUUID(),
    modelo_id: u.modelo_id || null,
    modelo: (u.modelo || "").toString().trim(),
    serial,
    numero_de_serie: serial,
    bateria: !!acc.bateria, clip: !!acc.clip, cargador: !!acc.cargador,
    fuente: !!acc.fuente, antena: !!acc.antena, cubrepolvo: !!acc.cubrepolvo,
    observaciones,
    eliminado: false,
  };
}

// Conteo de equipos con plural correcto ("1 equipo devuelto" / "6 equipos
// devueltos"). Este texto termina impreso en la orden de servicio, así que
// no puede seguir siendo el "equipo(s) devuelto(s)" de plantilla.
function frasePiezas(n) {
  const s = Number(n) === 1 ? "" : "s";
  return `${n} equipo${s} devuelto${s}`;
}

// Observación general auto-generada de una ENTRADA. Se REGENERA cada vez que
// una tanda nueva agrega equipos (onOrdenDevolucionWrite): el conteo tiene que
// seguir al array `equipos`, no quedarse con el de la primera tanda.
function obsEntradaAuto(n, motivo, contratoLabel) {
  return `Orden creada automáticamente: inspección de ${frasePiezas(n)}. ${motivo} — contrato ${contratoLabel || "—"}.`;
}

// Reconoce el encabezado auto-generado (cualquier conteo, con el "(s)" viejo o
// con el plural nuevo) para poder reescribir el número sin pisar notas que
// alguien haya agregado a mano.
const RE_OBS_AUTO = /^Orden creada automáticamente: inspección de \d+ equipos?(?:\(s\))? devueltos?(?:\(s\))?\./i;

// Observación estándar del equipo al entrar: condición/daño registrados en
// el momento del check-in (lo que el cliente firmó), previo a la revisión.
function obsDeEntrada(u, motivo) {
  const partes = [`Inspección de entrada — ${motivo}.`];
  if (u.condicion) partes.push(`Condición reportada: ${COND[u.condicion] || u.condicion}.`);
  if (u.dano) partes.push(`Daño visible al recibir: ${u.dano}.`);
  return partes.join(" ");
}

// Observación de un equipo agregado por una TANDA posterior (la ENTRADA ya
// existía). Vive aquí junto a obsDeEntrada para que obsEquipoDevolucion —
// que reconoce ambas formas para la corrección pre-firma — no se desincronice.
function obsDeTanda(ordenDevId, dano) {
  return `Tanda de devolución ${ordenDevId} — pendiente de inspección.` +
    (dano ? ` Daño visible al recibir: ${dano}.` : "");
}

// Las dos formas auto-generadas de la observación de un equipo que entró por
// una devolución: al CREAR la ENTRADA (obsDeEntrada, sin condición — el
// check-in de devolución no la captura) o al agregarlo una tanda (obsDeTanda).
function obsEquipoDevolucion(ordenDevId, motivoEntrada, dano) {
  return [obsDeEntrada({ dano }, motivoEntrada), obsDeTanda(ordenDevId, dano)];
}

// Corrección pre-firma espejada en la ENTRADA: recepción corrigió accesorios
// o daño de una unidad recibida ANTES de que el cliente firmara el acuse, y
// la ENTRADA nació con los datos originales congelados. Transformación pura
// (testeable sin Firestore) sobre el array `equipos` de la ENTRADA.
//
// Candado clave: la observación del equipo se reescribe SOLO si su texto
// actual es EXACTAMENTE una de las auto-generadas con el daño anterior —
// cualquier otra cosa es una nota hecha a mano (taller/recepción) y no se
// pisa. Los checkmarks de accesorios solo cambian si la corrección trae
// checklist. correcciones: [{ serial, accesorios, dano_visible, dano_antes }].
function corregirEquiposEntrada(equipos, correcciones, ordenDevId, motivoEntrada) {
  const lista = (Array.isArray(equipos) ? equipos : []).map(x => ({ ...x }));
  let cambios = 0;
  for (const c of (correcciones || [])) {
    const serial = String(c.serial || "").trim().toUpperCase();
    if (!serial) continue;
    const i = lista.findIndex(x => !x.eliminado &&
      String(x.numero_de_serie || x.serial || "").trim().toUpperCase() === serial);
    if (i < 0) continue;
    const eq = lista[i];
    const esperadas = obsEquipoDevolucion(ordenDevId, motivoEntrada, c.dano_antes || "");
    const idx = esperadas.indexOf(String(eq.observaciones || ""));
    if (idx < 0) continue; // observación editada a mano: no se pisa
    const acc = c.accesorios;
    lista[i] = {
      ...eq,
      ...(acc ? {
        bateria: !!acc.bateria, clip: !!acc.clip, cargador: !!acc.cargador,
        fuente: !!acc.fuente, antena: !!acc.antena, cubrepolvo: !!acc.cubrepolvo,
      } : {}),
      observaciones: obsEquipoDevolucion(ordenDevId, motivoEntrada, c.dano_visible || "")[idx],
    };
    cambios++;
  }
  return { equipos: lista, cambios };
}

// Número de orden con el formato de la app (AAAAMMDD + secuencia de 2 dígitos,
// ej. 2026071604). create() falla si el ID ya existe → reintenta con el
// siguiente consecutivo (carrera con una creación manual simultánea).
async function _siguienteOrdenId() {
  const hoy = new Date();
  // Zona horaria de Panamá (UTC-5, sin DST) — el formato del ID es por fecha local.
  const local = new Date(hoy.getTime() - 5 * 60 * 60 * 1000);
  const fechaBase = `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
  const snap = await db.collection("ordenes_de_servicio")
    .where(admin.firestore.FieldPath.documentId(), ">=", `${fechaBase}00`)
    .where(admin.firestore.FieldPath.documentId(), "<=", `${fechaBase}99`)
    .get();
  const usados = snap.docs
    .map(d => parseInt(d.id.slice(-2), 10))
    .filter(n => !Number.isNaN(n));
  const siguiente = usados.length ? Math.max(...usados) + 1 : 1;
  return { fechaBase, siguiente };
}

// Destinatarios: recepción (empresa/config.email_recepcion o todos los usuarios
// con rol recepcion) + jefe de taller (empresa/config.email_taller — es quien
// debe ASIGNAR la orden) + el vendedor asignado del cliente. Nunca lanza.
async function _destinatarios(clienteId) {
  const emails = new Set();
  try {
    const cfg = await configEmailTo("recepcion", "");
    if (cfg) cfg.split(",").map(s => s.trim().toLowerCase()).filter(isEmail).forEach(e => emails.add(e));
  } catch (e) { /* fallback abajo */ }
  try {
    const taller = await configEmailTo("taller", "");
    if (taller) taller.split(",").map(s => s.trim().toLowerCase()).filter(isEmail).forEach(e => emails.add(e));
  } catch (e) { /* sin taller configurado: recepción cubre el aviso */ }
  if (!emails.size) {
    try {
      const snap = await db.collection("usuarios").where("rol", "==", "recepcion").get();
      snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
    } catch (e) {
      logger.warn("[ordenEntrada] No se pudieron leer usuarios de recepción", { error: e.message });
    }
  }
  try {
    if (clienteId) {
      const cli = await db.collection("clientes").doc(clienteId).get();
      const vendUid = cli.exists ? cli.data().vendedor_asignado : null;
      if (vendUid) {
        const v = await db.collection("usuarios").doc(vendUid).get();
        const e = v.exists ? v.data().email : null;
        if (isEmail(e)) emails.add(e.trim().toLowerCase());
      }
    }
  } catch (e) {
    logger.warn("[ordenEntrada] No se pudo resolver el vendedor del cliente", { clienteId, error: e.message });
  }
  return [...emails];
}

/**
 * Crea la orden de ENTRADA y encola el correo a recepción + vendedor.
 * @param {Object} p
 * @param {string} p.clienteId / p.clienteNombre — cliente del contrato
 * @param {string} p.contratoDocId / p.contratoId — contrato de origen
 * @param {Array}  p.unidades — [{ serial, modelo, modelo_id?, condicion? }]
 * @param {string} p.motivo — texto para observaciones y correo
 *                 ("Baja de contrato (enmienda)" | "Anulación de contrato")
 * @param {Object} p.refEntrada — { tipo: 'cancelacion'|'anulacion', id }
 * @returns {string|null} ordenId creada, o null si falló (best-effort).
 */
async function crearOrdenEntrada({ clienteId, clienteNombre, contratoDocId, contratoId, unidades, motivo, refEntrada }) {
  const lista = (unidades || []).filter(u => (u.serial || "").toString().trim());
  if (!lista.length) return null;

  const equipos = lista.map(u => equipoDeEntrada(u, obsDeEntrada(u, motivo)));

  const observaciones = obsEntradaAuto(lista.length, motivo, contratoId || contratoDocId);

  const data = {
    cliente_id: clienteId || "",
    cliente_nombre: clienteNombre || "",
    vendedor_asignado: "",
    tipo_de_servicio: "ENTRADA",
    // Nace POR ASIGNAR (pedido del dueño 2026-09-03, caso 2026090308): lo que
    // la ENTRADA espera es un TÉCNICO que la inspeccione, y "RECIBIDO EN
    // MOSTRADOR" la escondía de la cola de asignación. La recepción física es
    // real y queda sellada abajo (fecha_recepcion + acuse que copia
    // onOrdenDevolucionWrite); el flujo no pasa por "Recibir": botonesFlujo
    // ofrece Asignar directo para las ENTRADA (sinRecepcion) y las rules ya
    // permiten POR ASIGNAR → ASIGNADO. Antes nacía "RECIBIDO EN MOSTRADOR"
    // (2026-07-21, "los equipos ya están en el taller").
    estado_reparacion: "POR ASIGNAR",
    fecha_recepcion: admin.firestore.FieldValue.serverTimestamp(),
    recepcion_por_uid: "system",
    recepcion_por_email: null,
    fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
    observaciones,
    equipos,
    contrato: {
      aplica: true,
      contrato_doc_id: contratoDocId || null,
      contrato_id: contratoId || null,
      motivo_no_aplica: null,
    },
    // Marca de orden de INSPECCIÓN de entrada: onOrdenWritePool no mueve el
    // estado del pool para estas órdenes (los equipos siguen en cuarentena).
    entrada_inspeccion: { tipo: refEntrada?.tipo || "entrada", ref_id: refEntrada?.id || null },
    creado_por_uid: "system",
    creado_por_email: null,
    eliminado: false,
    os_logs: [{ action: "CREAR", by: "system:orden-entrada" }],
  };

  // Intenta hasta 5 consecutivos por si hay carrera con una creación manual.
  let ordenId = null;
  const { fechaBase, siguiente } = await _siguienteOrdenId();
  for (let i = 0; i < 5 && !ordenId; i++) {
    const candidato = `${fechaBase}${String(siguiente + i).padStart(2, "0")}`;
    try {
      await db.collection("ordenes_de_servicio").doc(candidato).create(data);
      ordenId = candidato;
    } catch (e) {
      if (e.code !== 6 && !/already exists/i.test(e.message || "")) throw e; // 6 = ALREADY_EXISTS
    }
  }
  if (!ordenId) {
    logger.error("[ordenEntrada] No se pudo reservar un número de orden", { fechaBase, contratoId });
    return null;
  }
  logger.info("[ordenEntrada] Orden de entrada creada", { ordenId, contratoId, unidades: lista.length });

  // Correo a recepción + vendedor del cliente (best-effort).
  try {
    const destinatarios = await _destinatarios(clienteId);
    if (destinatarios.length) {
      const filas = lista.map(u => {
        const cond = [COND[u.condicion] || u.condicion, u.dano ? `daño visible: ${u.dano}` : ""]
          .filter(Boolean).join(" · ") || "—";
        return `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${escapeHtml(u.serial)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(u.modelo || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(cond)}</td>
        </tr>`;
      }).join("");
      await db.collection("mail_queue").add({
        to: destinatarios[0],
        cc: destinatarios.length > 1 ? destinatarios.slice(1).join(",") : null,
        subject: `Nueva orden de ENTRADA ${ordenId} – ${clienteNombre || "Cliente"}`,
        preheader: `${frasePiezas(lista.length)} para inspección · ${motivo}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden de entrada creada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Se creó automáticamente la orden <b>${escapeHtml(ordenId)}</b> por <b>${escapeHtml(motivo)}</b>
            del contrato <b>${escapeHtml(contratoId || contratoDocId || "—")}</b> de
            <b>${escapeHtml(clienteNombre || "—")}</b>. El taller debe inspeccionar los equipos devueltos;
            al terminar, inventario los regresa a bodega o los da de baja.
          </p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Condición reportada</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>`,
        ctaUrl: `${APP_BASE_URL}/ordenes/index.html`,
        ctaLabel: "Ver órdenes de servicio",
        meta: {
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          source: "orden-entrada",
          orden_id: ordenId,
          contrato_id: contratoId || contratoDocId || null,
        },
        status: "queued",
      });
      logger.info("[ordenEntrada] Correo encolado", { ordenId, to: destinatarios[0], cc: destinatarios.length - 1 });
    } else {
      logger.warn("[ordenEntrada] Sin destinatarios (recepción/vendedor) — orden creada sin correo", { ordenId });
    }
  } catch (e) {
    logger.warn("[ordenEntrada] No se pudo encolar el correo (no crítico)", { ordenId, error: e.message });
  }

  return ordenId;
}

module.exports = {
  crearOrdenEntrada, equipoDeEntrada, frasePiezas, obsEntradaAuto, RE_OBS_AUTO,
  obsDeTanda, obsEquipoDevolucion, corregirEquiposEntrada,
};

// Máquina de estados de las gestiones por cliente (Ola 2 — reemplazo y demo).
// docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md §4.4.
//
// Reacciona a escrituras en gestiones/{gid}:
//   A) creada pendiente_aprobacion → correo a administradores (excepción por
//      servicio al cliente: propio sin garantía — decisión 2026-08-26 §8.1).
//   B) creada / aprobada → pendiente_bodega → correo a Bodega para asignar.
//   C) asignación COMPLETA (todos los ítems con serial) → mueve los entrantes
//      en el pool (asignados a la gestión, heredando el contrato del saliente),
//      crea la(s) OS de PROGRAMACIÓN (una por contrato afectado) y avisa a
//      Recepción con copia al vendedor del cliente. cierre.asignacion = true.
//   D) las 4 condiciones de cierre en true → estado 'cerrada' + correo al
//      responsable. La solicitud se cierra SOLA (correo de Zuleika, punto 10).
// La entrega y la entrada las estampa onOrdenWriteGestion (la gestión avanza
// desde las órdenes — cero botones extra). Todo idempotente: cada bloque
// verifica el flanco y las marcas antes de actuar.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const pool = require("../../domain/equiposPool");
const G = require("../../lib/gestiones");

const CIERRE_FLAGS = ["asignacion", "programacion", "entrega", "entrada"];

function asignacionCompleta(g) {
  if (g.tipo === "reemplazo") {
    const items = g.items || [];
    return items.length > 0 && items.every(it => String(it.serial_nuevo || "").trim());
  }
  if (g.tipo === "demo") {
    const total = (g.demo?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const asignados = (g.demo?.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
    return total > 0 && asignados >= total;
  }
  return false;
}

async function correoAdmins(gid, g) {
  const admins = await G.adminEmails();
  if (!admins.length) {
    logger.warn("[onGestionWrite] excepción sin administradores con email", { gid });
    return;
  }
  const items = (g.items || []).filter(it => it.elegibilidad === "propio_excepcion");
  await G.encolarCorreo({
    to: admins[0],
    cc: admins.length > 1 ? admins.slice(1).join(",") : null,
    subject: `Aprobación requerida: ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid} — ${g.cliente_nombre || "Cliente"}`,
    preheader: "Reemplazo de equipo propio sin garantía vigente (excepción por servicio al cliente)",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Gestión esperando aprobación</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> incluye
        equipo(s) <b>propios sin garantía vigente</b>: el reemplazo procede como excepción por servicio
        al cliente y requiere aprobación de un administrador antes de que Bodega asigne.
      </p>
      ${G.tablaHtml(["Serial", "Modelo", "Motivo"], (items.length ? items : (g.items || [])).map(it => [
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo || "—"),
        G.escapeHtml(it.motivo_detalle || it.motivo_codigo || "—"),
      ]))}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Revisar y aprobar",
    meta: { gestion_id: gid, paso: "aprobacion" },
  });
}

async function correoBodega(gid, g) {
  const to = await G.bodegaEmailTo();
  if (!to) {
    logger.warn("[onGestionWrite] sin buzón de bodega (email_bodega) — gestión sin aviso", { gid });
    return;
  }
  const filas = g.tipo === "reemplazo"
    ? (g.items || []).map(it => [
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo || "—"),
        G.escapeHtml(it.modelo_solicitado || it.modelo || "—"),
        G.escapeHtml(it.motivo_detalle || it.motivo_codigo || "—"),
      ])
    : (g.demo?.lineas || []).map(l => [
        `${Number(l.cantidad || 0)}`,
        G.escapeHtml(l.modelo || "—"),
        G.escapeHtml(g.demo?.finalidad || "—"), "",
      ]);
  await G.encolarCorreo({
    to,
    subject: `${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}: asignar serial(es) — ${g.cliente_nombre || "Cliente"}`,
    preheader: g.tipo === "reemplazo"
      ? `Asignar ${(g.items || []).length} equipo(s) de reemplazo`
      : `Asignar equipos para demo (nuevo o refurbished)`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">${G.escapeHtml(G.TIPO_LABEL[g.tipo] || g.tipo)} — asignación de equipos</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> espera
        que Bodega asigne ${g.tipo === "reemplazo" ? "el serial del equipo que sustituye a cada radio" : "los seriales del demo (stock nuevo o refurbished)"}.
        Al completar la asignación, el sistema crea solo la orden de programación y avisa a Recepción.
      </p>
      ${g.tipo === "reemplazo"
        ? G.tablaHtml(["Sale", "Modelo actual", "Modelo solicitado", "Motivo"], filas)
        : G.tablaHtml(["Cantidad", "Modelo", "Finalidad", ""], filas)}`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Asignar seriales",
    meta: { gestion_id: gid, paso: "bodega" },
  });
}

async function correoRecepcion(gid, g, ordenIds) {
  const dests = await G.destinatariosRecepcionVendedor(g.cliente_id);
  if (!dests.length) {
    logger.warn("[onGestionWrite] OS de programación sin destinatarios", { gid, ordenIds });
    return;
  }
  const pares = g.tipo === "reemplazo"
    ? (g.items || []).map(it => [
        `<code>${G.escapeHtml(it.serial_nuevo || "—")}</code>`,
        `<code>${G.escapeHtml(it.serial_saliente || "—")}</code>`,
        G.escapeHtml(it.modelo_solicitado || it.modelo || "—"),
      ])
    : (g.demo?.seriales_asignados || []).map(s => [
        `<code>${G.escapeHtml(s.serial || "—")}</code>`, "—", G.escapeHtml(s.modelo || "—"),
      ]);
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
    subject: `OS de programación lista: ${ordenIds.join(", ")} — ${G.TIPO_LABEL[g.tipo] || g.tipo} ${gid}`,
    preheader: g.tipo === "reemplazo"
      ? "Programar copiando la configuración del radio reemplazado"
      : "Programar los equipos del demo",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden(es) de programación creada(s)</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Bodega asignó los equipos de la gestión <b>${G.escapeHtml(gid)}</b>
        (<b>${G.escapeHtml(g.cliente_nombre || "—")}</b>) y el sistema creó la(s) orden(es)
        <b>${ordenIds.map(G.escapeHtml).join(", ")}</b>.
        ${g.tipo === "reemplazo"
          ? "Cada equipo indica el serial que sustituye: <b>copia su configuración, coloca su ID y confirma</b>."
          : "Programar y coordinar la entrega del demo."}
      </p>
      ${G.tablaHtml(["Entra", "Sustituye a", "Modelo"], pares)}`,
    ctaUrl: `${APP_BASE_URL}/ordenes/index.html?ids=${encodeURIComponent(ordenIds.join(","))}`,
    ctaLabel: "Ver la(s) orden(es)",
    meta: { gestion_id: gid, paso: "programacion", ordenes: ordenIds.join(",") },
  });
}

module.exports = onDocumentWritten(
  { document: "gestiones/{gid}", region: "us-central1" },
  async (event) => {
    const gid = event.params.gid;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return null;
    if (!["reemplazo", "demo"].includes(after.tipo)) return null; // otros tipos: olas 3–5
    if (["cerrada", "anulada"].includes(after.estado) && before?.estado === after.estado) return null;

    const creada = !before;
    const ref = event.data.after.ref;

    // ── A/B) correos de arranque, por flanco de estado ──────────────────
    try {
      if (creada && after.estado === "pendiente_aprobacion") {
        await correoAdmins(gid, after);
        await G.registrarEvento(gid, "correo_aprobacion", "Correo de aprobación enviado a administradores (excepción propio sin garantía).");
      }
      const entraABodega =
        (creada && after.estado === "pendiente_bodega") ||
        (before && before.estado === "pendiente_aprobacion" && after.estado === "pendiente_bodega");
      if (entraABodega) {
        await correoBodega(gid, after);
        await G.registrarEvento(gid, "correo_bodega", "Aviso enviado a Bodega para asignar seriales.");
      }
    } catch (e) {
      logger.error("[onGestionWrite] correos de arranque fallaron", { gid, message: e.message });
    }

    // ── C) asignación completa → pool + OS PROGRAMACIÓN + correo ────────
    try {
      const lista = !after.ordenes?.programacion_id
        && ["pendiente_bodega", "en_proceso"].includes(after.estado)
        && asignacionCompleta(after);
      if (lista) {
        // Entrantes al pool: asignados a la gestión. El de reemplazo HEREDA el
        // contrato (línea de facturación) del saliente; el de demo queda del
        // cliente sin contrato (asignacion.tipo:'demo').
        const entrantes = after.tipo === "reemplazo"
          ? (after.items || []).map(it => ({
              serial: it.serial_nuevo,
              modelo_id: it.modelo_solicitado_id || it.modelo_id || null,
              modelo: it.modelo_solicitado || it.modelo || "",
              asignacion: {
                contrato_doc_id: it.contrato_doc_id || null,
                contrato_id: it.contrato_id || null,
                cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
                gestion_doc_id: gid,
              },
              nota: `Asignado por gestión ${gid} — reemplaza a ${it.serial_saliente || "—"}`,
            }))
          : (after.demo?.seriales_asignados || []).map(s => ({
              serial: s.serial,
              modelo_id: s.modelo_id || null,
              modelo: s.modelo || "",
              asignacion: {
                contrato_doc_id: null, contrato_id: null,
                cliente_id: after.cliente_id, cliente_nombre: after.cliente_nombre || "",
                gestion_doc_id: gid, tipo: "demo",
              },
              nota: `Asignado por gestión ${gid} (demo)`,
            }));
        for (const u of entrantes) {
          try {
            const r = await pool.transicionar(u.serial, u.modelo_id, u.modelo, {
              aEstado: pool.ESTADOS.ASIGNADO,
              soloDesde: [pool.ESTADOS.EN_BODEGA],
              tipo: "asignacion_gestion",
              refMov: { tipo: "gestion", id: gid, label: gid },
              notas: u.nota,
              extra: { asignacion: u.asignacion },
            });
            // transicionar → 'transicion' | 'sin-cambio' | 'no-existe'. Un
            // 'no-existe' aquí es un serial mal asignado por bodega — se
            // registra pero no frena la OS: el kardex y la conciliación lo ven.
            if (r !== "transicion") {
              logger.warn("[onGestionWrite] entrante no se pudo asignar en pool", { gid, serial: u.serial, motivo: r });
              await G.registrarEvento(gid, "pool_incidencia", `El serial ${u.serial} no se pudo asignar en el pool (${r}).`);
            }
          } catch (e) {
            logger.warn("[onGestionWrite] transición de entrante falló", { gid, serial: u.serial, message: e.message });
          }
        }

        const ordenIds = await G.crearOrdenesProgramacion(gid, after);
        if (ordenIds.length) {
          await ref.set({
            estado: "en_proceso",
            ordenes: {
              ...(after.ordenes || {}),
              programacion_id: ordenIds[0],
              programacion_ids: ordenIds,
            },
            cierre: { ...(after.cierre || {}), asignacion: true },
          }, { merge: true });
          await G.registrarEvento(gid, "programacion",
            `Asignación completa. OS de programación ${ordenIds.join(", ")} creada(s); correo a Recepción con copia al vendedor.`);
          await correoRecepcion(gid, after, ordenIds);
        }
      }
    } catch (e) {
      logger.error("[onGestionWrite] bloque de asignación falló", { gid, message: e.message });
    }

    // ── D) cierre automático 4/4 ─────────────────────────────────────────
    try {
      const c = after.cierre || {};
      const completo = CIERRE_FLAGS.every(k => c[k] === true);
      if (completo && !["cerrada", "anulada"].includes(after.estado)) {
        await ref.set({
          estado: "cerrada",
          cerrada_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await G.registrarEvento(gid, "cierre", "Gestión cerrada automáticamente — 4 de 4 condiciones completadas.");
        if (G.isEmail(after.responsable_email)) {
          await G.encolarCorreo({
            to: after.responsable_email,
            subject: `${G.TIPO_LABEL[after.tipo] || after.tipo} ${gid} cerrada — ${after.cliente_nombre || "Cliente"}`,
            preheader: "Las 4 condiciones de cierre se completaron",
            bodyContent: `
              <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Gestión cerrada</h2>
              <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                La gestión <b>${G.escapeHtml(gid)}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>
                completó sus 4 condiciones (asignación, programación, entrega y entrada) y se cerró
                automáticamente. El expediente queda como historial del cliente.
              </p>`,
            ctaUrl: G.urlGestion(after, gid),
            ctaLabel: "Ver el expediente",
            meta: { gestion_id: gid, paso: "cierre" },
          });
        }
        logger.info("[onGestionWrite] gestión cerrada automáticamente", { gid });
      }
    } catch (e) {
      logger.error("[onGestionWrite] cierre automático falló", { gid, message: e.message });
    }

    return null;
  }
);

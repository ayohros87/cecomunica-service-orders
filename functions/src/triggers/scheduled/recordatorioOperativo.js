// Digest diario de estancamiento operativo — cierra dos "quedan en el aire"
// que hasta ahora solo eran visibles entrando a las páginas:
//
//  A) ÓRDENES ESTANCADAS: atascadas en POR ASIGNAR / RECIBIDO EN MOSTRADOR /
//     ASIGNADO con edad entre empresa/config.orden_stale_dias (10) y
//     orden_stale_max_dias (30). Fuera del tope = legacy noise que se omite
//     para no enmascarar lo accionable — mismo criterio que admin/operacion.
//     Destinatario: taller (email_taller o usuarios jefe_taller).
//
//  B) CUARENTENA SIN INSPECCIÓN: unidades de equipos_pool en devuelto_revision
//     (entrada por anulación/baja/defectuoso) sin movimiento hace >=
//     empresa/config.entrada_recordatorio_dias (7). La salida de cuarentena es
//     manual por unidad (inspección OK / baja) y nada avisaba si nadie la hacía.
//     Destinatario: recepción (email_recepcion o usuarios rol recepcion).
//
//  D) QC PENDIENTE: órdenes en COMPLETADO (EN OFICINA) que no pueden
//     entregarse porque el control de calidad no está aprobado (o caducó al
//     cambiar los equipos), hace >= empresa/config.qc_recordatorio_dias (3).
//     La sección A no las ve: solo mira estados abiertos. Destinatario: taller.
//
//  F) EQUIPOS NO DEVUELTOS: renglones de cobros_equipos abiertos. Escala a
//     `en_cobranza` los que pasaron los 10 días y manda el resumen con el
//     monto. Destinatario: empresa/config.email_cobranza (o recepción).
//
//  G) ENTRADAs CERRADAS CON EQUIPOS QUE NO ATERRIZARON: órdenes marcadas con
//     `cierre_entrada_con_incidencias` por onOrdenWritePool — el radio se
//     quedó fuera del inventario al cerrar, casi siempre por un serial mal
//     tecleado. Destinatario: recepción, con copia al taller.
//
// F es la ÚNICA sección que escribe (el escalado de etapa); las demás solo
// mandan correos (mail_queue → onMailQueued). Un correo por sección por día,
// solo si hay filas.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const { tallerEmailTo, recepcionEmails, configEmailTo } = require("../../lib/mailRecipients");
const { pendientesDevolucion } = require("../../lib/devolucion");
// Predicados compartidos con el navegador (espejo + test de sincronía):
// la definición de "estancada", "lista para entregar", el estado del QC y
// el "posponer" viven UNA vez en src/domain/pendientes.js. Antes cada
// sección de este cron llevaba su copia y ya divergían.
const PEND = require("../../domain/pendientes");
const cobros = require("../../lib/cobrosEquipos");
const VIG = require("../../lib/vigencia");

const ESTADOS_ABIERTOS = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO"];
const STALE_DIAS_DEFAULT = 10;
const STALE_MAX_DEFAULT = 30;
const ENTRADA_DIAS_DEFAULT = 7;
const DEVOLUCION_SLA_DEFAULT = 15;
const QC_DIAS_DEFAULT = 3;
const ENTREGA_DIAS_DEFAULT = 3;
const MAX_FILAS = 30; // tope de filas por correo; el resto se resume

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function aDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function edadDias(ts, now) {
  const d = aDate(ts);
  return d ? (now - d) / (1000 * 60 * 60 * 24) : null;
}

// Deep-link del CTA: las órdenes CONCRETAS que el correo enumera, por ID.
//
// El botón llevaba a `/ordenes/index.html` pelado y la bandeja muestra las 40
// MÁS RECIENTES — mientras que todo lo que enumeran estos correos es viejo por
// definición (estancadas 10+ días, en cola de QC, esperando entrega). El
// resultado era que la persona hacía clic y veía su bandeja de siempre, sin
// rastro de lo anunciado (reporte de la jefa de taller, 2026-08-20:
// "carga la página como si estuviera iniciando sesión de manera normal").
//
// Se mandan los IDs y no un filtro por criterio para no duplicar en el cliente
// la lógica de edad/SLA/estado de este cron, que se desincronizaría a la
// primera. El tope es el mismo MAX_FILAS que se muestra en la tabla.
function idsCta(arr) {
  const ids = arr.slice(0, MAX_FILAS).map(o => o.id).filter(Boolean);
  return ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
}

// Enlace de una fila a su orden. Llegar a la orden nombrada no debería exigir
// buscarla a mano en la bandeja.
function linkOrden(id, texto) {
  return `<a href="${APP_BASE_URL}/ordenes/editar-orden.html?id=${encodeURIComponent(id)}">${esc(texto)}</a>`;
}

function tablaHtml(headers, rows) {
  const th = headers.map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">${esc(h)}</th>`).join("");
  const trs = rows.map(cols =>
    `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${c}</td>`).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
    <thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

module.exports = onSchedule(
  {
    schedule: "every day 07:15",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    const now = new Date();

    // Config con fallbacks (nunca lanza).
    let staleDias = STALE_DIAS_DEFAULT, staleMax = STALE_MAX_DEFAULT, entradaDias = ENTRADA_DIAS_DEFAULT, devolucionSla = DEVOLUCION_SLA_DEFAULT, qcDias = QC_DIAS_DEFAULT, entregaDias = ENTREGA_DIAS_DEFAULT;
    try {
      const cfg = (await db.collection("empresa").doc("config").get()).data() || {};
      if (Number.isFinite(Number(cfg.orden_stale_dias)) && Number(cfg.orden_stale_dias) >= 1) staleDias = Number(cfg.orden_stale_dias);
      if (Number.isFinite(Number(cfg.orden_stale_max_dias)) && Number(cfg.orden_stale_max_dias) > staleDias) staleMax = Number(cfg.orden_stale_max_dias);
      if (Number.isFinite(Number(cfg.entrada_recordatorio_dias)) && Number(cfg.entrada_recordatorio_dias) >= 1) entradaDias = Number(cfg.entrada_recordatorio_dias);
      if (Number.isFinite(Number(cfg.devolucion_sla_dias)) && Number(cfg.devolucion_sla_dias) >= 1) devolucionSla = Number(cfg.devolucion_sla_dias);
      if (Number.isFinite(Number(cfg.qc_recordatorio_dias)) && Number(cfg.qc_recordatorio_dias) >= 1) qcDias = Number(cfg.qc_recordatorio_dias);
      if (Number.isFinite(Number(cfg.entrega_recordatorio_dias)) && Number(cfg.entrega_recordatorio_dias) >= 1) entregaDias = Number(cfg.entrega_recordatorio_dias);
    } catch (e) { /* defaults */ }

    // ── A) Órdenes estancadas ────────────────────────────────────────────
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("estado_reparacion", "in", ESTADOS_ABIERTOS)
        .limit(1000)
        .get();

      const estancadas = [];
      snap.forEach(d => {
        const o = d.data() || {};
        // Predicado compartido (excluye eliminadas, DEVOLUCIÓN —sección C— y
        // aplica la ventana [staleDias, staleMax]); el posponer del usuario
        // silencia también este correo, no solo la bandeja del home.
        if (!PEND.esOrdenEstancada(o, now, { staleDias, staleMax })) return;
        if (PEND.estaPospuesto(o, now)) return;
        const base = o.fecha_modificacion || o.fecha_actualizacion || o.updatedAt || o.fecha_entrada || o.fecha_creacion;
        const edad = edadDias(base, now);
        estancadas.push({
          id: d.id,
          orden: o.numero_orden || d.id,
          cliente: o.cliente_nombre || o.cliente || "—",
          estado: o.estado_reparacion || "—",
          tecnico: o.tecnico_asignado || "—",
          dias: Math.floor(edad),
        });
      });
      estancadas.sort((a, b) => b.dias - a.dias);

      const to = await tallerEmailTo();
      if (estancadas.length && to) {
        // Cada orden enlazada (reporte jefa de taller 2026-08-19): el CTA
        // lleva a la lista, que muestra las 40 MÁS RECIENTES — y estas son
        // justamente las viejas, así que ninguna aparecía ahí. Sin enlace por
        // fila no había forma de llegar a la orden que el correo nombra.
        // Mismo patrón que la sección E, que sí lo hacía.
        const filas = estancadas.slice(0, MAX_FILAS).map(o => [
          `<a href="${APP_BASE_URL}/ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">${esc(o.orden)}</a>`,
          esc(o.cliente), esc(o.estado), esc(o.tecnico), `<b>${o.dias}</b>`,
        ]);
        const extra = estancadas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${estancadas.length - MAX_FILAS} más (ver listado completo en la app).</p>` : "";
        await db.collection("mail_queue").add({
          to,
          subject: `Órdenes estancadas: ${estancadas.length} sin avanzar hace ${staleDias}+ días`,
          preheader: `${estancadas.length} órdenes abiertas sin movimiento`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Órdenes sin avanzar</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estas órdenes llevan <b>${staleDias}+ días</b> sin movimiento en un estado abierto
              (se omiten las de más de ${staleMax} días — legacy).
            </p>
            ${tablaHtml(["Orden", "Cliente", "Estado", "Técnico", "Días"], filas)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/ordenes/index.html${idsCta(estancadas)}`,
          ctaLabel: "Ver estas órdenes",
          meta: { source: "recordatorioOperativo", seccion: "ordenes_estancadas", total: estancadas.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] órdenes", { abiertas: snap.size, estancadas: estancadas.length, notificado: !!(estancadas.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección órdenes falló", { message: e.message });
    }

    // ── B) Cuarentena de entrada sin inspección ──────────────────────────
    try {
      const snap = await db.collection("equipos_pool")
        .where("estado", "==", "devuelto_revision")
        .limit(1000)
        .get();

      const atascadas = [];
      snap.forEach(d => {
        const u = d.data() || {};
        if (!PEND.esCuarentenaAtascada(u, now, entradaDias)) return;
        if (PEND.estaPospuesto(u, now)) return;
        const edad = edadDias(u.updated_at || u.created_at, now);
        atascadas.push({
          serial: u.serial || d.id,
          modelo: u.modelo_label || "—",
          cliente: u.asignacion?.cliente_nombre || "—",
          dias: Math.floor(edad),
        });
      });
      atascadas.sort((a, b) => b.dias - a.dias);

      const dests = await recepcionEmails();
      if (atascadas.length && dests.length) {
        const filas = atascadas.slice(0, MAX_FILAS).map(u => [
          esc(u.serial), esc(u.modelo), esc(u.cliente), `<b>${u.dias}</b>`,
        ]);
        const extra = atascadas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${atascadas.length - MAX_FILAS} más.</p>` : "";
        await db.collection("mail_queue").add({
          to: dests[0],
          cc: dests.length > 1 ? dests.slice(1).join(", ") : null,
          subject: `Devueltos sin inspeccionar: ${atascadas.length} equipos en cuarentena hace ${entradaDias}+ días`,
          preheader: `${atascadas.length} unidades esperan inspección`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Equipos en cuarentena sin inspección</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estas unidades entraron como devolución (anulación / baja / defectuoso) y llevan
              <b>${entradaDias}+ días</b> esperando inspección. Hasta que se resuelvan
              (inspección OK → bodega, o baja) no vuelven a estar disponibles.
            </p>
            ${tablaHtml(["Serial", "Modelo", "Venía de", "Días"], filas)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/inventario/equipos.html`,
          ctaLabel: "Abrir pool de equipos",
          meta: { source: "recordatorioOperativo", seccion: "cuarentena", total: atascadas.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] cuarentena", { enCuarentena: snap.size, atascadas: atascadas.length, notificado: !!(atascadas.length && dests.length) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección cuarentena falló", { message: e.message });
    }

    // ── C) Devoluciones de equipos ───────────────────────────────────────
    // C1: órdenes de DEVOLUCIÓN abiertas más allá del SLA (devolucion_sla_dias).
    // C2: unidades pendiente_devolucion aún con el cliente SIN orden de
    //     devolución abierta que las cubra (p.ej. transición registrada a mano
    //     en la página) — el reemplazo del viejo recordatorio semanal.
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("tipo_de_servicio", "==", "DEVOLUCION")
        .limit(1000)
        .get();

      const abiertas = [];
      const cubiertos = new Set(); // serial_norm de toda orden ABIERTA (SLA o no)
      snap.forEach(d => {
        const o = d.data() || {};
        if (o.eliminado) return;
        if ((o.estado_reparacion || "").toUpperCase() === "CERRADA (DEVOLUCION)") return;
        const esperados = o.devolucion?.esperados || [];
        esperados.forEach(e => {
          const s = String(e.serial || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (s) cubiertos.add(s);
        });
        // Incluye el faltante de los contratos de PAPEL (modo sin_contrato):
        // esas órdenes nacen sin esperados —los seriales se capturan al
        // llegar— así que el conteo por serial/modelo era siempre 0 y NUNCA
        // entraban al aviso aunque el cliente hubiera devuelto 6 de 9.
        const pend = pendientesDevolucion(o.devolucion);
        const edad = edadDias(o.fecha_creacion, now);
        abiertas.push({
          id: d.id,
          cliente: o.cliente_nombre || "—",
          contrato: o.contrato?.contrato_id || "—",
          modo: o.devolucion?.modo === "confirmacion" ? "confirmación"
              : o.devolucion?.modo === "sin_contrato" ? "contrato de papel"
              : "recuperación",
          pendientes: pend,
          dias: edad == null ? 0 : Math.floor(edad),
        });
      });
      const vencidas = abiertas.filter(a => a.dias >= devolucionSla && a.pendientes > 0)
        .sort((a, b) => b.dias - a.dias);

      // C2: unidades sueltas (flag activo, con el cliente, sin orden abierta).
      const sueltas = [];
      try {
        const pend = await db.collection("equipos_pool")
          .where("pendiente_devolucion", "==", true).limit(1000).get();
        pend.forEach(d => {
          const u = d.data() || {};
          if (!["asignado_contrato", "en_cliente"].includes(u.estado)) return;
          const s = String(u.serial_norm || u.serial || d.id).toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (cubiertos.has(s)) return;
          if (PEND.estaPospuesto(u, now)) return;
          sueltas.push({
            serial: u.serial || d.id,
            modelo: u.modelo_label || "—",
            cliente: u.asignacion?.cliente_nombre || "—",
            dias: Math.floor(edadDias(u.updated_at, now) ?? 0),
          });
        });
        sueltas.sort((a, b) => b.dias - a.dias);
      } catch (e) {
        logger.warn("[recordatorioOperativo] C2 (sueltas) falló", { message: e.message });
      }

      const dests = await recepcionEmails();
      if ((vencidas.length || sueltas.length) && dests.length) {
        const filasV = vencidas.slice(0, MAX_FILAS).map(a => [
          linkOrden(a.id, a.id), esc(a.cliente), esc(a.contrato), esc(a.modo), `${a.pendientes}`, `<b>${a.dias}</b>`,
        ]);
        const filasS = sueltas.slice(0, MAX_FILAS).map(u => [
          esc(u.serial), esc(u.modelo), esc(u.cliente), `<b>${u.dias}</b>`,
        ]);
        await db.collection("mail_queue").add({
          to: dests[0],
          cc: dests.length > 1 ? dests.slice(1).join(", ") : null,
          subject: `Devoluciones pendientes: ${vencidas.length} orden(es) vencida(s)${sueltas.length ? ` · ${sueltas.length} equipo(s) sin orden` : ""}`,
          preheader: `Devoluciones de equipos sin resolver (SLA ${devolucionSla} días)`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Devoluciones de equipos</h2>
            ${vencidas.length ? `
            <p style="margin:0 0 8px;font:14px/1.5 Arial,sans-serif;">
              Órdenes de devolución abiertas hace <b>${devolucionSla}+ días</b> con unidades sin resolver
              (coordinar con el cliente, o registrar la excepción con su motivo):
            </p>
            ${tablaHtml(["Orden", "Cliente", "Contrato", "Modo", "Pend.", "Días"], filasV)}` : ""}
            ${sueltas.length ? `
            <p style="margin:${vencidas.length ? "14px" : "0"} 0 8px;font:14px/1.5 Arial,sans-serif;">
              Equipos marcados <b>pendiente de devolución</b> que <b>no están en ninguna orden de
              devolución abierta</b> (transiciones registradas a mano) — nadie es dueño de recuperarlos:
            </p>
            ${tablaHtml(["Serial", "Modelo", "Cliente", "Días"], filasS)}` : ""}`,
          ctaUrl: `${APP_BASE_URL}/ordenes/index.html${idsCta(vencidas)}`,
          ctaLabel: vencidas.length ? "Ver estas órdenes" : "Ver órdenes",
          meta: { source: "recordatorioOperativo", seccion: "devoluciones", vencidas: vencidas.length, sueltas: sueltas.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] devoluciones", {
        abiertas: abiertas.length, vencidas: vencidas.length, sueltas: sueltas.length,
        notificado: !!((vencidas.length || sueltas.length) && dests.length),
      });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección devoluciones falló", { message: e.message });
    }

    // ── D) Órdenes esperando control de calidad ──────────────────────────
    // La sección A solo mira estados ABIERTOS (POR ASIGNAR / RECIBIDO /
    // ASIGNADO): una orden parada en COMPLETADO (EN OFICINA) esperando la
    // firma de QC era invisible para todo el mundo, y el candado impide
    // entregarla. Hoy el QC lo firma una sola persona, así que su ausencia
    // detiene la cola en silencio.
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("qc_requerido", "==", true)
        .limit(1000)
        .get();

      const esperando = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (o.eliminado) return;
        // Predicado compartido: excluye eliminadas, no-COMPLETADO y ENTRADA,
        // y trae la caducidad COMPLETA (conteo Y sustitución de serial — la
        // copia local de este cron solo sabía contar).
        if (!PEND.esQcColaOperativa(o)) return;
        const edad = edadDias(o.fecha_completado, now);
        if (edad == null || edad < qcDias) return;
        esperando.push({
          id: d.id,     // necesario para enlazar la fila a la orden
          orden: o.numero_orden || d.id,
          cliente: o.cliente_nombre || o.cliente || "—",
          tipo: o.tipo_de_servicio || "—",
          tecnico: o.tecnico_asignado || "—",
          estadoQc: PEND.qcCaducado(o) ? "Caducado" : (o.qc?.resultado === "rechazado" ? "Rechazado" : "Sin revisar"),
          dias: Math.floor(edad),
        });
      });
      esperando.sort((a, b) => b.dias - a.dias);

      const to = await tallerEmailTo();
      if (esperando.length && to) {
        // Enlace por fila, igual que en la sección A: el CTA `?qc=1` ya trae la
        // cola completa desde el servidor, pero llegar a UNA orden concreta
        // desde el correo sigue siendo lo más directo.
        const filas = esperando.slice(0, MAX_FILAS).map(o => [
          `<a href="${APP_BASE_URL}/ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">${esc(o.orden)}</a>`,
          esc(o.cliente), esc(o.tipo), esc(o.tecnico), esc(o.estadoQc), `<b>${o.dias}</b>`,
        ]);
        const extra = esperando.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${esperando.length - MAX_FILAS} más (ver listado completo en la app).</p>` : "";
        await db.collection("mail_queue").add({
          to,
          subject: `Control de calidad: ${esperando.length} orden(es) esperando hace ${qcDias}+ días`,
          preheader: `${esperando.length} órdenes completadas que no pueden entregarse sin QC`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Órdenes esperando control de calidad</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estas órdenes están <b>completadas en oficina</b> hace <b>${qcDias}+ días</b> y
              <b>no pueden entregarse</b> hasta que el control de calidad quede aprobado.
            </p>
            ${tablaHtml(["Orden", "Cliente", "Tipo", "Técnico", "QC", "Días"], filas)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/ordenes/index.html?qc=1`,
          ctaLabel: "Ver cola de QC",
          meta: { source: "recordatorioOperativo", seccion: "qc_pendiente", total: esperando.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] qc", { conMarca: snap.size, esperando: esperando.length, notificado: !!(esperando.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección qc falló", { message: e.message });
    }

    // ── E) Listas para entregar (informe tracking 2026-08-12, P6) ────────
    // El eslabón más débil del ciclo es humano: la orden queda COMPLETADA con
    // QC aprobado y nadie la marca ENTREGADO AL CLIENTE. Medido el 2026-08-11:
    // el 46% de las PROGRAMACIÓN de agosto se paró ahí — y sin ENTREGADO no hay
    // `entrega_confirmada`, no corre la transición de renovación y el pool se
    // queda `en_taller`. La sección D avisa cuando FALTA el QC; esta avisa
    // cuando el QC YA ESTÁ y solo falta apretar el botón.
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("estado_reparacion", "==", "COMPLETADO (EN OFICINA)")
        .limit(1000)
        .get();

      const listas = [];
      snap.forEach(d => {
        const o = d.data() || {};
        // Predicado compartido: tipo cuyo terminal ES la entrega, QC aprobado
        // y vigente (si falta, es cola de la sección D), edad suficiente.
        if (!PEND.esListaParaEntregar(o, now, entregaDias)) return;
        if (PEND.estaPospuesto(o, now)) return;
        const edad = edadDias(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion, now);
        listas.push({
          id: d.id,
          orden: o.numero_orden || d.id,
          cliente: o.cliente_nombre || o.cliente || "—",
          tipo: o.tipo_de_servicio || "—",
          contrato: o.contrato?.contrato_id || "—",
          dias: Math.floor(edad),
        });
      });
      listas.sort((a, b) => b.dias - a.dias);

      const to = (await recepcionEmails()).join(",");
      if (listas.length && to) {
        const filas = listas.slice(0, MAX_FILAS).map(o => [
          `<a href="${APP_BASE_URL}/ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">${esc(o.orden)}</a>`,
          esc(o.cliente), esc(o.tipo), esc(o.contrato), `<b>${o.dias}</b>`,
        ]);
        const extra = listas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${listas.length - MAX_FILAS} más.</p>` : "";
        await db.collection("mail_queue").add({
          to,
          subject: `Listas para entregar: ${listas.length} orden(es) con el trabajo terminado hace ${entregaDias}+ días`,
          preheader: `${listas.length} órdenes completadas y con QC listo — solo falta marcar la entrega`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Órdenes listas para entregar</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              El trabajo está <b>terminado</b> y el control de calidad (si aplica) <b>aprobado</b> —
              solo falta marcarlas <b>ENTREGADO AL CLIENTE</b> cuando el cliente reciba.
              Sin ese paso el contrato no registra la entrega, la renovación no corre su
              transición de equipos y el inventario sigue contando esos radios en el taller.
            </p>
            ${tablaHtml(["Orden", "Cliente", "Tipo", "Contrato", "Días"], filas)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/ordenes/index.html${idsCta(listas)}`,
          ctaLabel: "Ver estas órdenes",
          meta: { source: "recordatorioOperativo", seccion: "listas_entregar", total: listas.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] listas para entregar", { total: listas.length, notificado: !!(listas.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección listas-entregar falló", { message: e.message });
    }

    // ── G) ENTRADAs cerradas con equipos que no aterrizaron ──────────────
    // El aviso que no existía. `onOrdenWritePool` anota en la orden los equipos
    // que el cierre no pudo mandar a bodega (`cierre_entrada_incidencias`);
    // esto los saca a la luz. Sin esta sección la anotación sería otro campo
    // que se escribe y nadie lee — exactamente el error que dejó nueve días
    // fuera del inventario al radio de TIL PANAMA.
    //
    // Va a recepción (quien teclea los seriales y puede corregirlos) con copia
    // al taller (quien cierra las ENTRADAs). El motivo `sin_ficha` es el grave:
    // hay un radio físico que el sistema no sabe dónde está, casi siempre por
    // un dígito mal tecleado. Corregir el serial en la orden lo aterriza solo.
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("cierre_entrada_con_incidencias", "==", true)
        .limit(500)
        .get();

      const filas = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (o.eliminado) return;
        (o.cierre_entrada_incidencias || []).forEach(i => {
          filas.push({
            id: d.id,
            orden: o.numero_orden || d.id,
            cliente: o.cliente_nombre || "—",
            serial: i.serial || "—",
            modelo: i.modelo || "—",
            motivo: i.motivo,
            estado: i.estado || null,
            dias: Math.floor(edadDias(o.cierre_entrada_incidencias_at || o.fecha_cierre_entrada, now) || 0),
          });
        });
      });
      filas.sort((a, b) => b.dias - a.dias);
      const sinFicha = filas.filter(f => f.motivo === "sin_ficha").length;

      const to = (await recepcionEmails()).join(",");
      const cc = await tallerEmailTo();
      if (filas.length && to) {
        const rows = filas.slice(0, MAX_FILAS).map(f => [
          linkOrden(f.id, f.orden), esc(f.cliente),
          `<code>${esc(f.serial)}</code>`, esc(f.modelo),
          f.motivo === "sin_ficha"
            ? '<b style="color:#b91c1c;">No existe en inventario</b>'
            : `No se pudo mover${f.estado ? ` (está ${esc(f.estado)})` : ""}`,
          `<b>${f.dias}</b>`,
        ]);
        const extra = filas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${filas.length - MAX_FILAS} más.</p>` : "";
        await db.collection("mail_queue").add({
          to, ...(cc ? { cc } : {}),
          subject: `Equipos que no llegaron a bodega al cerrar su ENTRADA: ${filas.length}`,
          preheader: `${filas.length} equipo(s) quedaron fuera del inventario al cerrar su orden de ENTRADA`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991b1b;">Equipos que no aterrizaron en bodega</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estas órdenes de ENTRADA se cerraron, pero <b>${filas.length} equipo(s)</b> no pasaron a bodega.
              Mientras tanto NO cuentan como disponibles: si alguien busca uno de estos radios en el
              sistema, no lo va a encontrar en el estante.
            </p>
            ${sinFicha ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#b91c1c;">
              <b>${sinFicha}</b> tienen un serial que <b>no existe en el inventario</b> — casi siempre es un
              dígito mal tecleado. Corrígelo en la orden (lápiz del equipo) y el radio aterriza solo.</p>` : ""}
            ${tablaHtml(["Orden", "Cliente", "Serial", "Modelo", "Qué pasó", "Días"], rows)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/ordenes/index.html${idsCta(filas)}`,
          ctaLabel: "Ver estas órdenes",
          meta: { source: "recordatorioOperativo", seccion: "entrada_incidencias",
                  total: filas.length, sinFicha },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] incidencias de cierre de ENTRADA",
        { total: filas.length, sinFicha, notificado: !!(filas.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección entrada-incidencias falló", { message: e.message });
    }

    // ── F) Equipos no devueltos: escalado a cobranza ─────────────────────
    // Plan: docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md.
    // Un equipo que el cliente no devolvió es plata que se debe, y lo que la
    // hacía evaporarse era que nadie la volvía a mirar: el dato quedaba en un
    // campo sin pantalla. Esta sección hace dos cosas, en este orden:
    //   1. escala a `en_cobranza` los renglones que pasaron los 10 días
    //      (regla del usuario 2026-08-20) — el escalado es del sistema, no de
    //      una persona, justo para que no dependa de que alguien se acuerde;
    //   2. manda el resumen diario de TODO lo abierto, con el monto.
    // El correo sale aunque no haya escalados nuevos: la deuda vieja tiene que
    // seguir doliendo todos los días hasta que alguien la cierre.
    try {
      const snap = await db.collection(cobros.COL)
        .where("etapa", "in", cobros.ABIERTAS)
        .limit(1000)
        .get();

      const abiertos = [];
      let escalados = 0;
      for (const d of snap.docs) {
        const c = d.data() || {};
        const dias = edadDias(c.desde || c.created_at, now);
        const fila = {
          id: d.id,
          cliente: c.cliente_nombre || "—",
          equipo: c.serial_norm
            ? `${c.serial_norm} · ${c.modelo_label || "—"}`
            : `${Number(c.cantidad) || 1} × ${c.modelo_label || "equipo"}`,
          orden: c.orden_devolucion_id || "—",
          dias: dias == null ? 0 : Math.floor(dias),
          monto: Number(c.monto_total) || 0,
          etapa: c.etapa,
          sinPrecio: !(Number(c.monto_total) > 0),
          porAprobar: c.requiere_aprobacion === true,
        };
        // Escalado: pasa a cobranza y se queda ahí (no vuelve solo).
        if (fila.dias >= cobros.DIAS_A_COBRANZA && c.etapa === cobros.ETAPAS.PENDIENTE) {
          try {
            await d.ref.update({
              etapa: cobros.ETAPAS.EN_COBRANZA,
              escalado_at: admin.firestore.FieldValue.serverTimestamp(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              historial: admin.firestore.FieldValue.arrayUnion({
                accion: "escalado",
                detalle: `${fila.dias} días sin resolver — pasa a cobranza`,
                fecha_iso: new Date().toISOString(),
                por_uid: "system", por_email: "system:recordatorioOperativo",
              }),
            });
            fila.etapa = cobros.ETAPAS.EN_COBRANZA;
            escalados++;
          } catch (err) {
            logger.warn("[recordatorioOperativo] no se pudo escalar el cobro", { id: d.id, error: err.message });
          }
        }
        abiertos.push(fila);
      }
      abiertos.sort((a, b) => b.dias - a.dias);

      // Destinatario: `empresa/config.email_cobranza` si está configurado. Sin
      // esa clave cae en recepción, que es quien cierra las devoluciones — un
      // correo sin buzón es un correo que no se envía, y aquí eso significa
      // volver al problema original.
      const to = (await configEmailTo("cobranza", "")) || (await recepcionEmails()).join(",");
      if (abiertos.length && to) {
        const deuda = abiertos.reduce((s, c) => s + c.monto, 0);
        const enCobranza = abiertos.filter(c => c.etapa === cobros.ETAPAS.EN_COBRANZA).length;
        const sinPrecio = abiertos.filter(c => c.sinPrecio).length;
        const porAprobar = abiertos.filter(c => c.porAprobar).length;

        const filas = abiertos.slice(0, MAX_FILAS).map(c => [
          esc(c.cliente), esc(c.equipo),
          c.orden === "—" ? "—"
            : `<a href="${APP_BASE_URL}/ordenes/editar-orden.html?id=${encodeURIComponent(c.orden)}">${esc(c.orden)}</a>`,
          `<b>${c.dias}</b>`,
          c.sinPrecio ? '<span style="color:#b91c1c;">sin precio</span>' : `$${c.monto.toFixed(2)}`,
          c.etapa === cobros.ETAPAS.EN_COBRANZA
            ? '<b style="color:#b91c1c;">En cobranza</b>' : "Pendiente",
        ]);
        const extra = abiertos.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${abiertos.length - MAX_FILAS} más.</p>` : "";
        const pendientes = [
          sinPrecio ? `<b>${sinPrecio}</b> sin precio puesto (no se pueden facturar así)` : "",
          porAprobar ? `<b>${porAprobar}</b> con un descuento que espera aprobación` : "",
        ].filter(Boolean);

        await db.collection("mail_queue").add({
          to,
          subject: `Equipos no devueltos: ${abiertos.length} por cobrar ($${deuda.toFixed(2)})`
            + (escalados ? ` — ${escalados} pasaron a cobranza hoy` : ""),
          preheader: `${abiertos.length} equipos sin devolver por $${deuda.toFixed(2)}; el más viejo lleva ${abiertos[0].dias} días`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991b1b;">Equipos que el cliente no devolvió</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Hay <b>${abiertos.length} equipo(s)</b> sin devolver por <b>$${deuda.toFixed(2)}</b>.
              El más viejo lleva <b>${abiertos[0].dias} días</b>${enCobranza ? ` y <b>${enCobranza}</b> ya está(n) en cobranza` : ""}.
            </p>
            ${escalados ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#b91c1c;">
              <b>${escalados}</b> pasaron hoy a cobranza por cumplir ${cobros.DIAS_A_COBRANZA} días sin resolverse.</p>` : ""}
            ${pendientes.length ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Ojo: ${pendientes.join(" y ")}.</p>` : ""}
            ${tablaHtml(["Cliente", "Equipo", "Devolución", "Días", "A cobrar", "Etapa"], filas)}
            ${extra}
            <p style="margin:12px 0 0;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
              Cada renglón se cierra facturándolo (el número de factura sale de QuickBooks),
              condonándolo (solo administración) o marcando que el equipo apareció.
              Nada se cierra solo.
            </p>`,
          ctaUrl: `${APP_BASE_URL}/inventario/no-devueltos.html`,
          ctaLabel: "Ver los equipos por cobrar",
          meta: { source: "recordatorioOperativo", seccion: "no_devueltos",
                  total: abiertos.length, deuda, escalados },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] no devueltos",
        { abiertos: abiertos.length, escalados, notificado: !!(abiertos.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección no-devueltos falló", { message: e.message });
    }

    // ── H) Contratos por vencer (aviso a 60 días — decisión 2026-08-26) ──
    // Ola 1 de gestiones por cliente (docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_
    // 2026-08-25.md). Dos trabajos, en este orden:
    //   1. mantener `vencimiento_estado` (vigente → por_vencer → vencido) —
    //      es lo que leen las señales del Centro de gestión y la lista de
    //      contratos; el campo nace en onContratoActivado / el backfill;
    //   2. digest a empresa/config.email_renovaciones con lo que está en
    //      ventana. Sin esa clave configurada NO se inventa destinatario: se
    //      loguea y la señal queda solo en la app. Nada se bloquea al vencer.
    try {
      const horizonte = new Date(now.getTime() + VIG.AVISO_DIAS * 86400000);
      const snap = await db.collection("contratos")
        .where("estado", "in", ["activo", "aprobado"]) // ambos operan (283 aprobados nunca pasan a activo)
        .where("fecha_vencimiento", "<=", admin.firestore.Timestamp.fromDate(horizonte))
        .limit(1000)
        .get();

      const filas = [];
      let actualizados = 0;
      for (const d of snap.docs) {
        const c = d.data() || {};
        if (c.deleted) continue;
        // Solo ALQ/PROP/REEMP señalan; DEMO/TEMP terminan por su propio flujo.
        if (!VIG.aplicaVencimiento(c)) continue;
        // Un contrato cuya renovación YA está amarrada no señala — pero solo
        // si el renovador es una renovación REAL vigente: un REEMP amarrado
        // como origen NO renueva al contrato (solo sustituye equipos).
        if (Array.isArray(c.renovado_por_ids) && c.renovado_por_ids.length) {
          let renovado = false;
          for (const rid of c.renovado_por_ids.slice(0, 3)) {
            try {
              const r = (await db.collection("contratos").doc(rid).get()).data();
              if (r && ["activo", "aprobado"].includes(r.estado) && VIG.codigoTipo(r) !== "REEMP") { renovado = true; break; }
            } catch (err) { /* señal se mantiene si no se pudo verificar */ }
          }
          if (renovado) continue;
        }
        const est = VIG.estadoVencimiento(c.fecha_vencimiento, now);
        if (est && est !== c.vencimiento_estado) {
          try {
            await d.ref.update({
              vencimiento_estado: est,
              vencimiento_estado_at: admin.firestore.FieldValue.serverTimestamp(),
            });
            actualizados++;
          } catch (err) {
            logger.warn("[recordatorioOperativo] no se pudo estampar vencimiento_estado", { id: d.id, error: err.message });
          }
        }
        const fv = aDate(c.fecha_vencimiento);
        filas.push({
          id: d.id,
          contrato: c.contrato_id || d.id,
          cliente: c.cliente_nombre || "—",
          tipo: c.tipo_contrato || c.codigo_tipo || "—",
          vence: fv ? fv.toISOString().slice(0, 10) : "—",
          dias: fv ? Math.ceil((fv - now) / 86400000) : 0,
          estado: est || "—",
        });
      }
      filas.sort((a, b) => a.dias - b.dias);

      const to = await configEmailTo("renovaciones", "");
      if (filas.length && to) {
        const vencidosN = filas.filter(f => f.estado === "vencido").length;
        const rows = filas.slice(0, MAX_FILAS).map(f => [
          `<a href="${APP_BASE_URL}/contratos/editar-contrato.html?id=${encodeURIComponent(f.id)}">${esc(f.contrato)}</a>`,
          esc(f.cliente), esc(f.tipo), esc(f.vence),
          f.dias < 0 ? `<b style="color:#b91c1c;">vencido hace ${-f.dias}</b>` : `<b>${f.dias}</b>`,
        ]);
        const extra = filas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${filas.length - MAX_FILAS} más.</p>` : "";
        await db.collection("mail_queue").add({
          to,
          subject: `Contratos por vencer: ${filas.length} en ventana de renovación${vencidosN ? ` (${vencidosN} ya vencidos)` : ""}`,
          preheader: `${filas.length} contratos activos vencen dentro de ${VIG.AVISO_DIAS} días o ya vencieron`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Contratos por vencer</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estos contratos activos vencen dentro de <b>${VIG.AVISO_DIAS} días</b> (o ya vencieron):
              es la ventana para coordinar la renovación con el cliente. Nada se bloquea al vencer —
              este aviso existe para que la renovación no llegue tarde.
            </p>
            ${tablaHtml(["Contrato", "Cliente", "Tipo", "Vence", "Días"], rows)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/contratos/index.html`,
          ctaLabel: "Abrir contratos",
          meta: { source: "recordatorioOperativo", seccion: "por_vencer", total: filas.length, vencidos: vencidosN },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (filas.length) {
        logger.info("[recordatorioOperativo] por-vencer sin buzón (empresa/config.email_renovaciones vacío) — señal solo en la app");
      }
      logger.info("[recordatorioOperativo] contratos por vencer", { enVentana: filas.length, estampados: actualizados, notificado: !!(filas.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección por-vencer falló", { message: e.message });
    }

    // ── I) Demos con retorno vencido (decisiones 2026-08-26 #7 y #10) ────
    // El demo sale con fecha estimada de devolución: al VENCERSE, recordatorio.
    // Si salió SIN fecha, el recordatorio corre a los `demo_recordatorio_dias`
    // (15) de la salida. Un solo recordatorio por demo (demo.recordatorio_at);
    // la orden de retorno sigue viva y la sección C la recoge si envejece.
    // Destinatario: el vendedor del cliente, con copia a recepción.
    try {
      const G = require("../../lib/gestiones");
      let demoDias = 15;
      try {
        const cfg = (await db.collection("empresa").doc("config").get()).data() || {};
        if (Number.isFinite(Number(cfg.demo_recordatorio_dias)) && Number(cfg.demo_recordatorio_dias) >= 1) demoDias = Number(cfg.demo_recordatorio_dias);
      } catch (e) { /* default */ }

      const snap = await db.collection("gestiones")
        .where("estado", "==", "en_demo")
        .limit(500)
        .get();

      let avisados = 0;
      const dests = await recepcionEmails();
      for (const d of snap.docs) {
        const g = d.data() || {};
        if (g.deleted || g.tipo !== "demo") continue;
        if (g.demo?.recordatorio_at) continue;   // ya se avisó una vez

        const estStr = String(g.demo?.fecha_devolucion_estimada || "").trim();
        const est = estStr ? new Date(estStr + (estStr.length === 10 ? "T23:59:59-05:00" : "")) : null;
        let motivo = null;
        if (est && !isNaN(est.getTime())) {
          if (now > est) motivo = `la fecha estimada de devolución (<b>${esc(estStr)}</b>) ya pasó`;
        } else {
          // Sin fecha estimada: base = salida del demo (fecha_entrega; los
          // demos anteriores a este campo caen al evento 'entrega' y por
          // último a la creación de la gestión).
          let base = aDate(g.demo?.fecha_entrega);
          if (!base) {
            try {
              const ev = await d.ref.collection("eventos").where("accion", "==", "entrega").limit(1).get();
              if (!ev.empty) base = aDate(ev.docs[0].data().at);
            } catch (err) { /* fallback abajo */ }
          }
          if (!base) base = aDate(g.fecha_creacion);
          const edad = base ? (now - base) / 86400000 : null;
          if (edad != null && edad >= demoDias) {
            motivo = `salió <b>sin fecha estimada</b> de devolución hace ${Math.floor(edad)} días`;
          }
        }
        if (!motivo) continue;

        const to = await G.vendedorEmailDeCliente(g.cliente_id);
        const cc = dests.join(", ") || null;
        const destino = to || cc;
        if (!destino) { logger.warn("[recordatorioOperativo] demo sin buzón", { gid: d.id }); continue; }
        const seriales = (g.demo?.seriales_asignados || []).map(s => s.serial).filter(Boolean);
        await db.collection("mail_queue").add({
          to: destino,
          ...(to && cc ? { cc } : {}),
          subject: `Demo ${d.id} — coordinar la devolución con ${g.cliente_nombre || "el cliente"}`,
          preheader: `El demo de ${g.cliente_nombre || "cliente"} debe retornar`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Retorno de demo pendiente</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              El demo <b>${esc(d.id)}</b> de <b>${esc(g.cliente_nombre || "—")}</b> sigue con el cliente y ${motivo}.
              Coordina la devolución (o formaliza la venta/contrato si el cliente se queda los equipos).
            </p>
            ${seriales.length ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Equipos: ${seriales.map(s => `<code>${esc(s)}</code>`).join(", ")}</p>` : ""}`,
          ctaUrl: G.urlGestion(g, d.id),
          ctaLabel: "Abrir la gestión",
          meta: { source: "recordatorioOperativo", seccion: "demo_retorno", gestion: d.id },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Rutas anidadas con update() (dot-path), nunca set(merge).
        await d.ref.update({ "demo.recordatorio_at": admin.firestore.FieldValue.serverTimestamp() });
        await G.registrarEvento(d.id, "recordatorio", `Recordatorio de retorno del demo enviado a ${destino}.`);
        avisados++;
      }
      logger.info("[recordatorioOperativo] demos", { enDemo: snap.size, avisados });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección demos falló", { message: e.message });
    }

    return null;
  }
);

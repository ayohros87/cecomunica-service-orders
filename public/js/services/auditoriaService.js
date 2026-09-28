/**
 * auditoriaService.js — unified read of recent audit events for the admin panel.
 *
 * Aggregates events from:
 *  - ordenes_de_servicio.os_logs[] — { action, by } per ASIGNAR/COMPLETAR/ENTREGAR
 *    timestamp is derived from the corresponding fecha_* field on the parent
 *    document since arrayUnion can't accept serverTimestamp() (ver ARQUITECTURA §5.4).
 *  - contratos transitions — fecha_aprobacion, fecha_anulacion
 *  - contratos firmado_historial[] — REEMPLAZAR_FIRMADO (sustitución del PDF
 *    firmado sobre un contrato ya activo)
 *  - PII purges — identificacion_purged_at + identificacion_purged_by
 *  - admin_audit — guardados de Configuración, fusiones de clientes y
 *    migraciones de datos (auditoría UX 2026-09-28)
 *
 * Returned events shape:
 *   { ts, type, action, by, refType, refId, refLabel, link }
 */
const AuditoriaService = {

  /** Fetches the latest N audit events across all sources, sorted descending. */
  async getTimelineEvents({ limitPerSource = 200 } = {}) {
    const db = firebase.firestore();
    const events = [];

    // ── ÓRDENES: os_logs + PII purges ──
    try {
      const snap = await db.collection('ordenes_de_servicio')
        .orderBy('fecha_creacion', 'desc')
        .limit(limitPerSource)
        .get();
      snap.forEach(doc => {
        const o = doc.data();
        const logs = Array.isArray(o.os_logs) ? o.os_logs : [];
        for (const log of logs) {
          const ts = pickTsForAction(o, log.action);
          if (!ts) continue;
          events.push({
            ts: toMs(ts),
            type: 'orden',
            action: log.action,
            by: log.by || null,
            refType: 'orden',
            refId: doc.id,
            refLabel: o.numero_orden || doc.id,
            link: `../ordenes/editar-orden.html?id=${encodeURIComponent(doc.id)}`,
            cliente: o.cliente_nombre || o.clienteNombre || '',
          });
        }
        if (o.identificacion_purged_at) {
          events.push({
            ts: toMs(o.identificacion_purged_at),
            type: 'pii',
            action: 'PURGAR_ID',
            by: o.identificacion_purged_by || null,
            refType: 'orden',
            refId: doc.id,
            refLabel: o.numero_orden || doc.id,
            link: `../ordenes/editar-orden.html?id=${encodeURIComponent(doc.id)}`,
            cliente: o.cliente_nombre || o.clienteNombre || '',
            meta: `Retención ${o.identificacion_retention_days || 90} días`,
          });
        }
      });
    } catch (err) {
      console.warn('[auditoria] ordenes:', err);
    }

    // ── CONTRATOS: aprobaciones, anulaciones, activaciones ──
    try {
      const snap = await db.collection('contratos')
        .orderBy('fecha_creacion', 'desc')
        .limit(limitPerSource)
        .get();
      snap.forEach(doc => {
        const c = doc.data();
        if (c.fecha_aprobacion) {
          events.push({
            ts: toMs(c.fecha_aprobacion),
            type: 'contrato',
            action: 'APROBAR',
            by: c.aprobado_por_uid || c.creado_por_uid || null,
            refType: 'contrato',
            refId: doc.id,
            refLabel: c.contrato_id || doc.id,
            link: `../contratos/editar-contrato.html?id=${encodeURIComponent(doc.id)}`,
            cliente: c.cliente_nombre || c.clienteNombre || '',
          });
        }
        // Reemplazo del PDF firmado sobre un contrato vivo: cada entrada de
        // firmado_historial[] es un archivo que dejó de ser el vigente
        // (contratos-upload.js, modo 'reemplazo'). Sustituir el papel de un
        // contrato activo no puede ser silencioso.
        const histFirmado = Array.isArray(c.firmado_historial) ? c.firmado_historial : [];
        for (const h of histFirmado) {
          if (!h || !h.reemplazado_at) continue;
          events.push({
            ts: toMs(h.reemplazado_at),
            type: 'contrato',
            action: 'REEMPLAZAR_FIRMADO',
            by: h.reemplazado_por_uid || null,
            refType: 'contrato',
            refId: doc.id,
            refLabel: c.contrato_id || doc.id,
            link: `../contratos/editar-contrato.html?id=${encodeURIComponent(doc.id)}`,
            cliente: c.cliente_nombre || c.clienteNombre || '',
            meta: `Archivo sustituido: ${h.firmado_nombre || h.firmado_storage_path || '—'}`,
          });
        }
        if (c.fecha_anulacion) {
          events.push({
            ts: toMs(c.fecha_anulacion),
            type: 'contrato',
            action: 'ANULAR',
            by: c.anulado_por_uid || null,
            refType: 'contrato',
            refId: doc.id,
            refLabel: c.contrato_id || doc.id,
            link: `../contratos/editar-contrato.html?id=${encodeURIComponent(doc.id)}`,
            cliente: c.cliente_nombre || c.clienteNombre || '',
          });
        }
      });
    } catch (err) {
      console.warn('[auditoria] contratos:', err);
    }

    // ── USUARIOS (alta, cambio rol, desactivar, reactivar, reset) ──
    try {
      const snap = await db.collection('usuarios_audit')
        .orderBy('ts', 'desc')
        .limit(limitPerSource)
        .get();
      snap.forEach(doc => {
        const e = doc.data();
        events.push({
          ts: toMs(e.ts),
          type: 'usuario',
          action: e.action,
          by: e.actor_uid || null,
          refType: 'usuario',
          refId: e.target_uid || doc.id,
          // El correo identifica a la persona; el uid recortado no decía nada.
          refLabel: (e.after?.email) || (e.before?.email) || (e.meta?.email)
            || (e.target_uid ? e.target_uid.slice(0, 8) + '…' : doc.id),
          link: 'usuarios.html',
          cliente: '',
          meta: e.before && e.after
            ? `${JSON.stringify(e.before)} → ${JSON.stringify(e.after)}`
            : (e.meta ? JSON.stringify(e.meta) : ''),
        });
      });
    } catch (err) {
      console.warn('[auditoria] usuarios:', err);
    }

    // ── PANEL ADMIN: configuración, fusiones, migraciones (admin_audit) ──
    // Auditoría UX 2026-09-28: antes no quedaba rastro de quién cambió la
    // configuración ni de qué fusionó.
    try {
      const snap = await db.collection('admin_audit')
        .orderBy('fecha', 'desc')
        .limit(limitPerSource)
        .get();
      snap.forEach(doc => {
        const e = doc.data();
        const ev = adminAuditEvento(doc.id, e);
        if (ev) events.push(ev);
      });
    } catch (err) {
      console.warn('[auditoria] admin_audit:', err);
    }

    events.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return events;
  },
};

// Evento de la línea de tiempo a partir de un doc de admin_audit.
function adminAuditEvento(id, e) {
  const por = e.por || {};
  const base = {
    ts: toMs(e.fecha),
    by: por.uid || null,
    byNombre: por.nombre || por.email || '',
    byEmail: por.email || '',
    refId: id,
  };
  const corto = (v) => {
    const s = Array.isArray(v) ? v.join(', ') : (v == null || v === '' ? '(vacío)' : String(v));
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };
  if (e.tipo === 'config') {
    const cambios = Array.isArray(e.cambios) ? e.cambios : [];
    return {
      ...base, type: 'config', action: 'CONFIG_GUARDAR', refType: 'config',
      refLabel: e.origen === 'alertas' ? 'Alertas' : e.origen === 'privacidad' ? 'Privacidad' : e.origen === 'grupos' ? 'Grupos PoC' : 'Configuración',
      link: e.origen === 'alertas' ? 'alertas.html' : e.origen === 'privacidad' ? 'pii.html' : 'config.html',
      cliente: '',
      meta: cambios.map(c => `${c.campo}: ${corto(c.antes)} → ${corto(c.despues)}`).join(' · '),
    };
  }
  if (e.tipo === 'fusion') {
    const fus = Array.isArray(e.fusionados) ? e.fusionados : [];
    const refs = Array.isArray(e.refs) ? e.refs.length : 0;
    return {
      ...base, type: 'datos', action: 'FUSION_CLIENTES', refType: 'cliente',
      refLabel: e.conservado?.nombre || e.conservado?.id || '—',
      link: e.conservado?.id ? `../clientes/centro.html?id=${encodeURIComponent(e.conservado.id)}` : null,
      cliente: fus.map(f => f.nombre || f.id).join(', '),
      meta: `${fus.length} ficha(s) fusionada(s) · ${refs} enlace(s) re-apuntado(s)${e.estado === 'fallida' ? ' · FALLÓ A MEDIAS' : ''}`,
    };
  }
  if (e.tipo === 'backfill') {
    return {
      ...base, type: 'datos', action: 'BACKFILL', refType: 'backfill',
      refLabel: e.nombre || e.backfill || '—', link: 'backfills.html', cliente: '',
      meta: e.resumen || '',
    };
  }
  return null;
}

// Map an os_log action to the corresponding parent-doc timestamp field.
function pickTsForAction(orden, action) {
  switch ((action || '').toUpperCase()) {
    case 'ASIGNAR':   return orden.fecha_asignacion || orden.fecha_entrada;
    case 'COMPLETAR': return orden.fecha_completada || orden.fecha_actualizacion;
    case 'ENTREGAR':  return orden.fecha_entrega    || orden.fecha_actualizacion;
    default:          return orden.fecha_actualizacion || orden.fecha_entrada;
  }
}

function toMs(v) {
  if (!v) return 0;
  if (v.toMillis && typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
  return 0;
}

window.AuditoriaService = AuditoriaService;

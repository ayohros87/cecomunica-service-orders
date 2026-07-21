// @ts-nocheck
/* ========================================
 * ORDENES QC - Control de calidad del taller
 * Checklist de QC (jefe_taller/admin) sobre órdenes en COMPLETADO (EN
 * OFICINA), previo a la entrega. Checklist según tipo_de_servicio
 * (programación vs reparación), aprobación con todos los ítems marcados
 * (OK o N/A) o rechazo con motivo → la orden vuelve a ASIGNADO para que
 * el técnico corrija. El resultado vive en `qc` (último) + `qc_historial`
 * (todas las pasadas, base de métricas por técnico/motivo).
 * `qc_requerido: true` lo estampa completeOrder: órdenes completadas
 * ANTES del despliegue no lo tienen y quedan exentas del candado
 * (corte legacy, mismo patrón que seriales).
 * Modal dinámico (patrón ordenes-visita.js).
 * ======================================== */

(function () {
  const esc = (s) => escapeHtml(String(s ?? ''));

  // Checklists por tipo — espejo del proceso validado con la jefa de
  // taller (correo QC jul-2026). Las keys son estables: alimentan
  // qc.checklist y las métricas; no renombrar sin migrar.
  const QC_CHECKLISTS = {
    programacion: [
      { key: 'programacion_verificada', label: 'Programación cargada y verificada en el equipo' },
      { key: 'grupos_ok',               label: 'Grupos correctamente configurados' },
      { key: 'gps_ok',                  label: 'GPS funcionando correctamente' },
      { key: 'estado_fisico',           label: 'Estado físico del equipo revisado' },
      { key: 'limpieza',                label: 'Limpieza y presentación (pantalla y exterior)' },
    ],
    reparacion: [
      { key: 'enciende_opera',  label: 'El equipo enciende y opera correctamente' },
      { key: 'falla_resuelta',  label: 'La falla reportada quedó resuelta' },
      { key: 'componentes_ok',  label: 'Componentes físicos completos y en buen estado' },
      { key: 'limpieza',        label: 'Limpieza del equipo' },
    ],
  };

  // Categorías de motivo de rechazo — chips de un tap; alimentan las
  // métricas de rechazo por motivo (fase 2).
  const MOTIVOS_RECHAZO = [
    { key: 'programacion', label: 'Programación' },
    { key: 'grupos',       label: 'Grupos' },
    { key: 'gps',          label: 'GPS' },
    { key: 'falla',        label: 'Falla no resuelta' },
    { key: 'fisico',       label: 'Físico / componentes' },
    { key: 'limpieza',     label: 'Limpieza' },
    { key: 'otro',         label: 'Otro' },
  ];

  function _ordenDe(ordenId) {
    return (window.APP?.state?.orders || []).find(o => o.ordenId === ordenId) || {};
  }

  // Tipo de checklist según tipo_de_servicio (misma normalización que
  // tipoChip en ordenes-state.js). Mantenimiento y tipos sin clasificar
  // usan el checklist de reparación (cubre lo esencial: opera + físico).
  function qcTipoDe(orden) {
    const t = String(orden?.tipo_de_servicio || '').toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.includes('PROGRAM') ? 'programacion' : 'reparacion';
  }

  // ¿Esta orden pasa por QC? Solo las de taller marcadas por completeOrder.
  // Visitas y devoluciones tienen su propio cierre y nunca reciben la marca.
  function qcRequerido(orden) {
    return orden?.qc_requerido === true;
  }
  function qcAprobado(orden) {
    return orden?.qc?.resultado === 'aprobado';
  }
  // Pendiente = requerido y sin aprobación vigente (incluye rechazadas
  // re-completadas: el qc anterior quedó 'rechazado' hasta la nueva pasada).
  function qcPendiente(orden) {
    return qcRequerido(orden) && !qcAprobado(orden);
  }
  function puedeHacerQc(rol) {
    return rol === ROLES.ADMIN || rol === ROLES.JEFE_TALLER;
  }

  function _itemRowHtml(item, valor) {
    // valor: 'ok' | 'na' | '' — chips mutuamente excluyentes por ítem.
    return `
      <div class="qc-item-row" data-key="${esc(item.key)}"
           style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line,#eee);">
        <span style="flex:1 1 auto;">${esc(item.label)}</span>
        <div style="display:flex;gap:6px;flex:0 0 auto;">
          <button type="button" class="btn ${valor === 'ok' ? 'btn-primary' : 'btn-secondary'} qc-chip" data-valor="ok"
                  style="padding:6px 14px;">OK</button>
          <button type="button" class="btn ${valor === 'na' ? 'btn-primary' : 'btn-secondary'} qc-chip" data-valor="na"
                  style="padding:6px 10px;" title="No aplica a este equipo">N/A</button>
        </div>
      </div>`;
  }

  function _resumenQcHtml(qc) {
    const tipo = qc.tipo === 'programacion' ? 'programacion' : 'reparacion';
    const items = QC_CHECKLISTS[tipo];
    const filas = items.map(it => {
      const v = (qc.checklist || {})[it.key];
      const chip = v === 'na'
        ? '<span class="muted">N/A</span>'
        : (v === 'ok' ? '✅' : '—');
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;">
                <span>${esc(it.label)}</span><span>${chip}</span>
              </div>`;
    }).join('');
    const fecha = qc.fecha?.toDate ? qc.fecha.toDate().toLocaleString('es-PA') : (qc.fecha_iso || '');
    const motivosLbl = (qc.motivos || [])
      .map(k => (MOTIVOS_RECHAZO.find(m => m.key === k) || { label: k }).label)
      .join(', ');
    return `
      <div style="border:1px solid var(--line,#eee);border-radius:8px;padding:10px 12px;margin-bottom:10px;">
        ${filas}
      </div>
      ${motivosLbl ? `<div style="margin-bottom:8px;color:#991b1b;"><b>Motivo del rechazo:</b> ${esc(motivosLbl)}</div>` : ''}
      ${qc.observaciones ? `<div class="muted" style="margin-bottom:8px;"><b>Observaciones:</b> ${esc(qc.observaciones)}</div>` : ''}
      <div class="muted" style="font-size:12px;">Revisado por ${esc(qc.por_email || '')}${fecha ? ` · ${esc(fecha)}` : ''}</div>`;
  }

  async function abrir(ordenId) {
    let orden;
    try {
      orden = await OrdenesService.getOrder(ordenId);
    } catch (e) {
      console.error('[OrdenesQC.abrir]', e);
      Toast.show('Error cargando la orden', 'bad');
      return;
    }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }

    const rol = APP.state.userRole || '';
    const estado = String(orden.estado_reparacion || '').toUpperCase();
    // Solo se ejecuta QC sobre COMPLETADO y con rol autorizado; en cualquier
    // otro caso el modal es de consulta (muestra el último resultado).
    const soloLectura = !(puedeHacerQc(rol) && estado === 'COMPLETADO (EN OFICINA)');

    const tipo = qcTipoDe(orden);
    const items = QC_CHECKLISTS[tipo];
    const qcPrev = orden.qc || null;
    const rechazoPrevio = qcPrev && qcPrev.resultado === 'rechazado';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9500';

    const tituloTipo = tipo === 'programacion' ? 'Programación' : 'Reparación';

    overlay.innerHTML = `
      <div class="modal" style="max-width:560px;width:min(94vw,560px);">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;">
            <i data-lucide="clipboard-check"></i> Control de calidad — Orden ${esc(ordenId)}
          </h3>
          <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:12px 14px;max-height:72vh;overflow:auto;">
          <div class="muted" style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;">
            <span><b>Tipo:</b> ${esc(orden.tipo_de_servicio || tituloTipo)}</span>
            ${orden.tecnico_asignado ? `<span><b>Técnico:</b> ${esc(orden.tecnico_asignado)}</span>` : ''}
          </div>

          ${soloLectura && qcPrev ? `
            <div style="margin-bottom:8px;font-weight:600;">
              Resultado: ${qcPrev.resultado === 'aprobado' ? '✅ Aprobado' : '❌ Rechazado'}
            </div>
            ${_resumenQcHtml(qcPrev)}
          ` : soloLectura ? `
            <div class="muted">Esta orden no tiene control de calidad registrado.</div>
          ` : `
            ${rechazoPrevio ? `
              <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:13px;">
                <b>Rechazada anteriormente</b>${qcPrev.observaciones ? `: ${esc(qcPrev.observaciones)}` : ''}.
                Verifique de nuevo el checklist completo.
              </div>` : ''}

            <div id="qcChecklist">
              ${items.map(it => _itemRowHtml(it, '')).join('')}
            </div>

            <div class="form-field" style="margin-top:12px;">
              <label class="form-label">Motivo del rechazo <span class="muted" style="font-weight:400;">(solo si rechaza)</span></label>
              <div id="qcMotivos" style="display:flex;gap:6px;flex-wrap:wrap;">
                ${MOTIVOS_RECHAZO.map(m => `
                  <button type="button" class="btn btn-secondary qc-motivo-chip" data-motivo="${m.key}"
                          style="padding:6px 12px;">${m.label}</button>`).join('')}
              </div>
            </div>

            <div class="form-field" style="margin-top:10px;">
              <label class="form-label" for="qcObservaciones">Observaciones</label>
              <textarea class="form-input form-textarea" id="qcObservaciones" rows="3"
                placeholder="Observaciones para el técnico o para el registro (obligatorias al rechazar si no marca motivo)"></textarea>
            </div>
          `}
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">${soloLectura ? 'Cerrar' : 'Cancelar'}</button>
          ${soloLectura ? '' : `
            <button class="btn btn-danger" id="qcRechazarBtn"><i data-lucide="x-circle"></i> Rechazar</button>
            <button class="btn btn-primary" id="qcAprobarBtn" disabled
                    title="Marque todos los puntos (OK o N/A) para aprobar">
              <i data-lucide="check-circle"></i> Aprobar QC
            </button>
          `}
        </div>
      </div>`;

    const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
    const kb = e => { if (e.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', kb);

    const checklist = {};   // key → 'ok' | 'na'
    const motivosSel = new Set();

    const _refreshAprobar = () => {
      const btn = overlay.querySelector('#qcAprobarBtn');
      if (!btn) return;
      btn.disabled = !items.every(it => checklist[it.key] === 'ok' || checklist[it.key] === 'na');
    };

    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }

      const chip = e.target.closest('.qc-chip');
      if (chip) {
        const row = chip.closest('.qc-item-row');
        const key = row.dataset.key;
        checklist[key] = chip.dataset.valor;
        row.querySelectorAll('.qc-chip').forEach(b => {
          const active = b.dataset.valor === checklist[key];
          b.classList.toggle('btn-primary', active);
          b.classList.toggle('btn-secondary', !active);
        });
        _refreshAprobar();
        return;
      }

      const motivo = e.target.closest('.qc-motivo-chip');
      if (motivo) {
        const k = motivo.dataset.motivo;
        if (motivosSel.has(k)) motivosSel.delete(k); else motivosSel.add(k);
        motivo.classList.toggle('btn-primary', motivosSel.has(k));
        motivo.classList.toggle('btn-secondary', !motivosSel.has(k));
        return;
      }
    });

    const btnAprobar  = overlay.querySelector('#qcAprobarBtn');
    const btnRechazar = overlay.querySelector('#qcRechazarBtn');

    if (btnAprobar) btnAprobar.onclick = async () => {
      const obs = overlay.querySelector('#qcObservaciones').value.trim();
      btnAprobar.disabled = true;
      btnAprobar.textContent = 'Guardando…';
      try {
        await OrdenesService.saveQcAprobado(ordenId, { tipo, checklist: { ...checklist }, observaciones: obs });
        cleanup();
        Toast.show('✅ Control de calidad aprobado — la orden puede entregarse', 'ok');
      } catch (err) {
        console.error('[OrdenesQC] aprobar', err);
        Toast.show('❌ Error al guardar el QC: ' + err.message, 'bad');
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i data-lucide="check-circle"></i> Aprobar QC';
        APP.utils.lucideRefresh(btnAprobar);
      }
    };

    if (btnRechazar) btnRechazar.onclick = async () => {
      const obs = overlay.querySelector('#qcObservaciones').value.trim();
      if (!motivosSel.size && !obs) {
        Toast.show('Indique el motivo del rechazo (chips u observaciones)', 'bad');
        return;
      }
      const ok = await Modal.confirm({
        message: `¿Rechazar el QC de la orden ${ordenId}? Volverá al técnico${orden.tecnico_asignado ? ` (${orden.tecnico_asignado})` : ''} para corrección.`,
        danger: true
      });
      if (!ok) return;
      btnRechazar.disabled = true;
      btnRechazar.textContent = 'Guardando…';
      try {
        await OrdenesService.saveQcRechazado(ordenId, {
          tipo,
          checklist: { ...checklist },
          motivos: [...motivosSel],
          observaciones: obs
        });
        cleanup();
        Toast.show('Orden devuelta al técnico con el motivo del rechazo', 'ok');
      } catch (err) {
        console.error('[OrdenesQC] rechazar', err);
        Toast.show('❌ Error al guardar el rechazo: ' + err.message, 'bad');
        btnRechazar.disabled = false;
        btnRechazar.innerHTML = '<i data-lucide="x-circle"></i> Rechazar';
        APP.utils.lucideRefresh(btnRechazar);
      }
    };

    document.body.appendChild(overlay);
    APP.utils.lucideRefresh(overlay);
  }

  window.OrdenesQC = { abrir, qcTipoDe, qcRequerido, qcAprobado, qcPendiente, puedeHacerQc };
})();

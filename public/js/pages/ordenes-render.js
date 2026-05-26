// @ts-nocheck
/* ========================================
 * ORDENES RENDER - Row + equipment table builders
 * Pure DOM construction; does not read Firestore (callers pass data).
 * ======================================== */

function mostrarFeedbackEquipo(equipoId, tipo = 'success') {
  const fila = document.querySelector(`tr[data-equipo-id="${equipoId}"]`);
  if (!fila) return;

  fila.classList.remove('feedback-success', 'feedback-update');
  void fila.offsetWidth;
  fila.classList.add(`feedback-${tipo}`);

  setTimeout(() => {
    fila.classList.remove(`feedback-${tipo}`);
  }, 1200);
}
window.mostrarFeedbackEquipo = mostrarFeedbackEquipo;

function obtenerIconoLapiz(id, campo, valorActual) {
  return `
    <button class="lapiz" data-action="editar-campo-equipo" data-id="${id}" data-campo="${campo}" data-valor="${valorActual}">
      <svg xmlns="http://www.w3.org/2000/svg" class="lapiz-icon" viewBox="0 0 24 24" width="16" height="16">
        <path fill="#aaa" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/>
      </svg>
    </button>
  `;
}

function renderizarOrdenYEquipos(ordenId, ordenData, equipos, contenedor) {
  const equiposNormalizados = Array.isArray(equipos) ? equipos : [];
  const sinEquipos = equiposNormalizados.length === 0;
  // Render only the layout the user is currently looking at. A
  // breakpoint-change listener at the bottom of this file triggers a
  // re-render when the user crosses the 768px boundary, so swapping
  // is correct even if the user resizes mid-session.
  const isMobile = APP.utils.isMobileLayout();

  function normalizarTipo(tipo) {
    return (tipo || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  const estado = (ordenData.estado_reparacion || "POR ASIGNAR").toUpperCase();
  const fotosTallerCount = Number(ordenData.fotos_taller_count || 0);

  if (!isMobile) {
  const filaOrden = document.createElement("tr");
  filaOrden.setAttribute("data-orden-id", ordenId);
  const tieneNota = ordenData.nota_tecnica && ordenData.nota_tecnica.trim() !== "";
  const estiloNota = tieneNota ? 'background-color: #d4edda;' : '';
  const tooltipNota = tieneNota
    ? ordenData.nota_tecnica.slice(0, 80).replace(/"/g, "'")
    : 'Agregar nota técnica';
  const fotosBadge = fotosTallerCount > 0
    ? `<span class="fotos-taller-badge" title="Fotos de taller"><i data-lucide="camera"></i> ${fotosTallerCount}</span>`
    : "";

  filaOrden.style.cursor = "pointer";
  filaOrden.setAttribute('data-estado', estado);
  // Keyboard accessibility: row acts as a disclosure button.
  filaOrden.setAttribute('tabindex', '0');
  filaOrden.setAttribute('role', 'button');
  filaOrden.setAttribute('aria-expanded', 'false');
  filaOrden.setAttribute('aria-label', `Detalles de la orden ${ordenId}`);
  const trabajo = (ordenData.trabajo_estado)
    || (ordenData.cotizacion_emitida ? 'COMPLETADO' : 'SIN_INICIAR');

  const dotClass =
    trabajo === 'COMPLETADO'  ? 'dot green'  :
    trabajo === 'EN_PROGRESO' ? 'dot orange' :
                                'dot';

  const iconoAdvertencia = sinEquipos
    ? '<span title="Orden sin equipos" style="cursor:help;margin-left:6px;vertical-align:middle;"><i data-lucide="alert-triangle" class="warn-icon" style="color:#d97706;width:15px;height:15px;"></i></span>'
    : '';

  let iconoContrato = '';
  if (normalizarTipo(ordenData.tipo_de_servicio) === "PROGRAMACION") {
    if (ordenData.contrato) {
      if (ordenData.contrato.aplica === true) {
        const contratoNumero = ordenData.contrato.contrato_id || 'ID no disponible';
        iconoContrato = `<span title="Contrato: ${contratoNumero}" style="cursor:help;margin-left:4px;vertical-align:middle;"><i data-lucide="link" style="color:#059669;width:15px;height:15px;"></i></span>`;
      } else if (ordenData.contrato.aplica === false) {
        const motivoShort = ordenData.contrato.motivo_no_aplica || 'Sin motivo';
        iconoContrato = `<span title="No aplica contrato: ${motivoShort}" style="cursor:help;margin-left:4px;vertical-align:middle;"><i data-lucide="ban" style="color:#dc2626;width:15px;height:15px;"></i></span>`;
      }
    } else {
      iconoContrato = '<span title="PROGRAMACIÓN sin contrato registrado" style="cursor:help;margin-left:4px;vertical-align:middle;"><i data-lucide="alert-triangle" style="color:#f59e0b;width:15px;height:15px;"></i></span>';
    }
  }

  filaOrden.innerHTML = `
    <td>
      <span class="${dotClass}"></span>
      <i data-lucide="chevron-right" class="flecha"></i>
      ${ordenId}
      ${fotosBadge}
    </td>
    <td class="client-name-cell">
      <div class="cliente-cell">
        <span class="cliente-text">${nombreClienteDe(ordenData)}</span>
        <span class="cliente-icon">${iconoAdvertencia}${iconoContrato}</span>
      </div>
    </td>
    <td>${ordenData.tecnico_asignado || ""}</td>
    <td>${tipoChip(ordenData.tipo_de_servicio)}</td>
    <td><span class="chip-estado ${getEstadoClass(estado)}" title="${estado}">${estadoCompacto(estado)}</span></td>
    <td>${formatFecha(ordenData.fecha_creacion)}</td>
    <td class="col-fecha-entrega">${formatFecha(ordenData.fecha_entrega)}</td>
    <td class="acciones"><div class="acciones-wrap">${botonesFlujo(ordenId, estado, ordenData)}${botonesGestion(ordenId, estado, tooltipNota, estiloNota)}</div></td>
  `;

  const filaDetalle = document.createElement("tr");
  filaDetalle.style.display = "none";
  filaDetalle.classList.add("filaDetalle");
  filaDetalle.setAttribute("data-orden-id", ordenId);
  filaDetalle.setAttribute("data-equipos-loaded", "false");

  const estadoUpper = estado.toUpperCase();
  const ordenCerrada = estadoUpper.includes('ENTREGAD') || estadoUpper.includes('ENTREGADA');
  const ordenActiva = estadoUpper === 'POR ASIGNAR' || estadoUpper === 'ASIGNADO' || estadoUpper.includes('EN OFICINA');

  filaDetalle.innerHTML = `
    <td colspan="8" class="orden-expandida-wrapper">
      <div class="orden-expandida-card ${ordenCerrada ? 'orden-cerrada' : 'orden-activa'}">
        <div class="orden-header-compacto">
          <div class="header-col-izq header-line" title="Cliente: ${nombreClienteDe(ordenData)} · Técnico: ${ordenData.tecnico_asignado || 'Sin asignar'}">
            <span class="orden-numero"><strong>Orden ${ordenId}</strong></span>
            <span class="separador">•</span>
            <span class="cliente-nombre">${nombreClienteDe(ordenData)}</span>
            <span class="separador">•</span>
            <div class="progreso-intervenciones-inline ${ordenCerrada ? 'contexto-historico' : 'contexto-activo'}" data-orden-id="${ordenId}">
              <span class="icon"><i data-lucide="wrench"></i></span>
              <span class="progreso-valor">0/${equiposNormalizados.length}</span>
            </div>
            <span class="contradiccion-badge" data-orden-id="${ordenId}" style="display: none;"></span>
          </div>

          <div class="header-col-der">
            <button class="btn-header-compact" data-action="agregar-equipo" data-stop-propagation="true" data-orden-id="${ordenId}" title="Agregar equipo">
              <i data-lucide="plus"></i>
            </button>
            <div class="overflow-menu mini-menu">
              <button class="btn-header-compact" data-action="toggle-order-actions" data-stop-propagation="true" data-orden-id="${ordenId}" title="Más acciones">
                ⋯
              </button>
              <div class="overflow-menu-dropdown" id="order-actions-${ordenId}">
                <button class="overflow-menu-item" data-action="copiar-seriales" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="copy"></i> Copiar seriales</button>
                <button class="overflow-menu-item" data-action="activar-accesorios" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="wrench"></i> Accesorios en lote</button>
              </div>
            </div>
            <button id="btnGuardarAccesorios_${ordenId}" class="btn-header-compact primary" data-action="guardar-accesorios" data-stop-propagation="true" data-orden-id="${ordenId}" style="display:none;" title="Guardar accesorios">
              <i data-lucide="save"></i>
            </button>
          </div>
        </div>

        <div class="accesorios-popover" id="popoverAccesorios_${ordenId}" style="display: none;">
          <div class="popover-content">
            <div class="popover-header-leyenda">
              <div class="leyenda-titulo">Leyenda de Accesorios</div>
              <button class="popover-close" data-action="close-popover" data-stop-propagation="true" data-orden-id="${ordenId}">×</button>
              <div class="leyenda-items-inline">
                <span class="leyenda-item"><span class="icono"><i data-lucide="battery-full"></i></span> Batería</span>
                <span class="leyenda-item"><span class="icono"><i data-lucide="paperclip"></i></span> Clip</span>
                <span class="leyenda-item"><span class="icono"><i data-lucide="plug"></i></span> Cargador</span>
                <span class="leyenda-item"><span class="icono"><i data-lucide="zap"></i></span> Fuente</span>
                <span class="leyenda-item"><span class="icono"><i data-lucide="radio-tower"></i></span> Antena</span>
                <span class="separador-leyenda">|</span>
                <span class="estado-inline"><span class="indicador incluido"></span> Incluido</span>
                <span class="estado-inline"><span class="indicador no-incluido"></span> No incluido</span>
              </div>
            </div>
          </div>
        </div>

        <div class="resumen-operativo" data-orden-id="${ordenId}" style="display: ${ordenCerrada ? 'block' : 'none'};">
          <div class="resumen-header">
            <span class="icon"><i data-lucide="bar-chart-2"></i></span>
            <strong>Resumen de Cierre</strong>
          </div>
          <div class="resumen-contenido">
            <div class="resumen-item">
              <span class="label">Total equipos:</span>
              <span class="valor resumen-equipos">0</span>
            </div>
            <div class="resumen-item">
              <span class="label">Intervenciones:</span>
              <span class="valor resumen-intervenciones">0/0</span>
            </div>
            <div class="resumen-item">
              <span class="label">Accesorios completos:</span>
              <span class="valor resumen-accesorios">0/0</span>
            </div>
          </div>
        </div>

        ${_buildTimelineHTML(ordenData)}

        <div class="equipos-container">
          <div style="padding: 20px; text-align: center; color: #666;">
            <div class="loader" style="margin: 0 auto;"></div>
            <p style="margin-top: 10px;">Cargando equipos...</p>
          </div>
        </div>
      </div>
    </td>
  `;

  // Row click/keydown handling is delegated at the table level — see
  // the `initOrdenRowDelegation` IIFE at the bottom of this file.
  // Marker attribute identifies rows that should toggle on click/Enter.
  filaOrden.setAttribute("data-orden-row", "1");

  contenedor.appendChild(filaOrden);
  contenedor.appendChild(filaDetalle);

  const clientText = filaOrden.querySelector('.cliente-text');
  if (clientText && clientText.scrollWidth > clientText.offsetWidth) {
    clientText.title = nombreClienteDe(ordenData);
  }
  } // ── end !isMobile (desktop layout) ──────────────────────────────────

  if (isMobile) {
    const cardsWrap = document.getElementById("ordersCards");
    if (cardsWrap) {
    const card = document.createElement("div");
    card.className = "card-contrato";
    card.setAttribute("data-orden-id", ordenId);

    const estadoDisplay = (ordenData.estado_reparacion || "POR ASIGNAR").toUpperCase();
    // Drive the per-estado left-rail color (mirrors the desktop
    // table's tr[data-estado=*] rules so cards and rows match).
    card.setAttribute("data-estado", estadoDisplay);
    const tecnicoDisplay = ordenData.tecnico_asignado || "Sin asignar";
    const tipoDisplay = ordenData.tipo_de_servicio || "—";
    const fotosBadgeMobile = fotosTallerCount > 0
      ? `<span class="fotos-taller-badge mobile" title="Fotos de taller"><i data-lucide="camera"></i> ${fotosTallerCount}</span>`
      : "";

    // Intervención progress for the card (per-equipo aggregate) —
    // mirrors the per-orden count rendered into the expand panel by
    // renderEquiposTabla (lines 380-384) so techs can scan progress
    // without expanding the order. Same source-of-truth fields:
    // trabajo_tecnico (filled) + intervencion_no_disponible.
    const eqConIntervencion = equiposNormalizados.filter(e => (e.trabajo_tecnico || "").trim()).length;
    const eqNoDisponibles   = equiposNormalizados.filter(e => e.intervencion_no_disponible).length;
    const interHechas       = eqConIntervencion + eqNoDisponibles;
    const totalEquipos      = equiposNormalizados.length;
    const progresoCls = totalEquipos === 0           ? ""
                      : interHechas === totalEquipos ? "card-contrato__progreso--done"
                      : interHechas > 0              ? "card-contrato__progreso--progress"
                      : "";
    const progresoHtml = totalEquipos > 0
      ? `<span class="card-contrato__progreso ${progresoCls}">Intervenciones ${interHechas}/${totalEquipos}</span>`
      : "";

    // botonesFlujo returns `<em>-</em>` when the user's role/order
    // state has no flujo action. That stray <em> in the mobile flex
    // acciones row would render as a literal "-" between buttons.
    // Suppress it on mobile.
    const flujoRaw  = botonesFlujo(ordenId, estado, ordenData);
    const flujoHtml = flujoRaw === "<em>-</em>" ? "" : flujoRaw;

    // Cliente-primero hierarchy (v3 — ui_kits/app-mobile design notes
    // v3/v5/v6). Actions reflect the technician's real flow on mobile:
    //   Tier 1   client (anchor, bold) + estado chip aligned to it
    //   Tier 2   #orden · tipo · técnico (· foto badge if any)
    //   Tier 3   Inicio date            + intervención progress n/m
    //   Actions  Equipos (gateway to per-equipo intervención)
    //          + Flujo (state-advance)
    //          + ··· overflow (Fotos, Notas, Imprimir, Editar, Eliminar)
    card.innerHTML = `
      <div class="card-contrato__tier1">
        <div class="card-contrato__cliente">${nombreClienteDe(ordenData)}</div>
        <span class="chip-estado ${getEstadoClass(estadoDisplay)}" title="${estadoDisplay}">${estadoCompacto(estadoDisplay)}</span>
      </div>
      <div class="card-contrato__tier2">
        <span class="card-contrato__ord">#${ordenId}</span>
        <span class="card-contrato__sep" aria-hidden="true">·</span>
        <span class="card-contrato__tipo">${tipoDisplay}</span>
        <span class="card-contrato__sep" aria-hidden="true">·</span>
        <span class="card-contrato__tecnico">${tecnicoDisplay}</span>
        ${fotosBadgeMobile}
      </div>
      <div class="card-contrato__tier3">
        <span>Inicio: ${formatFecha(ordenData.fecha_creacion)}</span>
        ${progresoHtml}
      </div>
      <div class="acciones">
        <button class="btn btn-primary" data-action="abrir-equipos-mobile" data-stop-propagation="true" data-orden-id="${ordenId}">
          <i data-lucide="package"></i> Equipos
        </button>
        ${flujoHtml}
        ${botonesGestion(ordenId, estado)}
      </div>
    `;

      cardsWrap.appendChild(card);
    }
  }
}
window.renderizarOrdenYEquipos = renderizarOrdenYEquipos;

// Build the audit-log timeline HTML for an order.
// Derives entries from the dedicated `fecha_*` timestamp fields the
// lifecycle handlers already write. Where the order also has an
// `entrega_por_email` (entrega flow) or `tecnico_asignado` (assign
// flow), the "by" line surfaces who did the action. The `os_logs`
// array carries `{ action, by }` but lacks per-entry timestamps
// (Firestore disallows serverTimestamp() in arrayUnion); the fecha_*
// fields give us both. ORDENES_INDEX_IMPROVEMENTS.md §5.7.
function _buildTimelineHTML(ordenData) {
  const safe = (s) => escapeHtml(String(s ?? ''));
  const entries = [];

  if (ordenData.fecha_creacion) {
    entries.push({
      icon: 'plus-circle',
      label: 'Orden creada',
      ts: ordenData.fecha_creacion,
      by: ordenData.creado_por_email || ordenData.created_by_email || '',
      kind: 'created'
    });
  }
  if (ordenData.fecha_asignacion) {
    entries.push({
      icon: 'user-check',
      label: 'Asignada a técnico',
      ts: ordenData.fecha_asignacion,
      by: ordenData.tecnico_asignado || '',
      kind: 'asignado'
    });
  }
  if (ordenData.fecha_completado) {
    entries.push({
      icon: 'check-circle',
      label: 'Completada en oficina',
      ts: ordenData.fecha_completado,
      by: ordenData.completado_por_email || '',
      kind: 'completado'
    });
  }
  if (ordenData.fecha_entrega) {
    entries.push({
      icon: ordenData.no_recibido ? 'alert-triangle' : 'package-check',
      label: ordenData.no_recibido ? 'Entrega NO recibida' : 'Entregada al cliente',
      ts: ordenData.fecha_entrega,
      by: ordenData.entrega_por_email || '',
      kind: ordenData.no_recibido ? 'no-recibido' : 'entregado'
    });
  }
  if (ordenData.fecha_eliminacion) {
    entries.push({
      icon: 'trash-2',
      label: 'Eliminada',
      ts: ordenData.fecha_eliminacion,
      by: '',
      kind: 'eliminado'
    });
  }

  // Sort ascending by epoch — oldest at top, newest at bottom.
  entries.sort((a, b) => {
    const am = a.ts?.toMillis?.() ?? 0;
    const bm = b.ts?.toMillis?.() ?? 0;
    return am - bm;
  });

  if (entries.length === 0) return '';

  const rowsHtml = entries.map(e => `
    <div class="timeline-entry timeline-entry--${e.kind}">
      <span class="timeline-dot"><i data-lucide="${e.icon}" aria-hidden="true"></i></span>
      <div class="timeline-body">
        <div class="timeline-label">${safe(e.label)}</div>
        <div class="timeline-meta">
          <span class="timeline-date">${safe(formatFechaHora(e.ts))}</span>
          ${e.by ? `<span class="timeline-by">· ${safe(e.by)}</span>` : ''}
        </div>
      </div>
    </div>`).join('');

  return `
    <div class="timeline-orden">
      <div class="timeline-header">
        <span class="icon"><i data-lucide="history"></i></span>
        <strong>Línea de tiempo</strong>
      </div>
      <div class="timeline-entries">${rowsHtml}</div>
    </div>`;
}

// LAZY RENDER: Genera la tabla de equipos solo cuando se expande
function renderEquiposTabla(ordenId, equipos, filaDetalle) {
  const container = filaDetalle.querySelector('.equipos-container');
  if (!container) return;

  if (equipos.length === 0) {
    container.innerHTML = '<em style="color: #666; padding: 20px; display: block;">No hay equipos asociados</em>';
  } else {
    const equiposConIntervencion = equipos.filter(e => (e.trabajo_tecnico || "").trim()).length;
    const equiposNoDisponibles = equipos.filter(e => e.intervencion_no_disponible).length;
    const equiposFinalizados = equiposConIntervencion + equiposNoDisponibles;
    const progresoPercent = equipos.length ? Math.round((equiposFinalizados / equipos.length) * 100) : 0;

    const equiposAccesoriosCompletos = equipos.filter(e => {
      return e.bateria && e.clip && e.cargador && e.fuente && e.antena;
    }).length;

    const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
    const estadoOrden = ordenData?.estado || '';
    const estadoUpper = estadoOrden.toUpperCase();
    const ordenCerrada = estadoUpper.includes('ENTREGAD') || estadoUpper.includes('ENTREGADA');

    const pendientesIntervencion = Math.max(0, equipos.length - equiposFinalizados);
    const hayContradiccion = ordenCerrada && pendientesIntervencion > 0;

    const progresoIndicador = document.querySelector(`.progreso-intervenciones-inline[data-orden-id="${ordenId}"]`);
    if (progresoIndicador) {
      const valorEl = progresoIndicador.querySelector('.progreso-valor');
      if (valorEl) valorEl.textContent = `Intervenidos ${equiposConIntervencion} / No disp ${equiposNoDisponibles}`;

      progresoIndicador.classList.remove('completo', 'parcial', 'vacio');
      if (progresoPercent === 100) {
        progresoIndicador.classList.add('completo');
      } else if (progresoPercent > 0) {
        progresoIndicador.classList.add('parcial');
      } else {
        progresoIndicador.classList.add('vacio');
      }
    }

    const contradiccionBadge = document.querySelector(`.contradiccion-badge[data-orden-id="${ordenId}"]`);
    if (contradiccionBadge) {
      if (hayContradiccion) {
        contradiccionBadge.style.display = 'inline-flex';
        contradiccionBadge.innerHTML = `
          <i data-lucide="alert-triangle" class="badge-icon" style="width:14px;height:14px;"></i>
          <span class="badge-text">Orden cerrada con ${pendientesIntervencion} intervención(es) pendiente(s)</span>
        `;
        APP.utils.lucideRefresh(contradiccionBadge);
        contradiccionBadge.className = 'contradiccion-badge advertencia';
        contradiccionBadge.title = 'Esta orden fue entregada pero tiene equipos sin intervención registrada';
      } else {
        contradiccionBadge.style.display = 'none';
      }
    }

    const resumenOperativo = document.querySelector(`.resumen-operativo[data-orden-id="${ordenId}"]`);
    if (resumenOperativo && ordenCerrada) {
      resumenOperativo.querySelector('.resumen-equipos').textContent = equipos.length;
      resumenOperativo.querySelector('.resumen-intervenciones').textContent = `Intervenidos ${equiposConIntervencion} / No disp ${equiposNoDisponibles}`;
      resumenOperativo.querySelector('.resumen-accesorios').textContent = `${equiposAccesoriosCompletos}/${equipos.length}`;

      const itemIntervenciones = resumenOperativo.querySelector('.resumen-intervenciones').parentElement;
      const itemAccesorios = resumenOperativo.querySelector('.resumen-accesorios').parentElement;

      itemIntervenciones.classList.remove('completo', 'incompleto');
      itemAccesorios.classList.remove('completo', 'incompleto');

      if (equiposFinalizados === equipos.length) {
        itemIntervenciones.classList.add('completo');
      } else {
        itemIntervenciones.classList.add('incompleto');
      }

      if (equiposAccesoriosCompletos === equipos.length) {
        itemAccesorios.classList.add('completo');
      } else {
        itemAccesorios.classList.add('incompleto');
      }
    }

    container.innerHTML = `
      <table class="equipos-table">
        <colgroup>
          <col style="width: 8%;">
          <col style="width: 8%;">
          <col style="width: 26%;">
          <col style="width: 18%;">
          <col style="width: 32%;">
          <col style="width: 8%;">
        </colgroup>
        <thead>
          <tr>
            <th class="col-serie">Serie</th>
            <th class="col-modelo">Modelo</th>
            <th class="col-intervencion">Intervención</th>
            <th class="col-accesorios">Accesorios</th>
            <th class="col-observaciones">Observaciones</th>
            <th class="col-acciones">⋯</th>
          </tr>
        </thead>
        <tbody>
          ${equipos.map(e => {
            const accesoriosPresentes = [e.bateria, e.clip, e.cargador, e.fuente, e.antena].filter(Boolean).length;
            const accesoriosTotal = 5;
            const accesoriosCompleto = accesoriosPresentes === accesoriosTotal;
            const noDisponible = !!e.intervencion_no_disponible;
            const motivoNoDisponible = (e.motivo_no_disponible || "").toString();
            const tieneIntervencion = !!(e.trabajo_tecnico || "").trim();

            return `
            <tr data-equipo-id="${ordenId}_${e.id}" class="equipo-row ${ordenCerrada ? 'contexto-historico' : 'contexto-activo'} ${noDisponible ? 'no-disponible' : ''}">
              <td class="col-serie">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="numero_de_serie">
                  <span class="valor valor-primario">${e.numero_de_serie || "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'numero_de_serie', e.numero_de_serie || '')}
                </div>
              </td>

              <td class="col-modelo">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="modelo">
                  <span class="valor valor-primario">${e.modelo || "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'modelo', e.modelo || '')}
                </div>
              </td>

              <td class="col-intervencion">
                <div class="intervencion-stack">
                  ${noDisponible
                    ? `<div class="intervencion-badge no-disponible" title="Equipo no disponible para intervención">
                         <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                           <span class="icon"><i data-lucide="ban"></i></span>
                           <span class="label">No disponible</span>
                         </button>
                       </div>`
                    : (tieneIntervencion
                      ? `<div class="intervencion-badge activa" title="Intervención registrada">
                          <div class="intervencion-content">
                            <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                              <span class="icon"><i data-lucide="check-circle"></i></span>
                              <span class="label">Registrada</span>
                            </button>
                            <span class="intervencion-text" title="${escapeHtml(e.trabajo_tecnico || '')}">${escapeHtml(e.trabajo_tecnico || '')}</span>
                          </div>
                         </div>`
                      : `<div class="intervencion-badge pendiente ${ordenCerrada ? 'historico' : 'activo'}" title="${ordenCerrada ? 'No se registró intervención (orden cerrada)' : 'Pendiente de intervención'}">
                           <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                             <span class="icon">${ordenCerrada ? '<i data-lucide="file-text"></i>' : '<i data-lucide="clock"></i>'}</span>
                             <span class="label">${ordenCerrada ? 'No registrada' : 'Pendiente'}</span>
                           </button>
                         </div>`
                    )
                  }
                </div>
              </td>

              <td class="col-accesorios">
                <div class="accesorios-wrapper ${accesoriosCompleto ? 'completo' : 'incompleto'}">
                  <div class="accesorios-group">
                    <span class="accesorio-item ${e.bateria ? 'activo' : 'inactivo'}" data-campo="bateria" title="${e.bateria ? 'Batería incluida' : 'Batería NO incluida'}">
                      <span class="icono"><i data-lucide="battery-full"></i></span>
                    </span>
                    <span class="accesorio-item ${e.clip ? 'activo' : 'inactivo'}" data-campo="clip" title="${e.clip ? 'Clip incluido' : 'Clip NO incluido'}">
                      <span class="icono"><i data-lucide="paperclip"></i></span>
                    </span>
                    <span class="accesorio-item ${e.cargador ? 'activo' : 'inactivo'}" data-campo="cargador" title="${e.cargador ? 'Cargador incluido' : 'Cargador NO incluido'}">
                      <span class="icono"><i data-lucide="plug"></i></span>
                    </span>
                    <span class="accesorio-item ${e.fuente ? 'activo' : 'inactivo'}" data-campo="fuente" title="${e.fuente ? 'Fuente incluida' : 'Fuente NO incluida'}">
                      <span class="icono"><i data-lucide="zap"></i></span>
                    </span>
                    <span class="accesorio-item ${e.antena ? 'activo' : 'inactivo'}" data-campo="antena" title="${e.antena ? 'Antena incluida' : 'Antena NO incluida'}">
                      <span class="icono"><i data-lucide="radio-tower"></i></span>
                    </span>
                  </div>
                  <span class="completitud-badge">${accesoriosPresentes}/${accesoriosTotal}</span>
                </div>
              </td>

              <td class="col-observaciones">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="observaciones">
                  <span class="valor" title="${e.observaciones || ''}">${e.observaciones || "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'observaciones', e.observaciones || '')}
                </div>
              </td>

              <td class="col-acciones">
                <button data-action="eliminar-equipo" data-id="${ordenId}_${e.id}" class="btn-eliminar-equipo" title="Eliminar equipo">
                  <i data-lucide="trash-2"></i>
                </button>
              </td>
            </tr>
          `}).join("")}
        </tbody>
      </table>
    `;
  }

  filaDetalle.setAttribute("data-equipos-loaded", "true");
  APP.utils.lucideRefresh(filaDetalle);
}

function refrescarEquiposDeOrden(ordenId) {
  const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!ordenData) return;

  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  if (!filaDetalle || filaDetalle.getAttribute("data-equipos-loaded") === "false") return;

  const equipos = (ordenData.equipos || []).filter(e => !e.eliminado);
  renderEquiposTabla(ordenId, equipos, filaDetalle);
}
window.refrescarEquiposDeOrden = refrescarEquiposDeOrden;

function botonesFlujo(ordenId, estado, ordenData) {
  const rol = APP.state.userRole || "";
  let html = "";
  const tipoServicio = (ordenData?.tipo_de_servicio || "").toUpperCase();

  if (rol === ROLES.ADMIN || rol === ROLES.RECEPCION) {
    if (estado === "POR ASIGNAR") {
      html += `<button class="btn-flujo btn-flujo--asignar" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="wrench"></i> Asignar</button>`;
    } else if (estado === "ASIGNADO") {
      html += `<button class="btn-flujo btn-flujo--completar" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="check-circle"></i> Completar</button>`;
    } else if (estado === "COMPLETADO (EN OFICINA)" && !tipoServicio.includes("ENTRADA")) {
      html += `<button class="btn-flujo btn-flujo--entregar" title="Entregar al cliente" data-action="entregar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="send"></i> Entregar</button>`;
    }
  }

  else if (rol === ROLES.TECNICO) {
    if (estado === "POR ASIGNAR") {
      html += `<button class="btn-flujo btn-flujo--asignar" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="wrench"></i> Asignar</button>`;
    } else if (estado === "ASIGNADO") {
      html += `<button class="btn-flujo btn-flujo--completar" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="check-circle"></i> Completar</button>`;
    }
  }

  else if (rol === ROLES.TECNICO_OPERATIVO) {
    if (estado === "ASIGNADO") {
      html += `<button class="btn-flujo btn-flujo--completar" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="check-circle"></i> Completar</button>`;
    }
  }

  else if (rol === ROLES.VENDEDOR) {
    if (estado === "COMPLETADO (EN OFICINA)" && !tipoServicio.includes("ENTRADA")) {
      html += `<button class="btn-flujo btn-flujo--entregar" title="Entregar al cliente" data-action="entregar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="send"></i> Entregar</button>`;
    }
  }

  return html || "<em>-</em>";
}
window.botonesFlujo = botonesFlujo;

function botonesGestion(ordenId, estado, tooltipNota = "", estiloNota = "") {
  const rol = APP.state.userRole || "";
  const estadoUpper = (estado || "").toUpperCase();

  const o = APP.state.orders.find(x => x.ordenId === ordenId) || {};
  const trabajo = (o.trabajo_estado) || (o.cotizacion_emitida ? 'COMPLETADO' : 'SIN_INICIAR');
  const tieneNota = o.nota_tecnica && o.nota_tecnica.trim() !== "";

  let menuItems = [
    { icon: '<i data-lucide="camera"></i>', label: "Fotos de taller", action: "go-fotos-taller", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
  ];

  if (rol === ROLES.ADMIN || rol === ROLES.RECEPCION) {
    menuItems.push(
      { icon: '<i data-lucide="file-text"></i>', label: "Generar nota entrega", action: "generar-nota-entrega", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="clipboard-list"></i>', label: "Nota entrega con intervenciones", action: "generar-nota-entrega-intervenciones", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="wrench"></i>', label: trabajo === 'COMPLETADO' ? "Trabajo completado" : trabajo === 'EN_PROGRESO' ? "Trabajo en progreso" : "Gestionar trabajo", action: "gestionar-trabajo", dataAttributes: `data-orden-id="${ordenId}"`, class: trabajo === 'COMPLETADO' ? 'highlighted' : '' },
      { icon: '<i data-lucide="file-text"></i>', label: tieneNota ? "Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' },
      { divider: true },
      { icon: '<i data-lucide="pencil"></i>', label: "Editar orden", action: "editar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: estadoUpper !== "POR ASIGNAR" ? "disabled" : "" },
      { icon: '<i data-lucide="trash-2"></i>', label: "Eliminar orden", action: "eliminar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "danger" }
    );
  } else if (rol === ROLES.TECNICO || rol === ROLES.TECNICO_OPERATIVO) {
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="wrench"></i>', label: trabajo === 'COMPLETADO' ? "Trabajo completado" : trabajo === 'EN_PROGRESO' ? "Trabajo en progreso" : "Gestionar trabajo", action: "gestionar-trabajo", dataAttributes: `data-orden-id="${ordenId}"`, class: trabajo === 'COMPLETADO' ? 'highlighted' : '' },
      { icon: '<i data-lucide="file-text"></i>', label: tieneNota ? "Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' }
    );
  } else if (rol === ROLES.VISTA) {
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
    );
  } else if (rol === ROLES.VENDEDOR) {
    menuItems.push(
      { icon: '<i data-lucide="file-text"></i>', label: "Generar nota entrega", action: "generar-nota-entrega", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="clipboard-list"></i>', label: "Nota entrega con intervenciones", action: "generar-nota-entrega-intervenciones", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="wrench"></i>', label: trabajo === 'COMPLETADO' ? "Trabajo completado" : trabajo === 'EN_PROGRESO' ? "Trabajo en progreso" : "Gestionar trabajo", action: "gestionar-trabajo", dataAttributes: `data-orden-id="${ordenId}"`, class: trabajo === 'COMPLETADO' ? 'highlighted' : '' }
    );
  }

  if (menuItems.length === 0) return "<em>-</em>";

  const dropdownHtml = menuItems.map(item => {
    if (item.divider) {
      return '<div class="overflow-menu-divider"></div>';
    }
    const disabled = item.class.includes('disabled');
    const onclickAttr = disabled ? '' : `data-action="${item.action}" ${item.dataAttributes || ''}`;
    return `<button class="overflow-menu-item ${item.class}" ${onclickAttr} ${disabled ? 'disabled' : ''} data-stop-propagation="true">
      <span>${item.icon}</span>
      <span>${item.label}</span>
    </button>`;
  }).join('');

  return `
    <div class="overflow-menu">
      <button class="overflow-menu-btn" data-action="toggle-overflow-menu" data-stop-propagation="true" data-orden-id="${ordenId}" title="Más acciones">
        ⋯
      </button>
      <div class="overflow-menu-dropdown" id="overflow-menu-${ordenId}">
        ${dropdownHtml}
      </div>
    </div>
  `;
}
window.botonesGestion = botonesGestion;

function actualizarResumen(lista) {
  const el = document.getElementById("resumenOrdenes");
  // Count from APP.state.orders (unfiltered) so chip counts reflect the
  // dataset, not the filtered view. The legacy resumen-button shows the
  // filtered total so the user has both numbers.
  const fullList = APP.state.orders || lista || [];
  const total = (lista || []).length;

  const _statusOf = (o) => (o.estado_reparacion || "POR ASIGNAR").toUpperCase();
  const porAsignar         = fullList.filter(o => _statusOf(o) === "POR ASIGNAR").length;
  const asignado           = fullList.filter(o => _statusOf(o) === "ASIGNADO").length;
  const completadoOficina  = fullList.filter(o => _statusOf(o) === "COMPLETADO (EN OFICINA)").length;
  const entregadoCliente   = fullList.filter(o => _statusOf(o) === "ENTREGADO AL CLIENTE").length;

  // Pump counts into BOTH estado chip bars (desktop #estadoChipsBar
   // and mobile #estadoChipsBarMobile). Selecting by .class instead
   // of #id keeps a single source of truth and both stay in sync.
  const chipCount = (key, n) => {
    document
      .querySelectorAll(`.estado-chips-bar [data-count="${key}"]`)
      .forEach(span => { span.textContent = String(n); });
  };
  chipCount('all', fullList.length);
  chipCount('POR ASIGNAR', porAsignar);
  chipCount('ASIGNADO', asignado);
  chipCount('COMPLETADO (EN OFICINA)', completadoOficina);
  chipCount('ENTREGADO AL CLIENTE', entregadoCliente);
  // (The old #mobileHeader .topbar-badges cluster — tbPorAsignar /
  // tbAsignado / tbCompletado / tbEntregado — was a duplicate estado
  // filter and is gone. Its counts now live in the mobile chip bar
  // above, populated by chipCount().)

  if (!el) return;

  const filtroEstadoSelect = document.getElementById("filtroEstado");
  const estadoActivo = filtroEstadoSelect ? filtroEstadoSelect.value : "";
  const estadoLabel = estadoActivo || "Todos";

  el.innerHTML = `
    <div class="overflow-menu resumen-menu-wrap">
      <button class="btn btn-ghost resumen-btn" data-action="toggle-resumen-menu" data-stop-propagation="true" aria-haspopup="true" aria-expanded="false">
        Resumen: ${total} · ${estadoLabel}
      </button>
      <div class="overflow-menu-dropdown resumen-menu" id="resumen-menu">
        <div class="resumen-total" data-action="limpiar-filtros" title="Ver todas las órdenes">Total: ${total}</div>
        <div class="resumen-badges">
          <span class="badge asignar ${estadoActivo === 'POR ASIGNAR' ? 'active' : ''}" title="Click para filtrar: POR ASIGNAR" data-action="filtrar-badge" data-estado="POR ASIGNAR">${porAsignar}</span>
          <span class="badge asignado ${estadoActivo === 'ASIGNADO' ? 'active' : ''}" title="Click para filtrar: ASIGNADO" data-action="filtrar-badge" data-estado="ASIGNADO">${asignado}</span>
          <span class="badge completo ${estadoActivo === 'COMPLETADO (EN OFICINA)' ? 'active' : ''}" title="Click para filtrar: COMPLETADO (EN OFICINA)" data-action="filtrar-badge" data-estado="COMPLETADO (EN OFICINA)">${completadoOficina}</span>
          <span class="badge ${estadoActivo === 'ENTREGADO AL CLIENTE' ? 'active' : ''}" style="background:#bbf7d0;" title="Click para filtrar: ENTREGADO AL CLIENTE" data-action="filtrar-badge" data-estado="ENTREGADO AL CLIENTE">${entregadoCliente}</span>
        </div>
      </div>
    </div>
  `;

  // mirror to mobile header summary (compact text only)
  const mh = document.getElementById("mobileResumen");
  if (mh) {
    mh.textContent = `Total: ${total} · ${estadoLabel}`;
  }
}

/**
 * Renders N skeleton rows into both `#ordersTable` and `#ordersCards`
 * during initial load. Replaces the spinner-only loading state with
 * a content-shaped placeholder — perceived perf bump per
 * ORDENES_INDEX_IMPROVEMENTS.md QW11. The actual data load wipes
 * `innerHTML` on both containers before rendering, so no explicit
 * "remove skeleton" step is needed.
 * @param {number} [count=8]
 */
function renderSkeletonRows(count = 8) {
  const skeletonRow = `
    <tr class="skeleton-row" aria-hidden="true">
      <td><span class="skel skel--num"></span></td>
      <td><span class="skel skel--md"></span></td>
      <td><span class="skel skel--sm"></span></td>
      <td><span class="skel skel--sm"></span></td>
      <td><span class="skel skel--pill"></span></td>
      <td><span class="skel skel--xs"></span></td>
      <td class="col-fecha-entrega"><span class="skel skel--xs"></span></td>
      <td><span class="skel skel--sm"></span></td>
    </tr>`;
  const skeletonCard = `
    <div class="card-contrato skeleton-card" aria-hidden="true">
      <div class="row"><span class="skel skel--md"></span><span class="skel skel--num"></span></div>
      <div class="row"><span class="skel skel--sm"></span><span class="skel skel--sm"></span></div>
      <div class="row"><span class="skel skel--pill"></span></div>
      <div class="row"><span class="skel skel--xs"></span><span class="skel skel--xs"></span></div>
    </div>`;

  const ordersTable = document.getElementById("ordersTable");
  const ordersCards = document.getElementById("ordersCards");
  if (ordersTable) ordersTable.innerHTML = skeletonRow.repeat(count);
  if (ordersCards) ordersCards.innerHTML = skeletonCard.repeat(count);
}
window.renderSkeletonRows = renderSkeletonRows;

/**
 * Renders a friendly empty state in both `#ordersTable` and `#ordersCards`
 * so the user sees the same message regardless of which layout the
 * current breakpoint shows. The "Limpiar filtros" CTA only appears when
 * the filter state is non-default — gated by `hasActiveFilters` from
 * ordenes-filters.js.
 *
 * ORDENES_INDEX_IMPROVEMENTS.md QW15 + §4.1.
 *
 * @param {string} message - Headline shown to the user
 * @param {Object} [opts]
 * @param {string} [opts.icon='inbox'] - Lucide icon name
 * @param {string} [opts.sublabel] - Optional secondary line
 */
function renderEmptyState(message, opts = {}) {
  const icon = opts.icon || 'inbox';
  const sublabel = opts.sublabel || '';
  // hasActiveFilters lives in ordenes-filters.js; guard for evaluation
  // order in case render is called before filters init.
  let activeFilters = false;
  try {
    if (typeof getActiveFilters === 'function' && typeof hasActiveFilters === 'function') {
      activeFilters = hasActiveFilters(getActiveFilters());
    }
  } catch { /* noop */ }

  const ctaHtml = activeFilters
    ? `<button class="btn btn-secondary empty-state__cta" data-action="limpiar-filtros">
         <i data-lucide="x"></i> Limpiar filtros
       </button>`
    : '';

  const cardHtml = `
    <div class="empty-state" role="status">
      <div class="empty-state__icon" aria-hidden="true"><i data-lucide="${icon}"></i></div>
      <p class="empty-state__msg">${message}</p>
      ${sublabel ? `<p class="empty-state__sub">${sublabel}</p>` : ''}
      ${ctaHtml}
    </div>`;

  const ordersTable = document.getElementById("ordersTable");
  if (ordersTable) {
    ordersTable.innerHTML = `<tr><td colspan="8" class="empty-state__cell">${cardHtml}</td></tr>`;
  }
  const ordersCards = document.getElementById("ordersCards");
  if (ordersCards) {
    ordersCards.innerHTML = cardHtml;
  }

  APP.utils.lucideRefresh([ordersTable, ordersCards]);
}
window.renderEmptyState = renderEmptyState;

// ── Row expansion: one delegated listener for the entire table ──────
// Replaces N per-row click + keydown listeners (50 rows × 2 = 100 listeners
// at full page) with a single pair on #ordersTable. Toggle state lives in
// the DOM (`data-equipos-loaded` + style.display); orden data is looked up
// from APP.state.orders by `data-orden-id`. ORDENES_INDEX_IMPROVEMENTS.md QW4.
function _toggleOrdenRow(filaOrden) {
  const filaDetalle = filaOrden.nextElementSibling;
  if (!filaDetalle || !filaDetalle.classList.contains('filaDetalle')) return;

  filaOrden.classList.toggle('activo');
  const wasHidden = filaDetalle.style.display === 'none';
  filaDetalle.style.display = wasHidden ? 'table-row' : 'none';
  filaOrden.setAttribute('aria-expanded', wasHidden ? 'true' : 'false');

  if (wasHidden && filaDetalle.getAttribute('data-equipos-loaded') === 'false') {
    const ordenId = filaOrden.dataset.ordenId;
    const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId);
    if (!orden) return;
    const equipos = (orden.equipos || [])
      .filter(e => !e.eliminado)
      .sort((a, b) => String(a.numero_de_serie || '').localeCompare(String(b.numero_de_serie || '')));
    renderEquiposTabla(ordenId, equipos, filaDetalle);
  }
}

// The script loads in <head> with no `defer`, so #ordersTable doesn't
// exist yet when this file evaluates. Document-level delegation works
// from any point in the page lifecycle and matches the existing pattern
// used by the data-action delegation in ordenes-events.js.
document.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-orden-row]');
  if (!row) return;
  if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.overflow-menu')) return;
  _toggleOrdenRow(row);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('tr[data-orden-row]');
  if (!row) return;
  // Only handle key events that fired on the row itself — let nested
  // interactive elements keep their own keyboard semantics.
  if (e.target !== row) return;
  e.preventDefault();
  _toggleOrdenRow(row);
});

// ── Layout breakpoint listener ──────────────────────────────────────
// When the user resizes across the 768px boundary, the active layout
// changes (mobile cards ↔ desktop table). renderizarOrdenYEquipos only
// builds the active layout; without this listener the inactive layout
// would stay empty after a resize. Debounced 150ms because the change
// event can fire multiple times during a resize drag in some browsers.
(function watchLayoutBreakpoint() {
  if (typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia('(max-width: 768px)');
  let debounceTimer = null;
  let lastIsMobile = mql.matches;

  const onChange = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const nowIsMobile = mql.matches;
      if (nowIsMobile === lastIsMobile) return;
      lastIsMobile = nowIsMobile;
      if (typeof aplicarFiltrosCombinados === 'function') {
        aplicarFiltrosCombinados();
      }
    }, 150);
  };

  // Modern + legacy listener registration.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
  } else if (typeof mql.addListener === 'function') {
    mql.addListener(onChange);
  }
})();

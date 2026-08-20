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

// Edad en cola (§5.22, aprobado 2026-08-18): pill discreto junto a la fecha
// SOLO en POR ASIGNAR / RECIBIDO EN MOSTRADOR estancados — 9 órdenes >30 días
// eran inventario fantasma que la bandeja no distinguía de lo de ayer. Ámbar
// a los 14 días, rojo a los 30. Sin animación ni bloqueo: informa, no estorba.
function edadChip(ordenData, estado) {
  if (estado !== "POR ASIGNAR" && estado !== "RECIBIDO EN MOSTRADOR") return "";
  // Para RECIBIDO cuenta desde la recepción si existe (estancado EN ese paso).
  const f = (estado === "RECIBIDO EN MOSTRADOR" && ordenData.fecha_recepcion)
    ? ordenData.fecha_recepcion : ordenData.fecha_creacion;
  const ms = f?.toDate ? f.toDate().getTime() : (f ? new Date(f).getTime() : NaN);
  if (!isFinite(ms)) return "";
  const dias = Math.floor((Date.now() - ms) / 86400000);
  if (dias < 14) return "";
  const nivel = dias >= 30 ? "edad-chip--critica" : "edad-chip--alta";
  return ` <span class="edad-chip ${nivel}" title="${dias} días en ${estado === 'POR ASIGNAR' ? 'POR ASIGNAR' : 'RECIBIDO EN MOSTRADOR'}">${dias} d</span>`;
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
  const indicadorNota = tieneNota
    ? `<span class="nota-tecnica-indicador" title="Notas técnicas: ${tooltipNota}">🧠</span>`
    : "";
  const fotosBadge = fotosTallerCount > 0
    ? `<span class="fotos-taller-badge" title="Ver fotos de la orden" data-action="go-fotos-taller" data-orden-id="${ordenId}" data-stop-propagation="true" role="button" tabindex="0"><i data-lucide="camera"></i> ${fotosTallerCount}</span>`
    : "";

  filaOrden.style.cursor = "pointer";
  filaOrden.setAttribute('data-estado', estado);
  // Keyboard accessibility: row acts as a disclosure button.
  filaOrden.setAttribute('tabindex', '0');
  filaOrden.setAttribute('role', 'button');
  filaOrden.setAttribute('aria-expanded', 'false');
  filaOrden.setAttribute('aria-label', `Detalles de la orden ${ordenId}`);
  // (El dot de "trabajo" que abría la fila se retiró: trabajo_estado no tiene
  // escritor desde que se eliminó trabajar-orden [2026-07-06] — el punto gris
  // era ruido sin señal. Auditoría órdenes P2.)

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
      <i data-lucide="chevron-right" class="flecha"></i>
      <span class="orden-id">${ordenId}</span>
      ${fotosBadge}
    </td>
    <td class="client-name-cell">
      <div class="cliente-cell">
        <span class="cliente-text">${escapeHtml(nombreClienteDe(ordenData))}</span>
        <span class="cliente-icon">${iconoAdvertencia}${iconoContrato}</span>
      </div>
    </td>
    <td>${(() => {
      // Reskin F4 slice 3 (propuesta): avatar de iniciales junto al técnico.
      const ini = String(ordenData.tecnico_asignado || '').trim()
        .split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
      return ini ? `<span class="tec-avatar" aria-hidden="true">${ini}</span>` : '';
    })()}${escapeHtml(ordenData.tecnico_asignado)}${indicadorNota}</td>
    <td>${tipoChip(ordenData.tipo_de_servicio)}</td>
    <td><span class="chip-estado ${getEstadoClass(estado)}" title="${estado}">${estadoCompacto(estado)}</span></td>
    <td>${formatFecha(ordenData.fecha_creacion)}${edadChip(ordenData, estado)}</td>
    <td class="col-fecha-entrega">${formatFecha(ordenData.fecha_entrega)}</td>
    <td class="acciones"><div class="acciones-wrap">${botonesFlujo(ordenId, estado, ordenData)}${botonesGestion(ordenId, estado, tooltipNota, estiloNota)}</div></td>
  `;

  // Row click/keydown handling is delegated at the table level — see
  // the `initOrdenRowDelegation` IIFE at the bottom of this file.
  // Marker attribute identifies rows that should toggle on click/Enter.
  filaOrden.setAttribute("data-orden-row", "1");

  contenedor.appendChild(filaOrden);
  // Fila de detalle LAZY (auditoría P3.17): antes se construía aquí, EAGER,
  // para las 50 órdenes de la página (~55% de los ~10,000 nodos de cada
  // pintado, oculta casi toda). Ahora la construye _crearFilaDetalle al
  // PRIMER expand (_toggleOrdenRow) — el snapshot re-pinta solo filas
  // compactas y las expandidas se reconstruyen al re-expandir
  // (renderOrdersList preserva cuáles estaban abiertas).

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
    const tieneNotaCard = ordenData.nota_tecnica && ordenData.nota_tecnica.trim() !== "";
    const indicadorNotaCard = tieneNotaCard
      ? `<span class="nota-tecnica-indicador" title="Notas técnicas: ${ordenData.nota_tecnica.slice(0, 80).replace(/"/g, "'")}">🧠</span>`
      : "";
    const tipoDisplay = ordenData.tipo_de_servicio || "—";
    const fotosBadgeMobile = fotosTallerCount > 0
      ? `<span class="fotos-taller-badge mobile" title="Ver fotos de la orden" data-action="go-fotos-taller" data-orden-id="${ordenId}" data-stop-propagation="true" role="button" tabindex="0"><i data-lucide="camera"></i> ${fotosTallerCount}</span>`
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
        <span class="card-contrato__tecnico">${tecnicoDisplay}${indicadorNotaCard}</span>
        ${fotosBadgeMobile}
      </div>
      <div class="card-contrato__tier3">
        <span>Inicio: ${formatFecha(ordenData.fecha_creacion)}${edadChip(ordenData, estado)}</span>
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
  if (ordenData.fecha_recepcion) {
    entries.push({
      icon: 'package-plus',
      label: 'Recibida en mostrador',
      ts: ordenData.fecha_recepcion,
      by: ordenData.receptor_recepcion_nombre || ordenData.recepcion_por_email || '',
      kind: 'recibido'
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
      return e.bateria && e.clip && e.cargador && e.fuente && e.antena && e.cubrepolvo;
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
      // Compact format: just "X / N". Detalle (intervenidos vs no
      // disponibles) queda en el title del contenedor para tooltip.
      if (valorEl) valorEl.textContent = `${equiposFinalizados} / ${equipos.length}`;
      progresoIndicador.title = `${equiposConIntervencion} intervenidos · ${equiposNoDisponibles} no disponibles · ${equipos.length} total`;

      // Estado para CSS — el look neutro ignora estos modificadores,
      // pero los mantenemos por si otras vistas dependen de ellos.
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
        <!-- Debe coincidir con los .col-* de ordenes-index.css. Serie lleva el
             serial MAS los chips del pool, por eso es ancha; Observaciones se
             trunca a una linea con tooltip, por eso cedio espacio. -->
        <colgroup>
          <col style="width: 16%;">
          <col style="width: 12%;">
          <col style="width: 24%;">
          <col style="width: 22%;">
          <col style="width: 20%;">
          <col style="width: 6%;">
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
            const accesoriosPresentes = [e.bateria, e.clip, e.cargador, e.fuente, e.antena, e.cubrepolvo].filter(Boolean).length;
            const accesoriosTotal = 6;
            const accesoriosCompleto = accesoriosPresentes === accesoriosTotal;
            const noDisponible = !!e.intervencion_no_disponible;
            const motivoNoDisponible = (e.motivo_no_disponible || "").toString();
            const tieneIntervencion = !!(e.trabajo_tecnico || "").trim();
            const fotosActivas = (Array.isArray(e.fotos) ? e.fotos : []).filter(f => f && f.deleted !== true && !!f.url).length;
            const fotosBadgeDesktop = fotosActivas > 0
              ? `<span class="equipo-fotos-badge" title="${fotosActivas} foto(s)"><i data-lucide="camera"></i> ${fotosActivas}</span>`
              : '';

            return `
            <tr data-equipo-id="${ordenId}_${e.id}" class="equipo-row ${ordenCerrada ? 'contexto-historico' : 'contexto-activo'} ${noDisponible ? 'no-disponible' : ''}">
              <td class="col-serie">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="numero_de_serie">
                  <span class="valor valor-primario">${e.numero_de_serie ? escapeHtml(e.numero_de_serie) : "-"}</span>
                  ${obtenerIconoLapiz(`${ordenId}_${e.id}`, 'numero_de_serie', e.numero_de_serie || '')}
                  ${fotosBadgeDesktop}
                </div>
              </td>

              <td class="col-modelo">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="modelo">
                  <span class="valor valor-primario">${e.modelo ? escapeHtml(e.modelo) : "-"}</span>
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
                           <span class="chev"><i data-lucide="chevron-right"></i></span>
                         </button>
                       </div>`
                    : (tieneIntervencion
                      ? `<div class="intervencion-badge activa" title="Intervención registrada">
                          <div class="intervencion-content">
                            <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                              <span class="icon"><i data-lucide="clipboard-check"></i></span>
                              <span class="label">Registrada</span>
                              <span class="chev"><i data-lucide="chevron-right"></i></span>
                            </button>
                            <span class="intervencion-text" title="${escapeHtml(e.trabajo_tecnico || '')}">${escapeHtml(e.trabajo_tecnico || '')}</span>
                          </div>
                         </div>`
                      : `<div class="intervencion-badge pendiente ${ordenCerrada ? 'historico' : 'activo'}" title="${ordenCerrada ? 'No se registró intervención (orden cerrada)' : 'Pendiente de intervención'}">
                           <button class="btn-intervencion" data-action="abrir-intervencion-desktop" data-stop-propagation="true" data-orden-id="${ordenId}" data-equipo-id="${e.id}">
                             <span class="icon">${ordenCerrada ? '<i data-lucide="file-x"></i>' : '<i data-lucide="clipboard-list"></i>'}</span>
                             <span class="label">${ordenCerrada ? 'No registrada' : 'Pendiente'}</span>
                             <span class="chev"><i data-lucide="chevron-right"></i></span>
                           </button>
                         </div>`
                    )
                  }
                </div>
              </td>

              <td class="col-accesorios">
                <div class="accesorios-wrapper ${accesoriosCompleto ? 'completo' : 'incompleto'}">
                  <div class="accesorios-group accesorios-group--chips">
                    <span class="accesorio-item accesorio-item--chip ${e.bateria ? 'activo' : 'inactivo'}" data-campo="bateria" title="${e.bateria ? 'Batería incluida' : 'Batería NO incluida'}">BAT</span>
                    <span class="accesorio-item accesorio-item--chip ${e.clip ? 'activo' : 'inactivo'}" data-campo="clip" title="${e.clip ? 'Clip incluido' : 'Clip NO incluido'}">CLIP</span>
                    <span class="accesorio-item accesorio-item--chip ${e.cargador ? 'activo' : 'inactivo'}" data-campo="cargador" title="${e.cargador ? 'Cargador incluido' : 'Cargador NO incluido'}">CARG</span>
                    <span class="accesorio-item accesorio-item--chip ${e.fuente ? 'activo' : 'inactivo'}" data-campo="fuente" title="${e.fuente ? 'Fuente incluida' : 'Fuente NO incluida'}">FNT</span>
                    <span class="accesorio-item accesorio-item--chip ${e.antena ? 'activo' : 'inactivo'}" data-campo="antena" title="${e.antena ? 'Antena incluida' : 'Antena NO incluida'}">ANT</span>
                    <span class="accesorio-item accesorio-item--chip ${e.cubrepolvo ? 'activo' : 'inactivo'}" data-campo="cubrepolvo" title="${e.cubrepolvo ? 'Cubre Polvo incluido' : 'Cubre Polvo NO incluido'}">CUB</span>
                  </div>
                  <span class="completitud-badge">${accesoriosPresentes}/${accesoriosTotal}</span>
                </div>
              </td>

              <td class="col-observaciones">
                <div class="celda-editable" data-id="${ordenId}_${e.id}" data-campo="observaciones">
                  <!-- escapeHtml en AMBOS: una comilla en la observacion rompia
                       el atributo title, y el cuerpo iba crudo al innerHTML. -->
                  <span class="valor" title="${escapeHtml(e.observaciones || '')}">${e.observaciones ? escapeHtml(e.observaciones) : "-"}</span>
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
  decorarEstadoPoolEnTabla(ordenId, equipos, filaDetalle);
}

// Decora la columna Serie con el estado de la unidad en el pool de equipos
// serializados (equipos_pool): chip de estado con link al kardex y, si el
// serial figura asignado a OTRO cliente, un aviso — ayuda a detectar equipos
// mal identificados al recibirlos en taller. Best-effort y asíncrono: si el
// servicio no está o la consulta falla, la tabla queda igual que siempre.
// Caché por sesión del decorado del pool (auditoría órdenes P0): mientras
// una fila siguiera expandida, CADA snapshot re-consultaba equipos_pool por
// sus seriales. TTL 5 min; también se cachean los "sin ficha" (docs: [])
// para no re-preguntar por seriales que no existen en el pool.
const _poolDecoCache = new Map(); // serial_norm → { ts, docs: [] }

async function decorarEstadoPoolEnTabla(ordenId, equipos, filaDetalle) {
  if (typeof EquiposPoolService === 'undefined') return;
  const conSerial = (equipos || [])
    .map(e => ({ e, norm: EquiposPoolService.normalizarSerial(e.numero_de_serie || e.serial || '') }))
    .filter(x => x.norm);
  if (!conSerial.length) return;

  // Una query por chunk de 10 (limite del operador `in`) sobre serial_norm,
  // SOLO para los seriales sin caché fresca.
  const norms = [...new Set(conSerial.map(x => x.norm))];
  const docs = [];
  const faltan = [];
  const ahora = Date.now();
  norms.forEach(n => {
    const c = _poolDecoCache.get(n);
    if (c && (ahora - c.ts) < 300000) docs.push(...c.docs);
    else faltan.push(n);
  });
  if (faltan.length) {
    try {
      const db = firebase.firestore();
      const traidos = new Map(faltan.map(n => [n, []]));
      for (let i = 0; i < faltan.length; i += 10) {
        const snap = await db.collection('equipos_pool')
          .where('serial_norm', 'in', faltan.slice(i, i + 10)).get();
        snap.docs.forEach(d => {
          const doc = { id: d.id, ...d.data() };
          docs.push(doc);
          (traidos.get(doc.serial_norm) || []).push(doc);
        });
      }
      traidos.forEach((arr, n) => _poolDecoCache.set(n, { ts: ahora, docs: arr }));
    } catch (err) { return; }
  }
  if (!docs.length) return;

  const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
  const clienteOrdenId = ordenData?.cliente_id || '';

  for (const { e, norm } of conSerial) {
    const candidatos = docs.filter(d => d.serial_norm === norm);
    if (!candidatos.length) continue;
    // Con colisión de serial entre modelos, elige el doc del modelo del equipo.
    const unidad = candidatos.length === 1 ? candidatos[0]
      : (candidatos.find(d => EquiposPoolService._mismoModelo(d, e.modelo_id || null, e.modelo || '')) || candidatos[0]);

    const celda = filaDetalle.querySelector(`tr[data-equipo-id="${ordenId}_${e.id}"] .col-serie .celda-editable`);
    if (!celda) continue;
    celda.querySelectorAll('.eqpool-chip').forEach(n => n.remove());

    const chip = document.createElement('a');
    chip.className = `eqpool-chip eqpool-chip-${EquiposPoolService.ESTADO_LABELS[unidad.estado] ? unidad.estado : 'desconocido'}`;
    chip.href = EquiposPoolService.kardexUrl(unidad.serial || unidad.serial_norm);
    chip.style.textDecoration = 'none';
    chip.title = 'Estado en el pool de equipos — click para ver la ficha del equipo';
    chip.textContent = EquiposPoolService.ESTADO_LABELS[unidad.estado] || unidad.estado || '';
    // La Ficha del equipo es legible por CUALQUIER rol; el kardex de inventario
    // queda como fallback si el componente no está cargado.
    chip.addEventListener('click', (ev) => {
      if (window.EquipoFicha) { ev.preventDefault(); EquipoFicha.abrir(unidad.serial || unidad.serial_norm); }
    });
    celda.appendChild(chip);

    // Aviso suave: el pool dice que esta unidad esta con OTRO cliente.
    // Mismo texto y misma paleta que SerialField (.eqpool-chip-aviso) — es el
    // mismo hallazgo, solo que aqui sobre una fila ya guardada.
    const clientePool = unidad.asignacion?.cliente_id || '';
    if (clientePool && clienteOrdenId && clientePool !== clienteOrdenId) {
      const warn = document.createElement('span');
      warn.className = 'eqpool-chip eqpool-chip-aviso';
      warn.title = `En el pool esta unidad figura con ${unidad.asignacion?.cliente_nombre || 'otro cliente'} — verifica el serial`;
      warn.textContent = '⚠ otro cliente';
      celda.appendChild(warn);
    }
  }
}

function refrescarEquiposDeOrden(ordenId) {
  const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!ordenData) return;

  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  if (filaDetalle && filaDetalle.getAttribute("data-equipos-loaded") !== "false") {
    const equipos = (ordenData.equipos || []).filter(e => !e.eliminado);
    renderEquiposTabla(ordenId, equipos, filaDetalle);
  }

  // Also re-render the mobile equipos modal if it's currently open.
  const mobileModal = document.getElementById("modalEquiposMobile");
  if (mobileModal && !mobileModal.classList.contains("hidden") && typeof window.abrirEquiposMobile === "function") {
    window.abrirEquiposMobile(ordenId);
  }
}
window.refrescarEquiposDeOrden = refrescarEquiposDeOrden;

// ===== Control de calidad (ordenes-qc.js) =====
// El botón Entregar queda visualmente bloqueado mientras el QC esté
// pendiente (qc_requerido sin aprobación vigente); entregarOrden re-valida
// al click y las rules lo exigen en la transición. Órdenes completadas
// antes del despliegue no llevan qc_requerido → sin candado (corte legacy).
function _qcPendiente(od) {
  return typeof OrdenesQC !== 'undefined' && OrdenesQC.qcPendiente(od);
}

function _btnEntregar(ordenId, od) {
  const bloqueado = _qcPendiente(od);
  const caducado  = typeof OrdenesQC !== 'undefined' && OrdenesQC.qcCaducado(od);
  const cls   = bloqueado ? ' btn-flujo--bloqueado' : '';
  const title = caducado
    ? 'El QC aprobado caducó: cambiaron los equipos de la orden'
    : (bloqueado ? 'Requiere control de calidad aprobado' : 'Entregar al cliente');
  return `<button class="btn-flujo btn-flujo--entregar${cls}" title="${title}" data-action="entregar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="send"></i> Entregar</button>`;
}

// Órdenes de ENTRADA (inspección de devueltos): la revisión termina y las
// unidades quedan bajo control de inventario — no hay entrega al cliente,
// así que su terminal es "Cerrar entrada" (CERRADA (ENTRADA)), no Entregar.
function _btnCerrarEntrada(ordenId) {
  return `<button class="btn-flujo btn-flujo--completar" title="Cerrar entrada (los equipos quedan bajo control de inventario)" data-action="cerrar-entrada" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Cerrar entrada</button>`;
}

// Botón de QC para jefe_taller/admin sobre órdenes COMPLETADO: resaltado
// mientras está pendiente, "Ver QC" una vez aprobado. También se ofrece en
// órdenes legacy sin la marca (QC voluntario, sin candado).
function _btnQc(ordenId, od, rol) {
  if (typeof OrdenesQC === 'undefined' || !OrdenesQC.puedeHacerQc(rol)) return '';
  if (OrdenesQC.qcAprobado(od)) {
    return `<button class="btn-flujo btn-flujo--qc-ok" title="Ver control de calidad aprobado" data-action="qc-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="clipboard-check"></i> Ver QC</button>`;
  }
  // Caducado = hubo una aprobación pero cambiaron los equipos desde la firma.
  if (OrdenesQC.qcCaducado(od)) {
    return `<button class="btn-flujo btn-flujo--qc" title="El QC caducó: cambiaron los equipos de la orden" data-action="qc-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="clipboard-check"></i> Repetir QC</button>`;
  }
  return `<button class="btn-flujo btn-flujo--qc" title="Realizar control de calidad" data-action="qc-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="clipboard-check"></i> QC</button>`;
}

// En ASIGNADO tras un rechazo de QC: acceso al motivo para el técnico
// (modal en solo-lectura fuera de COMPLETADO/rol QC).
function _btnQcRechazo(ordenId, od) {
  if (od?.qc?.resultado !== 'rechazado') return '';
  // Cuántos radios hay que corregir, EN LA FILA. Con revisión por equipo el
  // rechazo ya no es "la orden está mal": son 2 de 9 radios concretos, y el
  // técnico no debería tener que abrir el modal para enterarse de cuántos son
  // (pedido de la jefa de taller, 2026-08-20: "debe estar claro para el
  // técnico qué quedó pendiente").
  const denegados = Array.isArray(od?.qc?.equipos_denegados) ? od.qc.equipos_denegados : [];
  const n = denegados.length;
  const etiqueta = n ? `Corregir ${n}` : 'Rechazo QC';
  const detalle = n
    ? `Control de calidad denegó ${n} equipo${n === 1 ? '' : 's'}: ${denegados.join(', ')}. Click para ver qué falló en cada uno.`
    : 'Ver motivo del rechazo de control de calidad';
  return `<button class="btn-flujo btn-flujo--qc-rechazo" title="${escapeHtml(detalle)}" data-action="qc-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="clipboard-x"></i> ${escapeHtml(etiqueta)}</button>`;
}

// Chip "faltan N" de una orden de DEVOLUCIÓN abierta. Se pinta junto al botón
// de check-in para que el faltante se vea desde el listado — antes había que
// abrir la orden para enterarse de que el cliente devolvió 6 de 9.
// El conteo sale de pendientesDevolucion (ordenes-state.js), la misma fórmula
// que usan el modal de check-in y el recordatorio diario.
function badgePendientesDevolucion(od) {
  if (typeof pendientesDevolucion !== 'function') return '';
  const n = pendientesDevolucion(od);
  if (!n) return '';
  return `<span class="chip-estado chip-espera" style="margin-right:4px;white-space:nowrap;"
    title="El cliente todavía no ha devuelto ${n} equipo${n === 1 ? '' : 's'}">
    <i data-lucide="package-x" style="width:12px;height:12px;vertical-align:-1px;"></i> Faltan ${n}</span>`;
}
window.badgePendientesDevolucion = badgePendientesDevolucion;

function botonesFlujo(ordenId, estado, ordenData) {
  const rol = APP.state.userRole || "";
  let html = "";

  const od = ordenData || (APP.state.orders || []).find(x => x.ordenId === ordenId) || {};
  const esVisita = typeof esOrdenVisita === 'function' && esOrdenVisita(od);
  const esDevolucion = typeof esOrdenDevolucion === 'function' && esOrdenDevolucion(od);
  const esEntrada = typeof esOrdenEntrada === 'function' && esOrdenEntrada(od);

  // Órdenes de DEVOLUCIÓN (recuperar equipos del cliente / confirmar
  // anulación): su flujo es el check-in por serial, no el de taller.
  if (esDevolucion) {
    const cerradaDev = (estado || '').toUpperCase() === 'CERRADA (DEVOLUCION)';
    if (!cerradaDev && rol !== ROLES.VISTA) {
      // Dos estados del mismo botón (ambos abren el check-in):
      //   · faltan equipos  → ámbar "Registrar equipos": es un prompt de captura.
      //     El verde con package-check se leía como "seriales ya registrados".
      //   · todos recibidos → verde "Lista para cerrar": solo falta el acuse.
      // Ojo: pendientesDevolucion da 0 también cuando una devolución
      // sin_contrato no declaró total_esperado — ahí NO está lista, no hay
      // contra qué comparar; se exige que haya habido algo esperado.
      const dev = od?.devolucion || {};
      const pend = typeof pendientesDevolucion === 'function' ? pendientesDevolucion(od) : 1;
      const huboEsperados = (dev.esperados || []).length > 0
        || (dev.esperados_por_modelo || []).some(m => Number(m.cantidad || 0) > 0)
        || Number(dev.total_esperado || 0) > 0;
      if (pend === 0 && huboEsperados) {
        html += `<button class="btn-flujo btn-flujo--completar" title="El cliente ya devolvió todos los equipos — abre la devolución para firmar el acuse y cerrarla" data-action="checkin-devolucion" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Lista para cerrar</button>`;
      } else {
        // Cuántos radios sigue debiendo el cliente, sin abrir el check-in: es el
        // dato que se perdía de vista cuando devuelven solo una parte.
        html += badgePendientesDevolucion(od);
        html += `<button class="btn-flujo btn-flujo--checkin-dev" title="Registrar por serial los equipos que el cliente devuelve" data-action="checkin-devolucion" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="scan-barcode"></i> Registrar equipos</button>`;
      }
    } else {
      html += `<button class="btn-flujo btn-flujo--ver-entrega" title="Ver devolución" data-action="checkin-devolucion" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Ver devolución</button>`;
    }
    return html;
  }

  // Visitas técnicas (trabajo de campo): no hay recepción en mostrador ni
  // entrega al cliente. Flujo propio: POR ASIGNAR → Asignar → ASIGNADO →
  // Cerrar visita (firma del personal de la empresa visitada o motivo).
  // COMPLETADO (EN OFICINA) cubre visitas legacy completadas sin firma:
  // también se les ofrece regularizar el cierre.
  if (esVisita && [ROLES.ADMIN, ROLES.RECEPCION, ROLES.JEFE_TALLER, ROLES.TECNICO, ROLES.TECNICO_OPERATIVO].includes(rol)) {
    const btnAsignar = `<button class="btn-flujo btn-flujo--asignar" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="wrench"></i> Asignar</button>`;
    const btnCerrar  = `<button class="btn-flujo btn-flujo--completar" title="Cerrar visita (firma en sitio)" data-action="cerrar-visita" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="pen-line"></i> Cerrar visita</button>`;
    if ((estado === "POR ASIGNAR" || estado === "RECIBIDO EN MOSTRADOR") && rol !== ROLES.TECNICO_OPERATIVO) {
      html += btnAsignar;
    } else if (estado === "ASIGNADO" || estado === "COMPLETADO (EN OFICINA)") {
      html += btnCerrar;
    }
    if ((estado || "").toUpperCase() === "CERRADA (VISITA)") {
      html += `<button class="btn-flujo btn-flujo--ver-entrega" title="Ver cierre de visita" data-action="ver-entrega" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Ver cierre</button>`;
    }
    // Visitas legacy que llegaron a ENTREGADO por el flujo viejo: conservar
    // el acceso a su comprobante de entrega/recepción.
    if ((estado || "").toUpperCase().includes("ENTREGAD")
        && (od.firma_url || od.receptor_nombre || od.fecha_entrega || od.firma_recepcion_url || od.fecha_recepcion)) {
      html += `<button class="btn-flujo btn-flujo--ver-entrega" title="Ver entrega" data-action="ver-entrega" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Ver entrega</button>`;
    }
    return html || "<em>-</em>";
  }

  // Visitas vistas por roles fuera del flujo de campo (vendedor, vista…):
  // solo consulta. Sin este corte, un vendedor vería "Entregar" en una
  // visita en COMPLETADO y la sacaría por el terminal equivocado
  // (ENTREGADO AL CLIENTE en vez de CERRADA (VISITA)).
  if (esVisita) {
    if ((estado || "").toUpperCase() === "CERRADA (VISITA)") {
      html += `<button class="btn-flujo btn-flujo--ver-entrega" title="Ver cierre de visita" data-action="ver-entrega" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Ver cierre</button>`;
    }
    if ((estado || "").toUpperCase().includes("ENTREGAD")
        && (od.firma_url || od.receptor_nombre || od.fecha_entrega || od.firma_recepcion_url || od.fecha_recepcion)) {
      html += `<button class="btn-flujo btn-flujo--ver-entrega" title="Ver entrega" data-action="ver-entrega" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Ver entrega</button>`;
    }
    return html || "<em>-</em>";
  }

  // jefe_taller (supervisor de taller) comparte el flujo completo con
  // admin/recepción: recibir → asignar → completar → entregar. Tiene el
  // permiso 'asignar-tecnico' en roles.js, así que debe ver el botón de
  // flujo igual que ellos.
  if (rol === ROLES.ADMIN || rol === ROLES.RECEPCION || rol === ROLES.JEFE_TALLER) {
    if (estado === "POR ASIGNAR") {
      // Primer paso obligatorio: recibir los equipos (acuse). No se puede
      // asignar hasta haber recibido.
      html += `<button class="btn-flujo btn-flujo--recibir" title="Recibir equipos (primer paso)" data-action="recibir-mostrador" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-plus"></i> Recibir</button>`;
    } else if (estado === "RECIBIDO EN MOSTRADOR") {
      html += `<button class="btn-flujo btn-flujo--asignar" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="wrench"></i> Asignar</button>`;
    } else if (estado === "ASIGNADO") {
      html += `<button class="btn-flujo btn-flujo--completar" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="check-circle"></i> Completar</button>`;
      html += _btnQcRechazo(ordenId, od);
    } else if (estado === "COMPLETADO (EN OFICINA)") {
      // ENTRADA (inspección de devueltos): cierra sin entrega ni QC — la
      // revisión es el trabajo mismo y nada sale hacia el cliente.
      if (esEntrada) {
        html += _btnCerrarEntrada(ordenId);
      } else {
        html += _btnQc(ordenId, od, rol);
        html += _btnEntregar(ordenId, od);
      }
    }
  }

  else if (rol === ROLES.TECNICO) {
    if (estado === "POR ASIGNAR") {
      // El técnico también puede recibir (primer paso). Si recepción no la
      // recibió, puede saltarse el paso con "Asignar (saltar recepción)" del ⋯.
      html += `<button class="btn-flujo btn-flujo--recibir" title="Recibir equipos (primer paso)" data-action="recibir-mostrador" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-plus"></i> Recibir</button>`;
    } else if (estado === "RECIBIDO EN MOSTRADOR") {
      html += `<button class="btn-flujo btn-flujo--asignar" title="Asignar técnico" data-action="asignar-tecnico" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="wrench"></i> Asignar</button>`;
    } else if (estado === "ASIGNADO") {
      html += `<button class="btn-flujo btn-flujo--completar" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="check-circle"></i> Completar</button>`;
      html += _btnQcRechazo(ordenId, od);
    } else if (estado === "COMPLETADO (EN OFICINA)") {
      html += esEntrada ? _btnCerrarEntrada(ordenId) : _btnEntregar(ordenId, od);
    }
  }

  else if (rol === ROLES.TECNICO_OPERATIVO) {
    if (estado === "ASIGNADO") {
      html += `<button class="btn-flujo btn-flujo--completar" title="Completar orden" data-action="completar-orden" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="check-circle"></i> Completar</button>`;
      html += _btnQcRechazo(ordenId, od);
    } else if (estado === "COMPLETADO (EN OFICINA)") {
      html += esEntrada ? _btnCerrarEntrada(ordenId) : _btnEntregar(ordenId, od);
    }
  }

  else if (rol === ROLES.VENDEDOR) {
    if (estado === "COMPLETADO (EN OFICINA)") {
      // El vendedor entrega órdenes de taller, pero no cierra entradas
      // (inspección interna del taller/inventario).
      if (!esEntrada) html += _btnEntregar(ordenId, od);
    }
  }

  // Si la orden ya fue entregada (o la ENTRADA ya cerró) no queda acción de
  // flujo, así que "Ver entrega/recepción" vuelve inline (la columna quedaría
  // solo con ⋯). En estados con acción de flujo vive en el menú ⋯. En una
  // ENTRADA cerrada, "Ver recepción" muestra el acuse firmado del cliente.
  if ((estado || "").toUpperCase().includes("ENTREGAD")
      || (estado || "").toUpperCase() === "CERRADA (ENTRADA)") {
    const tieneEnt = !!(od.firma_url || od.receptor_nombre || od.fecha_entrega || od.sin_id || od.identificacion_path || od.identificacion_url);
    const tieneRec = !!(od.firma_recepcion_url || od.receptor_recepcion_nombre || od.fecha_recepcion);
    if (tieneEnt || tieneRec) {
      const label = tieneEnt ? 'Ver entrega' : 'Ver recepción';
      html += `<button class="btn-flujo btn-flujo--ver-entrega" title="${label}" data-action="ver-entrega" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> ${label}</button>`;
    }
  }

  // Visita cerrada vista por roles fuera del flujo de visita (vendedor,
  // vista): igual pueden consultar el cierre (firma / motivo).
  if ((estado || "").toUpperCase() === "CERRADA (VISITA)") {
    html += `<button class="btn-flujo btn-flujo--ver-entrega" title="Ver cierre de visita" data-action="ver-entrega" data-stop-propagation="true" data-orden-id="${ordenId}"><i data-lucide="package-check"></i> Ver cierre</button>`;
  }

  return html || "<em>-</em>";
}
window.botonesFlujo = botonesFlujo;

function botonesGestion(ordenId, estado, tooltipNota = "", estiloNota = "") {
  const rol = APP.state.userRole || "";
  const estadoUpper = (estado || "").toUpperCase();

  const o = APP.state.orders.find(x => x.ordenId === ordenId) || {};
  const tieneNota = o.nota_tecnica && o.nota_tecnica.trim() !== "";
  const esVisita = typeof esOrdenVisita === 'function' && esOrdenVisita(o);

  let menuItems = [
    { icon: '<i data-lucide="camera"></i>', label: esVisita ? "Fotos de la visita" : "Fotos de taller", action: "go-fotos-taller", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
  ];

  // Informe de visita — el registro estructurado del trabajo de campo
  // (reemplaza el volcado en notas técnicas). Primero en el menú para
  // que el técnico lo tenga a un tap en móvil.
  if (esVisita && rol !== ROLES.VISTA) {
    const tieneInforme = !!(o.informe_visita?.trabajo_realizado || "").trim();
    menuItems.unshift({
      icon: '<i data-lucide="clipboard-list"></i>',
      label: tieneInforme ? "Ver informe de visita" : "Llenar informe de visita",
      action: "informe-visita",
      dataAttributes: `data-orden-id="${ordenId}"`,
      class: "highlighted"
    });
  }

  // "Ver entrega/recepción" en el menú SOLO cuando todavía hay acción de
  // flujo (no entregada). Si ya fue entregada, el botón va inline (botonesFlujo)
  // para no duplicarlo.
  const tieneRecepcion = !!(o.firma_recepcion_url || o.receptor_recepcion_nombre || o.fecha_recepcion);
  const tieneEntrega   = !!(o.firma_url || o.receptor_nombre || o.fecha_entrega || o.sin_id || o.identificacion_path || o.identificacion_url);
  if (!estadoUpper.includes("ENTREGAD") && (tieneRecepcion || tieneEntrega)) {
    menuItems.unshift({
      icon: '<i data-lucide="package-check"></i>',
      label: tieneEntrega ? "Ver entrega" : "Ver recepción",
      action: "ver-entrega",
      dataAttributes: `data-orden-id="${ordenId}"`,
      class: "highlighted"
    });
  }

  // Asignar aunque recepción no haya recibido la orden: opción en el menú
  // para saltarse el paso de recibir en POR ASIGNAR. Para todos los roles
  // operativos (no para 'vista', que es solo lectura).
  if (estadoUpper === "POR ASIGNAR" && rol !== ROLES.VISTA) {
    menuItems.unshift({
      icon: '<i data-lucide="wrench"></i>',
      label: "Asignar (saltar recepción)",
      action: "asignar-tecnico",
      dataAttributes: `data-orden-id="${ordenId}"`,
      class: "highlighted"
    });
  }


  if (rol === ROLES.ADMIN || rol === ROLES.RECEPCION) {
    // Editar: SOLO cuando aplica (POR ASIGNAR). El item gris permanente era
    // ruido — en la mayoría de las filas no se podía usar (auditoría P2).
    // Eliminar: solo en estados NO terminales; una orden entregada/cerrada es
    // historial del cliente y se conserva (anular ≠ borrar).
    const esTerminal = estadoUpper.includes("ENTREGAD") || estadoUpper.startsWith("CERRADA");
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden-doc", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="clipboard-list"></i>', label: "Nota de entrega", action: "nota-entrega-doc", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="file-text"></i>', label: tieneNota ? "Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' }
    );
    if (estadoUpper === "POR ASIGNAR" || !esTerminal) menuItems.push({ divider: true });
    if (estadoUpper === "POR ASIGNAR") {
      menuItems.push({ icon: '<i data-lucide="pencil"></i>', label: "Editar orden", action: "editar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" });
    }
    if (!esTerminal) {
      menuItems.push({ icon: '<i data-lucide="trash-2"></i>', label: "Eliminar orden", action: "eliminar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "danger" });
    }
  } else if (rol === ROLES.TECNICO || rol === ROLES.TECNICO_OPERATIVO) {
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="file-text"></i>', label: tieneNota ? "Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' }
    );
  } else if (rol === ROLES.JEFE_TALLER) {
    // Supervisor de taller: imprime la orden y sus documentos, y gestiona
    // notas técnicas — sin editar/eliminar la orden (eso queda en admin).
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden-doc", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="clipboard-list"></i>', label: "Nota de entrega", action: "nota-entrega-doc", dataAttributes: `data-orden-id="${ordenId}"`, class: "" },
      { icon: '<i data-lucide="file-text"></i>', label: tieneNota ? "Ver notas técnicas" : "Agregar notas técnicas", action: "gestionar-notas", dataAttributes: `data-orden-id="${ordenId}"`, class: tieneNota ? 'highlighted' : '' }
    );
  } else if (rol === ROLES.VISTA) {
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir orden", action: "imprimir-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
    );
  } else if (rol === ROLES.VENDEDOR) {
    menuItems.push(
      { icon: '<i data-lucide="printer"></i>', label: "Imprimir / documentos", action: "ver-documentos", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
    );
  }

  // Cambiar técnico — reasignación esporádica para admin / supervisor de taller
  // (permiso 'reasignar-tecnico'). Solo cuando la orden YA tiene técnico y aún
  // NO se ha entregado: después de entregada no se cambia. Vive en el menú ⋯
  // por ser de uso poco frecuente, y usa un flujo aparte de "Asignar" que no
  // altera el estado de la orden.
  if (canRole(rol, 'reasignar-tecnico')
      && (o.tecnico_uid || o.tecnico_asignado)
      && !estadoUpper.includes("ENTREGAD")) {
    menuItems.push(
      { icon: '<i data-lucide="user-cog"></i>', label: "Cambiar técnico", action: "reasignar-tecnico", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
    );
  }

  // Cotizar — prepara una cotización (borrador) a partir de la orden y sus
  // intervenciones. Disponible para quienes pueden prepararla, incluidos los
  // técnicos de taller (preparan; la aprobación/envío es otro permiso).
  if (canRole(rol, 'preparar-cotizacion')) {
    menuItems.push(
      { icon: '<i data-lucide="receipt"></i>', label: "Cotizar", action: "cotizar-orden", dataAttributes: `data-orden-id="${ordenId}"`, class: "" }
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

// ── Conteos del SERVIDOR para chips/KPIs (auditoría M4/A8) ────────────────
// Los conteos locales solo ven lo CARGADO (50 por página): "Por asignar: 3"
// podía ser 8 en el servidor. Tras cada pintado local se corrigen con los
// MISMOS count() agregados de las señales del home (SenalesService — 1
// lectura por cada 1,000 contados), con throttle para no facturar por tecla.
// El chip "Todas" queda local a propósito: cuenta lo cargado (los estados
// legacy no están en la lista canónica y una suma server-side mentiría).
let _conteosSrvTs = 0;
let _conteosSrvEnVuelo = false;
async function _refrescarConteosServidor() {
  if (!window.SenalesService) return;
  if (_conteosSrvEnVuelo || (Date.now() - _conteosSrvTs) < 45000) return;
  _conteosSrvEnVuelo = true;
  try {
    const ESTADOS = ['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO',
      'COMPLETADO (EN OFICINA)', 'ENTREGADO AL CLIENTE', 'CERRADA (VISITA)'];
    const [counts, qc] = await Promise.all([
      Promise.all(ESTADOS.map(e => SenalesService.countOrdenesPorEstado(e).catch(() => null))),
      SenalesService.countOrdenesQcPendiente().catch(() => null),
    ]);
    const pinta = (key, n) => {
      if (n == null) return;   // un count fallido no pisa el número local
      document.querySelectorAll(`.estado-chips-bar [data-count="${key}"]`)
        .forEach(s => { s.textContent = String(n); });
    };
    ESTADOS.forEach((e, i) => pinta(e, counts[i]));
    pinta('qc', qc);
    _conteosSrvTs = Date.now();
  } finally { _conteosSrvEnVuelo = false; }
}

function actualizarResumen(lista) {
  const el = document.getElementById("resumenOrdenes");
  // Count from APP.state.chipBase — the last UNFILTERED dataset (kept fresh
  // by the snapshot + pagination in ordenes-data.js). APP.state.orders no
  // sirve de base: filtrarPorEstado lo reemplaza con el subset de un solo
  // estado y los demás chips caían a 0. The legacy resumen-button shows the
  // filtered total so the user has both numbers.
  const fullList = APP.state.chipBase || APP.state.orders || lista || [];
  const total = (lista || []).length;

  const _statusOf = (o) => (o.estado_reparacion || "POR ASIGNAR").toUpperCase();
  const porAsignar         = fullList.filter(o => _statusOf(o) === "POR ASIGNAR").length;
  const recibidoMostrador  = fullList.filter(o => _statusOf(o) === "RECIBIDO EN MOSTRADOR").length;
  const asignado           = fullList.filter(o => _statusOf(o) === "ASIGNADO").length;
  const completadoOficina  = fullList.filter(o => _statusOf(o) === "COMPLETADO (EN OFICINA)").length;
  const entregadoCliente   = fullList.filter(o => _statusOf(o) === "ENTREGADO AL CLIENTE").length;
  const cerradaVisita      = fullList.filter(o => _statusOf(o) === "CERRADA (VISITA)").length;
  // Cola de control de calidad: completadas que el candado no deja entregar.
  // Es un subconjunto de "completadas", no un estado — por eso va como chip
  // aparte y no en la barra de estados. Sin esto, "Completadas (en oficina)"
  // se leía como "listas para entregar" cuando parte no lo estaba.
  const qcPendientes = fullList.filter(o =>
    _statusOf(o) === "COMPLETADO (EN OFICINA)"
    && !(typeof esOrdenEntrada === 'function' && esOrdenEntrada(o))
    && typeof OrdenesQC !== 'undefined' && OrdenesQC.qcPendiente(o)).length;

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
  chipCount('RECIBIDO EN MOSTRADOR', recibidoMostrador);
  chipCount('ASIGNADO', asignado);
  chipCount('COMPLETADO (EN OFICINA)', completadoOficina);
  chipCount('ENTREGADO AL CLIENTE', entregadoCliente);
  chipCount('CERRADA (VISITA)', cerradaVisita);
  chipCount('qc', qcPendientes);
  // El chip de QC es un toggle (checkbox #filtroQcPendiente), no un estado:
  // su "activo" se sincroniza aquí, que corre tras cada aplicación de filtros
  // (incluye el deep-link ?qc=1 y el chip del dropdown Resumen).
  const qcOn = !!document.getElementById('filtroQcPendiente')?.checked;
  document.querySelectorAll('.estado-chips-bar [data-action="filtrar-qc"]').forEach(b => {
    b.classList.toggle('active', qcOn);
    b.setAttribute('aria-selected', String(qcOn));
  });
  // Corrección asíncrona con los conteos del servidor (throttled, ver arriba).
  _refrescarConteosServidor();
  // (The old #mobileHeader .topbar-badges cluster — tbPorAsignar /
  // tbAsignado / tbCompletado / tbEntregado — was a duplicate estado
  // filter and is gone. Its counts now live in the mobile chip bar
  // above, populated by chipCount().)

  if (!el) return;

  const filtroEstadoSelect = document.getElementById("filtroEstado");
  const estadoActivo = filtroEstadoSelect ? filtroEstadoSelect.value : "";
  const qcActivo = !!document.getElementById("filtroQcPendiente")?.checked;
  const estadoLabel = qcActivo ? "Pendientes de QC" : (estadoActivo || "Todos");

  // Texto plano, sin dropdown: el menú "Resumen" era la TERCERA copia del
  // filtro de estado (los chips y el select ya filtran). Queda el conteo del
  // listado actual, visible y anunciable (aria-live), espejado al header móvil.
  el.textContent = `Total: ${total} · ${estadoLabel}`;

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
 * @param {Function} [opts.onRetry] - When set, renders a "Reintentar"
 *   button wired to this callback (load-error / timeout states).
 * @param {string} [opts.retryLabel='Reintentar'] - Retry button label
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

  // A retry action (error/timeout) takes precedence over the "limpiar
  // filtros" CTA — when the load itself failed, clearing filters wouldn't
  // help the user.
  const ctaHtml = opts.onRetry
    ? `<button class="btn btn-secondary empty-state__cta" data-action="reintentar-carga">
         <i data-lucide="refresh-cw"></i> ${opts.retryLabel || 'Reintentar'}
       </button>`
    : (activeFilters
      ? `<button class="btn btn-secondary empty-state__cta" data-action="limpiar-filtros">
           <i data-lucide="x"></i> Limpiar filtros
         </button>`
      : '');

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

  // Wire the retry button directly (not via the delegated table listener,
  // which only knows about row actions). One-shot: re-rendering replaces it.
  if (opts.onRetry) {
    [ordersTable, ordersCards].forEach(root => {
      const btn = root && root.querySelector('[data-action="reintentar-carga"]');
      if (btn) btn.addEventListener('click', () => opts.onRetry(), { once: true });
    });
  }

  APP.utils.lucideRefresh([ordersTable, ordersCards]);
}
window.renderEmptyState = renderEmptyState;

// Construye la fila de detalle de una orden — LAZY (auditoría P3.17): antes
// se armaba eager para las 50 órdenes (~55% de los ~10,000 nodos por pintado,
// oculta casi toda); ahora SOLO la llama _toggleOrdenRow al primer expand
// (y al re-expandir tras un re-render, vía renderOrdersList). Devuelve el
// <tr class="filaDetalle"> listo; renderEquiposTabla llena .equipos-container.
function _crearFilaDetalle(ordenId, ordenData, equiposNormalizados) {
  const estado = (ordenData.estado_reparacion || "POR ASIGNAR").toUpperCase();
  const ordenCerrada = estado.includes('ENTREGAD') || estado.includes('ENTREGADA');

  const filaDetalle = document.createElement("tr");
  filaDetalle.style.display = "none";
  filaDetalle.classList.add("filaDetalle");
  filaDetalle.setAttribute("data-orden-id", ordenId);
  filaDetalle.setAttribute("data-equipos-loaded", "false");

  filaDetalle.innerHTML = `
    <td colspan="8" class="orden-expandida-wrapper">
      <div class="orden-expandida-card ${ordenCerrada ? 'orden-cerrada' : 'orden-activa'}">
        <div class="orden-header-compacto">
          <div class="header-col-izq header-line" title="Cliente: ${escapeHtml(nombreClienteDe(ordenData))} · Técnico: ${escapeHtml(ordenData.tecnico_asignado || 'Sin asignar')}">
            <span class="orden-numero"><strong>Orden ${ordenId}</strong></span>
            <span class="separador">•</span>
            <span class="cliente-nombre">${escapeHtml(nombreClienteDe(ordenData))}</span>
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
            <button class="btn-header-compact" data-action="nuevo-batch" data-stop-propagation="true" data-orden-id="${ordenId}" title="Nuevo batch de equipos">
              <i data-lucide="layers"></i>
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
                <span class="leyenda-item"><span class="accesorio-item accesorio-item--chip activo">BAT</span> Batería</span>
                <span class="leyenda-item"><span class="accesorio-item accesorio-item--chip activo">CLIP</span> Clip</span>
                <span class="leyenda-item"><span class="accesorio-item accesorio-item--chip activo">CARG</span> Cargador</span>
                <span class="leyenda-item"><span class="accesorio-item accesorio-item--chip activo">FNT</span> Fuente</span>
                <span class="leyenda-item"><span class="accesorio-item accesorio-item--chip activo">ANT</span> Antena</span>
                <span class="leyenda-item"><span class="accesorio-item accesorio-item--chip activo">CUB</span> Cubre Polvo</span>
                <span class="separador-leyenda">|</span>
                <span class="estado-inline"><span class="accesorio-item accesorio-item--chip activo accesorio-item--mini">✓</span> Incluido</span>
                <span class="estado-inline"><span class="accesorio-item accesorio-item--chip inactivo accesorio-item--mini">✕</span> No incluido</span>
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

  return filaDetalle;
}

// ── Row expansion: one delegated listener for the entire table ──────
// Replaces N per-row click + keydown listeners (50 rows × 2 = 100 listeners
// at full page) with a single pair on #ordersTable. Toggle state lives in
// the DOM (`data-equipos-loaded` + style.display); orden data is looked up
// from APP.state.orders by `data-orden-id`. ORDENES_INDEX_IMPROVEMENTS.md QW4.
function _toggleOrdenRow(filaOrden) {
  // Fila de detalle LAZY (P3.17): ya no existe pre-construida junto a cada
  // fila — se crea aquí al PRIMER expand con los datos frescos de APP.state.
  let filaDetalle = filaOrden.nextElementSibling;
  if (!filaDetalle || !filaDetalle.classList.contains('filaDetalle')) {
    const ordenId = filaOrden.dataset.ordenId;
    const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId);
    if (!orden) return;
    const equipos = (orden.equipos || [])
      .filter(e => !e.eliminado)
      .sort((a, b) => String(a.numero_de_serie || '').localeCompare(String(b.numero_de_serie || '')));
    filaDetalle = _crearFilaDetalle(ordenId, orden, equipos);
    filaOrden.after(filaDetalle);
    APP.utils.lucideRefresh(filaDetalle);
  }

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

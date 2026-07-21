// @ts-nocheck
/* ========================================
 * ORDENES EVENTS - Centralized event delegation
 * Maps every data-action attribute to a handler. Single click+change
 * listener on document covers ~40 actions across all page modules.
 * Phase 3 of the original orders refactor (2025-04); split out into
 * its own file in Phase 5f.
 * ======================================== */

/* ========================================
   PHASE 3: Event Delegation System
   ======================================== */

/**
 * Centralized event delegation for all button clicks
 * Replaces inline onclick handlers for cleaner HTML and better maintainability
 */
(function initEventDelegation() {
  
  // Action handlers map
  const ACTION_HANDLERS = {
    // Navigation actions
    'go-nueva-orden': () => window.location.href = BASE + 'nueva-orden.html',
    'go-config': () => window.location.href = BASE + 'config.html',
    'go-admin-equipos-cliente': () => {
      const currentRole = String(APP.state?.userRole || "").trim().toLowerCase();
      if (currentRole !== ROLES.ADMIN) {
        Toast.show('Solo administradores pueden acceder', 'bad');
        return;
      }
      window.location.href = BASE + 'admin-equipos-cliente.html';
    },
    'go-reporte-pendientes': () => window.open(BASE + 'reporte-pendientes.html', '_blank'),
    'go-progreso-tecnicos': () => window.location.href = 'progreso-tecnicos.html',
    'go-menu-principal': () => window.location.href = '../index.html',
    'logout': () => cerrarSesion(),
    'toggle-topbar-menu': () => toggleTopbarMenu(),
    'toggle-resumen-menu': () => toggleResumenMenu(),
    
    // Filter actions
    'filtrar': () => filtrarOrdenes(),
    'filtrar-rapido': () => filtrarRapido(),
    'limpiar-filtros': () => limpiarFiltros(),
    'toggle-filtros-avanzados': () => toggleFiltrosAvanzados(),
    'cambiar-orden': () => cambiarOrden(),
    'cambiar-direccion': () => cambiarDireccionOrden(),
    'filtrar-estado': () => aplicarFiltrosCombinados(),
    'filtrar-tipo': () => aplicarFiltrosCombinados(),
    'filtrar-tecnico': () => aplicarFiltrosCombinados(),
    'filtrar-mias': () => aplicarFiltrosCombinados(),
    'filtrar-estado-chip': (el) => filtrarPorChipEstado(el),
    'set-view-cards': () => setOrdersView('cards'),
    'set-view-table': () => setOrdersView('table'),
    // §4.4 Barcode scan-to-search
    'scan-serial': () => _scanSerial(),
    'toggle-fecha-entrega': () => {
      const visible = document.body?.classList.contains('hide-fecha-entrega');
      setFechaEntregaVisible(visible);
    },

    // Filter presets — ORDENES_INDEX_IMPROVEMENTS.md §5.2
    'toggle-presets-menu': () => togglePresetsMenu(),
    'guardar-preset': () => guardarPresetActual(),
    'cargar-preset': (el) => cargarPreset(el.dataset.presetId),
    'eliminar-preset': (el) => eliminarPreset(el.dataset.presetId),
    
    // Modal actions
    'cerrar-modal-asignar': () => cerrarModalAsignar(),
    'confirmar-asignar-tecnico': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) confirmarAsignarTecnico(ordenId);
    },
    'cerrar-modal-entrega': () => cerrarModalEntrega(),
    'confirmar-entrega': () => confirmarEntrega(),
    'limpiar-entrega-firma': () => limpiarEntregaFirma(),
    'entrega-no-recibido-change': () => _toggleEntregaNoRecibido(),
    'entrega-sin-id-change': () => _toggleEntregaSinId(),
    'entrega-sin-firma-change': () => _toggleEntregaSinFirma(),
    
    // Órdenes de DEVOLUCIÓN: check-in por serial (el mismo modal sirve de
    // vista de solo lectura cuando la orden está cerrada o el rol no opera).
    'checkin-devolucion': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); OrdenesDevolucion.abrir(ordenId); }
    },

    // Order actions
    'asignar-tecnico': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); abrirModalAsignarTecnico(ordenId); }
    },
    'reasignar-tecnico': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); abrirModalCambiarTecnico(ordenId); }
    },
    'completar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) completarOrden(ordenId);
    },
    'entregar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) entregarOrden(ordenId);
    },
    // Órdenes de ENTRADA (inspección de devueltos): terminal propio sin
    // entrega — las unidades quedan bajo control de inventario.
    'cerrar-entrada': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); cerrarEntrada(ordenId); }
    },
    // Control de calidad (ordenes-qc.js): checklist de jefe_taller/admin
    // sobre órdenes COMPLETADO; solo-lectura en los demás casos (p.ej.
    // técnico consultando el motivo de un rechazo desde ASIGNADO).
    'qc-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); OrdenesQC.abrir(ordenId); }
    },
    'recibir-mostrador': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); abrirModalRecepcion(ordenId); }
    },
    // Visitas técnicas (ordenes-visita.js): informe estructurado + cierre
    // en sitio con firma del personal de la empresa visitada.
    'cerrar-visita': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); abrirCierreVisita(ordenId); }
    },
    'informe-visita': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) { closeAllMenus(); abrirInformeVisita(ordenId); }
    },
    'eliminar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) eliminarOrden(ordenId);
    },
    'editar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) window.location.href = `editar-orden.html?id=${ordenId}`;
    },
    'go-fotos-taller': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        window.location.href = BASE + `fotos-taller.html?ordenId=${encodeURIComponent(ordenId)}`;
      }
    },
    
    // Equipment actions
    'agregar-equipo': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) agregarEquipo(ordenId);
    },
    'nuevo-batch': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) nuevoBatch(ordenId);
    },
    'copiar-seriales': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) copiarSeriales(ordenId);
    },
    'activar-accesorios': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) activarModoAccesorios(ordenId);
    },
    'guardar-accesorios': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) guardarAccesoriosLote(ordenId);
    },
    'toggle-order-actions': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) toggleOrderActionsMenu(ordenId);
    },
    'toggle-leyenda-accesorios': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
        if (popover) {
          popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
        }
      }
    },
    'close-popover': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
        if (popover) popover.style.display = 'none';
      }
    },
    'editar-campo-equipo': (el) => {
      const { id, campo, valor } = el.dataset;
      if (id && campo !== undefined) editarCampoEquipo(id, campo, valor || '');
    },
    'eliminar-equipo': (el, e) => {
      const id = el.dataset.id;
      if (id) eliminarEquipo(e, id);
    },
    'abrir-intervencion-desktop': (el) => {
      const { ordenId, equipoId } = el.dataset;
      if (ordenId && equipoId) abrirIntervencionEquipoDesktop(ordenId, equipoId);
    },
    'toggle-no-disponible': async (el) => {
      const { ordenId, equipoId } = el.dataset;
      const checked = !!el.checked;
      const panel = el.closest('.intervencion-hover-ctrl, .no-disponible-panel');
      const motivoInput = panel?.querySelector('.motivo-no-disponible');

      if (motivoInput) {
        motivoInput.disabled = !checked;
        if (!checked) {
          motivoInput.value = "";
        } else {
          setTimeout(() => motivoInput.focus(), 0);
        }
      }

      const motivo = checked ? (motivoInput?.value || "").trim() : "";
      if (ordenId && equipoId) await setEquipoNoDisponible({ ordenId, equipoId, noDisponible: checked, motivo });
    },
    'motivo-no-disponible': async (el) => {
      if (el.disabled) return;
      const { ordenId, equipoId } = el.dataset;
      const motivo = (el.value || "").trim();
      if (ordenId && equipoId) await setEquipoNoDisponible({ ordenId, equipoId, noDisponible: true, motivo });
    },
    
    // Mobile actions
    'mobile-scroll-top': () => mobileScrollTop(),
    'mobile-open-filters': () => openMobileFilters(),
    'mobile-close-filters': () => closeMobileFilters(),
    'mobile-clear-all': () => mobileClearAll(),
    'mobile-apply-search': () => mobileApplyQuickSearch(),
    'mobile-sync-sort': () => mobileSyncSortField(),
    'mobile-toggle-sort': () => mobileToggleSortDir(),
    'mobile-apply-advanced': () => {
      syncMobileAdvancedFiltersToDesktop();
      filtrarOrdenes();
      closeMobileFilters();
    },
    'abrir-equipos-mobile': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) abrirEquiposMobile(ordenId);
    },
    'cerrar-equipos-mobile': () => cerrarEquiposMobile(),
    'cerrar-trabajo-equipo': () => cerrarTrabajoEquipoModal(),
    'guardar-trabajo-equipo': () => guardarTrabajoEquipoModal(),
    'ver-obs-completa': (el) => {
      const ordenId = el.dataset.ordenId;
      const idx = parseInt(el.dataset.idx, 10);
      if (ordenId && !isNaN(idx)) verObsCompleta(ordenId, idx);
    },
    'abrir-trabajo-equipo': (el) => {
      const ordenId = el.dataset.ordenId;
      const idx = parseInt(el.dataset.idx, 10);
      if (ordenId && !isNaN(idx)) abrirTrabajoEquipoModal(ordenId, idx);
    },
    'ver-trabajo-equipo': (el) => {
      const ordenId = el.dataset.ordenId;
      const idx = parseInt(el.dataset.idx, 10);
      if (ordenId && !isNaN(idx)) verTrabajoEquipo(ordenId, idx);
    },
    'agregar-foto-equipo': () => agregarFotoEquipo(),
    'equipo-foto-input-change': (_el, ev) => onEquipoFotoInputChange(ev),
    'ver-foto-equipo': (el) => {
      const fotoId = el.dataset.fotoId;
      if (fotoId) verFotoEquipo(fotoId);
    },
    'cerrar-foto-equipo-viewer': () => cerrarFotoEquipoViewer(),
    'eliminar-foto-equipo-viewer': () => eliminarFotoEquipoViewer(),

    // Materiales / piezas del equipo (modal de intervención técnica)
    'abrir-material-equipo': () => abrirMaterialEquipoModal(),
    'cerrar-material-equipo': () => cerrarMaterialEquipoModal(),
    'confirmar-material-equipo': () => confirmarMaterialEquipo(),
    'pick-material-equipo': (el) => pickMaterialEquipo(el.dataset.piezaId),
    'eliminar-material-equipo': (el) => eliminarMaterialEquipo(el.dataset.lineaId),

    'close-text-modal': () => closeTextModal(),
    'copy-text-modal': () => copyTextModalContent(),

    // Overflow menu
    'toggle-overflow-menu': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) toggleOverflowMenu(ordenId);
    },
    
    // Overflow menu actions
    'generar-nota-entrega': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        generarNotaEntrega(ordenId);
        closeAllMenus();
      }
    },
    'generar-nota-entrega-intervenciones': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        generarNotaEntregaIntervenciones(ordenId);
        closeAllMenus();
      }
    },
    'imprimir-orden': (el) => {
      abrirImpresionOrden(el.dataset.ordenId);
      closeAllMenus();
    },
    // Imprimir / documentos — agrupa Imprimir orden + Nota de entrega.
    'ver-documentos': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      mostrarDocumentos(ordenId);
    },
    'cotizar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        closeAllMenus();
        window.location.href = BASE + `cotizar-orden.html?id=${ordenId}`;
      }
    },
    'gestionar-notas': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        gestionarNotasTecnicas(ordenId);
        closeAllMenus();
      }
    },
    // Ver entrega/recepción — modal combinado con las fases que existan.
    'ver-entrega': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      mostrarEntregaRecepcion(ordenId);
    },
    
    // Badge filter actions
    'filtrar-badge': (el) => {
      const estado = el.dataset.estado;
      const resumenEl = el.closest('.resumen, #mobileResumen');
      
      // Toggle active state
      const wasActive = el.classList.contains('active');
      if (resumenEl) {
        resumenEl.querySelectorAll('.badge').forEach(b => b.classList.remove('active'));
      }
      
      if (!wasActive) {
        el.classList.add('active');
        // Sync dropdown
        const sel = document.getElementById('filtroEstado');
        if (sel) sel.value = estado;
        filtrarPorEstado(estado);
      } else {
        // Toggle off - show all
        const sel = document.getElementById('filtroEstado');
        if (sel) sel.value = '';
        limpiarFiltros();
      }
    }
  };
  
  /**
   * Handle click events with action delegation
   * @param {Event} e - Click event
   */
  function handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    // Handle backdrop clicks (only if clicking exactly on the backdrop, not children)
    if (target.dataset.backdrop === 'true' && e.target !== target) {
      return;
    }

    if (target.tagName === 'SELECT' && (target.dataset.action === 'filtrar-estado' || target.dataset.action === 'filtrar-tipo')) {
      return;
    }
    
    const action = target.dataset.action;
    const handler = ACTION_HANDLERS[action];
    
    if (handler) {
      // Stop propagation if requested
      if (target.dataset.stopPropagation === 'true') {
        e.stopPropagation();
      }
      
      // Prevent default if requested
      if (target.dataset.preventDefault === 'true') {
        e.preventDefault();
      }
      
      // Execute handler
      handler(target, e);
    } else {
      console.warn(`[Event Delegation] No handler found for action: ${action}`);
    }
  }
  
  /**
   * Handle change events with action delegation
   * @param {Event} e - Change event
   */
  function handleChange(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    
    const action = target.dataset.action;
    const handler = ACTION_HANDLERS[action];
    
    if (handler) {
      handler(target, e);
    }
  }
  
  // Attach event listeners to document
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);

  console.log('✅ Event delegation system initialized');
})();

/* ========================================
   Abrir la vista (read-only) de la orden — reutilizada por la acción
   'imprimir-orden' y por el botón "Ver orden" del modal de entrega.
   Apunta a imprimir-orden.html.
   ======================================== */
function abrirImpresionOrden(ordenId) {
  if (!ordenId) return;
  const orden = (window.APP?.state?.orders || []).find(o => o.ordenId === ordenId);
  if (orden) {
    localStorage.setItem('imprimirOrdenData', JSON.stringify({
      ordenId: orden.ordenId,
      tipo_de_servicio: orden.tipo_de_servicio || '',
      tecnico_asignado: orden.tecnico_asignado || '',
      estado_reparacion: orden.estado_reparacion || '',
      observaciones: orden.observaciones || '',
      cliente: (typeof nombreClienteDe === 'function' ? nombreClienteDe(orden) : (orden.cliente_nombre || '')),
      fecha_creacion: orden.fecha_creacion?.toDate?.()?.toISOString?.() ?? null,
      fecha_entrega: orden.fecha_entrega?.toDate?.()?.toISOString?.() ?? null,
      // Visita técnica: sitio + informe estructurado viajan al print
      // (updated_at es Timestamp y no se necesita en papel, se omite).
      visita: orden.visita ? {
        sitio: orden.visita.sitio || '',
        contacto_sitio: orden.visita.contacto_sitio || ''
      } : null,
      informe_visita: orden.informe_visita ? {
        fecha_visita: orden.informe_visita.fecha_visita || null,
        motivo: orden.informe_visita.motivo || '',
        trabajo_realizado: orden.informe_visita.trabajo_realizado || '',
        hallazgos: orden.informe_visita.hallazgos || '',
        elementos: (orden.informe_visita.elementos || []).map(el => ({
          tipo: el.tipo || '', detalle: el.detalle || '', serial: el.serial || ''
        }))
      } : null,
      equipos: (orden.equipos || []).filter(e => !e.eliminado).map(e => ({
        numero_de_serie: e.numero_de_serie || '',
        modelo: e.modelo || '',
        bateria: !!e.bateria,
        clip: !!e.clip,
        cargador: !!e.cargador,
        fuente: !!e.fuente,
        antena: !!e.antena,
        cubrepolvo: !!e.cubrepolvo,
        observaciones: e.observaciones || ''
      }))
    }));
  }
  window.open(BASE + `imprimir-orden.html?id=${ordenId}`, '_blank');
}
window.abrirImpresionOrden = abrirImpresionOrden;

// Selector de documentos — agrupa las acciones de impresión en una sola
// entrada del menú: imprimir la orden y generar la nota de entrega.
function mostrarDocumentos(ordenId) {
  const esc = _entregaEsc;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title"><i data-lucide="printer"></i> Documentos — Orden ${esc(ordenId)}</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:14px 10px;display:flex;flex-direction:column;gap:8px;">
        <button class="btn" data-doc="orden" style="justify-content:flex-start;"><i data-lucide="file-text"></i> Imprimir orden</button>
        <button class="btn" data-doc="nota" style="justify-content:flex-start;"><i data-lucide="clipboard-list"></i> Nota de entrega</button>
      </div>
    </div>`;
  const cleanup = () => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }
    const doc = e.target.closest('[data-doc]')?.dataset.doc;
    if (doc === 'orden') { abrirImpresionOrden(ordenId); cleanup(); }
    else if (doc === 'nota') {
      if (typeof generarNotaEntregaIntervenciones === 'function') generarNotaEntregaIntervenciones(ordenId);
      cleanup();
    }
  });
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.mostrarDocumentos = mostrarDocumentos;

/* ========================================
   Ver entrega — modal con receptor + firma (todos) e identificación (admin)
   ======================================== */
function _entregaEsc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _entregaFecha(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d)) return null;
    return d.toLocaleString('es-PA', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return null; }
}

// Lightbox de imagen — overlay dinámico, cierra con backdrop/Escape/✕.
function _entregaLightbox(url, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '10000';
  overlay.innerHTML = `
    <div class="modal" style="max-width:90vw;max-height:90vh;padding:8px;">
      <div style="display:flex;justify-content:flex-end;">
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <img src="${_entregaEsc(url)}" alt="${_entregaEsc(alt || 'Imagen')}"
           style="max-width:86vw;max-height:78vh;object-fit:contain;display:block;border-radius:6px;">
    </div>`;
  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
  });
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
}

// Modal combinado "Ver entrega/recepción" — una sola vista con las fases que
// existan: Recepción en mostrador (acuse de ingreso) y Entrega al cliente.
// Cada fase muestra quién/cuándo + su firma; los equipos (serial/modelo/
// accesorios) se listan una vez; la cédula (admin) tiene botón interno. Abajo,
// botones para imprimir el comprobante de entrega y/o el acuse de recepción.
function _faseFilas(pares) {
  return pares
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<div style="display:flex;gap:8px;padding:3px 0;"><span class="muted" style="min-width:170px;">${k}</span><strong>${v}</strong></div>`)
    .join('');
}
function _faseFirma(url, cap) {
  return url
    ? `<div style="margin-top:8px;"><div class="muted" style="margin-bottom:4px;">${cap}</div>
         <img src="${_entregaEsc(url)}" alt="${_entregaEsc(cap)}" style="max-width:240px;border:1px solid var(--line,#e5e7eb);border-radius:8px;background:#fff;display:block;"></div>`
    : '';
}

function mostrarEntregaRecepcion(ordenId) {
  const o = (window.APP?.state?.orders || []).find(x => x.ordenId === ordenId) || {};
  const esc = _entregaEsc;
  const esAdmin = (window.APP?.state?.userRole) === (window.ROLES ? ROLES.ADMIN : 'administrador');
  const cliente = (typeof nombreClienteDe === 'function' ? nombreClienteDe(o) : (o.cliente_nombre || '—'));

  const tieneRecepcion = !!(o.firma_recepcion_url || o.receptor_recepcion_nombre || o.fecha_recepcion);
  const tieneEntrega   = !!(o.firma_url || o.receptor_nombre || o.fecha_entrega || o.sin_id || o.identificacion_path || o.identificacion_url);
  // Cierre de visita técnica (firma en sitio o motivo) — ordenes-visita.js.
  const tieneCierreVisita = !!(o.firma_visita_url || o.visita_sin_firma || o.fecha_cierre_visita);

  const cabecera = _faseFilas([
    ['Orden', esc(ordenId)],
    ['Cliente', esc(cliente)],
    ['Tipo de servicio', esc(o.tipo_de_servicio || '—')],
    ['Sitio', esc(o.visita?.sitio || '')],
  ]);

  const faseCard = (titulo, icon, inner) => `
    <div style="margin-top:14px;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px;">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:6px;"><i data-lucide="${icon}"></i> ${titulo}</div>
      ${inner}
    </div>`;

  const recFirmaHtml = o.recepcion_sin_firma
    ? `<div class="muted" style="margin-top:8px;"><i data-lucide="pen-off"></i> Equipos recibidos sin firma${o.recepcion_sin_firma_motivo ? ' — ' + esc(o.recepcion_sin_firma_motivo) : ''}.</div>`
    : _faseFirma(o.firma_recepcion_url, 'Firma de quien entrega');
  const recepcionHtml = tieneRecepcion ? faseCard('Recepción en mostrador', 'package-plus',
    _faseFilas([
      ['Entregado por (cliente)', esc(o.receptor_recepcion_nombre || '—')],
      ['Recibido por (Cecomunica)', esc(o.recepcion_por_email || '—')],
      ['Fecha y hora', esc(_entregaFecha(o.fecha_recepcion) || '—')],
    ]) + recFirmaHtml
  ) : '';

  // Cédula (solo admin) dentro de la fase de entrega.
  let idHtml = '';
  if (esAdmin && tieneEntrega) {
    if (o.sin_id) {
      idHtml = `<div class="muted" style="margin-top:8px;"><i data-lucide="badge-alert"></i> Cliente no presentó identificación${o.sin_id_motivo ? ' — ' + esc(o.sin_id_motivo) : ''}.</div>`;
    } else if (o.identificacion_purged_at) {
      idHtml = `<div class="muted" style="margin-top:8px;"><i data-lucide="trash-2"></i> Foto de identificación purgada por retención.</div>`;
    } else if (o.identificacion_path || o.identificacion_url) {
      idHtml = `<div style="margin-top:8px;"><button class="btn btn-sm" data-ver-id="1"><i data-lucide="id-card"></i> Ver identificación</button>
          <span class="muted" style="margin-left:6px;font-size:12px;">enlace temporal</span></div>`;
    }
  }

  const entregaHtml = tieneEntrega ? faseCard('Entrega al cliente', 'package-check',
    _faseFilas([
      ['Recibido por', esc(o.receptor_nombre || '—')],
      ['Fecha y hora', esc(_entregaFecha(o.fecha_entrega) || '—')],
    ]) + _faseFirma(o.firma_url, 'Firma del receptor') + idHtml
  ) : '';

  // Cierre de visita técnica: quién recibió conforme en el sitio (o el
  // motivo si se cerró sin firma) + resumen del informe de visita.
  const inf = o.informe_visita || {};
  const cierreFirmaHtml = o.visita_sin_firma
    ? `<div class="muted" style="margin-top:8px;"><i data-lucide="pen-off"></i> Visita cerrada sin firma${o.visita_sin_firma_motivo ? ' — ' + esc(o.visita_sin_firma_motivo) : ''}.</div>`
    : _faseFirma(o.firma_visita_url, 'Firma de conformidad');
  const cierreInformeHtml = (inf.trabajo_realizado || inf.fecha_visita)
    ? `<div style="margin-top:10px;border-top:1px dashed var(--line,#e5e7eb);padding-top:8px;">
         ${_faseFilas([
           ['Fecha de la visita', esc(inf.fecha_visita || '—')],
           ['Motivo', esc(inf.motivo || '—')],
           ['Elementos', (Array.isArray(inf.elementos) && inf.elementos.length)
             ? esc(inf.elementos.map(el => [el.tipo, el.detalle].filter(Boolean).join(' ')).join(' · '))
             : ''],
         ])}
         <div class="muted" style="margin-top:4px;">Trabajo realizado</div>
         <div style="white-space:pre-wrap;">${esc(inf.trabajo_realizado || '—')}</div>
         ${inf.hallazgos ? `<div class="muted" style="margin-top:6px;">Hallazgos / recomendaciones</div><div style="white-space:pre-wrap;">${esc(inf.hallazgos)}</div>` : ''}
       </div>`
    : '';
  const cierreHtml = tieneCierreVisita ? faseCard('Cierre de visita', 'pen-line',
    _faseFilas([
      ['Recibió conforme', esc(o.firma_visita_receptor || '—')],
      ['Cargo / área', esc(o.firma_visita_cargo || '')],
      ['Fecha y hora', esc(_entregaFecha(o.fecha_cierre_visita) || '—')],
      ['Cerrada por', esc(o.completado_por_email || '—')],
    ]) + cierreFirmaHtml + cierreInformeHtml
  ) : '';

  // Equipos una sola vez (serial/modelo/accesorios).
  const eqs = _equiposEntregaRows(o);
  const equiposRows = eqs.map(e => `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid var(--line,#eee);font-family:monospace;font-size:12px;">${esc(e.serial)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid var(--line,#eee);">${esc(e.modelo)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid var(--line,#eee);">${esc(e.accesorios)}</td>
    </tr>`).join('');
  const equiposHtml = eqs.length
    ? `<div style="margin-top:14px;">
         <div class="muted" style="margin-bottom:4px;">Equipos (${eqs.length})</div>
         <table width="100%" style="border-collapse:collapse;font-size:13px;">
           <tr style="text-align:left;">
             <td style="padding:5px 8px;border-bottom:2px solid var(--line,#e5e7eb);font-weight:600;">Serial</td>
             <td style="padding:5px 8px;border-bottom:2px solid var(--line,#e5e7eb);font-weight:600;">Modelo</td>
             <td style="padding:5px 8px;border-bottom:2px solid var(--line,#e5e7eb);font-weight:600;">Accesorios</td>
           </tr>${equiposRows}
         </table>
       </div>`
    : '';

  const titulo = tieneCierreVisita ? 'Cierre de visita' : (tieneEntrega ? 'Entrega' : 'Recepción');
  const footerBtns = [
    tieneEntrega   ? `<button class="btn btn-primary" data-ver-comprobante="1"><i data-lucide="printer"></i> Imprimir entrega</button>` : '',
    tieneRecepcion ? `<button class="btn" data-ver-acuse="1"><i data-lucide="printer"></i> Imprimir acuse</button>` : '',
  ].filter(Boolean).join('');

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title"><i data-lucide="package-check"></i> ${titulo} — Orden ${esc(ordenId)}</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:12px 8px;max-height:70vh;overflow:auto;">
        ${cabecera}
        ${recepcionHtml}
        ${entregaHtml}
        ${cierreHtml}
        ${equiposHtml}
      </div>
      <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 8px;border-top:1px solid var(--line,#eee);">
        ${footerBtns}
      </div>
    </div>`;

  const cleanup = () => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }
    if (e.target.closest('[data-ver-comprobante]')) { verEntregaComprobante(ordenId); return; }
    if (e.target.closest('[data-ver-acuse]')) { verRecepcionComprobante(ordenId); return; }
    const verBtn = e.target.closest('[data-ver-id]');
    if (verBtn) {
      verBtn.disabled = true;
      const prev = verBtn.innerHTML;
      verBtn.innerHTML = 'Cargando…';
      try { await verIdentificacionAdmin(ordenId); }
      finally {
        verBtn.disabled = false;
        verBtn.innerHTML = prev;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  });
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
window.mostrarEntregaRecepcion = mostrarEntregaRecepcion;

// "Ver entrega" → documento imprimible (comprobante de entrega): muestra qué
// se entregó y a quién (receptor, fecha, firma). Se abre en ventana nueva,
// autocontenido (CSS inline) y listo para imprimir. No incluye la cédula: es
// PII interna, se ve aparte con "Ver identificación" (admin).
function verEntregaComprobante(ordenId) {
  const o = (window.APP?.state?.orders || []).find(x => x.ordenId === ordenId) || {};
  const esc = _entregaEsc;
  const cliente = (typeof nombreClienteDe === 'function' ? nombreClienteDe(o) : (o.cliente_nombre || '—'));
  const fecha = _entregaFecha(o.fecha_entrega) || '—';

  // Mismas columnas que la hoja que firma el cliente: serial, modelo y
  // accesorios entregados. El nombre y la intervención NO van en la hoja de
  // firma, por eso tampoco aquí.
  const equipos = (Array.isArray(o.equipos) ? o.equipos : []).filter(e => !e.eliminado);
  const equiposRows = equipos.map((e, i) => {
    const serial = e.numero_de_serie || e.SERIAL || e.serial || '';
    const accs = [];
    if (e.bateria)  accs.push('Batería');
    if (e.clip)     accs.push('Clip');
    if (e.cargador) accs.push('Cargador');
    if (e.fuente)   accs.push('Fuente');
    if (e.antena)   accs.push('Antena');
    if (e.cubrepolvo) accs.push('Cubre Polvo');
    return `<tr>
        <td class="c-num">${i + 1}</td>
        <td class="c-mono">${esc(serial || '—')}</td>
        <td>${esc(e.modelo || '—')}</td>
        <td>${accs.length ? esc(accs.join(', ')) : '—'}</td>
      </tr>`;
  }).join('');

  // La nota de identificación solo afirma "Verificada" si realmente hubo foto;
  // si el cliente no presentó ID se indica; si no hay dato, se omite.
  const idNota = o.sin_id
    ? `<p class="nota"><strong>Identificación:</strong> Cliente no presentó identificación${o.sin_id_motivo ? ' — ' + esc(o.sin_id_motivo) : ''}.</p>`
    : (o.identificacion_path || o.identificacion_url)
      ? `<p class="nota"><strong>Identificación:</strong> Verificada al momento de la entrega.</p>`
      : '';

  const firmaBlock = o.firma_url
    ? `<img src="${esc(o.firma_url)}" alt="Firma del receptor" class="firma-img">`
    : `<div class="firma-line"></div>`;

  const logo = `${location.origin}/logo_cecomunica.png`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Comprobante de Entrega — Orden ${esc(ordenId)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#111827; margin:0; padding:32px; max-width:780px; }
  .head { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #0091D7; padding-bottom:12px; margin-bottom:18px; }
  .head img { height:42px; }
  .head h1 { font-size:18px; margin:0; color:#0091D7; text-align:right; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin-bottom:18px; font-size:14px; }
  .meta div { padding:4px 0; border-bottom:1px solid #eee; }
  .meta .k { color:#6b7280; }
  h2 { font-size:14px; margin:18px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
  th { background:#f3f4f6; border-bottom:2px solid #d1d5db; }
  .c-num { width:28px; color:#6b7280; }
  .c-mono { font-family:monospace; font-size:12px; }
  .nota { font-size:13px; margin:14px 0 0; }
  .firma-wrap { margin-top:28px; }
  .firma-img { max-width:280px; max-height:130px; display:block; border:1px solid #e5e7eb; border-radius:6px; background:#fff; }
  .firma-line { width:280px; border-bottom:1px solid #111; height:60px; }
  .firma-cap { font-size:12px; color:#6b7280; margin-top:4px; }
  .toolbar { margin-bottom:18px; }
  .toolbar button { background:#0091D7; color:#fff; border:0; padding:8px 16px; border-radius:6px; font:600 13px Arial; cursor:pointer; }
  .foot { margin-top:32px; font-size:11px; color:#9ca3af; text-align:center; border-top:1px solid #eee; padding-top:8px; }
  @media print { .toolbar { display:none; } body { padding:0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ Imprimir</button></div>
  <div class="head">
    <img src="${esc(logo)}" alt="Cecomunica" onerror="this.style.display='none'">
    <h1>Comprobante de Entrega</h1>
  </div>
  <div class="meta">
    <div><span class="k">Orden:</span> <strong>${esc(ordenId)}</strong></div>
    <div><span class="k">Fecha y hora de entrega:</span> <strong>${esc(fecha)}</strong></div>
    <div><span class="k">Cliente:</span> <strong>${esc(cliente)}</strong></div>
    <div><span class="k">Tipo de servicio:</span> <strong>${esc(o.tipo_de_servicio || '—')}</strong></div>
    <div><span class="k">Recibido por:</span> <strong>${esc(o.receptor_nombre || '—')}</strong></div>
    <div><span class="k">Técnico:</span> <strong>${esc(o.tecnico_asignado || '—')}</strong></div>
  </div>

  <h2>Equipos entregados (${equipos.length})</h2>
  ${equipos.length
    ? `<table><thead><tr><th class="c-num">#</th><th>Serial</th><th>Modelo</th><th>Accesorios</th></tr></thead><tbody>${equiposRows}</tbody></table>`
    : `<p class="nota">Sin equipos registrados en la orden.</p>`}

  ${idNota}

  <div class="firma-wrap">
    <div class="firma-cap">Firma del receptor:</div>
    ${firmaBlock}
    <div class="firma-cap">${esc(o.receptor_nombre || '')}</div>
  </div>

  <div class="foot">Cecomunica, S.A. — Documento generado el ${esc(new Date().toLocaleString('es-PA'))}</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { Toast.show('Permite las ventanas emergentes para ver el comprobante', 'warn'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
window.verEntregaComprobante = verEntregaComprobante;

// "Ver identificación" (admin) → signed URL temporal en lightbox.
async function verIdentificacionAdmin(ordenId, btnEl) {
  try {
    if (typeof Toast !== 'undefined') Toast.show('Obteniendo identificación…', 'info');
    const fn = firebase.functions().httpsCallable('getIdentificacionUrl');
    const { data } = await fn({ ordenId });
    if (data.status === 'ok' && data.url) {
      _entregaLightbox(data.url, 'Identificación del receptor');
    } else if (data.status === 'sin_id') {
      Toast.show('El cliente no presentó identificación' + (data.motivo ? `: ${data.motivo}` : ''), 'warn');
    } else if (data.status === 'purged') {
      Toast.show('La foto fue purgada por política de retención', 'warn');
    } else {
      Toast.show('No hay foto de identificación para esta orden', 'warn');
    }
  } catch (err) {
    console.error('[verIdentificacionAdmin] getIdentificacionUrl', err);
    Toast.show('No se pudo obtener la identificación: ' + (err.message || err.code || 'error'), 'bad');
  }
}
window.verIdentificacionAdmin = verIdentificacionAdmin;

// Filas de equipos (serial/modelo/accesorios) compartidas por los modales y
// comprobantes de entrega/recepción — coinciden con la hoja que se firma.
function _equiposEntregaRows(o) {
  const esc = _entregaEsc;
  return (Array.isArray(o.equipos) ? o.equipos : []).filter(e => !e.eliminado).map(e => {
    const serial = e.numero_de_serie || e.SERIAL || e.serial || '';
    const accs = [];
    if (e.bateria)  accs.push('Batería');
    if (e.clip)     accs.push('Clip');
    if (e.cargador) accs.push('Cargador');
    if (e.fuente)   accs.push('Fuente');
    if (e.antena)   accs.push('Antena');
    if (e.cubrepolvo) accs.push('Cubre Polvo');
    return { serial: serial || '—', modelo: e.modelo || '—', accesorios: accs.length ? accs.join(', ') : '—' };
  });
}

// Acuse de recepción imprimible (documento de ingreso en mostrador).
function verRecepcionComprobante(ordenId) {
  const o = (window.APP?.state?.orders || []).find(x => x.ordenId === ordenId) || {};
  const esc = _entregaEsc;
  const cliente = (typeof nombreClienteDe === 'function' ? nombreClienteDe(o) : (o.cliente_nombre || '—'));
  const fecha = _entregaFecha(o.fecha_recepcion) || '—';
  const eqs = _equiposEntregaRows(o);
  const equiposRows = eqs.map((e, i) => `<tr>
      <td class="c-num">${i + 1}</td>
      <td class="c-mono">${esc(e.serial)}</td>
      <td>${esc(e.modelo)}</td>
      <td>${esc(e.accesorios)}</td>
    </tr>`).join('');
  const firmaBlock = o.recepcion_sin_firma
    ? `<div style="font-size:13px;">Equipos recibidos <strong>sin firma</strong>${o.recepcion_sin_firma_motivo ? ' — ' + esc(o.recepcion_sin_firma_motivo) : ''}.</div>`
    : (o.firma_recepcion_url
        ? `<img src="${esc(o.firma_recepcion_url)}" alt="Firma de recepción" class="firma-img">`
        : `<div class="firma-line"></div>`);
  const logo = `${location.origin}/logo_cecomunica.png`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Acuse de Recepción — Orden ${esc(ordenId)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#111827; margin:0; padding:32px; max-width:780px; }
  .head { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #0091D7; padding-bottom:12px; margin-bottom:18px; }
  .head img { height:42px; }
  .head h1 { font-size:18px; margin:0; color:#0091D7; text-align:right; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin-bottom:18px; font-size:14px; }
  .meta div { padding:4px 0; border-bottom:1px solid #eee; }
  .meta .k { color:#6b7280; }
  h2 { font-size:14px; margin:18px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #e5e7eb; }
  th { background:#f3f4f6; border-bottom:2px solid #d1d5db; }
  .c-num { width:28px; color:#6b7280; }
  .c-mono { font-family:monospace; font-size:12px; }
  .firma-wrap { margin-top:28px; }
  .firma-img { max-width:280px; max-height:130px; display:block; border:1px solid #e5e7eb; border-radius:6px; background:#fff; }
  .firma-line { width:280px; border-bottom:1px solid #111; height:60px; }
  .firma-cap { font-size:12px; color:#6b7280; margin-top:4px; }
  .toolbar { margin-bottom:18px; }
  .toolbar button { background:#0091D7; color:#fff; border:0; padding:8px 16px; border-radius:6px; font:600 13px Arial; cursor:pointer; }
  .foot { margin-top:32px; font-size:11px; color:#9ca3af; text-align:center; border-top:1px solid #eee; padding-top:8px; }
  @media print { .toolbar { display:none; } body { padding:0; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨️ Imprimir</button></div>
  <div class="head">
    <img src="${esc(logo)}" alt="Cecomunica" onerror="this.style.display='none'">
    <h1>Acuse de Recepción en Mostrador</h1>
  </div>
  <div class="meta">
    <div><span class="k">Orden:</span> <strong>${esc(ordenId)}</strong></div>
    <div><span class="k">Fecha y hora de recepción:</span> <strong>${esc(fecha)}</strong></div>
    <div><span class="k">Cliente:</span> <strong>${esc(cliente)}</strong></div>
    <div><span class="k">Tipo de servicio:</span> <strong>${esc(o.tipo_de_servicio || '—')}</strong></div>
    <div><span class="k">Entregado por (cliente):</span> <strong>${esc(o.receptor_recepcion_nombre || '—')}</strong></div>
    <div><span class="k">Recibido por (Cecomunica):</span> <strong>${esc(o.recepcion_por_email || '—')}</strong></div>
  </div>

  <h2>Equipos recibidos (${eqs.length})</h2>
  ${eqs.length
    ? `<table><thead><tr><th class="c-num">#</th><th>Serial</th><th>Modelo</th><th>Accesorios</th></tr></thead><tbody>${equiposRows}</tbody></table>`
    : `<p>Sin equipos registrados en la orden.</p>`}

  <div class="firma-wrap">
    <div class="firma-cap">Firma de quien entrega:</div>
    ${firmaBlock}
    <div class="firma-cap">${esc(o.receptor_recepcion_nombre || '')}</div>
  </div>

  <div class="foot">Cecomunica, S.A. — Documento generado el ${esc(new Date().toLocaleString('es-PA'))}</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { Toast.show('Permite las ventanas emergentes para ver el acuse', 'warn'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
window.verRecepcionComprobante = verRecepcionComprobante;

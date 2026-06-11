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
    
    // Order actions
    'asignar-tecnico': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) abrirModalAsignarTecnico(ordenId);
    },
    'completar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) completarOrden(ordenId);
    },
    'entregar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) entregarOrden(ordenId);
    },
    'recibir-mostrador': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) abrirModalRecepcion(ordenId);
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
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      const orden = APP.state.orders.find(o => o.ordenId === ordenId);
      if (orden) {
        localStorage.setItem('imprimirOrdenData', JSON.stringify({
          ordenId: orden.ordenId,
          tipo_de_servicio: orden.tipo_de_servicio || '',
          tecnico_asignado: orden.tecnico_asignado || '',
          estado_reparacion: orden.estado_reparacion || '',
          observaciones: orden.observaciones || '',
          cliente: nombreClienteDe(orden),
          fecha_creacion: orden.fecha_creacion?.toDate?.()?.toISOString?.() ?? null,
          fecha_entrega: orden.fecha_entrega?.toDate?.()?.toISOString?.() ?? null,
          equipos: (orden.equipos || []).filter(e => !e.eliminado).map(e => ({
            numero_de_serie: e.numero_de_serie || '',
            modelo: e.modelo || '',
            bateria: !!e.bateria,
            clip: !!e.clip,
            cargador: !!e.cargador,
            fuente: !!e.fuente,
            antena: !!e.antena,
            observaciones: e.observaciones || ''
          }))
        }));
      }
      window.open(BASE + `imprimir-orden.html?id=${ordenId}`, '_blank');
      closeAllMenus();
    },
    'gestionar-trabajo': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        window.location.href = BASE + `trabajar-orden.html?id=${ordenId}`;
      }
    },
    'gestionar-notas': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) {
        gestionarNotasTecnicas(ordenId);
        closeAllMenus();
      }
    },
    // Ver entrega — receptor + firma (todos) e identificación (solo admin).
    'ver-entrega': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      mostrarEntrega(ordenId);
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
    return d.toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' });
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

function mostrarEntrega(ordenId) {
  const o = (window.APP?.state?.orders || []).find(x => x.ordenId === ordenId) || {};
  const esc = _entregaEsc;
  const esAdmin = (window.APP?.state?.userRole) === (window.ROLES ? ROLES.ADMIN : 'administrador');
  const fecha = _entregaFecha(o.fecha_entrega);

  const filas = [];
  if (o.receptor_nombre) filas.push(['Recibido por', esc(o.receptor_nombre)]);
  if (fecha)             filas.push(['Fecha de entrega', esc(fecha)]);
  const filasHtml = filas.map(([k, v]) =>
    `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--line,#eee);"><span class="muted" style="min-width:140px;">${k}</span><strong>${v}</strong></div>`
  ).join('');

  const firmaHtml = o.firma_url
    ? `<div style="margin-top:12px;">
         <div class="muted" style="margin-bottom:4px;">Firma del receptor</div>
         <img src="${esc(o.firma_url)}" alt="Firma del receptor"
              style="max-width:280px;border:1px solid var(--line,#e5e7eb);border-radius:8px;background:#fff;display:block;">
       </div>`
    : `<div class="muted" style="margin-top:12px;">Sin firma registrada.</div>`;

  let idHtml = '';
  if (esAdmin) {
    if (o.sin_id) {
      idHtml = `<div class="muted" style="margin-top:12px;"><i data-lucide="badge-alert"></i> Cliente no presentó identificación${o.sin_id_motivo ? ' — ' + esc(o.sin_id_motivo) : ''}.</div>`;
    } else if (o.identificacion_purged_at) {
      idHtml = `<div class="muted" style="margin-top:12px;"><i data-lucide="trash-2"></i> Foto de identificación purgada por política de retención.</div>`;
    } else if (o.identificacion_path || o.identificacion_url) {
      idHtml = `<div style="margin-top:12px;">
          <button class="btn" data-ver-id="1"><i data-lucide="id-card"></i> Ver identificación</button>
          <span class="muted" style="margin-left:8px;font-size:12px;">Solo administradores · enlace temporal</span>
        </div>`;
    } else {
      idHtml = `<div class="muted" style="margin-top:12px;"><i data-lucide="image-off"></i> Sin foto de identificación registrada.</div>`;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title"><i data-lucide="package-check"></i> Entrega — Orden ${esc(ordenId)}</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:12px 8px;">
        ${filasHtml || '<div class="muted">Sin datos de receptor.</div>'}
        ${firmaHtml}
        ${idHtml}
      </div>
    </div>`;

  const cleanup = () => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }
    const verBtn = e.target.closest('[data-ver-id]');
    if (verBtn) {
      verBtn.disabled = true;
      const prev = verBtn.innerHTML;
      verBtn.innerHTML = 'Cargando…';
      try {
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
        console.error('[mostrarEntrega] getIdentificacionUrl', err);
        Toast.show('No se pudo obtener la identificación: ' + (err.message || err.code || 'error'), 'bad');
      } finally {
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
window.mostrarEntrega = mostrarEntrega;

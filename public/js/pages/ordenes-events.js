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
  // Acciones de negocio que cuentan en uso_diario (admin/uso.html). Lista
  // cerrada a propósito: lo demás (filtros, ordenar, cerrar modales, móvil)
  // es ruido que taparía lo que importa.
  const USO_ACCIONES = new Set([
    'go-nueva-orden', 'nuevo-batch', 'nueva-devolucion', 'checkin-devolucion', 'recibir-mostrador',
    'asignar-tecnico', 'reasignar-tecnico', 'completar-orden', 'entregar-orden', 'entregar-parcial',
    'cerrar-entrada', 'qc-orden', 'cerrar-visita', 'informe-visita', 'eliminar-orden', 'dividir-orden',
    'casos-viejos', 'regularizar-reemplazo', 'entrega-tardia', 'devolver-bodega', 'proponer-reemplazo', 'marcar-cambio-serial',
    'editar-orden', 'resolver-contrato-anulado', 'go-fotos-taller', 'agregar-equipo', 'venta-facturada',
    'imprimir-orden', 'imprimir-orden-doc', 'nota-entrega-doc', 'ver-documentos', 'ver-cotizacion',
    'cotizar-orden', 'gestionar-notas', 'seguimiento-retiro', 'ver-entrega', 'subir-nota-firmada', 'scan-serial', 'copiar-seriales',
    'abrir-trabajo-equipo', 'abrir-intervencion-desktop', 'ver-trabajo-equipo', 'ver-intervencion-equipo',
    'agregar-foto-equipo', 'abrir-material-equipo',
    'filtrar-mias', 'filtrar-estado-chip', 'abrir-chip-cerradas', 'set-view-cards', 'set-view-table', 'ver-ficha',
  ]);
  const ACTION_HANDLERS = {
    // La nota impresa que el cliente firmó, subida DESPUÉS de la entrega
    // (auditoría 2026-09-17): en el mostrador con cola no siempre se alcanza a
    // escanear, así que la orden la sigue pidiendo en su línea de tiempo y se
    // sube desde ahí. Misma ruta y mismas reglas que la del modal de entrega.
    'subir-nota-firmada': (el) => {
      const ordenId = el.dataset.orden;
      if (!ordenId) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,application/pdf';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        el.disabled = true; el.textContent = 'Subiendo…';
        try {
          if (window.CargaDiferida?.storage) await CargaDiferida.storage();
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
          const path = `ordenes_notas_firmadas/${ordenId}_nota_${Date.now()}.${ext}`;
          const ref = firebase.storage().ref(path);
          await ref.put(file, { contentType: file.type || 'image/jpeg' });
          await OrdenesService.mergeOrder(ordenId, {
            nota_firmada_url: await ref.getDownloadURL(),
            nota_firmada_path: path,
            nota_firmada_at: firebase.firestore.FieldValue.serverTimestamp(),
          });
          Toast.show('Nota firmada guardada en la orden.', 'ok');
          el.textContent = 'Nota guardada';
          if (typeof window.cargarOrdenesYEquipos === 'function') window.cargarOrdenesYEquipos(true);
        } catch (err) {
          console.error('[subir-nota-firmada]', err);
          Toast.show('No se pudo subir la nota: ' + err.message, 'bad');
          el.disabled = false; el.textContent = 'Subir la nota';
        }
      };
      input.click();
    },

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
    'go-descartados': () => window.location.href = '../inventario/descartados.html',
    'go-condiciones': () => window.location.href = '../inventario/condiciones.html',
    'go-menu-principal': () => window.location.href = '../index.html',
    'logout': () => cerrarSesion(),
    'toggle-topbar-menu': () => toggleTopbarMenu(),

    // Filter actions
    'filtrar': () => filtrarOrdenes(),
    'filtrar-rapido': () => filtrarRapido(),
    'limpiar-filtros': () => limpiarFiltros(),
    'toggle-filtros-avanzados': () => toggleFiltrosAvanzados(),
    'cambiar-orden': () => cambiarOrden(),
    'cambiar-direccion': () => cambiarDireccionOrden(),
    'sort-col': (el) => sortColumna(el),
    'filtrar-estado': () => aplicarFiltrosCombinados(),
    'filtrar-tipo': () => aplicarFiltrosCombinados(),
    'filtrar-tecnico': () => aplicarFiltrosCombinados(),
    // Ficha lateral de la orden (2026-10-09): número de la fila / tarjeta.
    'ver-ficha': (el) => { if (window.OrdenesFicha) OrdenesFicha.abrir(el.dataset.ordenId); },
    'filtrar-mias': () => aplicarFiltrosCombinados(),
    // Desde/Hasta (auditoría UX 2026-09-28, T6): re-consulta al servidor.
    'filtrar-fechas': () => filtrarPorFechas(),
    'filtrar-estado-chip': (el) => filtrarPorChipEstado(el),
    // Chip "Cerradas": un solo chip con menú para los 6 estados terminales.
    'abrir-chip-cerradas': (el) => abrirChipCerradas(el),
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
    // El módulo (22 KB gz + firmaPad + storage) se carga al PRIMER uso
    // (auditoría P3.15) — CargaDiferida cachea, el segundo click es directo.
    'checkin-devolucion': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.devolucion().then(() => OrdenesDevolucion.abrir(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir el check-in.', 'bad'));
    },
    // Devolución de equipos con contrato de papel (fuera del sistema):
    // crea la orden en modo sin_contrato y abre el check-in de captura libre.
    'venta-facturada': () => {
      CargaDiferida.ventaFacturada().then(() => VentaFacturada.abrir({ user: firebase.auth().currentUser }))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la venta facturada.', 'bad'));
    },
    'nueva-devolucion': () => {
      CargaDiferida.devolucion().then(() => OrdenesDevolucion.nueva())
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la devolución.', 'bad'));
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
    // Visitas técnicas (ordenes-visita.js, diferido — P3.15): informe
    // estructurado + cierre en sitio con firma del personal visitado.
    'cerrar-visita': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.visita().then(() => abrirCierreVisita(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir el cierre.', 'bad'));
    },
    'informe-visita': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.visita().then(() => abrirInformeVisita(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir el informe.', 'bad'));
    },
    'eliminar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) eliminarOrden(ordenId);
    },
    // Dividir una ENTRADA entre varias órdenes (ordenes-dividir.js, diferido).
    'dividir-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.dividir().then(() => abrirDividirOrden(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir el reparto.', 'bad'));
    },
    // Entrega parcial: el cliente se lleva una tanda y la orden sigue abierta
    // (ordenes-entrega-parcial.js, diferido). entregarParcialOrden corre los
    // mismos candados que el botón Entregar antes de abrir la hoja.
    'entregar-parcial': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      entregarParcialOrden(ordenId)
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la entrega parcial.', 'bad'));
    },
    // Válvula de casos viejos (ordenes-casos-viejos.js, diferido): la lista de
    // reparaciones terminadas hace >30 días, con las dos puertas de cierre.
    'casos-viejos': () => {
      closeAllMenus();
      CargaDiferida.casosViejos().then(() => abrirCasosViejos())
        .catch(() => Toast.show('Sin conexión — no se pudieron abrir los casos viejos.', 'bad'));
    },
    // Reemplazo hecho por fuera de la gestión (ordenes-regularizar-reemplazo.js,
    // diferido): liga saliente y entrante a posteriori.
    'regularizar-reemplazo': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.regularizarReemplazo().then(() => abrirRegularizarReemplazo(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir el registro del reemplazo.', 'bad'));
    },
    // Entrega tardía (ordenes-entrega-tardia.js, diferido): la orden quedó EN
    // OFICINA y el cliente ya tiene los radios desde hace tiempo.
    'entrega-tardia': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.entregaTardia().then(() => abrirEntregaTardia(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la entrega tardía.', 'bad'));
    },
    // Orden interna de C COMUNICA (maquillaje): se cierra devolviendo sus
    // radios a bodega (ordenes-devolver-bodega.js, diferido).
    'devolver-bodega': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.devolverBodega().then(() => abrirDevolverBodega(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la devolución a bodega.', 'bad'));
    },
    // El taller propone reemplazar ESTE radio (ordenes-reemplazo.js, diferido):
    // nace una gestión GR por serial, en pendiente_aprobacion, y ventas la
    // decide. La acción sale de la fila del equipo, no del ⋯ de la orden.
    'proponer-reemplazo': (el) => {
      const { ordenId, equipoId } = el.dataset;
      if (!ordenId || !equipoId) return;
      closeAllMenus();
      CargaDiferida.reemplazo().then(() => abrirProponerReemplazo(ordenId, equipoId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la propuesta.', 'bad'));
    },
    // El taller avisa que ESTE radio no sirve para la gestion de la que salio
    // la orden (ordenes-cambio-serial.js, diferido): se marca el serial en la
    // gestion y bodega lo cambia. No es un reemplazo: el radio no salio.
    'marcar-cambio-serial': (el) => {
      const { ordenId, equipoId } = el.dataset;
      if (!ordenId || !equipoId) return;
      closeAllMenus();
      CargaDiferida.cambioSerialTaller().then(() => abrirCambioSerialTaller(ordenId, equipoId))
        .catch(() => Toast.show('Sin conexion - no se pudo abrir el aviso.', 'bad'));
    },
    'editar-orden': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) window.location.href = `editar-orden.html?id=${ordenId}`;
    },
    // Las dos puertas de una orden cuyo contrato se anuló (ordenes-flujo).
    'resolver-contrato-anulado': (el) => {
      const ordenId = el.dataset.ordenId;
      closeAllMenus();
      if (ordenId) abrirResolverContratoAnulado(ordenId);
    },
    // Galería modal a nivel de orden (§5.23) — antes navegaba a
    // fotos-taller.html (página retirada). Mismos datos (fotos_taller[]).
    'go-fotos-taller': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.fotos().then(() => abrirFotosOrden(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudo abrir la galería.', 'bad'));
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
    'accesorios-todos': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) marcarAccesoriosTodos(ordenId, el.dataset.valor === '1');
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
    // Buscador de serial dentro de la orden (barra sobre la tabla de equipos).
    'limpiar-busqueda-serial': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) limpiarBusquedaSerialOrden(ordenId);
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
    // Ficha de la intervención en SOLO LECTURA (badge de fotos de la fila).
    'ver-intervencion-equipo': (el) => {
      const { ordenId, equipoId } = el.dataset;
      if (ordenId && equipoId) verIntervencionEquipoDesktop(ordenId, equipoId);
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
    // X y Cancelar preguntan si hay texto sin guardar, igual que el toque
    // fuera del modal (auditoría de módulos 2026-09-30, 01 R4).
    'cerrar-trabajo-equipo': () => solicitarCierreTrabajoEquipo(),
    'guardar-trabajo-equipo': () => guardarTrabajoEquipoModal(),
    'guardar-trabajo-equipo-siguiente': () => guardarTrabajoEquipoModal({ siguiente: true }),
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
    // Galería única de la orden, abierta desde el modal del equipo con ese
    // equipo filtrado y propuesto como etiqueta (auditoría UX 2026-09-28).
    'ver-galeria-equipo': () => {
      if (typeof abrirGaleriaDelEquipoActual === 'function') abrirGaleriaDelEquipoActual();
    },
    'ver-foto-equipo': (el) => {
      const fotoId = el.dataset.fotoId;
      if (fotoId) verFotoEquipo(fotoId);
    },
    'cerrar-foto-equipo-viewer': () => cerrarFotoEquipoViewer(),
    'descargar-foto-equipo-viewer': () => descargarFotoEquipoViewer(),
    'eliminar-foto-equipo-viewer': () => eliminarFotoEquipoViewer(),

    // Materiales / piezas del equipo (modal de intervención técnica)
    'abrir-material-equipo': () => abrirMaterialEquipoModal(),
    'cerrar-material-equipo': () => cerrarMaterialEquipoModal(),
    'confirmar-material-equipo': () => confirmarMaterialEquipo(),
    'pick-material-equipo': (el) => pickMaterialEquipo(el.dataset.piezaId),
    'material-fuera-catalogo-toggle': (el) => toggleMaterialFueraCatalogo(el.dataset.nombre || ''),
    'eliminar-material-equipo': (el) => eliminarMaterialEquipo(el.dataset.lineaId),

    'close-text-modal': () => closeTextModal(),
    'copy-text-modal': () => copyTextModalContent(),

    // Overflow menu
    'toggle-overflow-menu': (el) => {
      const ordenId = el.dataset.ordenId;
      if (ordenId) toggleOverflowMenu(ordenId);
    },
    
    // Overflow menu actions
    // ('generar-nota-entrega' y 'generar-nota-entrega-intervenciones' se
    // retiraron: ningún template emitía esos data-action. La ruta viva es
    // 'nota-entrega-doc' → generarNotaEntregaIntervenciones. Auditoría P2.)
    'imprimir-orden': (el) => {
      abrirImpresionOrden(el.dataset.ordenId);
      closeAllMenus();
    },
    // Imprimir / documentos — agrupa Imprimir orden + Nota de entrega.
    // (Se conserva para compat; el menú ⋯ ahora trae las dos entradas
    // DIRECTAS de abajo — auditoría Q10: el modal intermedio costaba un
    // click extra en cada impresión.)
    'ver-documentos': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      mostrarDocumentos(ordenId);
    },
    'imprimir-orden-doc': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      abrirImpresionOrden(ordenId);
    },
    'nota-entrega-doc': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      if (typeof generarNotaEntregaIntervenciones === 'function') generarNotaEntregaIntervenciones(ordenId);
    },
    // La orden ya tiene cotización (auditoría UX 2026-09-28): abrir la
    // existente en vez de preparar otra.
    'ver-cotizacion': (el) => {
      const cotId = el.dataset.cotizacionId;
      if (!cotId) return;
      closeAllMenus();
      window.location.href = '/cotizaciones/detalle-cotizacion.html?id=' + encodeURIComponent(cotId);
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
      if (!ordenId) return;
      closeAllMenus();
      CargaDiferida.notas().then(() => gestionarNotasTecnicas(ordenId))
        .catch(() => Toast.show('Sin conexión — no se pudieron abrir las notas.', 'bad'));
    },
    // Seguimiento de retiro: una nota por orden (texto, quién, cuándo). Vacía
    // la borra. El snapshot vivo repinta la fila.
    'seguimiento-retiro': async (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      const o = (APP.state.orders || []).find(x => x.ordenId === ordenId) || {};
      const nota = await Modal.prompt({
        title: `Seguimiento de retiro · ${ordenId}`,
        message: 'Qué se habló con el cliente y qué sigue. Lo ven recepción, taller y el vendedor en la fila, en el inicio y en el correo semanal.',
        defaultValue: o.seguimiento_retiro?.nota || '',
        placeholder: 'Ej.: hablé con Pedro, pasa a retirar el viernes',
        multiline: true, confirmLabel: 'Guardar', cancelLabel: 'Cancelar',
      });
      if (nota === null) return;
      const texto = String(nota).trim();
      try {
        await OrdenesService.updateOrder(ordenId, {
          seguimiento_retiro: texto
            ? { nota: texto, por_email: firebase.auth().currentUser?.email || '', at: firebase.firestore.FieldValue.serverTimestamp() }
            : firebase.firestore.FieldValue.delete(),
        });
        Toast.show(texto ? 'Seguimiento guardado' : 'Seguimiento borrado', 'ok');
      } catch (e) {
        Toast.show('No se pudo guardar el seguimiento: ' + (e?.message || e), 'bad');
      }
    },
    // Ver entrega/recepción — modal combinado con las fases que existan.
    'ver-entrega': (el) => {
      const ordenId = el.dataset.ordenId;
      if (!ordenId) return;
      closeAllMenus();
      mostrarEntregaRecepcion(ordenId);
    },
    
    // Cola de control de calidad (ordenes-qc.js): subconjunto de las
    // completadas que el candado no deja entregar. Es un toggle propio, no un
    // estado, así que limpia el filtro de estado para no cruzarse con él.
    'filtrar-qc': () => {
      const cb = document.getElementById('filtroQcPendiente');
      if (!cb) return;
      cb.checked = !cb.checked;
      if (cb.checked) {
        const sel = document.getElementById('filtroEstado');
        if (sel) sel.value = '';
        if (typeof syncEstadoChipsFromSelect === 'function') syncEstadoChipsFromSelect();
      } else if (typeof olvidarColaQc === 'function') {
        olvidarColaQc();
      }
      aplicarFiltrosCombinados();
      // La cola de QC no cabe en la primera página (órdenes viejas): se
      // consulta al servidor y repinta cuando llega. Ver asegurarColaQc.
      if (cb.checked && typeof asegurarColaQc === 'function') asegurarColaQc();
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
    // Los <input type=date> buscan al CAMBIAR (handleChange), no al hacer
    // clic para abrir el calendario.
    if (target.tagName === 'INPUT' && target.dataset.action === 'filtrar-fechas') {
      return;
    }
    
    const action = target.dataset.action;
    const handler = ACTION_HANDLERS[action];

    if (handler) {
      // Uso del app: qué acción de la bandeja se pulsa. Solo las de negocio
      // (lista cerrada): filtros, ordenar, cerrar modales y lo móvil son ruido.
      if (window.Uso && USO_ACCIONES.has(action)) Uso.accion(`ordenes.${action}`);
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
    const esVisita = String(orden.tipo_de_servicio || '').toLowerCase().includes('visita');
    localStorage.setItem('imprimirOrdenData', JSON.stringify({
      // Versión del paquete. v2 (2026-11-19): los equipos llevan id e
      // intervención del técnico, que la visita impresa necesita; la página
      // de impresión descarta un paquete de visita sin `v` y lee de Firestore.
      v: 2,
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
      // Sin los descartados que se quedan en Cecomunica: tras el QC, este
      // papel es el que firma el cliente al retirar (domain/descarteEntrega.js).
      // En una VISITA no hay retiro ni QC: van todos los radios atendidos,
      // con lo que el técnico le hizo a cada uno (la tabla "Radios atendidos"
      // de la visita impresa; las piezas las pide la página de impresión).
      equipos: (orden.equipos || []).filter(e => !e.eliminado
          && (esVisita || !(window.DescarteEntrega && DescarteEntrega.seQueda(orden, e)))).map(e => ({
        sin_reparar: !esVisita && !!(window.DescarteEntrega && DescarteEntrega.sinReparar(orden, e)),
        id: e.id || '',
        numero_de_serie: e.numero_de_serie || '',
        modelo: e.modelo || '',
        bateria: !!e.bateria,
        clip: !!e.clip,
        cargador: !!e.cargador,
        fuente: !!e.fuente,
        antena: !!e.antena,
        cubrepolvo: !!e.cubrepolvo,
        observaciones: e.observaciones || '',
        trabajo_tecnico: e.trabajo_tecnico || '',
        intervencion_no_disponible: !!e.intervencion_no_disponible,
        motivo_no_disponible: e.motivo_no_disponible || ''
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
  Modal.sheet({
    title: `Documentos — Orden ${esc(ordenId)}`, icon: 'printer', size: 'sm',
    html: `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button type="button" class="btn" data-doc="orden" style="justify-content:flex-start;"><i data-lucide="file-text"></i> Imprimir orden</button>
        <button type="button" class="btn" data-doc="nota" style="justify-content:flex-start;"><i data-lucide="clipboard-list"></i> Nota de entrega</button>
      </div>`,
    buttons: [],
    onMount: (root, api) => root.addEventListener('click', (e) => {
      const doc = e.target.closest('[data-doc]')?.dataset.doc;
      if (!doc) return;
      api.close(doc);
      if (doc === 'orden') abrirImpresionOrden(ordenId);
      else if (typeof generarNotaEntregaIntervenciones === 'function') generarNotaEntregaIntervenciones(ordenId);
    }),
  });
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

// Formato largo del módulo, en hora de Panamá (ordenes-state.js).
function _entregaFecha(ts) {
  try {
    const s = formatFechaHora(ts);
    return s === '—' ? null : s;
  } catch { return null; }
}

// Lightbox de imagen — overlay dinámico, cierra con backdrop/Escape/✕.
//
// Con zoom (2026-11-19, Brenda): la nota de entrega firmada en papel se sube
// como foto y en el modal sale a 240px — no se leía la firma ni el nombre de
// quien recibió. Aquí se abre sola, se amplía (botones, rueda, clic) y se
// arrastra; "Abrir en pestaña nueva" deja el zoom del navegador como respaldo.
// La usan las firmas/notas del modal de entrega y la cédula (admin, URL
// firmada temporal): por eso no se guarda nada ni se vuelve a pedir la URL.
//
// Geometría: la imagen queda centrada en el marco y se transforma con
// translate(t) scale(s) desde su centro, así un punto p del marco (medido
// desde el centro) muestra el punto (p − t)/s de la imagen. Para ampliar SIN
// que lo que está bajo el cursor se mueva: t' = p − (p − t)·s'/s.
function _entregaLightbox(url, alt) {
  const esc = _entregaEsc;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '10000';
  overlay.innerHTML = `
    <div class="modal" aria-label="${esc(alt || 'Imagen')}"
         style="width:min(96vw,1200px);max-width:none;max-height:94vh;padding:8px;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 2px 8px;">
        <button type="button" class="btn btn-sm" data-lb="out" aria-label="Alejar" title="Alejar" style="min-width:36px;">−</button>
        <span data-lb-pct class="muted" style="min-width:46px;text-align:center;font-size:12px;">100%</span>
        <button type="button" class="btn btn-sm" data-lb="in" aria-label="Acercar" title="Acercar" style="min-width:36px;">+</button>
        <button type="button" class="btn btn-sm" data-lb="fit">Ajustar</button>
        <a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir en pestaña nueva</a>
        <span style="flex:1 1 auto;"></span>
        <button type="button" class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div data-lb-stage style="flex:1 1 76vh;min-height:140px;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;background:#f1f5f9;border-radius:6px;touch-action:none;cursor:zoom-in;">
        <img src="${esc(url)}" alt="${esc(alt || 'Imagen')}" draggable="false"
             style="max-width:100%;max-height:100%;object-fit:contain;display:block;transform-origin:center center;user-select:none;-webkit-user-drag:none;">
      </div>
      <div class="muted" style="font-size:12px;padding:6px 2px 0;">Clic o rueda del mouse para ampliar · arrastra para moverte por la imagen</div>
    </div>`;

  const stage = overlay.querySelector('[data-lb-stage]');
  const img = stage.querySelector('img');
  const pct = overlay.querySelector('[data-lb-pct]');
  const MIN = 1, MAX = 8;
  let s = 1, tx = 0, ty = 0;
  let arrastrando = false, movio = false, ox = 0, oy = 0, pid = null;

  const pintar = () => {
    // Tope del arrastre: la imagen ampliada no se sale del marco.
    const mx = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2);
    const my = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    pct.textContent = `${Math.round(s * 100)}%`;
    stage.style.cursor = s > 1 ? (arrastrando ? 'grabbing' : 'grab') : 'zoom-in';
  };
  // Amplía alrededor de un punto del marco (medido desde su centro).
  const zoomA = (nuevo, px = 0, py = 0) => {
    let n = Math.min(MAX, Math.max(MIN, nuevo));
    if (n < 1.02) n = 1;               // el redondeo de la rueda no deja un 101%
    if (n !== s) {
      tx = px - (px - tx) * (n / s);
      ty = py - (py - ty) * (n / s);
      s = n;
      if (s === 1) { tx = 0; ty = 0; }
    }
    pintar();
  };
  const puntoDe = (e) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
  };

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = puntoDe(e);
    zoomA(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), px, py);
  }, { passive: false });

  stage.addEventListener('pointerdown', (e) => {
    if (arrastrando || (e.pointerType === 'mouse' && e.button !== 0)) return;
    arrastrando = true; movio = false; ox = e.clientX; oy = e.clientY; pid = e.pointerId;
    try { stage.setPointerCapture(pid); } catch { /* sin captura igual funciona dentro del marco */ }
    pintar();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!arrastrando || e.pointerId !== pid) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    if (!movio && Math.hypot(dx, dy) < 4) return;   // un clic con pulso no es arrastre
    movio = true;
    if (s > 1) { tx += dx; ty += dy; }
    ox = e.clientX; oy = e.clientY;
    pintar();
  });
  const soltar = (e) => {
    if (!arrastrando || e.pointerId !== pid) return;
    arrastrando = false;
    try { stage.releasePointerCapture(pid); } catch { /* ya suelta */ }
    // Clic sin arrastre: amplía donde se tocó; si ya estaba ampliada, ajusta.
    if (!movio && e.type === 'pointerup') {
      if (s === 1) zoomA(2.5, ...puntoDe(e)); else zoomA(1);
    } else pintar();
  };
  stage.addEventListener('pointerup', soltar);
  stage.addEventListener('pointercancel', soltar);

  img.addEventListener('error', () => {
    stage.innerHTML = '<div class="muted" style="padding:24px;text-align:center;">No se pudo cargar la imagen. Prueba con "Abrir en pestaña nueva" o vuelve a abrirla.</div>';
  });

  const cleanup = () => {
    overlay.remove();
    window.removeEventListener('keydown', kb, true);
    window.removeEventListener('resize', pintar);
  };
  // En captura y cortando la propagación del Escape: el modal de entrega que
  // queda debajo (Modal.sheet) también escucha keydown y se cerraría con él.
  const kb = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); }
    else if (e.key === '+' || e.key === '=') zoomA(s * 1.5);
    else if (e.key === '-') zoomA(s / 1.5);
    else if (e.key === '0') zoomA(1);
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }
    const b = e.target.closest('[data-lb]');
    if (!b) return;
    if (b.dataset.lb === 'in') zoomA(s * 1.5);
    else if (b.dataset.lb === 'out') zoomA(s / 1.5);
    else zoomA(1);
  });
  window.addEventListener('keydown', kb, true);
  window.addEventListener('resize', pintar);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]')?.focus();
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
// La imagen va dentro de un <button> (foco y Enter gratis): un clic la abre
// sola en el lightbox con zoom — el modal la enseña a 240px y ahí no se lee
// una nota firmada (2026-11-19, Brenda). El clic lo atiende el modal de
// entrega por `data-zoom-img`.
function _faseFirma(url, cap) {
  return url
    ? `<div style="margin-top:8px;"><div class="muted" style="margin-bottom:4px;">${cap}</div>
         <button type="button" data-zoom-img="1" title="Clic para ampliar" aria-label="Ampliar: ${_entregaEsc(cap)}"
                 style="display:block;padding:0;margin:0;border:0;background:none;cursor:zoom-in;">
           <img src="${_entregaEsc(url)}" alt="${_entregaEsc(cap)}" style="max-width:240px;border:1px solid var(--line,#e5e7eb);border-radius:8px;background:#fff;display:block;">
         </button>
         <div class="muted" style="font-size:12px;margin-top:3px;">Clic para ampliar</div></div>`
    : '';
}

function mostrarEntregaRecepcion(ordenId) {
  const o = (window.APP?.state?.orders || []).find(x => x.ordenId === ordenId) || {};
  const esc = _entregaEsc;
  const esAdmin = (window.APP?.state?.userRole) === (window.ROLES ? ROLES.ADMIN : 'administrador');
  const cliente = (typeof nombreClienteDe === 'function' ? nombreClienteDe(o) : (o.cliente_nombre || '—'));

  const tieneRecepcion = !!(o.firma_recepcion_url || o.receptor_recepcion_nombre || o.fecha_recepcion);
  const tieneEntrega   = !!(o.firma_url || o.receptor_nombre || o.fecha_entrega || o.sin_id || o.identificacion_path || o.identificacion_url
    || o.no_recibido || o.entrega_persona_interna);
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

  // Firma en papel (`no_recibido`, nombre histórico del flag): quien recibió
  // está en `entrega_persona_interna`, no en `receptor_nombre`, y la prueba
  // es la nota impresa (auditoría de módulos 2026-09-30, R1: 38 entregas del
  // mes decían "Recibido por —").
  const enPapel = !!o.no_recibido;
  let papelHtml = '';
  if (enPapel) {
    const esPdf = /\.pdf(\?|$)/i.test(String(o.nota_firmada_path || o.nota_firmada_url || ''));
    const notaHtml = o.nota_firmada_url
      ? (esPdf
          ? `<div style="margin-top:8px;"><a class="btn btn-sm" href="${esc(o.nota_firmada_url)}" target="_blank" rel="noopener"><i data-lucide="file-text"></i> Ver la nota firmada (PDF)</a></div>`
          : _faseFirma(o.nota_firmada_url, 'Nota firmada por el cliente'))
      : `<div class="muted" style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
           <span><i data-lucide="alert-triangle"></i> Falta subir la nota firmada${o.nota_firmada_omitida_motivo ? ' — ' + esc(o.nota_firmada_omitida_motivo) : ''}.</span>
           <button type="button" class="btn btn-sm" data-action="subir-nota-firmada" data-orden="${esc(ordenId)}">Subir la nota</button>
         </div>`;
    papelHtml = `<div class="muted" style="margin-top:8px;"><i data-lucide="pen-off"></i> Firmó en papel${o.no_recibido_motivo ? ' — ' + esc(o.no_recibido_motivo) : ''}.</div>` + notaHtml;
  }
  const entregaHtml = tieneEntrega ? faseCard('Entrega al cliente', 'package-check',
    _faseFilas([
      ['Recibido por', esc((enPapel ? (o.entrega_persona_interna || o.receptor_nombre) : o.receptor_nombre) || '—')],
      ['Fecha y hora', esc(_entregaFecha(o.fecha_entrega) || '—')],
      // Constancia de que recepción miró la cédula física (2026-11-17). Sin
      // el número: la cédula es PII y se ve aparte (admin).
      ['Identificación', o.id_verificada
        ? esc(`Cédula verificada por ${o.id_verificada.por_email || '—'}`
            + (_entregaFecha(o.id_verificada.at) ? ` · ${_entregaFecha(o.id_verificada.at)}` : ''))
        : (o.sin_id ? 'No presentó identificación' : '')],
    ]) + (enPapel ? papelHtml : _faseFirma(o.firma_url, 'Firma del receptor')) + idHtml
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

  // Entregas PARCIALES (entrega.tandas[]): cada tanda tiene su nota numerada,
  // imprimible y reenviable. Vive aquí porque es el único sitio que sigue
  // alcanzable cuando la orden ya cerró — la hoja de entrega parcial
  // desaparece en cuanto no quedan equipos pendientes, y con ella se irían
  // los papeles que el cliente puede venir a pedir dentro de seis meses.
  // Las tarjetas las pinta el módulo diferido; si aún no cargó, se pinta un
  // resumen sin botones y se rellena al llegar (abajo, en onMount).
  const tandas = (typeof EntregaTandas !== 'undefined') ? EntregaTandas.tandas(o) : [];
  const tandasHtml = tandas.length ? `
    <div style="margin-top:14px;border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:10px 12px;">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:6px;">
        <i data-lucide="package-check"></i> Entregas parciales (${tandas.length})
      </div>
      <div id="epTandasMount"><div class="muted">Cargando notas…</div></div>
    </div>` : '';

  const titulo = tieneCierreVisita ? 'Cierre de visita' : (tieneEntrega ? 'Entrega' : 'Recepción');
  const footerBtns = [
    tieneEntrega   ? `<button class="btn btn-primary" data-ver-comprobante="1"><i data-lucide="printer"></i> Imprimir entrega</button>` : '',
    tieneRecepcion ? `<button class="btn" data-ver-acuse="1"><i data-lucide="printer"></i> Imprimir acuse</button>` : '',
  ].filter(Boolean).join('');

  let overlay = null, sheetApi = null;
  Modal.sheet({
    title: `${titulo} — Orden ${ordenId}`, icon: 'package-check', size: 'md',
    html: `
        ${cabecera}
        ${recepcionHtml}
        ${entregaHtml}
        ${cierreHtml}
        ${tandasHtml}
        ${equiposHtml}`,
    footerHtml: `
        ${footerBtns}`,
    onMount: (root, api) => {
      overlay = root; sheetApi = api;
      root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(null); });
      // Las tarjetas de tanda las sabe pintar el módulo de entrega parcial:
      // se carga en diferido para no traer su documento imprimible a cada
      // orden que solo se consulta.
      const mount = root.querySelector('#epTandasMount');
      if (!mount || !tandas.length) return;
      CargaDiferida.entregaParcial().then(() => {
        mount.innerHTML = tandas.map(t => EntregaParcialDoc.tarjetaTanda(ordenId, t)).join('');
        EntregaParcialDoc.cablearTandas(mount, ordenId);
        if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(mount);
      }).catch(() => {
        mount.innerHTML = '<div class="muted">No se pudieron cargar las notas — recarga la página.</div>';
      });
    },
  });

  const cleanup = () => sheetApi.close(null);
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }
    const zoomBtn = e.target.closest('[data-zoom-img]');
    if (zoomBtn) {
      const im = zoomBtn.querySelector('img');
      if (im) _entregaLightbox(im.currentSrc || im.src, im.alt);
      return;
    }
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

  // La nota de identificación solo afirma "Verificada" si recepción marcó que
  // miró la cédula física (id_verificada, 2026-11-17) o si hubo foto; si el
  // cliente no presentó ID se indica; si no hay dato, se omite.
  const idNota = o.sin_id
    ? `<p class="nota"><strong>Identificación:</strong> Cliente no presentó identificación${o.sin_id_motivo ? ' — ' + esc(o.sin_id_motivo) : ''}.</p>`
    : (o.id_verificada || o.identificacion_path || o.identificacion_url)
      ? `<p class="nota"><strong>Identificación:</strong> Verificada al momento de la entrega.</p>`
      : '';

  const firmaBlock = o.firma_url
    ? `<img src="${esc(o.firma_url)}" alt="Firma del receptor" class="firma-img">`
    : `<div class="firma-line"></div>`;

  // Entrega con firma EN PAPEL (`no_recibido`, nombre histórico del flag): la
  // prueba de que el cliente recibió es la foto de la nota firmada, y el
  // comprobante salía con la línea de firma vacía (2026-11-19, Brenda: "no se
  // incluye la imagen de la nota de entrega firmada"). Misma lectura que el
  // modal: quien recibió está en `entrega_persona_interna`, y la nota puede
  // ser foto, PDF o estar pendiente de subir.
  const enPapel = !!o.no_recibido;
  const recibidoPor = (enPapel ? (o.entrega_persona_interna || o.receptor_nombre) : o.receptor_nombre) || '';
  let firmaWrap;
  if (!enPapel) {
    firmaWrap = `<div class="firma-wrap">
    <div class="firma-cap">Firma del receptor:</div>
    ${firmaBlock}
    <div class="firma-cap">${esc(recibidoPor)}</div>
  </div>`;
  } else {
    const notaEsPdf = /\.pdf(\?|$)/i.test(String(o.nota_firmada_path || o.nota_firmada_url || ''));
    const datos = [
      recibidoPor ? `Recibido por: <strong>${esc(recibidoPor)}</strong>` : '',
      o.no_recibido_motivo ? `Motivo (sin firma digital): ${esc(o.no_recibido_motivo)}` : '',
    ].filter(Boolean).join(' · ');
    let notaHtml;
    if (o.nota_firmada_url && !notaEsPdf) {
      notaHtml = `<img src="${esc(o.nota_firmada_url)}" alt="Nota de entrega firmada por el cliente" class="nota-img"
        onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'nota',textContent:'No se pudo cargar la imagen de la nota firmada; consúltala en la orden ${esc(ordenId)}.'}))">`;
    } else if (o.nota_firmada_url) {
      notaHtml = `<p class="nota">La nota firmada por el cliente está guardada en PDF y no se puede incrustar aquí:
        <a href="${esc(o.nota_firmada_url)}" target="_blank" rel="noopener">abrir la nota firmada (PDF)</a>.
        Imprímela junto con este comprobante.</p>`;
    } else {
      notaHtml = `<p class="nota"><strong>Nota firmada pendiente de subir</strong>${o.nota_firmada_omitida_motivo ? ' — ' + esc(o.nota_firmada_omitida_motivo) : ''}.</p>`;
    }
    firmaWrap = `<div class="firma-wrap papel">
    <div class="papel-t">Firmó en papel — nota firmada por el cliente</div>
    ${datos ? `<div class="firma-cap">${datos}</div>` : ''}
    ${notaHtml}
  </div>`;
  }

  // Observaciones de la orden y notas escritas al confirmar la entrega. Van
  // en el comprobante impreso porque el correo de Nota de Entrega ya las
  // lleva: la hoja que firma el cliente decía menos que el correo, y ahí
  // nacían los malentendidos (p. ej. "este radio reemplaza al robado").
  // white-space:pre-wrap conserva los saltos de línea del textarea.
  const obsBlock = o.observaciones
    ? `<div class="bloque">
         <div class="bloque-t">Contrato / Observaciones</div>
         <div class="bloque-b">${esc(o.observaciones)}</div>
       </div>`
    : '';
  const notasBlock = o.notas_entrega
    ? `<div class="bloque bloque-alerta">
         <div class="bloque-t">Notas de entrega</div>
         <div class="bloque-b">${esc(o.notas_entrega)}</div>
       </div>`
    : '';

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
  .bloque { margin:14px 0 0; padding:10px 14px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; }
  .bloque-alerta { background:#fffbeb; border-color:#fde68a; }
  .bloque-t { font-size:12px; font-weight:700; color:#6b7280; margin-bottom:3px; }
  .bloque-alerta .bloque-t { color:#92400e; }
  .bloque-b { font-size:13px; line-height:1.5; white-space:pre-wrap; }
  .firma-wrap { margin-top:28px; }
  .firma-img { max-width:280px; max-height:130px; display:block; border:1px solid #e5e7eb; border-radius:6px; background:#fff; }
  .firma-line { width:280px; border-bottom:1px solid #111; height:60px; }
  .firma-cap { font-size:12px; color:#6b7280; margin-top:4px; }
  .papel-t { font-size:14px; font-weight:700; }
  .nota-img { display:block; max-width:100%; margin-top:10px; border:1px solid #e5e7eb; border-radius:6px; background:#fff; }
  .toolbar { margin-bottom:18px; }
  .toolbar button { background:#0091D7; color:#fff; border:0; padding:8px 16px; border-radius:6px; font:600 13px Arial; cursor:pointer; }
  .foot { margin-top:32px; font-size:11px; color:#9ca3af; text-align:center; border-top:1px solid #eee; padding-top:8px; }
  /* La foto de la nota firmada no se parte entre hojas: se limita a lo que
     cabe en una (carta, con márgenes) y, si no entra en lo que queda de la
     primera, el navegador la pasa entera a la siguiente. */
  @media print { .toolbar { display:none; } body { padding:0; } .bloque { break-inside:avoid; }
    .papel { break-inside:avoid; page-break-inside:avoid; }
    .nota-img { max-height:225mm; width:auto; } }
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
    <div><span class="k">Recibido por:</span> <strong>${esc(recibidoPor || '—')}</strong></div>
    <div><span class="k">Técnico:</span> <strong>${esc(o.tecnico_asignado || '—')}</strong></div>
  </div>

  ${obsBlock}

  <h2>Equipos entregados (${equipos.length})</h2>
  ${equipos.length
    ? `<table><thead><tr><th class="c-num">#</th><th>Serial</th><th>Modelo</th><th>Accesorios</th></tr></thead><tbody>${equiposRows}</tbody></table>`
    : `<p class="nota">Sin equipos registrados en la orden.</p>`}

  ${notasBlock}

  ${idNota}

  ${firmaWrap}

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
    // functions-compat se difiere (P3.15): solo este callable lo usa en la página.
    await CargaDiferida.functions();
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

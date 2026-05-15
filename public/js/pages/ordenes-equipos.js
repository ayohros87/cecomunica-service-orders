// @ts-nocheck
/* ========================================
 * ORDENES EQUIPOS - Equipment CRUD + trabajo modal
 * Field edits, deletes, accesorios bulk-update, mobile equipos modal,
 * trabajo-equipo modal, and the "no disponible" toggle. All Firestore
 * writes go through OrdenesService.
 * ======================================== */

window.guardarAccesoriosLote = async function(ordenId) {
  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  if (!filaDetalle) {
    Toast.show("⚠️ Abre la orden primero para guardar accesorios", "bad");
    return;
  }

  const updates = {};

  try {
    // Obtener todos los equipos de la orden desde el estado
    const ordenData = APP.state.orders.find(o => o.ordenId === ordenId);
    if (!ordenData || !ordenData.equipos) return;

    // Recorrer cada equipo y extraer el estado actual de sus iconos de accesorios
    ordenData.equipos.forEach(equipo => {
      const equipoId = equipo.id;

      // Buscar los iconos de accesorios para este equipo en la fila de equipos
      const filaEquipo = filaDetalle.querySelector(`tr[data-equipo-id="${ordenId}_${equipoId}"]`);
      if (!filaEquipo) return;

      const accesoriosWrapper = filaEquipo.querySelector('.accesorios-group');
      if (!accesoriosWrapper) return;

      const campos = [
        { name: 'bateria', icon: 'battery-full' },
        { name: 'clip',    icon: 'paperclip' },
        { name: 'cargador',icon: 'plug' },
        { name: 'fuente',  icon: 'zap' },
        { name: 'antena',  icon: 'radio-tower' }
      ];

      // Leer estado de cada accesorio desde los atributos data-campo
      campos.forEach(campo => {
        const accesorioItem = Array.from(accesoriosWrapper.querySelectorAll('.accesorio-item'))
          .find(item => item.dataset.campo === campo.name);

        if (accesorioItem) {
          const isActivo = accesorioItem.classList.contains('activo');
          const key = `${equipoId}.${campo.name}`;
          updates[key] = isActivo;
        }
      });
    });

    if (Object.keys(updates).length > 0) {
      await OrdenesService.batchUpdateAccessories(ordenId, updates);

      // Update local cache with fresh data from Firestore
      const ordenActualizada = await OrdenesService.getOrder(ordenId);
      if (ordenActualizada) {
        const cacheIndex = APP.state.orders.findIndex(o => o.ordenId === ordenId);
        if (cacheIndex !== -1) {
          APP.state.orders[cacheIndex] = ordenActualizada;
        }
      }

      Toast.show("✅ Accesorios actualizados", "ok");
    }

    // Remover modo edición
    delete filaDetalle.dataset.modoAccesorios;

    // Remover listeners y clases de edición
    const accesorioItems = filaDetalle.querySelectorAll('.accesorio-item.editable');
    accesorioItems.forEach(item => {
      item.classList.remove('editable');
      item.style.cursor = '';
      delete item.dataset.listenerAdded;
    });

    // Ocultar botón guardar
    const btnGuardar = document.getElementById(`btnGuardarAccesorios_${ordenId}`);
    if (btnGuardar) btnGuardar.style.display = "none";

    // Cerrar popover de leyenda
    const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
    if (popover) popover.style.display = 'none';

    // Refrescar UI si hubo cambios
    if (Object.keys(updates).length > 0) {
      refrescarEquiposDeOrden(ordenId);
    }
  } catch (error) {
    console.error("Error guardando accesorios:", error);
    Toast.show("❌ Error al guardar", "bad");
  }
};
function resolverEquipoDesdeCompuesto(compuestoId) {
  const orders = APP.state.orders || [];
  for (const orden of orders) {
    const equipos = Array.isArray(orden.equipos) ? orden.equipos : [];
    const equipo = equipos.find(eq => `${orden.ordenId}_${eq.id}` === compuestoId);
    if (equipo) {
      return { ordenId: orden.ordenId, equipoId: equipo.id, orden, equipo };
    }
  }
  return null;
}

window.editarCampoEquipo = async function(compuestoId, campo, valorActual = "") {
  const permitidos = new Set(["numero_de_serie", "modelo", "observaciones"]);
  if (!permitidos.has(campo)) {
    Toast.show("⚠️ Campo no editable", "bad");
    return;
  }

  const target = resolverEquipoDesdeCompuesto(compuestoId);
  if (!target) {
    Toast.show("❌ Equipo no encontrado", "bad");
    return;
  }

  const etiqueta = campo === "numero_de_serie"
    ? "Número de serie"
    : (campo === "modelo" ? "Modelo" : "Observaciones");

  const nuevoValor = await Modal.prompt({
    title: `Editar ${etiqueta}`,
    defaultValue: valorActual ?? "",
    multiline: campo === "observaciones"
  });
  if (nuevoValor === null) return;

  const valorLimpio = String(nuevoValor).trim();
  if (campo !== "observaciones" && !valorLimpio) {
    Toast.show(`⚠️ ${etiqueta} no puede quedar vacío`, "bad");
    return;
  }

  try {
    await OrdenesService.updateEquipmentField(target.ordenId, target.equipoId, campo, valorLimpio);

    const cacheOrden = APP.state.orders.find(o => o.ordenId === target.ordenId);
    if (cacheOrden && Array.isArray(cacheOrden.equipos)) {
      const i = cacheOrden.equipos.findIndex(eq => eq.id === target.equipoId);
      if (i >= 0) cacheOrden.equipos[i][campo] = valorLimpio;
    }

    refrescarEquiposDeOrden(target.ordenId);
    Toast.show("✅ Equipo actualizado", "ok");
  } catch (e) {
    console.error("❌ Error al editar campo del equipo:", e);
    Toast.show(`❌ Error al actualizar: ${e?.message || e}`, "bad");
  }
};

window.eliminarEquipo = async function(e, compuestoId) {
  if (e) e.stopPropagation();

  const target = resolverEquipoDesdeCompuesto(compuestoId);
  if (!target) {
    Toast.show("❌ Equipo no encontrado", "bad");
    return;
  }

  if (!await Modal.confirm({ message: '¿Eliminar este equipo de la orden?', danger: true })) return;

  try {
    await OrdenesService.deleteEquipment(target.ordenId, target.equipoId);

    const cacheOrden = APP.state.orders.find(o => o.ordenId === target.ordenId);
    if (cacheOrden && Array.isArray(cacheOrden.equipos)) {
      const i = cacheOrden.equipos.findIndex(eq => eq.id === target.equipoId);
      if (i >= 0) cacheOrden.equipos[i].eliminado = true;
    }

    refrescarEquiposDeOrden(target.ordenId);
    Toast.show("✅ Equipo eliminado", "ok");
  } catch (err) {
    console.error("❌ Error al eliminar equipo:", err);
    Toast.show("Error al eliminar equipo", "bad");
  }
};

let equipoEditandoId = null;
let equipoEditandoOrdenId = null;

window.abrirEditorAccesorios = function(id, datosEquipo) {
  equipoEditandoId = id.split("_")[1];
  equipoEditandoOrdenId = id.split("_")[0];

  const form = document.getElementById("formAccesorios");
  ["bateria", "clip", "cargador", "fuente", "antena"].forEach(campo => {
    form.elements[campo].checked = !!datosEquipo[campo];
  });

  document.getElementById("modalAccesorios").style.display = "block";
};


window.activarModoAccesorios = function (ordenId) {
  const campos = ["bateria", "clip", "cargador", "fuente", "antena"];
  const filaDetalle = document.querySelector(`tr.filaDetalle[data-orden-id="${ordenId}"]`);
  
  if (!filaDetalle) {
    Toast.show("⚠️ Abre la orden primero para editar accesorios", "bad");
    return;
  }
  
  // Marcar que estamos en modo edición
  filaDetalle.dataset.modoAccesorios = "true";
  
  // Hacer todos los accesorio-items clickeables
  const accesorioItems = filaDetalle.querySelectorAll('.accesorio-item');
  
  accesorioItems.forEach(item => {
    // Agregar clase de edición para estilos visuales
    item.classList.add('editable');
    
    // Si no tiene listener, agregarlo
    if (!item.dataset.listenerAdded) {
      item.dataset.listenerAdded = "true";
      item.style.cursor = "pointer";
      
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        // Toggle estado activo/inactivo
        if (this.classList.contains('activo')) {
          this.classList.remove('activo');
          this.classList.add('inactivo');
        } else {
          this.classList.remove('inactivo');
          this.classList.add('activo');
        }
      });
    }
  });
  
  // Mostrar botón guardar
  const btnGuardar = document.getElementById(`btnGuardarAccesorios_${ordenId}`);
  if (btnGuardar) btnGuardar.style.display = "inline-block";
  
  // Mostrar automáticamente la leyenda de accesorios
  const popover = document.getElementById(`popoverAccesorios_${ordenId}`);
  if (popover) {
    popover.style.display = 'block';
  }
};

// nombreClienteDe, getEstadoClass, tipoChip, estadoCompacto → pages/ordenes-state.js

// actualizarResumen → pages/ordenes-render.js

window.abrirEquiposMobile = function(ordenId) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  if (!o) return;

  const equipos = (o.equipos || []).filter(e => !e.eliminado);

  const title = document.getElementById("equiposMobileTitle");
  const sub = document.getElementById("equiposMobileSub");
  const list = document.getElementById("equiposMobileList");
  const modal = document.getElementById("modalEquiposMobile");

  if (title) title.textContent = `Orden #${ordenId} · Equipos`;
  if (sub) sub.textContent = `${nombreClienteDe(o)} · ${equipos.length} equipo(s)`;

  if (!list) return;
  if (equipos.length === 0) {
    list.innerHTML = `
      <div class="equipos-empty">
        <div class="equipos-empty-icon"><i data-lucide="package"></i></div>
        <div class="equipos-empty-text">No hay equipos asociados</div>
      </div>
    `;
  } else {
    list.innerHTML = equipos.map((e, idx) => {
      const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
      const modelo = (e.modelo || e.MODEL || e.modelo_nombre || "-").toString();
      const obs = (e.observaciones || e.descripcion || e.nombre || "").toString();
      const noDisponible = !!e.intervencion_no_disponible;
      const motivoNoDisponible = (e.motivo_no_disponible || "").toString();
      const cardClass = `equipo-card ${noDisponible ? 'equipo-card--no-disponible' : (e.trabajo_tecnico ? 'equipo-card--ok' : '')}`;

      // 2-line clamp usando CSS inline simple
      const obsHtml = obs
        ? `<div class="equipo-obs clamp-2">${escapeHtml(obs)}</div>
           <button class="btn ghost equipo-obs-more" data-action="ver-obs-completa" data-orden-id="${ordenId}" data-idx="${idx}"><i data-lucide="eye"></i> Ver más</button>`
        : `<div class="equipo-obs equipo-obs--empty">Sin observaciones</div>`;
      
      // Trabajo tecnico display
      const trabajoDisplay = (e.trabajo_tecnico || "").trim()
        ? `<div class="trabajo-card trabajo-card--ok">
             <div class="trabajo-header">
               <span class="trabajo-icon">✓</span>
               <strong class="trabajo-title">Intervención Registrada</strong>
             </div>
             <div class="trabajo-text clamp-2">${escapeHtml(e.trabajo_tecnico)}</div>
           </div>`
        : (noDisponible
          ? `<div class="trabajo-card trabajo-card--warn">
               Equipo no disponible para intervención${motivoNoDisponible ? ` · ${escapeHtml(motivoNoDisponible)}` : ''}
             </div>`
          : `<div class="trabajo-card trabajo-card--empty">Sin intervención registrada</div>`
        );

      return `
        <div class="${cardClass}">
          <div class="equipo-card-header">
            <div class="equipo-card-info">
              <div class="equipo-card-serial"><i data-lucide="package"></i> ${escapeHtml(serial)}</div>
              <div class="equipo-card-model">Modelo: <span class="equipo-card-model-value">${escapeHtml(modelo)}</span></div>
            </div>
            ${noDisponible
              ? '<div class="equipo-status-badge equipo-status-badge--warn"><i data-lucide="ban"></i> No disponible</div>'
              : (e.trabajo_tecnico ? '<div class="equipo-status-badge equipo-status-badge--ok">✓ OK</div>' : '')
            }
          </div>
          ${obsHtml}
          
          <div class="equipo-card-actions">
            <button class="btn ${e.trabajo_tecnico ? 'ok' : 'secondary'} equipo-card-action"
              data-action="abrir-trabajo-equipo" data-orden-id="${ordenId}" data-idx="${idx}">
              <i data-lucide="${e.trabajo_tecnico ? 'check-circle' : 'pencil-line'}"></i> Intervención
            </button>

            <button class="btn ghost equipo-card-view"
              data-action="ver-trabajo-equipo" data-orden-id="${ordenId}" data-idx="${idx}" title="Ver comentario">
              <i data-lucide="eye"></i>
            </button>
          </div>

          ${trabajoDisplay}
        </div>
      `;
    }).join("");
  }

  APP.utils.lucideRefresh(modal);
  if (modal) APP.utils.show(modal);
};

window.cerrarEquiposMobile = function() {
  const modal = document.getElementById("modalEquiposMobile");
  if (modal) APP.utils.hide(modal);
};

let _trabajoOrdenId = null;
let _trabajoEquipoIdx = null;

window.abrirTrabajoEquipoModal = function(ordenId, idx) {
  // Check permissions
  const rol = APP.state.userRole || "";
  if (![ROLES.TECNICO, ROLES.TECNICO_OPERATIVO, ROLES.ADMIN, ROLES.RECEPCION].includes(rol)) {
    Toast.show("Sin permisos para editar", "bad");
    return;
  }

  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  if (!o) return;

  const equipos = (o.equipos || []).filter(e => !e.eliminado);
  const e = equipos[idx];
  if (!e) return;

  _trabajoOrdenId = ordenId;
  _trabajoEquipoIdx = idx;

  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  const modelo = (e.modelo || e.MODEL || e.modelo_nombre || "-").toString();

  document.getElementById("trabajoEquipoTitle").textContent = `✍️ Intervención técnica · ${serial}`;
  document.getElementById("trabajoEquipoSub").textContent = `Modelo: ${modelo}`;
  const txtEl = document.getElementById("trabajoEquipoText");
  if (txtEl) txtEl.value = (e.trabajo_tecnico || "").toString();

  const chkNoDisp = document.getElementById("trabajoNoDisponible");
  const motivoNoDisp = document.getElementById("trabajoMotivoNoDisponible");
  const isNoDisp = !!e.intervencion_no_disponible;
  if (chkNoDisp) chkNoDisp.checked = isNoDisp;
  if (motivoNoDisp) {
    motivoNoDisp.value = (e.motivo_no_disponible || "").toString();
    motivoNoDisp.disabled = !isNoDisp;
  }
  if (txtEl) txtEl.disabled = isNoDisp;

  if (chkNoDisp) {
    chkNoDisp.onchange = () => {
      const checked = chkNoDisp.checked;
      if (motivoNoDisp) {
        motivoNoDisp.disabled = !checked;
        if (!checked) motivoNoDisp.value = "";
        else setTimeout(() => motivoNoDisp.focus(), 0);
      }
      if (txtEl) {
        if (checked) txtEl.value = "";
        txtEl.disabled = checked;
      }
    };
  }

  const modal = document.getElementById("modalTrabajoEquipo");
  
  // Add backdrop click handler (close when clicking outside modal)
  modal.onclick = function(e) {
    if (e.target === modal) {
      cerrarTrabajoEquipoModal();
    }
  };
  
  APP.utils.show(modal);
  setTimeout(() => document.getElementById("trabajoEquipoText")?.focus(), 50);
};

window.cerrarTrabajoEquipoModal = function() {
  const modal = document.getElementById("modalTrabajoEquipo");
  if (modal) APP.utils.hide(modal);
  _trabajoOrdenId = null;
  _trabajoEquipoIdx = null;
};

window.abrirIntervencionEquipoDesktop = function(ordenId, equipoId) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  if (!o) return;

  const equipos = (o.equipos || []).filter(e => !e.eliminado);
  const idx = equipos.findIndex(e => e.id === equipoId);
  if (idx === -1) return;

  // Reutilizamos el modal existente de mobile
  abrirTrabajoEquipoModal(ordenId, idx);
};

window.verTrabajoEquipo = function(ordenId, idx) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  const equipos = (o?.equipos || []).filter(e => !e.eliminado);
  const e = equipos[idx];
  if (!e) return;

  const texto = (e.trabajo_tecnico || "").toString().trim();
  const noDisponible = !!e.intervencion_no_disponible;
  const motivo = (e.motivo_no_disponible || "").toString().trim();
  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  
  showTextModal(
    `Intervención Técnica · ${serial}`,
    texto || (noDisponible ? `Equipo no disponible para intervención${motivo ? ` · ${motivo}` : ""}` : "Sin intervención registrada"),
    !texto && !noDisponible
  );
};

window.guardarTrabajoEquipoModal = async function() {
  if (!_trabajoOrdenId && _trabajoOrdenId !== "") return;
  if (_trabajoEquipoIdx === null || _trabajoEquipoIdx === undefined) return;

  const btn = document.getElementById("btnGuardarTrabajoEquipo");
  const txt = (document.getElementById("trabajoEquipoText")?.value || "").trim();
  const chkNoDisp = document.getElementById("trabajoNoDisponible");
  const motivoNoDisp = (document.getElementById("trabajoMotivoNoDisponible")?.value || "").trim();
  const marcarNoDisp = !!chkNoDisp?.checked;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Guardando...';
    APP.utils.lucideRefresh(btn);

    const user = firebase.auth().currentUser;
    const uid = user?.uid || "";
    const email = user?.email || "";

    const cacheOrden = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
    const cacheEquipos = (cacheOrden?.equipos || []).filter(e => !e.eliminado);
    const cacheEquipo = cacheEquipos[_trabajoEquipoIdx];

    if (marcarNoDisp) {
      if (!cacheEquipo?.id) throw new Error("Equipo no encontrado");
      const equiposAll = await OrdenesService.updateEquipoNoDisponible({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo?.id,
        noDisponible: true,
        motivo: motivoNoDisp,
        uid,
        email
      });

      if (cacheOrden) cacheOrden.equipos = equiposAll;
      refrescarEquiposDeOrden(_trabajoOrdenId);
      cerrarTrabajoEquipoModal();
      Toast.show("⚠️ Equipo marcado como no disponible", "ok");
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save"></i> Guardar';
      APP.utils.lucideRefresh(btn);
      return;
    }

    if (cacheEquipo?.intervencion_no_disponible) {
      if (!cacheEquipo?.id) throw new Error("Equipo no encontrado");
      await OrdenesService.updateEquipoNoDisponible({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo?.id,
        noDisponible: false,
        motivo: "",
        uid,
        email
      });
    }

    const equiposAll = await OrdenesService.updateTrabajoTecnico({
      ordenId: _trabajoOrdenId,
      equipoIdx: _trabajoEquipoIdx,
      texto: txt,
      uid,
      email
    });
    // Actualizar cache local
    const cache = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
    if (cache) cache.equipos = equiposAll;

    // Refrescar UI - solo la tabla de equipos expandida si existe (desktop)
    refrescarEquiposDeOrden(_trabajoOrdenId);

    cerrarTrabajoEquipoModal();
    Toast.show("✅ Intervención guardada", "ok");
    
    // Reset button state
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar';
    APP.utils.lucideRefresh(btn);
  } catch (e) {
    console.error("❌ Error guardando trabajo del equipo:", e);
    Toast.show(`❌ Error al guardar: ${e?.message || e}`, "bad");
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar';
    APP.utils.lucideRefresh(btn);
  }
};

async function setEquipoNoDisponible({ ordenId, equipoId, noDisponible, motivo }) {
  if (!ordenId || !equipoId) return;

  try {
    const user = firebase.auth().currentUser;
    const uid = user?.uid || "";
    const email = user?.email || "";

    const equiposAll = await OrdenesService.updateEquipoNoDisponible({
      ordenId,
      equipoId,
      noDisponible,
      motivo,
      uid,
      email
    });

    const cache = APP.state.orders.find(x => x.ordenId === ordenId);
    if (cache) cache.equipos = equiposAll;

    refrescarEquiposDeOrden(ordenId);

    const modal = document.getElementById("modalEquiposMobile");
    if (modal && !modal.classList.contains("hidden")) {
      abrirEquiposMobile(ordenId);
    }

    Toast.show(noDisponible ? "⚠️ Equipo marcado como no disponible" : "✅ Equipo marcado como disponible", "ok");
  } catch (e) {
    console.error("❌ Error actualizando no disponible:", e);
    Toast.show("❌ Error al actualizar estado", "bad");
  }
}

// Modal simple para obs completa
window.verObsCompleta = function(ordenId, idx) {
  const o = APP.state.orders.find(x => x.ordenId === ordenId);
  const equipos = (o?.equipos || []).filter(e => !e.eliminado);
  const e = equipos[idx];
  if (!e) return;

  const obs = (e.observaciones || e.descripcion || e.nombre || "").toString();
  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  
  showTextModal(
    `📝 Observaciones · ${serial}`,
    obs || "Sin observaciones",
    !obs
  );
};

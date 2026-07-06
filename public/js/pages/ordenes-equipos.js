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
           <button class="btn btn-ghost equipo-obs-more" data-action="ver-obs-completa" data-orden-id="${ordenId}" data-idx="${idx}"><i data-lucide="eye"></i> Ver más</button>`
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

      const fotosCount = (Array.isArray(e.fotos) ? e.fotos : []).filter(f => f && f.deleted !== true && !!f.url).length;
      const fotosBadge = fotosCount > 0
        ? `<span class="equipo-fotos-badge" title="Fotos del equipo"><i data-lucide="camera"></i> ${fotosCount}</span>`
        : '';

      return `
        <div class="${cardClass}">
          <div class="equipo-card-header">
            <div class="equipo-card-info">
              <div class="equipo-card-serial"><i data-lucide="package"></i> ${escapeHtml(serial)} ${fotosBadge}</div>
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

            <button class="btn btn-ghost equipo-card-view"
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
let _trabajoEquipoId = null;
let _fotoViewerId = null;

function _activeFotosDe(equipo) {
  const fotos = Array.isArray(equipo?.fotos) ? equipo.fotos : [];
  return fotos.filter(f => f && f.deleted !== true && !!f.url);
}

function _puedeEliminarFotos() {
  const rol = String(APP.state.userRole || "").toLowerCase();
  const permitidos = [ROLES.ADMIN, ROLES.TECNICO, ROLES.TECNICO_OPERATIVO]
    .map(r => String(r || "").toLowerCase());
  return permitidos.includes(rol);
}

function _formatFotoTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("es-CO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (_) { return ""; }
}

function _genFotoId() {
  return `eq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function _sanitizeFileName(name) {
  return String(name || "foto").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "");
}

function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function _compressFoto(file, maxWidth = 1600, quality = 0.75) {
  const dataUrl = await _readFileAsDataURL(file);
  const img = await _loadImage(dataUrl);
  let w = img.width, h = img.height;
  if (w > maxWidth) {
    const ratio = maxWidth / w;
    w = maxWidth;
    h = Math.round(img.height * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo comprimir la imagen")), "image/jpeg", quality);
  });
}

function _resolveEquipoActual() {
  const o = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
  if (!o) return null;
  const equipos = (o.equipos || []).filter(e => !e.eliminado);
  return equipos[_trabajoEquipoIdx] || null;
}

function _renderEquipoFotos() {
  const grid = document.getElementById("equipoFotosGrid");
  const countEl = document.getElementById("equipoFotosCount");
  if (!grid || !countEl) return;

  const equipo = _resolveEquipoActual();
  const fotos = _activeFotosDe(equipo);
  countEl.textContent = String(fotos.length);

  if (!fotos.length) {
    grid.innerHTML = '<div class="equipo-fotos-empty">Sin fotos. Toca «Agregar foto» para capturar la primera.</div>';
    return;
  }

  grid.innerHTML = fotos.map(f => `
    <div class="equipo-foto-thumb" data-action="ver-foto-equipo" data-foto-id="${escapeHtml(f.id)}">
      <img src="${escapeHtml(f.url)}" alt="Foto del equipo" loading="lazy">
    </div>
  `).join("");
  APP.utils.lucideRefresh(grid);
}

function _setFotoStatus(msg, isError = false) {
  const el = document.getElementById("equipoFotosStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("equipo-fotos-status--error", !!isError);
}

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
  _trabajoEquipoId = e.id || null;

  const serial = (e.numero_de_serie || e.serial || e.SERIAL || "-").toString();
  const modelo = (e.modelo || e.MODEL || e.modelo_nombre || "-").toString();

  document.getElementById("trabajoEquipoTitle").textContent = `✍️ Intervención técnica · ${serial}`;
  document.getElementById("trabajoEquipoSub").textContent = `Modelo: ${modelo}`;

  // Reset and render fotos for this equipo
  const fotoInput = document.getElementById("equipoFotoInput");
  if (fotoInput) fotoInput.value = "";
  _setFotoStatus("");
  _renderEquipoFotos();
  _renderEquipoMateriales();
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
  if (_fotoViewerId) cerrarFotoEquipoViewer();
  _trabajoOrdenId = null;
  _trabajoEquipoIdx = null;
  _trabajoEquipoId = null;
};

window.agregarFotoEquipo = function() {
  const input = document.getElementById("equipoFotoInput");
  if (!input) return;
  input.value = "";
  input.click();
};

window.onEquipoFotoInputChange = async function(ev) {
  const file = ev?.target?.files && ev.target.files[0];
  if (!file) return;
  if (!/^image\//i.test(file.type || "")) {
    Toast.show("Selecciona una imagen válida", "bad");
    return;
  }
  if (!_trabajoOrdenId || !_trabajoEquipoId) {
    Toast.show("Abre la intervención primero", "bad");
    return;
  }

  const ordenId = _trabajoOrdenId;
  const equipoId = _trabajoEquipoId;
  const user = firebase.auth().currentUser;
  if (!user) { Toast.show("Sesión expirada", "bad"); return; }

  try {
    _setFotoStatus("Comprimiendo imagen…");
    const blob = await _compressFoto(file, 1600, 0.75);

    _setFotoStatus("Subiendo…");
    const ts = Date.now();
    const safe = _sanitizeFileName(file.name || "foto.jpg").replace(/\.[a-z0-9]+$/i, "") || "foto";
    const safeEquipo = _sanitizeFileName(equipoId);
    const fileName = `eq_${safeEquipo}_${ts}_${safe}.jpg`;
    const path = `ordenes_taller_fotos/${ordenId}/${fileName}`;
    const ref = firebase.storage().ref(path);
    await ref.put(blob, { contentType: "image/jpeg" });
    const url = await ref.getDownloadURL();

    const foto = {
      id: _genFotoId(),
      url,
      path,
      nota: "",
      uploaded_by_uid: user.uid || "",
      uploaded_by_email: user.email || "",
      uploaded_at: firebase.firestore.Timestamp.now(),
      deleted: false
    };

    const equiposAll = await OrdenesService.addEquipoFoto({ ordenId, equipoId, foto });

    const cache = APP.state.orders.find(x => x.ordenId === ordenId);
    if (cache) cache.equipos = equiposAll;

    _setFotoStatus("Foto subida ✓");
    _renderEquipoFotos();
    refrescarEquiposDeOrden(ordenId);
    Toast.show("✅ Foto agregada", "ok");
  } catch (e) {
    console.error("❌ Error subiendo foto del equipo:", e);
    _setFotoStatus("Error al subir la foto", true);
    Toast.show(`❌ Error al subir: ${e?.message || e}`, "bad");
  } finally {
    if (ev?.target) ev.target.value = "";
  }
};

window.verFotoEquipo = function(fotoId) {
  const equipo = _resolveEquipoActual();
  const fotos = _activeFotosDe(equipo);
  const foto = fotos.find(f => f.id === fotoId);
  if (!foto) return;

  _fotoViewerId = fotoId;
  const viewer = document.getElementById("equipoFotoViewer");
  const img = document.getElementById("equipoFotoViewerImg");
  const meta = document.getElementById("equipoFotoViewerMeta");
  const btnDel = document.getElementById("equipoFotoViewerDelete");

  if (img) img.src = foto.url;
  if (meta) {
    const fecha = _formatFotoTimestamp(foto.uploaded_at);
    const by = foto.uploaded_by_email ? escapeHtml(foto.uploaded_by_email) : "";
    meta.innerHTML = [fecha, by].filter(Boolean).join(" · ");
  }
  if (btnDel) btnDel.classList.toggle("hidden", !_puedeEliminarFotos());

  if (viewer) {
    viewer.classList.remove("hidden");
    viewer.classList.add("show");
  }
  APP.utils.lucideRefresh(viewer);
};

window.cerrarFotoEquipoViewer = function() {
  const viewer = document.getElementById("equipoFotoViewer");
  const img = document.getElementById("equipoFotoViewerImg");
  if (img) img.src = "";
  if (viewer) {
    viewer.classList.add("hidden");
    viewer.classList.remove("show");
  }
  _fotoViewerId = null;
};

window.eliminarFotoEquipoViewer = async function() {
  if (!_fotoViewerId) return;
  if (!_puedeEliminarFotos()) { Toast.show("No tienes permisos para eliminar fotos", "bad"); return; }
  if (!_trabajoOrdenId || !_trabajoEquipoId) return;

  // Capture state before any await — closing the viewer (or another action)
  // would otherwise clear these globals mid-flow.
  const ordenId = _trabajoOrdenId;
  const equipoId = _trabajoEquipoId;
  const fotoId = _fotoViewerId;

  // Close the viewer first so the confirm dialog (z-index 1500) isn't
  // hidden behind the viewer (z-index 1600).
  cerrarFotoEquipoViewer();

  if (!await Modal.confirm({ message: "¿Eliminar esta foto?", danger: true })) return;

  const user = firebase.auth().currentUser;
  try {
    const equiposAll = await OrdenesService.softDeleteEquipoFoto({
      ordenId,
      equipoId,
      fotoId,
      uid: user?.uid || "",
      email: user?.email || ""
    });
    const cache = APP.state.orders.find(x => x.ordenId === ordenId);
    if (cache) cache.equipos = equiposAll;

    _renderEquipoFotos();
    refrescarEquiposDeOrden(ordenId);
    Toast.show("✅ Foto eliminada", "ok");
  } catch (e) {
    console.error("❌ Error eliminando foto del equipo:", e);
    Toast.show(`❌ Error al eliminar: ${e?.message || e}`, "bad");
  }
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

/* ========================================
   Materiales / piezas del equipo (consumos)
   El técnico selecciona los materiales usados junto a la intervención; se
   guardan en ordenes_de_servicio/{id}/consumos (mismo esquema que el flujo
   legacy de trabajar-orden) y cotizar-orden los precarga como líneas.
   ======================================== */

let _materialPiezas = null;         // cache del catálogo (inventario_piezas activas)
let _materialSeleccionada = null;   // pieza elegida en el modal de selección
let _materialBuscarTimer = null;
let _materialWired = false;

function _normMaterial(x = "") {
  return String(x).toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

// modelo_norm con el mismo criterio que el flujo legacy (marca_modelo),
// para que analytics_piezas_modelo siga acumulando sobre las mismas claves.
function _modeloNormEquipo(equipo) {
  const m = _normMaterial(equipo?.modelo || equipo?.MODEL || equipo?.modelo_nombre || "");
  const b = _normMaterial(equipo?.marca || equipo?.fabricante || "");
  return b ? `${b}_${m}` : m;
}

function _nombrePieza(p) {
  return p?.descripcion || p?.nombre || (((p?.marca || "") + " " + (p?.modelo || "")).trim()) || "Pieza";
}

// Los consumos legacy de equipos sin id se guardaban bajo el número de serie;
// se conserva ese criterio para que cotizar-orden los siga casando.
function _consumoKeyEquipoActual() {
  const e = _resolveEquipoActual();
  if (!e) return null;
  return e.id || (e.numero_de_serie || e.serial || e.SERIAL || "").toString() || null;
}

function _ordenActualBloqueada() {
  const o = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
  return o?.cotizacion_emitida === true;
}

async function _ensureMaterialPiezas() {
  if (_materialPiezas) return _materialPiezas;
  const all = await PiezasService.getPiezas();
  _materialPiezas = (all || []).filter(p => p.activo !== false);
  return _materialPiezas;
}

async function _renderEquipoMateriales() {
  const list = document.getElementById("equipoMaterialesList");
  const countEl = document.getElementById("equipoMaterialesCount");
  if (!list || !countEl) return;
  const equipoKey = _consumoKeyEquipoActual();
  if (!_trabajoOrdenId || !equipoKey) { list.innerHTML = ""; countEl.textContent = "0"; return; }

  list.innerHTML = '<div class="equipo-fotos-empty">Cargando materiales…</div>';
  let items = [];
  try {
    items = await OrdenesService.getConsumos(_trabajoOrdenId, { equipoId: equipoKey });
  } catch (e) {
    console.error("❌ Error cargando materiales del equipo:", e);
    list.innerHTML = '<div class="equipo-fotos-empty">No se pudieron cargar los materiales.</div>';
    return;
  }

  countEl.textContent = String(items.length);
  if (!items.length) {
    list.innerHTML = '<div class="equipo-fotos-empty">Sin materiales. Toca «Seleccionar materiales» para registrar el primero.</div>';
    return;
  }

  list.innerHTML = items.map(it => `
    <div class="equipo-material-item">
      <div class="equipo-material-main">
        <span class="equipo-material-name">${escapeHtml(it.pieza_nombre || "Pieza")}</span>
        <span class="equipo-material-meta">${it.sku ? escapeHtml(it.sku) + " · " : ""}${Number(it.qty || 0)} × ${FMT.money(it.precio_unit || 0)} · ${escapeHtml(it.tipo || "cobro")}</span>
      </div>
      <button type="button" class="btn btn-ghost equipo-material-del" data-action="eliminar-material-equipo" data-linea-id="${escapeHtml(it.id)}" title="Eliminar material">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `).join("");
  APP.utils.lucideRefresh(list);
}

function _materialSubtotalRefresh() {
  const out = document.getElementById("materialSubtotal");
  if (!out) return;
  const qty = Math.max(1, parseInt(document.getElementById("materialQty")?.value || "1", 10));
  const tipo = document.getElementById("materialTipo")?.value || "cobro";
  const precio = Number(document.getElementById("materialPrecio")?.value || 0);
  if (!_materialSeleccionada) { out.textContent = ""; return; }
  const sub = tipo === "cobro" ? qty * precio : 0;
  out.innerHTML = `Subtotal: <strong>${FMT.money(sub)}</strong>${tipo === "garantia" ? " (garantía — no se cobra)" : ""}`;
}

function _materialRenderSugerencias(q) {
  const sug = document.getElementById("materialSugerencias");
  if (!sug) return;
  const query = (q || "").trim();
  if (!query) { sug.innerHTML = ""; return; }
  const piezas = _materialPiezas || [];
  const list = PiezaSearch.search(piezas, query.toLowerCase());
  if (!list.length) { sug.innerHTML = '<div class="equipo-fotos-empty">Sin coincidencias.</div>'; return; }
  sug.innerHTML = list.map(p => {
    const stock = Number(p.cantidad || 0);
    const sinControl = p.sin_control_inventario === true;
    const agotada = !sinControl && stock <= 0;
    return `<button type="button" class="equipo-material-chip" ${agotada ? "disabled" : ""}
      data-action="pick-material-equipo" data-pieza-id="${escapeHtml(p.id)}"
      title="Stock: ${sinControl ? "sin control" : stock}">
      <span>${escapeHtml(_nombrePieza(p))}</span>
      <span class="mono">${escapeHtml(p.sku || "-")}</span>
      <span>${FMT.money(p.precio_venta || 0)}</span>
    </button>`;
  }).join("");
}

function _materialWireInputs() {
  if (_materialWired) return;
  _materialWired = true;
  document.getElementById("materialBuscar")?.addEventListener("input", (e) => {
    clearTimeout(_materialBuscarTimer);
    _materialBuscarTimer = setTimeout(() => _materialRenderSugerencias(e.target.value), 150);
  });
  document.getElementById("materialQty")?.addEventListener("input", _materialSubtotalRefresh);
  document.getElementById("materialTipo")?.addEventListener("change", _materialSubtotalRefresh);
  document.getElementById("materialPrecio")?.addEventListener("input", _materialSubtotalRefresh);
}

window.abrirMaterialEquipoModal = async function() {
  const equipo = _resolveEquipoActual();
  if (!_trabajoOrdenId || !equipo) { Toast.show("Abre la intervención primero", "bad"); return; }
  if (_ordenActualBloqueada()) { Toast.show("Orden bloqueada: la cotización ya fue emitida", "warn"); return; }

  _materialWireInputs();
  _materialSeleccionada = null;

  const serial = (equipo.numero_de_serie || equipo.serial || equipo.SERIAL || "-").toString();
  const modelo = (equipo.modelo || equipo.MODEL || equipo.modelo_nombre || "-").toString();
  const sub = document.getElementById("materialEquipoSub");
  if (sub) sub.textContent = `Serie: ${serial} · Modelo: ${modelo}`;

  const buscar = document.getElementById("materialBuscar");
  if (buscar) buscar.value = "";
  const sugEl = document.getElementById("materialSugerencias");
  if (sugEl) sugEl.innerHTML = '<div class="equipo-fotos-empty">Cargando catálogo…</div>';
  const selEl = document.getElementById("materialSeleccion");
  if (selEl) selEl.innerHTML = "";
  const qtyEl = document.getElementById("materialQty");
  if (qtyEl) qtyEl.value = "1";
  const tipoEl = document.getElementById("materialTipo");
  if (tipoEl) tipoEl.value = "cobro";
  const precioEl = document.getElementById("materialPrecio");
  if (precioEl) precioEl.value = "0";
  _materialSubtotalRefresh();

  const modal = document.getElementById("modalMaterialEquipo");
  if (modal) APP.utils.show(modal);
  APP.utils.lucideRefresh(modal);

  try {
    await _ensureMaterialPiezas();
    if (sugEl) sugEl.innerHTML = "";
    setTimeout(() => buscar?.focus(), 50);
  } catch (e) {
    console.error("❌ Error cargando catálogo de piezas:", e);
    if (sugEl) sugEl.innerHTML = '<div class="equipo-fotos-empty">No se pudo cargar el catálogo.</div>';
  }
};

window.cerrarMaterialEquipoModal = function() {
  const modal = document.getElementById("modalMaterialEquipo");
  if (modal) APP.utils.hide(modal);
  _materialSeleccionada = null;
};

window.pickMaterialEquipo = function(piezaId) {
  const p = (_materialPiezas || []).find(x => x.id === piezaId);
  if (!p) return;
  _materialSeleccionada = p;
  const selEl = document.getElementById("materialSeleccion");
  if (selEl) {
    const stock = p.sin_control_inventario === true ? "sin control" : Number(p.cantidad || 0);
    selEl.innerHTML = `Seleccionado: <strong>${escapeHtml(_nombrePieza(p))}</strong> (${escapeHtml(p.sku || "-")}) · Stock: ${stock}`;
  }
  const precioEl = document.getElementById("materialPrecio");
  if (precioEl) precioEl.value = String(Number(p.precio_venta || 0));
  _materialSubtotalRefresh();
};

window.confirmarMaterialEquipo = async function() {
  const btn = document.getElementById("btnAgregarMaterial");
  const equipo = _resolveEquipoActual();
  const equipoKey = _consumoKeyEquipoActual();
  if (!_trabajoOrdenId || !equipo || !equipoKey) { Toast.show("Abre la intervención primero", "bad"); return; }
  if (!_materialSeleccionada) { Toast.show("Selecciona una pieza", "warn"); return; }
  if (_ordenActualBloqueada()) { Toast.show("Orden bloqueada: la cotización ya fue emitida", "warn"); return; }

  const qty = Math.max(1, parseInt(document.getElementById("materialQty")?.value || "1", 10));
  const tipo = document.getElementById("materialTipo")?.value === "garantia" ? "garantia" : "cobro";
  const precio = Math.max(0, Number(document.getElementById("materialPrecio")?.value || 0));
  const subtotal = +((tipo === "cobro" ? qty * precio : 0)).toFixed(2);
  const user = firebase.auth().currentUser;

  try {
    if (btn) btn.disabled = true;

    // Releer la pieza para validar stock real antes de descontar.
    const piezaDB = await PiezasService.getPieza(_materialSeleccionada.id);
    if (!piezaDB) { Toast.show("La pieza ya no existe en el catálogo", "bad"); return; }
    const sinControl = piezaDB.sin_control_inventario === true;
    if (!sinControl && Number(piezaDB.cantidad || 0) < qty) {
      Toast.show(`Stock insuficiente (${Number(piezaDB.cantidad || 0)} disponibles)`, "warn");
      return;
    }

    await OrdenesService.addConsumo(_trabajoOrdenId, {
      equipoId: equipoKey,
      pieza_id: _materialSeleccionada.id,
      pieza_nombre: _nombrePieza(_materialSeleccionada),
      sku: _materialSeleccionada.sku || "",
      qty,
      precio_unit: precio,
      tipo,
      subtotal,
      added_by_uid: user?.uid || null,
      added_by_email: user?.email || null,
      added_at: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (!sinControl) {
      await PiezasService.ajustarDelta(_materialSeleccionada.id, -qty);
      const cache = (_materialPiezas || []).find(x => x.id === _materialSeleccionada.id);
      if (cache) cache.cantidad = Number(cache.cantidad || 0) - qty;
    }

    // Alimenta las recomendaciones "más usadas por modelo" (analytics).
    if (tipo === "cobro") {
      try { await PiezasService.incrementarUsoAnalytics(_modeloNormEquipo(equipo), _materialSeleccionada.id); }
      catch (e) { console.warn("No se pudo registrar analytics de pieza:", e); }
    }

    cerrarMaterialEquipoModal();
    Toast.show("✅ Material registrado", "ok");
    _renderEquipoMateriales();
  } catch (e) {
    console.error("❌ Error registrando material:", e);
    Toast.show(`❌ Error al registrar: ${e?.message || e}`, "bad");
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.eliminarMaterialEquipo = async function(lineaId) {
  if (!_trabajoOrdenId || !lineaId) return;
  if (_ordenActualBloqueada()) { Toast.show("Orden bloqueada: la cotización ya fue emitida", "warn"); return; }
  if (!await Modal.confirm({ message: "¿Eliminar este material?", danger: true })) return;
  try {
    await OrdenesService.deleteConsumo(_trabajoOrdenId, lineaId);
    Toast.show("Material eliminado", "ok");
    _renderEquipoMateriales();
  } catch (e) {
    console.error("❌ Error eliminando material:", e);
    Toast.show(`❌ Error al eliminar: ${e?.message || e}`, "bad");
  }
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

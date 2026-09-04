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
        { name: 'antena',  icon: 'radio-tower' },
        { name: 'cubrepolvo', icon: 'shield' }
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

  // Al editar el SERIAL se decora el campo con SerialField (auditoría
  // 2026-08-04, R3): este lápiz es la edición de serial más frecuente de la app
  // y era el único punto de captura sin ninguna señal del pool — el chip que se
  // ve en la tabla es decoración de lectura, no valida lo que escribes. Ahora
  // el chip dice, mientras tecleas, de quién es el radio y dónde figura.
  const esSerial = campo === "numero_de_serie";
  const nuevoValor = await Modal.prompt({
    title: `Editar ${etiqueta}`,
    defaultValue: valorActual ?? "",
    multiline: campo === "observaciones",
    onMount: !esSerial ? null : (input) => {
      if (typeof SerialField === "undefined" || typeof EquiposPoolService === "undefined") return;
      SerialField.adjuntar(input, {
        clienteId: () => target.orden?.cliente_id || null,
        modelo: () => ({ modelo_id: target.equipo?.modelo_id || null,
                         modelo_label: target.equipo?.modelo || "" }),
      });
    },
  });
  if (nuevoValor === null) return;
  // El serial cambió: la ficha vieja del pool queda cacheada en SerialField.
  if (esSerial && typeof SerialField !== "undefined") {
    SerialField.invalidar(valorActual);
    SerialField.invalidar(nuevoValor);
  }

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

    // Si la tabla estaba filtrada por el serial VIEJO, el re-render la dejaría
    // en "sin coincidencias" y parecería que el radio se perdió: se re-apunta
    // el buscador al serial nuevo (ordenes-render.js).
    if (esSerial && typeof reapuntarBusquedaSerialOrden === "function") {
      reapuntarBusquedaSerialOrden(target.ordenId, valorActual || "", valorLimpio);
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
  ["bateria", "clip", "cargador", "fuente", "antena", "cubrepolvo"].forEach(campo => {
    form.elements[campo].checked = !!datosEquipo[campo];
  });

  document.getElementById("modalAccesorios").style.display = "block";
};


window.activarModoAccesorios = function (ordenId) {
  const campos = ["bateria", "clip", "cargador", "fuente", "antena", "cubrepolvo"];
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

// Chips de accesorios vivos al PRIMER click (auditoría órdenes P2): antes el
// click en un chip fuera del modo lote se perdía — había que descubrir
// "Accesorios en lote" en el menú del detalle. Delegado: si el modo no está
// activo, lo activa y aplica el toggle del chip clickeado. Con el modo activo
// este listener no llega a correr (el listener directo del chip hace
// stopPropagation). Solo chips de la tabla de equipos (.accesorios-group);
// los de la leyenda/popover no cuentan.
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.accesorios-group .accesorio-item');
  if (!chip) return;
  const filaDetalle = chip.closest('tr.filaDetalle');
  if (!filaDetalle || filaDetalle.dataset.modoAccesorios === "true") return;
  const ordenId = filaDetalle.dataset.ordenId;
  if (!ordenId) return;
  activarModoAccesorios(ordenId);
  // Re-despacha sobre el chip: ya con el listener directo, aplica el toggle
  // que el usuario pidió con ese primer click.
  chip.click();
});

// nombreClienteDe, getEstadoClass, tipoChip, estadoCompacto → pages/ordenes-state.js

// actualizarResumen → pages/ordenes-render.js

// ── Condición particular por serial (equipos_condiciones) ─────────────────
// Lo que YA está registrado sobre un serial, aparte de esta orden. Petición
// de Alberto al aprobar lo de Solangel (2026-09-04): si el radio vuelve a
// taller por cualquier proceso, el técnico tiene que verlo sin volver a
// descifrar el mismo problema. Best-effort: sin servicio o sin red, nada.
async function _mostrarCondicionVigente(serial, idx) {
  const box = document.getElementById("trabajoCondicionVigente");
  if (!box) return;
  box.style.display = "none";
  box.innerHTML = "";
  if (typeof EquiposCondicionesService === "undefined") return;
  let c = null;
  try { c = await EquiposCondicionesService.buscar(serial); } catch (e) { c = null; }
  // El modal navega entre equipos (Anterior/Siguiente): si ya cambió, no pintar.
  if (!c || _trabajoEquipoIdx !== idx) return;
  const f = c.registrado_at?.toDate ? c.registrado_at.toDate().toLocaleDateString("es-PA") : "";
  const meta = [c.por_email, f, c.orden_id ? "orden " + c.orden_id : ""].filter(Boolean).join(" · ");
  box.innerHTML = `⚠ <b>Este equipo ya tiene una condición registrada:</b> ${escapeHtml(String(c.condicion || ""))}
    <div style="font-size:11.5px;margin-top:3px;">${escapeHtml(meta)} — si sigue igual no hace falta volver a marcarla; si cambió, márcala abajo con el texto nuevo.</div>`;
  box.style.display = "";
}

// Chip amarillo en las tarjetas (móvil) con la condición registrada por
// serial. Se pinta DESPUÉS del render, sin bloquearlo.
async function _decorarCondicionesEnTarjetas(list, equipos) {
  if (!list || typeof EquiposCondicionesService === "undefined") return;
  const seriales = (equipos || []).map(e => String(e.numero_de_serie || e.serial || e.SERIAL || "")).filter(s => s.trim());
  if (!seriales.length) return;
  let mapa;
  try { mapa = await EquiposCondicionesService.buscarVarios(seriales); } catch (e) { return; }
  if (!mapa.size) return;
  list.querySelectorAll(".equipo-card[data-serial]").forEach(card => {
    const serial = card.getAttribute("data-serial") || "";
    const c = mapa.get(EquiposCondicionesService.normalizar(serial));
    if (!c) return;
    const host = card.querySelector(".equipo-card-serial");
    if (!host || host.querySelector(".eqcond-chip")) return;
    const chip = document.createElement("a");
    chip.className = "eqpool-chip eqpool-chip-aviso eqcond-chip";
    chip.style.cssText = "text-decoration:none;cursor:pointer;margin-left:6px;";
    chip.textContent = `⚠ condición: ${EquiposCondicionesService.resumen(c.condicion, 40)}`;
    chip.title = `Condición registrada por serial: ${c.condicion}${c.orden_id ? " (orden " + c.orden_id + ")" : ""}. Click para ver la ficha.`;
    chip.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); if (window.EquipoFicha) EquipoFicha.abrir(serial); });
    host.appendChild(chip);
  });
}

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
      const descartado = !!e.descartado_revision;
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
        <div class="${cardClass}" data-serial="${escapeHtml(serial)}">
          <div class="equipo-card-header">
            <div class="equipo-card-info">
              <div class="equipo-card-serial"><i data-lucide="package"></i> ${escapeHtml(serial)} ${fotosBadge}</div>
              <div class="equipo-card-model">Modelo: <span class="equipo-card-model-value">${escapeHtml(modelo)}</span></div>
            </div>
            ${descartado
              ? `<div class="equipo-status-badge equipo-status-badge--warn" style="background:#FEF2F2;color:#991B1B;border-color:#FECACA;" title="${escapeHtml((e.descarte_motivo || '').toString())}"><i data-lucide="ban"></i> Descartado</div>`
              : (noDisponible
                ? '<div class="equipo-status-badge equipo-status-badge--warn"><i data-lucide="ban"></i> No disponible</div>'
                : (e.condicion_especial
                  ? `<div class="equipo-status-badge equipo-status-badge--warn" style="background:#FFFBEB;color:#92400E;border-color:#FCD34D;" title="${escapeHtml((e.condicion_texto || '').toString())}"><i data-lucide="alert-triangle"></i> Con condición</div>`
                  : (e.trabajo_tecnico ? '<div class="equipo-status-badge equipo-status-badge--ok">✓ OK</div>' : '')))
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

  _decorarCondicionesEnTarjetas(list, equipos);

  // Buscador de serial (misma petición que en la tabla de escritorio). Al
  // cambiar de orden se limpia; si es un refresco de la MISMA orden se
  // conserva lo escrito y se vuelve a aplicar sobre las tarjetas nuevas.
  const buscarInput = document.getElementById("equiposMobileBuscar");
  if (buscarInput && _equiposMobileOrdenId !== ordenId) buscarInput.value = "";
  _equiposMobileOrdenId = ordenId;
  const barraBuscar = document.getElementById("equiposMobileBuscador");
  if (barraBuscar) {
    const mostrar = equipos.length >= EQUIPOS_BUSCADOR_MIN_MOBILE;
    barraBuscar.style.display = mostrar ? '' : 'none';
    if (!mostrar && buscarInput) buscarInput.value = "";
  }
  aplicarBusquedaSerialMobile();

  APP.utils.lucideRefresh(modal);
  if (modal) APP.utils.show(modal);
};

// ── Buscador de serial en el modal de equipos (móvil) ─────────────────────
// Espejo de la barra de la tabla de escritorio (ordenes-render.js): filtra las
// tarjetas por serial con la identidad tolerante del pool. La lista se
// re-genera entera en cada refresco, por eso el filtro se re-aplica al final
// de abrirEquiposMobile.
const EQUIPOS_BUSCADOR_MIN_MOBILE = 5;
let _equiposMobileOrdenId = null;

function _normSerialMobile(v) {
  if (typeof EquiposPoolService !== "undefined") return EquiposPoolService.normalizarSerial(v);
  return String(v == null ? "" : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function aplicarBusquedaSerialMobile() {
  const input = document.getElementById("equiposMobileBuscar");
  const info = document.getElementById("equiposMobileBuscarInfo");
  const barra = document.getElementById("equiposMobileBuscador");
  const list = document.getElementById("equiposMobileList");
  if (!input || !list) return;

  const cards = [...list.querySelectorAll(".equipo-card")];
  cards.forEach(c => c.classList.remove("equipo-card--oculto", "equipo-card--hit"));
  if (barra) barra.classList.remove("sin-resultados");

  const q = _normSerialMobile(input.value);
  if (!q) { if (info) info.textContent = ""; return; }

  let hits = 0;
  cards.forEach(c => {
    if (_normSerialMobile(c.dataset.serial || "").includes(q)) { c.classList.add("equipo-card--hit"); hits++; }
    else c.classList.add("equipo-card--oculto");
  });
  if (info) {
    info.textContent = hits
      ? `${hits} de ${cards.length} equipo${cards.length === 1 ? "" : "s"}`
      : "Ningún serial de esta orden coincide";
  }
  if (!hits && barra) barra.classList.add("sin-resultados");
}
window.aplicarBusquedaSerialMobile = aplicarBusquedaSerialMobile;

document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "equiposMobileBuscar") aplicarBusquedaSerialMobile();
});
document.addEventListener("keydown", (e) => {
  if (!e.target || e.target.id !== "equiposMobileBuscar") return;
  if (e.key === "Escape") {
    e.stopPropagation();          // Escape limpia el filtro, no cierra el modal
    e.target.value = "";
    aplicarBusquedaSerialMobile();
  } else if (e.key === "Enter") {
    e.preventDefault();
  }
});

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

  // Lote (auditoría M3): checkboxes con los DEMÁS equipos de la orden para
  // aplicarles el mismo texto de intervención — una orden de 10 radios
  // idénticos costaba repetir este modal 10 veces (~3N+1 interacciones).
  const wrapOtros = document.getElementById("trabajoAplicarOtros");
  if (wrapOtros) {
    const escBatch = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
    const otros = equipos.map((eq, i) => ({ eq, i })).filter(x => x.i !== idx);
    if (!otros.length) {
      wrapOtros.style.display = "none";
      wrapOtros.innerHTML = "";
    } else {
      wrapOtros.style.display = "";
      wrapOtros.innerHTML = `
        <details style="margin:10px 0 0;">
          <summary style="cursor:pointer; font-size:13px; color:var(--fg-2);">
            Aplicar esta intervención también a otros equipos de la orden (${otros.length}) — solo el texto</summary>
          <div style="max-height:140px; overflow-y:auto; margin-top:6px; display:flex; flex-direction:column; gap:4px;">
            ${otros.map(({ eq, i }) => {
              const s = escBatch(String(eq.numero_de_serie || eq.serial || eq.SERIAL || "-"));
              const ya = (eq.trabajo_tecnico || "").trim()
                ? ' · <span style="color:#B45309;">ya tiene intervención (se reemplaza)</span>' : "";
              const noDisp = eq.intervencion_no_disponible
                ? ' · <span style="color:var(--fg-3);">marcado no disponible</span>' : "";
              return `<label style="display:flex; gap:6px; align-items:center; font-size:13px;">
                <input type="checkbox" class="trabajo-aplicar-chk" value="${i}">
                <span style="font-family:var(--font-mono);">${s}</span>${ya}${noDisp}
              </label>`;
            }).join("")}
          </div>
        </details>`;
    }
  }

  const chkNoDisp = document.getElementById("trabajoNoDisponible");
  const motivoNoDisp = document.getElementById("trabajoMotivoNoDisponible");
  const isNoDisp = !!e.intervencion_no_disponible;
  if (chkNoDisp) chkNoDisp.checked = isNoDisp;
  if (motivoNoDisp) {
    motivoNoDisp.value = (e.motivo_no_disponible || "").toString();
    motivoNoDisp.disabled = !isNoDisp;
  }
  if (txtEl) txtEl.disabled = isNoDisp;

  // Descarte en revisión — SOLO en órdenes de ENTRADA (petición Solangel
  // 2026-09-03): la inspección de devueltos no lleva QC, así que sin esto un
  // radio descartado ahí no quedaba en ningún registro. Excluyente con "no
  // disponible": un equipo que no llegó no se puede descartar.
  const esEntrada = typeof esOrdenEntrada === 'function' && esOrdenEntrada(o);
  const descarteCtrl = document.getElementById("trabajoDescarteCtrl");
  const chkDescarte = document.getElementById("trabajoDescartado");
  const motivoDescarte = document.getElementById("trabajoDescarteMotivo");
  const avisoDescarte = document.getElementById("trabajoDescarteAviso");
  const isDescartado = esEntrada && !!e.descartado_revision;
  if (descarteCtrl) descarteCtrl.style.display = esEntrada ? "" : "none";
  const _syncDescarteUI = () => {
    const checked = !!chkDescarte?.checked;
    if (motivoDescarte) motivoDescarte.disabled = !checked;
    if (avisoDescarte) avisoDescarte.style.display = checked ? "" : "none";
    if (chkNoDisp) chkNoDisp.disabled = checked;
  };
  if (chkDescarte) {
    chkDescarte.checked = isDescartado;
    chkDescarte.disabled = isNoDisp;
    chkDescarte.onchange = () => {
      if (!chkDescarte.checked && motivoDescarte) motivoDescarte.value = "";
      _syncDescarteUI();
      // Un descartado no lleva condición: ya no circula.
      if (chkDescarte.checked && chkCondicion) { chkCondicion.checked = false; if (txtCondicion) txtCondicion.value = ""; }
      _syncCondicionUI();
      if (chkDescarte.checked) setTimeout(() => motivoDescarte?.focus(), 0);
    };
  }
  if (motivoDescarte) motivoDescarte.value = isDescartado ? (e.descarte_motivo || "").toString() : "";
  _syncDescarteUI();

  // Condición particular (petición Solangel 2026-09-04) — en CUALQUIER tipo
  // de orden: el radio funciona, pero con una limitación que el taller no
  // puede resolver. Excluyente con "no disponible" (no se revisó) y con el
  // descarte (ya no circula). Aquí solo se estampa en el equipo; el registro
  // por serial lo escribe la firma del QC o el cierre de la ENTRADA.
  const chkCondicion = document.getElementById("trabajoCondicion");
  const txtCondicion = document.getElementById("trabajoCondicionTexto");
  const avisoCondicion = document.getElementById("trabajoCondicionAviso");
  const isConCondicion = !!e.condicion_especial;
  const _syncCondicionUI = () => {
    const checked = !!chkCondicion?.checked;
    if (txtCondicion) txtCondicion.disabled = !checked;
    if (avisoCondicion) avisoCondicion.style.display = checked ? "" : "none";
    if (chkCondicion) chkCondicion.disabled = !!chkNoDisp?.checked || !!chkDescarte?.checked;
  };
  if (chkCondicion) {
    chkCondicion.checked = isConCondicion;
    chkCondicion.onchange = () => {
      if (!chkCondicion.checked && txtCondicion) txtCondicion.value = "";
      _syncCondicionUI();
      if (chkCondicion.checked) setTimeout(() => txtCondicion?.focus(), 0);
    };
  }
  if (txtCondicion) txtCondicion.value = isConCondicion ? (e.condicion_texto || "").toString() : "";
  _syncCondicionUI();
  // Lo que YA está registrado por serial, para que el técnico no vuelva a
  // descifrar el mismo problema (pedido de Alberto al aprobar la petición).
  _mostrarCondicionVigente(serial, idx);

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
      // Un equipo que no llegó no se revisó: sin condición que marcar.
      if (chkCondicion && checked) { chkCondicion.checked = false; if (txtCondicion) txtCondicion.value = ""; }
      _syncCondicionUI();
      if (chkDescarte) {
        if (checked) { chkDescarte.checked = false; if (motivoDescarte) motivoDescarte.value = ""; }
        chkDescarte.disabled = checked;
        _syncDescarteUI();
        // _syncDescarteUI re-habilita chkNoDisp cuando el descarte quedó
        // desmarcado — correcto en ambos sentidos del toggle.
      }
    };
  }

  // Navegación entre equipos (auditoría órdenes P1.7): pasar al siguiente
  // sin cerrar/reabrir el modal. Con texto editado y sin guardar, pregunta
  // antes de descartar.
  const nav = document.getElementById("trabajoNav");
  if (nav) {
    const total = equipos.length;
    nav.style.display = total > 1 ? "flex" : "none";
    const pos = document.getElementById("trabajoNavPos");
    if (pos) pos.textContent = `Equipo ${idx + 1} de ${total}`;
    const original = (e.trabajo_tecnico || "").toString().trim();
    const irA = async (destino) => {
      if (destino < 0 || destino >= total) return;
      const txtAhora = (document.getElementById("trabajoEquipoText")?.value || "").trim();
      if (txtAhora !== original) {
        const ok = await Modal.confirm({
          title: "Texto sin guardar",
          message: "La intervención de este equipo tiene cambios sin guardar. ¿Pasar al otro equipo y descartarlos?",
          confirmLabel: "Cambiar de equipo",
        });
        if (!ok) return;
      }
      abrirTrabajoEquipoModal(ordenId, destino);
    };
    const prev = document.getElementById("trabajoNavPrev");
    const next = document.getElementById("trabajoNavNext");
    if (prev) { prev.disabled = idx === 0; prev.onclick = () => irA(idx - 1); }
    if (next) { next.disabled = idx === total - 1; next.onclick = () => irA(idx + 1); }
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
    await CargaDiferida.storage(); // SDK diferido (P3.15): se paga al subir foto
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
let _materialEquipoActual = null;   // equipo del modal (para sugerencias por modelo)
let _materialOtros = [];            // otros equipos de la orden [{equipo, key}] (lote P1.6)
let _materialBuscarTimer = null;
let _materialWired = false;
// Pieza FUERA DE CATÁLOGO (2026-09-04, petición de Solangel): el catálogo
// inventario_piezas tiene 16 piezas, todas Hytera. Para un Kenwood NX-420 el
// técnico no podía registrar NADA — el modal exigía elegir del catálogo — y
// terminaba en una hoja a mano que se perdía antes de llegar a cotización.
// Con el modo activo el consumo se guarda con `fuera_catalogo: true`,
// `pieza_id: null`, sin descontar stock ni alimentar analytics; bodega lo
// recibe señalado en el resumen para cargarlo al catálogo.
let _materialFueraCat = false;

function _materialFueraCatSet(activo, { nombreSugerido } = {}) {
  _materialFueraCat = !!activo;
  const bloque = document.getElementById("materialFueraCatBloque");
  const btn = document.getElementById("btnMaterialFueraCat");
  const selEl = document.getElementById("materialSeleccion");
  const sugEl = document.getElementById("materialSugerencias");
  const buscar = document.getElementById("materialBuscar");
  if (bloque) bloque.classList.toggle("hidden", !_materialFueraCat);
  if (sugEl) sugEl.classList.toggle("hidden", _materialFueraCat);
  if (buscar) buscar.classList.toggle("hidden", _materialFueraCat);
  if (btn) {
    btn.innerHTML = _materialFueraCat
      ? '<i data-lucide="search"></i> Volver a buscar en el catálogo'
      : '<i data-lucide="pencil-line"></i> No está en el catálogo — escribirla a mano';
    APP.utils.lucideRefresh(btn);
  }
  if (_materialFueraCat) {
    _materialSeleccionada = null;
    if (selEl) selEl.innerHTML = "";
    const nom = document.getElementById("materialFcNombre");
    if (nom) {
      if (nombreSugerido && !nom.value.trim()) nom.value = nombreSugerido;
      setTimeout(() => nom.focus(), 30);
    }
  } else {
    const nom = document.getElementById("materialFcNombre");
    const sku = document.getElementById("materialFcSku");
    if (nom) nom.value = "";
    if (sku) sku.value = "";
    setTimeout(() => buscar?.focus(), 30);
  }
  _materialSubtotalRefresh();
}

window.toggleMaterialFueraCatalogo = function(nombreSugerido) {
  _materialFueraCatSet(!_materialFueraCat, { nombreSugerido: typeof nombreSugerido === "string" ? nombreSugerido : "" });
};

// Lo que se va a registrar cuando el modo fuera de catálogo está activo.
function _materialFueraCatDatos() {
  const nombre = (document.getElementById("materialFcNombre")?.value || "").trim();
  const sku = (document.getElementById("materialFcSku")?.value || "").trim();
  return { nombre, sku };
}

function _nombrePieza(p) {
  // Prioriza el nombre corto del catálogo; la descripción (texto largo de QBO)
  // es el fallback — misma prioridad que el drawer de cotizar-orden.
  return p?.nombre || p?.descripcion || (((p?.marca || "") + " " + (p?.modelo || "")).trim()) || "Pieza";
}

function _consumoKeyEquipoActual() {
  return OrdenesService.consumoKeyDe(_resolveEquipoActual());
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
        <span class="equipo-material-meta">${it.sku ? escapeHtml(it.sku) + " · " : ""}${Number(it.qty || 0)} × ${FMT.money(it.precio_unit || 0)} · ${escapeHtml(it.tipo || "cobro")}${it.fuera_catalogo ? ' · <span class="equipo-material-fc" title="Escrita a mano: no está en el catálogo de piezas">fuera de catálogo</span>' : ""}</span>
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
  const listo = _materialFueraCat ? !!_materialFueraCatDatos().nombre : !!_materialSeleccionada;
  if (!listo) { out.textContent = ""; return; }
  const sub = tipo === "cobro" ? qty * precio : 0;
  out.innerHTML = `Subtotal: <strong>${FMT.money(sub)}</strong>${tipo === "garantia" ? " (garantía — no se cobra)" : ""}`;
}

// Sugerencias al abrir (auditoría órdenes P1.6): la analítica "más usadas
// por modelo" (analytics_piezas_modelo, escrita en cada cobro) existía SIN
// ningún lector — el buscador exigía teclear siempre. Índice ya desplegado:
// (modelo_norm ASC, usos_cobro DESC).
async function _materialSugerenciasIniciales(equipo) {
  const sug = document.getElementById("materialSugerencias");
  if (!sug || !equipo) return;
  try {
    const modeloNorm = PiezasService.modeloNormDeEquipo(equipo);
    if (!modeloNorm) { sug.innerHTML = ""; return; }
    const snap = await firebase.firestore().collection("analytics_piezas_modelo")
      .where("modelo_norm", "==", modeloNorm)
      .orderBy("usos_cobro", "desc")
      .limit(8).get();
    if (snap.empty) { sug.innerHTML = ""; return; }
    const porId = new Map((_materialPiezas || []).map(p => [p.id, p]));
    const filas = [];
    snap.forEach(d => {
      const a = d.data();
      const p = porId.get(a.pieza_id);
      if (!p) return;
      const stock = Number(p.cantidad || 0);
      const sinControl = p.sin_control_inventario === true;
      const agotada = !sinControl && stock <= 0;
      filas.push(`<button type="button" class="equipo-material-chip" ${agotada ? "disabled" : ""}
        data-action="pick-material-equipo" data-pieza-id="${escapeHtml(p.id)}"
        title="Usada ${Number(a.usos_cobro || 0)} vez(ces) en este modelo · Stock: ${sinControl ? "sin control" : stock}">
        <span>${escapeHtml(_nombrePieza(p))}</span>
        <span class="mono">${escapeHtml(p.sku || "-")}</span>
        <span>${FMT.money(p.precio_venta || 0)}</span>
      </button>`);
    });
    sug.innerHTML = filas.length
      ? `<div style="font-size:12px;color:var(--fg-3);padding:2px 0 4px;">Más usadas en este modelo:</div>` + filas.join("")
      : "";
  } catch (e) { sug.innerHTML = ""; /* sin sugerencias no estorba */ }
}

function _materialRenderSugerencias(q) {
  const sug = document.getElementById("materialSugerencias");
  if (!sug) return;
  const query = (q || "").trim();
  // Con el buscador vacío vuelven las sugerencias por modelo (P1.6).
  if (!query) { _materialSugerenciasIniciales(_materialEquipoActual); return; }
  const piezas = _materialPiezas || [];
  const list = PiezaSearch.search(piezas, query.toLowerCase());
  if (!list.length) {
    // Sin coincidencias ya no es un callejón: se ofrece registrarla a mano
    // con lo que el técnico escribió como nombre inicial.
    sug.innerHTML = `<div class="equipo-fotos-empty">Sin coincidencias en el catálogo.</div>
      <button type="button" class="btn btn-secondary btn-sm" data-action="material-fuera-catalogo-toggle" data-nombre="${escapeHtml(query)}" style="align-self:flex-start;">
        <i data-lucide="pencil-line"></i> Registrar «${escapeHtml(query.slice(0, 40))}» fuera de catálogo
      </button>`;
    APP.utils.lucideRefresh(sug);
    return;
  }
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
  document.getElementById("materialFcNombre")?.addEventListener("input", _materialSubtotalRefresh);
}

window.abrirMaterialEquipoModal = async function() {
  const equipo = _resolveEquipoActual();
  if (!_trabajoOrdenId || !equipo) { Toast.show("Abre la intervención primero", "bad"); return; }
  if (_ordenActualBloqueada()) { Toast.show("Orden bloqueada: la cotización ya fue emitida", "warn"); return; }

  _materialWireInputs();
  _materialSeleccionada = null;
  _materialFueraCatSet(false);

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

  // Lote (P1.6): checkboxes con los DEMÁS equipos de la orden para aplicar
  // la misma pieza/cantidad — antes el modal se repetía por equipo.
  _materialEquipoActual = equipo;
  _materialOtros = [];
  const wrapOtrosMat = document.getElementById("materialAplicarOtros");
  if (wrapOtrosMat) {
    const cacheOrden = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
    const eqsAct = (cacheOrden?.equipos || []).filter(e2 => !e2.eliminado && e2.id !== equipo.id);
    _materialOtros = eqsAct.map(e2 => ({ equipo: e2, key: OrdenesService.consumoKeyDe(e2) }));
    if (!_materialOtros.length) {
      wrapOtrosMat.style.display = "none"; wrapOtrosMat.innerHTML = "";
    } else {
      wrapOtrosMat.style.display = "";
      wrapOtrosMat.innerHTML = `
        <details style="margin:8px 0 0;">
          <summary style="cursor:pointer; font-size:13px; color:var(--fg-2);">
            Aplicar este material también a otros equipos (${_materialOtros.length}) — misma pieza y cantidad</summary>
          <div style="max-height:120px; overflow-y:auto; margin-top:6px; display:flex; flex-direction:column; gap:4px;">
            ${_materialOtros.map((x, i) => `
              <label style="display:flex; gap:6px; align-items:center; font-size:13px;">
                <input type="checkbox" class="material-aplicar-chk" value="${i}">
                <span style="font-family:var(--font-mono,monospace);">${escapeHtml(String(x.equipo.numero_de_serie || x.equipo.serial || "-"))}</span>
                ${x.equipo.modelo ? " · " + escapeHtml(x.equipo.modelo) : ""}
              </label>`).join("")}
          </div>
        </details>`;
    }
  }

  const modal = document.getElementById("modalMaterialEquipo");
  if (modal) APP.utils.show(modal);
  APP.utils.lucideRefresh(modal);

  try {
    await _ensureMaterialPiezas();
    _materialSugerenciasIniciales(equipo);
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
  const fueraCat = _materialFueraCat ? _materialFueraCatDatos() : null;
  if (fueraCat) {
    if (!fueraCat.nombre) { Toast.show("Escribe el nombre de la pieza", "warn"); return; }
  } else if (!_materialSeleccionada) { Toast.show("Selecciona una pieza", "warn"); return; }
  if (_ordenActualBloqueada()) { Toast.show("Orden bloqueada: la cotización ya fue emitida", "warn"); return; }

  const qty = Math.max(1, parseInt(document.getElementById("materialQty")?.value || "1", 10));
  const tipo = document.getElementById("materialTipo")?.value === "garantia" ? "garantia" : "cobro";
  const precio = Math.max(0, Number(document.getElementById("materialPrecio")?.value || 0));
  const subtotal = +((tipo === "cobro" ? qty * precio : 0)).toFixed(2);
  const user = firebase.auth().currentUser;

  // Lote (P1.6): la misma pieza/cantidad a los equipos marcados en el modal.
  const marcadosMat = Array.from(document.querySelectorAll('#materialAplicarOtros .material-aplicar-chk:checked'))
    .map(ch => _materialOtros[Number(ch.value)])
    .filter(Boolean);
  const destinos = [{ equipo, key: equipoKey }, ...marcadosMat];

  try {
    if (btn) btn.disabled = true;

    // Releer la pieza para validar el stock COMBINADO antes de descontar
    // (qty por CADA equipo del lote). Fuera de catálogo no hay pieza que
    // releer ni stock que validar.
    let sinControl = true;
    if (!fueraCat) {
      const piezaDB = await PiezasService.getPieza(_materialSeleccionada.id);
      if (!piezaDB) { Toast.show("La pieza ya no existe en el catálogo", "bad"); return; }
      sinControl = piezaDB.sin_control_inventario === true;
      const qtyTotal = qty * destinos.length;
      if (!sinControl && Number(piezaDB.cantidad || 0) < qtyTotal) {
        Toast.show(`Stock insuficiente para ${destinos.length} equipo(s): se necesitan ${qtyTotal} y hay ${Number(piezaDB.cantidad || 0)}`, "warn");
        return;
      }
    }

    let consumosOk = 0;
    for (const d of destinos) {
      if (btn && destinos.length > 1) btn.innerHTML = `<i data-lucide="loader"></i> Registrando ${consumosOk + 1}/${destinos.length}…`;
      await OrdenesService.addConsumo(_trabajoOrdenId, {
        equipoId: d.key,
        pieza_id: fueraCat ? null : _materialSeleccionada.id,
        pieza_nombre: fueraCat ? fueraCat.nombre : _nombrePieza(_materialSeleccionada),
        sku: fueraCat ? fueraCat.sku : (_materialSeleccionada.sku || ""),
        fuera_catalogo: !!fueraCat,
        qty,
        precio_unit: precio,
        tipo,
        subtotal,
        added_by_uid: user?.uid || null,
        added_by_email: user?.email || null,
        added_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      consumosOk++;
    }

    // A partir de aquí los consumos YA existen: los pasos restantes no deben
    // presentarse como fallo total — un reintento del usuario duplicaría el
    // consumo (y el descuento de stock).
    const piezaId = fueraCat ? null : _materialSeleccionada.id;
    try {
      if (!sinControl && piezaId) {
        await PiezasService.ajustarDelta(piezaId, -qty * consumosOk);
        const cache = (_materialPiezas || []).find(x => x.id === piezaId);
        if (cache) cache.cantidad = Number(cache.cantidad || 0) - qty * consumosOk;
      }
    } catch (e) {
      console.error("❌ Material registrado pero no se pudo descontar stock:", e);
      Toast.show("⚠️ Material registrado, pero no se pudo descontar el stock — ajústalo en inventario", "warn");
    }

    // Alimenta las recomendaciones "más usadas por modelo" (analytics) —
    // una vez por modelo distinto dentro del lote. Fuera de catálogo no hay
    // pieza_id que recomendar.
    if (tipo === "cobro" && piezaId) {
      const modelos = new Set(destinos.map(d => PiezasService.modeloNormDeEquipo(d.equipo)).filter(Boolean));
      for (const m of modelos) {
        try { await PiezasService.incrementarUsoAnalytics(m, piezaId); }
        catch (e) { console.warn("No se pudo registrar analytics de pieza:", e); }
      }
    }

    cerrarMaterialEquipoModal();
    Toast.show(destinos.length > 1
      ? `✅ Material registrado en ${consumosOk} equipo(s)`
      : (fueraCat ? "✅ Pieza registrada fuera de catálogo" : "✅ Material registrado"), "ok");
    _renderEquipoMateriales();
  } catch (e) {
    console.error("❌ Error registrando material:", e);
    Toast.show(`❌ Error al registrar: ${e?.message || e}`, "bad");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="plus"></i> Agregar material';
      APP.utils.lucideRefresh(btn);
    }
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

  // Descarte en revisión (solo ENTRADA — el bloque va oculto en el resto).
  // El motivo es obligatorio: es lo que lee bodega en el registro central.
  const marcarDescarte = !marcarNoDisp && !!document.getElementById("trabajoDescartado")?.checked;
  const motivoDescarte = (document.getElementById("trabajoDescarteMotivo")?.value || "").trim();
  if (marcarDescarte && !motivoDescarte) {
    Toast.show("Escribe el motivo del descarte — es lo que queda en el registro.", "warn");
    document.getElementById("trabajoDescarteMotivo")?.focus();
    return;
  }

  // Condición particular: el texto es obligatorio (es lo que leen bodega y el
  // QC). No aplica si el radio no se revisó ni si se descartó.
  const marcarCondicion = !marcarNoDisp && !marcarDescarte && !!document.getElementById("trabajoCondicion")?.checked;
  const textoCondicion = (document.getElementById("trabajoCondicionTexto")?.value || "").trim();
  if (marcarCondicion && !textoCondicion) {
    Toast.show("Escribe cuál es la condición — es lo que verán bodega y el QC.", "warn");
    document.getElementById("trabajoCondicionTexto")?.focus();
    return;
  }

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
      let equiposAll = await OrdenesService.updateEquipoNoDisponible({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo?.id,
        noDisponible: true,
        motivo: motivoNoDisp,
        uid,
        email
      });

      // "No disponible" y "descartado" son excluyentes: si el equipo venía
      // marcado como descartado, se limpia (la UI ya lo desmarcó).
      if (cacheEquipo?.descartado_revision) {
        equiposAll = await OrdenesService.updateEquipoDescartado({
          ordenId: _trabajoOrdenId,
          equipoId: cacheEquipo?.id,
          descartado: false,
          motivo: "",
          uid,
          email
        });
      }
      // Lo mismo con la condición: un equipo que no llegó no se revisó.
      if (cacheEquipo?.condicion_especial) {
        equiposAll = await OrdenesService.updateEquipoCondicion({
          ordenId: _trabajoOrdenId,
          equipoId: cacheEquipo?.id,
          condicion: false,
          texto: "",
          uid,
          email
        });
      }

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

    // Lote en UN write (auditoría órdenes P1.8): el equipo actual + los
    // marcados en "aplicar también" van juntos en una sola lectura+escritura
    // del doc — antes era un viaje get+update POR EQUIPO con la espera
    // visible "Aplicando 3/5…". Solo el camino de texto: "no disponible" es
    // por equipo.
    const marcados = Array.from(document.querySelectorAll('#trabajoAplicarOtros .trabajo-aplicar-chk:checked'))
      .map(ch => Number(ch.value))
      .filter(i => Number.isInteger(i) && i !== _trabajoEquipoIdx);
    let equiposAll = await OrdenesService.updateTrabajoTecnico({
      ordenId: _trabajoOrdenId,
      equipoIdx: _trabajoEquipoIdx,
      equipoIdxs: [_trabajoEquipoIdx, ...marcados],
      texto: txt,
      uid,
      email
    });

    // Descarte en revisión (ENTRADA): se estampa solo si cambió — marcarlo,
    // desmarcarlo o corregir el motivo. El registro central lo hace el cierre.
    const descarteCambio = marcarDescarte !== !!cacheEquipo?.descartado_revision
      || (marcarDescarte && motivoDescarte !== (cacheEquipo?.descarte_motivo || "").trim());
    if (descarteCambio && cacheEquipo?.id) {
      equiposAll = await OrdenesService.updateEquipoDescartado({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo.id,
        descartado: marcarDescarte,
        motivo: motivoDescarte,
        uid,
        email
      });
    }

    // Condición particular: igual, solo si cambió. El registro por serial lo
    // hace la firma del QC (o el cierre de la ENTRADA).
    const condicionCambio = marcarCondicion !== !!cacheEquipo?.condicion_especial
      || (marcarCondicion && textoCondicion !== (cacheEquipo?.condicion_texto || "").trim());
    if (condicionCambio && cacheEquipo?.id) {
      equiposAll = await OrdenesService.updateEquipoCondicion({
        ordenId: _trabajoOrdenId,
        equipoId: cacheEquipo.id,
        condicion: marcarCondicion,
        texto: textoCondicion,
        uid,
        email
      });
    }

    // Actualizar cache local
    const cache = APP.state.orders.find(x => x.ordenId === _trabajoOrdenId);
    if (cache) cache.equipos = equiposAll;

    // Refrescar UI - solo la tabla de equipos expandida si existe (desktop)
    refrescarEquiposDeOrden(_trabajoOrdenId);

    cerrarTrabajoEquipoModal();
    Toast.show(marcados.length
      ? `✅ Intervención guardada en ${1 + marcados.length} equipo(s)`
      : (marcarDescarte
        ? "⛔ Intervención guardada — equipo marcado como descartado (queda en el registro al cerrar la entrada)"
        : (marcarCondicion
          ? "⚠️ Intervención guardada — condición particular marcada (queda pegada al serial al firmar el QC)"
          : "✅ Intervención guardada")), "ok");
    
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

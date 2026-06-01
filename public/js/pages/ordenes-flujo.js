// @ts-nocheck
/* ========================================
 * ORDENES FLUJO - Lifecycle transitions
 * Asignar / Completar / Entregar / Eliminar / Agregar-equipo flows,
 * plus nota-entrega generators and serial copy. All actions delegate
 * to OrdenesService for Firestore writes and trigger a reload via
 * cargarOrdenesYEquipos.
 * ======================================== */

// ===== MODAL ASIGNAR TÉCNICO =====
window.abrirModalAsignarTecnico = function (ordenId) {
  const modal = document.getElementById("modalAsignar");
  const select = document.getElementById("asignarTecnicoSelect");
  const btnConfirmar = modal.querySelector("button[data-action='confirmar-asignar-tecnico']");

  if (!modal || !select || !btnConfirmar) {
    console.error("Modal elements not found");
    return;
  }

  btnConfirmar.dataset.ordenId = ordenId;

  select.innerHTML = '<option value="">Seleccionar técnico...</option>';

  OrdenesService.loadTechnicians()
    .then(technicians => {
      technicians.forEach(tech => {
        const option = document.createElement("option");
        option.value = tech.uid;
        option.textContent = tech.nombre;
        select.appendChild(option);
      });
    })
    .catch(error => {
      console.error("Error cargando técnicos:", error);
      Toast.show("❌ Error cargando técnicos", "bad");
    });

  modal.onclick = function (e) {
    if (e.target === modal) {
      cerrarModalAsignar();
    }
  };

  // Modal.open wires Escape, Tab focus-trap, and saves/restores
  // focus on the previously-focused element. The `.hidden` class is
  // removed inside open(). ORDENES_INDEX_IMPROVEMENTS.md QW5.
  Modal.open("modalAsignar");
};

window.cerrarModalAsignar = function () {
  const modal = document.getElementById("modalAsignar");
  if (!modal) return;
  Modal.close("modalAsignar");
  modal.classList.add("hidden");  // keep the .hidden class invariant
  const select = document.getElementById("asignarTecnicoSelect");
  if (select) select.value = "";
};

window.confirmarAsignarTecnico = async function (ordenId) {
  const select = document.getElementById("asignarTecnicoSelect");
  if (!select || !select.value) {
    Toast.show("⚠️ Selecciona un técnico", "bad");
    return;
  }

  const tecnicoUid = select.value;
  const tecnicoNombre = select.options[select.selectedIndex].text;

  try {
    await OrdenesService.assignTechnician(ordenId, tecnicoUid, tecnicoNombre);

    Toast.show("✅ Técnico asignado correctamente", "ok");

    cerrarModalAsignar();
    // The live snapshot in ordenes-data.js picks up the Firestore write
    // and re-renders within milliseconds — no manual reload needed.
    // ORDENES_INDEX_IMPROVEMENTS.md §3.1.
  } catch (error) {
    console.error("Error asignando técnico:", error);
    Toast.show("❌ Error al asignar técnico", "bad");
  }
};

window.completarOrden = async function (ordenId) {
  if (!await Modal.confirm({ message: `¿Marcar la orden ${ordenId} como completada?` })) return;

  try {
    await OrdenesService.completeOrder(ordenId);

    Toast.show("✅ Orden completada", "ok");
    // Live snapshot picks up the change — no manual reload.
  } catch (error) {
    console.error("Error completando orden:", error);
    Toast.show("❌ Error al completar orden", "bad");
  }
};

window.entregarOrden = function (ordenId) {
  abrirModalEntrega(ordenId);
};

window.eliminarOrden = async function (ordenId) {
  if (!await Modal.confirm({ message: `¿ELIMINAR la orden ${ordenId}? Esta acción no se puede deshacer.`, danger: true })) return;

  try {
    await OrdenesService.deleteOrder(ordenId);

    Toast.show("✅ Orden eliminada", "ok");
    // Live snapshot picks up the eliminado:true write — no manual reload.
  } catch (error) {
    console.error("Error eliminando orden:", error);
    Toast.show("❌ Error al eliminar orden", "bad");
  }
};

window.agregarEquipo = function (ordenId) {
  window.location.href = `agregar-equipo.html?orden_id=${ordenId}`;
};

window.generarNotaEntrega = function (ordenId) {
  const orden = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!orden) {
    Toast.show("Orden no encontrada", 'bad');
    return;
  }

  const equipos = prepararEquiposParaNota(orden, false);

  const data = {
    numeroOrden: orden.ordenId || "",
    cliente: nombreClienteDe(orden),
    observaciones: orden.observaciones || "",
    equipos,
    resumen: computeResumenTotales(equipos)
  };

  localStorage.setItem("notaEntregaData", JSON.stringify(data));
  window.open(BASE + "nota-entrega.html", "_blank");
};

window.generarNotaEntregaIntervenciones = function (ordenId) {
  const orden = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!orden) {
    Toast.show("Orden no encontrada", 'bad');
    return;
  }

  const equipos = prepararEquiposParaNota(orden, true);

  const data = {
    numeroOrden: orden.ordenId || "",
    cliente: nombreClienteDe(orden),
    observaciones: orden.observaciones || "",
    equipos,
    resumen: computeResumenTotales(equipos)
  };

  localStorage.setItem("notaEntregaData", JSON.stringify(data));
  window.open(BASE + "nota-entrega-intervenciones.html", "_blank");
};

function prepararEquiposParaNota(orden, incluirIntervencion = false) {
  const equipos = Array.isArray(orden?.equipos) ? orden.equipos : [];
  const unicos = [];
  const seen = new Set();

  equipos.forEach((e) => {
    if (!e || e.eliminado === true) return;

    const serial = String(e.numero_de_serie || "").trim();
    const modelo = String(e.modelo || "").trim();
    const nombre = String(e.nombre || "-").trim() || "-";
    const id = String(e.id || "").trim();

    const key = id ? `id:${id}` : `sm:${serial.toLowerCase()}|${modelo.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const item = {
      serial, modelo, nombre,
      bateria:  !!e.bateria,
      clip:     !!e.clip,
      cargador: !!e.cargador,
      fuente:   !!e.fuente,
      antena:   !!e.antena,
    };
    if (incluirIntervencion) {
      item.intervencion = String(e.trabajo_tecnico || "").trim();
    }
    unicos.push(item);
  });

  return unicos;
}

// Shared helper: count radios + accessory totals from a list of
// equipos (either raw from Firestore or already-prepared via
// prepararEquiposParaNota). Returns { radios, bateria, clip,
// cargador, fuente, antena }. Used by print templates and the
// entrega modal to render a one-line totals summary.
function computeResumenTotales(equiposLike) {
  const list = (Array.isArray(equiposLike) ? equiposLike : [])
    .filter(e => e && e.eliminado !== true);
  const r = { radios: list.length, bateria: 0, clip: 0, cargador: 0, fuente: 0, antena: 0 };
  list.forEach(e => {
    if (e.bateria)  r.bateria++;
    if (e.clip)     r.clip++;
    if (e.cargador) r.cargador++;
    if (e.fuente)   r.fuente++;
    if (e.antena)   r.antena++;
  });
  return r;
}
window.computeResumenTotales = computeResumenTotales;

window.copiarSeriales = function (ordenId) {
  const filas = document.querySelectorAll(`.celda-editable[data-campo="numero_de_serie"][data-id^="${ordenId}_"] .valor`);
  const seriales = [...filas].map(f => f.textContent.trim()).filter(Boolean).join('\n');

  if (!seriales) {
    Toast.show("No hay seriales para copiar", 'warn');
    return;
  }

  navigator.clipboard.writeText(seriales)
    .then(() => Toast.show('✅ Seriales copiados al portapapeles', 'ok'))
    .catch(err => Toast.show(`Error al copiar: ${err}`, 'bad'));
};


// ===== MODAL ENTREGA DE EQUIPOS =====
(function () {
  let _ordenId = null;
  let _ctx = null;
  let _dibujando = false;
  let _canvasInited = false;

  // ── Canvas helpers ──────────────────────────────────────────────
  function _initCanvas() {
    const canvas = document.getElementById('entregaFirmaCanvas');
    if (!canvas) return;
    _ctx = canvas.getContext('2d');
    _ctx.strokeStyle = '#000';
    _ctx.lineWidth = 2;
    _ctx.lineJoin = 'round';
    _ctx.lineCap = 'round';
    _resizeCanvas(canvas);

    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      if (e.touches) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
      return { x: e.offsetX, y: e.offsetY };
    };
    const start = e => { _dibujando = true; _ctx.beginPath(); const p = getPos(e); _ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move  = e => { if (!_dibujando) return; const p = getPos(e); _ctx.lineTo(p.x, p.y); _ctx.stroke(); e.preventDefault(); };
    const end   = e => { _dibujando = false; e.preventDefault(); };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end,   { passive: false });
    _canvasInited = true;
  }

  function _resizeCanvas(canvas) {
    canvas = canvas || document.getElementById('entregaFirmaCanvas');
    if (!canvas) return;
    // Match backing store to devicePixelRatio so the captured signature is
    // sharp on retina/HiDPI displays. CSS size stays at 100% × 200px from
    // the inline style; we scale the drawing buffer up and apply a transform
    // so drawing coords remain in CSS pixels.
    const dpr  = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || canvas.offsetWidth || 300;
    const cssH = 200;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (_ctx) {
      // setTransform (not scale) so re-running _resizeCanvas is idempotent.
      _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      _ctx.fillStyle = '#fff';
      _ctx.fillRect(0, 0, cssW, cssH);
      _ctx.strokeStyle = '#000';
      _ctx.lineWidth = 2;
      _ctx.lineJoin = 'round';
      _ctx.lineCap = 'round';
    }
  }

  function _clearCanvas() {
    const canvas = document.getElementById('entregaFirmaCanvas');
    if (!canvas || !_ctx) return;
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    _ctx.clearRect(0, 0, canvas.width, canvas.height);
    _ctx.fillStyle = '#fff';
    _ctx.fillRect(0, 0, canvas.width, canvas.height);
    _ctx.restore();
  }

  function _isCanvasEmpty() {
    const canvas = document.getElementById('entregaFirmaCanvas');
    if (!canvas) return true;
    return !canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(v => v !== 255);
  }

  // ── Reset form ──────────────────────────────────────────────────
  function _reset() {
    const g = id => document.getElementById(id);

    const noRecibidoCb = g('entregaNoRecibido');
    if (noRecibidoCb) noRecibidoCb.checked = false;
    const motivo = g('entregaNoRecibidoMotivo');
    if (motivo) motivo.value = '';
    const persona = g('entregaPersonaInterna');
    if (persona) persona.value = '';

    const receptorNombre = g('entregaReceptorNombre');
    if (receptorNombre) receptorNombre.value = '';

    const sinIdCb = g('entregaSinId');
    if (sinIdCb) sinIdCb.checked = false;
    const fotoId = g('entregaFotoId');
    if (fotoId) fotoId.value = '';
    const preview = g('entregaPreviewId');
    if (preview) preview.innerHTML = '';
    const sinIdMotivo = g('entregaSinIdMotivo');
    if (sinIdMotivo) sinIdMotivo.value = '';

    // Reset visibility. Use classList — the global `.hidden` class
    // is `display:none !important`, so any prior inline style is moot
    // and must not be carried over either.
    const nb = g('entregaNoRecibidoBloque');
    if (nb) { nb.classList.add('hidden'); nb.style.display = ''; }
    const normalBloque = g('entregaNormalBloque');
    if (normalBloque) { normalBloque.classList.remove('hidden'); normalBloque.style.display = ''; }
    const conId = g('entregaConIdBloque');
    if (conId) { conId.classList.remove('hidden'); conId.style.display = ''; }
    const sinId = g('entregaSinIdBloque');
    if (sinId) { sinId.classList.add('hidden'); sinId.style.display = ''; }

    _clearCanvas();
  }

  // ── Resumen de la orden (equipos + totales) + leyenda ENTRADA ───
  function _escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function _renderResumenEntrega(orden) {
    const ul  = document.getElementById('entregaResumenEquipos');
    const tot = document.getElementById('entregaResumenTotales');
    if (!ul || !tot) return;

    const equipos = (Array.isArray(orden?.equipos) ? orden.equipos : [])
      .filter(e => e && !e.eliminado);

    const accs = [
      { key: 'bateria',  short: 'Bat',  plural: 'baterías'   },
      { key: 'clip',     short: 'Clip', plural: 'clips'      },
      { key: 'cargador', short: 'Carg', plural: 'cargadores' },
      { key: 'fuente',   short: 'Fnt',  plural: 'fuentes'    },
      { key: 'antena',   short: 'Ant',  plural: 'antenas'    },
    ];
    const totales = { bateria: 0, clip: 0, cargador: 0, fuente: 0, antena: 0 };

    ul.innerHTML = equipos.length
      ? equipos.map((e, i) => {
          accs.forEach(a => { if (e[a.key]) totales[a.key]++; });
          const presentes = accs.filter(a => !!e[a.key]).map(a => a.short);
          const serial = _escapeHtml(e.numero_de_serie || '—');
          const modelo = e.modelo ? ` <span class="re-mod">${_escapeHtml(e.modelo)}</span>` : '';
          const accStr = presentes.length
            ? `<span class="re-acc">${presentes.join(' · ')}</span>`
            : `<span class="re-acc re-acc--none">sin acc.</span>`;
          return `<li><span class="re-num">${i + 1}.</span> <span class="re-serial">${serial}</span>${modelo} ${accStr}</li>`;
        }).join('')
      : `<li class="re-empty">Sin equipos</li>`;

    const partes = [`<b>${equipos.length}</b> radio${equipos.length !== 1 ? 's' : ''}`];
    accs.forEach(a => { if (totales[a.key] > 0) partes.push(`<b>${totales[a.key]}</b> ${a.plural}`); });
    tot.innerHTML = partes.join(' · ');
  }

  function _toggleLegendaEntrada(orden) {
    const el = document.getElementById('entregaLegendaEntrada');
    if (!el) return;
    const tipo = String(orden?.tipo_de_servicio || '').toUpperCase();
    // Cache tipo on the element so the no-recibido toggle can decide
    // whether to re-show the legend when the user unchecks it.
    el.dataset.tipo = tipo;
    el.classList.toggle('hidden', !tipo.includes('ENTRADA'));
  }

  // ── Public API ──────────────────────────────────────────────────
  window.abrirModalEntrega = function (ordenId) {
    _ordenId = ordenId;
    const labelEl = document.getElementById('entregaModalOrdenId');
    if (labelEl) labelEl.textContent = ordenId;

    _reset();

    const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};
    _renderResumenEntrega(orden);
    _toggleLegendaEntrada(orden);

    // Modal.open wires Escape, Tab focus-trap, and saves/restores focus.
    // ARIA attrs (role=dialog, aria-modal, aria-labelledby) are on the
    // HTML root in ordenes/index.html. ORDENES_INDEX_IMPROVEMENTS.md §3a.11.
    Modal.open('modalEntrega');

    // Init / resize canvas after it becomes visible so clientWidth is correct
    requestAnimationFrame(() => {
      if (!_canvasInited) {
        _initCanvas();
      } else {
        _resizeCanvas();
      }
    });

    // Backdrop click — Modal.open doesn't wire this, keep our own.
    const modal = document.getElementById('modalEntrega');
    if (modal) modal.onclick = e => { if (e.target === modal) cerrarModalEntrega(); };
  };

  window.cerrarModalEntrega = function () {
    Modal.close('modalEntrega');
    const modal = document.getElementById('modalEntrega');
    if (modal) modal.classList.add('hidden');  // preserve .hidden invariant
    _ordenId = null;
  };

  window.limpiarEntregaFirma = _clearCanvas;

  // Exposed for data-action change handlers in ordenes-events.js.
  // Use classList.toggle('hidden', ...) — the global `.hidden` class
  // is `display:none !important`, so plain `style.display` can't
  // override it when the element starts with class="hidden".
  window._toggleEntregaNoRecibido = function () {
    const checked = !!document.getElementById('entregaNoRecibido')?.checked;
    const nb = document.getElementById('entregaNoRecibidoBloque');
    const norm = document.getElementById('entregaNormalBloque');
    const leg  = document.getElementById('entregaLegendaEntrada');
    if (nb)   nb.classList.toggle('hidden', !checked);
    if (norm) norm.classList.toggle('hidden', checked);
    // Hide ENTRADA legend when toggled into "no recibido" — it's
    // about delivering, not about not-receiving.
    if (leg && checked) leg.classList.add('hidden');
    if (leg && !checked) {
      const t = String(leg.dataset.tipo || '').toUpperCase();
      leg.classList.toggle('hidden', !t.includes('ENTRADA'));
    }
  };

  window._toggleEntregaSinId = function () {
    const checked = !!document.getElementById('entregaSinId')?.checked;
    const conId = document.getElementById('entregaConIdBloque');
    const sinId = document.getElementById('entregaSinIdBloque');
    if (conId) conId.classList.toggle('hidden', checked);
    if (sinId) sinId.classList.toggle('hidden', !checked);
  };

  window._entregaFotoIdChange = function (input) {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const preview = document.getElementById('entregaPreviewId');
    if (preview) preview.innerHTML = `<img src="${url}" style="max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:4px;">`;
  };

  // ── ID-photo upload preparation ─────────────────────────────────
  // Modern phones produce 4–6 MB JPEGs; without resizing, a year of
  // deliveries fills storage with multi-GB of ID photos and 4G techs
  // spend 10–30 s per upload. Resize to ≤1280 px on the longest edge,
  // re-encode as JPEG q=0.85. Skip when file is already small or not an
  // image (e.g. PDF). Fail open: on any error, upload the original.
  async function _prepareIdUpload(file) {
    const origExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const origCT  = file.type || 'image/jpeg';
    if (!file.type.startsWith('image/') || file.size < 200 * 1024) {
      return { blob: file, contentType: origCT, ext: origExt };
    }
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
        : await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('toBlob returned null');
      return { blob, contentType: 'image/jpeg', ext: 'jpg' };
    } catch (err) {
      console.warn('[ordenes-flujo] ID image compression failed, uploading original', err);
      return { blob: file, contentType: origCT, ext: origExt };
    }
  }

  // Email HTML is now built server-side by
  // `functions/src/domain/emailRenderer.js → buildBodyNotaEntrega`.
  // The frontend enqueues a structured payload (`template` + `data`)
  // and `onMailQueued` renders the final HTML via `renderByTemplate`.
  // Single source of truth for branding (ORDENES_INDEX_IMPROVEMENTS §3a.12).

  // Distill the order doc down to just the fields the entrega email
  // needs. Mail queue docs are public to anyone with read on the
  // collection, so we ship the minimum, not the whole order.
  function _ordenEmailSnapshot(orden) {
    if (!orden || typeof orden !== 'object') return {};
    const equipos = (Array.isArray(orden.equipos) ? orden.equipos : [])
      .filter(e => e && !e.eliminado)
      .map(e => ({
        nombre:          e.nombre || null,
        modelo:          e.modelo || null,
        numero_de_serie: e.numero_de_serie || e.SERIAL || e.serial || null,
        trabajo_tecnico: e.trabajo_tecnico || null,
      }));
    return {
      cliente_nombre:    orden.cliente_nombre    || null,
      tecnico_asignado:  orden.tecnico_asignado  || null,
      tipo_de_servicio:  orden.tipo_de_servicio  || null,
      equipos,
    };
  }

  // ── Submit ──────────────────────────────────────────────────────
  window.confirmarEntrega = async function () {
    if (!_ordenId) return;
    const ordenId = _ordenId;
    const user = firebase.auth().currentUser;
    if (!user) { Toast.show('No hay usuario autenticado', 'bad'); return; }

    const noRecibido = !!document.getElementById('entregaNoRecibido')?.checked;
    const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};

    const btn = document.getElementById('btnConfirmarEntrega');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      let firestoreData = {
        estado_reparacion: 'ENTREGADO AL CLIENTE',
        no_recibido: noRecibido,
        fecha_entrega: firebase.firestore.FieldValue.serverTimestamp(),
        entrega_por_uid: user.uid,
        entrega_por_email: user.email,
        os_logs: firebase.firestore.FieldValue.arrayUnion({ action: 'ENTREGAR', by: user.uid })
      };
      let emailOpts = { noRecibido };

      if (noRecibido) {
        // ── Branch A: not received ──
        const motivo = (document.getElementById('entregaNoRecibidoMotivo')?.value || '').trim();
        const personaInterna = (document.getElementById('entregaPersonaInterna')?.value || '').trim();
        if (!motivo) { Toast.show('Indique el motivo por el cual no fue recibido', 'bad'); return; }
        if (!personaInterna) { Toast.show('Indique quién recibió / manejó los equipos', 'bad'); return; }
        firestoreData.no_recibido_motivo = motivo;
        firestoreData.entrega_persona_interna = personaInterna;
        emailOpts = { ...emailOpts, motivo, personaInterna };

      } else {
        // ── Branch B: normal delivery ──
        const receptorNombre = (document.getElementById('entregaReceptorNombre')?.value || '').trim();
        const sinId = !!document.getElementById('entregaSinId')?.checked;
        const sinIdMotivo = sinId ? (document.getElementById('entregaSinIdMotivo')?.value || '').trim() : '';

        if (!receptorNombre) { Toast.show('Ingrese el nombre de quien recibe', 'bad'); return; }
        if (_isCanvasEmpty()) { Toast.show('La firma es obligatoria', 'bad'); return; }
        if (sinId && !sinIdMotivo) { Toast.show('Indique por qué el cliente no proporciona ID', 'bad'); return; }

        // Upload signature
        const canvas = document.getElementById('entregaFirmaCanvas');
        const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
        const pathFirma = `ordenes_firmas/${ordenId}_firma_${Date.now()}.png`;
        const refFirma = firebase.storage().ref(pathFirma);
        await refFirma.put(blob, { contentType: 'image/png' });
        const firmaUrl = await refFirma.getDownloadURL();

        // Upload ID photo (if provided and not waived)
        let identificacionUrl = null;
        if (!sinId) {
          const fileIdRaw = document.getElementById('entregaFotoId')?.files[0];
          if (fileIdRaw) {
            const { blob, contentType, ext } = await _prepareIdUpload(fileIdRaw);
            const pathId = `ordenes_identificacion/${ordenId}_id_${Date.now()}.${ext}`;
            const refId  = firebase.storage().ref(pathId);
            await refId.put(blob, { contentType });
            identificacionUrl = await refId.getDownloadURL();
          }
        }

        firestoreData.receptor_nombre = receptorNombre;
        firestoreData.firma_url = firmaUrl;
        firestoreData.identificacion_url = identificacionUrl;
        firestoreData.sin_id = sinId;
        firestoreData.sin_id_motivo = sinId ? sinIdMotivo : null;
        emailOpts = { ...emailOpts, receptorNombre, firmaUrl, sinId, sinIdMotivo };
      }

      await OrdenesService.mergeOrder(ordenId, firestoreData);

      // Look up recipient emails in parallel
      const [clienteDoc, vendedorDoc, tecnicoDoc] = await Promise.all([
        orden.cliente_id       ? ClientesService.getCliente(orden.cliente_id).catch(() => null)            : Promise.resolve(null),
        orden.vendedor_asignado ? UsuariosService.getUsuario(orden.vendedor_asignado).catch(() => null)    : Promise.resolve(null),
        orden.tecnico_uid      ? UsuariosService.getUsuario(orden.tecnico_uid).catch(() => null)           : Promise.resolve(null),
      ]);

      const subject = `Nota de Entrega — Orden ${ordenId}${noRecibido ? ' (No recibido)' : ''}`;
      // Structured payload — onMailQueued renders the body via
      // emailRenderer.renderByTemplate. fechaISO is included so the
      // email reflects the moment the entrega was confirmed even if
      // there's queue latency.
      const mailPayload = {
        template: 'nota_entrega',
        data: {
          ordenId,
          orden: _ordenEmailSnapshot(orden),
          opts:  { ...emailOpts, fechaISO: new Date().toISOString() },
        },
      };

      await Promise.allSettled([
        clienteDoc?.email  ? MailService.enqueue({ to: clienteDoc.email,  subject, ...mailPayload }) : null,
        vendedorDoc?.email ? MailService.enqueue({ to: vendedorDoc.email, subject, ...mailPayload }) : null,
        tecnicoDoc?.email  ? MailService.enqueue({ to: tecnicoDoc.email,  subject, ...mailPayload }) : null,
      ].filter(Boolean));

      cerrarModalEntrega();
      Toast.show('✅ Entrega registrada correctamente', 'ok');
      // Live snapshot picks up the estado_reparacion + fecha_entrega
      // write — no manual reload.

    } catch (err) {
      console.error('[confirmarEntrega]', err);
      Toast.show('❌ Error al registrar la entrega: ' + err.message, 'bad');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check"></i> Confirmar Entrega';
        APP.utils.lucideRefresh(btn);
      }
    }
  };

})();


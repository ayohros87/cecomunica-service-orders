// @ts-nocheck
/* ========================================
 * ORDENES FLUJO - Lifecycle transitions
 * Asignar / Completar / Entregar / Eliminar / Agregar-equipo flows,
 * plus nota-entrega generators and serial copy. All actions delegate
 * to OrdenesService for Firestore writes and trigger a reload via
 * cargarOrdenesYEquipos.
 * ======================================== */

// ===== MODAL ASIGNAR / CAMBIAR TÉCNICO =====
// El mismo modal (#modalAsignar) sirve dos flujos:
//   · 'asignar'   → primera asignación; transiciona la orden a ASIGNADO.
//   · 'reasignar' → cambio esporádico de técnico (admin/jefe_taller) que NO
//                   toca el estado. Preselecciona el técnico actual.
// El modo viaja en el dataset del botón confirmar y lo lee confirmarAsignarTecnico.
function _abrirModalTecnico(ordenId, { modo }) {
  const modal = document.getElementById("modalAsignar");
  const select = document.getElementById("asignarTecnicoSelect");
  const btnConfirmar = modal && modal.querySelector("button[data-action='confirmar-asignar-tecnico']");
  const titulo = document.getElementById("modalAsignarTitle");

  if (!modal || !select || !btnConfirmar) {
    console.error("Modal elements not found");
    return;
  }

  const esReasignar = modo === "reasignar";
  btnConfirmar.dataset.ordenId = ordenId;
  btnConfirmar.dataset.modo = modo;

  // Título + texto del botón según el modo (el modal se reutiliza para ambos).
  if (titulo) {
    titulo.innerHTML = esReasignar
      ? '<i data-lucide="user-cog"></i> Cambiar técnico'
      : '<i data-lucide="wrench"></i> Asignar técnico';
  }
  btnConfirmar.textContent = esReasignar ? "Cambiar técnico" : "Asignar técnico";

  // Técnico actual, para preseleccionarlo en modo reasignar.
  const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
  const tecnicoActualUid = orden.tecnico_uid || "";

  select.innerHTML = '<option value="">Seleccionar técnico...</option>';

  OrdenesService.loadTechnicians()
    .then(technicians => {
      technicians.forEach(tech => {
        const option = document.createElement("option");
        option.value = tech.uid;
        option.textContent = tech.nombre;
        if (esReasignar && tech.uid === tecnicoActualUid) option.selected = true;
        select.appendChild(option);
      });
      select.style.borderColor = select.value ? 'var(--accent)' : 'var(--line)';
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
  // Re-pinta el icono del título recién inyectado (data-lucide).
  if (APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(modal);
  else if (window.lucide?.createIcons) window.lucide.createIcons();
}

window.abrirModalAsignarTecnico = function (ordenId) {
  _abrirModalTecnico(ordenId, { modo: "asignar" });
};

window.abrirModalCambiarTecnico = function (ordenId) {
  _abrirModalTecnico(ordenId, { modo: "reasignar" });
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

  const btnConfirmar = document.querySelector("#modalAsignar button[data-action='confirmar-asignar-tecnico']");
  const modo = (btnConfirmar && btnConfirmar.dataset.modo) || "asignar";
  const tecnicoUid = select.value;
  const tecnicoNombre = select.options[select.selectedIndex].text;

  try {
    if (modo === "reasignar") {
      const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
      // Eligió el mismo técnico: nada que cambiar, solo cierra.
      if (tecnicoUid && tecnicoUid === orden.tecnico_uid) {
        cerrarModalAsignar();
        return;
      }
      await OrdenesService.reassignTechnician(ordenId, tecnicoUid, tecnicoNombre, {
        prevUid: orden.tecnico_uid || "",
        prevNombre: orden.tecnico_asignado || ""
      });
      Toast.show("✅ Técnico cambiado correctamente", "ok");
    } else {
      await OrdenesService.assignTechnician(ordenId, tecnicoUid, tecnicoNombre);
      Toast.show("✅ Técnico asignado correctamente", "ok");
    }

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

window.nuevoBatch = function (ordenId) {
  window.location.href = `nuevo-batch.html?orden_id=${ordenId}`;
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

window.generarNotaEntregaIntervenciones = async function (ordenId) {
  const orden = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!orden) {
    Toast.show("Orden no encontrada", 'bad');
    return;
  }

  // Abrir la ventana dentro del gesto del usuario (evita bloqueo de pop-ups);
  // la apuntamos al documento una vez resueltos los datos asíncronos.
  const win = window.open("about:blank", "_blank");

  const equipos = prepararEquiposParaNota(orden, true);

  // Adjunta las piezas/accesorios cambiados o reparados por el técnico (consumos
  // cobrables y de garantía) a cada equipo, para que la nota que firma el cliente
  // muestre nº de serie, modelo, piezas cambiadas y la intervención completa.
  try {
    const cons = await OrdenesService.getConsumos(ordenId);
    const porEquipo = {};
    (cons || []).forEach(c => {
      if ((c.tipo || 'cobro') === 'interno') return; // las internas no van en la nota del cliente
      const k = c.equipoId || 'X';
      (porEquipo[k] = porEquipo[k] || []).push({
        nombre: c.pieza_nombre || 'Pieza',
        sku: c.sku || '',
        qty: Number(c.qty || 0),
        tipo: c.tipo || 'cobro',
      });
    });
    equipos.forEach(eq => { eq.piezas = porEquipo[eq.id] || porEquipo[eq.serial] || []; });
  } catch (e) {
    console.warn('No se pudieron cargar las piezas del técnico para la nota:', e);
  }

  const data = {
    numeroOrden: orden.ordenId || "",
    cliente: nombreClienteDe(orden),
    observaciones: orden.observaciones || "",
    equipos,
    resumen: computeResumenTotales(equipos)
  };

  localStorage.setItem("notaEntregaData", JSON.stringify(data));
  if (win) { win.location = BASE + "nota-entrega-intervenciones.html"; }
  else { window.open(BASE + "nota-entrega-intervenciones.html", "_blank"); }
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
      id: id || serial,
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
  // Cached cliente doc for the open modal — populated in abrirModalEntrega
  // so confirmarEntrega can detect email edits without an extra round-trip.
  let _clienteDoc = null;
  // 'entrega' (default) o 'recepcion'. _applyModo lo sincroniza con la UI;
  // confirmarEntrega lo lee para despachar a la rama correcta del flujo.
  let _modo = 'entrega';

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

    const notas = g('entregaNotas');
    if (notas) notas.value = '';

    const clienteEmail = g('entregaClienteEmail');
    if (clienteEmail) clienteEmail.value = '';
    const clienteEmailHint = g('entregaClienteEmailHint');
    if (clienteEmailHint) {
      clienteEmailHint.textContent = 'Cargando email registrado…';
      clienteEmailHint.style.color = '';
    }
    _clienteDoc = null;

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

  // Minimal RFC-style check — backend re-validates on send. Enough to
  // catch typos like missing "@" or domain before queueing the email.
  function _isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  // Load the cliente doc and prefill the email input so the user can
  // review/edit before confirming delivery. Stored in _clienteDoc so
  // confirmarEntrega can diff against the original value.
  function _prefillClienteEmail(orden) {
    const input = document.getElementById('entregaClienteEmail');
    const hint  = document.getElementById('entregaClienteEmailHint');
    if (!input) return;

    if (!orden?.cliente_id) {
      _clienteDoc = null;
      if (hint) hint.textContent = 'No hay cliente vinculado a la orden. Ingrese el email manualmente si desea enviar la nota.';
      return;
    }

    ClientesService.getCliente(orden.cliente_id)
      .then(doc => {
        _clienteDoc = doc;
        if (doc?.email) {
          input.value = doc.email;
          if (hint) hint.textContent = 'Email registrado del cliente. Edítelo si necesita corregirlo antes de enviar.';
        } else if (hint) {
          hint.textContent = 'El cliente no tiene email registrado. Ingréselo para enviar la nota de entrega.';
        }
      })
      .catch(err => {
        console.warn('[abrirModalEntrega] cliente fetch failed', err);
        if (hint) {
          hint.textContent = 'No se pudo cargar el email del cliente. Ingréselo manualmente.';
          hint.style.color = 'var(--warn, #b45309)';
        }
      });
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

  // Reconfigura el modal compartido entre los flujos de entrega y
  // recepción. En 'recepcion' oculta los bloques que no aplican (ID,
  // sin-ID, no-recibido, leyenda ENTRADA) y cambia título/labels/botón.
  // Mantiene firma + nombre + email cliente, que son los únicos campos
  // requeridos para el acuse de recibo en mostrador.
  function _applyModo(modo) {
    _modo = (modo === 'recepcion') ? 'recepcion' : 'entrega';
    const root = document.getElementById('modalEntrega');
    if (root) root.dataset.modo = _modo;
    const esRecepcion = _modo === 'recepcion';

    const titulo = document.getElementById('entregaModalTituloPrefijo');
    if (titulo) titulo.textContent = esRecepcion ? 'Recepción en mostrador' : 'Entrega';

    // Lucide reemplaza el <i> con <svg> en el primer render, así que
    // un simple setAttribute no actualiza el icono. Re-creamos el <i>
    // y dejamos que lucideRefresh lo vuelva a renderizar.
    const icon = document.getElementById('entregaModalIcon');
    if (icon) {
      const fresh = document.createElement('i');
      fresh.id = 'entregaModalIcon';
      fresh.setAttribute('data-lucide', esRecepcion ? 'package-plus' : 'package-check');
      icon.replaceWith(fresh);
    }

    const receptorLabel = document.getElementById('entregaReceptorLabel');
    if (receptorLabel) receptorLabel.textContent = esRecepcion ? 'Nombre de quien entrega' : 'Nombre de quien recibe';

    const firmaLabel = document.getElementById('entregaFirmaLabel');
    if (firmaLabel) firmaLabel.textContent = esRecepcion ? 'Firma del que entrega' : 'Firma del receptor';

    const btnLabel = document.getElementById('btnConfirmarEntregaLabel');
    if (btnLabel) btnLabel.textContent = esRecepcion ? 'Confirmar Recepción' : 'Confirmar Entrega';

    // Containers que no aplican en recepción. .modal-entrega__alert--no-id
    // envuelve el bloque de foto-ID y el checkbox sin-ID; .modal-entrega__alert
    // envuelve el checkbox no-recibido y su sub-bloque.
    const root2 = document.getElementById('modalEntrega');
    const idAlert = root2?.querySelector('.modal-entrega__alert--no-id');
    if (idAlert) idAlert.classList.toggle('hidden', esRecepcion);
    const noRecibidoAlert = root2?.querySelector('.modal-entrega__alert');
    if (noRecibidoAlert) noRecibidoAlert.classList.toggle('hidden', esRecepcion);
    const legenda = document.getElementById('entregaLegendaEntrada');
    if (legenda && esRecepcion) legenda.classList.add('hidden');

    // Notas de entrega solo aplican al flujo de entrega (van en el email).
    // En recepción no se envía email, así que el campo se oculta.
    const notasWrap = document.getElementById('entregaNotasWrap');
    if (notasWrap) notasWrap.classList.toggle('hidden', esRecepcion);

    // "Equipos recibidos sin firma" solo aplica en recepción. Se resetea a
    // desmarcado cada vez que se aplica el modo (firma visible, motivo oculto).
    const sinFirmaWrap   = document.getElementById('entregaRecepcionSinFirmaWrap');
    const sinFirmaCb     = document.getElementById('entregaRecepcionSinFirma');
    const sinFirmaBloque = document.getElementById('entregaRecepcionSinFirmaBloque');
    const sigWrap        = document.getElementById('entregaSigWrap');
    if (sinFirmaWrap)   sinFirmaWrap.classList.toggle('hidden', !esRecepcion);
    if (sinFirmaCb)     sinFirmaCb.checked = false;
    if (sinFirmaBloque) sinFirmaBloque.classList.add('hidden');
    if (sigWrap)        sigWrap.classList.remove('hidden');

    APP.utils.lucideRefresh(root2);
  }

  // ── Public API ──────────────────────────────────────────────────
  // opts.modo: 'entrega' (default) o 'recepcion' — comparte el modal
  // con `abrirModalRecepcion`, que es solo un envoltorio.
  window.abrirModalEntrega = function (ordenId, opts = {}) {
    _ordenId = ordenId;
    const labelEl = document.getElementById('entregaModalOrdenId');
    if (labelEl) labelEl.textContent = ordenId;

    _reset();
    _applyModo(opts.modo || 'entrega');

    const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};
    _renderResumenEntrega(orden);
    // En modo recepción la leyenda ENTRADA no aplica (no estamos
    // entregando radios, los estamos recibiendo); _applyModo ya la ocultó.
    if (_modo !== 'recepcion') _toggleLegendaEntrada(orden);
    _prefillClienteEmail(orden);

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
    // Reset modo so the next open defaults to 'entrega' even if the
    // modal was last used for recepción.
    _modo = 'entrega';
  };

  // Atajo público para abrir el modal en modo recepción — usado por
  // botonesFlujo cuando la orden está POR ASIGNAR.
  window.abrirModalRecepcion = function (ordenId) {
    window.abrirModalEntrega(ordenId, { modo: 'recepcion' });
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

  // Recepción: "equipos recibidos sin firma" — al marcar se oculta el canvas
  // de firma y se muestra el motivo (obligatorio).
  window._toggleEntregaSinFirma = function () {
    const checked = !!document.getElementById('entregaRecepcionSinFirma')?.checked;
    const bloque  = document.getElementById('entregaRecepcionSinFirmaBloque');
    const sigWrap = document.getElementById('entregaSigWrap');
    if (bloque)  bloque.classList.toggle('hidden', !checked);
    if (sigWrap) sigWrap.classList.toggle('hidden', checked);
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
  // `consumos` (opcional) son las piezas registradas por el técnico
  // (subcolección consumos); se adjuntan por equipo casando por equipoId
  // con fallback por serial (equipos legacy sin id).
  function _ordenEmailSnapshot(orden, consumos = []) {
    if (!orden || typeof orden !== 'object') return {};
    const consumosDe = (e) => (Array.isArray(consumos) ? consumos : []).filter(c => {
      if (!c || !c.equipoId) return false;
      const serial = e.numero_de_serie || e.SERIAL || e.serial || null;
      return (e.id && c.equipoId === e.id) || (serial && c.equipoId === serial);
    }).map(c => ({
      pieza_nombre: c.pieza_nombre || null,
      sku:          c.sku || null,
      qty:          Number(c.qty || 0),
      precio_unit:  Number(c.precio_unit || 0),
      tipo:         c.tipo || 'cobro',
    }));
    const equipos = (Array.isArray(orden.equipos) ? orden.equipos : [])
      .filter(e => e && !e.eliminado)
      .map(e => ({
        modelo:          e.modelo || null,
        numero_de_serie: e.numero_de_serie || e.SERIAL || e.serial || null,
        trabajo_tecnico: e.trabajo_tecnico || null,
        // Accesorios (flags booleanos) — se listan en la nota como columna
        // "Accesorios", con la misma fuente de datos que "Imprimir orden".
        bateria:  !!e.bateria,
        clip:     !!e.clip,
        cargador: !!e.cargador,
        fuente:   !!e.fuente,
        antena:   !!e.antena,
        // Repuestos/accesorios usados por el técnico (tabla por equipo).
        consumos: consumosDe(e),
      }));
    return {
      cliente_nombre:    orden.cliente_nombre    || null,
      tecnico_asignado:  orden.tecnico_asignado  || null,
      tipo_de_servicio:  orden.tipo_de_servicio  || null,
      equipos,
    };
  }

  // ── Submit recepción ────────────────────────────────────────────
  // Flujo simplificado: validar receptor + firma, subir firma a
  // Storage, llamar al service que escribe el estado RECIBIDO EN
  // MOSTRADOR. No envía email (el cliente se lleva la nota impresa
  // desde "Imprimir orden" si la necesita).
  async function _confirmarRecepcion(ordenId, user) {
    const receptorNombre = (document.getElementById('entregaReceptorNombre')?.value || '').trim();
    if (!receptorNombre) { Toast.show('Ingrese el nombre de quien entrega', 'bad'); return; }

    // "Equipos recibidos sin firma": omite la firma pero exige motivo.
    const sinFirma = !!document.getElementById('entregaRecepcionSinFirma')?.checked;
    const sinFirmaMotivo = sinFirma ? (document.getElementById('entregaRecepcionSinFirmaMotivo')?.value || '').trim() : '';
    if (sinFirma) {
      if (!sinFirmaMotivo) { Toast.show('Indique el motivo por el cual se reciben sin firma', 'bad'); return; }
    } else if (_isCanvasEmpty()) {
      Toast.show('La firma del que entrega es obligatoria', 'bad'); return;
    }

    const btn = document.getElementById('btnConfirmarEntrega');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      let firmaUrl = null;
      if (!sinFirma) {
        const canvas = document.getElementById('entregaFirmaCanvas');
        const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
        const pathFirma = `ordenes_firmas/${ordenId}_recepcion_${Date.now()}.png`;
        const refFirma = firebase.storage().ref(pathFirma);
        await refFirma.put(blob, { contentType: 'image/png' });
        firmaUrl = await refFirma.getDownloadURL();
      }

      await OrdenesService.receiveAtCounter(ordenId, { receptorNombre, firmaUrl, sinFirma, sinFirmaMotivo });

      // Si el operador editó el email del cliente, persistirlo en su
      // doc — mismo patrón que confirmarEntrega. Fallo no-fatal.
      const clienteEmailInput = (document.getElementById('entregaClienteEmail')?.value || '').trim().toLowerCase();
      const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};
      if (clienteEmailInput && orden.cliente_id) {
        if (!_isValidEmail(clienteEmailInput)) {
          Toast.show('⚠️ Recepción registrada, pero el email del cliente no es válido', 'warn');
        } else {
          const clienteEmailOriginal = (_clienteDoc?.email || '').toLowerCase().trim();
          if (clienteEmailInput !== clienteEmailOriginal) {
            try {
              await ClientesService.updateCliente(orden.cliente_id, { email: clienteEmailInput });
            } catch (err) {
              console.warn('[confirmarRecepcion] no se pudo actualizar email del cliente', err);
            }
          }
        }
      }

      cerrarModalEntrega();
      Toast.show('✅ Recepción registrada correctamente', 'ok');
    } catch (err) {
      console.error('[confirmarRecepcion]', err);
      Toast.show('❌ Error al registrar la recepción: ' + err.message, 'bad');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check"></i> <span id="btnConfirmarEntregaLabel">Confirmar Recepción</span>';
        APP.utils.lucideRefresh(btn);
      }
    }
  }

  // ── Submit ──────────────────────────────────────────────────────
  window.confirmarEntrega = async function () {
    if (!_ordenId) return;
    const ordenId = _ordenId;
    const user = firebase.auth().currentUser;
    if (!user) { Toast.show('No hay usuario autenticado', 'bad'); return; }

    // Despacha al flujo de recepción cuando el modal fue abierto en ese
    // modo — comparte canvas/validaciones/firma pero salta no-recibido,
    // ID, leyenda y email automático.
    if (_modo === 'recepcion') {
      return _confirmarRecepcion(ordenId, user);
    }

    const noRecibido = !!document.getElementById('entregaNoRecibido')?.checked;
    const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};

    // Notas de entrega — opcionales, libres. Aplican a ambos flujos
    // (entrega normal y no-recibido) y se incluyen en el email.
    const notasEntrega = (document.getElementById('entregaNotas')?.value || '').trim();

    // Email del cliente — editable en el modal. Si está vacío se omite
    // el envío al cliente; si tiene formato inválido se aborta.
    const clienteEmailInput = (document.getElementById('entregaClienteEmail')?.value || '').trim().toLowerCase();
    if (clienteEmailInput && !_isValidEmail(clienteEmailInput)) {
      Toast.show('El email del cliente no tiene un formato válido', 'bad');
      return;
    }

    const btn = document.getElementById('btnConfirmarEntrega');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      let firestoreData = {
        estado_reparacion: 'ENTREGADO AL CLIENTE',
        no_recibido: noRecibido,
        notas_entrega: notasEntrega || null,
        fecha_entrega: firebase.firestore.FieldValue.serverTimestamp(),
        entrega_por_uid: user.uid,
        entrega_por_email: user.email,
        os_logs: firebase.firestore.FieldValue.arrayUnion({ action: 'ENTREGAR', by: user.uid })
      };
      let emailOpts = { noRecibido, notas: notasEntrega };

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

        // Upload ID photo (if provided and not waived). We store only the
        // Storage PATH — never a tokenized download URL — because the ID is
        // sensitive PII. Admins view it via the getIdentificacionUrl callable
        // (short-lived signed URL). See storage.rules: read is locked off.
        let identificacionPath = null;
        if (!sinId) {
          const fileIdRaw = document.getElementById('entregaFotoId')?.files[0];
          if (fileIdRaw) {
            const { blob, contentType, ext } = await _prepareIdUpload(fileIdRaw);
            const pathId = `ordenes_identificacion/${ordenId}_id_${Date.now()}.${ext}`;
            const refId  = firebase.storage().ref(pathId);
            await refId.put(blob, { contentType });
            identificacionPath = pathId;
          }
        }

        firestoreData.receptor_nombre = receptorNombre;
        firestoreData.firma_url = firmaUrl;
        firestoreData.identificacion_path = identificacionPath;
        firestoreData.sin_id = sinId;
        firestoreData.sin_id_motivo = sinId ? sinIdMotivo : null;
        emailOpts = { ...emailOpts, receptorNombre, firmaUrl, sinId, sinIdMotivo };
      }

      await OrdenesService.mergeOrder(ordenId, firestoreData);

      // Look up recipient emails in parallel. _clienteDoc was populated
      // when the modal opened; refetch only if missing (e.g., modal opened
      // before the async load resolved or no orden.cliente_id at open time).
      const clienteDocPromise = _clienteDoc
        ? Promise.resolve(_clienteDoc)
        : (orden.cliente_id ? ClientesService.getCliente(orden.cliente_id).catch(() => null) : Promise.resolve(null));
      const [clienteDoc, vendedorDoc, tecnicoDoc, empresaConfig, consumosOrden] = await Promise.all([
        clienteDocPromise,
        orden.vendedor_asignado ? UsuariosService.getUsuario(orden.vendedor_asignado).catch(() => null)    : Promise.resolve(null),
        orden.tecnico_uid      ? UsuariosService.getUsuario(orden.tecnico_uid).catch(() => null)           : Promise.resolve(null),
        // Buzón único de recepción (config de empresa) — lleva el control de entregas.
        EmpresaService.getConfig().catch(() => ({})),
        // Repuestos registrados por el técnico — se agrupan por equipo en el
        // correo. Fallo no-fatal: la nota sale sin esa tabla.
        OrdenesService.getConsumos(ordenId).catch(err => { console.warn('[confirmarEntrega] no se pudieron cargar los consumos', err); return []; }),
      ]);

      // Persist email change back to the cliente doc if the user edited
      // it. Skip when blank (user opted out of cliente email this time)
      // or when unchanged. Failure is non-fatal — the entrega already
      // saved; we just log so it can be retried manually later.
      const clienteEmailOriginal = (clienteDoc?.email || '').toLowerCase().trim();
      if (orden.cliente_id && clienteEmailInput && clienteEmailInput !== clienteEmailOriginal) {
        try {
          await ClientesService.updateCliente(orden.cliente_id, { email: clienteEmailInput });
        } catch (err) {
          console.warn('[confirmarEntrega] no se pudo actualizar email del cliente', err);
          Toast.show('⚠️ Entrega registrada, pero no se pudo actualizar el email del cliente', 'warn');
        }
      }
      const clienteEmailToUse = clienteEmailInput || clienteEmailOriginal;

      const subject = `Nota de Entrega — Orden ${ordenId}${noRecibido ? ' (No recibido)' : ''}`;
      // Structured payload — onMailQueued renders the body via
      // emailRenderer.renderByTemplate. fechaISO is included so the
      // email reflects the moment the entrega was confirmed even if
      // there's queue latency. ctaUrl se inyecta por-destinatario (abajo).
      const baseData = {
        ordenId,
        orden:  _ordenEmailSnapshot(orden, consumosOrden),
        opts:   { ...emailOpts, fechaISO: new Date().toISOString() },
      };

      // CTA "Ver orden": deep-link al índice INTERNO → abre el modal de
      // Entrega/Recepción sobre la lista completa de órdenes. Es útil para
      // el personal, pero NO debe ir al cliente: detrás del modal quedaría
      // expuesta toda la cartera de órdenes de la empresa (y la página exige
      // login del staff). Por eso el cliente recibe la nota SIN botón — el
      // cuerpo del correo ya es su comprobante completo (equipos, receptor,
      // firma, notas). Solo los internos llevan el deep-link.
      const internalCtaUrl = `https://app.cecomunica.net/ordenes/index.html?entrega=${encodeURIComponent(ordenId)}`;

      // Destinatarios. Set normaliza a minúsculas para no duplicar.
      const recepcionEmail = (empresaConfig?.email_recepcion_entregas || '').toLowerCase().trim();
      const clienteEmail   = (clienteEmailToUse || '').toLowerCase().trim();
      const internos = new Set();
      if (vendedorDoc?.email) internos.add(vendedorDoc.email.toLowerCase().trim());
      if (tecnicoDoc?.email)  internos.add(tecnicoDoc.email.toLowerCase().trim());
      if (recepcionEmail)     internos.add(recepcionEmail);
      // Jefe de taller (empresa/config.email_taller — string o array).
      const tallerCfg = empresaConfig?.email_taller;
      (Array.isArray(tallerCfg) ? tallerCfg : (tallerCfg ? [tallerCfg] : []))
        .map(e => String(e || '').toLowerCase().trim())
        .filter(Boolean)
        .forEach(e => internos.add(e));
      // Si el correo del cliente coincide con uno interno, mándalo como cliente
      // (sin link) — nunca le des el deep-link a un destinatario externo.
      if (clienteEmail) internos.delete(clienteEmail);

      const jobs = [];
      if (clienteEmail) {
        jobs.push(MailService.enqueue({ to: clienteEmail, subject, template: 'nota_entrega', data: baseData }));
      }
      for (const to of internos) {
        if (!to) continue;
        // `interno: true` habilita columnas sensibles (precio/tipo) en la
        // tabla de repuestos — el cliente recibe la nota sin precios.
        jobs.push(MailService.enqueue({
          to, subject, template: 'nota_entrega',
          data: { ...baseData, ctaUrl: internalCtaUrl, interno: true },
        }));
      }
      await Promise.allSettled(jobs);

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
        // Preserva el span btnConfirmarEntregaLabel para que la próxima
        // apertura del modal (potencialmente en modo recepción) pueda
        // ajustar el texto vía _applyModo.
        btn.innerHTML = '<i data-lucide="check"></i> <span id="btnConfirmarEntregaLabel">Confirmar Entrega</span>';
        APP.utils.lucideRefresh(btn);
      }
    }
  };

})();


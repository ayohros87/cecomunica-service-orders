// @ts-nocheck
// Galería de fotos de la ORDEN en un modal (§5.23, aprobado 2026-08-19):
// reemplaza a la página fotos-taller.html (7 usos/90d). Mismo contrato de
// datos que la página retirada — fotos_taller[] en el doc de la orden,
// storage en ordenes_taller_fotos/{ordenId}/, os_logs SUBIR_FOTO_TALLER /
// ELIMINAR_FOTO_TALLER y mantenimiento de fotos_taller_count — así que las
// fotos históricas se ven igual y el badge de la fila sigue funcionando.
//
// UNA galería por orden (auditoría UX 2026-09-28, 4.2 #16): antes las fotos
// que el técnico subía desde el modal de intervención (equipos[i].fotos[])
// no aparecían aquí ni contaban en el badge, y al revés. Ahora esta galería
// lee los DOS orígenes (OrdenesService.fotosDeOrden), cada foto puede llevar
// la etiqueta de un equipo (opcional, se elige al subir), se puede filtrar
// por equipo, y la escritura es una sola (OrdenesService.addFotoOrden →
// fotos_taller[]). Sirve igual con o sin equipos (visitas técnicas de campo).
// Se abre con abrirFotosOrden(ordenId, { equipoId? }) desde el menú ⋯, el
// badge de la fila, el modal de intervención y el aviso del informe de visita.
(() => {
  const TIPOS = [
    { key: "antes",   label: "Antes" },
    { key: "despues", label: "Después" },
    { key: "detalle", label: "Detalle" },
  ];

  let _ordenId = "";
  let _orden = null;
  let _fotos = [];
  let _equipos = [];            // equipos vivos de la orden (para etiquetar / filtrar)
  let _filtroEquipo = "";       // "" = toda la orden; si no, id del equipo
  let _equipoPreseleccion = ""; // id del equipo con que se abrió (modal de intervención)
  let _pending = null;          // { file, tipo, previewUrl }

  const esc = (v) => (typeof FMT !== "undefined" && FMT.esc) ? FMT.esc(v)
    : String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

  const prettyTipo = (t) => (TIPOS.find(x => x.key === t) || {}).label || "Detalle";

  const genPhotoId = () => `ft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const serialDe = (e) => String(e?.numero_de_serie || e?.serial || e?.SERIAL || "").trim();
  const etiquetaEquipo = (e) => {
    const s = serialDe(e) || "(sin serial)";
    const m = String(e?.modelo || e?.MODEL || e?.modelo_nombre || "").trim();
    return m ? `${s} · ${m}` : s;
  };

  // Un solo criterio de permisos para las dos vistas (ver OrdenesService).
  function canSoftDelete(foto) {
    return OrdenesService.puedeEliminarFoto(foto, {
      rol: APP.state.userRole || "",
      uid: firebase.auth().currentUser?.uid || "",
    });
  }

  // ── Compresión (portada de fotos-taller.js): 1600px máx, JPEG 0.75 ──
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  async function compressImage(file, maxWidth = 1600, quality = 0.75) {
    const img = await loadImage(await readFileAsDataURL(file));
    let w = img.width, h = img.height;
    if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo comprimir la imagen")), "image/jpeg", quality);
    });
  }

  function formatTs(ts) {
    if (!ts) return "";
    try {
      const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
      if (!d || Number.isNaN(d.getTime())) return "";
      return d.toLocaleString("es-PA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (_) { return ""; }
  }

  function overlayEl() { return document.getElementById("fotosOrdenOverlay"); }

  function cerrar() {
    const ov = overlayEl();
    if (!ov) return;
    if (_pending?.previewUrl) URL.revokeObjectURL(_pending.previewUrl);
    _pending = null;
    document.removeEventListener("keydown", onKey);
    ov.remove();
    document.body.style.overflow = "";
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    const viewer = document.getElementById("fotosOrdenViewer");
    if (viewer && viewer.classList.contains("show")) { closeViewer(); return; }
    cerrar();
  }

  function openViewer(foto) {
    const viewer = document.getElementById("fotosOrdenViewer");
    if (!viewer || !foto?.url) return;
    viewer.querySelector("img").src = foto.url;
    const fecha = formatTs(foto.uploaded_at);
    viewer.querySelector(".fotos-viewer__meta").innerHTML =
      `${esc(prettyTipo(foto.tipo))}${foto.equipo_serial ? ` · ${esc(foto.equipo_serial)}` : ""}` +
      `${foto.nota ? `<br>${esc(foto.nota)}` : ""}${fecha ? `<br>${esc(fecha)}` : ""}` +
      `${foto.uploaded_by_email ? `<br>${esc(foto.uploaded_by_email)}` : ""}`;
    viewer.classList.add("show");
  }
  function closeViewer() {
    const viewer = document.getElementById("fotosOrdenViewer");
    if (!viewer) return;
    viewer.classList.remove("show");
    viewer.querySelector("img").src = "";
  }

  function renderPending() {
    const card = overlayEl()?.querySelector(".fotos-pending");
    if (!card) return;
    if (!_pending) { card.style.display = "none"; return; }
    card.style.display = "block";
    card.querySelector("img").src = _pending.previewUrl;
    card.querySelector(".fotos-pending__tipo").textContent = prettyTipo(_pending.tipo);
    // El equipo se propone según el filtro activo (o el equipo con que se
    // abrió la galería); siempre se puede cambiar o dejar "toda la orden".
    const sel = card.querySelector(".fotos-pending__equipo");
    if (sel && !sel.value) sel.value = _filtroEquipo || _equipoPreseleccion || "";
  }

  // Selects de equipo (filtro arriba, etiqueta al subir): solo si la orden
  // tiene equipos; en una visita de campo no aparecen.
  function renderSelectsEquipo() {
    const ov = overlayEl();
    if (!ov) return;
    const opciones = `<option value="">Toda la orden</option>` +
      _equipos.map(e => `<option value="${esc(e.id || "")}">${esc(etiquetaEquipo(e))}</option>`).join("");
    const filtro = ov.querySelector(".fotos-filtro");
    if (filtro) {
      filtro.style.display = _equipos.length ? "" : "none";
      const sel = filtro.querySelector("select");
      if (sel) {
        sel.innerHTML = `<option value="">Todas las fotos</option>` +
          _equipos.map(e => `<option value="${esc(e.id || "")}">${esc(etiquetaEquipo(e))}</option>`).join("");
        sel.value = _filtroEquipo && _equipos.some(e => e.id === _filtroEquipo) ? _filtroEquipo : "";
        _filtroEquipo = sel.value;
      }
    }
    const wrapEq = ov.querySelector(".fotos-pending__equipo-wrap");
    if (wrapEq) {
      wrapEq.style.display = _equipos.length ? "" : "none";
      const sel = wrapEq.querySelector("select");
      if (sel) {
        const previo = sel.value;
        sel.innerHTML = opciones;
        sel.value = _equipos.some(e => e.id === previo) ? previo : (_equipoPreseleccion || "");
      }
    }
  }

  function fotosVisibles() {
    const activas = _fotos.filter(f => f.deleted !== true && !!f.url);
    if (!_filtroEquipo) return activas;
    const eq = _equipos.find(e => e.id === _filtroEquipo);
    return eq ? OrdenesService.fotosDeEquipo(_orden, eq) : activas;
  }

  function renderGaleria() {
    const ov = overlayEl();
    const wrap = ov?.querySelector(".fotos-galeria");
    if (!wrap) return;
    const total = _fotos.filter(f => f.deleted !== true && !!f.url).length;
    const cnt = ov.querySelector(".fotos-total");
    if (cnt) cnt.textContent = total ? `(${total})` : "";

    const activas = fotosVisibles();
    if (!activas.length) {
      wrap.innerHTML = `<div class="fotos-empty">${_filtroEquipo
        ? "Este equipo no tiene fotos todavía. Sube una y etiquétala con él."
        : "Sin fotos todavía. Usa los botones de arriba para capturar o subir la primera."}</div>`;
      return;
    }
    wrap.innerHTML = TIPOS.map(t => {
      const lista = activas.filter(f => f.tipo === t.key);
      if (!lista.length) return "";
      return `
        <div class="fotos-seccion">
          <div class="fotos-seccion__titulo">${t.label} <span class="fotos-seccion__count">${lista.length}</span></div>
          <div class="fotos-grid">
            ${lista.map(f => `
              <figure class="fotos-item">
                <img src="${esc(f.url)}" alt="Foto ${esc(t.label)}" loading="lazy" data-foto-ver="${esc(f.id)}">
                ${f.equipo_serial ? `<span class="fotos-item__equipo" title="Equipo ${esc(f.equipo_serial)}"><i data-lucide="radio"></i> ${esc(f.equipo_serial)}</span>` : ""}
                ${f.nota ? `<figcaption class="fotos-item__nota" title="${esc(f.nota)}">${esc(f.nota.slice(0, 60))}</figcaption>` : ""}
                ${canSoftDelete(f) ? `<button type="button" class="fotos-item__del" title="Eliminar foto" data-foto-borrar="${esc(f.id)}"><i data-lucide="trash-2"></i></button>` : ""}
              </figure>`).join("")}
          </div>
        </div>`;
    }).join("");
    if (APP.utils?.lucideRefresh) APP.utils.lucideRefresh(wrap);
  }

  // Deja la orden fresca en la bandeja (badges y modal del equipo leen de ahí).
  function sincronizarCache(data) {
    const cache = (APP.state.orders || []).find(x => x.ordenId === _ordenId);
    if (!cache || !data) return;
    cache.fotos_taller = data.fotos_taller;
    cache.fotos_taller_count = data.fotos_taller_count;
    if (Array.isArray(data.equipos)) cache.equipos = data.equipos;
    if (typeof refrescarEquiposDeOrden === "function") { try { refrescarEquiposDeOrden(_ordenId); } catch (_) {} }
  }

  function aplicarOrden(data) {
    _orden = data;
    _fotos = OrdenesService.fotosDeOrden(data);
    _equipos = (Array.isArray(data.equipos) ? data.equipos : []).filter(e => e && !e.eliminado);
    const sub = overlayEl()?.querySelector(".fotos-sub");
    if (sub) sub.textContent = `${data.cliente_nombre || "—"} · ${typeof estadoCompacto === "function" && data.estado_reparacion ? estadoCompacto(data.estado_reparacion, data) : (data.estado_reparacion || "—")}`;
    renderSelectsEquipo();
    renderGaleria();
  }

  async function recargar() {
    const data = await OrdenesService.getOrder(_ordenId);
    if (!data) { Toast.show("Orden no encontrada.", "bad"); cerrar(); return; }
    aplicarOrden(data);
  }

  async function subirPendiente() {
    if (!_pending) return;
    const user = firebase.auth().currentUser;
    if (!user) { Toast.show("Usuario no autenticado.", "bad"); return; }
    const ov = overlayEl();
    const btn = ov?.querySelector('[data-foto-accion="subir"]');
    if (btn) { btn.disabled = true; btn.textContent = "Subiendo…"; }
    try {
      const compressed = await compressImage(_pending.file);
      const ts = Date.now();
      const safeName = String(_pending.file.name || "foto.jpg").toLowerCase()
        .replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").replace(/\.[a-z0-9]+$/i, "") || "foto";
      const path = `ordenes_taller_fotos/${_ordenId}/${_pending.tipo}_${ts}_${safeName}.jpg`;
      if (typeof CargaDiferida !== "undefined" && CargaDiferida.storage) await CargaDiferida.storage();
      const ref = firebase.storage().ref(path);
      await ref.put(compressed, { contentType: "image/jpeg" });
      const url = await ref.getDownloadURL();

      const nota = (ov?.querySelector(".fotos-pending__nota")?.value || "").trim();
      const equipoId = ov?.querySelector(".fotos-pending__equipo")?.value || "";
      const equipo = _equipos.find(e => e.id === equipoId) || null;
      const data = await OrdenesService.addFotoOrden({
        ordenId: _ordenId,
        foto: { id: genPhotoId(), url, path, tipo: _pending.tipo, nota },
        equipo: equipo ? { id: equipo.id, serial: serialDe(equipo) || null } : null,
        user: { uid: user.uid || "", email: user.email || "" },
      });

      if (_pending.previewUrl) URL.revokeObjectURL(_pending.previewUrl);
      _pending = null;
      const notaEl = ov?.querySelector(".fotos-pending__nota");
      if (notaEl) notaEl.value = "";
      renderPending();
      Toast.show("✅ Foto subida", "ok");
      sincronizarCache(data);
      aplicarOrden(data);
    } catch (err) {
      console.error("Error subiendo foto:", err);
      Toast.show("No se pudo subir la foto. Intenta de nuevo.", "bad");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Subir foto"; }
    }
  }

  async function borrarFoto(photoId) {
    const foto = _fotos.find(f => f.id === photoId);
    if (!canSoftDelete(foto)) {
      Toast.show("Solo administración, el taller o quien subió la foto puede eliminarla.", "bad");
      return;
    }
    if (!await Modal.confirm({ message: "¿Marcar esta foto como eliminada?", danger: true })) return;
    const user = firebase.auth().currentUser;
    try {
      const data = await OrdenesService.softDeleteFotoOrden({
        ordenId: _ordenId, fotoId: photoId, uid: user?.uid || "", email: user?.email || "",
      });
      sincronizarCache(data);
      aplicarOrden(data);
    } catch (err) {
      console.error("Error eliminando foto:", err);
      Toast.show("No se pudo eliminar la foto.", "bad");
    }
  }

  function onFileSelected(file, tipo) {
    if (!file) return;
    if (!/^image\//i.test(file.type || "")) { Toast.show("Selecciona una imagen válida.", "bad"); return; }
    if (_pending?.previewUrl) URL.revokeObjectURL(_pending.previewUrl);
    _pending = { file, tipo, previewUrl: URL.createObjectURL(file) };
    renderPending();
  }

  /**
   * Abre la galería de la orden.
   * @param {string} ordenId
   * @param {{equipoId?: string}} [opts] - equipo con que se abre: filtra sus
   *   fotos y lo propone como etiqueta al subir (modal de intervención).
   */
  window.abrirFotosOrden = async function (ordenId, { equipoId = "" } = {}) {
    if (!ordenId) return;
    cerrar(); // por si quedó una instancia abierta de otra orden
    _ordenId = ordenId;
    _orden = null;
    _fotos = [];
    _equipos = [];
    _pending = null;
    _equipoPreseleccion = equipoId || "";
    _filtroEquipo = equipoId || "";

    const o = (APP.state.orders || []).find(x => x.ordenId === ordenId) || {};
    const esVisita = typeof esOrdenVisita === "function" && esOrdenVisita(o);

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.id = "fotosOrdenOverlay";
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <div class="modal fotos-modal">
        <div class="sheet-header">
          <h3 class="sheet-title"><i data-lucide="camera"></i> ${esVisita ? "Fotos de la visita" : "Fotos de la orden"} · ${esc(ordenId)} <span class="fotos-total muted"></span></h3>
          <button class="btn btn-ghost" data-close title="Cerrar"><i data-lucide="x"></i></button>
        </div>
        <div class="sheet-body">
          <div class="fotos-sub muted">Cargando…</div>
          <div class="fotos-captura">
            ${TIPOS.map(t => `
              <button type="button" class="btn btn-secondary" data-foto-tipo="${t.key}">
                <i data-lucide="camera"></i> ${t.label}
              </button>
              <input type="file" accept="image/*" capture="environment" hidden data-foto-input="${t.key}">`).join("")}
          </div>
          <div class="fotos-pending" style="display:none;">
            <img alt="Vista previa">
            <div class="fotos-pending__body">
              <div>Tipo: <strong class="fotos-pending__tipo">—</strong></div>
              <label class="fotos-pending__equipo-wrap" style="display:none;">
                <span class="muted">Equipo (opcional)</span>
                <select class="input fotos-pending__equipo"></select>
              </label>
              <input type="text" class="input fotos-pending__nota" maxlength="140" placeholder="Nota (opcional)">
              <div class="fotos-pending__acciones">
                <button type="button" class="btn btn-primary" data-foto-accion="subir">Subir foto</button>
                <button type="button" class="btn btn-ghost" data-foto-accion="cancelar">Cancelar</button>
              </div>
            </div>
          </div>
          <label class="fotos-filtro" style="display:none;">
            <span class="muted">Ver</span>
            <select class="input" data-foto-filtro></select>
          </label>
          <div class="fotos-galeria"></div>
        </div>
        <div class="fotos-viewer" id="fotosOrdenViewer">
          <button type="button" class="btn btn-ghost fotos-viewer__close" data-foto-accion="cerrar-viewer" title="Cerrar"><i data-lucide="x"></i></button>
          <img alt="Foto ampliada">
          <div class="fotos-viewer__meta"></div>
        </div>
      </div>`;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-close]")) { cerrar(); return; }

      const tipoBtn = e.target.closest("[data-foto-tipo]");
      if (tipoBtn) {
        const input = overlay.querySelector(`[data-foto-input="${tipoBtn.dataset.fotoTipo}"]`);
        if (input) { input.value = ""; input.click(); }
        return;
      }
      const accion = e.target.closest("[data-foto-accion]")?.dataset.fotoAccion;
      if (accion === "subir") { subirPendiente(); return; }
      if (accion === "cancelar") {
        if (_pending?.previewUrl) URL.revokeObjectURL(_pending.previewUrl);
        _pending = null; renderPending(); return;
      }
      if (accion === "cerrar-viewer") { closeViewer(); return; }

      const verId = e.target.closest("[data-foto-ver]")?.dataset.fotoVer;
      if (verId) { openViewer(_fotos.find(f => f.id === verId)); return; }
      const delId = e.target.closest("[data-foto-borrar]")?.dataset.fotoBorrar;
      if (delId) { borrarFoto(delId); return; }

      const viewer = document.getElementById("fotosOrdenViewer");
      if (viewer && e.target === viewer) closeViewer();
    });
    overlay.addEventListener("change", (e) => {
      if (e.target?.hasAttribute?.("data-foto-filtro")) {
        _filtroEquipo = e.target.value || "";
        renderGaleria();
        return;
      }
      const tipo = e.target?.dataset?.fotoInput;
      if (!tipo) return;
      onFileSelected(e.target.files && e.target.files[0], tipo);
    });

    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    if (APP.utils?.lucideRefresh) APP.utils.lucideRefresh(overlay);

    try {
      await recargar();
    } catch (err) {
      console.error("Error cargando fotos de la orden:", err);
      Toast.show("No se pudieron cargar las fotos.", "bad");
    }
  };
})();

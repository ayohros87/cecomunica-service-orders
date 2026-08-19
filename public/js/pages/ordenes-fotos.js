// @ts-nocheck
// Galería de fotos de la ORDEN en un modal (§5.23, aprobado 2026-08-19):
// reemplaza a la página fotos-taller.html (7 usos/90d). Mismo contrato de
// datos que la página retirada — fotos_taller[] en el doc de la orden,
// storage en ordenes_taller_fotos/{ordenId}/, os_logs SUBIR_FOTO_TALLER /
// ELIMINAR_FOTO_TALLER y mantenimiento de fotos_taller_count — así que las
// fotos históricas se ven igual y el badge de la fila sigue funcionando.
// Las fotos son a NIVEL DE ORDEN: sirve igual con o sin equipos (visitas
// técnicas de campo). Se abre con abrirFotosOrden(ordenId) desde el menú ⋯,
// el badge de la fila y el aviso del informe de visita.
(() => {
  const TIPOS = [
    { key: "antes",   label: "Antes" },
    { key: "despues", label: "Después" },
    { key: "detalle", label: "Detalle" },
  ];

  let _ordenId = "";
  let _orden = null;
  let _fotos = [];
  let _pending = null; // { file, tipo, previewUrl }

  const esc = (v) => (typeof FMT !== "undefined" && FMT.esc) ? FMT.esc(v)
    : String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

  const prettyTipo = (t) => (TIPOS.find(x => x.key === t) || {}).label || "Detalle";

  const genPhotoId = () => `ft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  function normalizeFotos(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(Boolean).map(f => ({
      id: f.id || genPhotoId(),
      url: f.url || "",
      path: f.path || "",
      tipo: f.tipo || "detalle",
      equipo_serial: f.equipo_serial || null,
      nota: f.nota || "",
      uploaded_by_uid: f.uploaded_by_uid || "",
      uploaded_by_email: f.uploaded_by_email || "",
      uploaded_at: f.uploaded_at || null,
      deleted: f.deleted === true,
      deleted_by_uid: f.deleted_by_uid || null,
      deleted_by_email: f.deleted_by_email || null,
      deleted_at: f.deleted_at || null,
    }));
  }

  // Puede eliminar: admin, jefe de taller, o quien subió la foto (mismo
  // criterio que la página retirada).
  function canSoftDelete(foto) {
    const rol = String(APP.state.userRole || "").toLowerCase();
    if ([ROLES.ADMIN, ROLES.JEFE_TALLER].map(r => String(r || "").toLowerCase()).includes(rol)) return true;
    const uid = firebase.auth().currentUser?.uid || "";
    return !!(foto?.uploaded_by_uid && uid && foto.uploaded_by_uid === uid);
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
      `${foto.nota ? `<br>${esc(foto.nota)}` : ""}${fecha ? `<br>${esc(fecha)}` : ""}`;
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
  }

  function renderGaleria() {
    const wrap = overlayEl()?.querySelector(".fotos-galeria");
    if (!wrap) return;
    const activas = _fotos.filter(f => f.deleted !== true && !!f.url);
    if (!activas.length) {
      wrap.innerHTML = `<div class="fotos-empty">Sin fotos todavía. Usa los botones de arriba para capturar o subir la primera.</div>`;
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
                ${f.nota ? `<figcaption class="fotos-item__nota" title="${esc(f.nota)}">${esc(f.nota.slice(0, 60))}</figcaption>` : ""}
                ${canSoftDelete(f) ? `<button type="button" class="fotos-item__del" title="Eliminar foto" data-foto-borrar="${esc(f.id)}"><i data-lucide="trash-2"></i></button>` : ""}
              </figure>`).join("")}
          </div>
        </div>`;
    }).join("");
    if (APP.utils?.lucideRefresh) APP.utils.lucideRefresh(wrap);
  }

  async function recargar() {
    const data = await OrdenesService.getOrder(_ordenId);
    if (!data) { Toast.show("Orden no encontrada.", "bad"); cerrar(); return; }
    _orden = data;
    _fotos = normalizeFotos(data.fotos_taller || []);
    const sub = overlayEl()?.querySelector(".fotos-sub");
    if (sub) sub.textContent = `${data.cliente_nombre || "—"} · ${data.estado_reparacion || "—"}`;
    renderGaleria();
  }

  async function subirPendiente() {
    if (!_pending) return;
    const user = firebase.auth().currentUser;
    if (!user) { Toast.show("Usuario no autenticado.", "bad"); return; }
    const btn = overlayEl()?.querySelector('[data-foto-accion="subir"]');
    if (btn) { btn.disabled = true; btn.textContent = "Subiendo…"; }
    try {
      const compressed = await compressImage(_pending.file);
      const ts = Date.now();
      const safeName = String(_pending.file.name || "foto.jpg").toLowerCase()
        .replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").replace(/\.[a-z0-9]+$/i, "") || "foto";
      const path = `ordenes_taller_fotos/${_ordenId}/${_pending.tipo}_${ts}_${safeName}.jpg`;
      const ref = firebase.storage().ref(path);
      await ref.put(compressed, { contentType: "image/jpeg" });
      const url = await ref.getDownloadURL();

      const nota = (overlayEl()?.querySelector(".fotos-pending__nota")?.value || "").trim();
      const photoMeta = {
        id: genPhotoId(), url, path, tipo: _pending.tipo,
        equipo_serial: null, nota,
        uploaded_by_uid: user.uid || "", uploaded_by_email: user.email || "",
        uploaded_at: firebase.firestore.Timestamp.now(), deleted: false,
      };
      await OrdenesService.updateOrder(_ordenId, {
        fotos_taller: firebase.firestore.FieldValue.arrayUnion(photoMeta),
        os_logs: firebase.firestore.FieldValue.arrayUnion({
          action: "SUBIR_FOTO_TALLER", by: user.uid || "", email: user.email || "",
          tipo: _pending.tipo, ts: firebase.firestore.Timestamp.now(),
        }),
        fotos_taller_updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Recuento sobre lectura fresca (mismo patrón que la página retirada:
      // arrayUnion no sabe cuántas quedaron).
      const fresh = await OrdenesService.getOrder(_ordenId);
      const count = normalizeFotos(fresh?.fotos_taller || []).filter(f => f.deleted !== true).length;
      await OrdenesService.updateOrder(_ordenId, {
        fotos_taller_count: count,
        fotos_taller_updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (_pending.previewUrl) URL.revokeObjectURL(_pending.previewUrl);
      _pending = null;
      const notaEl = overlayEl()?.querySelector(".fotos-pending__nota");
      if (notaEl) notaEl.value = "";
      renderPending();
      Toast.show("✅ Foto subida", "ok");
      await recargar();
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
      Toast.show("Solo un administrador, el jefe de taller o quien subió la foto puede eliminarla.", "bad");
      return;
    }
    if (!await Modal.confirm({ message: "¿Marcar esta foto como eliminada?", danger: true })) return;
    const user = firebase.auth().currentUser;
    try {
      const data = await OrdenesService.getOrder(_ordenId);
      const fotos = normalizeFotos(data?.fotos_taller || []);
      let tipo = "";
      const updated = fotos.map(f => {
        if (f.id !== photoId || f.deleted === true) return f;
        tipo = f.tipo || "";
        return { ...f, deleted: true, deleted_by_uid: user?.uid || "", deleted_by_email: user?.email || "", deleted_at: firebase.firestore.Timestamp.now() };
      });
      await OrdenesService.updateOrder(_ordenId, {
        fotos_taller: updated,
        fotos_taller_count: updated.filter(f => f.deleted !== true).length,
        fotos_taller_updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        os_logs: firebase.firestore.FieldValue.arrayUnion({
          action: "ELIMINAR_FOTO_TALLER", by: user?.uid || "", email: user?.email || "",
          tipo, ts: firebase.firestore.Timestamp.now(),
        }),
      });
      await recargar();
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

  window.abrirFotosOrden = async function (ordenId) {
    if (!ordenId) return;
    cerrar(); // por si quedó una instancia abierta de otra orden
    _ordenId = ordenId;
    _fotos = [];
    _pending = null;

    const o = (APP.state.orders || []).find(x => x.ordenId === ordenId) || {};
    const esVisita = typeof esOrdenVisita === "function" && esOrdenVisita(o);

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.id = "fotosOrdenOverlay";
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <div class="modal fotos-modal">
        <div class="sheet-header">
          <h3 class="sheet-title"><i data-lucide="camera"></i> ${esVisita ? "Fotos de la visita" : "Fotos de taller"} · ${esc(ordenId)}</h3>
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
              <input type="text" class="input fotos-pending__nota" maxlength="140" placeholder="Nota (opcional)">
              <div class="fotos-pending__acciones">
                <button type="button" class="btn btn-primary" data-foto-accion="subir">Subir foto</button>
                <button type="button" class="btn btn-ghost" data-foto-accion="cancelar">Cancelar</button>
              </div>
            </div>
          </div>
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

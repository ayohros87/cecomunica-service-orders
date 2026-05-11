// @ts-nocheck
    const storage = firebase.storage();
    const firestore = firebase.firestore();

    const state = {
      ordenId: "",
      orderDoc: null,
      user: null,
      userRole: "",
      equiposActivos: [],
      pendingTipo: "",
      pendingFile: null,
      pendingPreviewUrl: "",
      fotos: []
    };

    function setStatus(msg, isError = false) {
      const el = document.getElementById("statusMsg");
      if (!el) return;
      el.textContent = msg || "";
      el.style.color = isError ? "#b91c1c" : "#475569";
    }

    function sanitizeFileName(name) {
      const raw = (name || "foto").toLowerCase();
      const noSpaces = raw.replace(/\s+/g, "-");
      return noSpaces.replace(/[^a-z0-9._-]/g, "");
    }

    function genPhotoId() {
      return `ft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function prettyTipo(tipo) {
      if (tipo === "antes") return "Antes";
      if (tipo === "despues") return "Después";
      if (tipo === "detalle") return "Detalle";
      return "—";
    }

    function formatTimestamp(ts) {
      if (!ts) return "";
      try {
        const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
        if (!d || Number.isNaN(d.getTime())) return "";
        return d.toLocaleString("es-CO", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });
      } catch (_) {
        return "";
      }
    }

    function getOrdenIdFromQuery() {
      const params = new URLSearchParams(window.location.search);
      return (params.get("ordenId") || "").trim();
    }

    function bindCaptureButtons() {
      document.querySelectorAll(".capture-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const tipo = btn.dataset.tipo;
          const inputId = tipo === "antes" ? "inputAntes" : tipo === "despues" ? "inputDespues" : "inputDetalle";
          const input = document.getElementById(inputId);
          if (!input) return;
          input.value = "";
          input.click();
        });
      });

      document.querySelectorAll(".hidden-input").forEach(input => {
        input.addEventListener("change", (e) => {
          const tipo = e.target.dataset.tipo;
          const file = e.target.files && e.target.files[0];
          onImageSelected(file, tipo);
        });
      });
    }

    function bindUiEvents() {
      document.getElementById("btnBack").addEventListener("click", () => {
        window.location.href = "index.html";
      });

      document.getElementById("btnCancelarFoto").addEventListener("click", clearPendingCapture);
      document.getElementById("btnSubirFoto").addEventListener("click", uploadPendingPhoto);

      const viewer = document.getElementById("viewer");
      document.getElementById("btnViewerClose").addEventListener("click", closeViewer);
      viewer.addEventListener("click", (e) => {
        if (e.target === viewer) closeViewer();
      });
    }

    function clearPendingCapture() {
      if (state.pendingPreviewUrl) {
        URL.revokeObjectURL(state.pendingPreviewUrl);
      }
      state.pendingPreviewUrl = "";
      state.pendingFile = null;
      state.pendingTipo = "";

      document.getElementById("previewImg").src = "";
      document.getElementById("previewTipo").textContent = "—";
      document.getElementById("fotoNota").value = "";
      document.getElementById("equipoSerial").value = "";
      document.getElementById("previewCard").classList.remove("show");
      setStatus("");
    }

    function populateEquiposSelect() {
      const select = document.getElementById("equipoSerial");
      if (!select) return;

      const options = ["<option value=''>Sin serial</option>"];
      state.equiposActivos.forEach(eq => {
        const serial = (eq.numero_de_serie || eq.serial || "").toString().trim();
        if (!serial) return;
        const modelo = (eq.modelo || eq.modelo_nombre || "").toString().trim();
        const label = modelo ? `${serial} - ${modelo}` : serial;
        options.push(`<option value="${escapeHtml(serial)}">${escapeHtml(label)}</option>`);
      });

      select.innerHTML = options.join("");
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function onImageSelected(file, tipo) {
      if (!file) {
        setStatus("No se seleccionó imagen.", true);
        return;
      }
      if (!/^image\//i.test(file.type || "")) {
        alert("Selecciona una imagen válida.");
        return;
      }

      clearPendingCapture();
      state.pendingFile = file;
      state.pendingTipo = tipo;
      state.pendingPreviewUrl = URL.createObjectURL(file);

      document.getElementById("previewImg").src = state.pendingPreviewUrl;
      document.getElementById("previewTipo").textContent = prettyTipo(tipo);
      document.getElementById("previewCard").classList.add("show");
      setStatus("Foto lista para subir.");
    }

    async function compressImage(file, maxWidth = 1600, quality = 0.75) {
      const dataUrl = await readFileAsDataURL(file);
      const img = await loadImage(dataUrl);

      let targetWidth = img.width;
      let targetHeight = img.height;
      if (img.width > maxWidth) {
        const ratio = maxWidth / img.width;
        targetWidth = maxWidth;
        targetHeight = Math.round(img.height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error("No se pudo comprimir la imagen"));
        }, "image/jpeg", quality);
      });

      return blob;
    }

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

    function normalizeFotos(arr) {
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(Boolean)
        .map(f => ({
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
          deleted_at: f.deleted_at || null
        }));
    }

    function activeFotos() {
      return (state.fotos || []).filter(f => f.deleted !== true && !!f.url);
    }

    function countByTipo(list, tipo) {
      return list.filter(f => f.tipo === tipo).length;
    }

    function openViewer(url, meta) {
      const viewer = document.getElementById("viewer");
      document.getElementById("viewerImg").src = url;
      document.getElementById("viewerMeta").innerHTML = meta;
      viewer.classList.add("show");
    }

    function closeViewer() {
      const viewer = document.getElementById("viewer");
      viewer.classList.remove("show");
      document.getElementById("viewerImg").src = "";
      document.getElementById("viewerMeta").textContent = "";
    }

    function canSoftDelete() {
      return String(state.userRole || "").toLowerCase() === "administrador";
    }

    function renderGallery() {
      const all = activeFotos();
      const before = all.filter(f => f.tipo === "antes");
      const after = all.filter(f => f.tipo === "despues");
      const detail = all.filter(f => f.tipo === "detalle");

      const empty = document.getElementById("emptyState");
      empty.style.display = all.length ? "none" : "block";

      renderTipoSection("antes", before, "sectionAntes", "gridAntes", "countAntes");
      renderTipoSection("despues", after, "sectionDespues", "gridDespues", "countDespues");
      renderTipoSection("detalle", detail, "sectionDetalle", "gridDetalle", "countDetalle");
    }

    function renderTipoSection(tipo, fotos, sectionId, gridId, countId) {
      const section = document.getElementById(sectionId);
      const grid = document.getElementById(gridId);
      const countEl = document.getElementById(countId);

      countEl.textContent = fotos.length;
      section.style.display = fotos.length ? "grid" : "none";

      if (!fotos.length) {
        grid.innerHTML = "";
        return;
      }

      grid.innerHTML = fotos.map(f => {
        const serial = f.equipo_serial ? `Serial: ${escapeHtml(f.equipo_serial)}` : "Sin serial";
        const noteShort = (f.nota || "").trim();
        const noteHtml = noteShort ? `<div class=\"photo-note\">${escapeHtml(noteShort.slice(0, 90))}</div>` : "";

        return `
          <article class="photo-item">
            <img class="photo-thumb" src="${escapeHtml(f.url)}" alt="Foto ${escapeHtml(tipo)}" data-action="open-viewer" data-photo-id="${escapeHtml(f.id)}">
            <div class="photo-body">
              <div class="photo-meta">${serial}</div>
              ${noteHtml}
              ${canSoftDelete() ? `<button class=\"photo-delete\" data-action=\"delete-photo\" data-photo-id=\"${escapeHtml(f.id)}\">Eliminar</button>` : ""}
            </div>
          </article>
        `;
      }).join("");

      grid.querySelectorAll('[data-action="open-viewer"]').forEach(img => {
        img.addEventListener("click", () => {
          const photoId = img.dataset.photoId;
          const foto = (state.fotos || []).find(f => f.id === photoId);
          if (!foto || !foto.url) return;

          const fecha = formatTimestamp(foto.uploaded_at);
          const meta = `${escapeHtml(prettyTipo(foto.tipo))}${foto.equipo_serial ? ` · ${escapeHtml(foto.equipo_serial)}` : ""}${foto.nota ? `<br>${escapeHtml(foto.nota)}` : ""}${fecha ? `<br>${escapeHtml(fecha)}` : ""}`;
          openViewer(foto.url, meta);
        });
      });

      grid.querySelectorAll('[data-action="delete-photo"]').forEach(btn => {
        btn.addEventListener("click", () => {
          softDeletePhoto(btn.dataset.photoId);
        });
      });
    }

    async function uploadPendingPhoto() {
      if (!state.user) {
        alert("Usuario no autenticado.");
        return;
      }
      if (!state.ordenId) {
        alert("No se detectó la orden.");
        return;
      }
      if (!state.pendingFile || !state.pendingTipo) {
        alert("No hay imagen seleccionada.");
        return;
      }

      const btn = document.getElementById("btnSubirFoto");
      btn.disabled = true;
      btn.textContent = "Subiendo...";

      try {
        setStatus("Comprimiendo imagen...");
        const compressed = await compressImage(state.pendingFile, 1600, 0.75);

        setStatus("Subiendo a almacenamiento...");
        const ts = Date.now();
        const safeName = sanitizeFileName(state.pendingFile.name || "foto.jpg").replace(/\.[a-z0-9]+$/i, "") || "foto";
        const fileName = `${state.pendingTipo}_${ts}_${safeName}.jpg`;
        const path = `ordenes_taller_fotos/${state.ordenId}/${fileName}`;
        const ref = storage.ref(path);

        await ref.put(compressed, { contentType: "image/jpeg" });
        const url = await ref.getDownloadURL();

        const equipoSerial = (document.getElementById("equipoSerial").value || "").trim() || null;
        const nota = (document.getElementById("fotoNota").value || "").trim();

        const photoMeta = {
          id: genPhotoId(),
          url,
          path,
          tipo: state.pendingTipo,
          equipo_serial: equipoSerial,
          nota,
          uploaded_by_uid: state.user.uid || "",
          uploaded_by_email: state.user.email || "",
          uploaded_at: firebase.firestore.Timestamp.now(),
          deleted: false
        };

        const logEntry = {
          action: "SUBIR_FOTO_TALLER",
          by: state.user.uid || "",
          email: state.user.email || "",
          tipo: state.pendingTipo,
          ts: firebase.firestore.Timestamp.now()
        };

        await OrdenesService.updateOrder(state.ordenId, {
          fotos_taller: firebase.firestore.FieldValue.arrayUnion(photoMeta),
          os_logs: firebase.firestore.FieldValue.arrayUnion(logEntry),
          fotos_taller_updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });

        const freshData = await OrdenesService.getOrder(state.ordenId);
        const freshFotos = normalizeFotos((freshData && freshData.fotos_taller) || []);
        const count = freshFotos.filter(f => f.deleted !== true).length;

        await OrdenesService.updateOrder(state.ordenId, {
          fotos_taller_count: count,
          fotos_taller_updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });

        setStatus("Foto subida correctamente.");
        clearPendingCapture();
        await loadOrder();
      } catch (err) {
        console.error("Error al subir foto:", err);
        alert("No se pudo subir la foto. Intenta de nuevo.");
        setStatus("Error al subir la foto.", true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Subir foto";
      }
    }

    async function softDeletePhoto(photoId) {
      if (!photoId) return;
      if (!canSoftDelete()) {
        alert("Solo un administrador puede eliminar fotos.");
        return;
      }
      if (!confirm("¿Marcar esta foto como eliminada?")) return;

      try {
        const data = await OrdenesService.getOrder(state.ordenId);
        if (!data) {
          alert("La orden no existe.");
          return;
        }

        const fotos = normalizeFotos(data.fotos_taller || []);
        let found = false;
        let deletedTipo = "";

        const updatedFotos = fotos.map(f => {
          if (f.id !== photoId || f.deleted === true) return f;
          found = true;
          deletedTipo = f.tipo || "";
          return {
            ...f,
            deleted: true,
            deleted_by_uid: state.user.uid || "",
            deleted_by_email: state.user.email || "",
            deleted_at: firebase.firestore.Timestamp.now()
          };
        });

        if (!found) {
          alert("No se encontró la foto seleccionada.");
          return;
        }

        const count = updatedFotos.filter(f => f.deleted !== true).length;
        const logEntry = {
          action: "ELIMINAR_FOTO_TALLER",
          by: state.user.uid || "",
          email: state.user.email || "",
          tipo: deletedTipo,
          ts: firebase.firestore.Timestamp.now()
        };

        await OrdenesService.updateOrder(state.ordenId, {
          fotos_taller: updatedFotos,
          fotos_taller_count: count,
          fotos_taller_updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          os_logs: firebase.firestore.FieldValue.arrayUnion(logEntry)
        });

        await loadOrder();
      } catch (err) {
        console.error("Error eliminando foto:", err);
        alert("No se pudo eliminar la foto.");
      }
    }

    async function loadUserRole(uid) {
      try {
        const u = await UsuariosService.getUsuario(uid);
        state.userRole = u ? (u.rol || "").toString().trim().toLowerCase() : "";
      } catch (err) {
        console.warn("No se pudo cargar rol:", err);
        state.userRole = "";
      }
    }

    async function loadOrder() {
      if (!state.ordenId) return;

      const data = await OrdenesService.getOrder(state.ordenId);
      if (!data) {
        alert("Orden no encontrada.");
        window.location.href = "index.html";
        return;
      }

      state.orderDoc = data;
      state.fotos = normalizeFotos(data.fotos_taller || []);
      state.equiposActivos = (data.equipos || []).filter(e => e && e.eliminado !== true);

      document.getElementById("metaOrden").textContent = `Orden: ${state.ordenId}`;
      document.getElementById("metaCliente").textContent = `Cliente: ${data.cliente_nombre || "—"}`;
      document.getElementById("metaEstado").textContent = `Estado: ${data.estado_reparacion || "—"}`;

      populateEquiposSelect();
      renderGallery();
    }

    function init() {
      bindUiEvents();
      bindCaptureButtons();

      state.ordenId = getOrdenIdFromQuery();
      if (!state.ordenId) {
        alert("Falta el parámetro ordenId en la URL.");
        window.location.href = "index.html";
        return;
      }

      firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
          alert("Debes iniciar sesión para usar esta función.");
          window.location.href = "../login.html";
          return;
        }

        state.user = user;
        await loadUserRole(user.uid);

        try {
          await loadOrder();
        } catch (err) {
          console.error("Error cargando orden:", err);
          alert("No se pudo cargar la orden.");
        }
      });
    }

    document.addEventListener("DOMContentLoaded", init);

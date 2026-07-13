// @ts-nocheck
// Sección "Documentos legales" en el form de cliente (solo modo edición).
// Subida + listado + ver (URL firmada efímera) + borrado lógico.
// Toda visualización pasa por la callable getClienteDocUrl: estos archivos son
// PII y Storage los tiene en read:false.
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const clienteId = params.get("id");

  const $section = document.getElementById("docsSection");
  if (!$section) return;

  $section.style.display = "";

  // Sin clienteId (alta) no hay dónde colgar documentos: se piden tras guardar.
  if (!clienteId) {
    document.getElementById("docsNeedSave").style.display = "";
    document.getElementById("docsBody").style.display = "none";
    return;
  }

  const $tipo   = document.getElementById("docTipo");
  const $file   = document.getElementById("docFile");
  const $btn    = document.getElementById("docBtnSubir");
  const $status = document.getElementById("docUploadStatus");
  const $pct    = document.getElementById("docUploadPct");
  const $list   = document.getElementById("docList");

  function escapeHtml(s) { return FMT.esc(s); } // helper canónico (core/formatting.js)
  function fmtSize(bytes) {
    if (!bytes) return "";
    const kb = bytes / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }
  function fmtDate(ts) {
    const d = ts?.toDate?.();
    return d ? d.toLocaleString("es-PA", { hour12: false }) : "";
  }

  // Poblar tipos
  ClienteDocumentosService.TIPOS.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.value; opt.textContent = t.label;
    $tipo.appendChild(opt);
  });

  function rowHtml(d) {
    return `
      <div class="doc-row" data-id="${d.id}" style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) 0;border-bottom:1px solid var(--border-1);">
        <i data-lucide="${(d.content_type || '').includes('pdf') ? 'file-text' : 'image'}" style="width:18px;height:18px;color:var(--fg-3);"></i>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;">${escapeHtml(ClienteDocumentosService.labelFor(d.tipo))}</div>
          <div style="font-size:12px;color:var(--fg-3);">${escapeHtml(d.nombre_archivo || "")} · ${fmtSize(d.size)} · ${fmtDate(d.subido_en)}</div>
        </div>
        <button type="button" class="btn sm" data-ver><i data-lucide="eye"></i> Ver</button>
        <button type="button" class="btn sm danger" data-del><i data-lucide="trash-2"></i></button>
      </div>`;
  }

  async function refresh() {
    $list.innerHTML = `<div style="color:var(--fg-3);padding:var(--sp-2) 0;">Cargando…</div>`;
    try {
      const docs = await ClienteDocumentosService.list(clienteId);
      if (!docs.length) {
        $list.innerHTML = `<div style="color:var(--fg-3);padding:var(--sp-2) 0;">No hay documentos cargados.</div>`;
        return;
      }
      $list.innerHTML = docs.map(rowHtml).join("");
      wireRows(docs);
      if (typeof lucide !== "undefined") lucide.createIcons();
    } catch (err) {
      console.error("[cliente-documentos] list:", err);
      $list.innerHTML = `<div style="color:var(--danger);padding:var(--sp-2) 0;">Error al cargar documentos.</div>`;
    }
  }

  function wireRows(docs) {
    $list.querySelectorAll(".doc-row").forEach(row => {
      const id = row.dataset.id;
      row.querySelector("[data-ver]").onclick = async () => {
        const b = row.querySelector("[data-ver]");
        b.disabled = true;
        try {
          const url = await ClienteDocumentosService.getViewUrl(clienteId, id);
          window.open(url, "_blank", "noopener");
        } catch (err) {
          Toast.show(err.message || "No se pudo abrir el documento.", "bad");
        } finally {
          b.disabled = false;
        }
      };
      row.querySelector("[data-del]").onclick = async () => {
        const d = docs.find(x => x.id === id);
        const ok = await Modal.confirm({
          message: `¿Eliminar el documento "${escapeHtml(d?.nombre_archivo || "")}"?`,
          danger: true,
        });
        if (!ok) return;
        try {
          await ClienteDocumentosService.softDelete(clienteId, id);
          Toast.show("Documento eliminado.", "ok");
          refresh();
        } catch (err) {
          Toast.show("No se pudo eliminar: " + err.message, "bad");
        }
      };
    });
  }

  function setBusy(on) {
    $btn.disabled = on; $tipo.disabled = on; $file.disabled = on;
    $status.style.display = on ? "inline" : "none";
  }

  $btn.onclick = () => {
    const file = $file.files[0];
    if (!file) { Toast.show("Selecciona un archivo.", "warn"); return; }
    const okType = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!okType) { Toast.show("Solo PDF o imágenes.", "warn"); return; }
    if (file.size > 10 * 1024 * 1024) { Toast.show("El archivo supera 10 MB.", "warn"); return; }

    setBusy(true);
    $pct.textContent = "0%";
    ClienteDocumentosService.upload({
      clienteId,
      tipo: $tipo.value,
      file,
      onProgress: (p) => { $pct.textContent = p + "%"; },
      onError: (err) => {
        console.error("[cliente-documentos] upload:", err);
        Toast.show("Error al subir: " + err.message, "bad");
        setBusy(false);
      },
      onDone: () => {
        Toast.show("Documento subido.", "ok");
        $file.value = "";
        setBusy(false);
        refresh();
      },
    });
  };

  refresh();
})();

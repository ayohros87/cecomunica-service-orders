// @ts-nocheck
/* ========================================
 * ORDENES NOTAS - Notas técnicas modal
 * Builds the dynamic notes-técnicas modal for the order list view.
 * Writes nota_tecnica via OrdenesService and reloads on save.
 * ======================================== */

window.gestionarNotasTecnicas = async function(ordenId) {
  const datos = await OrdenesService.getOrder(ordenId);
  if (!datos) {
    Toast.show("Orden no encontrada", 'bad');
    return;
  }

  const notaAnterior = datos.nota_tecnica || "";

  // 🎨 Crear modal moderno para notas técnicas
  const modal = document.createElement("div");
  modal.className = "notas-modal";

  const dialog = document.createElement("div");
  dialog.className = "notas-dialog";

  const header = document.createElement("div");
  header.className = "notas-header";
  header.innerHTML = `
    <div class="notas-title">
      <span class="notas-icon">🧠</span>
      <h3>Notas Técnicas - Orden ${ordenId}</h3>
    </div>
    <button id="closeNotasModal" class="notas-close" type="button"><i data-lucide="x"></i></button>
  `;

  const content = document.createElement("div");
  content.className = "notas-content";

  const label = document.createElement("label");
  label.className = "notas-label";
  label.textContent = "Escribe las notas técnicas de esta orden:";

  const textarea = document.createElement("textarea");
  textarea.id = "notasTecnicasTextarea";
  textarea.value = notaAnterior;
  textarea.placeholder = "Descripción detallada del trabajo realizado, piezas utilizadas, observaciones importantes...";
  textarea.className = "notas-textarea";

  const charCount = document.createElement("div");
  charCount.className = "notas-charcount";
  charCount.textContent = `${notaAnterior.length} caracteres`;

  textarea.oninput = () => {
    const len = textarea.value.length;
    charCount.textContent = `${len} caracteres`;
    if (len > 5000) {
      charCount.style.color = "#dc2626";
      charCount.textContent += " (máximo recomendado: 5000)";
    } else {
      charCount.style.color = "var(--muted)";
    }
  };

  const footer = document.createElement("div");
  footer.className = "notas-footer";

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.onclick = () => document.body.removeChild(modal);

  const btnGuardar = document.createElement("button");
  btnGuardar.className = "btn primary";
  btnGuardar.textContent = "Guardar nota";
  
  btnGuardar.onclick = async () => {
    const nuevaNota = textarea.value.trim();
    
    // Mostrar loading
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = `<span class="spinner"></span> Guardando...`;

    try {
      await OrdenesService.updateTechnicalNote(ordenId, nuevaNota);

      // ✅ Actualizar el botón directamente sin recargar
      const fila = [...document.querySelectorAll("tr")].find(f => f.innerText.includes(ordenId));
      if (fila) {
        const btns = fila.querySelectorAll("button");
        const botonNota = [...btns].find(b => b.textContent.includes("🧠"));
        if (botonNota) {
          if (nuevaNota) {
            botonNota.style.backgroundColor = "#d4edda";
            botonNota.style.borderColor = "#28a745";
            botonNota.title = nuevaNota.slice(0, 100).replace(/"/g, "'") + (nuevaNota.length > 100 ? "..." : "");
          } else {
            botonNota.style.backgroundColor = "";
            botonNota.style.borderColor = "";
            botonNota.title = "Agregar nota técnica";
          }
        }
      }

      document.body.removeChild(modal);
      Toast.show("✅ Nota técnica guardada exitosamente", "ok");
    } catch (error) {
      console.error("Error al guardar nota:", error);
      Toast.show("❌ Error al guardar la nota técnica", "bad");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Guardar nota";
    }
  };

  // Cerrar con ESC
  const handleEscape = (e) => {
    if (e.key === "Escape" && document.body.contains(modal)) {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);

  // Cerrar al hacer clic fuera
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
      document.removeEventListener("keydown", handleEscape);
    }
  };
  dialog.onclick = (e) => e.stopPropagation();

  // Ensamblar modal
  content.appendChild(label);
  content.appendChild(textarea);
  content.appendChild(charCount);
  footer.appendChild(btnCancelar);
  footer.appendChild(btnGuardar);
  dialog.appendChild(header);
  dialog.appendChild(content);
  dialog.appendChild(footer);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  // Configurar el botón de cerrar DESPUÉS de que el modal esté en el DOM
  document.getElementById("closeNotasModal").onclick = () => {
    document.body.removeChild(modal);
    document.removeEventListener("keydown", handleEscape);
  };

  // Auto-focus y seleccionar todo el texto
  setTimeout(() => {
    textarea.focus();
    textarea.select();
  }, 100);
};

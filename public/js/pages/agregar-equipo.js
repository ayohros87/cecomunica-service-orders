// @ts-nocheck
    const form = document.getElementById("formEquipos");
    const container = document.getElementById("equiposContainer");
    const mensaje = document.getElementById("mensaje");
    let modelos = [];

    let contador = 0;

    // Escapes mínimos para inyectar valores de usuario en el markup del fieldset.
    const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    async function cargarModelos() {
  const raw = await ModelosService.getModelos();
  modelos = raw
    .map(m => ({
      id: m.id,
      nombre: (m.modelo || m.nombre || "(sin nombre)").trim()
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}


    // Crea un fieldset de equipo (modelo + serie + accesorios + observaciones) y
    // lo agrega al contenedor. Compartido por "Agregar equipo" y el importador en
    // lote. Devuelve el fieldset creado.
    function renderEquipoFieldset({ serial = "", modeloId = "", accesorios = {}, observaciones = "", focusSerie = false } = {}) {
      const id = `equipo_${contador}`;
      const uuid = crypto.randomUUID();
      const acc = accesorios || {};

      const html = `
  <fieldset id="${id}" data-uuid="${uuid}" class="section form">
    <legend>Equipo ${contador + 1}</legend>

    <div class="form-grid cols-2">
      <div class="form-field">
        <label class="req">Modelo</label>
        <select class="modelo" required>
          <option value="">Seleccione modelo</option>
          ${modelos.map(m => `<option value="${m.id}" ${m.id === modeloId ? 'selected' : ''}>${escHtml(m.nombre)}</option>`).join('')}
        </select>
      </div>

      <div class="form-field">
        <label class="req">Serie</label>
        <input type="text" class="serie" value="${escAttr(serial)}" required>
      </div>
    </div>

    <div class="form-field">
      <label>Accesorios</label>
      <div class="chips">
        <label class="chip"><input type="checkbox" class="todos-accesorios"> Todos</label>
        <label class="chip"><input type="checkbox" class="bateria" ${acc.bateria ? 'checked' : ''}> Batería</label>
        <label class="chip"><input type="checkbox" class="clip" ${acc.clip ? 'checked' : ''}> Clip</label>
        <label class="chip"><input type="checkbox" class="cargador" ${acc.cargador ? 'checked' : ''}> Cargador</label>
        <label class="chip"><input type="checkbox" class="fuente" ${acc.fuente ? 'checked' : ''}> Fuente</label>
        <label class="chip"><input type="checkbox" class="antena" ${acc.antena ? 'checked' : ''}> Antena</label>
        <label class="chip"><input type="checkbox" class="cubrepolvo" ${acc.cubrepolvo ? 'checked' : ''}> Cubre Polvo</label>
      </div>
    </div>

    <div class="form-field">
      <label>Observaciones</label>
      <textarea class="observaciones" rows="2">${escHtml(observaciones)}</textarea>
    </div>

    <div class="form-actions" style="justify-content:flex-start">
      <button type="button" class="btn btn-danger" onclick="document.getElementById('${id}').remove()"><i data-lucide="trash-2"></i> Eliminar equipo</button>
    </div>
  </fieldset>
`;

      container.insertAdjacentHTML("beforeend", html);
      if (typeof lucide !== 'undefined') lucide.createIcons();

      const fieldset = document.getElementById(id);
      const todosCheckbox = fieldset.querySelector(".todos-accesorios");
      if (todosCheckbox) {
        todosCheckbox.addEventListener("change", function () {
          fieldset.querySelectorAll("input[type='checkbox']").forEach(c => {
            if (!c.classList.contains("todos-accesorios")) c.checked = this.checked;
          });
        });
      }

      if (focusSerie) {
        const serieInput = fieldset.querySelector(".serie");
        if (serieInput) serieInput.focus();
      }

      contador++;
      return fieldset;
    }

    window.agregarEquipo = () => renderEquipoFieldset({ focusSerie: true });

    form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const equipos = container.querySelectorAll("fieldset");
  let guardados = 0;
  const nuevosEquipos = [];

  const ordenId = document.getElementById("orden_id").value;
  const ordenData = await OrdenesService.getOrder(ordenId);

  if (!ordenData) {
    mensaje.style.color = "red";
    mensaje.textContent = "❌ No se encontró la orden";
    return;
  }

  const equiposExistentes = ordenData.equipos || [];

  for (let equipo of equipos) {
    const serieInput = equipo.querySelector(".serie");
    const modeloInput = equipo.querySelector(".modelo");
    const observacionesInput = equipo.querySelector(".observaciones");

    if (
      !serieInput?.value.trim() &&
      !modeloInput?.value.trim() &&
      !equipo.querySelector(".bateria")?.checked &&
      !equipo.querySelector(".clip")?.checked &&
      !equipo.querySelector(".cargador")?.checked &&
      !equipo.querySelector(".fuente")?.checked &&
      !equipo.querySelector(".antena")?.checked &&
      !equipo.querySelector(".cubrepolvo")?.checked &&
      !observacionesInput?.value.trim()
    ) {
      console.log("❌ Equipo ignorado por estar completamente vacío");
      continue;
    }

    // Normalize via the shared EquipoNormalize helper so canonical
    // field names (serial / modelo / observaciones) are guaranteed,
    // regardless of which legacy alias an upstream snippet might use.
    const nuevoEquipo = EquipoNormalize.normalize({
      id: crypto.randomUUID(),
      modelo_id: modeloInput?.value || "",
      modelo: modelos.find(m => m.id === modeloInput?.value)?.nombre || "",
      serial: serieInput?.value.trim() || "",
      // numero_de_serie kept as a write-side alias for now — readers
      // across the codebase still mix `serial` and `numero_de_serie`.
      // Drop once those readers consolidate on `serial`.
      numero_de_serie: serieInput?.value.trim() || "",
      bateria: equipo.querySelector(".bateria")?.checked || false,
      clip: equipo.querySelector(".clip")?.checked || false,
      cargador: equipo.querySelector(".cargador")?.checked || false,
      fuente: equipo.querySelector(".fuente")?.checked || false,
      antena: equipo.querySelector(".antena")?.checked || false,
      cubrepolvo: equipo.querySelector(".cubrepolvo")?.checked || false,
      observaciones: observacionesInput?.value.trim() || "sin observaciones"
    });

    const equipoId = equipo.dataset.uuid || crypto.randomUUID();
    nuevoEquipo.id = equipoId;

    nuevosEquipos.push(nuevoEquipo);
    guardados++;
  }

  await OrdenesService.updateOrder(ordenId, {
    equipos: [...equiposExistentes, ...nuevosEquipos]
  });

  mensaje.style.color = "green";
  const toast = document.createElement("div");
  toast.textContent = `✅ Se guardaron ${guardados} equipo(s) correctamente.`;
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.backgroundColor = "#4CAF50";
  toast.style.color = "white";
  toast.style.padding = "10px 20px";
  toast.style.borderRadius = "5px";
  toast.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
  document.body.appendChild(toast);
  setTimeout(() => {
    document.body.removeChild(toast);
    window.location.href = "index.html";
  }, 2000);
  container.innerHTML = "";
  contador = 0;
});

    async function cargarOrdenes() {
  const ordenInput = document.getElementById("orden_id");
  const clienteInput = document.getElementById("cliente");
  const tipoInput = document.getElementById("tipo");
  const ordenID = new URLSearchParams(window.location.search).get("orden_id");
  if (!ordenID) return;

  ordenInput.value = ordenID;
  const data = await OrdenesService.getOrder(ordenID);

  if (data) {
    let nombreCliente = "";

    // 1) String directo
    if (typeof data.cliente === "string" && data.cliente) {
      nombreCliente = data.cliente;

    // 2) Objeto con nombre
    } else if (data.cliente?.nombre) {
      nombreCliente = data.cliente.nombre;

    // 3) Referencia por ID (nuevo esquema)
    } else if (data.cliente_id) {
      try {
        const cli = await ClientesService.getCliente(data.cliente_id);
        if (cli) nombreCliente = cli.nombre || "";
      } catch (e) {
        console.error("Error cargando cliente:", e);
      }
    }

    clienteInput.value = nombreCliente;
    tipoInput.value = data.tipo_de_servicio || data.tipo || "";
  }
}



async function init() {
  try {
    await cargarModelos();
    await cargarOrdenes();
    agregarEquipo();
  } catch (error) {
    console.error("Error al iniciar la página:", error);
  }
}

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    await init();
  }
});

    // ── Duplicar múltiples ─────────────────────────────────────────────────
    // Toma el modelo + accesorios + observaciones del ÚLTIMO equipo del
    // formulario y crea un equipo nuevo por cada serial pegado (uno por línea).
    // Útil cuando entran varios equipos del mismo modelo con distinto serial.

    function ultimoFieldset() {
      const fs = container.querySelectorAll("fieldset");
      return fs.length ? fs[fs.length - 1] : null;
    }

    window.abrirDuplicarMultiples = () => {
      const ultimo = ultimoFieldset();
      if (!ultimo) { Toast.show("Primero agrega y llena un equipo para duplicar.", "warn"); return; }

      const modeloId = ultimo.querySelector(".modelo")?.value || "";
      const modeloNombre = modelos.find(m => m.id === modeloId)?.nombre || "sin modelo";
      const info = document.getElementById("dupInfo");
      if (info) info.textContent = `Se copiará el modelo (${modeloNombre}), accesorios y observaciones del último equipo. Pega un serial por línea.`;

      const ta = document.getElementById("dupSeriales");
      if (ta) ta.value = "";
      Modal.open("overlayDuplicar");
      setTimeout(() => { if (ta) ta.focus(); }, 50);
    };

    window.cerrarDuplicarMultiples = () => Modal.close("overlayDuplicar");

    window.aplicarDuplicarMultiples = () => {
      const ultimo = ultimoFieldset();
      if (!ultimo) { Toast.show("No hay equipo de referencia para duplicar.", "warn"); return; }

      const lineas = document.getElementById("dupSeriales").value.split("\n").map(s => s.trim()).filter(Boolean);
      if (!lineas.length) { Toast.show("Pega al menos un serial.", "warn"); return; }

      // Dedup de la lista pegada.
      const vistos = new Set();
      const seriales = [];
      let duplicados = 0;
      lineas.forEach(s => {
        const k = s.toLowerCase();
        if (vistos.has(k)) { duplicados++; return; }
        vistos.add(k);
        seriales.push(s);
      });

      const modeloId = ultimo.querySelector(".modelo")?.value || "";
      const accesorios = {
        bateria:  ultimo.querySelector(".bateria")?.checked || false,
        clip:     ultimo.querySelector(".clip")?.checked || false,
        cargador: ultimo.querySelector(".cargador")?.checked || false,
        fuente:   ultimo.querySelector(".fuente")?.checked || false,
        antena:   ultimo.querySelector(".antena")?.checked || false,
        cubrepolvo: ultimo.querySelector(".cubrepolvo")?.checked || false,
      };
      const observaciones = ultimo.querySelector(".observaciones")?.value || "";

      seriales.forEach(serial => renderEquipoFieldset({ serial, modeloId, accesorios, observaciones }));

      Modal.close("overlayDuplicar");
      let msg = `${seriales.length} equipo(s) duplicado(s).`;
      if (duplicados) msg += ` ${duplicados} serial(es) duplicado(s) omitido(s).`;
      Toast.show(msg, "ok");
    };

// @ts-nocheck
    const form = document.getElementById("formEquipos");
    const container = document.getElementById("equiposContainer");
    const mensaje = document.getElementById("mensaje");
    let modelos = [];

    let contador = 0;
    let ordenClienteId = "";   // para el aviso "este serial figura con otro cliente"

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
      const acc = accesorios || {};

      const html = `
  <fieldset id="${id}" class="section form">
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

    // Guard contra doble-submit: guardar hace dos viajes a Firestore (leer la
    // orden + escribir) sin feedback inmediato; cada clic/Enter extra durante
    // esa ventana re-anexaba los mismos fieldsets a la orden (caso 2026071706:
    // 5 radios → 115 filas, indeleteables porque compartían id).
    let guardandoEquipos = false;

    form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (guardandoEquipos) return;

  const btnSubmit = form.querySelector("button[type='submit']");
  guardandoEquipos = true;
  if (btnSubmit) btnSubmit.disabled = true;
  let exito = false;

  try {
  const equipos = container.querySelectorAll("fieldset");
  let guardados = 0;
  let omitidos = 0;
  const nuevosEquipos = [];

  const ordenId = document.getElementById("orden_id").value;
  const ordenData = await OrdenesService.getOrder(ordenId);

  if (!ordenData) {
    mensaje.style.color = "red";
    mensaje.textContent = "❌ No se encontró la orden";
    return;
  }

  const equiposExistentes = ordenData.equipos || [];

  // Seriales vivos ya guardados en la orden: re-guardar el formulario o
  // re-teclear un serial no debe crear filas duplicadas.
  const serialesPresentes = new Set(
    equiposExistentes
      .filter(eq => !eq.eliminado)
      .map(eq => String(eq.serial || eq.numero_de_serie || "").trim().toLowerCase())
      .filter(Boolean)
  );

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

    const serialKey = (serieInput?.value.trim() || "").toLowerCase();
    if (serialKey && serialesPresentes.has(serialKey)) {
      omitidos++;
      continue;
    }

    // Normalize via the shared EquipoNormalize helper so canonical
    // field names (serial / modelo / observaciones) are guaranteed,
    // regardless of which legacy alias an upstream snippet might use.
    const nuevoEquipo = EquipoNormalize.normalize({
      // id nuevo en cada guardado — nunca reutilizar el del fieldset, que
      // repetido rompe el borrado por id.
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

    if (serialKey) serialesPresentes.add(serialKey);
    nuevosEquipos.push(nuevoEquipo);
    guardados++;
  }

  if (!nuevosEquipos.length) {
    Toast.show(omitidos
      ? `Ese/esos ${omitidos} serial(es) ya están en la orden — nada que guardar.`
      : "Agrega al menos un equipo con datos.", "warn");
    return;
  }

  await OrdenesService.updateOrder(ordenId, {
    equipos: [...equiposExistentes, ...nuevosEquipos]
  });

  exito = true;
  mensaje.style.color = "green";
  let textoToast = `✅ Se guardaron ${guardados} equipo(s) correctamente.`;
  if (omitidos) textoToast += ` ${omitidos} ya estaban en la orden.`;
  Toast.show(textoToast, "ok");
  setTimeout(() => { window.location.href = "index.html"; }, 2000);
  container.innerHTML = "";
  contador = 0;
  } catch (error) {
    console.error("❌ Error guardando equipos:", error);
    Toast.show(`❌ Error al guardar: ${error?.message || error}`, "bad");
  } finally {
    // Tras un guardado exitoso la página redirige — el botón se queda
    // deshabilitado para no reabrir la ventana de doble-submit.
    if (!exito) {
      guardandoEquipos = false;
      if (btnSubmit) btnSubmit.disabled = false;
    }
  }
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
    ordenClienteId = data.cliente_id || "";
  }
}

// ── Autocompletar por serial desde el pool de equipos ────────────────────
// Al salir del campo Serie (teclear o escanear), busca la unidad en
// equipos_pool: si existe, llena el modelo automáticamente (si está vacío) y
// avisa —suave, nunca bloquea— si la unidad figura asignada a OTRO cliente.
// focusout (a diferencia de blur) burbujea, así que un solo listener cubre
// todos los fieldsets presentes y futuros. (PLAN_CICLO_VIDA_EQUIPOS.md D.3)
const normName2 = (s) => String(s ?? "").trim().toLowerCase()
  .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/\s+/g, " ");

container.addEventListener("focusout", async (e) => {
  const input = e.target;
  if (!input.classList?.contains("serie")) return;
  const serial = input.value.trim();
  if (!serial || typeof EquiposPoolService === "undefined") return;
  if (input.dataset.poolChecked === serial) return; // ya consultado sin cambios
  input.dataset.poolChecked = serial;

  let docs = [];
  try { docs = await EquiposPoolService.findBySerial(serial); } catch (err) { return; }
  if (!docs.length) return;

  const fieldset = input.closest("fieldset");
  const modeloSel = fieldset?.querySelector(".modelo");

  // Con colisión de serial entre modelos, prioriza el doc del modelo elegido.
  const unidad = docs.length === 1 ? docs[0]
    : (docs.find(d => modeloSel?.value && d.modelo_id === modeloSel.value) || docs[0]);

  if (modeloSel && !modeloSel.value) {
    const porId = modelos.find(m => m.id === unidad.modelo_id);
    const porNombre = porId ? null : modelos.find(m => normName2(m.nombre) === normName2(unidad.modelo_label || ""));
    const match = porId || porNombre;
    if (match) {
      modeloSel.value = match.id;
      Toast.show(`Serial reconocido en el pool: ${match.nombre}.`, "ok");
    }
  }

  const clientePool = unidad.asignacion?.cliente_id || "";
  if (clientePool && ordenClienteId && clientePool !== ordenClienteId) {
    Toast.show(`Ojo: en el pool ${serial} figura con ${unidad.asignacion?.cliente_nombre || "otro cliente"} — verifica el serial.`, "warn");
  }
});



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

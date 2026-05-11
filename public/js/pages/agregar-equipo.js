// @ts-nocheck
    const form = document.getElementById("formEquipos");
    const container = document.getElementById("equiposContainer");
    const mensaje = document.getElementById("mensaje");
    let modelos = [];

    let contador = 0;
    
    async function cargarModelos() {
  const raw = await ModelosService.getModelos();
  modelos = raw
    .map(m => ({
      id: m.id,
      nombre: (m.modelo || m.nombre || "(sin nombre)").trim()
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}




    window.agregarEquipo = () => {
      const id = `equipo_${contador}`;
     const uuid = crypto.randomUUID(); // 👈 agregar esto arriba

const html = `
  <fieldset id="${id}" data-uuid="${uuid}" class="section form">
    <legend>Equipo ${contador + 1}</legend>

    <div class="form-grid cols-2">
      <div class="form-field">
        <label class="req">Modelo</label>
        <select class="modelo" required>
          <option value="">Seleccione modelo</option>
          ${modelos.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}
        </select>
      </div>

      <div class="form-field">
        <label class="req">Serie</label>
        <input type="text" class="serie" required>
      </div>
    </div>

    <div class="form-field">
      <label>Accesorios</label>
      <div class="chips">
        <label class="chip"><input type="checkbox" class="todos-accesorios"> Todos</label>
        <label class="chip"><input type="checkbox" class="bateria"> Batería</label>
        <label class="chip"><input type="checkbox" class="clip"> Clip</label>
        <label class="chip"><input type="checkbox" class="cargador"> Cargador</label>
        <label class="chip"><input type="checkbox" class="fuente"> Fuente</label>
        <label class="chip"><input type="checkbox" class="antena"> Antena</label>
      </div>
    </div>

    <div class="form-field">
      <label>Observaciones</label>
      <textarea class="observaciones" rows="2"></textarea>
    </div>

    <div class="form-actions" style="justify-content:flex-start">
      <button type="button" class="btn danger" onclick="document.getElementById('${id}').remove()">🗑️ Eliminar equipo</button>
    </div>
  </fieldset>
`;


      container.insertAdjacentHTML("beforeend", html);
     
  const fieldset = document.getElementById(id); 
  const serieInput = fieldset.querySelector(".serie");
  if (serieInput) serieInput.focus();
      const todosCheckbox = fieldset.querySelector(".todos-accesorios");
      if (todosCheckbox) {
        todosCheckbox.addEventListener("change", function () {
          const checkboxes = fieldset.querySelectorAll("input[type='checkbox']");
          checkboxes.forEach(c => {
            if (!c.classList.contains("todos-accesorios")) c.checked = this.checked;
          });
        });
      }
      contador++;
    };

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
      !observacionesInput?.value.trim()
    ) {
      console.log("❌ Equipo ignorado por estar completamente vacío");
      continue;
    }

    const nuevoEquipo = {
      id: crypto.randomUUID(),
      modelo_id: modeloInput?.value || "",
      modelo: modelos.find(m => m.id === modeloInput?.value)?.nombre || "",
      numero_de_serie: serieInput?.value.trim() || "",
      bateria: equipo.querySelector(".bateria")?.checked || false,
      clip: equipo.querySelector(".clip")?.checked || false,
      cargador: equipo.querySelector(".cargador")?.checked || false,
      fuente: equipo.querySelector(".fuente")?.checked || false,
      antena: equipo.querySelector(".antena")?.checked || false,
      observaciones: observacionesInput?.value.trim() || "sin observaciones"
    };

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

    window.duplicarMultiplesEquipos = async function() {
  const cantidad = parseInt(prompt("¿Cuántos equipos desea duplicar?"));
  if (isNaN(cantidad) || cantidad <= 0) return alert("Cantidad inválida.");

  const series = [];
  for (let i = 0; i < cantidad; i++) {
    const serie = prompt(`Ingrese la serie del equipo #${i + 1}:`);
    if (!serie) return alert("Se canceló la operación.");
    series.push(serie);
  }

  const equipos = container.querySelectorAll("fieldset");
  if (equipos.length === 0) return alert("No hay equipos para duplicar.");

  const ultimo = equipos[equipos.length - 1];
  const modelo = ultimo.querySelector(".modelo")?.value || "";
  const bateria = ultimo.querySelector(".bateria")?.checked || false;
  const clip = ultimo.querySelector(".clip")?.checked || false;
  const cargador = ultimo.querySelector(".cargador")?.checked || false;
  const fuente = ultimo.querySelector(".fuente")?.checked || false;
  const antena = ultimo.querySelector(".antena")?.checked || false;
  const observaciones = ultimo.querySelector(".observaciones")?.value || "";

  for (let i = 0; i < series.length; i++) {
    const id = `equipo_${contador}`;
    const uuid = crypto.randomUUID(); // 👈 generar id único

const html = `
  <fieldset id="${id}" data-uuid="${uuid}">

    <legend>Equipo ${contador + 1}</legend>

    <div class="form-group">
      <label><span class="required">Modelo:</span></label>
      <select class="modelo" required>
    <option value="">Seleccione modelo</option>
    ${modelos.map(m => `<option value="${m.id}" ${m.id === modelo ? 'selected' : ''}>${m.nombre}</option>`).join('')}
  </select>
    </div>

    <div class="form-group">
      <label><span class="required">Serie:</span></label>
      <input type="text" class="serie" value="${series[i]}" required>
    </div>

    <div class="form-group">
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); text-align: center;">
        <div>Todos</div>
        <div>Batería</div>
        <div>Clip</div>
        <div>Cargador</div>
        <div>Fuente</div>
        <div>Antena</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); place-items: center; margin-top: 6px;">
        <input type="checkbox" class="todos-accesorios" style="transform: scale(1.2);">
        <input type="checkbox" class="bateria" ${bateria ? 'checked' : ''} style="transform: scale(1.2);">
        <input type="checkbox" class="clip" ${clip ? 'checked' : ''} style="transform: scale(1.2);">
        <input type="checkbox" class="cargador" ${cargador ? 'checked' : ''} style="transform: scale(1.2);">
        <input type="checkbox" class="fuente" ${fuente ? 'checked' : ''} style="transform: scale(1.2);">
        <input type="checkbox" class="antena" ${antena ? 'checked' : ''} style="transform: scale(1.2);">
      </div>
    </div>

    <div class="form-group">
      <label>Observaciones:</label>
      <textarea class="observaciones" rows="2">${observaciones}</textarea>
    </div>

    <button type="button" onclick="document.getElementById('${id}').remove()" class="eliminar-boton">🗑️ Eliminar equipo</button>
  </fieldset>
`;

    container.insertAdjacentHTML("beforeend", html);
    const fieldset = document.getElementById(id);
    const todosCheckbox = fieldset.querySelector(".todos-accesorios");
    if (todosCheckbox) {
      todosCheckbox.addEventListener("change", function () {
        const checkboxes = fieldset.querySelectorAll("input[type='checkbox']");
        checkboxes.forEach(c => {
          if (!c.classList.contains("todos-accesorios")) c.checked = this.checked;
        });
      });
    }
    contador++;
  }
};


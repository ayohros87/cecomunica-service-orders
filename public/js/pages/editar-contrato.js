// @ts-nocheck
    const params = new URLSearchParams(location.search);
    const contratoDocId = params.get("id");
    let modelosDisponibles = [];
async function cargarContrato() {
  if (!contratoDocId) {
    alert("Falta el id del contrato.");
    window.location.href = "index.html";
    return;
  }

  // 1) Cargar modelos primero (para poblar los <select>)
  const todosModelos = await ModelosService.getModelos();
  todosModelos.sort((a, b) => (a.modelo || "").localeCompare(b.modelo || ""));
  modelosDisponibles = todosModelos.map(m => ({ modelo_id: m.id, modelo: m.modelo }));

  // 2) Traer el contrato
  const c = await ContratosService.getContrato(contratoDocId);
  if (!c) {
    alert("Contrato no encontrado.");
    window.location.href = "index.html";
    return;
  }

  // 3) Bloquear edición si ya fue aprobado
  if (c.estado === "activo") {
    alert("Este contrato ya fue aprobado y no se puede editar.");
    window.location.href = `imprimir-contrato.html?id=${c.contrato_id || contratoDocId}`;
    return;
  }

  // 4) Poblar formulario
  document.getElementById("cliente_nombre").value = c.cliente_nombre || "";
  document.getElementById("tipo_contrato").value = c.codigo_tipo || "";
  document.getElementById("accion").value = c.accion || "";
  document.getElementById("renovacion_sin_equipo").checked = !!c.renovacion_sin_equipo;
  refreshRenovacionEditorUI();
  document.getElementById("estado").value = c.estado || "";
  document.getElementById("observaciones").value = c.observaciones || "";
    // Precargar duración si existe
  if (c.duracion) {
    if (["12 meses", "18 meses"].includes(c.duracion)) {
      document.getElementById("duracion").value = c.duracion;
    } else {
      document.getElementById("duracion").value = "Otro";
      document.getElementById("otra_duracion").value = c.duracion.replace(" meses", "").trim();
      toggleOtraDuracion("Otro");
    }
  }

  // 5) Cargar filas de equipos con dropdown de modelos
  (c.equipos || []).forEach(eq =>
  agregarEquipo(eq.modelo_id || "", eq.modelo || "", eq.cantidad, eq.precio, eq.descripcion)
);
}

function agregarEquipo(modelo_id = '', modeloNombre = '', cantidad = 1, precio = 0, descripcion = "Equipos de Comunicación") {
  const tr = document.createElement("tr");

  const opciones = modelosDisponibles
    .map(m => `<option value="${m.modelo_id}">${m.modelo}</option>`)
    .join('');

  tr.innerHTML = `
    <td><select class="modelo">${opciones}</select></td>
    <td><input type="text" class="descripcion" value="${descripcion}"></td>
    <td><input type="number" class="cantidad" value="${cantidad}" min="1"></td>
    <td><input type="number" class="precio" value="${precio}" step="0.01" min="0"></td>
    <td class="subtotal">$0.00</td>
    <td><button type="button" onclick="this.closest('tr').remove(); calcularTotal()">❌</button></td>
  `;

  const sel = tr.querySelector('.modelo');
  if (modelo_id) {
    sel.value = modelo_id;
  } else if (modeloNombre) {
    const match = modelosDisponibles.find(m => m.modelo === modeloNombre);
    if (match) sel.value = match.modelo_id;
  }

  tr.querySelectorAll("input").forEach(i => i.addEventListener("input", calcularTotal));
  document.getElementById("tablaEquipos").appendChild(tr);
  calcularTotal();
}


      // Reemplazar COMPLETO
  function calcularTotal() {
    let total = 0;
    document.querySelectorAll("#tablaEquipos tr").forEach(row => {
      const cant = parseFloat(row.querySelector(".cantidad")?.value || 0);
      const price = parseFloat(row.querySelector(".precio")?.value || 0);
      const subtotal = cant * price;
      row.querySelector(".subtotal").textContent = "$" + subtotal.toFixed(2);
      total += subtotal;
    });
    document.getElementById("total").textContent = total.toFixed(2);
  }

function refreshRenovacionEditorUI() {
  const accion = document.getElementById("accion")?.value;
  const box = document.getElementById("renovacionBox");
  const badge = document.getElementById("renovacionBadge");
  const checkbox = document.getElementById("renovacion_sin_equipo");
  if (!box || !badge || !checkbox) return;

  const esRenovacion = accion === "Renovación";
  if (!esRenovacion) {
    box.style.display = "none";
    checkbox.checked = false;
    checkbox.disabled = true;
    badge.textContent = "Renovación con equipo";
    return;
  }

  box.style.display = "block";
  checkbox.disabled = false;
  badge.textContent = checkbox.checked ? "Renovación sin equipo" : "Renovación con equipo";
}


  document.getElementById("formEditar").addEventListener("submit", async e => {
    e.preventDefault();

const duracionSeleccionada = document.getElementById("duracion").value;
const otraDuracion = document.getElementById("otra_duracion").value;
const duracionFinal = duracionSeleccionada === "Otro"
  ? `${otraDuracion} meses`
  : duracionSeleccionada;

const equipos = [...document.querySelectorAll("#tablaEquipos tr")].map(row => {
  const modelo_id = row.querySelector(".modelo").value.trim();
  const modelo = modelosDisponibles.find(m => m.modelo_id === modelo_id)?.modelo || "";
  const descripcion = (row.querySelector(".descripcion")?.value || "").trim() || "Equipos de Comunicación";
  return {
    modelo_id,
    modelo,
    descripcion,
    cantidad: parseInt(row.querySelector(".cantidad").value || 0),
    precio: parseFloat(row.querySelector(".precio").value || 0)
  };
});
const total = equipos.reduce((sum, eq) => sum + (eq.cantidad * eq.precio), 0);
const accionSeleccionada = document.getElementById("accion").value;
const esRenovacion = accionSeleccionada === "Renovación";
const renovacionSinEquipo = esRenovacion && !!document.getElementById("renovacion_sin_equipo")?.checked;
const renovacionRefurbishedComponentes = esRenovacion
  && renovacionSinEquipo
  && !!document.getElementById("renovacion_refurbished_componentes")?.checked;
const renovacionModalidad = esRenovacion
  ? (renovacionSinEquipo ? "Renovación sin equipo" : "Renovación con equipo")
  : "";

// Calcular total de equipos
const total_equipos = equipos.reduce((acc, e) => acc + Number(e.cantidad || 0), 0);

await ContratosService.updateContrato(contratoDocId, {
  codigo_tipo: document.getElementById("tipo_contrato").value,
  tipo_contrato: document.getElementById("tipo_contrato").selectedOptions[0].text,
  accion: accionSeleccionada,
  renovacion_sin_equipo: renovacionSinEquipo,
  renovacion_refurbished_componentes: renovacionRefurbishedComponentes,
  renovacion_modalidad: renovacionModalidad,
  duracion: duracionFinal,
  observaciones: document.getElementById("observaciones").value.trim(),
  equipos,
  total,
  total_equipos,
  fecha_modificacion: new Date()
});

    alert("✅ Cambios guardados");
    location.href = "index.html";
  });


    (async () => {
      await cargarContrato();  // ✅ aquí ya cargas modelos y luego el contrato
    })();

document.addEventListener('DOMContentLoaded', () => {
  const selEstado = document.getElementById('estado');
  if (selEstado) selEstado.disabled = true;

  document.getElementById("accion")?.addEventListener("change", refreshRenovacionEditorUI);
  document.getElementById("renovacion_sin_equipo")?.addEventListener("change", refreshRenovacionEditorUI);
  document.getElementById("renovacion_refurbished_componentes")?.addEventListener("change", refreshRenovacionEditorUI);
});
function toggleOtraDuracion(valor) {
  document.getElementById("otraDuracionLabel").style.display =
    valor === "Otro" ? "block" : "none";
}


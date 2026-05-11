// @ts-nocheck
    let modelos = [];
    let modelosFiltrados = [];
    let ordenCampo = "alto_movimiento";
    let ordenAsc = false;

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = "../login.html";
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;

      if (!userDoc || (rol !== "administrador" && rol !== "inventario")) {
        document.body.innerHTML = "<h3 style='color:red; text-align:center;'>Acceso restringido a administradores</h3>";
        return;
      }


      await cargarModelos();
    });

    async function cargarModelos() {
  const all = await ModelosService.getModelos();
  modelos = all.filter(m => m.activo !== false); // Incluye todos los modelos que no fueron marcados como eliminados

  modelosFiltrados = [...modelos];
  renderizarTabla();
}

function filtrar() {
  const marca = document.getElementById("filtroMarca").value.toLowerCase();
  const modelo = document.getElementById("filtroModelo").value.toLowerCase();

  modelosFiltrados = modelos.filter(m =>
    (m.marca || "").toLowerCase().includes(marca) &&
    (m.modelo || "").toLowerCase().includes(modelo)
  );

  renderizarTabla();
  actualizarResumenCargar(modelosFiltrados);
}

function limpiarFiltro() {
  document.getElementById("filtroMarca").value = "";
  document.getElementById("filtroModelo").value = "";
  modelosFiltrados = [...modelos];
  renderizarTabla();
  actualizarResumenCargar(modelosFiltrados);
}

function ordenarPor(campo) {
  if (ordenCampo === campo) {
    ordenAsc = !ordenAsc;
  } else {
    ordenCampo = campo;
    ordenAsc = true;
  }
  renderizarTabla();
}
function renderizarTabla() {
  const tbody = document.getElementById("tablaModelos");
  const header = document.getElementById("headerModelos");
  tbody.innerHTML = "";

  const columnas = [
    { campo: "marca", label: "Marca" },
    { campo: "modelo", label: "Modelo" },
    { campo: "tipo", label: "Tipo" },
    { campo: "estado", label: "Estado" },
    { campo: "alto_movimiento", label: "Alto Movimiento" }
  ];

  header.innerHTML = `
    <tr>
      ${columnas.map(c => {
        let clase = "sortable";
        if (c.campo === ordenCampo) {
          clase = ordenAsc ? "ordenado-asc" : "ordenado-desc";
        }
        return `<th onclick="ordenarPor('${c.campo}')" class="${clase}">${c.label}</th>`;
      }).join("")}
      <th>Cantidad</th>
    </tr>
  `;

  // 🔀 Orden compuesto por defecto
  const ordenados = [...modelosFiltrados].sort((a, b) => {
    if (!ordenCampo || ordenCampo === "alto_movimiento") {
      const aAM = a.alto_movimiento ? 1 : 0;
      const bAM = b.alto_movimiento ? 1 : 0;
      if (bAM - aAM !== 0) return bAM - aAM;

      const marcaA = (a.marca || "").toLowerCase();
      const marcaB = (b.marca || "").toLowerCase();
      if (marcaA !== marcaB) return marcaA.localeCompare(marcaB);

      const tipoA = (a.tipo || "").toLowerCase();
      const tipoB = (b.tipo || "").toLowerCase();
      if (tipoA !== tipoB) return tipoA.localeCompare(tipoB);

      const modeloA = (a.modelo || "").toLowerCase();
      const modeloB = (b.modelo || "").toLowerCase();
      return modeloA.localeCompare(modeloB);
    } else {
      const vA = (a[ordenCampo] || "").toString().toLowerCase();
      const vB = (b[ordenCampo] || "").toString().toLowerCase();
      return ordenAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    }
  });

ordenados.forEach((modelo, index) => {
  // Mostrar nombres completos
  let tipoTexto = "-";
  if (modelo.tipo === "P") tipoTexto = "Portátil";
  else if (modelo.tipo === "C") tipoTexto = "Cámara";
  else if (modelo.tipo === "B") tipoTexto = "Base";

  let estadoTexto = "-";
  if (modelo.estado === "N") estadoTexto = "Nuevo";
  else if (modelo.estado === "R") estadoTexto = "Reuso";

  tbody.innerHTML += `
    <tr>
      <td>${modelo.marca}</td>
      <td>${modelo.modelo}</td>
      <td>${tipoTexto}</td>
      <td>${estadoTexto}</td>
      <td>${modelo.alto_movimiento ? "✅" : "❌"}</td>
      <td><input type="number" id="qty_${index}" min="0" /></td>
    </tr>
  `;
});


  // Actualiza modelos ordenados global
  modelos = ordenados;
  actualizarResumenCargar(ordenados);
}

    window.guardarSemana = async function () {
    const entries = [];
    for (let index = 0; index < modelos.length; index++) {
      const modelo = modelos[index];
      const cantidad = parseInt(document.getElementById("qty_" + index).value);
      if (!isNaN(cantidad) && cantidad >= 0) {
        entries.push({ modeloId: modelo.id, cantidad });
      }
    }
    try {
      await InventarioService.guardarInventario(entries);
      alert("✅ Inventario actualizado correctamente");
      window.location.href = "index.html";
    } catch (e) {
      console.error("❌ Error al guardar:", e);
      alert("Error al guardar inventario");
    }
    };

function actualizarResumenCargar(lista = modelosFiltrados) {
  const el = document.getElementById("resumenCargar");
  if (!el) return;
  el.innerHTML = `<strong>${(lista || []).length}</strong> modelos listados`;
}


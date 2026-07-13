// @ts-nocheck
    let modelos = [];
    let modelosFiltrados = [];
    const cantidades = {}; // modeloId → valor tecleado; sobrevive filtros/re-renders
    let ordenCampo = "alto_movimiento";
    let ordenAsc = false;

    function setCantidad(modeloId, valor) {
      if (valor === '' || valor === null) delete cantidades[modeloId];
      else cantidades[modeloId] = valor;
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = "../login.html";
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;

      if (!userDoc || (rol !== ROLES.ADMIN && rol !== ROLES.INVENTARIO)) {
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
        const isCurr = c.campo === ordenCampo;
        const arrow = isCurr ? (ordenAsc ? "↑" : "↓") : "↕";
        return `<th onclick="ordenarPor('${c.campo}')" class="sortable">${c.label} <span style="font-size:12px; opacity:.6;">${arrow}</span></th>`;
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

  tbody.innerHTML = ordenados.map((modelo, index) => {
    // Mostrar nombres completos
    let tipoTexto = "-";
    if (modelo.tipo === "P") tipoTexto = "Portátil";
    else if (modelo.tipo === "C") tipoTexto = "Cámara";
    else if (modelo.tipo === "B") tipoTexto = "Base";

    let estadoTexto = "-";
    if (modelo.estado === "N") estadoTexto = "Nuevo";
    else if (modelo.estado === "R") estadoTexto = "Reuso";

    const am = modelo.alto_movimiento
      ? '<span class="badge asignar">Alto</span>'
      : '<span style="color:var(--fg-4);">—</span>';

    return `
    <tr>
      <td>${modelo.marca}</td>
      <td class="td-primary">${modelo.modelo}</td>
      <td>${tipoTexto}</td>
      <td>${estadoTexto}</td>
      <td>${am}</td>
      <td><input type="number" min="0" class="form-input" style="max-width:120px;" placeholder="0"
            value="${cantidades[modelo.id] ?? ''}" oninput="setCantidad('${modelo.id}', this.value)" /></td>
    </tr>
  `;
  }).join('');

  // No sobreescribe `modelos`: antes, filtrar y luego limpiar perdía modelos de la vista.
  actualizarResumenCargar(ordenados);
}

    window.guardarSemana = async function () {
    const entries = [];
    for (const [modeloId, valor] of Object.entries(cantidades)) {
      const cantidad = parseInt(valor);
      if (!isNaN(cantidad) && cantidad >= 0) {
        entries.push({ modeloId, cantidad });
      }
    }
    try {
      await InventarioService.guardarInventario(entries);
      Toast.show('Inventario actualizado correctamente', 'ok');
      window.location.href = "index.html";
    } catch (e) {
      console.error("❌ Error al guardar:", e);
      Toast.show('Error al guardar inventario', 'bad');
    }
    };

function actualizarResumenCargar(lista = modelosFiltrados) {
  const el = document.getElementById("resumenCargar");
  if (!el) return;
  el.innerHTML = `<strong>${(lista || []).length}</strong> modelos listados`;
}


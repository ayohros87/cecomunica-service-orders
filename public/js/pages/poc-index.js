  let listaOperadores = [];

  let clientesMap = {};
  let modelosMap = {};

async function cargarModelosMap() {
  try {
    const modelos = await ModelosService.getModelos();
    modelosMap = {};
    modelos.forEach(m => {
      const label = `${(m.marca || "").toString().trim()} ${(m.modelo || "").toString().trim()}`.trim();
      modelosMap[m.id] = label || m.modelo || m.marca || m.id;
    });
  } catch (e) {
    console.error("Error al cargar modelos:", e);
    modelosMap = {};
  }
}

function obtenerModeloTexto(d = {}) {
  return (d.modelo_id && modelosMap[d.modelo_id])
    || (d.modeloId && modelosMap[d.modeloId])
    || (d.model_id && modelosMap[d.model_id])
    || (d.modelId && modelosMap[d.modelId])
    || d.modelo_label
    || d.modeloLabel
    || d.Modelo
    || d.modelo
    || d.model_label
    || d.modelLabel
    || d.model
    || "";
}

async function cargarClientesMap() {
  try {
    const raw = await ClientesService.loadClientes();
    clientesMap = {};
    raw.forEach((cliente, id) => {
      clientesMap[id] = (cliente.nombre || "").trim() || id;
    });
  } catch (e) {
    console.error("Error al cargar clientes:", e);
    clientesMap = {};
  }
}

// 👇 Devuelve el nombre “amigable” del cliente
function nombreClienteDe(d) {
  const id = d?.cliente_id;
  return (id && clientesMap[id]) || d?.cliente || "";
}
function actualizarResumenPOC({ total = 0, activos = 0, incompletos = 0 } = {}) {
  const el = document.getElementById("resumenEquipos");
  if (!el) return;
  el.innerHTML = `
    <strong title="Total de equipos">${total}</strong>
    <span style="color: var(--muted); font-size: 12px;">equipos</span>
    <span class="badge completo" title="Activos">✅ ${activos}</span>
    <span class="badge asignado" title="Incompletos (faltan campos)">⚠️ ${incompletos}</span>
  `;
}

  async function cargarOperadores() {
  try {
    let arr = [];

    // 1) Documento principal: empresa/operadores
    const snap = await EmpresaService.getOperadores();
    if (snap) {
      if (Array.isArray(snap.list)) arr = snap.list;
      else if (Array.isArray(snap.operadores)) arr = snap.operadores;
    }

    // 2) Fallback: si está vacío, deduce operadores usados en poc_devices
    if (!arr.length) {
      const s2 = await db.collection("poc_devices")
        .where("operador", "!=", null)
        .limit(1000)
        .get();
      const set = new Set();
      s2.forEach(doc => {
        const v = (doc.data().operador || "").toString().trim();
        if (v) set.add(v);
      });
      arr = Array.from(set);
    }

    // 3) Normaliza/ordena
    listaOperadores = (arr || [])
      .map(v => v.toString().trim())
      .filter(Boolean)
      .sort((a,b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  } catch (e) {
    console.error("Error al cargar operadores:", e);
    listaOperadores = [];
  }
}


    let lastDoc = null;
    let primeraCarga = true;
    let noMasDatos = false;
    let campoOrdenActual = "created_at"; // Orden por fecha de creación
    let direccionOrdenAsc = false;       // De más reciente a más antigua
    let filtroID = 0; // Control para cancelar búsquedas simultáneas
    let rolActual = ROLES.VISTA;         // ← GLOBAL NUEVO

    // ✅ Centralized column index mapping (10-column compact table)
    const COL = {
      checkbox: 0,
      cliente: 1,
      activo: 2,
      serial: 3,
      ip: 4,
      unit_id: 5,
      radio_name: 6,
      grupos: 7,
      sim_tel: 8,
      acciones: 9
    };
    
    // Global variables for drawer
    let currentEditDocId = null;
    let currentEditRow = null;
  
    function esSoloLecturaPOC() {       // ← TRUE para técnico y vista
    return rolActual === ROLES.TECNICO || rolActual === ROLES.VISTA;
  }

    document.addEventListener("DOMContentLoaded", function () {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "/login.html";
      return;
    }

    const userDoc = await UsuariosService.getUsuario(user.uid);
    rolActual = userDoc?.rol || ROLES.VISTA;

    // ✅ Solo estos roles pueden entrar a POC/index
    const permitidos = [ROLES.ADMIN, ROLES.RECEPCION, ROLES.TECNICO, ROLES.VISTA];
    if (!permitidos.includes(rolActual)) {
      alert("❌ No autorizado. Tu rol no tiene acceso a este módulo.");
      window.location.href = "/index.html";
      return;
    }

    aplicarPermisosRolPOC();   // oculta controles si es solo lectura
    
    if (esSoloLecturaPOC()) {
  document.querySelector(".check-all")?.setAttribute("disabled", "disabled");
}

    await cargarOperadores();
    await cargarClientesMap();
    await cargarModelosMap();
    cargarDispositivos(true);
    
    // ✅ Drawer event listeners
    document.getElementById('editDrawerOverlay').addEventListener('click', closeEditDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('editDrawer').classList.contains('active')) {
        closeEditDrawer();
      }
    });
  });
});

  // NUEVO: oculta/inhabilita acciones según rol
  function aplicarPermisosRolPOC() {
    // Top buttons
    // Agrega estos IDs en el HTML (ver sección 2)
    if (esSoloLecturaPOC()) {
      document.getElementById("btnBatch")?.remove();
      document.getElementById("btnSim")?.remove();
      document.getElementById("btnImportar")?.remove();
      // El botón de imprimir lo dejamos, es solo lectura
    }
  }

     window.editarEquipo = async function (row, docId, data) {
    if (esSoloLecturaPOC()) {
      alert("🔒 Modo lectura: el rol técnico no puede editar PoC.");
      return;
    }
    
    // Store current edit context
    currentEditDocId = docId;
    currentEditRow = row;
    
    // Highlight the row being edited
    document.querySelectorAll('tr.row-editing').forEach(r => r.classList.remove('row-editing'));
    row.classList.add('row-editing');
    
    // Populate drawer fields
    document.getElementById('drawer-serial').value = data.serial || '';
    document.getElementById('drawer-unit-id').value = data.unit_id || '';
    document.getElementById('drawer-radio-name').value = data.radio_name || '';
    document.getElementById('drawer-modelo').value = obtenerModeloTexto(data);
    document.getElementById('drawer-grupos').value = (data.grupos || []).join(', ');
    document.getElementById('drawer-activo').checked = data.activo !== false;
    
    document.getElementById('drawer-sim-number').value = data.sim_number || '';
    document.getElementById('drawer-sim-phone').value = data.sim_phone || '';
    
    // Populate operador dropdown
    const operadorSelect = document.getElementById('drawer-operador');
    operadorSelect.innerHTML = '<option value="">Seleccione...</option>';
    (listaOperadores || []).forEach(op => {
      const option = document.createElement('option');
      option.value = op;
      option.textContent = op;
      if (op === data.operador) option.selected = true;
      operadorSelect.appendChild(option);
    });
    
    document.getElementById('drawer-ip').value = data.ip || '';
    document.getElementById('drawer-gps').checked = data.gps || false;
    document.getElementById('drawer-notas').value = data.notas || '';
    
    // Open drawer
    document.getElementById('editDrawerOverlay').classList.add('active');
    document.getElementById('editDrawer').classList.add('active');
  };
  
  window.closeEditDrawer = function() {
    document.getElementById('editDrawerOverlay').classList.remove('active');
    document.getElementById('editDrawer').classList.remove('active');
    
    // Remove row highlight
    if (currentEditRow) {
      currentEditRow.classList.remove('row-editing');
    }
    
    currentEditDocId = null;
    currentEditRow = null;
  };
  
  window.saveDrawerChanges = async function() {
    if (!currentEditDocId) return;
    
    try {
      const grupos = document.getElementById('drawer-grupos').value
        .split(',')
        .map(g => g.trim())
        .filter(g => g);
      
      const user = firebase.auth().currentUser;
      const prevData = (await PocService.getPocDevice(currentEditDocId)) || {};

      const newData = {
        serial: document.getElementById('drawer-serial').value,
        unit_id: document.getElementById('drawer-unit-id').value,
        radio_name: document.getElementById('drawer-radio-name').value,
        modelo: document.getElementById('drawer-modelo').value,
        grupos,
        activo: document.getElementById('drawer-activo').checked,
        sim_number: document.getElementById('drawer-sim-number').value,
        sim_phone: document.getElementById('drawer-sim-phone').value,
        operador: document.getElementById('drawer-operador').value,
        ip: document.getElementById('drawer-ip').value,
        gps: document.getElementById('drawer-gps').checked,
        notas: document.getElementById('drawer-notas').value,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_by: user?.uid || null,
        updated_by_email: user?.email || null
      };

      // ✅ Update device
      await PocService.updatePocDevice(currentEditDocId, newData);

      // ✅ Log to poc_logs
      await PocService.addLog({
        equipo_id: currentEditDocId,
        fecha: firebase.firestore.FieldValue.serverTimestamp(),
        usuario: user?.email,
        cambios: { antes: prevData, despues: newData }
      });

      // Close drawer
      closeEditDrawer();
      
      alert('✅ Cambios guardados');
      
      // Refresh list
      if (document.getElementById("filtroValor").value.trim()) { 
        filtrarDispositivos(); 
      } else { 
        cargarDispositivos(true); 
      }
    } catch (error) {
      console.error('Error saving changes:', error);
      alert('❌ Error al guardar cambios: ' + error.message);
    }
  };

      // Toggle advanced filters (Duplicados, ordenar hint)
      window.toggleAdvancedFilters = function() {
        const elem = document.getElementById('advancedFilters');
        if (elem) {
          elem.style.display = elem.style.display === 'none' ? 'flex' : 'none';
        }
      };

      window.cerrarSesion = () => {
        const auth = firebase.auth();
        auth.signOut()
          .then(() => {
            window.location.href = "/login.html";  // si login.html está en la raíz
            // window.location.href = "../login.html"; // usa esta si login.html está una carpeta arriba
          })
          .catch((err) => {
            console.error("Error al cerrar sesión:", err);
            // Redirigimos igual para no dejar al usuario “atrapado”
            window.location.href = "/login.html";
          });
      };


    function filtrarDispositivos() {
  const ejecucionID = ++filtroID; // Identificador único por ejecución

  const campo = document.getElementById("filtroCampo").value;
  const valor = document.getElementById("filtroValor").value.trim().toLowerCase();
  const tbody = document.getElementById("devicesTable");
  const btnCargarMas = document.getElementById("btnCargarMas");

  // ✅ Limpia la tabla antes de mostrar resultados
  while (tbody.firstChild) {
    tbody.removeChild(tbody.firstChild);
  }
  btnCargarMas.style.display = "none";

  const idsYaMostrados = new Set();

    db.collection("poc_devices")
    .where("deleted", "!=", true)
    .orderBy("deleted")                     // ← primero por el campo del "!="
    .orderBy("created_at", "desc")
    .get()

    .then((querySnapshot) => {
      // 🔒 Solo continúa si esta sigue siendo la ejecución activa
      if (ejecucionID !== filtroID) return;

      let total = 0;
      let activos = 0;
      let incompletos = 0; 

      querySnapshot.forEach((doc) => {
        const id = doc.id;
        if (idsYaMostrados.has(id)) return;
        idsYaMostrados.add(id);

        const d = doc.data();
        const nombreCliente = nombreClienteDe(d);

        // ❗ Filtro para mostrar solo incompletos (si el checkbox está marcado)
        const soloIncompletos = document.getElementById("soloIncompletos")?.checked;
        if (soloIncompletos) {
          const camposCriticos = [d.cliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone];
          const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");
          if (algunoVacio) incompletos++;  
          if (!algunoVacio) return; // No mostrar si está completo
        }

        if (campo !== "cliente" && (d[campo] == null || (typeof d[campo] === "string" && d[campo].trim() === ""))) return;


              let contenido;
      if (campo === "cliente") {
        contenido = nombreCliente.toLowerCase();
      } else if (Array.isArray(d[campo])) {
        contenido = d[campo].join(" ").toLowerCase();
      } else {
        contenido = String(d[campo] ?? "").toLowerCase();
      }

        const soloActivos = document.getElementById("soloActivos")?.checked;
        const cumpleActivo = !soloActivos || d.activo === true;

        if (contenido.includes(valor) && cumpleActivo) {

          total++;
          if (d.activo) activos++;

          const row = document.createElement("tr");
          row.dataset.id = doc.id;

          const tdCheckbox = document.createElement("td");
          const checkbox = document.createElement("input");
          const fechaCreado = d.created_at?.toDate?.()?.toLocaleDateString?.("es-PA", { day: '2-digit', month: '2-digit', year: 'numeric' }) || "";
          const fechaModificado = d.updated_at?.toDate?.()?.toLocaleDateString?.("es-PA", { day: '2-digit', month: '2-digit', year: 'numeric' }) || ""; 
          checkbox.type = "checkbox";
          checkbox.className = "seleccion-sim";
          tdCheckbox.appendChild(checkbox);
          row.appendChild(tdCheckbox);
          const celdaCliente = document.createElement("td"); 
          const camposCriticos = [ nombreCliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone ];
          const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");
          celdaCliente.innerHTML = algunoVacio
            ? `<span style="color:red;" title="Falta completar campos obligatorios">❗</span> ${nombreCliente}`
            : nombreCliente;

          row.appendChild(celdaCliente);

          // COL.activo (2)
          const tdEstado = nuevaCelda(d.activo ? "🟢" : "🔴");
          tdEstado.className = d.activo ? "estado-activo" : "estado-inactivo";
          row.appendChild(tdEstado);
          
          // COL.serial (3)
          row.appendChild(nuevaCelda(d.serial));
          
          // COL.ip (4)
          row.appendChild(crearCeldaIp(d.ip));
          
          // COL.unit_id (5)
          row.appendChild(nuevaCelda(d.unit_id));
          
          // COL.radio_name (6)
          row.appendChild(nuevaCelda(d.radio_name));
          
          // COL.grupos (7)
          row.appendChild(crearCeldaConExpansor((d.grupos || []).join(", "), "grupos"));
          
          // COL.sim_tel (8)
          row.appendChild(nuevaCelda(`📱 ${d.sim_number || ""} / ${d.sim_phone || ""}`));

         const actionCell = document.createElement("td");

if (!esSoloLecturaPOC()) {        // ← solo si NO es técnico
  const editBtn = document.createElement("button");
  editBtn.className = "btn";
  editBtn.textContent = "✏️";

  editBtn.onclick = () => editarEquipo(row, doc.id, d);
  actionCell.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn danger";
  deleteBtn.textContent = "🗑️";
  deleteBtn.title = "Eliminar equipo";

  deleteBtn.onclick = () => {
    if (confirm("¿Seguro que quieres eliminar este equipo?")) {
      PocService.softDeletePocDevice(doc.id).then(() => {
        if (document.getElementById("filtroValor").value.trim()) { filtrarDispositivos(); } else { cargarDispositivos(true); }
      });
    }
  };
  actionCell.appendChild(deleteBtn);

  if (d.deleted) {
    const restoreBtn = document.createElement("button");
    restoreBtn.className = "btn";
    restoreBtn.textContent = "♻️";
    restoreBtn.title = "Restaurar";
    restoreBtn.onclick = () => {
      PocService.restorePocDevice(doc.id).then(() => {
        if (document.getElementById("filtroValor").value.trim()) { filtrarDispositivos(); } else { cargarDispositivos(true); }
      });
    };
    actionCell.appendChild(restoreBtn);
  }
}

row.appendChild(actionCell);

          tbody.appendChild(row);
        }
      });

      actualizarResumenPOC({ total, activos, incompletos });

    });
}



function limpiarFiltro() {
  document.getElementById("filtroValor").value = "";
  document.getElementById("filtroCampo").value = "cliente";
  document.getElementById("resumenEquipos").innerHTML = '<div class="loader" style="width: 24px; height: 24px; border-width: 3px;"></div>';
  if (document.getElementById("filtroValor").value.trim()) {
  filtrarDispositivos();
} else {
  cargarDispositivos(true);
}

}


function crearCeldaConExpansor(texto, campo = "") {
  const limitado = texto.length > 20 ? texto.slice(0, 20) + "..." : texto;
  const td = document.createElement("td");
  td.className = "truncate-cell";
  td.textContent = limitado;

  // Solo mostrar lupa para grupos o notas
  if (texto.length > 20 && (campo === "grupos" || campo === "notas")) {
    const btn = document.createElement("span");
    btn.textContent = "🔍";
    btn.className = "expand-btn";
    btn.title = texto;
    td.appendChild(btn);
  }

  return td;
}

  
function ordenarPor(campo) {
  if (campoOrdenActual === campo) {
    direccionOrdenAsc = !direccionOrdenAsc;
  } else {
    campoOrdenActual = campo;
    direccionOrdenAsc = true;
  }

  primeraCarga = true;
  if (document.getElementById("filtroValor").value.trim()) {
  filtrarDispositivos();
} else {
  cargarDispositivos(true);
}

}


function cargarDispositivos(reset = false) {
  const tbody = document.getElementById("devicesTable");
  const btnCargarMas = document.getElementById("btnCargarMas");

  if (reset || primeraCarga) {
    tbody.innerHTML = "";
    lastDoc = null;
    primeraCarga = false;
    noMasDatos = false;
    btnCargarMas.style.display = "block";
  }

  if (noMasDatos) return;

  const campoOrden = campoOrdenActual || "cliente";
  const direccionOrden = direccionOrdenAsc ? "asc" : "desc";

  let query = db.collection("poc_devices")
  .where("deleted", "!=", true)
  .orderBy("deleted")                              // ← primero "deleted"
  .orderBy(campoOrden, direccionOrden)             // ← luego tu orden dinámico
  .limit(50);



  if (lastDoc) {
    query = query.startAfter(lastDoc);
  }

  query.get().then((querySnapshot) => {
    if (querySnapshot.empty) {
      noMasDatos = true;
      btnCargarMas.style.display = "none";
      return;
    }

    lastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];

    querySnapshot.forEach((doc) => {
      const d = doc.data();
      const nombreCliente = nombreClienteDe(d);
            // ❗ Filtro para mostrar solo incompletos (si el checkbox está marcado)
      const soloIncompletos = document.getElementById("soloIncompletos")?.checked;
if (soloIncompletos) {
  const camposCriticos = [ nombreCliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone ];
  const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");
  if (!algunoVacio) return;
}


      const row = document.createElement("tr");
      row.dataset.id = doc.id;

      const tdCheckbox = document.createElement("td");
      const checkbox = document.createElement("input");
      const fechaCreado = d.created_at?.toDate?.()?.toLocaleDateString?.("es-PA", { day: '2-digit', month: '2-digit', year: 'numeric' }) || "";
      const fechaModificado = d.updated_at?.toDate?.()?.toLocaleDateString?.("es-PA", { day: '2-digit', month: '2-digit', year: 'numeric' }) || "";
      checkbox.type = "checkbox";
      checkbox.className = "seleccion-sim";
      tdCheckbox.appendChild(checkbox);
      row.appendChild(tdCheckbox);
      const celdaCliente = document.createElement("td");
      const camposCriticos = [
  nombreCliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone
];

      const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");

      celdaCliente.innerHTML = camposCriticos.some(v => !v || v.trim?.() === "")
  ? `<span style="color:red;" title="Falta completar campos obligatorios">❗</span> ${nombreCliente}`
  : nombreCliente;

      row.appendChild(celdaCliente);

      // COL.activo (2)
      const tdEstado = nuevaCelda(d.activo ? "🟢" : "🔴");
      tdEstado.className = d.activo ? "estado-activo" : "estado-inactivo";
      row.appendChild(tdEstado);
      
      // COL.serial (3)
      row.appendChild(nuevaCelda(d.serial));
      
      // COL.ip (4)
      row.appendChild(crearCeldaIp(d.ip));
      
      // COL.unit_id (5)
      row.appendChild(nuevaCelda(d.unit_id));
      
      // COL.radio_name (6)
      row.appendChild(nuevaCelda(d.radio_name));
      
      // COL.grupos (7)
      row.appendChild(crearCeldaConExpansor((d.grupos || []).join(", "), "grupos"));
      
      // COL.sim_tel (8)
      row.appendChild(nuevaCelda(`📱 ${d.sim_number || ""} / ${d.sim_phone || ""}`));

      const actionCell = document.createElement("td");

if (!esSoloLecturaPOC()) {        // ← solo si NO es técnico
  const editBtn = document.createElement("button");
  editBtn.className = "btn";
  editBtn.textContent = "✏️";

  editBtn.onclick = () => editarEquipo(row, doc.id, d);
  actionCell.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
deleteBtn.className = "btn danger";
deleteBtn.textContent = "🗑️";
deleteBtn.title = "Eliminar equipo";

  deleteBtn.onclick = () => {
    if (confirm("¿Seguro que quieres eliminar este equipo?")) {
      PocService.softDeletePocDevice(doc.id).then(() => {
        if (document.getElementById("filtroValor").value.trim()) { filtrarDispositivos(); } else { cargarDispositivos(true); }
      });
    }
  };
  actionCell.appendChild(deleteBtn);

  if (d.deleted) {
    const restoreBtn = document.createElement("button");
restoreBtn.className = "btn";
restoreBtn.textContent = "♻️";
restoreBtn.title = "Restaurar";

    restoreBtn.onclick = () => {
      PocService.restorePocDevice(doc.id).then(() => {
        if (document.getElementById("filtroValor").value.trim()) { filtrarDispositivos(); } else { cargarDispositivos(true); }
      });
    };
    actionCell.appendChild(restoreBtn);
  }
}

row.appendChild(actionCell);

      tbody.appendChild(row);
    });

    // Actualiza resumen
    const total = tbody.rows.length;
    let activos = 0;
    let incompletos = 0;
    [...tbody.rows].forEach(row => {
      // Use COL.activo (index 2) to check active status
      if (row.cells[COL.activo]?.textContent?.includes("🟢")) activos++;
      // Use COL.cliente (index 1) to check for incomplete warning (❗)
      if (row.cells[COL.cliente]?.innerHTML?.includes("❗")) incompletos++;
    });
    actualizarResumenPOC({ total, activos, incompletos });

  });
  actualizarFlechitas();
}


function nuevaCelda(texto) {
  const td = document.createElement("td");
  td.textContent = texto || "";
  return td;
}

function crearCeldaIp(ip) {
  const td = document.createElement("td");
  const value = String(ip || "").trim();
  if (!value) return td;

  const dominio = ".cecomunica.net";
  if (value.toLowerCase().endsWith(dominio)) {
    const host = value.slice(0, value.length - dominio.length);
    const hostSpan = document.createElement("span");
    hostSpan.className = "ip-host";
    hostSpan.textContent = host;

    const fullSpan = document.createElement("span");
    fullSpan.className = "ip-domain";
    fullSpan.textContent = value;

    td.appendChild(hostSpan);
    td.appendChild(fullSpan);
  } else {
    td.textContent = value;
  }

  return td;
}

function actualizarFlechitas() {
  const encabezado = document.getElementById("encabezadoTabla");
  [...encabezado.children].forEach(th => {
    const campo = th.getAttribute("onclick")?.match(/'(.+)'/)?.[1];
    
    if (!campo) {
      th.className = ""; // No es ordenable
      return;
    }

    if (campo === campoOrdenActual) {
      th.className = direccionOrdenAsc ? "ordenado-asc" : "ordenado-desc";
    } else {
      th.className = "sortable";
    }
  });
}

function manejarCambioActivos() {
  const valorFiltro = document.getElementById("filtroValor").value.trim();
  if (valorFiltro) {
    filtrarDispositivos(); // Hay filtro aplicado, aplica cambio sobre el filtro
  } else {
    if (document.getElementById("filtroValor").value.trim()) {
  filtrarDispositivos();
} else {
  cargarDispositivos(true);
}
 // No hay filtro, recarga la tabla completa
  }
}

function manejarCambioIncompletos() {
  const hayFiltro = document.getElementById("filtroValor").value.trim();
  if (hayFiltro) {
    filtrarDispositivos(); // aplica sobre el filtro actual
  } else {
    cargarDispositivos(true); // recarga sin filtro
  }
}


function abrirSimModal() {
  if (esSoloLecturaPOC()) {
  alert("🔒 Modo lectura: el rol técnico no puede modificar SIM/Teléfono.");
  return;
}

  const seleccionados = obtenerSeleccionados();
  if (seleccionados.length === 0) {
    alert("Selecciona al menos un equipo.");
    return;
  }

  const dropdown = document.getElementById("operadorGlobal");
  dropdown.innerHTML = '<option value="">— Selecciona operador —</option>';
  (listaOperadores || []).forEach(op => {
    const option = document.createElement("option");
    option.value = op;
    option.textContent = op;
    dropdown.appendChild(option);
  });

  const modal = document.getElementById("simModal");
  Modal.open('simModal', { onEscape: false });
  modal.onclick = (e) => { if (e.target === modal) cerrarSimModal(); };
  const handleEscape = (e) => { if (e.key === 'Escape') cerrarSimModal(); };
  document.addEventListener('keydown', handleEscape);
  modal._escapeHandler = handleEscape;
}

async function procesarSIMSeleccionados() {
  if (esSoloLecturaPOC()) {
  alert("🔒 Modo lectura: el rol técnico no puede modificar SIM/Teléfono.");
  return;
}

  const datos = document.getElementById("simPasteArea").value.trim().split("\n");
  const seleccionados = obtenerSeleccionados();

  if (datos.length !== seleccionados.length) {
    alert(`⚠️ Seleccionaste ${seleccionados.length} radios pero pegaste ${datos.length} líneas.`);
    return;
  }

  const operador = document.getElementById("operadorGlobal").value;
  let actualizados = 0;

  for (let i = 0; i < seleccionados.length; i++) {
    const simTel = datos[i].split(/\t|,/).map(s => s.trim());
    const sim = simTel[0] || "";
    const tel = simTel[1] || "";

    const id = seleccionados[i].id;
    if (!id) continue;

const user = firebase.auth().currentUser;
const prevData = (await PocService.getPocDevice(id)) || {};

const newData = {
  operador,
  sim_number: sim,
  sim_phone: tel,
  updated_at: firebase.firestore.FieldValue.serverTimestamp(),
  updated_by: user?.uid || null,
  updated_by_email: user?.email || null
};

// ✅ Actualiza el radio
await PocService.updatePocDevice(id, newData);

// ✅ Guarda log en poc_logs
await PocService.addLog({
  equipo_id: id,
  fecha: firebase.firestore.FieldValue.serverTimestamp(),
  usuario: user?.email,
  cambios: { antes: prevData, despues: newData }
});

actualizados++;

  }

  // ✅ Actualiza tabla, limpia y oculta modal
  alert(`✅ ${actualizados} radios actualizados.`);
  document.getElementById("simPasteArea").value = "";         // limpia textarea
  document.getElementById("operadorGlobal").selectedIndex = 0; // reinicia dropdown
  cerrarSimModal();
  if (document.getElementById("filtroValor").value.trim()) {
  filtrarDispositivos();
} else {
  cargarDispositivos(true);
}
                                   // recarga tabla
}
function cerrarSimModal() {
  const modal = document.getElementById("simModal");
  Modal.close('simModal');
  if (modal._escapeHandler) {
    document.removeEventListener("keydown", modal._escapeHandler);
    modal._escapeHandler = null;
  }
  document.getElementById("simPasteArea").value = "";
  document.getElementById("operadorGlobal").selectedIndex = 0;
}


function obtenerSeleccionados() {
  const filas = [...document.querySelectorAll("#devicesTable tr")];
  return filas
    .filter(fila => fila.querySelector(".seleccion-sim")?.checked)
    .map(fila => ({
      id: fila.dataset.id,
      fila: fila
    }));
}
async function exportarExcelSeleccionados() {
  try {
    const seleccionados = obtenerSeleccionados(); // ya existe en tu código
    if (!seleccionados.length) {
      alert("Selecciona al menos un equipo para exportar.");
      return;
    }

    // Lee cada doc de Firestore para obtener TODOS los campos
    const ids = seleccionados.map(s => s.id).filter(Boolean);
    // Por seguridad, limita a 2,000 (puedes ajustar)
    if (ids.length > 2000) {
      alert(`Has seleccionado ${ids.length} equipos. Reduce la selección (máx. 2000) o exporta por partes.`);
      return;
    }

    const docs = await Promise.all(ids.map(id => PocService.getPocDevice(id)));
    const registros = [];

    // Helper fecha legible
    const f = (ts) => {
      try {
        const d = ts?.toDate?.();
        if (!d) return "";
        // Formato local Panamá (yyyy-mm-dd hh:mm)
        const pad = n => String(n).padStart(2,"0");
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } catch { return ""; }
    };

    // Mapeo “campo → encabezado Excel”
    // Puedes ajustar el orden/etiquetas aquí.
    const headers = [
      ["device_id", "ID"],
      ["cliente_name", "Cliente"],
      ["cliente_id", "Cliente ID"],
      ["operador", "Operador"],
      ["serial", "Serial"],
      ["unit_id", "Unit ID"],
      ["sim_number", "SIM"],
      ["sim_phone", "Teléfono"],
      ["ip", "IP"],
      ["gps", "GPS"],
      ["activo", "Activo"],
      ["radio_name", "Nombre del Radio"],
      ["grupos", "Grupos"],
      ["notas", "Notas"],
      ["created_at_fmt", "Creado"],
      ["updated_at_fmt", "Modificado"],
      ["updated_by_email", "Actualizado por"]
    ];

    docs.forEach(d => {
      if (!d) return;

      // Relacionados / derivados
      const clienteName = nombreClienteDe(d) || d.cliente || ""; // usa tu helper con clientesMap
      const gruposTxt = Array.isArray(d.grupos) ? d.grupos.join(", ") : (d.grupos || "");
      const fila = {
        device_id: d.id,
        cliente_name: clienteName,
        cliente_id: d.cliente_id || "",
        operador: d.operador || "",
        serial: d.serial || "",
        unit_id: d.unit_id || "",
        sim_number: d.sim_number || "",
        sim_phone: d.sim_phone || "",
        ip: d.ip || "",
        gps: d.gps === true ? "Sí" : "No",
        activo: d.activo === false ? "No" : "Sí",
        radio_name: d.radio_name || "",
        grupos: gruposTxt,
        notas: d.notas || "",
        created_at_fmt: f(d.created_at),
        updated_at_fmt: f(d.updated_at),
        updated_by_email: d.updated_by_email || ""
      };
      registros.push(fila);
    });

    if (!registros.length) {
      alert("No se encontraron datos para exportar.");
      return;
    }

    // Construir hoja con SheetJS
    const hoja = XLSX.utils.json_to_sheet(registros, {
      header: headers.map(h => h[0])
    });

    // Reemplazar keys por encabezados amistosos
    // (SheetJS no renombra headers automáticamente con json_to_sheet)
    // Creamos una fila de encabezados bonitos:
    const encabezadosBonitos = {};
    headers.forEach(([key, titulo], idx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: idx });
      hoja[cellRef] = { t: "s", v: titulo };
    });

    // Ajuste ancho de columnas (opcional)
    hoja["!cols"] = headers.map(() => ({ wch: 20 }));

    // Libro y archivo
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Equipos");
    const fechaNow = new Date();
    const pad = n => String(n).padStart(2,"0");
    const stamp = `${fechaNow.getFullYear()}-${pad(fechaNow.getMonth()+1)}-${pad(fechaNow.getDate())}_${pad(fechaNow.getHours())}${pad(fechaNow.getMinutes())}`;
    const nombreArchivo = `POC_equipos_seleccion_${stamp}.xlsx`;

    XLSX.writeFile(libro, nombreArchivo);
  } catch (err) {
    console.error("Error exportando Excel:", err);
    alert("Ocurrió un error al exportar. Revisa la consola.");
  }
}
function toggleSeleccionMasiva(master) {
  document.querySelectorAll(".seleccion-sim").forEach(cb => cb.checked = master.checked);
}
const encabezado = document.getElementById("encabezadoTabla");
if (encabezado && !encabezado.querySelector(".check-all")) {
  const th = document.createElement("th");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.onclick = () => toggleSeleccionMasiva(check);
  check.className = "check-all";
  th.appendChild(check);
  encabezado.insertBefore(th, encabezado.firstChild);
}
function mostrarTodo() {
  const tbody = document.getElementById("devicesTable");
  tbody.innerHTML = "";
  lastDoc = null;
  primeraCarga = true;
  noMasDatos = false;
  document.getElementById("btnCargarMas").style.display = "none";

  let query = db.collection("poc_devices")
    .where("deleted", "!=", true);

  const soloActivos = document.getElementById("soloActivos")?.checked;
  if (soloActivos) {
    query = query.where("activo", "==", true);
  }

  query = query
  .orderBy("deleted")                                           // ← primero
  .orderBy(campoOrdenActual, direccionOrdenAsc ? "asc" : "desc");


  query.get().then(snapshot => {
    snapshot.forEach(doc => {
      // Usa la misma lógica de render de `cargarDispositivos()`
      const d = doc.data();
      const nombreCliente = nombreClienteDe(d);
            // ❗ Filtro para mostrar solo incompletos (si el checkbox está marcado)
      const soloIncompletos = document.getElementById("soloIncompletos")?.checked;
      if (soloIncompletos) {
        const camposCriticos = [d.cliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone];
        const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");
        if (!algunoVacio) return; // No mostrar si está completo
      }

      const row = document.createElement("tr");
      row.dataset.id = doc.id;

      const tdCheckbox = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "seleccion-sim";
      tdCheckbox.appendChild(checkbox);
      row.appendChild(tdCheckbox);

      const fechaCreado = d.created_at?.toDate?.()?.toLocaleDateString?.("es-PA", { day: '2-digit', month: '2-digit', year: 'numeric' }) || "";
      const fechaModificado = d.updated_at?.toDate?.()?.toLocaleDateString?.("es-PA", { day: '2-digit', month: '2-digit', year: 'numeric' }) || "";
      const celdaCliente = document.createElement("td");
      const camposCriticos = [
  nombreCliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone
];

      const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");
celdaCliente.innerHTML = algunoVacio
  ? `<span style="color:red;" title="Falta completar campos obligatorios">❗</span> ${nombreCliente}`
  : nombreCliente;

      row.appendChild(celdaCliente);

      // COL.activo (2)
      const tdEstado = nuevaCelda(d.activo ? "🟢" : "🔴");
      tdEstado.className = d.activo ? "estado-activo" : "estado-inactivo";
      row.appendChild(tdEstado);
      
      // COL.serial (3)
      row.appendChild(nuevaCelda(d.serial));
      
      // COL.ip (4)
      row.appendChild(nuevaCelda(d.ip));
      
      // COL.unit_id (5)
      row.appendChild(nuevaCelda(d.unit_id));
      
      // COL.radio_name (6)
      row.appendChild(nuevaCelda(d.radio_name));
      
      // COL.grupos (7)
      row.appendChild(crearCeldaConExpansor((d.grupos || []).join(", "), "grupos"));
      
      // COL.sim_tel (8)
      row.appendChild(nuevaCelda(`📱 ${d.sim_number || ""} / ${d.sim_phone || ""}`));

      // dentro de mostrarTodo(), donde creas los botones de acción:
const actionCell = document.createElement("td");

if (!esSoloLecturaPOC()) {
  const editBtn = document.createElement("button");
  editBtn.className = "btn";
  editBtn.textContent = "✏️";
  editBtn.onclick = () => editarEquipo(row, doc.id, d);
  actionCell.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn danger";
  deleteBtn.textContent = "🗑️";
  deleteBtn.title = "Eliminar equipo";
  deleteBtn.onclick = () => {
    if (confirm("¿Eliminar este equipo?")) {
      PocService.softDeletePocDevice(doc.id).then(() => mostrarTodo());
    }
  };
  actionCell.appendChild(deleteBtn);

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "btn";
  restoreBtn.textContent = "♻️";
  restoreBtn.title = "Restaurar";
  restoreBtn.onclick = () => {
    PocService.restorePocDevice(doc.id).then(() => mostrarTodo());
  };
  actionCell.appendChild(restoreBtn);

}

row.appendChild(actionCell);

      tbody.appendChild(row);
    });

        // ✅ CONTADOR DE EQUIPOS (reutilizado)
    const total = document.getElementById("devicesTable").rows.length;
    let activos = 0;
    [...document.getElementById("devicesTable").rows].forEach(row => {
      if (row.cells[COL.activo]?.textContent?.includes("🟢")) activos++;
    });
    document.getElementById("resumenEquipos").textContent = 
      total > 0 ? `Mostrando: ${total} equipos (${activos} activos)` : "No se encontraron resultados.";

  });
}
function irAImpresion() {
  const seleccionados = obtenerSeleccionados();
  if (seleccionados.length === 0) {
    alert("Selecciona al menos un equipo para imprimir.");
    return;
  }

  const ids = seleccionados.map(s => s.id);
  const query = `?ids=${encodeURIComponent(JSON.stringify(ids))}`;
  window.open(`imprimir-equipos.html${query}`, '_blank');
}
async function filtrarDuplicados(tipo) {
  const devices = await PocService.getPocDevices();
  const equipos = [];
  const soloActivos = document.getElementById("soloActivos")?.checked;

  devices.forEach(d => {
    if (d.deleted === true) return;
    if (soloActivos && !d.activo) return;
      equipos.push({
    id: d.id,
    serial: d.serial ? String(d.serial) : "",
    sim: d.sim_number ? String(d.sim_number) : "",
    cliente: nombreClienteDe(d) || "",
    cliente_id: d.cliente_id || "",
    unit_id: d.unit_id || "",
    operador: d.operador || "",
    ip: d.ip || "",
    sim_phone: d.sim_phone || "",
    gps: d.gps || false,
    activo: d.activo,
    radio_name: d.radio_name || "",
    grupos: d.grupos || [],
    notas: d.notas || "",
    created_at: d.created_at,
    updated_at: d.updated_at
  });
  });

  const campoClave = tipo === "serial" ? "serial" : "sim";
  const duplicados = equipos
  .filter(e => {
  const valor = e[campoClave]?.toString().toLowerCase().trim() || "";
  if (!valor) return false;

  if (campoClave === "serial") {
    if (["n/d", "nd", "consola"].includes(valor)) return false;
  }

  return true;
})

  .reduce((acc, curr) => {
    const clave = curr[campoClave].toLowerCase().trim();
    acc[clave] = acc[clave] || [];
    acc[clave].push(curr);
    return acc;
  }, {});


  const repetidos = Object.values(duplicados).filter(arr => arr.length > 1).flat();
  const repetidosUnicos = repetidos.filter((e, idx, arr) => arr.findIndex(x => x.id === e.id) === idx);

  mostrarResultadosFiltrados(repetidosUnicos);
}

async function buscarGruposInvalidos() {
  const resumenEl = document.getElementById("resumenEquipos");
  if (resumenEl) resumenEl.innerHTML = '<div class="loader" style="width:20px;height:20px;border-width:2px;"></div>';

  const devices = await PocService.getPocDevices();
  const invalidos = [];

  devices.forEach(d => {
    if (d.deleted === true) return;
    const grupos = d.grupos || [];
    const tieneInvalido = grupos.some(g => {
      const v = (g || "").toString();
      return v.includes("...") || v.includes("🔍");
    });
    if (!tieneInvalido) return;
    invalidos.push({
      id: d.id,
      serial: d.serial ? String(d.serial) : "",
      sim: d.sim_number ? String(d.sim_number) : "",
      cliente: nombreClienteDe(d) || "",
      cliente_id: d.cliente_id || "",
      unit_id: d.unit_id || "",
      operador: d.operador || "",
      ip: d.ip || "",
      sim_phone: d.sim_phone || "",
      gps: d.gps || false,
      activo: d.activo,
      radio_name: d.radio_name || "",
      grupos,
      notas: d.notas || "",
      created_at: d.created_at,
      updated_at: d.updated_at
    });
  });

  mostrarResultadosFiltrados(invalidos);
}

function mostrarResultadosFiltrados(lista) {
  const tbody = document.getElementById("devicesTable");
  if (!tbody) return;
  tbody.innerHTML = "";

  let activos = 0;

  // helpers
  const nuevaCelda = (texto) => {
    const td = document.createElement("td");
    td.textContent = texto || "";
    return td;
  };

  lista.forEach(d => {
    const row = document.createElement("tr");
    if (d.id) row.dataset.id = d.id;

    // checkbox (para acciones en lote; si quieres ocultarlo a técnicos, coméntalo)
    const tdCheckbox = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "seleccion-sim";
    tdCheckbox.appendChild(checkbox);
    row.appendChild(tdCheckbox);

    // banderita de incompletos
    const camposCriticos = [d.cliente, d.unit_id, d.operador, d.ip, d.sim || d.sim_number, d.sim_phone];
    const algunoVacio = camposCriticos.some(v => !v || v.trim?.() === "");
    const celdaCliente = document.createElement("td");
    celdaCliente.innerHTML = algunoVacio
      ? `<span style="color:red;" title="Falta completar campos obligatorios">❗</span> ${d.cliente || ""}`
      : (d.cliente || "");
    row.appendChild(celdaCliente);

    // COL.activo (2)
    const tdEstado = nuevaCelda(d.activo ? "🟢" : "🔴");
    tdEstado.className = d.activo ? "estado-activo" : "estado-inactivo";
    row.appendChild(tdEstado);
    if (d.activo) activos++;
    
    // COL.serial (3)
    row.appendChild(nuevaCelda(d.serial));
    
    // COL.ip (4)
    row.appendChild(crearCeldaIp(d.ip));
    
    // COL.unit_id (5)
    row.appendChild(nuevaCelda(d.unit_id));
    
    // COL.radio_name (6)
    row.appendChild(nuevaCelda(d.radio_name));
    
    // COL.grupos (7)
    row.appendChild(crearCeldaConExpansor(Array.isArray(d.grupos) ? d.grupos.join(", ") : (d.grupos || ""), "grupos"));
    
    // COL.sim_tel (8)
    row.appendChild(nuevaCelda(`📱 ${(d.sim || d.sim_number) || ""} / ${d.sim_phone || ""}`));

    // 👉 Acciones
    const acciones = document.createElement("td"); // ✅ ahora sí existe

    // Si NO es técnico, mostramos botones
    if (!esSoloLecturaPOC()) {
      const btnEditar = document.createElement("button");
      btnEditar.className = "btn";
      btnEditar.textContent = "✏️";

      btnEditar.onclick = () => editarEquipo(row, d.id, d);
      acciones.appendChild(btnEditar);

      const btnEliminar = document.createElement("button");
      btnEliminar.className = "btn danger";
      btnEliminar.textContent = "🗑️";
      btnEliminar.title = "Eliminar";
      btnEliminar.onclick = () => {
        if (confirm("¿Seguro que quieres eliminar este equipo?")) {
          PocService.softDeletePocDevice(d.id)
            .then(() => cargarDispositivos(true));
        }
      };
      acciones.appendChild(btnEliminar);

      if (d.deleted) {
        const btnRestaurar = document.createElement("button");
        btnRestaurar.className = "btn";
        btnRestaurar.textContent = "♻️";

        btnRestaurar.onclick = () => {
          PocService.restorePocDevice(d.id)
            .then(() => cargarDispositivos(true));
        };
        acciones.appendChild(btnRestaurar);
      }
    }

    row.appendChild(acciones);
    tbody.appendChild(row);
  });

  document.getElementById("resumenEquipos").textContent =
    lista.length > 0 ? `Mostrando: ${lista.length} equipos (${activos} activos)` : "No se encontraron resultados.";
}

function buildOperadorSelectHTML(valorActual = "") {
  const opciones = (listaOperadores || [])
    .map(op => `<option value="${op}" ${op === valorActual ? "selected" : ""}>${op}</option>`)
    .join("");
  return `<select class="table-input table-select w-100">
            <option value="">— Selecciona operador —</option>
            ${opciones}
          </select>`;
}

// Campos editables en edición masiva (solo los visibles en tabla compacta)
let camposMasivos = ["activo","serial","unit_id","radio_name","grupos","sim_number","sim_phone"];
let modoEdicionMasiva = false;

function activarEdicionMasiva() {
  if (modoEdicionMasiva) {
    alert("⚠️ Ya estás en modo edición masiva.");
    return;
  }

  if (rolActual !== ROLES.ADMIN && rolActual !== ROLES.RECEPCION) {
    alert("❌ Solo administradores o recepción pueden usar edición masiva.");
    return;
  }

  const seleccionados = obtenerSeleccionados();
  if (seleccionados.length === 0) {
    alert("Selecciona al menos un equipo.");
    return;
  }

  if (seleccionados.length > 10) {
    alert("⚠️ El máximo permitido es 10 equipos por edición masiva.");
    return;
  }

  modoEdicionMasiva = true;

  seleccionados.forEach(({ fila }) => {
    const celdas = fila.querySelectorAll("td");

    // 1) Activo (COL.activo = 2): checkbox
    const activoOriginal = celdas[COL.activo].textContent.includes("🟢");
    celdas[COL.activo].setAttribute("data-original", activoOriginal ? "🟢" : "🔴");
    celdas[COL.activo].innerHTML = `<input type="checkbox" class="mass-activo" ${activoOriginal ? "checked" : ""}>`;

    // 2) Serial (COL.serial = 3): input text
    const serialOriginal = celdas[COL.serial].textContent.trim();
    celdas[COL.serial].setAttribute("data-original", serialOriginal);
    celdas[COL.serial].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${serialOriginal}">`;

    // 3) Unit ID (COL.unit_id = 5): input text
    const unitOriginal = celdas[COL.unit_id].textContent.trim();
    celdas[COL.unit_id].setAttribute("data-original", unitOriginal);
    celdas[COL.unit_id].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${unitOriginal}">`;

    // 4) Nombre del Radio (COL.radio_name = 6): input text
    const radioOriginal = celdas[COL.radio_name].textContent.trim();
    celdas[COL.radio_name].setAttribute("data-original", radioOriginal);
    celdas[COL.radio_name].innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${radioOriginal}">`;

    // 5) Grupos (COL.grupos = 7): extraer del title si tiene 🔍, sino del textContent
    const celdaGrupos = celdas[COL.grupos];
    const botonExpansor = celdaGrupos.querySelector(".expandir-btn");
    let gruposOriginal = "";
    if (botonExpansor && botonExpansor.title) {
      gruposOriginal = botonExpansor.title; // valor completo si hay truncado
    } else {
      gruposOriginal = celdaGrupos.textContent.replace("🔍", "").replace("…", "").trim();
    }
    celdaGrupos.setAttribute("data-original", celdaGrupos.innerHTML); // guardar HTML original para restaurar
    celdaGrupos.innerHTML = `<input type="text" class="table-input" style="width:100%;" value="${gruposOriginal}">`;

    // 6) SIM / Teléfono (COL.sim_tel = 8): separar en 2 inputs
    const simTelOriginal = celdas[COL.sim_tel].textContent.trim();
    celdas[COL.sim_tel].setAttribute("data-original", simTelOriginal);
    
    // Parsear "📱 SIM / TEL" (puede tener espacios)
    const simTelTexto = simTelOriginal.replace("📱", "").trim();
    const partes = simTelTexto.split("/").map(s => s.trim());
    const sim = partes[0] || "";
    const tel = partes[1] || "";
    
    celdas[COL.sim_tel].innerHTML = `
      <input type="text" class="table-input sim-number" placeholder="SIM" value="${sim}" style="width:48%; margin-right:4%;">
      <input type="text" class="table-input sim-phone" placeholder="TEL" value="${tel}" style="width:48%;">
    `;
  });

  // Mover botones Guardar/Cancelar al toolbar principal
  const primaryGroup = document.querySelector(".actions-toolbar .actions-group:first-child");
  const btnGuardar = document.getElementById("btnGuardarMasivo");
  const btnCancelar = document.getElementById("btnCancelarMasivo");
  
  primaryGroup.appendChild(btnGuardar);
  primaryGroup.appendChild(btnCancelar);
  
  btnGuardar.style.display = "inline-block";
  btnCancelar.style.display = "inline-block";
  
  
}

async function guardarEdicionMasiva() {
  const seleccionados = obtenerSeleccionados();
  if (seleccionados.length === 0) {
    alert("Selecciona al menos un equipo.");
    return;
  }
  
  if (seleccionados.length > 10) {
    alert("⚠️ No puedes guardar más de 10 equipos en una sola operación.");
    return;
  }

  if (!confirm(`⚠️ Vas a actualizar ${seleccionados.length} equipos. ¿Confirmas continuar?`)) {
    return;
  }

  const user = firebase.auth().currentUser;
  let actualizados = 0;

  for (const { id, fila } of seleccionados) {
    const celdas = fila.querySelectorAll("td");

    // Leer inputs inline usando COL
    const activo = celdas[COL.activo].querySelector("input")?.checked || false;
    const serial = celdas[COL.serial].querySelector("input")?.value || "";
    const unit_id = celdas[COL.unit_id].querySelector("input")?.value || "";
    const radio_name = celdas[COL.radio_name].querySelector("input")?.value || "";
    const gruposInput = celdas[COL.grupos].querySelector("input")?.value || "";
    const grupos = gruposInput.split(",").map(g => g.trim()).filter(Boolean);
    const sim_number = celdas[COL.sim_tel].querySelector(".sim-number")?.value || "";
    const sim_phone = celdas[COL.sim_tel].querySelector(".sim-phone")?.value || "";

    // Construir newData SOLO con campos visibles + metadata
    const newData = {
      activo,
      serial,
      unit_id,
      radio_name,
      grupos,
      sim_number,
      sim_phone,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: user?.uid || null,
      updated_by_email: user?.email || null
    };

    const prevData = (await PocService.getPocDevice(id)) || {};

    await PocService.updatePocDevice(id, newData);

    // Log en poc_logs
    await PocService.addLog({
      equipo_id: id,
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
      usuario: user?.email,
      cambios: { antes: prevData, despues: { ...prevData, ...newData } }
    });

    // Highlight verde temporal
    fila.style.backgroundColor = "#d4edda";
    setTimeout(() => fila.style.backgroundColor = "transparent", 1000);

    actualizados++;
  }

  alert(`✅ ${actualizados} equipos actualizados.`);

  // Restaurar botones al toolbar principal y ocultarlos
  const primaryGroup = document.querySelector(".actions-toolbar .actions-group:first-child");
  const btnGuardar = document.getElementById("btnGuardarMasivo");
  const btnCancelar = document.getElementById("btnCancelarMasivo");
  
  primaryGroup.appendChild(btnGuardar);
  primaryGroup.appendChild(btnCancelar);
  
  btnGuardar.style.display = "none";
  btnCancelar.style.display = "none";
  modoEdicionMasiva = false;

  // Recargar lista
  if (document.getElementById("filtroValor").value.trim()) {
    filtrarDispositivos();
  } else {
    cargarDispositivos(true);
  }
}
function cancelarEdicionMasiva() {
  const seleccionados = obtenerSeleccionados();
  if (seleccionados.length === 0) return;

  seleccionados.forEach(({ fila }) => {
    const celdas = fila.querySelectorAll("td");

    // Restaurar usando COL
    // 1) Activo (COL.activo = 2): restaurar emoji
    celdas[COL.activo].innerHTML = celdas[COL.activo].getAttribute("data-original") || "🔴";
    
    // 2) Serial (COL.serial = 3): restaurar texto
    celdas[COL.serial].innerHTML = celdas[COL.serial].getAttribute("data-original") || "";
    
    // 3) Unit ID (COL.unit_id = 5): restaurar texto
    celdas[COL.unit_id].innerHTML = celdas[COL.unit_id].getAttribute("data-original") || "";
    
      // 4) Nombre del Radio (COL.radio_name = 6): restaurar texto
    celdas[COL.radio_name].innerHTML = celdas[COL.radio_name].getAttribute("data-original") || "";
    
      // 5) Grupos (COL.grupos = 7): restaurar HTML completo (con 🔍 si tenía)
    celdas[COL.grupos].innerHTML = celdas[COL.grupos].getAttribute("data-original") || "";
    
      // 6) SIM/Teléfono (COL.sim_tel = 8): restaurar texto original
    celdas[COL.sim_tel].innerHTML = celdas[COL.sim_tel].getAttribute("data-original") || "";
  });

    // Restaurar botones al toolbar principal y ocultarlos
    const primaryGroup = document.querySelector(".actions-toolbar .actions-group:first-child");
  const btnGuardar = document.getElementById("btnGuardarMasivo");
  const btnCancelar = document.getElementById("btnCancelarMasivo");
  
    primaryGroup.appendChild(btnGuardar);
    primaryGroup.appendChild(btnCancelar);
  
  btnGuardar.style.display = "none";
  btnCancelar.style.display = "none";
  modoEdicionMasiva = false;
}


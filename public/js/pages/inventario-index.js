// @ts-nocheck
firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = "../login.html";
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;

      if (rol !== ROLES.ADMIN && rol !== ROLES.INVENTARIO) {
        document.body.innerHTML = '<div style="text-align:center; margin-top:100px; color:red;">Acceso restringido: área en construcción.</div>';
        return;
      }

      window.userRole = rol;
      document.getElementById("loader").style.display = "block";
      await cargarInventario();
      document.getElementById("loader").style.display = "none";
    });

    function cerrarSesion() {
      firebase.auth().signOut().then(() => window.location.href = "../login.html");
    }

    async function cargarInventario() {
  const tabla = document.getElementById("inventarioTable");
  tabla.innerHTML = "";

  try {
    // 1. Cargar todos los modelos una sola vez
    const modelosList = await ModelosService.getModelos();
    const modelosMap = {};
    modelosList.forEach(m => { modelosMap[m.id] = m; });

    // 2. Cargar inventario_actual (con modelo_id como string)
    const inventario = await InventarioService.getInventarioActual();

    if (inventario.length === 0) {
      tabla.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding: 20px; color: #666;">
          ⚠️ No se encontraron datos en el inventario actual.
        </td>
      </tr>
    `;

      return;
    }

    const datos = [];

inventario.forEach(data => {
  const modelo = modelosMap[data.modelo_id] || {};
  datos.push({ data, modelo });
});

// Ordenar por alto_movimiento (true primero), luego marca, tipo y modelo
datos.sort((a, b) => {
  const altoA = a.modelo.alto_movimiento === true ? 1 : 0;
  const altoB = b.modelo.alto_movimiento === true ? 1 : 0;
  if (altoA !== altoB) return altoB - altoA; // true primero

  const marcaA = a.modelo.marca?.toLowerCase() || "";
  const marcaB = b.modelo.marca?.toLowerCase() || "";
  if (marcaA !== marcaB) return marcaA.localeCompare(marcaB);

  const tipoA = a.modelo.tipo?.toLowerCase() || "";
  const tipoB = b.modelo.tipo?.toLowerCase() || "";
  if (tipoA !== tipoB) return tipoA.localeCompare(tipoB);

  const modeloA = a.modelo.modelo?.toLowerCase() || "";
  const modeloB = b.modelo.modelo?.toLowerCase() || "";
  return modeloA.localeCompare(modeloB);
});



// Mostrar ordenado
inventarioDatos = datos;
renderizarTabla(inventarioDatos);

  } catch (err) {
    console.error("❌ Error al cargar inventario:", err);
    tabla.innerHTML = "<tr><td colspan='7' style='color:red;'>Error al cargar datos</td></tr>";
  }
}

async function verHistorico(modeloId) {
  const historial = await InventarioService.getHistorialModelo(modeloId);

  if (historial.length === 0) {
    alert("No hay registros históricos para este modelo.");
    return;
  }

  let resumen = `📜 Histórico del modelo: ${modeloId}\n\n`;
  historial.forEach(data => {
    const fecha = data.timestamp?.toDate().toLocaleString() || "-";
    resumen += `• ${fecha} → Cantidad: ${data.cantidad}\n`;
  });

  alert(resumen);
}

let inventarioDatos = [];
let ordenCampo = 'alto_movimiento';
let ordenAsc = false;

function filtrarInventario() {
  const marca = document.getElementById("filtroMarca").value.toLowerCase();
  const modelo = document.getElementById("filtroModelo").value.toLowerCase();

  const filtrados = inventarioDatos.filter(({ data, modelo: m }) => {
    const marcaOk = m.marca?.toLowerCase().includes(marca);
    const modeloOk = m.modelo?.toLowerCase().includes(modelo);
    return marcaOk && modeloOk;
  });

  renderizarTabla(filtrados);
}

function limpiarFiltro() {
  document.getElementById("filtroMarca").value = "";
  document.getElementById("filtroModelo").value = "";
  renderizarTabla(inventarioDatos);
}

function ordenarPor(campo) {
  if (ordenCampo === campo) ordenAsc = !ordenAsc;
  else {
    ordenCampo = campo;
    ordenAsc = true;
  }

  renderizarTabla(inventarioDatos);
}
function renderizarTabla(datos) {
  const tabla = document.getElementById("inventarioTable");
  const encabezado = document.getElementById("headerInventario");
  tabla.innerHTML = "";

  const cols = [
    { campo: "marca", label: "Marca" },
    { campo: "modelo", label: "Modelo" },
    { campo: "tipo", label: "Tipo" },
    { campo: "estado", label: "Estado" },
    { campo: "alto_movimiento", label: "Alto Mov." },
    { campo: "cantidad", label: "Cantidad" },
    { campo: "cantidad_anterior", label: "Cant. anterior", cls: "col-anterior" },
    { campo: "ultima_actualizacion", label: "Última actualización" },
    { campo: "penultima_actualizacion", label: "Penúltima actualización", cls: "col-penultima" },
  ];

  // Header con sort arrow
  encabezado.innerHTML = `
    <tr>
      ${cols.map(c=>{
        const isCurr = c.campo === ordenCampo;
        const arrow = isCurr ? (ordenAsc ? '↑' : '↓') : '↕';
        return `<th data-sort="${c.campo}" class="${c.cls||''}" onclick="ordenarPor('${c.campo}')">${c.label} <span class="sort">${arrow}</span></th>`;
      }).join('')}
      <th>Acciones</th>
    </tr>`;

  // Orden
  datos.sort((a,b)=>{
    if (ordenCampo === "alto_movimiento") {
      const amA = a.modelo.alto_movimiento === true ? 1 : 0;
      const amB = b.modelo.alto_movimiento === true ? 1 : 0;
      if (amA !== amB) return ordenAsc ? amA - amB : amB - amA;
      const ma = a.modelo.marca?.toLowerCase() || "", mb = b.modelo.marca?.toLowerCase() || "";
      if (ma !== mb) return ma.localeCompare(mb);
      const ta = a.modelo.tipo?.toLowerCase() || "", tb = b.modelo.tipo?.toLowerCase() || "";
      if (ta !== tb) return ta.localeCompare(tb);
      const moa = a.modelo.modelo?.toLowerCase() || "", mob = b.modelo.modelo?.toLowerCase() || "";
      return moa.localeCompare(mob);
    }
    const vA = obtenerValor(a, ordenCampo);
    const vB = obtenerValor(b, ordenCampo);
    if (typeof vA === "number" && typeof vB === "number") return ordenAsc ? vA - vB : vB - vA;
    return ordenAsc ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
  });

  // Skeleton si vacío
  if (datos.length === 0){
    tabla.innerHTML = `
      <tr><td colspan="10" style="padding:20px;">
        <div class="skeleton" style="width:60%; height:12px; margin-bottom:8px;"></div>
        <div class="skeleton" style="width:40%; height:12px;"></div>
      </td></tr>`;
    applyColumnVisibility(); applyDensity(); return;
  }

  // Filas
  tabla.innerHTML = datos.map(({ data, modelo })=>{
    const cant = Number(data.cantidad ?? 0);
    const minBadge = cant <= 0 ? '<span class="badge danger">0</span>'
                  : cant < 5 ? `<span class="badge pendiente">${cant}</span>`
                  : `<span class="badge completo">${cant}</span>`;
    const tipoTxt = modelo.tipo === "P" ? "Portátil" : modelo.tipo === "C" ? "Cámara" : modelo.tipo === "B" ? "Base" : "-";
    const estadoTxt = modelo.estado === "N" ? "Nuevo" : modelo.estado === "R" ? "Reuso" : "-";
    const ua = data.ultima_actualizacion ? data.ultima_actualizacion.toDate().toLocaleString() : "-";
    const pa = data.penultima_actualizacion ? data.penultima_actualizacion.toDate().toLocaleString() : "-";
    const am = modelo.alto_movimiento ? "✅" : "❌";

    return `
      <tr>
        <td>${modelo.marca || "-"}</td>
        <td>${modelo.modelo || "-"}</td>
        <td>${tipoTxt}</td>
        <td>${estadoTxt}</td>
        <td>${am}</td>
        <td>${minBadge}</td>
        <td class="col-anterior">${data.cantidad_anterior ?? "-"}</td>
        <td>${ua}</td>
        <td class="col-penultima">${pa}</td>
        <td><button class="btn" onclick="verHistorico('${data.modelo_id}')">📊 Histórico</button></td>
      </tr>`;
  }).join('');

  // Resumen
  const total = datos.length;
  const altoMov = datos.filter(({modelo})=>modelo.alto_movimiento===true).length;
  const resumen = document.getElementById("resumenInv");
  if (resumen) resumen.innerHTML = `<strong>${total}</strong> modelos · <span class="badge completo">${altoMov}</span> alto mov.`;

  // Aplica visibilidad/densidad
  applyColumnVisibility(); applyDensity();
}

function obtenerValor(obj, campo) {
  if (campo === "marca") return obj.modelo.marca?.toLowerCase() || "";
  if (campo === "modelo") return obj.modelo.modelo?.toLowerCase() || "";
  if (campo === "tipo") return obj.modelo.tipo || "";
  if (campo === "estado") return obj.modelo.estado || "";
  if (campo === "alto_movimiento") return obj.modelo.alto_movimiento === true ? 1 : 0;
  if (campo === "cantidad") return obj.data.cantidad ?? 0;
  if (campo === "cantidad_anterior") return obj.data.cantidad_anterior ?? 0;
  if (campo === "ultima_actualizacion") return obj.data.ultima_actualizacion?.toDate().getTime() ?? 0;
  if (campo === "penultima_actualizacion") return obj.data.penultima_actualizacion?.toDate().getTime() ?? 0;
  return "";
}
function exportarExcel() {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["Marca", "Modelo", "Tipo", "Estado", "Alto Movimiento", "Cantidad", "Última actualización"]
  ];

  inventarioDatos.forEach(({ modelo, data }) => {
    wsData.push([
      modelo.marca || "-",
      modelo.modelo || "-",
      modelo.tipo === "P" ? "Portátil" : modelo.tipo === "C" ? "Cámara" : modelo.tipo === "B" ? "Base" : "-",
      modelo.estado === "N" ? "Nuevo" : modelo.estado === "R" ? "Reuso" : "-",
      modelo.alto_movimiento ? "✅" : "❌",
      data.cantidad ?? "-",
      data.ultima_actualizacion ? data.ultima_actualizacion.toDate().toLocaleString() : "-"
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Inventario");

  const fecha = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Inventario_Cecomunica_${fecha}.xlsx`);
}
// ===== Densidad
let dense = false;
function applyDensity(){
  const wrap = document.getElementById('wrapTabla');
  if (wrap) wrap.setAttribute('data-density', dense ? 'dense' : 'roomy');
}
function toggleDensity(){
  dense = !dense; applyDensity();
  Toast.show(dense ? 'Vista compacta' : 'Vista cómoda', 'ok');
}

// ===== Columnas ocultables
const hiddenCols = new Set(); // 'anterior' | 'penultima'
function applyColumnVisibility(){
  const map = { anterior: '.col-anterior', penultima: '.col-penultima' };
  Object.entries(map).forEach(([k, sel])=>{
    const hide = hiddenCols.has(k);
    document.querySelectorAll(sel).forEach(el=>{
      if (hide) el.classList.add('hidden-col'); else el.classList.remove('hidden-col');
    });
  });
}
document.addEventListener('change', (e)=>{
  if (e.target.id === 'col-CHK-anterior'){
    if (!e.target.checked) hiddenCols.add('anterior'); else hiddenCols.delete('anterior');
    applyColumnVisibility();
  }
  if (e.target.id === 'col-CHK-penultima'){
    if (!e.target.checked) hiddenCols.add('penultima'); else hiddenCols.delete('penultima');
    applyColumnVisibility();
  }
});

// ===== Búsqueda unificada
function debounce(fn, t=220){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); } }
const onQuickFilter = debounce(aplicarFiltroRapido, 220);
window.addEventListener('DOMContentLoaded', ()=>{
  // abrir menú por click
  const ddBtn = document.querySelector('.dropdown > button.btn');
  if (ddBtn){
    ddBtn.addEventListener('click',(ev)=>{ev.stopPropagation(); ddBtn.parentElement.classList.toggle('open');});
    document.addEventListener('click',()=>document.querySelector('.dropdown.open')?.classList.remove('open'));
  }
  const q = document.getElementById('buscador');
  if (q){
    q.addEventListener('input', onQuickFilter);
    q.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); aplicarFiltroRapido(); }});
  }
  applyDensity();
});
function aplicarFiltroRapido(){
  const q = (document.getElementById('buscador')?.value || '').toLowerCase().trim();
  if (!Array.isArray(inventarioDatos)){ Toast.show('Inventario aún no cargado','warn'); return; }
  const filtrados = inventarioDatos.filter(({modelo})=>{
    const marca = (modelo.marca||'').toLowerCase();
    const mod = (modelo.modelo||'').toLowerCase();
    const tipo = (modelo.tipo||'').toLowerCase();
    return marca.includes(q) || mod.includes(q) || tipo.includes(q);
  });
  renderizarTabla(filtrados);
}

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

    // 2. Fuente PRINCIPAL: el pool de seriales (unidades reales en bodega).
    //    El conteo físico (inventario_actual) queda como verificación manual.
    const [inventario, poolMap] = await Promise.all([
      InventarioService.getInventarioActual(),
      EquiposPoolService.contarBodegaPorModelo().catch(e => { console.warn('pool', e); return new Map(); }),
    ]);

    // Índices del pool para casar contra las filas de conteo (por id de
    // catálogo o por label normalizado — mismas tolerancias del pool).
    const poolPorId = new Map(), poolPorLabel = new Map();
    poolMap.forEach(g => {
      if (g.modelo_id) poolPorId.set(g.modelo_id, g);
      const tl = EquiposPoolService._tightLabel(g.modelo_label);
      if (tl && !poolPorLabel.has(tl)) poolPorLabel.set(tl, g);
    });

    if (inventario.length === 0 && poolMap.size === 0) {
      tabla.innerHTML = `
      <tr>
        <td colspan="12" style="text-align:center; padding: 20px; color: #666;">
          <i data-lucide="alert-triangle"></i> Sin unidades en bodega ni conteos registrados.
        </td>
      </tr>
    `;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    const datos = [];
    const gruposUsados = new Set();

inventario.forEach(data => {
  const modelo = modelosMap[data.modelo_id] || {};
  const g = poolPorId.get(data.modelo_id)
    || poolPorLabel.get(EquiposPoolService._tightLabel(modelo.modelo || '')) || null;
  if (g) gruposUsados.add(g);
  datos.push({ data, modelo, seriales: g ? g.n : 0 });
});

// Modelos con seriales en bodega que el conteo físico aún no lista.
poolMap.forEach(g => {
  if (gruposUsados.has(g)) return;
  const modelo = (g.modelo_id && modelosMap[g.modelo_id])
    || { modelo: g.modelo_label || '(sin modelo)' };
  datos.push({ data: { modelo_id: g.modelo_id || null, cantidad: null }, modelo, seriales: g.n, sinConteo: true });
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
renderKPIs();
renderizarTabla(inventarioDatos);

  } catch (err) {
    console.error("❌ Error al cargar inventario:", err);
    tabla.innerHTML = "<tr><td colspan='12' style='color:red;'>Error al cargar datos</td></tr>";
  }
}

async function verHistorico(modeloId) {
  const historial = await InventarioService.getHistorialModelo(modeloId);

  if (historial.length === 0) {
    Toast.show('No hay registros históricos para este modelo.', 'bad');
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
let filtroTipo = '';

// KPIs sobre el dataset completo (no el filtrado). Principal = seriales del
// pool; el conteo físico es la verificación manual; la diferencia es la
// conciliación (0 = bodega cuadrada).
function renderKPIs() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const totalSeriales = inventarioDatos.reduce((s, r) => s + Number(r.seriales ?? 0), 0);
  const totalConteo = inventarioDatos.reduce((s, { data }) => s + Number(data.cantidad ?? 0), 0);
  set('kpiModelos', inventarioDatos.length);
  set('kpiUnidades', totalSeriales.toLocaleString());
  set('kpiConteo', totalConteo.toLocaleString());
  const dif = totalSeriales - totalConteo;
  set('kpiDif', (dif > 0 ? '+' : '') + dif.toLocaleString());
  const difEl = document.getElementById('kpiDif');
  if (difEl) difEl.classList.toggle('kpi-warn', dif !== 0);
  // Compat: cards viejas si siguieran en el HTML.
  set('kpiAltoMov', inventarioDatos.filter(({ modelo }) => modelo.alto_movimiento === true).length);
  set('kpiStockBajo', inventarioDatos.filter(r => Number(r.seriales ?? 0) < 5).length);
}

// Filtro unificado: búsqueda + chip de tipo + toggles
function datosFiltrados() {
  const q = (document.getElementById('buscador')?.value || '').toLowerCase().trim();
  const soloAM = !!document.getElementById('chkAltoMov')?.checked;
  const soloSB = !!document.getElementById('chkStockBajo')?.checked;
  return inventarioDatos.filter((r) => {
    const { data, modelo } = r;
    if (filtroTipo && modelo.tipo !== filtroTipo) return false;
    if (soloAM && modelo.alto_movimiento !== true) return false;
    if (soloSB && Number(r.seriales ?? 0) >= 5) return false;
    if (q) {
      const marca = (modelo.marca || '').toLowerCase();
      const mod = (modelo.modelo || '').toLowerCase();
      const tipo = (modelo.tipo || '').toLowerCase();
      if (!(marca.includes(q) || mod.includes(q) || tipo.includes(q))) return false;
    }
    return true;
  });
}

function refrescarTabla() { renderizarTabla(datosFiltrados()); }

function setFiltroTipo(t) {
  filtroTipo = t;
  document.querySelectorAll('#chipsTipo .filter-chip').forEach(b =>
    b.classList.toggle('active', b.dataset.tipo === t));
  refrescarTabla();
}

function onToggleFiltro(inp) {
  inp.closest('.toggle-pill')?.classList.toggle('is-on', inp.checked);
  refrescarTabla();
}

function ordenarPor(campo) {
  if (ordenCampo === campo) ordenAsc = !ordenAsc;
  else {
    ordenCampo = campo;
    ordenAsc = true;
  }

  refrescarTabla();
}
function renderizarTabla(datos) {
  const tabla = document.getElementById("inventarioTable");
  const encabezado = document.getElementById("headerInventario");
  tabla.innerHTML = "";

  // Principal = Unidades (seriales del pool en bodega); el conteo físico es
  // la verificación manual y la Dif. es la conciliación por modelo.
  const cols = [
    { campo: "marca", label: "Marca" },
    { campo: "modelo", label: "Modelo" },
    { campo: "tipo", label: "Tipo" },
    { campo: "estado", label: "Estado" },
    { campo: "alto_movimiento", label: "Alto Mov." },
    { campo: "seriales", label: "Unidades (seriales)" },
    { campo: "cantidad", label: "Conteo físico" },
    { campo: "dif", label: "Dif." },
    { campo: "cantidad_anterior", label: "Conteo anterior", cls: "col-anterior" },
    { campo: "ultima_actualizacion", label: "Último conteo" },
    { campo: "penultima_actualizacion", label: "Penúltimo conteo", cls: "col-penultima" },
  ];

  // Header con sort arrow
  encabezado.innerHTML = `
    <tr>
      ${cols.map(c=>{
        const isCurr = c.campo === ordenCampo;
        const arrow = isCurr ? (ordenAsc ? '↑' : '↓') : '↕';
        return `<th data-sort="${c.campo}" class="${c.cls||''}" onclick="ordenarPor('${c.campo}')">${c.label} <span class="sort">${arrow}</span></th>`;
      }).join('')}
      <th style="text-align:right;">Acciones</th>
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
      <tr><td colspan="12" style="padding:20px;">
        <div class="skeleton" style="width:60%; height:12px; margin-bottom:8px;"></div>
        <div class="skeleton" style="width:40%; height:12px;"></div>
      </td></tr>`;
    applyColumnVisibility(); applyDensity(); return;
  }

  // Filas
  tabla.innerHTML = datos.map((r)=>{
    const { data, modelo } = r;
    const seriales = Number(r.seriales ?? 0);
    const tieneConteo = data.cantidad != null;
    const cant = Number(data.cantidad ?? 0);
    // El número es un drill-down: clic → Equipos por serial con la pestaña
    // "En bodega" y la familia del modelo prefiltradas (los seriales exactos
    // detrás del agregado — clave para auditar una Dif. distinta de 0).
    const badgeSer = seriales <= 0 ? '<span class="badge danger">0</span>'
                  : seriales < 5 ? `<span class="badge pendiente">${seriales}</span>`
                  : `<span class="badge completo">${seriales}</span>`;
    const urlPool = `./equipos.html?tab=en_bodega${data.modelo_id ? `&modelo=${encodeURIComponent(data.modelo_id)}` : ''}`;
    const serialesBadge = `<a href="${urlPool}" title="Ver los seriales de este modelo en bodega" style="text-decoration:none;cursor:pointer;">${badgeSer}</a>`;
    const conteoTxt = tieneConteo ? String(cant) : '<span title="Modelo con seriales en bodega sin fila de conteo físico">—</span>';
    const dif = tieneConteo ? seriales - cant : null;
    const difBadge = !tieneConteo ? '<span style="color:var(--fg-4);">—</span>'
                  : dif === 0 ? '<span class="badge completo">0</span>'
                  : `<span class="badge ${dif > 0 ? 'pendiente' : 'danger'}" title="${dif > 0 ? 'Seriales capturados que el conteo no vio' : 'Conteo mayor que los seriales — posible unidad sin capturar en el pool'}">${dif > 0 ? '+' : ''}${dif}</span>`;
    const tipoTxt = modelo.tipo === "P" ? "Portátil" : modelo.tipo === "C" ? "Cámara" : modelo.tipo === "B" ? "Base" : "-";
    const estadoTxt = modelo.estado === "N" ? "Nuevo" : modelo.estado === "R" ? "Reuso" : "-";
    const ua = data.ultima_actualizacion ? data.ultima_actualizacion.toDate().toLocaleString() : "-";
    const pa = data.penultima_actualizacion ? data.penultima_actualizacion.toDate().toLocaleString() : "-";
    const am = modelo.alto_movimiento
      ? '<span class="badge asignar">Alto</span>'
      : '<span style="color:var(--fg-4);">—</span>';

    return `
      <tr>
        <td>${modelo.marca || "-"}</td>
        <td class="td-primary">${modelo.modelo || "-"}</td>
        <td>${tipoTxt}</td>
        <td>${estadoTxt}</td>
        <td>${am}</td>
        <td>${serialesBadge}</td>
        <td class="td-muted">${conteoTxt}</td>
        <td>${difBadge}</td>
        <td class="col-anterior td-muted">${data.cantidad_anterior ?? "-"}</td>
        <td class="td-muted">${ua}</td>
        <td class="col-penultima td-muted">${pa}</td>
        <td class="td-actions">${data.modelo_id ? `<button class="btn btn-ghost btn-sm" title="Ver histórico de conteos" aria-label="Ver histórico de conteos" onclick="verHistorico('${data.modelo_id}')"><i data-lucide="bar-chart-2"></i></button>` : ''}</td>
      </tr>`;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Resumen (footer): filtrados vs total
  const total = datos.length;
  const altoMov = datos.filter(({modelo})=>modelo.alto_movimiento===true).length;
  const resumen = document.getElementById("resumenInv");
  if (resumen) resumen.innerHTML = `Mostrando <strong>${total}</strong> de <strong>${inventarioDatos.length}</strong> modelos · <strong>${altoMov}</strong> alto mov.`;

  // Aplica visibilidad/densidad
  applyColumnVisibility(); applyDensity();
}

function obtenerValor(obj, campo) {
  if (campo === "marca") return obj.modelo.marca?.toLowerCase() || "";
  if (campo === "modelo") return obj.modelo.modelo?.toLowerCase() || "";
  if (campo === "tipo") return obj.modelo.tipo || "";
  if (campo === "estado") return obj.modelo.estado || "";
  if (campo === "alto_movimiento") return obj.modelo.alto_movimiento === true ? 1 : 0;
  if (campo === "seriales") return Number(obj.seriales ?? 0);
  if (campo === "dif") return obj.data.cantidad != null ? Number(obj.seriales ?? 0) - Number(obj.data.cantidad) : -9999;
  if (campo === "cantidad") return obj.data.cantidad ?? 0;
  if (campo === "cantidad_anterior") return obj.data.cantidad_anterior ?? 0;
  if (campo === "ultima_actualizacion") return obj.data.ultima_actualizacion?.toDate().getTime() ?? 0;
  if (campo === "penultima_actualizacion") return obj.data.penultima_actualizacion?.toDate().getTime() ?? 0;
  return "";
}
function exportarExcel() {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["Marca", "Modelo", "Tipo", "Estado", "Alto Movimiento", "Unidades (seriales)", "Conteo físico", "Diferencia", "Conteo anterior", "Último conteo", "Penúltimo conteo"]
  ];

  inventarioDatos.forEach((r) => {
    const { modelo, data } = r;
    const seriales = Number(r.seriales ?? 0);
    wsData.push([
      modelo.marca || "-",
      modelo.modelo || "-",
      modelo.tipo === "P" ? "Portátil" : modelo.tipo === "C" ? "Cámara" : modelo.tipo === "B" ? "Base" : "-",
      modelo.estado === "N" ? "Nuevo" : modelo.estado === "R" ? "Reuso" : "-",
      modelo.alto_movimiento ? "Sí" : "No",
      seriales,
      data.cantidad ?? "-",
      data.cantidad != null ? seriales - Number(data.cantidad) : "-",
      data.cantidad_anterior ?? "-",
      data.ultima_actualizacion ? data.ultima_actualizacion.toDate().toLocaleString() : "-",
      data.penultima_actualizacion ? data.penultima_actualizacion.toDate().toLocaleString() : "-"
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
  if (!Array.isArray(inventarioDatos)){ Toast.show('Inventario aún no cargado','warn'); return; }
  refrescarTabla();
}

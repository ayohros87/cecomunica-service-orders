

firebase.auth().onAuthStateChanged(async user => {
  if (!user) return (window.location.href = "../login.html");
  try {
    await cargarModelos();
    poblarDropdownModeloGlobal();

    
    const userDoc = await UsuariosService.getUsuario(user.uid);
    const rol = userDoc ? userDoc.rol : null;

    if (!["administrador", "vendedor", "recepcion"].includes(rol)) {
      toast("Acceso restringido.", "bad");
      return (window.location.href = "../index.html");
    }
    
    // Auto-focus first input for better UX
    setTimeout(() => {
      document.getElementById("clienteGlobal")?.focus();
    }, 100);
  } catch (error) {
    console.error("Error al verificar el rol o cargar modelos:", error);
    window.location.href = "../index.html";
  }
});
let grupos = [];
// Ahora guardamos objetos completos {id, marca, modelo, label}
let modelosDisponibles = [];
let clienteIDSeleccionado = null;
let clienteNombreSeleccionado = null;
const CLIENTES_PAGE_SIZE = 500;
let clientesCache = [];         // [{id, nombre, norm}]
let clientesCargados = false;

function normalizar(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")   // quita acentos
    .toLowerCase();
}

async function cargarClientesCache() {
  // 1) Intenta LS primero
  const cacheLS = lsGet("cache_clientes_v1");
  if (cacheLS && Array.isArray(cacheLS) && cacheLS.length) {
    clientesCache = cacheLS;
    clientesCargados = true;
    return;
  }

  clientesCache = [];
  const FieldPath = firebase.firestore.FieldPath;
  let baseQ = db.collection("clientes").where("deleted", "==", false).orderBy("nombre");
  let lastDoc = null;

  while (true) {
    let q = lastDoc ? baseQ.startAfter(lastDoc).limit(CLIENTES_PAGE_SIZE)
                    : baseQ.limit(CLIENTES_PAGE_SIZE);

    // cache-first
    let snap = await q.get({ source: "cache" });
    if (snap.empty) snap = await q.get();

    if (snap.empty) break;

    snap.forEach(doc => {
      const nombre = (doc.data().nombre || "").toString();
      clientesCache.push({ id: doc.id, nombre, norm: normalizar(nombre) });
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < CLIENTES_PAGE_SIZE) break;
  }

  // Guarda en LS
  lsSet("cache_clientes_v1", clientesCache);
  clientesCargados = true;
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { exp, data } = JSON.parse(raw);
    if (!exp || Date.now() > exp) return null;
    return data;
  } catch (_) { return null; }
}
function lsSet(key, data, ttlMs = 6 * 60 * 60 * 1000) { // 6 horas
  localStorage.setItem(key, JSON.stringify({ exp: Date.now() + ttlMs, data }));
}

async function cargarModelos() {
  // 1) Intenta desde localStorage
  const cacheLS = lsGet("cache_modelos_v1");
  if (cacheLS) {
    modelosDisponibles = cacheLS;
    return;
  }

  try {
    // 2) Intenta primero del cache de Firestore
    let snap = await db.collection("modelos").get({ source: "cache" });
    if (snap.empty) snap = await db.collection("modelos").get(); // fallback servidor

    modelosDisponibles = snap.docs
      .map(d => {
        const m = d.data();
        return {
          id: d.id,
          marca: m.marca || "",
          modelo: m.modelo || "",
          tipo: m.tipo || "",
          estado: m.estado || "",
          alto_movimiento: !!m.alto_movimiento,
          activo: m.activo !== false,
        };
      })
      .filter(m => m.activo)
      .sort((a, b) => {
        const ma = a.marca.toLowerCase();
        const mb = b.marca.toLowerCase();
        if (ma !== mb) return ma.localeCompare(mb);
        return a.modelo.toLowerCase().localeCompare(b.modelo.toLowerCase());
      })
      .map(m => ({ ...m, label: `${m.marca} ${m.modelo}`.trim() }));

    // 3) Guarda en LS para próximos usos
    lsSet("cache_modelos_v1", modelosDisponibles);
  } catch (e) {
    console.error("Error al cargar modelos:", e);
    modelosDisponibles = [];
  }
}

function poblarDropdownModeloGlobal() {
  const select = document.getElementById("modeloGlobal");
  if (!select) return;
  select.innerHTML = [
    `<option value="">— Selecciona modelo —</option>`,
    ...modelosDisponibles.map(m => `<option value="${m.id}">${m.label}</option>`)
  ].join("");
}

    function generarTabla() {
  const cliente = document.getElementById("clienteGlobal").value.trim();
  const regexProhibidos = /[\\/#\[\]$]/;

  if (regexProhibidos.test(cliente)) {
  toast("El nombre del cliente contiene caracteres no permitidos: / # [ ] $", "bad");
  return;
}


  const input = document.getElementById("grupoInput").value;
  grupos = input.split(',').map(g => g.trim()).filter(g => g);
  window.grupos = grupos;


  const nombres = document.getElementById("serialesPaste").value.trim().split('\n').map(s => s.trim()).filter(s => s);

  const header = document.getElementById("encabezadoTabla");
  document.getElementById("tablaEquipos").style.display = "table";

  header.innerHTML = `
    <th>Cliente</th>
    <th>Nombre del Radio</th>
    <th><input type="checkbox" id="gpsMaster" onchange="toggleGPS(this)"> GPS</th>
    ${grupos.map((g, i) => `<th><input type='checkbox' onchange='toggleGrupo(${i}, this)'> ${g}</th>`).join('')}
    <th>Modelo</th>
    <th></th>
  `;
  document.getElementById("wrapTablaEquipos").style.display = "block";
  document.getElementById("scrollHintEquipos").style.display = "block";
  document.getElementById("tableSection").style.display = "flex";
  document.getElementById("exportSection").style.display = "flex";
  document.getElementById("actionCard").style.display = "block";
  actualizarResumenBatch();

  const cuerpo = document.getElementById("cuerpoTabla");
  cuerpo.innerHTML = "";

  for (let i = 0; i < nombres.length; i++) {
    agregarFila("", nombres[i]);
  }

  document.getElementById("tablaEquipos").scrollIntoView({ behavior: "smooth" });
}

function setStep(step){
  document.getElementById("step-prep").classList.toggle("active", step==="prep");
  document.getElementById("step-rev").classList.toggle("active", step==="rev");
  document.getElementById("step-exp").classList.toggle("active", step==="exp");
}

    function agregarFila(_, nombreRadio = "") {
  const cliente = document.getElementById("clienteGlobal").value;
  const modeloGlobal = document.getElementById("modeloGlobal").value; // id del modelo seleccionado (opcional)

  const fila = document.createElement("tr");
  fila.innerHTML = `
  <td>${cliente}</td>
  <td><input type="text" class="table-input nombre" value="${nombreRadio}"></td>
  <td><input type="checkbox" class="table-checkbox gps"></td>
  ${grupos.map(() => `<td><input type="checkbox" class="table-checkbox grupo"></td>`).join('')}
  <td>
    <select class="table-input table-select modelo">
      <option value="">— Selecciona modelo —</option>
      ${modelosDisponibles.map(m => `
        <option value="${m.id}" ${m.id === modeloGlobal ? 'selected' : ''}>${m.label}</option>
      `).join('')}
    </select>
  </td>
  <td><button class="btn danger" onclick="this.closest('tr').remove(); actualizarResumenBatch();">❌</button></td>
`;

  fila.dataset.cliente = cliente;
  document.getElementById("tablaEquipos").style.display = "table";
  document.getElementById("cuerpoTabla").appendChild(fila);
  document.getElementById("wrapTablaEquipos").style.display = "block";
  document.getElementById("scrollHintEquipos").style.display = "block";
  document.getElementById("tableSection").style.display = "flex";
  document.getElementById("exportSection").style.display = "flex";
  document.getElementById("actionCard").style.display = "block";
  actualizarResumenBatch();
  fila.addEventListener("click", () => fila.classList.toggle("selected"));
  fila.addEventListener("keydown", (e) => { if (e.key === "Delete") { fila.remove(); actualizarResumenBatch(); }});

}
    function toggleGrupo(index, master) {
      const filas = document.querySelectorAll("#cuerpoTabla tr");
      filas.forEach(fila => {
        const checks = fila.querySelectorAll(".grupo");
        if (checks[index]) {
          checks[index].checked = master.checked;
        }
      });
    }

    function toggleGPS(master) {
      const gpsChecks = document.querySelectorAll(".gps");
      gpsChecks.forEach(c => c.checked = master.checked);
    }

    
   function mostrarTablaResultado() {
  const datos = generarJSON();

const salida = document.getElementById("salida");
salida.innerHTML = `
  <div class="table-wrap compact">
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Nombre</th>
          <th>GPS</th>
          <th>Modelo</th>
          <th class="col-grupos">Grupos</th>
        </tr>
      </thead>
      <tbody>
        ${datos.map(d => `
          <tr>
            <td>${d.cliente_nombre}</td>
            <td>${d.radio_name}</td>
            <td>${d.gps ? "✅" : ""}</td>
            <td>${d.modelo_label || ""}</td>
            <td class="col-grupos">${(d.grupos || []).join(", ")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  </div>
`;
document.querySelector("#salida .table-wrap").scrollIntoView({behavior:"smooth"});
setStep('rev')    // ← estás “Revisando” el resultado

}

    function descargarExcel() {
  const filas = document.querySelectorAll("#cuerpoTabla tr");
  const cliente = (window.clienteNombreSeleccionado || document.getElementById("clienteGlobal").value || "").trim();

  const datos = [];
  filas.forEach((fila) => {
    const nombre = (fila.querySelector(".nombre")?.value || "").trim();
    const gps = fila.querySelector(".gps")?.checked ? "✅" : "";
    const sel = fila.querySelector(".modelo");
    const modeloId = (sel?.value || "").trim();

    // label desde catálogo o, si no, desde el texto del option seleccionado
    const fromCatalog = modelosDisponibles.find(m => m.id === modeloId);
    const fromSelect  = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent.trim() : "";
    const modeloLabel = fromCatalog ? fromCatalog.label : (fromSelect === "— Selecciona modelo —" ? "" : fromSelect);

    const checks = fila.querySelectorAll(".grupo");
    const row = {
      Cliente: cliente,
      "Nombre del Radio": nombre,
      GPS: gps,
      Modelo: modeloLabel
    };
    grupos.forEach((g, i) => {
      row[g] = checks[i]?.checked ? "✅" : "";
    });
    datos.push(row);
  });

  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Equipos");
  XLSX.writeFile(wb, "equipos-vendedores.xlsx");
  setStep('exp');
}

    function generarJSON() {
  const filas = document.querySelectorAll("#cuerpoTabla tr");
  const datos = [];

  // Nombre escrito en el input (fallback si no se seleccionó de la lista)
  const inputNombre = (document.getElementById("clienteGlobal").value || "").trim();

  // Resolver cliente: prioriza selección; si no hay, intenta resolver por cache; si no, usa el texto
  let cid = window.clienteIDSeleccionado || null;
  let cn  = window.clienteNombreSeleccionado || inputNombre;

  // Intento de resolver el id por coincidencia exacta (normalizada) si no hay selección
  if (!cid && cn && Array.isArray(window.clientesCache) && window.clientesCache.length) {
    const needle = normalizar(cn);
    const hit = window.clientesCache.find(c => c.norm === needle);
    if (hit) {
      cid = hit.id;
      cn  = hit.nombre; // usa el nombre exacto guardado en la BD
    }
  }

  // Si no hay nombre en absoluto, entonces sí frenamos
  if (!cn) {
    alert("⚠️ Escribe el nombre del cliente o selecciónalo de la lista.");
    return [];
  }

  filas.forEach((fila) => {
    const nombre = (fila.querySelector(".nombre")?.value || "").trim();
    const gps = !!fila.querySelector(".gps")?.checked;
    const modeloId = (fila.querySelector(".modelo")?.value || "").trim();
    const checks = fila.querySelectorAll(".grupo");
    const gruposMarcados = grupos.filter((g, i) => checks[i]?.checked);

    if (nombre) {
      const modeloSel = modelosDisponibles.find(m => m.id === modeloId);
      datos.push({
        cliente_id: cid,                        // puede ser null si no se encontró id
        cliente_nombre: cn,                     // siempre el nombre resulto
        radio_name: nombre,
        gps,
        modelo_id: modeloId || null,
        modelo_label: modeloSel ? modeloSel.label : "",
        grupos: gruposMarcados
      });
    }
  });

  return datos;
}

function descargarJSON() {
  const datos = generarJSON();
  if (!datos.length) {
    alert("No hay datos para descargar.");
    return;
  }
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "equipos-vendedores.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStep('exp');
}

let timeoutCliente = window.timeoutCliente || null;

function sugerirClientes() {
  const contenedor = document.getElementById("sugerenciasClientes");
  contenedor.innerHTML = "";
  const inputEl = document.getElementById("clienteGlobal");
  const texto = (inputEl.value || "").trim();

  if (texto.length < 2) {
    window.clienteIDSeleccionado = null;
    window.clienteNombreSeleccionado = null;
    return;
  }

  clearTimeout(timeoutCliente);
  timeoutCliente = setTimeout(async () => {
    // Si no se ha cargado el cache, cárgalo ahora
    if (!clientesCargados) {
      try { await cargarClientesCache(); } catch (e) { console.error(e); }
    }

    const needle = normalizar(texto);

    // Buscar por subcadena en cualquier posición (case/acentos-insensible)
    let matches = clientesCache
      .filter(c => c.norm.includes(needle))
      .map(c => ({
        id: c.id,
        nombre: c.nombre,
        pos: c.norm.indexOf(needle) // para ordenar: prefijo primero
      }));

    // Orden: primero los que empiezan con el texto, luego los demás alfabéticamente
    matches.sort((a, b) => {
      if (a.pos !== b.pos) return a.pos - b.pos; // prefijo (0) antes que subcadena (>0)
      return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
    });

    renderSugerencias(matches, contenedor, inputEl);
  }, 200);
}

function toTitleCase(str) {
  // Convierte a minúsculas y capitaliza cada palabra (compatible con acentos)
  return (str || "").toLowerCase().replace(/\b[\p{L}\p{M}]+/gu, s => s.charAt(0).toUpperCase() + s.slice(1));
}

function renderSugerencias(items, contenedor, inputEl) {
  contenedor.innerHTML = "";
  if (!items || items.length === 0) return;

  const lista = document.createElement("ul");
  lista.className = "suggest-list";

  items.forEach(it => {
    const li = document.createElement("li");
    li.className = "suggest-item";
    // Mostrar siempre uniforme (Title Case) SOLO en la lista
    li.textContent = toTitleCase(it.nombre || "");
    li.onclick = () => {
      // Al seleccionar, conservar el nombre EXACTO del documento (no el Title Case)
      inputEl.value = it.nombre || "";
      window.clienteIDSeleccionado = it.id;
      window.clienteNombreSeleccionado = it.nombre || "";
      contenedor.innerHTML = "";
      buscarGruposCliente();
    };
    lista.appendChild(li);
  });

  contenedor.appendChild(lista);
}
const gruposClienteCache = new Map();

async function buscarGruposCliente() {
  const escrito = (document.getElementById("clienteGlobal").value || "").trim();
  let nombreExacto = window.clienteNombreSeleccionado || escrito;

  // Resolver exacto desde clientesCache si hace falta
  if (!clientesCargados) { try { await cargarClientesCache(); } catch(_){} }
  if (!window.clienteNombreSeleccionado && nombreExacto) {
    const needle = normalizar(nombreExacto);
    const hit = (clientesCache || []).find(c => c.norm === needle);
    if (hit) {
      nombreExacto = hit.nombre;
      window.clienteNombreSeleccionado = hit.nombre;
      window.clienteIDSeleccionado = hit.id;
      document.getElementById("clienteGlobal").value = hit.nombre;
    }
  }
  if (!nombreExacto) {
    alert("Primero escribe el nombre del cliente.");
    return;
  }

  const cacheKey = window.clienteIDSeleccionado || normalizar(nombreExacto);
  const lsKey = "grupos_id_" + cacheKey;

  // 1) Intenta RAM
  if (gruposClienteCache.has(cacheKey)) {
    const gruposEncontrados = gruposClienteCache.get(cacheKey);
   document.getElementById("grupoInput").value = gruposEncontrados.join(", ");
    renderGrupoChips();              // ← dibuja chips y sincroniza window.grupos
    actualizarResumenBatch();        // ← por si hay tabla visible, refrescar badge
    feedbackGrupos(gruposEncontrados.length);
return;

  }

  // 2) Intenta LS
    const gLS = lsGet(lsKey);
    if (gLS && Array.isArray(gLS) && gLS.length) {
      gruposClienteCache.set(cacheKey, gLS);
      document.getElementById("grupoInput").value = gLS.join(", ");
      renderGrupoChips();       // sincroniza window.grupos + dibuja chips
      actualizarResumenBatch(); // refresca badge con tooltip
      feedbackGrupos(gLS.length);
      return;
    }


  try {
    // 3) Query cache-first
    let snap;
    if (window.clienteIDSeleccionado) {
      snap = await db.collection("poc_devices").where("cliente_id", "==", window.clienteIDSeleccionado).get({ source: "cache" });
      if (snap.empty) snap = await db.collection("poc_devices").where("cliente_id", "==", window.clienteIDSeleccionado).get();
    } else {
      snap = await db.collection("poc_devices").where("cliente", "==", nombreExacto).get({ source: "cache" });
      if (snap.empty) snap = await db.collection("poc_devices").where("cliente", "==", nombreExacto).get();
    }

    const gruposSet = new Set();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.deleted === true) return;
      (d.grupos || []).forEach(g => {
        const v = (g || "").toString().trim();
        if (v) gruposSet.add(v);
      });
    });

    const gruposEncontrados = Array.from(gruposSet).sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    if (!gruposEncontrados.length) {
      alert("No se encontraron grupos para este cliente.");
      return;
    }

    // Guarda en RAM + LS
    gruposClienteCache.set(cacheKey, gruposEncontrados);
    lsSet(lsKey, gruposEncontrados);

    document.getElementById("grupoInput").value = gruposEncontrados.join(", ");
    renderGrupoChips();              // ← dibuja chips y sincroniza window.grupos
    actualizarResumenBatch();        // ← por si hay tabla visible, refrescar badge
    feedbackGrupos(gruposEncontrados.length);
  } catch (e) {
    console.error("Error buscando grupos:", e);
    alert("Ocurrió un error al buscar los grupos.");
  }
}

function feedbackGrupos(n) {
  let estado = document.getElementById("estadoFeedback");
  const input = document.getElementById("grupoInput");
  if (!estado) {
    estado = document.createElement("div");
    estado.id = "estadoFeedback";
    input.after(estado);
  }
  estado.textContent = `✅ Grupos encontrados: ${n}`;
  estado.style.cssText = "color:green;padding:6px 12px;background:#e6ffe6;border:1px solid #7ccc7c;border-radius:5px;margin-top:10px;";
  setTimeout(() => estado.remove(), 5000);
}

function agregarGrupo() {
  const nuevoGrupo = prompt("Nombre del nuevo grupo:");
  if (!nuevoGrupo) return;

  // Obtener grupos existentes desde el input
  const input = document.getElementById("grupoInput");
  const actuales = input.value.split(",").map(g => g.trim()).filter(g => g);

  // Añadir nuevo grupo
  actuales.push(nuevoGrupo.trim());

  // Actualizar el campo visual
  input.value = actuales.join(", ");

  renderGrupoChips(); // Actualiza chips y estado global

  // Regenerar tabla con todos los grupos
  generarTabla();
}

document.addEventListener("click", (e) => {
  const box = document.getElementById("sugerenciasClientes");
  const input = document.getElementById("clienteGlobal");
  if (!box) return;
  const clickDentro = box.contains(e.target) || input.contains(e.target);
  if (!clickDentro) box.innerHTML = "";
});

function limpiarTodo() {
  // Inputs superiores
  const clienteInput = document.getElementById("clienteGlobal");
  const modeloGlobalSel = document.getElementById("modeloGlobal");
  const gruposInput = document.getElementById("grupoInput");
  const seriales = document.getElementById("serialesPaste");
  const sugerenciasBox = document.getElementById("sugerenciasClientes");
  const salida = document.getElementById("salida");

  if (clienteInput) clienteInput.value = "";
  if (modeloGlobalSel) modeloGlobalSel.value = "";
  if (gruposInput) gruposInput.value = "";
  if (seriales) seriales.value = "";
  if (sugerenciasBox) sugerenciasBox.innerHTML = "";
  if (salida) salida.innerHTML = "";

  // Limpia feedback de grupos (si existe)
  const fb = document.getElementById("estadoFeedback");
  if (fb) fb.remove();


// Resetea variables globales
window.clienteIDSeleccionado = null;
window.clienteNombreSeleccionado = null;
grupos = [];
window.grupos = [];          // ← importante para el contador
renderGrupoChips?.();        // si usas chips, vacíalos si existe el contenedor
actualizarResumenBatch();    // recalcula: filas=0, grupos=0
setStep('prep');             // vuelve visualmente al primer paso del flujo


// ✅ Reinicia por completo los encabezados y filas
resetTablaEdicion();
}

function resetTablaEdicion() {
  const thead = document.querySelector("#tablaEquipos thead");
  const tbody = document.getElementById("cuerpoTabla");
  const table = document.getElementById("tablaEquipos");

  if (thead) {
    thead.innerHTML = `
      <tr id="encabezadoTabla">
        <th>Cliente</th>
        <th>Nombre del Radio</th>
        <th><input type="checkbox" id="gpsMaster" onchange="toggleGPS(this)"> GPS</th>
        <th>Modelo</th>
        <th>🗑️</th>
      </tr>
    `;
  }
  if (tbody) tbody.innerHTML = "";
  if (table) table.style.display = "none";   // ← se oculta la tabla
  document.getElementById("wrapTablaEquipos").style.display = "none";
  document.getElementById("scrollHintEquipos").style.display = "none";
  document.getElementById("tableSection").style.display = "none";
  document.getElementById("exportSection").style.display = "none";
  document.getElementById("actionCard").style.display = "none";
  actualizarResumenBatch();
}

function actualizarResumenBatch() {
  const resumenEl = document.getElementById("resumenBatch");
  if (!resumenEl) return;

  const filas = document.querySelectorAll("#cuerpoTabla tr").length;

  // Lee SIEMPRE desde el input (más robusto)
  const gruposTexto = (document.getElementById("grupoInput").value || "");
  const gruposArr = gruposTexto.split(",").map(g => g.trim()).filter(Boolean);
  const nGrupos = gruposArr.length;

  // Tooltip con la lista completa (ej: "A, B, C")
  const tooltip = nGrupos ? gruposArr.join(", ") : "Sin grupos";

  resumenEl.innerHTML = `
    <strong>${filas}</strong> filas ·
    <span class="badge completo" title="${tooltip}">${nGrupos}</span>
  `;
}

function renderGrupoChips() {
  const cont = document.getElementById("grupoChips");
  const val = (document.getElementById("grupoInput").value || "");
  const arr = val.split(",").map(s => s.trim()).filter(Boolean);

  // mantener estado global y contador SIEMPRE que cambie el input
  window.grupos = arr;
  actualizarResumenBatch();

  cont.innerHTML = arr.map((g,i)=>`
    <span class="chip-x">${g} <button title="Quitar" onclick="quitarGrupo(${i})">×</button></span>
  `).join("") + `
    <button class="btn btn-pill" onclick="agregarGrupoPrompt()" title="Agregar grupo"><span style="margin-right:4px">+</span> Grupo</button>
  `;
}

function quitarGrupo(index){
  const input = document.getElementById("grupoInput");
  const arr = input.value.split(",").map(s=>s.trim()).filter(Boolean);
  arr.splice(index,1);
  input.value = arr.join(", ");
  renderGrupoChips();
  // si ya había tabla, re-genera encabezado
  if (document.getElementById("tablaEquipos").style.display !== "none") generarTabla();
}
function agregarGrupoPrompt(){
  const g = prompt("Nombre del grupo:");
  if (!g) return;
  const input = document.getElementById("grupoInput");
  const arr = input.value.split(",").map(s=>s.trim()).filter(Boolean);
  arr.push(g.trim());
  input.value = arr.join(", ");
  renderGrupoChips();
  if (document.getElementById("tablaEquipos").style.display !== "none") generarTabla();
}
// render inicial y oninput
document.getElementById("grupoInput").addEventListener("input", renderGrupoChips);
document.addEventListener("DOMContentLoaded", renderGrupoChips);
function toast(msg, type=""){ // type: "", "ok", "bad"
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast" + (type ? " "+type : "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 3500);
}

// === Autosave borrador ===
let DRAFT_KEY = null;

firebase.auth().onAuthStateChanged(user => {
  if (user) {
    DRAFT_KEY = "vend_batch_draft_" + user.uid; 
    restoreDraft(); // ← aquí restauras el borrador correcto de ese usuario
  }
});

function saveDraft(){
  if (!DRAFT_KEY) return;
  const draft = {
    cliente: document.getElementById("clienteGlobal").value || "",
    modelo: document.getElementById("modeloGlobal").value || "",
    grupos: document.getElementById("grupoInput").value || "",
    lista: document.getElementById("serialesPaste").value || "",
    tabla: Array.from(document.querySelectorAll("#cuerpoTabla tr")).map(tr => ({
      nombre: tr.querySelector(".nombre")?.value || "",
      gps: !!tr.querySelector(".gps")?.checked,
      modelo: tr.querySelector(".modelo")?.value || "",
      grupos: Array.from(tr.querySelectorAll(".grupo")).map(ch => !!ch.checked)
    }))
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  toast("Borrador guardado", "ok");
}

function restoreDraft(){
  if (!DRAFT_KEY) return;
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    document.getElementById("clienteGlobal").value = d.cliente || "";
    document.getElementById("modeloGlobal").value = d.modelo || "";
    document.getElementById("grupoInput").value = d.grupos || "";
    document.getElementById("serialesPaste").value = d.lista || "";
    renderGrupoChips();
    if ((d.tabla||[]).length){
      // reconstruir encabezado
      grupos = (d.grupos || "").split(",").map(s=>s.trim()).filter(Boolean);
      document.getElementById("encabezadoTabla").innerHTML = `
        <th>Cliente</th>
        <th>Nombre del Radio</th>
        <th><input type="checkbox" id="gpsMaster" onchange="toggleGPS(this)"> GPS</th>
        ${grupos.map((g, i) => `<th><input type='checkbox' onchange='toggleGrupo(${i}, this)'> ${g}</th>`).join('')}
        <th>Modelo</th>
        <th>🗑️</th>`;
      document.getElementById("wrapTablaEquipos").style.display = "block";
      const tbody = document.getElementById("cuerpoTabla");
      tbody.innerHTML = "";
      d.tabla.forEach(r => {
        agregarFila("", r.nombre);
        const tr = tbody.lastElementChild;
        tr.querySelector(".gps").checked = !!r.gps;
        const sel = tr.querySelector(".modelo");
        if (sel) sel.value = r.modelo || "";
        tr.querySelectorAll(".grupo").forEach((ch, idx) => ch.checked = !!(r.grupos||[])[idx]);
      });
      actualizarResumenBatch();
      toast("Borrador restaurado", "ok");
    }
   }catch(e){ console.warn("No se pudo restaurar borrador", e); }
}

function clearDraft(){
  if (!DRAFT_KEY) return;
  localStorage.removeItem(DRAFT_KEY);
  toast("Borrador eliminado", "warn");
}

// Botón guardar + atajo Ctrl+S
document.getElementById("btnGuardarBorrador").addEventListener("click", saveDraft);
document.addEventListener("keydown", (e)=>{
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="s"){
    e.preventDefault(); saveDraft();
  }
});

// Update step badges based on form completion
function updateStepBadges(){
  const cliente = (document.getElementById("clienteGlobal").value || "").trim();
  const grupos = (document.getElementById("grupoInput").value || "").trim();
  const lista  = (document.getElementById("serialesPaste").value || "").trim();

  const b1 = document.getElementById("badgeCliente");
  const b2 = document.getElementById("badgeLote");

  if (b1) {
    b1.textContent = cliente ? "Listo" : "Pendiente";
    b1.className = cliente ? "badge ready" : "badge pending";
  }
  if (b2) {
    b2.textContent = (grupos && lista) ? "Listo" : "Pendiente";
    b2.className = (grupos && lista) ? "badge ready" : "badge pending";
  }
}

// Attach badge update listeners
["clienteGlobal","grupoInput","serialesPaste"].forEach(id=>{
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", updateStepBadges);
});

// Restaurar al cargar
document.addEventListener("DOMContentLoaded", () => { setStep('prep'); restoreDraft(); updateStepBadges(); });
// Ctrl+Enter = Generar tabla
document.addEventListener("keydown", (e)=>{
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter"){
    e.preventDefault(); generarTabla();
    toast("Tabla generada", "ok");
  }
});

async function refrescarModelos() {
  // Limpia cache local
  localStorage.removeItem("cache_modelos_v1");

  try {
    // Fuerza lectura desde el servidor (ignora cache Firestore)
    let snap = await db.collection("modelos").get({ source: "server" });

    modelosDisponibles = snap.docs
      .map(d => {
        const m = d.data();
        return {
          id: d.id,
          marca: m.marca || "",
          modelo: m.modelo || "",
          tipo: m.tipo || "",
          estado: m.estado || "",
          alto_movimiento: !!m.alto_movimiento,
          activo: m.activo !== false,
        };
      })
      .filter(m => m.activo)
      .sort((a, b) => {
        const ma = a.marca.toLowerCase();
        const mb = b.marca.toLowerCase();
        if (ma !== mb) return ma.localeCompare(mb);
        return a.modelo.toLowerCase().localeCompare(b.modelo.toLowerCase());
      })
      .map(m => ({ ...m, label: `${m.marca} ${m.modelo}`.trim() }));

    // Vuelve a poblar el dropdown
    poblarDropdownModeloGlobal();

    // Guarda de nuevo en localStorage
    lsSet("cache_modelos_v1", modelosDisponibles);

    toast("Lista de modelos actualizada ✅", "ok");
  } catch (e) {
    console.error("Error al refrescar modelos:", e);
    toast("Error al refrescar modelos", "bad");
  }
}
async function refrescarClientes() {
  try {
    localStorage.removeItem("cache_clientes_v1");
    clientesCargados = false;
    await cargarClientesCache(); // reconstruye el cache desde Firestore
    toast("Lista de clientes actualizada ✅", "ok");
  } catch (e) {
    console.error("Error al refrescar clientes:", e);
    toast("Error al refrescar clientes", "bad");
  }
}


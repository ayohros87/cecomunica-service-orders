// @ts-nocheck
  /* ===== Preferencias UI / Orden ===== */
let sortKey = 'marca';
let sortDir = 'asc'; // 'asc' | 'desc'
let dense = false;
const hiddenCols = new Set(); // 'sku' | 'costo' | 'ubicacion'

function loadUIPrefs(){
  try{
    const p = JSON.parse(localStorage.getItem('inv_piezas_prefs') || '{}');
    // 👇 antes decía 'nombre'; ahora por defecto 'marca'
    sortKey = p.sortKey || 'marca';
    sortDir = p.sortDir || 'asc';
    dense = !!p.dense;
    (p.hiddenCols || []).forEach(k => hiddenCols.add(k));
  }catch(e){}
  document.body.classList.toggle('dense', dense);

  // checkboxes
  const chSku = document.getElementById('col-CHK-sku');
  const chCos = document.getElementById('col-CHK-costo');
  const chUbi = document.getElementById('col-CHK-ubicacion');
  if (chSku) chSku.checked = !hiddenCols.has('sku');
  if (chCos) chCos.checked = !hiddenCols.has('costo');
  if (chUbi) chUbi.checked = !hiddenCols.has('ubicacion');
  applyDensity();
}

function saveUIPrefs(){
  localStorage.setItem('inv_piezas_prefs', JSON.stringify({
    sortKey, sortDir, dense, hiddenCols:[...hiddenCols]
  }));
}

/* ========= Estado ========= */
let piezas = [];
let filtro = '';
let piezaEditId = null; // null => crear, string => editar
let rolActual = null;

/* ========= Auth + Rol ========= */
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return window.location.href = "../login.html";
  try {
    // Rol desde Sesion (caché de sesión, compartida con el rail): en
    // navegaciones tibias no hay viaje al servidor antes de pedir las piezas.
    const rol = (await Sesion.rol(user.uid)) || null;
    rolActual = rol;
    loadUIPrefs();
    // Precios solo en Finanzas: el enlace de la nota de arriba es para admin
    // (contabilidad no entra a esta página; inventario no edita precios).
    const lnk = document.getElementById('lnkFinanzas');
    if (lnk) lnk.innerHTML = rol === ROLES.ADMIN
      ? '(<a href="/inventario/piezas-tarifas.html">Editar en Finanzas</a>)'
      : '(administración o contabilidad)';

const btnBatch = document.getElementById('btnBatch');
if (btnBatch) {
  if (rol !== ROLES.ADMIN && rol !== ROLES.INVENTARIO) {
    btnBatch.style.display = 'none';
  }
}

    // Solo administradores o personal de inventario
    if (rol !== ROLES.ADMIN && rol !== ROLES.INVENTARIO) {
      document.body.innerHTML = '<div style="text-align:center; margin-top:100px; color:red;">Acceso restringido.</div>';
      return;
    }

    // ?filtro=sin_stock|stock_bajo|activas — deep-link de la señal S9 del home
    // (auditoría UX 2026-09-28: antes aterrizaba sin filtro).
    const f = new URLSearchParams(location.search).get('filtro');
    if (f) aplicarFiltroKpi(f, { sinRender: true });

    await cargar();

  } catch (e) {
    console.error(e);
    Toast.show('Error al validar rol','bad');
  }
});

// Los KPI aplican su filtro (auditoría UX 2026-09-28). Deja marcada solo la
// casilla que corresponde; '' = ver todas.
const FILTROS_KPI = { activas: 'chkActivas', sin_stock: 'chkSinStock', stock_bajo: 'chkStockBajo' };
function aplicarFiltroKpi(clave, { sinRender = false } = {}) {
  ['chkActivas', 'chkConStock', 'chkSinStock', 'chkStockBajo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = FILTROS_KPI[clave] === id;
    el.closest('.toggle-pill')?.classList.toggle('is-on', el.checked);
  });
  if (!sinRender) render();
}
/* ========= Batch: modal control ========= */
function abrirBatchModal(){
  if (rolActual !== ROLES.ADMIN && rolActual !== ROLES.INVENTARIO) {
    Toast.show('Acceso restringido.','warn');
    return;
  }
  Modal.open('overlayBatch');
}
function cerrarBatchModal(){
  Modal.close('overlayBatch');
}

/* ========= Batch: helpers ========= */
function normalizaHeader(h){
  if(!h) return '';
  return String(h).toLowerCase().trim()
    .replace(/\s+/g,'_')
    .replace(/[^a-z0-9_]/g,'');
}
function parseBooleanLike(v){
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (['true','1','si','sí','yes','y','activo'].includes(s)) return true;
  if (['false','0','no','n','inactivo'].includes(s)) return false;
  return null;
}
function parseNumberSafe(v, def=0){
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
/* ===== Debounce buscar ===== */
function debounce(fn, delay=220){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); };
}
const onFilterInput = debounce(()=>{
  filtro = (document.getElementById('filtroNombre').value||'').toLowerCase().trim();
  render();
}, 220);

// Engancha eventos
window.addEventListener('DOMContentLoaded', ()=>{
  const inp = document.getElementById('filtroNombre');
  if (inp){
    inp.addEventListener('input', onFilterInput);
    // Atajo: Enter = buscar inmediata
    inp.addEventListener('keydown', e=>{
      if (e.key === 'Enter'){ e.preventDefault(); onFilterInput(); }
    });
  }
  applyColumnVisibility();
  // Abrir/cerrar dropdown "Columnas" por click
  const ddBtn = document.querySelector('.dropdown > button.btn');
  if (ddBtn){
    ddBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      ddBtn.parentElement.classList.toggle('open');
    });
    document.addEventListener('click', ()=>{
      document.querySelector('.dropdown.open')?.classList.remove('open');
    });
  }

});
function sortBy(key){
  if (sortKey === key){
    sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }
  saveUIPrefs();
  render();
}

function applySort(arr){
  const dir = (sortDir === 'asc') ? 1 : -1;
  const key = sortKey;
  return arr.slice().sort((a,b)=>{
    const va = (a[key] ?? '');
    const vb = (b[key] ?? '');
    if (typeof va === 'number' || typeof vb === 'number'){
      return (Number(va) - Number(vb)) * dir;
    }
    // boolean: true > false
    if (typeof va === 'boolean' || typeof vb === 'boolean'){
      return ((va===vb)?0:(va?1:-1)) * dir;
    }
    return String(va).localeCompare(String(vb), 'es', {numeric:true, sensitivity:'base'}) * dir;
  });
}

function updateSortIndicators(){
  document.querySelectorAll('th .sort').forEach(el => el.textContent = '↕');
  const el = document.getElementById('s-'+sortKey);
  if (el) el.textContent = (sortDir === 'asc') ? '↑' : '↓';
}



function toggleColumn(key, visible){
  if (!visible) hiddenCols.add(key);
  else hiddenCols.delete(key);
  saveUIPrefs();
  render(); // re-pinta con clases ocultas
}
/* ===== Densidad ===== */
function applyDensity(){
  const tw = document.querySelector('.app-table-wrap');
  if (tw) tw.setAttribute('data-density', dense ? 'dense' : 'roomy');
}

function toggleDensity(){
  dense = !dense;
  document.body.classList.toggle('dense', dense); // puedes mantenerla, pero la clave es data-density
  saveUIPrefs();
  applyDensity();
  Toast.show(dense ? 'Vista compacta' : 'Vista cómoda', 'ok');
}

/* ===== Aplica visibilidad de columnas a <th> y <td> ===== */
function applyColumnVisibility(){
  const map = { sku: '.col-sku', costo: '.col-costo', ubicacion: '.col-ubicacion' };
  Object.entries(map).forEach(([key, selector]) => {
    const hide = hiddenCols.has(key);
    document.querySelectorAll(selector).forEach(el => {
      if (hide) el.classList.add('hidden-col');
      else el.classList.remove('hidden-col');
    });
  });
}


/* CSV/TSV muy simple: separa por líneas, detecta separador (coma o tab), respeta encabezados. */
function parseDelimited(text){
  if (!text || !text.trim()) return [];
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  // detecta separador
  const sep = (lines[0].includes('\t')) ? '\t' : ',';
  const headers = lines[0].split(sep).map(normalizaHeader);
  const rows = [];

  for (let i = 1; i < lines.length; i++){
    const cols = lines[i].split(sep);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (cols[idx] ?? '').trim());
    rows.push(obj);
  }
  return rows;
}

function descargarPlantillaCSV(){
  const contenido = [
    'marca,sku,nombre,descripcion,precio_venta,costo_unitario,cantidad,minimo,unidad,ubicacion,equipos_asociados,activo,notas',
    'Hytera,CN-PD786-BAT,Batería PD786,Batería Li-Ion 2000mAh,35,21,10,3,pieza,Estante A3,Radio-123|Base-Oficina,true,',
    'Genérico,,Cable coaxial RG58,Cable coaxial RG58 por metro,1.2,0.6,100,10,metro,Bodega 1,Camion-5|Sucursal-Colon,true,carrete de 100m'
  ].join('\n');
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_piezas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ========= Batch: lectura de archivo (sobrescribe textarea) ========= */
document.getElementById('batch-file')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  document.getElementById('batch-text').value = text;
});

/* ========= Batch: guardar ========= */
async function guardarBatch(){
  if (rolActual !== ROLES.ADMIN && rolActual !== ROLES.INVENTARIO) {
    Toast.show('Acceso restringido.','warn');
    return;
  }

  const raw = document.getElementById('batch-text').value || '';
  const defUnidad = (document.getElementById('def-unidad').value || '').trim();
  const defUbic = (document.getElementById('def-ubicacion').value || '').trim();
  const defMin = parseNumberSafe(document.getElementById('def-minimo').value, null);

  const rows = parseDelimited(raw);
  if (rows.length === 0){
    Toast.show('No hay datos para cargar','warn');
    return;
  }

const map = {
  marca: ['marca','brand'],
  sku: ['sku','codigo','código'],
  nombre: ['nombre','nombre_corto','name'],
  descripcion: ['descripcion','descripción','description','desc'],
  precio_venta: ['precio_venta','precio','precio venta','precio_venta_usd'],
  costo_unitario: ['costo_unitario','costo','costo unitario'],
  cantidad: ['cantidad','qty','existencia'],
  minimo: ['minimo','mínimo','min','min_stock'],
  unidad: ['unidad','um'],
  ubicacion: ['ubicacion','ubicación','location'],
  equipos_asociados: ['equipos_asociados','equipos','equipos asociados'],
  activo: ['activo','status','estado'],
  sin_control_inventario: ['sin_control_inventario','sin_control','sincontrol','inventario_libre'],
  notas: ['notas','nota','observacion','observación','comentario']
};

  // Construye mapeo de headers
  const first = rows[0] || {};
  const headersPresentes = Object.keys(first);
  const headerToKey = {};
  headersPresentes.forEach(h => {
    const matchKey = Object.keys(map).find(k => map[k].includes(normalizaHeader(h)));
    if (matchKey) headerToKey[h] = matchKey;
  });

  let ok = 0, err = 0;
  const errores = [];

  let batch = db.batch();
  let ops = 0;

  const now = firebase.firestore.FieldValue.serverTimestamp();
  const uid = (firebase.auth().currentUser || {}).uid;

  for (let i = 0; i < rows.length; i++){
    const row = rows[i];
// 1) payload base
const payload = {
  marca: '', sku: '', nombre: '', descripcion: '',
  precio_venta: 0, costo_unitario: 0, cantidad: 0, minimo: 5,
  unidad: 'pieza', ubicacion: '', equipos_asociados: [],
  notas: '', activo: true
};

// 2) volcar columnas reconocidas
for (const h in row){
  const key = headerToKey[h];
  if (!key) continue;
  payload[key] = row[h];
}

// 3) defaults (unidad/ubicación/mínimo) y coerciones numéricas/bool
if (!payload.unidad && defUnidad) payload.unidad = defUnidad;
if (!payload.ubicacion && defUbic) payload.ubicacion = defUbic;
if ((payload.minimo === undefined || payload.minimo === '' || payload.minimo === null) && defMin !== null) {
  payload.minimo = defMin;
}

payload.marca = String(payload.marca || '').trim();
payload.sku = String(payload.sku || '').trim();
payload.nombre = String(payload.nombre || '').trim();
payload.descripcion = String(payload.descripcion || '').trim();

payload.precio_venta   = parseNumberSafe(payload.precio_venta, 0);
payload.costo_unitario = parseNumberSafe(payload.costo_unitario, 0);
payload.cantidad       = parseNumberSafe(payload.cantidad, 0);
payload.minimo         = parseNumberSafe(payload.minimo, 5);

const bActivo = parseBooleanLike(payload.activo);
payload.activo = (bActivo === null) ? true : bActivo; // default true
payload.notas = String(payload.notas || '').trim();

// equipos_asociados a lista
if (typeof payload.equipos_asociados === 'string' && payload.equipos_asociados.trim()){
  payload.equipos_asociados = payload.equipos_asociados
    .split(/[|,]/).map(x=>x.trim()).filter(Boolean);
} else if (!Array.isArray(payload.equipos_asociados)) {
  payload.equipos_asociados = [];
}

// ⚠️ AHORA sí: coerción de sin_control_inventario
const sc = parseBooleanLike(payload.sin_control_inventario);
payload.sin_control_inventario = (sc === null) ? false : sc;

// Precio y costo son de Finanzas (piezas-tarifas): la carga por CSV solo
// los acepta de administración; para inventario las piezas nacen en 0 y el
// precio se completa en Finanzas (auditoría UX 2026-09-28, remate).
if (rolActual !== ROLES.ADMIN) {
  payload.precio_venta = 0;
  payload.costo_unitario = 0;
}

// Validaciones mínimas (el precio ya no es obligatorio: lo pone Finanzas)
if (!payload.marca){
  err++;
  errores.push(`Línea ${i+2}: requiere marca`);
  continue;
}

// 4) doc final
const docData = {
  ...payload,
  creado_por_uid: uid,
  creado_en: now,
  actualizado_en: now
};

    const ref = PiezasService.newDocRef();
    batch.set(ref, docData);
    ops++;

    // Commit parcial
    if (ops >= 450){
      try {
        await batch.commit();
        ok += ops;
      } catch (e) {
        console.error('Commit parcial falló:', e);
        err += ops;
      }
      batch = db.batch();
      ops = 0;
    }
  }

  // Commit final
  if (ops > 0){
    try {
      await batch.commit();
      ok += ops;
    } catch (e) {
      console.error('Commit final falló:', e);
      err += ops;
    }
  }

  // Feedback
  if (errores.length){
    console.warn('Errores en batch:', errores.slice(0,10));
  }
  Toast.show(`Insertadas: ${ok} · Errores: ${err}`, err ? 'warn' : 'ok');

  cerrarBatchModal();
  await cargar();
}

// Arranque rápido (2026-09-29): la tabla se pinta primero desde la caché
// local de Firestore (lo último visto) y el servidor la corrige enseguida.
let _servidorListo = false;
async function cargar() {
  showSkeleton();
  PiezasService.getPiezas({ source: 'cache' })
    .then(rows => { if (!_servidorListo && rows.length) { piezas = rows; render(); renderResumen(); } })
    .catch(() => { /* sin caché todavía */ });
  try {
    piezas = await PiezasService.getPiezas();
    _servidorListo = true;
  } catch (e) {
    console.error(e);
    Toast.show('Error cargando piezas','bad');
    piezas = [];
  }
  render();
  renderResumen();
}


function showSkeleton(){
  const tb = document.getElementById('tb');
  const rows = 6;
  tb.innerHTML = Array.from({length:rows}).map(()=>`
    <tr>
      <td><div class="skeleton" style="width:120px;"></div></td>  <!-- Marca -->
      <td class="col-sku"><div class="skeleton" style="width:90px;"></div></td>  <!-- SKU -->
      <td><div class="skeleton" style="width:180px;"></div></td> <!-- Descripción -->
      <td><div class="skeleton" style="width:60px;"></div></td>  <!-- Precio -->
      <td class="col-costo"><div class="skeleton" style="width:60px;"></div></td> <!-- Costo -->
      <td><div class="skeleton" style="width:50px;"></div></td>  <!-- Cant -->
      <td><div class="skeleton" style="width:40px;"></div></td>  <!-- Mín -->
      <td><div class="skeleton" style="width:60px;"></div></td>  <!-- Unidad -->
      <td class="col-ubicacion"><div class="skeleton" style="width:120px;"></div></td> <!-- Ubicación -->
      <td><div class="skeleton" style="width:160px;"></div></td> <!-- Equipos -->
      <td><div class="skeleton" style="width:70px;"></div></td>  <!-- Estado -->
      <td><div class="skeleton" style="width:80px;"></div></td>  <!-- Inventario -->
      <td><div class="skeleton" style="width:140px;"></div></td> <!-- Acciones -->
    </tr>
  `).join('');
  applyColumnVisibility();
  applyDensity();
}



// Mismos criterios en KPI, filtros y la señal S9 del home (auditoría UX
// 2026-09-28): "sin stock" = ACTIVA, controlada y en 0 — una pieza inactiva o
// "Libre" no es un faltante que alguien tenga que reponer; "stock bajo" =
// controlada, con algo, bajo el mínimo. SenalesService.countPiezasSinStock
// cuenta exactamente esto: si cambia aquí, cambia allá.
const esSinStock = (p) => p.activo === true && !p.sin_control_inventario && Number(p.cantidad || 0) <= 0;
const esStockBajo = (p) => !p.sin_control_inventario && Number(p.cantidad || 0) > 0 && Number(p.cantidad || 0) < Number(p.minimo || 5);

function renderResumen(){
  const total = piezas.length;
  const activas = piezas.filter(p => p.activo === true).length;
  const criticas = piezas.filter(esSinStock).length;
  const bajas = piezas.filter(esStockBajo).length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpiTotal', total);
  set('kpiActivas', activas);
  set('kpiSinStock', criticas);
  set('kpiBajas', bajas);
}

function onTogglePiezas(inp){
  inp.closest('.toggle-pill')?.classList.toggle('is-on', inp.checked);
  render();
}

function render() {
  const tb = document.getElementById('tb');
  let data = piezas;

// Filtro: marca, sku, descripcion y equipos_asociados

  const q = (document.getElementById('filtroNombre').value||'').toLowerCase().trim();
  if (q) {
    data = data.filter(p => {
    const nombre = (p.nombre||'').toLowerCase();
    const marca = (p.marca||'').toLowerCase();
    const sku = (p.sku||'').toLowerCase();
    const desc = (p.descripcion||'').toLowerCase();
      const equipos = Array.isArray(p.equipos_asociados) ? p.equipos_asociados.map(x=>String(x).toLowerCase()) : [];
      return nombre.includes(q) || marca.includes(q) || sku.includes(q) || desc.includes(q) || equipos.some(e=>e.includes(q));
    });
  }

  // Toggles de stock (las piezas sin control de inventario no cuentan como agotadas)
  const on = (id) => !!document.getElementById(id)?.checked;
  if (on('chkActivas')) data = data.filter(p => p.activo === true);
  if (on('chkConStock'))
    data = data.filter(p => p.sin_control_inventario || Number(p.cantidad || 0) > 0);
  if (on('chkSinStock')) data = data.filter(esSinStock);
  if (on('chkStockBajo')) data = data.filter(esStockBajo);

  // KPI resaltado según el filtro aplicado.
  const kpiOn = { kpiActivas: on('chkActivas'), kpiSinStock: on('chkSinStock'), kpiBajas: on('chkStockBajo') };
  Object.entries(kpiOn).forEach(([id, v]) => document.getElementById(id)?.closest('.kpi-card')?.classList.toggle('is-on', v));

  // sort
  data = applySort(data);
  updateSortIndicators();

  // Vacío POR FILTRO ≠ catálogo vacío (auditoría UX 2026-09-28): con piezas
  // cargadas y un filtro puesto, "Crea tu primera pieza" era mentira.
  const hayFiltro = !!q || ['chkActivas', 'chkConStock', 'chkSinStock', 'chkStockBajo'].some(on);
  if (data.length === 0 && piezas.length && hayFiltro) {
    tb.innerHTML = `
      <tr>
        <td colspan="13" style="padding:24px;">
          <div class="card soft" style="text-align:center;">
            <div style="font-size:16px; margin-bottom:8px;">No hay piezas que cumplan el filtro</div>
            <button class="btn" onclick="limpiarFiltrosPiezas()"><i data-lucide="x"></i> Quitar filtros</button>
          </div>
        </td>
      </tr>`;
    const resumenVacio = document.getElementById('resumen');
    if (resumenVacio) resumenVacio.innerHTML = `Mostrando <strong>0</strong> de <strong>${piezas.length}</strong> piezas`;
    if (window.Icons) Icons.pintar(tb); else if (window.lucide) lucide.createIcons({ root: tb }); // `nodes` no existe en el vendor: barría todo el documento
    return;
  }

  // empty state
  if (data.length === 0) {
    tb.innerHTML = `
      <tr>
        <td colspan="13" style="padding:24px;">
          <div class="card soft" style="text-align:center;">
            <div style="font-size:18px; margin-bottom:8px;">No hay piezas</div>
            <div class="muted" style="margin-bottom:14px;">Crea tu primera pieza o carga un archivo CSV.</div>
            <div class="btn-group">
              <button class="btn btn-accent" onclick="abrirModal()"><i data-lucide="plus"></i> Nueva pieza</button>
              <button class="btn" onclick="abrirBatchModal()"><i data-lucide="download"></i> Carga en lote</button>
            </div>
          </div>
        </td>
      </tr>`;
    const resumenVacio = document.getElementById('resumen');
    if (resumenVacio) resumenVacio.innerHTML = `Mostrando <strong>0</strong> de <strong>${piezas.length}</strong> piezas`;
    if (window.Icons) Icons.pintar(tb); else if (window.lucide) lucide.createIcons({ root: tb }); // `nodes` no existe en el vendor: barría todo el documento
    return;
  }

  tb.innerHTML = data.map(p => {
    const precio = Number(p.precio_venta || 0);
    const costo = Number(p.costo_unitario || 0);
    const cant = Number(p.cantidad || 0);
    const min = Number(p.minimo || 5);
    const unidad = p.unidad || 'pieza';
    const ubic = p.ubicacion || '-';
    const sku = p.sku || '-';
    const marca = p.marca || '';
    const desc = p.descripcion || '';
    const nombre = p.nombre || '';
    const equipos = Array.isArray(p.equipos_asociados) ? p.equipos_asociados : [];
    const control = p.sin_control_inventario
  ? '<span class="badge warn">Libre</span>'
  : '<span class="badge completo">Controlado</span>';

    const chipCant =
      cant <= 0
        ? '<span class="badge danger">Sin stock</span>'
        : cant < min
          ? `<span class="badge pendiente">${cant}</span>`
          : `<span class="badge completo">${cant}</span>`;

    const estado =
      p.activo === true
        ? '<span class="badge completo">Activo</span>'
        : '<span class="badge">Inactivo</span>';

    const disableEdicion = (rolActual !== ROLES.ADMIN && rolActual !== ROLES.INVENTARIO);

    const equiposHtml = equipos.length
      ? equipos.slice(0,4).map(e => `<span class="chip" title="${e}">${e}</span>`).join(' ') + (equipos.length > 4 ? ` <span class="chip">+${equipos.length-4}</span>` : '')
      : '<span class="muted">—</span>';

    return `
      <tr>
        <td class="truncate" title="${marca}">${marca}</td>
        <td class="td-primary col-sku ${hiddenCols.has('sku') ? 'hidden-col':''}">${sku}</td>
        <td class="truncate" title="${nombre ? nombre + (desc ? ' — ' + desc : '') : desc}">
          ${nombre
            ? `${nombre}${desc ? `<span class="muted" style="display:block; font-size:11px;">${desc}</span>` : ''}`
            : (desc || '—')}
        </td>
        <td class="td-amount">$${precio.toFixed(2)}</td>
        <td class="td-amount col-costo ${hiddenCols.has('costo') ? 'hidden-col':''}">$${costo.toFixed(2)}</td>
        <td>
          <div class="table-actions">
            ${chipCant}
            <button class="btn btn-ghost btn-sm" title="Ajustar stock (±N con motivo)" aria-label="Ajustar stock" ${disableEdicion || p.sin_control_inventario ? 'disabled' : ''} onclick="ajustarStockN('${p.id}')">±</button>
            <button class="btn btn-ghost btn-sm" title="Kardex: cada entrada y salida con su motivo" aria-label="Kardex" onclick="verKardex('${p.id}')"><i data-lucide="history"></i></button>
          </div>
          ${p.ultimo_ajuste?.motivo ? `<span class="muted" style="display:block; font-size:11px;" title="${String(p.ultimo_ajuste.motivo).replace(/"/g, '&quot;')}">últ.: ${p.ultimo_ajuste.delta > 0 ? '+' : ''}${Number(p.ultimo_ajuste.delta || 0)}</span>` : ''}
        </td>
        <td>${min}</td>
        <td>${unidad}</td>
        <td class="truncate col-ubicacion ${hiddenCols.has('ubicacion') ? 'hidden-col':''}" title="${ubic}">${ubic}</td>
        <td>${equiposHtml}</td>
        <td>${estado}</td>
        <td>${control}</td>
        <td class="td-actions">
          <div class="table-actions">
            <button class="btn btn-ghost btn-sm" title="Editar" aria-label="Editar" ${disableEdicion ? 'disabled' : ''} onclick="abrirModal('${p.id}')"><i data-lucide="pencil"></i></button>
            <button class="btn btn-ghost btn-sm" title="${p.activo ? 'Desactivar' : 'Activar'}" aria-label="${p.activo ? 'Desactivar' : 'Activar'}" ${disableEdicion ? 'disabled' : ''} onclick="toggleActivo('${p.id}', ${!!p.activo})"><i data-lucide="power"></i></button>
            <button class="btn btn-ghost btn-sm" title="Duplicar" aria-label="Duplicar" ${disableEdicion ? 'disabled' : ''} onclick="duplicar('${p.id}')"><i data-lucide="copy"></i></button>
            ${rolActual === ROLES.ADMIN
              ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad);" title="Eliminar" aria-label="Eliminar" onclick="eliminarPieza('${p.id}', '${(marca + (sku ? ' ' + sku : '')).replace(/"/g,'&quot;')}')"><i data-lucide="trash-2"></i></button>`
              : ''
            }
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Footer: conteo filtrado vs total
  const resumenEl = document.getElementById('resumen');
  if (resumenEl) resumenEl.innerHTML = `Mostrando <strong>${data.length}</strong> de <strong>${piezas.length}</strong> piezas`;

  applyColumnVisibility();
  applyDensity();
  if (window.Icons) Icons.pintar(tb); else if (window.lucide) lucide.createIcons({ root: tb }); // `nodes` no existe en el vendor: barría todo el documento
}


/* ========= Filtros ========= */
function filtrar(){
  // ya usamos render() que lee directamente el valor del input
  render();
}

function limpiar(){
  document.getElementById('filtroNombre').value = '';
  filtro = '';
  render();
}

function limpiarFiltrosPiezas(){
  document.getElementById('filtroNombre').value = '';
  filtro = '';
  aplicarFiltroKpi('');
}
/* ========= Eliminar ========= */
async function eliminarPieza(id, nombre = '') {
  if (rolActual !== ROLES.ADMIN) {
    Toast.show('Solo los administradores pueden eliminar piezas','warn');
    return;
  }

  if (!await Modal.confirm({ message: `¿Seguro que deseas eliminar la pieza "${nombre}"? Esta acción no se puede deshacer.`, danger: true })) return;

  try {
    await PiezasService.deletePieza(id);
    Toast.show('Pieza eliminada','ok');
    await cargar();
  } catch (err) {
    console.error('Error eliminando pieza:', err);
    Toast.show('Error al eliminar la pieza','bad');
  }
}

function abrirModal(id = null){
  piezaEditId = id;
  const creando = (id === null);

  document.getElementById('modalTitle').innerText = creando ? 'Nueva pieza' : 'Editar pieza';
// Reset
setVal('f-marca',''); setVal('f-sku',''); setVal('f-nombre',''); setVal('f-descripcion','');
setVal('f-precio',''); setVal('f-costo','');
setVal('f-cantidad',''); setVal('f-minimo','5'); setVal('f-unidad','pieza'); setVal('f-ubicacion','');
setVal('f-equipos','');
document.getElementById('f-activo').value = 'true';
setVal('f-sin-control','false');
setVal('f-notas','');


  if (!creando){
    const pieza = piezas.find(x => x.id === id);
    if (pieza){
      setVal('f-marca', pieza.marca || '');
      setVal('f-sku', pieza.sku || '');
      setVal('f-nombre', pieza.nombre || '');
      setVal('f-descripcion', pieza.descripcion || '');
      setVal('f-precio', Number(pieza.precio_venta||0));
      setVal('f-costo', Number(pieza.costo_unitario||0));
      setVal('f-cantidad', Number(pieza.cantidad||0));
      setVal('f-minimo', Number(pieza.minimo||5));
      setVal('f-unidad', pieza.unidad || 'pieza');
      setVal('f-ubicacion', pieza.ubicacion || '');
      setVal('f-equipos', Array.isArray(pieza.equipos_asociados) ? pieza.equipos_asociados.join(', ') : '');
      setVal('f-sin-control', pieza.sin_control_inventario ? 'true' : 'false');
      document.getElementById('f-activo').value = pieza.activo === false ? 'false' : 'true';
      setVal('f-notas', pieza.notas || '');
    }
  }
  // Precio y costo son de LECTURA aquí (auditoría UX 2026-09-28): se editan
  // solo en Finanzas · Piezas y Tarifas (admin/contabilidad). Al crear
  // quedan en 0 y Finanzas los ve marcados "⚠ sin precio".
  const hint = document.getElementById('f-precio-hint');
  if (hint) {
    hint.innerHTML = (creando ? 'La pieza nace sin precio: ' : 'Precio y costo de lectura: ')
      + (rolActual === ROLES.ADMIN
        ? `<a href="/inventario/piezas-tarifas.html">Editar en Finanzas · Piezas y Tarifas</a>`
        : 'los fija Finanzas (administración o contabilidad) en Piezas y Tarifas.')
      + (creando ? '' : ` · <a href="#" onclick="event.preventDefault(); verKardex('${id}')">Ver kardex</a>`);
  }
  Modal.open('overlay');
}

// Kardex de la pieza (auditoría UX 2026-09-28): cada ±N con motivo, quién y
// de dónde (ajuste manual, consumo de una orden…). Antes solo quedaba el
// último ajuste en el doc.
async function verKardex(id) {
  const p = piezas.find(x => x.id === id);
  if (!p) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const nombre = p.nombre || [p.marca, p.sku].filter(Boolean).join(' ') || 'pieza';
  let movs = [];
  let error = '';
  try { movs = await PiezasService.getKardex(id); } catch (e) { console.warn(e); error = e?.message || String(e); }
  const fecha = (ts) => ts?.toDate ? ts.toDate().toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const filas = movs.map(m => `<tr>
      <td style="padding:6px 8px; border-bottom:1px solid var(--border); white-space:nowrap; font-size:12px; color:var(--fg-3);">${esc(fecha(m.fecha))}</td>
      <td style="padding:6px 8px; border-bottom:1px solid var(--border); text-align:right; font-weight:600; color:${Number(m.delta) > 0 ? '#067647' : '#b91c1c'}; font-variant-numeric:tabular-nums;">${Number(m.delta) > 0 ? '+' : ''}${Number(m.delta || 0)}</td>
      <td style="padding:6px 8px; border-bottom:1px solid var(--border); text-align:right; color:var(--fg-3); font-variant-numeric:tabular-nums; white-space:nowrap;">${Number(m.antes ?? 0)} → ${Number(m.despues ?? 0)}</td>
      <td style="padding:6px 8px; border-bottom:1px solid var(--border); font-size:13px;">${esc(m.motivo || '—')}
        <span class="muted" style="display:block; font-size:11px;">${esc(m.origen || '')}${m.ref?.label || m.ref?.id ? ` · ${esc(m.ref.label || m.ref.id)}` : ''}${m.por_email ? ` · ${esc(m.por_email)}` : ''}</span></td>
    </tr>`).join('');
  const ultimo = p.ultimo_ajuste?.motivo && !movs.length
    ? `<p class="muted" style="font-size:12px; margin:8px 0 0;">Último ajuste registrado antes del kardex: ${p.ultimo_ajuste.delta > 0 ? '+' : ''}${Number(p.ultimo_ajuste.delta || 0)} — ${esc(p.ultimo_ajuste.motivo)}</p>` : '';
  await Modal.sheet({
    title: 'Kardex', icon: 'history', size: 'md',
    html: `
      <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);"><b>${esc(nombre)}</b> · hay <b>${Number(p.cantidad || 0)}</b>${p.sin_control_inventario ? ' · sin control de inventario' : ''}</p>
      ${error ? `<p style="color:#b91c1c; font-size:13px;">No se pudo leer el kardex: ${esc(error)}</p>` : ''}
      ${movs.length ? `<div style="border:1px solid var(--border); border-radius:8px; max-height:360px; overflow-y:auto;">
        <table style="border-collapse:collapse; width:100%;">
          <thead><tr style="font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--fg-3);">
            <th style="text-align:left; padding:6px 8px;">Fecha</th><th style="text-align:right; padding:6px 8px;">±</th><th style="text-align:right; padding:6px 8px;">Stock</th><th style="text-align:left; padding:6px 8px;">Motivo</th></tr></thead>
          <tbody>${filas}</tbody></table></div>`
        : (error ? '' : '<p class="muted" style="font-size:13px;">Sin movimientos en el kardex todavía: cada ±N con motivo queda aquí a partir de ahora.</p>')}
      ${ultimo}`,
    buttons: [{ action: 'cerrar', label: 'Cerrar', primary: true }],
  });
}


function cerrarModal(){
  Modal.close('overlay');
  piezaEditId = null;
}
function setVal(id, val){ const el = document.getElementById(id); if (el) el.value = val; }

async function guardarPieza(){
  const marca = (document.getElementById('f-marca').value || '').trim();
  const sku = (document.getElementById('f-sku').value || '').trim();
  const nombre = (document.getElementById('f-nombre').value || '').trim();
  const descripcion = (document.getElementById('f-descripcion').value || '').trim();

  const cantidad = Number(document.getElementById('f-cantidad').value || 0);
  const minimo = Number(document.getElementById('f-minimo').value || 5);
  const unidad = (document.getElementById('f-unidad').value || 'pieza').trim();
  const ubicacion = (document.getElementById('f-ubicacion').value || '').trim();
  const activo = document.getElementById('f-activo').value === 'true';
  const sin_control = document.getElementById('f-sin-control').value === 'true';
  const notas = (document.getElementById('f-notas').value || '').trim();

  const equiposTxt = (document.getElementById('f-equipos').value || '').trim();
  const equipos_asociados = equiposTxt
    ? equiposTxt.split(',').map(x=>x.trim()).filter(Boolean)
    : [];

  if (!marca){
    Toast.show('La marca es requerida','warn');
    return;
  }

  // Sin precio_venta ni costo_unitario: los escribe solo Finanzas (Piezas y
  // Tarifas). Al crear nacen en 0 para que Finanzas los vea "⚠ sin precio".
  const payload = {
    marca, sku, nombre, descripcion,
    cantidad, minimo, unidad, ubicacion,
    equipos_asociados,
    sin_control_inventario: sin_control,
    notas, activo,
    actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    if (piezaEditId === null){
      await PiezasService.addPieza({ ...payload, precio_venta: 0, costo_unitario: 0, creado_por_uid: firebase.auth().currentUser.uid });
      Toast.show('Pieza creada','ok');
    } else {
      await PiezasService.updatePieza(piezaEditId, payload);
      Toast.show('Pieza actualizada','ok');
    }

    cerrarModal();
    await cargar();

  } catch (err) {
    console.error(err);
    Toast.show('Error al guardar la pieza','bad');
  }
}

async function ajustarStock(id, delta, motivo = '') {
  try {
    const r = await PiezasService.ajustarDelta(id, delta, { motivo, avisar: false });
    if (r?.recortado) {
      Toast.show(`Había ${r.antes}: no se pueden restar ${-delta}. Quedó en 0.`, 'warn');
    } else {
      Toast.show(delta > 0 ? `Stock: ${r?.antes ?? ''} → ${r?.despues ?? ''} (+${delta})` : `Stock: ${r?.antes ?? ''} → ${r?.despues ?? ''} (${delta})`, 'ok');
    }
    // Se actualiza la fila en memoria en vez de recargar el catálogo entero.
    const p = piezas.find(x => x.id === id);
    if (p && r) { p.cantidad = r.despues; if (motivo) p.ultimo_ajuste = { delta, motivo }; render(); renderResumen(); }
    else await cargar();
  } catch (err) {
    console.error(err);
    Toast.show('Error al ajustar stock','bad');
  }
}

// ±N con motivo por fila (auditoría UX 2026-09-28): sumar 10 eran 10 clics y
// 10 recargas, sin decir por qué. Enter en la cantidad salta al motivo; Enter
// en el motivo aplica.
async function ajustarStockN(id) {
  const p = piezas.find(x => x.id === id);
  if (!p) return;
  const nombre = p.nombre || [p.marca, p.sku].filter(Boolean).join(' ') || 'pieza';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const r = await Modal.sheet({
    title: 'Ajustar stock', icon: 'package', size: 'sm',
    html: `
      <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);"><b>${esc(nombre)}</b> · hay <b>${Number(p.cantidad || 0)}</b></p>
      <label class="form-label" for="ajN">Cantidad (+ entra, − sale)</label>
      <input id="ajN" class="form-input" type="number" step="1" placeholder="Ej. 10 o -3" inputmode="numeric">
      <label class="form-label" for="ajMotivo" style="margin-top:10px;">Motivo</label>
      <input id="ajMotivo" class="form-input" type="text" placeholder="Ej. compra factura 1234, conteo, merma…">
      <div id="ajErr" style="display:none; margin-top:8px; color:#b91c1c; font-size:13px;"></div>`,
    buttons: [
      { action: 'cancel', label: 'Cancelar' },
      { action: 'ok', label: 'Aplicar', primary: true },
    ],
    onMount(root) {
      const n = root.querySelector('#ajN'), m = root.querySelector('#ajMotivo');
      setTimeout(() => n.focus(), 50);
      n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); m.focus(); } });
      m.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-sheet-action="ok"]')?.click(); } });
    },
    onAction(action, root) {
      if (action !== 'ok') return undefined;
      const n = Math.trunc(Number(root.querySelector('#ajN').value));
      const motivo = root.querySelector('#ajMotivo').value.trim();
      const err = root.querySelector('#ajErr');
      const falla = (t) => { err.textContent = t; err.style.display = ''; return false; };
      if (!Number.isFinite(n) || n === 0) return falla('Escribe una cantidad distinta de 0 (negativa para restar).');
      if (!motivo) return falla('El motivo es obligatorio: es lo único que dice por qué cambió el stock.');
      if (Number(p.cantidad || 0) + n < 0) return falla(`Solo hay ${Number(p.cantidad || 0)}: no se pueden restar ${-n}.`);
      return { n, motivo };
    },
  });
  if (!r || typeof r !== 'object') return;
  await ajustarStock(id, r.n, r.motivo);
}

async function toggleActivo(id, estado) {
  try {
    await PiezasService.updatePieza(id, { activo: !estado });
    Toast.show(!estado ? 'Pieza activada' : 'Pieza desactivada','ok');
    await cargar();
  } catch (err) {
    console.error(err);
    Toast.show('Error al cambiar estado','bad');
  }
}


async function duplicar(id) {
  const pieza = piezas.find(x => x.id === id);
  if(!pieza) return;
  try {
    await PiezasService.addPieza({
      marca: pieza.marca || '',
      sku: pieza.sku || '',
      nombre: pieza.nombre || '',
      descripcion: pieza.descripcion || '',
      precio_venta: Number(pieza.precio_venta||0),
      costo_unitario: Number(pieza.costo_unitario||0),
      cantidad: Number(pieza.cantidad||0),
      minimo: Number(pieza.minimo||5),
      unidad: pieza.unidad || 'pieza',
      ubicacion: pieza.ubicacion || '',
      sin_control_inventario: pieza.sin_control_inventario === true,
      equipos_asociados: Array.isArray(pieza.equipos_asociados) ? pieza.equipos_asociados : [],
      notas: pieza.notas || '',
      activo: pieza.activo === true,
      creado_por_uid: firebase.auth().currentUser.uid,
    });
    Toast.show('Pieza duplicada','ok');
    await cargar();
  } catch (err) {
    console.error(err);
    Toast.show('Error al duplicar','bad');
  }
}


// --- Puente window (F1, docs/plans/PLAN_MIGRACION_MODULAR.md) ---
// Estos nombres los usan otros archivos o el HTML (onclick / inline). Hoy son
// globales porque el archivo es un <script> clásico; al empaquetarse como
// módulo ES dejarían de serlo. El puente los publica de forma explícita.
Object.assign(window, {
  abrirBatchModal, abrirModal, ajustarStock, ajustarStockN, aplicarFiltroKpi, limpiarFiltrosPiezas,
  cerrarBatchModal, cerrarModal,
  descargarPlantillaCSV, duplicar, eliminarPieza, guardarBatch, guardarPieza,
  onTogglePiezas, sortBy, toggleActivo, verKardex
});

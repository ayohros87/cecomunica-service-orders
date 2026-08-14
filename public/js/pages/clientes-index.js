// @ts-nocheck
  let listaVendedores = [];

async function cargarVendedores() {
  const snap = await UsuariosService.getVendedores();

  listaVendedores = snap.map(d => ({
    id: d.id,
    email: d.email || d.id,
    nombre: d.nombre || null,
  }));
}

(function(){
  const auth = firebase.auth();


  const PAGE_SIZE = 20;
  let lastDoc = null;
  let currentQuery = null;
  let role = ROLES.VISTA; // por defecto
  const ALLOWED_ROLES = new Set(['admin', ROLES.ADMIN, ROLES.RECEPCION]);
let currentPage = 1;
let knownTotalPages = null;
// Cursor ANTES de cada página (1-based): pageCursors[1] = null (inicio)
const pageCursors = { 1: null };

  // --------- Helpers ----------
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const debounce = (fn, delay=600)=>{
    let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); };
  };
  function tokensFrom(text){
    if(!text) return [];
    const parts = text
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .split(/[^a-z0-9]+/).filter(Boolean);
    // prefijos simples (p.ej. "insti" coincide)
    const toks = new Set();
    for(const p of parts){
      for(let i=2;i<=p.length;i++){ toks.add(p.slice(0,i)); }
    }
    return Array.from(toks).slice(0,200); // límite de seguridad
  }
  function asReadonly(){
  return !(role==="admin" || role===ROLES.ADMIN || role==="editor" || role===ROLES.RECEPCION);
}
// --- Helpers para confirmación bonita y seguridad de HTML ---
function escapeHtml(s){ return FMT.esc(s); } // helper canónico (core/formatting.js)

// Indicador de guardado por fila: saving (ámbar) → saved (verde, se desvanece) → error (rojo).
const _savedTimers = {};
function setRowStatus(id, state){
  const sel = document.querySelector(`#tbody .rowSel[data-id="${id}"]`);
  const dot = sel && sel.closest('tr') && sel.closest('tr').querySelector('.row-status');
  if(!dot) return;
  dot.classList.remove('saving','saved','error');
  if(state) dot.classList.add(state);
  if(_savedTimers[id]){ clearTimeout(_savedTimers[id]); delete _savedTimers[id]; }
  if(state === 'saved'){
    _savedTimers[id] = setTimeout(()=>{ dot.classList.remove('saved'); delete _savedTimers[id]; }, 1600);
  }
}

function confirmDialog({ title = 'Confirmar', message = '', confirmText = 'Aceptar' }){
  return new Promise(resolve=>{
    const overlay = document.getElementById('overlay');
    const $title = document.getElementById('confirmTitle');
    const $msg = document.getElementById('confirmMsg');
    const $ok = document.getElementById('btnOk');
    const $cancel = document.getElementById('btnCancel');

    function cleanup(result){
      overlay.style.display = 'none';
      $ok.onclick = $cancel.onclick = overlay.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e){ if(e.key === 'Escape') cleanup(false); }

    $title.textContent = title;
    $msg.innerHTML = message;          // message viene controlado por nosotros (escapeHtml)
    $ok.textContent = confirmText;

    overlay.style.display = 'flex';
    setTimeout(()=> $ok.focus(), 0);

    $ok.onclick = ()=> cleanup(true);
    $cancel.onclick = ()=> cleanup(false);
    overlay.onclick = (e)=> { if(e.target === overlay) cleanup(false); };
    document.addEventListener('keydown', onKey);
  });
}

  // --------- UI refs ----------
  const $q = document.getElementById('q');
  const $soloActivos = document.getElementById('soloActivos');
  const $btnBuscar = document.getElementById('btnBuscar');
  const $btnLimpiar = document.getElementById('btnLimpiar');
  const $btnMas = document.getElementById('btnMas');
  const $btnNuevo = document.getElementById('btnNuevo');
  const $tbody = document.getElementById('tbody');
  const $resumen = document.getElementById('resumen');
  const $btnTodo = document.getElementById('btnTodo');
const $selectAll = document.getElementById('selectAll');
const $bulkBar = document.getElementById('bulkBar');
const $bulkCount = document.getElementById('bulkCount');
const $bulkActivar = document.getElementById('bulkActivar');
const $bulkDesactivar = document.getElementById('bulkDesactivar');
const $bulkVendedor = document.getElementById('bulkVendedor');
const $bulkAsignarVend = document.getElementById('bulkAsignarVend');
const $bulkExento = document.getElementById('bulkExento');
const $bulkPaga = document.getElementById('bulkPaga');
const $btnPrev = document.getElementById('btnPrev');
const $btnNext = document.getElementById('btnNext');
const $pageInput = document.getElementById('pageInput');
const $pageTotal = document.getElementById('pageTotal');


const selectedIds = new Set();


  $btnNuevo.onclick = ()=> location.href = '../contratos/nuevo-cliente.html?from=clientes';
$btnBuscar.onclick = ()=> { resetPagination(); gotoPage(1); updateTotalPages();
};
$btnLimpiar.onclick = ()=>{
  // Solo limpia la búsqueda; no toca los toggles (Solo activos / Compacta).
  $q.value='';
  resetPagination(); gotoPage(1); updateTotalPages();
};
$soloActivos.onchange = ()=> {
  localStorage.setItem('clientes_solo_activos', $soloActivos.checked ? '1' : '0');
  resetPagination(); gotoPage(1); updateTotalPages();
};

// Solo activos — recuerda el último estado; por defecto ON en la primera visita.
const _savedActivos = localStorage.getItem('clientes_solo_activos');
$soloActivos.checked = _savedActivos === null ? true : (_savedActivos === '1');

// Vista compacta — esconde columnas secundarias. Persistido en localStorage.
const $vistaCompacta = document.getElementById('vistaCompacta');
const _saved = localStorage.getItem('clientes_compacta');
// Por defecto compacta para todos (oculta columnas secundarias); respeta la preferencia guardada.
const initialCompact = _saved === null ? true : (_saved === '1');
$vistaCompacta.checked = initialCompact;
document.body.classList.toggle('clientes-compact', initialCompact);
$vistaCompacta.onchange = () => {
  document.body.classList.toggle('clientes-compact', $vistaCompacta.checked);
  localStorage.setItem('clientes_compacta', $vistaCompacta.checked ? '1' : '0');
};

// Enter en el buscador:
document.getElementById('q').addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ resetPagination(); gotoPage(1); updateTotalPages();
}
});

  $btnMas.onclick = ()=> gotoPage(currentPage + 1);
  $btnPrev.onclick = ()=> gotoPage(currentPage - 1);
$btnNext.onclick = ()=> gotoPage(currentPage + 1);

$pageInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    const n = parseInt($pageInput.value, 10);
    if(Number.isFinite(n) && n >= 1){ gotoPage(n); }
  }
});


let loadingAll = false;
$btnTodo.onclick = async ()=>{
  if(loadingAll) return;
  if(!await Modal.confirm({ message: '¿Cargar todos los resultados? Puede tardar si hay muchos registros.' })) return;

  loadingAll = true;
  $btnTodo.disabled = true; $btnMas.disabled = true;
  try{
    $tbody.innerHTML = '<tr><td colspan="14" class="loader-center"><div class="loader"></div></td></tr>'; $resumen.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px; display: inline-block; vertical-align: middle; margin-right: 8px;"></div>Cargando...';
    selectedIds.clear(); $selectAll.checked = false; updateBulkBar();
    lastDoc = null;
    let total = 0, pages = 0, MAX_PAGES = 500; // ~10k si PAGE_SIZE=20

    while(true){
      const { docs, lastDoc: cur, count } = await fetchPage(lastDoc);
      if(!count) break;
      lastDoc = cur;
      for(const d of docs){ renderRow(d.id, d); total++; }
      pages++;
      if(count < PAGE_SIZE) break;
      if(pages >= MAX_PAGES){
        Toast.show('Se alcanzó el límite de seguridad. Filtra más la búsqueda.', 'warn');
        break;
      }
    }
    $resumen.textContent = `${total} resultado(s) — todo cargado`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } finally {
    loadingAll = false;
    $btnTodo.disabled = false; $btnMas.disabled = false;
  }
};

$selectAll.onchange = ()=>{
  if(asReadonly()){ $selectAll.checked = false; return; }
  const rows = $tbody.querySelectorAll('.rowSel');
  rows.forEach(chk=>{
    chk.checked = $selectAll.checked;
    const id = chk.dataset.id;
    if($selectAll.checked){ selectedIds.add(id); } else { selectedIds.delete(id); }
  });
  updateBulkBar();
};


  // Navegación tipo hoja de cálculo: Enter mueve a la celda de abajo (Shift+Enter arriba),
  // manteniendo la misma columna. Los <select> conservan su comportamiento nativo.
  $tbody.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter') return;
    if(e.target.tagName === 'SELECT') return;
    const cell = e.target.closest('td');
    const tr = e.target.closest('tr');
    if(!cell || !tr) return;
    e.preventDefault();
    const colIndex = Array.from(tr.children).indexOf(cell);
    const nextTr = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
    if(!nextTr) return;
    const targetCell = nextTr.children[colIndex];
    const inp = targetCell && targetCell.querySelector('input, select');
    if(inp){ inp.focus(); if(typeof inp.select === 'function') inp.select(); }
  });

  // --------- Auth guard ----------
  auth.onAuthStateChanged(async (user)=>{
    if(!user){ location.href = '../index.html'; return; }

    // Carga rol (ajústalo a tu fuente: custom claims o colección usuarios)
    try{
      const u = await UsuariosService.getUsuario(user.uid);
      role = u && u.rol ? u.rol : ROLES.VISTA;
    }catch(e){ role=ROLES.VISTA; }
    
// --- Guard: acceso solo para admin/administrador/recepcion ---
if (!ALLOWED_ROLES.has(role)) {
  Toast.show('Acceso denegado: no tienes permisos para ver Clientes.', 'bad');
  location.href = '../index.html';
  return;
}
await cargarVendedores();
populateBulkVendedor();
resetPagination(); gotoPage(1);
updateTotalPages();

  });

 async function fetchPage(cursorDoc){
  return ClientesService.listClientesPage({
    term: $q.value.trim().toLowerCase(),
    onlyActive: $soloActivos.checked,
    cursorDoc: cursorDoc ?? null,
    limit: PAGE_SIZE,
  });
}

function updateBulkBar(){
  const n = selectedIds.size;
  $bulkCount.textContent = n;
  $bulkBar.classList.toggle('visible', n>0 && !asReadonly());
}
$bulkActivar.onclick = async ()=>{
  if(asReadonly() || selectedIds.size===0) return;
  if(!await Modal.confirm({ message: `¿Activar ${selectedIds.size} cliente(s)?` })) return;
  await ClientesService.batchUpdate(Array.from(selectedIds), { activo: true });
  selectedIds.forEach(id=>{
    const selEl = $tbody.querySelector(`.rowSel[data-id="${id}"]`);
    if (selEl) {
      const row = selEl.closest('tr');
      if (row) {
        const chkEl = row.querySelector('input[type="checkbox"][data-field="activo"]');
        if (chkEl) chkEl.checked = true;
      }
    }
  });
  Toast.show('Clientes activados', 'ok');
};

$bulkDesactivar.onclick = async ()=>{
  if(asReadonly() || selectedIds.size===0) return;
  if(!await Modal.confirm({ message: `¿Desactivar ${selectedIds.size} cliente(s)?`, danger: true })) return;
  await ClientesService.batchUpdate(Array.from(selectedIds), { activo: false });
  selectedIds.forEach(id=>{
    const selEl = $tbody.querySelector(`.rowSel[data-id="${id}"]`);
    if (selEl) {
      const row = selEl.closest('tr');
      if (row) {
        const chkEl = row.querySelector('input[type="checkbox"][data-field="activo"]');
        if (chkEl) chkEl.checked = false;
      }
    }
  });
  Toast.show('Clientes desactivados', 'ok');
};

// Llena el select de vendedores de la bulk-bar (una sola vez, tras cargarVendedores).
function populateBulkVendedor(){
  if(!$bulkVendedor) return;
  listaVendedores.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.nombre ? `${v.nombre} (${v.email})` : v.email;
    $bulkVendedor.appendChild(opt);
  });
}

$bulkAsignarVend && ($bulkAsignarVend.onclick = async ()=>{
  if(asReadonly() || selectedIds.size===0) return;
  const vend = listaVendedores.find(v => v.id === $bulkVendedor.value);
  if(!vend){ Toast.show('Elige un vendedor', 'warn'); return; }
  if(!await Modal.confirm({ message:`¿Asignar ${selectedIds.size} cliente(s) a ${vend.nombre || vend.email}?` })) return;
  await ClientesService.batchUpdate(Array.from(selectedIds), {
    vendedor_asignado: vend.id,
    vendedor_email: vend.email,
  });
  // Reflejar en los selects visibles
  selectedIds.forEach(id=>{
    const s = $tbody.querySelector(`.vendedorSelect[data-id="${id}"]`);
    if(s) s.value = vend.id;
  });
  Toast.show('Vendedor asignado', 'ok');
});

async function bulkSetExento(exento){
  if(asReadonly() || selectedIds.size===0) return;
  if(!await Modal.confirm({ message:`¿Marcar ${selectedIds.size} cliente(s) como ${exento ? 'EXENTO de ITBMS' : 'que PAGA ITBMS'}?` })) return;
  const patch = { itbms_exento: exento };
  if(!exento) patch.itbms_motivo_exencion = '';
  await ClientesService.batchUpdate(Array.from(selectedIds), patch);
  // Reflejar en filas visibles
  selectedIds.forEach(id=>{
    const sel = $tbody.querySelector(`.rowSel[data-id="${id}"]`);
    const row = sel && sel.closest('tr');
    if(!row) return;
    const isel = row.querySelector('select[data-field="itbms_exento"]');
    if(isel) isel.value = exento ? 'true' : 'false';
    const motivo = row.querySelector('input[data-field="itbms_motivo_exencion"]');
    if(motivo){
      if(!exento){ motivo.value=''; motivo.readOnly=true; motivo.style.opacity='.4'; motivo.placeholder='—'; }
      else { motivo.readOnly=false; motivo.style.opacity=''; motivo.placeholder='Motivo / referencia'; }
    }
  });
  Toast.show(exento ? 'Marcados como exentos' : 'Marcados como paga', 'ok');
}
$bulkExento && ($bulkExento.onclick = ()=> bulkSetExento(true));
$bulkPaga   && ($bulkPaga.onclick   = ()=> bulkSetExento(false));
async function updateStats(term, onlyActive, total){
  const $t = document.getElementById('statTotal');
  const $a = document.getElementById('statActivos');
  const $i = document.getElementById('statInactivos');
  if(!$t) return;
  try{
    if(onlyActive){
      // El total ya está filtrado a activos.
      $t.textContent = total; $a.textContent = total; $i.textContent = 0;
      return;
    }
    $t.textContent = total;
    const activos = await ClientesService.countClientes({ term, onlyActive: true });
    $a.textContent = activos;
    $i.textContent = Math.max(0, total - activos);
  }catch(e){
    $a.textContent = '—'; $i.textContent = '—';
  }
}

async function updateTotalPages(){
  try{
    const term = $q.value.trim().toLowerCase();
    const onlyActive = $soloActivos.checked;
    const total = await ClientesService.countClientes({ term, onlyActive });
    knownTotalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $pageTotal.textContent = `/ ${knownTotalPages}`;
    updateStats(term, onlyActive, total);
    return knownTotalPages;
  } catch (e) {
    console.error("No se pudo calcular el total (fallback):", e);
    knownTotalPages = null;
    $pageTotal.textContent = "/ —";
    return null;
  }
}


function resetPagination(){
  currentPage = 1;
  for (const k in pageCursors) delete pageCursors[k];
  pageCursors[1] = null;
  if ($pageInput) $pageInput.value = 1;
  updateTotalPages();
}
let paging = false;
async function gotoPage(target){
  if(paging) return;
  if(target < 1) return;

  paging = true;
  $btnPrev.disabled = true; $btnNext.disabled = true;

  try{
    // Construir cursores intermedios si aún no existen
    let maxKnown = Math.max(...Object.keys(pageCursors).map(k=>parseInt(k,10)));
    if(!(target in pageCursors)){
      let cursor = pageCursors[maxKnown];
      for(let p=maxKnown; p<target; p++){
        const pg = await fetchPage(cursor);
        if(!pg.count){
          if(p === maxKnown){ $tbody.innerHTML=''; $resumen.textContent='0 resultados'; }
          Toast.show('No hay más páginas.', 'warn');
          $btnPrev.disabled = (currentPage<=1);
          $btnNext.disabled = true;
          paging = false;
          return;
        }
        cursor = pg.lastDoc;
        pageCursors[p+1] = cursor;
      }
    }

    // Traer la página solicitada
    const startCursor = pageCursors[target]; // null si target=1
    const { docs, count } = await fetchPage(startCursor);

    // Limpiar y pintar
    $tbody.innerHTML = '';
    selectedIds.clear(); $selectAll.checked=false; updateBulkBar();

    for(const d of docs){ renderRow(d.id, d); }
    if (typeof lucide !== 'undefined') lucide.createIcons();

    currentPage = target;
    $pageInput.value = currentPage;
    $resumen.textContent = `Página ${currentPage} — ${count} registro(s)`;
    $selectAll.disabled = ($tbody.children.length === 0) || asReadonly();

    // Habilitar/deshabilitar anterior/siguiente
    $btnPrev.disabled = (currentPage <= 1);
    $btnNext.disabled = (count < PAGE_SIZE); // si la página vino incompleta, no hay siguiente
    if (knownTotalPages != null) {
  $btnNext.disabled = $btnNext.disabled || (currentPage >= knownTotalPages);
}

  } finally {
    paging = false;
  }
}

async function loadPage(reset){
  if(reset){
    selectedIds.clear();
    $selectAll.checked = false;
    updateBulkBar();

    $tbody.innerHTML='';
    $resumen.textContent='Buscando…';
  }
  const { docs, lastDoc: cur, count } = await fetchPage(reset ? null : lastDoc);
  if(cur) lastDoc = cur;
  if(reset && !count){ $resumen.textContent='0 resultados'; return; }

  for(const d of docs){ renderRow(d.id, d); }
  if (typeof lucide !== 'undefined') lucide.createIcons();
  $resumen.textContent = `${document.querySelectorAll('#tbody tr').length} resultado(s)`;
  $selectAll.disabled = ($tbody.children.length === 0) || asReadonly();
}

const _guardarInline = async (id, partial)=>{
  try{
    const uid = firebase.auth().currentUser?.uid || null;
    partial.updated_by = uid;
    // updated_at lo estampa ClientesService.updateCliente (serverTimestamp).

    // Tokens de búsqueda: SIEMPRE por arrayUnion (añadir, nunca reemplazar).
    // El reemplazo total que hacía la rama de nombre borraba los tokens ya
    // guardados de representante/dirección/RUC; los tokens viejos que queden
    // de más solo sobran — el form completo los reconstruye al guardar.
    const toks = new Set();

    // nombre → normaliza (nombre_norm) y añade tokens
    if(Object.prototype.hasOwnProperty.call(partial,'nombre') && partial.nombre){
      partial.nombre_norm = ClientesService.norm(partial.nombre);
      ClientesService.tokensFrom(partial.nombre).forEach(t=>toks.add(t));
    }

    // representante → añade tokens
    if(Object.prototype.hasOwnProperty.call(partial,'representante') && partial.representante){
      ClientesService.tokensFrom(partial.representante).forEach(t=>toks.add(t));
    }

    // dirección → añade tokens (útil para buscar por calle/sector)
    if(Object.prototype.hasOwnProperty.call(partial,'direccion') && partial.direccion){
      ClientesService.tokensFrom(partial.direccion).forEach(t=>toks.add(t));
    }

    // ruc/dv → recalcular los normalizados (misma fórmula que
    // ClientesService.buildClientePayload). Sin esto, un RUC corregido inline
    // dejaba ruc_norm/rucdv_norm/dv_norm viejos y la detección de duplicados
    // y las búsquedas normalizadas mentían a partir de ese momento.
    if(Object.prototype.hasOwnProperty.call(partial,'ruc') || Object.prototype.hasOwnProperty.call(partial,'dv')){
      const fila = $tbody.querySelector(`.rowSel[data-id="${id}"]`)?.closest('tr');
      const ruc = Object.prototype.hasOwnProperty.call(partial,'ruc')
        ? partial.ruc : (fila?.querySelector('input[data-field="ruc"]')?.value || '').trim();
      const dv  = Object.prototype.hasOwnProperty.call(partial,'dv')
        ? partial.dv  : (fila?.querySelector('input[data-field="dv"]')?.value || '').trim();
      const ruc_norm = String(ruc || '').replace(/\D/g, '');
      const dv_norm  = String(dv  || '').replace(/\D/g, '');
      partial.ruc_norm   = ruc_norm;
      partial.dv_norm    = dv_norm;
      partial.rucdv_norm = ruc_norm + (dv_norm ? ('-' + dv_norm) : '');
      if (ruc_norm) toks.add(ruc_norm);
      if (partial.rucdv_norm){
        toks.add(partial.rucdv_norm);
        toks.add(partial.rucdv_norm.replace(/\D/g, ''));
      }
    }

    if (toks.size) partial.searchTokens = firebase.firestore.FieldValue.arrayUnion(...Array.from(toks));

    await ClientesService.updateCliente(id, partial);
    setRowStatus(id, 'saved');
  }catch(e){
    setRowStatus(id, 'error');
    Toast.show('No se pudo guardar: '+e.message, 'bad');
  }
};

// Guardado inline: un temporizador POR CLIENTE con merge de campos. Antes era
// un único debounce global compartido por todas las filas: editar otra celda
// en <700 ms cancelaba el guardado anterior CON SUS ARGUMENTOS — el dot
// quedaba en "saving" ámbar para siempre y el dato nunca se persistía
// (escenario probable navegando con Enter fila abajo).
const _inlinePendientes = new Map(); // id → { timer, partial }
function onInlineUpdate(id, partial){
  const prev   = _inlinePendientes.get(id);
  const merged = Object.assign(prev ? prev.partial : {}, partial);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(()=>{
    _inlinePendientes.delete(id);
    _guardarInline(id, merged);
  }, 700);
  _inlinePendientes.set(id, { timer, partial: merged });
}
function renderRow(id, c){
  const tr = document.createElement('tr');
  const ro = asReadonly();
  tr.innerHTML = `
    <td class="sticky-col sticky-sel" style="text-align:center; width:34px">
      <span class="row-status"></span>
      <input type="checkbox" class="rowSel" data-id="${id}" ${ro?'disabled':''}>
    </td>

    <td class="sticky-col sticky-nombre">
      <input type="text" class="td-input" value="${FMT.esc(c.nombre)}" ${ro?'readonly':''} data-field="nombre" />
    </td>

    <td>
      <input type="text" class="td-input td-mono" value="${FMT.esc(c.ruc)}" ${ro?'readonly':''} data-field="ruc" />
    </td>
    <td>
      <input type="text" class="td-input td-mono" value="${FMT.esc(c.dv)}" ${ro?'readonly':''} data-field="dv" />
    </td>

    <td>
      <select class="td-select" ${ro?'disabled':''} data-field="itbms_exento">
        <option value="false" ${!c.itbms_exento?'selected':''}>Paga</option>
        <option value="true" ${c.itbms_exento?'selected':''}>Exento</option>
      </select>
    </td>
    <td class="col-secondary">
      <input type="text" class="td-input" value="${FMT.esc(c.itbms_motivo_exencion)}" ${(ro||!c.itbms_exento)?'readonly':''} data-field="itbms_motivo_exencion" placeholder="${c.itbms_exento?'Motivo / referencia':'—'}" ${!c.itbms_exento?'style="opacity:.4;"':''} />
    </td>

    <td>
      <input type="text" class="td-input" value="${FMT.esc(c.representante)}" ${ro?'readonly':''} data-field="representante" />
    </td>

    <td class="col-secondary">
      <input type="text" class="td-input td-mono" value="${FMT.esc(c.representante_cedula||c.cedula_representante)}" ${ro?'readonly':''} data-field="representante_cedula" />
    </td>

    <td>
      <input type="tel" class="td-input" value="${FMT.esc(c.telefono)}" ${ro?'readonly':''} data-field="telefono" />
    </td>

    <td class="col-secondary">
      <input type="email" class="td-input" value="${FMT.esc(c.email)}" ${ro?'readonly':''} data-field="email" />
    </td>

    <td class="col-secondary">
      <input type="text" class="td-input" value="${FMT.esc(c.direccion)}" ${ro?'readonly':''} data-field="direccion" />
    </td>
    <td class="col-secondary">
      <select class="td-select vendedorSelect" data-id="${id}" ${ro?'disabled':''}>
        <option value="">-- Sin asignar --</option>
      </select>
    </td>
    <td style="text-align:center">
      <label class="input-row fit" style="justify-content:center">
        <input type="checkbox" data-field="activo" ${c.activo?'checked':''} ${ro?'disabled':''}>
      </label>
    </td>

<td class="actions" style="text-align:center">
  <div class="table-actions">
    <button class="btn sm" data-equipos title="Equipos del cliente en el pool (por contrato, con estado)"><i data-lucide="radio"></i> Equipos</button>
    <button class="btn sm" data-edit ${ro?'disabled':''}><i data-lucide="pencil"></i> Editar</button>
    <button class="btn sm danger" data-delete ${ro?'disabled':''}><i data-lucide="trash-2"></i> Eliminar</button>
  </div>
</td>
  `;
// Llenar dropdown de vendedores
const selectVend = tr.querySelector('.vendedorSelect');
if (selectVend) {
  listaVendedores.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;

    // Mostrar preferiblemente el nombre, y el email entre paréntesis
    if (v.nombre) {
      opt.textContent = `${v.nombre} (${v.email})`;
    } else {
      opt.textContent = v.email;
    }

    if (c.vendedor_asignado === v.id) opt.selected = true;
    selectVend.appendChild(opt);
  });

  selectVend.addEventListener('change', async () => {
    const newId = selectVend.value;
    const vend = listaVendedores.find(v => v.id === newId);
    setRowStatus(id, 'saving');
    try {
      await ClientesService.updateCliente(id, {
        vendedor_asignado: vend ? vend.id : null,
        vendedor_email: vend ? vend.email : null,
      });
      setRowStatus(id, 'saved');
    } catch(e){
      setRowStatus(id, 'error');
      Toast.show('No se pudo guardar: '+e.message, 'bad');
    }
  });
}


  // Selección para edición masiva
  const sel = tr.querySelector('.rowSel');
  if(sel){
    sel.addEventListener('change', ()=>{
      if(sel.checked){ selectedIds.add(id); } else { selectedIds.delete(id); }
      updateBulkBar();
    });
  }

  // Listeners inline (texto/email/tel/etc.)
  tr.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      if(asReadonly()) return;
      setRowStatus(id, 'saving');
      const field = inp.dataset.field;
      let value = inp.value.trim();

      onInlineUpdate(id, { [field]: value });
    });
  });

  // Checkbox ACTIVO
  const chk = tr.querySelector('input[type="checkbox"][data-field="activo"]');
  chk && chk.addEventListener('change', ()=>{
    if(asReadonly()){ chk.checked = !!c.activo; return; }
    setRowStatus(id, 'saving');
    onInlineUpdate(id, {activo: !!chk.checked});
  });

  // Select ITBMS exento — al cambiar, sincroniza el input de motivo
  const selItbms   = tr.querySelector('select[data-field="itbms_exento"]');
  const motivoInp  = tr.querySelector('input[data-field="itbms_motivo_exencion"]');
  if (selItbms){
    selItbms.addEventListener('change', ()=>{
      if (asReadonly()){ selItbms.value = c.itbms_exento ? 'true' : 'false'; return; }
      const exento = (selItbms.value === 'true');
      const patch = { itbms_exento: exento };
      if (!exento){
        patch.itbms_motivo_exencion = '';
        if (motivoInp){ motivoInp.value = ''; motivoInp.readOnly = true; motivoInp.style.opacity = '.4'; motivoInp.placeholder = '—'; }
      } else if (motivoInp){
        motivoInp.readOnly = false; motivoInp.style.opacity = ''; motivoInp.placeholder = 'Motivo / referencia';
      }
      setRowStatus(id, 'saving');
      onInlineUpdate(id, patch);
    });
  }

// Equipos del cliente — flota real del pool, agrupada por contrato.
tr.querySelector('[data-equipos]').onclick = ()=>{
  if(window.EquiposCliente) EquiposCliente.abrir(id, c.nombre || '');
};

// Editar (lleva al mismo formulario de nuevo-cliente, pero con id)
tr.querySelector('[data-edit]').onclick = ()=> location.href = `../contratos/nuevo-cliente.html?id=${id}&from=clientes`;


// Eliminar (soft-delete con advertencia)
tr.querySelector('[data-delete]').onclick = async ()=>{
  if(asReadonly()) return;

  const nombre = escapeHtml(c.nombre || 'sin nombre');

  // Pre-check (auditoría P1): el soft-delete era CIEGO — exactamente el
  // escenario que ya dejó contratos y poc_devices colgantes. Con contratos
  // vivos o equipos del pool encima, el borrado se bloquea; para fusionar
  // duplicados está Admin · Clientes duplicados, que sí re-apunta.
  let contratosVivos = 0, unidadesPool = 0;
  try {
    const snap = await firebase.firestore().collection('contratos')
      .where('cliente_id', '==', id).get();
    snap.forEach(d => {
      const x = d.data();
      if (!x.deleted && x.estado !== 'anulado') contratosVivos++;
    });
    if (typeof EquiposPoolService !== 'undefined' && EquiposPoolService.listarPorCliente) {
      const unidades = await EquiposPoolService.listarPorCliente(id);
      unidadesPool = (unidades || []).filter(u =>
        ['asignado_contrato', 'en_cliente', 'en_taller'].includes(u.estado)).length;
    }
  } catch (e) { console.warn('Pre-check de borrado falló (se sigue con la advertencia):', e); }

  if (contratosVivos > 0 || unidadesPool > 0) {
    await confirmDialog({
      title: 'No se puede eliminar',
      message: `<strong>${nombre}</strong> tiene <strong>${contratosVivos}</strong> contrato(s) no anulados y
                <strong>${unidadesPool}</strong> equipo(s) del pool asociados.<br>
                Eliminarlo dejaría esos registros colgantes. Si es un duplicado,
                fusiónalo desde <strong>Admin · Clientes duplicados</strong> (re-apunta contratos y equipos).`,
      confirmText: 'Entendido'
    });
    return;
  }

  const ok = await confirmDialog({
    title: 'Eliminar cliente',
    message: `¿Seguro que deseas eliminar a <strong>${nombre}</strong>?<br>
              Se marcará como <code>deleted: true</code> y ya no aparecerá en la lista.`,
    confirmText: 'Sí, eliminar'
  });
  if(!ok) return;

  try {
    await ClientesService.deleteCliente(id);
    tr.remove();
  } catch(e){
    Toast.show('Error al eliminar: ' + e.message, 'bad');
  }
};



  $tbody.appendChild(tr);
}

})();



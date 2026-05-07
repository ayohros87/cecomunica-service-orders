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
  const db = firebase.firestore();
  

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
function escapeHtml(s){
  return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
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
const $bulkAddTag = document.getElementById('bulkAddTag');
const $bulkTag = document.getElementById('bulkTag');
const $btnPrev = document.getElementById('btnPrev');
const $btnNext = document.getElementById('btnNext');
const $pageInput = document.getElementById('pageInput');
const $pageTotal = document.getElementById('pageTotal');


const selectedIds = new Set();


  $btnNuevo.onclick = ()=> location.href = '../contratos/nuevo-cliente.html?from=clientes';
$btnBuscar.onclick = ()=> { resetPagination(); gotoPage(1); updateTotalPages();
};
$btnLimpiar.onclick = ()=>{
  $q.value=''; $soloActivos.checked=false; resetPagination(); gotoPage(1);updateTotalPages();

};
$soloActivos.onchange = ()=> { resetPagination(); gotoPage(1); updateTotalPages();
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
  if(!confirm('Cargar todos los resultados? Puede tardar si hay muchos registros.')) return;

  loadingAll = true;
  $btnTodo.disabled = true; $btnMas.disabled = true;
  try{
    $tbody.innerHTML = '<tr><td colspan="13" class="loader-center"><div class="loader"></div></td></tr>'; $resumen.innerHTML = '<div class="loader" style="width: 20px; height: 20px; border-width: 2px; display: inline-block; vertical-align: middle; margin-right: 8px;"></div>Cargando...';
    selectedIds.clear(); $selectAll.checked = false; updateBulkBar();
    lastDoc = null;
    let total = 0, pages = 0, MAX_PAGES = 500; // ~10k si PAGE_SIZE=20

    while(true){
      const snap = await buildQuery(false).get();
      if(snap.empty) break;
      lastDoc = snap.docs[snap.docs.length-1];
      for(const d of snap.docs){ renderRow(d.id, d.data()); total++; }
      pages++;
      if(snap.size < PAGE_SIZE) break;
      if(pages >= MAX_PAGES){
        alert('Se alcanzó el límite de seguridad. Filtra más la búsqueda.');
        break;
      }
    }
    $resumen.textContent = `${total} resultado(s) — todo cargado`;
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
  alert('Acceso denegado: no tienes permisos para ver Clientes.');
  location.href = '../index.html'; // o a la página que prefieras
  return;
}
await cargarVendedores();
resetPagination(); gotoPage(1);
updateTotalPages();

  });

 function buildQuery(reset){
  let q = db.collection('clientes').limit(PAGE_SIZE);

  const term = $q.value.trim().toLowerCase();
  if(term){
    // si el cliente tiene searchTokens lo usará
    q = db.collection('clientes')
      .where('searchTokens','array-contains', term)
      .where('deleted','==',false)
      .limit(PAGE_SIZE);
  } else {
    q = db.collection('clientes')
      .orderBy('nombre')
      .where('deleted','==',false) // 🔹 excluir borrados
      .limit(PAGE_SIZE);
  }

  if($soloActivos.checked){
    q = q.where('activo','==',true);
  }
  if(!reset && lastDoc) q = q.startAfter(lastDoc);
  return q;
}

function updateBulkBar(){
  const n = selectedIds.size;
  $bulkCount.textContent = n;
  $bulkBar.style.display = (n>0 && !asReadonly()) ? 'block' : 'none';
}
$bulkActivar.onclick = async ()=>{
  if(asReadonly() || selectedIds.size===0) return;
  if(!confirm(`Activar ${selectedIds.size} cliente(s)?`)) return;
  await ClientesService.batchUpdate(Array.from(selectedIds), { activo: true });
  // refresco visual de las filas seleccionadas
  selectedIds.forEach(id=>{
    const selEl = $tbody.querySelector(`.rowSel[data-id="${id}"]`);
if (selEl) {
  const row = selEl.closest('tr');
  if (row) {
    const chkEl = row.querySelector('input[type="checkbox"][data-field="activo"]');
    if (chkEl) chkEl.checked = true; // o = false en desactivar
  }
}

  });
  alert('Clientes activados');
};

$bulkDesactivar.onclick = async ()=>{
  if(asReadonly() || selectedIds.size===0) return;
  if(!confirm(`Desactivar ${selectedIds.size} cliente(s)?`)) return;
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
  alert('Clientes desactivados');
};

$bulkAddTag.onclick = async ()=>{
  if(asReadonly() || selectedIds.size===0) return;
  const tag = $bulkTag.value.trim();
  if(!tag){ alert('Escribe un tag'); return; }
  const tagLower = tag.toLowerCase();
  await ClientesService.batchUpdate(Array.from(selectedIds), {
    tags: firebase.firestore.FieldValue.arrayUnion(tag),
    searchTokens: firebase.firestore.FieldValue.arrayUnion(tagLower),
  });
  alert(`Tag "${tag}" agregado`);
  $bulkTag.value = '';
};
async function updateTotalPages(){
  try{
    const term = $q.value.trim().toLowerCase();

    // Construimos un query base SIN limit, con el mismo orden que usas para paginar
    let base;
    if (term) {
      // Búsqueda: sin orderBy explícito (Firestore usa orden por __name__ implícito)
      base = db.collection('clientes')
               .where('searchTokens','array-contains', term) .where('deleted','==',false);
    } else {
      // Listado general: orden por nombre para poder usar startAfter
      base = db.collection('clientes')
               .orderBy('nombre') .where('deleted','==',false);
    }
    if ($soloActivos.checked) {
      base = base.where('activo','==', true);
    }

    // Escaneo por lotes usando startAfter(lastDoc)
    const STEP = 500;                 // tamaño del lote
    const MAX_LOOPS = 200;            // tope de seguridad (~100k docs)
    let total = 0;
    let last = null;
    let loops = 0;

    while (true) {
      let q = base.limit(STEP);
      if (last) q = q.startAfter(last);

      const snap = await q.get();
      total += snap.size;

      if (snap.empty || snap.size < STEP) break;
      last = snap.docs[snap.docs.length - 1];
      loops++;
      if (loops >= MAX_LOOPS) break;   // evita barridos enormes por accidente
    }

    knownTotalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $pageTotal.textContent = `/ ${knownTotalPages}`;
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
function buildQueryWithCursor(cursorDoc){
  let q;
  const term = $q.value.trim().toLowerCase();
  if(term){
    q = db.collection('clientes')
          .where('searchTokens','array-contains', term)
          .where('deleted','==',false)
          .limit(PAGE_SIZE);
  } else {
    q = db.collection('clientes')
          .orderBy('nombre')
          .where('deleted','==',false)
          .limit(PAGE_SIZE);
  }
  if($soloActivos.checked){
    q = q.where('activo','==',true);
  }
  if(cursorDoc){ q = q.startAfter(cursorDoc); }
  return q;
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
        const snapBuild = await buildQueryWithCursor(cursor).get();
        if(snapBuild.empty){
          // No hay más páginas
          if(p === maxKnown){
            $tbody.innerHTML=''; 
            $resumen.textContent='0 resultados';
          }
          alert('No hay más páginas.');
          // Reactiva botones según estado actual
          $btnPrev.disabled = (currentPage<=1);
          $btnNext.disabled = true;
          paging = false;
          return;
        }
        cursor = snapBuild.docs[snapBuild.docs.length-1];
        pageCursors[p+1] = cursor;
      }
    }

    // Traer la página solicitada
    const startCursor = pageCursors[target]; // null si target=1
    const snap = await buildQueryWithCursor(startCursor).get();

    // Limpiar y pintar
    $tbody.innerHTML = '';
    selectedIds.clear(); $selectAll.checked=false; updateBulkBar();

    let count = 0;
    snap.forEach(d => { renderRow(d.id, d.data()); count++; });

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
  const snap = await buildQuery(reset).get();
  if(snap.docs.length>0){ lastDoc = snap.docs[snap.docs.length-1]; }
  if(reset && snap.empty){ $resumen.textContent='0 resultados'; return; }

  for(const d of snap.docs){ renderRow(d.id, d.data()); }
  $resumen.textContent = `${document.querySelectorAll('#tbody tr').length} resultado(s)`;
  $selectAll.disabled = ($tbody.children.length === 0) || asReadonly();
}

const onInlineUpdate = debounce(async (id, partial)=>{
  try{
    partial.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    // nombre → normaliza + tokens base
    if(Object.prototype.hasOwnProperty.call(partial,'nombre') && partial.nombre){
      partial.nombreLower = partial.nombre.toLowerCase();
      partial.searchTokens = Array.from(new Set([
        ...tokensFrom(partial.nombre),
      ]));
    }

    // representante → añade tokens
    if(Object.prototype.hasOwnProperty.call(partial,'representante') && partial.representante){
      const t = tokensFrom(partial.representante);
      partial.searchTokens = firebase.firestore.FieldValue.arrayUnion(...t);
    }

    // dirección → añade tokens (útil para buscar por calle/sector)
    if(Object.prototype.hasOwnProperty.call(partial,'direccion') && partial.direccion){
      const t = tokensFrom(partial.direccion);
      partial.searchTokens = firebase.firestore.FieldValue.arrayUnion(...t);
    }

    // ruc / cedula_representante: se guardan tal cual, sin tokens (evita ruido)
    await ClientesService.updateCliente(id, partial);
  }catch(e){
    alert('No se pudo guardar: '+e.message);
  }
}, 700);
function renderRow(id, c){
  const tr = document.createElement('tr');
  const ro = asReadonly();
  tr.innerHTML = `
    <td style="text-align:center; width:34px">
      <input type="checkbox" class="rowSel" data-id="${id}" ${ro?'disabled':''}>
    </td>

    <td>
      <input type="text" class="table-input sm" value="${c.nombre||''}" ${ro?'readonly':''} data-field="nombre" />
    </td>

    <td>
      <input type="text" class="table-input sm mono" value="${c.ruc||''}" ${ro?'readonly':''} data-field="ruc" />
    </td>
    <td>
      <input type="text" class="table-input sm mono" value="${c.dv||''}" ${ro?'readonly':''} data-field="dv" />
    </td>

    <td>
      <input type="text" class="table-input sm" value="${c.representante||''}" ${ro?'readonly':''} data-field="representante" />
    </td>

    <td>
      <input type="text" class="table-input sm mono" value="${c.cedula_representante||''}" ${ro?'readonly':''} data-field="cedula_representante" />
    </td>

    <td>
      <input type="tel" class="table-input sm" value="${c.telefono||''}" ${ro?'readonly':''} data-field="telefono" />
    </td>

    <td>
      <input type="email" class="table-input sm" value="${c.email||''}" ${ro?'readonly':''} data-field="email" />
    </td>

    <td>
      <input type="text" class="table-input sm" value="${c.direccion||''}" ${ro?'readonly':''} data-field="direccion" />
    </td>
    <td>
      <select class="table-input sm vendedorSelect" data-id="${id}" ${ro?'disabled':''}>
        <option value="">-- Sin asignar --</option>
      </select>
    </td>
    <td>
      <input type="text" class="table-input sm" placeholder="tag1, tag2" value="${(c.tags||[]).join(', ')}" ${ro?'readonly':''} data-field="tags" />
    </td>
    <td style="text-align:center">
      <label class="input-row fit" style="justify-content:center">
        <input type="checkbox" data-field="activo" ${c.activo?'checked':''} ${ro?'disabled':''}>
      </label>
    </td>

<td class="actions" style="text-align:center">
  <div class="table-actions">
    <button class="btn sm" data-edit ${ro?'disabled':''}>✏️ Editar</button>
    <button class="btn sm danger" data-delete ${ro?'disabled':''}>🗑️ Eliminar</button>
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
    await ClientesService.updateCliente(id, {
      vendedor_asignado: vend ? vend.id : null,
      vendedor_email: vend ? vend.email : null,
    });
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
      const field = inp.dataset.field;
      let value = inp.value.trim();

      // Normaliza TAGS a array y actualiza tokens
      if(field === 'tags'){
        const tagsArr = value ? value.split(',').map(s=>s.trim()).filter(Boolean) : [];
        onInlineUpdate(id, {
          tags: tagsArr,
          searchTokens: firebase.firestore.FieldValue.arrayUnion(...tagsArr.map(t=>t.toLowerCase()))
        });
        return;
      }

      onInlineUpdate(id, { [field]: value });
    });
  });

  // Checkbox ACTIVO
  const chk = tr.querySelector('input[type="checkbox"][data-field="activo"]');
  chk && chk.addEventListener('change', ()=>{
    if(asReadonly()){ chk.checked = !!c.activo; return; }
    onInlineUpdate(id, {activo: !!chk.checked});
  });

// Editar (lleva al mismo formulario de nuevo-cliente, pero con id)
tr.querySelector('[data-edit]').onclick = ()=> location.href = `../contratos/nuevo-cliente.html?id=${id}&from=clientes`;


// Eliminar (soft-delete con advertencia)
tr.querySelector('[data-delete]').onclick = async ()=>{
  if(asReadonly()) return;

  const nombre = escapeHtml(c.nombre || 'sin nombre');
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
    alert('Error al eliminar: ' + e.message);
  }
};



  $tbody.appendChild(tr);
}

})();



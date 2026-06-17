// @ts-nocheck
// Modelos y Tarifas — hoja de cálculo (auto-guardado por celda). Edita tarifas
// (alquiler/frecuencia) y el mapeo a QuickBooks (item/bundle) en línea; la
// identidad (marca/modelo/tipo) se crea/edita en el modal. Solo admin/contabilidad.

/* ===== Estado ===== */
let listaModelos = [];
let modeloEditId = null;
let showInactivos = true;
let soloConfig = false;
const _savedTimers = {};
const qboItems = { alquileres: [], bundles: [], loaded: false };

/* ===== Util ===== */
function debounce(fn, t = 220){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); }; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function mapTipo(v){ return v==='P'?'Portátil':v==='B'?'Base':v==='C'?'Cámara':'—'; }
function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

/* ===== Auth ===== */
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return window.location.href = "../login.html";
  try{
    const userDoc = await UsuariosService.getUsuario(user.uid);
    const rol = userDoc ? userDoc.rol : null;
    // Catálogo + tarifas (info sensible) → solo admin y contabilidad.
    if (!userDoc || (rol !== ROLES.ADMIN && rol !== ROLES.CONTABILIDAD)) {
      document.body.innerHTML = "<h3 style='color:red; text-align:center; margin-top:100px;'>Acceso restringido</h3>";
      return;
    }

    const q = document.getElementById('q');
    if (q) q.addEventListener('input', debounce(render, 200));
    document.addEventListener('change', (e)=>{
      if (e.target.id === 'chk-inactivos'){ showInactivos = e.target.checked; render(); }
      if (e.target.id === 'chk-solo-config'){ soloConfig = e.target.checked; render(); }
    });

    await cargarModelos();
    await loadQboItems();
    render();
  }catch(e){
    console.error(e); Toast.show('Error validando usuario','bad');
  }
});

/* ===== Carga ===== */
async function cargarModelos(){
  try{ listaModelos = await ModelosService.getModelos(); }
  catch(e){ console.error(e); Toast.show('Error cargando modelos','bad'); listaModelos=[]; }
}

async function loadQboItems(){
  const hint = document.getElementById('qboHint');
  try{
    const res = await firebase.functions().httpsCallable('listQBOItems')();
    qboItems.alquileres = res.data.alquileres || [];
    qboItems.bundles    = res.data.bundles || [];
    qboItems.loaded     = true;
    if (hint) hint.textContent = `QuickBooks: ${qboItems.alquileres.length} items "Alquiler" · ${qboItems.bundles.length} bundles "Mensualidad"`;
  }catch(e){
    console.error('listQBOItems', e);
    qboItems.loaded = false;
    if (hint) hint.textContent = '⚠ No se pudo cargar la lista de QuickBooks (se conserva el ID guardado).';
  }
}

/* ===== Estado de mapeo ===== */
function mapeoBadge(m){
  const alq = Number(m.precio_alquiler) || 0;
  if(!alq && !m.qbo_item_alquiler_id && !m.qbo_bundle_id) return { cls:'map-none', label:'—' };
  if(!alq)                      return { cls:'map-warn', label:'⚠ sin tarifa' };
  if(!m.qbo_item_alquiler_id)   return { cls:'map-warn', label:'⚠ sin item' };
  if(!m.qbo_bundle_id)          return { cls:'map-warn', label:'⚠ sin bundle' };
  return { cls:'map-ok', label:'✓ mapeado' };
}

function qboOptions(list, selectedId){
  const sid = selectedId==null ? '' : String(selectedId);
  const opts = ['<option value="">— ninguno —</option>'];
  let found = false;
  (list||[]).forEach(it=>{
    const on = String(it.id)===sid; if(on) found = true;
    opts.push(`<option value="${esc(it.id)}"${on?' selected':''}>${esc(it.name)} (${esc(it.id)})</option>`);
  });
  if(sid && !found){
    const aviso = qboItems.loaded ? 'no encontrado en QBO' : 'QBO no disponible';
    opts.push(`<option value="${esc(sid)}" selected>ID ${esc(sid)} (${aviso})</option>`);
  }
  return opts.join('');
}

/* ===== Render ===== */
function render(){
  const tbody = document.getElementById('tablaModelos');
  const term = (document.getElementById('q')?.value || '').toLowerCase().trim();

  let data = (listaModelos||[]).filter(m => showInactivos ? true : (m.activo !== false));
  if (term) data = data.filter(m =>
    (m.modelo||'').toLowerCase().includes(term) || (m.marca||'').toLowerCase().includes(term));
  if (soloConfig) data = data.filter(m => mapeoBadge(m).cls === 'map-warn');

  data.sort((a,b)=> String(a.modelo||'').localeCompare(String(b.modelo||''), 'es', {numeric:true, sensitivity:'base'}));

  tbody.innerHTML = '';
  if (data.length === 0){
    tbody.innerHTML = `<tr><td colspan="9" style="padding:20px; text-align:center; color:#666;">No hay modelos para mostrar</td></tr>`;
    actualizarResumen();
    return;
  }
  data.forEach(m => tbody.appendChild(renderRow(m)));
  actualizarResumen();
  if (window.lucide) lucide.createIcons();
}

function renderRow(m){
  const id = m.id;
  const b = mapeoBadge(m);
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML = `
    <td class="sticky-col modelo-cell">
      <span class="row-status"></span>
      ${esc(m.modelo||'—')}<span class="modelo-sub">${esc(m.marca||'')}</span>
    </td>
    <td>${mapTipo(m.tipo)}</td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="precio_alquiler"
          value="${Number.isFinite(m.precio_alquiler)?m.precio_alquiler:''}" placeholder="0.00"></td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="precio_frecuencia"
          value="${Number.isFinite(m.precio_frecuencia)?m.precio_frecuencia:''}" placeholder="0.00"></td>
    <td><select class="td-select" data-field="qbo_item_alquiler_id" style="min-width:200px;">${qboOptions(qboItems.alquileres, m.qbo_item_alquiler_id)}</select></td>
    <td><select class="td-select" data-field="qbo_bundle_id" style="min-width:200px;">${qboOptions(qboItems.bundles, m.qbo_bundle_id)}</select></td>
    <td class="map-cell"><span class="map-badge ${b.cls}">${b.label}</span></td>
    <td style="text-align:center"><input type="checkbox" data-field="activo" ${m.activo!==false?'checked':''}></td>
    <td><button class="btn sm btn-ghost" title="Editar identidad" onclick="abrirModal('${id}')"><i data-lucide="pencil"></i></button></td>`;

  // Listeners inline (auto-guardado por celda)
  tr.querySelectorAll('input[type="number"]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      setRowStatus(id,'saving');
      onInlineUpdate(id, { [inp.dataset.field]: Math.max(0, Number(inp.value||0)) });
    });
  });
  tr.querySelectorAll('select[data-field]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      setRowStatus(id,'saving');
      onInlineUpdate(id, { [sel.dataset.field]: (sel.value||'').trim() });
    });
  });
  const chk = tr.querySelector('input[type="checkbox"][data-field="activo"]');
  chk && chk.addEventListener('change', ()=>{ setRowStatus(id,'saving'); onInlineUpdate(id, { activo: !!chk.checked }); });

  return tr;
}

function actualizarResumen(){
  const total = (listaModelos||[]).length;
  const conTarifa = (listaModelos||[]).filter(m => Number(m.precio_alquiler) > 0).length;
  const pend = (listaModelos||[]).filter(m => mapeoBadge(m).cls === 'map-warn').length;
  document.getElementById('resumenModelos').innerHTML =
    `<b>${total}</b> modelos · <b>${conTarifa}</b> con tarifa · <span style="color:#92400E"><b>${pend}</b> sin configurar</span>`;
}

/* ===== Guardado inline ===== */
function setRowStatus(id, state){
  const tr = document.querySelector(`#tablaModelos tr[data-id="${id}"]`);
  const dot = tr && tr.querySelector('.row-status');
  if(!dot) return;
  dot.classList.remove('saving','saved','error');
  if(state) dot.classList.add(state);
  if(_savedTimers[id]){ clearTimeout(_savedTimers[id]); delete _savedTimers[id]; }
  if(state==='saved'){ _savedTimers[id] = setTimeout(()=>{ dot.classList.remove('saved'); delete _savedTimers[id]; }, 1600); }
}

const onInlineUpdate = debounce(async (id, partial)=>{
  try{
    await ModelosService.updateModelo(id, partial);
    // Refleja en memoria y refresca el badge de esa fila.
    const m = listaModelos.find(x=>x.id===id);
    if(m){ Object.assign(m, partial);
      const tr = document.querySelector(`#tablaModelos tr[data-id="${id}"]`);
      const cell = tr && tr.querySelector('.map-cell');
      if(cell){ const b = mapeoBadge(m); cell.innerHTML = `<span class="map-badge ${b.cls}">${b.label}</span>`; }
    }
    setRowStatus(id,'saved');
    actualizarResumen();
  }catch(e){ console.error(e); setRowStatus(id,'error'); Toast.show('No se pudo guardar: '+e.message,'bad'); }
}, 600);

/* ===== Modal de identidad (crear / editar) ===== */
function abrirModal(id=null){
  modeloEditId = id;
  const creando = (id===null);
  document.getElementById('modalTitle').textContent = creando ? 'Nuevo modelo' : 'Editar modelo';
  setVal('f-marca',''); setVal('f-modelo','');
  document.getElementById('f-tipo').value='P';
  document.getElementById('f-estado').value='N';
  setVal('f-minimo','5');
  document.getElementById('f-alto').checked=false;
  document.getElementById('f-activo').checked=true;
  setVal('f-notas','');

  if(!creando){
    const m = listaModelos.find(x=>x.id===id);
    if (m){
      setVal('f-marca', m.marca||''); setVal('f-modelo', m.modelo||'');
      document.getElementById('f-tipo').value = m.tipo||'P';
      document.getElementById('f-estado').value = m.estado||'N';
      setVal('f-minimo', Number.isFinite(m.minimo)?m.minimo:5);
      document.getElementById('f-alto').checked = m.alto_movimiento===true;
      document.getElementById('f-activo').checked = m.activo!==false;
      setVal('f-notas', m.notas||'');
    }
  }
  const ov = document.getElementById('overlay');
  ov.classList.add('show'); ov.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
}
function cerrarModal(){ const ov=document.getElementById('overlay'); ov.classList.remove('show'); ov.style.display='none'; modeloEditId=null; }

async function guardarModelo(){
  const marca=(document.getElementById('f-marca').value||'').trim();
  const modelo=(document.getElementById('f-modelo').value||'').trim();
  if(!marca || !modelo){ Toast.show('Marca y Modelo son requeridos','warn'); return; }
  const payload = {
    marca, modelo,
    tipo: document.getElementById('f-tipo').value,
    estado: document.getElementById('f-estado').value,
    minimo: Math.max(0, Number(document.getElementById('f-minimo').value||0)),
    alto_movimiento: document.getElementById('f-alto').checked,
    activo: document.getElementById('f-activo').checked,
    notas: (document.getElementById('f-notas').value||'').trim(),
  };
  try{
    if (modeloEditId===null){ await ModelosService.addModelo(payload); Toast.show('Modelo creado','ok'); }
    else { await ModelosService.updateModelo(modeloEditId, payload); Toast.show('Modelo actualizado','ok'); }
    cerrarModal();
    await cargarModelos();
    render();
  }catch(e){ console.error(e); Toast.show('Error al guardar','bad'); }
}

/* ===== Exportar ===== */
function exportarExcel(){
  const wb = XLSX.utils.book_new();
  const ws = [["Marca","Modelo","Tipo","Alquiler","Frecuencia","Item QBO","Bundle QBO","Mapeo","Activo"]];
  (listaModelos||[]).forEach(m=>{
    ws.push([ m.marca||'', m.modelo||'', mapTipo(m.tipo),
      Number.isFinite(m.precio_alquiler)?m.precio_alquiler:'', Number.isFinite(m.precio_frecuencia)?m.precio_frecuencia:'',
      m.qbo_item_alquiler_id||'', m.qbo_bundle_id||'', mapeoBadge(m).label, (m.activo!==false)?'Sí':'No' ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws), "Modelos");
  XLSX.writeFile(wb, `Modelos_Tarifas_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/* ===== Exponer ===== */
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.guardarModelo = guardarModelo;
window.exportarExcel = exportarExcel;
function cerrarSesion(){ firebase.auth().signOut().then(()=>window.location.href="../login.html"); }
window.cerrarSesion = cerrarSesion;

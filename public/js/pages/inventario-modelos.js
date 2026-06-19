// @ts-nocheck
// Modelos y Tarifas — hoja de cálculo (auto-guardado por celda). Edita tarifas
// (alquiler/frecuencia) y el mapeo a QuickBooks (item/bundle) en línea; la
// identidad (marca/modelo/tipo) se crea/edita en el modal. Solo admin/contabilidad.

/* ===== Estado ===== */
let listaModelos = [];
let modeloEditId = null;
let showInactivos = false;   // por defecto ocultos para despejar la vista
let soloConfig = false;
let soloAlquiler = true;     // por defecto solo los modelos que se alquilan (vista limpia)
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
  if (soloAlquiler) data = data.filter(m => m.es_alquiler === true);
  if (term) data = data.filter(m =>
    (m.modelo||'').toLowerCase().includes(term) || (m.marca||'').toLowerCase().includes(term));
  if (soloConfig) data = data.filter(m => mapeoBadge(m).cls === 'map-warn');

  data.sort((a,b)=> String(a.modelo||'').localeCompare(String(b.modelo||''), 'es', {numeric:true, sensitivity:'base'}));

  tbody.innerHTML = '';
  if (data.length === 0){
    const hint = soloAlquiler
      ? 'No hay equipos marcados como "Se alquila". Pulsa <b>Todos</b> arriba y prende el toggle <b>¿Alquiler?</b> en los que se rentan.'
      : 'No hay modelos para mostrar';
    tbody.innerHTML = `<tr><td colspan="10" style="padding:20px; text-align:center; color:#666;">${hint}</td></tr>`;
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
    <td style="text-align:center"><label class="toggle-switch" title="¿Se alquila?"><input type="checkbox" data-field="es_alquiler" ${m.es_alquiler===true?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label></td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="precio_alquiler"
          value="${Number.isFinite(m.precio_alquiler)?m.precio_alquiler:''}" placeholder="0.00"></td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="precio_frecuencia"
          value="${Number.isFinite(m.precio_frecuencia)?m.precio_frecuencia:''}" placeholder="0.00"></td>
    <td><select class="td-select" data-field="qbo_item_alquiler_id" style="min-width:200px;">${qboOptions(qboItems.alquileres, m.qbo_item_alquiler_id)}</select></td>
    <td><select class="td-select" data-field="qbo_bundle_id" style="min-width:200px;">${qboOptions(qboItems.bundles, m.qbo_bundle_id)}</select></td>
    <td class="map-cell"><span class="map-badge ${b.cls}">${b.label}</span></td>
    <td style="text-align:center"><label class="toggle-switch" title="Activo"><input type="checkbox" data-field="activo" ${m.activo!==false?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label></td>
    <td style="text-align:center"><button class="btn sm btn-ghost" title="Editar identidad" onclick="abrirModal('${id}')"><i data-lucide="pencil"></i></button></td>`;

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
  tr.querySelectorAll('input[type="checkbox"][data-field]').forEach(chk=>{
    chk.addEventListener('change', ()=>{ setRowStatus(id,'saving'); onInlineUpdate(id, { [chk.dataset.field]: !!chk.checked }); });
  });

  return tr;
}

function actualizarResumen(){
  const total = (listaModelos||[]).length;
  const alquiler = (listaModelos||[]).filter(m => m.es_alquiler === true).length;
  const conTarifa = (listaModelos||[]).filter(m => m.es_alquiler === true && Number(m.precio_alquiler) > 0).length;
  const pend = (listaModelos||[]).filter(m => m.es_alquiler === true && mapeoBadge(m).cls === 'map-warn').length;
  document.getElementById('resumenModelos').innerHTML =
    `<b>${total}</b> modelos · <b>${alquiler}</b> de alquiler · <b>${conTarifa}</b> con tarifa · <span style="color:#92400E"><b>${pend}</b> sin configurar</span>`;
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
  document.getElementById('f-es-alquiler').checked = creando ? true : false; // en esta página, nuevo = de alquiler
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
      document.getElementById('f-es-alquiler').checked = m.es_alquiler===true;
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
    es_alquiler: document.getElementById('f-es-alquiler').checked,
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

/* ===== Importar desde QuickBooks (revisar → aprobar → ingresar) ===== */
let qboCandidatos = [];

async function importarDeQBO(){
  const ov = document.getElementById('overlayQbo');
  document.getElementById('btnImportarQbo').disabled = true;
  document.getElementById('qboBody').innerHTML = '<p style="color:var(--fg-3);">Consultando QuickBooks…</p>';
  ov.classList.add('show'); ov.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  try{
    const res = await firebase.functions().httpsCallable('listQBOEquipos')();
    qboCandidatos = (res.data && res.data.equipos) || [];
    renderQboPreview();
  }catch(e){
    console.error('listQBOEquipos', e);
    document.getElementById('qboBody').innerHTML = `<p style="color:#b91c1c;">No se pudo consultar QuickBooks: ${esc(e.message||'')}</p>`;
  }
}

function _normMod(s){ return String(s||'').trim().toLowerCase(); }

// Detecta modelos ya existentes por qbo_item_alquiler_id (preferente) o nombre.
function _existingModelosIndex(){
  const byId = new Set(), byName = new Set();
  (listaModelos||[]).forEach(m=>{
    if(m.qbo_item_alquiler_id) byId.add(String(m.qbo_item_alquiler_id));
    if(m.modelo) byName.add(_normMod(m.modelo));
  });
  return { byId, byName };
}

function renderQboPreview(){
  const { byId, byName } = _existingModelosIndex();
  const rows = qboCandidatos.map((c, idx)=>{
    const existe = byId.has(String(c.qbo_item_alquiler_id)) || byName.has(_normMod(c.modelo));
    return { ...c, idx, existe };
  });
  const nuevas = rows.filter(r=>!r.existe).length;
  const body = document.getElementById('qboBody');
  const btn = document.getElementById('btnImportarQbo');

  if(!rows.length){
    body.innerHTML = '<p style="color:var(--fg-3);">No hay items "Alquiler - …" en QuickBooks.</p>';
    btn.disabled = true; return;
  }
  btn.disabled = (nuevas === 0);
  body.innerHTML = `
    <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
      <b>${rows.length}</b> modelos en QuickBooks · <b style="color:#065F46;">${nuevas}</b> nuevos · <b>${rows.length-nuevas}</b> ya existen.
      Revisa y desmarca los que no quieras antes de aprobar. La marca y el tipo se completan después.
    </p>
    <div class="table-scroll" style="max-height:55vh; overflow:auto;">
      <table class="app-table" style="font-size:13px;">
        <thead><tr>
          <th style="width:34px;"><input type="checkbox" id="qbo-all" checked onchange="toggleAllQbo(this.checked)"></th>
          <th>Modelo</th><th style="text-align:right;">Alquiler $</th>
          <th>Item QBO "Alquiler"</th><th>Bundle "Mensualidad"</th><th>Estado</th>
        </tr></thead>
        <tbody>${rows.map(r=>`
          <tr style="${r.existe?'opacity:.55;':''}">
            <td><input type="checkbox" class="qbo-chk" data-idx="${r.idx}" ${r.existe?'disabled':'checked'}></td>
            <td style="font-weight:600;">${esc(r.modelo)}</td>
            <td style="text-align:right; font-family:var(--font-mono);">$${Number(r.precio_alquiler||0).toFixed(2)}</td>
            <td>${esc(r.qbo_item_alquiler_name||'—')}</td>
            <td>${r.qbo_bundle_id ? esc(r.qbo_bundle_name) : '<span class="map-badge map-warn">⚠ sin bundle</span>'}</td>
            <td>${r.existe?'<span class="map-badge map-none">ya existe</span>':'<span class="map-badge map-ok">nuevo</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

function toggleAllQbo(on){
  document.querySelectorAll('.qbo-chk:not(:disabled)').forEach(c=> c.checked = on);
}

async function confirmarImportQbo(){
  const seleccion = [...document.querySelectorAll('.qbo-chk:checked')]
    .map(c=> qboCandidatos[Number(c.dataset.idx)]).filter(Boolean);
  if(!seleccion.length){ Toast.show('No hay modelos seleccionados','warn'); return; }
  const rows = seleccion.map(c=>({
    marca: '',
    modelo: c.modelo,
    es_alquiler: true,
    activo: true,
    precio_alquiler: Number(c.precio_alquiler||0),
    qbo_item_alquiler_id: c.qbo_item_alquiler_id||'',
    qbo_bundle_id: c.qbo_bundle_id||'',
    origen: 'quickbooks',
  }));
  const btn = document.getElementById('btnImportarQbo'); btn.disabled = true;
  try{
    const uid = firebase.auth().currentUser?.uid || null;
    await ModelosService.importModelos(rows, uid);
    Toast.show(`${rows.length} modelo(s) importados`,'ok');
    cerrarQbo();
    await cargarModelos();
    render();
  }catch(e){ console.error(e); Toast.show('Error al importar: '+e.message,'bad'); btn.disabled = false; }
}

function cerrarQbo(){ const ov=document.getElementById('overlayQbo'); ov.classList.remove('show'); ov.style.display='none'; }

/* ===== Proponer mapeo QBO a modelos existentes (verificar → aprobar) ===== */
let mapeoPropuestas = [];

async function proponerMapeoQBO(){
  const ov = document.getElementById('overlayMapeo');
  document.getElementById('btnAplicarMapeo').disabled = true;
  document.getElementById('mapeoBody').innerHTML = '<p style="color:var(--fg-3);">Consultando QuickBooks…</p>';
  ov.classList.add('show'); ov.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  try{
    const res = await firebase.functions().httpsCallable('listQBOEquipos')();
    const cands = (res.data && res.data.equipos) || [];
    const byName = {};
    cands.forEach(c => { byName[_normMod(c.modelo)] = c; });
    // Propone para los modelos existentes que tienen equivalente y donde cambia algo.
    mapeoPropuestas = (listaModelos||[]).map(m=>{
      const c = byName[_normMod(m.modelo)];
      if(!c) return null;
      const itemProp = String(c.qbo_item_alquiler_id||''), itemActual = String(m.qbo_item_alquiler_id||'');
      const bundleProp = String(c.qbo_bundle_id||''),      bundleActual = String(m.qbo_bundle_id||'');
      const itemChange = !!itemProp && itemProp !== itemActual;
      const bundleChange = !!bundleProp && bundleProp !== bundleActual;
      if(!itemChange && !bundleChange) return null;
      return { id:m.id, modelo:m.modelo,
        item_id:itemProp, item_name:c.qbo_item_alquiler_name||'', itemChange, itemActual,
        bundle_id:bundleProp, bundle_name:c.qbo_bundle_name||'', bundleChange, bundleActual };
    }).filter(Boolean);
    renderMapeoPreview();
  }catch(e){
    console.error('proponerMapeoQBO', e);
    document.getElementById('mapeoBody').innerHTML = `<p style="color:#b91c1c;">No se pudo consultar QuickBooks: ${esc(e.message||'')}</p>`;
  }
}

function renderMapeoPreview(){
  const body = document.getElementById('mapeoBody');
  const btn = document.getElementById('btnAplicarMapeo');
  if(!mapeoPropuestas.length){
    body.innerHTML = '<p style="color:var(--fg-3);">Los modelos con equivalente en QuickBooks ya están mapeados. No hay cambios por proponer.</p>';
    btn.disabled = true; return;
  }
  btn.disabled = false;
  const tag = (change, prop, actual) => !prop ? '' : (!change ? '<span class="map-badge map-ok">= actual</span>'
    : (actual ? '<span class="map-badge map-warn">reemplaza</span>' : '<span class="map-badge map-ok">nuevo</span>'));
  body.innerHTML = `
    <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
      <b>${mapeoPropuestas.length}</b> modelo(s) con mapeo propuesto (match por nombre con QuickBooks).
      Verifica el item de <b>Alquiler</b> y el bundle de <b>Mensualidad</b>, desmarca lo que no quieras y aplica.
    </p>
    <div class="table-scroll" style="max-height:55vh; overflow:auto;">
      <table class="app-table" style="font-size:13px;">
        <thead><tr>
          <th style="width:34px;"><input type="checkbox" id="mapeo-all" checked onchange="toggleAllMapeo(this.checked)"></th>
          <th>Modelo</th>
          <th>Item "Alquiler" propuesto</th>
          <th>Bundle "Mensualidad" propuesto</th>
        </tr></thead>
        <tbody>${mapeoPropuestas.map((p,idx)=>`
          <tr>
            <td><input type="checkbox" class="mapeo-chk" data-idx="${idx}" checked></td>
            <td style="font-weight:600;">${esc(p.modelo)}</td>
            <td>${p.item_id ? esc(p.item_name) : '—'} ${tag(p.itemChange, p.item_id, p.itemActual)}</td>
            <td>${p.bundle_id ? (esc(p.bundle_name)+' '+tag(p.bundleChange, p.bundle_id, p.bundleActual)) : '<span class="map-badge map-warn">⚠ sin bundle</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

function toggleAllMapeo(on){
  document.querySelectorAll('.mapeo-chk:not(:disabled)').forEach(c=> c.checked = on);
}

async function confirmarMapeo(){
  const seleccion = [...document.querySelectorAll('.mapeo-chk:checked')]
    .map(c=> mapeoPropuestas[Number(c.dataset.idx)]).filter(Boolean);
  if(!seleccion.length){ Toast.show('No hay mapeos seleccionados','warn'); return; }
  const btn = document.getElementById('btnAplicarMapeo'); btn.disabled = true;
  try{
    for(const p of seleccion){
      const upd = {};
      if(p.item_id)   upd.qbo_item_alquiler_id = p.item_id;
      if(p.bundle_id) upd.qbo_bundle_id = p.bundle_id;
      if(Object.keys(upd).length) await ModelosService.updateModelo(p.id, upd);
    }
    Toast.show(`Mapeo aplicado a ${seleccion.length} modelo(s)`,'ok');
    cerrarMapeo();
    await cargarModelos();
    render();
  }catch(e){ console.error(e); Toast.show('Error al aplicar: '+e.message,'bad'); btn.disabled = false; }
}

function cerrarMapeo(){ const ov=document.getElementById('overlayMapeo'); ov.classList.remove('show'); ov.style.display='none'; }

/* ===== Exponer ===== */
function setFiltroAlquiler(v){
  soloAlquiler = v;
  document.getElementById('seg-alq')?.classList.toggle('is-on', v);
  document.getElementById('seg-all')?.classList.toggle('is-on', !v);
  render();
}
window.setFiltroAlquiler = setFiltroAlquiler;
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.guardarModelo = guardarModelo;
window.exportarExcel = exportarExcel;
window.importarDeQBO = importarDeQBO;
window.toggleAllQbo = toggleAllQbo;
window.confirmarImportQbo = confirmarImportQbo;
window.cerrarQbo = cerrarQbo;
window.proponerMapeoQBO = proponerMapeoQBO;
window.toggleAllMapeo = toggleAllMapeo;
window.confirmarMapeo = confirmarMapeo;
window.cerrarMapeo = cerrarMapeo;
function cerrarSesion(){ firebase.auth().signOut().then(()=>window.location.href="../login.html"); }
window.cerrarSesion = cerrarSesion;

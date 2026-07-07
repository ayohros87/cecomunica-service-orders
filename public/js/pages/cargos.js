// @ts-nocheck
// Cargos de Facturación — hoja de cálculo (auto-guardado por celda).
// Cargos no-equipo (activación, instalación, etc.): concepto + item QBO + monto
// default + único/recurrente. Solo admin/contabilidad.

let listaCargos = [];
let showInactivos = false;
const _savedTimers = {};
const qboServicios = { list: [], loaded: false };

function debounce(fn, t=220){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); }; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return window.location.href = "../login.html";
  try{
    const userDoc = await UsuariosService.getUsuario(user.uid);
    const rol = userDoc ? userDoc.rol : null;
    if (!userDoc || (rol !== ROLES.ADMIN && rol !== ROLES.CONTABILIDAD)) {
      document.body.innerHTML = "<h3 style='color:red; text-align:center; margin-top:100px;'>Acceso restringido</h3>";
      return;
    }
    const q = document.getElementById('q');
    if (q) q.addEventListener('input', debounce(render, 200));
    document.addEventListener('change', (e)=>{
      if (e.target.id === 'chk-inactivos'){ showInactivos = e.target.checked; render(); }
    });
    await cargarCargos();
    await loadQboServicios();
    render();
  }catch(e){ console.error(e); Toast.show('Error validando usuario','bad'); }
});

async function cargarCargos(){
  try{ listaCargos = await CargosService.getCargos(); }
  catch(e){ console.error(e); Toast.show('Error cargando cargos','bad'); listaCargos=[]; }
}

async function loadQboServicios(){
  const hint = document.getElementById('qboHint');
  try{
    const res = await firebase.functions().httpsCallable('listQBOItems')();
    qboServicios.list = res.data.servicios || [];
    qboServicios.loaded = true;
    if (hint) hint.textContent = `QuickBooks: ${qboServicios.list.length} servicios disponibles`;
  }catch(e){
    console.error('listQBOItems', e); qboServicios.loaded = false;
    if (hint) hint.textContent = '⚠ No se pudo cargar la lista de QuickBooks (se conserva el ID guardado).';
  }
}

function qboOptions(selectedId){
  const sid = selectedId==null ? '' : String(selectedId);
  const opts = ['<option value="">— ninguno —</option>'];
  let found = false;
  (qboServicios.list||[]).forEach(it=>{
    const on = String(it.id)===sid; if(on) found = true;
    opts.push(`<option value="${esc(it.id)}"${on?' selected':''}>${esc(it.name)} (${esc(it.id)})</option>`);
  });
  if(sid && !found){
    const aviso = qboServicios.loaded ? 'no encontrado en QBO' : 'QBO no disponible';
    opts.push(`<option value="${esc(sid)}" selected>ID ${esc(sid)} (${aviso})</option>`);
  }
  return opts.join('');
}

function render(){
  const tbody = document.getElementById('tablaCargos');
  const term = (document.getElementById('q')?.value || '').toLowerCase().trim();
  let data = (listaCargos||[]).filter(c => showInactivos ? true : (c.activo !== false));
  if (term) data = data.filter(c => (c.concepto||'').toLowerCase().includes(term));
  data.sort((a,b)=> String(a.concepto||'').localeCompare(String(b.concepto||''), 'es', {sensitivity:'base'}));

  tbody.innerHTML = '';
  if (data.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px; text-align:center; color:#666;">No hay cargos. Usa <b>+ Nuevo cargo</b> para crear uno (ej. Activación).</td></tr>`;
    actualizarResumen(); return;
  }
  data.forEach(c => tbody.appendChild(renderRow(c)));
  actualizarResumen();
  if (window.lucide) lucide.createIcons();
}

function renderRow(c){
  const id = c.id;
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML = `
    <td class="concepto-cell"><span class="row-status"></span>
      <input type="text" class="td-input" data-field="concepto" value="${esc(c.concepto||'')}" placeholder="Ej. Activación" style="min-width:180px;"></td>
    <td><select class="td-select" data-field="qbo_item_id" style="min-width:220px;">${qboOptions(c.qbo_item_id)}</select></td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="monto_default" value="${Number.isFinite(c.monto_default)?c.monto_default:''}" placeholder="0.00 (opcional)"></td>
    <td style="text-align:center"><label class="toggle-switch" title="Recurrente (mensual)"><input type="checkbox" data-field="recurrente" ${c.recurrente===true?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label></td>
    <td style="text-align:center"><label class="toggle-switch" title="Activo"><input type="checkbox" data-field="activo" ${c.activo!==false?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label></td>
    <td style="text-align:center"><button class="btn sm btn-ghost" title="Borrar" onclick="borrarCargo('${id}')"><i data-lucide="trash-2"></i></button></td>`;

  tr.querySelector('input[type="text"][data-field="concepto"]').addEventListener('input', (ev)=>{
    setRowStatus(id,'saving'); onInlineUpdate(id, { concepto: ev.target.value.trim() });
  });
  tr.querySelector('input[type="number"]').addEventListener('input', (ev)=>{
    setRowStatus(id,'saving'); onInlineUpdate(id, { monto_default: Math.max(0, Number(ev.target.value||0)) });
  });
  tr.querySelector('select[data-field="qbo_item_id"]').addEventListener('change', (ev)=>{
    setRowStatus(id,'saving'); onInlineUpdate(id, { qbo_item_id: (ev.target.value||'').trim() });
  });
  tr.querySelectorAll('input[type="checkbox"][data-field]').forEach(chk=>{
    chk.addEventListener('change', ()=>{ setRowStatus(id,'saving'); onInlineUpdate(id, { [chk.dataset.field]: !!chk.checked }); });
  });
  return tr;
}

function actualizarResumen(){
  const total = (listaCargos||[]).length;
  const activos = (listaCargos||[]).filter(c=>c.activo!==false).length;
  document.getElementById('resumen').innerHTML = `<b>${total}</b> cargos · <b>${activos}</b> activos`;
}

function setRowStatus(id, state){
  const tr = document.querySelector(`#tablaCargos tr[data-id="${id}"]`);
  const dot = tr && tr.querySelector('.row-status');
  if(!dot) return;
  dot.classList.remove('saving','saved','error');
  if(state) dot.classList.add(state);
  if(_savedTimers[id]){ clearTimeout(_savedTimers[id]); delete _savedTimers[id]; }
  if(state==='saved'){ _savedTimers[id] = setTimeout(()=>{ dot.classList.remove('saved'); delete _savedTimers[id]; }, 1600); }
}

const onInlineUpdate = debounce(async (id, partial)=>{
  try{
    await CargosService.updateCargo(id, partial);
    const c = listaCargos.find(x=>x.id===id); if(c) Object.assign(c, partial);
    setRowStatus(id,'saved'); actualizarResumen();
  }catch(e){ console.error(e); setRowStatus(id,'error'); Toast.show('No se pudo guardar: '+e.message,'bad'); }
}, 600);

async function agregarCargo(){
  try{
    await CargosService.addCargo({ concepto:'', qbo_item_id:'', monto_default:0, recurrente:false, activo:true });
    await cargarCargos(); render();
    const first = document.querySelector('#tablaCargos input[data-field="concepto"]');
    if(first){ first.focus(); }
    Toast.show('Cargo creado — completa los datos','ok');
  }catch(e){ console.error(e); Toast.show('No se pudo crear el cargo','bad'); }
}

async function borrarCargo(id){
  if(!window.confirm('¿Borrar este cargo definitivamente?')) return;
  try{ await CargosService.deleteCargo(id); await cargarCargos(); render(); Toast.show('Cargo borrado','ok'); }
  catch(e){ console.error(e); Toast.show('No se pudo borrar','bad'); }
}

window.agregarCargo = agregarCargo;
window.borrarCargo = borrarCargo;
function cerrarSesion(){ firebase.auth().signOut().then(()=>window.location.href="../login.html"); }
window.cerrarSesion = cerrarSesion;

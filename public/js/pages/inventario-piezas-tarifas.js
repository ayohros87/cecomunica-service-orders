// @ts-nocheck
// Piezas y Tarifas — hoja de cálculo (auto-guardado por celda). Vista enfocada en
// facturación: precio de venta, costo, margen y mapeo a un item de QuickBooks.
// La identidad/stock de la pieza se gestiona en inventario/piezas.html.
// Solo admin/contabilidad.

/* ===== Estado ===== */
let listaPiezas = [];
let showInactivos = false;
let soloSinPrecio = false;
const _savedTimers = {};
const qboItems = { servicios: [], loaded: false };

/* ===== Util ===== */
function debounce(fn, t = 220){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); }; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ===== Auth ===== */
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
      if (e.target.id === 'chk-sin-precio'){ soloSinPrecio = e.target.checked; render(); }
    });

    await cargarPiezas();
    await loadQboItems();
    render();
  }catch(e){
    console.error(e); Toast.show('Error validando usuario','bad');
  }
});

/* ===== Carga ===== */
async function cargarPiezas(){
  try{ listaPiezas = await PiezasService.getPiezas(); }
  catch(e){ console.error(e); Toast.show('Error cargando piezas','bad'); listaPiezas=[]; }
}

async function loadQboItems(){
  const hint = document.getElementById('qboHint');
  try{
    const res = await firebase.functions().httpsCallable('listQBOItems')();
    qboItems.servicios = res.data.servicios || [];
    qboItems.loaded    = true;
    if (hint) hint.textContent = `QuickBooks: ${qboItems.servicios.length} items de servicio/producto`;
  }catch(e){
    console.error('listQBOItems', e);
    qboItems.loaded = false;
    if (hint) hint.textContent = '⚠ No se pudo cargar la lista de QuickBooks (se conserva el ID guardado).';
  }
}

/* ===== Estado de mapeo ===== */
function mapeoBadge(p){
  const precio = num(p.precio_venta);
  if(!precio && !p.qbo_item_id) return { cls:'map-none', label:'—' };
  if(!precio)        return { cls:'map-warn', label:'⚠ sin precio' };
  if(!p.qbo_item_id) return { cls:'map-warn', label:'⚠ sin item' };
  return { cls:'map-ok', label:'✓ mapeado' };
}

function margenInfo(p){
  const precio = num(p.precio_venta), costo = num(p.costo_unitario);
  if(!precio) return { txt:'—', cls:'' };
  const m = precio - costo;
  const pct = precio>0 ? Math.round((m/precio)*100) : 0;
  return { txt:`$${m.toFixed(2)} (${pct}%)`, cls: m<0 ? 'margen-neg' : 'margen-pos' };
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
  const tbody = document.getElementById('tablaPiezas');
  const term = (document.getElementById('q')?.value || '').toLowerCase().trim();

  let data = (listaPiezas||[]).filter(p => showInactivos ? true : (p.activo !== false));
  if (soloSinPrecio) data = data.filter(p => !(num(p.precio_venta) > 0));
  if (term) data = data.filter(p =>
    (p.descripcion||'').toLowerCase().includes(term) ||
    (p.marca||'').toLowerCase().includes(term) ||
    (p.sku||'').toLowerCase().includes(term));

  data.sort((a,b)=> String(a.descripcion||a.marca||'').localeCompare(String(b.descripcion||b.marca||''), 'es', {numeric:true, sensitivity:'base'}));

  tbody.innerHTML = '';
  if (data.length === 0){
    tbody.innerHTML = `<tr><td colspan="8" style="padding:20px; text-align:center; color:#666;">No hay piezas para mostrar</td></tr>`;
    actualizarResumen();
    return;
  }
  data.forEach(p => tbody.appendChild(renderRow(p)));
  actualizarResumen();
  if (window.lucide) lucide.createIcons();
}

function renderRow(p){
  const id = p.id;
  const b = mapeoBadge(p);
  const mg = margenInfo(p);
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML = `
    <td class="sticky-col pieza-cell">
      <span class="row-status"></span>
      ${esc(p.descripcion||'(sin descripción)')}<span class="pieza-sub">${esc(p.marca||'')}${p.sku?(' · '+esc(p.sku)):''}</span>
    </td>
    <td style="font-family:var(--font-mono); font-size:12px;">${esc(p.sku||'—')}</td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="precio_venta"
          value="${Number.isFinite(p.precio_venta)?p.precio_venta:''}" placeholder="0.00"></td>
    <td><input type="number" step="0.01" min="0" class="td-input td-num" data-field="costo_unitario"
          value="${Number.isFinite(p.costo_unitario)?p.costo_unitario:''}" placeholder="0.00"></td>
    <td class="margen-cell ${mg.cls}" style="font-family:var(--font-mono); white-space:nowrap;">${mg.txt}</td>
    <td><select class="td-select" data-field="qbo_item_id" style="min-width:220px;">${qboOptions(qboItems.servicios, p.qbo_item_id)}</select></td>
    <td class="map-cell"><span class="map-badge ${b.cls}">${b.label}</span></td>
    <td style="text-align:center"><label class="toggle-switch" title="Activo"><input type="checkbox" data-field="activo" ${p.activo!==false?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label></td>`;

  tr.querySelectorAll('input[type="number"]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      setRowStatus(id,'saving');
      recomputeRow(id, inp);
      onInlineUpdate(id, { [inp.dataset.field]: Math.max(0, num(inp.value)) });
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

// Recalcula margen + badge de la fila en vivo (sin esperar el guardado).
function recomputeRow(id){
  const tr = document.querySelector(`#tablaPiezas tr[data-id="${id}"]`);
  if(!tr) return;
  const precio = num(tr.querySelector('[data-field="precio_venta"]')?.value);
  const costo  = num(tr.querySelector('[data-field="costo_unitario"]')?.value);
  const tmp = { precio_venta: precio, costo_unitario: costo, qbo_item_id: tr.querySelector('[data-field="qbo_item_id"]')?.value };
  const mc = tr.querySelector('.margen-cell');
  if(mc){ const mg = margenInfo(tmp); mc.className = `margen-cell ${mg.cls}`; mc.textContent = mg.txt; }
  const bc = tr.querySelector('.map-cell');
  if(bc){ const b = mapeoBadge(tmp); bc.innerHTML = `<span class="map-badge ${b.cls}">${b.label}</span>`; }
}

function actualizarResumen(){
  const total = (listaPiezas||[]).length;
  const conPrecio = (listaPiezas||[]).filter(p => num(p.precio_venta) > 0).length;
  const conItem = (listaPiezas||[]).filter(p => num(p.precio_venta) > 0 && p.qbo_item_id).length;
  const sinPrecio = (listaPiezas||[]).filter(p => p.activo !== false && !(num(p.precio_venta) > 0)).length;
  document.getElementById('resumenPiezas').innerHTML =
    `<b>${total}</b> piezas · <b>${conPrecio}</b> con precio · <b>${conItem}</b> mapeadas a QBO · <span style="color:#92400E"><b>${sinPrecio}</b> activas sin precio</span>`;
}

/* ===== Guardado inline ===== */
function setRowStatus(id, state){
  const tr = document.querySelector(`#tablaPiezas tr[data-id="${id}"]`);
  const dot = tr && tr.querySelector('.row-status');
  if(!dot) return;
  dot.classList.remove('saving','saved','error');
  if(state) dot.classList.add(state);
  if(_savedTimers[id]){ clearTimeout(_savedTimers[id]); delete _savedTimers[id]; }
  if(state==='saved'){ _savedTimers[id] = setTimeout(()=>{ dot.classList.remove('saved'); delete _savedTimers[id]; }, 1600); }
}

const onInlineUpdate = debounce(async (id, partial)=>{
  try{
    await PiezasService.updatePieza(id, partial);
    const p = listaPiezas.find(x=>x.id===id);
    if(p) Object.assign(p, partial);
    setRowStatus(id,'saved');
    actualizarResumen();
  }catch(e){ console.error(e); setRowStatus(id,'error'); Toast.show('No se pudo guardar: '+e.message,'bad'); }
}, 600);

/* ===== Exportar ===== */
function exportarExcel(){
  const wb = XLSX.utils.book_new();
  const ws = [["Marca","SKU","Descripción","Precio venta","Costo","Margen","Item QBO","Estado","Activo"]];
  (listaPiezas||[]).forEach(p=>{
    const mg = margenInfo(p);
    ws.push([ p.marca||'', p.sku||'', p.descripcion||'',
      Number.isFinite(p.precio_venta)?p.precio_venta:'', Number.isFinite(p.costo_unitario)?p.costo_unitario:'',
      mg.txt, p.qbo_item_id||'', mapeoBadge(p).label, (p.activo!==false)?'Sí':'No' ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws), "Piezas");
  XLSX.writeFile(wb, `Piezas_Tarifas_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/* ===== Exponer ===== */
window.exportarExcel = exportarExcel;
function cerrarSesion(){ firebase.auth().signOut().then(()=>window.location.href="../login.html"); }
window.cerrarSesion = cerrarSesion;

// @ts-nocheck
// Piezas y Tarifas — hoja de cálculo (auto-guardado por celda). Vista enfocada en
// facturación: precio de venta, costo, margen y mapeo a un item de QuickBooks.
// La identidad/stock de la pieza se gestiona en inventario/piezas.html.
// Solo admin/contabilidad.

/* ===== Estado ===== */
let listaPiezas = [];
let showInactivos = false;
let soloSinPrecio = false;
let soloPorRevisar = false;
const _savedTimers = {};
const qboItems = { productos: [], loaded: false };

/* ===== Util ===== */
function debounce(fn, t = 220){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); }; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Categorías del catálogo (Tarea 3 — navegación tipo → accesorios en el
// drawer de cotizar-orden). Campo opcional: sin backfill, los docs sin
// categoría caen en "Sin categoría" al agrupar.
// La lista vive en empresa/config.piezas_categorias (editable en
// admin/config.html); este valor es solo el fallback hasta que cargue.
let CATEGORIAS_PIEZA = EmpresaService.CONFIG_DEFAULTS.piezas_categorias.slice();
function categoriaOptions(sel){
  const cur = String(sel||'').trim();
  const opts = ['<option value="">— sin categoría —</option>'];
  CATEGORIAS_PIEZA.forEach(c => opts.push(`<option value="${esc(c)}"${c===cur?' selected':''}>${esc(c)}</option>`));
  // Valor legacy/manual que no está en la lista: consérvalo seleccionable.
  if (cur && !CATEGORIAS_PIEZA.includes(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
  return opts.join('');
}

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
      if (e.target.id === 'chk-por-revisar'){ soloPorRevisar = e.target.checked; render(); }
    });

    // Categorías administrables (empresa/config) — getConfig nunca lanza:
    // con doc ausente u offline devuelve los defaults.
    const cfg = await EmpresaService.getConfig();
    if (Array.isArray(cfg.piezas_categorias) && cfg.piezas_categorias.length) {
      CATEGORIAS_PIEZA = cfg.piezas_categorias.slice();
    }

    await cargarPiezas();
    render();                               // muestra las piezas de una vez (Firestore, rápido)
    loadQboItems().then(render).catch(()=>{}); // QBO en segundo plano; refresca los desplegables al llegar
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
    // Las piezas se vinculan a PRODUCTOS de QBO (Inventory/NonInventory), no a items
    // de servicio. Usar la lista correcta es lo que arregla el "(no encontrado)".
    const res = await firebase.functions().httpsCallable('listQBOPiezas')();
    qboItems.productos = (res.data.piezas || []).map(p => ({
      id: p.qbo_item_id,
      name: (p.descripcion && p.descripcion !== p.name) ? `${p.name} · ${p.descripcion}` : (p.name || p.descripcion || ''),
    }));
    qboItems.loaded = true;
    if (hint) hint.textContent = `QuickBooks: ${qboItems.productos.length} productos vinculables`;
  }catch(e){
    console.error('listQBOPiezas', e);
    qboItems.loaded = false;
    if (hint) hint.textContent = '⚠ No se pudo cargar la lista de QuickBooks (se conserva el vínculo guardado).';
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

// Origen del dato (G1): QBO = sincronizado desde QuickBooks; manual = creado a mano.
function origenBadge(p){
  return p.origen==='quickbooks'
    ? '<span title="Sincronizado desde QuickBooks" style="background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;border-radius:999px;padding:0 6px;font-size:10px;font-weight:700;">QBO</span>'
    : '<span title="Creado manualmente en la app" style="background:#eef2f7;color:#475569;border-radius:999px;padding:0 6px;font-size:10px;font-weight:700;">manual</span>';
}

function margenInfo(p){
  const precio = num(p.precio_venta), costo = num(p.costo_unitario);
  if(!precio) return { txt:'—', cls:'' };
  const m = precio - costo;
  const pct = precio>0 ? Math.round((m/precio)*100) : 0;
  return { txt:`$${m.toFixed(2)} (${pct}%)`, cls: m<0 ? 'margen-neg' : 'margen-pos' };
}

function qboOptions(list, selectedId, fallbackName){
  const sid = selectedId==null ? '' : String(selectedId);
  const opts = ['<option value="">— ninguno —</option>'];
  let found = false;
  (list||[]).forEach(it=>{
    const on = String(it.id)===sid; if(on) found = true;
    opts.push(`<option value="${esc(it.id)}"${on?' selected':''}>${esc(it.name)} (${esc(it.id)})</option>`);
  });
  // Si hay un vínculo guardado que no está en la lista actual: mostramos su NOMBRE
  // (si lo guardamos al importar) con un aviso accionable, no "(no encontrado)".
  if(sid && !found){
    const label = fallbackName ? esc(fallbackName) : ('ID ' + esc(sid));
    const aviso = qboItems.loaded ? 'inactivo/borrado en QBO — re-vincular' : 'QBO no disponible';
    opts.push(`<option value="${esc(sid)}" selected>${label} (${aviso})</option>`);
  }
  return opts.join('');
}

/* ===== Render ===== */
function render(){
  const tbody = document.getElementById('tablaPiezas');
  const term = (document.getElementById('q')?.value || '').toLowerCase().trim();

  let data = (listaPiezas||[]).filter(p => showInactivos ? true : (p.activo !== false));
  if (soloSinPrecio) data = data.filter(p => !(num(p.precio_venta) > 0));
  if (soloPorRevisar) data = data.filter(p => p.revision_estado === 'por_revisar');
  if (term) data = data.filter(p =>
    (p.descripcion||'').toLowerCase().includes(term) ||
    (p.marca||'').toLowerCase().includes(term) ||
    (p.sku||'').toLowerCase().includes(term));

  data.sort((a,b)=> String(a.descripcion||a.marca||'').localeCompare(String(b.descripcion||b.marca||''), 'es', {numeric:true, sensitivity:'base'}));

  tbody.innerHTML = '';
  if (data.length === 0){
    tbody.innerHTML = `<tr><td colspan="9" style="padding:20px; text-align:center; color:#666;">No hay piezas para mostrar</td></tr>`;
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
      ${esc(p.descripcion||'(sin descripción)')} ${origenBadge(p)}<span class="pieza-sub">${esc(p.marca||'')}${p.sku?(' · '+esc(p.sku)):''}</span>
      ${p.revision_estado==='por_revisar' && p.qbo_pendiente ? `
        <div style="margin-top:4px; font-size:11px; background:#FFFBEB; border:1px solid #FDE68A; border-radius:6px; padding:4px 6px; white-space:normal;">
          <b>⚠ Por revisar</b> — QBO propone: "${esc(p.qbo_pendiente.descripcion||'')}"${p.qbo_pendiente.sku?(' · SKU '+esc(p.qbo_pendiente.sku)):''}
          <div style="margin-top:3px; display:flex; gap:6px;">
            <button class="btn btn-sm btn-primary" onclick="resolverRevision('${id}','qbo')">Usar QBO</button>
            <button class="btn btn-sm btn-ghost" onclick="resolverRevision('${id}','app')">Mantener app</button>
          </div>
        </div>` : ''}
    </td>
    <td style="font-family:var(--font-mono); font-size:12px;">${esc(p.sku||'—')}</td>
    <td><select class="td-select" data-field="categoria" style="min-width:140px;">${categoriaOptions(p.categoria)}</select></td>
    <td><input type="number" step="any" min="0" class="td-input td-num" data-field="precio_venta"
          value="${Number.isFinite(p.precio_venta)?p.precio_venta:''}" placeholder="0.00"></td>
    <td><input type="number" step="any" min="0" class="td-input td-num" data-field="costo_unitario"
          value="${Number.isFinite(p.costo_unitario)?p.costo_unitario:''}" placeholder="0.00"></td>
    <td class="margen-cell ${mg.cls}" style="font-family:var(--font-mono); white-space:nowrap;">${mg.txt}</td>
    <td><select class="td-select" data-field="qbo_item_id" style="min-width:220px;">${qboOptions(qboItems.productos, p.qbo_item_id, p.qbo_item_name)}</select></td>
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
  const porRevisar = (listaPiezas||[]).filter(p => p.revision_estado === 'por_revisar').length;
  document.getElementById('resumenPiezas').innerHTML =
    `<b>${total}</b> piezas · <b>${conPrecio}</b> con precio · <b>${conItem}</b> mapeadas a QBO · <span style="color:#92400E"><b>${sinPrecio}</b> activas sin precio</span>` +
    (porRevisar ? ` · <span style="color:#92400E"><b>${porRevisar}</b> por revisar</span>` : '');
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
    const p = listaPiezas.find(x=>x.id===id) || {};
    // G4 — Auditoría del precio (anterior→nuevo, quién, cuándo). El precio vive SOLO
    // en la app; NO se sincroniza de vuelta a QuickBooks.
    if (Object.prototype.hasOwnProperty.call(partial,'precio_venta') && num(partial.precio_venta) !== num(p.precio_venta)){
      partial.precio_historial = firebase.firestore.FieldValue.arrayUnion({
        anterior: num(p.precio_venta), nuevo: num(partial.precio_venta),
        por: firebase.auth().currentUser?.uid || null, at: new Date().toISOString(),
      });
    }
    // Al (re)vincular un producto QBO desde el desplegable, guarda su nombre para que
    // el display no muestre "(no encontrado)" (G2).
    if (Object.prototype.hasOwnProperty.call(partial,'qbo_item_id')){
      const prod = (qboItems.productos||[]).find(x=>String(x.id)===String(partial.qbo_item_id));
      partial.qbo_item_name = prod ? prod.name : (partial.qbo_item_id ? (p.qbo_item_name||'') : '');
    }
    await PiezasService.updatePieza(id, partial);
    const { precio_historial, ...mem } = partial; // el sentinel arrayUnion no va a memoria
    Object.assign(p, mem);
    setRowStatus(id,'saved');
    actualizarResumen();
  }catch(e){ console.error(e); setRowStatus(id,'error'); Toast.show('No se pudo guardar: '+e.message,'bad'); }
}, 600);

/* ===== Exportar ===== */
function exportarExcel(){
  const wb = XLSX.utils.book_new();
  const ws = [["Marca","SKU","Descripción","Categoría","Precio venta","Costo","Margen","Item QBO","Estado","Activo"]];
  (listaPiezas||[]).forEach(p=>{
    const mg = margenInfo(p);
    ws.push([ p.marca||'', p.sku||'', p.descripcion||'', p.categoria||'',
      Number.isFinite(p.precio_venta)?p.precio_venta:'', Number.isFinite(p.costo_unitario)?p.costo_unitario:'',
      mg.txt, p.qbo_item_id||'', mapeoBadge(p).label, (p.activo!==false)?'Sí':'No' ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws), "Piezas");
  XLSX.writeFile(wb, `Piezas_Tarifas_${new Date().toISOString().split('T')[0]}.xlsx`);
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
    const res = await firebase.functions().httpsCallable('listQBOPiezas')();
    qboCandidatos = (res.data && res.data.piezas) || [];
    renderQboPreview();
  }catch(e){
    console.error('listQBOPiezas', e);
    document.getElementById('qboBody').innerHTML = `<p style="color:#b91c1c;">No se pudo consultar QuickBooks: ${esc(e.message||'')}</p>`;
  }
}

// Índice de piezas existentes por qbo_item_id y por SKU (para detectar conflictos).
function _existingPiezasIndex(){
  const byId = new Map(), bySku = new Map();
  (listaPiezas||[]).forEach(p=>{
    if(p.qbo_item_id) byId.set(String(p.qbo_item_id), p);
    if(p.sku) bySku.set(String(p.sku).toLowerCase(), p);
  });
  return { byId, bySku };
}
function _matchExistente(c, idx){
  return idx.byId.get(String(c.qbo_item_id)) || (c.sku ? idx.bySku.get(String(c.sku).toLowerCase()) : null) || null;
}
function _difiere(ex, c){
  return ((ex.descripcion||'') !== (c.descripcion||'')) || ((ex.sku||'') !== (c.sku||''));
}

function renderQboPreview(){
  const idx = _existingPiezasIndex();
  const rows = qboCandidatos.map((c, i)=>{
    const ex = _matchExistente(c, idx);
    const estado = !ex ? 'nueva' : (_difiere(ex, c) ? 'difiere' : 'igual');
    return { ...c, idx:i, estado };
  });
  const nuevas   = rows.filter(r=>r.estado==='nueva').length;
  const difieren = rows.filter(r=>r.estado==='difiere').length;
  const iguales  = rows.filter(r=>r.estado==='igual').length;
  const body = document.getElementById('qboBody');
  const btn = document.getElementById('btnImportarQbo');

  if(!rows.length){
    body.innerHTML = '<p style="color:var(--fg-3);">No hay productos (Inventory/NonInventory) en QuickBooks.</p>';
    btn.disabled = true; return;
  }
  btn.disabled = (nuevas + difieren === 0);
  const chip = (e)=> e==='nueva' ? '<span class="map-badge map-ok">nueva</span>'
    : e==='difiere' ? '<span class="map-badge map-warn">difiere → por revisar</span>'
    : '<span class="map-badge map-none">ya existe</span>';
  body.innerHTML = `
    <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
      <b>${rows.length}</b> productos en QuickBooks · <b style="color:#065F46;">${nuevas}</b> nuevas · <b style="color:#92400E;">${difieren}</b> difieren (se marcan "Por revisar") · <b>${iguales}</b> iguales.
      Revisa y desmarca lo que no quieras antes de aprobar.
    </p>
    <div class="table-scroll" style="max-height:55vh; overflow:auto;">
      <table class="app-table" style="font-size:13px;">
        <thead><tr>
          <th style="width:34px;"><input type="checkbox" id="qbo-all" checked onchange="toggleAllQbo(this.checked)"></th>
          <th>Descripción</th><th>SKU / código</th>
          <th style="text-align:right;">Precio</th><th style="text-align:right;">Costo</th>
          <th>Tipo</th><th>Estado</th>
        </tr></thead>
        <tbody>${rows.map(r=>`
          <tr style="${r.estado==='igual'?'opacity:.55;':''}">
            <td><input type="checkbox" class="qbo-chk" data-idx="${r.idx}" ${r.estado==='igual'?'disabled':'checked'}></td>
            <td>${esc(r.descripcion||r.name)}</td>
            <td style="font-family:var(--font-mono); font-size:12px;">${esc(r.sku||'—')}</td>
            <td style="text-align:right; font-family:var(--font-mono);">$${num(r.precio_venta).toFixed(2)}</td>
            <td style="text-align:right; font-family:var(--font-mono);">$${num(r.costo_unitario).toFixed(2)}</td>
            <td>${r.tipo==='Inventory'?'Inventario':'No-inventario'}</td>
            <td>${chip(r.estado)}</td>
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
  if(!seleccion.length){ Toast.show('No hay piezas seleccionadas','warn'); return; }
  const idx = _existingPiezasIndex();
  const nuevas = [], revisiones = [];
  for(const c of seleccion){
    const ex = _matchExistente(c, idx);
    if(!ex){
      nuevas.push({
        marca:'', sku:c.sku||'', descripcion:c.descripcion||c.name||'',
        precio_venta:num(c.precio_venta), costo_unitario:num(c.costo_unitario),
        cantidad:0, unidad:'pieza', activo:true, notas:c.notas||'',
        qbo_item_id:c.qbo_item_id||'', qbo_item_name:c.name||c.descripcion||'', origen:'quickbooks',
      });
    } else if(_difiere(ex, c)){
      // Opción (a): NO se pisa; se marca "Por revisar" con el valor propuesto por QBO.
      revisiones.push({ id: ex.id, qbo_pendiente: { descripcion:c.descripcion||'', sku:c.sku||'', qbo_item_name:c.name||'' } });
    }
  }
  const btn = document.getElementById('btnImportarQbo'); btn.disabled = true;
  try{
    const uid = firebase.auth().currentUser?.uid || null;
    if(nuevas.length) await PiezasService.importarPiezas(nuevas, uid);
    for(const r of revisiones){ await PiezasService.updatePieza(r.id, { revision_estado:'por_revisar', qbo_pendiente:r.qbo_pendiente }); }
    Toast.show(`${nuevas.length} nueva(s) · ${revisiones.length} marcada(s) "Por revisar"`, 'ok');
    cerrarQbo();
    await cargarPiezas();
    render();
  }catch(e){ console.error(e); Toast.show('Error al importar: '+e.message,'bad'); btn.disabled = false; }
}

// Resolver un conflicto "Por revisar": usar el valor de QBO o mantener el de la app.
async function resolverRevision(id, cual){
  const p = (listaPiezas||[]).find(x=>x.id===id); if(!p) return;
  const upd = {
    revision_estado: firebase.firestore.FieldValue.delete(),
    qbo_pendiente: firebase.firestore.FieldValue.delete(),
  };
  if(cual==='qbo' && p.qbo_pendiente){
    if(p.qbo_pendiente.descripcion!==undefined)   upd.descripcion   = p.qbo_pendiente.descripcion;
    if(p.qbo_pendiente.sku!==undefined)           upd.sku           = p.qbo_pendiente.sku;
    if(p.qbo_pendiente.qbo_item_name!==undefined) upd.qbo_item_name = p.qbo_pendiente.qbo_item_name;
  }
  try{
    await PiezasService.updatePieza(id, upd);
    await cargarPiezas(); render();
    Toast.show(cual==='qbo' ? 'Actualizada con el valor de QBO' : 'Se mantuvo el valor de la app', 'ok');
  }catch(e){ console.error(e); Toast.show('No se pudo resolver','bad'); }
}
window.resolverRevision = resolverRevision;

function cerrarQbo(){ const ov=document.getElementById('overlayQbo'); ov.classList.remove('show'); ov.style.display='none'; }

/* ===== Exponer ===== */
window.importarDeQBO = importarDeQBO;
window.toggleAllQbo = toggleAllQbo;
window.confirmarImportQbo = confirmarImportQbo;
window.cerrarQbo = cerrarQbo;
window.exportarExcel = exportarExcel;
function cerrarSesion(){ firebase.auth().signOut().then(()=>window.location.href="../login.html"); }
window.cerrarSesion = cerrarSesion;

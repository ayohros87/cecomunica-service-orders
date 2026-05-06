  const inventarioById = new Map();
const equiposById = new Map();

function norm(x=''){
  return String(x).toLowerCase().trim()
    .replace(/\s+/g,'_')
    .replace(/[^a-z0-9_]/g,'');
}
function modeloNorm(modelo='', marca=''){
  // Combina marca+modelo si tienes ambos; si no, usa solo modelo
  const m = norm(modelo);
  const b = norm(marca);
  return b ? `${b}_${m}` : m;
}

const params = new URLSearchParams(location.search);
const ordenId = params.get('id');

let ordenData = null;
let equipos = [];
let inventario = [];
let equipoSeleccionado = null; // eqId activo para modal
let piezaSeleccionada = null;
let rolUsuario = null;
let usuarioActual = { uid:null, email:null, nombre:null };
let itbmsPct = 0.07;

// Mapa de desuscripciones onSnapshot por equipo
const unsubByEquipo = new Map();

// ===== Util =====
const byId = (x)=>document.getElementById(x);
const fmtMoney = (n)=> '$'+Number(n||0).toFixed(2);
const showToast = (txt='💾 Guardado')=>{
  const t = byId('toast'); t.textContent = txt; t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 1000);
};


// ===== Auth & carga inicial =====
firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user){ location.href='login.html'; return; }
  usuarioActual.uid = user.uid;
  usuarioActual.email = user.email || '';

  try{
    const u = await UsuariosService.getUsuario(user.uid);
    rolUsuario = u ? (u.rol || null) : null;
    usuarioActual.nombre = (u && u.nombre) ? u.nombre : (usuarioActual.email || 'Usuario');
  }catch{}
  byId('chipUsuario').textContent = `Operando como: ${usuarioActual.nombre}`;

  // Parámetros
  try{
    const p = await EmpresaService.getDoc('parametros');
    if(p && typeof p.itbms==='number') itbmsPct = p.itbms;
  }catch{}

  // Orden
  ordenData = await OrdenesService.getOrder(ordenId);
  if(!ordenData){ alert('Orden no encontrada'); return; }

  // bloquear si cotización emitida
  const bloqueada = ordenData.cotizacion_emitida === true;
  if(bloqueada){ document.body.classList.add('solo-lectura'); }

  // Cabecera
  let cliente = ordenData.cliente_nombre || ordenData.cliente || '—';
  if(ordenData.cliente_id){
    try{
      const c = await ClientesService.getCliente(ordenData.cliente_id);
      if(c) cliente = c.nombre || cliente;
    }catch{}
  }
  const fecha = ordenData.fecha_creacion?.toDate ? ordenData.fecha_creacion.toDate().toISOString().slice(0,10) : '—';
  byId('infoOrden').innerHTML =
    `Orden <strong>${ordenId}</strong> · Cliente <strong>${cliente}</strong> · `+
    `Servicio <strong>${ordenData.tipo_de_servicio || '—'}</strong> · `+
    `Creada <strong>${fecha}</strong> · Estado <strong>${(ordenData.estado_reparacion||'').toUpperCase()}</strong>`;

  // Chips de trabajo (SIN/EN PROGRESO/COMPLETADO)
  pintarChipTrabajo((ordenData.trabajo_estado) || (ordenData.cotizacion_emitida ? 'COMPLETADO' : 'SIN_INICIAR'));

  // Botones según estado inicial
  setTimeout(()=>{
    const b1 = byId('btnCompletarCot');
    const b2 = byId('btnDesbloquearCot');
    if(ordenData?.cotizacion_emitida){
      if(b1){ b1.disabled = true; b1.textContent = '✅ Cotización completada'; }
      if(b2){ b2.style.display = 'inline-block'; }
    }else{
      if(b1){ b1.disabled = false; b1.textContent = '✅ Completar cotización'; }
      if(b2){ b2.style.display = 'none'; }
    }
  },0);

  // Equipos (no eliminados)
  equipos = Array.isArray(ordenData.equipos) ? ordenData.equipos.filter(e=>!e.eliminado) : [];

  // Inventario con cache 1h
  await cargarInventarioConCache();

  // Render inicial (y listeners en vivo por equipo)
  await renderEquiposYConsumos();
  await renderResumen();

  // Listeners live para recálculo general de resumen
  // (si hay muchos equipos, con onSnapshot por equipo ya recalcula)
});

async function cargarInventarioConCache(){
  try{
    const cache = localStorage.getItem('inv_cache');
    const t = Number(localStorage.getItem('inv_cache_time')||0);
    if(cache && Date.now()-t < 3600000){
      inventario = JSON.parse(cache);
      return;
    }
  }catch{}
  inventario = (await PiezasService.getPiezas()).filter(p => p.activo);
  // Índices
inventarioById.clear();
inventario.forEach(p => inventarioById.set(p.id, p));
equiposById.clear();
equipos.forEach(e => { const eid = e.id || e.numero_de_serie || 'X'; equiposById.set(eid, e); });

  try{
    localStorage.setItem('inv_cache', JSON.stringify(inventario));
    localStorage.setItem('inv_cache_time', String(Date.now()));
  }catch{}
}

function pintarChipTrabajo(estado){
  const chip = byId('chipTrabajo');
  let label = 'SIN INICIAR', cls = 'estado-sin';
  if(estado==='EN_PROGRESO'){ label='EN PROGRESO'; cls='estado-prog'; }
  if(estado==='COMPLETADO'){ label='COMPLETADO'; cls='estado-ok'; }
  chip.className = `chip estado-chip ${cls}`;
  chip.textContent = label;
}

async function setTrabajoEstado(nuevo){
  try{
    await OrdenesService.mergeOrder(ordenId, { trabajo_estado:nuevo });
    pintarChipTrabajo(nuevo);
  }catch(e){ console.warn('setTrabajoEstado',e); }
}
async function ensureEnProgreso(){
  try{
    const s = await OrdenesService.getOrder(ordenId);
    const cur = s ? s.trabajo_estado : null;
    if(cur !== 'COMPLETADO'){ await OrdenesService.mergeOrder(ordenId, { trabajo_estado:'EN_PROGRESO' }); pintarChipTrabajo('EN_PROGRESO'); }
  }catch(e){ console.warn('ensureEnProgreso', e); }
}


// =================== Render de equipos + onSnapshot por equipo ===================
async function renderEquiposYConsumos(){
  const wrap = byId('equiposWrap');
  wrap.innerHTML = '';

  // Limpia listeners antiguos
  for(const [eid,unsub] of unsubByEquipo.entries()){ try{ unsub(); }catch{} }
  unsubByEquipo.clear();

  await Promise.all(equipos.map(async (e, i)=>{
    const eid = e.id || e.numero_de_serie || 'X';
    const card = document.createElement('div');
    card.className = 'fila-equipo';
    card.innerHTML = `
      <div class="hdr">
      <div class="titulo">
        <div><strong>#${i+1}</strong> · <strong>Serie:</strong> ${e.numero_de_serie || '-'}</div>
        <div class="muted"><small>Modelo: ${e.modelo || '-'}</small></div>
      </div>
        <div class="acciones">
          <button class="toggle" title="Mostrar/Ocultar" onclick="toggleBody('${eid}')">▾</button>
          <select class="sel-filtro-tipo" data-eid="${eid}" style="font-size:12px">
            <option value="todos">Todos</option>
            <option value="cobro">Cobro</option>
            <option value="garantia">Garantía</option>
            <option value="interno">Interno</option>
          </select>
          <button class="btn" data-role="agregar-pieza" onclick="abrirModal('${eid}')">🧩 Pieza</button>
          <button class="btn ok" onclick="abrirModalServicio('${eid}')">🔧 Servicio</button>
        </div>
      </div>

      <div id="body_${eid}" class="body">
        <div>
        <div class="rec-label">Recomendadas para el modelo</div>
        <div class="recs-wrap" id="recs_asoc_${eid}"></div>
        <div class="rec-label" style="margin-top:4px;">Más usadas (inteligencia)</div>
        <div class="recs-wrap" id="recs_top_${eid}"></div>
      </div>
        <div class="consumos" id="consumos_${eid}">
          <div class="muted">Cargando consumos...</div>
        </div>

<div class="mt-8 notas-box">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    <div class="col-int">
      <label><strong>Notas internas</strong></label>
      <textarea rows="3" class="inp-nota" data-scope="internas" data-eid="${eid}" placeholder="Comentarios para uso interno"></textarea>
    </div>
    <div class="col-cli">
      <label><strong>Notas para el cliente</strong></label>
      <textarea rows="3" class="inp-nota" data-scope="cliente" data-eid="${eid}" placeholder="Texto que aparecerá en la cotización"></textarea>
    </div>
  </div>
</div>


        <div class="mt-8">
          <label><strong>Adjuntos</strong></label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="file" accept="image/*" data-eid="${eid}" class="inp-archivo">
            <button class="btn" onclick="listarAdjuntos('${eid}')">🔄 Refrescar</button>
          </div>
          <div id="adj_${eid}" class="muted" style="margin-top:6px">Sin archivos.</div>
        </div>
      </div>
    `;
    wrap.appendChild(card);
    renderRecsParaEquipo(eid);


    // Cargar notas existentes
    try{
      const meta = await db.collection('ordenes_de_servicio').doc(ordenId)
        .collection('equipos_meta').doc(eid).get();
      if(meta.exists){
        const m = meta.data();
        const selInt = document.querySelector(`.inp-nota[data-scope="internas"][data-eid="${eid}"]`);
        const selCli = document.querySelector(`.inp-nota[data-scope="cliente"][data-eid="${eid}"]`);
        if(selInt) selInt.value = m.notas_internas || '';
        if(selCli) selCli.value = m.notas_cliente || '';
      }
    }catch{}

    // Listener live de consumos (equipo)
    const unsub = db.collection('ordenes_de_servicio').doc(ordenId)
      .collection('consumos')
      .where('equipoId','==',eid)
      .orderBy('added_at','desc')
      .onSnapshot(async (snap)=>{
        const items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        await pintarTablaConsumos(eid, items);
        await renderResumen();
      });
    unsubByEquipo.set(eid, unsub);
  }));
}
async function renderRecsParaEquipo(eid){
  const eq = equiposById.get(eid) || {};
  const modelo = eq.modelo || '';
  const marca = eq.marca || eq.fabricante || ''; // por si lo tuvieras
  const mnorm = modeloNorm(modelo, marca);

  // 1) Asociadas por equipos_asociados/marca/modelo
  const asociadas = inventario.filter(p => {
    const lst = Array.isArray(p.equipos_asociados) ? p.equipos_asociados.map(x=>norm(x)) : [];
    const hitModelo = lst.includes(norm(modelo));
    const hitMarca  = lst.includes(norm(marca)) || lst.includes(norm(p.marca||'')); // flexible
    return (p.activo !== false) && (hitModelo || hitMarca);
  }).slice(0, 8);

  pintarChips(`recs_asoc_${eid}`, asociadas, eid);

  // 2) Inteligencia: top más usadas por modelo (analytics_piezas_modelo)
  let topDocs = [];
  try{
    const q = await db.collection('analytics_piezas_modelo')
      .where('modelo_norm','==', mnorm)
      .orderBy('usos_cobro','desc')
      .limit(8)
      .get();
    topDocs = q.docs.map(d=>d.data());
  }catch(e){ /* si no existe índice aún, ignoramos */ }

  const topPiezas = topDocs
    .map(x => inventarioById.get(x.pieza_id))
    .filter(Boolean);

  pintarChips(`recs_top_${eid}`, topPiezas, eid);
}
async function incrementarUsoAnalytics(eid, piezaId){
  try{
    const eq = equiposById.get(eid) || {};
    const mnorm = modeloNorm(eq.modelo || '', eq.marca || eq.fabricante || '');
    if(!mnorm || !piezaId) return;

    const docId = `${mnorm}::${piezaId}`;
    const ref = db.collection('analytics_piezas_modelo').doc(docId);
    await db.runTransaction(async t=>{
      const s = await t.get(ref);
      if(!s.exists){
        t.set(ref, {
          modelo_norm: mnorm,
          pieza_id: piezaId,
          usos_cobro: 1,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      }else{
        t.update(ref, {
          usos_cobro: (Number(s.data().usos_cobro||0) + 1),
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    });
  }catch(e){ /* opcional: console.warn(e); */ }
}

function pintarChips(containerId, lista, eid){
  const el = document.getElementById(containerId);
  if(!el){ return; }
  if(!lista || lista.length===0){
    el.innerHTML = '<span class="muted">—</span>';
    return;
  }
  el.innerHTML = lista.map(p=>{
    const sinStock = Number(p.cantidad||0) <= 0;
    const price = typeof p.precio_venta === 'number' ? p.precio_venta : 0;
  const sinControl = p.sin_control_inventario === true;
  const disabled = (!sinControl && sinStock) ? 'disabled' : '';
  return `
    <button class="rec-chip" ${disabled}
      title="${p.descripcion||p.nombre||''}\nStock: ${p.cantidad||0}"
      onclick="chipAddPieza('${eid}','${p.id}')">
      <span>${p.descripcion || p.nombre || (p.marca+' '+p.modelo) || 'Pieza'}</span>
      <span class="mono">${p.sku||''}</span>
      <span class="price">${fmtMoney(price)}</span>
    </button>
  `;

  }).join('');
}
async function chipAddPieza(eid, piezaId){
  try{
    if (ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); return; }

    const piezaRef = db.collection('inventario_piezas').doc(piezaId);
    const p = await PiezasService.getPieza(piezaId);
    if(!p) return;

    const qty = 1;
    const tipo = 'cobro';
    const precio = Number(p.precio_venta||0);
    const subtotal = precio; // qty=1
    const sinControl = p.sin_control_inventario === true;

    // 1) Agregar línea de consumo
    await OrdenesService.addConsumo(ordenId, {
      equipoId: eid,
      pieza_id: piezaId,
      pieza_nombre: p.descripcion || p.nombre || ((p.marca||'')+' '+(p.modelo||'')),
      sku: p.sku || '',
      qty, precio_unit: precio, tipo, subtotal,
      added_by_uid: usuarioActual.uid,
      added_by_email: usuarioActual.email,
      added_at: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2) Descontar stock si controla inventario
    if(!sinControl){
      await db.runTransaction(async t=>{
        const s = await t.get(piezaRef);
        if(!s.exists) return;
        const cur = Number(s.data().cantidad || 0);
        const nueva = Math.max(cur - qty, 0);
        t.update(piezaRef, { cantidad: nueva, actualizado_en: firebase.firestore.FieldValue.serverTimestamp() });
      });
    }

    await ensureEnProgreso();
    await incrementarUsoAnalytics(eid, piezaId);
    showToast('Pieza agregada');
  }catch(e){
    console.error(e);
    showToast('No se pudo agregar','bad');
  }
}
window.toggleBody = (eid)=>{
  const body = byId('body_'+eid);
  body.style.display = (body.style.display==='none'?'block':'none');
};

// Construye tabla de consumos (se respeta filtro)
async function pintarTablaConsumos(eid, items){
  const zona = byId('consumos_'+eid);
  if(!zona) return;

  if(items.length===0){
    zona.innerHTML = '<em>No hay piezas registradas.</em>'; return;
  }
  const filtroSel = document.querySelector(`.sel-filtro-tipo[data-eid="${eid}"]`);
  const filtro = filtroSel ? filtroSel.value : 'todos';
  const data = (filtro==='todos') ? items : items.filter(x => x.tipo===filtro);

  let html = `<table>
    <thead>
      <tr>
        <th>Pieza/Servicio</th><th>SKU</th><th>Tipo</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th>Acciones</th>
      </tr>
    </thead><tbody>`;

  let totalEquipo = 0;
  const puedeEditarPrecio = ['administrador','recepcion','inventario'].includes(rolUsuario);

  data.forEach(it=>{
    const sub = Number(it.subtotal||0);
    if(it.tipo==='cobro') totalEquipo += sub;

    const tipoSel = `
      <select data-id="${it.id}" class="sel-tipo" style="font-size:12px" data-prev="${it.tipo}">
        <option value="cobro" ${it.tipo==='cobro'?'selected':''}>cobro</option>
        <option value="garantia" ${it.tipo==='garantia'?'selected':''}>garantía</option>
        <option value="interno" ${it.tipo==='interno'?'selected':''}>interno</option>
      </select>`;

    const qtyInp = `
      <input type="number" min="1" step="1" value="${it.qty}" data-prev="${it.qty}"
        data-id="${it.id}" class="inp-qty" style="width:72px">`;

    html += `
      <tr>
        <td>${it.pieza_nombre}</td>
        <td>${it.sku||'-'}</td>
        <td>${tipoSel}</td>
        <td>${qtyInp}</td>
        <td>${fmtMoney(it.precio_unit)}</td>
        <td>${fmtMoney(sub)}</td>
        <td>
          ${puedeEditarPrecio ? `<button class="btn" data-action="editar-precio" onclick="editarPrecio('${it.id}')">✏️ Precio</button>` : ''}
          <button class="btn danger" data-action="eliminar-linea" title="Eliminar" onclick="eliminarLinea('${it.id}','${eid}')">🗑️</button>
        </td>
      </tr>`;
  });

  html += `</tbody></table>
  <div class="total-mini">Subtotal cobrado (equipo): ${fmtMoney(totalEquipo)}</div>`;

  zona.innerHTML = html;
}


// =================== Adjuntos ===================
document.addEventListener('change', async (e)=>{
  if(!e.target.classList.contains('inp-archivo')) return;
  if (ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); e.target.value=''; return; }
  const file = e.target.files?.[0]; if(!file) return;
  const equipoId = e.target.getAttribute('data-eid');

  const path = `ordenes/${ordenId}/${equipoId}/${Date.now()}_${file.name}`;
  const ref = firebase.storage().ref().child(path);
  await ref.put(file);
  await listarAdjuntos(equipoId);
  e.target.value='';
  alert('✅ Archivo subido');
});

async function listarAdjuntos(equipoId){
  const listRef = firebase.storage().ref().child(`ordenes/${ordenId}/${equipoId}`);
  try{
    const res = await listRef.listAll();
    if(res.items.length===0){
      byId('adj_'+equipoId).innerHTML = 'Sin archivos.'; return;
    }
    // máximo 6 visibles
    const first = res.items.slice(0,6);
    const urls = await Promise.all(first.map(i=>i.getDownloadURL()));
    const extras = res.items.length>6 ? `<span class="muted"> +${res.items.length-6} más</span>` : '';
    byId('adj_'+equipoId).innerHTML = urls.map(u=>`<a href="${u}" target="_blank">📎</a>`).join(' · ') + extras;
  }catch(e){
    byId('adj_'+equipoId).innerHTML = 'Sin archivos.';
  }
}


// =================== Filtros y edición rápida en tabla ===================
document.addEventListener('change', async (e) => {
  if (e.target.classList.contains('sel-filtro-tipo')) {
    const equipoId = e.target.getAttribute('data-eid');
    // onSnapshot repaintará cuando llegue, pero forzamos re-pintar con cache local:
    // (No guardamos cache local por simplicidad; el onSnapshot actualizará pronto.)
  }
});

document.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('sel-tipo')) return;
  if (ordenData?.cotizacion_emitida === true) {
    e.target.value = e.target.getAttribute('data-prev') || 'cobro'; return;
  }

  const id = e.target.getAttribute('data-id');
  const nuevoTipo = e.target.value;
  const d = await OrdenesService.getConsumo(ordenId, id);
  if (!d) return;

  const qty = Math.max(1, Number(d.qty || 1));
  const precio = Number(d.precio_unit || 0);
  const nuevoSub = (nuevoTipo === 'cobro') ? (qty * precio) : 0;

  await OrdenesService.updateConsumo(ordenId, id, { tipo:nuevoTipo, subtotal:nuevoSub, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
  e.target.setAttribute('data-prev', nuevoTipo);

  await ensureEnProgreso();
});

document.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('inp-qty')) return;
  if (ordenData?.cotizacion_emitida === true) {
    const prev = e.target.getAttribute('data-prev'); if (prev) e.target.value = prev; return;
  }

  const id = e.target.getAttribute('data-id');
  let nuevaQty = parseInt(e.target.value, 10);
  if (!isFinite(nuevaQty) || nuevaQty < 1) nuevaQty = 1;
  e.target.value = String(nuevaQty);
  e.target.setAttribute('data-prev', String(nuevaQty));

  const d = await OrdenesService.getConsumo(ordenId, id);
  if (!d) return;

  const precio = Number(d.precio_unit || 0);
  const nuevoSub = (d.tipo === 'cobro') ? (nuevaQty * precio) : 0;

  await OrdenesService.updateConsumo(ordenId, id, { qty:nuevaQty, subtotal:nuevoSub, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
  await ensureEnProgreso();
});

async function editarPrecio(lineaId){
  if (ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); return; }
  const d = await OrdenesService.getConsumo(ordenId, lineaId);
  if(!d) return;
  const nuevo = Number(prompt('Nuevo precio unitario (USD)', d.precio_unit));
  if(!isFinite(nuevo) || nuevo<0) return;
  const sub = (d.tipo==='cobro') ? (nuevo * Number(d.qty||0)) : 0;
  await OrdenesService.updateConsumo(ordenId, lineaId, {
    precio_unit: nuevo,
    subtotal: sub,
    precio_unit_override: true,
    override_by_uid: usuarioActual.uid,
    override_at: firebase.firestore.FieldValue.serverTimestamp()
  });
  await ensureEnProgreso();
}

async function eliminarLinea(lineaId, equipoId){
  if(!confirm('¿Eliminar esta línea?')) return;
  await OrdenesService.deleteConsumo(ordenId, lineaId);
}


// =================== Modales: PIEZA ===================
function abrirModal(eqId){
  equipoSeleccionado = eqId;
  piezaSeleccionada = null;
  byId('buscarPieza').value = '';
  byId('sugerencias').innerHTML = '';
  byId('qty').value = 1;
  byId('tipo').value = 'cobro';
  byId('modalPieza').style.display='flex';
  // ayuda subtotal
  actualizarSubtotalPieza();
}
function cerrarModal(){ byId('modalPieza').style.display='none'; }

// ====== Modal: selección de pieza (búsqueda multi-campo) ======
function pick(id){
  piezaSeleccionada = inventario.find(p=>p.id===id);
  const sug = byId('sugerencias');
  const nombreMostrado = piezaSeleccionada?.descripcion || piezaSeleccionada?.nombre || ((piezaSeleccionada?.marca||'')+' '+(piezaSeleccionada?.modelo||''));
  const precio = fmtMoney(Number(piezaSeleccionada?.precio_venta||0));
  sug.innerHTML = `<div class="muted">Seleccionado: <strong>${nombreMostrado||'Pieza'}</strong> (${piezaSeleccionada?.sku||'-'}) – ${precio}</div>`;
  actualizarSubtotalPieza();
}

// Normaliza equipos_asociados a string
function equiposAsociadosStr(p){
  if(Array.isArray(p?.equipos_asociados)) return p.equipos_asociados.join(' ').toLowerCase();
  return String(p?.equipos_asociados||'').toLowerCase();
}

// Scoring: SKU exacto >>> descripción >>> marca >>> equipos
function scorePieza(p, q){
  if(!q) return -Infinity;
  const sku = String(p?.sku||'').toLowerCase();
  const desc = String(p?.descripcion||p?.nombre||'').toLowerCase();
  const marca = String(p?.marca||'').toLowerCase();
  const equipos = equiposAsociadosStr(p);

  if(sku === q) return 1000;                 // match exacto de SKU
  let s = 0;
  if(sku.includes(q)) s += 80;
  if(desc.includes(q)) s += 60;
  if(marca.includes(q)) s += 40;
  if(equipos.includes(q)) s += 20;
  return s;
}

function filtrarPiezas(v){
  const q = (v||'').trim().toLowerCase();
  const sug = byId('sugerencias');
  if(!q){ sug.innerHTML=''; return; }

  // Busca en marca, sku, descripcion y equipos_asociados con score
  const list = (inventario||[]).map(p => ({ p, s: scorePieza(p, q) }))
    .filter(x => x.s > 0)
    .sort((a,b)=> b.s - a.s)
    .slice(0, 8)
    .map(x => x.p);

  sug.innerHTML = list.map(p=>{
    const nombreMostrado = p.descripcion || p.nombre || ((p.marca||'')+' '+(p.modelo||''));
    const price = fmtMoney(Number(p.precio_venta||0));
    const stock = Number(p.cantidad||0);
    const sinControl = p.sin_control_inventario === true;
    const disabled = (!sinControl && stock<=0) ? 'disabled' : '';
    return `<button class="chip" ${disabled} title="${nombreMostrado||''}\nStock: ${stock}" onclick='pick("${p.id}")'>
      ${nombreMostrado||'Pieza'} · <span class="mono">${p.sku||'-'}</span> · ${price}
    </button>`;
  }).join('');
}

// listeners
let tDeb = null;
byId('buscarPieza').addEventListener('input', (e)=>{
  clearTimeout(tDeb);
  tDeb = setTimeout(()=> filtrarPiezas(e.target.value), 120);
});
byId('buscarPieza').addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const sug = document.querySelector('#sugerencias .chip');
    if(sug){ sug.click(); e.preventDefault(); }
  }
});

// ====== Catálogo de Piezas (opcional: refrescar desde Firestore) ======
let catState = {
  abierto: false,
  orden: 'marca',
  filtroMarca: '',
  query: '',            // <— NUEVO: texto de búsqueda local
  pageSize: 50,
  lastDoc: null,
  usandoFirestore: false,
  buffer: []
};


function uniq(arr){ return Array.from(new Set(arr)); }
function getMarcasFrom(list){
  return uniq(list.map(p=>String(p.marca||'').trim()).filter(Boolean)).sort((a,b)=>a.localeCompare(b));
}
function catalogoMatch(p, q){
  if(!q) return true;
  const s = q.toLowerCase().trim();
  const sku   = String(p?.sku||'').toLowerCase();
  const desc  = String(p?.descripcion||p?.nombre||'').toLowerCase();
  const marca = String(p?.marca||'').toLowerCase();
  const equipos = Array.isArray(p?.equipos_asociados)
    ? p.equipos_asociados.join(' ').toLowerCase()
    : String(p?.equipos_asociados||'').toLowerCase();

  return sku.includes(s) || desc.includes(s) || marca.includes(s) || equipos.includes(s);
}

function abrirCatalogo(){
  const wrap = byId('catalogoWrap');
  const selMarca = byId('catFiltroMarca');
  const selOrden = byId('catOrden');
  const btnRefrescar = byId('btnCatRefrescar');

  catState.abierto = !catState.abierto;
  if(!catState.abierto){
    wrap.style.display = 'none';
    selMarca.style.display = 'none';
    selOrden.style.display = 'none';
    btnRefrescar.style.display = 'none';
    return;
  }

  // Inicial: trabajar con cache local 'inventario'
  catState.usandoFirestore = false;
  catState.lastDoc = null;
  catState.buffer = [];

// Habilitar controles
selOrden.style.display = 'inline-block';
selMarca.style.display = 'inline-block';
btnRefrescar.style.display = 'inline-block';
byId('catBuscar').style.display = 'inline-block';
byId('catContador').style.display = 'inline-block';


  // Llenar marcas únicas desde cache
  const marcas = getMarcasFrom(inventario||[]);
  selMarca.innerHTML = `<option value="">— Todas las marcas —</option>` + marcas.map(m=>`<option value="${m}">${m}</option>`).join('');

  wrap.style.display = 'block';
  renderCatalogo(true); // primera carga
}

function aplicarOrden(list, key){
  const k = key || 'marca';
  return [...list].sort((a,b)=>{
    if(k==='precio_venta') return Number(a.precio_venta||0)-Number(b.precio_venta||0);
    const av = String(a[k]||''); const bv = String(b[k]||'');
    return av.localeCompare(bv);
  });
}

function fuenteDatosLocal(){
  // Toma todo el inventario local activo
  const src = (inventario||[]).filter(p => p?.activo !== false);

  // Filtro por marca
  const marca = catState.filtroMarca || '';
  let base = marca ? src.filter(p => String(p.marca||'') === marca) : src;

  // Filtro por query local
  const q = (catState.query||'').trim();
  if(q){
    base = base.filter(p => catalogoMatch(p, q));
  }

  // Orden
  base = aplicarOrden(base, catState.orden || 'marca');
  return base;
}


function renderCatalogo(reset=false){
  const cont = byId('catTabla');
  if(reset){ catState.buffer = []; }

  // Determinar fuente y totales
  let fuente = [];
  let total = 0;
  if(catState.usandoFirestore){
    // Cuando se usa Firestore, el buffer contiene lo cargado hasta ahora
    fuente = catState.buffer;
    total = fuente.length; // no conocemos total real en servidor
  }else{
    // Local (cache)
    fuente = fuenteDatosLocal();
    catState.buffer = fuente; // mostramos todos los coincidentes
    total = fuente.length;
  }

  const rows = (fuente||[]).map(p=>{
    const nombre = p.descripcion || p.nombre || ((p.marca||'')+' '+(p.modelo||''));
    const price = fmtMoney(Number(p.precio_venta||0));
    const stock = Number(p.cantidad||0);
    const sinControl = p.sin_control_inventario === true;
    const disabled = (!sinControl && stock<=0) ? 'disabled' : '';

    return `<tr>
      <td>${nombre||'Pieza'}</td>
      <td class="mono">${p.sku||''}</td>
      <td>${p.marca||''}</td>
      <td class="right">${price}</td>
      <td class="right">${stock}</td>
      <td class="right"><button class="btn sm" ${disabled} onclick="pick('${p.id}')">Agregar</button></td>
    </tr>`;
  }).join('');

  cont.innerHTML = `
    <table>
      <thead><tr>
        <th>Descripción</th><th>SKU</th><th>Marca</th><th>Precio</th><th>Stock</th><th>Acción</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><em>Sin resultados</em></td></tr>'}</tbody>
    </table>
  `;

  // Contador
  const lbl = byId('catContador');
  if(catState.usandoFirestore){
    lbl.textContent = `Cargadas: ${total}${catState.filtroMarca ? ` | Marca: ${catState.filtroMarca}` : ''}${catState.query ? ` | Filtro: "${catState.query}"` : ''}`;
  }else{
    lbl.textContent = `Resultados: ${total}${catState.filtroMarca ? ` | Marca: ${catState.filtroMarca}` : ''}${catState.query ? ` | Filtro: "${catState.query}"` : ''}`;
  }
}

// ==== Eventos de la UI del catálogo ====
byId('btnVerCatalogo').addEventListener('click', abrirCatalogo);
byId('catOrden').addEventListener('change', (e)=>{
  catState.orden = e.target.value || 'marca';
  if(!catState.usandoFirestore) renderCatalogo(true);
});
byId('catFiltroMarca').addEventListener('change', (e)=>{
  catState.filtroMarca = e.target.value || '';
  if(!catState.usandoFirestore) renderCatalogo(true);
});

// ==== Firestore opcional (Refrescar + paginar) ====
byId('btnCatRefrescar').addEventListener('click', async ()=>{
  // Al refrescar, leer en vivo desde Firestore con paginación
  catState.usandoFirestore = true;
  catState.lastDoc = null;
  catState.buffer = [];
  await cargarMasCatalogo(true);
});

byId('btnCatMas').addEventListener('click', async ()=>{
  if(!catState.usandoFirestore){
    // En local no hay "más", así que no hace nada
    return;
  }
  await cargarMasCatalogo(false);
});

// Buscador local con debounce
let tCatSearch = null;
byId('catBuscar').addEventListener('input', (e)=>{
  clearTimeout(tCatSearch);
  tCatSearch = setTimeout(()=>{
    catState.query = e.target.value || '';
    if(!catState.usandoFirestore) renderCatalogo(true);
    // En modo Firestore, el filtro local también aplica sobre lo cargado
    else renderCatalogo(false);
  }, 150);
});

async function cargarMasCatalogo(reset){
  const col = db.collection('inventario_piezas');
  let q = col.where('activo','!=',false).orderBy('activo').orderBy('marca').orderBy('sku').limit(catState.pageSize);
  if(catState.filtroMarca) q = col.where('activo','!=',false).where('marca','==',catState.filtroMarca).orderBy('sku').limit(catState.pageSize);
  if(catState.lastDoc) q = q.startAfter(catState.lastDoc);

  const snap = await q.get();
  const arr = [];
  snap.forEach(d=>{
    const p = { id:d.id, ...d.data() };
    arr.push(p);
    // refrescar map auxiliar si existe
    if(typeof inventarioById?.set === 'function') inventarioById.set(p.id, p);
  });
  catState.lastDoc = snap.docs.length ? snap.docs[snap.docs.length-1] : catState.lastDoc;
  if(reset) catState.buffer = arr;
  else catState.buffer = catState.buffer.concat(arr);
  renderCatalogo(false);
}
function actualizarSubtotalPieza(){
  const qty = Math.max(1, parseInt(byId('qty').value||'1',10));
  const tipo = byId('tipo').value || 'cobro';
  const precio = Number(piezaSeleccionada?.precio_venta||0);
  const sub = (tipo==='cobro') ? (qty * precio) : 0;
  let info = `Cantidad: ${qty}`;
  if(piezaSeleccionada) info += ` · Precio: ${fmtMoney(precio)} · Subtotal: <strong>${fmtMoney(sub)}</strong>`;
  let ayuda = byId('ayudaPieza');
  if(!ayuda){
    ayuda = document.createElement('div'); ayuda.id='ayudaPieza'; ayuda.className='ayuda';
    byId('modalPieza').querySelector('.modal').appendChild(ayuda);
  }
  ayuda.innerHTML = info;
}

async function confirmarAgregar(){
  try{
    if(!piezaSeleccionada){
      toast('Selecciona una pieza','warn'); 
      return;
    }
    const ordenIdOk = ordenId || null;
    if(!ordenIdOk){ toast('Orden no encontrada','bad'); return; }

    // Lee datos del modal (IDs correctos)
    const qty = Math.max(1, parseInt(byId('qty').value || '1', 10));
    const tipo = byId('tipo').value || 'cobro';
    const precio = Number(piezaSeleccionada?.precio_venta || 0);
    const subtotal = +( (tipo==='cobro' ? qty * precio : 0) ).toFixed(2);

    // Confirma bandera "sin control" en Firestore
    const piezaRef = db.collection('inventario_piezas').doc(piezaSeleccionada.id);
    const piezaDB = await PiezasService.getPieza(piezaSeleccionada.id);
    if(!piezaDB){ toast('La pieza ya no existe','bad'); return; }
    const sinControl = piezaDB.sin_control_inventario === true;

    // Inserta consumo
    await OrdenesService.addConsumo(ordenIdOk, {
      equipoId: (typeof equipoSeleccionado!=='undefined' ? equipoSeleccionado : null),
      pieza_id: piezaSeleccionada.id,
      pieza_nombre: piezaSeleccionada.descripcion
                    || piezaSeleccionada.nombre
                    || ((piezaSeleccionada.marca||'')+' '+(piezaSeleccionada.modelo||'')),
      sku: piezaSeleccionada.sku || '',
      qty,
      precio_unit: precio,
      tipo,
      subtotal,
      added_by_uid: (firebase.auth().currentUser||{}).uid || null,
      added_by_email: (firebase.auth().currentUser||{}).email || null,
      added_at: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Descontar stock SOLO si controla inventario
    if(!sinControl){
      await db.runTransaction(async t=>{
        const s = await t.get(piezaRef);
        if(!s.exists) return;
        const cur = Number(s.data().cantidad || 0);
        const nueva = Math.max(cur - qty, 0);
        t.update(piezaRef, { cantidad: nueva, actualizado_en: firebase.firestore.FieldValue.serverTimestamp() });
      });
    }

    toast('Pieza agregada', 'ok');
    // refresco UI
    const sug = byId('sugerencias'); if(sug) sug.innerHTML = '';
    byId('buscarPieza')?.value && (byId('buscarPieza').value = '');
    cerrarModal(); // <-- función existente para cerrar el modal

  }catch(err){
    console.error(err);
    toast('Error al agregar pieza','bad');
  }
}
// =================== Modales: SERVICIO ===================
function abrirModalServicio(eqId){
  if (ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); return; }
  equipoSeleccionado = eqId;
  byId('serv_desc').value = '';
  byId('serv_qty').value = 1;
  byId('serv_precio').value = '';
  byId('serv_tipo').value = 'cobro';
  byId('modalServicio').style.display='flex';
  actualizarSubtotalServicio();
}
function cerrarModalServicio(){ byId('modalServicio').style.display='none'; }
byId('serv_qty').addEventListener('input', actualizarSubtotalServicio);
byId('serv_precio').addEventListener('input', actualizarSubtotalServicio);
byId('serv_tipo').addEventListener('change', actualizarSubtotalServicio);

function actualizarSubtotalServicio(){
  const qty  = Math.max(1, parseInt(byId('serv_qty').value||'1',10));
  const precio = Number(byId('serv_precio').value||0);
  const tipo = byId('serv_tipo').value || 'cobro';
  const sub = (tipo==='cobro') ? (qty * precio) : 0;

  let ayuda = byId('ayudaServicio');
  if(!ayuda){
    ayuda = document.createElement('div'); ayuda.id='ayudaServicio'; ayuda.className='ayuda';
    byId('modalServicio').querySelector('.modal').appendChild(ayuda);
  }
  ayuda.innerHTML = `Cantidad: ${qty} · Precio: ${fmtMoney(precio)} · Subtotal: <strong>${fmtMoney(sub)}</strong>`;
}

async function confirmarServicio(){
  if(!equipoSeleccionado){ alert('Equipo no válido'); return; }
  const desc = byId('serv_desc').value.trim();
  const qty  = Math.max(1, parseInt(byId('serv_qty').value||'1',10));
  const precio = Number(byId('serv_precio').value||0);
  const tipo = byId('serv_tipo').value || 'cobro';
  if(!desc || precio<0){ alert('Descripción y precio son requeridos'); return; }

  const subtotal = (tipo==='cobro') ? (qty * precio) : 0;
  await OrdenesService.addConsumo(ordenId, {
    equipoId: equipoSeleccionado,
    pieza_id: null,
    pieza_nombre: desc,
    sku: 'SERV',
    qty, precio_unit: precio, tipo, subtotal,
    added_by_uid: usuarioActual.uid,
    added_by_email: usuarioActual.email,
    added_at: firebase.firestore.FieldValue.serverTimestamp()
  });

  await ensureEnProgreso();
  cerrarModalServicio();
  alert('✅ Servicio agregado');
}


// =================== Resumen general ===================
async function renderResumen(){
  const consItems = await OrdenesService.getConsumos(ordenId, { tipo: 'cobro' });

  let subtotal = 0;
  consItems.forEach(line=>{
    subtotal += Number(line.subtotal || (line.qty||0)*(line.precio_unit||0));
  });
  const itbms = +(subtotal*itbmsPct).toFixed(2);
  const total = +(subtotal+itbms).toFixed(2);
  byId('resumenTxt').innerHTML =
    `Subtotal: <strong>${fmtMoney(subtotal)}</strong> · `+
    `ITBMS ${(itbmsPct*100).toFixed(0)}%: <strong>${fmtMoney(itbms)}</strong> · `+
    `Total: <strong>${fmtMoney(total)}</strong>`;
}


// =================== Notas autosave + Toast ===================
const notaTimers = {};
document.addEventListener('input', (e)=>{
  if(!e.target.classList.contains('inp-nota')) return;
  const equipoId = e.target.getAttribute('data-eid');
  const scope = e.target.getAttribute('data-scope'); // 'internas'|'cliente'
  const val = e.target.value;
  clearTimeout(notaTimers[equipoId+'_'+scope]);
  notaTimers[equipoId+'_'+scope] = setTimeout(async ()=>{
    await db.collection('ordenes_de_servicio').doc(ordenId)
      .collection('equipos_meta').doc(equipoId).set(
        scope==='internas' ? { notas_internas: val } : { notas_cliente: val },
        { merge:true }
      );
    showToast();
  }, 400);
});

document.addEventListener('change', async (e)=>{
  if(!e.target.classList.contains('sel-filtro-tipo')) return;
  // onSnapshot repintará automáticamente
});

document.addEventListener('keydown',(e)=>{
  if(byId('modalPieza').style.display==='flex'){
    if(e.key==='Escape') cerrarModal();
    if(e.key==='Enter') confirmarAgregar();
  }
});


// =================== Completar / Desbloquear cotización ===================
async function completarCotizacion(){
  try{
    if(ordenData?.cotizacion_emitida === true){
      alert('La cotización ya estaba completada.'); return;
    }
    if(!confirm('¿Deseas marcar la cotización como COMPLETADA? Esto bloqueará la edición.')) return;

    await OrdenesService.mergeOrder(ordenId, {
  cotizacion_emitida: true,
  cotizacion_emitida_en: firebase.firestore.FieldValue.serverTimestamp(),
  trabajo_estado: 'COMPLETADO',
  // ⛔️ QUITAR serverTimestamp dentro de arrayUnion
  // ✅ Usar timestamp de cliente para el log
  os_logs: firebase.firestore.FieldValue.arrayUnion({
    action: 'COTIZACION_COMPLETADA',
    by: usuarioActual.email || usuarioActual.uid,
    at_ms: Date.now()  // <- reemplaza "at: serverTimestamp()" por un milisegundo de cliente
  }),
  // (opcional pero recomendado) registrar una marca de tiempo de servidor a nivel de documento
  updated_at: firebase.firestore.FieldValue.serverTimestamp()
});

    // notifica por correo (si hubiera vendedor asignado)
    try{
      const d = (await OrdenesService.getOrder(ordenId)) || {};
      const vendedorUid = d.vendedor_asignado || '';
      let vendedorEmail = '';
      if(vendedorUid){
        const uDoc = await UsuariosService.getUsuario(vendedorUid);
        vendedorEmail = uDoc ? (uDoc.email || '') : '';
      }
      const toList = ['atencionalcliente@cecomunica.com'].concat(vendedorEmail ? [vendedorEmail] : []);
      if(toList.length){
        await MailService.enqueue({
          to: toList.join(','),
          subject: `Cotización COMPLETADA – Orden ${ordenId}`,
          text: `La cotización de la orden ${ordenId} fue marcada como COMPLETADA.`,
          html: `<p>La cotización de la orden <strong>${ordenId}</strong> fue marcada como <strong>COMPLETADA</strong>.</p>`,
        });
      }
    }catch(e){ console.warn('mail cotización',e); }

    ordenData.cotizacion_emitida = true;
    document.body.classList.add('solo-lectura');

    const b1 = byId('btnCompletarCot'); if(b1){ b1.disabled = true; b1.textContent = '✅ Cotización completada'; }
    const b2 = byId('btnDesbloquearCot'); if(b2){ b2.style.display = 'inline-block'; }
    pintarChipTrabajo('COMPLETADO');

    alert('✅ Cotización completada. La orden quedó bloqueada para edición.');
  }catch(e){
    console.error(e); alert('No se pudo completar la cotización.');
  }
}

async function desbloquearCotizacion(){
  try{
    if(!confirm('¿Desbloquear la orden para continuar editando?')) return;
    await OrdenesService.mergeOrder(ordenId, {
  cotizacion_emitida: false,
  trabajo_estado: 'EN_PROGRESO',
  os_logs: firebase.firestore.FieldValue.arrayUnion({
    action: 'COTIZACION_DESBLOQUEADA',
    by: usuarioActual.email || usuarioActual.uid,
    at_ms: Date.now()  // <- evita serverTimestamp dentro de arrayUnion
  }),
  updated_at: firebase.firestore.FieldValue.serverTimestamp()
});

    ordenData.cotizacion_emitida = false;
    document.body.classList.remove('solo-lectura');

    const b1 = byId('btnCompletarCot'); if(b1){ b1.disabled = false; b1.textContent = '✅ Completar cotización'; }
    const b2 = byId('btnDesbloquearCot'); if(b2){ b2.style.display = 'none'; }
    pintarChipTrabajo('EN_PROGRESO');

    alert('🔓 Orden desbloqueada. Puedes seguir trabajando.');
  }catch(e){
    console.error(e); alert('No se pudo desbloquear la orden.');
  }
}


// =================== Exportación a Excel (XLSX) ===================
async function exportarCotizacion(){
  try{
    const od = await OrdenesService.getOrder(ordenId);
    if(!od) return alert('Orden no encontrada');

    // Consumos cobrables
    const rows = await OrdenesService.getConsumos(ordenId, { tipo: 'cobro' });

    // Mapa de equipos visibles
    const equiposList = (Array.isArray(od.equipos) ? od.equipos.filter(e=>!e.eliminado) : []);
    const equiposById = {};
    equiposList.forEach(e=>{ const k=e.id||e.numero_de_serie||'X'; equiposById[k]=e; });

    // Construye dataset
    const data = rows.map(r=>{
      const eq = equiposById[r.equipoId] || {};
      return {
        Orden: ordenId,
        EquipoId: r.equipoId,
        Serie: eq.numero_de_serie || r.equipoId || '',
        Modelo: eq.modelo || '',
        Descripcion: r.pieza_nombre,
        SKU: r.sku || '',
        Cantidad: r.qty,
        PrecioUnit: Number(r.precio_unit||0),
        Subtotal: Number(r.subtotal || (r.qty||0)*(r.precio_unit||0))
      };
    });

    if(typeof XLSX === 'undefined'){
      // Fallback CSV simple
      const csv = toCSV(data);
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cotizacion_${ordenId}.csv`;
      a.click();
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion');
    XLSX.writeFile(wb, `cotizacion_${ordenId}.xlsx`);
  }catch(e){
    console.error(e);
    alert('No se pudo exportar.');
  }
}

function toCSV(arr){
  if(!arr.length) return '';
  const headers = Object.keys(arr[0]);
  const lines = [headers.join(',')];
  arr.forEach(o=> lines.push(headers.map(h=> JSON.stringify(o[h]??'')).join(',')));
  return lines.join('\n');
}


// =================== Eventos globales ===================
document.addEventListener('click', (e)=>{
  // nada por ahora
});

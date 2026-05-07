const params = new URLSearchParams(location.search);
const ordenId = params.get('id');
let ordenData = null;
let equipos = [];
let inventario = [];      // cache piezas
let equipoSeleccionado = null; // equipoId donde agrego

firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user){ location.href = 'login.html'; return; }

  // Cargar orden
  ordenData = await OrdenesService.getOrder(ordenId);
  if(!ordenData){ alert('Orden no encontrada'); return; }

  // Nombre del cliente (si viene con cliente_id)
  let cliente = ordenData.cliente_nombre || ordenData.cliente || '—';
  if(ordenData.cliente_id){
    try{
      const c = await ClientesService.getCliente(ordenData.cliente_id);
      if(c) cliente = c.nombre || cliente;
    }catch{}
  }

  // Equipos no eliminados
  equipos = Array.isArray(ordenData.equipos) ? ordenData.equipos.filter(e=>!e.eliminado) : [];

  // Mostrar cabecera
  const fecha = ordenData.fecha_creacion?.toDate ? ordenData.fecha_creacion.toDate().toISOString().slice(0,10) : '—';
  document.getElementById('infoOrden').innerHTML =
    `Orden <strong>${ordenId}</strong> · Cliente <strong>${cliente}</strong> · `+
    `Servicio <strong>${ordenData.tipo_de_servicio || '—'}</strong> · `+
    `Creada <strong>${fecha}</strong> · Estado <strong>${(ordenData.estado_reparacion||'').toUpperCase()}</strong>`;

  // Cargar inventario activo
  inventario = (await PiezasService.getPiezas()).filter(p => p.activo);

  // Render equipos
  await renderEquiposYConsumos();
});

async function renderEquiposYConsumos(){
  const wrap = document.getElementById('equiposWrap');
  wrap.innerHTML = '';

  for(const e of equipos){
    const div = document.createElement('div');
    div.className = 'fila-equipo';
    div.innerHTML = `
      <div class="hdr">
        <div>
          <div><strong>Serie:</strong> ${e.numero_de_serie || '-'}</div>
          <div><small>Modelo: ${e.modelo || '-'}</small></div>
        </div>
        <div class="acciones">
          <button class="btn" onclick="abrirModal('${e.id}')">➕ Agregar pieza</button>
        </div>
      </div>
      <div class="consumos" id="consumos_${e.id}">
        <div class="muted">Cargando consumos...</div>
      </div>
    `;
    wrap.appendChild(div);

    await cargarConsumosEquipo(e.id);
  }
}

async function cargarConsumosEquipo(equipoId){
  const zona = document.getElementById('consumos_'+equipoId);
  const consSnap = await OrdenesService.getConsumos(ordenId, { equipoId, orderByField: 'added_at' });

  const items = consSnap;

  if(items.length===0){
    zona.innerHTML = '<em>No hay piezas registradas.</em>';
    return;
  }

  let html = `<table>
    <thead>
      <tr>
        <th>Pieza</th><th>SKU</th><th>Tipo</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th>Acciones</th>
      </tr>
    </thead><tbody>`;

  let totalEquipo = 0;
  items.forEach(it=>{
    const badge = `<span class="badge-tipo ${it.tipo}">${it.tipo}</span>`;
    const sub = Number(it.subtotal||0);
    if(it.tipo==='cobro') totalEquipo += sub;
    html += `
      <tr>
        <td>${it.pieza_nombre}</td>
        <td>${it.sku||'-'}</td>
        <td>${badge}</td>
        <td>${it.qty}</td>
        <td>${fmtMoney(it.precio_unit)}</td>
        <td>${fmtMoney(sub)}</td>
        <td>
          <button class="btn" title="Editar" onclick="editarLinea('${it.id}')">✏️</button>
          <button class="btn danger" title="Eliminar" onclick="eliminarLinea('${it.id}','${equipoId}')">🗑️</button>
        </td>
      </tr>`;
  });
  html += `</tbody></table>
  <div class="total-mini">Subtotal cobrado (equipo): ${fmtMoney(totalEquipo)}</div>`;

  zona.innerHTML = html;
}

function fmtMoney(n){ n = Number(n||0); return '$'+n.toFixed(2); }

// ==== Modal ====
function abrirModal(eqId){
  equipoSeleccionado = eqId;
  document.getElementById('buscarPieza').value = '';
  document.getElementById('sugerencias').innerHTML = '';
  document.getElementById('qty').value = 1;
  document.getElementById('tipo').value = 'cobro';
  Modal.open('modalPieza');
}
function cerrarModal(){ Modal.close('modalPieza'); }

document.getElementById('buscarPieza').addEventListener('input', (e)=>{
  const q = e.target.value.trim().toLowerCase();
  const sug = document.getElementById('sugerencias');
  if(!q){ sug.innerHTML=''; return; }
  const top = inventario
    .filter(p=> (p.nombre||'').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q))
    .slice(0,8);
  sug.innerHTML = top.map(p=>`<button class="chip" onclick='pick("${p.id}")'>${p.nombre} · ${p.sku||'-'} · ${fmtMoney(p.precio_venta||0)}</button>`).join('');
});

let piezaSeleccionada = null;
function pick(id){
  piezaSeleccionada = inventario.find(p=>p.id===id);
  const sug = document.getElementById('sugerencias');
  sug.innerHTML = `<div class="muted">Seleccionado: <strong>${piezaSeleccionada.nombre}</strong> (${piezaSeleccionada.sku||'-'}) – ${fmtMoney(piezaSeleccionada.precio_venta||0)}</div>`;
}

async function confirmarAgregar(){
  if(!equipoSeleccionado){ alert('Equipo no válido'); return; }
  if(!piezaSeleccionada){ alert('Selecciona una pieza'); return; }

  const qty = Math.max(1, parseInt(document.getElementById('qty').value||'1',10));
  const tipo = document.getElementById('tipo').value || 'cobro';
  const precio = Number(piezaSeleccionada.precio_venta||0);
  const subtotal = (tipo==='cobro') ? (qty * precio) : 0;

  await OrdenesService.addConsumo(ordenId, {
    equipoId: equipoSeleccionado,
    pieza_id: piezaSeleccionada.id,
    pieza_nombre: piezaSeleccionada.nombre,
    sku: piezaSeleccionada.sku || '',
    qty,
    precio_unit: precio,
    tipo,
    subtotal,
    added_by_uid: firebase.auth().currentUser.uid,
    added_at: firebase.firestore.FieldValue.serverTimestamp()
  });

  cerrarModal();
  await cargarConsumosEquipo(equipoSeleccionado);
  alert('✅ Pieza agregada');
}

async function eliminarLinea(lineaId, equipoId){
  if(!confirm('¿Eliminar esta línea?')) return;
  await OrdenesService.deleteConsumo(ordenId, lineaId);
  await cargarConsumosEquipo(equipoId);
}

async function editarLinea(lineaId){
  const d = await OrdenesService.getConsumo(ordenId, lineaId);
  if(!d) return;
  const nuevaQty = parseInt(prompt('Cantidad', d.qty),10);
  if(!nuevaQty || nuevaQty<1) return;
  const nuevoTipo = prompt('Tipo (cobro/garantia/interno)', d.tipo||'cobro') || 'cobro';
  const nuevoSub = (nuevoTipo==='cobro') ? (nuevaQty * Number(d.precio_unit||0)) : 0;

  await OrdenesService.updateConsumo(ordenId, lineaId, { qty:nuevaQty, tipo:nuevoTipo, subtotal:nuevoSub });
  await cargarConsumosEquipo(d.equipoId);
}

function irACotizar(){
  location.href = 'cotizar-orden.html?id='+ordenId;
}

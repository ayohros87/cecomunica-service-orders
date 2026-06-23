// @ts-nocheck
// Activación de facturación — calcula readiness por contrato (señales requeridas /
// advertencia), bucketiza (Pendientes / Listos / Activos / En espera / No facturables)
// y permite activar/gestionar manual. Solo admin/contabilidad. Las escrituras van por
// el callable gestionarFacturacion (server-side, esquiva el guard de reglas).

let contratos = [];
let modelosById = {};
let modelosByName = {};
let vista = 'pendientes';

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function _norm(s){ return String(s||'').trim().toLowerCase(); }
function fdate(ts){ return ts?.toDate ? ts.toDate().toLocaleDateString('es-PA') : (ts ? new Date(ts).toLocaleDateString('es-PA') : '—'); }

firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user) return window.location.href='../login.html';
  try{
    const u = await UsuariosService.getUsuario(user.uid);
    const rol = u ? u.rol : null;
    if(!u || (rol!==ROLES.ADMIN && rol!==ROLES.CONTABILIDAD)){
      document.body.innerHTML="<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>"; return;
    }
    await cargar();
    render();
  }catch(e){ console.error(e); Toast.show('Error al iniciar','bad'); }
});

async function cargar(){
  const [cs, ms] = await Promise.all([
    ContratosService.getContratosActivosAprobados(),
    ModelosService.getModelos(),
  ]);
  contratos = cs || [];
  modelosById = {}; modelosByName = {};
  (ms||[]).forEach(m=>{ if(m.id) modelosById[m.id]=m; if(m.modelo) modelosByName[_norm(m.modelo)]=m; });
}

function activosDe(c){
  const total=(c.equipos||[]).reduce((s,e)=>s+Number(e.cantidad||0),0);
  return Math.max(0, total-Number(c.baja_cancelado_total||0));
}
function modeloDe(e){ return (e.modelo_id && modelosById[e.modelo_id]) || modelosByName[_norm(e.modelo)] || null; }

function readiness(c){
  const vigente = ['activo','aprobado'].includes(c.estado);
  // Mapeo QBO: cada equipo del contrato mapeado (precio + item + bundle). Sin equipos
  // (servicio/renovación) → no aplica el mapeo de alquiler, pasa.
  let mapeo = true;
  for(const e of (c.equipos||[])){
    const m = modeloDe(e);
    if(!m || !(Number(m.precio_alquiler)>0) || !m.qbo_item_alquiler_id || !m.qbo_bundle_id){ mapeo=false; break; }
  }
  const entrega = c.entrega_confirmada===true;
  const act = activosDe(c);
  const seriales = act>0 && Number(c.seriales_count||0) >= act;
  const firmado = !!c.firmado_url;
  return { vigente, mapeo, entrega, seriales, firmado, requeridosOk: vigente && mapeo };
}

function bucketDe(c){
  if(c.facturable===false || c.facturacion_estado==='no_aplica') return 'no_facturables';
  if(c.facturacion_estado==='activa') return 'activos';
  if(c.facturacion_estado==='en_espera') return 'en_espera';
  return readiness(c).requeridosOk ? 'listos' : 'pendientes';
}

function setVista(v){
  vista=v;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('is-on', b.dataset.v===v));
  render();
}

function chip(ok, label, req){
  const cls = ok ? 'r-ok' : (req ? 'r-bad' : 'r-warn');
  const icon = ok ? '✓' : (req ? '✗' : '⚠');
  return `<span class="r-chip ${cls}" title="${req?'Requerido':'Advertencia'}">${icon} ${label}</span>`;
}

function render(){
  actualizarConteos();
  const cont = document.getElementById('lista');
  const rows = contratos.filter(c=>bucketDe(c)===vista);
  if(!rows.length){ cont.innerHTML='<p style="color:var(--fg-3); padding:16px;">No hay contratos en esta vista.</p>'; return; }
  cont.innerHTML = rows.map(cardContrato).join('');
  if(window.lucide) lucide.createIcons();
}

function actualizarConteos(){
  const cnt={pendientes:0,listos:0,activos:0,en_espera:0,no_facturables:0};
  contratos.forEach(c=>{ cnt[bucketDe(c)]++; });
  Object.keys(cnt).forEach(k=>{ const el=document.getElementById('cnt-'+k); if(el) el.textContent=cnt[k]; });
}

function cardContrato(c){
  const id=c.id;
  const r = readiness(c);
  const act = activosDe(c);
  const total = (c.equipos||[]).reduce((s,e)=>s+Number(e.cantidad||0),0);
  const chips = [
    chip(r.vigente,'Vigente',true), chip(r.mapeo,'Mapeo QBO',true),
    chip(r.entrega,'Entrega',false), chip(r.seriales,'Seriales',false), chip(r.firmado,'Firmado',false),
  ].join(' ');
  const fechaSug = c.fecha_entrega_ultima ? fdate(c.fecha_entrega_ultima) : 'hoy';
  const defDate = c.fecha_entrega_ultima?.toDate
    ? c.fecha_entrega_ultima.toDate().toISOString().slice(0,10)
    : new Date().toISOString().slice(0,10);

  let acciones='';
  if(vista==='listos'){
    acciones = `
      <input type="date" class="form-input" id="fi-${id}" value="${defDate}" style="height:32px; width:150px;" title="Fecha de inicio de facturación">
      <button class="btn sm btn-primary" onclick="accion('${id}','activar')"><i data-lucide="play"></i> Activar</button>
      ${!r.entrega?`<button class="btn sm btn-ghost" onclick="accion('${id}','confirmar_entrega')"><i data-lucide="truck"></i> Confirmar entrega</button>`:''}
      <button class="btn sm btn-ghost" onclick="accion('${id}','no_facturable')"><i data-lucide="ban"></i> No factura</button>`;
  } else if(vista==='pendientes'){
    acciones = `
      ${!r.entrega?`<button class="btn sm btn-ghost" onclick="accion('${id}','confirmar_entrega')"><i data-lucide="truck"></i> Confirmar entrega</button>`:''}
      ${!r.mapeo?`<a class="btn sm btn-ghost" href="../inventario/modelos.html"><i data-lucide="git-compare"></i> Arreglar mapeo</a>`:''}
      <button class="btn sm btn-ghost" onclick="accion('${id}','no_facturable')"><i data-lucide="ban"></i> No factura</button>`;
  } else if(vista==='activos'){
    acciones = `<button class="btn sm btn-ghost" onclick="accion('${id}','en_espera')"><i data-lucide="pause"></i> Poner en espera</button>`;
  } else if(vista==='en_espera'){
    acciones = `<button class="btn sm btn-primary" onclick="accion('${id}','reactivar')"><i data-lucide="play"></i> Reactivar</button>`;
  } else if(vista==='no_facturables'){
    acciones = `<button class="btn sm btn-ghost" onclick="accion('${id}','facturable')"><i data-lucide="rotate-ccw"></i> Sí factura</button>`;
  }
  const lineaFact = vista==='activos'
    ? `<div style="font-size:12px; color:var(--status-online); margin-top:2px;">Factura desde ${fdate(c.facturacion_fecha_inicio)}</div>` : '';

  return `
    <div class="ds-card" style="padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-2);">
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
        <div style="min-width:240px;">
          <div style="font-weight:600;">${esc(c.contrato_id||id)} · ${esc(c.cliente_nombre||'')}</div>
          <div style="font-size:12px; color:var(--fg-3); margin:2px 0;">${act}/${total} equipos activos · entrega: ${fechaSug}</div>
          <div class="r-chips">${chips}</div>
          ${lineaFact}
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${acciones}</div>
      </div>
    </div>`;
}

async function accion(id, acc){
  const payload={};
  if(acc==='activar'){
    const d=document.getElementById('fi-'+id)?.value;
    payload.fecha_inicio = d ? new Date(d+'T00:00:00').toISOString() : null;
    if(!window.confirm('¿Activar facturación de este contrato?')) return;
  } else if(acc==='confirmar_entrega'){
    const d=window.prompt('Fecha de entrega (YYYY-MM-DD), vacío = hoy:','');
    if(d===null) return;
    payload.fecha = d ? new Date(d+'T00:00:00').toISOString() : null;
  } else if(acc==='no_facturable'){
    if(!window.confirm('¿Marcar como NO facturable (demo, etc.)?')) return;
    payload.motivo = window.prompt('Motivo (opcional):')||'';
  } else if(acc==='en_espera'){
    if(!window.confirm('¿Poner en espera (excluir del ciclo de facturación)?')) return;
  }
  try{
    await firebase.functions().httpsCallable('gestionarFacturacion')({ contratoId:id, accion:acc, payload });
    Toast.show('Listo','ok');
    await cargar();
    render();
  }catch(e){ console.error(e); Toast.show('Error: '+(e.message||''),'bad'); }
}

window.setVista = setVista;
window.accion = accion;

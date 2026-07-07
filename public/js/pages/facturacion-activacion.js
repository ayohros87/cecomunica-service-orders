// @ts-nocheck
// Activación de facturación — calcula readiness por contrato (señales requeridas /
// advertencia), bucketiza (Pendientes / Listos / Activos / En espera / No facturables)
// y permite activar/gestionar manual. Solo admin/contabilidad. Las escrituras van por
// el callable gestionarFacturacion (server-side, esquiva el guard de reglas).

let contratos = [];
let modelosById = {};
let modelosByName = {};
let vista = 'pendientes';

function esc(s){ return FMT.esc(s); } // helper canónico (core/formatting.js)
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
    await cargarConfig();
    render();
  }catch(e){ console.error(e); Toast.show('Error al iniciar','bad'); }
});

// Config de auto-activación (en empresa/facturacion_config, read/write=auth; UI gateada).
async function cargarConfig(){
  try{
    const d = await firebase.firestore().collection('empresa').doc('facturacion_config').get();
    const data = d.exists ? d.data() : {};
    const a = document.getElementById('autoActivar'); if(a) a.checked = !!data.auto_activar;
    const al = document.getElementById('alertasCorreo'); if(al) al.checked = !data.alertas_off; // on por default
  }catch(e){ console.warn('config', e); }
}
async function toggleAuto(on){
  try{
    await firebase.firestore().collection('empresa').doc('facturacion_config')
      .set({ auto_activar: !!on, actualizado_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    Toast.show(on?'Auto-activación activada (corre 7:00 AM)':'Auto-activación desactivada','ok');
  }catch(e){ console.error(e); Toast.show('No se pudo guardar la config','bad'); }
}
async function toggleAlertas(on){
  try{
    await firebase.firestore().collection('empresa').doc('facturacion_config')
      .set({ alertas_off: !on, actualizado_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    Toast.show(on?'Alertas por correo activadas':'Alertas por correo apagadas','ok');
  }catch(e){ console.error(e); Toast.show('No se pudo guardar la config','bad'); }
}
window.toggleAuto = toggleAuto;
window.toggleAlertas = toggleAlertas;

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

function emptyState(msg){
  return `<div class="empty-state"><i data-lucide="inbox" style="width:34px;height:34px;opacity:.4;"></i><div class="es-title">${msg}</div></div>`;
}

// Celda de verificación: si todo OK muestra "✓ completo"; si no, solo los chips
// de lo que falta (rojo = requerido, ámbar = recomendado). Más denso y escaneable.
function checklistCell(r){
  const items = [
    ['Vigente', r.vigente, true], ['Mapeo QBO', r.mapeo, true],
    ['Entrega', r.entrega, false], ['Seriales', r.seriales, false], ['Firmado', r.firmado, false],
  ];
  const faltan = items.filter(([,ok])=>!ok);
  if(!faltan.length) return '<span class="r-chip r-ok">✓ completo</span>';
  return '<div class="r-chips">' + faltan.map(([label,,req]) =>
    `<span class="r-chip ${req?'r-bad':'r-warn'}" title="${req?'Requerido':'Recomendado'}">${req?'✗':'⚠'} ${label}</span>`).join('') + '</div>';
}

function render(){
  actualizarConteos();
  const cont = document.getElementById('lista');
  const rows = contratos.filter(c=>bucketDe(c)===vista);
  if(!rows.length){ cont.innerHTML = emptyState('No hay contratos en esta vista.'); if(window.lucide) lucide.createIcons(); return; }
  cont.innerHTML = `
    <div class="app-table-wrap" style="border:none; box-shadow:none;">
      <table class="app-table">
        <thead><tr>
          <th>Contrato / Cliente</th>
          <th style="text-align:center;">Equipos</th>
          <th>Verificación</th>
          <th>${vista==='activos'?'Factura desde':'Fecha sugerida'}</th>
          <th style="text-align:right;">Acciones</th>
        </tr></thead>
        <tbody id="tablaActivacion">${rows.map(filaContrato).join('')}</tbody>
      </table>
    </div>`;
  if(window.lucide) lucide.createIcons();
}

function actualizarConteos(){
  const cnt={pendientes:0,listos:0,activos:0,en_espera:0,no_facturables:0};
  contratos.forEach(c=>{ cnt[bucketDe(c)]++; });
  Object.keys(cnt).forEach(k=>{ const el=document.getElementById('cnt-'+k); if(el) el.textContent=cnt[k]; });
  const kpis=document.getElementById('kpis');
  if(kpis){
    const sinMapeo = contratos.filter(c=>c.facturable!==false && c.facturacion_estado!=='no_aplica' && !readiness(c).mapeo).length;
    kpis.innerHTML =
      `<span class="k"><b>${cnt.activos}</b>activos</span>`+
      `<span class="k"><b>${cnt.listos}</b>listos para activar</span>`+
      `<span class="k warn"><b>${cnt.pendientes}</b>pendientes</span>`+
      `<span class="k warn"><b>${sinMapeo}</b>sin mapeo QBO</span>`;
  }
}

function filaContrato(c){
  const id=c.id;
  const r = readiness(c);
  const act = activosDe(c);
  const total = (c.equipos||[]).reduce((s,e)=>s+Number(e.cantidad||0),0);
  const defDate = c.fecha_entrega_ultima?.toDate
    ? c.fecha_entrega_ultima.toDate().toISOString().slice(0,10)
    : new Date().toISOString().slice(0,10);

  const fechaCol = vista==='activos'
    ? `<span style="color:var(--status-online);">${fdate(c.facturacion_fecha_inicio)}</span>`
    : (vista==='listos'
        ? `<input type="date" class="form-input" id="fi-${id}" value="${defDate}" style="height:30px; width:140px;" title="Fecha de inicio">`
        : (c.fecha_entrega_ultima ? fdate(c.fecha_entrega_ultima) : '—'));

  let acciones='';
  if(vista==='listos'){
    acciones = `<button class="btn btn-sm btn-primary" onclick="accion('${id}','activar')"><i data-lucide="play"></i> Activar</button>
      ${!r.entrega?`<button class="btn btn-sm btn-ghost" onclick="accion('${id}','confirmar_entrega')" title="Confirmar entrega"><i data-lucide="truck"></i></button>`:''}
      <button class="btn btn-sm btn-ghost" onclick="accion('${id}','no_facturable')" title="No factura"><i data-lucide="ban"></i></button>`;
  } else if(vista==='pendientes'){
    acciones = `${!r.entrega?`<button class="btn btn-sm btn-ghost" onclick="accion('${id}','confirmar_entrega')"><i data-lucide="truck"></i> Entrega</button>`:''}
      ${!r.mapeo?`<a class="btn btn-sm btn-ghost" href="../inventario/modelos.html"><i data-lucide="git-compare"></i> Mapeo</a>`:''}
      <button class="btn btn-sm btn-ghost" onclick="accion('${id}','no_facturable')" title="No factura"><i data-lucide="ban"></i></button>`;
  } else if(vista==='activos'){
    acciones = `<button class="btn btn-sm btn-ghost" onclick="vistaPrevia('${id}')"><i data-lucide="file-text"></i> Vista previa</button>
      <button class="btn btn-sm btn-ghost" onclick="accion('${id}','en_espera')" title="Poner en espera"><i data-lucide="pause"></i></button>`;
  } else if(vista==='en_espera'){
    acciones = `<button class="btn btn-sm btn-primary" onclick="accion('${id}','reactivar')"><i data-lucide="play"></i> Reactivar</button>`;
  } else if(vista==='no_facturables'){
    acciones = `<button class="btn btn-sm btn-ghost" onclick="accion('${id}','facturable')"><i data-lucide="rotate-ccw"></i> Sí factura</button>`;
  }

  return `
    <tr>
      <td><div style="font-weight:600;">${esc(c.contrato_id||id)}</div><div style="font-size:12px; color:var(--fg-3);">${esc(c.cliente_nombre||'')}</div></td>
      <td style="text-align:center; font-family:var(--font-mono);">${act}${total>act?`<span style="color:var(--fg-3);">/${total}</span>`:''}</td>
      <td>${checklistCell(r)}</td>
      <td style="white-space:nowrap;">${fechaCol}</td>
      <td style="text-align:right; white-space:nowrap;">${acciones}</td>
    </tr>`;
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

/* ===== Vista previa de factura (C1 — cálculo, sin escribir a QBO) ===== */
function money(n){ return '$'+Number(n||0).toFixed(2); }
const MESES=['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

async function vistaPrevia(id){
  const ov=document.getElementById('overlayFactura');
  document.getElementById('facturaBody').innerHTML='<p style="color:var(--fg-3);">Calculando…</p>';
  ov.classList.add('show'); ov.style.display='flex';
  if(window.lucide) lucide.createIcons();
  try{
    const res = await firebase.functions().httpsCallable('calcularFacturaContrato')({ contratoId:id });
    renderFactura(res.data);
  }catch(e){ console.error(e); document.getElementById('facturaBody').innerHTML=`<p style="color:#b91c1c;">${esc(e.message||'Error')}</p>`; }
}

function renderFactura(f){
  const lineas=(f.lineas||[]).map(l=>`
    <tr>
      <td>${esc(l.modelo)} ${l.parcial?`<span class="r-chip r-warn" title="${l.dias} días">parcial</span>`:''} ${!l.mapeo_ok?'<span class="r-chip r-bad">sin mapeo</span>':''} ${l.advertencia?`<span class="r-chip r-bad" title="${esc(l.advertencia)}">⚠</span>`:''}</td>
      <td style="text-align:center;">${l.cantidad}</td>
      <td style="text-align:right; font-family:var(--font-mono);">${money(l.importe)}</td>
      <td style="font-size:11px; color:var(--fg-3); white-space:nowrap;">A ${money(l.desglose.alquiler)} · F ${money(l.desglose.frecuencia)} · M ${money(l.desglose.mantenimiento)}</td>
    </tr>`).join('');
  const cargos=(f.cargos||[]).map(c=>`<tr><td>${esc(c.concepto)} <span style="font-size:11px;color:var(--fg-4);">(cargo)</span></td><td></td><td style="text-align:right; font-family:var(--font-mono);">${money(c.importe)}</td><td></td></tr>`).join('');
  document.getElementById('facturaBody').innerHTML=`
    <div style="margin-bottom:8px;"><b>${esc(f.contrato_id)}</b> · ${esc(f.cliente_nombre)} — ${MESES[f.periodo.mes]} ${f.periodo.anio} <span style="color:var(--fg-3);">(${f.periodo.inicio} a ${f.periodo.fin})</span></div>
    <div class="table-scroll" style="max-height:50vh; overflow:auto;">
      <table class="app-table" style="font-size:13px;">
        <thead><tr><th>Concepto</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Importe</th><th>Desglose (Alq/Frec/Mant)</th></tr></thead>
        <tbody>${lineas}${cargos}${(!lineas&&!cargos)?'<tr><td colspan="4" style="text-align:center; padding:12px; color:var(--fg-3);">Nada facturable este período.</td></tr>':''}</tbody>
      </table>
    </div>
    <div style="margin-top:12px; text-align:right; font-size:14px;">
      <div>Subtotal: <b style="font-family:var(--font-mono);">${money(f.subtotal)}</b></div>
      <div>${f.itbms_aplica?`ITBMS (${Math.round(f.itbms_porc*100)}%)`:'ITBMS exento'}: <b style="font-family:var(--font-mono);">${money(f.itbms)}</b></div>
      <div style="font-size:16px; margin-top:4px;">Total: <b style="font-family:var(--font-mono);">${money(f.total)}</b></div>
    </div>
    ${(f.omitidas&&f.omitidas.length)?`<p style="font-size:12px; color:var(--fg-3); margin-top:8px;">Omitidas: ${f.omitidas.map(o=>esc(o.modelo)+' ('+esc(o.motivo)+')').join(', ')}</p>`:''}
    <p style="font-size:11px; color:var(--fg-4); margin-top:8px;"><i data-lucide="info" style="width:12px;height:12px;vertical-align:-1px;"></i> Cálculo de validación. No se ha emitido ninguna factura en QuickBooks.</p>`;
  if(window.lucide) lucide.createIcons();
}

function cerrarFactura(){ const ov=document.getElementById('overlayFactura'); ov.classList.remove('show'); ov.style.display='none'; }
window.vistaPrevia=vistaPrevia; window.cerrarFactura=cerrarFactura;

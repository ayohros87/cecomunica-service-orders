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
    const u = await Sesion.miPerfil(user);
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
/* Estos dos checkboxes NO son filtros de la vista: escriben configuración de
   TODA la empresa al instante (uno gobierna la corrida automática de las 7:00
   AM). Estaban sin confirmación, a un clic accidental de distancia. Ahora
   avisan qué implica el cambio y, si se cancela, el checkbox vuelve a su
   estado anterior — mismo patrón que el mapeo global de Modelos y Tarifas. */
async function _confirmarConfig(chkId, valorPrevio, opts){
  const ok = await Modal.confirm(opts);
  if (!ok) {
    const chk = document.getElementById(chkId);
    if (chk) chk.checked = valorPrevio;   // revertir sin escribir
  }
  return ok;
}

async function toggleAuto(on){
  const ok = await _confirmarConfig('autoActivar', !on, {
    title: on ? 'Encender la auto-activación' : 'Apagar la auto-activación',
    message: on
      ? 'La corrida diaria de las <b>7:00 AM</b> pasará a activar sola todos los contratos que estén en <b>Listos</b>, sin que nadie los revise. Afecta a toda la empresa.'
      : 'Los contratos <b>Listos</b> dejarán de activarse solos: habrá que activarlos a mano uno por uno.',
    confirmLabel: on ? 'Sí, activar solos' : 'Sí, apagar',
    danger: !!on,
  });
  if (!ok) return;
  try{
    await firebase.firestore().collection('empresa').doc('facturacion_config')
      .set({ auto_activar: !!on, actualizado_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    Toast.show(on?'Auto-activación activada (corre 7:00 AM)':'Auto-activación desactivada','ok');
  }catch(e){
    console.error(e); Toast.show('No se pudo guardar la config','bad');
    const chk = document.getElementById('autoActivar'); if(chk) chk.checked = !on;  // no quedó guardado
  }
}

async function toggleAlertas(on){
  const ok = await _confirmarConfig('alertasCorreo', !on, {
    title: on ? 'Encender las alertas por correo' : 'Apagar las alertas por correo',
    message: on
      ? 'Se vuelven a enviar los correos de alerta (fuga / falso arranque) a los destinatarios configurados.'
      : 'Nadie recibirá los correos de <b>fuga</b> ni de <b>falso arranque</b> hasta que se vuelvan a encender. Afecta a toda la empresa.',
    confirmLabel: on ? 'Sí, encender' : 'Sí, apagar',
    danger: !on,
  });
  if (!ok) return;
  try{
    await firebase.firestore().collection('empresa').doc('facturacion_config')
      .set({ alertas_off: !on, actualizado_at: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
    Toast.show(on?'Alertas por correo activadas':'Alertas por correo apagadas','ok');
  }catch(e){
    console.error(e); Toast.show('No se pudo guardar la config','bad');
    const chk = document.getElementById('alertasCorreo'); if(chk) chk.checked = !on;  // no quedó guardado
  }
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
  // Mismo criterio que contratos-list (serialesBtn): las unidades omitidas
  // con motivo ("sin serial") cuentan como resueltas — antes este check las
  // ignoraba y el contrato se veía completo en la lista pero incompleto aquí.
  const seriales = act>0 && (Number(c.seriales_count||0) + Number(c.seriales_omitidos_count||0)) >= act;
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

let filtroTexto = '';
function setFiltroFact(v){ filtroTexto = String(v||'').trim().toLowerCase(); render(); }

function render(){
  actualizarConteos();
  const cont = document.getElementById('lista');
  const rows = contratos.filter(c=>bucketDe(c)===vista)
    .filter(c=>!filtroTexto
      || String(c.contrato_id||'').toLowerCase().includes(filtroTexto)
      || String(c.cliente_nombre||'').toLowerCase().includes(filtroTexto));
  if(!rows.length){ cont.innerHTML = emptyState(filtroTexto ? 'Nada coincide con la búsqueda en esta vista.' : 'No hay contratos en esta vista.'); if(window.lucide) lucide.createIcons(); return; }
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
  // Fecha en hora de Panamá: toISOString() da la fecha UTC y después de las
  // 7:00 pm proponía "mañana" (auditoría UX 2026-09-28, T8).
  const defDate = c.fecha_entrega_ultima?.toDate
    ? FMT.fechaISOPanama(c.fecha_entrega_ultima)
    : FMT.hoyISOPanama();

  const fechaCol = vista==='activos'
    ? `<span style="color:var(--status-online);">${fdate(c.facturacion_fecha_inicio)}</span>`
    : (vista==='listos'
        ? `<input type="date" class="form-input" id="fi-${id}" value="${defDate}" style="height:30px; width:140px;" title="Fecha de inicio">`
        : (c.fecha_entrega_ultima ? fdate(c.fecha_entrega_ultima) : '—'));

  let acciones='';
  if(vista==='listos'){
    acciones = `<button class="btn btn-sm btn-primary" onclick="accion('${id}','activar')" title="La app facturará este contrato por sí sola cuando exista la emisión"><i data-lucide="play"></i> Facturará la app</button>
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
      <td><div style="font-family:var(--font-mono, monospace); font-weight:600; font-size:13px; color:var(--accent, #0091D7);">${esc(c.contrato_id||id)}</div><div style="font-size:12px; color:var(--fg-3);">${esc(c.cliente_nombre||'')}</div></td>
      <td style="text-align:center; font-family:var(--font-mono);">${act}${total>act?`<span style="color:var(--fg-3);">/${total}</span>`:''}</td>
      <td>${checklistCell(r)}</td>
      <td style="white-space:nowrap;">${fechaCol}</td>
      <td style="text-align:right; white-space:nowrap;">${acciones}</td>
    </tr>`;
}

// Candado anti doble-click: los botones de fila no se deshabilitaban mientras
// el callable estaba en vuelo — doble click = doble invocación de
// gestionarFacturacion (y la tabla congelada sin señal mientras recarga).
let _accionEnVuelo = false;

// "YYYY-MM-DD" → ISO de la medianoche de Panamá (UTC-5, sin DST), o null si
// no es una fecha real. Antes `new Date(texto)` con "28/09/2026" lanzaba
// RangeError antes del try y el click "no hacía nada" (auditoría UX 2026-09-28, P0 #25).
function isoDesdeFechaPanama(d){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))) return null;
  const dt = new Date(d+'T00:00:00-05:00');
  return isNaN(dt) ? null : dt.toISOString();
}

// Hoja con un input type=date prellenado con hoy (Panamá). Resuelve con el
// ISO elegido o null si se cierra.
function pedirFechaEntrega(contrato){
  return Modal.sheet({
    title: 'Confirmar entrega', icon: 'truck', size: 'sm',
    html: `<p style="margin:0 0 10px;font-size:14px;">Contrato <b>${esc(contrato?.contrato_id||'')}</b>${contrato?.cliente_nombre?` · ${esc(contrato.cliente_nombre)}`:''}</p>
      <label class="form-label" for="fechaEntregaInput">Fecha de entrega</label>
      <input type="date" id="fechaEntregaInput" class="form-input" value="${FMT.hoyISOPanama()}">
      <p id="fechaEntregaErr" style="display:none;margin:6px 0 0;color:var(--status-offline,#b91c1c);font-size:13px;">Escoge una fecha válida.</p>`,
    buttons: [{ action:'cancelar', label:'Cancelar' }, { action:'ok', label:'Confirmar entrega', primary:true }],
    onAction: (action, root) => {
      if(action!=='ok') return null;
      const iso = isoDesdeFechaPanama(root.querySelector('#fechaEntregaInput')?.value);
      if(!iso){ root.querySelector('#fechaEntregaErr').style.display='block'; return false; }
      return iso;
    }
  });
}

// Un solo modal con el motivo en vez de confirm + prompt encadenados.
// Resuelve con {motivo} o null si se cancela.
function pedirNoFacturable(contrato){
  return Modal.sheet({
    title: 'Marcar como no facturable', icon: 'ban', size: 'sm',
    html: `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;">El contrato <b>${esc(contrato?.contrato_id||'')}</b>${contrato?.cliente_nombre?` (${esc(contrato.cliente_nombre)})`:''} saldrá del ciclo de facturación (demo, cortesía, etc.). Se puede revertir con "Sí factura".</p>
      <label class="form-label" for="motivoNoFact">Motivo (opcional)</label>
      <input type="text" id="motivoNoFact" class="form-input" maxlength="200" placeholder="Ej.: demo de 30 días">`,
    buttons: [{ action:'cancelar', label:'Cancelar' }, { action:'ok', label:'Marcar no facturable', primary:true }],
    onMount: (root) => setTimeout(()=>root.querySelector('#motivoNoFact')?.focus(), 30),
    onAction: (action, root) => action==='ok' ? { motivo: (root.querySelector('#motivoNoFact')?.value||'').trim() } : null
  });
}

async function accion(id, acc){
  if(_accionEnVuelo) return;
  const c = contratos.find(x=>x.id===id) || { id };
  const nombre = `<b>${esc(c.contrato_id||id)}</b>${c.cliente_nombre?` (${esc(c.cliente_nombre)})`:''}`;
  const payload={};
  if(acc==='activar'){
    const d=document.getElementById('fi-'+id)?.value;
    if(d){
      payload.fecha_inicio = isoDesdeFechaPanama(d);
      if(!payload.fecha_inicio){ Toast.show('La fecha de inicio no es válida.','bad'); return; }
    } else payload.fecha_inicio = null;
    if(!await Modal.confirm({ title: 'Facturará la app', confirmLabel: 'Activar', message: `¿Activar la facturación de ${nombre}${d?` desde el ${esc(d.split('-').reverse().join('/'))}`:''}?` })) return;
  } else if(acc==='confirmar_entrega'){
    const iso = await pedirFechaEntrega(c);
    if(!iso) return;
    payload.fecha = iso;
  } else if(acc==='no_facturable'){
    const r = await pedirNoFacturable(c);
    if(!r) return;
    payload.motivo = r.motivo;
  } else if(acc==='en_espera'){
    if(!await Modal.confirm({ title: 'Poner en espera', confirmLabel: 'Poner en espera', message: `¿Poner en espera ${nombre}? Sale del ciclo de facturación hasta que lo reactives.` })) return;
  } else if(acc==='reactivar'){
    if(!await Modal.confirm({ title: 'Reactivar', confirmLabel: 'Reactivar', message: `¿Reactivar la facturación de ${nombre}?` })) return;
  } else if(acc==='facturable'){
    if(!await Modal.confirm({ title: 'Sí factura', confirmLabel: 'Sí factura', message: `¿Devolver ${nombre} al ciclo de facturación?` })) return;
  }
  _accionEnVuelo = true;
  try{
    await firebase.functions().httpsCallable('gestionarFacturacion')({ contratoId:id, accion:acc, payload });
    Toast.show('Listo','ok');
    await cargar();
    render();
  }catch(e){ console.error(e); Toast.show('Error: '+(e.message||''),'bad'); }
  finally{ _accionEnVuelo = false; }
}

window.setVista = setVista;
window.setFiltroFact = setFiltroFact;
window.accion = accion;

/* ===== Vista previa de factura (C1 — cálculo, sin escribir a QBO) ===== */
function money(n){ return '$'+Number(n||0).toFixed(2); }
const MESES=['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

async function vistaPrevia(id){
  const ov=document.getElementById('overlayFactura');
  document.getElementById('facturaBody').innerHTML='<p style="color:var(--fg-3);">Calculando…</p>';
  Modal.open('overlayFactura');
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
  const cargos=(f.cargos||[]).map(c=>`<tr><td>${esc(c.concepto)} <span style="font-size:11px;color:var(--fg-4);">(cargo)</span></td><td style="text-align:center;">${Number(c.cantidad)||1}</td><td style="text-align:right; font-family:var(--font-mono);">${money(c.importe)}</td><td></td></tr>`).join('');
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

function cerrarFactura(){ Modal.close('overlayFactura'); }
window.vistaPrevia=vistaPrevia; window.cerrarFactura=cerrarFactura;

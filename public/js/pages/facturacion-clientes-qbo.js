// @ts-nocheck
// Clientes ↔ QuickBooks — match asistido. Empareja clientes del app con Customers de
// QBO por RUC (primario) o nombre, y revela la estructura: clientes con MÚLTIPLES
// candidatos (cuentas duplicadas) y RUCs con varias cuentas top-level en QBO.
// Contabilidad confirma y guarda qbo_customer_id en el cliente. Solo admin/contabilidad.

let clientes = [];
let custTop = [];          // customers top-level (no Job)
let byRuc = {}, byName = {};
let dupRucs = [];          // [{ruc, custs:[...]}]
let vista = 'sugeridos';
let filtroTexto = '';      // buscador (auditoría): sin él era scroll puro

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function norm(s){ return String(s||'').trim().toLowerCase(); }
function normTax(s){ return String(s||'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase(); }
function money(n){ return '$'+Number(n||0).toFixed(2); }

firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user) return window.location.href='../login.html';
  try{
    const u = await UsuariosService.getUsuario(user.uid);
    const rol = u ? u.rol : null;
    if(!u || (rol!==ROLES.ADMIN && rol!==ROLES.CONTABILIDAD)){
      document.body.innerHTML="<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>"; return;
    }
    const lista = document.getElementById('lista');
    if(lista && !lista._qboWired){
      lista.addEventListener('click', onListaClick);
      lista.addEventListener('focusin', onListaFocus);
      lista._qboWired = true;
    }
    await cargar();
    render();
  }catch(e){ console.error(e); Toast.show('Error al iniciar','bad'); }
});

async function cargar(){
  document.getElementById('lista').innerHTML='<p style="color:var(--fg-3);">Consultando QuickBooks…</p>';
  const [mapC, res] = await Promise.all([
    ClientesService.loadClientes(),
    firebase.functions().httpsCallable('listQBOCustomers')(),
  ]);
  clientes = Array.from(mapC.values()).filter(c=>c.deleted!==true);
  const customers = (res.data && res.data.customers) || [];
  custTop = customers.filter(c=>!c.job && c.active);

  byRuc={}; byName={};
  custTop.forEach(c=>{
    const r=normTax(c.ruc); if(r) (byRuc[r]=byRuc[r]||[]).push(c);
    [c.display_name, c.company_name].forEach(n=>{ const k=norm(n); if(k) (byName[k]=byName[k]||[]).push(c); });
  });
  // RUCs con varias cuentas top-level → duplicados/estructura múltiple.
  dupRucs = Object.entries(byRuc).filter(([,arr])=>arr.length>1)
    .map(([ruc,arr])=>({ ruc, custs: arr })).sort((a,b)=>b.custs.length-a.custs.length);

  // contadores de QBO
  const subs = customers.length - customers.filter(c=>!c.job).length;
  document.getElementById('qboResumen').innerHTML =
    `QBO: <b>${customers.length}</b> customers · <b>${custTop.length}</b> top-level · <b>${subs}</b> sub-customers · <b style="color:#92400E;">${dupRucs.length}</b> RUC con varias cuentas`;
}

// Similitud de nombre por tokens (ignora sufijos S.A./DE/CIA…). Cacha el RUC que
// calza pero el nombre no (error de RUC en QBO: KLM ↔ Magen David, etc.).
const STOP = new Set(['SA','S','A','INC','CORP','SRL','SL','LTD','DE','DEL','LA','EL','LOS','LAS','Y','CIA','COMPANIA','PH']);
function tokens(s){
  return String(s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^A-Z0-9\s]/g,' ').split(/\s+/).filter(t=>t.length>=3 && !STOP.has(t));
}
function nombreParecido(a,b){
  const ta=tokens(a), tb=tokens(b);
  if(!ta.length || !tb.length) return false;
  const setB=new Set(tb);
  const shared=ta.filter(t=>setB.has(t)).length;
  return shared>0 && (shared/Math.min(ta.length,tb.length) >= 0.34);
}

function matchInfo(cl){
  const tax = normTax(cl.ruc || cl.cedula);
  const clNom = cl.empresa || cl.nombre || '';
  let custs=[], via=null;
  if(tax && byRuc[tax]){ custs = byRuc[tax]; via='ruc'; }
  else { const n = byName[norm(clNom)]; if(n){ custs = n; via='nombre'; } }
  const seen=new Set();
  custs = custs.filter(c=>seen.has(c.qbo_customer_id)?false:(seen.add(c.qbo_customer_id),true));
  custs = custs.map(c=>({ ...c, _parecido: nombreParecido(clNom, c.display_name) || nombreParecido(clNom, c.company_name) }));
  const nombreDistinto = via==='ruc' && custs.length>0 && !custs.some(c=>c._parecido);
  return { custs, via, nombreDistinto };
}

function bucketDe(cl){
  if(cl.qbo_customer_id) return 'vinculados';
  const n = matchInfo(cl).custs.length;
  return n===0 ? 'sin_match' : n===1 ? 'sugeridos' : 'multiples';
}

function setVista(v){ vista=v; document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('is-on', b.dataset.v===v)); render(); }
function setFiltro(v){ filtroTexto = norm(v); render(); }

// Tras crear el Customer en QBO había que refrescar la página completa
// (cargar() solo corría en el arranque).
async function recargarQBO(){
  const b = document.getElementById('btnRecargarQbo');
  if (b) b.disabled = true;
  try { await cargar(); render(); Toast.show('Listado de QuickBooks actualizado','ok'); }
  catch(e){ console.error(e); Toast.show('No se pudo recargar desde QuickBooks','bad'); }
  finally { if (b) b.disabled = false; }
}

function emptyState(msg){
  return `<div class="empty-state"><i data-lucide="inbox" style="width:34px;height:34px;opacity:.4;"></i><div class="es-title">${msg}</div></div>`;
}

function render(){
  const cnt={sugeridos:0,multiples:0,sin_match:0,vinculados:0};
  clientes.forEach(c=>{ cnt[bucketDe(c)]++; });
  Object.keys(cnt).forEach(k=>{ const el=document.getElementById('cnt-'+k); if(el) el.textContent=cnt[k]; });
  const eld=document.getElementById('cnt-dupes'); if(eld) eld.textContent=dupRucs.length;

  const cont=document.getElementById('lista');
  if(vista==='dupes'){ cont.innerHTML = renderDupes(); if(window.lucide) lucide.createIcons(); return; }

  const fTax = filtroTexto.replace(/[^a-z0-9]/g,'').toUpperCase();
  const rows = clientes.filter(c=>bucketDe(c)===vista)
    .filter(c=>!filtroTexto
      || norm(c.empresa||c.nombre).includes(filtroTexto)
      || (fTax && normTax(c.ruc||c.cedula).includes(fTax)))
    .sort((a,b)=>norm(a.empresa||a.nombre).localeCompare(norm(b.empresa||b.nombre)));
  if(!rows.length){ cont.innerHTML = emptyState(filtroTexto ? 'Nada coincide con la búsqueda en esta vista.' : 'Sin clientes en esta vista.'); if(window.lucide) lucide.createIcons(); return; }
  cont.innerHTML = `
    <div class="app-table-wrap" style="border:none; box-shadow:none;">
      <table class="app-table">
        <thead><tr><th>Cliente</th><th>QuickBooks</th><th style="text-align:right;">Acción</th></tr></thead>
        <tbody>${rows.map(filaCliente).join('')}</tbody>
      </table>
    </div>`;
  if(window.lucide) lucide.createIcons();
}

// Botones con data-attributes + un listener delegado en #lista (auditoría UX
// 2026-09-28, 4.8 #4): el onclick inline con el nombre del Customer se rompía
// con un apóstrofe ("O'Neill") y el botón no hacía nada.
function filaCliente(cl){
  const nombre = esc(cl.empresa || cl.nombre || '—');
  const tax = cl.ruc || cl.cedula || '';
  const cli = `<td><div style="font-weight:600;">${nombre}</div><div style="font-size:12px; color:var(--fg-3);">${tax?('RUC/CI: '+esc(tax)):'sin RUC'}</div></td>`;

  if(cl.qbo_customer_id){
    return `<tr>${cli}
      <td><span class="r-chip r-ok">✓ ${esc(cl.qbo_customer_name||'vinculado')}</span></td>
      <td style="text-align:right; white-space:nowrap;"><button class="btn btn-sm btn-ghost" data-act="desvincular" data-cliente="${esc(cl.id)}"><i data-lucide="unlink"></i> Desvincular</button></td></tr>`;
  }
  const mi = matchInfo(cl);
  const cands = mi.custs;
  if(!cands.length){
    // "Sin match": combo con búsqueda (FilteredSelect) sobre los ~500
    // Customers top-level. Las opciones se pintan al enfocar la fila, no al
    // renderizar: con cientos de filas sin match eran decenas de miles de
    // <option>. El vínculo manual SIEMPRE pide confirmación.
    return `<tr>${cli}
      <td><span class="r-chip r-bad">sin match en QBO</span>
        <div style="display:flex; gap:6px; margin-top:6px; align-items:center; flex-wrap:wrap;">
          <input type="search" class="form-input" id="qbo-fil-${esc(cl.id)}" data-qbo-filtro="${esc(cl.id)}" placeholder="Buscar Customer…" autocomplete="off" style="max-width:180px; height:30px; font-size:12.5px;">
          <select class="form-select" id="qbo-man-${esc(cl.id)}" data-qbo-select="${esc(cl.id)}" style="max-width:280px; height:30px; font-size:12.5px;">
            <option value="">Vincular manualmente…</option>
          </select>
          <button class="btn btn-sm btn-ghost" data-act="vincular-manual" data-cliente="${esc(cl.id)}" title="Vincular con el Customer elegido"><i data-lucide="link"></i></button>
        </div>
      </td><td></td></tr>`;
  }
  const riesgoDe = (c)=> (cands.length>1 || (mi.via==='ruc' && !c._parecido)) ? '1' : '0';
  const lista = cands.map(c=>`
    <div style="display:flex; align-items:center; gap:8px; margin:3px 0;">
      <button class="btn btn-sm btn-primary" data-act="vincular" data-cliente="${esc(cl.id)}" data-qbo="${esc(c.qbo_customer_id)}" data-riesgo="${riesgoDe(c)}"><i data-lucide="link"></i> Vincular</button>
      <span style="font-size:13px;">${esc(c.display_name)}<span style="color:var(--fg-3); font-size:12px;">${c.ruc?(' · '+esc(c.ruc)):''} · saldo ${money(c.balance)}</span>${(mi.via==='ruc'&&!c._parecido)?' <span class="r-chip r-bad" title="RUC coincide pero el nombre no se parece — posible RUC errado en QBO">⚠ nombre distinto</span>':''}${(()=>{ const o=vinculadoA(c.qbo_customer_id, cl.id); return o?` <span class="r-chip r-warn" title="Un Customer se vincula a un solo cliente">ya vinculado a ${esc(o.empresa||o.nombre||o.id)}</span>`:''; })()}</span>
    </div>`).join('');
  let badge='';
  if(cands.length>1) badge += '<span class="r-chip r-warn">múltiples</span> ';
  if(mi.nombreDistinto) badge += '<span class="r-chip r-bad">verificar</span>';
  return `<tr>${cli}<td>${lista}</td><td style="text-align:right; white-space:nowrap;">${badge}</td></tr>`;
}

// Cliente del app que ya tiene este Customer (regla 1 a 1), excluyendo al
// propio cliente. Sobre la lista cargada; vincular() revalida contra Firestore.
function vinculadoA(qboId, excluirClienteId){
  if(!qboId) return null;
  return clientes.find(x => x.id !== excluirClienteId && String(x.qbo_customer_id||'') === String(qboId)) || null;
}

// Monta el combo con búsqueda de una fila "Sin match" la primera vez que se usa.
function montarComboManual(clienteId){
  const sel = document.getElementById('qbo-man-'+clienteId);
  if(!sel || sel._qboMontado || !window.FilteredSelect) return;
  sel._qboMontado = true;
  const items = custTop.slice().sort((a,b)=>norm(a.display_name).localeCompare(norm(b.display_name)));
  FilteredSelect.montar({
    select: sel, filtro: document.getElementById('qbo-fil-'+clienteId), items,
    id: c => c.qbo_customer_id,
    label: c => {
      const otro = vinculadoA(c.qbo_customer_id, clienteId);
      return `${c.display_name||''}${c.ruc?(' · '+c.ruc):''}${otro?(' — ya vinculado a '+(otro.empresa||otro.nombre||otro.id)):''}`;
    },
    placeholder: 'Vincular manualmente…',
  });
}

function onListaClick(ev){
  const b = ev.target.closest('[data-act]');
  if(!b) return;
  const act = b.getAttribute('data-act');
  const clienteId = b.getAttribute('data-cliente');
  if(act==='vincular'){
    const qboId = b.getAttribute('data-qbo');
    const c = custTop.find(x=>String(x.qbo_customer_id)===String(qboId));
    return vincular(clienteId, qboId, (c && c.display_name) || '', b.getAttribute('data-riesgo')==='1', b);
  }
  if(act==='vincular-manual') return vincularManual(clienteId, b);
  if(act==='desvincular') return desvincular(clienteId);
}
function onListaFocus(ev){
  const t = ev.target;
  const id = t && (t.getAttribute('data-qbo-filtro') || t.getAttribute('data-qbo-select'));
  if(id) montarComboManual(id);
}

function renderDupes(){
  if(!dupRucs.length) return '<p style="color:var(--fg-3); padding:8px;">No hay RUCs con varias cuentas en QuickBooks.</p>';
  return `<p style="font-size:13px; color:var(--fg-3); margin:0 0 10px;">Mismo RUC en varias cuentas top-level de QuickBooks (cuentas duplicadas del mismo cliente). Elige la canónica y considera fusionarlas en QuickBooks.</p>` +
    dupRucs.map(g=>`
      <div class="ds-card" style="padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-2);">
        <div style="font-weight:600;">RUC ${esc(g.ruc)} <span class="r-chip r-warn">${g.custs.length} cuentas</span></div>
        <ul style="margin:6px 0 0; padding-left:18px; font-size:13px;">
          ${g.custs.map(c=>`<li>${esc(c.display_name)} <span style="color:var(--fg-3);">· saldo ${money(c.balance)}${c.balance>0?' ⚠':''}</span></li>`).join('')}
        </ul>
      </div>`).join('');
}

async function vincular(clienteId, qboId, qboName, riesgo, btn){
  if(btn && btn.disabled) return;
  const cl = clientes.find(x=>x.id===clienteId);
  // Regla 1 a 1 (auditoría UX 2026-09-28, 4.8 #4): un Customer de QBO es UN
  // cliente del app. Se revisa la lista cargada y Firestore (otra pestaña u
  // otra persona pudo vincularlo después de cargar).
  let otro = vinculadoA(qboId, clienteId);
  if(!otro){
    try{
      const snap = await firebase.firestore().collection('clientes').where('qbo_customer_id','==',qboId).limit(5).get();
      const d = snap.docs.find(x => x.id !== clienteId && x.data().deleted !== true);
      if(d) otro = { id: d.id, ...d.data() };
    }catch(e){
      console.error(e);
      Toast.show('No se pudo verificar si ese Customer ya está vinculado. Intenta de nuevo.','bad');
      return;
    }
  }
  if(otro){
    await Modal.alert({
      title: 'Customer ya vinculado', icon: 'alert-triangle',
      message: `El Customer «${esc(qboName)}» ya está vinculado a <b>${esc(otro.empresa||otro.nombre||otro.id)}</b>. Un Customer de QuickBooks se vincula a un solo cliente: si es el mismo cliente duplicado, consolídalo; si no, quita primero ese vínculo (vista Vinculados).`,
    });
    return;
  }
  // Confirmación proporcional (auditoría): con Customer=cliente y la
  // facturación arrancando al entregar, un vínculo errado factura a OTRA
  // empresa — y era 1 click sin pregunta. Solo pregunta en los casos con
  // badge (múltiples / nombre distinto) y en el vínculo manual.
  if (riesgo && window.Modal) {
    const ok = await Modal.confirm({
      title: 'Confirmar vínculo con QuickBooks',
      message: `App: «${esc(cl?.empresa || cl?.nombre || clienteId)}» → QBO: «${esc(qboName)}». La facturación de sus contratos saldrá a ese Customer. ¿Vincular?`,
      confirmLabel: 'Vincular',
    });
    if (!ok) return;
  }
  if(btn) btn.disabled = true;
  try{
    const user = firebase.auth().currentUser;
    await ClientesService.updateCliente(clienteId, {
      qbo_customer_id: qboId, qbo_customer_name: qboName,
      // Rastro (auditoría): antes el vínculo no dejaba quién ni cuándo.
      qbo_vinculado_por: (user && (user.email || user.uid)) || null,
      qbo_vinculado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    if(cl){ cl.qbo_customer_id=qboId; cl.qbo_customer_name=qboName; }
    Toast.show('Cliente vinculado','ok'); render();
  }catch(e){ console.error(e); Toast.show('No se pudo vincular','bad'); if(btn) btn.disabled = false; }
}

// Vínculo manual desde "Sin match": el combo trae TODOS los Customers
// top-level; la confirmación es obligatoria (riesgo=true).
function vincularManual(clienteId, btn){
  const sel = document.getElementById('qbo-man-'+clienteId);
  const qboId = sel && sel.value;
  if(!qboId){ Toast.show('Busca y elige el Customer de QuickBooks en la lista.','warn'); return; }
  const c = custTop.find(x=>String(x.qbo_customer_id)===String(qboId));
  vincular(clienteId, qboId, (c && c.display_name) || '', true, btn);
}

async function desvincular(clienteId){
  if(!await Modal.confirm({ title: 'Quitar vínculo', confirmLabel: 'Quitar', danger: true, message: '¿Quitar el vínculo con QuickBooks?' })) return;
  try{
    const user = firebase.auth().currentUser;
    await ClientesService.updateCliente(clienteId, {
      qbo_customer_id: firebase.firestore.FieldValue.delete(),
      qbo_customer_name: firebase.firestore.FieldValue.delete(),
      qbo_desvinculado_por: (user && (user.email || user.uid)) || null,
      qbo_desvinculado_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    const cl = clientes.find(x=>x.id===clienteId); if(cl){ delete cl.qbo_customer_id; delete cl.qbo_customer_name; }
    Toast.show('Vínculo quitado','ok'); render();
  }catch(e){ console.error(e); Toast.show('No se pudo desvincular','bad'); }
}

window.setVista=setVista; window.setFiltro=setFiltro; window.recargarQBO=recargarQBO;
window.vincular=vincular; window.vincularManual=vincularManual; window.desvincular=desvincular;

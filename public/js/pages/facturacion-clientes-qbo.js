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

  const rows = clientes.filter(c=>bucketDe(c)===vista)
    .sort((a,b)=>norm(a.empresa||a.nombre).localeCompare(norm(b.empresa||b.nombre)));
  if(!rows.length){ cont.innerHTML = emptyState('Sin clientes en esta vista.'); if(window.lucide) lucide.createIcons(); return; }
  cont.innerHTML = `
    <div class="app-table-wrap" style="border:none; box-shadow:none;">
      <table class="app-table">
        <thead><tr><th>Cliente</th><th>QuickBooks</th><th style="text-align:right;">Acción</th></tr></thead>
        <tbody>${rows.map(filaCliente).join('')}</tbody>
      </table>
    </div>`;
  if(window.lucide) lucide.createIcons();
}

function filaCliente(cl){
  const nombre = esc(cl.empresa || cl.nombre || '—');
  const tax = cl.ruc || cl.cedula || '';
  const cli = `<td><div style="font-weight:600;">${nombre}</div><div style="font-size:12px; color:var(--fg-3);">${tax?('RUC/CI: '+esc(tax)):'sin RUC'}</div></td>`;

  if(cl.qbo_customer_id){
    return `<tr>${cli}
      <td><span class="r-chip r-ok">✓ ${esc(cl.qbo_customer_name||'vinculado')}</span></td>
      <td style="text-align:right; white-space:nowrap;"><button class="btn btn-sm btn-ghost" onclick="desvincular('${cl.id}')"><i data-lucide="unlink"></i> Desvincular</button></td></tr>`;
  }
  const mi = matchInfo(cl);
  const cands = mi.custs;
  if(!cands.length){
    return `<tr>${cli}<td><span class="r-chip r-bad">sin match en QBO</span></td><td></td></tr>`;
  }
  const lista = cands.map(c=>`
    <div style="display:flex; align-items:center; gap:8px; margin:3px 0;">
      <button class="btn btn-sm btn-primary" onclick="vincular('${cl.id}','${c.qbo_customer_id}','${esc(c.display_name).replace(/'/g,"\\'")}')"><i data-lucide="link"></i> Vincular</button>
      <span style="font-size:13px;">${esc(c.display_name)}<span style="color:var(--fg-3); font-size:12px;">${c.ruc?(' · '+esc(c.ruc)):''} · saldo ${money(c.balance)}</span>${(mi.via==='ruc'&&!c._parecido)?' <span class="r-chip r-bad" title="RUC coincide pero el nombre no se parece — posible RUC errado en QBO">⚠ nombre distinto</span>':''}</span>
    </div>`).join('');
  let badge='';
  if(cands.length>1) badge += '<span class="r-chip r-warn">múltiples</span> ';
  if(mi.nombreDistinto) badge += '<span class="r-chip r-bad">verificar</span>';
  return `<tr>${cli}<td>${lista}</td><td style="text-align:right; white-space:nowrap;">${badge}</td></tr>`;
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

async function vincular(clienteId, qboId, qboName){
  try{
    await ClientesService.updateCliente(clienteId, { qbo_customer_id: qboId, qbo_customer_name: qboName });
    const cl = clientes.find(x=>x.id===clienteId); if(cl){ cl.qbo_customer_id=qboId; cl.qbo_customer_name=qboName; }
    Toast.show('Cliente vinculado','ok'); render();
  }catch(e){ console.error(e); Toast.show('No se pudo vincular','bad'); }
}
async function desvincular(clienteId){
  if(!window.confirm('¿Quitar el vínculo con QuickBooks?')) return;
  try{
    await ClientesService.updateCliente(clienteId, { qbo_customer_id: firebase.firestore.FieldValue.delete(), qbo_customer_name: firebase.firestore.FieldValue.delete() });
    const cl = clientes.find(x=>x.id===clienteId); if(cl){ delete cl.qbo_customer_id; delete cl.qbo_customer_name; }
    Toast.show('Vínculo quitado','ok'); render();
  }catch(e){ console.error(e); Toast.show('No se pudo desvincular','bad'); }
}

window.setVista=setVista; window.vincular=vincular; window.desvincular=desvincular;

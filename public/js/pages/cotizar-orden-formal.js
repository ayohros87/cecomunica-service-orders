// @ts-nocheck
const params = new URLSearchParams(location.search);
const ordenId = params.get('id');

firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user){ location.href='login.html'; return; }

  // === Empresa (perfil + ITBMS) ===
  let itbms = FMT.ITBMS_RATE;
  try{
    const ed = await EmpresaService.getDoc('perfil');
    if(ed){
      byId('empresa_nombre').innerText = ed.nombre_legal || 'C COMUNICA, S.A.';
      byId('firma_empresa').innerText = ed.nombre_legal || 'C COMUNICA, S.A.';
      byId('empresa_slogan').innerText = ed.slogan || '';
      byId('empresa_box').innerHTML = `
        <small>RUC: ${ed.ruc || '—'}</small>
        <small>Tel: ${ed.telefono || '—'} · Email: ${ed.email || '—'}</small>
        <small>Dirección: ${ed.direccion || '—'}</small>`;
    }
    const pr = await EmpresaService.getDoc('parametros');
    if(pr && typeof pr.itbms === 'number') itbms = pr.itbms;
  }catch(e){ console.warn('empresa',e); }
  byId('itbms_pct').innerText = (itbms*100).toFixed(0);

  // === Orden ===
  const od = await OrdenesService.getOrder(ordenId);
  if(!od){ byId('head').innerText='Orden no encontrada'; return; }

  // Encabezado
  const fecha = od.fecha_creacion?.toDate ? od.fecha_creacion.toDate().toISOString().slice(0,10) : '—';
  byId('head').innerHTML = `Orden <strong>${ordenId}</strong> · Fecha <strong>${fecha}</strong> ` +
    (od.cotizacion_emitida ? `· <span class="badge">Emitida</span>` : '');

  // Cliente
  let clienteNombre = od.cliente_nombre || od.cliente || '—';
  let clienteExtra = '';
  if(od.cliente_id){
    try{
      const cd = await ClientesService.getCliente(od.cliente_id);
      if(cd){
        clienteNombre = cd.nombre || clienteNombre;
        clienteExtra = [cd.representante, cd.telefono, cd.correo, cd.direccion].filter(Boolean).join(' · ');
      }
    }catch{}
  }
  byId('clienteBox').innerHTML = `<div><strong>${clienteNombre}</strong></div><div>${clienteExtra||''}</div>`;
  byId('ordenBox').innerHTML = `
    <div>Servicio: <strong>${od.tipo_de_servicio || '—'}</strong></div>
    <div>Estado: <strong>${(od.estado_reparacion||'').toUpperCase()}</strong></div>`;

  // === Consumos cobrables (una sola lectura) ===
  const rows = await OrdenesService.getConsumos(ordenId, { tipo: 'cobro' });

  // === Agrupar por equipo ===
  // Determina IDs de equipo (usa e.id o numero_de_serie)
  const equipos = Array.isArray(od.equipos) ? od.equipos.filter(e=>!e.eliminado) : [];
  const equipoKey = (e)=> e.id || e.numero_de_serie || 'X';
  const equiposById = {};
  equipos.forEach(e=>{ equiposById[equipoKey(e)] = e; });

  const porEquipo = {};
  rows.forEach(r=>{
    const eid = r.equipoId || 'X';
    if(!porEquipo[eid]) porEquipo[eid] = [];
    porEquipo[eid].push(r);
  });

  // === Render por equipo: tabla + notas cliente + miniaturas ===
  const cont = byId('contenido');
  cont.innerHTML = '';
  let subtotalGlobal = 0;

  for(const eid of Object.keys(porEquipo).sort()){
    const eq = equiposById[eid] || {};
    const titulo = `Equipo: Serie ${eq.numero_de_serie || eid} · Modelo ${eq.modelo || '—'}`;
    const registros = porEquipo[eid];

    // Agrupa por (nombre + sku + precio_unit) para compactar
    const key = r => `${r.pieza_nombre}||${r.sku||''}||${Number(r.precio_unit||0)}`;
    const grupos = {};
    registros.forEach(r=>{
      const k = key(r);
      if(!grupos[k]) grupos[k] = { nombre:r.pieza_nombre, sku:r.sku||'', precio:r.precio_unit||0, qty:0, subtotal:0 };
      grupos[k].qty += Number(r.qty||0);
      grupos[k].subtotal += Number(r.subtotal || (r.qty||0)*(r.precio_unit||0));
    });

    let html = `<h3 class="equipo">${titulo}</h3>
      <table>
        <thead><tr>
          <th>Descripción</th><th>SKU</th><th class="num">Cantidad</th><th class="num">Precio Unit.</th><th class="num">Subtotal</th>
        </tr></thead><tbody>`;

    let subtotalEquipo = 0;
    Object.values(grupos).forEach(g=>{
      subtotalEquipo += g.subtotal;
      html += `<tr>
        <td>${escapeHTML(g.nombre)}</td>
        <td>${g.sku||'-'}</td>
        <td class="num">${g.qty}</td>
        <td class="num">${fmt(g.precio)}</td>
        <td class="num">${fmt(g.subtotal)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    subtotalGlobal += subtotalEquipo;

    // Inserta bloque
    const section = document.createElement('section');
    section.innerHTML = html;
    cont.appendChild(section);

    // Notas del cliente
    try{
      const meta = await oRef.collection('equipos_meta').doc(eid).get();
      if(meta.exists && meta.data().notas_cliente){
        const n = document.createElement('div');
        n.className = 'nota-cli';
        n.innerHTML = `<strong>Nota para el cliente:</strong><br>${escapeHTML(meta.data().notas_cliente)}`;
        cont.appendChild(n);
      }
    }catch{}

    // Miniaturas de adjuntos (si hay)
    try{
      const listRef = firebase.storage().ref().child(`ordenes/${ordenId}/${eid}`);
      const res = await listRef.listAll();
      if(res.items.length){
        const div = document.createElement('div');
        div.className = 'thumbs';
        // Máximo 6 miniaturas para no saturar
        const first = res.items.slice(0,6);
        const urls = await Promise.all(first.map(x=>x.getDownloadURL()));
        urls.forEach(u=>{
          const a = document.createElement('a');
          a.href = u; a.target = '_blank'; a.rel='noopener';
          a.innerHTML = `<img src="${u}" alt="Adjunto">`;
          div.appendChild(a);
        });
        cont.appendChild(div);
      }
    }catch(e){ /* sin adjuntos */ }
  }

  setTotales(subtotalGlobal, itbms);

  // Cachea resumen (opcional)
  try{
    await oRef.set({
      cotizacion_resumen:{
        subtotal: round2(subtotalGlobal),
        itbms: round2(subtotalGlobal*itbms),
        total: round2(subtotalGlobal*(1+itbms)),
        items: rows.length,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
      }
    },{merge:true});
  }catch(e){ console.warn('No se pudo cachear cotizacion_resumen', e); }
});



// === Utilidades ===
function setTotales(sub, itbms){
  const t_itbms = round2(sub*itbms);
  const t_total = round2(sub + t_itbms);
  byId('t_subtotal').innerText = fmt(sub);
  byId('t_itbms').innerText = fmt(t_itbms);
  byId('t_total').innerText = fmt(t_total);
}
function fmt(n){ return '$' + Number(n||0).toFixed(2); }
function round2(n){ return Math.round(Number(n||0)*100)/100; }
function byId(x){ return document.getElementById(x); }
function escapeHTML(s=''){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

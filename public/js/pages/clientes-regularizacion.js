// @ts-nocheck
// Bandeja "Cuentas por regularizar" (plan docs/plans/PLAN_REGULARIZACION_CUENTAS.md
// §4.6, 2026-09-08). Solo admin y gerencia. Lee clientes.regularizacion (lo
// escribe el job); NO calcula nada. Acciones por fila: abrir ficha, asignar
// vendedor (las 57 cuentas sin dueño del censo), marcar "asistida" (admin la
// regulariza con el script de custodia por órdenes, no el vendedor a mano).
// Sin montos: no es información financiera.
window.ClientesRegularizacion = (() => {
  const esc = (s) => FMT.esc(s);
  const db = () => firebase.firestore();
  let rol = null, uid = null;
  let cuentas = [];
  let vendedores = [];
  let filtro = 'all';
  let vendedorSel = '';
  let busqueda = '';
  let abierto = null;

  const NIVEL_CLS = { critica: 'cg-chip--bad', por_regularizar: 'cg-chip--warn', leve: 'cg-chip--muted', al_dia: 'cg-chip--ok' };
  const toDate = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
  const dias = (v) => { const d = toDate(v); return d && !isNaN(d) ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null; };

  function init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return (window.location.href = '../login.html');
      uid = user.uid;
      try { const u = await UsuariosService.getUsuario(uid); rol = u?.rol || null; } catch (e) { rol = null; }
      if (![ROLES.ADMIN, ROLES.GERENTE].includes(rol)) {
        document.getElementById('rgRows').innerHTML = '<div class="rg-vacio">Esta bandeja es de administración y gerencia. El vendedor ve sus cuentas por regularizar en el inicio y en cada ficha.</div>';
        document.getElementById('rgChips').style.display = 'none';
        return;
      }
      wire();
      await cargar();
    });
  }

  function wire() {
    document.getElementById('rgChips').addEventListener('click', (e) => {
      const b = e.target.closest('.rg-chip'); if (!b) return;
      filtro = b.dataset.f;
      document.querySelectorAll('.rg-chip').forEach(x => x.classList.toggle('active', x === b));
      render();
    });
    document.getElementById('rgVendedor').addEventListener('change', (e) => { vendedorSel = e.target.value; render(); });
    let t = null;
    document.getElementById('rgBuscar').addEventListener('input', (e) => {
      clearTimeout(t); t = setTimeout(() => { busqueda = String(e.target.value || '').trim().toLowerCase(); render(); }, 150);
    });
    document.getElementById('rgRows').addEventListener('click', onRowsClick);
  }

  async function cargar() {
    const [snap, vs] = await Promise.all([
      db().collection('clientes').where('regularizacion.puntos', '>', 0).limit(500).get(),
      UsuariosService.getUsuariosByRol([ROLES.VENDEDOR, ROLES.ADMIN, ROLES.GERENTE]).catch(() => []),
    ]);
    cuentas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.deleted && c.regularizacion?.puntos > 0);
    vendedores = (vs || []).filter(v => v.email && !/@sin\.email$/i.test(v.email))
      .map(v => ({ uid: v.id || v.uid, email: v.email, nombre: v.nombre || v.email.split('@')[0] }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const sel = document.getElementById('rgVendedor');
    sel.innerHTML = '<option value="">Todos los vendedores</option><option value="__none__">Sin vendedor</option>'
      + vendedores.map(v => `<option value="${esc(v.uid)}">${esc(v.nombre)}</option>`).join('');
    render();
  }

  function pasa(c) {
    const r = c.regularizacion;
    if (filtro === 'critica' || filtro === 'por_regularizar' || filtro === 'leve') { if (r.nivel !== filtro) return false; }
    if (filtro === 'sin_vendedor' && c.vendedor_asignado) return false;
    if (filtro === 'exceden' && !r.excede_margen) return false;
    if (vendedorSel === '__none__' && c.vendedor_asignado) return false;
    if (vendedorSel && vendedorSel !== '__none__' && c.vendedor_asignado !== vendedorSel) return false;
    if (busqueda && !String(c.nombre || '').toLowerCase().includes(busqueda)) return false;
    return true;
  }

  function orden(a, b) {
    // Sin vendedor primero (nadie las ve); luego las que exceden; luego por deuda.
    const va = a.vendedor_asignado ? 1 : 0, vb = b.vendedor_asignado ? 1 : 0;
    if (va !== vb) return va - vb;
    const ea = a.regularizacion.excede_margen ? 0 : 1, eb = b.regularizacion.excede_margen ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return (b.regularizacion.puntos || 0) - (a.regularizacion.puntos || 0);
  }

  function render() {
    const cnt = { all: cuentas.length, critica: 0, por_regularizar: 0, leve: 0, sin_vendedor: 0, exceden: 0 };
    cuentas.forEach(c => {
      const r = c.regularizacion;
      if (cnt[r.nivel] !== undefined) cnt[r.nivel]++;
      if (!c.vendedor_asignado) cnt.sin_vendedor++;
      if (r.excede_margen) cnt.exceden++;
    });
    Object.entries(cnt).forEach(([k, v]) => { const el = document.querySelector(`[data-cnt="${k}"]`); if (el) el.textContent = v; });

    const vis = cuentas.filter(pasa).sort(orden);
    const puntos = vis.reduce((s, c) => s + (c.regularizacion.puntos || 0), 0);
    document.getElementById('rgResumen').textContent = vis.length
      ? `${vis.length} cuenta${vis.length === 1 ? '' : 's'} · ${puntos} punto${puntos === 1 ? '' : 's'} de deuda · ${vis.reduce((s, c) => s + (c.regularizacion.d1 || 0), 0)} radios sin contrato · ${vis.reduce((s, c) => s + (c.regularizacion.d2 || 0), 0)} contratos sin seriales`
      : '';
    const cont = document.getElementById('rgRows');
    if (!vis.length) { cont.innerHTML = '<div class="rg-vacio">Ninguna cuenta con este filtro.</div>'; return; }
    cont.innerHTML = vis.map(fila).join('');
    if (window.lucide?.createIcons) lucide.createIcons();
  }

  function fila(c) {
    const r = c.regularizacion;
    const open = abierto === c.id;
    const des = Regularizacion.desglose(r);
    const t2 = des.slice(0, 3).map(x => `${x.n} ${x.label}`).join(' · ');
    const vend = c.vendedor_email ? c.vendedor_email.split('@')[0] : '';
    const desde = dias(r.primera_marca_at) ?? dias(r.calculado_at);
    return `<div class="rg-row${open ? ' is-open' : ''}" data-id="${esc(c.id)}">
      <div class="rg-main" data-toggle="1">
        <span><span class="cg-chip ${NIVEL_CLS[r.nivel] || 'cg-chip--info'}">${esc(Regularizacion.NIVEL_LABEL[r.nivel] || r.nivel)}</span>
          ${r.etiqueta === 'migracion' ? '<span class="cg-chip cg-chip--muted" title="Deuda de contratos anteriores al sistema: es de la empresa, no sube la escalera">migración</span>' : ''}
          ${c.regularizacion_asistida ? '<span class="cg-chip cg-chip--info" title="La regulariza administración con el script de custodia por órdenes">asistida</span>' : ''}</span>
        <div class="rg-txt">
          <div class="rg-t1"><b>${esc(c.nombre || '—')}</b>${r.excede_margen ? ' · <span style="color:var(--cg-bad-deep,#991B1B); font-weight:600;">excede el margen</span>' : ''}</div>
          <div class="rg-t2">${esc(t2)}</div>
        </div>
        <span class="rg-vend${vend ? '' : ' none'}">${vend ? esc(vend) : 'sin vendedor'}</span>
        <span class="rg-num" title="Puntos de deuda · gestiones puntuales">${r.puntos}${r.gestiones_puntuales ? ` <span style="color:var(--fg-4);">· ${r.gestiones_puntuales} pt</span>` : ''}</span>
        <span class="rg-num" title="Días desde la primera marca">${desde == null ? '—' : desde === 0 ? 'hoy' : `${desde} d`}</span>
      </div>
      ${open ? detalle(c) : ''}
    </div>`;
  }

  function detalle(c) {
    const r = c.regularizacion;
    const des = Regularizacion.desglose(r);
    const ids = (x) => x.ids && x.ids.length ? `<div class="ids">${x.ids.slice(0, 60).map(esc).join(', ')}${x.ids.length > 60 ? ` … +${x.ids.length - 60}` : ''}</div>` : '';
    return `<div class="rg-det">
      <div>
        <ul>${des.map(x => `<li><b>${x.n}</b> ${esc(x.label)}${ids(x)}</li>`).join('')}</ul>
        <p style="margin:8px 0 0; font-size:12.5px; color:var(--fg-3);">
          ${r.gestiones_puntuales ? `${r.gestiones_puntuales} gestión${r.gestiones_puntuales === 1 ? '' : 'es'} puntual${r.gestiones_puntuales === 1 ? '' : 'es'} sobre esta deuda. ` : 'Sin gestiones puntuales todavía. '}
          Calculado ${r.calculado_at ? esc(FMT.datetime ? FMT.datetime(toDate(r.calculado_at)) : toDate(r.calculado_at).toLocaleString('es-PA')) : '—'}.
        </p>
      </div>
      <div class="rg-side">
        <a class="btn btn-primary" href="./centro.html?id=${encodeURIComponent(c.id)}"><i data-lucide="compass"></i> Abrir ficha</a>
        <label for="rgAs-${esc(c.id)}">Vendedor responsable</label>
        <div style="display:flex; gap:6px;">
          <select class="form-select" id="rgAs-${esc(c.id)}" style="flex:1;">
            <option value="">— sin vendedor —</option>
            ${vendedores.map(v => `<option value="${esc(v.uid)}" ${v.uid === c.vendedor_asignado ? 'selected' : ''}>${esc(v.nombre)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-ghost" data-asignar="${esc(c.id)}">Asignar</button>
        </div>
        <label class="cg-toggle" style="font-size:12.5px;">
          <input type="checkbox" data-asistida="${esc(c.id)}" ${c.regularizacion_asistida ? 'checked' : ''}> Regularización asistida por administración
        </label>
      </div>
    </div>`;
  }

  async function onRowsClick(e) {
    const asignar = e.target.closest('[data-asignar]');
    if (asignar) { await asignarVendedor(asignar.dataset.asignar); return; }
    const asistida = e.target.closest('[data-asistida]');
    if (asistida) { await marcarAsistida(asistida.dataset.asistida, asistida.checked); return; }
    if (e.target.closest('a, select, label, input, button')) return;
    const row = e.target.closest('.rg-row');
    if (!row || !e.target.closest('[data-toggle]')) return;
    abierto = abierto === row.dataset.id ? null : row.dataset.id;
    render();
  }

  async function asignarVendedor(id) {
    const sel = document.getElementById(`rgAs-${id}`);
    const v = vendedores.find(x => x.uid === sel?.value) || null;
    const c = cuentas.find(x => x.id === id); if (!c) return;
    try {
      await db().collection('clientes').doc(id).update({
        vendedor_asignado: v ? v.uid : null,
        vendedor_email: v ? v.email : null,
        // El home del vendedor lee regularizacion.vendedor_uid: se espeja ya,
        // sin esperar al barrido (que lo confirma en su siguiente pasada).
        'regularizacion.vendedor_uid': v ? v.uid : null,
        'regularizacion.vendedor_email': v ? v.email : null,
      });
      c.vendedor_asignado = v ? v.uid : null; c.vendedor_email = v ? v.email : null;
      c.regularizacion.vendedor_uid = c.vendedor_asignado; c.regularizacion.vendedor_email = c.vendedor_email;
      Toast.show(v ? `${c.nombre}: ahora la lleva ${v.nombre}` : `${c.nombre}: sin vendedor`, 'ok');
      render();
    } catch (err) { console.error(err); Toast.show('No se pudo asignar el vendedor', 'bad'); }
  }

  async function marcarAsistida(id, on) {
    const c = cuentas.find(x => x.id === id); if (!c) return;
    try {
      await db().collection('clientes').doc(id).update({
        regularizacion_asistida: on ? { at: firebase.firestore.FieldValue.serverTimestamp(), por_uid: uid } : firebase.firestore.FieldValue.delete(),
      });
      c.regularizacion_asistida = on ? { por_uid: uid } : null;
      Toast.show(on ? 'Marcada como regularización asistida' : 'Marca de asistida quitada', 'ok');
      render();
    } catch (err) { console.error(err); Toast.show('No se pudo guardar la marca', 'bad'); }
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render };
})();

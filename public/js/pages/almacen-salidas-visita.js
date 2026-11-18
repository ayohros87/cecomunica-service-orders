/* =============================================================
   Almacén · Hoy — Radios con técnicos (salida a visita).
   (Alberto, 2026-11-18, tras el caso MACELLO.)

   Bodega le entrega al técnico los radios que se lleva a una VISITA
   y los recibe de vuelta si no los usó. Mientras están afuera, el
   pool los marca `con_tecnico` (ni en el estante ni con un cliente).
   El que se deja con el cliente sale de aquí solo, cuando el técnico
   registra el cambio en sitio en la visita.

   Revisión del 2026-11-18: (1) la fila de una visita que YA CERRÓ con
   radios afuera sale en alerta ("Visita cerrada: faltan N") — antes nada
   distinguía un radio olvidado de uno en camino; (2) la hoja de salida
   ofrece las visitas abiertas con su técnico en vez de exigir el número
   de memoria; (3) una visita sin técnico o ya terminada no admite salida
   (el callable también lo rechaza).

   Todo pasa por el callable salidaRadiosVisita (bodega y admin).
   Pinta en #hoySalidas, encima de la bandeja; carga por su cuenta y,
   si falla, falla solo este bloque.
   ============================================================= */

window.AlmacenSalidasVisita = (() => {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const $ = (id) => document.getElementById(id);
  const ctx = { rol: '', radios: [], visitas: new Map() };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  // Mismo criterio que el callable: las visitas viejas terminaron en
  // ENTREGADO AL CLIENTE / COMPLETADO, no en CERRADA (VISITA).
  const terminada = (estado) => /^(CERRADA|ENTREGAD|COMPLETAD|ANULAD)/.test(norm(estado));
  const tecnicoDe = (o) => String(o?.tecnico_asignado || o?.tecnico_nombre || o?.tecnico || '').trim();
  const opera = () => ctx.rol === ROLES.ADMIN || ctx.rol === ROLES.INVENTARIO;
  const ms = (t) => t?.toMillis?.() ?? (t?.seconds ? t.seconds * 1000 : 0);
  const llamar = (data) => firebase.functions().httpsCallable('salidaRadiosVisita')(data).then(r => r.data);
  const seriales = (txt) => String(txt || '').split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);

  async function cargar() {
    const el = $('hoySalidas');
    if (!el) return;
    try {
      ctx.radios = await EquiposPoolService.listar({ estado: 'con_tecnico' });
      render();
      // El estado de cada visita (pocas): para marcar las que ya cerraron
      // con radios afuera. Si falla, la lista queda como estaba.
      const ids = [...new Set(ctx.radios.map(r => r.salida_visita?.orden_id).filter(Boolean))];
      if (ids.length) {
        const db = firebase.firestore();
        const snaps = await Promise.all(ids.map(id => db.collection('ordenes_de_servicio').doc(id).get().catch(() => null)));
        ctx.visitas = new Map(snaps.filter(s => s?.exists).map(s => [s.id, s.data() || {}]));
        render();
      }
    } catch (e) {
      console.warn('[Hoy] radios con técnicos:', e?.code || e);
      el.innerHTML = Bandeja.nota('No se pudieron leer los radios con técnicos.');
    }
  }

  function render() {
    const el = $('hoySalidas');
    if (!el) return;
    const porVisita = new Map();
    ctx.radios.forEach(r => {
      const k = r.salida_visita?.orden_id || '—';
      if (!porVisita.has(k)) porVisita.set(k, []);
      porVisita.get(k).push(r);
    });
    const filas = [...porVisita.entries()]
      .sort((a, b) => ms(a[1][0].salida_visita?.at) - ms(b[1][0].salida_visita?.at))
      .map(([visita, rs]) => {
        const sv = rs[0].salida_visita || {};
        const lista = rs.map(r => `<b style="font-family:var(--mono,monospace);">${esc(r.serial)}</b>${r.modelo_label ? ` <span style="color:var(--fg-3);">${esc(r.modelo_label)}</span>` : ''}`).join(' · ');
        const o = ctx.visitas.get(visita);
        const cerro = !!o && (o.eliminado === true || terminada(o.estado_reparacion));
        return Bandeja.fila({
          chip: cerro ? `Visita cerrada: falta${rs.length === 1 ? '' : 'n'} ${rs.length}` : `${rs.length} radio${rs.length === 1 ? '' : 's'}`,
          tono: cerro ? 'alerta' : 'info', at: ms(sv.at) || null,
          data: cerro ? { 'salida-cerrada': '1' } : null,
          txt: `<b>${esc(sv.tecnico || 'Técnico')}</b> · visita <a href="/ordenes/index.html?ids=${encodeURIComponent(visita)}">${esc(visita)}</a>${sv.cliente_nombre ? ` · ${esc(sv.cliente_nombre)}` : ''}<span style="display:block;white-space:normal;line-height:1.6;">${lista}</span>${cerro ? '<span style="display:block;white-space:normal;font-size:12.5px;color:#92400E;">La visita ya cerró y estos radios no se registraron ni como dejados con el cliente ni de vuelta. Pídeselos al técnico.</span>' : ''}`,
          ctaHtml: opera() ? Bandeja.cta({ label: 'Recibir de vuelta', icono: 'undo-2', ghost: true, data: { 'salida-devolver': visita } }) : '',
        });
      }).join('');
    const boton = opera() ? `<a class="btn btn-sm btn-accent" href="#" data-salida-nueva="1"><i data-lucide="log-out" style="width:14px;height:14px;"></i> Salida a visita</a>` : '';
    el.innerHTML = `<div class="bj-grupo">
      <h3 class="bj-grupo-t" style="display:flex;align-items:center;gap:8px;">Radios con técnicos <span class="bj-n">${ctx.radios.length}</span>
        <span style="margin-left:auto;">${boton}</span></h3>
      ${filas || `<p style="margin:0;font-size:13px;color:var(--fg-3);">Ningún radio fuera con un técnico. Si un técnico se lleva radios a una visita, regístralo con <b>Salida a visita</b>.</p>`}
    </div>`;
    if (window.lucide) lucide.createIcons();
  }

  async function leerVisita(id) {
    const s = await firebase.firestore().collection('ordenes_de_servicio').doc(id).get();
    if (!s.exists) return { error: `No existe la orden ${id}.` };
    const o = s.data() || {};
    const tipo = String(o.tipo_de_servicio || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    if (!tipo.includes('VISITA')) return { error: `La orden ${id} es ${o.tipo_de_servicio || 'sin tipo'}, no una visita técnica.` };
    if (o.eliminado === true || terminada(o.estado_reparacion)) return { error: `La visita ${id} ya está cerrada (${o.estado_reparacion || 'eliminada'}).` };
    if (!tecnicoDe(o)) return { error: `La visita ${id} no tiene técnico asignado. Pídele al taller que la asigne primero.` };
    return { o };
  }

  // Visitas abiertas con técnico, para elegir en vez de escribir el número.
  // Si la consulta falla, la hoja sigue sirviendo con el número a mano.
  async function visitasAbiertas() {
    try {
      const q = await firebase.firestore().collection('ordenes_de_servicio')
        .where('estado_reparacion', 'in', ['ASIGNADO', 'POR ASIGNAR']).get();
      return q.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(o => o.eliminado !== true && norm(o.tipo_de_servicio).includes('VISITA') && tecnicoDe(o))
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
    } catch (e) {
      console.warn('[Hoy] visitas abiertas:', e?.code || e);
      return [];
    }
  }

  function abrirSalida() {
    if (!opera()) return;
    let visita = null;
    Modal.sheet({
      title: 'Salida de radios a una visita', icon: 'log-out', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">
          Registra los radios que el técnico se lleva. Quedan <b>con el técnico</b> (no disponibles) hasta que
          los deje con el cliente —él lo registra en la visita— o los traiga de vuelta.</p>
        <label class="form-label" for="svVisita">Número de la visita *</label>
        <input id="svVisita" class="form-input" inputmode="numeric" autocomplete="off" placeholder="Ej.: 2026111801" list="svVisitas">
        <datalist id="svVisitas"></datalist>
        <div id="svAbiertas" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
        <p id="svInfo" style="margin:6px 0 0;font-size:13px;color:var(--fg-3);min-height:18px;"></p>
        <label class="form-label" for="svSeriales" style="margin-top:10px;">Seriales que se lleva * <span style="font-weight:400;color:var(--fg-3);">(uno por línea; sirve el escáner)</span></label>
        <textarea id="svSeriales" class="form-input" rows="5" spellcheck="false" style="text-transform:uppercase;font-family:var(--mono,monospace);min-height:120px;height:auto;"></textarea>
        <p id="svAviso" style="display:none;margin:8px 0 0;color:#b91c1c;font-size:13px;"></p>`,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Registrar salida', primary: true }],
      onMount: (root) => {
        const inp = root.querySelector('#svVisita'); const info = root.querySelector('#svInfo');
        visitasAbiertas().then(vs => {
          const dl = root.querySelector('#svVisitas'); const caja = root.querySelector('#svAbiertas');
          if (!dl || !caja || !vs.length) return;
          const rotulo = (o) => `${tecnicoDe(o)} · ${o.cliente_nombre || o.cliente || ''}`;
          dl.innerHTML = vs.map(o => `<option value="${esc(o.id)}">${esc(rotulo(o))}</option>`).join('');
          caja.innerHTML = `<span style="font-size:12.5px;color:var(--fg-3);align-self:center;">Visitas abiertas:</span>`
            + vs.slice(0, 8).map(o => `<button type="button" class="btn btn-sm btn-secondary" data-sv-visita="${esc(o.id)}" title="${esc(rotulo(o))}">${esc(o.id)} · ${esc(tecnicoDe(o))}</button>`).join('');
          caja.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-sv-visita]'); if (!b) return;
            inp.value = b.dataset.svVisita; inp.dispatchEvent(new Event('change'));
            root.querySelector('#svSeriales')?.focus();
          });
        });
        inp.addEventListener('change', async () => {
          visita = null; const id = inp.value.trim();
          if (!id) { info.textContent = ''; return; }
          info.textContent = 'Buscando…';
          const r = await leerVisita(id).catch(() => ({ error: 'Sin conexión.' }));
          if (r.error) { info.innerHTML = `<span style="color:#b91c1c;">${esc(r.error)}</span>`; return; }
          visita = id;
          info.innerHTML = `<b>${esc(r.o.cliente_nombre || r.o.cliente || 'Cliente')}</b> · técnico: <b>${esc(r.o.tecnico_asignado || r.o.tecnico || 'sin asignar')}</b>`;
        });
        setTimeout(() => inp.focus(), 50);
      },
      onAction: async (action, root) => {
        if (action !== 'ok') return null;
        const aviso = root.querySelector('#svAviso');
        const avisar = (m) => { aviso.textContent = m; aviso.style.display = ''; return false; };
        const id = root.querySelector('#svVisita').value.trim();
        if (!id) return avisar('Escribe el número de la visita.');
        if (visita !== id) { const r = await leerVisita(id).catch(() => ({ error: 'Sin conexión.' })); if (r.error) return avisar(r.error); visita = id; }
        const ss = seriales(root.querySelector('#svSeriales').value);
        if (!ss.length) return avisar('Escribe al menos un serial.');
        try {
          const r = await llamar({ accion: 'sacar', ordenId: id, seriales: ss });
          Toast.show(`${r.radios.length} radio${r.radios.length === 1 ? '' : 's'} con ${r.tecnico || 'el técnico'} (visita ${id}).`, 'ok');
          cargar();
          return 'ok';
        } catch (e) { return avisar(e?.message || 'No se pudo registrar la salida.'); }
      },
    });
  }

  function abrirDevolver(visita) {
    if (!opera()) return;
    const rs = ctx.radios.filter(r => r.salida_visita?.orden_id === visita);
    if (!rs.length) return;
    Modal.sheet({
      title: `Recibir radios de la visita ${visita}`, icon: 'undo-2', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">Marca los que el técnico <b>trajo de vuelta</b> sin usar: vuelven a bodega.
          Si dejó alguno con el cliente, no lo marques: él lo registra en la visita (menú ⋯ → "Registrar cambio de radio en sitio") y sale de esta lista solo.</p>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${rs.map(r => `<label style="display:flex;gap:8px;align-items:center;font-size:14px;">
            <input type="checkbox" name="svDev" value="${esc(r.serial)}" checked>
            <b style="font-family:var(--mono,monospace);">${esc(r.serial)}</b> <span style="color:var(--fg-3);">${esc(r.modelo_label || '')}</span></label>`).join('')}
        </div>
        <p id="svAviso2" style="display:none;margin:8px 0 0;color:#b91c1c;font-size:13px;"></p>`,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Volvieron a bodega', primary: true }],
      onAction: async (action, root) => {
        if (action !== 'ok') return null;
        const aviso = root.querySelector('#svAviso2');
        const ss = [...root.querySelectorAll('input[name="svDev"]:checked')].map(i => i.value);
        if (!ss.length) { aviso.textContent = 'Marca al menos uno.'; aviso.style.display = ''; return false; }
        try {
          await llamar({ accion: 'devolver', ordenId: visita, seriales: ss });
          Toast.show(`${ss.length} radio${ss.length === 1 ? '' : 's'} de vuelta en bodega.`, 'ok');
          cargar();
          return 'ok';
        } catch (e) { aviso.textContent = e?.message || 'No se pudo registrar.'; aviso.style.display = ''; return false; }
      },
    });
  }

  function init(rol) {
    ctx.rol = rol;
    const el = $('hoySalidas');
    if (!el) return;
    el.addEventListener('click', (ev) => {
      const nueva = ev.target.closest('[data-salida-nueva]');
      const dev = ev.target.closest('[data-salida-devolver]');
      if (nueva) { ev.preventDefault(); abrirSalida(); }
      else if (dev) { ev.preventDefault(); abrirDevolver(dev.dataset.salidaDevolver); }
    });
    cargar();
  }

  return { init, cargar };
})();

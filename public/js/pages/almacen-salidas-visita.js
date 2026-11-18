/* =============================================================
   Almacén · Hoy — Radios con técnicos (salida a visita).
   (Alberto, 2026-11-18, tras el caso MACELLO.)

   Bodega le entrega al técnico los radios que se lleva a una VISITA
   y los recibe de vuelta si no los usó. Mientras están afuera, el
   pool los marca `con_tecnico` (ni en el estante ni con un cliente).
   El que se deja con el cliente sale de aquí solo, cuando el técnico
   registra el cambio en sitio en la visita.

   Todo pasa por el callable salidaRadiosVisita (bodega y admin).
   Pinta en #hoySalidas, encima de la bandeja; carga por su cuenta y,
   si falla, falla solo este bloque.
   ============================================================= */

window.AlmacenSalidasVisita = (() => {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const $ = (id) => document.getElementById(id);
  const ctx = { rol: '', radios: [] };
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
        return Bandeja.fila({
          chip: `${rs.length} radio${rs.length === 1 ? '' : 's'}`, tono: 'info', at: ms(sv.at) || null,
          txt: `<b>${esc(sv.tecnico || 'Técnico')}</b> · visita <a href="/ordenes/index.html?ids=${encodeURIComponent(visita)}">${esc(visita)}</a>${sv.cliente_nombre ? ` · ${esc(sv.cliente_nombre)}` : ''}<span style="display:block;white-space:normal;line-height:1.6;">${lista}</span>`,
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
    if (String(o.estado_reparacion || '').toUpperCase().startsWith('CERRADA')) return { error: `La visita ${id} ya está cerrada.` };
    return { o };
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
        <input id="svVisita" class="form-input" inputmode="numeric" autocomplete="off" placeholder="Ej.: 2026111801">
        <p id="svInfo" style="margin:6px 0 0;font-size:13px;color:var(--fg-3);min-height:18px;"></p>
        <label class="form-label" for="svSeriales" style="margin-top:10px;">Seriales que se lleva * <span style="font-weight:400;color:var(--fg-3);">(uno por línea; sirve el escáner)</span></label>
        <textarea id="svSeriales" class="form-input" rows="5" spellcheck="false" style="text-transform:uppercase;font-family:var(--mono,monospace);min-height:120px;height:auto;"></textarea>
        <p id="svAviso" style="display:none;margin:8px 0 0;color:#b91c1c;font-size:13px;"></p>`,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Registrar salida', primary: true }],
      onMount: (root) => {
        const inp = root.querySelector('#svVisita'); const info = root.querySelector('#svInfo');
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

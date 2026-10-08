// @ts-nocheck
// Centro de gestión de clientes — Selector de seriales compartido.
// Auditoría de módulos 2026-09-30 (05-centro-clientes, P4): los wizards de
// reemplazo, baja, cambio de serial y renovación listaban TODA la flota del
// cliente sin buscador (AGENCIA: 273 filas, 50 "No disponible" primero; la
// renovación medía 18,956 px). Para reemplazar UN radio había que leer la
// tabla entera y marcar la fila correcta.
//
// Aquí vive la pieza común: un buscador (serial, modelo o contrato), las
// filas agrupadas por contrato con cabecera plegable, "No disponible" al
// final y cerrado, y el conteo de lo marcado (o de lo que falta por decidir)
// en cada grupo. Cada wizard sigue siendo dueño de sus celdas, sus
// data-attributes (data-wsel, data-bsel, data-cssel, data-wcp…) y su lógica
// de guardar: esto solo decide QUÉ FILAS SE VEN. Con más de SS_COLAPSA_DESDE
// radios los grupos arrancan cerrados: se teclean 4 caracteres o se abre el
// contrato que toca.
//
// Uso:
//   const { barra, cuerpo } = this._ssHtml('wr', filas, { colspan: 5 });
//   …`${barra}<table><tbody data-sscuerpo="wr">${cuerpo}</tbody></table>`…
//   this._ssMontar('wr');          // tras pintar (y tras cada repintado)
// filas: [{ grupo, grupoLabel, orden, grupoAbierto, ok, busca, trAttrs, celdas, cfgAttrs, cfg }]
//   grupo/grupoLabel  clave y título del grupo (contrato); ok:false → "No disponible"
//   busca             texto donde se busca (serial, modelo, contrato)
//   celdas            los <td> de la fila; cfg (opcional) los <td> de la fila de
//                     configuración que la sigue (motivo, modelo…), con sus attrs
// opts: { colspan, modo: 'checks' | 'destinos', placeholder, marcarTodos, accionesGrupo(k) }
Object.assign(window.Centro, {
  SS_COLAPSA_DESDE: 8,
  _ss: {},

  _ssNorm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  },
  _ssReset(id) { delete this._ss[id]; },

  _ssHtml(id, filas, opts = {}) {
    const esc = (v) => this.esc(v);
    const prev = this._ss[id];
    const st = { term: prev?.term || '', abiertos: prev?.abiertos || null, opts: { colspan: 5, modo: 'checks', ...opts } };
    this._ss[id] = st;
    const grupos = new Map();
    for (const f of filas) {
      const nd = f.ok === false;
      const k = nd ? '__nd' : (f.grupo || '__sin');
      if (!grupos.has(k)) {
        grupos.set(k, { k, nd, label: nd ? 'No disponible' : (f.grupoLabel || 'Sin contrato'),
          orden: nd ? 9e9 : (f.orden ?? (k === '__sin' ? 8e9 : 0)), abrir: !!f.grupoAbierto, filas: [] });
      }
      grupos.get(k).filas.push(f);
    }
    const lista = [...grupos.values()].sort((a, b) => a.orden - b.orden || a.label.localeCompare(b.label));
    const total = filas.length;
    const colapsa = total > this.SS_COLAPSA_DESDE;
    if (!st.abiertos) st.abiertos = {};
    for (const g of lista) if (!(g.k in st.abiertos)) st.abiertos[g.k] = g.nd ? false : (g.abrir || !colapsa);
    st.grupos = lista.map(g => ({ k: g.k, label: g.label, n: g.filas.length, nd: g.nd }));

    const cuerpo = lista.map(g => {
      const abierto = !!st.abiertos[g.k];
      const acciones = g.nd ? ''
        : st.opts.accionesGrupo ? st.opts.accionesGrupo(g.k)
        : st.opts.marcarTodos ? `<button type="button" class="btn btn-ghost cg-act" style="padding:1px 8px; font-size:12px;" onclick="Centro._ssMarcarGrupo('${esc(id)}','${esc(g.k)}')">Marcar todos</button>` : '';
      const cab = `<tr class="cg-ssg" data-ssgh="${esc(g.k)}" data-abierto="${abierto ? 1 : 0}"><td colspan="${st.opts.colspan}" style="padding:6px 12px; background:var(--surface-sunken, #EEF2F6);${g.nd ? ' color:var(--fg-3);' : ''}">
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button type="button" onclick="Centro._ssToggle('${esc(id)}','${esc(g.k)}')" aria-expanded="${abierto}"
            style="background:none; border:0; padding:2px 0; font:inherit; font-weight:600; color:inherit; cursor:pointer; display:inline-flex; gap:6px; align-items:center;">
            <span data-ssflecha style="display:inline-block; width:1em; text-align:center;">${abierto ? '▾' : '▸'}</span>${esc(g.label)}
            <span style="font-weight:400; color:var(--fg-3);">· ${g.filas.length} radio${g.filas.length === 1 ? '' : 's'}</span>
            <span data-ssmarc style="font-weight:400;"></span></button>
          ${acciones}
        </div></td></tr>`;
      const h = abierto ? '' : ' hidden';
      const filasHtml = g.filas.map(f =>
        `<tr data-ssg="${esc(g.k)}" data-busca="${esc(this._ssNorm(f.busca))}" ${f.trAttrs || ''}${h}>${f.celdas}</tr>`
        + (f.cfg ? `<tr data-ssg="${esc(g.k)}" data-sscfg ${f.cfgAttrs || ''}${h}>${f.cfg}</tr>` : '')).join('');
      return cab + filasHtml;
    }).join('');

    const barra = `<div class="cg-ss" data-ss="${esc(id)}" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:0 0 8px;">
      <input class="form-input" data-ssq type="search" autocomplete="off" value="${esc(st.term)}" aria-label="Buscar serial, modelo o contrato"
        placeholder="${esc(st.opts.placeholder || 'Buscar serial, modelo o contrato…')}" style="max-width:260px;"
        oninput="Centro._ssFiltrar('${esc(id)}', this.value)">
      <span data-ssres style="font-size:12.5px; color:var(--fg-3); flex:1; min-width:180px;"></span>
      <button type="button" class="btn btn-ghost cg-act" data-sstodo onclick="Centro._ssAbrirTodo('${esc(id)}')">Abrir todo</button>
    </div>`;
    return { barra, cuerpo, total, grupos: lista.length };
  },

  _ssRaiz(id) {
    return document.querySelector(`#cgModal [data-sscuerpo="${id}"]`) || document.querySelector(`[data-sscuerpo="${id}"]`);
  },
  _ssBarra(id) {
    return document.querySelector(`#cgModal [data-ss="${id}"]`) || document.querySelector(`[data-ss="${id}"]`);
  },

  // Tras pintar: engancha el conteo de marcados y aplica el filtro/plegado.
  _ssMontar(id) {
    const tb = this._ssRaiz(id);
    if (!tb) return;
    if (!tb.dataset.ssWired) {
      tb.dataset.ssWired = '1';
      tb.addEventListener('change', () => this._ssContar(id));
    }
    const q = this._ssBarra(id)?.querySelector('[data-ssq]');
    if (q && q.value !== (this._ss[id]?.term || '')) q.value = this._ss[id]?.term || '';
    this._ssAplicar(id);
  },

  _ssFiltrar(id, term) {
    const st = this._ss[id];
    if (!st) return;
    st.term = String(term || '');
    this._ssAplicar(id);
  },

  _ssToggle(id, k) {
    const st = this._ss[id];
    if (!st) return;
    st.abiertos[k] = !st.abiertos[k];
    // Al abrir un grupo a mano se deja de filtrar: se quiere VER ese grupo.
    if (st.abiertos[k] && st.term) { st.term = ''; const q = this._ssBarra(id)?.querySelector('[data-ssq]'); if (q) q.value = ''; }
    this._ssAplicar(id);
  },

  _ssAbrirTodo(id) {
    const st = this._ss[id];
    if (!st) return;
    const hayCerrado = st.grupos.some(g => !st.abiertos[g.k]);
    st.grupos.forEach(g => { st.abiertos[g.k] = hayCerrado; });
    if (st.term) { st.term = ''; const q = this._ssBarra(id)?.querySelector('[data-ssq]'); if (q) q.value = ''; }
    this._ssAplicar(id);
  },

  // Pre-marcar filas que vienen de la selección hecha en la pestaña Equipos
  // de la ficha (2026-10-08): `pares` = [{ inp, on }] con el checkbox de cada
  // fila y el handler que el wizard corre al marcarla a mano. Abre el grupo
  // de cada una para que se VEA lo que llegó marcado.
  _ssPreMarcar(id, pares) {
    const st = this._ss[id];
    if (!st || !pares.length) return;
    for (const { inp, on } of pares) {
      if (!inp || inp.disabled) continue;
      inp.checked = true;
      try { on?.(); } catch (e) { console.warn('[centro] premarcar:', e?.message || e); }
      const k = inp.closest('tr[data-ssg]')?.dataset.ssg;
      if (k) st.abiertos[k] = true;
    }
    this._ssAplicar(id);
  },

  // Marca (checkbox) todas las filas disponibles de un grupo: dispara change
  // para que el wizard abra sus filas de configuración como si fuera a mano.
  _ssMarcarGrupo(id, k) {
    const tb = this._ssRaiz(id);
    if (!tb) return;
    tb.querySelectorAll(`tr[data-ssg="${k}"]:not([data-sscfg]) input[type=checkbox]:not(:disabled)`).forEach(c => {
      if (c.checked) return;
      c.checked = true;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    });
    this._ssContar(id);
  },

  _ssCoincide(busca, palabras) {
    const sinEspacios = busca.replace(/ /g, '');
    return palabras.every(p => busca.includes(p) || sinEspacios.includes(p));
  },

  // Qué filas se ven: con término, las que coinciden (y sus grupos); sin
  // término, las de los grupos abiertos. Las filas de configuración siguen a
  // su fila (su propia clase .hidden la maneja el wizard).
  _ssAplicar(id) {
    const st = this._ss[id];
    const tb = this._ssRaiz(id);
    if (!st || !tb) return;
    const palabras = this._ssNorm(st.term).split(' ').filter(Boolean);
    const filtrando = palabras.length > 0;
    const porGrupo = {};
    let coinciden = 0, principal = null, visiblePrincipal = false;
    for (const tr of tb.querySelectorAll('tr[data-ssg]')) {
      const k = tr.dataset.ssg;
      if (tr.hasAttribute('data-sscfg')) { tr.hidden = !visiblePrincipal; continue; }
      principal = tr;
      const ok = filtrando ? this._ssCoincide(tr.dataset.busca || '', palabras) : !!st.abiertos[k];
      if (filtrando && ok) { coinciden++; porGrupo[k] = (porGrupo[k] || 0) + 1; }
      tr.hidden = !ok;
      visiblePrincipal = ok;
    }
    void principal;
    for (const h of tb.querySelectorAll('tr[data-ssgh]')) {
      const k = h.dataset.ssgh;
      const abierto = filtrando ? (porGrupo[k] || 0) > 0 : !!st.abiertos[k];
      h.hidden = filtrando && !(porGrupo[k] > 0);
      h.dataset.abierto = abierto ? '1' : '0';
      const f = h.querySelector('[data-ssflecha]'); if (f) f.textContent = abierto ? '▾' : '▸';
      const b = h.querySelector('button[aria-expanded]'); if (b) b.setAttribute('aria-expanded', String(abierto));
    }
    const res = this._ssBarra(id)?.querySelector('[data-ssres]');
    if (res) {
      const total = st.grupos.reduce((s, g) => s + g.n, 0);
      const nd = st.grupos.find(g => g.nd)?.n || 0;
      const contratos = st.grupos.filter(g => !g.nd).length;
      const cerrados = st.grupos.some(g => !st.abiertos[g.k]);
      res.textContent = filtrando
        ? (coinciden ? `${coinciden} coincide${coinciden === 1 ? '' : 'n'} con “${st.term.trim()}”` : `Nada coincide con “${st.term.trim()}”`)
        : `${total} radio${total === 1 ? '' : 's'} en ${contratos} grupo${contratos === 1 ? '' : 's'}${nd ? ` · ${nd} no disponible${nd === 1 ? '' : 's'}` : ''}${cerrados && total > this.SS_COLAPSA_DESDE ? ' — escribe el serial o abre un contrato' : ''}`;
    }
    const todo = this._ssBarra(id)?.querySelector('[data-sstodo]');
    if (todo) todo.textContent = st.grupos.some(g => !st.abiertos[g.k]) ? 'Abrir todo' : 'Cerrar todo';
    this._ssContar(id);
  },

  // "· n marcados" (checks) o "· n sin destino" (destinos) en cada cabecera.
  _ssContar(id) {
    const st = this._ss[id];
    const tb = this._ssRaiz(id);
    if (!st || !tb) return;
    for (const h of tb.querySelectorAll('tr[data-ssgh]')) {
      const k = h.dataset.ssgh;
      const el = h.querySelector('[data-ssmarc]');
      if (!el) continue;
      const filas = tb.querySelectorAll(`tr[data-ssg="${k}"]:not([data-sscfg])`);
      if (st.opts.modo === 'destinos') {
        let faltan = 0;
        filas.forEach(tr => { const s = tr.querySelector('select[data-wcp]'); if (s && !s.value) faltan++; });
        el.textContent = faltan ? `· ${faltan} sin destino` : (filas.length ? '· listo' : '');
        el.style.color = faltan ? 'var(--warn-deep, #92400E)' : 'var(--ok-deep, #17714B)';
      } else {
        let n = 0;
        filas.forEach(tr => { if (tr.querySelector('input[type=checkbox]:checked')) n++; });
        el.textContent = n ? `· ${n} marcado${n === 1 ? '' : 's'}` : '';
        el.style.color = 'var(--accent)';
      }
    }
  },
});

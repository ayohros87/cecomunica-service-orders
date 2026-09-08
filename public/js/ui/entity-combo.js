// @ts-nocheck
// EntityCombo — combo buscable de una entidad (cliente, modelo…): filtra por
// subcadena sin acentos, todas las palabras en cualquier orden, con rango
// (empieza-por > contiene > otros campos), teclado ↑/↓/PgUp/PgDn/Home/End/
// Enter/Esc, resaltado de lo escrito, restaurar-al-salir y aviso de
// truncado (2026-09-08, F3 de "Bandejas y pickers"). Es el combo de cliente
// del editor de cotizaciones (cot-editor-state.mountClienteCombo)
// generalizado; los otros tres autocompletes de cliente se montan sobre él.
//
//   EntityCombo.montar(host, {
//     items: [...] | null,            // lista local, o
//     buscar: async (q) => items,     // búsqueda remota (debounce 180 ms)
//     recientes: () => items,         // se muestran con la caja vacía (opcional)
//     id: (it) => it.id, label: (it) => it.razon, sub: (it) => 'RUC …',
//     campos: (it) => [it.razon, it.ruc, it.representante],  // el primero es el principal
//     onSelect: (id, item) => {}, selectedId, placeholder, limite: 50,
//     inputId, input (adoptar un <input> existente), lista (un contenedor existente),
//     vacio: (q) => html,             // contenido cuando no hay coincidencias
//     autoFocus,
//   }) → { value, item, set(id), setItems(items), focus(), input, clear() }
//
//   EntityCombo.filtrar(items, query, { campos, limite }) → { items, total, tokens }
window.EntityCombo = (() => {
  const RE_DIACRITICOS = /[̀-ͯ]/g;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  function normBusq(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(RE_DIACRITICOS, '').toLowerCase().trim();
  }

  // Todas las palabras de la consulta deben aparecer. Las de 1–2 letras solo
  // valen contra el campo principal (si no, la "g" de "hotel g" calza con el
  // MIGUEL de un representante). Rango: empieza-por (0) > contiene en el
  // principal (1) > primera palabra en el principal (2) > solo otros campos (3).
  function filtrar(items, query, { campos = (it) => [it.label], limite = 50 } = {}) {
    const lista = Array.isArray(items) ? items : [];
    const q = normBusq(query);
    if (!q) return { items: lista.slice(0, limite), total: lista.length, tokens: [] };
    const tokens = q.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const it of lista) {
      const cs = (campos(it) || []).map(normBusq);
      const principal = cs[0] || '';
      const heno = cs.join(' ');
      if (!tokens.every((t) => (t.length < 3 ? principal : heno).includes(t))) continue;
      const rango = principal.startsWith(q) ? 0
        : principal.includes(q) ? 1
          : principal.includes(tokens[0]) ? 2 : 3;
      hits.push({ it, rango, principal });
    }
    hits.sort((a, b) => a.rango - b.rango || a.principal.localeCompare(b.principal, 'es'));
    return { items: hits.slice(0, limite).map((h) => h.it), total: hits.length, tokens };
  }

  // Resalta lo escrito sin correr un regex sobre HTML ya escapado.
  function resaltar(texto, tokens) {
    const t = String(texto == null ? '' : texto);
    if (!tokens || !tokens.length) return esc(t);
    const re = new RegExp('(' + tokens.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return t.split(re).map((trozo, i) => (i % 2 ? `<mark>${esc(trozo)}</mark>` : esc(trozo))).join('');
  }

  function montar(host, opts = {}) {
    const cont = typeof host === 'string' ? document.getElementById(host) : host;
    if (!cont && !opts.input) return null;
    const idDe = opts.id || ((it) => it.id);
    const labelDe = opts.label || ((it) => it.label ?? it.razon ?? it.nombre ?? '');
    const subDe = opts.sub || (() => '');
    const campos = opts.campos || ((it) => [labelDe(it)]);
    const limite = opts.limite || 50;
    const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : () => {};
    const remota = typeof opts.buscar === 'function';

    let items = Array.isArray(opts.items) ? opts.items : [];
    let byId = Object.create(null);
    const indexar = () => { byId = Object.create(null); items.forEach((it) => { const k = idDe(it); if (k != null) byId[k] = it; }); };
    indexar();

    let idSel = opts.selectedId || '';
    let vistos = [];
    let idx = -1;
    let abierto = false;
    let timer = null;

    // Modo "adoptar": el input y la lista ya existen en la página.
    let inp, list;
    if (opts.input) {
      inp = opts.input;
      list = opts.lista || (() => {
        const l = document.createElement('div');
        l.className = 'combo-list'; l.setAttribute('role', 'listbox'); l.hidden = true;
        const padre = inp.parentElement;
        if (padre && getComputedStyle(padre).position === 'static') padre.style.position = 'relative';
        inp.insertAdjacentElement('afterend', l);
        return l;
      })();
      inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-expanded', 'false');
      inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('autocomplete', 'off'); inp.setAttribute('spellcheck', 'false');
    } else {
      cont.style.position = 'relative';
      cont.innerHTML = `
        <input type="text" class="form-input" role="combobox" aria-expanded="false"
               aria-autocomplete="list" autocomplete="off" spellcheck="false"
               data-combo-busqueda="1"${opts.inputId ? ` id="${esc(opts.inputId)}"` : ''}
               placeholder="${esc(opts.placeholder || 'Escribe para buscar…')}">
        <div class="combo-list" role="listbox" hidden></div>`;
      inp = cont.querySelector('input');
      list = cont.querySelector('.combo-list');
    }

    const etiqueta = (id) => (byId[id] ? labelDe(byId[id]) : '');
    const panel = (cont || inp).closest ? (cont || inp).closest('.cc-panel') : null;

    function pintar(lista, total, tokens, query) {
      vistos = lista;
      idx = lista.length ? 0 : -1;
      if (!lista.length) {
        list.innerHTML = typeof opts.vacio === 'function'
          ? opts.vacio(query)
          : `<div class="combo-empty">Ninguna coincidencia con “${esc(query)}”.</div>`;
      } else {
        list.innerHTML = lista.map((it, i) => {
          const id = idDe(it);
          const sub = subDe(it);
          return `
          <div class="combo-item${i === idx ? ' active' : ''}" role="option" data-id="${esc(id)}"
               aria-selected="${String(id) === String(idSel) ? 'true' : 'false'}">
            <span class="combo-item-label">${resaltar(labelDe(it), tokens)}</span>
            ${sub ? `<span class="combo-sub">${esc(sub)}</span>` : ''}
          </div>`;
        }).join('') + (total > lista.length
          ? `<div class="combo-hint">Mostrando ${lista.length} de ${total} · escribe más para afinar</div>` : '');
      }
      abrir();
    }

    function pintarLista(query) {
      const q = normBusq(query);
      if (!q && typeof opts.recientes === 'function') {
        const rec = opts.recientes() || [];
        if (rec.length) { rec.forEach((it) => { const k = idDe(it); if (k != null && !byId[k]) byId[k] = it; }); pintar(rec, rec.length, [], query); return; }
      }
      if (remota) {
        if (!q) { cerrar(); return; }
        clearTimeout(timer);
        list.innerHTML = '<div class="combo-empty">Buscando…</div>'; abrir();
        timer = setTimeout(async () => {
          let res = [];
          try { res = await opts.buscar(query); } catch (e) { console.warn('[EntityCombo] búsqueda:', e?.message || e); }
          res = Array.isArray(res) ? res : [];
          res.forEach((it) => { const k = idDe(it); if (k != null) byId[k] = it; });
          pintar(res.slice(0, limite), res.length, q.split(/\s+/).filter(Boolean), query);
        }, 180);
        return;
      }
      const { items: lista, total, tokens } = filtrar(items, query, { campos, limite });
      pintar(lista, total, tokens, query);
    }

    function abrir() {
      list.hidden = false; abierto = true;
      inp.setAttribute('aria-expanded', 'true');
      if (panel) panel.classList.add('cc-panel-combo-abierto');
    }
    function cerrar() {
      list.hidden = true; abierto = false; idx = -1;
      inp.setAttribute('aria-expanded', 'false');
      if (panel) panel.classList.remove('cc-panel-combo-abierto');
    }
    // Al salir sin elegir, el texto vuelve a la selección vigente (si hay).
    function restaurar() { if (idSel) inp.value = etiqueta(idSel) || inp.value; }

    function mover(paso) {
      if (!abierto) { pintarLista(''); return; }
      if (!vistos.length) return;
      idx = Math.max(0, Math.min(vistos.length - 1, idx + paso));
      const nodos = list.querySelectorAll('.combo-item');
      nodos.forEach((n, i) => n.classList.toggle('active', i === idx));
      if (nodos[idx]) nodos[idx].scrollIntoView({ block: 'nearest' });
    }

    function elegir(id) {
      idSel = id || '';
      inp.value = etiqueta(idSel);
      cerrar();
      onSelect(idSel, byId[idSel] || null);
    }

    inp.addEventListener('focus', () => { inp.select(); pintarLista(inp.value === etiqueta(idSel) ? '' : inp.value); });
    inp.addEventListener('input', () => {
      // Escribir invalida la selección previa: la página lo sabe por onSelect('').
      if (idSel && inp.value !== etiqueta(idSel)) { idSel = ''; onSelect('', null); }
      pintarLista(inp.value);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'PageDown') { e.preventDefault(); mover(5); }
      else if (e.key === 'PageUp') { e.preventDefault(); mover(-5); }
      else if (e.key === 'Home' && abierto) { e.preventDefault(); mover(-vistos.length); }
      else if (e.key === 'End' && abierto) { e.preventDefault(); mover(vistos.length); }
      else if (e.key === 'Enter') {
        if (abierto && idx >= 0 && vistos[idx]) { e.preventDefault(); elegir(idDe(vistos[idx])); }
      } else if (e.key === 'Escape') { restaurar(); cerrar(); }
    });
    inp.addEventListener('blur', () => {
      // El mousedown de la lista ya seleccionó; este timeout deja que ocurra.
      setTimeout(() => { if (abierto) { restaurar(); cerrar(); } }, 150);
    });
    list.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.combo-item');
      if (!it) return;
      e.preventDefault();
      elegir(it.dataset.id);
    });

    if (idSel) inp.value = etiqueta(idSel);
    if (opts.autoFocus) inp.focus();

    return {
      get value() { return idSel; },
      get item() { return byId[idSel] || null; },
      set(id) { idSel = id || ''; inp.value = etiqueta(idSel); },
      setItems(nuevos) { items = Array.isArray(nuevos) ? nuevos : []; indexar(); if (abierto) pintarLista(inp.value); },
      clear() { idSel = ''; inp.value = ''; cerrar(); },
      focus() { inp.focus(); },
      input: inp,
    };
  }

  return { montar, filtrar, normBusq, resaltar };
})();

// @ts-nocheck
// FilteredSelect — un <select> con una caja de filtro delante: escribir
// repinta las opciones y, si queda UNA, se auto-selecciona y dispara `change`
// (2026-09-08, F3 de "Bandejas y pickers"). Era el mismo algoritmo copiado en
// nueva-orden (cliente), nueva-consola POC (cliente) y el asistente de
// recibir (modelo).
//
//   FilteredSelect.montar({
//     select, filtro,                 // elementos (o ids)
//     items: [{ id, label, ...}],     // o setItems() después
//     id: (it) => it.id, label: (it) => it.label,
//     placeholder: 'Seleccione…',
//     opcion: (it, option) => {}      // decorar la <option> (data-attrs)
//   }) → { setItems(items), repintar(), select, filtro }
window.FilteredSelect = (() => {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const el = (x) => (typeof x === 'string' ? document.getElementById(x) : x);

  function montar({ select, filtro, items = [], id = (it) => it.id, label = (it) => it.label, placeholder = 'Seleccione…', opcion = null } = {}) {
    const sel = el(select);
    const inp = el(filtro);
    if (!sel) return null;
    let lista = Array.isArray(items) ? items : [];

    function repintar(q = inp ? inp.value : '') {
      const k = norm(q);
      const actual = sel.value;
      const vis = k ? lista.filter((it) => norm(label(it)).includes(k)) : lista;
      sel.innerHTML = '';
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = placeholder; sel.appendChild(ph);
      vis.forEach((it) => {
        const o = document.createElement('option');
        o.value = id(it); o.textContent = label(it);
        if (typeof opcion === 'function') opcion(it, o);
        sel.appendChild(o);
      });
      if (actual && vis.some((it) => String(id(it)) === String(actual))) {
        sel.value = actual;
      } else if (k && vis.length === 1) {
        // Un único resultado → se auto-selecciona y dispara change (como un clic).
        sel.value = id(vis[0]);
        sel.dispatchEvent(new Event('change'));
      } else {
        sel.value = '';
        if (actual) sel.dispatchEvent(new Event('change'));
      }
    }

    if (inp && !inp._fsWired) { inp.addEventListener('input', (e) => repintar(e.target.value)); inp._fsWired = true; }
    repintar();
    return { setItems(nuevos) { lista = Array.isArray(nuevos) ? nuevos : []; repintar(); }, repintar, select: sel, filtro: inp };
  }

  return { montar, norm };
})();

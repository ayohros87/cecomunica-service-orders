// @ts-nocheck
// EntityPicker — elegir uno o varios elementos de una lista agrupada, con
// buscador, contador, tope de cupos por grupo y selección automática
// (2026-09-08, F3 de "Bandejas y pickers"). Antes el mismo patrón existía
// nueve veces con prefijos distintos; el picker del estante era el único con
// cupos y auto-selección. Corre sobre Modal.sheet (una hoja, trampa de foco).
//
//   EntityPicker.abrir({
//     titulo, icono, size: 'lg', descripcion (html),
//     grupos: [{ id, titulo, cupos?, items: [{ id, label, sub?, data? }] }],
//     buscar: true, normalizar: (s) => s (identidad tolerante del buscador),
//     multiple: true, autoSeleccion: true (botón "Selección automática"),
//     extraHtml (formulario encima de la lista), leerExtra(root) → obj|false,
//     confirmar: 'Asignar seleccionados', iconoConfirmar: 'check',
//     vacioGrupo: 'Sin elementos',
//   }) → Promise<{ seleccion: [{ grupo, id, label, data }], extra } | null>
window.EntityPicker = (() => {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const toast = (m, k) => { if (window.Toast) Toast.show(m, k); };

  async function abrir({
    titulo = 'Seleccionar', icono = 'list-checks', size = 'lg', descripcion = '',
    grupos = [], buscar = true, normalizar = (s) => String(s || '').trim().toLowerCase(),
    multiple = true, autoSeleccion = false, extraHtml = '', leerExtra = null,
    confirmar = 'Aceptar', iconoConfirmar = 'check', cancelar = 'Cancelar',
    vacioGrupo = 'Sin elementos.', placeholderBuscar = 'Filtrar…', mono = true,
  } = {}) {
    if (typeof Modal === 'undefined' || !Modal.sheet) throw new Error('EntityPicker requiere Modal.sheet');
    const tipo = multiple ? 'checkbox' : 'radio';
    const gruposHtml = grupos.map((g, gi) => {
      const filas = (g.items || []).map(it => `
        <label class="ep-item" data-q="${esc(normalizar(`${it.label} ${it.sub || ''}`))}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border-subtle,#eee);cursor:pointer;font-size:13px;">
          <input type="${tipo}" class="ep-check" name="ep-sel" value="${esc(it.id)}" data-grupo="${gi}" style="width:16px;height:16px;">
          <span class="ep-label" style="${mono ? 'font-family:var(--font-mono,monospace);' : ''}">${esc(it.label)}</span>
          ${it.sub ? `<span style="margin-left:auto;color:var(--fg-3);font-size:12px;">${esc(it.sub)}</span>` : ''}
        </label>`).join('');
      const cupos = Number(g.cupos || 0);
      return `
        <div class="ep-grupo" data-grupo="${gi}" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0;">
            <div style="font-weight:600;">${esc(g.titulo)}</div>
            <div class="ep-progreso" style="color:var(--fg-3);font-size:12px;">${cupos ? `0/${cupos} · ` : ''}${(g.items || []).length} disponible(s)</div>
          </div>
          ${(g.items || []).length
            ? `<div style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:8px;overflow:hidden;">${filas}</div>`
            : `<div style="border:1px dashed var(--border-subtle,#e5e7eb);border-radius:8px;padding:10px;color:var(--fg-3);font-size:13px;">${esc(vacioGrupo)}</div>`}
        </div>`;
    }).join('');

    const html = `
      ${descripcion ? `<p style="margin:0 0 10px;font-size:13px;color:var(--fg-3);">${descripcion}</p>` : ''}
      ${extraHtml || ''}
      ${buscar ? `<input type="search" class="form-input ep-buscar" placeholder="${esc(placeholderBuscar)}" style="width:100%;margin-bottom:8px;height:36px;${mono ? 'font-family:var(--font-mono,monospace);' : ''}">` : ''}
      <div class="ep-count" style="position:sticky;top:-24px;z-index:2;margin:0 -24px 10px;padding:6px 24px;background:var(--surface-card,#fff);border-bottom:1px solid var(--border-subtle,#EEF2F6);font-size:13px;font-weight:600;color:var(--fg-2);">Sin selección</div>
      ${gruposHtml}`;

    let root = null;
    const refrescar = () => {
      let total = 0;
      grupos.forEach((g, gi) => {
        const n = root.querySelectorAll(`.ep-check[data-grupo="${gi}"]:checked`).length;
        total += n;
        const el = root.querySelector(`.ep-grupo[data-grupo="${gi}"] .ep-progreso`);
        const cupos = Number(g.cupos || 0);
        if (el) el.textContent = `${cupos ? `${n}/${cupos} · ` : ''}${(g.items || []).length} disponible(s)`;
      });
      const c = root.querySelector('.ep-count');
      if (c) {
        let txt = total ? `${total} seleccionado(s)` : 'Sin selección';
        const q = root.querySelector('.ep-buscar')?.value;
        if (q && normalizar(q)) {
          const vis = [...root.querySelectorAll('.ep-item')].filter(i => i.style.display !== 'none').length;
          txt += vis ? ` · ${vis} coincidencia(s)` : ' · sin coincidencias';
        }
        c.textContent = txt;
      }
    };

    const r = await Modal.sheet({
      title: titulo, icon: icono, size, html,
      buttons: [
        ...(autoSeleccion && multiple ? [{ action: 'auto', label: 'Selección automática', icon: 'list-checks' }] : []),
        { action: 'cerrar', label: cancelar },
        { action: 'aplicar', label: confirmar, primary: true, icon: iconoConfirmar },
      ],
      onMount: (el) => {
        root = el;
        el.addEventListener('change', (e) => {
          const chk = e.target;
          if (!chk.classList || !chk.classList.contains('ep-check')) return;
          const gi = Number(chk.getAttribute('data-grupo'));
          const g = grupos[gi];
          const cupos = Number(g?.cupos || 0);
          if (chk.checked && cupos && el.querySelectorAll(`.ep-check[data-grupo="${gi}"]:checked`).length > cupos) {
            chk.checked = false;
            toast(`${g.titulo}: solo hay ${cupos} cupo(s).`, 'warn');
          }
          refrescar();
        });
        el.querySelector('.ep-buscar')?.addEventListener('input', (e) => {
          const q = normalizar(e.target.value);
          el.querySelectorAll('.ep-item').forEach(item => {
            item.style.display = (!q || (item.getAttribute('data-q') || '').includes(q)) ? '' : 'none';
          });
          // Un grupo sin coincidencias se esconde entero (los ya marcados siguen contando).
          el.querySelectorAll('.ep-grupo').forEach(g => {
            const alguno = [...g.querySelectorAll('.ep-item')].some(i => i.style.display !== 'none');
            g.style.display = (!q || alguno) ? '' : 'none';
          });
          refrescar();
        });
        refrescar();
      },
      onAction: (act, el) => {
        if (act === 'cerrar') return null;
        if (act === 'auto') {
          grupos.forEach((g, gi) => {
            const cupos = Number(g.cupos || 0) || (g.items || []).length;
            const checks = [...el.querySelectorAll(`.ep-check[data-grupo="${gi}"]`)];
            let n = checks.filter(c => c.checked).length;
            for (const c of checks) {
              if (n >= cupos) break;
              if (!c.checked) { c.checked = true; n++; }
            }
          });
          refrescar();
          return false;
        }
        if (act === 'aplicar') {
          const seleccion = [...el.querySelectorAll('.ep-check:checked')].map(c => {
            const gi = Number(c.getAttribute('data-grupo'));
            const g = grupos[gi] || {};
            const it = (g.items || []).find(x => String(x.id) === c.value) || { id: c.value, label: c.value };
            return { grupo: g.id ?? gi, grupoTitulo: g.titulo, id: it.id, label: it.label, data: it.data || null };
          });
          if (!seleccion.length) { toast('Marca al menos un elemento.', 'warn'); return false; }
          let extra = null;
          if (typeof leerExtra === 'function') {
            extra = leerExtra(el);
            if (extra === false) return false;   // el formulario extra rechazó (ya avisó)
          }
          return { seleccion, extra };
        }
        return false;
      },
    });
    return r && typeof r === 'object' ? r : null;
  }

  return { abrir };
})();

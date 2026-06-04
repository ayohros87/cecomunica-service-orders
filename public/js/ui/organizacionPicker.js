/**
 * organizacionPicker.js — Combobox reutilizable para elegir o crear una
 * organización (matriz) al dar de alta/editar un cliente.
 *
 * Drop-in: inyecta su propio CSS una sola vez y no depende de nada salvo
 * OrganizacionesService (debe cargarse antes). Pensado para reutilizarse en
 * el form compartido de cliente y en cualquier otro módulo que cree clientes,
 * evitando duplicar la lógica.
 *
 *   const picker = OrganizacionPicker.mount(containerEl, { onChange });
 *   picker.setValue({ id, nombre });   // precargar (ej. al editar)
 *   picker.getValue();                 // => { id: '', nombre: '' } si sin org
 *   picker.clear();
 */
(function (global) {
  'use strict';

  function injectStyles() {
    if (document.getElementById('org-picker-styles')) return;
    const css = `
      .org-picker { position: relative; }
      .org-picker-control { display: flex; align-items: center; gap: 6px; }
      .org-picker-clear {
        flex: 0 0 auto; border: none; background: none; cursor: pointer;
        color: var(--fg-3, #64748b); padding: 4px; line-height: 0; border-radius: 6px;
      }
      .org-picker-clear:hover { background: var(--bg-2, #eef2f6); color: var(--fg-1, #0f172a); }
      .org-picker-clear[hidden] { display: none; }
      .org-picker-menu {
        position: absolute; z-index: 40; left: 0; right: 0; top: calc(100% + 4px);
        background: #fff; border: 1px solid var(--border, #e2e8f0); border-radius: 8px;
        box-shadow: 0 8px 24px rgba(15,23,42,.12); max-height: 260px; overflow-y: auto; padding: 4px;
      }
      .org-picker-menu[hidden] { display: none; }
      .org-picker-opt {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 14px;
      }
      .org-picker-opt:hover, .org-picker-opt.active { background: var(--bg-2, #f1f5f9); }
      .org-picker-opt-ruc { color: var(--fg-3, #64748b); font-size: 12px; font-family: var(--font-mono, monospace); }
      .org-picker-create { color: var(--brand, #0B2A47); font-weight: 600; }
      .org-picker-empty { padding: 10px; color: var(--fg-3, #64748b); font-size: 13px; }
    `;
    const el = document.createElement('style');
    el.id = 'org-picker-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function esc(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function debounce(fn, ms) {
    let t = null;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  const OrganizacionPicker = {
    mount(container, { onChange = () => {}, placeholder = 'Buscar o crear organización…' } = {}) {
      injectStyles();
      const Svc = global.OrganizacionesService;

      let selected = { id: '', nombre: '' };
      let matches = [];

      container.classList.add('org-picker');
      container.innerHTML = `
        <div class="org-picker-control">
          <input type="text" class="form-input org-picker-input" placeholder="${esc(placeholder)}" autocomplete="off">
          <button type="button" class="org-picker-clear" hidden title="Quitar organización" aria-label="Quitar organización">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="org-picker-menu" hidden></div>`;

      const input = container.querySelector('.org-picker-input');
      const menu = container.querySelector('.org-picker-menu');
      const clearBtn = container.querySelector('.org-picker-clear');
      if (global.lucide) lucide.createIcons();

      function commit(val) {
        selected = { id: val.id || '', nombre: val.nombre || '' };
        input.value = selected.nombre;
        clearBtn.hidden = !selected.id;
        closeMenu();
        onChange({ ...selected });
      }
      function closeMenu() { menu.hidden = true; menu.innerHTML = ''; }

      function renderMenu() {
        const term = input.value.trim();
        const termNorm = Svc.norm(term);
        const exact = matches.find(m => (m.nombre_norm || Svc.norm(m.nombre)) === termNorm);
        let html = '';
        for (const m of matches) {
          html += `<div class="org-picker-opt" data-id="${esc(m.id)}" data-nombre="${esc(m.nombre)}">
              <span>${esc(m.nombre)}</span>
              ${m.ruc ? `<span class="org-picker-opt-ruc">RUC ${esc(m.ruc)}</span>` : ''}
            </div>`;
        }
        if (term && !exact) {
          html += `<div class="org-picker-opt org-picker-create" data-create="1">
              <span>➕ Crear organización “${esc(term)}”</span>
            </div>`;
        }
        if (!html) html = `<div class="org-picker-empty">Escribe para buscar o crear una organización.</div>`;
        menu.innerHTML = html;
        menu.hidden = false;

        menu.querySelectorAll('.org-picker-opt[data-id]').forEach(el => {
          el.addEventListener('mousedown', e => {
            e.preventDefault();
            commit({ id: el.dataset.id, nombre: el.dataset.nombre });
          });
        });
        const createEl = menu.querySelector('[data-create]');
        if (createEl) createEl.addEventListener('mousedown', async e => {
          e.preventDefault();
          await crearOrganizacion(term);
        });
      }

      async function crearOrganizacion(nombre) {
        const n = (nombre || '').trim();
        if (!n) return;
        try {
          const norm = Svc.norm(n);
          // Si ya existe una con ese nombre, selecciónala en vez de duplicar.
          if (await Svc.existsActiveByNorm('nombre_norm', norm)) {
            const all = await Svc.getAllOrgs();
            const found = all.find(o => (o.nombre_norm || Svc.norm(o.nombre)) === norm);
            if (found) { commit({ id: found.id, nombre: found.nombre }); return; }
          }
          const user = global.firebase ? firebase.auth().currentUser : null;
          const payload = Svc.buildOrgPayload({ nombre: n }, { user, isCreate: true });
          const id = await Svc.createOrg(payload);
          commit({ id, nombre: n });
          if (global.Toast) Toast.show(`Organización “${n}” creada`, 'ok');
        } catch (err) {
          console.error('Error creando organización:', err);
          if (global.Toast) Toast.show('No se pudo crear la organización.', 'bad');
        }
      }

      const buscar = debounce(async () => {
        const term = input.value.trim();
        if (!term) { matches = []; closeMenu(); return; }
        try {
          const { docs } = await Svc.listOrgsPage({ term: Svc.norm(term), limit: 8 });
          matches = docs;
        } catch (err) {
          console.error('Error buscando organizaciones:', err);
          matches = [];
        }
        renderMenu();
      }, 280);

      input.addEventListener('input', () => {
        // Al editar el texto, la selección previa deja de ser válida hasta reconfirmar.
        if (selected.id && input.value.trim() !== selected.nombre) {
          selected = { id: '', nombre: '' };
          clearBtn.hidden = true;
          onChange({ ...selected });
        }
        buscar();
      });
      input.addEventListener('focus', () => { if (input.value.trim()) buscar(); });
      input.addEventListener('blur', () => {
        // Restaura el display al valor comprometido (evita guardar texto sin seleccionar).
        setTimeout(() => { input.value = selected.nombre; closeMenu(); }, 120);
      });
      clearBtn.addEventListener('click', () => commit({ id: '', nombre: '' }));

      return {
        getValue() { return { ...selected }; },
        setValue(val) {
          selected = { id: (val && val.id) || '', nombre: (val && val.nombre) || '' };
          input.value = selected.nombre;
          clearBtn.hidden = !selected.id;
        },
        clear() { commit({ id: '', nombre: '' }); },
      };
    },
  };

  global.OrganizacionPicker = OrganizacionPicker;
})(window);

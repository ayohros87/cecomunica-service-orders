// @ts-nocheck
/* ========================================
 * ORDENES PRESETS — saved filter combinations
 * Stores named filter presets in localStorage keyed by URL search
 * string. Pairs with the URL filter state from §5.4: "save current"
 * captures `location.search`, "load" sets it via history.pushState
 * and re-applies via _applyURLToFilters + aplicarFiltrosCombinados.
 * ORDENES_INDEX_IMPROVEMENTS.md §5.2.
 * ======================================== */

window.OrdenesPresets = (() => {
  const STORAGE_KEY = 'ordenes:filter-presets:v1';
  const MAX_PRESETS = 20;

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[OrdenesPresets] load failed', e);
      return [];
    }
  }

  function _save(presets) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
    } catch (e) {
      console.warn('[OrdenesPresets] save failed', e);
    }
  }

  function list() {
    return _load();
  }

  function add(name, params) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const presets = _load();
    // Replace by name if it already exists — predictable for "Guardar"
    // when the user re-uses a name to update an existing preset.
    const idx = presets.findIndex(p => p.name === trimmed);
    const entry = {
      id: 'preset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name: trimmed,
      params: String(params || ''),
      createdAt: Date.now()
    };
    if (idx >= 0) presets[idx] = { ...presets[idx], ...entry, id: presets[idx].id };
    else presets.unshift(entry);
    _save(presets);
    return entry;
  }

  function remove(id) {
    const presets = _load().filter(p => p.id !== id);
    _save(presets);
  }

  return { list, add, remove };
})();

/**
 * Render the presets dropdown contents based on current localStorage state.
 * Called whenever the menu opens or after a save/remove.
 */
function _renderPresetsMenu() {
  const menu = document.getElementById('presetsMenu');
  if (!menu) return;

  const presets = OrdenesPresets.list();

  const itemsHtml = presets.length
    ? presets.map(p => `
        <div class="overflow-menu-item preset-item" data-stop-propagation="true">
          <button class="preset-load" data-action="cargar-preset" data-preset-id="${p.id}" title="Cargar preset">
            <i data-lucide="bookmark"></i>
            <span class="preset-name">${escapeHtml(p.name)}</span>
          </button>
          <button class="preset-delete" data-action="eliminar-preset" data-preset-id="${p.id}" title="Eliminar preset" aria-label="Eliminar preset">
            <i data-lucide="x"></i>
          </button>
        </div>`).join('')
    : '<div class="overflow-menu-item preset-item--empty">Sin presets guardados</div>';

  menu.innerHTML = `
    <button class="overflow-menu-item" data-action="guardar-preset" data-stop-propagation="true">
      <i data-lucide="plus"></i> Guardar filtros actuales…
    </button>
    <div class="overflow-menu-divider"></div>
    ${itemsHtml}
  `;
  APP.utils.lucideRefresh(menu);
}
window._renderPresetsMenu = _renderPresetsMenu;

window.togglePresetsMenu = function () {
  const menu = document.getElementById('presetsMenu');
  const btn = document.querySelector('[data-action="toggle-presets-menu"]');
  if (!menu) return;

  // Close any other overflow menus that are open.
  document.querySelectorAll('.overflow-menu-dropdown.show').forEach(m => {
    if (m.id !== 'presetsMenu') m.classList.remove('show');
  });

  const willOpen = !menu.classList.contains('show');
  if (willOpen) _renderPresetsMenu();
  menu.classList.toggle('show', willOpen);
  if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
};

window.guardarPresetActual = async function () {
  // Capture filters from the URL — this requires §5.4's _syncFiltersToURL
  // to have already run, which it does on every filter mutation.
  const params = (location.search || '').replace(/^\?/, '');
  if (!params) {
    Toast.show('No hay filtros activos para guardar', 'warn');
    return;
  }
  const name = await Modal.prompt({
    title: 'Guardar preset',
    message: 'Nombre del preset (p. ej. "Pendientes de hoy", "Mis vencidas")',
    placeholder: 'Nombre',
    confirmLabel: 'Guardar'
  });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    Toast.show('Nombre requerido', 'bad');
    return;
  }
  OrdenesPresets.add(trimmed, params);
  Toast.show('✅ Preset guardado', 'ok');
  _renderPresetsMenu();
};

window.cargarPreset = function (presetId) {
  const presets = OrdenesPresets.list();
  const p = presets.find(x => x.id === presetId);
  if (!p) return;
  // Push (not replace) so the user can navigate back to whatever was
  // showing before applying the preset.
  const newUrl = location.pathname + (p.params ? `?${p.params}` : '') + location.hash;
  history.pushState(null, '', newUrl);
  if (typeof _applyURLToFilters === 'function') _applyURLToFilters();
  if (typeof aplicarFiltrosCombinados === 'function') aplicarFiltrosCombinados();
  // Close menu after load.
  const menu = document.getElementById('presetsMenu');
  if (menu) menu.classList.remove('show');
  const btn = document.querySelector('[data-action="toggle-presets-menu"]');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  Toast.show(`📂 Preset "${p.name}" aplicado`, 'ok');
};

window.eliminarPreset = function (presetId) {
  OrdenesPresets.remove(presetId);
  _renderPresetsMenu();
};

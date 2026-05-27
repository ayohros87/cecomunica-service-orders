/* ─── App UI Kit — shared demo behaviors ──────────────────────────
   Loaded by every demo page (index, foundations, ordenes, poc, contratos).
   Functions are defined unconditionally but only act on elements that
   exist on the current page, so it's safe to share across all kits.
   ──────────────────────────────────────────────────────────────── */

lucide.createIcons();

// ── Sortable column headers ──────────────────────────────────────
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const parent = th.closest('thead');
    parent.querySelectorAll('th.sortable').forEach(t => {
      if (t !== th) { t.classList.remove('sort-asc','sort-desc'); }
    });
    if (th.classList.contains('sort-asc')) {
      th.classList.replace('sort-asc','sort-desc');
    } else {
      th.classList.remove('sort-desc');
      th.classList.add('sort-asc');
    }
  });
});

// ── Filter chip toggle ───────────────────────────────────────────
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.closest('.filter-chips').querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

// ── Toast ────────────────────────────────────────────────────────
const TOASTS = {
  success: { title:'Acción completada', desc:'La operación se guardó correctamente.', icon:'check-circle' },
  error:   { title:'Error al guardar', desc:'No se pudo conectar con el servidor.', icon:'x-circle' },
  warning: { title:'Atención', desc:'Hay datos pendientes de revisión.', icon:'alert-triangle' },
  info:    { title:'Información', desc:'Operación registrada.', icon:'info' },
};
function showToast(type) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const d = TOASTS[type] || TOASTS.info;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon"><i data-lucide="${d.icon}"></i></div>
    <div class="toast-body">
      <div class="toast-title">${d.title}</div>
      <div class="toast-desc">${d.desc}</div>
    </div>
    <button class="toast-close" aria-label="Cerrar"><i data-lucide="x"></i></button>
  `;
  el.querySelector('.toast-close').addEventListener('click', () => el.remove());
  region.appendChild(el);
  lucide.createIcons({ nodes: [el] });
  setTimeout(() => el.remove(), 5000);
}

// Static toast-close buttons inside demo blocks
document.querySelectorAll('.toast-close').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.toast').remove());
});

// ── File zone drag feedback ──────────────────────────────────────
document.querySelectorAll('.form-file-zone').forEach(zone => {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); });
  zone.addEventListener('click', () => zone.querySelector('input[type="file"]').click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') zone.querySelector('input[type="file"]').click(); });
});

// ── Active demo-nav link on scroll ───────────────────────────────
(function() {
  const sections = document.querySelectorAll('.demo-section');
  const navLinks = document.querySelectorAll('.demo-nav a');
  if (!sections.length || !navLinks.length) return;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active'));
        const link = document.querySelector(`.demo-nav a[href="#${entry.target.id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(s => observer.observe(s));
})();

// ── Accordion ────────────────────────────────────────────────────
document.querySelectorAll('.accordion-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    const isOpen = item.classList.contains('open');
    const body = document.getElementById(trigger.getAttribute('aria-controls'));
    item.classList.toggle('open', !isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
    if (body) body.style.display = isOpen ? 'none' : 'block';
  });
});

// ── Photo lightbox ───────────────────────────────────────────────
let lightboxIndex = 0;
const lightboxTotalPhotos = 4;
function openLightbox(idx) {
  lightboxIndex = idx;
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.style.display = 'flex';
  document.getElementById('lightbox-caption').textContent = `Foto ${idx + 1} de ${lightboxTotalPhotos}`;
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  lb.style.display = 'none';
  document.body.style.overflow = '';
}
function lightboxNav(dir) {
  lightboxIndex = (lightboxIndex + dir + lightboxTotalPhotos) % lightboxTotalPhotos;
  const cap = document.getElementById('lightbox-caption');
  if (cap) cap.textContent = `Foto ${lightboxIndex + 1} de ${lightboxTotalPhotos}`;
}
document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox');
  if (lb && lb.style.display === 'flex') {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
  }
});

// ── Inline CRUD list ─────────────────────────────────────────────
function editCrudItem(btn) {
  const item = btn.closest('.crud-list-item');
  const isEditing = item.classList.contains('editing');
  if (isEditing) {
    const input = item.querySelector('.crud-list-item-input');
    item.querySelector('.crud-list-item-label').textContent = input.value;
    item.classList.remove('editing');
    btn.querySelector('i').setAttribute('data-lucide', 'pencil');
    lucide.createIcons({ nodes: [btn] });
  } else {
    item.classList.add('editing');
    item.querySelector('.crud-list-item-input').focus();
    btn.querySelector('i').setAttribute('data-lucide', 'check');
    lucide.createIcons({ nodes: [btn] });
  }
}
function addCrudItem() {
  const input = document.getElementById('crud-new-item');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  const list = document.getElementById('crud-list-demo');
  const item = document.createElement('div');
  item.className = 'crud-list-item';
  item.innerHTML = `
    <span class="crud-list-item-handle"><i data-lucide="grip-vertical"></i></span>
    <span style="flex-shrink:0; width:6px;"></span>
    <span class="crud-list-item-label">${val}</span>
    <input class="crud-list-item-input" value="${val}" aria-label="Editar nombre">
    <div class="crud-list-item-actions">
      <button class="btn btn-ghost btn-icon btn-sm" aria-label="Editar" onclick="editCrudItem(this)"><i data-lucide="pencil"></i></button>
      <button class="btn btn-ghost btn-icon btn-sm" aria-label="Eliminar" onclick="this.closest('.crud-list-item').remove()"><i data-lucide="trash-2"></i></button>
    </div>`;
  list.appendChild(item);
  lucide.createIcons({ nodes: [item] });
  input.value = '';
  input.focus();
}

// ── Signature pad ────────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('sig-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false;
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }
  canvas.addEventListener('mousedown', e => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('mousemove', e => { if (!drawing) return; const p = getPos(e); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0B2A47'; ctx.lineTo(p.x, p.y); ctx.stroke(); });
  canvas.addEventListener('mouseup', () => drawing = false);
  canvas.addEventListener('mouseleave', () => drawing = false);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0B2A47'; ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
  canvas.addEventListener('touchend', () => drawing = false);
})();

function clearSig() {
  const canvas = document.getElementById('sig-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('sig-pad-demo').classList.remove('confirmed');
  document.getElementById('sig-confirm-btn').disabled = false;
}
function confirmSig() {
  document.getElementById('sig-pad-demo').classList.add('confirmed');
  document.getElementById('sig-confirm-btn').disabled = true;
  showToast('success');
}

// ── Combobox demo ────────────────────────────────────────────────
const COMBO_DATA = [
  { label: 'Portafolio Digital S.A.', sub: 'RUC 888-888-888 · Rosa Murillo' },
  { label: 'Soluciones Omega Corp', sub: 'RUC 777-777-777 · Luis Castillo' },
  { label: 'Radio Chiriquí S.A.', sub: 'RUC 666-555-444 · Ana González' },
  { label: 'Tech Panama Pty Ltd', sub: 'RUC 123-456-789 · Carlos Ramos' },
  { label: 'Comunicaciones del Istmo', sub: 'RUC 321-654-987 · Marta López' },
];
let comboActive = -1;
function demoComboFilter(val) {
  const list = document.getElementById('combo-list-demo');
  const input = document.getElementById('combo-demo-input');
  if (!list || !input) return;
  const q = val.trim().toLowerCase();
  const results = q ? COMBO_DATA.filter(d => d.label.toLowerCase().includes(q) || d.sub.toLowerCase().includes(q)) : COMBO_DATA.slice(0, 4);
  if (!results.length) {
    list.innerHTML = `<div class="combo-empty">Sin resultados para "<strong>${val}</strong>"</div>`;
  } else {
    list.innerHTML = results.map((d, i) => `
      <div class="combo-item" role="option" tabindex="-1" data-idx="${i}" onclick="demoComboSelect('${d.label}')">
        <span class="combo-item-label">${d.label}</span>
        <span class="combo-sub">${d.sub}</span>
      </div>`).join('');
  }
  list.hidden = false;
  comboActive = -1;
  lucide.createIcons({ nodes: [list] });
  input.onkeydown = (e) => {
    const items = list.querySelectorAll('.combo-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); comboActive = Math.min(comboActive + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('active', i === comboActive)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); comboActive = Math.max(comboActive - 1, 0); items.forEach((it, i) => it.classList.toggle('active', i === comboActive)); }
    if (e.key === 'Enter' && comboActive >= 0) { demoComboSelect(items[comboActive].dataset.idx >= 0 ? COMBO_DATA[comboActive]?.label : ''); }
    if (e.key === 'Escape') list.hidden = true;
  };
}
function demoComboSelect(label) {
  document.getElementById('combo-demo-input').value = label;
  document.getElementById('combo-list-demo').hidden = true;
}
document.addEventListener('click', e => {
  const box = document.getElementById('combobox-demo');
  if (box && !box.contains(e.target)) {
    const list = document.getElementById('combo-list-demo');
    if (list) list.hidden = true;
  }
});

// ── Conditional disclosure ───────────────────────────────────────
function demoDisclosure(val) {
  ['renovacion', 'traslado'].forEach(k => {
    const el = document.getElementById(`disc-panel-${k}`);
    if (el) el.classList.toggle('visible', val === k);
  });
}
function demoSubDisclosure(val) {
  const el = document.getElementById('disc-sub-panel');
  if (el) el.classList.toggle('visible', val === 'si');
}

// ── Details block — live summary update ──────────────────────────
function updateDetailsSummary() {
  const nombre = (document.getElementById('det-nombre')?.value || '').trim();
  const cargo  = (document.getElementById('det-cargo')?.value || '').trim();
  const liveEl = document.getElementById('det-live-1');
  if (!liveEl) return;
  if (nombre) {
    liveEl.innerHTML = ` &mdash; <strong>${nombre}</strong>${cargo ? ` &middot; ${cargo}` : ''}`;
  } else {
    liveEl.textContent = ' — completar datos';
  }
}

// ── Side-sheet ───────────────────────────────────────────────────
function demoSheetOpen(id) {
  const sheet = document.getElementById(id);
  const overlayId = id.replace('sheet-demo', 'sheet-overlay');
  const overlay = document.getElementById(overlayId);
  if (sheet) { sheet.classList.add('open'); document.body.style.overflow = 'hidden'; }
  if (overlay) overlay.classList.add('open');
}
function demoSheetClose(id) {
  const sheet = document.getElementById(id);
  const overlayId = id.replace('sheet-demo', 'sheet-overlay');
  const overlay = document.getElementById(overlayId);
  if (sheet) sheet.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.sheet.open').forEach(s => demoSheetClose(s.id));
  }
});

// ── Bulk action bar ──────────────────────────────────────────────
function bulkUpdateCount() {
  const checked = document.querySelectorAll('.bulk-row-check:checked').length;
  const bar = document.getElementById('bulk-bar-demo');
  const countEl = document.getElementById('bulk-count');
  if (bar) bar.classList.toggle('visible', checked > 0);
  if (countEl) countEl.textContent = `${checked} seleccionado${checked !== 1 ? 's' : ''}`;
  const selectAll = document.getElementById('bulk-select-all');
  const total = document.querySelectorAll('.bulk-row-check').length;
  if (selectAll) {
    selectAll.indeterminate = checked > 0 && checked < total;
    selectAll.checked = checked === total;
  }
  lucide.createIcons();
}
function bulkSelectAll(cb) {
  document.querySelectorAll('.bulk-row-check').forEach(c => { c.checked = cb.checked; });
  bulkUpdateCount();
}
function bulkClearAll() {
  document.querySelectorAll('.bulk-row-check, #bulk-select-all').forEach(c => { c.checked = false; c.indeterminate = false; });
  bulkUpdateCount();
}

// ── XLSX importer demo state ─────────────────────────────────────
const IMPORTER_STATES = {
  running: { icon: 'loader-circle', text: 'Procesando archivo… 247 de 1,024 filas' },
  done:    { icon: 'check-circle', text: '1,024 registros importados correctamente. 3 con advertencias.' },
  error:   { icon: 'alert-circle', text: 'Error al procesar: columna "serial" no encontrada en el archivo.' },
  '':      { icon: 'upload', text: 'Seleccione un archivo para comenzar' },
};
function demoImporterState(state) {
  const el = document.getElementById('importer-status-demo');
  if (!el) return;
  const cfg = IMPORTER_STATES[state] || IMPORTER_STATES[''];
  el.className = `importer-status${state ? ' ' + state : ''}`;
  el.innerHTML = `<span class="importer-status-icon"><i data-lucide="${cfg.icon}"></i></span> ${cfg.text}`;
  lucide.createIcons({ nodes: [el] });
}
function demoImporter(input) {
  if (input.files && input.files[0]) demoImporterState('running');
}

// ── Contrato — disclosure / sub-disclosure / duración ────────────
function demoContratoDisclosure(accion) {
  const panel = document.getElementById('ct-disc-renovacion');
  const checkbox = document.getElementById('ct-renovacion-sin-equipo');
  if (!panel || !checkbox) return;
  const visible = accion === 'Renovación';
  panel.classList.toggle('visible', visible);
  if (!visible) {
    checkbox.checked = false;
    demoContratoSubDisclosure();
  }
  demoContratoRefreshBadge();
}
function demoContratoSubDisclosure() {
  const sub = document.getElementById('ct-disc-refurbished');
  const cb = document.getElementById('ct-renovacion-sin-equipo');
  if (sub) sub.classList.toggle('visible', !!cb?.checked);
  demoContratoRefreshBadge();
}
function demoContratoRefreshBadge() {
  const badge = document.getElementById('ct-renovacion-badge');
  const accion = document.getElementById('ct-accion')?.value;
  const sinEquipo = document.getElementById('ct-renovacion-sin-equipo')?.checked;
  if (!badge) return;
  if (accion !== 'Renovación') { badge.textContent = 'Renovación con equipo'; return; }
  badge.textContent = sinEquipo ? 'Renovación sin equipo' : 'Renovación con equipo';
}
function demoContratoDuracion(val) {
  const wrap = document.getElementById('ct-otra-duracion-wrap');
  if (wrap) wrap.style.display = val === 'Otro' ? '' : 'none';
}

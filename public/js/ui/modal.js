// Shared modal helpers — single source of truth for open/close + scroll lock + Escape
// API:
//   Modal.open(id, opts?)     — open an existing overlay by element id
//   Modal.close(id)           — close an existing overlay by element id
//   Modal.confirm(opts)       — programmatic confirmation dialog, returns Promise<boolean>
//     opts: { message, title?, danger?, confirmLabel?, cancelLabel? }
//   Modal.prompt(opts)        — programmatic text-input dialog, returns Promise<string|null>
//     opts: { message, title?, defaultValue?, placeholder?, confirmLabel?, cancelLabel?, multiline? }
//     null on cancel/Escape/backdrop; trimmed string on confirm.
//   Modal.sheet(opts)         — hoja programática con cuerpo HTML y botones, Promise<resultado>
//     (2026-09-07, propuesta "Bandejas y pickers" F1). Ver abajo.
// Standard CSS selector for elements that participate in the Tab
// sequence — used by the focus trap. Pulled out so Modal.open and the
// programmatic confirm/prompt overlays share the same definition.
const _FOCUSABLE_SEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function _focusableIn(root) {
  return Array.from(root.querySelectorAll(_FOCUSABLE_SEL))
    .filter(el => !el.hasAttribute('disabled')
                && el.offsetParent !== null);  // skip hidden
}

// Trampa de foco: Tab/Shift+Tab dan la vuelta dentro de `el`. Devuelve true
// si consumió el evento.
function _trapTab(e, el) {
  if (e.key !== 'Tab') return false;
  const focusables = _focusableIn(el);
  if (focusables.length === 0) { e.preventDefault(); return true; }
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  return true;
}

// Pila de hojas programáticas abiertas: cada nueva va encima de la anterior
// y por encima de cualquier overlay de página (los flujos de órdenes usan
// 9500; el visor de fotos 10050). confirm/prompt van a 10100 y siguen
// encima de una hoja.
const _SHEET_Z_BASE = 10000;
let _sheetsAbiertas = 0;

window.Modal = {
  open(id, { onEscape = true } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    el.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Track previously-focused element so we can restore on close.
    el._previouslyFocused = document.activeElement;

    // Initial focus on the first focusable element inside the modal.
    // Defer to next frame so any display:none → flex transitions can
    // settle before measuring offsetParent.
    requestAnimationFrame(() => {
      const focusables = _focusableIn(el);
      if (focusables.length) focusables[0].focus();
      else el.focus?.();
    });

    // Combined key handler: Escape closes, Tab/Shift+Tab wraps focus
    // inside the modal so keyboard users can't tab out into the page
    // behind. ORDENES_INDEX_IMPROVEMENTS.md QW5 a11y compliance.
    const handler = (e) => {
      if (onEscape && e.key === 'Escape') {
        this.close(id);
        return;
      }
      _trapTab(e, el);
    };
    el._modalKeyHandler = handler;
    document.addEventListener('keydown', handler);
  },

  close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';
    document.body.style.overflow = '';
    if (el._modalKeyHandler) {
      document.removeEventListener('keydown', el._modalKeyHandler);
      delete el._modalKeyHandler;
    }
    // Restore focus to the element that was active before the modal opened.
    const prev = el._previouslyFocused;
    if (prev && typeof prev.focus === 'function') prev.focus();
    delete el._previouslyFocused;
  },

  // Hoja programática — la familia única de modal (anatomía del Centro, piel
  // del kit de diseño, hoja pegada abajo en móvil; ver ceco-ui.css
  // "Modal / Dialog"). Reemplaza los overlays construidos a mano.
  //
  //   Modal.sheet({
  //     title, icon?,            // icono lucide junto al título
  //     html,                    // cuerpo (la página escapa lo suyo)
  //     buttons: [{ action, label, primary?, danger?, ghost?, icon? }],
  //     size: 'sm'|'md'|'lg'|'xl',   // 440 · 560 · 720 · 960
  //     closable: true,          // X en el encabezado + Escape + clic fuera
  //     onMount(root, api),      // cablear el cuerpo; api = { close(v), root }
  //     onAction(action, root),  // false → sigue abierta; otro valor → resuelve con él;
  //                              // undefined → resuelve con `action`
  //   }) → Promise<valor | null>   (null = cerrada sin elegir)
  sheet({
    title = '',
    icon = null,
    html = '',
    buttons = [],
    size = 'md',
    closable = true,
    onMount = null,
    onAction = null,
  } = {}) {
    return new Promise(resolve => {
      const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
      }[m]));
      const ANCHO = { sm: 440, md: 560, lg: 720, xl: 960 };
      const overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      if (title) overlay.setAttribute('aria-label', title);
      overlay.style.zIndex = String(_SHEET_Z_BASE + _sheetsAbiertas * 10);
      const btnHtml = (buttons || []).map(b => {
        const cls = b.danger ? 'btn-danger' : b.primary ? 'btn-primary' : b.ghost !== false ? 'btn-ghost' : 'btn';
        return `<button type="button" class="btn ${cls}" data-sheet-action="${esc(b.action)}">`
          + (b.icon ? `<i data-lucide="${esc(b.icon)}" style="width:14px;height:14px;"></i> ` : '') + esc(b.label) + '</button>';
      }).join('');
      overlay.innerHTML = `
        <div class="modal" style="max-width:${ANCHO[size] || ANCHO.md}px; width:100%;">
          ${title || closable ? `<div class="modal-header">
            <h3 class="modal-title">${icon ? `<i data-lucide="${esc(icon)}"></i> ` : ''}${esc(title)}</h3>
            ${closable ? '<button type="button" class="modal-close" data-sheet-action="__cerrar" aria-label="Cerrar"><i data-lucide="x" style="width:18px;height:18px;"></i></button>' : ''}
          </div>` : ''}
          <div class="modal-body">${html}</div>
          ${btnHtml ? `<div class="modal-footer">${btnHtml}</div>` : ''}
        </div>`;

      const previo = document.activeElement;
      let cerrado = false;
      const cleanup = (result) => {
        if (cerrado) return;
        cerrado = true;
        overlay.remove();
        _sheetsAbiertas = Math.max(0, _sheetsAbiertas - 1);
        if (_sheetsAbiertas === 0 && !document.querySelector('.overlay[style*="flex"], .modal-backdrop')) {
          document.body.style.overflow = '';
        }
        document.removeEventListener('keydown', kb);
        if (previo && typeof previo.focus === 'function') previo.focus();
        resolve(result === undefined ? null : result);
      };
      const api = { root: overlay, close: (v) => cleanup(v) };

      const kb = (e) => {
        if (e.key === 'Escape' && closable) { e.preventDefault(); cleanup(null); return; }
        _trapTab(e, overlay);
      };

      overlay.addEventListener('click', async (e) => {
        if (e.target === overlay) { if (closable) cleanup(null); return; }
        const btn = e.target.closest('[data-sheet-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-sheet-action');
        if (action === '__cerrar') { cleanup(null); return; }
        if (typeof onAction === 'function') {
          let r;
          try { r = await onAction(action, overlay, api); } catch (err) { console.error('[Modal.sheet] onAction:', err); return; }
          if (r === false) return;              // la hoja sigue abierta
          cleanup(r === undefined ? action : r);
          return;
        }
        cleanup(action);
      });

      document.addEventListener('keydown', kb);
      document.body.appendChild(overlay);
      _sheetsAbiertas++;
      document.body.style.overflow = 'hidden';
      if (typeof onMount === 'function') {
        try { onMount(overlay, api); } catch (err) { console.error('[Modal.sheet] onMount:', err); }
      }
      if (window.lucide?.createIcons) lucide.createIcons({ nodes: [overlay] });
      requestAnimationFrame(() => {
        const primario = overlay.querySelector('.modal-footer .btn-primary, .modal-footer .btn-danger');
        const foco = primario || _focusableIn(overlay)[0];
        if (foco) foco.focus();
      });
    });
  },

  confirm({
    title         = 'Confirmar',
    message       = '',
    danger        = false,
    confirmLabel  = 'Confirmar',
    cancelLabel   = 'Cancelar',
  } = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.style.display = 'flex';
      // Por encima de cualquier overlay de página (QC/flujo/visita usan 9500,
      // el visor de fotos 10050): confirm/prompt siempre se abren ENCIMA de
      // otro modal, y el .overlay del CSS (z 1500) los dejaba escondidos
      // detrás — cada clic apilaba un backdrop más y la pantalla se veía negra.
      overlay.style.zIndex = '10100';
      overlay.innerHTML = `
        <div class="modal" style="max-width:440px">
          <div class="sheet-header">
            <h3 class="sheet-title">${title}</h3>
          </div>
          <div class="sheet-body" style="padding:16px 8px">
            <p style="margin:0;font-size:15px;line-height:1.5;color:var(--text)">${message}</p>
          </div>
          <div class="footer">
            <button class="btn btn-ghost" data-action="cancel">${cancelLabel}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${confirmLabel}</button>
          </div>
        </div>`;

      const cleanup = result => {
        overlay.remove();
        document.body.style.overflow = '';
        document.removeEventListener('keydown', kbHandler);
        resolve(result);
      };

      const kbHandler = e => {
        if (e.key === 'Escape') cleanup(false);
        if (e.key === 'Enter')  cleanup(true);
      };

      overlay.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (action === 'confirm') cleanup(true);
        else if (action === 'cancel' || e.target === overlay) cleanup(false);
      });

      document.addEventListener('keydown', kbHandler);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      overlay.querySelector('[data-action="confirm"]').focus();
    });
  },

  prompt({
    title         = '',
    message       = '',
    defaultValue  = '',
    placeholder   = '',
    confirmLabel  = 'Aceptar',
    cancelLabel   = 'Cancelar',
    multiline     = false,
    // Hook opcional: recibe el <input>/<textarea> ya montado, para decorarlo
    // (p.ej. SerialField.adjuntar en la edición de un serial). Se llama una
    // vez, antes del focus. No debe reemplazar el elemento.
    onMount       = null,
  } = {}) {
    return new Promise(resolve => {
      const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
      }[m]));
      const fieldHtml = multiline
        ? `<textarea class="input" data-role="prompt-input" rows="4" placeholder="${esc(placeholder)}" style="width:100%;resize:vertical">${esc(defaultValue)}</textarea>`
        : `<input type="text" class="input" data-role="prompt-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" style="width:100%">`;

      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.style.display = 'flex';
      // Mismo motivo que en confirm(): siempre encima del modal que lo abre.
      overlay.style.zIndex = '10100';
      overlay.innerHTML = `
        <div class="modal" style="max-width:460px">
          ${title ? `<div class="sheet-header"><h3 class="sheet-title">${esc(title)}</h3></div>` : ''}
          <div class="sheet-body" style="padding:16px 8px;display:flex;flex-direction:column;gap:10px">
            ${message ? `<p style="margin:0;font-size:14px;line-height:1.4;color:var(--text)">${esc(message)}</p>` : ''}
            ${fieldHtml}
          </div>
          <div class="footer">
            <button class="btn btn-ghost"   data-action="cancel">${esc(cancelLabel)}</button>
            <button class="btn btn-primary" data-action="confirm">${esc(confirmLabel)}</button>
          </div>
        </div>`;

      const input = overlay.querySelector('[data-role="prompt-input"]');

      const cleanup = result => {
        overlay.remove();
        document.body.style.overflow = '';
        document.removeEventListener('keydown', kbHandler);
        resolve(result);
      };

      const kbHandler = e => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
        // Enter confirms only on single-line; multiline lets Enter insert a newline.
        if (!multiline && e.key === 'Enter' && document.activeElement === input) {
          e.preventDefault();
          cleanup(input.value.trim());
        }
      };

      overlay.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (action === 'confirm') cleanup(input.value.trim());
        else if (action === 'cancel' || e.target === overlay) cleanup(null);
      });

      document.addEventListener('keydown', kbHandler);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      if (typeof onMount === 'function') {
        try { onMount(input); } catch (e) { /* decorar nunca rompe el prompt */ }
      }
      input.focus();
      input.select?.();
    });
  }
};

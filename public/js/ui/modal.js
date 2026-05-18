// Shared modal helpers — single source of truth for open/close + scroll lock + Escape
// API:
//   Modal.open(id, opts?)     — open an existing overlay by element id
//   Modal.close(id)           — close an existing overlay by element id
//   Modal.confirm(opts)       — programmatic confirmation dialog, returns Promise<boolean>
//     opts: { message, title?, danger?, confirmLabel?, cancelLabel? }
//   Modal.prompt(opts)        — programmatic text-input dialog, returns Promise<string|null>
//     opts: { message, title?, defaultValue?, placeholder?, confirmLabel?, cancelLabel?, multiline? }
//     null on cancel/Escape/backdrop; trimmed string on confirm.
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
      if (e.key !== 'Tab') return;
      const focusables = _focusableIn(el);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
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
      overlay.innerHTML = `
        <div class="modal" style="max-width:440px">
          <div class="sheet-header">
            <h3 class="sheet-title">${title}</h3>
          </div>
          <div class="sheet-body" style="padding:16px 8px">
            <p style="margin:0;font-size:15px;line-height:1.5;color:var(--text)">${message}</p>
          </div>
          <div class="footer">
            <button class="btn ghost" data-action="cancel">${cancelLabel}</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-action="confirm">${confirmLabel}</button>
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
      overlay.innerHTML = `
        <div class="modal" style="max-width:460px">
          ${title ? `<div class="sheet-header"><h3 class="sheet-title">${esc(title)}</h3></div>` : ''}
          <div class="sheet-body" style="padding:16px 8px;display:flex;flex-direction:column;gap:10px">
            ${message ? `<p style="margin:0;font-size:14px;line-height:1.4;color:var(--text)">${esc(message)}</p>` : ''}
            ${fieldHtml}
          </div>
          <div class="footer">
            <button class="btn ghost"   data-action="cancel">${esc(cancelLabel)}</button>
            <button class="btn primary" data-action="confirm">${esc(confirmLabel)}</button>
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
      input.focus();
      input.select?.();
    });
  }
};

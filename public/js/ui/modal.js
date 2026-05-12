// Shared modal helpers — single source of truth for open/close + scroll lock + Escape
// API:
//   Modal.open(id, opts?)     — open an existing overlay by element id
//   Modal.close(id)           — close an existing overlay by element id
//   Modal.confirm(opts)       — programmatic confirmation dialog, returns Promise<boolean>
//     opts: { message, title?, danger?, confirmLabel?, cancelLabel? }
window.Modal = {
  open(id, { onEscape = true } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (onEscape) {
      const handler = e => {
        if (e.key === 'Escape') { this.close(id); }
      };
      el._modalEscHandler = handler;
      document.addEventListener('keydown', handler);
    }
  },

  close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'none';
    document.body.style.overflow = '';
    if (el._modalEscHandler) {
      document.removeEventListener('keydown', el._modalEscHandler);
      delete el._modalEscHandler;
    }
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
  }
};

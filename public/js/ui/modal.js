// Shared modal helpers — single source of truth for open/close + scroll lock + Escape
// API: Modal.open(id, opts?)  Modal.close(id)
// opts: { onEscape: true (default) }
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
  }
};

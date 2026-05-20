// Shared floating-toast module — single source of truth
// API: Toast.show(msg, type?, durationMs?)  Toast.persist(msg, type?) → element
// type: 'ok' | 'bad' | 'warn' | '' (neutral)
// Renders DS App Kit toast variants (toast-success | toast-error |
// toast-warning | toast-info) into a .toast-region container.
window.Toast = {
  _container: null,

  _typeToVariant: {
    ok:   'toast-success',
    bad:  'toast-error',
    warn: 'toast-warning',
    '':   'toast-info',
  },

  _getContainer() {
    if (!this._container || !document.contains(this._container)) {
      this._container = document.getElementById('toasts');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.className = 'toast-region';
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  },

  _make(msg, type) {
    const variant = this._typeToVariant[type] || 'toast-info';
    const el = document.createElement('div');
    el.className = `toast ${variant}`;
    el.textContent = msg;
    return el;
  },

  show(msg, type = 'ok', durationMs = 3000) {
    const el = this._make(msg, type);
    this._getContainer().appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  },

  persist(msg, type = 'ok') {
    const el = this._make(msg, type);
    this._getContainer().appendChild(el);
    return el;
  }
};

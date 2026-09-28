// Shared floating-toast module — single source of truth
// API: Toast.show(msg, type?, durationMs?)  Toast.persist(msg, type?) → element
// type: 'ok' | 'bad' | 'warn' | '' (neutral)
// Renders DS App Kit toast variants (toast-success | toast-error |
// toast-warning | toast-info) into a .toast-region container.
// Auditoría UX 2026-09-28 (T10): la región se anuncia a lectores de pantalla
// (aria-live) y los errores duran el doble que los éxitos: 3 s no alcanzan
// para leer "No se pudo guardar: …".
window.Toast = {
  _container: null,

  _typeToVariant: {
    ok:   'toast-success',
    bad:  'toast-error',
    warn: 'toast-warning',
    '':   'toast-info',
  },

  // Duración por tipo cuando el llamador no la fija.
  _duracion: { ok: 3000, '': 3000, warn: 4500, bad: 6000 },

  _getContainer() {
    if (!this._container || !document.contains(this._container)) {
      this._container = document.getElementById('toasts');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.className = 'toast-region';
        document.body.appendChild(this._container);
      }
      if (!this._container.hasAttribute('aria-live')) {
        this._container.setAttribute('role', 'status');
        this._container.setAttribute('aria-live', 'polite');
        this._container.setAttribute('aria-atomic', 'false');
      }
    }
    return this._container;
  },

  _make(msg, type) {
    const variant = this._typeToVariant[type] || 'toast-info';
    const el = document.createElement('div');
    el.className = `toast ${variant}`;
    if (type === 'bad') el.setAttribute('role', 'alert');
    el.textContent = msg;
    return el;
  },

  show(msg, type = 'ok', durationMs) {
    const el = this._make(msg, type);
    this._getContainer().appendChild(el);
    const ms = Number.isFinite(durationMs) ? durationMs : (this._duracion[type] ?? 3000);
    setTimeout(() => el.remove(), ms);
  },

  persist(msg, type = 'ok') {
    const el = this._make(msg, type);
    this._getContainer().appendChild(el);
    return el;
  }
};

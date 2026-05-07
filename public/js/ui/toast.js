// Shared floating-toast module — single source of truth
// API: Toast.show(msg, type?, durationMs?)  Toast.persist(msg, type?) → element
// type: 'ok' | 'bad' | 'warn' | '' (neutral dark)
window.Toast = {
  _container: null,

  _getContainer() {
    if (!this._container || !document.contains(this._container)) {
      this._container = document.getElementById('toasts');
      if (!this._container) {
        this._container = document.createElement('div');
        this._container.className = 'toast-wrap';
        document.body.appendChild(this._container);
      }
    }
    return this._container;
  },

  _make(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
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

/* =============================================================
   withBusy — candado estándar contra el doble submit (auditoría UX
   2026-09-28, T3). Un solo lugar para "deshabilita el botón, muestra
   'Guardando…', corre la acción, rehabilita SIEMPRE (también en error)".

   Uso:
     await withBusy(btn, async () => { ... }, { label: 'Enviando…' });
     await withBusy('#btnGuardar', fn);            // acepta selector o id
     withBusy.esta(btn) → true mientras corre

   · Si el botón ya está ocupado, la llamada se IGNORA (devuelve
     undefined): ese es el candado. No se encola ni se reintenta.
   · El texto original del botón se restaura al terminar. Si el botón
     tiene un <i data-lucide> el icono se conserva.
   · Los errores se propagan al llamador después de rehabilitar; si el
     llamador no los atrapa y existe Toast, se muestran como 'bad'.
   · `btn` puede ser null (acciones sin botón): el candado se guarda
     entonces por `key` (opts.key) en un mapa interno.
   ============================================================= */
(function () {
  const _ocupados = new Set();

  function _resolver(btn) {
    if (!btn) return null;
    if (typeof btn === 'string') {
      return document.querySelector(btn.startsWith('#') || btn.includes(' ') || btn.includes('.') ? btn : '#' + btn);
    }
    return btn;
  }

  function _ponerLabel(btn, label) {
    const icono = btn.querySelector('i[data-lucide], svg');
    btn.dataset.busyHtml = btn.innerHTML;
    btn.innerHTML = '';
    if (icono) btn.appendChild(icono.cloneNode(true));
    btn.appendChild(document.createTextNode((icono ? ' ' : '') + label));
  }

  async function withBusy(btnRef, fn, opts = {}) {
    const btn = _resolver(btnRef);
    const key = btn || opts.key || fn;
    if (_ocupados.has(key)) return undefined;
    _ocupados.add(key);
    let restaurar = null;
    if (btn) {
      const eraDisabled = btn.disabled;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-busy');
      if (opts.label !== false) _ponerLabel(btn, opts.label || 'Guardando…');
      restaurar = () => {
        btn.disabled = eraDisabled;
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-busy');
        if (btn.dataset.busyHtml != null) {
          btn.innerHTML = btn.dataset.busyHtml;
          delete btn.dataset.busyHtml;
          if (window.lucide?.createIcons) { try { lucide.createIcons({ root: btn }); } catch (_) {} }
        }
      };
    }
    try {
      return await fn();
    } catch (err) {
      if (opts.toast !== false && window.Toast && !opts.silencioso) {
        Toast.show(opts.mensajeError || (err && err.message) || 'No se pudo completar la acción', 'bad');
      }
      if (opts.rethrow !== false) throw err;
      return undefined;
    } finally {
      _ocupados.delete(key);
      if (restaurar) restaurar();
    }
  }

  withBusy.esta = (btnRef) => _ocupados.has(_resolver(btnRef));
  window.withBusy = withBusy;
})();

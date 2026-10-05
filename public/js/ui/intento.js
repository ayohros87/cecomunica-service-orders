/* =============================================================
   IntentoEnvio — que un envío frenado no se pierda (2026-10-05).

   Caso COMPAÑÍA GOLY: Elvia "hizo" una gestión que nunca existió. El
   wizard la frenó con un aviso que duró 4 segundos arriba de la pantalla
   y no quedó rastro: ni ella ni administración pudieron saber qué pasó.

   vigilar(info, fn) corre `fn` (el submit de un wizard) mirando los
   avisos que muestra. Si terminó con un aviso 'warn'/'bad' (o con una
   excepción) y SIN un 'ok':
     1. el motivo queda FIJO en el modal, encima de los botones, hasta el
        siguiente intento o hasta cerrar el modal;
     2. se registra en intentos_fallidos/{auto} — quién, qué trámite, qué
        cliente, qué mensaje — y administración lo ve en admin/uso.html.
   El registro es best-effort: si falla, el vendedor igual ve el aviso.

   info: { accion, etiqueta, btn?, contexto?: () => ({ cliente_id, cliente_nombre, ... }) }
   withBusy lo usa solo cuando recibe opts.intento.
   ============================================================= */
(function () {
  const COL = 'intentos_fallidos';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const hoyPanama = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });

  // El pie del modal donde vive el botón; sin botón (onclick sin `this`),
  // el último modal abierto.
  function _pie(btn) {
    const desdeBtn = btn && btn.closest ? btn.closest('.modal-footer') : null;
    if (desdeBtn) return desdeBtn;
    const pies = document.querySelectorAll('.modal-footer');
    return pies.length ? pies[pies.length - 1] : null;
  }

  function limpiarAviso(btn) {
    const pie = _pie(btn);
    const prev = pie && pie.previousElementSibling;
    if (prev && prev.classList.contains('intento-aviso')) prev.remove();
  }

  function mostrarAviso(btn, mensajes, esError) {
    const pie = _pie(btn);
    if (!pie) return;               // sin modal: el toast es lo que hay
    limpiarAviso(btn);
    const caja = document.createElement('div');
    caja.className = 'intento-aviso';
    caja.setAttribute('role', 'alert');
    const tono = esError
      ? 'background:#FEF2F2; border-color:#FCA5A5; color:#991B1B;'
      : 'background:#FFFBEB; border-color:#FCD34D; color:#92400E;';
    caja.style.cssText = `margin:0 20px 12px; padding:10px 14px; border:1px solid; border-radius:6px; font-size:13.5px; line-height:1.45; ${tono}`;
    const titulo = esError
      ? 'No se guardó — hubo un error. Ya quedó registrado para administración.'
      : 'No se envió todavía. Corrige esto y vuelve a darle al botón:';
    caja.innerHTML = `<b>${esc(titulo)}</b>`
      + (mensajes.length === 1
        ? `<div style="margin-top:4px;">${esc(mensajes[0])}</div>`
        : `<ul style="margin:4px 0 0; padding-left:18px;">${mensajes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`);
    pie.parentNode.insertBefore(caja, pie);
    try { caja.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* jsdom */ }
  }

  async function registrar(info, mensajes, errorTxt, ctx) {
    try {
      if (!window.firebase?.firestore) return;
      const user = firebase.auth().currentUser;
      if (!user) return;
      const doc = {
        uid: user.uid,
        email: user.email || null,
        accion: String(info.accion || 'desconocida').slice(0, 80),
        etiqueta: String(info.etiqueta || info.accion || '').slice(0, 120),
        resultado: errorTxt ? 'error' : 'frenado',
        mensajes: mensajes.slice(0, 5).map((m) => String(m).slice(0, 500)),
        error: errorTxt ? String(errorTxt).slice(0, 1000) : null,
        pagina: String(location.pathname || '').slice(0, 200),
        cliente_id: ctx.cliente_id ? String(ctx.cliente_id).slice(0, 100) : null,
        cliente_nombre: ctx.cliente_nombre ? String(ctx.cliente_nombre).slice(0, 200) : null,
        fecha: hoyPanama(),
        at: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await firebase.firestore().collection(COL).add(doc);
    } catch (e) {
      console.warn('[intento] no se pudo registrar', e);
    }
  }

  async function vigilar(info, fn) {
    const btn = info.btn || null;
    const capt = [];
    let errorConsola = null;
    let errorLanzado = null;
    const T = window.Toast;
    const showOrig = T ? T.show : null;
    const persistOrig = T ? T.persist : null;
    const consoleOrig = console.error;
    if (T) {
      T.show = function (msg, type = 'ok', ms) {
        capt.push({ msg: String(msg == null ? '' : msg), type });
        return showOrig.call(this, msg, type, ms);
      };
      // El aviso con botón (_toastAccion: "Contrato creado · Ver documento")
      // va por persist: también cuenta como éxito.
      if (persistOrig) {
        T.persist = function (msg, type = 'ok') {
          capt.push({ msg: String(msg == null ? '' : msg), type });
          return persistOrig.call(this, msg, type);
        };
      }
    }
    // Los wizards atrapan su excepción y muestran un genérico ("No se pudo
    // crear el ajuste"): el detalle real solo pasa por console.error.
    console.error = function (...args) {
      if (!errorConsola) {
        const e = args.find((a) => a instanceof Error) || args[0];
        errorConsola = e instanceof Error ? (e.code ? `${e.code}: ${e.message}` : e.message) : String(e);
      }
      return consoleOrig.apply(this, args);
    };
    limpiarAviso(btn);
    try {
      return await fn();
    } catch (e) {
      errorLanzado = e;
      throw e;
    } finally {
      if (T) { T.show = showOrig; if (persistOrig) T.persist = persistOrig; }
      console.error = consoleOrig;
      const exito = capt.some((c) => c.type === 'ok');
      const malos = capt.filter((c) => c.type === 'warn' || c.type === 'bad').map((c) => c.msg);
      const errTxt = errorLanzado
        ? (errorLanzado.code ? `${errorLanzado.code}: ${errorLanzado.message}` : (errorLanzado.message || String(errorLanzado)))
        : (capt.some((c) => c.type === 'bad') ? errorConsola : null);
      if (errorLanzado && !malos.length) malos.push(errorLanzado.message || 'No se pudo completar la acción');
      if (malos.length && !exito) {
        const esError = !!errTxt || capt.some((c) => c.type === 'bad');
        mostrarAviso(btn, malos, esError);
        let ctx = {};
        try { ctx = (typeof info.contexto === 'function' ? info.contexto() : info.contexto) || {}; } catch (_) { /* contexto roto no bloquea */ }
        registrar(info, malos, errTxt, ctx);
      }
    }
  }

  window.IntentoEnvio = { vigilar, limpiarAviso, COL };
})();

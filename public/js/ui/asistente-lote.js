// @ts-nocheck
// Runner de acciones en lote del espacio Almacén (auditoría UX 2026-09-28,
// P2 #14). Antes había dos: el de Equipos por serial (barra, Detener y
// reporte por motivo) y el de Existencias, que solo decía "Procesando i/N"
// en el botón — sin forma de parar un lote de 300 ni de saber cuáles
// fallaron. Ahora es uno, sobre Modal.sheet:
//
//   const r = await AsistenteLote.correr({
//     titulo, icono, cuerpoHtml,          // qué va a pasar (la página escapa lo suyo)
//     items,                              // lo que se procesa
//     etiqueta: (it) => it.serial,        // cómo se nombra cada uno en la muestra y el reporte
//     pideMotivo, motivoPlaceholder,      // motivo obligatorio (queda en el kardex)
//     correr: (it, motivo) => Promise,    // la MISMA función de servicio que la acción de fila
//     concurrencia: 6, labelOk: 'Inspección OK',
//   });
//   → null si se canceló antes de empezar; si no { ok, fallidos:[{it,error}], noIntentados, cancelado }
//
// Lo ya procesado queda guardado: Detener solo evita seguir con el resto.
window.AsistenteLote = (() => {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const toast = (m, k) => { if (window.Toast) Toast.show(m, k); };

  // Corre `fn` sobre `items` con concurrencia acotada. Nunca lanza: cada item
  // devuelve {ok} o {ok:false, error} — en un lote de cientos, "algo falló"
  // sin decir qué es inservible. Cada unidad es su propia transacción (guard de
  // estado + kardex), por eso de a 6 y no todas de golpe.
  async function enTandas(items, fn, { concurrencia = 6, onProgreso, cancelado } = {}) {
    const res = [];
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        if (cancelado && cancelado()) return;
        const it = items[i++];
        try { await fn(it); res.push({ it, ok: true }); }
        catch (e) { res.push({ it, ok: false, error: (e && e.message) || String(e) }); }
        if (onProgreso) onProgreso(res.length, items.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, worker));
    return res;
  }

  // 300 errores iguales son UN problema: se agrupan por motivo, el más
  // frecuente primero, para que el distinto no se pierda en la lista.
  function agruparPorMotivo(fallidos, etiqueta) {
    const m = new Map();
    for (const f of (fallidos || [])) {
      if (!m.has(f.error)) m.set(f.error, []);
      m.get(f.error).push(etiqueta(f.it));
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }

  function reporteHtml({ ok, fallidos, noIntentados }, etiqueta) {
    const grupos = agruparPorMotivo(fallidos, etiqueta).map(([err, lista]) => `
      <div class="alm-lote-grupo">
        <div class="alm-lote-err">${esc(err)} — ${lista.length}</div>
        <div class="alm-lote-lista">${esc(lista.join(', '))}</div>
      </div>`).join('');
    return `
      <p style="margin:0 0 12px; font-size:13.5px;">
        <b style="color:#067647;">${ok}</b> listas ·
        <b style="color:#b91c1c;">${fallidos.length}</b> con error
        ${noIntentados ? ` · <b>${noIntentados}</b> sin intentar (detenido)` : ''}
      </p>
      ${fallidos.length ? `<div style="max-height:300px; overflow-y:auto;">${grupos}</div>
        <p style="margin:10px 0 0; font-size:12px; color:var(--fg-3);">
          Las que fallaron no se tocaron: puedes volver a intentarlo con ellas.</p>` : ''}
      ${noIntentados ? `<p style="margin:10px 0 0; font-size:12px; color:var(--fg-3);">
          Lo ya procesado quedó guardado; las ${noIntentados} restantes siguen como estaban.</p>` : ''}`;
  }

  async function correr({
    titulo = 'Acción en lote', icono = 'layers', cuerpoHtml = '', items = [],
    etiqueta = (it) => String(it?.serial || it?.serial_norm || it?.id || ''),
    pideMotivo = false, motivoPlaceholder = '', correr: fn, concurrencia = 6,
    labelOk = 'Lote', confirmLabel = null,
  } = {}) {
    if (!items.length || typeof fn !== 'function') return null;
    if (typeof Modal === 'undefined' || !Modal.sheet) throw new Error('AsistenteLote requiere Modal.sheet');
    const muestra = items.slice(0, 8).map(it => esc(etiqueta(it))).join(', ');
    const resto = items.length > 8 ? ` … y ${items.length - 8} más` : '';
    let corriendo = false, detener = false, resultado = null;

    const html = `
      <div data-lote="confirmar">
        <div style="margin:0 0 10px; font-size:13.5px; line-height:1.55;">${cuerpoHtml}</div>
        <div class="alm-lote-muestra">${muestra}${resto}</div>
        ${pideMotivo ? `
          <div class="form-field" style="margin-top:12px;">
            <label class="form-label" for="almLoteMotivo">Motivo (queda en el kardex de cada unidad)</label>
            <input class="form-input" id="almLoteMotivo" type="text" placeholder="${esc(motivoPlaceholder)}">
          </div>` : ''}
        <div class="alm-lote-msg" data-lote="msg" style="display:none;"></div>
      </div>
      <div data-lote="progreso" style="display:none;">
        <div class="alm-lote-barra"><div data-lote="barra"></div></div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
          <span data-lote="texto" style="font-size:13px; color:var(--fg-3);">0 de ${items.length}…</span>
          <span style="flex:1;"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-lote="detener">Detener</button>
        </div>
        <p style="margin:8px 0 0; font-size:12px; color:var(--fg-3);">
          Lo ya procesado queda guardado; detener solo evita seguir con el resto.</p>
      </div>
      <div data-lote="reporte" style="display:none;"></div>`;

    const r = await Modal.sheet({
      title: titulo, icon: icono, size: 'md', html,
      // Mientras corre no se cierra (ni Escape ni clic fuera): escondería el
      // progreso con las escrituras todavía en vuelo. Para parar está Detener.
      closable: () => !corriendo,
      buttons: [
        { action: 'cancelar', label: 'Cancelar' },
        { action: 'confirmar', label: confirmLabel || `Confirmar (${items.length})`, primary: true, icon: 'check' },
      ],
      onMount: (root) => {
        root.addEventListener('click', (e) => {
          const b = e.target.closest('[data-lote="detener"]');
          if (b) { detener = true; b.disabled = true; b.textContent = 'Deteniendo…'; }
          const c = e.target.closest('[data-lote="copiar"]');
          if (c && resultado) {
            const txt = resultado.fallidos.map(f => `${etiqueta(f.it)}\t${f.error}`).join('\n');
            navigator.clipboard?.writeText(txt)
              .then(() => toast('Lista de errores copiada.', 'ok'))
              .catch(() => toast('No se pudo copiar.', 'bad'));
          }
        });
        const m = root.querySelector('#almLoteMotivo');
        if (m) {
          setTimeout(() => m.focus(), 60);
          m.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-sheet-action="confirmar"]')?.click(); }
          });
        }
      },
      onAction: async (action, root) => {
        if (action === 'cancelar') return null;
        if (action === 'cerrar') return resultado;
        if (action !== 'confirmar' || corriendo) return false;
        let motivo = '';
        if (pideMotivo) {
          motivo = (root.querySelector('#almLoteMotivo')?.value || '').trim();
          if (!motivo) {
            const msg = root.querySelector('[data-lote="msg"]');
            if (msg) { msg.textContent = 'Esta acción requiere un motivo.'; msg.style.display = ''; }
            root.querySelector('#almLoteMotivo')?.focus();
            return false;
          }
        }
        corriendo = true;
        const q = (k) => root.querySelector(`[data-lote="${k}"]`);
        q('confirmar').style.display = 'none';
        q('progreso').style.display = '';
        const pie = root.querySelector('.modal-footer');
        if (pie) pie.style.display = 'none';
        const pintar = (hechos, total) => {
          q('barra').style.width = `${Math.round((hechos / total) * 100)}%`;
          q('texto').textContent = `${hechos} de ${total}…`;
        };
        const res = await enTandas(items, (it) => fn(it, motivo), {
          concurrencia, onProgreso: pintar, cancelado: () => detener,
        });
        corriendo = false;
        const fallidos = res.filter(x => !x.ok);
        resultado = { ok: res.length - fallidos.length, fallidos, noIntentados: items.length - res.length, cancelado: detener };
        // Todo bien → basta un aviso; con fallos o detenido, el reporte se queda
        // en pantalla hasta que la persona lo lea y cierre.
        if (!fallidos.length && !resultado.noIntentados) {
          toast(`${labelOk}: ${resultado.ok} listas.`, 'ok');
          return resultado;
        }
        q('progreso').style.display = 'none';
        const rep = q('reporte');
        rep.innerHTML = reporteHtml(resultado, etiqueta);
        rep.style.display = '';
        if (pie) {
          pie.innerHTML = `${fallidos.length ? '<button type="button" class="btn btn-ghost" data-lote="copiar"><i data-lucide="copy" style="width:14px;height:14px;"></i> Copiar errores</button>' : ''}
            <button type="button" class="btn btn-primary" data-sheet-action="cerrar">Cerrar</button>`;
          pie.style.display = '';
          if (window.lucide?.createIcons) lucide.createIcons({ nodes: [pie] });
          pie.querySelector('[data-sheet-action="cerrar"]')?.focus();
        }
        return false;
      },
    });
    // Cerrar el reporte con la X también devuelve lo que corrió: la página
    // tiene que refrescar igual.
    return resultado || (r && typeof r === 'object' ? r : null);
  }

  return { correr, enTandas, agruparPorMotivo };
})();

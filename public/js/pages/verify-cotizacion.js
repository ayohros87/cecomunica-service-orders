// @ts-nocheck
// Vista pública de cotización: lee cotizacion_verificaciones/{id}, valida el código,
// renderiza el print + registra la apertura en cotizacion_opens (un solo log por sesión).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = FMT.esc; // helper canónico (core/formatting.js)
  const T = window.CotizacionTotales;

  function fmtFechaCorta(iso) { return FMT.dateShort(iso); } // delega en el helper canónico

  function logoSvg() {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="48" height="48" aria-hidden="true">
        <rect width="40" height="40" rx="7" fill="#0B2A47"/>
        <path d="M18 8H13a9 9 0 0 0 0 24h5" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="square"/>
        <path d="M22 8h5a9 9 0 0 1 0 24h-5" stroke="#00B4D8" stroke-width="3.5" fill="none" stroke-linecap="square"/>
        <rect x="18.5" y="18.5" width="3" height="3" fill="#00B4D8"/>
      </svg>
    `;
  }

  function showError(msg) {
    $('cqPage').innerHTML = `
      <div style="padding:80px 48px; text-align:center;">
        <h2 style="font-family:var(--font-display); color:#991B1B; margin-bottom:8px;">Cotización no disponible</h2>
        <p style="color:var(--fg-3);">${esc(msg)}</p>
        <p style="font-size:11px; color:var(--fg-4); margin-top:24px;">Para cualquier consulta contacta a soporte@cecomunica.com.</p>
      </div>
    `;
  }

  // Antepone las 2 hojas de la carta de presentación como hermanas de #cqPage.
  function anteponerCarta(emisor) {
    const page = $('cqPage');
    const stage = page?.parentElement;
    if (!stage) return;
    page.insertAdjacentHTML('beforebegin', CartaPresentacion.html({ emisor }));
  }

  // Totales del espejo público. Lee del snapshot CONGELADO, no recalcula: un
  // link ya enviado no puede cambiar de contenido. Los espejos emitidos antes
  // de la modalidad no traen `hayAlquiler` — caen al camino de siempre, que es
  // exactamente lo que decía el documento que recibió el cliente.
  function totalesEspejo(snap) {
    const rotuloItbms = snap.itbmsPct > 0 ? 'ITBMS (' + snap.itbmsPct + '%)' : 'ITBMS exento';

    if (!snap.hayAlquiler) {
      return `
        <div class="cq-trow"><span>Subtotal</span><span class="cq-tv">${FMT.money(snap.subtotal)}</span></div>
        ${snap.descuentoPct > 0 ? `<div class="cq-trow disc"><span>Descuento (${snap.descuentoPct}%)</span><span class="cq-tv">−${FMT.money(snap.descGlobal)}</span></div>` : ''}
        <div class="cq-trow"><span>${rotuloItbms}</span><span class="cq-tv">${FMT.money(snap.itbms)}</span></div>
        <div class="cq-trow total"><span class="cq-lblt">Total</span><span class="cq-tv">${FMT.money(snap.total)}</span></div>`;
    }

    const bloque = (b, titulo, sufijo, cap) => !b || !b.n ? '' : `
      ${cap ? `<div class="cq-tcap">${cap}</div>` : ''}
      <div class="cq-trow"><span>Subtotal</span><span class="cq-tv">${FMT.money(b.subtotal)}</span></div>
      ${snap.descuentoPct > 0 ? `<div class="cq-trow disc"><span>Descuento (${snap.descuentoPct}%)</span><span class="cq-tv">−${FMT.money(b.descGlobal)}</span></div>` : ''}
      <div class="cq-trow"><span>${rotuloItbms}</span><span class="cq-tv">${FMT.money(b.itbms)}</span></div>
      <div class="cq-trow total"><span class="cq-lblt">${titulo}</span><span class="cq-tv">${FMT.money(b.total)}${sufijo}</span></div>`;

    return `
      ${bloque(snap.ventaDetalle, 'Total equipos', '', snap.hayVenta ? 'Equipos en venta' : '')}
      ${bloque(snap.alquilerDetalle, 'Mensualidad', '<span class="cq-per">/mes</span>', 'Alquiler mensual')}
      ${Number(snap.plazoMeses) > 0
        ? `<div class="cq-trow"><span>Plazo del alquiler</span><span class="cq-tv">${Number(snap.plazoMeses)} meses</span></div>`
        : ''}`;
  }

  function render(snap, emisor, vCode, docId, llevaCarta) {
    if (!snap) { showError('La cotización no contiene datos.'); return; }
    const cli = snap.cliente || {};
    const ej = snap.ejecutivo || {};
    const dirA = $('ptMeta').dataset.dirigidoA || cli.representante || '';
    const dirEmail = $('ptMeta').dataset.dirigidoEmail || cli.email || '';

    $('ptTitle').textContent = snap.id || 'Cotización';
    const page = $('cqPage');

    // La decisión viaja resuelta en el mirror (lleva_carta). Los mirrors creados
    // antes de esta función no traen el campo → sin carta, que es lo correcto:
    // un link ya enviado no cambia de contenido a posteriori.
    if (llevaCarta) anteponerCarta(emisor);

    page.innerHTML = `
      <div class="cq-hd">
        <div class="cq-lockup">
          ${logoSvg()}
          <div class="cq-divider"></div>
          <div>
            <div class="cq-wm">Cecomunica</div>
            <div class="cq-tag">Soluciones en Comunicaciones</div>
          </div>
        </div>
        <div class="cq-hd-right">
          <div class="cq-doctype">${esc(CotizacionTaller.tituloDocumento(snap))}</div>
          <div class="cq-num">N° ${esc(snap.id || '—')}</div>
          ${CotizacionTaller.esTaller(snap) && snap.orden_id
            ? `<div class="cq-num" style="margin-top:2px;">Orden de servicio ${esc(snap.orden_id)}</div>` : ''}
        </div>
      </div>

      <div class="cq-meta">
        <div class="cq-block">
          <div class="cq-lbl">De</div>
          <div class="cq-co">${esc(emisor.razon)}</div>
          <div class="cq-ln">
            RUC <span class="cq-mono">${esc(emisor.ruc)}</span><br>
            ${esc(emisor.dir1)}<br>${esc(emisor.dir2)}<br>
            <b>Tel</b> <span class="cq-mono">${esc(emisor.tel)}</span><br>
            ${esc(emisor.email)}
          </div>
        </div>
        <div class="cq-block">
          <div class="cq-lbl">Para</div>
          <div class="cq-co">${esc(cli.razon || '—')}</div>
          <div class="cq-ln">
            ${dirA ? `<b>Atención:</b> ${esc(dirA)}<br>` : ''}
            RUC <span class="cq-mono">${esc(cli.ruc || '—')}</span><br>
            <b>Tel</b> <span class="cq-mono">${esc(cli.tel || '—')}</span><br>
            ${esc(dirEmail)}
          </div>
          <div class="cq-dates">
            <div><div class="cq-k">Fecha</div><div class="cq-v">${esc(fmtFechaCorta(snap.fecha))}</div></div>
            <div><div class="cq-k">Validez</div><div class="cq-v">${esc(snap.validezDias)} días</div></div>
            <div><div class="cq-k">Moneda</div><div class="cq-v">${esc(snap.moneda)}</div></div>
          </div>
        </div>
      </div>

      ${snap.intro ? `<div class="cq-intro">${esc(snap.intro)}</div>` : ''}

      <div class="cq-items">
        <table class="cq-table">
          <thead><tr><th>#</th><th>Descripción</th><th class="c">Cant.</th>
            ${snap.hayAlquiler ? '<th class="c">Modalidad</th>' : ''}
            <th class="r">Precio unit.</th>
            ${T.hayDescLineas(snap.items) ? '<th class="c">Desc.</th>' : ''}
            <th class="r">Total</th></tr></thead>
          <tbody>
            <!-- Mismo cuerpo agrupado por equipo que la impresión: lo que el
                 cliente abre desde el correo y lo que descarga en PDF tienen
                 que decir exactamente lo mismo. -->
            ${T.filasPorEquipoHtml(snap.items || [], { hayAlquiler: snap.hayAlquiler })}
          </tbody>
        </table>
      </div>

      <div class="cq-lower">
        <div class="cq-conditions">
          ${(snap.condiciones || []).length ? `
          <div class="cq-lbl">Condiciones</div>
          <div class="cq-cgrid">
            ${snap.condiciones.map(c => `<div class="cq-ck">${esc(c.k)}</div><div class="cq-cv">${esc(c.v)}</div>`).join('')}
          </div>` : ''}
        </div>
        <div class="cq-totals">
          ${totalesEspejo(snap)}
        </div>
      </div>

      <div class="cq-sign">
        <div class="cq-col">
          <div class="cq-line">
            <div class="cq-nm">${esc(ej.nombre || '—')}</div>
            <div class="cq-rl">${esc(ej.rol || CotizacionTaller.cargoFirmante(snap, ej))} · ${esc(emisor.razon)}</div>
            <div class="cq-ct">${esc(ej.email || '')}<br>${esc(ej.tel || '')}</div>
          </div>
        </div>
        <div class="cq-col">
          <div class="cq-line">
            <div class="cq-nm" style="color:var(--fg4); font-weight:500;">Aceptación del cliente</div>
            <div class="cq-rl">Nombre, firma y sello</div>
            <div class="cq-ct">Fecha: ______________________</div>
          </div>
        </div>
      </div>

      <div class="cq-note">${esc(CotizacionTaller.notaLegal(snap))}</div>

      <div class="cq-band"></div>
      <div class="cq-ft">
        <span>${esc(emisor.razon)}</span>
        <span class="cq-web">${esc(emisor.web || '')}</span>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // Estado a la vista del cliente (auditoría UX 2026-09-28, #20): un link de
  // una cotización vencida o cerrada se veía vigente. El estado lo espeja
  // CotizacionesService.updateCotizacion en el mirror; los espejos viejos no lo
  // traen y caen al cálculo por fecha + validez.
  function situacion(data, snap) {
    const fecha = data.fecha || snap?.fecha || '';
    const dias = Number(data.validezDias || snap?.validezDias || 0);
    const vence = fecha && dias ? T.addDays(fecha, dias) : '';
    const hoy = (FMT.hoyISOPanama && FMT.hoyISOPanama()) || new Date().toISOString().slice(0, 10);
    const e = String(data.estado || '');
    // Eliminada en la app (softDelete espeja `deleted`): para el cliente es
    // una cotización cerrada, diga lo que diga el estado que tenía.
    if (data.deleted === true) return { k: 'cerrada', vence };
    if (e === 'convertida') return { k: 'aceptada', vence };
    // La declinó el propio cliente desde este enlace: se le dice eso, no
    // "cerrada" como si la hubiera cerrado la empresa.
    if (e === 'rechazada' && data.respuesta_cliente?.respuesta === 'rechazada') return { k: 'declinada', vence };
    if (e === 'descartada' || e === 'rechazada') return { k: 'cerrada', vence };
    if (e === 'vencida' || (vence && hoy > vence)) return { k: 'vencida', vence };
    return { k: 'vigente', vence };
  }

  function avisoSituacion(sit) {
    const venceTxt = sit.vence ? fmtFechaCorta(sit.vence) : '';
    const conf = {
      vigente:  { bg: '#ECFDF5', fg: '#065F46', bd: '#A7F3D0', t: 'Vigente' + (venceTxt ? ' hasta el ' + venceTxt : ''), d: 'Puedes aceptarla o declinarla aquí mismo (más abajo) o escribirle a tu vendedor.' },
      aceptada: { bg: '#ECFDF5', fg: '#065F46', bd: '#A7F3D0', t: 'Cotización aceptada', d: 'Ya registramos tu aceptación. Gracias.' },
      declinada: { bg: '#F1F5F9', fg: '#334155', bd: '#CBD5E1', t: 'Cotización declinada', d: 'Respondiste que no la aceptas. Si cambias de opinión, escríbele a tu vendedor.' },
      vencida:  { bg: '#FFF7ED', fg: '#9A3412', bd: '#FED7AA', t: 'Cotización vencida' + (venceTxt ? ' el ' + venceTxt : ''), d: 'Los precios y la disponibilidad pueden haber cambiado. Pide a tu vendedor una cotización actualizada antes de aceptarla.' },
      cerrada:  { bg: '#F1F5F9', fg: '#334155', bd: '#CBD5E1', t: 'Cotización cerrada', d: 'Esta cotización ya no está vigente. Si la necesitas, pide una nueva a tu vendedor.' },
    }[sit.k];
    const stage = $('cqPage')?.parentElement;
    if (!stage || !conf) return;
    const div = document.createElement('div');
    div.id = 'cqSituacion';
    div.className = 'cq-situacion';
    div.setAttribute('role', sit.k === 'vigente' ? 'status' : 'alert');
    div.style.cssText = `max-width:816px; margin:0 auto 12px; padding:12px 16px; border-radius:8px; border:1px solid ${conf.bd}; background:${conf.bg}; color:${conf.fg}; font-size:14px; line-height:1.5;`;
    div.innerHTML = `<b>${esc(conf.t)}</b><br><span>${esc(conf.d)}</span>`;
    stage.insertBefore(div, stage.firstChild);
    const meta = $('ptMeta');
    if (meta) meta.textContent = (meta.textContent || '') + ' · ' + conf.t;
  }

  // Registra apertura. Solo lo hace una vez por sesión por cotización (sessionStorage flag).
  // ¿Quien abre es de la casa? El vendedor va en CC del MISMO correo que recibe
  // el cliente (y supervisión en BCC), así que su copia trae el mismo link. Sin
  // este corte, revisar la propia cotización se registraba como apertura del
  // cliente y disparaba el aviso "📬 abierta por <cliente>" — pasó con
  // COT-2026-0040, "abierta" 24 segundos después de enviarse.
  //
  // El corte es la sesión de Firebase: todo interno la tiene (la app la deja en
  // el navegador), ningún cliente la tiene. Se resuelve con timeout para que un
  // auth lento nunca deje de registrar una apertura real.
  function esVisitaInterna() {
    return new Promise((resolve) => {
      if (!window.firebase || typeof firebase.auth !== 'function') return resolve(false);
      let resuelto = false;
      const listo = (v) => { if (!resuelto) { resuelto = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => listo(false), 2500);
      try {
        const off = firebase.auth().onAuthStateChanged(
          (u) => { listo(!!u); if (off) off(); },
          () => listo(false),
        );
      } catch (_) { listo(false); }
    });
  }

  // Aviso discreto para el interno: que sepa por qué su visita no cuenta.
  function marcarVistaInterna() {
    const meta = $('ptMeta');
    if (!meta || meta.dataset.interno === '1') return;
    meta.dataset.interno = '1';
    meta.textContent = (meta.textContent || '') + ' · Vista interna (no cuenta como apertura del cliente)';
  }

  async function logOpen(docId, vCode, cotizacionId) {
    try {
      const key = 'cot_open_' + docId;
      if (sessionStorage.getItem(key)) return;
      if (await esVisitaInterna()) { marcarVistaInterna(); return; }
      const db = firebase.firestore();
      await db.collection('cotizacion_opens').add({
        verificacion_id: docId,
        cotizacion_id: cotizacionId || null,
        code: vCode,
        opened_at: firebase.firestore.FieldValue.serverTimestamp(),
        user_agent: navigator.userAgent.slice(0, 200),
        referrer: (document.referrer || '').slice(0, 200),
      });
      sessionStorage.setItem(key, '1');
    } catch (e) {
      // No bloqueamos la vista por errores de log.
      console.warn('No se pudo registrar apertura:', e.message || e);
    }
  }

  // ── Aceptar / declinar desde el enlace (auditoría UX 2026-09-28 §4.5 #12) ──
  // El aviso decía "responde el correo o escríbele a tu vendedor": el cliente
  // abría, leía, y la respuesta viajaba por fuera del sistema. Ahora responde
  // aquí y la registra responderCotizacionPublica (valida el código del
  // enlace, escribe la cotización con la misma forma que "Respuesta del
  // cliente" del detalle y avisa al vendedor). El navegador no escribe nada:
  // las rules no dejan a un anónimo tocar `cotizaciones`.
  function fmtFechaHora(v) {
    const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null);
    if (!d || Number.isNaN(d.getTime())) return '';
    return FMT.datetime ? FMT.datetime(d) : d.toLocaleString('es-PA');
  }

  function respuestaRegistradaHtml(r, { recien = false } = {}) {
    const acepto = r.respuesta === 'aceptada';
    const titulo = recien ? 'Tu respuesta quedó registrada'
      : (acepto ? 'Aceptaste esta cotización' : 'Respondiste que no la aceptas');
    const cuando = r.fecha ? ' el ' + esc(fmtFechaHora(r.fecha)) : '';
    return `<b>${esc(titulo)}</b><br>
      <span>${acepto ? 'Aceptada' : 'Declinada'} a nombre de <b>${esc(r.nombre || '—')}</b>${cuando}.
      ${acepto ? 'Tu vendedor ya recibió el aviso y se comunicará contigo para lo que sigue.' : 'Tu vendedor ya recibió el aviso. Gracias por avisar.'}</span>`;
  }

  function panelRespuesta(data, sit, docId, vCode) {
    const stage = $('cqPage')?.parentElement;
    if (!stage) return;
    const panel = document.createElement('div');
    panel.id = 'cqRespuesta';
    panel.className = 'cq-resp';
    const ancla = $('cqSituacion');
    stage.insertBefore(panel, ancla ? ancla.nextSibling : stage.firstChild);

    const rc = data.respuesta_cliente || null;
    if (rc && rc.respuesta) { panel.innerHTML = respuestaRegistradaHtml(rc); return; }
    // Solo lo vigente se puede responder; lo demás ya lo explica el aviso.
    if (sit.k !== 'vigente') { panel.remove(); return; }

    const numero = data.cotizacion_id || data.snapshot?.id || 'esta cotización';
    panel.innerHTML = `
      <div class="cq-resp-hd">¿Aceptas esta cotización?</div>
      <p class="cq-resp-p">Tu respuesta le llega directo a tu vendedor. Tu nombre queda como constancia de quién respondió.</p>
      <label class="cq-resp-lbl">Nombre completo <span class="cq-resp-req" aria-hidden="true">*</span>
        <input id="cqRespNombre" type="text" maxlength="120" autocomplete="name" required aria-required="true">
      </label>
      <label class="cq-resp-lbl">Comentario (opcional)
        <textarea id="cqRespComentario" maxlength="500" rows="2" placeholder="Por ejemplo: para cuándo lo necesitas, o el motivo si no la aceptas"></textarea>
      </label>
      <div class="cq-resp-acts" id="cqRespActs">
        <button type="button" class="btn btn-primary" data-resp="aceptada">Aceptar la cotización</button>
        <button type="button" class="btn btn-secondary" data-resp="rechazada">No la acepto</button>
      </div>
      <div id="cqRespMsg" class="cq-resp-msg" role="alert" hidden></div>`;

    const msg = (texto, tipo) => {
      const el = $('cqRespMsg');
      if (!el) return;
      el.hidden = !texto;
      el.textContent = texto || '';
      el.dataset.tipo = tipo || '';
    };
    const acts = $('cqRespActs');
    const botonesIniciales = acts.innerHTML;

    acts.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-resp], button[data-confirmar], button[data-volver]');
      if (!btn) return;
      if (btn.dataset.volver !== undefined) { acts.innerHTML = botonesIniciales; msg(''); return; }

      const nombre = ($('cqRespNombre').value || '').replace(/\s+/g, ' ').trim();
      const comentario = ($('cqRespComentario').value || '').trim();
      if (nombre.length < 3) {
        msg('Escribe tu nombre completo: es la constancia de quién responde.', 'bad');
        $('cqRespNombre').focus();
        return;
      }
      msg('');

      // Paso de confirmación en el mismo bloque: sin modal en esta página.
      if (btn.dataset.resp) {
        const acepta = btn.dataset.resp === 'aceptada';
        acts.innerHTML = `
          <span class="cq-resp-conf">Vas a <b>${acepta ? 'aceptar' : 'declinar'}</b> la cotización <b>${esc(numero)}</b> a nombre de <b>${esc(nombre)}</b>. ¿Confirmas?</span>
          <button type="button" class="btn ${acepta ? 'btn-primary' : 'btn-secondary'}" data-confirmar="${btn.dataset.resp}">Sí, ${acepta ? 'aceptar' : 'declinar'}</button>
          <button type="button" class="btn btn-ghost" data-volver>Volver</button>`;
        return;
      }

      const respuesta = btn.dataset.confirmar;
      acts.querySelectorAll('button').forEach(b => { b.disabled = true; });
      btn.textContent = 'Registrando…';
      try {
        const fn = firebase.functions().httpsCallable('responderCotizacionPublica');
        const { data: res } = await fn({ docId, token: vCode, respuesta, nombre, comentario });
        if (res.status === 'registrada' || res.status === 'ya_respondida') {
          panel.innerHTML = respuestaRegistradaHtml(
            { respuesta: res.respuesta, nombre: res.nombre, fecha: res.fecha },
            { recien: res.status === 'registrada' }
          );
          // El aviso de arriba pasa a decir lo mismo que la base.
          $('cqSituacion')?.remove();
          avisoSituacion(situacion({ ...data, estado: res.estado, respuesta_cliente: { respuesta: res.respuesta } }, data.snapshot));
          return;
        }
        panel.innerHTML = `<b>${esc(res.status === 'vencida' ? 'Esta cotización ya venció' : 'Esta cotización ya no se puede responder')}</b><br>
          <span>Pide a tu vendedor una cotización actualizada.</span>`;
        $('cqSituacion')?.remove();
        avisoSituacion(situacion({ ...data, estado: res.status === 'vencida' ? 'vencida' : (res.estado || 'descartada') }, data.snapshot));
      } catch (err) {
        console.error(err);
        msg('No se pudo registrar tu respuesta: ' + (err?.message || 'inténtalo de nuevo o escríbele a tu vendedor.'), 'bad');
        acts.innerHTML = botonesIniciales;
      }
    });
  }

  (async () => {
    const params = new URLSearchParams(location.search);
    const docId = params.get('id');
    const vCode = params.get('v');
    if (!docId || !vCode) { showError('URL inválida.'); return; }

    try {
      const db = firebase.firestore();
      const snap = await db.collection('cotizacion_verificaciones').doc(docId).get();
      if (!snap.exists) { showError('La cotización no existe o aún no ha sido aprobada.'); return; }
      const data = snap.data() || {};
      if (data.code !== vCode) { showError('Código de verificación inválido.'); return; }

      // Meta data para el render (atención/email no van en el body pero sí en encabezado).
      $('ptMeta').dataset.dirigidoA = data.dirigido_a || '';
      $('ptMeta').dataset.dirigidoEmail = data.dirigido_email || '';
      $('ptMeta').textContent = `Para ${data.cliente_nombre || ''}`;

      const emisor = data.emisor || {};
      render(data.snapshot, emisor, vCode, docId, data.lleva_carta === true);
      if (data.snapshot) {
        const sit = situacion(data, data.snapshot);
        avisoSituacion(sit);
        panelRespuesta(data, sit, docId, vCode);
      }
      // Log de apertura (asíncrono, no bloquea render).
      logOpen(docId, vCode, data.cotizacion_id);
    } catch (e) {
      console.error(e);
      showError('No se pudo cargar la cotización.');
    }
  })();
})();

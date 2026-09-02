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
            <div class="cq-wm">CeComunica</div>
            <div class="cq-tag">Soluciones en Comunicaciones</div>
          </div>
        </div>
        <div class="cq-hd-right">
          <div class="cq-doctype">Cotización</div>
          <div class="cq-num">N° ${esc(snap.id || '—')}</div>
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
          <div class="cq-lbl">Condiciones</div>
          <div class="cq-cgrid">
            ${(snap.condiciones || []).map(c => `<div class="cq-ck">${esc(c.k)}</div><div class="cq-cv">${esc(c.v)}</div>`).join('')}
          </div>
        </div>
        <div class="cq-totals">
          ${totalesEspejo(snap)}
        </div>
      </div>

      <div class="cq-sign">
        <div class="cq-col">
          <div class="cq-line">
            <div class="cq-nm">${esc(ej.nombre || '—')}</div>
            <div class="cq-rl">${esc(ej.rol || 'Ejecutivo de Ventas')} · ${esc(emisor.razon)}</div>
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

      <div class="cq-note">
        Precios expresados en dólares de los Estados Unidos de América (USD), equivalentes a Balboas (PAB). Esta cotización no constituye factura fiscal. Los precios pueden variar sin previo aviso una vez vencida la validez indicada. Equipos sujetos a disponibilidad de inventario al momento de la orden de compra.
      </div>

      <div class="cq-band"></div>
      <div class="cq-ft">
        <span>${esc(emisor.razon)}</span>
        <span class="cq-web">${esc(emisor.web || '')}</span>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
      // Log de apertura (asíncrono, no bloquea render).
      logOpen(docId, vCode, data.cotizacion_id);
    } catch (e) {
      console.error(e);
      showError('No se pudo cargar la cotización.');
    }
  })();
})();

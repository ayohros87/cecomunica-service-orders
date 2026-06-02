// @ts-nocheck
// Vista pública de cotización: lee cotizacion_verificaciones/{id}, valida el código,
// renderiza el print + registra la apertura en cotizacion_opens (un solo log por sesión).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = window.CotizacionTotales;

  function fmtFechaCorta(iso) {
    if (!iso) return '—';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
  }

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

  function render(snap, emisor, vCode, docId) {
    if (!snap) { showError('La cotización no contiene datos.'); return; }
    const cli = snap.cliente || {};
    const ej = snap.ejecutivo || {};
    const dirA = $('ptMeta').dataset.dirigidoA || cli.representante || '';
    const dirEmail = $('ptMeta').dataset.dirigidoEmail || cli.email || '';

    $('ptTitle').textContent = snap.id || 'Cotización';
    const page = $('cqPage');
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
          <thead><tr><th>#</th><th>Descripción</th><th class="c">Cant.</th><th class="r">Precio unit.</th><th class="r">Total</th></tr></thead>
          <tbody>
            ${(snap.items || []).map((it, i) => `
              <tr>
                <td class="idx">${String(i + 1).padStart(2, '0')}</td>
                <td>
                  <div class="cq-desc">${esc(it.nombre)}</div>
                  ${(it.spec || it.modelo) ? `<div class="cq-spec">${esc(it.spec)}${it.modelo ? ' · <span class="cq-model">' + esc(it.modelo) + '</span>' : ''}</div>` : ''}
                </td>
                <td class="qty">${esc(it.cant)}</td>
                <td class="num r">${FMT.money(it.precio)}</td>
                <td class="num r">${FMT.money(T.lineTotal(it))}</td>
              </tr>
            `).join('')}
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
          <div class="cq-trow"><span>Subtotal</span><span class="cq-tv">${FMT.money(snap.subtotal)}</span></div>
          ${snap.descuentoPct > 0 ? `<div class="cq-trow disc"><span>Descuento (${snap.descuentoPct}%)</span><span class="cq-tv">−${FMT.money(snap.descGlobal)}</span></div>` : ''}
          <div class="cq-trow"><span>${snap.itbmsPct > 0 ? 'ITBMS (' + snap.itbmsPct + '%)' : 'ITBMS exento'}</span><span class="cq-tv">${FMT.money(snap.itbms)}</span></div>
          <div class="cq-trow total"><span class="cq-lblt">Total</span><span class="cq-tv">${FMT.money(snap.total)}</span></div>
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
  async function logOpen(docId, vCode, cotizacionId) {
    try {
      const key = 'cot_open_' + docId;
      if (sessionStorage.getItem(key)) return;
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
      render(data.snapshot, emisor, vCode, docId);
      // Log de apertura (asíncrono, no bloquea render).
      logOpen(docId, vCode, data.cotizacion_id);
    } catch (e) {
      console.error(e);
      showError('No se pudo cargar la cotización.');
    }
  })();
})();

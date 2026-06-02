// @ts-nocheck
// Print view de cotización — layout branded cq-* (espejo del kit).
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

  function estadoChipHtml(estado) {
    const e = CotState.ESTADOS[estado] || CotState.ESTADOS.borrador;
    return `<span class="chip-estado ${e.chip}">${e.label}</span>`;
  }

  // Logo SVG inline (mismo del kit)
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

  function render(cot, cli, ej, emisor, doc) {
    const dirigidoA = doc?.dirigido_a || cli.representante || '';
    const dirigidoEmail = doc?.dirigido_email || cli.email || '';
    const t = T.calcTotales(cot);
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
          <div class="cq-num">N° ${esc(cot.id || '—')}</div>
        </div>
      </div>

      <div class="cq-meta">
        <div class="cq-block">
          <div class="cq-lbl">De</div>
          <div class="cq-co">${esc(emisor.razon)}</div>
          <div class="cq-ln">
            RUC <span class="cq-mono">${esc(emisor.ruc)}</span><br>
            ${esc(emisor.dir1)}<br>${esc(emisor.dir2)}<br>
            <b>Tel</b> <span class="cq-mono">${esc(emisor.tel)}</span>${emisor.cel ? ' · <b>Cel</b> <span class="cq-mono">' + esc(emisor.cel) + '</span>' : ''}<br>
            ${esc(emisor.email)}
          </div>
        </div>
        <div class="cq-block">
          <div class="cq-lbl">Para</div>
          <div class="cq-co">${esc(cli.razon || '—')}</div>
          <div class="cq-ln">
            ${dirigidoA ? `<b>Atención:</b> ${esc(dirigidoA)}<br>` : ''}
            RUC <span class="cq-mono">${esc(cli.ruc || '—')}</span><br>
            <b>Tel</b> <span class="cq-mono">${esc(cli.tel || '—')}</span><br>
            ${esc(dirigidoEmail || '')}
          </div>
          <div class="cq-dates">
            <div><div class="cq-k">Fecha</div><div class="cq-v">${esc(fmtFechaCorta(cot.fecha))}</div></div>
            <div><div class="cq-k">Validez</div><div class="cq-v">${esc(cot.validezDias)} días</div></div>
            <div><div class="cq-k">Moneda</div><div class="cq-v">${esc(cot.moneda)}</div></div>
          </div>
        </div>
      </div>

      ${cot.intro ? `<div class="cq-intro">${esc(cot.intro)}</div>` : ''}

      <div class="cq-items">
        <table class="cq-table">
          <thead>
            <tr><th>#</th><th>Descripción</th><th class="c">Cant.</th>
              <th class="r">Precio unit.</th><th class="r">Total</th></tr>
          </thead>
          <tbody>
            ${cot.items.map((it, i) => `
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
            ${cot.condiciones.map(c => `<div class="cq-ck">${esc(c.k)}</div><div class="cq-cv">${esc(c.v)}</div>`).join('')}
          </div>
        </div>
        <div class="cq-totals">
          <div class="cq-trow"><span>Subtotal</span><span class="cq-tv">${FMT.money(t.subtotal)}</span></div>
          ${cot.descuentoPct > 0 ? `<div class="cq-trow disc"><span>Descuento (${cot.descuentoPct}%)</span><span class="cq-tv">−${FMT.money(t.descGlobal)}</span></div>` : ''}
          <div class="cq-trow"><span>${cot.itbmsPct > 0 ? 'ITBMS (' + cot.itbmsPct + '%)' : 'ITBMS exento'}</span><span class="cq-tv">${FMT.money(t.itbms)}</span></div>
          <div class="cq-trow total"><span class="cq-lblt">Total</span><span class="cq-tv">${FMT.money(t.total)}</span></div>
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

    // Toolbar
    $('ptTitle').textContent = cot.id || '—';
    $('ptEstado').innerHTML = estadoChipHtml(cot.estado);
    $('btnEditarPt').addEventListener('click', () => {
      location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(cot._docId);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    const params = new URLSearchParams(location.search);
    const docId = params.get('id');
    if (!docId) { $('cqPage').innerHTML = '<p style="padding:48px;">Falta id.</p>'; return; }

    const [doc, catalogos] = await Promise.all([
      CotizacionesService.getCotizacion(docId),
      CotState.bootstrapCatalogos(),
    ]);
    if (!doc) { $('cqPage').innerHTML = '<p style="padding:48px;">Cotización no encontrada.</p>'; return; }
    const cot = CotState.toUi(doc);
    const cli = catalogos.clientesById[cot.clienteId] || { razon: doc.cliente_nombre || '—', ruc: doc.cliente_ruc || '—', email: doc.cliente_email || '', tel: '', representante: doc.cliente_representante || '' };
    const ej = catalogos.ejecutivos.find(e => e.id === cot.ejecutivoId) || { nombre: doc.ejecutivo_nombre || '—', rol: '', email: '', tel: '' };
    render(cot, cli, ej, catalogos.emisor, doc);
  });
})();

// @ts-nocheck
// Print view de cotización — layout branded cq-* (espejo del kit).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = FMT.esc; // helper canónico (core/formatting.js)
  const T = window.CotizacionTotales;

  function fmtFechaCorta(iso) { return FMT.dateShort(iso); } // delega en el helper canónico

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

  // Antepone las 2 hojas de la carta de presentación como hermanas de #cqPage.
  // Idempotente: un segundo render no duplica las hojas.
  function anteponerCarta(emisor) {
    const page = $('cqPage');
    const stage = page?.parentElement;
    if (!stage) return;
    stage.querySelectorAll('.cq-carta').forEach((el) => el.remove());
    page.insertAdjacentHTML('beforebegin', CartaPresentacion.html({ emisor }));
  }

  // Totales de la propuesta impresa. Este documento lo LEE EL CLIENTE, así que
  // aquí no aparece el "valor evaluado" a 12 meses: ese número es interno, solo
  // sirve para decidir aprobaciones y no es nada que el cliente vaya a pagar.
  // Lo que se le muestra es lo que factura: el pago único y la mensualidad.
  function totalesImpresion(t, cot) {
    const pctD = Number(cot?.descuentoPct || 0);
    const rotuloItbms = cot.itbmsPct > 0 ? 'ITBMS (' + cot.itbmsPct + '%)' : 'ITBMS exento';

    const bloque = (b, titulo, sufijo, cap) => !b.n ? '' : `
      ${cap ? `<div class="cq-tcap">${cap}</div>` : ''}
      <div class="cq-trow"><span>Subtotal</span><span class="cq-tv">${FMT.money(b.subtotal)}</span></div>
      ${pctD > 0 ? `<div class="cq-trow disc"><span>Descuento (${pctD}%)</span><span class="cq-tv">−${FMT.money(b.descGlobal)}</span></div>` : ''}
      <div class="cq-trow"><span>${rotuloItbms}</span><span class="cq-tv">${FMT.money(b.itbms)}</span></div>
      <div class="cq-trow total"><span class="cq-lblt">${titulo}</span><span class="cq-tv">${FMT.money(b.total)}${sufijo}</span></div>`;

    if (!t.hayAlquiler) return bloque(t.venta, 'Total', '', '');

    return `
      ${bloque(t.venta, 'Total equipos', '', t.hayVenta ? 'Equipos en venta' : '')}
      ${bloque(t.alquiler, 'Mensualidad', '<span class="cq-per">/mes</span>', 'Alquiler mensual')}
      ${t.plazoMeses > 0
        ? `<div class="cq-trow"><span>Plazo del alquiler</span><span class="cq-tv">${t.plazoMeses} meses</span></div>`
        : ''}`;
  }

  function render(cot, cli, ej, emisor, doc) {
    const dirigidoA = doc?.dirigido_a || cli.representante || '';
    const dirigidoEmail = doc?.dirigido_email || cli.email || '';
    const t = T.calcTotales(cot);
    const page = $('cqPage');

    // Solo cotizaciones comerciales con la casilla marcada. Las de taller nunca.
    if (CotState.llevaCarta(doc)) anteponerCarta(emisor);

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
              ${t.hayAlquiler ? '<th class="c">Modalidad</th>' : ''}
              <th class="r">Precio unit.</th><th class="r">Total</th></tr>
          </thead>
          <tbody>
            <!-- Agrupado por equipo (reporte jefa de taller, punto 4): un
                 encabezado por radio con su modelo, su serie y el trabajo
                 realizado, en vez del contexto repetido en gris bajo cada fila.
                 La columna de modalidad solo se imprime si la propuesta mezcla
                 venta y alquiler; en una de pura venta sería la misma palabra
                 en todas las filas. -->
            ${T.filasPorEquipoHtml(cot.items, { hayAlquiler: t.hayAlquiler })}
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
          ${totalesImpresion(t, cot)}
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

  // Aviso de "vista previa, sin guardar": oculta el botón Editar (no hay id que
  // editar todavía) y muestra un banner en la barra de impresión.
  function marcarVistaPrevia() {
    const btnEd = $('btnEditarPt');
    if (btnEd) btnEd.style.display = 'none';
    const title = $('ptTitle');
    if (title) title.textContent = 'Vista previa (sin guardar)';
    const toolbar = document.querySelector('.cc-print-toolbar');
    if (toolbar && !$('cqPreviewNote')) {
      const note = document.createElement('div');
      note.id = 'cqPreviewNote';
      note.style.cssText = 'flex-basis:100%; order:99; margin-top:8px; padding:8px 12px; border-radius:6px; background:#FFF7E6; color:#8A5A00; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px;';
      note.innerHTML = '<i data-lucide="eye"></i> Vista previa — esta cotización aún no se ha guardado.';
      toolbar.appendChild(note);
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    const params = new URLSearchParams(location.search);

    // Modo vista previa: renderiza desde el borrador en sessionStorage, sin tocar
    // Firestore. Lo usa el editor para previsualizar/imprimir sin guardar.
    if (params.get('preview') === '1') {
      let cot = null;
      try { cot = JSON.parse(sessionStorage.getItem('cotPreviewDraft') || 'null'); }
      catch (e) { cot = null; }
      if (!cot) { $('cqPage').innerHTML = '<p style="padding:48px;">No hay datos de vista previa. Vuelve al editor e intenta de nuevo.</p>'; return; }
      const catalogos = await CotState.bootstrapCatalogos();
      const cli = catalogos.clientesById[cot.clienteId] || { razon: '—', ruc: '—', email: cot.dirigido_email || '', tel: '', representante: cot.dirigido_a || '' };
      const ej = catalogos.ejecutivos.find(e => e.id === cot.ejecutivoId) || { nombre: '—', rol: '', email: '', tel: '' };
      render(cot, cli, ej, catalogos.emisor, cot);
      marcarVistaPrevia();
      return;
    }

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

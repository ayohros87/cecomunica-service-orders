// @ts-nocheck
// Caja menuda — la SOLICITUD DE PAGO en papel.
//
// El formato que contabilidad usa hoy (muestras de Cheila, 2026-11-26):
// "Páguese a la orden de · La suma de (en letras) · En concepto de ·
// Mediante" y abajo las casillas de firma con su día y mes. El sistema la
// llena con lo que ya consta en él — quién pidió, quién aprobó — y la hoja
// se imprime para llevarla a firmar: revisado, aprobado y el Vo.Bo. del
// director van a mano (Alberto, 2026-11-27).
//
// Sale para lo que no se paga del fondo: el reembolso por ACH (pasa del
// tope) y el cheque de la reposición, que además lleva la lista de recibos.
//
//   CajaSolicitud.html(datos, { por })    el documento completo
//   CajaSolicitud.abrir(datos, { por })   lo abre en una pestaña para imprimir
//
// `datos` es lo que devuelve CajaMenuda.solicitudPago().
window.CajaSolicitud = (() => {
  const esc = (s) => FMT.esc(s);
  const balboas = (n) => `B/.${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');

  function html(d, { por = '' } = {}) {
    const C = window.CajaMenuda;
    const detalle = d.detalle.length ? `
      <table class="det"><thead><tr><th>Factura</th><th class="num">Monto</th><th>Descripción</th></tr></thead><tbody>
        ${d.detalle.map(x => `<tr><td>${x.factura ? 'No. ' + esc(x.factura) : '—'}</td><td class="num">${esc(balboas(x.monto).slice(3))}</td><td>${esc(x.descripcion)}</td></tr>`).join('')}
      </tbody></table>` : '';
    const firma = (f) => `
      <div class="firma">
        <div class="f-rol">${esc(f.rol)}:</div>
        <div class="f-nom">${esc(f.nombre) || '&nbsp;'}</div>
        <div class="f-linea"></div>
        <div class="f-pie"><span>Firma</span><span>Día ____ Mes ____</span></div>
      </div>`;
    const recibos = d.recibos.length ? `
      <h2>Recibos de esta reposición (${d.recibos.length})</h2>
      <table class="rec"><thead><tr><th>Comp.</th><th>Fecha</th><th>Beneficiario</th><th>Categoría</th><th>Descripción</th><th>Aprobó</th><th class="num">Monto</th></tr></thead><tbody>
        ${d.recibos.map(r => `<tr><td class="mono">${esc(r.numero)}</td><td>${esc(dmy(r.fecha))}</td><td>${esc(r.beneficiario)}</td><td>${esc(r.categoria)}</td><td>${esc(r.concepto)}</td><td>${esc(r.aprobo) || '—'}</td><td class="num">${esc(balboas(r.monto).slice(3))}</td></tr>`).join('')}
        <tr class="tot"><td colspan="6">Total</td><td class="num">${esc(balboas(d.monto).slice(3))}</td></tr>
      </tbody></table>` : '';
    const sistema = d.aprobado.filter(a => a.por).map(a =>
      `<li><b>${esc(a.que)}</b> — ${esc(a.por)}${a.fecha ? `, ${esc(dmy(a.fecha))}` : ''}</li>`).join('');

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Solicitud de pago ${esc(d.ref)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; }
        body { background: #e8e6e0; font: 13.5px/1.5 'Segoe UI', Arial, sans-serif; color: #1c1c1c; }
        .toolbar { display: flex; gap: 10px; align-items: center; justify-content: flex-end; max-width: 800px; margin: 0 auto; padding: 12px 16px 0; }
        .toolbar button { font: 600 13.5px 'Segoe UI', Arial, sans-serif; border: 0; border-radius: 8px; cursor: pointer; padding: 9px 16px; background: #0B2A47; color: #fff; }
        .hoja { background: #fff; max-width: 800px; margin: 12px auto 40px; padding: 40px 48px; box-shadow: 0 8px 30px rgba(20,20,30,.18); }
        .emp { font-size: 15px; font-weight: 700; letter-spacing: .04em; }
        h1 { font-size: 20px; letter-spacing: .06em; margin: 2px 0 0; }
        .cab { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #1c1c1c; padding-bottom: 10px; }
        .fecha { font-size: 13px; white-space: nowrap; }
        .campo { display: flex; gap: 10px; align-items: baseline; margin-top: 14px; }
        .campo .lbl { flex: 0 0 150px; font-size: 12.5px; color: #444; }
        .campo .val { flex: 1; border-bottom: 1px solid #1c1c1c; padding: 0 4px 2px; font-weight: 600; min-height: 22px; }
        .campo .val small { font-weight: 400; font-size: 12px; }
        .concepto { margin-top: 14px; border: 1px solid #1c1c1c; padding: 10px 12px; min-height: 90px; }
        .concepto-cab { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: #444; margin-bottom: 6px; }
        .concepto-cab b { color: #1c1c1c; }
        .concepto p { font-weight: 600; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #444; text-align: left; padding: 5px 8px; border-bottom: 1.5px solid #1c1c1c; }
        td { padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
        .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .mono { font-family: Consolas, monospace; white-space: nowrap; }
        .det { margin-top: 10px; font-size: 12.5px; }
        .sistema { margin-top: 14px; padding: 8px 12px; background: #f3f3f0; border-left: 3px solid #0B2A47; font-size: 12px; }
        .sistema b.t { display: block; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #444; margin-bottom: 2px; }
        .sistema ul { list-style: none; padding: 0; }
        .firmas { display: grid; grid-template-columns: repeat(${d.firmas.length > 3 ? 4 : d.firmas.length}, 1fr); gap: 22px; margin-top: 30px; }
        .f-rol { font-size: 12px; color: #444; }
        .f-nom { font-size: 12.5px; font-weight: 600; min-height: 19px; }
        .f-linea { border-bottom: 1px solid #1c1c1c; height: 58px; }
        .f-pie { display: flex; justify-content: space-between; gap: 6px; font-size: 10.5px; color: #444; margin-top: 3px; white-space: nowrap; }
        h2 { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: #444; margin: 30px 0 6px; }
        .rec { font-size: 11.5px; }
        .rec .tot td { font-weight: 700; border-top: 1.5px solid #1c1c1c; border-bottom: 0; }
        .pie { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 10.5px; color: #555; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        @media print {
          body { background: #fff; } .toolbar { display: none; }
          .hoja { box-shadow: none; margin: 0; max-width: none; padding: 8mm 6mm; }
          .sistema { background: none; } .firmas, .sistema, .concepto { break-inside: avoid; } tr { break-inside: avoid; }
        }
      </style></head>
      <body>
        <div class="toolbar"><button onclick="window.print()">🖨 Imprimir</button></div>
        <div class="hoja">
          <div class="cab">
            <div><div class="emp">C COMUNICA, S.A.</div><h1>SOLICITUD DE PAGO</h1></div>
            <div class="fecha">FECHA: <b>${esc(C.fechaLarga(d.fecha))}</b></div>
          </div>
          <div class="campo"><span class="lbl">Páguese a la orden de:</span><span class="val">${esc(String(d.beneficiario || '').toUpperCase())}</span></div>
          <div class="campo"><span class="lbl">La suma de:</span><span class="val">${esc(balboas(d.monto))} <small>(${esc(d.letras)})</small></span></div>
          <div class="concepto">
            <div class="concepto-cab"><span>En concepto de:</span><span>Mediante: <b>${esc(d.mediante)}</b></span></div>
            <p>${esc(d.concepto)}</p>
            ${detalle}
          </div>
          ${sistema ? `<div class="sistema"><b class="t">Ya consta en el sistema · ${esc(d.ref)}</b><ul>${sistema}</ul></div>` : ''}
          <div class="firmas">${d.firmas.map(firma).join('')}</div>
          ${recibos}
          <div class="pie">
            <span>Caja menuda · ${esc(d.ref)}</span>
            <span>Impreso el ${esc(dmy(FMT.hoyISOPanama()))}${por ? ` por ${esc(por)}` : ''}</span>
          </div>
        </div>
      </body></html>`;
  }

  function abrir(d, opts) {
    const w = window.open('', '_blank');
    if (!w) { Toast.show('El navegador bloqueó la pestaña — permite ventanas emergentes.', 'bad'); return false; }
    w.document.write(html(d, opts));
    w.document.close();
    return true;
  }

  return { html, abrir };
})();

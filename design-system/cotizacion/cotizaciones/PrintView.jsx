/* =============================================================
   PrintView — formato imprimible fiel a Cotización.html
   Clases con prefijo cq- para no chocar con app.css
   ============================================================= */
const PRINT_CSS = `
.cq-page{
  width:816px; min-height:1056px; background:#fff; position:relative;
  box-shadow:0 18px 50px rgba(0,0,0,.28); display:flex; flex-direction:column;
  --navy:#0B2A47; --navy-2:#143A5C; --signal:#00B4D8; --blue:#0091D7;
  --ink:#0A1219; --paper:#F5F7FA; --stone:#E4E9EE; --stone-2:#C8D1DA;
  --fg2:#2F3942; --fg3:#4A5560; --fg4:#6B7884;
  font-family:var(--font-body); color:var(--ink);
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.cq-page *{ box-sizing:border-box; }
.cq-hd{ background:var(--navy); color:#fff; padding:16px 48px; display:flex; align-items:center; justify-content:space-between; position:relative; overflow:hidden; }
.cq-hd::before{ content:""; position:absolute; inset:0;
  background-image:radial-gradient(circle, rgba(0,180,216,.45) 1.1px, transparent 1.2px);
  background-size:26px 26px;
  -webkit-mask-image:radial-gradient(ellipse at 92% 50%, #000 0%, transparent 62%);
  mask-image:radial-gradient(ellipse at 92% 50%, #000 0%, transparent 62%); opacity:.5; pointer-events:none; }
.cq-lockup{ display:flex; align-items:center; gap:14px; position:relative; }
.cq-lockup .cq-divider{ width:1px; height:42px; background:rgba(255,255,255,.25); }
.cq-wm{ font-family:var(--font-display); font-weight:800; text-transform:uppercase; letter-spacing:.01em; font-size:25px; color:#fff; line-height:1; }
.cq-tag{ font-size:8.5px; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.72); margin-top:5px; }
.cq-hd-right{ text-align:right; position:relative; }
.cq-doctype{ font-family:var(--font-display); font-weight:700; font-size:30px; letter-spacing:.04em; text-transform:uppercase; line-height:1; color:#fff; }
.cq-num{ font-family:var(--font-mono); font-size:14px; color:var(--signal); margin-top:8px; letter-spacing:.04em; }

.cq-meta{ display:grid; grid-template-columns:1fr 1fr; }
.cq-meta .cq-block{ padding:12px 48px; }
.cq-meta .cq-block + .cq-block{ border-left:1px solid var(--stone); }
.cq-lbl{ font-size:10px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--signal); margin-bottom:10px; }
.cq-co{ font-family:var(--font-display); font-weight:700; font-size:16px; line-height:1.2; color:var(--ink); margin-bottom:6px; }
.cq-ln{ font-size:12.5px; line-height:1.55; color:var(--fg3); }
.cq-ln b{ color:var(--fg2); font-weight:600; }
.cq-mono{ font-family:var(--font-mono); font-size:12px; }
.cq-dates{ margin-top:8px; display:flex; gap:28px; }
.cq-dates .cq-k{ font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--fg4); }
.cq-dates .cq-v{ font-family:var(--font-mono); font-size:13px; color:var(--ink); margin-top:3px; }

.cq-intro{ padding:8px 48px 2px; font-size:12px; line-height:1.5; color:var(--fg3); }

.cq-items{ padding:10px 48px 0; }
.cq-table{ width:100%; border-collapse:collapse; }
.cq-table thead th{ font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#fff; background:var(--navy); padding:8px 14px; text-align:left; }
.cq-table thead th.r{ text-align:right; } .cq-table thead th.c{ text-align:center; }
.cq-table thead th:first-child{ border-radius:5px 0 0 0; } .cq-table thead th:last-child{ border-radius:0 5px 0 0; }
.cq-table tbody td{ padding:6px 14px; border-bottom:1px solid var(--stone); vertical-align:top; font-size:12.5px; color:var(--fg2); }
.cq-table tbody tr:nth-child(even){ background:var(--paper); }
.cq-table td.idx{ font-family:var(--font-mono); color:var(--fg4); font-size:11.5px; width:34px; }
.cq-table td .cq-desc{ font-weight:600; color:var(--ink); font-size:13px; }
.cq-table td .cq-spec{ font-size:11px; color:var(--fg4); margin-top:3px; }
.cq-table td .cq-model{ font-family:var(--font-mono); color:var(--blue); }
.cq-table td.c{ text-align:center; } .cq-table td.r{ text-align:right; }
.cq-table td.num{ font-family:var(--font-mono); font-size:12.5px; color:var(--ink); white-space:nowrap; }
.cq-table td.qty{ font-family:var(--font-mono); font-size:12.5px; color:var(--fg2); text-align:center; width:60px; }

.cq-lower{ display:flex; gap:40px; padding:12px 48px 0; align-items:flex-start; }
.cq-conditions{ flex:1; }
.cq-cgrid{ display:grid; grid-template-columns:auto 1fr; gap:6px 16px; font-size:11.5px; }
.cq-cgrid .cq-ck{ color:var(--fg4); }
.cq-cgrid .cq-cv{ color:var(--fg2); font-weight:500; }
.cq-totals{ width:290px; flex-shrink:0; }
.cq-trow{ display:flex; justify-content:space-between; padding:8px 0; font-size:13px; color:var(--fg3); border-bottom:1px solid var(--stone); }
.cq-trow .cq-tv{ font-family:var(--font-mono); color:var(--ink); }
.cq-trow.disc .cq-tv{ color:var(--blue); }
.cq-trow.total{ margin-top:8px; padding:14px 16px; border:0; border-radius:8px; background:var(--navy); color:#fff; font-family:var(--font-display); font-weight:700; font-size:18px; align-items:baseline; }
.cq-trow.total .cq-tv{ font-family:var(--font-mono); font-weight:700; color:#fff; font-size:20px; }
.cq-trow.total .cq-lblt{ text-transform:uppercase; letter-spacing:.04em; }

.cq-sign{ display:flex; gap:48px; padding:12px 48px 0; margin-top:auto; }
.cq-sign .cq-col{ flex:1; }
.cq-sign .cq-line{ border-top:1.5px solid var(--ink); padding-top:8px; }
.cq-nm{ font-weight:700; font-size:13px; color:var(--ink); }
.cq-rl{ font-size:11.5px; color:var(--fg4); margin-top:2px; }
.cq-ct{ font-family:var(--font-mono); font-size:11px; color:var(--fg3); margin-top:6px; line-height:1.5; }

.cq-note{ padding:10px 48px 8px; font-size:10px; line-height:1.5; color:var(--fg4); }
.cq-ft{ margin-top:8px; display:flex; align-items:center; justify-content:space-between; padding:10px 48px; background:var(--ink); color:rgba(255,255,255,.7); font-size:10.5px; }
.cq-ft .cq-web{ font-family:var(--font-mono); color:var(--signal); }
.cq-band{ height:6px; background:linear-gradient(90deg, var(--navy) 0%, var(--signal) 100%); }
`;

function PrintView({ cot, onBack, onEdit }) {
  const cli = CLIENTES.find((c) => c.id === cot.clienteId) || {};
  const ej = EJECUTIVOS.find((e) => e.id === cot.ejecutivoId) || {};
  const t = calcTotales(cot);

  return (
    <React.Fragment>
      <style>{PRINT_CSS}</style>
      <div className="cc-print-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="arrow-left" size={14} /> Volver</button>
        <span className="cc-pt-title">{cot.id}</span>
        <EstadoChip estado={cot.estado} />
        <div className="app-toolbar-spacer" style={{ flex: 1 }}></div>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(cot.id)}><Icon name="pencil" size={14} /> Editar</button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}><Icon name="printer" size={14} /> Imprimir / PDF</button>
      </div>

      <div className="cc-print-stage">
        <div className="cq-page">
          {/* Header */}
          <div className="cq-hd">
            <div className="cq-lockup">
              <Logo size={48} />
              <div className="cq-divider"></div>
              <div>
                <div className="cq-wm">CeComunica</div>
                <div className="cq-tag">Soluciones en Comunicaciones</div>
              </div>
            </div>
            <div className="cq-hd-right">
              <div className="cq-doctype">Cotización</div>
              <div className="cq-num">N° {cot.id}</div>
            </div>
          </div>

          {/* De / Para */}
          <div className="cq-meta">
            <div className="cq-block">
              <div className="cq-lbl">De</div>
              <div className="cq-co">{EMISOR.razon}</div>
              <div className="cq-ln">
                RUC <span className="cq-mono">{EMISOR.ruc}</span><br />
                {EMISOR.dir1}<br />{EMISOR.dir2}<br />
                <b>Tel</b> <span className="cq-mono">{EMISOR.tel}</span> · <b>Cel</b> <span className="cq-mono">{EMISOR.cel}</span><br />
                {EMISOR.email}
              </div>
            </div>
            <div className="cq-block">
              <div className="cq-lbl">Para</div>
              <div className="cq-co">{cli.razon}</div>
              <div className="cq-ln">
                <b>Atención:</b> {cli.atencion}<br />
                RUC <span className="cq-mono">{cli.ruc}</span><br />
                <b>Tel</b> <span className="cq-mono">{cli.tel}</span><br />
                {cli.email}
              </div>
              <div className="cq-dates">
                <div><div className="cq-k">Fecha</div><div className="cq-v">{fmtFecha(cot.fecha)}</div></div>
                <div><div className="cq-k">Validez</div><div className="cq-v">{cot.validezDias} días</div></div>
                <div><div className="cq-k">Moneda</div><div className="cq-v">{cot.moneda}</div></div>
              </div>
            </div>
          </div>

          {cot.intro && <div className="cq-intro">{cot.intro}</div>}

          {/* Items */}
          <div className="cq-items">
            <table className="cq-table">
              <thead>
                <tr>
                  <th>#</th><th>Descripción</th><th className="c">Cant.</th>
                  <th className="r">Precio unit.</th><th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {cot.items.map((it, i) => (
                  <tr key={it.id}>
                    <td className="idx">{String(i + 1).padStart(2, "0")}</td>
                    <td>
                      <div className="cq-desc">{it.nombre}</div>
                      {(it.spec || it.modelo) && (
                        <div className="cq-spec">{it.spec}{it.modelo ? <span> · <span className="cq-model">{it.modelo}</span></span> : null}</div>
                      )}
                    </td>
                    <td className="qty">{it.cant}</td>
                    <td className="num r">{money(it.precio)}</td>
                    <td className="num r">{money(lineTotal(it))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totales + condiciones */}
          <div className="cq-lower">
            <div className="cq-conditions">
              <div className="cq-lbl">Condiciones</div>
              <div className="cq-cgrid">
                {cot.condiciones.map((c, i) => (
                  <React.Fragment key={i}><div className="cq-ck">{c.k}</div><div className="cq-cv">{c.v}</div></React.Fragment>
                ))}
              </div>
            </div>
            <div className="cq-totals">
              <div className="cq-trow"><span>Subtotal</span><span className="cq-tv">{money(t.subtotal)}</span></div>
              {cot.descuentoPct > 0 && (
                <div className="cq-trow disc"><span>Descuento ({cot.descuentoPct}%)</span><span className="cq-tv">−{money(t.descGlobal)}</span></div>
              )}
              <div className="cq-trow"><span>ITBMS ({cot.itbmsPct}%)</span><span className="cq-tv">{money(t.itbms)}</span></div>
              <div className="cq-trow total"><span className="cq-lblt">Total</span><span className="cq-tv">{money(t.total)}</span></div>
            </div>
          </div>

          {/* Firma */}
          <div className="cq-sign">
            <div className="cq-col">
              <div className="cq-line">
                <div className="cq-nm">{ej.nombre}</div>
                <div className="cq-rl">{ej.rol} · {EMISOR.razon}</div>
                <div className="cq-ct">{ej.email}<br />{ej.tel}</div>
              </div>
            </div>
            <div className="cq-col">
              <div className="cq-line">
                <div className="cq-nm" style={{ color: "var(--fg4)", fontWeight: 500 }}>Aceptación del cliente</div>
                <div className="cq-rl">Nombre, firma y sello</div>
                <div className="cq-ct">Fecha: ______________________</div>
              </div>
            </div>
          </div>

          <div className="cq-note">
            Precios expresados en dólares de los Estados Unidos de América (USD), equivalentes a Balboas (PAB). Esta cotización no constituye factura fiscal. Los precios pueden variar sin previo aviso una vez vencida la validez indicada. Equipos sujetos a disponibilidad de inventario al momento de la orden de compra.
          </div>

          <div className="cq-band"></div>
          <div className="cq-ft">
            <span>C Comunica, S.A.</span>
            <span className="cq-web">{EMISOR.web}</span>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

window.PrintView = PrintView;

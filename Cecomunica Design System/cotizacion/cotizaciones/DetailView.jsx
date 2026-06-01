/* =============================================================
   DetailView — resumen de cotización (solo lectura)
   ============================================================= */
function DetailView({ cot, onBack, onEdit, onPrint, onDuplicate }) {
  const cli = CLIENTES.find((c) => c.id === cot.clienteId) || {};
  const ej = EJECUTIVOS.find((e) => e.id === cot.ejecutivoId) || {};
  const t = calcTotales(cot);
  const vence = addDays(cot.fecha, cot.validezDias);

  /* Historial mock derivado del estado */
  const historial = useMemo(() => {
    const h = [{ act: "Cotización creada", meta: fmtFecha(cot.fecha) + " · " + ej.nombre }];
    if (["enviada", "aprobada", "rechazada", "vencida", "convertida"].includes(cot.estado))
      h.push({ act: "Enviada al cliente", meta: fmtFecha(addDays(cot.fecha, 1)) + " · por correo a " + cli.email });
    if (cot.estado === "aprobada" || cot.estado === "convertida")
      h.push({ act: "Aprobada por el cliente", meta: fmtFecha(addDays(cot.fecha, 5)) + " · orden de compra recibida" });
    if (cot.estado === "convertida")
      h.push({ act: "Convertida a orden de venta", meta: fmtFecha(addDays(cot.fecha, 6)) + " · OV-2025-0210" });
    if (cot.estado === "rechazada")
      h.push({ act: "Rechazada por el cliente", meta: fmtFecha(addDays(cot.fecha, 4)) + " · presupuesto no aprobado" });
    if (cot.estado === "vencida")
      h.push({ act: "Validez vencida", meta: fmtFecha(vence) + " · sin respuesta del cliente" });
    return h.reverse();
  }, [cot]);

  return (
    <div className="app-body">
      <nav className="app-breadcrumbs" aria-label="Breadcrumb">
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Cotizaciones</a>
        <span className="app-breadcrumbs-sep"><Icon name="chevron-right" size={12} /></span>
        <span className="app-breadcrumbs-current">{cot.id}</span>
      </nav>

      <div className="app-page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>{cot.id} <EstadoChip estado={cot.estado} /></h1>
            <p>{cli.razon} · {money(t.total)} · {cot.items.length} renglones</p>
          </div>
        </div>
        <div className="app-page-header-actions">
          <button className="btn btn-ghost" onClick={() => onDuplicate(cot.id)}><Icon name="copy" size={15} /> Duplicar</button>
          <button className="btn btn-secondary" onClick={() => onEdit(cot.id)}><Icon name="pencil" size={15} /> Editar</button>
          <button className="btn btn-primary" onClick={() => onPrint(cot.id)}><Icon name="printer" size={15} /> Imprimir / PDF</button>
        </div>
      </div>

      <div className="cc-detail-grid">
        <div>
          {/* Cliente */}
          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="building-2" size={16} /> Cliente</h3></div>
            <div className="cc-panel-body">
              <dl className="cc-kv">
                <dt>Razón social</dt><dd>{cli.razon}</dd>
                <dt>Atención</dt><dd>{cli.atencion}</dd>
                <dt>RUC</dt><dd style={{ fontFamily: "var(--font-mono)" }}>{cli.ruc}</dd>
                <dt>Teléfono</dt><dd style={{ fontFamily: "var(--font-mono)" }}>{cli.tel}</dd>
                <dt>Correo</dt><dd>{cli.email}</dd>
              </dl>
            </div>
          </div>

          {/* Renglones */}
          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="list" size={16} /> Renglones</h3>
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{cuenta(cot.items)} unidades</span></div>
            <div style={{ padding: "0 4px 4px" }}>
              <table className="app-table">
                <thead>
                  <tr><th style={{ width: 40 }}>#</th><th>Descripción</th><th style={{ width: 70, textAlign: "center" }}>Cant.</th>
                    <th style={{ width: 100, textAlign: "right" }}>P. unit.</th><th style={{ width: 110, textAlign: "right" }}>Total</th></tr>
                </thead>
                <tbody>
                  {cot.items.map((it, i) => (
                    <tr key={it.id} style={{ cursor: "default" }}>
                      <td className="td-muted">{String(i + 1).padStart(2, "0")}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--fg-1)" }}>{it.nombre}</div>
                        <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{it.spec}{it.modelo ? " · " + it.modelo : ""}{it.desc > 0 ? " · desc " + it.desc + "%" : ""}</div>
                      </td>
                      <td style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{it.cant}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(it.precio)}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg-1)" }}>{money(lineTotal(it))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Condiciones */}
          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="clipboard-check" size={16} /> Condiciones</h3></div>
            <div className="cc-panel-body">
              <dl className="cc-kv">
                {cot.condiciones.map((c, i) => (<React.Fragment key={i}><dt>{c.k}</dt><dd>{c.v}</dd></React.Fragment>))}
              </dl>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="calculator" size={16} /> Totales</h3></div>
            <div className="cc-panel-body">
              <div className="cc-sum-row"><span>Subtotal</span><span className="v">{money(t.subtotal)}</span></div>
              {cot.descuentoPct > 0 && <div className="cc-sum-row disc"><span>Descuento ({cot.descuentoPct}%)</span><span className="v">−{money(t.descGlobal)}</span></div>}
              <div className="cc-sum-row"><span>ITBMS ({cot.itbmsPct}%)</span><span className="v">{money(t.itbms)}</span></div>
              <div className="cc-sum-total"><span className="lbl">Total</span><span className="v">{money(t.total)}</span></div>
              <dl className="cc-kv" style={{ marginTop: 18, gridTemplateColumns: "auto 1fr", gap: "8px 14px" }}>
                <dt>Emitida</dt><dd>{fmtFecha(cot.fecha)}</dd>
                <dt>Vence</dt><dd>{fmtFecha(vence)}</dd>
                <dt>Ejecutivo</dt><dd>{ej.nombre}</dd>
              </dl>
            </div>
          </div>

          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="history" size={16} /> Historial</h3></div>
            <div className="cc-panel-body">
              <ul className="cc-timeline">
                {historial.map((h, i) => (
                  <li key={i}><div className="cc-tl-act">{h.act}</div><div className="cc-tl-meta">{h.meta}</div></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.DetailView = DetailView;

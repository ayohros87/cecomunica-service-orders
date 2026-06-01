/* =============================================================
   EditorView — crear / editar cotización
   ============================================================= */
function EditorView({ inicial, esNueva, onCancel, onSave, onPreview }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(inicial)));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const cliente = CLIENTES.find((c) => c.id === draft.clienteId) || {};
  const ejecutivo = EJECUTIVOS.find((e) => e.id === draft.ejecutivoId) || {};
  const t = calcTotales(draft);

  /* ── Renglones ── */
  function updItem(id, patch) {
    setDraft((d) => ({ ...d, items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  }
  function delItem(id) { setDraft((d) => ({ ...d, items: d.items.filter((it) => it.id !== id) })); }
  function addItem() {
    setDraft((d) => ({ ...d, items: [...d.items, { id: uid(), modelo: "", nombre: "", spec: "", cant: 1, precio: 0, desc: 0 }] }));
  }

  /* Drag reorder */
  const dragId = useRef(null);
  const [overId, setOverId] = useState(null);
  function onDrop(targetId) {
    const from = dragId.current;
    if (!from || from === targetId) { setOverId(null); return; }
    setDraft((d) => {
      const arr = d.items.slice();
      const fi = arr.findIndex((x) => x.id === from);
      const ti = arr.findIndex((x) => x.id === targetId);
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      return { ...d, items: arr };
    });
    dragId.current = null; setOverId(null);
  }

  return (
    <div className="app-body">
      <nav className="app-breadcrumbs" aria-label="Breadcrumb">
        <a href="#" onClick={(e) => { e.preventDefault(); onCancel(); }}>Cotizaciones</a>
        <span className="app-breadcrumbs-sep"><Icon name="chevron-right" size={12} /></span>
        <span className="app-breadcrumbs-current">{esNueva ? "Nueva cotización" : "Editar " + draft.id}</span>
      </nav>

      <div className="app-page-header">
        <div>
          <h1>{esNueva ? "Nueva cotización" : draft.id}</h1>
          <p>{esNueva ? "Completa los datos del cliente, renglones y condiciones." : "Editando · " + (ESTADOS[draft.estado] || {}).label}</p>
        </div>
        <div className="app-page-header-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-secondary" onClick={() => onPreview(draft)}><Icon name="eye" size={15} /> Vista previa</button>
          <button className="btn btn-primary" onClick={() => onSave(draft)}><Icon name="save" size={15} /> Guardar</button>
        </div>
      </div>

      <div className="cc-editor-grid">
        {/* ── Columna principal ── */}
        <div>
          {/* Cliente y datos */}
          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="building-2" size={16} /> Cliente y datos</h3></div>
            <div className="cc-panel-body">
              <div className="cc-dp">
                <div className="cc-dp-card">
                  <div className="cc-dp-lbl">De</div>
                  <div className="cc-dp-co">{EMISOR.razon}</div>
                  <div className="cc-dp-ln">
                    RUC <span className="mono">{EMISOR.ruc}</span><br />
                    {EMISOR.dir1}<br />{EMISOR.dir2}<br />
                    Tel <span className="mono">{EMISOR.tel}</span>
                  </div>
                </div>
                <div className="form-field">
                  <label className="form-label">Cliente (Para) <span className="req">*</span></label>
                  <select className="form-select" value={draft.clienteId} onChange={(e) => set({ clienteId: e.target.value })}>
                    {CLIENTES.map((c) => <option key={c.id} value={c.id}>{c.razon}</option>)}
                  </select>
                  <div className="cc-dp-ln" style={{ marginTop: 8 }}>
                    <b>Atención:</b> {cliente.atencion}<br />
                    RUC <span className="mono">{cliente.ruc}</span><br />
                    Tel <span className="mono">{cliente.tel}</span> · {cliente.email}
                  </div>
                </div>
              </div>

              <div className="cc-meta-grid" style={{ marginTop: 20 }}>
                <div className="form-field">
                  <label className="form-label">Fecha</label>
                  <input type="date" className="form-input" value={draft.fecha} onChange={(e) => set({ fecha: e.target.value })} />
                </div>
                <div className="form-field">
                  <label className="form-label">Validez (días)</label>
                  <input type="number" className="form-input" value={draft.validezDias} min="1" onChange={(e) => set({ validezDias: +e.target.value })} />
                </div>
                <div className="form-field">
                  <label className="form-label">Moneda</label>
                  <select className="form-select" value={draft.moneda} onChange={(e) => set({ moneda: e.target.value })}>
                    <option value="USD">USD</option><option value="PAB">PAB</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Ejecutivo (firmante)</label>
                  <select className="form-select" value={draft.ejecutivoId} onChange={(e) => set({ ejecutivoId: e.target.value })}>
                    {EJECUTIVOS.map((ej) => <option key={ej.id} value={ej.id}>{ej.nombre}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Estado</label>
                  <select className="form-select" value={draft.estado} onChange={(e) => set({ estado: e.target.value })}>
                    {ESTADO_ORDEN.map((e) => <option key={e} value={e}>{ESTADOS[e].label}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Vence</label>
                  <input type="text" className="form-input" disabled value={fmtFecha(addDays(draft.fecha, draft.validezDias))} />
                </div>
              </div>

              <div className="form-field" style={{ marginTop: 16 }}>
                <label className="form-label">Texto de introducción</label>
                <textarea className="form-textarea" rows="2" value={draft.intro} onChange={(e) => set({ intro: e.target.value })}></textarea>
              </div>
            </div>
          </div>

          {/* Renglones */}
          <div className="cc-panel">
            <div className="cc-panel-head">
              <h3><Icon name="list" size={16} /> Renglones</h3>
              <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{draft.items.length} líneas · {cuenta(draft.items)} unidades</span>
            </div>
            <div className="cc-panel-body">
              <div className="cc-items">
                <div className="cc-items-head">
                  <span></span><span>Descripción</span><span className="c">Cant.</span>
                  <span className="r">Precio unit.</span><span className="c">Desc. %</span>
                  <span className="r">Total</span><span></span>
                </div>
                {draft.items.map((it) => (
                  <ItemRow
                    key={it.id} it={it} onUpd={updItem} onDel={delItem}
                    onDragStart={() => (dragId.current = it.id)}
                    onDragOver={(e) => { e.preventDefault(); setOverId(it.id); }}
                    onDrop={() => onDrop(it.id)}
                    dragging={dragId.current === it.id} over={overId === it.id}
                  />
                ))}
              </div>
              <button className="btn btn-secondary cc-add-row" onClick={addItem}><Icon name="plus" size={15} /> Agregar renglón</button>
            </div>
          </div>

          {/* Condiciones */}
          <CondicionesPanel draft={draft} setDraft={setDraft} />
        </div>

        {/* ── Sidebar resumen ── */}
        <div className="cc-summary">
          <div className="cc-panel">
            <div className="cc-panel-head"><h3><Icon name="calculator" size={16} /> Resumen</h3></div>
            <div className="cc-panel-body">
              <div className="cc-sum-controls">
                <div className="form-field">
                  <label className="form-label">Descuento global %</label>
                  <input type="number" className="form-input" min="0" max="100" value={draft.descuentoPct} onChange={(e) => set({ descuentoPct: +e.target.value })} />
                </div>
                <div className="form-field">
                  <label className="form-label">ITBMS</label>
                  <select className="form-select" value={draft.itbmsPct} onChange={(e) => set({ itbmsPct: +e.target.value })}>
                    <option value="7">7%</option><option value="0">0% (exento)</option>
                  </select>
                </div>
              </div>
              <div className="cc-sum-row"><span>Subtotal</span><span className="v">{money(t.subtotal)}</span></div>
              {draft.descuentoPct > 0 && (
                <div className="cc-sum-row disc"><span>Descuento ({draft.descuentoPct}%)</span><span className="v">−{money(t.descGlobal)}</span></div>
              )}
              <div className="cc-sum-row"><span>ITBMS ({draft.itbmsPct}%)</span><span className="v">{money(t.itbms)}</span></div>
              <div className="cc-sum-total"><span className="lbl">Total</span><span className="v">{money(t.total)}</span></div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                <button className="btn btn-primary" onClick={() => onSave(draft)} style={{ width: "100%" }}><Icon name="save" size={15} /> Guardar cotización</button>
                <button className="btn btn-secondary" onClick={() => onPreview(draft)} style={{ width: "100%" }}><Icon name="printer" size={15} /> Vista previa / Imprimir</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Renglón individual con autocompletar catálogo ─────────── */
function ItemRow({ it, onUpd, onDel, onDragStart, onDragOver, onDrop, dragging, over }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    const term = (it.nombre || "").toLowerCase();
    if (!term) return CATALOGO.slice(0, 8);
    return CATALOGO.filter((c) => (c.nombre + " " + c.modelo + " " + c.cat).toLowerCase().includes(term)).slice(0, 8);
  }, [it.nombre]);

  useEffect(() => {
    function h(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function pick(p) {
    onUpd(it.id, { modelo: p.modelo, nombre: p.nombre, spec: p.spec, precio: p.precio });
    setOpen(false);
  }

  return (
    <div
      className={"cc-item-row" + (dragging ? " cc-dragging" : "") + (over ? " cc-drag-over" : "")}
      draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={() => onDrop(it.id)}
    >
      <span className="cc-item-handle" title="Arrastrar para reordenar"><Icon name="grip-vertical" size={15} /></span>
      <div className="cc-item-desc" ref={wrapRef} style={{ position: "relative" }}>
        <input
          className="form-input" placeholder="Buscar producto o escribir descripción…"
          value={it.nombre}
          onChange={(e) => { onUpd(it.id, { nombre: e.target.value }); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter" && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        <div className="cc-item-spec">
          <input className="form-input" placeholder="Especificación (opcional)" value={it.spec} onChange={(e) => onUpd(it.id, { spec: e.target.value })} />
        </div>
        {open && matches.length > 0 && (
          <div className="cc-cat-pop">
            {matches.map((p, i) => (
              <div key={p.modelo} className={"cc-cat-item" + (i === hi ? " active" : "")}
                onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <div className="cc-cat-name">{p.nombre}</div>
                <div className="cc-cat-meta">
                  <span className="cc-cat-model">{p.modelo}</span>
                  <span>{p.cat}</span>
                  <span className="cc-cat-price">{money(p.precio)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <input className="form-input ctr-input" type="number" min="0" value={it.cant} onChange={(e) => onUpd(it.id, { cant: +e.target.value })} />
      <input className="form-input num-input" type="number" min="0" step="0.01" value={it.precio} onChange={(e) => onUpd(it.id, { precio: +e.target.value })} />
      <input className="form-input ctr-input" type="number" min="0" max="100" value={it.desc} onChange={(e) => onUpd(it.id, { desc: +e.target.value })} />
      <span className="cc-item-total">{money(lineTotal(it))}</span>
      <button className="btn btn-ghost btn-icon btn-sm cc-item-del" title="Eliminar" onClick={() => onDel(it.id)}><Icon name="trash-2" size={14} /></button>
    </div>
  );
}

/* ── Panel de condiciones (con plantillas) ─────────────────── */
function CondicionesPanel({ draft, setDraft }) {
  function updCond(i, patch) {
    setDraft((d) => ({ ...d, condiciones: d.condiciones.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  }
  function delCond(i) { setDraft((d) => ({ ...d, condiciones: d.condiciones.filter((_, idx) => idx !== i) })); }
  function addCond() { setDraft((d) => ({ ...d, condiciones: [...d.condiciones, { k: "", v: "" }] })); }
  function aplicarPlantilla(id) {
    const p = PLANTILLAS_COND.find((x) => x.id === id);
    if (p) setDraft((d) => ({ ...d, condiciones: JSON.parse(JSON.stringify(p.cond)) }));
  }

  return (
    <div className="cc-panel">
      <div className="cc-panel-head">
        <h3><Icon name="clipboard-check" size={16} /> Condiciones</h3>
        <select className="form-select" style={{ width: 240, height: 32 }} value="" onChange={(e) => e.target.value && aplicarPlantilla(e.target.value)}>
          <option value="">Aplicar plantilla…</option>
          {PLANTILLAS_COND.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div className="cc-panel-body">
        {draft.condiciones.map((c, i) => (
          <div className="cc-cond-row" key={i}>
            <input className="form-input" placeholder="Concepto" value={c.k} onChange={(e) => updCond(i, { k: e.target.value })} />
            <input className="form-input" placeholder="Detalle" value={c.v} onChange={(e) => updCond(i, { v: e.target.value })} />
            <button className="btn btn-ghost btn-icon btn-sm cc-item-del" title="Eliminar" onClick={() => delCond(i)}><Icon name="trash-2" size={14} /></button>
          </div>
        ))}
        <button className="btn btn-secondary cc-add-row" onClick={addCond}><Icon name="plus" size={15} /> Agregar condición</button>
      </div>
    </div>
  );
}

window.EditorView = EditorView;

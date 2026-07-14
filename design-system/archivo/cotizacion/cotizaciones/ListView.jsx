/* =============================================================
   ListView — administración de cotizaciones
   ============================================================= */
function ListView({ cotizaciones, onNew, onOpen, onEdit, onPrint, onDuplicate, onDelete }) {
  const [filtro, setFiltro] = useState("todas");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "fecha", dir: "desc" });

  const clienteDe = (id) => CLIENTES.find((c) => c.id === id) || {};
  const ejecDe = (id) => EJECUTIVOS.find((e) => e.id === id) || {};

  /* Conteos por estado */
  const counts = useMemo(() => {
    const c = { todas: cotizaciones.length };
    ESTADO_ORDEN.forEach((e) => (c[e] = cotizaciones.filter((x) => x.estado === e).length));
    return c;
  }, [cotizaciones]);

  /* Filtrado + búsqueda */
  const filtradas = useMemo(() => {
    let list = cotizaciones.slice();
    if (filtro !== "todas") list = list.filter((c) => c.estado === filtro);
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter((c) => {
        const cli = clienteDe(c.clienteId);
        return (c.id + " " + (cli.razon || "") + " " + (cli.atencion || "")).toLowerCase().includes(term);
      });
    }
    list.sort((a, b) => {
      let av, bv;
      if (sort.key === "total") { av = calcTotales(a).total; bv = calcTotales(b).total; }
      else if (sort.key === "cliente") { av = clienteDe(a.clienteId).razon || ""; bv = clienteDe(b.clienteId).razon || ""; }
      else { av = a[sort.key]; bv = b[sort.key]; }
      const r = av > bv ? 1 : av < bv ? -1 : 0;
      return sort.dir === "asc" ? r : -r;
    });
    return list;
  }, [cotizaciones, filtro, q, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }
  function SortIcon({ col }) {
    const active = sort.key === col;
    return <span className="sort-icon" style={{ opacity: active ? 1 : 0.35 }}>
      <Icon name={active && sort.dir === "asc" ? "chevron-up" : "chevron-down"} size={13} />
    </span>;
  }

  /* Totales del mes (stats) */
  const totalAprobadas = cotizaciones.filter((c) => c.estado === "aprobada" || c.estado === "convertida")
    .reduce((s, c) => s + calcTotales(c).total, 0);
  const pendientes = cotizaciones.filter((c) => c.estado === "enviada").length;
  const tasaCierre = Math.round(
    (counts.aprobada + counts.convertida) / Math.max(1, cotizaciones.length - counts.borrador) * 100
  );

  return (
    <div className="app-body">
      <nav className="app-breadcrumbs" aria-label="Breadcrumb">
        <a href="#" onClick={(e) => e.preventDefault()}>Inicio</a>
        <span className="app-breadcrumbs-sep"><Icon name="chevron-right" size={12} /></span>
        <span className="app-breadcrumbs-current">Cotizaciones</span>
      </nav>

      <div className="app-page-header">
        <div>
          <h1>Cotizaciones</h1>
          <p>{cotizaciones.length} cotizaciones · Actualizado hace 2 min</p>
        </div>
        <div className="app-page-header-actions">
          <button className="btn btn-ghost"><Icon name="download" size={15} /> Exportar</button>
          <button className="btn btn-primary" onClick={onNew}><Icon name="plus" size={15} /> Nueva cotización</button>
        </div>
      </div>

      {/* Stats */}
      <div className="cc-stats">
        <StatCard icon="file-text" label="Total emitidas" value={cotizaciones.length} sub="este trimestre" />
        <StatCard icon="send" label="Enviadas · esperando" value={pendientes} sub="requieren seguimiento" tone="accent" />
        <StatCard icon="check-circle" label="Monto aprobado" value={money(totalAprobadas)} sub="aprobadas + convertidas" tone="green" />
        <StatCard icon="trending-up" label="Tasa de cierre" value={tasaCierre + "%"} sub="sobre cotizaciones enviadas" tone="amber" />
      </div>

      {/* Tabla */}
      <div className="app-table-wrap">
        <div className="filter-bar">
          <div className="cc-segments">
            <button className={"cc-seg" + (filtro === "todas" ? " active" : "")} onClick={() => setFiltro("todas")}>
              Todas <span className="cc-seg-count">{counts.todas}</span>
            </button>
            {ESTADO_ORDEN.map((e) => (
              <button key={e} className={"cc-seg" + (filtro === e ? " active" : "")} onClick={() => setFiltro(e)}>
                {ESTADOS[e].label} <span className="cc-seg-count">{counts[e]}</span>
              </button>
            ))}
          </div>
          <div className="app-toolbar-spacer"></div>
          <div className="filter-search">
            <span className="search-icon"><Icon name="search" size={15} /></span>
            <input type="text" placeholder="Buscar N°, cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <table className="app-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort("id")} style={{ width: 130 }}>N° <SortIcon col="id" /></th>
              <th className="sortable" onClick={() => toggleSort("cliente")}>Cliente <SortIcon col="cliente" /></th>
              <th className="sortable" onClick={() => toggleSort("fecha")} style={{ width: 110 }}>Fecha <SortIcon col="fecha" /></th>
              <th style={{ width: 120 }}>Estado</th>
              <th style={{ width: 150 }}>Ejecutivo</th>
              <th className="sortable" onClick={() => toggleSort("total")} style={{ width: 120, textAlign: "right" }}>Total <SortIcon col="total" /></th>
              <th style={{ width: 150, textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((c) => {
              const cli = clienteDe(c.clienteId);
              const t = calcTotales(c);
              return (
                <tr key={c.id} onClick={() => onOpen(c.id)}>
                  <td><span className="cc-cell-num">{c.id}</span></td>
                  <td>
                    <div className="cc-cell-cliente">{cli.razon}</div>
                    <div className="cc-aten">{cli.atencion}</div>
                  </td>
                  <td className="td-muted">{fmtFecha(c.fecha)}</td>
                  <td><EstadoChip estado={c.estado} /></td>
                  <td style={{ fontSize: 13 }}>{ejecDe(c.ejecutivoId).nombre}</td>
                  <td className="cc-cell-total">{money(t.total)}</td>
                  <td className="td-actions" onClick={(e) => e.stopPropagation()}>
                    <span className="cc-row-actions">
                      <button className="btn btn-ghost btn-icon btn-sm" title="Ver" onClick={() => onOpen(c.id)}><Icon name="eye" size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => onEdit(c.id)}><Icon name="pencil" size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" title="Duplicar" onClick={() => onDuplicate(c.id)}><Icon name="copy" size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" title="Imprimir / PDF" onClick={() => onPrint(c.id)}><Icon name="printer" size={14} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" title="Eliminar" onClick={() => onDelete(c.id)}><Icon name="trash-2" size={14} /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtradas.length === 0 && (
          <div className="app-empty-state">
            <Icon name="search-x" size={40} />
            <strong>Sin resultados</strong>
            <p>No hay cotizaciones que coincidan con el filtro o la búsqueda actual.</p>
          </div>
        )}

        <div className="app-table-footer">
          <span>{filtradas.length} de {cotizaciones.length} cotizaciones</span>
          <div className="app-pagination">
            <span className="app-pagination-page active">1</span>
            <span className="app-pagination-page">2</span>
            <span className="app-pagination-page"><Icon name="chevron-right" size={14} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ListView = ListView;

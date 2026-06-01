/* =============================================================
   App — routing y estado del módulo de cotizaciones
   ============================================================= */
function nuevaCotizacion() {
  const n = COTIZACIONES.length + 143;
  return {
    id: "COT-2025-" + String(n).padStart(4, "0"),
    estado: "borrador", clienteId: CLIENTES[0].id, ejecutivoId: EJECUTIVOS[0].id,
    fecha: new Date().toISOString().slice(0, 10), validezDias: 15, moneda: "USD",
    descuentoPct: 0, itbmsPct: 7,
    intro: "Estimados señores: de acuerdo con su solicitud, presentamos la siguiente cotización de equipos de radiocomunicación profesional y servicios asociados.",
    items: [{ id: uid(), modelo: "", nombre: "", spec: "", cant: 1, precio: 0, desc: 0 }],
    condiciones: JSON.parse(JSON.stringify(CONDICIONES_DEFAULT)),
  };
}

function App() {
  const [lista, setLista] = useState(() => JSON.parse(JSON.stringify(COTIZACIONES)));
  const [route, setRoute] = useState({ view: "list", id: null, draft: null });
  const [confirm, setConfirm] = useState(null);
  const { toasts, push, dismiss } = useToasts();

  const byId = (id) => lista.find((c) => c.id === id);

  /* Navegación */
  const goList = () => { setRoute({ view: "list" }); window.scrollTo(0, 0); };
  const goOpen = (id) => { setRoute({ view: "detail", id }); window.scrollTo(0, 0); };
  const goEdit = (id) => { setRoute({ view: "editor", id, esNueva: false }); window.scrollTo(0, 0); };
  const goNew = () => { setRoute({ view: "editor", id: null, esNueva: true, draft: nuevaCotizacion() }); window.scrollTo(0, 0); };
  const goPrint = (id) => { setRoute({ view: "print", id }); window.scrollTo(0, 0); };
  const goPreviewDraft = (draft) => { setRoute({ view: "print", id: null, draft, fromEditor: true }); window.scrollTo(0, 0); };

  /* Acciones */
  function saveDraft(draft) {
    setLista((l) => {
      const exists = l.some((c) => c.id === draft.id);
      return exists ? l.map((c) => (c.id === draft.id ? draft : c)) : [draft, ...l];
    });
    push({ type: "success", icon: "check-circle", title: "Cotización guardada", desc: draft.id + " guardada correctamente." });
    setRoute({ view: "detail", id: draft.id });
    window.scrollTo(0, 0);
  }
  function duplicate(id) {
    const src = byId(id);
    const n = lista.length + 143;
    const copia = JSON.parse(JSON.stringify(src));
    copia.id = "COT-2025-" + String(n).padStart(4, "0");
    copia.estado = "borrador";
    copia.fecha = new Date().toISOString().slice(0, 10);
    copia.items = copia.items.map((it) => ({ ...it, id: uid() }));
    setLista((l) => [copia, ...l]);
    push({ type: "info", icon: "copy", title: "Cotización duplicada", desc: "Se creó " + copia.id + " como borrador." });
    setRoute({ view: "editor", id: copia.id, esNueva: false });
    window.scrollTo(0, 0);
  }
  function askDelete(id) {
    setConfirm({
      title: "Eliminar cotización", danger: true, confirmLabel: "Eliminar",
      body: "¿Seguro que deseas eliminar " + id + "? Esta acción no se puede deshacer.",
      onConfirm: () => {
        setLista((l) => l.filter((c) => c.id !== id));
        push({ type: "error", icon: "trash-2", title: "Cotización eliminada", desc: id + " fue eliminada." });
        setConfirm(null);
        setRoute({ view: "list" });
      },
    });
  }

  let body;
  if (route.view === "list") {
    body = <ListView cotizaciones={lista} onNew={goNew} onOpen={goOpen} onEdit={goEdit}
      onPrint={goPrint} onDuplicate={duplicate} onDelete={askDelete} />;
  } else if (route.view === "editor") {
    const inicial = route.draft || byId(route.id);
    body = <EditorView inicial={inicial} esNueva={route.esNueva} onCancel={route.esNueva ? goList : () => goOpen(route.id)}
      onSave={saveDraft} onPreview={goPreviewDraft} />;
  } else if (route.view === "detail") {
    body = <DetailView cot={byId(route.id)} onBack={goList} onEdit={goEdit} onPrint={goPrint} onDuplicate={duplicate} />;
  } else if (route.view === "print") {
    const cot = route.draft || byId(route.id);
    const back = route.fromEditor
      ? () => setRoute({ view: "editor", id: cot.id, esNueva: !byId(cot.id), draft: cot })
      : () => goOpen(route.id);
    body = <PrintView cot={cot} onBack={back} onEdit={goEdit} />;
  }

  return (
    <React.Fragment>
      <TopBar onHome={goList} />
      {body}
      <ConfirmModal open={!!confirm} {...(confirm || {})} onCancel={() => setConfirm(null)} />
      <ToastRegion toasts={toasts} dismiss={dismiss} />
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

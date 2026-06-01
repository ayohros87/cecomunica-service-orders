// Estado compartido del editor de cotizaciones: estados, condiciones por defecto,
// adaptadores entre Firestore (esquema del UI Kit) y el editor.
// Expuesto como window.CotState.
(() => {
  // ── Estados (ciclo de vida) ───────────────────────────────────────────────
  const ESTADOS = {
    borrador:   { label: 'Borrador',   chip: 'chip-recibida'  },
    enviada:    { label: 'Enviada',    chip: 'chip-cotizada'  },
    aprobada:   { label: 'Aprobada',   chip: 'chip-aprobada'  },
    rechazada:  { label: 'Rechazada',  chip: 'chip-cancelada' },
    vencida:    { label: 'Vencida',    chip: 'chip-reparacion' },
    convertida: { label: 'Convertida', chip: 'chip-entregada' },
  };
  const ESTADO_ORDEN = ['borrador', 'enviada', 'aprobada', 'rechazada', 'vencida', 'convertida'];

  // ── Condiciones por defecto + plantillas ──────────────────────────────────
  const CONDICIONES_DEFAULT = [
    { k: 'Tiempo de entrega',   v: '4 – 6 semanas tras orden de compra' },
    { k: 'Garantía',            v: '12 meses contra defectos de fábrica' },
    { k: 'Forma de pago',       v: '50% anticipo · 50% contra entrega' },
    { k: 'Validez de la oferta', v: '15 días calendario' },
    { k: 'Instalación',         v: 'No incluida (cotizable aparte)' },
  ];

  const PLANTILLAS_COND = [
    { id: 'estandar', nombre: 'Estándar (venta de equipos)', cond: CONDICIONES_DEFAULT },
    {
      id: 'gobierno', nombre: 'Sector gobierno / licitación', cond: [
        { k: 'Tiempo de entrega', v: '6 – 8 semanas tras orden de compra' },
        { k: 'Garantía', v: '24 meses contra defectos de fábrica' },
        { k: 'Forma de pago', v: 'Contra entrega · crédito 30 días' },
        { k: 'Validez de la oferta', v: '30 días calendario' },
        { k: 'Instalación', v: 'Incluida en sitio' },
      ],
    },
    {
      id: 'servicio', nombre: 'Servicio / mantenimiento', cond: [
        { k: 'Tiempo de respuesta', v: '24 h hábiles' },
        { k: 'Vigencia del contrato', v: '12 meses renovables' },
        { k: 'Forma de pago', v: 'Mensual · transferencia bancaria' },
        { k: 'Validez de la oferta', v: '15 días calendario' },
        { k: 'Cobertura', v: 'Área metropolitana de Panamá' },
      ],
    },
  ];

  // Emisor de fallback si el doc empresa/emisor no existe.
  const EMISOR_FALLBACK = {
    razon: 'C Comunica, S.A.',
    ruc: '32977-27-249966 DV 39',
    dir1: 'C.C. Bal Harbour, Galerías, Mezanine, oficina 5A',
    dir2: 'Vía Italia, Punta Paitilla, Panamá',
    tel: '+507 279-5570',
    cel: '',
    email: 'ventas@cecomunica.com',
    web: 'www.cecomunica.com',
  };

  function uid() { return 'i' + Math.random().toString(36).slice(2, 9); }

  // ── Adaptadores de catálogos ──────────────────────────────────────────────
  function mapClienteToUI(id, c) {
    return {
      id,
      razon: c?.nombre || '',
      representante: c?.representante || '',
      ruc: [c?.ruc, c?.dv].filter(Boolean).join(' DV '),
      tel: c?.telefono || c?.tel || '',
      email: c?.email || '',
      direccion: c?.direccion || '',
    };
  }

  function mapModeloToCatItem(m) {
    const nombre = [m?.marca, m?.modelo].filter(Boolean).join(' ').trim() || m?.nombre || m?.id;
    return {
      modelo: m?.codigo || m?.modelo || m?.id,
      nombre,
      spec: m?.descripcion || m?.spec || '',
      precio: Number(m?.precio_venta || m?.precio || 0),
      cat: m?.categoria || m?.tipo || 'Equipos',
    };
  }

  function mapVendedorToEjec(u) {
    return {
      id: u?.id,
      nombre: u?.nombre || u?.name || u?.email || u?.id,
      rol: u?.cargo || u?.puesto || u?.rol_titulo || 'Ejecutivo de Ventas',
      email: u?.email || '',
      tel: u?.user_cel || u?.cel || u?.celular || '',
    };
  }

  // ── Adaptadores doc <-> UI (esquema del kit, sin legacy) ──────────────────
  function toUi(doc) {
    if (!doc) return null;
    const items = (doc.items || []).map((it) => ({
      id: it.id || uid(),
      modelo: it.modelo || '',
      nombre: it.nombre || '',
      spec: it.spec || '',
      cant: Number(it.cant || 0),
      precio: Number(it.precio || 0),
      desc: Number(it.desc || 0),
    }));
    return {
      _docId: doc.id || null,
      id: doc.cotizacion_id || '',
      estado: doc.estado || 'borrador',
      clienteId: doc.clienteId || '',
      ejecutivoId: doc.ejecutivoId || '',
      fecha: doc.fecha || new Date().toISOString().slice(0, 10),
      validezDias: Number(doc.validezDias || 15),
      moneda: doc.moneda || 'USD',
      descuentoPct: Number(doc.descuentoPct || 0),
      itbmsPct: Number(doc.itbmsPct != null ? doc.itbmsPct : Math.round(FMT.ITBMS_RATE * 100)),
      intro: doc.intro || '',
      items,
      condiciones: Array.isArray(doc.condiciones) && doc.condiciones.length
        ? doc.condiciones.map(c => ({ k: c.k || '', v: c.v || '' }))
        : JSON.parse(JSON.stringify(CONDICIONES_DEFAULT)),
      dirigido_a: doc.dirigido_a || '',
      dirigido_email: doc.dirigido_email || '',
      creado_por_uid: doc.creado_por_uid || null,
      creado_por_email: doc.creado_por_email || null,
      deleted: !!doc.deleted,
    };
  }

  function toDoc(ui, { catalogos } = {}) {
    const cliente = catalogos?.clientesById?.[ui.clienteId] || {};
    const ejec = (catalogos?.ejecutivos || []).find(e => e.id === ui.ejecutivoId) || {};
    const totales = window.CotizacionTotales.calcTotales(ui);
    return {
      cotizacion_id: ui.id,
      estado: ui.estado,
      clienteId: ui.clienteId,
      cliente_nombre: cliente.razon || '',
      cliente_ruc: cliente.ruc || '',
      cliente_email: cliente.email || '',
      cliente_representante: cliente.representante || '',
      // Override por-cotización: a quién se dirige y a qué correo se envía
      dirigido_a: ui.dirigido_a || cliente.representante || '',
      dirigido_email: ui.dirigido_email || cliente.email || '',
      ejecutivoId: ui.ejecutivoId,
      ejecutivo_nombre: ejec.nombre || '',
      fecha: ui.fecha,
      validezDias: Number(ui.validezDias || 15),
      moneda: ui.moneda || 'USD',
      descuentoPct: Number(ui.descuentoPct || 0),
      itbmsPct: Number(ui.itbmsPct || 0),
      intro: ui.intro || '',
      items: (ui.items || []).map((it) => ({
        id: it.id,
        modelo: it.modelo || '',
        nombre: it.nombre || '',
        spec: it.spec || '',
        cant: Number(it.cant || 0),
        precio: Number(it.precio || 0),
        desc: Number(it.desc || 0),
      })),
      condiciones: ui.condiciones || [],
      subtotal: totales.subtotal,
      descuento_global: totales.descGlobal,
      itbms: totales.itbms,
      total: totales.total,
      creado_por_uid: ui.creado_por_uid || null,
      creado_por_email: ui.creado_por_email || null,
      deleted: !!ui.deleted,
    };
  }

  // Genera un id correlativo "COT-YYYY-NNNN" para el año actual.
  async function nextCotizacionId() {
    const now = new Date();
    const y = now.getFullYear();
    const prefix = `COT-${y}-`;
    const start = new Date(y, 0, 1, 0, 0, 0);
    const end = new Date(y, 11, 31, 23, 59, 59, 999);

    let max = 0;
    try {
      const docs = await CotizacionesService.getCotizacionesPorFecha(start, end, { limit: 500 });
      docs.forEach(c => {
        const id = c.cotizacion_id || '';
        if (id.startsWith(prefix)) {
          const n = parseInt(id.slice(prefix.length), 10);
          if (!isNaN(n)) max = Math.max(max, n);
        }
      });
    } catch (e) { /* fallback abajo */ }
    return prefix + String(max + 1).padStart(4, '0');
  }

  function nuevaCotizacion({ ejecutivoId, clienteId } = {}) {
    return {
      _docId: null,
      id: '',
      estado: 'borrador',
      clienteId: clienteId || '',
      ejecutivoId: ejecutivoId || '',
      fecha: new Date().toISOString().slice(0, 10),
      validezDias: 15,
      moneda: 'USD',
      descuentoPct: 0,
      itbmsPct: Math.round(FMT.ITBMS_RATE * 100),
      intro: 'Estimados señores: de acuerdo con su solicitud, presentamos la siguiente cotización de equipos de radiocomunicación profesional y servicios asociados.',
      items: [{ id: uid(), modelo: '', nombre: '', spec: '', cant: 1, precio: 0, desc: 0 }],
      condiciones: JSON.parse(JSON.stringify(CONDICIONES_DEFAULT)),
      dirigido_a: '',
      dirigido_email: '',
    };
  }

  // ── Bootstrap de catálogos ────────────────────────────────────────────────
  async function bootstrapCatalogos() {
    const [clientesRaw, modelosRaw, vendedoresRaw, emisorRaw] = await Promise.all([
      (ClientesService.loadClientes ? ClientesService.loadClientes() : ClientesService.listClientes?.()) || [],
      ModelosService.getModelos(),
      UsuariosService.getVendedores(),
      EmpresaService.getDoc('emisor').catch(() => null),
    ]);

    const clientes = [];
    const clientesById = {};
    if (clientesRaw && typeof clientesRaw[Symbol.iterator] === 'function' && !Array.isArray(clientesRaw)) {
      for (const [id, c] of clientesRaw) {
        const ui = mapClienteToUI(id, c);
        clientes.push(ui);
        clientesById[id] = ui;
      }
    } else if (Array.isArray(clientesRaw)) {
      clientesRaw.forEach(c => {
        const ui = mapClienteToUI(c.id, c);
        clientes.push(ui);
        clientesById[c.id] = ui;
      });
    }
    clientes.sort((a, b) => (a.razon || '').localeCompare(b.razon || '', 'es', { sensitivity: 'base' }));

    const catalogo = (modelosRaw || []).map(mapModeloToCatItem)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

    const ejecutivos = (vendedoresRaw || []).map(mapVendedorToEjec)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

    const emisor = emisorRaw ? { ...EMISOR_FALLBACK, ...emisorRaw } : EMISOR_FALLBACK;

    return { clientes, clientesById, catalogo, ejecutivos, emisor };
  }

  window.CotState = {
    ESTADOS, ESTADO_ORDEN,
    CONDICIONES_DEFAULT, PLANTILLAS_COND,
    EMISOR_FALLBACK,
    uid,
    mapClienteToUI, mapModeloToCatItem, mapVendedorToEjec,
    toUi, toDoc, nuevaCotizacion, nextCotizacionId, bootstrapCatalogos,
  };
})();

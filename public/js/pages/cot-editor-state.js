// Estado compartido del editor de cotizaciones: estados, condiciones por defecto,
// adaptadores entre Firestore (esquema del UI Kit) y el editor.
// Expuesto como window.CotState.
(() => {
  // ── Estados (ciclo de vida) ───────────────────────────────────────────────
  // Colores (auditoría UX 2026-09-28, T1): el éxito ('convertida', que en
  // pantalla se lee "Aceptada") es VERDE; 'aprobada' es un paso interno y va
  // en morado; descartada gris. Las clases chip-cot-* viven en
  // css/cotizaciones-kit.css (ceco-ui.css no se toca desde este módulo).
  const ESTADOS = {
    borrador:   { label: 'Borrador',   chip: 'chip-recibida'  },
    enviada:    { label: 'Enviada',    chip: 'chip-cotizada'  },
    aprobada:   { label: 'Aprobada',   chip: 'chip-cot-aprobada' },
    rechazada:  { label: 'Rechazada',  chip: 'chip-cancelada' },
    // 'descartada' NO es un rechazo del cliente: es el cierre por cualquier
    // otro motivo que el vendedor escribe a mano (típico: se rehace la
    // cotización con otra cantidad de equipos). Chip gris a propósito — ni
    // ganada ni perdida — y fuera de las oportunidades de la tasa de cierre.
    descartada: { label: 'Descartada', chip: 'chip-cot-descartada' },
    vencida:    { label: 'Vencida',    chip: 'chip-reparacion' },
    // Clave 'convertida' (datos), etiqueta "Aceptada" (glosario T2).
    convertida: { label: 'Aceptada',   chip: 'chip-cot-convertida' },
  };
  const ESTADO_ORDEN = ['borrador', 'enviada', 'aprobada', 'rechazada', 'descartada', 'vencida', 'convertida'];

  // Una cotización solo es editable mientras está en 'borrador'. Apenas se aprueba,
  // envía, convierte, rechaza o vence queda como registro inmutable — ni siquiera un
  // admin la edita. Para cambiarla se usa "Duplicar", que crea un nuevo borrador.
  function esEditable(estado) { return (estado || 'borrador') === 'borrador'; }

  // ── Carta de presentación ─────────────────────────────────────────────────
  // Las cotizaciones de taller (nacen de una orden de servicio, cotizar-orden.js
  // les pone origen 'orden' + orden_id) nunca llevan carta: el cliente ya conoce
  // a la empresa, su equipo está en el taller. Las comerciales sí, salvo que el
  // vendedor desmarque la casilla — típicamente al reenviar a un recurrente.
  //
  // El `|| !!orden_id` cubre documentos anteriores a que existiera `origen`:
  // sin él, una cotización de servicio vieja se leería como comercial y se le
  // antepondría la carta.
  function esCotizacionDeTaller(doc) {
    return (doc?.origen || '') === 'orden' || !!doc?.orden_id;
  }

  // Etiqueta del estado según el tipo: en el taller 'convertida' se lee
  // "Aceptada" (ver CotizacionTaller.estadoLabel).
  function estadoLabel(estado, doc) {
    // Rechazo del aprobador ≠ cliente declinó (auditoría UX 2026-09-28, P0 #17).
    if (estado === 'rechazada' && doc?.rechazo_origen === 'aprobador') return 'Rechazada · aprobador';
    const base = ESTADOS[estado]?.label || estado;
    return window.CotizacionTaller ? CotizacionTaller.estadoLabel(estado, doc, base) : base;
  }

  // Decisión final para un documento (o su forma UI). `incluye_carta` ausente
  // se trata como true: el default es incluirla.
  function llevaCarta(doc) {
    return !esCotizacionDeTaller(doc) && doc?.incluye_carta !== false;
  }

  // ── Condiciones por defecto + plantillas ──────────────────────────────────
  const CONDICIONES_DEFAULT = [
    { k: 'Tiempo de entrega',   v: '4 – 6 semanas tras orden de compra' },
    { k: 'Garantía',            v: '12 meses contra defectos de fábrica' },
    { k: 'Forma de pago',       v: '50% anticipo · 50% contra entrega' },
    { k: 'Validez de la cotización', v: '15 días calendario' },
    { k: 'Instalación',         v: 'No incluida (cotizable aparte)' },
  ];

  const PLANTILLAS_COND = [
    { id: 'estandar', nombre: 'Estándar (venta de equipos)', cond: CONDICIONES_DEFAULT },
    {
      id: 'gobierno', nombre: 'Sector gobierno / licitación', cond: [
        { k: 'Tiempo de entrega', v: '6 – 8 semanas tras orden de compra' },
        { k: 'Garantía', v: '24 meses contra defectos de fábrica' },
        { k: 'Forma de pago', v: 'Contra entrega · crédito 30 días' },
        { k: 'Validez de la cotización', v: '30 días calendario' },
        { k: 'Instalación', v: 'Incluida en sitio' },
      ],
    },
    {
      id: 'servicio', nombre: 'Servicio / mantenimiento', cond: [
        { k: 'Tiempo de respuesta', v: '24 h hábiles' },
        { k: 'Vigencia del contrato', v: '12 meses renovables' },
        { k: 'Forma de pago', v: 'Mensual · transferencia bancaria' },
        { k: 'Validez de la cotización', v: '15 días calendario' },
        { k: 'Cobertura', v: 'Área metropolitana de Panamá' },
      ],
    },
    // Reparación en el taller (2026-09-25). La misma definición que usa la
    // pantalla de cotizar una orden.
    { id: 'taller', nombre: 'Reparación (taller)', cond: (window.CotizacionTaller?.CONDICIONES_TALLER) || [] },
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
      itbms_exento: !!c?.itbms_exento,
      itbms_motivo_exencion: c?.itbms_motivo_exencion || '',
    };
  }

  function mapModeloToCatItem(m) {
    const nombre = [m?.marca, m?.modelo].filter(Boolean).join(' ').trim() || m?.nombre || m?.id;
    const precioVenta = Number(m?.precio_venta || m?.precio || 0);
    const precioAlquiler = Number(m?.precio_alquiler || 0);
    return {
      modelo: m?.codigo || m?.modelo || m?.id,
      nombre,
      spec: m?.descripcion || m?.spec || '',
      // `precio` se conserva como el de VENTA por compatibilidad con quien ya
      // lo consume; el editor elige entre los dos según la modalidad del renglón.
      precio: precioVenta,
      precioVenta,
      precioAlquiler,
      esAlquiler: m?.es_alquiler === true,
      cat: m?.categoria || m?.tipo || 'Equipos',
    };
  }

  // Precio sugerido del catálogo para una modalidad. Devuelve null cuando no
  // hay precio cargado: es distinto de 0 y las pantallas lo dicen ("sin
  // tarifa") en vez de escribir un cero que parece un precio real.
  function precioSugerido(catItem, modalidad) {
    if (!catItem) return null;
    const v = modalidad === 'alquiler'
      ? Number(catItem.precioAlquiler || 0)
      : Number(catItem.precioVenta || 0);
    return v > 0 ? v : null;
  }

  function mapVendedorToEjec(u) {
    return {
      id: u?.id,
      nombre: u?.nombre || u?.name || u?.email || u?.id,
      // El cargo de la persona (usuarios.cargo, lo pone administración en
      // Usuarios) y, sin él, el de su ROL: antes todo el que no tenía cargo
      // salía "Ejecutivo de Ventas", incluida la jefa de taller.
      rol: u?.cargo || u?.puesto || u?.rol_titulo
        || (window.CotizacionTaller ? CotizacionTaller.cargoPorRol(u?.rol) : '')
        || 'Ejecutivo de Ventas',
      email: u?.email || '',
      tel: u?.user_cel || u?.cel || u?.celular || '',
    };
  }

  // ── Adaptadores doc <-> UI (esquema del kit, sin legacy) ──────────────────
  // Esquema ITBMS alineado con contratos/órdenes:
  //   - `itbms_aplica` (boolean) — fuente de verdad de si se cobra ITBMS.
  //   - `itbms_porcentaje` (decimal, e.g. 0.07) — siempre = FMT.ITBMS_RATE.
  //   - `itbms_monto`, `total_con_itbms` — calculados al persistir.
  // El campo `itbmsPct` se conserva en la UI como número entero (0 o 7) para
  // los inputs, pero al guardar se traduce a itbms_aplica + itbms_porcentaje.
  function toUi(doc) {
    if (!doc) return null;
    const items = (doc.items || []).map((it) => ({
      id: it.id || uid(),
      modelo: it.modelo || '',
      nombre: it.nombre || '',
      spec: it.spec || '',
      // Equipo al que pertenece el renglón, estructurado. Ausente en las
      // cotizaciones emitidas antes del desglose por equipo — quien agrupa
      // debe caer a `spec` (ver CotState.agruparPorEquipo).
      equipo: it.equipo || null,
      cant: Number(it.cant || 0),
      precio: Number(it.precio || 0),
      desc: Number(it.desc || 0),
      // Modalidad del renglón. Ausente = venta: así una cotización anterior a
      // este campo se lee y recalcula exactamente igual que siempre.
      modalidad: it.modalidad === 'alquiler' ? 'alquiler' : 'venta',
    }));
    // Resuelve ITBMS: prioriza `itbms_aplica` (esquema canónico). Fallback al
    // `itbmsPct` legacy y al default global FMT.ITBMS_RATE.
    let itbmsPct;
    if (typeof doc.itbms_aplica === 'boolean') {
      itbmsPct = doc.itbms_aplica ? Math.round(FMT.ITBMS_RATE * 100) : 0;
    } else if (doc.itbmsPct != null) {
      itbmsPct = Number(doc.itbmsPct);
    } else {
      itbmsPct = Math.round(FMT.ITBMS_RATE * 100);
    }
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
      itbmsPct,
      intro: doc.intro || '',
      items,
      // Plazo del alquiler, en meses. Vive en el DOCUMENTO: una cotización es
      // un solo acuerdo con un solo plazo, y se convierte en un solo contrato.
      plazoMeses: Number(doc.plazoMeses || 0),
      // Sin condiciones guardadas, una comercial vieja se sigue leyendo con las
      // de venta de siempre. Una de TALLER no: sin condiciones es sin
      // condiciones — rellenarla con las de venta era justo lo que Solangel
      // pidió quitar.
      condiciones: Array.isArray(doc.condiciones) && doc.condiciones.length
        ? doc.condiciones.map(c => ({ k: c.k || '', v: c.v || '' }))
        : (esCotizacionDeTaller(doc) ? [] : JSON.parse(JSON.stringify(CONDICIONES_DEFAULT))),
      dirigido_a: doc.dirigido_a || '',
      dirigido_email: doc.dirigido_email || '',
      // Adjuntos (brochures / fichas técnicas) que viajan con la propuesta.
      adjuntos: Array.isArray(doc.adjuntos) ? doc.adjuntos.map(a => ({
        id: a.id || uid(),
        nombre: a.nombre || a.path || 'archivo',
        url: a.url || '',
        path: a.path || '',
        content_type: a.content_type || null,
        size: Number(a.size || 0),
      })) : [],
      // Tipo de cotización (servicio vs comercial). Se conserva en el round-trip
      // para que editar una cotización de servicio no la reclasifique como comercial.
      origen: doc.origen || '',
      orden_id: doc.orden_id || '',
      // Carta de presentación: ausente = true (default ON en cotizaciones
      // comerciales). El gate por origen lo aplica llevaCarta(), no este campo.
      incluye_carta: typeof doc.incluye_carta === 'boolean' ? doc.incluye_carta : true,
      creado_por_uid: doc.creado_por_uid || null,
      creado_por_email: doc.creado_por_email || null,
      // Firmante tal como quedó guardado. El detalle y el "Atentamente" del
      // correo caían a "—" porque este campo no viajaba: la jefa de taller no
      // está en el catálogo de vendedores y no había de dónde sacar su nombre.
      ejecutivo_nombre: doc.ejecutivo_nombre || '',
      ejecutivo_cargo: doc.ejecutivo_cargo || '',
      ejecutivo_email: doc.ejecutivo_email || '',
      // Taller: cómo aceptó el cliente, la gestión de reemplazo que la originó
      // (reposición por daño) y el estado de su facturación (lo escriben las
      // Cloud Functions).
      aceptacion: doc.aceptacion || null,
      gestion_id: doc.gestion_id || '',
      facturacion: doc.facturacion || null,
      // Timestamps del ciclo de vida — usados por el historial para mostrar
      // las fechas reales en vez de derivarlas de la fecha de creación.
      fecha_creacion: doc.fecha_creacion || null,
      enviada_en: doc.enviada_en || null,
      fecha_aprobacion: doc.fecha_aprobacion || null,
      fecha_conversion: doc.fecha_conversion || null,
      fecha_rechazo: doc.fecha_rechazo || null,
      // Quién y por qué (auditoría de módulos 2026-09-30, R2): el detalle
      // lee estos siete campos de este objeto y, al no viajar, decía "el
      // cliente declinó" cuando rechazó el aprobador, "Descartada —" sin
      // motivo ni fecha y "Aprobada internamente" sin quién.
      rechazo_origen: doc.rechazo_origen || null,
      rechazo_motivo: doc.rechazo_motivo || '',
      rechazado_por_email: doc.rechazado_por_email || null,
      cierre_motivo: doc.cierre_motivo || '',
      fecha_descarte: doc.fecha_descarte || null,
      aprobado_por_email: doc.aprobado_por_email || null,
      respuesta_cliente: doc.respuesta_cliente || null,
      deleted: !!doc.deleted,
    };
  }

  function toDoc(ui, { catalogos } = {}) {
    const cliente = catalogos?.clientesById?.[ui.clienteId] || {};
    const ejec = (catalogos?.ejecutivos || []).find(e => e.id === ui.ejecutivoId) || {};
    const totales = window.CotizacionTotales.calcTotales(ui);
    // ITBMS canónico (alineado con contratos/órdenes vía FMT.ITBMS_RATE)
    const itbmsAplica = Number(ui.itbmsPct || 0) > 0;
    const itbmsPorc = FMT.ITBMS_RATE;
    return {
      cotizacion_id: ui.id,
      estado: ui.estado,
      clienteId: ui.clienteId,
      cliente_nombre: cliente.razon || '',
      cliente_ruc: cliente.ruc || '',
      cliente_email: cliente.email || '',
      cliente_representante: cliente.representante || '',
      cliente_itbms_exento: !!cliente.itbms_exento,
      // Override por-cotización: a quién se dirige y a qué correo se envía
      dirigido_a: ui.dirigido_a || cliente.representante || '',
      dirigido_email: ui.dirigido_email || cliente.email || '',
      ejecutivoId: ui.ejecutivoId,
      // Si el firmante no está en el catálogo cargado (la jefa de taller no es
      // vendedora) se conserva lo que ya decía el documento: antes, volver a
      // guardar un borrador de taller le borraba el nombre al firmante.
      ejecutivo_nombre: ejec.nombre || ui.ejecutivo_nombre || '',
      ejecutivo_cargo: ejec.rol || ui.ejecutivo_cargo || '',
      ejecutivo_email: ejec.email || ui.ejecutivo_email || '',
      fecha: ui.fecha,
      validezDias: Number(ui.validezDias) || Number(window.EMPRESA_CONFIG?.cotizacion_validez_dias) || 15,
      moneda: ui.moneda || 'USD',
      descuentoPct: Number(ui.descuentoPct || 0),
      // Campos canónicos ITBMS (mismo esquema que contratos)
      itbms_aplica: itbmsAplica,
      itbms_porcentaje: itbmsPorc,
      itbms_monto: FMT.round2(totales.itbms),
      total_con_itbms: FMT.round2(totales.total),
      // Espejo legacy para vistas internas del kit
      itbmsPct: itbmsAplica ? Math.round(itbmsPorc * 100) : 0,
      intro: ui.intro || '',
      items: (ui.items || []).map((it) => ({
        id: it.id,
        modelo: it.modelo || '',
        nombre: it.nombre || '',
        spec: it.spec || '',
        // null explícito y no `undefined`: Firestore rechaza undefined.
        equipo: it.equipo || null,
        cant: Number(it.cant || 0),
        precio: Number(it.precio || 0),
        desc: Number(it.desc || 0),
        // En alquiler, `precio` es POR MES. La modalidad es lo único que
        // distingue los dos significados del mismo campo.
        modalidad: window.CotizacionTotales.modalidadDe(it),
      })),
      // Plazo del alquiler (meses). 0 = no aplica / sin declarar.
      plazoMeses: Math.max(0, Math.round(Number(ui.plazoMeses || 0))),
      condiciones: ui.condiciones || [],
      // Adjuntos: se persisten en el doc para que viajen automáticamente en cada
      // envío de la propuesta (detalle, listado y aprobar-y-enviar).
      adjuntos: (ui.adjuntos || []).map(a => ({
        id: a.id,
        nombre: a.nombre || '',
        url: a.url || '',
        path: a.path || '',
        content_type: a.content_type || null,
        size: Number(a.size || 0),
      })),
      subtotal: FMT.round2(totales.subtotal),
      descuento_global: FMT.round2(totales.descGlobal),
      // `total` es el VALOR EVALUADO: la venta más el alquiler proyectado a un
      // máximo de 12 meses. Para una cotización de pura venta —todas las que
      // existen hoy— es el mismo número de siempre, así que el listado, los KPI
      // de Finanzas, la búsqueda global y firestore.rules siguen leyéndolo sin
      // migración. Ver CotizacionTotales.calcTotales.
      total: FMT.round2(totales.total),
      // Los dos totales REALES, para las pantallas que muestran el desglose.
      total_venta: FMT.round2(totales.venta.total),
      total_mensual: FMT.round2(totales.alquiler.total),
      // Compromiso del plazo acordado (mensual × plazo real). Informativo:
      // nunca se compara contra el techo de envío directo.
      compromiso_plazo: FMT.round2(totales.compromiso),
      // Tipo de cotización: por defecto 'comercial'. cotizar-orden.js sobrescribe
      // con 'orden' + orden_id después de toDoc (cotizaciones de servicio).
      origen: ui.origen || 'comercial',
      ...(ui.orden_id ? { orden_id: ui.orden_id } : {}),
      ...(ui.gestion_id ? { gestion_id: ui.gestion_id } : {}),
      // Casilla "Incluir carta de presentación" — es solo la preferencia del
      // vendedor. En las de taller queda en true y sin efecto: el corte por
      // origen lo aplica llevaCarta(), no este campo.
      incluye_carta: ui.incluye_carta !== false,
      creado_por_uid: ui.creado_por_uid || null,
      creado_por_email: ui.creado_por_email || null,
      deleted: !!ui.deleted,
    };
  }

  // Genera un id correlativo "COT-YYYY-NNNN" para el año actual.
  // Correlativo COT-YYYY-NNNN. Antes era un max+1 sobre un scan del año, SIN
  // atomicidad: dos creaciones simultáneas leían el mismo max y devolvían el
  // mismo número; y si el scan fallaba caía a 0 → COT-YYYY-0001. Ambas cosas
  // pasaron en producción — COT-2026-0012 quedó asignado a 3 documentos el mismo
  // día. Ahora el número se RESERVA en una transacción sobre
  // contadores/cotizaciones_{año}, que serializa a los concurrentes.
  //
  // `piso` = máximo correlativo ya existente en el año. Cumple dos papeles:
  //   1) auto-siembra el contador la primera vez que se usa en el año (los docs
  //      creados por el método viejo no dejaron contador) para no reiniciar en 1;
  //   2) colchón de compatibilidad si el contador quedara por detrás.
  // El scan es best-effort: una vez sembrado el contador, su fallo es inocuo — a
  // diferencia de antes, ya no puede producir un 0001 duplicado.
  async function nextCotizacionId() {
    const db = firebase.firestore();
    const y = new Date().getFullYear();
    const prefix = `COT-${y}-`;
    const start = new Date(y, 0, 1, 0, 0, 0);
    const end = new Date(y, 11, 31, 23, 59, 59, 999);

    let piso = 0;
    try {
      const docs = await CotizacionesService.getCotizacionesPorFecha(start, end, { limit: 500 });
      docs.forEach(c => {
        const id = c.cotizacion_id || '';
        if (id.startsWith(prefix)) {
          const n = parseInt(id.slice(prefix.length), 10);
          if (!isNaN(n)) piso = Math.max(piso, n);
        }
      });
    } catch (_) { /* el contador sembrado cubre el caso normal; piso queda en 0 */ }

    const ref = db.collection('contadores').doc(`cotizaciones_${y}`);
    const seq = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const actual = snap.exists ? Number(snap.data().seq || 0) : 0;
      const siguiente = Math.max(actual, piso) + 1;
      t.set(ref, {
        seq: siguiente,
        anio: y,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return siguiente;
    });
    return prefix + String(seq).padStart(4, '0');
  }

  function nuevaCotizacion({ ejecutivoId, clienteId } = {}) {
    return {
      _docId: null,
      id: '',
      estado: 'borrador',
      clienteId: clienteId || '',
      ejecutivoId: ejecutivoId || '',
      fecha: new Date().toISOString().slice(0, 10),
      // Configurable en empresa/config.cotizacion_validez_dias (admin/config);
      // el literal 15 es el fallback ante config vacía o Firestore caído.
      validezDias: Number(window.EMPRESA_CONFIG?.cotizacion_validez_dias) || 15,
      moneda: 'USD',
      descuentoPct: 0,
      itbmsPct: Math.round(FMT.ITBMS_RATE * 100),
      intro: 'Estimados señores: de acuerdo con su solicitud, presentamos la siguiente cotización de equipos de radiocomunicación profesional y servicios asociados.',
      items: [{ id: uid(), modelo: '', nombre: '', spec: '', cant: 1, precio: 0, desc: 0, modalidad: 'venta' }],
      plazoMeses: 0,
      condiciones: JSON.parse(JSON.stringify(CONDICIONES_DEFAULT)),
      dirigido_a: '',
      dirigido_email: '',
      adjuntos: [],
      incluye_carta: true,
    };
  }

  // Convierte los adjuntos guardados en el doc al formato de attachments de
  // nodemailer. Usa `path` (download URL) para que la Cloud Function los baje
  // de Storage al enviar — los docs de mail_queue tienen tope de 1 MB, así que
  // no se puede embeber el contenido. Filtra los que no tengan URL.
  function adjuntosToAttachments(adjuntos) {
    return (adjuntos || [])
      .filter(a => a && a.url)
      .map(a => ({
        filename: a.nombre || 'adjunto',
        path: a.url,
        ...(a.content_type ? { contentType: a.content_type } : {}),
      }));
  }

  // ── Bootstrap de catálogos ────────────────────────────────────────────────
  async function bootstrapCatalogos() {
    const [clientesRaw, modelosRaw, vendedoresRaw, emisorRaw] = await Promise.all([
      (ClientesService.loadClientes ? ClientesService.loadClientes() : ClientesService.listClientes?.()) || [],
      ModelosService.getModelos(),
      UsuariosService.getVendedores(),
      EmpresaService.getDoc('emisor').catch(() => null),
    ]);

    // `clientes` es lo que se ofrece para elegir: excluye los borrados (los
    // duplicados que Admin · Clientes duplicados fusionó quedan con
    // deleted:true, y seguían apareciendo en el selector — el caso de los dos
    // "HOTEL LATINO"). `clientesById` sí los conserva: una cotización vieja
    // puede apuntar a un cliente ya fusionado y debe seguir mostrando su RUC.
    const clientes = [];
    const clientesById = {};
    const agrega = (id, c) => {
      const ui = mapClienteToUI(id, c);
      clientesById[id] = ui;
      if (c?.deleted !== true) clientes.push(ui);
    };
    if (clientesRaw && typeof clientesRaw[Symbol.iterator] === 'function' && !Array.isArray(clientesRaw)) {
      for (const [id, c] of clientesRaw) agrega(id, c);
    } else if (Array.isArray(clientesRaw)) {
      clientesRaw.forEach(c => agrega(c.id, c));
    }
    clientes.sort((a, b) => (a.razon || '').localeCompare(b.razon || '', 'es', { sensitivity: 'base' }));

    const catalogo = (modelosRaw || []).map(mapModeloToCatItem)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

    const ejecutivos = (vendedoresRaw || []).map(mapVendedorToEjec)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

    const emisor = emisorRaw ? { ...EMISOR_FALLBACK, ...emisorRaw } : EMISOR_FALLBACK;

    return { clientes, clientesById, catalogo, ejecutivos, emisor };
  }

  // ── ¿Este borrador necesita aprobación antes de salir? ────────────────────
  // Única definición para las TRES puertas por las que nace un borrador:
  // Guardar (cot-editor), Duplicar desde el detalle y Duplicar desde el
  // listado. Vivían separadas y solo la primera consultaba la política, así
  // que toda copia notificaba al aprobador aunque estuviera dentro del umbral
  // — de ahí COT-2026-0042 ($160.50, sin descuento, copia de COT-2026-0035).
  // Devuelve la misma forma que CotizacionTotales.requiereAprobacion.
  function requiereAprobacionPara({ doc, rol, policy }) {
    const T = window.CotizacionTotales;
    // evaluarPolitica recalcula los totales desde los items, así que el
    // descuento por renglón (A10) y la proyección del alquiler a 12 meses
    // entran solas — ya no hay un input que armar y al que se le puedan
    // olvidar los `items`, que fue exactamente el bug de las tres puertas.
    const pol = T.evaluarPolitica(doc, policy);
    if (pol.requiere) return pol;
    // Dentro de umbral, pero el rol tiene que poder enviarla él mismo; si no,
    // alguien la tiene que aprobar igual.
    if (typeof window.canRole === 'function' && window.canRole(rol, 'enviar-cotizacion')) return pol;
    return { requiere: true, motivos: ['Tu rol no puede enviar cotizaciones al cliente.'] };
  }

  // ── Duplicar (una sola implementación, auditoría UX 2026-09-28 §4.5 #12) ──
  // La lista copiaba el documento crudo con spread y borraba a mano una lista
  // de campos del ciclo de vida; el detalle pasaba por toDoc. Cada campo nuevo
  // del ciclo (respuesta_cliente, rechazo_origen, searchTokens…) había que
  // acordarse de borrarlo en la lista. toDoc es una lista BLANCA: la copia
  // nace solo con el contenido de la propuesta.
  //   ui  → forma UI (toUi). raw → doc crudo: de ahí salen los datos del
  //         cliente cuando la página no cargó el catálogo (la lista no lo carga).
  let _duplicando = false;
  // Devuelve { id, numero } del borrador nuevo (o null). `confirmar:false` y
  // `navegar:false` los usa rehacer(), que confirma por su cuenta y navega
  // después de descartar la original.
  async function duplicar({ ui, raw = null, rol, policy, catalogos = null, confirmar = true, navegar = true }) {
    if (_duplicando) return null;
    const src = ui || toUi(raw);
    if (confirmar) {
      const ok = await Modal.confirm({
        title: 'Duplicar cotización',
        message: `Se creará una copia de ${src.id || 'esta cotización'} como nueva cotización en borrador (consume un número COT nuevo). ¿Continuar?`,
        confirmLabel: 'Duplicar',
      });
      if (!ok) return null;
    }
    _duplicando = true;
    try {
      const nuevoId = await nextCotizacionId();
      const user = firebase.auth().currentUser;
      const copia = toDoc(
        { ...src, id: nuevoId, estado: 'borrador', fecha: new Date().toISOString().slice(0, 10),
          creado_por_uid: user?.uid || null, creado_por_email: user?.email || null, deleted: false },
        { catalogos }
      );
      // Sin catálogo (o cliente que ya no está en él) toDoc deja el cliente en
      // blanco: se conserva el que decía la cotización original.
      if (!catalogos?.clientesById?.[src.clienteId] && raw) {
        ['cliente_nombre', 'cliente_ruc', 'cliente_email', 'cliente_representante'].forEach((k) => { copia[k] = raw[k] || ''; });
        copia.cliente_itbms_exento = !!raw.cliente_itbms_exento;
        if (!copia.dirigido_a) copia.dirigido_a = raw.dirigido_a || raw.cliente_representante || '';
        if (!copia.dirigido_email) copia.dirigido_email = raw.dirigido_email || raw.cliente_email || '';
      }
      copia.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
      copia.fecha_modificacion = firebase.firestore.FieldValue.serverTimestamp();
      // Flag persistido (A10) y la MISMA política que una nueva: dentro de
      // umbral y con rol que envía, no se molesta al aprobador (COT-2026-0042).
      const pol = requiereAprobacionPara({ doc: copia, rol, policy });
      copia.requiere_aprobacion = pol.requiere;
      const ref = await CotizacionesService.addCotizacion(copia);
      if (pol.requiere) {
        try { await enqueueAprobacionMail({ doc: copia, docId: ref.id, user }); }
        catch (e) { console.warn('No se pudo encolar correo de aprobación al duplicar:', e); }
        if (navegar) Toast.show('Cotización duplicada como ' + nuevoId + ' · solicitud de aprobación enviada', 'ok');
      } else if (navegar) {
        Toast.show('Cotización duplicada como ' + nuevoId + ' · lista para enviar al cliente', 'ok');
      }
      if (navegar) location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(ref.id);
      else _duplicando = false;
      return { id: ref.id, numero: nuevoId };
    } catch (err) {
      console.error(err);
      Toast.show('Error al duplicar: ' + (err?.message || err), 'bad');
      _duplicando = false;
      return null;
    }
  }

  // ── Rehacer (auditoría de módulos 2026-09-30, C2) ────────────────────────
  // "La mandé mal, la rehago": en septiembre pasó tres veces y las tres se
  // resolvieron con Eliminar, que no pedía motivo y dejaba vivo el enlace del
  // cliente. Eliminar quedó solo para borradores; esto es el camino para una
  // enviada/aprobada/vencida: la original queda DESCARTADA con el motivo
  // escrito (quién lea el historial sabe adónde fue) y se abre la copia.
  // Comercial: copia en borrador (duplicar) y al editor. Taller: la copia se
  // arma desde la orden (cotizar-orden precarga piezas y enlaza la orden con
  // la cotización nueva), así que se descarta y se va allá.
  async function rehacer({ ui, raw = null, rol, policy, catalogos = null }) {
    const src = ui || toUi(raw);
    const esc = FMT.esc;
    const taller = esCotizacionDeTaller(src);
    const docId = src._docId || raw?.id;
    if (!docId) return null;
    const ok = await Modal.confirm({
      title: 'Rehacer cotización',
      message: `${esc(src.id || 'Esta cotización')} quedará <b>Descartada</b> ("se rehace") y ${taller
        ? `volverás a cotizar la orden ${esc(src.orden_id || '')} con las piezas precargadas.`
        : 'se abrirá una copia en borrador con un número COT nuevo para corregirla.'}<br><br>El enlace que ya tiene el cliente dirá "Cotización cerrada".`,
      confirmLabel: 'Rehacer',
    });
    if (!ok) return null;
    try {
      let destino, motivo;
      if (taller) {
        motivo = 'Se rehace desde la orden ' + (src.orden_id || '');
        destino = '../ordenes/cotizar-orden.html?id=' + encodeURIComponent(src.orden_id || '');
      } else {
        const nueva = await duplicar({ ui: src, raw, rol, policy, catalogos, confirmar: false, navegar: false });
        if (!nueva) return null;
        motivo = 'Se rehace como ' + nueva.numero;
        destino = 'editar-cotizacion.html?id=' + encodeURIComponent(nueva.id);
      }
      const uid = firebase.auth().currentUser?.uid || null;
      await CotizacionesService.updateCotizacion(docId, patchCierre('descartada', motivo, uid));
      Toast.show((src.id || 'Cotización') + ' descartada · ' + motivo, 'ok');
      location.href = destino;
      return destino;
    } catch (err) {
      console.error(err);
      Toast.show('No se pudo rehacer: ' + (err?.message || err), 'bad');
      return null;
    }
  }

  // ── Bloque de totales (compartido) ───────────────────────────────────────
  // Lo pintan el editor, el detalle y la impresión. Vive aquí porque venta y
  // alquiler son dos totales que NO se suman, y tres copias del mismo markup
  // es exactamente como se termina mostrando un número distinto en cada
  // pantalla para la misma cotización.
  //
  //   t          → salida de CotizacionTotales.calcTotales
  //   cot        → el documento (o su forma UI): descuentoPct e itbmsPct
  //   plazoInput → HTML del campo editable de plazo; sin él se muestra el
  //                plazo como dato de solo lectura.
  function bloqueTotalesHtml(t, cot, { plazoInput = '' } = {}) {
    const pctD = Number(cot?.descuentoPct || 0);
    const itbmsPct = Number(cot?.itbmsPct || 0);
    const rotuloItbms = itbmsPct > 0 ? 'ITBMS (' + itbmsPct + '%)' : 'ITBMS exento';

    // Sin alquiler se ve exactamente igual que antes de existir la modalidad.
    if (!t.hayAlquiler) {
      return `
        <div class="cc-sum-row"><span>Subtotal</span><span class="v">${FMT.money(t.venta.subtotal)}</span></div>
        ${pctD > 0 ? `<div class="cc-sum-row disc"><span>Descuento (${pctD}%)</span><span class="v">−${FMT.money(t.venta.descGlobal)}</span></div>` : ''}
        <div class="cc-sum-row"><span>${rotuloItbms}</span><span class="v">${FMT.money(t.venta.itbms)}</span></div>
        <div class="cc-sum-total"><span class="lbl">Total</span><span class="v">${FMT.money(t.venta.total)}</span></div>`;
    }

    const grupo = (titulo, color, b, sufijo, clase) => `
      <div class="cc-sum-grupo ${clase}">
        <span class="cc-sum-cap"><i style="background:${color}"></i>${titulo}</span>
        ${b.descLineas > 0 ? `
          <div class="cc-sum-row"><span>Precio de lista</span><span class="v">${FMT.money(b.bruto)}</span></div>
          <div class="cc-sum-row disc"><span>Descuento por renglón</span><span class="v">−${FMT.money(b.descLineas)}</span></div>` : ''}
        <div class="cc-sum-row"><span>Subtotal</span><span class="v">${FMT.money(b.subtotal)}</span></div>
        ${pctD > 0 ? `<div class="cc-sum-row disc"><span>Descuento global (${pctD}%)</span><span class="v">−${FMT.money(b.descGlobal)}</span></div>` : ''}
        <div class="cc-sum-row"><span>${rotuloItbms}</span><span class="v">${FMT.money(b.itbms)}</span></div>
        <div class="cc-sum-total"><span class="lbl">${titulo}</span><span class="v">${FMT.money(b.total)}${sufijo}</span></div>
      </div>`;

    const plazoBloque = plazoInput
      ? `<div class="cc-sum-grupo cc-sum-plazo">
           ${plazoInput}
           ${t.plazoMeses > 0
             ? `<div class="cc-sum-row muted"><span>Compromiso de ${t.plazoMeses} meses</span><span class="v">${FMT.money(t.compromiso)}</span></div>`
             : '<span class="cc-sum-aviso">Sin plazo se evalúa como un año completo contra el límite de envío.</span>'}
         </div>`
      : (t.plazoMeses > 0
          ? `<div class="cc-sum-grupo cc-sum-plazo">
               <div class="cc-sum-row"><span>Plazo del alquiler</span><span class="v">${t.plazoMeses} meses</span></div>
               <div class="cc-sum-row muted"><span>Compromiso de ${t.plazoMeses} meses</span><span class="v">${FMT.money(t.compromiso)}</span></div>
             </div>`
          : '');

    return `
      ${t.hayVenta ? grupo('Total venta', 'var(--status-online, #1FA56B)', t.venta, '', 'es-venta') : ''}
      ${grupo('Total mensual', 'var(--accent)', t.alquiler, '<span class="cc-per">/mes</span>', 'es-alquiler')}
      ${plazoBloque}
      <div class="cc-sum-evaluado">
        <b>Valor evaluado a ${t.mesesComputables} ${t.mesesComputables === 1 ? 'mes' : 'meses'}</b>
        <span class="cc-sum-cuenta">${FMT.money(t.venta.total)} + ${FMT.money(t.alquiler.total)} × ${t.mesesComputables} = <b>${FMT.money(t.total)}</b></span>
        <span class="cc-sum-aviso">Es el número que compara el límite de envío directo, no lo que paga el cliente.</span>
      </div>`;
  }

  // ── Combo de cliente buscable ─────────────────────────────────────────────
  // Desde 2026-09-08 el combo es EntityCombo (js/ui/entity-combo.js): aquí
  // solo se adapta a los campos del cliente. La regla de búsqueda (todas las
  // palabras en cualquier orden, sin acentos, RUC y representante como
  // campos secundarios, palabras cortas solo contra el nombre) vive en el
  // componente; functions/test/cotizacionBuscadorCliente.test.js la congela.
  const CAMPOS_CLIENTE = (c) => [c && c.razon, c && c.ruc, c && c.representante];

  function filtrarClientes(clientes, query, { limite = 50 } = {}) {
    return EntityCombo.filtrar(clientes, query, { campos: CAMPOS_CLIENTE, limite });
  }

  // Monta el combo dentro de `host` (id o elemento). Devuelve la API mínima
  // de EntityCombo ({ value, set, focus, input }).
  function mountClienteCombo(host, opts = {}) {
    return EntityCombo.montar(host, {
      items: Array.isArray(opts.clientes) ? opts.clientes : [],
      id: (c) => c.id,
      label: (c) => c.razon || '',
      // El RUC desempata homónimos: dos "HOTEL LATINO" se distinguen aquí.
      sub: (c) => `RUC ${c.ruc || '—'}${c.representante ? ' · ' + c.representante : ''}`,
      campos: CAMPOS_CLIENTE,
      limite: opts.limite || 50,
      selectedId: opts.selectedId || '',
      placeholder: opts.placeholder || 'Escribe para buscar cliente…',
      autoFocus: !!opts.autoFocus,
      vacio: (q) => `<div class="combo-empty">Ningún cliente coincide con “${(window.FMT && FMT.esc ? FMT.esc(q) : q)}”.</div>`,
      onSelect: (id, c) => { if (id && typeof opts.onSelect === 'function') opts.onSelect(id, c); },
    });
  }

  // ── Modal "Cerrar cotización" ─────────────────────────────────
  // Marca el desenlace de una cotización enviada / aprobada sin llenar la
  // pantalla de botones. Tres salidas:
  //   · convertida  — el cliente aceptó, se cerró el negocio
  //   · rechazada   — el cliente declinó la propuesta
  //   · descartada  — cualquier otro motivo, EN PALABRAS DEL VENDEDOR. El caso
  //     común es "se rehace con otra cantidad de equipos": antes había que
  //     marcarla "Rechazada" — una mentira que además ensuciaba la tasa de
  //     cierre contando como perdida una oportunidad que sigue viva.
  //
  // Devuelve Promise<{ estado, motivo, aceptacion? } | null>. `motivo` solo
  // llega con 'descartada' y nunca vacío: el botón no cierra la hoja sin texto.
  // `vencida` (D12, 2026-10-01): la validez venció sola y nadie tiene que
  // hacer nada más; pero si el cliente la acepta después, el vendedor la marca
  // Aceptada igual, anotando cómo se cerró (viaja en `aceptacion.nota`).
  function cerrarPrompt({ cotizacionId, total, totalTexto, cliente, taller = false, reposicion = false, vencida = false } = {}) {
    const esc = FMT.esc; // helper canónico (core/formatting.js)
    const importe = totalTexto ? esc(totalTexto) : (total != null ? window.FMT.money(total) : '');
    if (taller) return cerrarPromptTaller({ cotizacionId, importe, cliente, reposicion, vencida });
    return Modal.sheet({
      title: 'Cerrar cotización', icon: 'flag', size: 'sm',
      html: `
        <p style="margin:0 0 12px; font-size:14px; color:var(--fg-2);">
          ${cotizacionId ? '<b>' + esc(cotizacionId) + '</b> · ' : ''}${esc(cliente || '')}${importe ? ' · ' + importe : ''}
        </p>
        <p style="margin:0 0 16px; font-size:13.5px; color:var(--fg-2); line-height:1.5;">
          ${vencida
            ? 'La validez ya venció. Si el cliente la aceptó después, márcala <b>Aceptada</b> y anota cómo se cerró; si no, no hace falta hacer nada más.'
            : '¿Cómo terminó esta cotización? Solo las cotizaciones convertidas a venta cuentan en el "Monto cerrado" del tablero.'}
        </p>
        <div id="cpOpciones" style="display:flex; flex-direction:column; gap:10px;">
          <button type="button" class="btn btn-secondary" data-act="convertida"
                  style="background:#065F46; color:#fff; border-color:#065F46; justify-content:flex-start; text-align:left;">
            <i data-lucide="trophy"></i>
            <span style="margin-left:8px;"><b>Aceptada por el cliente</b> — el cliente aceptó y se cerró el negocio</span>
          </button>
          <button type="button" class="btn btn-secondary" data-act="rechazada"
                  style="background:#991B1B; color:#fff; border-color:#991B1B; justify-content:flex-start; text-align:left;">
            <i data-lucide="x-circle"></i>
            <span style="margin-left:8px;"><b>Rechazada</b> — el cliente declinó la cotización</span>
          </button>
          ${vencida ? '' : `<button type="button" class="btn btn-secondary" data-act="vencida"
                  style="justify-content:flex-start; text-align:left;">
            <i data-lucide="hourglass"></i>
            <span style="margin-left:8px;"><b>Validez vencida</b> — pasó el plazo y el cliente no respondió</span>
          </button>`}
          <button type="button" class="btn btn-secondary" data-act="otros"
                  style="justify-content:flex-start; text-align:left;">
            <i data-lucide="pencil"></i>
            <span style="margin-left:8px;"><b>Otro motivo</b> — se rehace con otra cantidad, cambió el alcance…</span>
          </button>
        </div>
        <div id="cpTarde" style="display:none;">
          <label class="form-label" for="cpComo">¿Cómo se cerró la venta después de vencida?</label>
          <textarea id="cpComo" class="form-input form-textarea" rows="2" maxlength="200"
                    placeholder="Ej.: el cliente confirmó por correo el 3 de octubre; se mantuvo el precio."></textarea>
          <p id="cpErrorTarde" style="display:none; margin:8px 0 0; font-size:12.5px; color:#991B1B;"></p>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn btn-primary" data-act="guardar-tarde">Marcar Aceptada</button>
            <button type="button" class="btn btn-ghost" data-act="volver">Volver</button>
          </div>
        </div>
        <div id="cpOtros" style="display:none;">
          <label class="form-label" for="cpMotivo">¿Por qué se cierra?</label>
          <textarea id="cpMotivo" class="form-input form-textarea" rows="3" maxlength="300"
                    placeholder="Ej.: se rehace con 12 radios en vez de 20; el cliente pidió otra configuración."></textarea>
          <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">
            Queda en el historial de la cotización. No cuenta como oportunidad perdida en la tasa de cierre.
          </p>
          <p id="cpError" style="display:none; margin:8px 0 0; font-size:12.5px; color:#991B1B;"></p>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn btn-primary" data-act="guardar-otros">Cerrar con este motivo</button>
            <button type="button" class="btn btn-ghost" data-act="volver">Volver</button>
          </div>
        </div>`,
      buttons: [{ action: 'cancel', label: 'Cancelar' }],
      onMount: (root, api) => {
        const opciones = root.querySelector('#cpOpciones');
        const otros    = root.querySelector('#cpOtros');
        const tarde    = root.querySelector('#cpTarde');
        const taComo   = root.querySelector('#cpComo');
        const errTarde = root.querySelector('#cpErrorTarde');
        const ta       = root.querySelector('#cpMotivo');
        const error    = root.querySelector('#cpError');
        const guardarTarde = () => {
          const nota = (taComo.value || '').trim();
          if (nota.length < 5) {
            errTarde.textContent = 'Anota cómo se cerró — es lo que sostiene esta venta sobre una cotización vencida.';
            errTarde.style.display = '';
            taComo.focus();
            return;
          }
          api.close({ estado: 'convertida', motivo: '', aceptacion: { medio: 'otro', nota } });
        };
        const guardar = () => {
          const motivo = (ta.value || '').trim();
          // Un motivo de tres letras no le sirve a nadie que lea el historial
          // dentro de tres meses: se exige algo escrito de verdad.
          if (motivo.length < 5) {
            error.textContent = 'Escribe el motivo — es lo que va a leer quien revise esta cotización después.';
            error.style.display = '';
            ta.focus();
            return;
          }
          api.close({ estado: 'descartada', motivo });
        };
        root.addEventListener('click', (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (!act) return;
          // 'vencida' entra aquí (auditoría UX 2026-09-28, remate): antes vivía
          // aparte en "Cambiar estado" y eran dos caminos para cerrar.
          if (act === 'convertida' && vencida) { opciones.style.display = 'none'; tarde.style.display = ''; taComo.focus(); return; }
          if (act === 'convertida' || act === 'rechazada' || act === 'vencida') { api.close({ estado: act, motivo: '' }); return; }
          if (act === 'otros')  { opciones.style.display = 'none'; otros.style.display = ''; ta.focus(); return; }
          if (act === 'volver') { otros.style.display = 'none'; tarde.style.display = 'none'; opciones.style.display = ''; error.style.display = 'none'; errTarde.style.display = 'none'; return; }
          if (act === 'guardar-otros') guardar();
          if (act === 'guardar-tarde') guardarTarde();
        });
        // Ctrl/⌘+Enter cierra desde el propio textarea.
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardar(); }
        });
        taComo.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardarTarde(); }
        });
      },
      onAction: () => null,
    });
  }

  // ── Cierre de una cotización de TALLER (2026-09-25, pedido de Solangel) ──
  // La salida que el taller usa de verdad es "el cliente aceptó → a
  // facturar", y casi nunca la dice el cliente desde la página: contesta el
  // correo o lo dice por teléfono. Por eso se pregunta CÓMO aceptó (queda en
  // el historial y en la fila de Brenda) y con eso basta para seguir: el
  // mismo clic abre la fila en Facturación pendiente (onCotizacionEstadoChange).
  //
  // `reposicion`: la cotización cobra la reposición de un radio dañado por el
  // cliente (gestión de reemplazo por daño). Aceptarla libera a bodega;
  // rechazarla cierra el reemplazo y lo manda a cobranza. El texto lo dice
  // antes del clic, que es cuando sirve.
  //
  // "Pasar a facturar sin respuesta del cliente" (2026-10-01, pedido de
  // Solangel): muchas veces el cliente no acepta ni rechaza, la validez de 3
  // días se cumple y la cotización se vence sola — y vencida no llegaba nunca
  // a Facturación pendiente, ni siquiera al entregar el equipo. Cuando el
  // vendedor dice que se factura, el taller la pasa a mano EN CUALQUIER
  // MOMENTO (enviada, aprobada o ya vencida). Se exige quién lo autorizó: es
  // lo único que sostiene esa factura si el cliente después pregunta.
  // `vencida`: la hoja se abre sobre una cotización ya vencida.
  function cerrarPromptTaller({ cotizacionId, importe, cliente, reposicion, vencida = false }) {
    const esc = FMT.esc;
    const T = window.CotizacionTaller;
    const medios = (T?.MEDIOS_ACEPTACION || [['correo', 'Por correo'], ['verbal', 'Verbalmente'], ['otro', 'Otro medio']]);
    return Modal.sheet({
      title: reposicion ? 'Respuesta del cliente a la reposición' : 'Respuesta del cliente',
      icon: 'flag', size: 'sm',
      html: `
        <p style="margin:0 0 12px; font-size:14px; color:var(--fg-2);">
          ${cotizacionId ? '<b>' + esc(cotizacionId) + '</b> · ' : ''}${esc(cliente || '')}${importe ? ' · ' + importe : ''}
        </p>
        ${vencida ? `<p style="margin:0 0 12px; font-size:13px; color:var(--fg-2); line-height:1.5;">
          Se venció la validez sin respuesta. Si ya corresponde facturarla, pásala a facturar aquí.</p>` : ''}
        <div id="ctOpciones" style="display:flex; flex-direction:column; gap:10px;">
          <button type="button" class="btn btn-secondary" data-act="acepto"
                  style="background:#065F46; color:#fff; border-color:#065F46; justify-content:flex-start; text-align:left;">
            <i data-lucide="circle-check"></i>
            <span style="margin-left:8px;"><b>El cliente aceptó — pasar a facturar</b><br>
              <span style="font-size:12.5px; opacity:.9;">${reposicion
                ? 'Recepción recibe la fila para facturar y Bodega el aviso para asignar el radio de reposición.'
                : 'Recepción recibe la fila en Facturación pendiente, aunque el equipo siga en el taller.'}</span></span>
          </button>
          ${reposicion ? '' : `<button type="button" class="btn btn-secondary" data-act="sin-respuesta"
                  style="background:#0B2A47; color:#fff; border-color:#0B2A47; justify-content:flex-start; text-align:left;">
            <i data-lucide="receipt"></i>
            <span style="margin-left:8px;"><b>Pasar a facturar sin respuesta del cliente</b><br>
              <span style="font-size:12.5px; opacity:.9;">El cliente no contestó, pero ya corresponde facturar (p. ej. lo autorizó el vendedor).</span></span>
          </button>`}
          <button type="button" class="btn btn-secondary" data-act="rechazada"
                  style="background:#991B1B; color:#fff; border-color:#991B1B; justify-content:flex-start; text-align:left;">
            <i data-lucide="circle-x"></i>
            <span style="margin-left:8px;"><b>El cliente no aceptó</b><br>
              <span style="font-size:12.5px; opacity:.9;">${reposicion
                ? 'No se repone el radio. El caso se cierra y el daño pasa a cobranza.'
                : 'No se factura nada. El candado de materiales de la orden se reabre.'}</span></span>
          </button>
          <button type="button" class="btn btn-secondary" data-act="otros"
                  style="justify-content:flex-start; text-align:left;">
            <i data-lucide="pencil"></i>
            <span style="margin-left:8px;"><b>Otro motivo</b> — se rehace la cotización, cambió el trabajo…</span>
          </button>
        </div>
        <div id="ctAcepta" style="display:none;">
          <label class="form-label" for="ctMedio">¿Cómo aceptó?</label>
          <select id="ctMedio" class="form-select">
            ${medios.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
          </select>
          <label class="form-label" for="ctNota" style="margin-top:10px;">Detalle <span style="color:var(--fg-3); font-weight:400;">(opcional)</span></label>
          <input id="ctNota" class="form-input" maxlength="200"
                 placeholder="Ej.: respondió el correo el 25-sep · lo confirmó por teléfono con Juan Pérez">
          <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Queda en el historial y en la fila de facturación.</p>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn btn-primary" data-act="confirmar-acepto"><i data-lucide="check"></i> Pasar a facturar</button>
            <button type="button" class="btn btn-ghost" data-act="volver">Volver</button>
          </div>
        </div>
        <div id="ctSinResp" style="display:none;">
          <label class="form-label" for="ctAutorizo">¿Quién autorizó facturarla?</label>
          <input id="ctAutorizo" class="form-input" maxlength="200"
                 placeholder="Ej.: lo autorizó Juan Pérez (vendedor) el 1-oct · el equipo ya se entregó">
          <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Recepción la recibe en Facturación pendiente. Queda en el historial que el cliente no respondió.</p>
          <p id="ctSinRespError" style="display:none; margin:8px 0 0; font-size:12.5px; color:#991B1B;"></p>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn btn-primary" data-act="confirmar-sin-respuesta"><i data-lucide="check"></i> Pasar a facturar</button>
            <button type="button" class="btn btn-ghost" data-act="volver">Volver</button>
          </div>
        </div>
        <div id="ctOtros" style="display:none;">
          <label class="form-label" for="ctMotivo">¿Por qué se cierra?</label>
          <textarea id="ctMotivo" class="form-input form-textarea" rows="3" maxlength="300"
                    placeholder="Ej.: se rehace con otra pieza; el cliente retiró el equipo sin reparar."></textarea>
          <p id="ctError" style="display:none; margin:8px 0 0; font-size:12.5px; color:#991B1B;"></p>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button type="button" class="btn btn-primary" data-act="guardar-otros">Cerrar con este motivo</button>
            <button type="button" class="btn btn-ghost" data-act="volver">Volver</button>
          </div>
        </div>`,
      buttons: [{ action: 'cancel', label: 'Cancelar' }],
      onMount: (root, api) => {
        const panel = (id) => ['ctOpciones', 'ctAcepta', 'ctSinResp', 'ctOtros']
          .forEach(p => { root.querySelector('#' + p).style.display = p === id ? '' : 'none'; });
        root.addEventListener('click', (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (!act) return;
          if (act === 'acepto') { panel('ctAcepta'); root.querySelector('#ctMedio').focus(); return; }
          if (act === 'sin-respuesta') { panel('ctSinResp'); root.querySelector('#ctAutorizo').focus(); return; }
          if (act === 'otros')  { panel('ctOtros'); root.querySelector('#ctMotivo').focus(); return; }
          if (act === 'volver') { panel('ctOpciones'); return; }
          if (act === 'confirmar-sin-respuesta') {
            const quien = String(root.querySelector('#ctAutorizo').value || '').trim();
            if (quien.length < 3) {
              const err = root.querySelector('#ctSinRespError');
              err.textContent = 'Escribe quién autorizó facturarla — es lo que respalda la factura si el cliente pregunta.';
              err.style.display = '';
              return;
            }
            api.close({ estado: 'convertida', motivo: '', aceptacion: { medio: 'sin_respuesta', nota: quien.slice(0, 200) } });
            return;
          }
          if (act === 'rechazada') { api.close({ estado: 'rechazada', motivo: '' }); return; }
          if (act === 'confirmar-acepto') {
            api.close({
              estado: 'convertida', motivo: '',
              aceptacion: {
                medio: root.querySelector('#ctMedio').value || 'otro',
                nota: String(root.querySelector('#ctNota').value || '').trim().slice(0, 200),
              },
            });
            return;
          }
          if (act === 'guardar-otros') {
            const motivo = (root.querySelector('#ctMotivo').value || '').trim();
            if (motivo.length < 5) {
              const err = root.querySelector('#ctError');
              err.textContent = 'Escribe el motivo — es lo que va a leer quien revise esta cotización después.';
              err.style.display = '';
              return;
            }
            api.close({ estado: 'descartada', motivo });
          }
        });
      },
      onAction: () => null,
    });
  }

  // Sellos del cierre. Viven aquí y no en cada pantalla porque el detalle y la
  // banderita del listado cierran la MISMA cotización: cuando se duplicaba el
  // estampado, una de las dos se olvidaba de un campo.
  // `aceptacion` ({medio, nota}) solo llega del cierre de taller.
  function patchCierre(estado, motivo, uid, aceptacion = null) {
    const ahora = firebase.firestore.Timestamp.now();
    const patch = { estado };
    if (estado === 'convertida') {
      patch.fecha_conversion = ahora;
      patch.convertida_por_uid = uid || null;
      if (aceptacion) {
        patch.aceptacion = {
          medio: aceptacion.medio || 'otro',
          nota: aceptacion.nota || '',
          por_uid: uid || null,
          por_email: firebase.auth().currentUser?.email || null,
          at: ahora,
        };
      }
    } else if (estado === 'descartada') {
      patch.fecha_descarte = ahora;
      patch.descartada_por_uid = uid || null;
      patch.cierre_motivo = String(motivo || '').trim().slice(0, 300);
    } else if (estado === 'vencida') {
      // Mismos sellos que ponía "Marcar Vencida" en el panel del detalle.
      patch.fecha_vencimiento = ahora;
      patch.vencida_manual = true;
      patch.vencida_por_uid = uid || null;
    } else {
      patch.fecha_rechazo = ahora;
      patch.rechazado_por_uid = uid || null;
    }
    return patch;
  }

  function cierreToast(estado, { taller = false, sinRespuesta = false } = {}) {
    if (taller && estado === 'convertida' && sinRespuesta) return '✅ Pasada a facturación — Recepción la recibe en Facturación pendiente';
    if (taller && estado === 'convertida') return '✅ Aceptada — Recepción la recibe en Facturación pendiente';
    if (taller && estado === 'rechazada') return 'Registrado: el cliente no aceptó';
    if (estado === 'convertida') return '🏆 Aceptada por el cliente';
    if (estado === 'descartada') return 'Cotización descartada — el motivo queda en el historial';
    if (estado === 'vencida') return 'Cotización marcada como vencida';
    return 'Cotización rechazada';
  }

  // ── Modal "Reenviar al cliente" ───────────────────────────────────────────
  // Muestra preview del correo (destinatario editable, CC fijo al vendedor,
  // asunto y cuerpo) antes de enviar. Similar al panel de aprobación.
  // opts: { cotizacionId, clienteNombre, total, dirigidoA, defaultDest, ccEmail,
  //         intro, validezDias, ejecutivo, link }
  // Devuelve Promise<{ dest, subject, html } | null>.
  // ── Correo al cliente (asunto + cuerpo) ───────────────────────────────────
  // UNA sola definición para las dos puertas por las que sale una cotización:
  // "Enviar / Reenviar" (reenviarPrompt) y "Aprobar y enviar" del listado.
  // Eran dos copias y ya decían cosas distintas — la de aprobar le ponía al
  // cliente "Cotización X aprobada" en el asunto, cuando el que aprueba
  // todavía es él. `doc` es la cotización (o su forma UI): de ahí sale si es
  // de taller y la orden a la que pertenece.
  function correoCliente(opts) {
    const esc = window.FMT.esc;
    const doc = opts.doc || {};
    const CT = window.CotizacionTaller;
    const taller = CT ? CT.esTaller(doc) : esCotizacionDeTaller(doc);
    const clienteNom = String(opts.clienteNombre || '').trim();
    const idCot = opts.cotizacionId || doc.cotizacion_id || doc.id || '';
    const subject = CT
      ? CT.asunto({ ...doc, cotizacion_id: idCot }, { clienteNombre: clienteNom })
      : `Cotización ${idCot}${clienteNom ? ` · ${clienteNom}` : ''} · Cecomunica`;
    const titulo = CT ? CT.tituloDocumento(doc) : 'Cotización';
    const dirAHtml = opts.dirigidoA ? `<p style="margin:0 0 10px;">A la atención de: <b>${esc(opts.dirigidoA)}</b></p>` : '';
    const introHtml = esc(opts.intro || 'Adjuntamos la cotización solicitada.');
    const adjuntos = Array.isArray(opts.adjuntos) ? opts.adjuntos.filter(a => a && (a.url || a.path)) : [];
    const adjuntosHtml = adjuntos.length ? `
  <p style="margin:14px 0 4px;"><b>Archivos adjuntos:</b></p>
  <ul style="margin:0 0 10px; padding-left:18px; color:#374151;">
    ${adjuntos.map(a => `<li>${esc(a.nombre || a.filename || 'adjunto')}</li>`).join('')}
  </ul>` : '';
    // La orden va a la vista: es el número del comprobante con el que el
    // cliente dejó el radio, y lo que hace que no la confunda con una
    // propuesta de ventas.
    const ordenHtml = taller && doc.orden_id
      ? `<p style="margin:0 0 4px;"><b>Orden de servicio:</b> ${esc(doc.orden_id)}</p>` : '';
    const firma = [opts.ejecutivo, opts.ejecutivoCargo].filter(Boolean).map(esc).join(' · ');
    const html = `
<div style="font-family:Arial, sans-serif; color:#111; max-width:560px;">
  <h2 style="font:700 22px Arial,sans-serif; color:#0B2A47; margin:0 0 12px;">${esc(titulo)} ${esc(idCot)}</h2>
  <p style="margin:0 0 10px;">Estimados señores,</p>
  ${dirAHtml}
  <p style="margin:0 0 10px;">${introHtml}</p>
  ${clienteNom ? `<p style="margin:0 0 4px;"><b>Empresa:</b> ${esc(clienteNom)}</p>` : ''}
  ${ordenHtml}
  <p style="margin:0 0 4px;"><b>Total:</b> ${esc(opts.totalTexto || window.FMT.money(Number(opts.total || 0)))}</p>
  <p style="margin:0 0 4px;"><b>Validez:</b> ${opts.validezDias || 15} días</p>
  ${adjuntosHtml}
  <p style="margin:18px 0;">
    <a href="${esc(opts.link || '#')}" style="background:#0B2A47; color:#fff; padding:12px 18px; border-radius:6px; text-decoration:none; display:inline-block; font-weight:600;">
      Ver y descargar cotización (PDF)
    </a>
  </p>
  <p style="font-size:12px; color:#6B7884; margin-top:24px;">
    ${taller
      ? 'Para autorizar la reparación basta con responder a este correo.'
      : 'Si tiene cualquier consulta, puede responder a este correo.'} Atentamente, ${firma || 'Cecomunica'}.
  </p>
</div>`;
    return { subject, html };
  }

  // A dónde vuelve la respuesta del cliente: al firmante (en el taller, la
  // jefa de taller). Sin esto la respuesta caía en el buzón del SMTP, que no
  // lee nadie — y en el taller "responder el correo" ES la aceptación.
  function replyToDe({ ejecutivoEmail, creadoPorEmail } = {}) {
    const ok = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())
      && !String(e).endsWith('@sin.email.cecomunica.com');
    if (ok(ejecutivoEmail)) return String(ejecutivoEmail).trim();
    if (ok(creadoPorEmail)) return String(creadoPorEmail).trim();
    return null;
  }

  // Espejo público (cotizacion_verificaciones.snapshot) — lo que abre el
  // cliente desde el correo. También eran dos copias: la del listado no
  // llevaba el desglose de venta/alquiler que la del detalle sí.
  function snapshotPublico(cot, t, cli = {}, ej = {}) {
    const CT = window.CotizacionTaller;
    const taller = CT ? CT.esTaller(cot) : esCotizacionDeTaller(cot);
    return {
      id: cot.id, estado: cot.estado, fecha: cot.fecha, validezDias: cot.validezDias,
      moneda: cot.moneda, descuentoPct: cot.descuentoPct, itbmsPct: cot.itbmsPct,
      intro: cot.intro, items: cot.items, condiciones: cot.condiciones || [],
      subtotal: t.subtotal, descGlobal: t.descGlobal, itbms: t.itbms, total: t.total,
      totalVenta: t.venta.total, totalMensual: t.alquiler.total,
      plazoMeses: t.plazoMeses, hayAlquiler: t.hayAlquiler, hayVenta: t.hayVenta,
      ventaDetalle: t.venta, alquilerDetalle: t.alquiler,
      // Taller: el espejo se congela diciendo qué documento es. Los espejos ya
      // emitidos no lo traen y se siguen viendo como se enviaron.
      origen: taller ? 'orden' : 'comercial',
      ...(taller && cot.orden_id ? { orden_id: cot.orden_id } : {}),
      cliente: { razon: cli.razon || '', ruc: cli.ruc || '', tel: cli.tel || '', email: cli.email || '', representante: cli.representante || '' },
      ejecutivo: {
        nombre: ej.nombre || cot.ejecutivo_nombre || '',
        rol: CT ? CT.cargoFirmante(cot, ej) : (ej.rol || ''),
        email: ej.email || cot.ejecutivo_email || '', tel: ej.tel || '',
      },
    };
  }

  function reenviarPrompt(opts) {
      const esc = window.FMT.esc; // helper canónico (core/formatting.js)
      const { subject, html: bodyHtml } = correoCliente(opts);
      // La carta solo aplica a cotizaciones comerciales; quien llama pasa
      // `llevaCarta: null` cuando es de taller y la fila no se dibuja. Verla aquí
      // es lo que cierra el hueco: el envío ocurre fuera del editor, así que sin
      // esta fila nadie sabe con qué va a salir el documento.
      const cartaAplica = typeof opts.llevaCarta === 'boolean';

      return Modal.sheet({
        title: 'Enviar cotización al cliente', icon: 'send', size: 'lg',
        html: `
            <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-3); margin-bottom:var(--sp-3);">
              <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="mail"></i> Encabezado</legend>
              <div class="form-field" style="margin-bottom:8px;">
                <label class="form-label">Para (destinatario)</label>
                <input type="email" class="form-input" id="rxDest" value="${esc(opts.defaultDest || '')}" placeholder="destinatario@empresa.com">
                <span class="form-hint" style="font-size:11px; color:var(--fg-3);">Este es el "Email destinatario" de la cotización. Puedes ajustarlo si va a otra persona.</span>
              </div>
              <div class="form-field" style="margin-bottom:8px;">
                <label class="form-label">CC (vendedor)</label>
                <input type="email" class="form-input" value="${esc(opts.ccEmail || '')}" disabled>
              </div>
              <div class="form-field" style="margin-bottom:0;">
                <label class="form-label">Asunto</label>
                <input type="text" class="form-input" id="rxSubject" value="${esc(subject)}">
              </div>
            </fieldset>
            ${cartaAplica ? `
            <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-3); margin-bottom:var(--sp-3);">
              <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="file-text"></i> Carta de presentación</legend>
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; font-size:13px; line-height:1.5;">
                <input type="checkbox" id="rxCarta" ${opts.llevaCarta ? 'checked' : ''} style="width:18px; height:18px; flex:none; margin-top:1px;">
                <span><b>Enviar con la carta de presentación</b><br>
                  <span style="color:var(--fg-3);">Antepone 2 páginas institucionales al documento que abre el cliente. Este es el estado guardado en la cotización: lo que marques aquí es lo que se envía.</span>
                </span>
              </label>
            </fieldset>` : ''}
            <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-3);">
              <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="eye"></i> Vista previa del correo</legend>
              <div style="background:#F5F7FA; padding:16px; border-radius:6px; max-height:280px; overflow:auto;">${bodyHtml}</div>
            </fieldset>`,
        buttons: [
          { action: 'cancel', label: 'Cancelar', icon: 'x-circle' },
          { action: 'send', label: 'Enviar', primary: true, icon: 'send' },
        ],
        onMount: (root) => { root.querySelector('#rxDest')?.focus(); },
        onAction: (act, root) => {
          if (act !== 'send') return null;
          const destInput = root.querySelector('#rxDest');
          const dest = (destInput.value || '').trim();
          if (!dest) { destInput.focus(); return false; }
          const chkCarta = root.querySelector('#rxCarta');
          return {
            dest,
            subject: (root.querySelector('#rxSubject').value || '').trim() || subject,
            html: bodyHtml,
            llevaCarta: chkCarta ? chkCarta.checked : null,
          };
        },
      });
  }

  // ── Correo de solicitud de aprobación a ventas@cecomunica.com ────────────
  // Mismo patrón que cot-editor → enqueueAprobacionMail. Centralizado aquí
  // para que también se dispare al "Duplicar" desde el listado o detalle:
  // una cotización duplicada nace en borrador y necesita aprobación igual
  // que una cotización nueva.
  // Filas de totales de un bucket para el correo. Se mantiene aparte del
  // bloque de pantalla porque el correo es HTML de tabla para clientes de
  // correo viejos: nada de flex, nada de custom properties.
  function filaMail(b, titulo, sufijo, mostrarCap, doc) {
    if (!b.n) return '';
    const FMT = window.FMT;
    const td = 'padding:6px 0;border-bottom:1px solid #eee;';
    return `
      ${mostrarCap ? `<tr><td colspan="2" style="padding:10px 0 2px;font:700 11px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6B7884;">${titulo}</td></tr>` : ''}
      ${b.descLineas > 0 ? `
      <tr><td style="${td}"><b>Precio de lista</b></td><td style="${td}">${FMT.money(b.bruto)}</td></tr>
      <tr><td style="${td}"><b>Descuento por renglón</b></td><td style="${td}">−${FMT.money(b.descLineas)}</td></tr>` : ''}
      <tr><td style="${td}"><b>Subtotal</b></td><td style="${td}">${FMT.money(b.subtotal)}</td></tr>
      ${b.descGlobal > 0 ? `<tr><td style="${td}"><b>Descuento global (${Number(doc.descuentoPct || 0)}%)</b></td><td style="${td}">−${FMT.money(b.descGlobal)}</td></tr>` : ''}
      <tr><td style="${td}"><b>ITBMS (${doc.itbmsPct}%)</b></td><td style="${td}">${FMT.money(b.itbms)}</td></tr>
      <tr><td style="${td}"><b>${titulo}</b></td><td style="${td}"><b>${FMT.money(b.total)}${sufijo}</b></td></tr>`;
  }

  async function enqueueAprobacionMail({ doc, docId, user }) {
    const T = window.CotizacionTotales;
    const FMT = window.FMT;
    const esc = FMT.esc; // helper canónico (core/formatting.js)
    const t = T.calcTotales({
      items: doc.items || [], descuentoPct: doc.descuentoPct || 0, itbmsPct: doc.itbmsPct || 0,
      plazoMeses: doc.plazoMeses || 0,
    });
    const obsEsc = (doc.intro || '-').replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
    // POR QUÉ requiere aprobación: el correo solo decía "requiere aprobación" y
    // el aprobador tenía que abrir la cotización para adivinar el motivo —
    // sobre todo con descuento por renglón, que ni se veía en la tabla.
    let motivosHtml = '';
    try {
      const pol = T.requiereAprobacion(
        { total: t.total, descuentoPct: doc.descuentoPct, items: doc.items },
        T.policyFromConfig(await EmpresaService.getConfig()),
      );
      if (pol.motivos.length) {
        motivosHtml = `<div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid #B45309;background:#FFFBEB;font:14px/1.5 Arial,sans-serif;">
          <b>Motivo de la aprobación</b>
          <ul style="margin:6px 0 0;padding-left:18px;">${pol.motivos.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        </div>`;
      }
    } catch (e) { console.warn('No se pudo resolver el motivo de aprobación:', e); }
    // Renglones agrupados por equipo: los ítems creados desde una orden llevan
    // el contexto del radio en `spec` ("Equipo: Serie … · Modelo …"); los que
    // no lo traen (cotización comercial) caen a un grupo general sin encabezado.
    const grupos = new Map();
    (doc.items || []).forEach(it => {
      const key = String(it.spec || '').trim();
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(it);
    });
    const itemsHtml = [...grupos.entries()].map(([spec, items]) => {
      const lis = items.map(it =>
        `<li>${esc(it.nombre || '')}${it.modelo ? ` <span style="font-family:monospace;font-size:12px;">(${esc(it.modelo)})</span>` : ''} – ${Number(it.cant || 0)} × ${FMT.money(Number(it.precio || 0))}${T.esAlquiler(it) ? '/mes' : ''}${Number(it.desc || 0) > 0 ? ` <b>− ${Number(it.desc)}%</b> = ${FMT.money(T.lineTotal(it))}${T.esAlquiler(it) ? '/mes' : ''}` : ''}${T.esAlquiler(it) ? ' <span style="font-size:11px;color:#005781;">[alquiler]</span>' : ''}</li>`
      ).join('');
      const header = spec
        ? `<p style="margin:10px 0 4px;font:600 13px Arial,sans-serif;color:#374151;">${esc(spec)}</p>`
        : '';
      return `${header}<ul style="margin:0 0 8px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${lis}</ul>`;
    }).join('');
    // Destinatarios de la solicitud de aprobación, por TIPO de cotización:
    //   · servicio (origen=orden, sale de una orden de taller) → supervisor de
    //     taller (jefe_taller), que es quien la aprueba.
    //   · comercial → lista configurable por admin (empresa/config
    //     .cotizacion_aprobacion_to); si está vacía, buzón histórico de ventas.
    // Convención del repo (ver onCancelacionWrite): to = primero, cc = el resto + creador.
    let aprobacionList = ['ventas@cecomunica.com'];
    const esServicio = (doc.origen || '') === 'orden';
    try {
      if (esServicio) {
        const jefes = await UsuariosService.getUsuariosByRol(['jefe_taller']);
        const emails = (jefes || []).map(j => j.email).filter(Boolean);
        if (emails.length) aprobacionList = emails;
      } else {
        const cfg = await EmpresaService.getConfig();
        const list = Array.isArray(cfg.cotizacion_aprobacion_to) ? cfg.cotizacion_aprobacion_to.filter(Boolean) : [];
        if (list.length) aprobacionList = list;
      }
    } catch (e) { console.warn('No se pudieron resolver destinatarios de aprobación, usando ventas@:', e); }
    const aprobacionTo = aprobacionList[0];
    const aprobacionCc = [...aprobacionList.slice(1), user?.email].filter(Boolean).join(',') || null;
    await MailService.enqueue({
      to: aprobacionTo,
      cc: aprobacionCc,
      // Es una SOLICITUD, no un aviso de alta (auditoría UX 2026-09-28, #19).
      subject: `Solicitud de aprobación: ${doc.cotizacion_id} – ${doc.cliente_nombre}`,
      preheader: `Cotización pendiente de aprobación: ${doc.cliente_nombre}`,
      bodyContent: `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Solicitud de aprobación</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          Se registró la cotización <b>${doc.cotizacion_id}</b> en estado borrador y requiere aprobación.
        </p>
        ${motivosHtml}
        <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.cliente_nombre || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Dirigido a</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.dirigido_a || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Email destinatario</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.dirigido_email || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Vendedor</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.ejecutivo_nombre || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Validez</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.validezDias} días</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Introducción</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${obsEsc}</td></tr>
          ${filaMail(t.venta, t.hayAlquiler ? 'Total venta' : 'Total', '', t.hayAlquiler && t.hayVenta, doc)}
          ${t.hayAlquiler ? filaMail(t.alquiler, 'Total mensual', ' / mes', true, doc) : ''}
          ${t.hayAlquiler ? `
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Plazo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${t.plazoMeses > 0 ? t.plazoMeses + ' meses · compromiso ' + FMT.money(t.compromiso) : 'sin declarar'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Valor evaluado (${t.mesesComputables} meses)</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>${FMT.money(t.total)}</b> <span style="color:#6B7884;">= ${FMT.money(t.venta.total)} + ${FMT.money(t.alquiler.total)} × ${t.mesesComputables}</span></td></tr>` : ''}
        </table>
        ${itemsHtml ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Renglones</h4>${itemsHtml}` : ''}
      `,
      ctaUrl: `${location.origin}/cotizaciones/index.html?aprobar=${docId}`,
      ctaLabel: 'Revisar y aprobar',
      meta: {
        created_by: user?.uid || null,
        source: 'cotizacion-aprobacion',
      },
      status: 'queued',
    });
  }

  window.CotState = {
    ESTADOS, ESTADO_ORDEN, esEditable, estadoLabel,
    // Re-exportados desde CotizacionTotales (viven ahi porque verify/ los
    // necesita y esa pagina publica NO carga este archivo).
    agruparPorEquipo: (i) => CotizacionTotales.agruparPorEquipo(i),
    tituloEquipo:     (g) => CotizacionTotales.tituloEquipo(g),
    trabajoEquipo:    (g) => CotizacionTotales.trabajoEquipo(g),
    esCotizacionDeTaller, llevaCarta,
    CONDICIONES_DEFAULT, PLANTILLAS_COND,
    EMISOR_FALLBACK,
    uid,
    mapClienteToUI, mapModeloToCatItem, mapVendedorToEjec, precioSugerido,
    toUi, toDoc, nuevaCotizacion, nextCotizacionId, bootstrapCatalogos,
    filtrarClientes, mountClienteCombo, requiereAprobacionPara, bloqueTotalesHtml,
    cerrarPrompt, patchCierre, cierreToast, reenviarPrompt,
    correoCliente, replyToDe, snapshotPublico,
    CONDICIONES_TALLER: (window.CotizacionTaller?.CONDICIONES_TALLER) || [],
    enqueueAprobacionMail,
    adjuntosToAttachments,
    duplicar, rehacer,
  };
})();

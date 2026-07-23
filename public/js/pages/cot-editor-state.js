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
      itbms_exento: !!c?.itbms_exento,
      itbms_motivo_exencion: c?.itbms_motivo_exencion || '',
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
      cant: Number(it.cant || 0),
      precio: Number(it.precio || 0),
      desc: Number(it.desc || 0),
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
      condiciones: Array.isArray(doc.condiciones) && doc.condiciones.length
        ? doc.condiciones.map(c => ({ k: c.k || '', v: c.v || '' }))
        : JSON.parse(JSON.stringify(CONDICIONES_DEFAULT)),
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
      // Timestamps del ciclo de vida — usados por el historial para mostrar
      // las fechas reales en vez de derivarlas de la fecha de creación.
      fecha_creacion: doc.fecha_creacion || null,
      enviada_en: doc.enviada_en || null,
      fecha_aprobacion: doc.fecha_aprobacion || null,
      fecha_conversion: doc.fecha_conversion || null,
      fecha_rechazo: doc.fecha_rechazo || null,
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
      ejecutivo_nombre: ejec.nombre || '',
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
        cant: Number(it.cant || 0),
        precio: Number(it.precio || 0),
        desc: Number(it.desc || 0),
      })),
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
      total: FMT.round2(totales.total),
      // Tipo de cotización: por defecto 'comercial'. cotizar-orden.js sobrescribe
      // con 'orden' + orden_id después de toDoc (cotizaciones de servicio).
      origen: ui.origen || 'comercial',
      ...(ui.orden_id ? { orden_id: ui.orden_id } : {}),
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
      items: [{ id: uid(), modelo: '', nombre: '', spec: '', cant: 1, precio: 0, desc: 0 }],
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

  // ── Modal "Cerrar cotización" ─────────────────────────────────────────────
  // Permite al usuario marcar el desenlace de una cotización enviada / aprobada
  // como Convertida (venta cerrada) o Rechazada (cliente declinó), evitando
  // tener dos botones separados. Devuelve Promise<'convertida'|'rechazada'|null>.
  function cerrarPrompt({ cotizacionId, total, cliente } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.style.display = 'flex';
      overlay.innerHTML = `
        <div class="modal" style="max-width:480px;">
          <div class="modal-header">
            <h3 class="modal-title"><i data-lucide="flag"></i> Cerrar cotización</h3>
            <button class="modal-close" data-act="cancel" aria-label="Cerrar"><i data-lucide="x"></i></button>
          </div>
          <div class="modal-body">
            <p style="margin:0 0 12px; font-size:14px; color:var(--fg-2);">
              ${cotizacionId ? '<b>' + cotizacionId + '</b> · ' : ''}${cliente || ''}${total != null ? ' · ' + window.FMT.money(total) : ''}
            </p>
            <p style="margin:0 0 16px; font-size:13.5px; color:var(--fg-2); line-height:1.5;">
              ¿Cómo terminó esta cotización? Solo las cotizaciones convertidas a venta cuentan en el "Monto cerrado" del tablero.
            </p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              <button class="btn btn-secondary" data-act="convertida"
                      style="background:#065F46; color:#fff; border-color:#065F46; justify-content:flex-start;">
                <i data-lucide="trophy"></i>
                <span style="margin-left:8px;"><b>Convertida a venta</b> — el cliente aceptó y se cerró el negocio</span>
              </button>
              <button class="btn btn-secondary" data-act="rechazada"
                      style="background:#991B1B; color:#fff; border-color:#991B1B; justify-content:flex-start;">
                <i data-lucide="x-circle"></i>
                <span style="margin-left:8px;"><b>Rechazada</b> — el cliente declinó la propuesta</span>
              </button>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-act="cancel">Cancelar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      if (window.lucide) lucide.createIcons();

      function close(result) {
        document.body.style.overflow = '';
        overlay.remove();
        resolve(result);
      }
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return close(null);
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'cancel') return close(null);
        if (act === 'convertida' || act === 'rechazada') return close(act);
      });
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(null); }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  // ── Modal "Reenviar al cliente" ───────────────────────────────────────────
  // Muestra preview del correo (destinatario editable, CC fijo al vendedor,
  // asunto y cuerpo) antes de enviar. Similar al panel de aprobación.
  // opts: { cotizacionId, clienteNombre, total, dirigidoA, defaultDest, ccEmail,
  //         intro, validezDias, ejecutivo, link }
  // Devuelve Promise<{ dest, subject, html } | null>.
  function reenviarPrompt(opts) {
    return new Promise((resolve) => {
      const esc = window.FMT.esc; // helper canónico (core/formatting.js)
      const subject = `Cotización ${opts.cotizacionId || ''} · CeComunica`;
      const dirAHtml = opts.dirigidoA ? `<p style="margin:0 0 10px;">A la atención de: <b>${esc(opts.dirigidoA)}</b></p>` : '';
      const introHtml = esc(opts.intro || 'Adjuntamos la cotización solicitada.');
      const adjuntos = Array.isArray(opts.adjuntos) ? opts.adjuntos.filter(a => a && a.url) : [];
      const adjuntosHtml = adjuntos.length ? `
  <p style="margin:14px 0 4px;"><b>Archivos adjuntos:</b></p>
  <ul style="margin:0 0 10px; padding-left:18px; color:#374151;">
    ${adjuntos.map(a => `<li>${esc(a.nombre || 'adjunto')}</li>`).join('')}
  </ul>` : '';
      const bodyHtml = `
<div style="font-family:Arial, sans-serif; color:#111; max-width:560px;">
  <h2 style="font:700 22px Arial,sans-serif; color:#0B2A47; margin:0 0 12px;">Cotización ${esc(opts.cotizacionId || '')}</h2>
  <p style="margin:0 0 10px;">Estimados señores,</p>
  ${dirAHtml}
  <p style="margin:0 0 10px;">${introHtml}</p>
  <p style="margin:0 0 4px;"><b>Total:</b> ${window.FMT.money(Number(opts.total || 0))}</p>
  <p style="margin:0 0 4px;"><b>Validez:</b> ${opts.validezDias || 15} días</p>
  ${adjuntosHtml}
  <p style="margin:18px 0;">
    <a href="${esc(opts.link || '#')}" style="background:#0B2A47; color:#fff; padding:12px 18px; border-radius:6px; text-decoration:none; display:inline-block; font-weight:600;">
      Ver y descargar cotización (PDF)
    </a>
  </p>
  <p style="font-size:12px; color:#6B7884; margin-top:24px;">
    Si tiene cualquier consulta, puede responder a este correo. Atentamente, ${esc(opts.ejecutivo || 'CeComunica')}.
  </p>
</div>`;

      const overlay = document.createElement('div');
      overlay.className = 'modal-backdrop';
      overlay.style.display = 'flex';
      overlay.innerHTML = `
        <div class="modal modal-lg" style="max-width:680px;">
          <div class="modal-header">
            <h3 class="modal-title"><i data-lucide="send"></i> Enviar cotización al cliente</h3>
            <button class="modal-close" data-act="cancel" aria-label="Cerrar"><i data-lucide="x"></i></button>
          </div>
          <div class="modal-body">
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
            <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-3);">
              <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="eye"></i> Vista previa del correo</legend>
              <div style="background:#F5F7FA; padding:16px; border-radius:6px; max-height:280px; overflow:auto;">${bodyHtml}</div>
            </fieldset>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" data-act="cancel"><i data-lucide="x-circle"></i> Cancelar</button>
            <button class="btn btn-primary" data-act="send"><i data-lucide="send"></i> Enviar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      if (window.lucide) lucide.createIcons();
      const destInput = overlay.querySelector('#rxDest');
      const subjInput = overlay.querySelector('#rxSubject');
      destInput.focus();

      function close(result) {
        document.body.style.overflow = '';
        overlay.remove();
        resolve(result);
      }
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return close(null);
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'cancel') return close(null);
        if (btn.dataset.act === 'send') {
          const dest = (destInput.value || '').trim();
          if (!dest) { destInput.focus(); return; }
          return close({ dest, subject: (subjInput.value || '').trim() || subject, html: bodyHtml });
        }
      });
      const onKey = (e) => {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(null); }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  // ── Correo de solicitud de aprobación a ventas@cecomunica.com ────────────
  // Mismo patrón que cot-editor → enqueueAprobacionMail. Centralizado aquí
  // para que también se dispare al "Duplicar" desde el listado o detalle:
  // una cotización duplicada nace en borrador y necesita aprobación igual
  // que una cotización nueva.
  async function enqueueAprobacionMail({ doc, docId, user }) {
    const T = window.CotizacionTotales;
    const FMT = window.FMT;
    const esc = FMT.esc; // helper canónico (core/formatting.js)
    const t = T.calcTotales({
      items: doc.items || [], descuentoPct: doc.descuentoPct || 0, itbmsPct: doc.itbmsPct || 0,
    });
    const obsEsc = (doc.intro || '-').replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
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
        `<li>${esc(it.nombre || '')}${it.modelo ? ` <span style="font-family:monospace;font-size:12px;">(${esc(it.modelo)})</span>` : ''} – ${Number(it.cant || 0)} × ${FMT.money(Number(it.precio || 0))}</li>`
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
      subject: `Nueva cotización: ${doc.cotizacion_id} – ${doc.cliente_nombre}`,
      preheader: `Cotización pendiente de aprobación: ${doc.cliente_nombre}`,
      bodyContent: `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Nueva cotización creada</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          Se registró la cotización <b>${doc.cotizacion_id}</b> en estado borrador y requiere aprobación.
        </p>
        <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.cliente_nombre || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Dirigido a</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.dirigido_a || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Email destinatario</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.dirigido_email || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Ejecutivo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.ejecutivo_nombre || '-'}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Validez</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${doc.validezDias} días</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Introducción</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${obsEsc}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Subtotal</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${FMT.money(t.subtotal)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>ITBMS (${doc.itbmsPct}%)</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${FMT.money(t.itbms)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Total</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>${FMT.money(t.total)}</b></td></tr>
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
    ESTADOS, ESTADO_ORDEN, esEditable,
    esCotizacionDeTaller, llevaCarta,
    CONDICIONES_DEFAULT, PLANTILLAS_COND,
    EMISOR_FALLBACK,
    uid,
    mapClienteToUI, mapModeloToCatItem, mapVendedorToEjec,
    toUi, toDoc, nuevaCotizacion, nextCotizacionId, bootstrapCatalogos,
    cerrarPrompt, reenviarPrompt,
    enqueueAprobacionMail,
    adjuntosToAttachments,
  };
})();

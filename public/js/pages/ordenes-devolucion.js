// @ts-nocheck
// Check-in de órdenes de DEVOLUCIÓN — el tiquete de recuperar equipos que
// siguen con el cliente (renovación/baja) o de confirmar una anulación
// (¿los equipos salieron del taller o nunca?). Cada unidad esperada se
// resuelve con una de tres acciones:
//   Recibido      → mini-checklist (accesorios entregados + daño visible) y
//                   el backend (onOrdenDevolucionWrite) la manda a cuarentena;
//                   cada tanda alimenta al instante la ENTRADA de inspección.
//   Nunca salió   → (solo modo confirmación) vuelve a bodega directo.
//   No se devuelve→ excepción justificada (motivo obligatorio).
// ACUSE FIRMADO (2026-07-21): el cliente firma por tanda lo que entregó tal
// como quedó registrado (accesorios/daño), ANTES de la revisión técnica —
// devolucion.acuses[]. El backend copia el primer acuse a la ENTRADA como su
// recepción en mostrador ("Ver recepción" en la orden del taller).
// SIN CONTRATO (2026-07-22): devoluciones de contratos de papel (fuera del
// sistema) se crean a mano con `nueva()` (modo 'sin_contrato', sin esperados)
// y los seriales se capturan libres en este mismo check-in — el backend los
// da de alta en el pool vía upsertContacto (crea el doc si no existe).
// LOTE PEGADO (2026-07-29, pedido de recepción): un alquiler de 10 radios se
// recibía tecleando serial por serial. Ahora se pega la lista completa —
// tal cual la copia el botón "Copiar seriales" del POC — y el modelo se
// resuelve consultando el pool por serial; el operador revisa los avisos
// (serial ajeno, ficha en conflicto, no figura en la devolución) y confirma
// TODO con un solo checklist de accesorios. Es UNA escritura, así que el
// backend crea UNA sola tanda de ENTRADA y el acuse cubre el lote entero.
// Las resoluciones son definitivas (el pool se mueve al instante); un error
// se corrige desde Inventario · Equipos por serial.
// ACUSE FORMAL (2026-09-01): cada acuse lleva número correlativo
// ({ordenId}-A{n}), documento imprimible (nueva pestaña) y COPIA AL CLIENTE
// por correo: la UI marca acuses[].envio = 'solicitado' y el backend
// (onOrdenDevolucionWrite) encola el correo; onMailQueued espeja el resultado
// real (enviado/fallo) y la tarjeta ofrece reenviar. El correo del cliente
// sale de clientes.email_acuses || clientes.email y se guarda corregido.
// FIRMA EN TABLET: "Firmar en la tablet" crea una solicitud en firmas_tablet
// que la tablet del mostrador (/firmar/tablet.html) muestra en vivo; al
// firmarse allá, este modal la recoge (onSnapshot) y guarda el acuse solo.
// El modal además escucha la orden en vivo (estado del envío, tandas de otra
// pestaña) sin pisar capturas a medias.
(function () {
  'use strict';

  const MOTIVOS = [
    ['parcial', 'Renovación parcial — sigue en servicio'],
    ['vendido', 'Se vendió al cliente'],
    ['perdido', 'Perdido — pendiente de cobro'],
    ['otro',    'Otro (detallar)'],
  ];
  // Paleta PROPIA de resoluciones de devolución (antes reciclaba las clases de
  // chips de cotizaciones — mismo color, dominio ajeno; auditoría 2026-07-24).
  // El verde pálido es EXCLUSIVO del estado ya resuelto: los botones de acción
  // van sólidos (btn-primary) y sin gancho. Un "✓ Recibido" verde pálido en la
  // columna de resolución se leía como "esta unidad ya llegó" cuando en
  // realidad era el botón para registrarla (2026-08-14).
  const RES_LABEL = {
    recibido: '<span class="chip-estado" style="background:#e9f7f0;color:#067647;">Recibido</span>',
    nunca_salio: '<span class="chip-estado" style="background:#eef2ff;color:#4338ca;">Nunca salió</span>',
    no_devuelve: '<span class="chip-estado" style="background:#fdf3e4;color:#9a5b00;">No se devuelve</span>',
  };
  const RES_TEXTO = { recibido: 'recibido', nunca_salio: 'nunca salió', no_devuelve: 'no se devuelve' };
  // Checklist del acuse: qué entregó el cliente con cada unidad. Espeja los
  // booleanos de accesorios del equipo en la orden de ENTRADA (agregar-equipo).
  const ACCESORIOS = [
    ['bateria', 'Batería'], ['antena', 'Antena'], ['clip', 'Clip'],
    ['cargador', 'Cargador'], ['fuente', 'Fuente'], ['cubrepolvo', 'Cubrepolvo'],
  ];
  const esc = (v) => window.FMT ? FMT.esc(String(v ?? '')) : String(v ?? '');

  let _orden = null;      // copia fresca del doc
  let _ordenId = null;
  let _overlay = null;
  let _recibiendoId = null; // esperado con el mini-checklist abierto
  let _draftModelo = null;  // check-in por modelo/libre pendiente de confirmar {idx|null, serial, modelo, modelo_id}
  let _pegarAbierto = false;// caja de "pegar lista de seriales" desplegada
  let _draftLote = null;    // filas del lote pegado, en revisión (ver _clasificarLote)
  let _editandoId = null;   // unidad recibida con el checklist abierto para corregir
  let _firmaAcuse = null;   // API del canvas del acuse (FirmaPad)
  let _firmaSnapshot = null;// firma en curso, para sobrevivir a un re-render
  let _modelos = null;      // catálogo para el datalist de la captura libre (lazy)
  let _emailCliente = null; // correo de acuses de la ficha del cliente (email_acuses || email)
  let _acuseEmailDraft = null;  // correo tecleado en el bloque de firma (sobrevive re-renders)
  let _acuseNombreDraft = '';   // nombre tecleado en el bloque de firma (idem)
  let _acuseEnviarCopia = true; // "Enviar copia al cliente al guardar"
  let _solTabletId = null;  // solicitud de firma en tablet pendiente (firmas_tablet)
  let _unsubTablet = null;  // onSnapshot de la solicitud
  let _unsubOrden = null;   // onSnapshot de la orden (envíos/tandas en vivo)
  let _tabletGuardando = false; // candado: la firma de la tablet se guarda UNA vez

  // Los caminos de captura (unidad esperada, check-in por modelo/libre, lote
  // pegado y corrección de una recibida) comparten los IDs del mini-checklist:
  // solo uno puede estar abierto a la vez o `_leerChecklist` leería casillas
  // de otro formulario.
  function _cerrarCapturas() {
    _recibiendoId = null;
    _draftModelo = null;
    _draftLote = null;
    _pegarAbierto = false;
    _editandoId = null;
  }

  function puedeOperar() {
    const rol = window.APP?.state?.userRole || '';
    return [ROLES.ADMIN, ROLES.RECEPCION, ROLES.JEFE_TALLER, ROLES.VENDEDOR, ROLES.TECNICO].includes(rol);
  }

  async function abrir(ordenId) {
    _ordenId = ordenId;
    _cerrarCapturas();
    _firmaAcuse?.destroy();
    _firmaAcuse = null;
    _firmaSnapshot = null;
    _emailCliente = null;
    _acuseEmailDraft = null;
    _acuseNombreDraft = '';
    _acuseEnviarCopia = true;
    _solTabletId = null;
    try {
      _orden = await OrdenesService.getOrder(ordenId);
    } catch (e) { Toast.show('No se pudo cargar la orden.', 'bad'); return; }
    if (!_orden || !_orden.devolucion) { Toast.show('La orden no tiene datos de devolución.', 'bad'); return; }
    const db = firebase.firestore();
    // Correo del cliente para la copia del acuse (best-effort): este flujo no
    // capturaba ningún correo; se lee de la ficha y se guarda corregido.
    if (_orden.cliente_id) {
      try {
        const c = await db.collection('clientes').doc(_orden.cliente_id).get();
        if (c.exists) {
          const d = c.data();
          _emailCliente = String(d.email_acuses || d.email || '').trim().toLowerCase() || null;
        }
      } catch (e) { /* sin ficha o sin permiso: el campo queda vacío */ }
    }
    // ¿Quedó una firma en tablet de una sesión anterior? Se retoma la
    // pendiente, y una 'firmada' que nunca llegó a aplicarse (el modal se
    // cerró justo cuando el cliente confirmaba) se recupera aquí mismo.
    // Solo igualdades + in: no requiere índice compuesto.
    _unsubTablet?.(); _unsubTablet = null;
    try {
      const s = await db.collection('firmas_tablet')
        .where('orden_id', '==', ordenId)
        .where('estado', 'in', ['pendiente', 'firmada'])
        .where('tipo', '==', 'acuse_devolucion')
        .get();
      const aplicados = new Set((_orden.devolucion.acuses || []).map(a => a.solicitud_id).filter(Boolean));
      const docs = s.docs.filter(d => !aplicados.has(d.id));
      const pendiente = docs.find(d => d.data().estado === 'pendiente');
      // Una firmada vieja (otra tanda, otro día) no debe pegarse a la tanda
      // actual: solo se recupera si es de las últimas 4 horas — la misma
      // ventana de frescura que muestra la tablet.
      const frescoMs = Date.now() - 4 * 60 * 60 * 1000;
      const firmada = docs.find(d => d.data().estado === 'firmada'
        && (d.data().creado_at?.toDate?.().getTime() || 0) >= frescoMs);
      if (pendiente) { _solTabletId = pendiente.id; _suscribirTablet(); }
      else if (firmada) { _acuseDesdeTablet(firmada.id, firmada.data()); }
    } catch (e) { /* sin permiso o colección nueva: no crítico */ }
    // La orden EN VIVO: el estado del envío del acuse lo escriben los triggers
    // (encolado→enviado/fallo) y otra pestaña puede registrar tandas. Solo se
    // repinta cuando no hay una captura a medias — un re-render en frío
    // vaciaría el checklist o el campo que se está tecleando.
    _unsubOrden?.();
    _unsubOrden = db.collection('ordenes_de_servicio').doc(ordenId).onSnapshot((snap) => {
      if (!_overlay || !snap.exists) return;
      const fresh = snap.data();
      if (!fresh || !fresh.devolucion) return;
      const el = document.activeElement;
      const tecleando = _overlay.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '');
      const capturando = _recibiendoId || _draftModelo || _draftLote || _editandoId
        || _pegarAbierto || tecleando || (_firmaAcuse && !_firmaAcuse.isEmpty());
      if (capturando) return; // la siguiente escritura propia re-sincroniza
      _orden = fresh;
      render();
    });
    // Captura libre (sin contrato): datalist de modelos del catálogo, para
    // que la unidad nazca con modelo_id cuando el operador elige uno conocido.
    if (_orden.devolucion.modo === 'sin_contrato' && !_modelos) {
      try {
        _modelos = (typeof ModelosService !== 'undefined')
          ? (await ModelosService.getModelos())
              // `precio_venta` viaja para prellenar el monto de los equipos que
              // el cliente NO devuelve (itemización al cerrar) sin releer el
              // catálogo. Sin precio en el catálogo el campo nace vacío.
              .map(m => ({ id: m.id, nombre: (m.modelo || m.nombre || '').trim(),
                           precio_venta: Number(m.precio_venta) || 0 }))
              .filter(m => m.nombre)
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
          : [];
      } catch (e) { _modelos = []; }
    }
    render();
  }

  function cerrarModal() {
    _firmaAcuse?.destroy();
    _firmaAcuse = null;
    _firmaSnapshot = null;
    _unsubOrden?.(); _unsubOrden = null;
    // La solicitud de tablet NO se cancela al cerrar el modal: el cliente
    // puede estar firmando en ese momento. Al reabrir la orden se retoma.
    _unsubTablet?.(); _unsubTablet = null;
    _overlay?.remove();
    _overlay = null;
    // Refresca la fila en la lista si la página de órdenes está montada.
    if (typeof window.cargarOrdenesYEquipos === 'function') { try { window.cargarOrdenesYEquipos(true); } catch (e) {} }
  }

  // Firma del acuse: la captura vive en FirmaPad (js/ui/firmaPad.js), común a
  // todos los puntos de firma. Cubre mouse, pantalla táctil y PAD de firma /
  // lápiz USB con un solo camino (Pointer Events + captura de puntero) —
  // antes solo escuchaba mouse/touch sin captura y en escritorio el trazo se
  // cortaba al salir del recuadro, así que había que marcar "sin firma".
  function _montarFirma(canvas) {
    if (!window.FirmaPad) {
      console.error('[OrdenesDevolucion] FirmaPad no cargó — revisa el <script> de js/ui/firmaPad.js');
      return null;
    }
    const pad = FirmaPad.mount(canvas, {
      alto: 140,
      onChange: (hayFirma) => {
        const est = _overlay?.querySelector('#acuseFirmaEstado');
        if (est) {
          est.textContent = hayFirma ? '✓ Firma capturada' : 'Firme dentro del recuadro';
          est.style.color = hayFirma ? '#065F46' : 'var(--fg-3,#6b7280)';
        }
        if (hayFirma) _firmaSnapshot = null; // el trazo vivo manda sobre el restaurado
      },
    });
    // El modal se re-renderiza en cada check-in: si el cliente ya había
    // firmado, se recupera el trazo en vez de perderlo en silencio.
    if (pad && _firmaSnapshot) pad.restore(_firmaSnapshot);
    return pad;
  }

  // Checklist de accesorios + daño. Lo comparten el check-in unitario y el
  // lote pegado. "Todos" (2026-07-29, pedido de recepción) marca los seis de
  // un golpe: el caso normal es que el cliente devuelva el radio completo, y
  // marcar gancho por gancho en cada unidad era el grueso del trabajo.
  // `previo` precarga el estado actual — lo usa la corrección de una unidad ya
  // recibida (si no, corregir el cargador obligaría a volver a marcar los otros
  // cinco, que es justo el trabajo que "Todos" vino a quitar).
  function checklistHtml(titulo, previo) {
    const acc = previo?.accesorios || null;
    return `
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">${titulo}</div>
      <label style="display:flex;align-items:center;gap:4px;margin:0 0 6px;font-size:12px;font-weight:700;width:max-content;cursor:pointer;">
        <input type="checkbox" id="devAccTodos"> Todos
      </label>
      <div style="display:flex;gap:4px 12px;flex-wrap:wrap;font-size:12px;">
        ${ACCESORIOS.map(([k, l]) => `<label style="display:flex;align-items:center;gap:4px;margin:0;"><input type="checkbox" class="dev-acc" data-acc="${k}"${acc && acc[k] ? ' checked' : ''}> ${l}</label>`).join('')}
      </div>
      <input class="form-input" id="devDano" value="${esc(previo?.dano || '')}" placeholder="Daño obvio a la vista (opcional) — ej.: carcasa rajada" style="height:30px;font-size:12px;margin-top:6px;width:100%;">`;
  }

  // Mini-checklist al recibir: qué entregó el cliente con la unidad + daño
  // obvio a la vista. Es lo que después firma en el acuse — se registra
  // ANTES de la revisión técnica.
  function miniFormHtml(serial) {
    return `
      <div style="border:1px solid #bae6fd;background:#eff6ff;border-radius:8px;padding:8px;max-width:440px;">
        ${checklistHtml(`¿Qué entregó el cliente con ${esc(serial)}?`)}
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="devRecibidoConfirm">Confirmar recibido</button>
          <button type="button" class="btn btn-sm" id="devRecibidoCancel">Cancelar</button>
        </div>
      </div>`;
  }

  // Corrección de una unidad YA recibida, precargada con lo registrado. Solo
  // accesorios y daño: el serial no se toca (ver candado en corregirHtml).
  function corregirHtml(e) {
    return `
      <div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:8px;padding:8px;max-width:440px;">
        ${checklistHtml(`Corregir lo registrado con ${esc(e.serial)}`, { accesorios: e.accesorios, dano: e.dano_visible })}
        <div style="font-size:11px;color:#92400e;margin-top:6px;">
          Esto corrige el <b>acuse</b> de la devolución. La orden de ENTRADA ya recibió su copia
          cuando entró la tanda, así que si el taller ya la tiene, ajústala también allá.
          El serial no se cambia desde aquí: ya movió el equipo en el inventario. Si el serial
          está mal, corrígelo en <b>Inventario · Equipos por serial</b>.
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="devCorregirConfirm">Guardar corrección</button>
          <button type="button" class="btn btn-sm" id="devCorregirCancel">Cancelar</button>
        </div>
      </div>`;
  }

  // Estado del checklist en pantalla. Solo hay uno abierto a la vez
  // (_cerrarCapturas), así que la búsqueda por ID/clase es inequívoca.
  function _leerChecklist() {
    const accesorios = {};
    _overlay.querySelectorAll('.dev-acc').forEach(cb => { accesorios[cb.dataset.acc] = !!cb.checked; });
    return { accesorios, dano: (_overlay.querySelector('#devDano')?.value || '').trim() };
  }

  // "Todos" ⇄ casillas individuales, en los dos sentidos (marcar los seis a
  // mano deja "Todos" marcado; desmarcar uno lo pone en indeterminado).
  function _wireChecklist() {
    const todos = _overlay.querySelector('#devAccTodos');
    if (!todos) return;
    const cajas = [..._overlay.querySelectorAll('.dev-acc')];
    const sincronizarTodos = () => {
      const n = cajas.filter(x => x.checked).length;
      todos.checked = n === cajas.length;
      todos.indeterminate = n > 0 && n < cajas.length;
    };
    todos.addEventListener('change', () => {
      cajas.forEach(cb => { cb.checked = todos.checked; });
      todos.indeterminate = false;
    });
    cajas.forEach(cb => cb.addEventListener('change', sincronizarTodos));
    sincronizarTodos(); // el checklist puede venir precargado (corrección)
  }

  // ¿Se puede corregir lo registrado de esta unidad? Solo mientras el cliente
  // NO haya firmado el acuse: la firma es el papel que se lleva, y su copia
  // (acuses[].unidades) dice exactamente qué accesorios entregó. Editar
  // después dejaría al sistema diciendo una cosa y al papel del cliente otra.
  // Después de la firma la corrección va en la orden de ENTRADA, que es el
  // registro del taller y ahí sí se edita.
  function puedeCorregir(e, editable) {
    return !!editable && e.resolucion === 'recibido' && !e.acuse_id;
  }

  // Detalle bajo el chip "Recibido": lo que quedó registrado en el check-in
  // (base del acuse firmado) y si la firma sigue pendiente.
  function detalleRecibido(e, editable) {
    if (e.resolucion !== 'recibido') return '';
    const det = [];
    if (e.accesorios) {
      const con = ACCESORIOS.filter(([k]) => e.accesorios[k]).map(([, l]) => l);
      det.push(con.length ? `Entregó: ${con.join(', ')}` : 'Sin accesorios');
    }
    if (e.dano_visible) det.push(`Daño: ${esc(e.dano_visible)}`);
    if (e.corregido_at) det.push('<span title="Los accesorios o el daño se corrigieron después del check-in, antes de la firma.">corregido</span>');
    if (!e.acuse_id && editable) det.push('<b style="color:#92400e;">acuse pendiente de firma</b>');
    const linea = det.length ? `<div style="font-size:11px;color:var(--fg-3,#6b7280);">${det.join(' · ')}</div>` : '';

    // Corregir (antes de la firma) o explicar por qué ya no se puede.
    const accion = puedeCorregir(e, editable)
      ? `<button type="button" class="btn btn-ghost btn-sm dev-corregir" data-id="${esc(e.id)}"
                 title="Corregir accesorios o daño de esta unidad — se puede mientras el cliente no firme el acuse"
                 style="padding:1px 5px;font-size:11px;margin-top:3px;">✎ Corregir</button>`
      : (editable && e.resolucion === 'recibido' && e.acuse_id
        ? `<div style="font-size:11px;color:var(--fg-3,#6b7280);margin-top:2px;"
                title="El acuse firmado del cliente ya dice qué accesorios entregó; cambiarlo aquí lo dejaría distinto al papel que se llevó.">
             🔒 firmado por el cliente — corrige en la orden de ENTRADA
           </div>`
        : '');
    return linea + accion;
  }

  // Resumen del checklist de una unidad ("Completo" / lista / "Ninguno") —
  // espeja _resumenAccesorios de functions/src/lib/acuseDevolucion.js.
  function _accResumen(acc) {
    if (!acc) return 'Sin checklist';
    const con = ACCESORIOS.filter(([k]) => acc[k]).map(([, l]) => l);
    if (con.length === ACCESORIOS.length) return 'Completo';
    return con.length ? `Entregó: ${con.join(', ')}` : 'Sin accesorios';
  }

  // Chip del estado de envío de un acuse. 'solicitado'/'encolado' son el
  // tránsito (la UI lo pide, el backend lo encola); 'enviado'/'fallo' son el
  // resultado REAL del SMTP que espeja onMailQueued.
  function _chipEnvioHtml(envio) {
    const st = envio?.status || 'sin_enviar';
    if (st === 'enviado') {
      const cuando = envio.at?.toDate ? envio.at.toDate().toLocaleString('es-PA', { hour12: false }) : '';
      return `<span class="chip-estado" style="background:#e9f7f0;color:#067647;" title="Copia enviada a ${esc(envio.to || '')}${cuando ? ` · ${cuando}` : ''}">✓ Enviado al cliente</span>`;
    }
    if (st === 'solicitado' || st === 'encolado') {
      return `<span class="chip-estado" style="background:#eef2ff;color:#4338ca;" title="El correo está en cola de envío${envio?.to ? ` hacia ${esc(envio.to)}` : ''}.">Enviando…</span>`;
    }
    if (st === 'fallo') {
      return `<span class="chip-estado" style="background:#fee2e2;color:#b91c1c;" title="${esc(envio?.error || 'El envío falló')}">⚠ Falló el envío</span>`;
    }
    return `<span class="chip-estado" style="background:var(--bg-2,#f3f4f6);color:var(--fg-3,#6b7280);">Sin enviar</span>`;
  }

  // Tabla de revisión del lote pegado: qué va a entrar, con qué modelo y con
  // qué aviso. Nada se escribe hasta "Confirmar" — es la única oportunidad de
  // ver que un serial es de otro cliente ANTES de mover el pool.
  function bloqueLoteHtml() {
    const filas = _draftLote || [];
    const inc = filas.filter(f => f.incluir);
    const filasHtml = filas.map((f, i) => {
      const bloqueada = !f.incluir;
      const modeloCell = (f.destino === 'nuevo' || f.destino === 'por_modelo')
        ? `<input class="form-input dev-lote-modelo" data-i="${i}" list="devModelosList" value="${esc(f.modelo)}"
                  placeholder="Modelo" style="height:28px;font-size:12px;max-width:180px;" autocomplete="off">`
        : `<span style="white-space:nowrap;">${esc(f.modelo || '—')}</span>`;
      return `
        <tr style="${bloqueada ? 'opacity:.62;' : ''}">
          <td style="padding:5px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);font-family:var(--font-mono,monospace);white-space:nowrap;">${esc(f.serial)}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${modeloCell}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">
            <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">${f.avisos.join('')}</div>
          </td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);text-align:right;">
            <button type="button" class="btn btn-ghost btn-sm dev-lote-quitar" data-i="${i}"
                    title="Quitar del lote" style="padding:2px 6px;font-size:12px;line-height:1;">✕</button>
          </td>
        </tr>`;
    }).join('');

    // Los descartados se NOMBRAN aquí arriba: la tabla lleva scroll propio y
    // un "2 quedan fuera" sin decir cuáles obligaba a bajar dentro de la caja
    // para enterarse de qué no entró.
    const fuera = filas.filter(f => !f.incluir).map(f => f.serial);
    const fueraTxt = fuera.slice(0, 8).map(esc).join(', ') + (fuera.length > 8 ? `, +${fuera.length - 8} más` : '');
    // Contrato de papel: el total declarado al abrir el tiquete es a mano y se
    // equivoca. Si el lote lo pasa, mejor decirlo aquí que dejar un "recibidos
    // 12 de 10" sin explicación en el banner.
    const dev = _orden.devolucion || {};
    const totalEsperado = Number(dev.total_esperado || 0);
    const yaRecibidos = (dev.esperados || []).filter(e => e.resolucion === 'recibido').length;
    const excede = (dev.modo === 'sin_contrato' && totalEsperado && inc.length && yaRecibidos + inc.length > totalEsperado)
      ? `<div style="margin:0 0 8px;font-size:11.5px;color:#92400e;background:#fef3c7;border-radius:6px;padding:6px 8px;">
           Con este lote quedarían <b>${yaRecibidos + inc.length}</b> recibidos y el contrato de papel declara
           <b>${totalEsperado}</b>. Confirma si quieres, pero corrige el "Debe devolver" para que el pendiente cuadre.
         </div>`
      : '';
    return `
      <div id="devLoteBox" style="margin:0 0 12px;border:1px solid #bae6fd;background:#eff6ff;border-radius:10px;padding:10px 12px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:2px;">
          Revisión del lote — se van a registrar ${inc.length} de ${filas.length}
        </div>
        <p style="margin:0 0 8px;font-size:11.5px;color:${fuera.length ? '#92400e' : 'var(--fg-3,#6b7280)'};">
          ${fuera.length
            ? `Quedan fuera <b>${fueraTxt}</b> — el motivo va en su fila. Corrígelos y vuelve a pegar la lista, o regístralos aparte.`
            : 'El modelo sale del inventario por serial; puedes corregirlo aquí. Confirmar mueve los equipos.'}
        </p>
        ${excede}
        <div style="overflow:auto;max-height:45vh;border:1px solid var(--border-subtle,#e5e7eb);border-radius:8px;background:var(--bg-1,#fff);">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:460px;">
            <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:11.5px;">
              <th style="padding:5px 8px;">Serial</th><th style="padding:5px 8px;">Modelo</th>
              <th style="padding:5px 8px;">Inventario</th><th style="padding:5px 8px;"></th>
            </tr></thead>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>
        ${inc.length ? `
        <div style="margin-top:10px;">
          ${checklistHtml(`¿Qué entregó el cliente con ${inc.length === 1 ? 'esta unidad' : `estas ${inc.length} unidades`}?`)}
          <div style="font-size:11px;color:var(--fg-3,#6b7280);margin-top:4px;">
            Se aplica igual a todo el lote. Si una unidad llegó distinta, quítala de aquí y regístrala aparte.
          </div>
        </div>` : ''}
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" id="devLoteConfirm" ${inc.length ? '' : 'disabled'}>Confirmar ${inc.length} recibido${inc.length === 1 ? '' : 's'}</button>
          <button type="button" class="btn btn-sm" id="devLoteCancel">Cancelar</button>
        </div>
      </div>`;
  }

  function render() {
    // Cada check-in re-renderiza el modal entero. Si el cliente ya trazó su
    // firma, se guarda para restaurarla en el canvas nuevo.
    if (_firmaAcuse && !_firmaAcuse.isEmpty()) _firmaSnapshot = _firmaAcuse.snapshot();

    const dev = _orden.devolucion || {};
    const esperados = dev.esperados || [];
    const porModelo = dev.esperados_por_modelo || [];
    const acuses = dev.acuses || [];
    const cerrada = (_orden.estado_reparacion || '').toUpperCase() === 'CERRADA (DEVOLUCION)';
    const editable = !cerrada && puedeOperar();
    const esConfirmacion = dev.modo === 'confirmacion';
    const esSinContrato = dev.modo === 'sin_contrato';

    const pendientes = esperados.filter(e => !e.resolucion).length;
    const modelosPend = porModelo.reduce((s, m) => s + Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)), 0);
    const sinAcuse = esperados.filter(e => e.resolucion === 'recibido' && !e.acuse_id);

    // Pendientes por devolver. En 'sin_contrato' no hay lista previa: el
    // pendiente sale de total_esperado (lo que el cliente declaró) menos lo
    // recibido. Fórmula compartida con la lista de órdenes y con el
    // recordatorio diario.
    const recibidos = esperados.filter(e => e.resolucion === 'recibido').length;
    const totalEsperado = Number(dev.total_esperado || 0);
    const totalPend = (typeof pendientesDevolucion === 'function')
      ? pendientesDevolucion(_orden)
      : pendientes + modelosPend;
    // Con contrato el cierre exige resolver todo; sin contrato el faltante
    // puede ser real (el cliente no trajo el resto) y se cierra con constancia.
    const bloqueaCierre = pendientes + modelosPend > 0;

    const intro = esConfirmacion
      ? 'Anulación de contrato: lo usual es que los equipos <b>nunca hayan salido</b>. Confirma unidad por unidad — <b>Nunca salió</b> los regresa a bodega directo; <b>Recibido</b> los manda a inspección.'
      : esSinContrato
      ? 'Devolución <b>sin contrato en el sistema</b> (contrato de papel). Registra cada unidad al recibirla — serial + modelo — con su checklist de accesorios/daño y el <b>acuse firmado</b> del cliente. Las unidades quedan trackeadas en Equipos por serial y alimentan la orden de ENTRADA del taller.'
      : 'Estos equipos están <b>con el cliente</b>. Marca <b>Recibido</b> cuando cada unidad llegue físicamente: registra accesorios y daño visible, y el cliente <b>firma el acuse</b> de lo entregado (antes de la revisión técnica). Cada tanda alimenta al instante la orden de ENTRADA del taller.';

    // Contador de faltantes siempre a la vista: es el dato que se pierde de
    // vista cuando el cliente trae solo una parte del alquiler.
    const bannerPendientes = totalPend > 0
      ? `<div style="margin:0 0 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;">
           <i data-lucide="package-x" style="width:16px;height:16px;color:#b45309;"></i>
           <span style="font-size:13px;color:#78350f;">
             <b>${totalPend} equipo${totalPend === 1 ? '' : 's'} pendiente${totalPend === 1 ? '' : 's'} por devolver</b>${esSinContrato && totalEsperado ? ` — recibidos ${recibidos} de ${totalEsperado}.` : '.'}
             ${cerrada
               ? 'La orden se cerró así: la recuperación o el cobro se coordina fuera del sistema.'
               : 'Mientras queden pendientes, la orden sigue apareciendo en el recordatorio diario de devoluciones.'}
           </span>
         </div>`
      : (() => {
          // Todo resuelto: banner verde con el SIGUIENTE PASO explícito —
          // sin él, el modal quedaba mudo y no se entendía qué faltaba
          // (firmar el acuse o cerrar la orden). Solo si hubo algo esperado:
          // una sin_contrato sin total declarado da 0 pendientes en vacío.
          const huboAlgo = esperados.length > 0
            || porModelo.some(m => Number(m.cantidad || 0) > 0)
            || totalEsperado > 0;
          if (!huboAlgo) return '';
          const detalle = esSinContrato && totalEsperado
            ? `${recibidos} de ${totalEsperado} equipos recibidos`
            : 'todas las unidades están resueltas';
          const siguiente = cerrada ? ''
            : sinAcuse.length
            ? ` Siguiente paso: el cliente <b>firma el acuse</b> de ${sinAcuse.length} unidad(es) — más abajo.`
            : ' Siguiente paso: <b>Cerrar devolución</b> (botón al pie).';
          return `<div style="margin:0 0 12px;border:1px solid #A7F3D0;background:#ECFDF5;border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;">
             <i data-lucide="package-check" style="width:16px;height:16px;color:#059669;flex:none;"></i>
             <span style="font-size:13px;color:#065F46;"><b>Completo:</b> ${detalle}.${siguiente}</span>
           </div>`;
        })();

    const tdS = 'padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);';

    // ── El modal se organiza por ETAPA del mostrador (2026-09-01), en el
    // orden físico del trabajo: recibir → firmar la tanda → acuses → cierre.
    // Antes era UNA tabla con todo mezclado y el vínculo tanda→acuse no se
    // veía por ningún lado.

    // Unidades PENDIENTES por recibir, con sus acciones de check-in.
    const filas = esperados.filter(e => !e.resolucion).map(e => `
      <tr>
        <td style="${tdS}font-family:var(--font-mono,monospace);">${esc(e.serial)}</td>
        <td style="${tdS}white-space:nowrap;">${esc(e.modelo || '—')}</td>
        <td style="${tdS}">
          ${editable ? (_recibiendoId === e.id ? miniFormHtml(e.serial) : `
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <button type="button" class="btn btn-primary btn-sm dev-recibido" data-id="${esc(e.id)}"
                        title="Registrar la llegada física de esta unidad — abre el checklist de accesorios y daño"><i data-lucide="arrow-down-to-line"></i> Marcar recibido</button>
                ${esConfirmacion ? `<button type="button" class="btn btn-sm dev-nunca" data-id="${esc(e.id)}">Nunca salió</button>` : ''}
                <select class="form-select dev-motivo" data-id="${esc(e.id)}" style="height:30px;font-size:12px;max-width:230px;">
                  <option value="">No se devuelve — motivo…</option>
                  ${MOTIVOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              </div>`)
            : '<span style="color:var(--fg-3,#6b7280);">pendiente</span>'}
        </td>
      </tr>`).join('');

    // TANDA EN CURSO: recibidas que aún no tienen acuse firmado. Aquí vive la
    // corrección pre-firma; las ya firmadas se ven en su tarjeta de acuse.
    const filasTanda = sinAcuse.map(e => `
      <tr>
        <td style="${tdS}font-family:var(--font-mono,monospace);">${esc(e.serial)}</td>
        <td style="${tdS}white-space:nowrap;">${esc(e.modelo || '—')}</td>
        <td style="${tdS}">
          ${_editandoId === e.id
            ? corregirHtml(e)
            : (RES_LABEL.recibido + detalleRecibido(e, editable))}
        </td>
      </tr>`).join('');

    // Otras resoluciones (no entran al taller): nunca salió / no se devuelve.
    const otras = esperados.filter(e => e.resolucion === 'nunca_salio' || e.resolucion === 'no_devuelve');
    const filasOtras = otras.map(e => `
      <tr>
        <td style="${tdS}font-family:var(--font-mono,monospace);">${esc(e.serial)}</td>
        <td style="${tdS}white-space:nowrap;">${esc(e.modelo || '—')}</td>
        <td style="${tdS}">
          ${RES_LABEL[e.resolucion] || esc(e.resolucion)}
          ${e.motivo_codigo ? `<div style="font-size:11px;color:var(--fg-3,#6b7280);">${esc((MOTIVOS.find(([v]) => v === e.motivo_codigo) || [,''])[1])}${e.motivo_detalle ? ': ' + esc(e.motivo_detalle) : ''}</div>` : ''}
        </td>
      </tr>`).join('');

    // Check-in por modelo pendiente de confirmar: fila extra con el mismo
    // mini-checklist (se escribe una sola vez, al confirmar).
    const filaDraft = _draftModelo ? `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);font-family:var(--font-mono,monospace);">${esc(_draftModelo.serial)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(_draftModelo.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${miniFormHtml(_draftModelo.serial)}</td>
      </tr>` : '';

    // Captura libre (modo sin_contrato): la orden nace sin esperados — cada
    // serial se registra al llegar, con modelo del catálogo si se conoce.
    const bloqueCapturaLibre = (editable && esSinContrato && !_draftModelo && !_draftLote) ? `
      <div style="margin-top:${esperados.length ? '12px' : '0'};border:1px dashed var(--border-subtle,#cbd5e1);border-radius:10px;padding:10px 12px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
          <span style="font-weight:600;font-size:13px;">Registrar unidad recibida</span>
          <span style="font-size:12px;color:var(--fg-3,#6b7280);margin-left:auto;">Debe devolver</span>
          <input class="form-input" id="devTotalEsperado" type="number" min="0" max="999" value="${totalEsperado || ''}"
                 placeholder="—" title="Cantidad de equipos que el cliente debe devolver según el contrato de papel"
                 style="height:28px;font-size:12.5px;width:64px;text-align:center;">
          <span style="font-size:12px;color:var(--fg-3,#6b7280);">equipos</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <input class="form-input" id="devSerialLibre" placeholder="Serial (tecléalo o escanéalo)" style="height:32px;font-size:12.5px;max-width:220px;" autocomplete="off">
          <input class="form-input" id="devModeloLibre" list="devModelosList" placeholder="Modelo" style="height:32px;font-size:12.5px;max-width:220px;" autocomplete="off">
          <button type="button" class="btn btn-sm dev-checkin-libre" style="height:32px;">Check-in</button>
        </div>
      </div>` : '';

    // ── Lote pegado ───────────────────────────────────────────────────────
    // Solo tiene sentido si queda algo por recibir: unidades esperadas
    // pendientes, faltantes por modelo, o una devolución de contrato de papel
    // (donde nunca hay lista previa).
    const hayDondeMeter = esSinContrato || pendientes > 0 || modelosPend > 0;
    const pegarPosible = editable && hayDondeMeter && !_draftLote && !_draftModelo && !_recibiendoId;

    const bloquePegar = !pegarPosible ? '' : (_pegarAbierto ? `
      <div id="devPegarBox" style="margin:0 0 12px;border:1px solid #bae6fd;background:#eff6ff;border-radius:10px;padding:10px 12px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:2px;">Pegar lista de seriales</div>
        <p style="margin:0 0 8px;font-size:11.5px;color:var(--fg-3,#6b7280);">
          Cópialos del POC (botón <b>Copiar seriales</b>) o de cualquier lista: uno por línea, o separados
          por coma o espacio. Se buscan en el inventario para traer el modelo y avisar de seriales ajenos;
          después confirmas todo el lote con un solo checklist.
        </p>
        <textarea class="form-input form-textarea" id="devPegarSeriales" rows="5" spellcheck="false"
                  placeholder="25219A0944&#10;24O31A0947&#10;…"
                  style="font-family:var(--font-mono,monospace);font-size:12.5px;width:100%;"></textarea>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button type="button" class="btn btn-primary btn-sm" id="devPegarProcesar">Revisar seriales</button>
          <button type="button" class="btn btn-sm" id="devPegarCancelar">Cancelar</button>
        </div>
      </div>` : `
      <div style="margin:0 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm" id="devPegarAbrir"><i data-lucide="clipboard-paste"></i> Pegar lista de seriales</button>
        <span style="font-size:11.5px;color:var(--fg-3,#6b7280);">Recibe varios de una — cópialos del POC y pégalos aquí.</span>
      </div>`);

    const bloqueLote = (editable && _draftLote) ? bloqueLoteHtml() : '';

    const filasModelo = porModelo.map((m, i) => {
      const falta = Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0));
      return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(m.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);text-align:center;">${Number(m.recibidos || 0)} / ${Number(m.cantidad || 0)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">
          ${(editable && falta > 0) ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input class="form-input dev-serial-modelo" data-idx="${i}" placeholder="Serial recibido (tecléalo o escanéalo)" style="height:30px;font-size:12px;max-width:220px;">
              <button type="button" class="btn btn-sm dev-checkin-modelo" data-idx="${i}">Check-in</button>
            </div>` : (falta === 0 ? '<span class="chip-estado chip-aprobada">completo</span>' : '')}
        </td>
      </tr>`;
    }).join('');

    // Acuse de recepción de la TANDA: el cliente firma aquí (canvas) o en la
    // tablet del mostrador ("Firmar en la tablet" → firmas_tablet, la página
    // /firmar/tablet.html la muestra en vivo). El número correlativo nace
    // aquí y la copia al cliente puede salir en el mismo guardado. Este
    // bloque se pinta como pie de la sección "Tanda en curso".
    const numeroSiguiente = `${_ordenId}-A${acuses.length + 1}`;
    const emailPrellenado = _acuseEmailDraft != null ? _acuseEmailDraft : (_emailCliente || '');
    const bloqueEnvioCopia = `
        <div style="border-top:1px solid #fcd34d;margin-top:10px;padding-top:8px;">
          <label class="form-check" style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin:0 0 6px;">
            <input type="checkbox" id="acuseEnviarCopia"${_acuseEnviarCopia ? ' checked' : ''}>
            <span>Enviar copia del acuse al cliente al guardar</span>
          </label>
          <div class="form-field" style="margin:0;">
            <input class="form-input" id="acuseEmail" type="email" placeholder="correo@cliente.com" autocomplete="off"
                   style="height:32px;max-width:320px;" value="${esc(emailPrellenado)}">
            <div style="font-size:11px;color:var(--fg-3,#6b7280);margin-top:3px;">
              Sale de la ficha del cliente${_emailCliente ? '' : ' (no tiene correo registrado)'} — si lo corriges aquí,
              queda guardado para los próximos envíos. También se puede enviar o reenviar después, desde la tarjeta del acuse.
            </div>
          </div>
        </div>`;
    const bloqueAcuse = (editable && sinAcuse.length) ? `
      <div style="border-top:1px solid #fcd34d;background:#fffbeb;padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
          <span style="font-weight:700;font-size:13px;">Acuse de recibido — firma del cliente</span>
          <span style="font-family:var(--font-mono,monospace);font-size:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:1px 8px;">${esc(numeroSiguiente)}</span>
          ${(!_solTabletId && _tabletMostradorDisponible()) ? `<button type="button" class="btn btn-sm btn-firma-tablet" id="acuseTabletBtn" style="margin-left:auto;"
              title="La solicitud aparece sola en la tablet del mostrador; cuando el cliente confirme allá, el acuse se guarda aquí automáticamente.">
              <i data-lucide="tablet"></i> Firmar en la tablet</button>` : ''}
        </div>
        <p style="margin:0 0 10px;font-size:11.5px;color:#92400e;background:#fef3c7;border-radius:6px;padding:6px 8px;">
          Los radios ingresarán al taller para su revisión. Cualquier daño identificado como causado por mal uso,
          así como los accesorios o equipos no devueltos, serán notificados oportunamente mediante cotización
          para su posterior facturación.
        </p>
        ${_solTabletId ? `
        <div style="display:flex;align-items:center;gap:10px;border:1px dashed #fcd34d;border-radius:8px;background:#fff;padding:10px 12px;">
          <span style="width:14px;height:14px;border:2px solid #fcd34d;border-top-color:#b45309;border-radius:99px;display:inline-block;animation:devspin 1s linear infinite;flex:none;"></span>
          <span style="font-size:12.5px;color:#78350f;flex:1;">
            <b>Esperando la firma en la tablet…</b> Pásale la tablet al cliente; al confirmar allá, el acuse se guarda aquí solo.
          </span>
          <button type="button" class="btn btn-ghost btn-sm" id="acuseTabletCancelar">Cancelar</button>
        </div>
        <style>@keyframes devspin{to{transform:rotate(360deg)}}</style>` : `
        <div class="form-field" style="margin-bottom:8px;">
          <label class="form-label" for="acuseNombre">Nombre de quien entrega</label>
          <input class="form-input" id="acuseNombre" placeholder="Nombre y apellido" autocomplete="off" style="height:32px;" value="${esc(_acuseNombreDraft)}">
        </div>
        <div id="acuseFirmaWrap">
          <label class="form-label">Firma</label>
          <canvas id="acuseFirmaCanvas" style="width:100%;height:140px;border:1px dashed var(--line,#cbd5e1);border-radius:8px;background:#fff;touch-action:none;cursor:crosshair;"></canvas>
          <div style="display:flex;align-items:center;gap:10px;margin-top:2px;">
            <button type="button" class="btn btn-ghost btn-sm" id="acuseLimpiarFirma" style="padding:3px 8px;font-size:12px;">Limpiar firma</button>
            <span id="acuseFirmaEstado" style="font-size:11.5px;color:var(--fg-3,#6b7280);">Firme dentro del recuadro</span>
          </div>
          <div style="font-size:11px;color:var(--fg-3,#6b7280);margin-top:2px;">
            Sirve con dedo, mouse, lápiz o pad de firma USB — mantenga presionado y trace; el trazo continúa aunque se salga del recuadro.
          </div>
        </div>
        <label class="form-check" style="margin-top:6px;display:flex;align-items:center;gap:8px;font-size:12.5px;">
          <input type="checkbox" id="acuseSinFirma"> <span>Registrar sin firma del cliente</span>
        </label>
        <div class="form-field hidden" id="acuseSinFirmaBloque" style="margin-top:6px;">
          <label class="form-label" for="acuseSinFirmaMotivo">Motivo (obligatorio)</label>
          <input class="form-input" id="acuseSinFirmaMotivo" style="height:32px;" placeholder="Ej.: equipos recogidos por el técnico en sitio">
        </div>`}
        ${bloqueEnvioCopia}
        ${!_solTabletId ? `<button type="button" class="btn btn-primary btn-sm" id="acuseGuardarBtn" style="margin-top:10px;"><i data-lucide="pen-line"></i> Guardar acuse</button>` : ''}
      </div>` : '';

    // Tarjetas de acuse: una por tanda firmada, cada una con su número, sus
    // unidades y SU PROPIO estado de envío al cliente (Ver/Imprimir y
    // Enviar/Reenviar funcionan también con la orden cerrada).
    const puedeEnviar = puedeOperar();
    const secAcuses = acuses.length ? `
      <div style="margin-top:16px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Acuses de recibido</div>
        <div style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:10px;overflow:hidden;">
        ${acuses.map((a, idx) => {
          const numero = a.numero || `${_ordenId}-A${idx + 1}`;
          const unidadesA = (a.unidades && a.unidades.length)
            ? a.unidades : (a.seriales || []).map(s => ({ serial: s }));
          const fecha = a.at?.toDate ? a.at.toDate().toLocaleString('es-PA', { hour12: false }) : '';
          const envio = a.envio || null;
          const st = envio?.status || 'sin_enviar';
          const btnEnviar = !puedeEnviar ? '' : (
            st === 'enviado'
              ? `<button type="button" class="btn btn-ghost btn-sm dev-acuse-enviar" data-idx="${idx}" style="padding:3px 8px;font-size:12px;">Reenviar</button>`
              : (st === 'solicitado' || st === 'encolado')
              ? ''
              : `<button type="button" class="btn btn-primary btn-sm dev-acuse-enviar" data-idx="${idx}" style="padding:3px 10px;font-size:12px;">${st === 'fallo' ? 'Reenviar' : 'Enviar al cliente'}</button>`);
          return `
          <div style="padding:10px 14px;${idx ? 'border-top:1px solid var(--border-subtle,#e5e7eb);' : ''}">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-family:var(--font-mono,monospace);font-size:12px;font-weight:600;background:var(--bg-2,#f3f4f6);border:1px solid var(--border-subtle,#e5e7eb);border-radius:6px;padding:1px 8px;white-space:nowrap;">${esc(numero)}</span>
              <div style="flex:1;min-width:160px;">
                <div style="font-size:13px;font-weight:600;">
                  ${a.sin_firma ? `Sin firma — ${esc(a.sin_firma_motivo || '')}` : `Firmado por ${esc(a.nombre_entrega || '—')}`}
                  ${a.via === 'tablet' ? '<span style="font-size:11px;color:var(--fg-3,#6b7280);font-weight:400;"> · en tablet</span>' : ''}
                </div>
                <div style="font-size:11.5px;color:var(--fg-3,#6b7280);">${esc(fecha)} · ${unidadesA.length} unidad(es)</div>
              </div>
              ${_chipEnvioHtml(envio)}
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button type="button" class="btn btn-ghost btn-sm dev-acuse-ver" data-idx="${idx}" style="padding:3px 8px;font-size:12px;"
                        title="Abre el documento del acuse en una pestaña nueva, listo para imprimir.">Ver / Imprimir</button>
                ${btnEnviar}
              </div>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
              ${unidadesA.map(u => `<span style="font-family:var(--font-mono,monospace);font-size:11px;background:var(--bg-2,#f3f4f6);border:1px solid var(--border-subtle,#e5e7eb);border-radius:6px;padding:1px 7px;color:var(--fg-2,#374151);"
                title="${esc(_accResumen(u.accesorios))}${u.dano_visible ? ` · Daño: ${esc(u.dano_visible)}` : ''}">${esc(u.serial)}</span>`).join('')}
            </div>
            ${st === 'enviado' && envio?.to ? `<div style="font-size:11.5px;color:var(--fg-3,#6b7280);margin-top:5px;">Copia enviada a <b>${esc(envio.to)}</b></div>` : ''}
            ${(st === 'solicitado' || st === 'encolado') && envio?.to ? `<div style="font-size:11.5px;color:var(--fg-3,#6b7280);margin-top:5px;">Enviando copia a <b>${esc(envio.to)}</b>… (tarda unos segundos; el chip cambia solo)</div>` : ''}
            ${st === 'fallo' ? `<div style="font-size:11.5px;color:#b91c1c;margin-top:5px;">El envío falló${envio?.error ? `: ${esc(envio.error)}` : ''} — verifica el correo y reenvía.</div>` : ''}
          </div>`;
        }).join('')}
        </div>
      </div>` : '';

    // Barra de progreso del tiquete: recibidos (verde) / excepciones (ámbar)
    // / pendientes (gris). Es el dato que se pierde de vista cuando el
    // cliente trae el alquiler por partes.
    const excCount = otras.length;
    const totalUnidades = recibidos + excCount + totalPend;
    const progreso = totalUnidades > 0 ? `
      <div style="margin:0 0 12px;">
        <div style="display:flex;height:7px;border-radius:99px;overflow:hidden;background:var(--bg-2,#f3f4f6);">
          <span style="width:${(recibidos / totalUnidades) * 100}%;background:#059669;"></span>
          <span style="width:${(excCount / totalUnidades) * 100}%;background:#d97706;"></span>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:5px;font-size:11.5px;color:var(--fg-3,#6b7280);">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:#059669;margin-right:4px;"></span><b style="color:var(--fg-1,#111827);">${recibidos}</b> recibidos</span>
          ${excCount ? `<span><span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:#d97706;margin-right:4px;"></span><b style="color:var(--fg-1,#111827);">${excCount}</b> con excepción</span>` : ''}
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:#d1d5db;margin-right:4px;"></span><b style="color:var(--fg-1,#111827);">${totalPend}</b> pendientes</span>
          <span style="margin-left:auto;"><b style="color:var(--fg-1,#111827);">${acuses.length}</b> acuse(s)</span>
        </div>
      </div>` : '';

    const theadUnidades = (col3) => `
      <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:12px;">
        <th style="padding:6px 8px;">Serial</th><th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;">${col3}</th>
      </tr></thead>`;

    // Sección "Por recibir": unidades esperadas pendientes + captura por
    // modelo + captura libre — todo lo que aún puede convertirse en recibido.
    const hayPorRecibir = filas || filaDraft || porModelo.length || bloqueCapturaLibre;
    const secPorRecibir = hayPorRecibir ? `
      <div style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:10px;overflow:hidden;margin-bottom:14px;">
        <div style="padding:8px 14px;background:var(--bg-2,#f8fafc);border-bottom:1px solid var(--border-subtle,#e5e7eb);font-weight:700;font-size:13px;">
          Por recibir
        </div>
        <div style="padding:10px 14px;">
          ${(filas || filaDraft) ? `
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
              ${theadUnidades('Check-in')}
              <tbody>${filas}${filaDraft}</tbody>
            </table>
          </div>` : ''}
          ${bloqueCapturaLibre}
          ${porModelo.length ? `
          <div style="margin-top:${(filas || filaDraft) ? '12px' : '0'};">
            <div style="font-weight:600;font-size:12.5px;margin-bottom:6px;color:var(--fg-2,#374151);">Por modelo (la baja no registró seriales — se capturan al llegar)</div>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
                <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:12px;">
                  <th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;text-align:center;">Recibidos</th><th style="padding:6px 8px;">Check-in</th>
                </tr></thead>
                <tbody>${filasModelo}</tbody>
              </table>
            </div>
          </div>` : ''}
        </div>
      </div>` : '';

    // Sección "Tanda en curso" (ámbar): recibidos sin acuse + el bloque de
    // firma como pie. Es el paso que faltaba nombrar: la tanda ES el acuse.
    const secTanda = sinAcuse.length ? `
      <div style="border:1px solid #fcd34d;border-radius:10px;overflow:hidden;margin-bottom:14px;">
        <div style="padding:8px 14px;background:#fffbeb;border-bottom:1px solid #fcd34d;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:13px;color:#92400e;">Tanda en curso — sin acuse firmado</span>
          <span style="font-size:12px;color:#b45309;">${sinAcuse.length} unidad(es)</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
            ${theadUnidades('Registrado en el check-in')}
            <tbody>${filasTanda}</tbody>
          </table>
        </div>
        ${bloqueAcuse}
      </div>` : '';

    // Otras resoluciones: nunca salió / no se devuelve — no van al taller.
    const secOtras = filasOtras ? `
      <div style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:10px;overflow:hidden;margin-top:16px;">
        <div style="padding:8px 14px;background:var(--bg-2,#f8fafc);border-bottom:1px solid var(--border-subtle,#e5e7eb);font-weight:700;font-size:13px;">
          Otras resoluciones
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
            ${theadUnidades('Resolución')}
            <tbody>${filasOtras}</tbody>
          </table>
        </div>
      </div>` : '';

    const html = `
      <div class="modal" style="max-width:780px;max-height:88vh;display:flex;flex-direction:column;">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div style="font-weight:700;">Devolución de equipos — orden ${esc(_ordenId)}</div>
            <div style="font-size:12.5px;color:var(--fg-3,#6b7280);">${esc(_orden.cliente_nombre || '')} · ${esc(_orden.contrato?.contrato_id || '')} ${cerrada ? '· <b>CERRADA</b>' : ''}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="devCerrarModal"><i data-lucide="x"></i></button>
        </div>
        <div style="padding:14px 18px;overflow:auto;flex:1;">
          <datalist id="devModelosList">${(_modelos || []).map(m => `<option value="${esc(m.nombre)}"></option>`).join('')}</datalist>
          <p style="margin:0 0 10px;font-size:13px;color:var(--fg-2,#374151);">${intro}</p>
          ${progreso}
          ${bannerPendientes}
          ${bloquePegar}
          ${bloqueLote}
          ${secPorRecibir}
          ${secTanda}
          ${secAcuses}
          ${secOtras}
        </div>
        <div class="sheet-footer" style="display:flex;justify-content:space-between;gap:8px;padding:12px 18px;border-top:1px solid var(--border-subtle,#e5e7eb);">
          <span style="font-size:12px;color:var(--fg-3,#6b7280);align-self:center;">${cerrada
            ? `Orden cerrada.${Number(dev.cierre_pendientes || 0) ? ` <b style="color:#92400e;">Cerró con ${dev.cierre_pendientes} equipo(s) sin devolver.</b>` : ''}`
            : `${totalPend} equipo(s) pendiente(s) por devolver${sinAcuse.length ? ` · ${sinAcuse.length} sin acuse firmado` : ''}`}</span>
          ${(!cerrada && puedeOperar()) ? `<button type="button" class="btn btn-primary" id="devCerrarOrden" ${bloqueaCierre ? 'disabled title="Resuelve todas las unidades para cerrar"' : ''}><i data-lucide="check"></i> Cerrar devolución</button>` : ''}
        </div>
      </div>`;

    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.className = 'overlay';
      _overlay.style.display = 'flex';
      document.body.appendChild(_overlay);
      _overlay.addEventListener('click', (ev) => { if (ev.target === _overlay) cerrarModal(); });
    }
    _overlay.innerHTML = html;
    if (window.lucide) lucide.createIcons();

    _overlay.querySelector('#devCerrarModal')?.addEventListener('click', cerrarModal);
    _overlay.querySelector('#devCerrarOrden')?.addEventListener('click', cerrarOrden);
    // "Marcar recibido" abre el mini-checklist; la escritura ocurre al confirmar.
    _overlay.querySelectorAll('.dev-recibido').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      _cerrarCapturas();
      _recibiendoId = id;
      render();
    }));
    _overlay.querySelector('#devRecibidoConfirm')?.addEventListener('click', confirmarRecibido);
    _overlay.querySelector('#devRecibidoCancel')?.addEventListener('click', () => {
      _cerrarCapturas(); render();
    });
    // Corregir una unidad ya recibida (accesorios/daño), antes de la firma.
    _overlay.querySelectorAll('.dev-corregir').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      _cerrarCapturas();
      _editandoId = id;
      render();
    }));
    _overlay.querySelector('#devCorregirConfirm')?.addEventListener('click', confirmarCorreccion);
    _overlay.querySelector('#devCorregirCancel')?.addEventListener('click', () => {
      _cerrarCapturas(); render();
    });
    _wireChecklist();

    // Lote pegado: abrir la caja, procesar el texto, revisar y confirmar.
    _overlay.querySelector('#devPegarAbrir')?.addEventListener('click', abrirPegar);
    _overlay.querySelector('#devPegarCancelar')?.addEventListener('click', () => {
      _cerrarCapturas(); render();
    });
    _overlay.querySelector('#devPegarProcesar')?.addEventListener('click', procesarPegado);
    _overlay.querySelector('#devLoteCancel')?.addEventListener('click', () => {
      _cerrarCapturas(); render();
    });
    _overlay.querySelector('#devLoteConfirm')?.addEventListener('click', confirmarLote);
    _overlay.querySelectorAll('.dev-lote-quitar').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (!_draftLote || !(i >= 0)) return;
      _draftLote.splice(i, 1);
      if (!_draftLote.length) _draftLote = null;
      render();
    }));
    // El modelo corregido a mano manda sobre el del pool (y engancha modelo_id
    // si coincide con el catálogo). Sin re-render: perdería el foco al teclear.
    _overlay.querySelectorAll('.dev-lote-modelo').forEach(inp => inp.addEventListener('change', () => {
      const f = (_draftLote || [])[Number(inp.dataset.i)];
      if (!f) return;
      const txt = (inp.value || '').trim();
      const cat = (_modelos || []).find(m => m.nombre.toLowerCase() === txt.toLowerCase());
      f.modelo = cat ? cat.nombre : txt;
      f.modelo_id = cat ? cat.id : null;
      if (cat) inp.value = cat.nombre;
    }));
    // La caja recién abierta va lista para el Ctrl+V; la revisión del lote se
    // trae a la vista (el modal re-renderiza desde arriba).
    const foco = _overlay.querySelector('#devPegarSeriales');
    if (foco) requestAnimationFrame(() => foco.focus());
    const loteBox = _overlay.querySelector('#devLoteBox');
    if (loteBox) requestAnimationFrame(() => loteBox.scrollIntoView({ block: 'nearest' }));
    _overlay.querySelectorAll('.dev-nunca').forEach(b => b.addEventListener('click', () => resolver(b.dataset.id, 'nunca_salio')));
    _overlay.querySelectorAll('.dev-motivo').forEach(sel => sel.addEventListener('change', async () => {
      if (!sel.value) return;
      let detalle = '';
      if (sel.value === 'otro') {
        detalle = (window.Modal?.prompt
          ? await Modal.prompt({ title: 'Motivo de la excepción', message: 'Detalla por qué esta unidad no se devuelve.' })
          : window.prompt('Detalla por qué esta unidad no se devuelve:')) || '';
        if (!detalle.trim()) { sel.value = ''; return; }
      }
      resolver(sel.dataset.id, 'no_devuelve', sel.value, detalle.trim());
    }));
    _overlay.querySelectorAll('.dev-checkin-modelo').forEach(b => b.addEventListener('click', () => checkinPorModelo(Number(b.dataset.idx))));
    _overlay.querySelectorAll('.dev-checkin-libre').forEach(b => b.addEventListener('click', checkinLibre));
    _overlay.querySelector('#devTotalEsperado')?.addEventListener('change', (ev) => {
      guardarTotalEsperado(ev.target.value);
    });
    // Enter en el serial libre = Check-in (flujo de escáner de código de barras).
    _overlay.querySelector('#devSerialLibre')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); checkinLibre(); }
    });
    // SerialField: antes de recibir, el chip dice de quién es y dónde figura
    // el radio según el pool (clave cuando llegan radios revueltos de varios
    // clientes) — el check-in no se bloquea, solo se informa.
    //
    // Auditoría 2026-08-04 (R3): se adjuntaba SIN opciones, así que los chips
    // "⚠ otro cliente" y "modelo distinto" no podían dispararse nunca —
    // justo los dos avisos que este flujo necesita. Ahora se le pasa el cliente
    // de la orden, y se decoran TAMBIÉN los campos de check-in por modelo, que
    // no tenían ninguna señal del pool.
    if (typeof SerialField !== 'undefined' && typeof EquiposPoolService !== 'undefined') {
      const clienteId = () => _orden?.cliente_id || null;
      const inpLibre = _overlay.querySelector('#devSerialLibre');
      if (inpLibre) {
        const inpModeloLibre = _overlay.querySelector('#devModeloLibre');
        SerialField.adjuntar(inpLibre, {
          clienteId,
          modelo: () => ({ modelo_id: null, modelo_label: inpModeloLibre?.value || '' }),
        });
      }
      const porModeloDev = _orden?.devolucion?.esperados_por_modelo || [];
      _overlay.querySelectorAll('.dev-serial-modelo').forEach(inp => {
        const m = porModeloDev[Number(inp.dataset.idx)] || {};
        SerialField.adjuntar(inp, {
          clienteId,
          modelo: () => ({ modelo_id: m.modelo_id || null, modelo_label: m.modelo || '' }),
        });
      });
    }

    // Bloque de acuse: canvas + toggle sin-firma + guardar.
    const cbSin = _overlay.querySelector('#acuseSinFirma');
    if (cbSin) cbSin.addEventListener('change', () => {
      _overlay.querySelector('#acuseSinFirmaBloque')?.classList.toggle('hidden', !cbSin.checked);
      _overlay.querySelector('#acuseFirmaWrap')?.classList.toggle('hidden', cbSin.checked);
    });
    _overlay.querySelector('#acuseLimpiarFirma')?.addEventListener('click', () => {
      _firmaSnapshot = null;
      _firmaAcuse?.clear();
    });
    _overlay.querySelector('#acuseGuardarBtn')?.addEventListener('click', guardarAcuse);
    // Firma en tablet + envío de acuses + borradores del bloque de firma
    // (nombre/correo sobreviven a los re-renders de cada check-in).
    _overlay.querySelector('#acuseTabletBtn')?.addEventListener('click', enviarATablet);
    _overlay.querySelector('#acuseTabletCancelar')?.addEventListener('click', cancelarTablet);
    _overlay.querySelectorAll('.dev-acuse-ver').forEach(b =>
      b.addEventListener('click', () => abrirDocAcuse(Number(b.dataset.idx))));
    _overlay.querySelectorAll('.dev-acuse-enviar').forEach(b =>
      b.addEventListener('click', () => enviarAcuseCliente(Number(b.dataset.idx))));
    const inpAcuseNombre = _overlay.querySelector('#acuseNombre');
    inpAcuseNombre?.addEventListener('input', () => { _acuseNombreDraft = inpAcuseNombre.value; });
    const inpAcuseEmail = _overlay.querySelector('#acuseEmail');
    inpAcuseEmail?.addEventListener('input', () => { _acuseEmailDraft = inpAcuseEmail.value; });
    inpAcuseEmail?.addEventListener('change', _pushCopiaATablet);
    const cbCopia = _overlay.querySelector('#acuseEnviarCopia');
    cbCopia?.addEventListener('change', () => {
      _acuseEnviarCopia = !!cbCopia.checked;
      _pushCopiaATablet();
    });
    // El re-render descarta el canvas anterior: soltar sus listeners para no
    // dejar handlers de window colgando por cada check-in.
    _firmaAcuse?.destroy();
    _firmaAcuse = null;
    const cv = _overlay.querySelector('#acuseFirmaCanvas');
    // El canvas necesita clientWidth real → esperar al layout.
    if (cv) requestAnimationFrame(() => { _firmaAcuse = _montarFirma(cv); });
  }

  async function _guardarDevolucion(log) {
    const user = firebase.auth().currentUser;
    await OrdenesService.mergeOrder(_ordenId, {
      devolucion: _orden.devolucion,
      os_logs: firebase.firestore.FieldValue.arrayUnion({ action: log, by: user?.uid || '' }),
    });
  }

  // Confirmación del mini-checklist: única escritura del "recibido" (unidad
  // esperada o check-in por modelo), con accesorios y daño incluidos.
  async function confirmarRecibido() {
    const dev = _orden.devolucion;
    const user = firebase.auth().currentUser;
    const { accesorios, dano } = _leerChecklist();

    if (_draftModelo) {
      const m = (dev.esperados_por_modelo || [])[_draftModelo.idx];
      const nuevo = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        serial: _draftModelo.serial,
        modelo: _draftModelo.modelo || '',
        modelo_id: _draftModelo.modelo_id || null,
        pool_doc_id: null, // el backend resuelve por serial
        resolucion: 'recibido',
        accesorios,
        dano_visible: dano || null,
        motivo_codigo: null, motivo_detalle: null,
        resuelto_at: firebase.firestore.Timestamp.now(),
        resuelto_por: user?.uid || null,
      };
      dev.esperados = dev.esperados || [];
      dev.esperados.push(nuevo);
      if (m) m.recibidos = Number(m.recibidos || 0) + 1;
      try {
        await _guardarDevolucion('DEVOLUCION_CHECKIN');
        Toast.show(`${nuevo.serial}: recibido.`, 'ok');
        _draftModelo = null;
      } catch (err) {
        console.error(err);
        dev.esperados.pop();
        if (m) m.recibidos = Number(m.recibidos || 0) - 1;
        Toast.show('No se pudo registrar el check-in.', 'bad');
      }
      render();
      return;
    }

    const e = (dev.esperados || []).find(x => x.id === _recibiendoId);
    _recibiendoId = null;
    if (!e || e.resolucion) { render(); return; }
    e.resolucion = 'recibido';
    e.accesorios = accesorios;
    e.dano_visible = dano || null;
    e.motivo_codigo = null;
    e.motivo_detalle = null;
    e.resuelto_at = firebase.firestore.Timestamp.now();
    e.resuelto_por = user?.uid || null;
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN');
      Toast.show(`${e.serial}: recibido.`, 'ok');
    } catch (err) {
      console.error(err);
      e.resolucion = null; e.accesorios = null; e.dano_visible = null; e.resuelto_at = null; e.resuelto_por = null;
      Toast.show('No se pudo registrar el check-in.', 'bad');
    }
    render();
  }

  // Corrección de accesorios/daño de una unidad ya recibida (pedido de
  // recepción 2026-07-29: se marcó "Todos" y uno de los cargadores venía sin
  // cable). NO toca el serial ni la resolución — el equipo ya se movió en el
  // inventario y ya entró a la ENTRADA. La ventana se cierra con la firma del
  // acuse: `puedeCorregir` lo decide y aquí se vuelve a verificar, porque el
  // acuse puede haberse firmado en otra pestaña mientras el checklist estaba
  // abierto.
  async function confirmarCorreccion() {
    const dev = _orden.devolucion;
    const e = (dev.esperados || []).find(x => x.id === _editandoId);
    _editandoId = null;
    if (!e) { render(); return; }
    if (!puedeCorregir(e, true)) {
      Toast.show('Esta unidad ya tiene acuse firmado: la corrección va en la orden de ENTRADA.', 'bad');
      render();
      return;
    }
    const { accesorios, dano } = _leerChecklist();
    const antes = { accesorios: e.accesorios || null, dano_visible: e.dano_visible || null };
    const user = firebase.auth().currentUser;
    e.accesorios = accesorios;
    e.dano_visible = dano || null;
    e.corregido_at = firebase.firestore.Timestamp.now();
    e.corregido_por = user?.uid || null;
    try {
      await _guardarDevolucion('DEVOLUCION_CORRIGE_RECIBIDO');
      Toast.show(`${e.serial}: corregido.`, 'ok');
    } catch (err) {
      console.error(err);
      e.accesorios = antes.accesorios;
      e.dano_visible = antes.dano_visible;
      delete e.corregido_at;
      delete e.corregido_por;
      Toast.show('No se pudo guardar la corrección.', 'bad');
    }
    render();
  }

  // Cuántos equipos debe devolver el cliente según el contrato de PAPEL. Es
  // el único ancla de "cuántos faltan" en el modo sin_contrato: sin él nadie
  // —ni la lista de órdenes ni el recordatorio diario— puede saber que
  // quedaron radios afuera. Se puede corregir mientras la orden esté abierta.
  async function guardarTotalEsperado(valor) {
    const n = Math.max(0, Math.min(999, Math.floor(Number(valor) || 0)));
    const dev = _orden.devolucion;
    const previo = Number(dev.total_esperado || 0);
    if (n === previo) return;
    const recibidos = (dev.esperados || []).filter(e => e.resolucion === 'recibido').length;
    if (n > 0 && n < recibidos) {
      Toast.show(`Ya se registraron ${recibidos} equipos: el total no puede ser menor.`, 'bad');
      render();
      return;
    }
    dev.total_esperado = n;
    try {
      await _guardarDevolucion('DEVOLUCION_TOTAL_ESPERADO');
    } catch (err) {
      console.error(err);
      dev.total_esperado = previo;
      Toast.show('No se pudo guardar la cantidad esperada.', 'bad');
    }
    render();
  }

  // nunca_salio / no_devuelve — sin checklist (no entra nada al taller).
  async function resolver(esperadoId, resolucion, motivoCodigo, motivoDetalle) {
    const e = (_orden.devolucion.esperados || []).find(x => x.id === esperadoId);
    if (!e || e.resolucion) return;
    const labels = { nunca_salio: 'NUNCA SALIÓ del taller', no_devuelve: 'NO SE DEVUELVE' };
    if (!window.confirm(`${e.serial} → ${labels[resolucion]}. Esta acción mueve el equipo en el inventario y no se deshace desde aquí. ¿Confirmar?`)) { render(); return; }
    const user = firebase.auth().currentUser;
    e.resolucion = resolucion;
    e.motivo_codigo = motivoCodigo || null;
    e.motivo_detalle = motivoDetalle || null;
    e.resuelto_at = firebase.firestore.Timestamp.now();
    e.resuelto_por = user?.uid || null;
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN');
      Toast.show(`${e.serial}: ${labels[resolucion].toLowerCase()}.`, 'ok');
    } catch (err) {
      console.error(err);
      e.resolucion = null; e.motivo_codigo = null; e.motivo_detalle = null; e.resuelto_at = null; e.resuelto_por = null;
      Toast.show('No se pudo registrar el check-in.', 'bad');
    }
    render();
  }

  function checkinPorModelo(idx) {
    const m = (_orden.devolucion.esperados_por_modelo || [])[idx];
    const input = _overlay.querySelector(`.dev-serial-modelo[data-idx="${idx}"]`);
    const serial = (input?.value || '').trim().toUpperCase();
    if (!m || !serial) { Toast.show('Escribe o escanea el serial recibido.', 'warn'); return; }
    if ((_orden.devolucion.esperados || []).some(e => (e.serial || '').toUpperCase() === serial)) {
      Toast.show('Ese serial ya está registrado en esta orden.', 'warn'); return;
    }
    // El registro se escribe al confirmar el mini-checklist (una sola
    // escritura con accesorios + daño incluidos).
    _cerrarCapturas();
    _draftModelo = { idx, serial, modelo: m.modelo || '', modelo_id: m.modelo_id || null };
    render();
  }

  // Captura libre (modo sin_contrato): serial + modelo sin lista previa de
  // esperados. Si el modelo coincide con el catálogo, la unidad viaja con
  // modelo_id (mejor identidad en el pool); texto libre también vale.
  function checkinLibre() {
    const serial = (_overlay.querySelector('#devSerialLibre')?.value || '').trim().toUpperCase();
    const modeloTxt = (_overlay.querySelector('#devModeloLibre')?.value || '').trim();
    if (!serial) { Toast.show('Escribe o escanea el serial recibido.', 'warn'); return; }
    if ((_orden.devolucion.esperados || []).some(e => (e.serial || '').toUpperCase() === serial)) {
      Toast.show('Ese serial ya está registrado en esta orden.', 'warn'); return;
    }
    const cat = (_modelos || []).find(m => m.nombre.toLowerCase() === modeloTxt.toLowerCase());
    _cerrarCapturas();
    _draftModelo = { idx: null, serial, modelo: cat ? cat.nombre : modeloTxt, modelo_id: cat ? cat.id : null };
    render();
  }

  // ── Lote pegado ────────────────────────────────────────────────────────
  // Recepción copia los seriales del POC ("Copiar seriales", uno por línea) y
  // los pega aquí. El pool resuelve el modelo de cada uno y el operador ve, en
  // una sola pantalla, cuáles no cuadran — antes esto era teclear serial por
  // serial y el desajuste (radio de otro cliente) solo se veía después.

  async function abrirPegar() {
    // El datalist de modelos hace falta para corregir a mano lo que el pool no
    // sepa; en modo con contrato aún no se había cargado.
    if (!_modelos) {
      try {
        _modelos = (typeof ModelosService !== 'undefined')
          ? (await ModelosService.getModelos())
              .map(m => ({ id: m.id, nombre: (m.modelo || m.nombre || '').trim(),
                           precio_venta: Number(m.precio_venta) || 0 }))
              .filter(m => m.nombre)
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
          : [];
      } catch (e) { _modelos = []; }
    }
    _cerrarCapturas();
    _pegarAbierto = true;
    render();
  }

  // Fichas del pool de un puñado de seriales, en chunks de 10 (tope del `in`
  // de Firestore). Devuelve norm → [docs] ([] si el serial nunca entró).
  async function _fichasDelPool(norms) {
    const mapa = new Map();
    if (!norms.length || typeof EquiposPoolService === 'undefined') return mapa;
    const db = firebase.firestore();
    const chunks = [];
    for (let i = 0; i < norms.length; i += 10) chunks.push(norms.slice(i, i + 10));
    const snaps = await Promise.all(chunks.map(c =>
      db.collection('equipos_pool').where('serial_norm', 'in', c).get()));
    snaps.forEach(s => s.docs.forEach(d => {
      const u = { id: d.id, ...d.data() };
      const arr = mapa.get(u.serial_norm) || [];
      arr.push(u);
      mapa.set(u.serial_norm, arr);
    }));
    return mapa;
  }

  // Decide a dónde va cada serial pegado y con qué avisos. Destinos:
  //   esperado   → la unidad ya figura en la devolución, pendiente
  //   nuevo      → captura libre (contrato de papel)
  //   por_modelo → cubre un faltante del bloque "por modelo"
  //   duplicado / ajeno / invalido → fuera del lote, con el motivo a la vista
  function _clasificarLote(tokens, fichas) {
    const dev = _orden.devolucion || {};
    const esperados = dev.esperados || [];
    const esSinContrato = dev.modo === 'sin_contrato';
    const clienteOrden = _orden.cliente_id || '';
    // Copia de los faltantes por modelo: se van consumiendo al asignar filas.
    const cupos = (dev.esperados_por_modelo || []).map((m, i) => ({
      i, m, falta: Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)),
    }));
    const vistos = new Set();

    return tokens.map((token) => {
      const serial = token.trim().toUpperCase();
      const norm = EquiposPoolService.normalizarSerial(serial);
      const docs = fichas.get(norm) || [];
      const unidad = docs.length === 1 ? docs[0] : null;
      const f = {
        serial, norm, modelo: '', modelo_id: null,
        destino: null, esperado_id: null, idx_modelo: null,
        incluir: false, avisos: [],
      };
      const aviso = (txt, css, title) => f.avisos.push(
        `<span class="eqpool-chip" style="${css}"${title ? ` title="${esc(title)}"` : ''}>${esc(txt)}</span>`);

      if (!EquiposPoolService.esSerialValido(norm)) {
        f.destino = 'invalido';
        aviso('no parece un serial', 'background:#fee2e2;color:#b91c1c;',
          'Un serial lleva de 3 a 30 caracteres y al menos un número. Revisa si se coló una línea de texto al copiar.');
        return f;
      }
      if (vistos.has(norm)) {
        f.destino = 'duplicado';
        aviso('repetido en la lista', 'background:#fef3c7;color:#92400e;');
        return f;
      }
      vistos.add(norm);

      const ya = esperados.find(e => EquiposPoolService.normalizarSerial(e.serial) === norm);
      if (ya && ya.resolucion) {
        f.destino = 'duplicado';
        f.modelo = ya.modelo || '';
        aviso(`ya registrado: ${RES_TEXTO[ya.resolucion] || ya.resolucion}`, 'background:#fef3c7;color:#92400e;',
          'Esta unidad ya se resolvió en esta devolución — el lote no la vuelve a tocar.');
        return f;
      }
      if (ya) {
        f.destino = 'esperado';
        f.incluir = true;
        f.esperado_id = ya.id;
        f.modelo = ya.modelo || unidad?.modelo_label || '';
        f.modelo_id = ya.modelo_id || unidad?.modelo_id || null;
      } else if (esSinContrato) {
        f.destino = 'nuevo';
        f.incluir = true;
        f.modelo = unidad?.modelo_label || '';
        f.modelo_id = unidad?.modelo_id || null;
      } else {
        // Con contrato la lista esperada manda: un serial que no figura no se
        // mete solo (movería el pool de otro contrato). Salvo que haya cupo
        // por modelo, que es justo el caso "la baja no registró seriales".
        const conCupo = cupos.filter(c => c.falta > 0);
        const cupo = (unidad && conCupo.find(c => EquiposPoolService._mismoModelo(unidad, c.m.modelo_id || null, c.m.modelo || '')))
          || (!unidad && conCupo.length === 1 ? conCupo[0] : null);
        if (cupo) {
          cupo.falta--;
          f.destino = 'por_modelo';
          f.incluir = true;
          f.idx_modelo = cupo.i;
          f.modelo = unidad?.modelo_label || cupo.m.modelo || '';
          f.modelo_id = unidad?.modelo_id || cupo.m.modelo_id || null;
        } else {
          f.destino = 'ajeno';
          f.modelo = unidad?.modelo_label || '';
          aviso('no figura en esta devolución', 'background:#fee2e2;color:#b91c1c;',
            conCupo.length
              ? 'No coincide con ninguna unidad esperada ni con un modelo que falte. Regístralo por el check-in de su modelo si corresponde.'
              : 'Esta devolución solo cubre las unidades listadas. Si el cliente trajo un radio de otro contrato, regístralo en la devolución que corresponda.');
        }
      }

      // Avisos del pool — informativos: el check-in no se bloquea por ellos.
      if (!docs.length) {
        aviso('sin registro en el inventario', 'background:transparent;border:1px dashed var(--border,#cbd5e1);color:var(--fg-3,#64748b);',
          'El serial no existe en Equipos por serial: se dará de alta al confirmar. Verifica que esté bien escrito.');
      } else if (docs.length > 1) {
        aviso(`⚠ ${docs.length} fichas con este serial`, 'background:#fee2e2;color:#b91c1c;',
          'El serial existe en más de una ficha (modelos en conflicto). Confirma el modelo correcto antes de recibirlo.');
      } else {
        f.avisos.push(EquiposPoolService.chipEstadoHtml(unidad.estado));
        const dueno = unidad.asignacion?.cliente_id || '';
        if (dueno && clienteOrden && dueno !== clienteOrden) {
          aviso(`⚠ es de ${unidad.asignacion?.cliente_nombre || 'otro cliente'}`, 'background:#fef3c7;color:#92400e;',
            'En el inventario esta unidad figura asignada a otro cliente — verifica el serial antes de confirmar.');
        }
      }
      return f;
    });
  }

  const MAX_LOTE = 300;

  async function procesarPegado() {
    const texto = _overlay.querySelector('#devPegarSeriales')?.value || '';
    const tokens = texto.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!tokens.length) { Toast.show('Pega al menos un serial.', 'warn'); return; }
    if (tokens.length > MAX_LOTE) {
      Toast.show(`Son ${tokens.length} seriales: pega máximo ${MAX_LOTE} por tanda.`, 'bad');
      return;
    }
    const btn = _overlay.querySelector('#devPegarProcesar');
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando en el inventario…'; }
    try {
      const norms = [...new Set(tokens
        .map(t => EquiposPoolService.normalizarSerial(t))
        .filter(n => EquiposPoolService.esSerialValido(n)))];
      const fichas = await _fichasDelPool(norms);
      const filas = _clasificarLote(tokens, fichas);
      _cerrarCapturas();
      _draftLote = filas;
      const listos = filas.filter(f => f.incluir).length;
      Toast.show(listos === filas.length
        ? `${listos} serial(es) listos para recibir — revisa y confirma.`
        : `${listos} de ${filas.length} listos: revisa los avisos.`, listos ? 'ok' : 'warn');
    } catch (err) {
      console.error('[OrdenesDevolucion.procesarPegado]', err);
      Toast.show('No se pudo consultar el inventario. Reintenta.', 'bad');
      if (btn) { btn.disabled = false; btn.textContent = 'Revisar seriales'; }
      return;
    }
    render();
  }

  // Confirmación del lote: UNA sola escritura con todas las unidades. El
  // trigger de devolución las procesa como una tanda (una ENTRADA, un correo)
  // y el acuse posterior las cubre a todas con una firma.
  async function confirmarLote() {
    const filas = (_draftLote || []).filter(f => f.incluir);
    if (!filas.length) return;
    // Sin modelo la unidad nace en el pool sin identidad y hay que arreglarla
    // después a mano. En una unidad sola se nota; en un lote de 10 se pasa por
    // alto, así que aquí se pregunta antes de escribir.
    const sinModelo = filas.filter(f => !(f.modelo || '').trim()).map(f => f.serial);
    if (sinModelo.length && !window.confirm(
      `${sinModelo.length} unidad(es) van SIN modelo: ${sinModelo.slice(0, 8).join(', ')}` +
      `${sinModelo.length > 8 ? `, +${sinModelo.length - 8} más` : ''}.\n\n` +
      'Quedarán en el inventario sin modelo y habrá que corregirlas a mano. ¿Continuar así?')) {
      return;
    }
    const { accesorios, dano } = _leerChecklist();
    const dev = _orden.devolucion;
    const user = firebase.auth().currentUser;
    const ts = firebase.firestore.Timestamp.now();
    dev.esperados = dev.esperados || [];

    let aplicadas = 0;
    for (const f of filas) {
      if (f.destino === 'esperado') {
        const e = dev.esperados.find(x => x.id === f.esperado_id);
        if (!e || e.resolucion) continue; // resuelto por otra vía mientras revisaba
        e.resolucion = 'recibido';
        e.accesorios = { ...accesorios };
        e.dano_visible = dano || null;
        e.motivo_codigo = null;
        e.motivo_detalle = null;
        e.resuelto_at = ts;
        e.resuelto_por = user?.uid || null;
      } else {
        dev.esperados.push({
          id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${aplicadas}`),
          serial: f.serial,
          modelo: f.modelo || '',
          modelo_id: f.modelo_id || null,
          pool_doc_id: null, // el backend resuelve por serial
          resolucion: 'recibido',
          accesorios: { ...accesorios },
          dano_visible: dano || null,
          motivo_codigo: null, motivo_detalle: null,
          resuelto_at: ts,
          resuelto_por: user?.uid || null,
        });
        if (f.destino === 'por_modelo') {
          const m = (dev.esperados_por_modelo || [])[f.idx_modelo];
          if (m) m.recibidos = Number(m.recibidos || 0) + 1;
        }
      }
      aplicadas++;
    }

    const btn = _overlay.querySelector('#devLoteConfirm');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN_LOTE');
      Toast.show(`${aplicadas} equipo${aplicadas === 1 ? '' : 's'} recibido${aplicadas === 1 ? '' : 's'} — falta el acuse firmado.`, 'ok');
      _draftLote = null;
    } catch (err) {
      console.error('[OrdenesDevolucion.confirmarLote]', err);
      Toast.show('No se pudo registrar el lote — no se guardó nada.', 'bad');
      // Deshacer a mano N filas es frágil: la orden en Firestore es la verdad.
      try { _orden = await OrdenesService.getOrder(_ordenId); } catch (e) { /* se queda con la copia local */ }
    }
    render();
  }

  // ── Acuse formal por tanda ─────────────────────────────────────────────
  // _persistirAcuse es el ÚNICO camino que agrega devolucion.acuses[]: lo
  // usan la firma en mostrador (guardarAcuse) y la firma en tablet
  // (_acuseDesdeTablet). Asigna el número correlativo ({ordenId}-A{n}),
  // estampa acuse_id en cada unidad cubierta y — si se pidió — deja el envío
  // en 'solicitado' para que onOrdenDevolucionWrite encole la copia al
  // cliente. El backend copia el primer acuse a la ENTRADA como su recepción.
  const _esEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  function _emailCopia() {
    return String((_acuseEmailDraft != null ? _acuseEmailDraft : _emailCliente) || '').trim().toLowerCase();
  }

  // La tablet de firmas vive EN EL MOSTRADOR: en un teléfono o pantalla
  // táctil (vendedor en la calle) el botón no se pinta — parecería el acceso
  // para firmar en el propio dispositivo, y ahí el canvas del modal ya
  // cumple. Mismo corte que .btn-firma-tablet en ordenes-index.css.
  function _tabletMostradorDisponible() {
    try {
      return !window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
    } catch (e) { return true; }
  }

  async function _persistirAcuse({ nombre, cedula, firmaUrl, sin, motivo, via, solicitudId, laxEmail }) {
    const dev = _orden.devolucion;
    const pendientes = (dev.esperados || []).filter(e => e.resolucion === 'recibido' && !e.acuse_id);
    if (!pendientes.length) return false;
    const user = firebase.auth().currentUser;
    const email = _emailCopia();
    let enviar = _acuseEnviarCopia && !!email;
    if (_acuseEnviarCopia && email && !_esEmail(email)) {
      // Desde la tablet no hay nadie frente a la PC para corregir el correo:
      // el acuse se guarda igual (sin enviar) y el envío queda para después.
      if (laxEmail) enviar = false;
      else { Toast.show('Escribe un correo válido o desmarca "Enviar copia al cliente".', 'bad'); return false; }
    }

    const acuse = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      numero: `${_ordenId}-A${(dev.acuses || []).length + 1}`,
      at: firebase.firestore.Timestamp.now(),
      por_uid: user?.uid || null,
      nombre_entrega: sin ? null : (nombre || null),
      // Cédula de quien entrega — hoy solo la captura la firma en tablet.
      cedula_entrega: sin ? null : (cedula || null),
      firma_url: firmaUrl || null,
      sin_firma: !!sin,
      sin_firma_motivo: sin ? (motivo || '') : null,
      via: via || 'mostrador',
      solicitud_id: solicitudId || null,
      seriales: pendientes.map(e => e.serial),
      unidades: pendientes.map(e => ({
        serial: e.serial,
        modelo: e.modelo || '',
        accesorios: e.accesorios || null,
        dano_visible: e.dano_visible || null,
      })),
      envio: enviar
        ? { status: 'solicitado', to: email,
            solicitado_at: firebase.firestore.Timestamp.now(),
            solicitado_por: user?.uid || null }
        : { status: 'sin_enviar', to: email || null },
    };
    dev.acuses = [...(dev.acuses || []), acuse];
    pendientes.forEach(e => { e.acuse_id = acuse.id; });
    // La corrección de una unidad se abre en este mismo modal, arriba del
    // bloque de firma: si el cliente firmó mientras estaba abierta, esa
    // unidad ya no se corrige y el formulario tiene que cerrarse solo.
    _editandoId = null;
    try {
      await _guardarDevolucion('DEVOLUCION_ACUSE');
    } catch (err) {
      dev.acuses = dev.acuses.filter(a => a.id !== acuse.id);
      pendientes.forEach(e => { delete e.acuse_id; });
      throw err;
    }
    // La firma ya quedó archivada en este acuse: el lienzo arranca limpio
    // para la siguiente tanda (si no, render() la restauraría).
    _firmaSnapshot = null;
    _firmaAcuse?.clear();
    _acuseNombreDraft = '';
    Toast.show(enviar
      ? `Acuse ${acuse.numero} guardado — la copia va en camino a ${email}.`
      : `Acuse ${acuse.numero} guardado.`, 'ok');
    _guardarEmailCliente(email); // corrección de vuelta a la ficha (best-effort)
    return true;
  }

  // Firma en el mostrador (canvas de este modal): sube la firma y persiste.
  async function guardarAcuse() {
    const dev = _orden.devolucion;
    const pendientes = (dev.esperados || []).filter(e => e.resolucion === 'recibido' && !e.acuse_id);
    if (!pendientes.length) return;

    const sin = !!_overlay.querySelector('#acuseSinFirma')?.checked;
    const nombre = (_overlay.querySelector('#acuseNombre')?.value || '').trim();
    const motivo = (_overlay.querySelector('#acuseSinFirmaMotivo')?.value || '').trim();
    if (sin) {
      if (!motivo) { Toast.show('Indica el motivo para registrar sin firma.', 'bad'); return; }
    } else {
      if (!nombre) { Toast.show('Ingresa el nombre de quien entrega.', 'bad'); return; }
      if (!_firmaAcuse || _firmaAcuse.isEmpty()) { Toast.show('La firma es obligatoria (o marca "Registrar sin firma").', 'bad'); return; }
    }

    const btn = _overlay.querySelector('#acuseGuardarBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      let firmaUrl = null;
      if (!sin) {
        const blob = await _firmaAcuse.toBlob();
        if (!blob) throw new Error('La firma quedó vacía al guardar.');
        const path = `ordenes_firmas/${_ordenId}_acuse_${Date.now()}.png`;
        const ref = firebase.storage().ref(path);
        await ref.put(blob, { contentType: 'image/png' });
        firmaUrl = await ref.getDownloadURL();
      }
      await _persistirAcuse({ nombre, firmaUrl, sin, motivo, via: 'mostrador' });
    } catch (err) {
      console.error(err);
      Toast.show('No se pudo guardar el acuse.', 'bad');
    }
    render();
  }

  // ── Firma en tablet (firmas_tablet + /firmar/tablet.html) ──────────────
  // "Firmar en la tablet" crea una solicitud que la tablet del mostrador
  // muestra en vivo; cuando el cliente confirma allá, el onSnapshot de aquí
  // guarda el acuse con esa firma. La solicitud sobrevive a cerrar el modal
  // (abrir() la retoma) y recepción puede cancelarla en cualquier momento.
  async function enviarATablet() {
    const dev = _orden.devolucion || {};
    const sinAcuse = (dev.esperados || []).filter(e => e.resolucion === 'recibido' && !e.acuse_id);
    if (!sinAcuse.length || _solTabletId) return;
    if (!_tabletMostradorDisponible()) {
      Toast.show('La firma en tablet es de la tablet del mostrador de recepción — en este dispositivo el cliente firma en el recuadro de aquí mismo.', 'warn');
      return;
    }
    const user = firebase.auth().currentUser;
    try {
      const ref = await firebase.firestore().collection('firmas_tablet').add({
        tipo: 'acuse_devolucion',
        estado: 'pendiente',
        orden_id: _ordenId,
        cliente_nombre: _orden.cliente_nombre || '',
        contrato_id: dev.origen?.ref_papel || _orden.contrato?.contrato_id || null,
        numero: `${_ordenId}-A${(dev.acuses || []).length + 1}`,
        unidades: sinAcuse.map(e => ({
          serial: e.serial, modelo: e.modelo || '',
          accesorios: e.accesorios || null, dano_visible: e.dano_visible || null,
        })),
        // La tablet le muestra al cliente a qué correo llegará su copia (y él
        // mismo avisa si está mal ANTES de firmar). Es informativo: el envío
        // real lo decide _persistirAcuse con el estado vigente del checkbox.
        copia_a: (_acuseEnviarCopia && _esEmail(_emailCopia())) ? _emailCopia() : null,
        creado_at: firebase.firestore.FieldValue.serverTimestamp(),
        creado_por_uid: user?.uid || null,
        creado_por_email: user?.email || null,
      });
      _solTabletId = ref.id;
      _suscribirTablet();
      Toast.show('Solicitud enviada — ya aparece en la tablet del mostrador.', 'ok');
    } catch (e) {
      console.error('[OrdenesDevolucion.enviarATablet]', e);
      Toast.show('No se pudo enviar la solicitud a la tablet.', 'bad');
    }
    render();
  }

  function _suscribirTablet() {
    _unsubTablet?.();
    if (!_solTabletId) return;
    _unsubTablet = firebase.firestore().collection('firmas_tablet').doc(_solTabletId)
      .onSnapshot((s) => {
        const d = s.exists ? s.data() : null;
        if (!d) return;
        if (d.estado === 'firmada') {
          _acuseDesdeTablet(s.id, d);
        } else if (d.estado === 'cancelada') {
          _unsubTablet?.(); _unsubTablet = null; _solTabletId = null;
          if (_overlay) render();
        }
      });
  }

  // Corrección del correo con la tablet en la mano del cliente: el destino de
  // la copia (copia_a) se actualiza en la solicitud pendiente y la tablet lo
  // repinta en vivo. Best-effort e informativo — el envío real lo decide
  // _persistirAcuse con el estado vigente del checkbox y el campo.
  function _pushCopiaATablet() {
    if (!_solTabletId) return;
    const email = _emailCopia();
    firebase.firestore().collection('firmas_tablet').doc(_solTabletId)
      .update({ copia_a: (_acuseEnviarCopia && _esEmail(email)) ? email : null })
      .catch(() => { /* solicitud ya firmada/cancelada: el dato ya no importa */ });
  }

  async function cancelarTablet() {
    if (!_solTabletId) return;
    try {
      await firebase.firestore().collection('firmas_tablet').doc(_solTabletId)
        .update({ estado: 'cancelada' }); // el snapshot hace la limpieza
    } catch (e) {
      // Carrera benigna: la tablet firmó justo al cancelar — el snapshot
      // entregará la firma de todos modos.
      console.warn('[OrdenesDevolucion.cancelarTablet]', e);
    }
  }

  // La tablet firmó: guarda el acuse UNA vez con la firma que subió la
  // tablet (Storage) y el nombre que tecleó el cliente allá.
  async function _acuseDesdeTablet(solId, sol) {
    if (_tabletGuardando || !_orden?.devolucion) return;
    if ((_orden.devolucion.acuses || []).some(a => a.solicitud_id === solId)) {
      _unsubTablet?.(); _unsubTablet = null; _solTabletId = null;
      return; // ya se aplicó (otra pestaña / doble snapshot)
    }
    _tabletGuardando = true;
    try {
      await _persistirAcuse({
        nombre: sol.firma?.nombre || '',
        cedula: sol.firma?.cedula || '',
        firmaUrl: sol.firma?.url || null,
        sin: false, motivo: '',
        via: 'tablet', solicitudId: solId,
        laxEmail: true,
      });
      _unsubTablet?.(); _unsubTablet = null; _solTabletId = null;
    } catch (e) {
      console.error('[OrdenesDevolucion._acuseDesdeTablet]', e);
      Toast.show('La tablet firmó pero no se pudo guardar el acuse — cierra y reabre la devolución para reintentar.', 'bad');
    } finally {
      _tabletGuardando = false;
    }
    if (_overlay) render();
  }

  // ── Documento del acuse (ver / imprimir) ───────────────────────────────
  // El documento formal se renderiza en el navegador, en una pestaña nueva
  // lista para Ctrl+P — sin PDF ni servidor. El CONTENIDO espeja el correo
  // que arma functions/src/lib/acuseDevolucion.js: si cambias columnas o la
  // leyenda aquí, cámbialas también allá.
  function _docAcuseHtml(a, idx) {
    const dev = _orden.devolucion || {};
    const numero = a.numero || `${_ordenId}-A${idx + 1}`;
    const unidades = (a.unidades && a.unidades.length)
      ? a.unidades : (a.seriales || []).map(s => ({ serial: s }));
    const fecha = a.at?.toDate
      ? a.at.toDate().toLocaleString('es-PA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    const contratoId = dev.origen?.ref_papel || _orden.contrato?.contrato_id || null;
    const filasDoc = unidades.map(u => `
      <tr>
        <td class="mono">${esc(u.serial || '—')}</td>
        <td>${esc(u.modelo || '—')}</td>
        <td>${esc(_accResumen(u.accesorios))}</td>
        <td>${esc(u.dano_visible || '—')}</td>
      </tr>`).join('');
    const firmaBloque = a.sin_firma
      ? `<span class="sinfirma">Registrado sin firma — ${esc(a.sin_firma_motivo || '')}</span>`
      : (a.firma_url ? `<img src="${esc(a.firma_url)}" alt="Firma de ${esc(a.nombre_entrega || '')}">` : '');
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Acuse ${esc(numero)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; }
        body { background: #e8e6e0; font: 14px/1.55 'Source Serif 4', Georgia, 'Times New Roman', serif; color: #26221C; }
        .toolbar { display: flex; gap: 10px; align-items: center; justify-content: flex-end; max-width: 780px; margin: 0 auto; padding: 12px 16px 0; font-family: 'Segoe UI', Arial, sans-serif; }
        .toolbar button { font: 600 13.5px 'Segoe UI', Arial, sans-serif; border: 0; border-radius: 8px; cursor: pointer; padding: 9px 16px; background: #0B2A47; color: #fff; }
        .hoja { background: #FDFCF8; max-width: 780px; margin: 12px auto 40px; padding: 44px 52px; box-shadow: 0 8px 30px rgba(20,20,30,.18); }
        .memb { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; border-bottom: 2px solid #26221C; padding-bottom: 14px; flex-wrap: wrap; }
        .memb img { height: 42px; }
        .memb .datos-emp { font: 10.5px/1.5 'Segoe UI', Arial, sans-serif; color: #5C554A; margin-top: 4px; }
        .docnum { text-align: right; font-size: 12.5px; color: #5C554A; }
        .docnum b { display: block; font-family: Consolas, monospace; font-size: 14px; color: #26221C; }
        h1 { font-size: 18px; text-align: center; margin: 26px 0 4px; letter-spacing: .02em; }
        .subt { text-align: center; font-size: 12.5px; color: #5C554A; margin-bottom: 22px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 28px; font-size: 13px; margin-bottom: 20px; }
        .grid .lbl { display: block; font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #5C554A; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .07em; text-transform: uppercase; color: #5C554A; text-align: left; padding: 6px 10px; border-bottom: 1.5px solid #26221C; }
        td { padding: 8px 10px; border-bottom: 1px solid #E4DFD2; vertical-align: top; }
        td.mono { font-family: Consolas, monospace; font-size: 12px; white-space: nowrap; }
        .legal { font-size: 11.5px; color: #5C554A; border-left: 2px solid #E4DFD2; padding-left: 14px; margin: 18px 0 34px; font-style: italic; }
        .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .f-col { text-align: center; font-size: 12px; }
        .f-line { border-bottom: 1px solid #26221C; min-height: 58px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 6px; }
        .f-line img { max-height: 56px; max-width: 100%; }
        .f-name { font-weight: 600; }
        .f-role { font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #5C554A; }
        .sinfirma { font-size: 11px; color: #5C554A; padding-bottom: 8px; }
        .pie { margin-top: 34px; padding-top: 10px; border-top: 1px solid #E4DFD2; font: 10.5px 'Segoe UI', Arial, sans-serif; color: #5C554A; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        @media print { body { background: #fff; } .toolbar { display: none; } .hoja { box-shadow: none; margin: 0; max-width: none; padding: 6mm 4mm; } }
      </style></head>
      <body>
        <div class="toolbar"><button onclick="window.print()">🖨 Imprimir</button></div>
        <div class="hoja">
          <div class="memb">
            <div>
              <img src="${location.origin}/brand/logo-lockup-horizontal.svg" alt="C Comunica">
              <div class="datos-emp">C COMUNICA, S.A. · RUC 32977-27-249966 DV 39 · Panamá<br>ventas@cecomunica.com · +507 279-5570</div>
            </div>
            <div class="docnum">Acuse N.º <b>${esc(numero)}</b>${esc(fecha)}</div>
          </div>
          <h1>Acuse de recibo de equipos</h1>
          <p class="subt">Constancia de entrega física en devolución — previa a la inspección técnica</p>
          <div class="grid">
            <div><span class="lbl">Cliente</span><b>${esc(_orden.cliente_nombre || '—')}</b></div>
            <div><span class="lbl">Contrato</span><b>${esc(contratoId || '—')}</b></div>
            <div><span class="lbl">Orden de devolución</span><b>${esc(_ordenId)}</b></div>
            <div><span class="lbl">Recibido en</span><b>Mostrador — recepción</b></div>
          </div>
          <table>
            <thead><tr><th>Serial</th><th>Modelo</th><th>Accesorios entregados</th><th>Daño visible</th></tr></thead>
            <tbody>${filasDoc}</tbody>
          </table>
          <p class="legal">Los equipos listados ingresan al taller para su revisión técnica. Cualquier daño
            identificado como causado por mal uso, así como los accesorios o equipos no devueltos, serán
            notificados oportunamente mediante cotización para su posterior facturación. Este acuse deja
            constancia de la entrega física; no constituye la inspección técnica final.</p>
          <div class="firmas">
            <div class="f-col">
              <div class="f-line">${firmaBloque}</div>
              <div class="f-name">${esc(a.nombre_entrega || (a.sin_firma ? '—' : ''))}</div>
              ${a.cedula_entrega ? `<div style="font-size:11.5px;color:#5C554A;">Cédula ${esc(a.cedula_entrega)}</div>` : ''}
              <div class="f-role">Entrega — por el cliente</div>
            </div>
            <div class="f-col">
              <div class="f-line"></div>
              <div class="f-name">Recepción C Comunica</div>
              <div class="f-role">Recibe — ${esc(fecha)}</div>
            </div>
          </div>
          <div class="pie">
            <span>Generado por el sistema de órdenes de servicio</span>
            <span>${unidades.length} unidad(es) · ${esc(numero)}</span>
          </div>
        </div>
      </body></html>`;
  }

  function abrirDocAcuse(idx) {
    const a = (_orden.devolucion?.acuses || [])[idx];
    if (!a) return;
    const w = window.open('', '_blank');
    if (!w) { Toast.show('El navegador bloqueó la pestaña del documento — permite ventanas emergentes.', 'bad'); return; }
    w.document.write(_docAcuseHtml(a, idx));
    w.document.close();
  }

  // ── Envío del acuse al cliente (desde la tarjeta) ──────────────────────
  // Marca envio 'solicitado' y el backend encola el correo; sirve para el
  // primer envío, el reenvío tras un fallo y el reenvío de cortesía — también
  // con la orden CERRADA (el estado no cambia y las reglas lo permiten).
  function enviarAcuseCliente(idx) {
    const dev = _orden.devolucion || {};
    const a = (dev.acuses || [])[idx];
    if (!a || !puedeOperar()) return;
    const st = a.envio?.status;
    if (st === 'solicitado' || st === 'encolado') { Toast.show('Ese acuse ya está en camino.', 'warn'); return; }
    const numero = a.numero || `${_ordenId}-A${idx + 1}`;
    const prellenado = a.envio?.to || _emailCopia() || '';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9500';
    overlay.innerHTML = `
      <div class="modal" style="max-width:430px;width:min(94vw,430px);">
        <div class="sheet-header"><h3 class="sheet-title">Enviar acuse ${esc(numero)}</h3></div>
        <div class="sheet-body" style="padding:12px 14px;">
          <p style="margin:0 0 10px;font-size:13px;color:var(--fg-2,#374151);">
            El cliente recibe el documento completo del acuse — unidades, accesorios registrados y firma —
            listo para archivar o imprimir.
          </p>
          <div class="form-field">
            <label class="form-label" for="devEnvioEmail">Correo del cliente</label>
            <input class="form-input" id="devEnvioEmail" type="email" value="${esc(prellenado)}" style="height:34px;" autocomplete="off">
            <div style="font-size:11px;color:var(--fg-3,#6b7280);margin-top:3px;">Si lo corriges, queda guardado en la ficha para los próximos envíos.</div>
          </div>
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">Cancelar</button>
          <button class="btn btn-primary" id="devEnvioConfirmar">Enviar copia</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cerrar = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) cerrar(); });
    overlay.querySelector('#devEnvioConfirmar').addEventListener('click', async () => {
      const email = (overlay.querySelector('#devEnvioEmail')?.value || '').trim().toLowerCase();
      if (!_esEmail(email)) { Toast.show('Escribe un correo válido.', 'bad'); return; }
      const user = firebase.auth().currentUser;
      const previo = a.envio || null;
      a.envio = {
        status: 'solicitado', to: email,
        solicitado_at: firebase.firestore.Timestamp.now(),
        solicitado_por: user?.uid || null,
      };
      const btn = overlay.querySelector('#devEnvioConfirmar');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        await _guardarDevolucion('DEVOLUCION_ACUSE_ENVIO');
        cerrar();
        Toast.show(`Acuse ${numero} en camino a ${email}.`, 'ok');
        _guardarEmailCliente(email);
      } catch (err) {
        console.error(err);
        a.envio = previo;
        btn.disabled = false; btn.textContent = 'Enviar copia';
        Toast.show('No se pudo solicitar el envío.', 'bad');
      }
      render();
    });
    requestAnimationFrame(() => overlay.querySelector('#devEnvioEmail')?.focus());
  }

  // Correo corregido de vuelta a la ficha (best-effort). Va en email_acuses
  // para no pisar el email general del cliente.
  async function _guardarEmailCliente(email) {
    if (!email || !_esEmail(email) || !_orden?.cliente_id || email === _emailCliente) return;
    try {
      await firebase.firestore().collection('clientes').doc(_orden.cliente_id)
        .set({ email_acuses: email }, { merge: true });
      _emailCliente = email;
    } catch (e) { console.warn('[OrdenesDevolucion] email_acuses no guardado', e); }
  }

  // Faltantes que NO tienen fila propia: los que vienen de `esperados_por_modelo`
  // (la baja no registró seriales) y los del contrato de PAPEL (total declarado
  // menos recibidos). Los `esperados` sin resolver sí tienen fila y se resuelven
  // uno a uno con "No se devuelve" — esos ya abren su renglón de cobro solos.
  function _faltantesSinFila(dev) {
    const esperados = dev.esperados || [];
    const porModelo = (dev.esperados_por_modelo || [])
      .map((m, i) => ({ idx: i, modelo_id: m.modelo_id || '', modelo: m.modelo || '',
                        falta: Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)) }))
      .filter(m => m.falta > 0);
    let papel = 0;
    if (dev.modo === 'sin_contrato') {
      const total = Number(dev.total_esperado || 0);
      const recibidos = esperados.filter(e => e.resolucion === 'recibido').length;
      if (total > 0) papel = Math.max(0, total - recibidos);
    }
    return { porModelo, papel, total: porModelo.reduce((s, m) => s + m.falta, 0) + papel };
  }

  // Modelo más frecuente entre lo que SÍ llegó — la mejor conjetura para
  // prellenar un faltante de contrato de papel, donde no hay lista previa.
  function _modeloDominante(dev) {
    const cuenta = new Map();
    (dev.esperados || []).filter(e => e.resolucion === 'recibido').forEach(e => {
      const k = `${e.modelo_id || ''}|${e.modelo || ''}`;
      cuenta.set(k, (cuenta.get(k) || 0) + 1);
    });
    let mejor = null;
    cuenta.forEach((n, k) => { if (!mejor || n > mejor.n) mejor = { k, n }; });
    if (!mejor) return { modelo_id: '', modelo: '' };
    const [modelo_id, modelo] = mejor.k.split('|');
    return { modelo_id, modelo };
  }

  // Itemización obligatoria de lo que el cliente no devolvió. Antes esto era un
  // contador (`cierre_pendientes`) y una frase en observaciones: los 4 radios
  // del finiquito de TIL PANAMA se perdieron exactamente ahí, porque un número
  // no se puede cobrar ni perseguir. Ahora cada faltante sale del cierre como un
  // renglón con modelo, cantidad y monto.
  // Devuelve las líneas confirmadas, o null si se canceló.
  function _pedirFaltantes(dev, faltan) {
    return new Promise(resolve => {
      const dom = _modeloDominante(dev);
      const catalogo = _modelos || [];
      const precioDe = (nombre) => {
        const m = catalogo.find(x => x.nombre.toLowerCase() === (nombre || '').toLowerCase());
        return m && m.precio_venta > 0 ? m.precio_venta : '';
      };
      // Arranca con una línea por cada grupo por-modelo conocido, más una del
      // modelo dominante para el resto (contrato de papel).
      const lineas = faltan.porModelo.map(m => ({
        modelo_id: m.modelo_id, modelo: m.modelo, cantidad: m.falta, monto: precioDe(m.modelo),
      }));
      if (faltan.papel > 0) {
        lineas.push({ modelo_id: dom.modelo_id, modelo: dom.modelo,
                      cantidad: faltan.papel, monto: precioDe(dom.modelo) });
      }

      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.style.display = 'flex';

      const filaHtml = (l, i) => `
        <tr data-i="${i}">
          <td style="padding:4px;">
            <input class="form-input fl-modelo" list="flModelos" value="${esc(l.modelo)}"
                   placeholder="Modelo" style="height:30px;font-size:12px;min-width:170px;">
          </td>
          <td style="padding:4px;">
            <input type="number" min="1" step="1" class="form-input fl-cant" value="${Number(l.cantidad) || 1}"
                   style="height:30px;font-size:12px;width:70px;text-align:right;">
          </td>
          <td style="padding:4px;">
            <input type="number" min="0" step="any" class="form-input fl-monto" value="${l.monto === '' ? '' : Number(l.monto)}"
                   placeholder="0.00" style="height:30px;font-size:12px;width:100px;text-align:right;">
          </td>
          <td style="padding:4px;">
            <button type="button" class="btn btn-sm fl-quitar" title="Quitar">✕</button>
          </td>
        </tr>`;

      const pintar = () => {
        overlay.querySelector('#flCuerpo').innerHTML = lineas.map(filaHtml).join('');
        const suma = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
        const monto = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.monto) || 0), 0);
        const ok = suma === faltan.total;
        overlay.querySelector('#flResumen').innerHTML =
          `<b>${suma}</b> de <b>${faltan.total}</b> equipo(s) itemizados · total a cobrar <b>$${monto.toFixed(2)}</b>` +
          (ok ? '' : ` <span style="color:#b91c1c;">— las cantidades tienen que sumar ${faltan.total}</span>`);
        overlay.querySelector('#flConfirmar').disabled = !ok;
      };

      overlay.innerHTML = `
        <div class="modal" style="max-width:620px;">
          <div class="sheet-header"><h3 class="sheet-title">Equipos que el cliente no devolvió</h3></div>
          <div class="sheet-body" style="padding:14px 10px;">
            <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">
              Faltan <b>${faltan.total}</b> equipo(s). Antes de cerrar hay que decir <b>qué son</b> y
              <b>a cuánto se cobran</b>: así quedan como renglones que alguien puede perseguir, en vez de
              un número que se pierde al cerrar la orden.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);">
                <th style="padding:4px;">Modelo</th><th style="padding:4px;">Cant.</th>
                <th style="padding:4px;">$ c/u</th><th></th>
              </tr></thead>
              <tbody id="flCuerpo"></tbody>
            </table>
            <datalist id="flModelos">${catalogo.map(m => `<option value="${esc(m.nombre)}"></option>`).join('')}</datalist>
            <button type="button" class="btn btn-sm" id="flAgregar" style="margin-top:8px;">+ Otra línea</button>
            <div id="flResumen" style="margin-top:10px;font-size:12.5px;"></div>
            <div style="margin-top:8px;font-size:11.5px;color:var(--fg-3,#6b7280);">
              El monto sale del precio de venta del catálogo y se puede ajustar. Un descuento mayor al
              ${(window.CobrosEquiposService?.DESCUENTO_LIBRE_PCT) || 15}% pedirá aprobación antes de facturar,
              y condonar solo lo puede hacer un administrador.
            </div>
          </div>
          <div class="footer">
            <button class="btn btn-ghost" id="flCancelar">Cancelar</button>
            <button class="btn btn-primary" id="flConfirmar">Registrar y cerrar</button>
          </div>
        </div>`;

      const cerrar = (r) => {
        overlay.remove();
        document.body.style.overflow = '';
        resolve(r);
      };

      overlay.addEventListener('input', e => {
        const tr = e.target.closest('tr[data-i]');
        if (!tr) return;
        const i = Number(tr.dataset.i);
        if (e.target.classList.contains('fl-modelo')) {
          const txt = e.target.value.trim();
          const cat = catalogo.find(m => m.nombre.toLowerCase() === txt.toLowerCase());
          lineas[i].modelo = txt;
          lineas[i].modelo_id = cat ? cat.id : '';
          // Solo prellena si el monto estaba vacío: no pisa lo que ya tecleó.
          if (cat && cat.precio_venta > 0 && !lineas[i].monto) {
            lineas[i].monto = cat.precio_venta;
            tr.querySelector('.fl-monto').value = cat.precio_venta;
          }
        } else if (e.target.classList.contains('fl-cant')) {
          lineas[i].cantidad = Math.max(1, Number(e.target.value) || 1);
        } else if (e.target.classList.contains('fl-monto')) {
          lineas[i].monto = e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0);
        }
        const suma = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
        const monto = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.monto) || 0), 0);
        const ok = suma === faltan.total;
        overlay.querySelector('#flResumen').innerHTML =
          `<b>${suma}</b> de <b>${faltan.total}</b> equipo(s) itemizados · total a cobrar <b>$${monto.toFixed(2)}</b>` +
          (ok ? '' : ` <span style="color:#b91c1c;">— las cantidades tienen que sumar ${faltan.total}</span>`);
        overlay.querySelector('#flConfirmar').disabled = !ok;
      });

      overlay.addEventListener('click', e => {
        if (e.target.closest('.fl-quitar')) {
          const i = Number(e.target.closest('tr[data-i]').dataset.i);
          lineas.splice(i, 1);
          if (!lineas.length) lineas.push({ modelo_id: '', modelo: '', cantidad: 1, monto: '' });
          pintar();
          return;
        }
        if (e.target.closest('#flAgregar')) {
          lineas.push({ modelo_id: '', modelo: '', cantidad: 1, monto: '' });
          pintar();
          return;
        }
        if (e.target.closest('#flCancelar') || e.target === overlay) cerrar(null);
        if (e.target.closest('#flConfirmar')) {
          const sinModelo = lineas.filter(l => !(l.modelo || '').trim()).length;
          if (sinModelo) { Toast.show('Cada línea necesita un modelo.', 'warn'); return; }
          cerrar(lineas.map(l => ({
            modelo_id: l.modelo_id || '', modelo: (l.modelo || '').trim(),
            cantidad: Math.max(1, Number(l.cantidad) || 1),
            monto: l.monto === '' ? null : Math.max(0, Number(l.monto) || 0),
          })));
        }
      });

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      pintar();
    });
  }

  async function cerrarOrden() {
    const dev = _orden.devolucion || {};
    const sinAcuse = (dev.esperados || []).filter(e => e.resolucion === 'recibido' && !e.acuse_id).length;
    const pend = (typeof pendientesDevolucion === 'function') ? pendientesDevolucion(_orden) : 0;
    const aviso = sinAcuse ? `\n\nOJO: ${sinAcuse} unidad(es) recibida(s) quedan SIN acuse firmado del cliente.` : '';
    const acusesSinEnvio = (dev.acuses || []).filter(a =>
      !a.envio || ['sin_enviar', 'fallo'].includes(a.envio.status)).length;
    const avisoEnvio = acusesSinEnvio
      ? `\n\n${acusesSinEnvio} acuse(s) aún sin enviar al cliente — se pueden enviar desde su tarjeta, también con la orden cerrada.`
      : '';

    // Faltantes sin fila propia: hay que itemizarlos ANTES de cerrar, o se
    // vuelven un número muerto. Los que sí tienen fila se resuelven con
    // "No se devuelve", que abre su renglón de cobro por su cuenta.
    const faltan = _faltantesSinFila(dev);
    let lineas = null;
    if (faltan.total > 0) {
      if (typeof CobrosEquiposService === 'undefined') {
        Toast.show('No se pudo cargar el registro de cobros — recarga la página.', 'bad');
        return;
      }
      lineas = await _pedirFaltantes(dev, faltan);
      if (!lineas) return;   // canceló: la orden NO se cierra
    }

    const base = pend > 0
      ? `¿Cerrar la devolución con ${pend} equipo(s) SIN devolver?\n\n` +
        (faltan.total > 0
          ? `Los ${faltan.total} faltantes quedarán registrados como equipos por cobrar, visibles en "Equipos no devueltos" hasta que se facturen, se condonen o aparezcan.`
          : 'Quedará registrado en la orden — coordina el cobro o la excepción antes de cerrar.')
      : '¿Cerrar la devolución? Todas las unidades quedaron resueltas; los equipos recibidos ya están (o quedarán) en la orden de ENTRADA de inspección.';
    if (!window.confirm(base + aviso + avisoEnvio)) return;
    const user = firebase.auth().currentUser;
    const previo = dev.cierre_pendientes;
    dev.cierre_pendientes = pend;

    // Los renglones de cobro se abren ANTES de cerrar: si el cierre falla, la
    // deuda ya quedó registrada (que es lo que no puede perderse). Un renglón
    // de más se cierra a mano desde la bandeja; uno de menos no se detecta.
    if (lineas) {
      const ids = [];
      for (const l of lineas) {
        try {
          const id = await CobrosEquiposService.abrir({
            cliente_id: _orden.cliente_id || '',
            cliente_nombre: _orden.cliente_nombre || '',
            orden_devolucion_id: _ordenId,
            modelo_id: l.modelo_id, modelo_label: l.modelo,
            cantidad: l.cantidad,
            motivo_codigo: 'perdido',
            motivo_detalle: 'No devuelto al cerrar la devolución (sin lista por serial)',
            monto_catalogo_unit: l.monto,
            monto_unit: l.monto,
          });
          ids.push(id);
        } catch (e) {
          console.error('[devolucion] no se pudo abrir el cobro', e);
          Toast.show(`No se pudo registrar el cobro de ${l.modelo}: ${e?.message || e}`, 'bad');
          dev.cierre_pendientes = previo;
          return;   // sin renglón no se cierra: es justo lo que se traspapelaba
        }
      }
      dev.cobros_ids = [...(dev.cobros_ids || []), ...ids];
    }

    try {
      // `devolucion` va completo: mergeOrder usa set({merge:true}) y una clave
      // con punto crearía un campo literal "devolucion.cierre_pendientes".
      await OrdenesService.mergeOrder(_ordenId, {
        estado_reparacion: 'CERRADA (DEVOLUCION)',
        fecha_completado: firebase.firestore.FieldValue.serverTimestamp(),
        completado_por_uid: user?.uid || null,
        devolucion: dev,
        os_logs: firebase.firestore.FieldValue.arrayUnion({ action: 'CERRAR_DEVOLUCION', by: user?.uid || '' }),
      });
      _orden.estado_reparacion = 'CERRADA (DEVOLUCION)';
      Toast.show('Devolución cerrada.', 'ok');
      render();
    } catch (e) {
      console.error(e);
      dev.cierre_pendientes = previo;
      Toast.show('No se pudo cerrar la devolución.', 'bad');
    }
  }

  // ── Nueva devolución SIN CONTRATO (contrato de papel) ────────────────
  // Para equipos alquilados con contratos fuera del sistema: crea la orden
  // de DEVOLUCION en modo 'sin_contrato' (sin esperados) y abre el check-in,
  // donde los seriales se capturan libres y quedan trackeados en el pool.
  const ROLES_NUEVA = () => [ROLES.ADMIN, ROLES.RECEPCION, ROLES.JEFE_TALLER, ROLES.VENDEDOR];

  // Consecutivo AAAAMMDDNN — misma convención que nueva-orden.js y el backend
  // (_siguienteOrdenId): transacción create-if-missing con reintentos por si
  // hay carrera con otra creación simultánea.
  async function _crearDocOrden(data) {
    const db = firebase.firestore();
    const col = db.collection('ordenes_de_servicio');
    const hoy = new Date();
    const fechaBase = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
    const snap = await col
      .where(firebase.firestore.FieldPath.documentId(), '>=', `${fechaBase}00`)
      .where(firebase.firestore.FieldPath.documentId(), '<=', `${fechaBase}99`)
      .get();
    const usados = snap.docs.map(d => parseInt(d.id.slice(-2), 10)).filter(n => !Number.isNaN(n));
    const siguiente = usados.length ? Math.max(...usados) + 1 : 1;
    for (let i = 0; i < 5; i++) {
      const candidato = `${fechaBase}${String(siguiente + i).padStart(2, '0')}`;
      const ganado = await db.runTransaction(async (tx) => {
        const s = await tx.get(col.doc(candidato));
        if (s.exists) return null;
        tx.set(col.doc(candidato), data);
        return candidato;
      });
      if (ganado) return ganado;
    }
    throw new Error('No se pudo reservar un número de orden — reintenta.');
  }

  async function nueva() {
    if (!ROLES_NUEVA().includes(window.APP?.state?.userRole || '')) {
      Toast.show('Tu rol no puede registrar devoluciones.', 'bad');
      return;
    }

    // Autocompletado de clientes (best-effort): texto libre también vale —
    // el cliente de un contrato de papel puede no existir en el sistema.
    let clientes = [];
    try { clientes = [...(await ClientesService.loadClientes()).values()]; } catch (e) { /* datalist vacío */ }
    const nombres = clientes
      .filter(c => c.deleted !== true) // los duplicados fusionados no se sugieren
      .map(c => (c.nombre || '').trim()).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9400';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;width:min(94vw,520px);">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="package-open"></i> Devolución sin contrato</h3>
          <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:12px 14px;">
          <p style="margin:0 0 10px;font-size:13px;color:var(--fg-2,#374151);">
            Para equipos alquilados con <b>contrato de papel</b> (fuera del sistema). Se crea el
            tiquete de devolución y los seriales se registran al recibirlos, con checklist de
            accesorios/daño y acuse firmado — las unidades quedan trackeadas en Equipos por serial.
          </p>
          <div class="form-field" style="margin-bottom:8px;">
            <label class="form-label" for="devNuevaCliente">Cliente <span class="req"></span></label>
            <input class="form-input" id="devNuevaCliente" list="devNuevaClientesList" placeholder="Nombre del cliente (elige o escribe)" autocomplete="off">
            <datalist id="devNuevaClientesList">${nombres.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
          </div>
          <div class="form-field" style="margin-bottom:8px;">
            <label class="form-label" for="devNuevaRef">Referencia del contrato de papel</label>
            <input class="form-input" id="devNuevaRef" placeholder="Ej.: contrato físico #123 / carpeta 2019" autocomplete="off">
          </div>
          <div class="form-field" style="margin-bottom:8px;">
            <label class="form-label" for="devNuevaTotal">¿Cuántos equipos debe devolver? <span class="req"></span></label>
            <input class="form-input" id="devNuevaTotal" type="number" min="1" max="999" placeholder="Ej.: 9" style="max-width:120px;" autocomplete="off">
            <div style="font-size:11.5px;color:var(--fg-3,#6b7280);margin-top:3px;">
              Total del alquiler según el contrato de papel. Es lo que permite saber cuántos radios
              quedan pendientes cuando el cliente trae solo una parte, y dispara el aviso diario a
              recepción. Se puede corregir después.
            </div>
          </div>
          <div class="form-field">
            <label class="form-label" for="devNuevaObs">Observaciones (opcional)</label>
            <textarea class="form-input form-textarea" id="devNuevaObs" rows="2" placeholder="Ej.: cliente pasa a dejar 4 radios por fin de alquiler"></textarea>
          </div>
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">Cancelar</button>
          <button class="btn btn-primary" id="devNuevaCrearBtn"><i data-lucide="plus"></i> Crear devolución</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(overlay);
    const cleanup = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
    });

    const btn = overlay.querySelector('#devNuevaCrearBtn');
    btn.onclick = async () => {
      const nombre = (overlay.querySelector('#devNuevaCliente')?.value || '').trim();
      const refPapel = (overlay.querySelector('#devNuevaRef')?.value || '').trim();
      const obs = (overlay.querySelector('#devNuevaObs')?.value || '').trim();
      const total = Math.floor(Number(overlay.querySelector('#devNuevaTotal')?.value || 0));
      if (!nombre) { Toast.show('Ingresa el nombre del cliente.', 'bad'); return; }
      if (!(total >= 1 && total <= 999)) {
        Toast.show('Indica cuántos equipos debe devolver el cliente (1-999).', 'bad');
        overlay.querySelector('#devNuevaTotal')?.focus();
        return;
      }
      const match = clientes.find(c => (c.nombre || '').trim().toLowerCase() === nombre.toLowerCase());
      const user = firebase.auth().currentUser;

      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const data = {
          cliente_id: match?.id || '',
          cliente_nombre: nombre,
          vendedor_asignado: '',
          tipo_de_servicio: 'DEVOLUCION',
          estado_reparacion: 'POR ASIGNAR',
          fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
          observaciones: [
            `Devolución sin contrato en el sistema${refPapel ? ` — ${refPapel}` : ''}.`,
            `El cliente debe devolver ${total} equipo${total === 1 ? '' : 's'}.`,
            obs,
          ].filter(Boolean).join(' '),
          // Sin `equipos[]` a propósito (mismo criterio que ordenDevolucion.js
          // del backend): las unidades entran al capturarse en el check-in.
          devolucion: {
            modo: 'sin_contrato',
            origen: { tipo: 'contrato_papel', ref_id: null, ref_papel: refPapel || null },
            esperados: [],
            esperados_por_modelo: [],
            // Único ancla de "cuántos faltan" en papel: no hay lista de
            // esperados que consultar, solo esta cantidad menos lo recibido.
            total_esperado: total,
          },
          contrato: {
            aplica: false,
            contrato_doc_id: null,
            contrato_id: refPapel || null,
            motivo_no_aplica: 'Contrato de papel (fuera del sistema)',
          },
          creado_por_uid: user?.uid || '',
          creado_por_email: user?.email || null,
          eliminado: false,
          os_logs: [{ action: 'CREAR', by: user?.uid || '' }],
        };
        const ordenId = await _crearDocOrden(data);
        cleanup();
        Toast.show(`Devolución ${ordenId} creada — registra los seriales al recibirlos.`, 'ok');
        abrir(ordenId); // directo al check-in, con el cliente en el mostrador
      } catch (err) {
        console.error('[OrdenesDevolucion.nueva]', err);
        Toast.show('No se pudo crear la devolución: ' + err.message, 'bad');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="plus"></i> Crear devolución';
        if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(btn);
      }
    };
  }

  window.OrdenesDevolucion = { abrir, nueva };
})();

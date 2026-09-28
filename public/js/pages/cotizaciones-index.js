// @ts-nocheck
// Lista de cotizaciones — UI Kit (stats, segmented filter, sortable table)
(() => {
  let cotizaciones = [];
  let lastDoc = null;
  let isLoading = false;
  let filtroEstado = 'todas';
  let sortKey = 'fecha';
  let sortDir = 'desc';
  let userUid = null;
  let userRol = null;
  let soloMias = false;     // toggle "Solo mis cotizaciones" (admins; forzado para vendedores)
  let esSupervisor = false; // email en empresa/config.cotizaciones_supervisores → ve todas (solo lectura)
  let policyCfg = null;     // { descuentoMaxPct, totalMax } desde empresa/config
  // Taller | Ventas | Todas (2026-09-25). Una cotización de taller y una de
  // ventas terminan distinto (la de taller en facturación, la de ventas en un
  // contrato o una venta) y mezclarlas hacía que las reparaciones del taller
  // contaran en la tasa de cierre de los vendedores.
  let filtroTipo = 'todas';
  // ?aprobar=1 (señal SAP del home): solo los borradores que esperan
  // aprobación (requiere_aprobacion == true). Antes la señal contaba esos y
  // aterrizaba en TODOS los borradores (auditoría UX 2026-09-28, P0 #20).
  let soloPorAprobar = false;
  const esTallerC = (c) => CotizacionTaller.esTaller(c);
  const pasaTipo = (c) => filtroTipo === 'todas' || (filtroTipo === 'taller' ? esTallerC(c) : !esTallerC(c));

  const $ = (id) => document.getElementById(id);

  // ── Fecha helpers ─────────────────────────────────────────────
  function fechaIso(c) {
    // Esquema kit: campo `fecha` ISO YYYY-MM-DD.
    return c.fecha || (c.fecha_creacion?.toDate ? c.fecha_creacion.toDate().toISOString().slice(0, 10) : '');
  }
  function fmtFechaCorta(iso) { return FMT.dateShort(iso); } // delega en el helper canónico

  // ── Carga ─────────────────────────────────────────────────────
  async function cargarCotizaciones(esInicial = true) {
    if (isLoading) return;
    isLoading = true;
    const btn = $('btnCargarMas');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Cargando...'; }
    if (esInicial) { cotizaciones = []; lastDoc = null; }

    // Vendedor (forzado a "solo mías"): filtro EN EL SERVIDOR — antes
    // descargaba las de toda la empresa y veía 3-4 suyas por página de 30
    // (además de privacidad: docs ajenos en su navegador). El toggle de
    // admin/supervisor sigue siendo client-side sobre lo cargado.
    const uidFiltro = (userRol === ROLES.VENDEDOR && !esSupervisor) ? userUid : null;
    // Rango de fechas (auditoría UX 2026-09-28 §4.5 #12): va al servidor sobre
    // fecha_creacion, con el mismo índice que la paginación.
    const { desde, hasta } = rangoFechas();
    if (esInicial) { kpiSrv = null; _busqUltima = ''; }
    const { docs, lastDoc: cursor } = await CotizacionesService.listCotizaciones({ lastDoc, limit: 30, creadoPorUid: uidFiltro, desde, hasta });
    if (docs.length) { lastDoc = cursor; cotizaciones.push(...docs); }
    render();

    if (btn) {
      btn.disabled = false;
      btn.style.display = docs.length ? 'inline-flex' : 'none';
      btn.innerHTML = '<i data-lucide="chevron-down"></i> Cargar más';
    }
    isLoading = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Filtros / orden ───────────────────────────────────────────
  function getFiltradas() {
    const term = ($('filtroTexto').value || '').trim().toLowerCase();
    const mostrarEliminadas = $('toggleEliminadas').checked;
    let list = cotizaciones.slice();
    if (!mostrarEliminadas) list = list.filter(c => !c.deleted);
    // Vendedor solo ve las propias (forzado). Admin con toggle.
    if (soloMias) list = list.filter(c => c.creado_por_uid === userUid);
    if (soloPorAprobar) list = list.filter(c => c.requiere_aprobacion === true && (c.estado || 'borrador') === 'borrador');
    list = list.filter(pasaTipo);
    // Los dos últimos segmentos no filtran por estado sino por FACTURACIÓN: es
    // el control que el taller llevaba a mano ("cuáles ya se facturaron y
    // cuáles no"). Solo aplican a cotizaciones de taller, que son las únicas
    // que abren fila en la bandeja al entregarse la orden.
    if (filtroEstado === 'por_facturar')      list = list.filter(c => facturacionEstado(c) === 'pendiente');
    else if (filtroEstado === 'facturadas')   list = list.filter(c => facturacionEstado(c) === 'facturada');
    // 'activas' (señal S7 del home): lo que todavía está en juego.
    else if (filtroEstado === 'activas')      list = list.filter(esActiva);
    else if (filtroEstado !== 'todas')        list = list.filter(c => (c.estado || 'borrador') === filtroEstado);
    // El rango también se aplica aquí: lo que entra por la búsqueda por tokens
    // o por "activas" no pasó por el filtro de fechas del servidor.
    const { desde, hasta } = rangoFechas();
    if (desde || hasta) {
      list = list.filter(c => {
        const t = c.fecha_creacion?.toDate ? c.fecha_creacion.toDate() : null;
        return !!t && (!desde || t >= desde) && (!hasta || t < hasta);
      });
    }
    if (term) {
      list = list.filter(c => {
        const blob = (c.cotizacion_id || '') + ' ' + (c.cliente_nombre || '') + ' ' + (c.ejecutivo_nombre || '');
        return blob.toLowerCase().includes(term);
      });
    }
    list.sort((a, b) => {
      let av, bv;
      if (sortKey === 'total') { av = Number(a.total || 0); bv = Number(b.total || 0); }
      else if (sortKey === 'cliente') { av = (a.cliente_nombre || '').toLowerCase(); bv = (b.cliente_nombre || '').toLowerCase(); }
      else if (sortKey === 'fecha') { av = fechaIso(a); bv = fechaIso(b); }
      else { av = a.cotizacion_id || ''; bv = b.cotizacion_id || ''; }
      const r = av > bv ? 1 : av < bv ? -1 : 0;
      return sortDir === 'asc' ? r : -r;
    });
    return list;
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    const filtradas = getFiltradas();
    renderTipo();
    renderSegments();
    renderStats(filtradas);
    renderTabla(filtradas);
    renderCards(filtradas);
    renderSortIcons();
    const avisoPA = $('avisoPorAprobar');
    if (avisoPA) avisoPA.style.display = soloPorAprobar ? '' : 'none';
    $('emptyState').style.display = filtradas.length ? 'none' : '';
    $('footerResumen').textContent = filtradas.length + ' de ' + cotizaciones.length + ' cotizaciones';
    $('headerSubtitle').textContent = cotizaciones.length + ' cotizaciones cargadas';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderTipo() {
    const wrap = $('tipoSeg');
    if (!wrap) return;
    const base = cotizaciones.filter(c => !c.deleted && (!soloMias || c.creado_por_uid === userUid));
    const n = { todas: base.length, taller: base.filter(esTallerC).length };
    n.ventas = n.todas - n.taller;
    wrap.innerHTML = [['taller', 'Taller'], ['ventas', 'Ventas'], ['todas', 'Todas']].map(([k, l]) => `
      <button type="button" class="cc-seg${filtroTipo === k ? ' active' : ''}" data-tipo="${k}" role="tab" aria-selected="${filtroTipo === k}">
        ${l} <span class="cc-seg-count">${n[k]}</span>
      </button>`).join('');
  }

  function renderSegments() {
    const wrap = $('segments');
    if (!wrap) return;
    // Los conteos respetan los mismos filtros que la tabla (soloMias + visibles),
    // para que el segmento "Borrador 3" siempre coincida con lo que muestra el listado
    // al hacer click. Antes el segmento contaba globalmente y la tabla filtraba por
    // vendedor → "Borrador 3" vs "Sin resultados".
    const base = cotizaciones.filter(c => !c.deleted && (!soloMias || c.creado_por_uid === userUid) && pasaTipo(c));
    const counts = { todas: base.length };
    CotState.ESTADO_ORDEN.forEach(e => {
      counts[e] = base.filter(c => (c.estado || 'borrador') === e).length;
    });
    const porFacturar = base.filter(c => facturacionEstado(c) === 'pendiente').length;
    const facturadas  = base.filter(c => facturacionEstado(c) === 'facturada').length;
    const segs = [
      { key: 'todas', label: 'Todas', count: counts.todas },
      // Solo cuando se aterriza desde la señal S7 (?estado=activas): al elegir
      // otro segmento desaparece, como el aviso de "por aprobar".
      ...(filtroEstado === 'activas' ? [{ key: 'activas', label: 'Activas', count: base.filter(esActiva).length }] : []),
      // En la vista de Taller 'convertida' se lee "Aceptada" y 'aprobada' no
      // existe en la práctica (el taller aprueba y envía de una vez), así que
      // los segmentos vacíos que no significan nada ahí se esconden.
      ...CotState.ESTADO_ORDEN
        .filter(e => filtroTipo !== 'taller' || counts[e] > 0 || ['borrador', 'enviada', 'convertida'].includes(e) || filtroEstado === e)
        .map(e => ({ key: e, label: filtroTipo === 'taller' && e === 'convertida' ? 'Aceptada' : CotState.ESTADOS[e].label, count: counts[e] })),
    ];
    // Solo aparecen cuando hay algo que contar: en una lista de puras
    // cotizaciones comerciales estos dos segmentos siempre dirían 0 y no
    // significan nada ahí.
    if (porFacturar || facturadas || filtroEstado === 'por_facturar' || filtroEstado === 'facturadas') {
      segs.push({ key: 'por_facturar', label: 'Por facturar', count: porFacturar });
      segs.push({ key: 'facturadas',   label: 'Facturadas',   count: facturadas });
    }
    wrap.innerHTML = segs.map(s => `
      <button type="button" class="cc-seg${filtroEstado === s.key ? ' active' : ''}" data-estado="${s.key}">
        ${s.label} <span class="cc-seg-count">${s.count}</span>
      </button>
    `).join('');
  }

  // ── KPIs del servidor (auditoría UX 2026-09-28 §4.5 #12) ─────────
  // Antes salían de lo CARGADO (páginas de 30) y el subtítulo decía "de las
  // N cargadas" para que el número no pareciera absoluto (P0 #20). Ahora son
  // count()/sum() sobre TODAS las del alcance (CotAgg, puente modular del
  // entry): el mismo alcance que la tabla (soloMias) y el mismo corte por tipo
  // (Taller = origen 'orden'; Ventas = todas menos taller). Lo cargado sigue
  // siendo el respaldo mientras llegan o si la agregación falla. El rango de
  // fechas NO los recorta: son el histórico completo, y el subtítulo lo dice.
  // Solo igualdades (deleted, creado_por_uid, estado, origen…): Firestore
  // combina los índices de un campo y no hace falta un compuesto por
  // combinación. `deleted` lo escriben las tres puertas desde el primer día
  // del módulo (toDoc, cotizar-orden y lib/reposicionDano).
  let kpiSrv = null;      // { key, datos|null }
  let kpiSrvPend = null;
  const kpiKey = () => (soloMias ? userUid : '') + '|' + filtroTipo;

  async function cargarKpisServidor() {
    if (!window.CotAgg) return;
    const key = kpiKey();
    if ((kpiSrv && kpiSrv.key === key) || kpiSrvPend === key) return;
    kpiSrvPend = key;
    const base = [['deleted', '==', false]];
    if (soloMias) base.push(['creado_por_uid', '==', userUid]);
    const bloque = async (extra) => {
      const w = (...m) => [...base, ...extra, ...m];
      const [enviada, aprobada, convertida, rechazada, rechAprob, vencida, porFacturar] = await Promise.all([
        CotAgg.contar(w(['estado', '==', 'enviada'])),
        CotAgg.contar(w(['estado', '==', 'aprobada'])),
        CotAgg.contar(w(['estado', '==', 'convertida']), { conMonto: true }),
        CotAgg.contar(w(['estado', '==', 'rechazada'])),
        // Un rechazo del APROBADOR no es una oportunidad perdida (P0 #17).
        CotAgg.contar(w(['estado', '==', 'rechazada'], ['rechazo_origen', '==', 'aprobador'])),
        CotAgg.contar(w(['estado', '==', 'vencida'])),
        CotAgg.contar(w(['facturacion.estado', '==', 'pendiente'])),
      ]);
      return {
        enviadas: enviada.n, aprobadas: aprobada.n,
        convertidas: convertida.n, montoCerrado: convertida.monto,
        oportunidades: enviada.n + convertida.n + (rechazada.n - rechAprob.n) + vencida.n,
        porFacturar: porFacturar.n,
      };
    };
    try {
      const [todas, taller] = await Promise.all([
        filtroTipo !== 'taller' ? bloque([]) : null,
        filtroTipo !== 'todas'  ? bloque([['origen', '==', 'orden']]) : null,
      ]);
      let datos = todas;
      if (filtroTipo === 'taller') datos = taller;
      else if (filtroTipo === 'ventas') {
        datos = {};
        Object.keys(todas).forEach(k => { datos[k] = todas[k] - taller[k]; });
      }
      kpiSrv = { key, datos };
    } catch (e) {
      console.warn('KPIs del servidor no disponibles; se muestran los de lo cargado:', e?.code || e);
      kpiSrv = { key, datos: null };
    } finally {
      if (kpiSrvPend === key) kpiSrvPend = null;
    }
    if (kpiKey() === key) renderStats(getFiltradas());
  }

  function renderStats(filtradas) {
    // Los KPIs de negocio (enviadas / monto cerrado / tasa) reflejan el alcance del
    // usuario (soloMias forzado para vendedores), no el de toda la empresa.
    const visibles = cotizaciones.filter(c => !c.deleted && (!soloMias || c.creado_por_uid === userUid));
    const srv = (kpiSrv && kpiSrv.key === kpiKey()) ? kpiSrv.datos : null;
    if (!srv && !(kpiSrv && kpiSrv.key === kpiKey())) cargarKpisServidor();
    const alcance = srv ? 'todo el histórico' : `de las ${cotizaciones.length} cargadas`;
    // Un rechazo del APROBADOR no es una oportunidad perdida con el cliente:
    // la cotización nunca le llegó (auditoría UX 2026-09-28, P0 #17).
    const esOportunidad = (c) => ['enviada', 'convertida', 'rechazada', 'vencida'].includes(c.estado)
      && !(c.estado === 'rechazada' && c.rechazo_origen === 'aprobador');
    // Vista de TALLER: sus propios números. Lo que el cliente todavía no
    // contesta, lo que se aceptó y cuánto de eso ya se facturó.
    if (filtroTipo === 'taller') {
      const taller = visibles.filter(esTallerC);
      const aceptadas = taller.filter(c => c.estado === 'convertida');
      const esperando = srv ? srv.enviadas + srv.aprobadas : taller.filter(c => c.estado === 'enviada' || c.estado === 'aprobada').length;
      const nAceptadas = srv ? srv.convertidas : aceptadas.length;
      const montoAceptado = srv ? srv.montoCerrado : aceptadas.reduce((s, c) => s + Number(c.total || 0), 0);
      const oportunidadesT = srv ? srv.oportunidades : taller.filter(esOportunidad).length;
      const porFacturar = srv ? srv.porFacturar : taller.filter(c => facturacionEstado(c) === 'pendiente').length;
      $('statTotal').textContent = filtradas.length;
      $('statPendientes').textContent = esperando;
      $('statPendSub').textContent = 'esperando la respuesta del cliente';
      $('statMontoLbl').textContent = 'Monto aceptado';
      $('statMontoAprobado').textContent = FMT.money(montoAceptado);
      $('statMontoSub').textContent = (porFacturar ? `${porFacturar} por facturar` : 'todo lo aceptado ya se facturó') + ' · ' + alcance;
      $('statTasaLbl').textContent = 'Tasa de aceptación';
      $('statTasa').textContent = (oportunidadesT ? Math.round(nAceptadas / oportunidadesT * 100) : 0) + '%';
      $('statTasaSub').textContent = 'aceptadas / enviadas · ' + alcance;
      return;
    }
    $('statPendSub').textContent = 'requieren seguimiento';
    $('statMontoLbl').textContent = 'Monto cerrado';
    $('statTasaLbl').textContent = 'Tasa de cierre';
    $('statTasaSub').textContent = 'aceptadas / oportunidades · ' + alcance;
    // Los números de VENTAS no cuentan las reparaciones del taller: una
    // reparación aceptada no es una venta cerrada del vendedor.
    const ventas = visibles.filter(c => !esTallerC(c));
    const enviadas = srv ? srv.enviadas : ventas.filter(c => c.estado === 'enviada').length;
    // "Monto cerrado": solo cotizaciones convertidas a venta efectiva.
    // `c.total` es el valor evaluado, así que una cotización de alquiler entra
    // con su primer año de renta — es la única forma de sumarla con las ventas
    // de pago único. El subtítulo lo dice cuando hay alguna (eso sí se mira en
    // lo cargado: un rango sobre total_mensual pediría un índice compuesto).
    const convertidasList = ventas.filter(c => c.estado === 'convertida');
    const montoCerrado = srv ? srv.montoCerrado : convertidasList.reduce((s, c) => s + Number(c.total || 0), 0);
    const hayRentaCerrada = convertidasList.some(c => Number(c.total_mensual || 0) > 0);
    // Tasa de cierre: convertidas / oportunidades activas (enviadas + convertidas + rechazadas + vencidas).
    // Excluye borrador (en proceso) y aprobada (aún no llegó al cliente), y
    // también 'descartada': esa cotización se cerró por otro motivo (típico:
    // se rehace con otra cantidad) y contarla como perdida castigaría al
    // vendedor dos veces por la misma oportunidad.
    const convertidas = srv ? srv.convertidas : convertidasList.length;
    // Sin los rechazos del aprobador (ver esOportunidad).
    const oportunidades = srv ? srv.oportunidades : ventas.filter(esOportunidad).length;
    const tasa = oportunidades > 0 ? Math.round(convertidas / oportunidades * 100) : 0;
    // "Total emitidas" debe ser consonante con lo que el usuario ve: cuenta
    // exactamente las filas listadas (respeta filtros de estado/texto/eliminadas
    // y la paginación), no el set completo `visibles`.
    $('statTotal').textContent = filtradas.length;
    $('statPendientes').textContent = enviadas;
    $('statMontoAprobado').textContent = FMT.money(montoCerrado);
    const sub = $('statMontoSub');
    if (sub) sub.textContent = (hayRentaCerrada ? 'aceptadas · alquiler a 12 meses' : 'solo aceptadas por el cliente') + ' · ' + alcance;
    $('statTasa').textContent = tasa + '%';
  }

  function estadoChip(estado, motivo, doc) {
    const e = CotState.ESTADOS[estado] || CotState.ESTADOS.borrador;
    // Una cotización descartada sin el por qué a la vista obliga a abrirla:
    // el motivo que escribió el vendedor viaja en el tooltip del chip.
    const tip = motivo ? ` title="${FMT.esc(motivo)}"` : '';
    return `<span class="chip-estado ${e.chip}"${tip}>${FMT.esc(CotState.estadoLabel(estado, doc))}</span>`;
  }

  // ── Facturación de las cotizaciones de taller ─────────────────
  // `facturacion` lo escriben las Cloud Functions, nunca el navegador: nace
  // 'pendiente' cuando la orden se ENTREGA (onOrdenEntregada abre la fila en
  // Facturación pendiente) y pasa a 'facturada' cuando Recepción marca el paso
  // QBO con el número (onCotizacionFacturada). Una cotización sin el campo
  // simplemente no participa — las comerciales no se facturan por esta vía.
  function facturacionEstado(c) {
    const f = c.facturacion;
    if (!f || !f.estado) return null;
    return f.estado === 'facturada' ? 'facturada' : 'pendiente';
  }

  function facturacionChip(c) {
    const e = facturacionEstado(c);
    if (!e) return '';
    if (e === 'facturada') {
      const n = c.facturacion.factura;
      return `<span class="chip-estado chip-entregada" title="${n ? `Factura N.° ${FMT.esc(n)}` : 'Facturada, sin número anotado'}">Facturada${n ? ` ${FMT.esc(n)}` : ''}</span>`;
    }
    // Chip propio (cotizaciones-kit.css): antes compartía el naranja de "Vencida" (T1).
    return `<span class="chip-estado chip-cot-porfacturar" title="Está en la bandeja de Facturación pendiente de Recepción">Por facturar</span>`;
  }

  // ¿El usuario puede operar esta fila? Los roles con vista global mantienen sus
  // acciones sobre cualquier fila; el resto solo sobre las propias. Un supervisor
  // (allowlist cotizaciones_supervisores) ve todas las filas pero las ajenas en
  // solo-lectura — las reglas de Firestore le denegarían la escritura de todos modos.
  function puedeMutarFila(c) {
    return [ROLES.ADMIN, ROLES.JEFE_TALLER, ROLES.GERENTE].includes(userRol)
        || c.creado_por_uid === userUid;
  }

  // Botón de fila para un borrador, según rol + política de envío (espejo del
  // header de detalle-cotizacion): aprobar (aprobador) · enviar directo (vendedor
  // dentro de política) · solicitar aprobación (vendedor fuera de política).
  function botonBorrador(c) {
    if ((c.estado || 'borrador') !== 'borrador') return '';
    if (puedeAprobarCotizacion(userRol, c)) {
      return `<button class="btn btn-ghost btn-icon btn-sm" title="Aprobar y enviar" data-action="aprobar"><i data-lucide="check-circle"></i></button>`;
    }
    if (!canRole(userRol, 'enviar-cotizacion')) return '';
    // evaluarPolitica recalcula desde el documento — descuento por renglón y
    // alquiler proyectado incluidos. Armar el input a mano fue lo que hacía que
    // esta fila ofreciera "Enviar al cliente" para un borrador que el editor ya
    // había marcado como requiere_aprobacion.
    const pol = window.CotizacionTotales.evaluarPolitica(c, policyCfg);
    return pol.requiere
      ? `<button class="btn btn-ghost btn-icon btn-sm" title="Solicitar aprobación" data-action="solicitar"><i data-lucide="shield-check"></i></button>`
      : `<button class="btn btn-ghost btn-icon btn-sm" title="Enviar al cliente" data-action="enviar-directo"><i data-lucide="send"></i></button>`;
  }

  function renderTabla(lista) {
    const tbody = $('tablaCotizaciones');
    if (!tbody) return;
    tbody.innerHTML = lista.map(c => {
      const id = c.cotizacion_id || c.id;
      const total = FMT.money(Number(c.total || 0));
      const mutable = puedeMutarFila(c);
      // Fila eliminada (toggle "Mostrar eliminadas"): atenuada, con etiqueta y
      // solo Ver / Imprimir / Restaurar — sin Editar ni Duplicar (auditoría UX 2026-09-28, P0 #18).
      if (c.deleted) {
        return `
        <tr data-id="${c.id}" class="cc-row-eliminada">
          <td><span class="cc-cell-num">${id}</span></td>
          <td><div class="cc-cell-cliente">${c.cliente_nombre ? FMT.esc(c.cliente_nombre) : '—'}</div></td>
          <td class="td-muted">${fmtFechaCorta(fechaIso(c))}</td>
          <td><div style="display:flex;flex-wrap:wrap;gap:4px;"><span class="chip-estado chip-cot-eliminada">Eliminada</span>${estadoChip(c.estado || 'borrador', c.cierre_motivo || c.rechazo_motivo, c)}</div></td>
          <td style="font-size:13px;">${c.ejecutivo_nombre ? FMT.esc(c.ejecutivo_nombre) : '—'}</td>
          <td class="cc-cell-total">${total}</td>
          <td class="td-actions">
            <span class="cc-row-actions">
              <button class="btn btn-ghost btn-icon btn-sm" title="Ver" data-action="detalle"><i data-lucide="eye"></i></button>
              <button class="btn btn-ghost btn-icon btn-sm" title="Imprimir / PDF" data-action="imprimir"><i data-lucide="printer"></i></button>
              ${mutable ? `<button class="btn btn-secondary btn-sm" title="Restaurar la cotización" data-action="restaurar"><i data-lucide="rotate-ccw"></i> Restaurar</button>` : ''}
            </span>
          </td>
        </tr>`;
      }
      return `
        <tr data-id="${c.id}">
          <td><span class="cc-cell-num">${id}</span></td>
          <td>
            <div class="cc-cell-cliente">${c.cliente_nombre ? FMT.esc(c.cliente_nombre) : '—'}</div>
            ${c.cliente_email ? '<div class="cc-aten">' + FMT.esc(c.cliente_email) + '</div>' : ''}
          </td>
          <td class="td-muted">${fmtFechaCorta(fechaIso(c))}</td>
          <td><div style="display:flex;flex-wrap:wrap;gap:4px;">${filtroTipo === 'todas' && esTallerC(c) ? '<span class="chip-estado chip-cot-taller" title="Cotización de servicio técnico (taller)">Taller</span>' : ''}${estadoChip(c.estado || 'borrador', c.cierre_motivo || c.rechazo_motivo, c)}${facturacionChip(c)}</div></td>
          <td style="font-size:13px;">${c.ejecutivo_nombre ? FMT.esc(c.ejecutivo_nombre) : '—'}</td>
          <td class="cc-cell-total">${total}</td>
          <td class="td-actions">
            <span class="cc-row-actions">
              ${mutable ? botonBorrador(c) : ''}
              ${mutable && (c.estado === 'aprobada' || c.estado === 'enviada') ? (esTallerC(c)
                ? `<button class="btn btn-ghost btn-icon btn-sm" title="Respuesta del cliente (aceptó → a facturar)" data-action="cerrar"><i data-lucide="circle-check"></i></button>`
                : `<button class="btn btn-ghost btn-icon btn-sm" title="Cerrar cotización" data-action="cerrar"><i data-lucide="flag"></i></button>`) : ''}
              <button class="btn btn-ghost btn-icon btn-sm" title="Ver" data-action="detalle"><i data-lucide="eye"></i></button>
              ${mutable && CotState.esEditable(c.estado) ? `<button class="btn btn-ghost btn-icon btn-sm" title="Editar" data-action="editar"><i data-lucide="pencil"></i></button>` : ''}
              ${mutable && (c.estado === 'aprobada' || c.estado === 'enviada' || c.estado === 'convertida') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Reenviar al cliente" data-action="enviar"><i data-lucide="send"></i></button>` : ''}
              ${mutable ? `<button class="btn btn-ghost btn-icon btn-sm" title="Duplicar" data-action="duplicar"><i data-lucide="copy"></i></button>` : ''}
              <button class="btn btn-ghost btn-icon btn-sm" title="Imprimir / PDF" data-action="imprimir"><i data-lucide="printer"></i></button>
              ${mutable ? `<button class="btn btn-ghost btn-icon btn-sm" title="Eliminar" data-action="eliminar"><i data-lucide="trash-2"></i></button>` : ''}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderCards(lista) {
    const wrap = $('listaCotizacionesMovil');
    if (!wrap) return;
    wrap.innerHTML = lista.map(c => {
      const id = c.cotizacion_id || c.id;
      return `
        <div class="responsive-card${c.deleted ? ' cc-row-eliminada' : ''}" data-id="${c.id}">
          <div class="responsive-card-top">
            <div>
              <div class="responsive-card-title">${c.cliente_nombre ? FMT.esc(c.cliente_nombre) : '—'}</div>
              <div class="responsive-card-sub"><span class="cc-cell-num">${id}</span> · ${fmtFechaCorta(fechaIso(c))}</div>
            </div>
            ${c.deleted ? '<span class="chip-estado chip-cot-eliminada">Eliminada</span>' : estadoChip(c.estado || 'borrador', c.cierre_motivo || c.rechazo_motivo, c)}
          </div>
          <div class="responsive-card-meta">
            <span>${c.ejecutivo_nombre ? FMT.esc(c.ejecutivo_nombre) : '—'}</span>
            <span class="cc-cell-total">${FMT.money(Number(c.total || 0))}</span>
          </div>
          <div class="responsive-card-actions">
            <button class="btn btn-ghost btn-sm" data-action="detalle"><i data-lucide="eye"></i> Ver</button>
            ${!c.deleted && puedeMutarFila(c) && CotState.esEditable(c.estado) ? `<button class="btn btn-ghost btn-sm" data-action="editar"><i data-lucide="pencil"></i> Editar</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-action="imprimir"><i data-lucide="printer"></i> Imprimir</button>
            ${c.deleted && puedeMutarFila(c) ? `<button class="btn btn-secondary btn-sm" data-action="restaurar"><i data-lucide="rotate-ccw"></i> Restaurar</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
      const k = th.dataset.sort;
      const active = sortKey === k;
      const icon = th.querySelector('.sort-icon i');
      if (icon) {
        icon.setAttribute('data-lucide', active && sortDir === 'asc' ? 'chevron-up' : 'chevron-down');
        th.querySelector('.sort-icon').style.opacity = active ? '1' : '0.35';
      }
    });
  }

  // ── Acciones ──────────────────────────────────────────────────
  async function onAction(action, docId, btn) {
    const cot = cotizaciones.find(c => c.id === docId);
    if (!cot) return;
    if (action === 'detalle')  { location.href = `detalle-cotizacion.html?id=${encodeURIComponent(docId)}`; return; }
    if (action === 'editar')   { location.href = `editar-cotizacion.html?id=${encodeURIComponent(docId)}`; return; }
    if (action === 'imprimir') { window.open(`imprimir-cotizacion.html?id=${encodeURIComponent(docId)}`, '_blank'); return; }
    if (action === 'duplicar') { return await duplicar(cot); }
    if (action === 'eliminar') { return await eliminar(cot); }
    if (action === 'enviar')   { return await enviar(cot, btn); }
    if (action === 'enviar-directo') { return await enviar(cot, btn); } // envío directo del vendedor (borrador→enviada)
    if (action === 'restaurar') { return await restaurar(cot, btn); }
    if (action === 'solicitar') { return await solicitarAprobacion(cot); }
    if (action === 'aprobar')  { return openAprobacion(cot.id); }
    if (action === 'cerrar')   { return await cerrarDesdeLista(cot); }
  }

  // Notifica al aprobador que un borrador fuera de política espera revisión.
  async function solicitarAprobacion(cot) {
    const pol = window.CotizacionTotales.evaluarPolitica(cot, policyCfg);
    const ok = await Modal.confirm({
      title: 'Solicitar aprobación',
      message: 'Esta cotización supera los límites para envío directo:\n\n• ' +
        pol.motivos.join('\n• ') +
        '\n\nSe notificará a un aprobador para que la revise y la envíe al cliente.',
    });
    if (!ok) return;
    try {
      const doc = await CotizacionesService.getCotizacion(cot.id);
      await CotState.enqueueAprobacionMail({ doc, docId: cot.id, user: firebase.auth().currentUser });
      Toast.show('Solicitud de aprobación enviada.', 'ok');
    } catch (e) {
      Toast.show('No se pudo enviar la solicitud: ' + (e?.message || e), 'bad');
    }
  }

  async function cerrarDesdeLista(cot) {
    const taller = esTallerC(cot);
    const cierre = await CotState.cerrarPrompt({
      cotizacionId: cot.cotizacion_id || cot.id,
      total: Number(cot.total || 0),
      cliente: cot.cliente_nombre || '',
      taller,
      reposicion: !!cot.gestion_id,
    });
    if (!cierre) return;
    const desenlace = cierre.estado;
    const patch = CotState.patchCierre(desenlace, cierre.motivo, userUid, cierre.aceptacion || null);
    try {
      await CotizacionesService.updateCotizacion(cot.id, patch);
      // La fila se repinta desde `cotizaciones` en memoria: entra el patch
      // completo para que el chip muestre el motivo en su tooltip.
      Object.assign(cot, patch);
      Toast.show(CotState.cierreToast(desenlace, { taller }), desenlace === 'convertida' ? 'ok' : 'warn');
      render();
    } catch (e) {
      Toast.show('No se pudo cerrar: ' + (e?.message || e), 'bad');
    }
  }

  // Candado estándar (js/ui/busy.js) — auditoría UX 2026-09-28, T3/#8: generar
  // el link tarda y sin candado el segundo click abría dos paneles de envío.
  function conCandado(btn, fn, opts = {}) {
    if (typeof window.withBusy === 'function') {
      return window.withBusy(btn, fn, { toast: false, rethrow: false, ...opts });
    }
    return fn();
  }

  function enviar(cot, btn) {
    // Botón de icono: sin texto nuevo, el icono gira (cotizaciones-kit.css .is-busy).
    return conCandado(btn, () => _enviar(cot), { label: false });
  }

  async function _enviar(cot) {
    // Pre-cargar link público (puede tardar un instante) antes de mostrar preview.
    let link;
    try { link = await ensureLinkPublico(cot.id); }
    catch (e) { Toast.show('No se pudo generar el link público: ' + (e?.message || e), 'bad'); return; }

    const cartaAplica = !CotState.esCotizacionDeTaller(cot);
    const payload = await CotState.reenviarPrompt({
      cotizacionId: cot.cotizacion_id || cot.id,
      clienteNombre: cot.cliente_nombre || '',
      total: Number(cot.total || 0),
      dirigidoA: cot.dirigido_a || '',
      defaultDest: cot.dirigido_email || cot.cliente_email || '',
      ccEmail: cot.creado_por_email || '',
      intro: cot.intro || '',
      validezDias: cot.validezDias || 15,
      ejecutivo: cot.ejecutivo_nombre || '',
      ejecutivoCargo: CotizacionTaller.cargoFirmante(cot, null),
      doc: cot,
      link,
      adjuntos: cot.adjuntos || [],
      llevaCarta: cartaAplica ? CotState.llevaCarta(cot) : null,
    });
    if (!payload) return;

    // Igual que en el detalle: lo que se marque en el panel manda. Se persiste y
    // se reescribe el espejo (ensureLinkPublico relee el documento).
    if (cartaAplica && payload.llevaCarta !== CotState.llevaCarta(cot)) {
      const anterior = cot.incluye_carta;
      try {
        cot.incluye_carta = payload.llevaCarta;
        await CotizacionesService.updateCotizacion(cot.id, { incluye_carta: payload.llevaCarta });
        await ensureLinkPublico(cot.id);
      } catch (e) {
        cot.incluye_carta = anterior;
        Toast.show('No se pudo aplicar el cambio de carta de presentación: ' + (e?.message || e), 'bad');
        return;
      }
    }

    try {
      await CotizacionesService.enviarPorCorreo(cot.id, {
        to: payload.dest,
        cc: cot.creado_por_email || null,
        subject: payload.subject,
        html: payload.html,
        attachments: CotState.adjuntosToAttachments(cot.adjuntos),
        replyTo: CotState.replyToDe({ ejecutivoEmail: cot.ejecutivo_email, creadoPorEmail: cot.creado_por_email }),
      });
      cot.estado = 'enviada';
      Toast.show('Cotización enviada a ' + payload.dest, 'ok');
      render();
    } catch (err) {
      Toast.show('Error al enviar: ' + (err?.message || err), 'bad');
    }
  }

  // Duplicar: la MISMA implementación que el detalle (CotState.duplicar →
  // toDoc, lista blanca de campos; auditoría UX 2026-09-28 §4.5 #12). Antes
  // la lista copiaba el doc crudo y borraba a mano los campos del ciclo de vida.
  function duplicar(src) {
    return CotState.duplicar({ raw: src, rol: userRol, policy: policyCfg });
  }

  async function eliminar(cot) {
    const ok = await Modal.confirm({
      title: 'Eliminar cotización',
      message: '¿Seguro que deseas eliminar ' + (cot.cotizacion_id || cot.id) + '? Podrás restaurarla desde "Mostrar eliminadas".',
      danger: true,
    });
    if (!ok) return;
    try {
      await CotizacionesService.softDelete(cot.id);
      cot.deleted = true;
      Toast.show('Cotización eliminada', 'warn');
      render();
    } catch (e) {
      Toast.show('No se pudo eliminar: ' + (e?.message || e), 'bad');
    }
  }

  // "Restaurar" (auditoría UX 2026-09-28, P0 #18): el diálogo de borrar lo
  // prometía y nadie llamaba a CotizacionesService.restore.
  function restaurar(cot, btn) {
    return conCandado(btn, async () => {
      try {
        await CotizacionesService.restore(cot.id);
        cot.deleted = false;
        delete cot.deleted_at;
        Toast.show('Cotización ' + (cot.cotizacion_id || '') + ' restaurada', 'ok');
        render();
      } catch (e) {
        Toast.show('No se pudo restaurar: ' + (e?.message || e), 'bad');
      }
    }, { label: false });
  }

  // ── Helpers de envío público ──────────────────────────────────
  // El espejo público y el modal de aprobación viven en cot-aprobacion.js,
  // compartidos con el detalle (auditoría UX 2026-09-28, #11).
  const ensureLinkPublico = (docId) => CotAprobacion.ensureLinkPublico(docId);

  function openAprobacion(docId) {
    return CotAprobacion.abrir(docId, {
      rol: userRol, uid: userUid, policy: policyCfg,
      onDone: async () => { await cargarCotizaciones(true); if (soloPorAprobar) await cargarPorAprobar(); },
    });
  }

  // Trae TODOS los borradores que esperan aprobación (mismo query que la señal
  // SAP, índice estado+requiere_aprobacion), no solo los de las 30 cargadas.
  async function cargarPorAprobar() {
    try {
      let q = firebase.firestore().collection('cotizaciones')
        .where('estado', '==', 'borrador')
        .where('requiere_aprobacion', '==', true);
      // Un vendedor solo puede listar las suyas (rules).
      if (userRol === ROLES.VENDEDOR && !esSupervisor) q = q.where('creado_por_uid', '==', userUid);
      const snap = await q.limit(200).get();
      let nuevas = false;
      snap.forEach(d => {
        if (!cotizaciones.some(c => c.id === d.id)) { cotizaciones.push({ id: d.id, ...d.data() }); nuevas = true; }
      });
      if (nuevas) render();
    } catch (e) { console.warn('No se pudieron traer las cotizaciones por aprobar:', e); }
  }

  // Atajo por número (auditoría): la búsqueda filtra solo lo paginado en
  // memoria — encontrar una COT vieja obligaba a martillar "Cargar más" de
  // 30 en 30. Si el término es un número COT completo y no está cargado,
  // se trae con una query directa y entra a la lista.
  let _cotLookupPend = null;
  async function lookupPorNumero() {
    const term = ($('filtroTexto').value || '').trim().toUpperCase();
    if (!/^COT-\d{4}-\d+$/.test(term)) return;
    if (cotizaciones.some(c => (c.cotizacion_id || '').toUpperCase() === term)) return;
    if (_cotLookupPend === term) return;
    _cotLookupPend = term;
    try {
      const snap = await firebase.firestore().collection('cotizaciones')
        .where('cotizacion_id', '==', term).limit(2).get();
      let nuevas = false;
      snap.forEach(d => {
        if (!cotizaciones.some(c => c.id === d.id)) {
          cotizaciones.push({ id: d.id, ...d.data() });
          nuevas = true;
        }
      });
      if (nuevas) render();
    } catch (e) { console.warn('Lookup por número COT falló:', e); }
  }

  // Búsqueda EN EL SERVIDOR por searchTokens (auditoría UX 2026-09-28 T6 /
  // §4.5 #12): la caja filtraba solo lo paginado, y una cotización vieja por
  // cliente obligaba a martillar "Cargar más". Los tokens los estampa
  // onCotizacionSearchTokens (prefijos de cliente y vendedor, número COT).
  // Los hits entran a la lista en memoria (como el atajo por número) y
  // getFiltradas los refina con includes(); si la query falla (índice o
  // backfill pendientes), la búsqueda sobre lo cargado sigue funcionando.
  let _busqTimer = null;
  let _busqUltima = '';
  function onBuscarInput() {
    render();
    lookupPorNumero();
    clearTimeout(_busqTimer);
    _busqTimer = setTimeout(buscarEnServidor, 300);
  }
  async function buscarEnServidor() {
    const term = ($('filtroTexto').value || '').trim();
    if (term.length < 2 || _busqUltima === term) return;
    _busqUltima = term;
    try {
      const uidFiltro = (userRol === ROLES.VENDEDOR && !esSupervisor) ? userUid : null;
      const hits = await CotizacionesService.searchByToken(term, { creadoPorUid: uidFiltro });
      if (agregarALista(hits)) render();
    } catch (e) { console.warn('Búsqueda por tokens no disponible aún (¿índice o backfill pendientes?):', e?.code || e); }
  }

  // ?estado=activas (señal S7 del home): borrador + enviada + aprobada, TODAS
  // las del alcance y no solo las que caben en la primera página de 30.
  const ESTADOS_ACTIVOS = ['borrador', 'enviada', 'aprobada'];
  const esActiva = (c) => ESTADOS_ACTIVOS.includes(c.estado || 'borrador');
  async function cargarActivas() {
    try {
      const uidFiltro = (userRol === ROLES.VENDEDOR && !esSupervisor) ? userUid : null;
      const docs = await CotizacionesService.listPorEstados(ESTADOS_ACTIVOS, { creadoPorUid: uidFiltro });
      if (agregarALista(docs)) render();
    } catch (e) { console.warn('No se pudieron traer las cotizaciones activas:', e?.code || e); }
  }

  // Suma a la lista en memoria lo que no esté ya (por id). Devuelve si entró algo.
  function agregarALista(docs) {
    let nuevas = false;
    (docs || []).forEach(d => {
      if (!cotizaciones.some(c => c.id === d.id)) { cotizaciones.push(d); nuevas = true; }
    });
    return nuevas;
  }

  // Rango de fecha de creación. Un <input type="date"> da "AAAA-MM-DD" sin
  // zona: se lee como día de Panamá (UTC-5 fijo). `hasta` es EXCLUSIVO (la
  // medianoche del día siguiente) para que "hasta hoy" incluya la tarde.
  function fechaDeInput(id, diasMas = 0) {
    const v = ($(id)?.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(v + 'T00:00:00-05:00');
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + diasMas);
    return d;
  }
  function rangoFechas() {
    let desde = fechaDeInput('filtroDesde');
    let hasta = fechaDeInput('filtroHasta', 1);
    // Rango al revés = la persona invirtió los campos; se corrige, no se castiga.
    if (desde && hasta && desde >= hasta) { desde = fechaDeInput('filtroHasta'); hasta = fechaDeInput('filtroDesde', 1); }
    return { desde, hasta };
  }

  // ── Eventos ───────────────────────────────────────────────────
  function bindEvents() {
    $('filtroTexto').addEventListener('input', onBuscarInput);
    ['filtroDesde', 'filtroHasta'].forEach(id => $(id)?.addEventListener('change', () => cargarCotizaciones(true)));
    $('toggleEliminadas').addEventListener('change', render);
    $('toggleMias').addEventListener('change', (e) => { soloMias = e.target.checked; render(); });
    $('btnCargarMas').addEventListener('click', () => cargarCotizaciones(false));
    // Los botones del modal de aprobación los enlaza cot-aprobacion.js.
    const btnVerTodas = $('btnQuitarPorAprobar');
    if (btnVerTodas) btnVerTodas.addEventListener('click', () => {
      soloPorAprobar = false;
      const url = new URL(window.location);
      url.searchParams.delete('aprobar');
      window.history.replaceState({}, document.title, url.toString());
      render();
    });

    $('tipoSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tipo]');
      if (!btn) return;
      filtroTipo = btn.dataset.tipo;
      // Un segmento de facturación no existe en Ventas: se vuelve a "Todas".
      if (filtroTipo === 'ventas' && ['por_facturar', 'facturadas'].includes(filtroEstado)) filtroEstado = 'todas';
      try { sessionStorage.setItem('cotTipo', filtroTipo); } catch (_) { /* preferencia de sesión */ }
      render();
    });

    $('segments').addEventListener('click', (e) => {
      const btn = e.target.closest('.cc-seg');
      if (!btn) return;
      filtroEstado = btn.dataset.estado;
      render();
    });

    document.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
        else { sortKey = k; sortDir = 'asc'; }
        render();
      });
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      if (!row) return;
      onAction(btn.dataset.action, row.dataset.id, btn);
    });

    // Click en fila (no en botones) → detalle
    document.querySelector('#tablaCotizaciones').addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      const row = e.target.closest('tr[data-id]');
      if (row) location.href = `detalle-cotizacion.html?id=${encodeURIComponent(row.dataset.id)}`;
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    userUid = user.uid;
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      userRol = rol;
      // Supervisores (empresa/config.cotizaciones_supervisores): entran sin
      // importar su rol y ven TODAS las cotizaciones en solo-lectura.
      // EMPRESA_CONFIG lo deja cargado firebase-init antes de este callback.
      const cfg = window.EMPRESA_CONFIG || await EmpresaService.getConfig();
      esSupervisor = (cfg.cotizaciones_supervisores || [])
        .some(e => String(e).toLowerCase() === (user.email || '').toLowerCase());
      const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR, ROLES.JEFE_TALLER, ROLES.GERENTE];
      if (!permitidos.includes(rol) && !esSupervisor) { Toast.show('Sin acceso', 'bad'); location.href = '../index.html'; return; }

      // Vendedor: forzar "solo mías" y ocultar el toggle (salvo supervisor). Admin: mostrarlo.
      if (rol === ROLES.VENDEDOR && !esSupervisor) {
        soloMias = true;
        $('wrapToggleMias').style.display = 'none';
      } else {
        $('wrapToggleMias').style.display = '';
        soloMias = false;
      }

      // "Nueva cotización" solo para los roles que el editor deja entrar
      // (cot-editor.js): el gerente la veía y el editor lo expulsaba (auditoría UX 2026-09-28, #6).
      const rolesEditor = [ROLES.ADMIN, ROLES.VENDEDOR, ROLES.JEFE_TALLER];
      const btnNueva = $('btnNuevaCot');
      if (btnNueva && !rolesEditor.includes(rol)) btnNueva.style.display = 'none';

      try { policyCfg = window.CotizacionTotales.policyFromConfig(cfg); }
      catch (e) { policyCfg = window.CotizacionTotales.POLICY_DEFAULT; }

      // Deep-link ?estado= (señales del home, p.ej. S6 "enviadas"): aterrizar
      // con el segmento ya aplicado en vez de mostrar "Todas" y obligar a
      // filtrar a mano lo que la señal ya prometía.
      // Vista por defecto según quién entra: la jefa de taller trabaja sus
      // reparaciones; un vendedor, sus propuestas. `?tipo=` y la última
      // elección de la sesión mandan sobre eso.
      const tipoParam = new URLSearchParams(location.search).get('tipo');
      let tipoSesion = null;
      try { tipoSesion = sessionStorage.getItem('cotTipo'); } catch (_) { /* sin storage */ }
      filtroTipo = ['taller', 'ventas', 'todas'].includes(tipoParam) ? tipoParam
        : ['taller', 'ventas', 'todas'].includes(tipoSesion) ? tipoSesion
        : rol === ROLES.JEFE_TALLER ? 'taller'
        : rol === ROLES.VENDEDOR ? 'ventas' : 'todas';

      const estadoParam = new URLSearchParams(location.search).get('estado');
      if (estadoParam && (estadoParam === 'todas' || estadoParam === 'activas' || CotState.ESTADO_ORDEN.includes(estadoParam))) {
        filtroEstado = estadoParam;
      }

      bindEvents();
      await cargarCotizaciones(true);
      // La señal S7 promete TODAS las activas: se completan tras la primera página.
      if (filtroEstado === 'activas') await cargarActivas();

      // Manejo de ?aprobar=<docId> (CTA desde correo de solicitud). El permiso se
      // valida dentro de openAprobacion según el tipo de cotización (servicio vs
      // comercial), ya que requiere leer el doc primero.
      const params = new URLSearchParams(location.search);
      const aprobarId = params.get('aprobar');
      if (aprobarId === '1') {
        // Filtro de la señal SAP (no es un docId): se queda en la URL.
        soloPorAprobar = true;
        filtroEstado = 'borrador';
        render();
        await cargarPorAprobar();
      } else if (aprobarId) {
        openAprobacion(aprobarId);
        const url = new URL(window.location);
        url.searchParams.delete('aprobar');
        window.history.replaceState({}, document.title, url.toString());
      }
    });
  });
})();

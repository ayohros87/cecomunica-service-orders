// @ts-nocheck
// Comisiones (Finanzas · Comisiones) — F2 de docs/plans/PLAN_COMISIONES.md.
//
// El botón viejo `listo_para_comision` era un booleano que administración
// prendía a mano después de revisar firma, pago y entrega contrato por
// contrato. Aquí el chip verde NO lo prende nadie: sale de los tres requisitos
// que el backend deriva (lib/facturacionAvisos). Lo único que una persona
// decide es CERRAR EL PERÍODO — y queda quién y cuándo.
//
// Una fila por hecho comisionable, agrupada por vendedor. La fila dice, en
// este orden: en qué estado está (única voz de color), de quién y qué evento,
// qué requisito falta y POR QUÉ, y la base. El detalle abre el formulario del
// pago y el cierre.
//
// Roles: FacturacionAvisosService.ROLES_COMISION (admin/contabilidad). A
// diferencia de la Bandeja, recepción no entra: liberar plata es otra decisión.
// Deep-link: ?aviso=<id> abre la fila.

window.FacturacionComisiones = (() => {
  const S = () => window.FacturacionAvisosService;
  const esc = (s) => FMT.esc(s);
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let rol = null;
  let todas = [];
  let filtro = 'abiertas';
  let periodo = '';        // '' = todos; 'YYYY-MM' de fecha_efectiva
  let busqueda = '';
  let abierto = null;
  let enVuelo = false;
  // Cierre en lote (auditoría UX 2026-09-28, 4.8 #8): ids elegidos en la vista
  // "Listas para pago". Antes eran 5-6 clics POR comisión al pagar la planilla.
  const seleccion = new Set();

  const toDate = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fCorta(v) {
    const d = toDate(v); if (!d || isNaN(d)) return '—';
    return `${d.getDate()} ${MESES[d.getMonth()]}`;
  }
  function mesDe(v) {
    const d = toDate(v); if (!d || isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function mesLabel(ym) {
    if (!ym) return '—';
    const [a, m] = ym.split('-');
    return `${MESES_LARGO[Number(m) - 1] || m} ${a}`;
  }
  // Mes en curso en hora de Panamá (no UTC: un cierre del día 1 caería al mes
  // anterior — la misma trampa del correlativo de contratos; T8 de la
  // auditoría UX 2026-09-28).
  function mesHoy() {
    return FMT.hoyISOPanama().slice(0, 7);
  }

  const REQ_LABEL = { firma: 'firma', entrega: 'entrega', pago: 'pago' };

  // ── Datos derivados ─────────────────────────────────────────────────────
  const est = (a) => S().estadoComision(a.comision || {});
  const esAbierta = (a) => ['esperando', 'listo'].includes(est(a));
  const sinVendedor = (a) => a.comision?.aplica === true && !a.comision.vendedor_email;
  // Solo falta el PAGO (firma y entrega ya están, o no aplican): es la fila
  // que Cheila o Zuleika confirman en lote con el estado de cuenta (decisión
  // 16 de Alberto, 1-oct-2026). 37 de las 45 abiertas estaban así.
  const soloFaltaPago = (a) => {
    if (est(a) !== 'esperando' || !a.comision?.vendedor_email) return false;
    const f = S().faltantes(a.comision);
    return f.length > 0 && f.every(x => x.paso === 'pago');
  };
  // Qué fila lleva casilla en el modo lote de la vista actual.
  const elegible = (a) => (filtro === 'listo' ? est(a) === 'listo' : (filtro === 'pago' ? soloFaltaPago(a) : false));

  function pasaFiltro(a) {
    const e = est(a);
    if (filtro === 'abiertas') return esAbierta(a);
    if (filtro === 'sinvend') return sinVendedor(a) && esAbierta(a);
    if (filtro === 'pago') return soloFaltaPago(a);
    return e === filtro;
  }
  function pasaPeriodo(a) {
    if (!periodo) return true;
    // Una comisión cerrada se ubica por su PERÍODO (es el mes en que se pagó);
    // una abierta, por la fecha efectiva del hecho.
    return est(a) === 'pagada'
      ? (a.comision.periodo || mesDe(a.fecha_efectiva)) === periodo
      : mesDe(a.fecha_efectiva) === periodo;
  }
  function pasaBusqueda(a) {
    if (!busqueda) return true;
    const t = busqueda.toLowerCase();
    return [a.cliente_nombre, a.contrato_id, a.gestion_id, a.comision?.vendedor_email, a.titulo]
      .some(x => String(x || '').toLowerCase().includes(t));
  }

  function visibles() {
    return todas.filter(a => a.comision && pasaFiltro(a) && pasaPeriodo(a) && pasaBusqueda(a));
  }

  // ── Render ──────────────────────────────────────────────────────────────
  function reqHtml(com) {
    const r = com.requisitos || {};
    return ['firma', 'entrega', 'pago'].map(k => {
      const x = r[k];
      if (!x) return '';
      if (!x.aplica) {
        return `<span class="cm-req n" title="${esc(x.motivo || 'no aplica')}">— ${REQ_LABEL[k]} <em>(no aplica)</em></span>`;
      }
      if (x.hecho) {
        const extra = k === 'pago' && x.factura ? ` fact. ${esc(x.factura)}` : (x.at ? ` ${fCorta(x.at)}` : '');
        return `<span class="cm-req"><span class="g">✓</span> ${REQ_LABEL[k]}${extra}</span>`;
      }
      return `<span class="cm-req" title="${esc(x.motivo || '')}"><span class="w">•</span> ${REQ_LABEL[k]} pendiente</span>`;
    }).join('');
  }

  function filaHtml(a) {
    const com = a.comision;
    const e = est(a);
    const abiertaFila = abierto === a.id;
    const ref = a.contrato_id || a.gestion_id || a.id;
    const estTxt = { listo: 'Listo', esperando: 'Esperando', pagada: 'Pagada', no_aplica: 'No aplica' }[e] || e;
    const conSel = modoLote();
    const sel = conSel && elegible(a)
      ? `<label class="cm-sel" onclick="event.stopPropagation()" title="${filtro === 'pago' ? 'Incluir en la confirmación de pagos en lote' : 'Incluir en el cierre en lote'}"><input type="checkbox" data-sel="${esc(a.id)}" ${seleccion.has(a.id) ? 'checked' : ''} aria-label="Seleccionar"></label>`
      : (conSel ? '<span></span>' : '');
    return `<div class="cm-row ${abiertaFila ? 'is-open' : ''} ${e === 'pagada' ? 'is-pagada' : ''}" data-row="${esc(a.id)}">
      <div class="cm-main${conSel ? ' cm-main--sel' : ''}" onclick="FacturacionComisiones.toggle('${esc(a.id)}')">
        ${sel}<span class="cm-est cm-est--${e}">${estTxt}</span>
        <div class="cm-txt">
          <div class="cm-t1"><b>${esc(a.cliente_nombre || '—')}</b>
            <span class="id">${esc(ref)}</span>
            <span class="que">· ${esc(a.titulo || a.tipo || '')}</span></div>
          <div class="cm-t2">${com.aplica === false
            ? `<span class="cm-req n">${esc(com.motivo || 'no paga comisión')}</span>`
            : reqHtml(com)}</div>
        </div>
        <div class="cm-base">${com.base == null ? '—' : money(com.base)}<small>${com.base == null
          ? 'base en QuickBooks' : (com.base_de === 'delta_mensual' ? 'delta/mes' : 'mensual')}</small></div>
        <span class="cm-caret">${abiertaFila ? '▾' : '▸'}</span>
      </div>
      ${abiertaFila ? detalleHtml(a) : ''}
    </div>`;
  }

  function detalleHtml(a) {
    const com = a.comision;
    const r = com.requisitos || {};
    const e = est(a);
    const d = (l, v) => v ? `<div class="cm-d"><span>${l}</span><span>${v}</span></div>` : '';
    const puede = S().puedeComisionar(rol);
    const faltan = S().faltantes(com);

    const datos = `<div class="cm-grid">
      ${d('Evento', esc(a.titulo || a.tipo))}
      ${d('Fecha efectiva', a.fecha_efectiva ? fCorta(a.fecha_efectiva) + ' ' + (toDate(a.fecha_efectiva)?.getFullYear() || '') : '')}
      ${d('Vendedor', com.vendedor_email ? esc(com.vendedor_email)
        : '<b style="color:#991B1B;">sin vendedor — no se le puede pagar a nadie</b>')}
      ${d('Base', com.base == null ? 'la da la factura de venta (QuickBooks)' : money(com.base))}
      ${d('Equipos', esc(a.resumen?.equipos || ''))}
      ${d('Factura del pago', r.pago?.factura ? esc(r.pago.factura) : '')}
      ${d('Período', com.periodo ? mesLabel(com.periodo) : '')}
      ${d('Liberada por', com.liberada_por ? `${esc(com.liberada_por)}${com.liberada_at ? ' · ' + fCorta(com.liberada_at) : ''}` : '')}
      ${d('Nota', esc(com.nota || ''))}
    </div>`;

    const porQue = faltan.length
      ? `<p style="font-size:12.5px;color:#8A6415;margin:0 0 8px;"><b>Falta:</b> ${faltan
          .map(f => `${REQ_LABEL[f.paso]} — ${esc(f.motivo)}`).join(' · ')}</p>`
      : '';

    // Acciones. El "listo" no se prende a mano en ningún caso: si falta algo,
    // lo que se ofrece es marcar el pago (el único requisito que no se deriva).
    let acciones = '';
    if (com.aplica === false) {
      acciones = `<p style="font-size:12.5px;color:var(--fg-3);margin:0;">Este evento no paga comisión: ${esc(com.motivo || '')}.</p>`;
    } else if (!puede) {
      acciones = `<p style="font-size:12.5px;color:var(--fg-3);margin:0;">Solo administración y contabilidad mueven comisiones.</p>`;
    } else if (e === 'pagada') {
      acciones = `<div class="cm-acts"><span class="sep"></span>
        <button type="button" class="btn btn-ghost btn-sm" onclick="FacturacionComisiones.reabrir('${esc(a.id)}')">
          <i data-lucide="rotate-ccw"></i> Reabrir el período</button></div>`;
    } else {
      const pagoHecho = r.pago?.hecho === true;
      const listo = e === 'listo';
      acciones = `<div class="cm-acts">
        ${!pagoHecho
          ? `<button type="button" class="btn btn-primary btn-sm" onclick="FacturacionComisiones.formPago('${esc(a.id)}')">
              <i data-lucide="check"></i> Confirmar el primer pago</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" onclick="FacturacionComisiones.deshacerPago('${esc(a.id)}')">
              <i data-lucide="undo-2"></i> Deshacer el pago</button>`}
        <span class="sep"></span>
        <button type="button" class="btn ${listo ? 'btn-primary' : 'btn-ghost'} btn-sm" ${listo ? '' : 'disabled'}
          title="${listo ? 'Marca esta comisión como pagada en un período' : 'Todavía falta un requisito'}"
          onclick="FacturacionComisiones.formCierre('${esc(a.id)}')">
          <i data-lucide="badge-dollar-sign"></i> Cerrar el período</button>
      </div>
      <div id="cmForm-${esc(a.id)}"></div>`;
    }

    const hist = (a.historial || []).filter(h => String(h.accion || '').startsWith('comision'));
    const historial = hist.length ? `<div class="cm-hist"><h5>Rastro de la comisión</h5><ul>
      ${hist.slice(-6).reverse().map(h => `<li>${esc(h.detalle || h.accion)}
        <span>· ${esc((h.fecha_iso || '').slice(0, 10))}${h.por_email ? ' · ' + esc(h.por_email) : ''}</span></li>`).join('')}
      </ul></div>` : '';

    return `<div class="cm-det">${datos}${porQue}${acciones}${historial}</div>`;
  }

  // El encabezado del grupo lleva el nombre, no el correo entero en
  // mayúsculas: "ELVIA.ONODERA@CECOMUNICA.COM" grita y ocupa media línea. El
  // correo completo queda en el title (y en el CSV, que es lo que se paga).
  function vendedorCorto(email) {
    const local = String(email || '').split('@')[0];
    return local.replace(/[._-]+/g, ' ').trim() || email;
  }

  function grupoHtml(vendedor, filas) {
    const sin = vendedor === '(sin vendedor)';
    const abiertas = filas.filter(esAbierta);
    const total = abiertas.reduce((s, a) => s + Number(a.comision.base || 0), 0);
    const listas = filas.filter(a => est(a) === 'listo').length;
    const elegibles = filas.filter(elegible).length;
    return `<div class="cm-grupo">
      <div class="cm-gh">
        <span class="who ${sin ? 'sin' : ''}" title="${esc(sin ? 'estas comisiones no tienen a quién pagarse' : vendedor)}">${
          esc(sin ? 'SIN VENDEDOR ASIGNADO' : vendedorCorto(vendedor))}</span>
        <span class="meta">${filas.length} evento${filas.length === 1 ? '' : 's'}${listas ? ` · ${listas} lista${listas === 1 ? '' : 's'} para pago` : ''}</span>
        ${abiertas.length ? `<span class="tot">${money(total)} en base abierta</span>` : ''}
        ${modoLote() && !sin && elegibles ? `<button type="button" class="btn btn-ghost btn-sm" data-sel-vendedor="${esc(vendedor)}">Seleccionar sus ${elegibles}</button>` : ''}
      </div>
      <div class="cm-rows">${filas.map(filaHtml).join('')}</div>
    </div>`;
  }

  // El lote existe en "Listas para pago" (cerrar período) y en "Falta el pago"
  // (confirmar el primer pago), solo para quien puede liberar.
  function modoLote() { return ['listo', 'pago'].includes(filtro) && S().puedeComisionar(rol); }

  function pintarLote() {
    const box = document.getElementById('cmLote');
    if (!box) return;
    if (!modoLote()) { box.hidden = true; box.innerHTML = ''; return; }
    const elegidas = todas.filter(a => seleccion.has(a.id));
    const base = elegidas.reduce((s, a) => s + Number(a.comision?.base || 0), 0);
    if (filtro === 'pago') {
      // Confirmación del primer pago en lote (decisión 16 de Alberto, 1-oct-2026):
      // una fecha para el lote y el número de factura por fila en la hoja.
      const hoy = FMT.hoyISOPanama();
      const fAnterior = document.getElementById('cmLoteF')?.value || hoy;
      box.hidden = false;
      box.innerHTML = `
        <span class="cm-lote-n"><b>${elegidas.length}</b> seleccionada${elegidas.length === 1 ? '' : 's'}${elegidas.length ? ` · base ${money(base)}` : ''}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-lote="todas">Todas las visibles</button>
        <button type="button" class="btn btn-ghost btn-sm" data-lote="ninguna" ${elegidas.length ? '' : 'disabled'}>Ninguna</button>
        <span class="sep"></span>
        <label for="cmLoteF">Fecha del pago</label>
        <input type="date" id="cmLoteF" class="form-input" value="${esc(fAnterior)}" max="${hoy}" style="width:150px;">
        <button type="button" class="btn btn-primary btn-sm" id="cmLotePagoBtn" ${elegidas.length ? '' : 'disabled'}>
          <i data-lucide="check"></i> Confirmar ${elegidas.length || ''} pago${elegidas.length === 1 ? '' : 's'}…</button>`;
      return;
    }
    const meses = [...new Set([mesHoy(), ...elegidas.map(a => mesDe(a.fecha_efectiva)).filter(Boolean)])].sort().reverse();
    const pAnterior = document.getElementById('cmLoteP')?.value;
    const nAnterior = document.getElementById('cmLoteN')?.value || '';
    box.hidden = false;
    box.innerHTML = `
      <span class="cm-lote-n"><b>${elegidas.length}</b> seleccionada${elegidas.length === 1 ? '' : 's'}${elegidas.length ? ` · base ${money(base)}` : ''}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-lote="todas">Todas las visibles</button>
      <button type="button" class="btn btn-ghost btn-sm" data-lote="ninguna" ${elegidas.length ? '' : 'disabled'}>Ninguna</button>
      <span class="sep"></span>
      <label for="cmLoteP">Período</label>
      <select id="cmLoteP" class="form-select" style="width:160px;">
        ${meses.map(m => `<option value="${m}" ${m === pAnterior ? 'selected' : ''}>${mesLabel(m)}</option>`).join('')}
      </select>
      <input id="cmLoteN" class="form-input" placeholder="Nota (planilla, quincena…)" autocomplete="off" style="width:200px;" value="${esc(nAnterior)}">
      <button type="button" class="btn btn-primary btn-sm" id="cmLoteBtn" ${elegidas.length ? '' : 'disabled'}>
        <i data-lucide="badge-dollar-sign"></i> Cerrar seleccionadas</button>`;
  }

  async function cerrarLote() {
    const elegidas = todas.filter(a => seleccion.has(a.id) && est(a) === 'listo');
    if (!elegidas.length) { Toast.show('Selecciona al menos una comisión lista para pago.', 'warn'); return; }
    const p = document.getElementById('cmLoteP')?.value || mesHoy();
    const nota = document.getElementById('cmLoteN')?.value || '';
    const base = elegidas.reduce((s, a) => s + Number(a.comision?.base || 0), 0);
    const vendedores = new Set(elegidas.map(a => a.comision?.vendedor_email || '')).size;
    const ok = await Modal.confirm({
      title: 'Cerrar comisiones en lote', confirmLabel: `Cerrar ${elegidas.length}`,
      message: `Vas a cerrar <b>${elegidas.length}</b> comisión(es) de <b>${vendedores}</b> vendedor(es), base total <b>${money(base)}</b>, en el período <b>${esc(mesLabel(p))}</b>.<br><br>Queda registrado que tú las liberaste y cuándo. Cada una se puede reabrir si fue un error.`,
    });
    if (!ok) return;
    const btn = document.getElementById('cmLoteBtn');
    await withBusy(btn, async () => {
      enVuelo = true;
      const errores = [];
      let hechas = 0;
      try {
        for (const a of elegidas) {
          if (btn) btn.lastChild.textContent = ` Cerrando ${hechas + errores.length + 1}/${elegidas.length}…`;
          try { await S().cerrarPeriodo(a, p, nota); hechas++; seleccion.delete(a.id); }
          catch (e) { console.error('[comisiones] lote', a.id, e); errores.push({ a, msg: e.message || String(e) }); }
        }
      } finally { enVuelo = false; }
      await cargar();
      if (!errores.length) { Toast.show(`${hechas} comisión(es) liberada(s) en ${mesLabel(p)}`, 'ok'); return; }
      await Modal.alert({ title: 'Cierre en lote incompleto', icon: 'alert-triangle',
        message: `Se cerraron ${hechas} de ${elegidas.length}. Estas no se cerraron (siguen seleccionadas):<ul style="margin:8px 0 0 18px;">${errores.map(({ a, msg }) => `<li><b>${esc(a.cliente_nombre || a.id)}</b>: ${esc(msg)}</li>`).join('')}</ul>` });
    }, { label: 'Cerrando…', rethrow: false });
  }

  // Primer pago en LOTE (decisión 16 + P9 de la auditoría de módulos): la hoja
  // lista las seleccionadas con el número de factura que Recepción ya anotó en
  // la bandeja (pasos.qbo.factura) para no pedirlo dos veces; se completa el
  // que falte. Sin número no se confirma (marcarPago lo exige: es con lo que
  // se verifica contra QuickBooks). Una fecha para todo el lote.
  async function confirmarPagosLote() {
    const elegidas = todas.filter(a => seleccion.has(a.id) && soloFaltaPago(a));
    if (!elegidas.length) { Toast.show('Selecciona al menos una comisión a la que solo le falte el pago.', 'warn'); return; }
    const fecha = document.getElementById('cmLoteF')?.value || FMT.hoyISOPanama();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { Toast.show('Escribe la fecha del pago.', 'warn'); return; }
    const fechaTxt = fecha.split('-').reverse().join('/');
    const filas = elegidas.map(a => {
      const num = a.pasos?.qbo?.factura || '';
      const monto = a.resumen?.con_itbms != null ? money(a.resumen.con_itbms) : (a.comision?.base != null ? money(a.comision.base) : '—');
      return `<tr>
        <td><b>${esc(a.cliente_nombre || '—')}</b><br><span style="font-family:var(--font-mono);font-size:12px;color:var(--fg-3);">${esc(a.contrato_id || a.gestion_id || '')}</span></td>
        <td style="font-family:var(--font-mono);text-align:right;">${monto}</td>
        <td><input class="form-input" data-lf="${esc(a.id)}" value="${esc(num)}" placeholder="N.° factura" maxlength="40" style="width:130px;height:30px;" autocomplete="off">
          ${num ? '<div style="font-size:11px;color:var(--fg-3);">de la bandeja</div>' : '<div style="font-size:11px;color:#8A6415;">sin número en la bandeja</div>'}</td>
      </tr>`;
    }).join('');
    const numeros = await Modal.sheet({
      title: `Confirmar ${elegidas.length} primer${elegidas.length === 1 ? '' : 'os'} pago${elegidas.length === 1 ? '' : 's'}`, icon: 'check',
      html: `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.5;">Fecha del pago: <b>${esc(fechaTxt)}</b>. El número viene de la bandeja de facturación cuando Recepción lo anotó; completa el que falte.
          <b>Sin número no se confirma</b>: es con lo que el sistema verifica el pago contra QuickBooks. Cuenta solo la factura en cero.</p>
        <div class="table-scroll" style="max-height:55vh;overflow:auto;"><table class="app-table" style="font-size:13px;">
          <thead><tr><th>Cliente</th><th style="text-align:right;">Mensual c/ITBMS</th><th>Factura</th></tr></thead>
          <tbody>${filas}</tbody></table></div>`,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Confirmar los pagos', primary: true }],
      onMount: (root) => setTimeout(() => root.querySelector('[data-lf]:not([value]), [data-lf][value=""]')?.focus(), 30),
      onAction: (action, root) => action === 'ok'
        ? Object.fromEntries([...root.querySelectorAll('[data-lf]')].map(i => [i.getAttribute('data-lf'), i.value.trim()]))
        : null,
    });
    if (!numeros) return;
    const btn = document.getElementById('cmLotePagoBtn');
    const errores = [], sinNum = [];
    let hechas = 0;
    await withBusy(btn, async () => {
      enVuelo = true;
      try {
        for (const a of elegidas) {
          const num = numeros[a.id] || '';
          if (!num) { sinNum.push(a); continue; }
          try { await S().marcarPago(a, { factura: num, fecha }); hechas++; seleccion.delete(a.id); }
          catch (e) { console.error('[comisiones] lote pago', a.id, e); errores.push({ a, msg: e.message || String(e) }); }
        }
      } finally { enVuelo = false; }
    }, { label: 'Confirmando…', rethrow: false });
    await cargar();
    if (!errores.length && !sinNum.length) { Toast.show(`${hechas} pago${hechas === 1 ? '' : 's'} confirmado${hechas === 1 ? '' : 's'} — ${hechas === 1 ? 'la comisión queda' : 'las comisiones quedan'} LISTA${hechas === 1 ? '' : 'S'} para pago`, 'ok'); return; }
    await Modal.alert({ title: 'Confirmación en lote incompleta', icon: 'alert-triangle',
      message: `Se confirmaron ${hechas} de ${elegidas.length}.`
        + (sinNum.length ? `<br><br><b>Sin número de factura (siguen seleccionadas):</b><ul style="margin:6px 0 0 18px;">${sinNum.map(a => `<li>${esc(a.cliente_nombre || a.id)}</li>`).join('')}</ul>` : '')
        + (errores.length ? `<br><b>No se pudieron guardar:</b><ul style="margin:6px 0 0 18px;">${errores.map(({ a, msg }) => `<li><b>${esc(a.cliente_nombre || a.id)}</b>: ${esc(msg)}</li>`).join('')}</ul>` : '') });
  }

  function render() {
    // Contadores: siempre sobre TODO (con período y búsqueda aplicados), para
    // que el chip diga cuántas hay y no cuántas se están viendo.
    const base = todas.filter(a => a.comision && pasaPeriodo(a) && pasaBusqueda(a));
    const cnt = {
      abiertas: base.filter(esAbierta).length,
      listo: base.filter(a => est(a) === 'listo').length,
      esperando: base.filter(a => est(a) === 'esperando').length,
      pago: base.filter(soloFaltaPago).length,
      pagada: base.filter(a => est(a) === 'pagada').length,
      sinvend: base.filter(a => sinVendedor(a) && esAbierta(a)).length,
    };
    Object.entries(cnt).forEach(([k, v]) => {
      const el = document.querySelector(`[data-cnt="${k}"]`);
      if (el) el.textContent = v;
    });
    document.querySelectorAll('.cm-chip').forEach(b => b.classList.toggle('active', b.dataset.f === filtro));

    // Sin vendedor primero: es lo que hay que resolver antes de poder pagar.
    const filas = visibles();
    const grupos = new Map();
    for (const a of filas) {
      const v = a.comision.vendedor_email || '(sin vendedor)';
      if (!grupos.has(v)) grupos.set(v, []);
      grupos.get(v).push(a);
    }
    const orden = [...grupos.keys()].sort((x, y) => {
      if (x === '(sin vendedor)') return -1;
      if (y === '(sin vendedor)') return 1;
      const lx = grupos.get(x).filter(a => est(a) === 'listo').length;
      const ly = grupos.get(y).filter(a => est(a) === 'listo').length;
      return ly - lx || x.localeCompare(y);
    });
    for (const v of orden) {
      grupos.get(v).sort((a, b) => (toDate(a.fecha_efectiva) || 0) - (toDate(b.fecha_efectiva) || 0));
    }

    // La selección solo guarda lo que sigue visible y elegible en esta vista.
    const idsElegibles = new Set(filas.filter(elegible).map(a => a.id));
    [...seleccion].forEach(id => { if (!modoLote() || !idsElegibles.has(id)) seleccion.delete(id); });
    pintarLote();

    const cont = document.getElementById('cmRows');
    cont.innerHTML = filas.length
      ? orden.map(v => grupoHtml(v, grupos.get(v))).join('')
      : `<div class="cm-vacio">No hay comisiones que mostrar con este filtro.</div>`;
    if (window.lucide?.createIcons) lucide.createIcons();
  }

  // ── Formularios ─────────────────────────────────────────────────────────
  function formPago(id) {
    const a = todas.find(x => x.id === id); if (!a) return;
    const hoy = FMT.hoyISOPanama(); // hora de Panamá, no UTC (T8)
    const el = document.getElementById(`cmForm-${id}`); if (!el) return;
    // El número que Recepción ya anotó en la bandeja (pasos.qbo.factura) viene
    // puesto: no se pide dos veces (P5 de la auditoría de módulos 2026-09-30).
    const numBandeja = a.pasos?.qbo?.factura || '';
    el.innerHTML = `<div class="cm-form">
      <div><label for="pgF-${esc(id)}">Factura (QuickBooks)${numBandeja ? ' · de la bandeja' : ''}</label>
        <input id="pgF-${esc(id)}" class="form-input" style="width:140px;" placeholder="1234" autocomplete="off" value="${esc(numBandeja)}"></div>
      <div><label for="pgD-${esc(id)}">Fecha del pago</label>
        <input id="pgD-${esc(id)}" type="date" class="form-input" value="${hoy}" max="${hoy}"></div>
      <div><label for="pgM-${esc(id)}">Monto pagado</label>
        <input id="pgM-${esc(id)}" type="number" step="0.01" min="0" class="form-input" style="width:110px;" placeholder="opcional"></div>
      <div><label for="pgS-${esc(id)}">Saldo pendiente</label>
        <input id="pgS-${esc(id)}" type="number" step="0.01" min="0" class="form-input" style="width:110px;" placeholder="0.00"></div>
      <button type="button" class="btn btn-primary btn-sm" onclick="FacturacionComisiones.guardarPago('${esc(id)}')">Guardar</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="FacturacionComisiones.cerrarForm('${esc(id)}')">Cancelar</button>
      <p class="ayuda">El <b>número de factura</b> no es opcional: es lo que le va a permitir al sistema
        verificar el pago solo contra QuickBooks. Si la factura tiene <b>saldo pendiente</b>, escríbelo —
        la comisión no se libera hasta que quede en cero.</p>
    </div>`;
    document.getElementById(`pgF-${id}`)?.focus();
  }

  function formCierre(id) {
    const a = todas.find(x => x.id === id); if (!a) return;
    if (est(a) !== 'listo') {
      Toast.show('Todavía falta un requisito: ' + S().faltantes(a.comision).map(f => REQ_LABEL[f.paso]).join(', '), 'warn');
      return;
    }
    const el = document.getElementById(`cmForm-${id}`); if (!el) return;
    // Por defecto, el mes de la fecha efectiva del hecho; si es más viejo que
    // el mes en curso se ofrecen los dos, porque una comisión atrasada se paga
    // en el período en que se paga, no en el que se generó.
    const mesHecho = mesDe(a.fecha_efectiva) || mesHoy();
    const opts = [...new Set([mesHoy(), mesHecho])].sort().reverse();
    el.innerHTML = `<div class="cm-form">
      <div><label for="ciP-${esc(id)}">Período en que se paga</label>
        <select id="ciP-${esc(id)}" class="form-select" style="width:170px;">
          ${opts.map(m => `<option value="${m}">${mesLabel(m)}</option>`).join('')}
        </select></div>
      <div style="flex:1;min-width:180px;"><label for="ciN-${esc(id)}">Nota (opcional)</label>
        <input id="ciN-${esc(id)}" class="form-input" placeholder="planilla, quincena…" autocomplete="off"></div>
      <button type="button" class="btn btn-primary btn-sm" onclick="FacturacionComisiones.guardarCierre('${esc(id)}')">Cerrar</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="FacturacionComisiones.cerrarForm('${esc(id)}')">Cancelar</button>
      <p class="ayuda">Queda registrado que <b>tú</b> la liberaste y cuándo. Se puede reabrir si fue un error.</p>
    </div>`;
  }

  function cerrarForm(id) {
    const el = document.getElementById(`cmForm-${id}`);
    if (el) el.innerHTML = '';
  }

  async function guardarPago(id) {
    if (enVuelo) return;
    const a = todas.find(x => x.id === id); if (!a) return;
    const factura = document.getElementById(`pgF-${id}`)?.value || '';
    const fecha = document.getElementById(`pgD-${id}`)?.value || '';
    const montoRaw = document.getElementById(`pgM-${id}`)?.value || '';
    const saldoRaw = document.getElementById(`pgS-${id}`)?.value || '';
    enVuelo = true;
    try {
      const estado = await S().marcarPago(a, {
        factura, fecha,
        monto: montoRaw === '' ? null : Number(montoRaw),
        saldo: saldoRaw === '' ? null : Number(saldoRaw),
      });
      Toast.show(estado === 'listo'
        ? 'Pago confirmado — la comisión queda LISTA para pago'
        : 'Pago con saldo pendiente: la comisión sigue esperando', estado === 'listo' ? 'ok' : 'warn');
      await cargar();
    } catch (e) {
      console.error(e); Toast.show(e.message || 'No se pudo guardar el pago', 'bad', 7000);
    } finally { enVuelo = false; }
  }

  async function guardarCierre(id) {
    if (enVuelo) return;
    const a = todas.find(x => x.id === id); if (!a) return;
    const p = document.getElementById(`ciP-${id}`)?.value || '';
    const nota = document.getElementById(`ciN-${id}`)?.value || '';
    enVuelo = true;
    try {
      await S().cerrarPeriodo(a, p, nota);
      Toast.show(`Comisión liberada en ${mesLabel(p)}`, 'ok');
      await cargar();
    } catch (e) {
      console.error(e); Toast.show(e.message || 'No se pudo cerrar', 'bad', 7000);
    } finally { enVuelo = false; }
  }

  async function deshacerPago(id) {
    const a = todas.find(x => x.id === id); if (!a) return;
    const ok = await Modal.confirm({
      title: 'Deshacer el pago', confirmLabel: 'Deshacer',
      message: `El pago de <b>${esc(a.cliente_nombre || '')}</b> (factura
        ${esc(a.comision?.requisitos?.pago?.factura || '—')}) deja de contar y la comisión vuelve a esperar.
        No se borra nada: queda en el rastro quién lo marcó y quién lo deshizo.`,
    });
    if (!ok) return;
    try {
      await S().deshacerPago(a);
      Toast.show('Pago deshecho', 'ok');
      await cargar();
    } catch (e) { console.error(e); Toast.show(e.message || 'No se pudo deshacer', 'bad', 7000); }
  }

  async function reabrir(id) {
    const a = todas.find(x => x.id === id); if (!a) return;
    const ok = await Modal.confirm({
      title: 'Reabrir el período', confirmLabel: 'Reabrir', danger: true,
      message: `La comisión de <b>${esc(a.cliente_nombre || '')}</b> vuelve a quedar abierta
        (período ${esc(a.comision?.periodo || '—')}). Úsalo solo si el cierre fue un error.`,
    });
    if (!ok) return;
    try {
      await S().reabrirPeriodo(a);
      Toast.show('Período reabierto', 'ok');
      await cargar();
    } catch (e) { console.error(e); Toast.show(e.message || 'No se pudo reabrir', 'bad', 7000); }
  }

  // ── CSV: es lo que Zuleika necesita para pagar ──────────────────────────
  function csv() {
    const filas = visibles();
    if (!filas.length) { Toast.show('No hay nada que exportar con este filtro', 'warn'); return; }
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const enc = ['Vendedor', 'Estado', 'Cliente', 'Referencia', 'Evento', 'Fecha efectiva',
      'Base', 'Base de', 'Firma', 'Entrega', 'Pago', 'Factura', 'Periodo', 'Liberada por'];
    const req = (x) => !x ? '' : (!x.aplica ? 'no aplica' : (x.hecho ? 'sí' : 'pendiente'));
    const lineas = filas.map(a => {
      const c = a.comision, r = c.requisitos || {};
      const d = toDate(a.fecha_efectiva);
      return [
        c.vendedor_email || 'SIN VENDEDOR', est(a), a.cliente_nombre || '',
        a.contrato_id || a.gestion_id || a.id, a.titulo || a.tipo || '',
        d && !isNaN(d) ? FMT.fechaISOPanama(d) : '',
        c.base == null ? '' : Number(c.base).toFixed(2), c.base_de || '',
        req(r.firma), req(r.entrega), req(r.pago),
        r.pago?.factura || '', c.periodo || '', c.liberada_por || '',
      ].map(q).join(',');
    });
    // BOM para que Excel en Windows lea los acentos.
    const blob = new Blob(['﻿' + [enc.map(q).join(','), ...lineas].join('\r\n')],
      { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comisiones_${filtro}${periodo ? '_' + periodo : ''}_${FMT.hoyISOPanama()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Carga y arranque ────────────────────────────────────────────────────
  function toggle(id) {
    abierto = abierto === id ? null : id;
    render();
    if (abierto) {
      const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function pintarPeriodos() {
    const sel = document.getElementById('cmPeriodo');
    if (!sel) return;
    const meses = new Set();
    todas.forEach(a => {
      if (!a.comision) return;
      const m = a.comision.periodo || mesDe(a.fecha_efectiva);
      if (m) meses.add(m);
    });
    const orden = [...meses].sort().reverse();
    sel.innerHTML = `<option value="">Todos los períodos</option>` +
      orden.map(m => `<option value="${m}" ${m === periodo ? 'selected' : ''}>${mesLabel(m)}</option>`).join('');
  }

  async function cargar() {
    try {
      todas = await S().listComisiones();
      pintarPeriodos();
      const sinV = todas.filter(a => sinVendedor(a) && esAbierta(a)).length;
      const aviso = document.getElementById('cmAviso');
      if (aviso) {
        // No se puede pagar una comisión sin saber de quién es. Salió al correr
        // el backfill: hay cuentas sin vendedor_asignado y contratos viejos sin
        // creado_por_uid.
        aviso.hidden = !sinV;
        if (sinV) aviso.innerHTML = `<b>${sinV} comisión(es) sin vendedor.</b> El contrato no dice quién lo hizo
          y la ficha del cliente no tiene vendedor asignado, así que no hay a quién pagarle. Asigna el vendedor
          en la ficha del cliente y vuelve a entrar.`;
      }
      render();
    } catch (e) {
      console.error(e);
      document.getElementById('cmRows').innerHTML = `<div class="cm-vacio">No se pudieron cargar las comisiones.</div>`;
    }
  }

  function wire() {
    document.getElementById('cmChips')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('.cm-chip'); if (!b) return;
      filtro = b.dataset.f; abierto = null; render();
    });
    let t = null;
    document.getElementById('cmBuscar')?.addEventListener('input', (ev) => {
      clearTimeout(t);
      const v = ev.target.value;
      t = setTimeout(() => { busqueda = v.trim(); abierto = null; render(); }, 180);
    });
    document.getElementById('cmPeriodo')?.addEventListener('change', (ev) => {
      periodo = ev.target.value; abierto = null; render();
    });
    document.getElementById('cmCsv')?.addEventListener('click', csv);
    // Cierre en lote: casillas por fila, "seleccionar las del vendedor" y la barra.
    document.getElementById('cmRows')?.addEventListener('change', (ev) => {
      const cb = ev.target.closest('input[data-sel]'); if (!cb) return;
      const id = cb.getAttribute('data-sel');
      if (cb.checked) seleccion.add(id); else seleccion.delete(id);
      pintarLote(); if (window.lucide?.createIcons) lucide.createIcons();
    });
    document.getElementById('cmRows')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sel-vendedor]'); if (!b) return;
      const v = b.getAttribute('data-sel-vendedor');
      visibles().filter(a => elegible(a) && (a.comision.vendedor_email || '') === v).forEach(a => seleccion.add(a.id));
      render();
    });
    document.getElementById('cmLote')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.id === 'cmLoteBtn') { cerrarLote(); return; }
      if (b.id === 'cmLotePagoBtn') { confirmarPagosLote(); return; }
      const q = b.getAttribute('data-lote');
      if (q === 'todas') visibles().filter(elegible).forEach(a => seleccion.add(a.id));
      if (q === 'ninguna') seleccion.clear();
      if (q) render();
    });
  }

  function init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = '../login.html';
      try {
        const u = await Sesion.miPerfil(user);
        rol = u ? u.rol : null;
        // Esta pantalla es de admin/contabilidad y punto: recepción marca pasos
        // de facturación, no libera comisiones.
        if (!S().puedeComisionar(rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>";
          return;
        }
        const mount = document.getElementById('wsTabs-mount');
        if (mount && !mount.children.length && window.FinanzasNav) FinanzasNav.render('comisiones');
        wire();
        await cargar();
        const id = new URLSearchParams(location.search).get('aviso');
        if (id && todas.some(a => a.id === id)) { filtro = 'abiertas'; toggle(id); }
      } catch (e) { console.error(e); Toast.show('Error al iniciar', 'bad'); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render, cargar, toggle, formPago, formCierre, cerrarForm,
    guardarPago, guardarCierre, deshacerPago, reabrir, confirmarPagosLote };
})();

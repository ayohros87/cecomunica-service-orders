// @ts-nocheck
// Bandeja "Facturación pendiente" (Finanzas · Bandeja) — propuesta 2026-09-04.
//
// Una fila por aviso (facturacion_avisos). La fila responde, en este orden:
// qué le pasa al cobro (efecto = única voz de color), de quién y cuánto, qué
// falta (pastillas QBO / POC). Al hacer clic en una pastilla vacía se abre una
// confirmación pegada a ella (QBO pregunta "facturar desde": ahí queda escrita
// la decisión del firmado tardío). El detalle se abre al hacer clic en la fila:
// líneas, seriales, correo (con reenviar si falló), historial y "No aplica".
//
// Lo más viejo va arriba (es lo que más urge); "esperando entrega" al final.
// Roles: FacturacionAvisosService.ROLES. Deep-link: ?aviso=<id> abre la fila.

window.FacturacionBandeja = (() => {
  const S = () => window.FacturacionAvisosService;
  const esc = (s) => FMT.esc(s);
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;

  let rol = null;
  let pendientes = [];
  let cerrados = [];
  let filtro = 'all';
  let verCerrados = false;
  let busqueda = '';
  let abierto = null;       // id de la fila expandida
  let popAbierto = null;    // { id, paso }
  let descartando = null;   // id con el formulario de descarte visible
  let enVuelo = false;

  // ── Utilidades de fecha ────────────────────────────────────────────────
  const toDate = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fCorta(v) {
    const d = toDate(v); if (!d || isNaN(d)) return '—';
    return `${d.getDate()} ${MESES[d.getMonth()]}`;
  }
  function fHora(v) {
    const d = toDate(v); if (!d || isNaN(d)) return '—';
    return `${d.getDate()} ${MESES[d.getMonth()]} ${d.toLocaleTimeString('es-PA', { hour: 'numeric', minute: '2-digit' })}`;
  }
  function fIso(v) {
    const d = toDate(v); if (!d || isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fLarga(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-').map(Number);
    return `${d} ${MESES[m - 1]} ${y}`;
  }
  function dias(v) {
    const d = toDate(v); if (!d || isNaN(d)) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }
  // Mismo umbral que la bandeja de Almacén: ámbar > 3 días, rojo > 7.
  function ageHtml(a) {
    if (a.estado === 'esperando') return `<span class="fb-age" title="Esperando la entrega">—</span>`;
    const n = dias(a.fecha_efectiva);
    if (n == null) return `<span class="fb-age">—</span>`;
    const cls = n > 7 ? ' bad' : (n > 3 ? ' warn' : '');
    return `<span class="fb-age${cls}" title="Días desde la fecha efectiva">${n === 0 ? 'hoy' : `${n} d`}</span>`;
  }

  // ── Texto de la fila ──────────────────────────────────────────────────
  function linea2(a) {
    const c = a.contexto || {};
    const r = a.resumen || {};
    const partes = [];
    if (a.correo?.status === 'error') partes.push(`<span class="alerta">El correo no salió</span>`);
    switch (a.tipo) {
      case 'contrato_activo':
      case 'renovacion_activa':
        partes.push(`Activado <b>${fCorta(a.fecha_efectiva || a.created_at)}</b>${c.activado_por ? ` por ${esc(c.activado_por)}` : ''}`);
        if (c.contrato_fecha) partes.push(`contrato del ${fLarga(c.contrato_fecha)}`);
        if (c.duracion) partes.push(esc(c.duracion));
        partes.push(c.entrega_pendiente ? 'la facturación arranca al entregar' : 'sin entrega pendiente');
        break;
      case 'aumento_entregado':
        partes.push(`Entregado <b>${fCorta(a.fecha_efectiva)}</b>${c.orden ? ` con la OS ${esc(c.orden)}` : ''}`);
        if (c.duracion_meses) partes.push(`el tramo de ${c.duracion_meses} meses arranca ese día`);
        break;
      case 'ajuste_tarifa':
      case 'regularizacion':
        partes.push(`Anexo firmado <b>${fCorta(a.fecha_efectiva)}</b> · efectivo desde ese día`);
        break;
      case 'baja_aprobada':
        partes.push(`Fin de facturación <b>${c.fecha_fin_texto ? esc(c.fecha_fin_texto) : fCorta(a.fecha_efectiva)}</b>`);
        partes.push(c.terminacion_total ? 'terminación total' : 'baja parcial');
        partes.push('los equipos entran por devolución');
        break;
      case 'terminacion_completada':
        partes.push(`Flota recuperada <b>${fCorta(a.fecha_efectiva)}</b>${c.orden ? ` (devolución ${esc(c.orden)})` : ''} · cerrar en QuickBooks y apagar en POC`);
        break;
      default:
        partes.push(`Efectivo <b>${fCorta(a.fecha_efectiva)}</b>`);
    }
    // Seriales registrados: el camino gradual a facturar desde la app.
    if (r.seriales_total > 0) {
      const n = Number(r.seriales_count || 0);
      partes.push(n >= r.seriales_total
        ? `seriales ${n}/${r.seriales_total}`
        : `<span class="alerta">seriales ${n}/${r.seriales_total}</span>`);
    }
    return partes.join(' · ');
  }

  function montoHtml(a) {
    const r = a.resumen || {};
    if (a.estado === 'esperando' && r.mensual != null) return `<div class="fb-monto">${money(r.mensual)}<small>/mes al entregar</small></div>`;
    if (r.delta_mensual == null && r.mensual == null) return `<div class="fb-monto">—<small>&nbsp;</small></div>`;
    if (a.efecto === 'termina') {
      return r.delta_mensual != null
        ? `<div class="fb-monto">−${money(Math.abs(r.delta_mensual))}<small>/mes</small></div>`
        : `<div class="fb-monto">—<small>fin de cobro</small></div>`;
    }
    const v = r.delta_mensual ?? r.mensual;
    const signo = a.efecto === 'cambia' && v > 0 ? '+' : '';
    const sub = r.exento ? '/mes · exento' : (r.con_itbms != null ? `/mes · ${money(r.con_itbms)} con ITBMS` : '/mes + ITBMS');
    return `<div class="fb-monto">${signo}${money(v)}<small>${sub}</small></div>`;
  }

  function pasoHtml(a, key, label) {
    const p = a.pasos?.[key];
    if (!p || !p.aplica) return `<span class="fb-paso na" title="No aplica a este aviso">${label}</span>`;
    if (a.estado === 'esperando') return `<span class="fb-paso na" title="Esperando la entrega">${label}</span>`;
    if (a.estado === 'descartado') return `<span class="fb-paso na">${label}</span>`;
    const done = !!p.hecho;
    const title = done ? `${p.por_email || '—'} · ${fHora(p.at)}${p.facturar_desde ? ` · desde ${fLarga(p.facturar_desde)}` : ''}${p.ref ? ` · ${p.ref}` : ''}` : `Marcar ${label} como hecho`;
    const pop = (!done && popAbierto && popAbierto.id === a.id && popAbierto.paso === key) ? popHtml(a, key) : '';
    return `<span class="fb-popwrap"><button type="button" class="fb-paso${done ? ' done' : ''}" data-act="paso" data-id="${esc(a.id)}" data-paso="${key}" title="${esc(title)}"><span class="o"></span>${label}</button>${pop}</span>`;
  }

  function popHtml(a, key) {
    const u = firebase.auth().currentUser;
    const quien = u?.email ? u.email.split('@')[0] : '—';
    if (key === 'qbo') {
      const def = fIso(a.fecha_efectiva) || fIso(new Date());
      const c = a.contexto || {};
      return `<div class="fb-pop show" data-pop="${esc(a.id)}">
        <h6>Hecho en QuickBooks</h6>
        <label>Facturar desde</label>
        <input type="date" class="form-input" data-f="desde" value="${esc(def)}">
        <div class="hint">${a.efecto === 'termina' ? 'Fecha en que deja de cobrarse.' : `Prellenada con la fecha efectiva.${c.contrato_fecha ? ` Cámbiala si acordaron otra (por ejemplo, la del contrato: ${fLarga(c.contrato_fecha)}).` : ''}`}</div>
        <label>Referencia (opcional)</label>
        <input type="text" class="form-input" data-f="ref" maxlength="80" placeholder="N.° de factura o nota">
        <div class="err" data-f="err"></div>
        <div class="act"><button type="button" class="btn btn-sm btn-ghost" data-act="pop-cancel">Cancelar</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="pop-ok" data-id="${esc(a.id)}" data-paso="qbo">Marcar hecho</button></div>
        <div class="hint">Quedará como ${esc(quien)} · ahora</div>
      </div>`;
    }
    return `<div class="fb-pop show" data-pop="${esc(a.id)}">
      <h6>Hecho en POC</h6>
      <label>Nota (opcional)</label>
      <input type="text" class="form-input" data-f="nota" maxlength="140" placeholder="Qué se activó o ajustó">
      <div class="err" data-f="err"></div>
      <div class="act"><button type="button" class="btn btn-sm btn-ghost" data-act="pop-cancel">Cancelar</button>
        <button type="button" class="btn btn-sm btn-primary" data-act="pop-ok" data-id="${esc(a.id)}" data-paso="poc">Marcar hecho</button></div>
      <div class="hint">Quedará como ${esc(quien)} · ahora</div>
    </div>`;
  }

  // ── Detalle expandido ─────────────────────────────────────────────────
  function detalleHtml(a) {
    const d = a.detalle || {};
    const r = a.resumen || {};
    const c = a.contexto || {};
    let izq = '';
    const lineas = (d.lineas || []).filter(l => Number(l.cantidad || 0) > 0);
    if (lineas.length) {
      izq += `<h5>Equipos</h5><table><tr><th>Cant.</th><th>Equipo</th><th class="r">Precio/mes</th></tr>` +
        lineas.map(l => `<tr><td>${Number(l.cantidad || 0)}</td><td>${esc(l.modelo || '—')}${l.modalidad === 'propio' ? ' · equipo del cliente' : ''}</td><td class="r">${money(l.precio)}</td></tr>`).join('') +
        (r.mensual != null ? `<tr><td colspan="2"><b>Total mensual</b></td><td class="r"><b>${money(r.mensual)}</b>${r.exento ? ' · exento' : (r.con_itbms != null ? ` · ${money(r.con_itbms)} con ITBMS` : '')}</td></tr>` : '') +
        `</table>`;
    }
    if ((d.cargos || []).length) {
      izq += `<h5 style="margin-top:12px">Cargos</h5><table><tr><th>Cant.</th><th>Concepto</th><th>Tipo</th><th class="r">Monto</th></tr>` +
        d.cargos.map(cg => `<tr><td>${Number(cg.cantidad || 1)}</td><td>${esc(cg.concepto || '—')}</td><td>${cg.recurrente ? 'Mensual' : 'Único'}</td><td class="r">${money(cg.monto)}</td></tr>`).join('') + `</table>`;
    }
    if ((d.ajustes_precio || []).length) {
      izq += `<h5 style="margin-top:12px">Tarifas renegociadas</h5><table><tr><th>Línea</th><th>Cant.</th><th class="r">Antes</th><th class="r">Ahora</th></tr>` +
        d.ajustes_precio.map(x => `<tr><td>${esc(x.modelo || '—')}</td><td>${Number(x.cantidad || 0)}</td><td class="r">${money(x.precio_anterior)}</td><td class="r"><b>${money(x.precio_nuevo)}</b></td></tr>`).join('') + `</table>`;
    }
    if ((d.items || []).length) {
      izq += `<h5>Equipos que salen</h5><table><tr><th>Serial</th><th>Modelo</th><th>Contrato</th></tr>` +
        d.items.map(it => `<tr><td class="seriales">${esc(it.serial_saliente || it.serial || '—')}</td><td>${esc(it.modelo || '—')}</td><td class="seriales">${esc(it.contrato_id || '—')}</td></tr>`).join('') + `</table>`;
      if (c.liquidacion) izq += `<div class="kv" style="margin-top:6px">Liquidación estimada: <b>${money(c.liquidacion)}</b></div>`;
    }
    if ((r.seriales || []).length) {
      izq += `<h5 style="margin-top:12px">Seriales</h5><div class="seriales">${r.seriales.map(esc).join(' · ')}</div>`;
    } else if (r.seriales_total > 0 && Number(r.seriales_count || 0) < r.seriales_total) {
      izq += `<h5 style="margin-top:12px">Seriales</h5><div class="kv">La cuenta tiene ${Number(r.seriales_count || 0)} de ${r.seriales_total} seriales registrados. Se cobra en QuickBooks igual; lo que falta es el registro para que esta cuenta pueda facturarse desde la app más adelante.</div>`;
    }
    if (a.estado === 'esperando') {
      izq += `<h5 style="margin-top:12px">Qué pasa después</h5><div class="kv">Cuando la orden se marque "Entregado al cliente", esta fila pasa a <b>Arranca</b> con la fecha real de entrega. Hoy no hay nada que facturar.</div>`;
    }
    if (!izq) izq = `<div class="kv" style="color:var(--fg-3)">(sin detalle registrado)</div>`;

    // Derecha: correo, historial, enlaces
    let der = `<h5>Aviso</h5>`;
    const m = a.correo || {};
    if (m.status === 'error') {
      der += `<div class="fb-mail err">✕ No se pudo enviar${m.error ? ` (${esc(String(m.error).slice(0, 80))})` : ''}</div>
        <div class="links"><button type="button" class="btn btn-sm" data-act="reenviar" data-id="${esc(a.id)}"><i data-lucide="send"></i> Reenviar el correo</button></div>`;
    } else if (m.status === 'sent') {
      der += `<div class="fb-mail">✓ Enviado a activaciones@${m.sent_at ? ` el ${fHora(m.sent_at)}` : ''}${a.vendedor_email ? ` · CC ${esc(a.vendedor_email.split('@')[0])}` : ''}</div>`;
    } else if (m.status === 'queued' || m.status === 'retrying') {
      der += `<div class="fb-mail">… En cola de envío</div>`;
    } else {
      der += `<div class="fb-mail">Sin correo enlazado</div>`;
    }
    if (!a.vendedor_email) der += `<div class="kv" style="margin-top:4px;color:var(--fg-3)">La ficha del cliente no tiene vendedor asignado.</div>`;

    const hist = (a.historial || []).slice().sort((x, y) => String(x.fecha_iso || '').localeCompare(String(y.fecha_iso || '')));
    if (hist.length) {
      der += `<h5 style="margin-top:12px">Historial</h5><div class="fb-hist">` +
        hist.map(h => `<b>${fHora(h.fecha_iso)}</b> · ${esc(h.detalle || h.accion || '')}${h.por_email ? ` — ${esc(h.por_email.split('@')[0])}` : ''}`).join('<br>') + `</div>`;
    }
    const links = [];
    if (a.contrato_doc_id) links.push(`<a class="btn btn-sm" href="../contratos/documento.html?id=${encodeURIComponent(a.contrato_doc_id)}"><i data-lucide="file-text"></i> Ver el contrato</a>`);
    if (a.gestion_id && a.cliente_id) links.push(`<a class="btn btn-sm" href="../clientes/centro.html?id=${encodeURIComponent(a.cliente_id)}&g=${encodeURIComponent(a.gestion_id)}"><i data-lucide="folder-open"></i> Ver el expediente</a>`);
    if (a.cliente_id) links.push(`<a class="btn btn-sm" href="../clientes/centro.html?id=${encodeURIComponent(a.cliente_id)}"><i data-lucide="user"></i> Ficha del cliente</a>`);
    if (links.length) der += `<div class="links">${links.join('')}</div>`;

    // Pie: deshacer pasos / no aplica / reactivar
    let pie = '';
    if (a.estado === 'descartado') {
      const ds = a.descarte || {};
      pie = `<div class="fb-detfoot"><span class="fb-descartado">Descartado: <b>${esc(S().motivoLabel(ds.motivo))}</b>${ds.nota ? ` · ${esc(ds.nota)}` : ''} — ${esc((ds.por_email || '').split('@')[0])} · ${fHora(ds.at)}</span>
        <span class="push"></span><button type="button" class="btn btn-sm" data-act="reactivar" data-id="${esc(a.id)}"><i data-lucide="undo-2"></i> Reactivar</button></div>`;
    } else if (descartando === a.id) {
      const opts = S().MOTIVOS_DESCARTE.map(m => `<option value="${esc(m.codigo)}">${esc(m.label)}</option>`).join('');
      pie = `<div class="fb-desc" data-desc="${esc(a.id)}"><div class="t">¿Por qué no aplica este aviso?</div>
        <select class="form-input" data-f="motivo" style="max-width:280px"><option value="">Selecciona el motivo…</option>${opts}</select>
        <input class="form-input" data-f="nota" type="text" maxlength="140" placeholder="Nota (opcional; obligatoria si es 'Otro')" style="flex:1;min-width:200px">
        <button type="button" class="btn btn-sm btn-danger" data-act="desc-ok" data-id="${esc(a.id)}">Descartar</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="desc-cancel">Cancelar</button>
        <div class="err" data-f="err"></div></div>`;
    } else {
      const deshacer = ['qbo', 'poc'].filter(k => a.pasos?.[k]?.hecho)
        .map(k => `<button type="button" class="btn btn-sm btn-ghost" data-act="deshacer" data-id="${esc(a.id)}" data-paso="${k}" title="Vuelve a pendiente; el historial conserva quién lo había marcado"><i data-lucide="rotate-ccw"></i> Deshacer ${k.toUpperCase()}</button>`).join('');
      pie = `<div class="fb-detfoot">${deshacer}<span class="push"></span>
        ${a.estado !== 'hecho' ? `<button type="button" class="btn btn-sm btn-ghost" data-act="descartar" data-id="${esc(a.id)}" style="color:#991B1B">No aplica…</button>` : ''}</div>`;
    }
    return `<div class="fb-det"><div>${izq}</div><div>${der}</div>${pie}</div>`;
  }

  function filaHtml(a) {
    const cerrado = a.estado === 'hecho' || a.estado === 'descartado';
    const efectoCls = a.estado === 'esperando' ? 'espera' : (a.estado === 'descartado' ? 'hecho' : a.efecto);
    const efectoTxt = a.estado === 'esperando' ? 'Espera' : (a.estado === 'descartado' ? 'No aplica' : (a.estado === 'hecho' ? 'Hecho' : a.efecto));
    const r = a.resumen || {};
    const que = [a.titulo || a.tipo, r.equipos].filter(Boolean).join(' · ');
    return `<div class="fb-row${abierto === a.id ? ' is-open' : ''}${cerrado ? ' is-cerrado' : ''}" data-row="${esc(a.id)}">
      <div class="fb-main" data-act="abrir" data-id="${esc(a.id)}">
        <span class="fb-efecto fb-efecto--${efectoCls}">${esc(efectoTxt)}</span>
        <div class="fb-txt">
          <div class="fb-t1"><b>${esc(a.cliente_nombre || '—')}</b> <span class="id">${esc(a.contrato_id || a.gestion_id || '')}</span> <span class="que">· ${esc(que)}</span></div>
          <div class="fb-t2">${linea2(a)}</div>
        </div>
        ${montoHtml(a)}
        ${ageHtml(a)}
        <div class="fb-pasos">${pasoHtml(a, 'qbo', 'QBO')}${pasoHtml(a, 'poc', 'POC')}<span class="fb-more" aria-hidden="true">···</span></div>
      </div>
      ${abierto === a.id ? detalleHtml(a) : ''}
    </div>`;
  }

  // ── Render ────────────────────────────────────────────────────────────
  function orden(a, b) {
    // esperando al final; el resto por fecha efectiva ascendente (lo viejo arriba)
    const ea = a.estado === 'esperando', eb = b.estado === 'esperando';
    if (ea !== eb) return ea ? 1 : -1;
    const ta = toDate(a.fecha_efectiva || a.created_at)?.getTime() || 0;
    const tb = toDate(b.fecha_efectiva || b.created_at)?.getTime() || 0;
    return ta - tb;
  }
  function coincide(a) {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return [a.cliente_nombre, a.contrato_id, a.gestion_id, a.resumen?.equipos].some(v => String(v || '').toLowerCase().includes(q));
  }
  function pasaFiltro(a) {
    if (filtro === 'all') return true;
    if (filtro === 'espera') return a.estado === 'esperando';
    return a.estado !== 'esperando' && a.efecto === filtro;
  }

  function render() {
    // Conteos (sobre pendientes, sin la búsqueda)
    const cnt = { all: pendientes.length, arranca: 0, cambia: 0, termina: 0, espera: 0 };
    pendientes.forEach(a => { if (a.estado === 'esperando') cnt.espera++; else if (cnt[a.efecto] != null) cnt[a.efecto]++; });
    document.querySelectorAll('#fbChips [data-cnt]').forEach(el => { el.textContent = cnt[el.getAttribute('data-cnt')] ?? 0; });
    document.querySelectorAll('#fbChips .fb-chip').forEach(el => {
      const on = el.getAttribute('data-f') === filtro;
      el.classList.toggle('active', on); el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const activos = pendientes.filter(a => a.estado === 'pendiente').length;
    if (window.WorkspaceTabs) WorkspaceTabs.setBadge('bandeja', activos);

    const lista = pendientes.filter(pasaFiltro).filter(coincide).sort(orden);
    let html = lista.map(filaHtml).join('');
    if (!lista.length) {
      html = `<div class="fb-vacio"><i data-lucide="check-circle-2"></i><div>${busqueda ? 'Nada coincide con la búsqueda.' : 'Nada pendiente de facturar. Los avisos nuevos aparecen aquí y por correo a activaciones@.'}</div></div>`;
    }
    if (verCerrados) {
      const cl = cerrados.filter(coincide).sort((a, b) => (toDate(b.updated_at)?.getTime() || 0) - (toDate(a.updated_at)?.getTime() || 0));
      html += `<div class="fb-sep">Hechos y descartados <span style="font-weight:500;letter-spacing:0">(${cl.length})</span></div>` +
        (cl.length ? cl.map(filaHtml).join('') : `<div class="fb-vacio">Todavía no hay avisos cerrados.</div>`);
    }
    const mount = document.getElementById('fbRows');
    mount.innerHTML = html;
    if (window.lucide) lucide.createIcons({ nodes: [mount] });
  }

  async function cargar() {
    try {
      pendientes = await S().listPendientes();
      cerrados = verCerrados ? await S().listCerrados() : cerrados;
    } catch (e) {
      console.error(e);
      const av = document.getElementById('fbAviso');
      av.textContent = `No se pudo leer la bandeja: ${e.message || e}`; av.hidden = false;
    }
    render();
  }

  function todos() { return pendientes.concat(cerrados); }
  function porId(id) { return todos().find(a => a.id === id); }

  // ── Acciones ──────────────────────────────────────────────────────────
  async function conCandado(fn) {
    if (enVuelo) return;
    enVuelo = true;
    try { await fn(); }
    catch (e) {
      console.error(e);
      const msg = e?.code === 'permission-denied' ? 'Tu usuario no puede marcar esta bandeja.' : (e.message || 'Error');
      Toast.show(msg, 'bad');
    }
    finally { enVuelo = false; }
  }

  async function onClick(ev) {
    const t = ev.target.closest('[data-act]');
    // Clic fuera de un popover lo cierra
    if (!ev.target.closest('.fb-pop') && popAbierto && !(t && t.getAttribute('data-act') === 'paso')) {
      popAbierto = null; render(); if (!t) return;
    }
    if (!t) return;
    const act = t.getAttribute('data-act');
    const id = t.getAttribute('data-id');
    const a = id ? porId(id) : null;

    if (act === 'abrir') {
      if (ev.target.closest('.fb-pasos')) return;
      abierto = abierto === id ? null : id; descartando = null; render(); return;
    }
    if (act === 'paso') {
      ev.stopPropagation();
      const paso = t.getAttribute('data-paso');
      if (!a) return;
      if (a.pasos?.[paso]?.hecho) { abierto = id; render(); return; }   // hecho: el detalle tiene "Deshacer"
      popAbierto = (popAbierto && popAbierto.id === id && popAbierto.paso === paso) ? null : { id, paso };
      render();
      const inp = document.querySelector(`.fb-pop[data-pop="${CSS.escape(id)}"] .form-input`);
      if (inp) inp.focus();
      return;
    }
    if (act === 'pop-cancel') { ev.stopPropagation(); popAbierto = null; render(); return; }
    if (act === 'pop-ok') {
      ev.stopPropagation();
      const paso = t.getAttribute('data-paso');
      const pop = t.closest('.fb-pop');
      const datos = {
        facturar_desde: pop.querySelector('[data-f="desde"]')?.value,
        ref: pop.querySelector('[data-f="ref"]')?.value,
        nota: pop.querySelector('[data-f="nota"]')?.value,
      };
      await conCandado(async () => {
        try {
          const r = await S().marcarPaso(a, paso, datos);
          a.pasos[paso] = r.paso; a.estado = r.estado;
          a.historial = (a.historial || []).concat([{ accion: `${paso}_hecho`, detalle: paso === 'qbo' ? `QuickBooks hecho · facturar desde ${datos.facturar_desde}` : 'POC hecho', fecha_iso: new Date().toISOString(), por_email: firebase.auth().currentUser?.email }]);
          popAbierto = null;
          if (a.estado === 'hecho') {
            pendientes = pendientes.filter(x => x.id !== a.id); cerrados.unshift(a);
            Toast.show(`${a.cliente_nombre}: listo. Sale de la bandeja.`, 'ok');
          } else Toast.show(`${paso.toUpperCase()} marcado.`, 'ok');
          render();
        } catch (e) {
          const err = pop.querySelector('[data-f="err"]'); if (err) err.textContent = e.message || 'Error';
          throw e;
        }
      });
      return;
    }
    if (act === 'deshacer') {
      const paso = t.getAttribute('data-paso');
      const ok = await Modal.confirm({ title: `Deshacer ${paso.toUpperCase()}`, message: 'El paso vuelve a pendiente. El historial conserva quién lo había marcado.', confirmLabel: 'Deshacer' });
      if (!ok) return;
      await conCandado(async () => {
        const r = await S().deshacerPaso(a, paso);
        a.pasos[paso] = r.paso; a.estado = r.estado;
        if (r.estado === 'pendiente' && !pendientes.some(x => x.id === a.id)) { cerrados = cerrados.filter(x => x.id !== a.id); pendientes.push(a); }
        Toast.show('Deshecho.', 'ok'); await cargar();
      });
      return;
    }
    if (act === 'descartar') { descartando = id; abierto = id; render(); return; }
    if (act === 'desc-cancel') { descartando = null; render(); return; }
    if (act === 'desc-ok') {
      const box = t.closest('.fb-desc');
      const motivo = box.querySelector('[data-f="motivo"]').value;
      const nota = box.querySelector('[data-f="nota"]').value;
      await conCandado(async () => {
        try {
          await S().descartar(a, { motivo, nota });
          descartando = null; Toast.show('Descartado.', 'ok'); await cargar();
          if (verCerrados) cerrados = await S().listCerrados();
          render();
        } catch (e) { box.querySelector('[data-f="err"]').textContent = e.message || 'Error'; throw e; }
      });
      return;
    }
    if (act === 'reactivar') {
      await conCandado(async () => { await S().reactivar(a); Toast.show('De vuelta en la bandeja.', 'ok'); cerrados = await S().listCerrados(); await cargar(); });
      return;
    }
    if (act === 'reenviar') {
      await conCandado(async () => {
        await S().solicitarReenvio(a);
        a.correo = { ...(a.correo || {}), status: 'queued', error: null };
        Toast.show('Reenvío pedido. El correo sale en unos segundos.', 'ok'); render();
      });
      return;
    }
  }

  function wire() {
    const mount = document.getElementById('fbRows');
    if (!mount._fbBound) { mount.addEventListener('click', onClick); mount._fbBound = true; }
    document.getElementById('fbChips').addEventListener('click', (ev) => {
      const c = ev.target.closest('.fb-chip'); if (!c) return;
      filtro = c.getAttribute('data-f'); render();
    });
    document.getElementById('fbBuscar').addEventListener('input', (ev) => { busqueda = ev.target.value.trim(); render(); });
    document.getElementById('fbVerHechos').addEventListener('change', async (ev) => {
      verCerrados = ev.target.checked;
      if (verCerrados && !cerrados.length) { try { cerrados = await S().listCerrados(); } catch (e) { Toast.show(e.message, 'bad'); } }
      render();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && popAbierto) { popAbierto = null; render(); } });
  }

  async function abrirDeepLink() {
    const id = new URLSearchParams(location.search).get('aviso');
    if (!id) return;
    if (!porId(id)) {
      const a = await S().get(id).catch(() => null);
      if (!a) { Toast.show('Ese aviso no existe o no tienes acceso.', 'bad'); return; }
      if (a.estado === 'hecho' || a.estado === 'descartado') {
        verCerrados = true; document.getElementById('fbVerHechos').checked = true;
        cerrados = await S().listCerrados();
      }
    }
    abierto = id; render();
    const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  }

  function init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = '../login.html';
      try {
        const u = await UsuariosService.getUsuario(user.uid);
        rol = u ? u.rol : null;
        if (!S().puedeGestionar(rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>"; return;
        }
        if (window.FinanzasNav) FinanzasNav.render('bandeja', null, rol);
        wire();
        await cargar();
        await abrirDeepLink();
      } catch (e) { console.error(e); Toast.show('Error al iniciar', 'bad'); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render, cargar };
})();

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
  // Un solo nombre por paso en toda la pantalla (auditoría UX 2026-09-28, T1):
  // "POC" solo se confundía con la Base PoC; el paso es la plataforma.
  const PASO_LABEL = { qbo: 'QBO', poc: 'Plataforma PoC' };

  let rol = null;
  let pendientes = [];
  let cerrados = [];
  let sinNumero = [];       // QBO hecho por una persona SIN número (P5): vista propia
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
    // El correo en error se ve EN LA FILA con su botón, no solo al abrir el
    // detalle (auditoría de módulos 2026-09-30, R3: dos avisos llevaban el
    // correo caído desde septiembre y nadie lo vio).
    if (a.correo?.status === 'error') {
      partes.push(`<span class="alerta">El correo no salió</span>`
        + (a.correo?.mail_queue_id && a.estado !== 'descartado'
          ? ` <button type="button" class="fb-reenviar" data-act="reenviar" data-id="${esc(a.id)}" title="Vuelve a encolar el correo a activaciones@">Reenviar</button>` : ''));
    }
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
        // El "cómo" lo escribe el trigger en contexto.origen_texto con
        // domain/gestionAutorizacion (2026-09-10): la actualización de
        // seriales se aplica SIN firma y esta fila decía "Anexo firmado".
        // Los avisos anteriores al cambio no lo traen — ahí solo la fecha.
        partes.push(`${c.origen_texto ? `${esc(c.origen_texto)} ` : ''}<b>${fCorta(a.fecha_efectiva)}</b> · efectivo desde ese día`);
        break;
      case 'baja_aprobada':
        partes.push(`Fin de facturación <b>${c.fecha_fin_texto ? esc(c.fecha_fin_texto) : fCorta(a.fecha_efectiva)}</b>`);
        partes.push(c.terminacion_total ? 'terminación total' : 'baja parcial');
        partes.push('los equipos entran por devolución');
        break;
      case 'cotizacion_servicio':
        partes.push(`${c.es_visita ? 'Visita cerrada' : 'Entregado'} <b>${fCorta(a.fecha_efectiva)}</b>${c.orden ? ` · orden ${esc(c.orden)}` : ''}`);
        if (c.cotizacion_id) partes.push(`cotización ${esc(c.cotizacion_id)}`);
        if (a.pasos?.qbo?.hecho && a.pasos.qbo.factura) partes.push(`factura <b>${esc(a.pasos.qbo.factura)}</b>`);
        else if (!a.pasos?.qbo?.hecho) partes.push('cobro único, pendiente de facturar');
        break;
      case 'terminacion_completada':
        partes.push(`Flota recuperada <b>${fCorta(a.fecha_efectiva)}</b>${c.orden ? ` (devolución ${esc(c.orden)})` : ''} · cerrar en QuickBooks y apagar en la Plataforma PoC`);
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
    // Reparación de taller: un cobro ÚNICO. Pintarlo con "/mes" sería decir que
    // se le va a cobrar todos los meses.
    if (a.tipo === 'cotizacion_servicio') {
      return `<div class="fb-monto">${money(r.total)}<small>${r.exento ? 'único · exento' : 'único · con ITBMS'}</small></div>`;
    }
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
    // Un paso QBO hecho SIN número de factura queda a medias: el sistema no
    // puede confirmar el pago contra QuickBooks. Se puede anotar después
    // (2026-09-14).
    //
    // El "?" solo se pinta cuando lo marcó UNA PERSONA. Los 38 pasos que dejó
    // la siembra (fuente: 'siembra') son facturación histórica que nadie
    // tecleó: marcarlos como incompletos sería acusar a Recepción de una deuda
    // que el sistema se inventó solo. Se pueden anotar igual si alguien quiere.
    const puedeAnotar = done && key === 'qbo' && !p.factura;
    const faltaNum = puedeAnotar && p.fuente !== 'siembra';
    const title = done
      ? `${p.por_email || '—'} · ${fHora(p.at)}`
        + (p.facturar_desde ? ` · desde ${fLarga(p.facturar_desde)}` : '')
        + (p.factura ? ` · factura ${p.factura}` : (puedeAnotar ? ' · SIN número de factura (clic para anotarlo)' : ''))
        + (p.ref ? ` · ${p.ref}` : '')
      : `Marcar ${label} como hecho`;
    const abrible = !done || puedeAnotar;
    const pop = (abrible && popAbierto && popAbierto.id === a.id && popAbierto.paso === key) ? popHtml(a, key) : '';
    return `<span class="fb-popwrap"><button type="button" class="fb-paso${done ? ' done' : ''}${faltaNum ? ' sin-num' : ''}" data-act="paso" data-id="${esc(a.id)}" data-paso="${key}" title="${esc(title)}"><span class="o"></span>${label}${faltaNum ? '<b class="q">?</b>' : ''}</button>${pop}</span>`;
  }

  function popHtml(a, key) {
    const u = firebase.auth().currentUser;
    const quien = u?.email ? u.email.split('@')[0] : '—';
    if (key === 'qbo') {
      const q = a.pasos?.qbo || {};
      // Paso YA marcado al que le falta el número: solo se pide eso. Sin esta
      // puerta, un paso marcado sin número no se podía completar nunca y la
      // verificación automática del pago lo saltaría para siempre.
      if (q.hecho) {
        return `<div class="fb-pop show" data-pop="${esc(a.id)}">
          <h6>Número de la factura</h6>
          <div class="hint">Este paso ya está marcado, pero sin el número no se puede
            verificar el pago contra QuickBooks.</div>
          <label>N.° de factura</label>
          <input type="text" class="form-input" data-f="factura" maxlength="40" placeholder="10791">
          <div class="err" data-f="err"></div>
          <div class="act"><button type="button" class="btn btn-sm btn-ghost" data-act="pop-cancel">Cancelar</button>
            <button type="button" class="btn btn-sm btn-primary" data-act="pop-factura" data-id="${esc(a.id)}">Anotar</button></div>
        </div>`;
      }
      const def = fIso(a.fecha_efectiva) || fIso(new Date());
      const c = a.contexto || {};
      // Cobro ÚNICO (reparación de taller): "facturar desde" no significa nada
      // —no hay período que arranque— así que el formulario no la pregunta y
      // el número de factura sube a primer campo, que es el dato que cierra el
      // círculo con el taller.
      if (q.periodo === false) {
        return `<div class="fb-pop show" data-pop="${esc(a.id)}">
          <h6>Facturado en QuickBooks</h6>
          <div class="hint">Cobro único de ${esc(c.cotizacion_id || 'la cotización')}${a.resumen?.total != null ? ` por <b>${money(a.resumen.total)}</b>` : ''}.</div>
          <label>N.° de factura</label>
          <input type="text" class="form-input" data-f="factura" maxlength="40" placeholder="10791">
          <div class="hint">Solo el número. Con él, ${esc((c.cotizado_por || 'el taller').split('@')[0])} recibe
            el aviso de que ya quedó facturada; si ahora no lo tienes, se puede anotar después.</div>
          <label>Nota (opcional)</label>
          <input type="text" class="form-input" data-f="ref" maxlength="80" placeholder="Sin fiscalizar, parcial, etc.">
          <div class="err" data-f="err"></div>
          <div class="act"><button type="button" class="btn btn-sm btn-ghost" data-act="pop-cancel">Cancelar</button>
            <button type="button" class="btn btn-sm btn-primary" data-act="pop-ok" data-id="${esc(a.id)}" data-paso="qbo">Marcar facturada</button></div>
          <div class="hint">Quedará como ${esc(quien)} · ahora</div>
        </div>`;
      }
      // Dos campos, no uno (2026-09-14). "Referencia — N.° de factura o nota"
      // pedía las dos cosas a la vez y salieron tres formatos en cuatro
      // registros: "Factura N° 10791", "FACTURA SIN FISCALIZAR … BAJO EL N°
      // 10429.". El número es el dato que consulta la verificación del pago.
      return `<div class="fb-pop show" data-pop="${esc(a.id)}">
        <h6>Hecho en QuickBooks</h6>
        <label>${a.efecto === 'termina' ? 'Deja de cobrarse el' : 'Facturar desde'}</label>
        <input type="date" class="form-input" data-f="desde" value="${esc(def)}">
        <div class="hint">${a.efecto === 'termina' ? 'Fecha en que deja de cobrarse.' : `Prellenada con la fecha efectiva.${c.contrato_fecha ? ` Cámbiala si acordaron otra (por ejemplo, la del contrato: ${fLarga(c.contrato_fecha)}).` : ''}`}</div>
        <label>N.° de factura</label>
        <input type="text" class="form-input" data-f="factura" maxlength="40" placeholder="10791">
        <div class="hint">Solo el número. Es con lo que el sistema va a poder confirmar
          el pago solo; si ahora no lo tienes, se puede anotar después.</div>
        <label>Nota (opcional)</label>
        <input type="text" class="form-input" data-f="ref" maxlength="80" placeholder="Sin fiscalizar, parcial, etc.">
        <div class="err" data-f="err"></div>
        <div class="act"><button type="button" class="btn btn-sm btn-ghost" data-act="pop-cancel">Cancelar</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="pop-ok" data-id="${esc(a.id)}" data-paso="qbo">Marcar hecho</button></div>
        <div class="hint">Quedará como ${esc(quien)} · ahora</div>
      </div>`;
    }
    return `<div class="fb-pop show" data-pop="${esc(a.id)}">
      <h6>Hecho en la Plataforma PoC</h6>
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
    // Renglones de una cotización de taller: lo que se le cobra al cliente,
    // pieza por pieza, para que Recepción arme la factura sin abrir la
    // cotización.
    const rgs = (d.renglones || []).filter(x => Number(x.cant || 0) > 0);
    if (rgs.length) {
      izq += `<h5>Lo cotizado</h5><table><tr><th>Cant.</th><th>Concepto</th><th class="r">Importe</th></tr>` +
        rgs.map(x => `<tr><td>${Number(x.cant || 0)}</td><td>${esc(x.nombre || '—')}${x.parte ? ` <span class="seriales">${esc(x.parte)}</span>` : ''}${x.serial ? `<br><span class="seriales" style="color:var(--fg-3)">${esc(x.serial)}</span>` : ''}</td><td class="r">${money(x.importe)}</td></tr>`).join('') +
        `<tr><td colspan="2"><b>Total</b></td><td class="r"><b>${money(r.total)}</b>${r.exento ? ' · exento' : ` · incl. ITBMS ${money(r.itbms)}`}</td></tr></table>`;
      // La misma pieza sumada a través de los radios (pedido de Solangel): una
      // fila = una línea de factura, por eso la clave lleva el precio. Con un
      // solo radio repetiría la tabla de arriba. Misma regla que
      // CotizacionTotales.resumenPiezas, que esta página no carga.
      if (new Set(rgs.map(x => x.serial).filter(Boolean)).size > 1) {
        const porPieza = new Map();
        rgs.forEach(x => {
          const k = `${String(x.parte || x.nombre || '').trim().toUpperCase()}|${Number(x.precio || 0)}`;
          const f = porPieza.get(k) || { parte: x.parte, nombre: x.nombre, cant: 0, precio: x.precio, importe: 0 };
          f.cant += Number(x.cant || 0);
          f.importe = Math.round((f.importe + Number(x.importe || 0)) * 100) / 100;
          porPieza.set(k, f);
        });
        izq += `<h5 style="margin-top:12px">Resumen por pieza</h5><table><tr><th>Cant.</th><th>Pieza</th><th class="r">P. unit.</th><th class="r">Importe</th></tr>` +
          [...porPieza.values()].map(f => `<tr><td><b>${f.cant}</b></td><td>${esc(f.nombre || '—')}${f.parte ? ` <span class="seriales">${esc(f.parte)}</span>` : ''}</td><td class="r">${money(f.precio)}</td><td class="r">${money(f.importe)}</td></tr>`).join('') +
          `</table>`;
      }
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
    if (c.cotizacion_doc_id) links.push(`<a class="btn btn-sm" href="../cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(c.cotizacion_doc_id)}"><i data-lucide="receipt"></i> Ver la cotización</a>`);
    if (a.tipo === 'cotizacion_servicio' && a.orden_id) links.push(`<a class="btn btn-sm" href="../ordenes/index.html?ids=${encodeURIComponent(a.orden_id)}"><i data-lucide="wrench"></i> Ver la orden</a>`);
    if (a.contrato_doc_id) links.push(`<a class="btn btn-sm" href="../contratos/documento.html?id=${encodeURIComponent(a.contrato_doc_id)}"><i data-lucide="file-text"></i> Ver el contrato</a>`);
    if (a.gestion_id && a.cliente_id) links.push(`<a class="btn btn-sm" href="../clientes/centro.html?id=${encodeURIComponent(a.cliente_id)}&g=${encodeURIComponent(a.gestion_id)}"><i data-lucide="folder-open"></i> Ver el expediente</a>`);
    if (a.cliente_id) links.push(`<a class="btn btn-sm" href="../clientes/centro.html?id=${encodeURIComponent(a.cliente_id)}"><i data-lucide="user"></i> Ficha del cliente</a>`);
    if (links.length) der += `<div class="links">${links.join('')}</div>`;

    // Pie: deshacer pasos / no aplica / reactivar
    let pie = '';
    if (a.estado === 'descartado') {
      const ds = a.descarte || {};
      // Sin por_email es un cierre AUTOMÁTICO del servidor (contrato anulado o
      // vencido, R3): lo dice en vez de dejar un guion vacío.
      pie = `<div class="fb-detfoot"><span class="fb-descartado">No aplica: <b>${esc(S().motivoLabel(ds.motivo))}</b>${ds.nota ? ` · ${esc(ds.nota)}` : ''} — ${ds.por_email ? esc(ds.por_email.split('@')[0]) : 'el sistema'} · ${fHora(ds.at)}</span>
        <span class="push"></span><button type="button" class="btn btn-sm" data-act="reactivar" data-id="${esc(a.id)}"><i data-lucide="undo-2"></i> Reactivar</button></div>`;
    } else if (descartando === a.id) {
      const opts = S().MOTIVOS_DESCARTE.map(m => `<option value="${esc(m.codigo)}">${esc(m.label)}</option>`).join('');
      pie = `<div class="fb-desc" data-desc="${esc(a.id)}"><div class="t">¿Por qué no aplica este aviso?</div>
        <select class="form-input" data-f="motivo" style="max-width:280px"><option value="">Selecciona el motivo…</option>${opts}</select>
        <input class="form-input" data-f="nota" type="text" maxlength="140" placeholder="Nota (opcional; obligatoria si es 'Otro')" style="flex:1;min-width:200px">
        <button type="button" class="btn btn-sm btn-danger" data-act="desc-ok" data-id="${esc(a.id)}">Marcar no aplica</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="desc-cancel">Cancelar</button>
        <div class="err" data-f="err"></div></div>`;
    } else {
      const deshacer = ['qbo', 'poc'].filter(k => a.pasos?.[k]?.hecho)
        .map(k => `<button type="button" class="btn btn-sm btn-ghost" data-act="deshacer" data-id="${esc(a.id)}" data-paso="${k}" title="Vuelve a pendiente; el historial conserva quién lo había marcado"><i data-lucide="rotate-ccw"></i> Deshacer ${PASO_LABEL[k]}</button>`).join('');
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
          <div class="fb-t1"><b>${esc(a.cliente_nombre || '—')}</b> <span class="id">${esc(a.contrato_id || a.contexto?.cotizacion_id || a.gestion_id || '')}</span> <span class="que">· ${esc(que)}</span></div>
          <div class="fb-t2">${linea2(a)}</div>
        </div>
        ${montoHtml(a)}
        ${ageHtml(a)}
        <div class="fb-pasos">${pasoHtml(a, 'qbo', PASO_LABEL.qbo)}${pasoHtml(a, 'poc', PASO_LABEL.poc)}<span class="fb-more" aria-hidden="true">···</span></div>
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
    return [a.cliente_nombre, a.contrato_id, a.gestion_id, a.resumen?.equipos,
      a.contexto?.cotizacion_id, a.orden_id, a.pasos?.qbo?.factura,
    ].some(v => String(v || '').toLowerCase().includes(q));
  }
  // "Pendientes" = estado pendiente, el mismo número del badge de la pestaña;
  // los que esperan la entrega van en su propio chip "En espera" (antes el
  // chip los sumaba y el badge no: dos números para lo mismo; auditoría UX
  // 2026-09-28, T1).
  function pasaFiltro(a) {
    if (filtro === 'all') return a.estado !== 'esperando';
    if (filtro === 'espera') return a.estado === 'esperando';
    return a.estado !== 'esperando' && a.efecto === filtro;
  }

  function render() {
    // Conteos (sobre pendientes, sin la búsqueda)
    const cnt = { all: 0, arranca: 0, cambia: 0, termina: 0, espera: 0 };
    // Correos en error por chip (R3): el chip lleva un punto rojo con el
    // conteo en el title, para no tener que abrir cada fila.
    const err = { all: 0, arranca: 0, cambia: 0, termina: 0, espera: 0 };
    pendientes.forEach(a => {
      const conError = a.correo?.status === 'error';
      if (a.estado === 'esperando') { cnt.espera++; if (conError) err.espera++; return; }
      cnt.all++;
      if (cnt[a.efecto] != null) cnt[a.efecto]++;
      if (conError) { err.all++; if (err[a.efecto] != null) err[a.efecto]++; }
    });
    cnt.sinnum = sinNumero.length;
    document.querySelectorAll('#fbChips [data-cnt]').forEach(el => { el.textContent = cnt[el.getAttribute('data-cnt')] ?? 0; });
    document.querySelectorAll('#fbChips [data-err]').forEach(el => {
      const n = err[el.getAttribute('data-err')] || 0;
      el.hidden = !n;
      el.title = n ? `${n} con el correo sin salir` : '';
    });
    document.querySelectorAll('#fbChips .fb-chip').forEach(el => {
      const on = el.getAttribute('data-f') === filtro;
      el.classList.toggle('active', on); el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (window.WorkspaceTabs) WorkspaceTabs.setBadge('bandeja', cnt.all);

    // "Sin número" es una vista aparte (P5): avisos ya hechos o pendientes
    // cuyo paso QBO lo marcó una persona sin el número de factura. La pastilla
    // con "?" abre el formulario para anotarlo.
    const lista = filtro === 'sinnum'
      ? sinNumero.filter(coincide).sort((a, b) => (toDate(a.pasos?.qbo?.at)?.getTime() || 0) - (toDate(b.pasos?.qbo?.at)?.getTime() || 0))
      : pendientes.filter(pasaFiltro).filter(coincide).sort(orden);
    let html = lista.map(filaHtml).join('');
    if (!lista.length) {
      const enEspera = filtro === 'all' && cnt.espera ? ` Hay ${cnt.espera} en espera de la entrega (chip "En espera").` : '';
      const vacio = filtro === 'sinnum'
        ? 'Todos los pasos QBO marcados tienen su número de factura.'
        : 'Nada pendiente de facturar. Los avisos nuevos aparecen aquí y por correo a activaciones@.';
      html = `<div class="fb-vacio"><i data-lucide="check-circle-2"></i><div>${busqueda ? 'Nada coincide con la búsqueda.' : vacio}${enEspera}</div></div>`;
    }
    if (verCerrados && filtro !== 'sinnum') {
      const cl = cerrados.filter(coincide).sort((a, b) => (toDate(b.updated_at)?.getTime() || 0) - (toDate(a.updated_at)?.getTime() || 0));
      html += `<div class="fb-sep">Hechos y no aplica <span style="font-weight:500;letter-spacing:0">(${cl.length})</span></div>` +
        (cl.length ? cl.map(filaHtml).join('') : `<div class="fb-vacio">Todavía no hay avisos cerrados.</div>`);
    }
    const mount = document.getElementById('fbRows');
    mount.innerHTML = html;
    if (window.Icons) Icons.pintar(mount); else if (window.lucide) lucide.createIcons({ root: mount }); // `nodes` no existe en el vendor: barría todo el documento
  }

  async function cargar() {
    try {
      // Pendientes y "sin número" en paralelo (los dos son decenas de docs).
      // Si la consulta de "sin número" falla, la bandeja sigue: el chip queda en 0.
      [pendientes, sinNumero] = await Promise.all([
        S().listPendientes(),
        S().listSinNumero().catch(e => { console.warn('[bandeja] sin número:', e?.message || e); return []; }),
      ]);
      cerrados = verCerrados ? await S().listCerrados() : cerrados;
    } catch (e) {
      console.error(e);
      const av = document.getElementById('fbAviso');
      av.textContent = `No se pudo leer la bandeja: ${e.message || e}`; av.hidden = false;
    }
    render();
  }

  function todos() { return pendientes.concat(cerrados, sinNumero); }
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
      // Hecho: el detalle tiene "Deshacer". La excepción es un QBO hecho SIN
      // número de factura: ahí el clic abre la ficha para anotarlo, porque si
      // no ese paso se queda a medias para siempre (2026-09-14).
      const hecho = a.pasos?.[paso];
      const puedeAnotar = hecho?.hecho && paso === 'qbo' && !hecho.factura;
      if (hecho?.hecho && !puedeAnotar) { abierto = id; render(); return; }
      popAbierto = (popAbierto && popAbierto.id === id && popAbierto.paso === paso) ? null : { id, paso };
      render();
      const inp = document.querySelector(`.fb-pop[data-pop="${CSS.escape(id)}"] .form-input`);
      if (inp) inp.focus();
      return;
    }
    if (act === 'pop-cancel') { ev.stopPropagation(); popAbierto = null; render(); return; }
    // Anotar el número de factura de un paso QBO que ya estaba marcado.
    if (act === 'pop-factura') {
      ev.stopPropagation();
      const pop = t.closest('.fb-pop');
      const txt = pop.querySelector('[data-f="factura"]')?.value;
      await conCandado(async () => {
        try {
          const num = await S().anotarFactura(a, txt);
          // El mismo aviso puede vivir en dos listas (pendientes y sin número).
          todos().filter(x => x.id === a.id).forEach(x => { x.pasos.qbo.factura = num; });
          sinNumero = sinNumero.filter(x => x.id !== a.id);
          popAbierto = null;
          Toast.show(`Factura ${num} anotada`, 'ok');
          render();
        } catch (e) {
          const err = pop.querySelector('[data-f="err"]'); if (err) err.textContent = e.message || 'Error';
        }
      });
      return;
    }
    if (act === 'pop-ok') {
      ev.stopPropagation();
      const paso = t.getAttribute('data-paso');
      const pop = t.closest('.fb-pop');
      const datos = {
        facturar_desde: pop.querySelector('[data-f="desde"]')?.value,
        factura: pop.querySelector('[data-f="factura"]')?.value,
        ref: pop.querySelector('[data-f="ref"]')?.value,
        nota: pop.querySelector('[data-f="nota"]')?.value,
      };
      // P5 (auditoría de módulos 2026-09-30): marcar QBO sin número pasaba en
      // silencio y 9 de 15 marcas quedaron sin él. No se vuelve obligatorio
      // (decisión 2026-09-14: no trancar a Recepción); deja de ser invisible.
      if (paso === 'qbo' && !String(datos.factura || '').trim()) {
        const ok = await Modal.confirm({
          title: '¿Marcar sin número de factura?',
          message: 'Sin el número, el sistema no puede confirmar el pago contra QuickBooks y el taller no recibe el aviso de "ya quedó facturada". Se puede anotar después desde la pastilla <b>QBO</b> con el <b>?</b>, o en el chip <b>Sin número</b>.',
          confirmLabel: 'Marcar sin número',
        });
        if (!ok) { pop.querySelector('[data-f="factura"]')?.focus(); return; }
      }
      await conCandado(async () => {
        try {
          const r = await S().marcarPaso(a, paso, datos);
          a.pasos[paso] = r.paso; a.estado = r.estado;
          if (paso === 'qbo' && !r.paso.factura && !sinNumero.some(x => x.id === a.id)) sinNumero.push(a);
          a.historial = (a.historial || []).concat([{ accion: `${paso}_hecho`, detalle: paso === 'qbo' ? `QuickBooks hecho · ${a.efecto === 'termina' ? 'deja de cobrarse el' : 'facturar desde'} ${datos.facturar_desde}` : 'Plataforma PoC hecha', fecha_iso: new Date().toISOString(), por_email: firebase.auth().currentUser?.email }]);
          popAbierto = null;
          if (a.estado === 'hecho') {
            pendientes = pendientes.filter(x => x.id !== a.id); cerrados.unshift(a);
            Toast.show(`${a.cliente_nombre}: listo. Sale de la bandeja.`, 'ok');
          } else Toast.show(`${PASO_LABEL[paso] || paso} marcado.`, 'ok');
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
      const ok = await Modal.confirm({ title: `Deshacer ${PASO_LABEL[paso] || paso}`, message: 'El paso vuelve a pendiente. El historial conserva quién lo había marcado.', confirmLabel: 'Deshacer' });
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
          descartando = null; Toast.show('Marcado como no aplica. Sale de la bandeja.', 'ok'); await cargar();
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
      // SIEMPRE del servidor (auditoría de módulos 2026-09-30, R2): antes solo
      // consultaba si `cerrados` estaba vacío, y al marcar el último paso de un
      // aviso la fila se metía ahí localmente — "Hechos y no aplica (1)" cuando
      // en producción había 45, justo cuando uno quiere comprobar "¿ya cerré
      // esto?".
      if (verCerrados) { try { cerrados = await S().listCerrados(); } catch (e) { Toast.show(e.message, 'bad'); } }
      render();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && popAbierto) { popAbierto = null; render(); } });
  }

  // ?q=ALQ20260920-99 (D13, 2026-10-02): el documento del contrato y la
  // cotización llegan aquí con la búsqueda puesta. Prende "Ver hechos" para
  // contestar también "¿esto ya se facturó?" — lo cerrado no sale en pendientes.
  function aplicarBusquedaUrl() {
    const q = (new URLSearchParams(location.search).get('q') || '').trim();
    if (!q) return;
    busqueda = q;
    const inp = document.getElementById('fbBuscar'); if (inp) inp.value = q;
    verCerrados = true;
    const chk = document.getElementById('fbVerHechos'); if (chk) chk.checked = true;
  }

  // Ya cargada la bandeja con ?q=: si lo único que coincide está "En espera"
  // (contrato con equipo por entregar), cambia a ese chip en vez de decir
  // "Nada coincide"; si coincide un solo aviso, lo abre — un clic menos.
  function ajustarBusquedaUrl() {
    if (!new URLSearchParams(location.search).get('q') || !busqueda) return;
    const pend = pendientes.filter(coincide);
    const vivos = pend.filter(a => a.estado !== 'esperando');
    if (!vivos.length && pend.length) filtro = 'espera';
    const hits = pend.concat(cerrados.filter(coincide));
    if (hits.length === 1) abierto = hits[0].id;
    render();
    if (abierto) {
      const row = document.querySelector(`[data-row="${CSS.escape(abierto)}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    }
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
    // Un aviso en espera ya no sale en "Pendientes": el deep-link cambia de chip.
    const av = porId(id);
    if (av && av.estado === 'esperando') filtro = 'espera';
    abierto = id; render();
    const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  }

  function init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = '../login.html';
      try {
        const u = await Sesion.miPerfil(user);
        rol = u ? u.rol : null;
        if (!S().puedeGestionar(rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>"; return;
        }
        // Barra de Finanzas solo admin/contabilidad (need-to-know). La página
        // la pintó en DOMContentLoaded con la sesión cacheada; aquí se confirma
        // con el rol real: se agrega si faltaba, se quita si no corresponde.
        const mount = document.getElementById('wsTabs-mount');
        if (mount) {
          if (S().ROLES_FINANZAS.includes(rol)) { if (!mount.children.length && window.FinanzasNav) FinanzasNav.render('bandeja'); }
          else mount.innerHTML = '';
        }
        wire();
        aplicarBusquedaUrl();
        await cargar();
        ajustarBusquedaUrl();
        await abrirDeepLink();
      } catch (e) { console.error(e); Toast.show('Error al iniciar', 'bad'); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render, cargar };
})();

// @ts-nocheck
// Documento de contrato v2 (2026-08-28) — la vista "papel" del contrato con el
// formato nuevo: secciones numeradas citables, Anexo A por serial (solo
// seriales de bodega, nunca inferidos), valor de reposición por unidad y
// firma digital estampada con su rastro. El formato anterior sigue en
// imprimir-contrato.html para los contratos ya firmados en papel.

(function () {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `$${(Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2)}`;
  const fecha = (ts) => {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    return d && !isNaN(d) ? d : null;
  };

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const NUM_LETRAS = { 1: 'un', 2: 'dos', 3: 'tres', 6: 'seis', 12: 'doce', 18: 'dieciocho', 24: 'veinticuatro', 36: 'treinta y seis' };

  async function cargar() {
    const c = await ContratosService.resolverContrato(idParam);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    const docId = c.id || idParam;

    // ── Toolbar / aviso de estado ──
    $('lnkFicha').href = `../clientes/centro.html?id=${encodeURIComponent(c.cliente_id || '')}`;
    $('lnkClasico').href = `imprimir-contrato.html?id=${encodeURIComponent(docId)}`;
    if (c.estado === 'pendiente_aprobacion' || (!c.firmado && c.estado !== 'activo')) {
      const av = $('avisoEstado');
      av.style.display = 'block';
      av.textContent = c.estado === 'pendiente_aprobacion'
        ? 'Borrador — el contrato está pendiente de aprobación; el documento aún no lleva firmas.'
        : 'El contrato está aprobado pero aún sin la firma del cliente.';
    }

    // ── Encabezado ──
    const numero = c.contrato_id || docId;
    $('hNumero').textContent = numero;
    $('hTipoDur').textContent = [c.tipo_contrato || c.codigo_tipo || '', c.duracion || ''].filter(Boolean).join(' · ');

    // ── Sección 1: partes ──
    const rucdv = (c.cliente_rucdv && String(c.cliente_rucdv).trim())
      || ((c.cliente_ruc || c.ruc || '') + (c.cliente_dv ? ` DV ${c.cliente_dv}` : '')).trim();
    const rep = c.representante || '____________________';
    const repCed = c.representante_cedula || '________________';
    $('sPartes').innerHTML = `<b>C COMUNICA, S.A.</b> (RUC 32977-27-249966 DV 39), en adelante
      <b>LA EMPRESA</b>, y <b>${esc(c.cliente_nombre || '—')}</b>${rucdv ? ` (RUC ${esc(rucdv)})` : ''},
      representada por <b>${esc(rep)}</b>, cédula ${esc(repCed)}, en adelante <b>EL CLIENTE</b>,
      convienen el presente contrato de servicio de comunicación conforme a las secciones y
      cláusulas siguientes, que se citan por su número.`;

    // ── Sección 2: líneas + totales (campos persistidos; fallback calculado) ──
    const esVenta = /venta/i.test(c.tipo_contrato || '') || (c.codigo_tipo || '').startsWith('VTA');
    let filas = '';
    let subEquipos = 0;
    (c.equipos || []).forEach((l) => {
      const cant = Number(l.cantidad || 0); const precio = Number(l.precio || 0);
      subEquipos += cant * precio;
      filas += `<tr><td>${cant}</td><td>${esc((esVenta ? '' : 'Alquiler ') + (l.modelo || l.descripcion || 'Equipos de comunicación'))}</td>
        <td>${esVenta ? 'Único' : 'Mensual'}</td><td class="right">${money(precio)}</td><td class="right">${money(cant * precio)}</td></tr>`;
    });
    (c.cargos || []).forEach((x) => {
      const cant = Math.max(1, Number(x.cantidad || 1)); const monto = Number(x.monto || 0);
      filas += `<tr><td>${cant}</td><td>${esc(x.concepto || '—')}</td>
        <td>${x.recurrente ? 'Mensual' : 'Único'}</td><td class="right">${money(monto)}</td><td class="right">${money(cant * monto)}</td></tr>`;
    });
    const subtotal = Number(c.subtotal ?? subEquipos) || subEquipos;
    const rate = Number(c.itbms_porcentaje ?? (window.FMT?.ITBMS_RATE ?? 0.07));
    const itbmsAplica = (typeof c.itbms_aplica === 'undefined') ? true : Boolean(c.itbms_aplica);
    const itbms = Number(c.itbms_monto ?? (itbmsAplica ? subtotal * rate : 0));
    const total = Number(c.total_con_itbms ?? (subtotal + itbms));
    const cargosUnico = Number(c.cargos_unico ?? 0);
    const primerPago = Number(c.primer_pago ?? total);
    filas += `<tr><td colspan="4" class="right">Subtotal ${esVenta ? '' : 'mensual'}</td><td class="right">${money(subtotal)}</td></tr>
      <tr><td colspan="4" class="right">${itbmsAplica ? `ITBMS (${Math.round(rate * 100)}%)` : 'ITBMS EXENTO'}</td><td class="right">${money(itbms)}</td></tr>
      <tr><td colspan="4" class="right" style="font-weight:700;">TOTAL ${esVenta ? '' : 'MENSUAL'}</td><td class="right" style="font-weight:700;">${money(total)}</td></tr>`;
    if (cargosUnico > 0 || primerPago > total + 0.005) {
      filas += `<tr><td colspan="4" class="right" style="font-weight:700; border-bottom:1.5px solid #111;">PRIMER PAGO (mes 1 + únicos c/ITBMS)</td>
        <td class="right" style="font-weight:700; border-bottom:1.5px solid #111;">${money(primerPago)}</td></tr>`;
    }
    $('tLineas').innerHTML = filas;
    const pagoBits = [];
    if (Number(c.deposito_monto || 0) > 0) pagoBits.push(`Depósito de garantía: <b>${money(c.deposito_monto)}</b> (cláusula 16)`);
    if (c.forma_pago) pagoBits.push(`Forma de pago: <b>${esc(c.forma_pago)}</b> (cláusulas 10 y 11)`);
    if (c.observaciones) pagoBits.push(esc(c.observaciones));
    $('pPago').innerHTML = pagoBits.join(' · ');

    // ── Secciones 3 y 4 + cláusulas 5-18 ──
    // Contrato FIRMADO digitalmente: el texto sale de la copia CONGELADA en la
    // solicitud de firma — lo que el cliente leyó y aceptó, inmutable aunque
    // las cláusulas del sistema cambien después. Sin firma digital (o enlaces
    // viejos sin copia), se muestra el texto vigente y se dice con claridad.
    let sFirma = null;
    if (c.firmado && c.firmado_digital?.solicitud_id) {
      try {
        const snap = await firebase.firestore().collection('firma_solicitudes')
          .doc(c.firmado_digital.solicitud_id).get();
        sFirma = snap.exists ? snap.data() : null;
      } catch (e) { console.warn('solicitud de firma no legible', e); }
    }
    const frozen = sFirma?.documento?.clausulas_html ? sFirma.documento : null;
    const durNum = Number(String(c.duracion || '').match(/\d+/)?.[0] || 0);
    const durHtml = `<b>${durNum
      ? `${NUM_LETRAS[durNum] || durNum} (${durNum}) meses` : esc(c.duracion || '____ meses')}</b>`;
    $('txtInventario').innerHTML = frozen?.inventario_html || ContratoV2Texto.inventarioHtml;
    $('txtVigencia').innerHTML = frozen?.vigencia_html || ContratoV2Texto.vigenciaHtml(durHtml);
    $('olClausulas').innerHTML = frozen?.clausulas_html || ContratoV2Texto.clausulasHtml;
    if (c.firmado && c.firmado_digital) {
      const av = $('avisoEstado');
      av.style.display = 'block';
      if (frozen) {
        av.style.background = '#E7F5EC'; av.style.borderColor = '#1FA56B'; av.style.color = '#17714B';
        av.textContent = `Texto conforme al firmado digitalmente — copia congelada en la solicitud de firma (versión ${frozen.texto_version || 'sin versión'}).`;
      } else {
        av.textContent = 'Este contrato se firmó digitalmente sobre el RESUMEN del enlace de firma: '
          + 'el texto completo no quedó congelado en esa solicitud. Las cláusulas mostradas son el '
          + 'texto vigente del sistema, como referencia — el firmado válido es el que vio el cliente.';
      }
    }

    // ── Firmas ──
    const nombreFirmaCliente = `${esc(rep)} · ${esc(c.cliente_nombre || '')}`;
    ['f1Cliente', 'f2Cliente', 'f3Cliente'].forEach((id) => { $(id).innerHTML = nombreFirmaCliente; });
    const fFirma = fecha(c.firmado_fecha) || fecha(c.fecha_activacion) || fecha(c.fecha_aprobacion);
    if (fFirma) $('pFechaFirma').textContent =
      `Panamá, ${fFirma.getDate()} de ${MESES[fFirma.getMonth()]} de ${fFirma.getFullYear()}.`;

    // Firma digital del cliente: el trazo vive en la solicitud de firma; el
    // rastro (nombre, cédula, hash) quedó estampado en el contrato.
    if (c.firmado && c.firmado_digital) {
      const fd = c.firmado_digital;
      const png = sFirma?.firma?.png || null;
      const fAt = fecha(fd.firmado_at);
      const sello = `<div>${png ? `<img class="trazo" src="${png}" alt="firma">` : ''}
        <div class="sello">✔ Firmado electrónicamente por ${esc(fd.firmante_nombre || rep)}<br>
        Cédula: ${esc(fd.firmante_cedula || '—')}${fd.firmante_cargo ? ` · ${esc(fd.firmante_cargo)}` : ''}<br>
        ${fAt ? fAt.toLocaleString('es-PA') : ''}${fd.hash ? `<br>Hash: <span class="mono">${esc(fd.hash.slice(0, 16))}…</span>` : ''}</div></div>`;
      document.querySelectorAll('[data-firma="cliente"]').forEach((el) => { el.innerHTML = sello; });
    } else if (c.firmado) {
      const fAt = fecha(c.firmado_fecha);
      const sello = `<div class="sello">✔ Firmado (respaldo físico/foto)${fAt ? `<br>${fAt.toLocaleDateString('es-PA')}` : ''}</div>`;
      document.querySelectorAll('[data-firma="cliente"]').forEach((el) => { el.innerHTML = sello; });
    }

    // Sello de LA EMPRESA (aprobador) en los espacios de la derecha.
    if ((c.estado === 'activo' || c.estado === 'aprobado') && c.aprobado_por_uid) {
      try {
        const u = await UsuariosService.getUsuario(c.aprobado_por_uid);
        const fAp = fecha(c.fecha_aprobacion);
        const sello = `<div class="sello">✔ Firmado electrónicamente por ${esc(u?.nombre || '—')}<br>
          ${esc(u?.cargo || 'Administración')}${fAp ? `<br>${fAp.toLocaleString('es-PA')}` : ''}</div>`;
        document.querySelectorAll('[data-firma="empresa"]').forEach((el) => { el.innerHTML = sello; });
      } catch (e) { console.warn('aprobador no legible', e); }
    }

    // ── Verificación (HMAC + QR de onContratoActivado) ──
    if (c.firma_url && c.firma_codigo && (c.estado === 'activo' || c.estado === 'aprobado')) {
      $('verifBox').style.display = 'flex';
      $('verifCodigo').textContent = c.firma_codigo;
      $('verifUrl').textContent = c.firma_url;
      $('folioVerif1').textContent = `Verificación: ${c.firma_url}`;
      if (window.QRCode) {
        const canvas = document.createElement('canvas');
        QRCode.toCanvas(canvas, c.firma_url, { width: 84 }, (err) => {
          if (!err) $('qrVerif').appendChild(canvas);
        });
      }
    }
    $('folio1').textContent = `${numero} · Página 1 (+ Anexo A)`;
    $('folio2').textContent = `${numero} · Condiciones generales`;

    // ── Anexo A: seriales reales del pool asignados a ESTE contrato ──
    let unidades = [];
    try { unidades = await EquiposPoolService.listarPorContrato(docId); }
    catch (e) { console.warn('pool no legible', e); }
    $('aSub').textContent = `Contrato ${numero} · ${c.cliente_nombre || ''}`;
    $('aTotal').innerHTML = `${unidades.length} equipo(s)<br><span style="font-weight:400;color:#555;">por serial</span>`;
    $('folioA').textContent = `Anexo A · ${numero}`;

    let modelosMap = {};
    try {
      const ms = await ModelosService.getModelos();
      (ms || []).forEach((m) => { modelosMap[m.id] = m; });
    } catch (e) { console.warn('modelos no legibles', e); }

    const filasA = unidades.map((e, i) => `<tr>
      <td>${i + 1}</td><td class="mono">${esc(e.serial || e.id)}</td>
      <td>${esc(e.modelo_label || e.modelo || '—')}</td>
      <td style="color:#bbb;">____________</td>
      <td>${e.propiedad === 'cliente' ? 'Del cliente' : 'C COMUNICA'}</td><td>☐</td></tr>`);
    // Filas en blanco para la verificación conjunta en sitio.
    const desde = unidades.length;
    for (let i = 0; i < (unidades.length ? 3 : 8); i++) {
      filasA.push(`<tr><td>${desde + i + 1}</td><td class="mono" style="color:#bbb;">____________</td>
        <td style="color:#bbb;">____________</td><td style="color:#bbb;">____________</td>
        <td style="color:#bbb;">______</td><td>☐</td></tr>`);
    }
    if (!unidades.length) {
      filasA.unshift(`<tr><td colspan="6" style="color:#555; font-size:11px;">Sin seriales de
        bodega asignados a este contrato — filas en blanco para el levantamiento en verificación
        conjunta con EL CLIENTE:</td></tr>`);
    }
    $('tAnexoA').innerHTML = filasA.join('');

    // Resumen por modelo + valor de reposición (precio de venta del catálogo;
    // si el modelo no tiene, aplica el valor genérico del contrato: $200).
    const grupos = {};
    unidades.forEach((e) => {
      const k = e.modelo_label || e.modelo || '—';
      grupos[k] = grupos[k] || { ceco: 0, cli: 0, modelo_id: e.modelo_id || null };
      grupos[k][e.propiedad === 'cliente' ? 'cli' : 'ceco']++;
      if (!grupos[k].modelo_id && e.modelo_id) grupos[k].modelo_id = e.modelo_id;
    });
    let totC = 0; let totCli = 0;
    const filasR = Object.keys(grupos).sort().map((k) => {
      const g = grupos[k]; totC += g.ceco; totCli += g.cli;
      const m = g.modelo_id ? modelosMap[g.modelo_id] : null;
      const valor = g.ceco === 0 ? 'n/a (del cliente)'
        : `${money(Number(m?.precio_venta) > 0 ? m.precio_venta : 200)} + ITBMS`;
      return `<tr><td>${esc(k)}</td><td class="right">${g.ceco || '—'}</td>
        <td class="right">${g.cli || '—'}</td><td class="right">${g.ceco + g.cli}</td>
        <td class="right">${valor}</td></tr>`;
    });
    filasR.push(`<tr><td style="font-weight:700;">TOTAL</td><td class="right" style="font-weight:700;">${totC}</td>
      <td class="right" style="font-weight:700;">${totCli}</td><td class="right" style="font-weight:700;">${totC + totCli}</td><td></td></tr>`);
    $('tResumenA').innerHTML = filasR.join('');

    $('doc').style.display = 'block';
  }

  // Mismo arranque que imprimir-contrato: los <script defer> ya cargaron los
  // servicios cuando corre este archivo (también defer, va de último).
  window.addEventListener('DOMContentLoaded', () => {
    cargar().catch((e) => {
      console.error(e);
      window.Toast?.show?.('No se pudo cargar el documento', 'bad');
    });
  });
})();

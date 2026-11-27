// @ts-nocheck
// Caja menuda — las piezas de pantalla que comparten quien pide
// (caja/index.html) y contabilidad (caja/contabilidad.html): la tarjeta de un
// gasto, su detalle con las acciones que le tocan a quien mira, y las hojas
// de pedir, pagar, rendir y cerrar.
//
// Pensado para el teléfono: todo ocurre en hojas (Modal.sheet), que en
// pantallas angostas suben desde abajo con los botones al alcance del pulgar.
// CSS en css/caja.css (prefijo .cm-).
//
//   CajaUI.init({ yo, cfg, onCambio })   yo = { uid, rol, nombre, email }
//   CajaUI.tarjeta(g, { quien })         HTML de la fila; lleva data-cm-id
//   CajaUI.abrir(g)                      detalle + acciones
//   CajaUI.nuevo()                       pedir un gasto
window.CajaUI = (() => {
  const C = () => window.CajaMenuda;
  const S = () => window.CajaMenudaService;
  const esc = (s) => FMT.esc(s);
  const $ = (root, sel) => root.querySelector(sel);

  let yo = null, cfg = null, onCambio = () => {};

  function init(o) { yo = o.yo; cfg = o.cfg; onCambio = o.onCambio || (() => {}); }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const aDate = (v) => (v?.toDate ? v.toDate() : (v instanceof Date ? v : null));
  function fCorta(v) { const d = aDate(v); return d ? `${d.getDate()} ${MESES[d.getMonth()]}` : ''; }
  function fHora(v) {
    const d = aDate(v); if (!d) return '';
    return `${d.getDate()} ${MESES[d.getMonth()]}, ${d.toLocaleTimeString('es-PA', { hour: 'numeric', minute: '2-digit' })}`;
  }
  function fIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : '';
  }
  const dinero = (n) => C().dinero(n);
  const chip = (g) => {
    const e = C().ESTADOS[g.estado] || { label: g.estado, tono: 'neutro' };
    return `<span class="bj-chip bj-chip--${e.tono}">${esc(e.label)}</span>`;
  };
  // Un viático recorre el camino del reembolso, pero no es un reembolso:
  // no hay factura. En pantalla se llama por su nombre.
  const esViatico = (g) => g.tipo === 'reembolso' && C().esViatico(g, cfg);
  const tipoLabel = (g) => (esViatico(g) ? 'Viático' : (C().TIPOS[g.tipo]?.label || ''));
  const pintarIconos = (root) => { if (window.lucide?.createIcons) lucide.createIcons({ nodes: [root] }); };
  const fallo = (e) => {
    console.error('[caja]', e);
    const m = e?.code === 'permission-denied' ? 'No tienes permiso para eso (o alguien ya lo movió). Recarga la lista.' : (e?.message || 'No se pudo guardar.');
    Toast.show(m, 'bad');
  };

  // ── Tarjeta de la lista ────────────────────────────────────────────────
  // quien: 'mio' (mis gastos: qué espera) · 'otro' (aprobar / contabilidad:
  // de quién es).
  function tarjeta(g, { quien = 'mio' } = {}) {
    const tipo = tipoLabel(g);
    const sub = [g.categoria, tipo, fCorta(g.created_at), g.numero].filter(Boolean).map(esc).join(' · ');
    const dias = C().diasSinRendir(g);
    const tarde = dias != null && dias > cfg.dias_rendir;
    const espera = quien === 'mio' ? C().esperaA(g) : '';
    return `<button type="button" class="cm-card" data-cm-id="${esc(g.id)}">
      <span class="cm-card-monto">${dinero(g.monto)}${g.via === 'ach' ? '<small>ACH</small>' : ''}</span>
      <span class="cm-card-main">
        ${quien === 'otro' ? `<span class="cm-card-quien">${esc(g.solicitante_nombre || g.solicitante_email || '')}</span>` : ''}
        <b>${esc(g.concepto || '')}</b>
        <span class="cm-card-sub">${sub}</span>
        ${espera ? `<span class="cm-card-espera">${esc(espera)}</span>` : ''}
        ${tarde ? `<span class="cm-card-tarde">Lleva ${dias} días sin rendir</span>` : ''}
      </span>
      ${chip(g)}
    </button>`;
  }

  // ── Fotos de la factura ────────────────────────────────────────────────
  // Selector con dos entradas: la cámara (lo normal en el teléfono) y un
  // archivo (foto guardada o PDF). Cada archivo sube al elegirlo; `lista`
  // es el arreglo vivo de { path, tipo, nombre }.
  function selectorFotos(lista, max) {
    return `<div class="cm-fotos" data-cm-fotos>
      <div class="cm-fotos-lista"></div>
      <div class="cm-fotos-btns">
        <label class="btn btn-ghost cm-foto-btn"><i data-lucide="camera"></i> Tomar foto
          <input type="file" accept="image/*" capture="environment" hidden data-cm-file></label>
        <label class="btn btn-ghost cm-foto-btn"><i data-lucide="paperclip"></i> Elegir archivo
          <input type="file" accept="image/*,application/pdf" hidden data-cm-file></label>
      </div>
      <p class="form-hint">Que se lean el proveedor, la fecha y el total. Hasta ${max} fotos.</p>
    </div>`;
  }
  function cablearFotos(root, lista, max, alCambiar = () => {}) {
    const cont = $(root, '[data-cm-fotos]');
    if (!cont) return { ocupado: () => false };
    let subiendo = 0;
    const pintar = () => {
      $(cont, '.cm-fotos-lista').innerHTML = lista.map((r, i) =>
        `<span class="cm-foto-chip"><i data-lucide="${r.tipo === 'application/pdf' ? 'file-text' : 'camera'}"></i>
          ${esc(r.tipo === 'application/pdf' ? (r.nombre || 'PDF') : `Foto ${i + 1}`)}
          <button type="button" data-cm-quitar="${i}" aria-label="Quitar">×</button></span>`).join('')
        + (subiendo ? `<span class="cm-foto-chip is-subiendo">Subiendo…</span>` : '');
      cont.querySelectorAll('.cm-foto-btn').forEach(b => b.classList.toggle('is-off', lista.length >= max));
      pintarIconos(cont);
      alCambiar();
    };
    cont.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-cm-file]');
      if (!inp || !inp.files?.length) return;
      const file = inp.files[0];
      inp.value = '';
      if (lista.length >= max) { Toast.show(`Máximo ${max} fotos.`, 'warn'); return; }
      subiendo++; pintar();
      try { lista.push(await S().subirRecibo(file)); }
      catch (err) { fallo(err); }
      finally { subiendo--; pintar(); }
    });
    cont.addEventListener('click', (e) => {
      const q = e.target.closest('[data-cm-quitar]');
      if (!q) return;
      lista.splice(Number(q.dataset.cmQuitar), 1);
      pintar();
    });
    pintar();
    return { ocupado: () => subiendo > 0 };
  }

  // ── Pedir (o corregir) un gasto ────────────────────────────────────────
  async function nuevo(previo = null) {
    const f = previo
      ? { tipo: previo.tipo, monto: previo.monto, categoria: previo.categoria, concepto: previo.concepto,
          proveedor: previo.proveedor || '', fecha_gasto: previo.fecha_gasto || FMT.hoyISOPanama(),
          factura_numero: previo.factura_numero || '', recibos: [...(previo.recibos || [])] }
      : { tipo: 'reembolso', monto: '', categoria: '', concepto: '', proveedor: '', fecha_gasto: FMT.hoyISOPanama(), factura_numero: '', recibos: [] };
    // Corrigiendo un anticipo no se puede pasar a viático (el tipo no cambia).
    const categorias = previo?.tipo === 'anticipo' ? cfg.categorias.filter(c => !C().sinFactura(c, cfg)) : cfg.categorias;
    const tipoBtn = (t) => `<button type="button" class="cm-seg-btn${f.tipo === t ? ' is-on' : ''}" data-cm-tipo="${t}"${previo ? ' disabled' : ''}>
        <b>${esc(C().TIPOS[t].corto)}</b><span>${esc(C().TIPOS[t].ayuda)}</span></button>`;
    const html = `
      <div class="cm-form">
        <div class="cm-seg" role="radiogroup" aria-label="Tipo">${tipoBtn('reembolso')}${tipoBtn('anticipo')}</div>
        <label class="cm-campo cm-campo--monto"><span>Monto</span>
          <span class="cm-monto-in"><i>$</i><input type="text" inputmode="decimal" id="cmMonto" class="form-input" placeholder="0.00" value="${esc(f.monto)}" autocomplete="off"></span></label>
        <p class="cm-aviso" id="cmAvisoVia" hidden></p>
        <label class="cm-campo"><span>Categoría</span>
          <select id="cmCategoria" class="form-input"><option value="">Elige…</option>
            ${categorias.map(c => `<option${f.categoria === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <p class="cm-aviso cm-aviso--info" id="cmAvisoViatico" hidden>Los viáticos <b>no llevan factura</b>.
          Cuando lo apruebe tu jefe, pasas por contabilidad a cobrarlo.</p>
        <label class="cm-campo"><span>¿Para qué fue?</span>
          <input type="text" id="cmConcepto" class="form-input" maxlength="300" placeholder="Ej.: peaje para la visita a DECAMERON" value="${esc(f.concepto)}"></label>
        <div data-cm-solo="reembolso">
          <label class="cm-campo" data-cm-factura><span>Proveedor</span>
            <input type="text" id="cmProveedor" class="form-input" maxlength="120" placeholder="A quién se le pagó" value="${esc(f.proveedor)}"></label>
          <div class="cm-dos">
            <label class="cm-campo"><span id="cmFechaLbl">Fecha de la factura</span>
              <input type="date" id="cmFecha" class="form-input" max="${FMT.hoyISOPanama()}" value="${esc(f.fecha_gasto)}"></label>
            <label class="cm-campo" data-cm-factura><span>N.º de factura <em>(opcional)</em></span>
              <input type="text" id="cmFactura" class="form-input" maxlength="40" value="${esc(f.factura_numero)}"></label>
          </div>
          <div class="cm-campo" data-cm-factura><span>Factura fiscal</span>${selectorFotos(f.recibos, C().MAX_RECIBOS)}</div>
        </div>
        <p class="cm-aviso cm-aviso--info" data-cm-solo="anticipo">Cuando lo apruebe tu jefe, pasas por contabilidad a retirar el efectivo.
          Después tienes <b>${cfg.dias_rendir} días</b> para traer la factura fiscal y el vuelto.</p>
        <p class="cm-aprueba" id="cmAprueba"></p>
      </div>`;
    let fotos = { ocupado: () => false };
    const leer = (root) => {
      f.monto = $(root, '#cmMonto').value;
      f.categoria = $(root, '#cmCategoria').value;
      f.concepto = $(root, '#cmConcepto').value;
      f.proveedor = $(root, '#cmProveedor').value;
      f.fecha_gasto = $(root, '#cmFecha').value;
      f.factura_numero = $(root, '#cmFactura').value;
      return f;
    };
    const res = await Modal.sheet({
      title: previo ? 'Corregir el gasto' : 'Nuevo gasto', icon: 'banknote', size: 'md', html,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'enviar', label: previo ? 'Guardar' : 'Enviar a aprobación', primary: true, icon: 'send' }],
      onMount(root) {
        const refrescar = () => {
          // Viático: no hay nada que elegir ni que fotografiar. Se pide, se
          // aprueba y se cobra.
          const viatico = C().sinFactura($(root, '#cmCategoria').value, cfg);
          if (viatico && !previo) f.tipo = 'reembolso';
          $(root, '.cm-seg').hidden = viatico;
          $(root, '#cmAvisoViatico').hidden = !viatico;
          root.querySelectorAll('[data-cm-factura]').forEach(el => { el.hidden = viatico; });
          $(root, '#cmFechaLbl').textContent = viatico ? 'Fecha del viático' : 'Fecha de la factura';
          root.querySelectorAll('[data-cm-solo]').forEach(el => { el.hidden = el.dataset.cmSolo !== f.tipo; });
          root.querySelectorAll('[data-cm-tipo]').forEach(b => b.classList.toggle('is-on', b.dataset.cmTipo === f.tipo));
          const m = C().num($(root, '#cmMonto').value);
          const av = $(root, '#cmAvisoVia');
          if (m > cfg.tope_recibo && f.tipo === 'reembolso') {
            av.hidden = false; av.className = 'cm-aviso cm-aviso--info';
            av.innerHTML = `Pasa de <b>${dinero(cfg.tope_recibo)}</b>, el tope de caja menuda: no sale en efectivo. Contabilidad lo tramita con una solicitud de pago y te lo devuelve por <b>ACH</b>.`;
          } else if (m > cfg.tope_recibo && f.tipo === 'anticipo') {
            av.hidden = false; av.className = 'cm-aviso';
            av.innerHTML = `Recuerda que el tope de caja menuda es de <b>${dinero(cfg.tope_recibo)}</b> por factura.`;
          } else av.hidden = true;
        };
        root.addEventListener('click', (e) => {
          const b = e.target.closest('[data-cm-tipo]');
          if (!b || b.disabled) return;
          f.tipo = b.dataset.cmTipo; refrescar();
        });
        $(root, '#cmMonto').addEventListener('input', refrescar);
        $(root, '#cmCategoria').addEventListener('change', refrescar);
        fotos = cablearFotos(root, f.recibos, C().MAX_RECIBOS);
        refrescar();
        if (previo) {
          $(root, '#cmAprueba').textContent = previo.aprobador_nombre ? `Lo aprueba ${previo.aprobador_nombre}.` : 'Lo aprueba administración.';
        } else {
          S().miJefe().then(j => { $(root, '#cmAprueba').textContent = j.nombre ? `Lo aprueba ${j.nombre}.` : 'Lo aprueba administración.'; }).catch(() => {});
        }
      },
      async onAction(action, root) {
        if (action !== 'enviar') return action;
        if (fotos.ocupado()) { Toast.show('Espera a que termine de subir la foto.', 'warn'); return false; }
        leer(root);
        const viatico = C().sinFactura(f.categoria, cfg);
        const envio = { ...f, recibos: f.tipo === 'reembolso' && !viatico ? f.recibos : [] };
        if (viatico) { envio.proveedor = ''; envio.factura_numero = ''; }
        const errores = C().validar(envio, cfg, { hoyISO: FMT.hoyISOPanama() });
        if (errores.length) { Toast.show(errores[0], 'warn'); return false; }
        const btn = root.querySelector('[data-sheet-action="enviar"]');
        btn.disabled = true;
        try {
          if (previo) await S().editar(previo.id, envio); else await S().crear(envio);
          return 'ok';
        } catch (e) { fallo(e); btn.disabled = false; return false; }
      },
    });
    if (res === 'ok') {
      Toast.show(previo ? 'Gasto corregido.' : 'Enviado. Te avisamos por correo cuando lo aprueben.', 'ok');
      onCambio();
    }
  }

  // ── Detalle ────────────────────────────────────────────────────────────
  const dato = (k, v) => (v ? `<div class="cm-dato"><dt>${esc(k)}</dt><dd>${v}</dd></div>` : '');

  function detalleHtml(g) {
    const viatico = esViatico(g);
    const cajas = [];
    if (g.estado === 'rechazado' && g.rechazo) {
      cajas.push(`<div class="cm-caja cm-caja--mal"><b>Rechazado por ${esc(g.rechazo.por_nombre || '')}</b><br>${esc(g.rechazo.motivo || '')}</div>`);
    }
    if (g.estado === 'entregado' && g.rendicion_devuelta?.motivo) {
      cajas.push(`<div class="cm-caja cm-caja--mal"><b>Contabilidad devolvió la rendición</b><br>${esc(g.rendicion_devuelta.motivo)}</div>`);
    }
    if (g.via === 'ach') {
      cajas.push(`<div class="cm-caja">Pasa del tope de ${dinero(cfg.tope_recibo)}: no sale del fondo. Se paga por <b>ACH</b> con una solicitud de pago firmada.</div>`);
    }
    const e = g.entrega;
    const r = g.rendicion;
    const plata = [];
    if (e) plata.push(dato(g.tipo === 'anticipo' ? 'Efectivo entregado' : 'Pagado',
      `${dinero(e.monto)} · ${e.metodo === 'ach' ? `ACH ${esc(e.referencia || '')}` : 'efectivo'} · ${esc(e.por_nombre || '')}, ${fHora(e.at)}`));
    if (r) {
      plata.push(dato('Gastado', dinero(r.monto_gastado)));
      plata.push(dato(r.vuelto >= 0 ? 'Vuelto a devolver' : 'Gastó de más', dinero(Math.abs(r.vuelto))));
      if (r.nota) plata.push(dato('Nota', esc(r.nota)));
    }
    if (g.cierre) {
      plata.push(dato('Cerrado', `${esc(g.cierre.por_nombre || '')}, ${fHora(g.cierre.at)}`
        + (g.cierre.vuelto_recibido ? ` · recibió ${dinero(g.cierre.vuelto_recibido)} de vuelto` : '')
        + (g.cierre.diferencia_pagada ? ` · pagó ${dinero(g.cierre.diferencia_pagada)} de diferencia` : '')));
    }
    const hist = (g.historial || []).map(h =>
      `<li><b>${esc(h.accion || '')}</b> · ${esc(h.por_nombre || '')} <span>${fHora(h.at)}</span>${h.nota ? `<em>${esc(h.nota)}</em>` : ''}</li>`).join('');
    return `<div class="cm-det" data-cm-det="${esc(g.id)}">
      <div class="cm-det-top">
        <span class="cm-det-monto">${dinero(g.monto)}</span>
        <span>${chip(g)}<small>${esc(tipoLabel(g))}${g.numero ? ` · ${esc(g.numero)}` : ''}</small></span>
      </div>
      ${cajas.join('')}
      <dl class="cm-datos">
        ${dato('Para qué', esc(g.concepto))}
        ${dato('Categoría', esc(g.categoria))}
        ${dato('Proveedor', esc(g.proveedor))}
        ${dato(viatico ? 'Fecha' : 'Factura', [fIso(g.fecha_gasto), g.factura_numero ? `N.º ${esc(g.factura_numero)}` : ''].filter(Boolean).join(' · '))}
        ${dato('Pidió', `${esc(g.solicitante_nombre || g.solicitante_email || '')}, ${fHora(g.created_at)}`)}
        ${dato('Aprueba', g.aprobacion ? `${esc(g.aprobacion.por_nombre || '')} lo aprobó, ${fHora(g.aprobacion.at)}` : esc(g.aprobador_nombre || 'Administración'))}
        ${plata.join('')}
      </dl>
      <div class="cm-recibos" data-cm-recibos>${(g.recibos || []).length ? '' : `<p class="cm-sin-recibo">${viatico ? 'Viático: no lleva factura.' : 'Sin factura todavía.'}</p>`}</div>
      <details class="cm-hist"><summary>Historial</summary><ul>${hist}</ul></details>
    </div>`;
  }

  // Carga las facturas en el contenedor [data-cm-recibos] (miniaturas que
  // abren la imagen completa; el PDF, un enlace).
  function cargarRecibos(root, g) {
    const cont = $(root, '[data-cm-recibos]');
    if (!cont) return;
    (g.recibos || []).forEach((r, i) => {
      const a = document.createElement('a');
      a.className = 'cm-recibo'; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Cargando…';
      cont.appendChild(a);
      S().urlRecibo(r.path).then((url) => {
        a.href = url;
        if (r.tipo === 'application/pdf') { a.classList.add('is-pdf'); a.textContent = r.nombre || `Factura ${i + 1} (PDF)`; }
        else { a.textContent = ''; const img = new Image(); img.alt = `Factura ${i + 1}`; img.loading = 'lazy'; img.src = url; a.appendChild(img); }
      }).catch(() => { a.textContent = 'No se pudo cargar la factura'; a.classList.add('is-error'); });
    });
  }

  const BOTONES = {
    aprobar: { label: 'Aprobar', primary: true, icon: 'check' },
    rechazar: { label: 'Rechazar', danger: true },
    editar: { label: 'Corregir' },
    anular: { label: 'Anular' },
    pagar: { label: 'Registrar el pago', primary: true, icon: 'banknote' },
    entregar: { label: 'Entregar el efectivo', primary: true, icon: 'banknote' },
    rendir: { label: 'Rendir: traje la factura', primary: true, icon: 'receipt' },
    cerrar: { label: 'Cerrar', primary: true, icon: 'check' },
    devolver_rendicion: { label: 'Devolver', title: 'Falta algo en la rendición' },
  };

  async function abrir(g) {
    const acciones = C().acciones(g, yo);
    // El botón principal al final: en el teléfono queda bajo el pulgar.
    const orden = [...acciones].sort((a, b) => (BOTONES[a].primary ? 1 : 0) - (BOTONES[b].primary ? 1 : 0));
    const res = await Modal.sheet({
      title: g.solicitante_uid === yo.uid ? 'Mi gasto' : `Gasto de ${g.solicitante_nombre || ''}`,
      icon: 'banknote', size: 'md', html: detalleHtml(g),
      buttons: orden.map(a => ({ action: a, ...BOTONES[a] })),
      onMount(root) { cargarRecibos(root, g); },
      async onAction(action, root) {
        const bloquear = (v) => root.querySelectorAll('[data-sheet-action]').forEach(b => { b.disabled = v; });
        try {
          bloquear(true);
          const hecho = await ejecutar(action, g);
          if (!hecho) { bloquear(false); return false; }
          return hecho;
        } catch (e) { fallo(e); bloquear(false); return false; }
      },
    });
    if (res && res !== 'editar-abierto') onCambio();
  }

  // Devuelve un texto (lo hecho) o false si la persona canceló.
  async function ejecutar(action, g) {
    switch (action) {
      case 'aprobar':
        await S().aprobar(g.id);
        Toast.show(`Aprobado: ${dinero(g.monto)} de ${g.solicitante_nombre || ''}.`, 'ok');
        return 'aprobado';
      case 'rechazar': {
        const m = await Modal.prompt({ title: 'Rechazar el gasto', message: `Dile a ${esc(g.solicitante_nombre || 'la persona')} por qué. Le llega por correo.`,
          placeholder: 'Motivo', confirmLabel: 'Rechazar', multiline: true });
        if (m == null) return false;
        if (String(m).trim().length < 3) { Toast.show('Escribe el motivo.', 'warn'); return false; }
        await S().rechazar(g.id, m);
        Toast.show('Rechazado.', 'ok');
        return 'rechazado';
      }
      case 'anular': {
        const ok = await Modal.confirm({ title: 'Anular el gasto', message: `¿Anular ${dinero(g.monto)} — ${esc(g.concepto || '')}? No se puede deshacer.`, danger: true, confirmLabel: 'Anular' });
        if (!ok) return false;
        await S().anular(g.id);
        Toast.show('Anulado.', 'ok');
        return 'anulado';
      }
      case 'editar':
        setTimeout(() => nuevo(g), 0); // se abre al cerrarse esta hoja
        return 'editar-abierto';
      case 'pagar':
      case 'entregar': return (await hojaEntregar(g)) ? 'entregado' : false;
      case 'rendir': return (await hojaRendir(g)) ? 'rendido' : false;
      case 'cerrar': return (await hojaCerrar(g)) ? 'cerrado' : false;
      case 'devolver_rendicion': {
        const m = await Modal.prompt({ title: 'Devolver la rendición', message: `¿Qué le falta a ${esc(g.solicitante_nombre || 'la persona')}? Le llega por correo.`,
          placeholder: 'Ej.: falta la factura del peaje', confirmLabel: 'Devolver', multiline: true });
        if (m == null) return false;
        if (String(m).trim().length < 3) { Toast.show('Escribe qué falta.', 'warn'); return false; }
        await S().devolverRendicion(g.id, m);
        Toast.show('Devuelta para que la corrija.', 'ok');
        return 'devuelta';
      }
      default: return false;
    }
  }

  // Contabilidad paga el reembolso o entrega el efectivo del anticipo.
  async function hojaEntregar(g) {
    const ach = g.via === 'ach';
    const anticipo = g.tipo === 'anticipo';
    const quien = esc(g.solicitante_nombre || 'la persona');
    const html = `<div class="cm-form">
      <p class="cm-aviso cm-aviso--info">${ach
        ? `Reembolso por <b>ACH</b> a ${quien}: no sale del fondo. Regístralo cuando la solicitud de pago tenga sus firmas y la transferencia esté hecha.`
        : (anticipo ? `Le entregas el efectivo a ${quien}. Tiene ${cfg.dias_rendir} días para traer la factura y el vuelto.`
          : (esViatico(g) ? `Le pagas el viático en efectivo a ${quien}. No lleva factura.`
            : `Le pagas en efectivo a ${quien}, contra la factura.`))}</p>
      <label class="cm-campo cm-campo--monto"><span>${ach ? 'Monto transferido' : 'Efectivo entregado'}</span>
        <span class="cm-monto-in"><i>$</i><input type="text" inputmode="decimal" id="cmEntMonto" class="form-input" value="${Number(g.monto).toFixed(2)}" autocomplete="off"></span></label>
      ${ach ? `<label class="cm-campo"><span>Referencia del ACH</span><input type="text" id="cmEntRef" class="form-input" maxlength="60" placeholder="N.º de transacción del banco"></label>` : ''}
    </div>`;
    const res = await Modal.sheet({
      title: ach ? 'Registrar el pago por ACH' : (anticipo ? 'Entregar el efectivo' : 'Pagar el reembolso'), icon: 'banknote', size: 'sm', html,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: ach ? 'Registrar' : 'Entregado', primary: true }],
      async onAction(action, root) {
        if (action !== 'ok') return action;
        try {
          await S().entregar(g, { monto: $(root, '#cmEntMonto').value, referencia: ach ? $(root, '#cmEntRef').value : '' });
          return 'hecho';
        } catch (e) { e?.code ? fallo(e) : Toast.show(e.message, 'warn'); return false; }
      },
    });
    if (res !== 'hecho') return false;
    Toast.show(ach ? 'Pago registrado.' : 'Entrega registrada.', 'ok');
    return true;
  }

  // Quien recibió el anticipo rinde: cuánto gastó + la factura.
  async function hojaRendir(g) {
    const entregado = Number(g.entrega?.monto) || 0;
    const nuevos = [];
    const cupo = Math.max(0, C().MAX_RECIBOS - (g.recibos || []).length);
    const html = `<div class="cm-form">
      <p class="cm-aviso cm-aviso--info">Te entregaron <b>${dinero(entregado)}</b>. Di cuánto gastaste y sube la factura fiscal.</p>
      <label class="cm-campo cm-campo--monto"><span>Gastaste</span>
        <span class="cm-monto-in"><i>$</i><input type="text" inputmode="decimal" id="cmRinMonto" class="form-input" placeholder="0.00" autocomplete="off"></span></label>
      <p class="cm-aviso" id="cmRinVuelto" hidden></p>
      <div class="cm-campo"><span>Factura fiscal</span>${selectorFotos(nuevos, cupo)}</div>
      <label class="cm-campo"><span>Nota <em>(opcional)</em></span><input type="text" id="cmRinNota" class="form-input" maxlength="300"></label>
    </div>`;
    let fotos = { ocupado: () => false };
    const res = await Modal.sheet({
      title: 'Rendir el anticipo', icon: 'receipt', size: 'md', html,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Enviar a contabilidad', primary: true, icon: 'send' }],
      onMount(root) {
        fotos = cablearFotos(root, nuevos, cupo);
        $(root, '#cmRinMonto').addEventListener('input', () => {
          const r = C().rendicion(entregado, $(root, '#cmRinMonto').value);
          const el = $(root, '#cmRinVuelto');
          if (!r) { el.hidden = true; return; }
          el.hidden = false;
          el.innerHTML = r.vuelto > 0 ? `Devuelves <b>${dinero(r.vuelto)}</b> de vuelto a contabilidad.`
            : (r.vuelto < 0 ? `Gastaste <b>${dinero(-r.vuelto)}</b> de más: contabilidad te paga la diferencia.` : 'Sin vuelto.');
        });
      },
      async onAction(action, root) {
        if (action !== 'ok') return action;
        if (fotos.ocupado()) { Toast.show('Espera a que termine de subir la foto.', 'warn'); return false; }
        try {
          await S().rendir(g, { monto_gastado: $(root, '#cmRinMonto').value, recibos: nuevos, nota: $(root, '#cmRinNota').value });
          return 'hecho';
        } catch (e) { e?.code ? fallo(e) : Toast.show(e.message, 'warn'); return false; }
      },
    });
    if (res !== 'hecho') return false;
    Toast.show('Rendido. Lleva el vuelto y la factura original a contabilidad.', 'ok');
    return true;
  }

  // Contabilidad revisa la rendición y cierra: recibe el vuelto, o paga la
  // diferencia si la persona gastó de más.
  async function hojaCerrar(g) {
    const vuelto = Number(g.rendicion?.vuelto) || 0;
    const quien = esc(g.solicitante_nombre || 'la persona');
    const html = `<div class="cm-form">
      <p class="cm-aviso cm-aviso--info">Entregado <b>${dinero(g.entrega?.monto)}</b> · gastado <b>${dinero(g.rendicion?.monto_gastado)}</b>.
        ${vuelto > 0 ? `${quien} devuelve <b>${dinero(vuelto)}</b>.` : (vuelto < 0 ? `A ${quien} se le deben <b>${dinero(-vuelto)}</b>.` : 'Sin vuelto.')}</p>
      ${vuelto !== 0 ? `<label class="cm-campo cm-campo--monto"><span>${vuelto > 0 ? 'Vuelto que recibiste' : 'Diferencia que le pagaste'}</span>
        <span class="cm-monto-in"><i>$</i><input type="text" inputmode="decimal" id="cmCieMonto" class="form-input" value="${Math.abs(vuelto).toFixed(2)}" autocomplete="off"></span></label>` : ''}
      <p class="form-hint">Al cerrar confirmas que tienes la factura fiscal original.</p>
    </div>`;
    const res = await Modal.sheet({
      title: 'Cerrar la rendición', icon: 'check', size: 'sm', html,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Cerrar', primary: true }],
      async onAction(action, root) {
        if (action !== 'ok') return action;
        const v = vuelto !== 0 ? C().num($(root, '#cmCieMonto').value) : 0;
        if (!(v >= 0)) { Toast.show('Escribe el monto.', 'warn'); return false; }
        try {
          await S().cerrar(g, vuelto >= 0 ? { vuelto_recibido: v } : { vuelto_recibido: 0, diferencia_pagada: v });
          return 'hecho';
        } catch (e) { e?.code ? fallo(e) : Toast.show(e.message, 'warn'); return false; }
      },
    });
    if (res !== 'hecho') return false;
    Toast.show('Rendición cerrada.', 'ok');
    return true;
  }

  return { init, tarjeta, abrir, nuevo, detalleHtml, cargarRecibos, ejecutar, BOTONES, fCorta, fHora, fIso, chip, tipoLabel };
})();

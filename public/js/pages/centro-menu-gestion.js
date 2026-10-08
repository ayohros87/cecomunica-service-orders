// @ts-nocheck
// Centro de gestión de clientes — Menú "Nueva gestión".
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Menú "Nueva gestión" ═════════ */

  // Panel lateral "Más acciones" (ficha v3, 2026-10-08). Antes era un
  // desplegable de 12 renglones bajo "Nueva gestión" más un "⋯" aparte con
  // Cotizar · Datos · Documentos · Historial. Ahora es UNA hoja lateral con
  // todo, por intención, con buscador, y lo que no aplica sale en gris CON el
  // motivo (antes se escondía: "no estoy viendo el menú…", 2026-09-09).
  // Conserva el id #cgMenu: los wizards lo cierran con classList.add('hidden').
  toggleMenu(e) {
    e?.stopPropagation?.();
    const el = document.getElementById('cgMenu');
    if (!el) return;
    if (el.classList.contains('hidden')) this.abrirMenu(); else this.cerrarMenu();
  },
  abrirMenu() {
    const el = document.getElementById('cgMenu');
    if (!el) return;
    if (!el.innerHTML) this.armarMenu();
    el.classList.remove('hidden');
    document.getElementById('cgMenuVelo')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (window.lucide?.createIcons) lucide.createIcons();
    const q = el.querySelector('[data-accq]');
    if (q) { q.value = ''; this._menuFiltrar(''); setTimeout(() => q.focus(), 60); }
    if (!this._menuEsc) {
      this._menuEsc = (ev) => { if (ev.key === 'Escape') this.cerrarMenu(); };
      document.addEventListener('keydown', this._menuEsc);
    }
  },
  cerrarMenu() {
    document.getElementById('cgMenu')?.classList.add('hidden');
    document.getElementById('cgMenuVelo')?.classList.add('hidden');
    document.body.style.overflow = '';
    if (this._menuEsc) { document.removeEventListener('keydown', this._menuEsc); this._menuEsc = null; }
  },
  abrirMenuDesdeDock() { this.abrirMenu(); },
  _menuNorm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  },
  _menuFiltrar(term) {
    const el = document.getElementById('cgMenu');
    if (!el) return;
    const palabras = this._menuNorm(term).split(' ').filter(Boolean);
    const grupos = el.querySelectorAll('[data-accgrp]');
    let visibles = 0;
    grupos.forEach(g => {
      let n = 0;
      g.querySelectorAll('.cg-acc').forEach(a => {
        const ok = !palabras.length || palabras.every(p => (a.dataset.busca || '').includes(p));
        a.classList.toggle('is-oculto', !ok);
        if (ok) n++;
      });
      g.classList.toggle('hidden', n === 0);
      visibles += n;
    });
    const vacio = el.querySelector('[data-accvacio]');
    if (vacio) vacio.classList.toggle('hidden', visibles > 0);
  },

  armarMenu() {
    const el = document.getElementById('cgMenu');
    if (!el || !this.cliente) return;
    const esc = (v) => this.esc(v);
    const puedeG = this.puedeCrearGestion();
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const hayRadios = this.equipos.some(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    const hayContrato = est.renovables.length > 0;
    const n = est.renovables.length;
    const cid = encodeURIComponent(this.cliente.id);
    const SIN_ROL = 'Tu rol no inicia gestiones: las abre ventas, recepción o administración.';
    const SIN_CONTRATO = 'La cuenta no tiene contrato vigente en el sistema: empieza por Nuevo contrato.';
    const EN_TRAMITE = `Hay una renovación en trámite (${tram?.contrato_id || ''}): lo que cambie entra por ahí.`;
    const SIN_RADIOS = 'El cliente no tiene radios en campo.';

    // Un ítem: {icono, label, hint, onclick|href, ok, motivo, cls}. Lo que no
    // aplica sale en gris con el motivo en el renglón de abajo.
    const item = (d) => {
      const busca = this._menuNorm(`${d.label} ${d.hint || ''} ${d.busca || ''}`);
      const box = `<span class="box"><i data-lucide="${d.icono}"></i></span>`;
      if (d.ok === false) {
        return `<div class="cg-acc off${d.cls ? ` ${d.cls}` : ''}" aria-disabled="true" data-busca="${esc(busca)}">${box}
          <span><span class="t">${esc(d.label)}</span><span class="h">${esc(d.motivo || 'No aplica a esta cuenta.')}</span></span><span class="chev"></span></div>`;
      }
      const cuerpo = `${box}<span><span class="t">${esc(d.label)}</span>${d.hint ? `<span class="h">${esc(d.hint)}</span>` : ''}</span><span class="chev">›</span>`;
      if (d.href) return `<a class="cg-acc${d.cls ? ` ${d.cls}` : ''}" href="${d.href}" data-busca="${esc(busca)}">${cuerpo}</a>`;
      return `<button type="button" class="cg-acc${d.cls ? ` ${d.cls}` : ''}" data-busca="${esc(busca)}" onclick="Centro.cerrarMenu(); ${d.onclick}">${cuerpo}</button>`;
    };
    const grupo = (hd, items) => { const xs = items.filter(Boolean); return xs.length ? `<div data-accgrp><div class="grp"><h3>${hd}</h3></div>${xs.join('')}</div>` : ''; };
    const okG = (cond, motivo) => puedeG ? ({ ok: !!cond, motivo }) : ({ ok: false, motivo: SIN_ROL });

    // Arriba, destacado: lo que la cuenta pide primero (misma regla que la
    // marca "Sugerido" de la barra y el dock móvil: _accionPrimaria).
    const P = this._accionPrimaria();
    const top = P ? grupo('Lo que la cuenta pide primero', [item({ icono: 'flag', label: P.label, hint: P.hint, onclick: P.onclick, cls: 'top' })]) : '';

    const d1Menu = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion);
    const ajusteOn = est.tipo === 'consolidada' ? `Centro.wizAjuste('${esc(est.maestro.id)}')` : 'Centro.wizAjuste()';

    const dar = grupo('Dar equipos', [
      item({ icono: 'plus', label: 'Agregar equipos', hint: 'radios nuevos por anexo al contrato de la cuenta · administración aprueba, bodega asigna, el cliente firma',
        onclick: 'Centro.wizAgregarEquipos()', ...okG(hayContrato && !tram, tram ? EN_TRAMITE : SIN_CONTRATO) }),
      // La consola es un CARGO, no un radio (2026-10-02, COMPAÑÍA GOLY).
      item({ icono: 'monitor', label: 'Agregar consola o servicio', hint: 'consola, GPS y otros cargos · anexo con firma, sin bodega',
        onclick: ajusteOn, ...okG(hayContrato, SIN_CONTRATO) }),
      // TEMP (evento) y DEMO son independientes de la cuenta (caso Arraiján / Elvia, 2026-09-07).
      item({ icono: 'calendar', label: 'Contrato temporal', hint: 'por evento, días o meses · no toca la cuenta ni la renueva',
        onclick: 'Centro.wizContrato({temporal:true})', ...okG(true) }),
      item({ icono: 'radio', label: 'Demo', hint: 'prueba sin cargo · termina con la devolución', onclick: 'Centro.wizDemo()', ...okG(true) }),
    ]);
    const cambiar = grupo('Cambiar', [
      item({ icono: 'repeat', label: 'Reemplazar un equipo', hint: 'marca el radio en la pestaña Equipos o búscalo aquí · el taller propone, administración aprueba',
        onclick: 'Centro.wizReemplazo()', ...okG(hayRadios, SIN_RADIOS) }),
      // Corregir ≠ reemplazar: aquí no se mueve equipo.
      item({ icono: 'arrow-left-right', label: 'Corregir un serial mal registrado', hint: 'el cliente tiene otro radio del que dice el sistema · no mueve equipo',
        onclick: 'Centro.wizCambioSerial()', ...okG(hayRadios, SIN_RADIOS) }),
      item({ icono: 'sliders-horizontal', label: 'Ajustar tarifa', hint: 'cambia el precio de las líneas o agrega cargos · anexo con firma',
        onclick: ajusteOn, ...okG(hayContrato, SIN_CONTRATO) }),
    ]);
    // "Poner la cuenta al día" (Alberto 2026-09-09): gestión de CUENTA, se
    // ofrece siempre que haya contrato vigente; el hint dice cuál caso es.
    const actualizar = grupo('Actualizar', [
      item({ icono: 'clipboard-check', label: 'Actualizar seriales del cliente',
        hint: d1Menu.length
          ? `amarra al contrato los ${d1Menu.length} radio(s) que ya tiene · sin firma, sin bodega y sin entrega`
          : 'declara los que el sistema no conoce o saca los que el cliente ya no tiene · sin firma',
        onclick: 'Centro.wizRegularizarCuenta()', ...okG(hayContrato && !tram, tram ? EN_TRAMITE : SIN_CONTRATO) }),
    ]);
    const retirar = grupo('Retirar', [
      item({ icono: 'undo-2', label: 'Baja parcial por serial', hint: 'marca los radios en Equipos o búscalos aquí · carta del cliente · termina con la orden de devolución',
        onclick: 'Centro.wizBaja()', ...okG(hayRadios, SIN_RADIOS) }),
      item({ icono: 'x-circle', label: 'Terminar la cuenta', hint: n > 1 ? `cancela los ${n} contratos con una sola carta · administración aprueba` : 'cancela el contrato con la carta del cliente · administración aprueba',
        onclick: 'Centro.wizTerminacionCuenta()', cls: 'danger', ...okG(hayContrato, SIN_CONTRATO) }),
    ]);
    // Contratos: el nuevo cuando no hay ninguno; con cuenta vigente, "aparte"
    // como respaldo (decisión 6 de Alberto, 1-oct-2026: pide la razón).
    const sinNinguno = est.tipo === 'nueva' || est.tipo === 'sin_contrato';
    const contratos = grupo('Contratos', [
      sinNinguno
        ? item({ icono: 'file-plus', label: 'Nuevo contrato', hint: est.tipo === 'sin_contrato' ? `cubre los ${est.custodia} radio(s) que el cliente ya tiene` : 'el primer contrato de la cuenta',
          onclick: est.tipo === 'sin_contrato' ? 'Centro.wizContrato({renovarCuenta:true})' : 'Centro.wizContrato()', ...okG(true) })
        : item({ icono: 'file-plus', label: 'Otro contrato aparte', hint: 'respaldo: otra sede u otro servicio · pide la razón de no usar anexo o renovación',
          onclick: 'Centro.wizContrato({nuevoConVigente:true})', ...okG(!tram, EN_TRAMITE) }),
      // Adenda a contrato EN PAPEL (2026-09-07, caso Falcon): solo cuando el marco no está en el sistema.
      item({ icono: 'file-text', label: 'Anexo de aumento a un contrato en papel', hint: 'el contrato marco no está en el sistema y hace falta un equipo más',
        onclick: 'Centro.wizAumento(null,{papel:true})', ...okG(sinNinguno, 'La cuenta ya tiene contrato en el sistema: usa Agregar equipos.') }),
    ]);
    const hayCampo = this.equipos.some(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    const cliente = grupo('Cliente y documentos', [
      item({ icono: 'receipt', label: 'Nueva cotización', hint: 'abre el editor con este cliente ya elegido',
        href: `../cotizaciones/nueva-cotizacion.html?cliente_id=${cid}&from=centro`, ok: this._puedeCotizar(), motivo: 'Las cotizaciones las abre ventas o administración.' }),
      item({ icono: this._puedeEditarCliente() ? 'pencil' : 'eye', label: this._puedeEditarCliente() ? 'Editar datos del cliente' : 'Ver datos del cliente',
        hint: this._puedeEditarCliente() ? 'RUC, representante, contacto, vendedor' : 'solo lectura: los cambios los hace cobros', href: `./ficha.html?id=${cid}&from=centro` }),
      item({ icono: 'folder-open', label: 'Documentos del cliente', hint: 'registro público, cédula, poderes · cada apertura queda en la auditoría',
        onclick: "Centro.mostrarTab('blkDocumentos')", ok: this._puedeVerDocs(), motivo: 'El expediente legal lo ven administración, recepción y gerencia.' }),
      item({ icono: 'file-check', label: 'Constancia de equipos', hint: 'lo que el cliente tiene hoy, con qué contrato y con qué orden se entregó · para imprimir',
        onclick: 'Centro.constanciaEquipos()', ok: hayCampo, motivo: 'La cuenta no tiene equipos en campo.' }),
      item({ icono: 'history', label: 'Historial de la ficha', hint: 'quién cambió qué y cuándo', onclick: "Centro.mostrarTab('blkActividad')" }),
      // Trasladar cambia a quién se factura: administración o gerencia (2026-10-07, P3).
      item({ icono: 'users', label: 'Cambio de razón social / traslado de cuenta', hint: 'todo lo vivo pasa a otra ficha; esta queda inactiva',
        onclick: 'Centro.trasladarCuenta()', ok: this._puedeTrasladar(), motivo: 'Cambia a quién se factura: lo hace administración o gerencia.' }),
      this._puedeMasiva() ? item({ icono: 'list-checks', label: 'Edición masiva de clientes', hint: 'el grid de limpieza por tandas (admin y recepción)', href: './index.html' }) : '',
    ]);

    el.innerHTML = `
      <div class="ph">
        <div style="flex:1; min-width:0;">
          <h2>Todas las acciones</h2>
          <div class="sub">para ${esc(this.cliente.nombre || '')} · lo que no aplica sale en gris con el motivo</div>
          <input class="form-input" type="search" data-accq autocomplete="off" aria-label="Buscar una acción"
            placeholder="Escribe lo que quieres hacer: reemplazar, baja, consola…" oninput="Centro._menuFiltrar(this.value)">
        </div>
        <button type="button" class="btn" style="width:44px; padding:0; justify-content:center; flex:none;" aria-label="Cerrar el panel" onclick="Centro.cerrarMenu()"><i data-lucide="x"></i></button>
      </div>
      ${top}${dar}${cambiar}${actualizar}${retirar}${contratos}${cliente}
      <div class="cg-vacio hidden" data-accvacio>Ninguna acción coincide con lo que escribiste.</div>
      <div class="pie">Las gestiones abiertas y las que ya cerraron están en la pestaña <a href="#" onclick="event.preventDefault(); Centro.cerrarMenu(); Centro.mostrarTab('blkGestiones')">Gestiones</a>.</div>`;
    if (!el.classList.contains('hidden') && window.lucide?.createIcons) lucide.createIcons();
  },

  // Trasladar la cuenta o un contrato a otra ficha cambia a quién se factura:
  // administración o gerencia (2026-10-07, P3).
  _puedeTrasladar() { return [ROLES.ADMIN, 'admin', ROLES.GERENTE].includes(this.rol); },

  // Documentos legales del cliente (PII). Hasta 2026-09-10 solo se veían desde
  // el form de cliente del módulo de contratos; el Centro es la ficha 360, así
  // que el expediente digital se abre AQUÍ. Espejo exacto de ALLOWED_ROLES de
  // la callable getClienteDocUrl (functions/src/callable/getClienteDocUrl.js):
  // admin + recepción. A los demás ni se les ofrece — la lista de metadata sí
  // la dejan leer las rules, pero los bytes los negaría la callable.
  // Espejo de ALLOWED_ROLES de getClienteDocUrl. Gerencia entra el 2026-09-24:
  // valida firmantes y necesita el registro público / poder del expediente.
  _puedeVerDocs() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE].includes(this.rol); },

  // ── Constancia de equipos (auditoría 2026-09-17) ─────────────────────
  // "¿Qué equipos tengo con ustedes y desde cuándo?" se contestaba a mano
  // desde tres pantallas, así que salía distinta según quién la armara. Esto
  // la arma sola con lo que YA está escrito: nada se calcula de nuevo.
  //
  // Para cada radio dice desde cuándo está con el cliente y CON QUÉ ORDEN se
  // entregó — el dato sale del kardex (el movimiento que lo dejó en_cliente),
  // que es la prueba de la entrega. Una lectura de subcolección por equipo:
  // se paga solo cuando alguien pide el documento, y por eso hay tope.
  TOPE_CONSTANCIA: 200,

  async constanciaEquipos() {
    if (!this.cliente) return;
    this._cerrarAcciones();
    const enCampo = (this.equipos || [])
      .filter(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    if (!enCampo.length) { Toast.show('Esta cuenta no tiene equipos en campo.', 'warn'); return; }

    Toast.show('Armando la constancia…', 'info');
    const conDetalle = enCampo.length <= this.TOPE_CONSTANCIA;
    const detalle = new Map();
    if (conDetalle) {
      // El movimiento MÁS RECIENTE que dejó la unidad con el cliente: si el
      // radio fue y volvió del taller, la fecha que vale es la última salida.
      await Promise.all(enCampo.map(async (e) => {
        try {
          const movs = await EquiposPoolService.getMovimientos(e.id);   // desc
          const m = (movs || []).find(x => x.a_estado === 'en_cliente');
          if (m) detalle.set(e.id, { at: m.at, orden: m.ref?.tipo === 'orden' ? m.ref.id : null });
        } catch (err) { /* sin kardex legible: la fila sale sin fecha */ }
      }));
    }

    const fmtF = (ts) => {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      return d && !isNaN(d) ? d.toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    };
    const esc = (v) => this.esc(v);
    // Agrupado por contrato, que es como el cliente entiende su cuenta.
    const grupos = new Map();
    for (const e of enCampo) {
      const k = e.asignacion?.contrato_doc_id || '__sin__';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(e);
    }
    const bloques = [...grupos.entries()].map(([k, items]) => {
      const c = this.contratos.find(x => x.id === k);
      const titulo = c
        ? `Contrato ${esc(c.contrato_id || '—')} · ${this._compChipHtml(c)}`
        : 'Equipos sin contrato registrado';
      const filas = items
        .sort((a, b) => String(a.serial || '').localeCompare(String(b.serial || '')))
        .map((e) => {
          const d = detalle.get(e.id);
          return `<tr>
            <td class="mono">${esc(e.serial || e.id)}</td>
            <td>${esc(e.modelo_label || '—')}</td>
            <td>${e.propiedad === 'cliente' ? 'Del cliente' : 'En alquiler'}</td>
            <td>${conDetalle ? esc(fmtF(d?.at)) : '—'}</td>
            <td class="mono">${d?.orden ? esc(d.orden) : '—'}</td>
          </tr>`;
        }).join('');
      return `<h2>${titulo} <span class="cuenta">${items.length} equipo(s)</span></h2>
        <table>
          <thead><tr><th>Serial</th><th>Modelo</th><th>Régimen</th><th>Con el cliente desde</th><th>Orden de entrega</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>`;
    }).join('');

    const hoy = new Date().toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' });
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Constancia de equipos — ${esc(this.cliente.nombre || '')}</title>
      <style>
        * { box-sizing: border-box; margin: 0; }
        body { background: #e8e6e0; font: 14px/1.55 'Source Serif 4', Georgia, 'Times New Roman', serif; color: #26221C; }
        .toolbar { display: flex; gap: 10px; justify-content: flex-end; max-width: 820px; margin: 0 auto; padding: 12px 16px 0; font-family: 'Segoe UI', Arial, sans-serif; }
        .toolbar button { font: 600 13.5px 'Segoe UI', Arial, sans-serif; border: 0; border-radius: 8px; cursor: pointer; padding: 9px 16px; background: #0B2A47; color: #fff; }
        .hoja { background: #FDFCF8; max-width: 820px; margin: 12px auto 40px; padding: 44px 52px; box-shadow: 0 8px 30px rgba(20,20,30,.18); }
        .memb { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; border-bottom: 2px solid #26221C; padding-bottom: 14px; flex-wrap: wrap; }
        .memb img { height: 42px; }
        .memb .datos-emp { font: 10.5px/1.5 'Segoe UI', Arial, sans-serif; color: #5C554A; margin-top: 4px; }
        .docnum { text-align: right; font-size: 12.5px; color: #5C554A; }
        h1 { font-size: 18px; text-align: center; margin: 26px 0 4px; letter-spacing: .02em; }
        .subt { text-align: center; font-size: 12.5px; color: #5C554A; margin-bottom: 22px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 28px; font-size: 13px; margin-bottom: 22px; }
        .grid .lbl { display: block; font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #5C554A; }
        h2 { font-size: 13.5px; margin: 22px 0 8px; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1px solid #E4DFD2; padding-bottom: 4px; }
        h2 .cuenta { font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #5C554A; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .07em; text-transform: uppercase; color: #5C554A; text-align: left; padding: 6px 10px; border-bottom: 1.5px solid #26221C; }
        td { padding: 7px 10px; border-bottom: 1px solid #E4DFD2; vertical-align: top; }
        td.mono { font-family: Consolas, monospace; font-size: 12px; white-space: nowrap; }
        .legal { font-size: 11.5px; color: #5C554A; border-left: 2px solid #E4DFD2; padding-left: 14px; margin: 24px 0 0; font-style: italic; }
        .pie { margin-top: 30px; padding-top: 10px; border-top: 1px solid #E4DFD2; font: 10.5px 'Segoe UI', Arial, sans-serif; color: #5C554A; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
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
            <div class="docnum">Emitida el <b>${esc(hoy)}</b></div>
          </div>
          <h1>Constancia de equipos en poder del cliente</h1>
          <p class="subt">Estado de la cuenta a la fecha de emisión</p>
          <div class="grid">
            <div><span class="lbl">Cliente</span><b>${esc(this.cliente.nombre || '—')}</b></div>
            <div><span class="lbl">RUC</span><b>${esc(this.cliente.ruc || '—')}</b></div>
            <div><span class="lbl">Equipos en campo</span><b>${enCampo.length}</b></div>
            <div><span class="lbl">Contratos involucrados</span><b>${[...grupos.keys()].filter(k => k !== '__sin__').length}</b></div>
          </div>
          ${bloques}
          <p class="legal">Esta constancia lista los equipos que, según los registros de C COMUNICA, S.A.,
            se encuentran en poder del cliente a la fecha de emisión, con la orden de servicio que respalda
            cada entrega.${conDetalle ? '' : ' Por el volumen de la cuenta se omite el detalle de entrega por equipo; se puede emitir por contrato.'}
            Cualquier diferencia debe notificarse para su conciliación.</p>
          <div class="pie">
            <span>Generado por el sistema de órdenes de servicio</span>
            <span>${enCampo.length} equipo(s) · ${esc(hoy)}</span>
          </div>
        </div>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { Toast.show('El navegador bloqueó la ventana. Permite las ventanas emergentes.', 'bad'); return; }
    w.document.write(html);
    w.document.close();
  },

  async verDocumentos() {
    if (!this.cliente || !this._puedeVerDocs()) return;
    this._cerrarAcciones();
    const id = this.cliente.id;
    // Subir y borrar viven en la sección Documentos de la ficha (un solo
    // formulario de cliente, auditoría UX 2026-09-28 T9): aquí solo se consulta.
    const urlSubir = `./ficha.html?id=${encodeURIComponent(id)}&from=centro&seccion=documentos`;
    this._abrirModalA({
      titulo: 'Documentos del cliente',
      banda: false,
      cuerpo: `<p style="margin:0 0 12px; font-size:13px; color:var(--fg-3);">
          Expediente legal de <b>${this.esc(this.cliente.nombre || '')}</b>. Cada archivo se abre con un
          enlace que vence a los 5 minutos y queda registrado en la auditoría de PII.</p>
        <div id="cgDocsList"><p style="color:var(--fg-3); font-size:13px;">Cargando documentos…</p></div>`,
      footer: `<a href="${urlSubir}" style="font-size:12.5px;">Cargar un documento ›</a>
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>`,
    });
    try {
      const docs = await ClienteDocumentosService.list(id);
      const cont = document.getElementById('cgDocsList');
      if (!cont) return;
      if (!docs.length) {
        cont.innerHTML = `<p style="color:var(--fg-3); font-size:13px;">No hay documentos cargados para este cliente.</p>`;
        return;
      }
      cont.innerHTML = docs.map(d => this._docFilaHtml(d)).join('');
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (err) {
      const cont = document.getElementById('cgDocsList');
      if (cont) cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">No se pudieron cargar los documentos: ${this.esc(err?.message || err)}</p>`;
    }
  },
  // OJO con el ícono: el vendor de lucide es A MEDIDA (198 nombres) y `image`
  // NO está — verificado en el emulador, el <i> se quedaba sin convertir y la
  // fila salía sin ícono. `camera` sí está en el censo.
  _docFilaHtml(d) {
    const kb = Number(d.size) || 0;
    const tam = !kb ? '' : kb < 1024 * 1024 ? `${Math.round(kb / 1024)} KB` : `${(kb / 1024 / 1024).toFixed(1)} MB`;
    const f = d.subido_en ? this._fmtFechaHora(d.subido_en) : '';
    const meta = [this.esc(d.nombre_archivo || ''), tam, this.esc(f)].filter(Boolean).join(' · ');
    return `<div style="display:flex; gap:10px; align-items:center; padding:9px 2px; border-bottom:1px solid var(--border-subtle);">
      <i data-lucide="${(d.content_type || '').includes('pdf') ? 'file-text' : 'camera'}" style="width:18px; height:18px; color:var(--fg-3); flex:none;"></i>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:600;">${this.esc(ClienteDocumentosService.labelFor(d.tipo))}</div>
        <div style="font-size:12px; color:var(--fg-4); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${meta}</div>
      </div>
      <button type="button" class="btn btn-ghost cg-act" onclick="Centro.verDocumento('${this.esc(d.id)}', this)">Ver</button>
    </div>`;
  },
  // La pestaña se abre ANTES del await: si se abriera con la URL ya firmada, el
  // navegador la trataría como popup (el gesto del clic ya se perdió) y la
  // bloquearía. Se abre vacía con el clic y luego se le pone el destino. Sin
  // 'noopener' en las features (Chrome devuelve null y no habría a quién
  // ponerle el destino): el enlace se corta anulando `opener` a mano.
  async verDocumento(docId, btn) {
    const tab = window.open('about:blank', '_blank');
    if (tab) { try { tab.opener = null; } catch (_) {} }
    if (btn) btn.disabled = true;
    try {
      const url = await ClienteDocumentosService.getViewUrl(this.cliente.id, docId);
      if (tab) tab.location.href = url; else window.open(url, '_blank', 'noopener');
    } catch (err) {
      if (tab) tab.close();
      Toast.show(err?.message || 'No se pudo abrir el documento.', 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // El grid de edición masiva salió del home/rail (2026-09-03): se entra SOLO
  // por aquí y solo los roles que la página acepta (su propio guard: admin y
  // recepción — gerente nunca pasó ese guard, así que no se le ofrece).
  _puedeMasiva() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION].includes(this.rol); },

  // Espejo de FichaCliente._puedeEditar (clientes-ficha.js) y del candado de
  // identidad en rules: admin/gerente/recepción. Cobros entra con rol recepción
  // (cobros@cecomunica.com); al vendedor se le muestra la ficha en solo lectura
  // y se le dirige a cobros.
  _puedeEditarCliente() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE].includes(this.rol); },

  // CREAR sí lo puede el vendedor, aunque no edite fichas ajenas: el cliente
  // que da de alta nace en SU cartera. Espejo de FichaCliente._puedeCrear.
  _puedeCrearCliente() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE, ROLES.VENDEDOR].includes(this.rol); },

  // Espejo del guard del editor de cotizaciones (admin/vendedor/jefe_taller);
  // gerente y recepción ven este menú pero el editor los rebotaría al home,
  // así que a ellos no se les ofrece la entrada.
  _puedeCotizar() { return [ROLES.ADMIN, 'admin', ROLES.VENDEDOR].includes(this.rol); },

  // Estado de la cuenta para el menú. Los DEMO/TEMP no cuentan (terminan por
  // su propia devolución); lo que define la cuenta son los renovables
  // (ALQ/PROP/REEMP operativos) y la custodia sin contrato.
  _cuentaEstado() {
    // La renovación en trámite no es un renovable (auditoría UX 2026-09-28).
    const operativos = this.contratos.filter(c => this._esOperativo(c));
    const renovables = operativos.filter(c => this._aplicaVenc(c));
    const custodia = this._wcCustodia().length;
    if (!renovables.length && !custodia) return { tipo: 'nueva', renovables, custodia, maestro: null };
    // 2026-09-01 (C COMUNICA tras la terminación total): SIN contratos
    // vigentes pero CON equipos en campo — no hay nada que renovar; lo que
    // aplica es un CONTRATO NUEVO que cubra esa custodia (el wizard entra en
    // regularización legacy y la amarra al activarse).
    if (!renovables.length) return { tipo: 'sin_contrato', renovables, custodia, maestro: null };
    if (renovables.length === 1 && !custodia) return { tipo: 'consolidada', renovables, custodia, maestro: renovables[0] };
    return { tipo: 'fragmentada', renovables, custodia, maestro: null };
  },

  // Contrato ANCLA de una cuenta fragmentada: donde se cuelga el anexo de
  // aumento SIN preguntarle al vendedor (decisión 2026-08-28 — cada tramo
  // tiene vigencia propia, así que el papel que lo hospeda importa poco y la
  // consolidación futura absorbe las líneas de todos). Criterio: el ALQ/PROP
  // vigente de mayor facturación; a igualdad, el más reciente.
  _cuentaAncla() {
    const est = this._cuentaEstado();
    const comerciales = est.renovables.filter(c => ['SERV', 'ALQ', 'PROP'].includes(this._codigoTipo(c)));
    const candidatos = comerciales.length ? comerciales : est.renovables;
    if (!candidatos.length) return null;
    const m = (c) => Number(c.total_mensual ?? c.total_con_itbms ?? 0);
    return candidatos.slice().sort((a, b) => (m(b) - m(a))
      || String(b.contrato_id || '').localeCompare(String(a.contrato_id || '')))[0];
  },

  // "Agregar equipos": el camino LIVIANO para vender un radio más (2026-08-28
  // — pedirle al cliente re-firmar 200 radios para agregar uno es exagerado).
  // Consolidada → aumento directo al maestro; fragmentada → aumento al ancla
  // automática (la consolidación se OFRECE dentro del wizard, no se impone);
  // sin ningún contrato → no hay dónde colgar el anexo: renovar/regularizar.
  wizAgregarEquipos() {
    const est = this._cuentaEstado();
    if (est.tipo === 'consolidada') { this.wizAumento(est.maestro.id); return; }
    const ancla = this._cuentaAncla();
    if (ancla) this.wizAumento(ancla.id, { ancla: true });
    else this.wizContrato({ renovarCuenta: true, agregar: true });
  },

  // "Poner la cuenta al día": la regularización por ANEXO, entrando por la
  // CUENTA (Alberto 2026-09-09: "debe ser un botón del menú que abarque todo
  // lo que el cliente tiene, no por contrato"). Los seriales SIEMPRE fueron
  // los de toda la cuenta —vengan del contrato que vengan o de ninguno—; lo
  // que se elegía a dedo era el contrato donde colgar el anexo: salía
  // `activos[0]`, el primero de la lista. Ahora es el ANCLA de la cuenta (la
  // de mayor facturación, la misma que usa "Agregar equipos"), dicha de frente
  // y cambiable si hay varios.
  wizRegularizarCuenta() {
    const est = this._cuentaEstado();
    const ancla = est.tipo === 'consolidada' ? est.maestro : this._cuentaAncla();
    if (!ancla) {
      Toast.show('La cuenta no tiene contrato vigente donde colgar el anexo — regularízala con un contrato nuevo', 'warn');
      this.wizContrato({ renovarCuenta: true });
      return;
    }
    this.wizAumento(ancla.id, { regularizarD1: true });
  },
});

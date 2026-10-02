// @ts-nocheck
// Centro de gestión de clientes — Menú "Nueva gestión".
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Menú "Nueva gestión" ═════════ */

  toggleMenu(e) {
    e.stopPropagation();
    // El "⋯" se cierra al abrir este (2026-09-09, Alberto: "aprieto los 3
    // puntitos y luego nueva gestión y no se cierra el menú"). toggleMas ya
    // hacía lo simétrico, y el stopPropagation de aquí impedía que el
    // listener {once:true} que deja toggleMas llegara a cerrarlo.
    document.getElementById('cgMasMenu')?.classList.add('hidden');
    document.getElementById('cgMenu').classList.toggle('hidden');
  },

  armarMenu() {
    const btn = document.getElementById('btnGestion');
    this._pintarHeadLinks();
    if (!this.puedeCrearGestion()) { btn?.classList.add('hidden'); return; }
    btn?.classList.remove('hidden');
    // Terminación total como GESTIÓN (2026-08-27) — la página vieja de
    // enmiendas queda para el histórico y se descontinuará en la Ola 6.
    // Menú SEGÚN EL ESTADO DE LA CUENTA (decisión 2026-08-28: la unidad es la
    // cuenta, no el contrato — cada acción tiene UN significado claro):
    //   nueva        → Nuevo contrato.
    //   fragmentada  → todo pasa por Renovar cuenta (consolida); agregar
    //                  equipos entra por ahí; terminación = toda la cuenta.
    //   consolidada  → Aumento (anexo directo al maestro), Renovar cuando
    //                  entra en ventana, Terminación de la cuenta.
    // ── Menú POR INTENCIÓN (plan 2026-09-08 §4.2, rediseño del menú de
    // 2026-08-28). Depende de dos hechos y una excepción: ¿hay radios en
    // campo?, ¿hay contrato vigente?, ¿hay renovación en trámite? Mismo nombre
    // para la misma intención en todos los estados; lo que no aplica se
    // ESCONDE, no se deshabilita. Cotizar / Datos / Historial viven en la
    // cabecera (_pintarHeadLinks): este menú es solo para gestiones.
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const hayRadios = this.equipos.some(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    const hayContrato = est.renovables.length > 0;
    const item = (onclick, label, hint, cls = '') =>
      `<button type="button" class="${cls}" onclick="${onclick}">${label}${hint ? `<span class="cg-menu-hint">${hint}</span>` : ''}</button>`;
    const grupo = (hd, items) => { const xs = items.filter(Boolean); return xs.length ? `<div class="hd">${hd}</div>${xs.join('')}` : ''; };

    // Arriba, destacado: lo que la cuenta pide primero (misma regla que el
    // botón primario de la cabecera y el dock móvil: _accionPrimaria).
    const P = this._accionPrimaria();
    const top = P ? item(P.onclick, P.label, P.hint, 'top') : '';
    // Renovar cuenta ya es el destacado cuando aplica: no se repite en "Cambiar".
    const n = est.renovables.length;

    // "Poner la cuenta al día" (Alberto 2026-09-09): estaba escondido dentro
    // de "Qué falta" y entraba por un contrato elegido a dedo. Es una gestión
    // de CUENTA —abarca todo lo que el cliente tiene, venga del contrato que
    // venga— y por eso vive en el menú, como las demás.
    const d1Menu = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion);
    // Se ofrece SIEMPRE que haya contrato vigente, tenga o no radios sueltos
    // (Alberto 2026-09-09: "no estoy viendo el menú actualizar seriales del
    // cliente"). Con la cuenta al día el camino sigue sirviendo para declarar
    // seriales que el sistema no conoce y para sacar los que el cliente ya no
    // tiene; el hint dice cuál de los dos casos es.
    const alDia = grupo('Actualizar', [
      hayContrato && !tram
        ? item('Centro.wizRegularizarCuenta()', 'Actualizar seriales del cliente',
          d1Menu.length
            ? `amarra al contrato los ${d1Menu.length} radio(s) que ya tiene — sin firma, sin bodega y sin entrega`
            : 'declara los que el sistema no conoce o saca los que el cliente ya no tiene — sin firma') : '',
    ]);
    const dar = grupo('Dar equipos', [
      hayContrato && !tram ? item('Centro.wizAgregarEquipos()', 'Agregar equipos', 'radios — anexo al contrato de la cuenta') : '',
      // La consola es un CARGO, no un radio (2026-10-02, COMPAÑÍA GOLY: la
      // vendedora la buscó aquí, la mandó como "Agregar equipos" y nada se
      // guardaba). Mismo wizard que "Ajustar tarifa", nombrado por lo que da.
      hayContrato ? item(est.tipo === 'consolidada' ? `Centro.wizAjuste('${this.esc(est.maestro.id)}')` : 'Centro.wizAjuste()',
        'Agregar consola o servicio', 'consola, GPS y otros cargos — anexo con firma, sin bodega') : '',
      // TEMP (evento) y DEMO son independientes de la cuenta: no cuentan para
      // _cuentaEstado ni renuevan nada (caso Arraiján / Elvia, 2026-09-07).
      item('Centro.wizContrato({temporal:true})', 'Contrato temporal', 'por evento, días o meses'),
      item('Centro.wizDemo()', 'Demo', 'prueba sin cargo, termina con la devolución'),
    ]);
    const cambiar = grupo('Cambiar', [
      hayRadios ? item('Centro.wizReemplazo()', 'Reemplazar un equipo') : '',
      // Corregir ≠ reemplazar: aquí no se mueve equipo. Va junto al reemplazo
      // porque es donde lo busca quien acaba de descubrir el error, y el hint
      // es lo que evita que abran el trámite equivocado.
      hayRadios ? item('Centro.wizCambioSerial()', 'Corregir un serial mal registrado',
        'el cliente tiene otro radio del que dice el sistema — no mueve equipo') : '',
      hayContrato ? item(est.tipo === 'consolidada' ? `Centro.wizAjuste('${this.esc(est.maestro.id)}')` : 'Centro.wizAjuste()',
        'Ajustar tarifa', 'cambia el precio de las líneas o agrega cargos') : '',
    ]);
    const retirar = grupo('Retirar', [
      hayRadios ? item('Centro.wizBaja()', 'Baja parcial por serial') : '',
      hayContrato ? item('Centro.wizTerminacionCuenta()', 'Terminar la cuenta', n > 1 ? `cancela los ${n} contratos con una sola carta` : '') : '',
    ]);
    // Pie discreto: salidas raras. Adenda a contrato EN PAPEL (2026-09-07,
    // caso Falcon): el marco no está en el sistema y hoy no se puede
    // regularizar, pero hace falta un equipo más; no crea contrato interno.
    // Solo donde tiene sentido: cuenta sin contrato en el sistema.
    const pie = [
      (est.tipo === 'nueva' || est.tipo === 'sin_contrato')
        ? item('Centro.wizAumento(null,{papel:true})', '¿Contrato en papel? Anexo de aumento', '', 'pie') : '',
      // Contrato nuevo con cuenta vigente (decisión 6 de Alberto, 1-oct-2026):
      // SÍ, como respaldo y no como camino principal — otra sede, otro
      // servicio aparte. Al final del menú, y el wizard pide y guarda la razón
      // por la que no es un anexo ni una renovación.
      hayContrato && !tram
        ? item('Centro.wizContrato({nuevoConVigente:true})', '¿Otro contrato aparte? Nuevo contrato', 'respaldo — pide la razón de no usar anexo o renovación', 'pie') : '',
      this._puedeMasiva() ? `<a class="pie" href="./index.html">Edición masiva de clientes</a>` : '',
    ].filter(Boolean).join('');

    document.getElementById('cgMenu').innerHTML = `${top}${alDia}${dar}${cambiar}${retirar}${pie}`;
  },

  // Menú "⋯" de la cabecera: Cotizar, Datos del cliente, Historial (2026-09-08).
  _pintarHeadLinks() {
    const el = document.getElementById('cgMasMenu');
    if (!el || !this.cliente) return;
    const id = this.esc(this.cliente.id);
    el.innerHTML = `
      ${this._puedeCotizar() ? `<a href="../cotizaciones/nueva-cotizacion.html?cliente_id=${id}&from=centro">Nueva cotización<span class="cg-menu-hint">abre el editor con este cliente ya elegido</span></a>` : ''}
      <a href="./ficha.html?id=${id}&from=centro">${this._puedeEditarCliente() ? 'Editar datos del cliente' : 'Ver datos del cliente'}<span class="cg-menu-hint">${this._puedeEditarCliente() ? 'RUC, representante, contacto, vendedor' : 'solo lectura — los cambios los hace cobros'}</span></a>
      ${this._puedeVerDocs() ? `<button type="button" onclick="Centro.verDocumentos()">Documentos del cliente<span class="cg-menu-hint">registro público, cédula, poderes</span></button>` : ''}
      <button type="button" onclick="Centro.constanciaEquipos()">Constancia de equipos<span class="cg-menu-hint">lo que tiene hoy, con qué contrato y con qué entrega</span></button>
      <button type="button" onclick="Centro.abrirBloque('blkActividad')">Historial de la ficha<span class="cg-menu-hint">quién cambió qué y cuándo</span></button>`;
  },

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

// Asistente "Recibir equipos" — componente reutilizable extraído de
// Inventario · Equipos por serial (2026-08-10) para que el espacio /almacen/
// pueda montarlo sin depender de esa página. UNA sola implementación: la
// página vieja delega aquí (EquiposPool.abrirRecibir → AsistenteRecibir.abrir).
//
// API:
//   AsistenteRecibir.abrir({ user, onDone })
//     user   — firebase.auth().currentUser del llamador (el componente NO
//              gatea rol: confía en que la página ya lo hizo, igual que hoy).
//     onDone — callback(resumen) al terminar una recepción (también en la
//              parcial de "corrige el modelo"), para que la página refresque.
//   AsistenteRecibir.mensajeColisiones(pendientes, modeloLabel)
//     Texto del diálogo de colisión — público porque el import Excel de
//     inventario-equipos.js reutiliza el mismo mensaje.
//
// El overlay es propio (mismo patrón que js/ui/equipo-ficha.js): clases
// .overlay/.modal del kit ceco-ui, cierre por ✕ / click-fuera / Escape.
// No depende de markup en el HTML de la página.
//
// Dependencias del host: firebase compat (global), EquiposPoolService,
// ModelosService, Modal (js/ui/modal.js, para los confirm en fases) y
// ceco-ui.css. Opcionales: FMT (usa su esc si existe), Toast, lucide.
window.AsistenteRecibir = {

  _opts: null,
  _el: null,        // overlay montado
  _modelos: [],     // { id, label, estado(N/R) } — fila EXACTA del catálogo
  _busy: false,     // bloquea el cierre mientras la recepción corre

  _esc(s) {
    if (window.FMT && typeof FMT.esc === 'function') return FMT.esc(s);
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  },

  _toast(msg, tipo) {
    if (window.Toast) Toast.show(msg, tipo);
  },

  async abrir(opts = {}) {
    this._opts = opts || {};
    this._render();
    await this._cargarModelos();
  },

  // Catálogo de modelos: misma preparación que la página de Inventario —
  // activos, etiqueta marca+modelo, y `estado` (N/R) conservado porque es lo
  // que determina la condición de la unidad (ver _condicionDeModelo).
  async _cargarModelos() {
    try {
      const todos = await ModelosService.getModelos();
      this._modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim(),
                     estado: (m.estado || '').toUpperCase() }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de modelos:', e);
      this._modelos = [];
    }
    this._pintarOpcionesModelo(this._el?.querySelector('#asrModeloFiltro')?.value || '');
  },

  // Pinta el select respetando el filtro (auditoría: el catálogo completo en
  // un <select> nativo era navegación a golpe de teclas parciales en bodega).
  // Fila EXACTA del catálogo (N y R aparte) — igual que el modal original.
  _pintarOpcionesModelo(filtro = '') {
    const sel = this._el?.querySelector('#asrModelo');
    if (!sel) return;
    const q = String(filtro || '').toLowerCase().trim();
    const actual = sel.value;
    const lista = q ? this._modelos.filter(m => (m.label || '').toLowerCase().includes(q)) : this._modelos;
    sel.innerHTML = '<option value="">Seleccione…</option>' + lista
      .map(m => `<option value="${this._esc(m.id)}">${this._esc(m.label)}</option>`).join('');
    if (actual && lista.some(m => m.id === actual)) sel.value = actual;
    // Con un único resultado se auto-selecciona: teclear "nx-410" y seguir
    // directo al textarea de seriales.
    else if (q && lista.length === 1) sel.value = lista[0].id;
    else sel.value = '';
    this._sincronizarCondicion();
  },

  _modeloLabel(modeloId) {
    return this._modelos.find(m => m.id === modeloId)?.label || '';
  },

  // La condición NO se escoge: la determina la fila del catálogo (las filas
  // con sufijo -R son refurbished). Mismo criterio que el servidor
  // (functions/src/domain/equiposPool.js): manda `estado`, y si falta se cae
  // al sufijo del nombre. null = modelo fuera del catálogo (aquí no pasa: el
  // select solo lista filas del catálogo, pero se conserva el contrato).
  _condicionDeModelo(modeloId) {
    const m = this._modelos.find(x => x.id === modeloId);
    if (!m) return null;
    if (m.estado === 'R') return 'reuso';
    if (m.estado === 'N') return 'nuevo';
    return /[\s-]r$/i.test(m.label || '') ? 'reuso' : 'nuevo';
  },

  // Refleja en el select deshabilitado la condición que impone el modelo.
  _sincronizarCondicion() {
    const modeloId = this._el?.querySelector('#asrModelo')?.value || '';
    const selCond  = this._el?.querySelector('#asrCondicion');
    const hint     = this._el?.querySelector('#asrCondicionHint');
    if (!selCond) return;
    const cond = this._condicionDeModelo(modeloId) || 'nuevo';
    selCond.value = cond;
    if (!hint) return;
    if (!modeloId) {
      hint.textContent = 'La define el modelo escogido.';
    } else {
      hint.textContent = cond === 'reuso'
        ? 'Refurbished: el modelo lleva sufijo -R.'
        : 'Nuevo: el modelo no lleva sufijo -R.';
    }
  },

  async guardar() {
    const modeloId = this._el.querySelector('#asrModelo').value;
    if (!modeloId) { this._toast('Selecciona el modelo de los equipos.', 'bad'); return; }
    const seriales = this._el.querySelector('#asrSeriales').value
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!seriales.length) { this._toast('Pega o escanea al menos un serial.', 'bad'); return; }

    const btn = this._el.querySelector('#asrBtnGuardar');
    btn.disabled = true;
    this._busy = true;
    try {
      // Detector de mal transcritos (auditoría): SerialPatron corría SOLO en
      // el importador — y justo este flujo de tecleo suelto es donde nacieron
      // seriales como 16O13D0998 (letra O por cero). Aviso no bloqueante.
      if (window.SerialPatron && seriales.length >= 3) {
        try {
          const rev = SerialPatron.revisar(seriales.map(s => s.toUpperCase()));
          const sosp = (rev.revisados || []).filter(r => r.sospechoso);
          if (sosp.length && rev.cobertura >= 0.6) {
            const detalle = sosp.slice(0, 8)
              .map(r => r.serial + (r.sugerencia ? ` (¿será ${r.sugerencia}?)` : '')).join('\n');
            const seguir = confirm(
              `Ojo: ${sosp.length} serial(es) no calzan con el patrón del resto de la tanda:\n\n${detalle}\n\n¿Recibir igual?`);
            if (!seguir) return;
          }
        } catch (_) { /* detector opcional: nunca frena la recepción */ }
      }

      const opciones = {
        modelo_id:    modeloId,
        modelo_label: this._modeloLabel(modeloId),
        condicion:    this._condicionDeModelo(modeloId) || 'nuevo',
        proveedor:    this._el.querySelector('#asrProveedor').value,
        notas:        this._el.querySelector('#asrNotas').value,
        origen:       this._el.querySelector('#asrTomaFisica').checked ? 'toma_fisica' : 'bodega',
      };
      const user = this._opts.user || firebase.auth().currentUser;
      const res = await EquiposPoolService.recibir(seriales, opciones, user);
      let noMovidos = 0;

      // Seriales que ya existen con OTRO modelo: se pregunta antes de partir la
      // ficha. Antes se creaban solas y solo lo avisaba un toast de paso — así
      // entraron 8 fichas duplicadas al inventario entre julio y agosto 2026.
      const pendientes = res.colisiones_pendientes || [];
      if (pendientes.length) {
        const confirmado = await Modal.confirm({
          title: 'Seriales que ya existen con otro modelo',
          danger: true,
          confirmLabel: `Sí, son ${pendientes.length === 1 ? 'otro equipo' : 'otros equipos'}`,
          cancelLabel: 'No, voy a corregir el modelo',
          message: this.mensajeColisiones(pendientes, opciones.modelo_label),
        });
        if (confirmado) {
          const res2 = await EquiposPoolService.recibir(
            pendientes.map(c => c.serial), { ...opciones, confirmarColisiones: true }, user);
          res.nuevos     += res2.nuevos;
          res.existentes += res2.existentes;
          res.colisiones += res2.colisiones;
        } else {
          // El asistente queda abierto con los datos puestos para corregir el
          // modelo y volver a intentar.
          let parcial = `${res.nuevos} equipos recibidos. ${pendientes.length} sin registrar:`
            + ` corrige el modelo y vuelve a guardar.`;
          this._toast(parcial, 'warn');
          this._onDone(res);
          return;
        }
      }

      // Seriales que YA tienen ficha de este modelo pero que el sistema tenía
      // en otro lado. Contar un radio es afirmar dónde está, así que se
      // pregunta y se traen a bodega. Sin esto la recepción decía "N ya
      // existían" y no movía nada: el conteo no tenía efecto y bodega quedaba
      // dependiendo de un script (44 NX-420-R así, 2026-08-06).
      const reubicables = res.reubicables_pendientes || [];
      if (reubicables.length) {
        const confirmado = await Modal.confirm({
          title: 'Equipos que el sistema tenía en otro lado',
          danger: true,
          confirmLabel: `Sí, ${reubicables.length === 1 ? 'está' : 'están'} en bodega`,
          cancelLabel: 'No los muevas',
          message: this._mensajeReubicacion(reubicables),
        });
        if (confirmado) {
          const res3 = await EquiposPoolService.recibir(
            reubicables.map(c => c.serial),
            { ...opciones, confirmarReubicacion: true,
              motivo: `Toma física de bodega${opciones.notas ? ` — ${opciones.notas}` : ''}` }, user);
          res.reubicados += res3.reubicados;
          res.modelo_completado += res3.modelo_completado || 0;
          res.bloqueados = (res.bloqueados || []).concat(res3.bloqueados || []);
        } else {
          noMovidos = reubicables.length;
        }
      }

      this._cerrar();
      let msg = `${res.nuevos} equipos recibidos en bodega.`;
      if (res.reubicados) msg += ` ${res.reubicados} traídos de vuelta a bodega.`;
      if (res.existentes) msg += ` ${res.existentes} ya estaban.`;
      // Se nombra aparte porque es lo que hace que aparezcan en el inventario:
      // sin modelo la ficha no suma bajo ninguno, y "ya estaban" a secas era
      // justo el mensaje que dejaba a bodega sin saber por qué no cuadraba.
      if (res.modelo_completado) {
        msg += ` ${res.modelo_completado} tenían la ficha sin modelo y se completó`
          + ` con ${opciones.modelo_label || 'el modelo del conteo'}.`;
      }
      // Decir "ya existían" de algo que sigue figurando con un cliente sería la
      // misma mentira que este cambio vino a quitar.
      if (noMovidos) msg += ` ${noMovidos} se dejaron donde estaban.`;
      if (res.colisiones) msg += ` ${res.colisiones} con serial compartido entre modelos.`;
      if (res.invalidos)  msg += ` ${res.invalidos} seriales inválidos.`;
      // Baja/vendido/en revisión no se mueven desde aquí: se nombran para que
      // nadie crea que el conteo los cubrió.
      const bloq = res.bloqueados || [];
      if (bloq.length) {
        msg += ` ${bloq.length} sin mover (${[...new Set(bloq.map(b =>
          EquiposPoolService.ESTADO_LABELS[b.estado] || b.estado))].join(', ')}):`
          + ` ${bloq.slice(0, 5).map(b => b.serial).join(', ')}${bloq.length > 5 ? '…' : ''}.`;
      }
      this._toast(msg, (res.colisiones || bloq.length) ? 'warn' : 'ok');
      this._onDone(res);
    } catch (e) {
      console.error('Error al recibir equipos:', e);
      this._toast('Error al recibir: ' + (e.message || e), 'bad');
    } finally {
      this._busy = false;
      btn.disabled = false;
    }
  },

  _onDone(resumen) {
    if (typeof this._opts?.onDone !== 'function') return;
    try { this._opts.onDone(resumen); }
    catch (e) { console.error('onDone del asistente de recepción falló:', e); }
  },

  // Texto del diálogo de colisión. Se inyecta como HTML dentro de un <p>, así
  // que solo <b>/<br> (nada de bloques) y todo dato va escapado. Público: el
  // import Excel de inventario-equipos.js arma el mismo diálogo.
  mensajeColisiones(pendientes, modeloLabel) {
    const esc = this._esc.bind(this);
    const MAX = 12;
    const filas = pendientes.slice(0, MAX).map(c =>
      `<b>${esc(c.serial)}</b> — ya registrado como ${esc(c.modelo_existente)}`
      + (c.estado_existente ? ` (${esc(EquiposPoolService.ESTADO_LABELS[c.estado_existente] || c.estado_existente)})` : '')
    ).join('<br>');
    const resto = pendientes.length > MAX ? `<br>… y ${pendientes.length - MAX} más` : '';
    return `${pendientes.length === 1 ? 'Este serial ya existe' : `Estos ${pendientes.length} seriales ya existen`}`
      + ` en el pool con un modelo distinto`
      + (modeloLabel ? ` a <b>${esc(modeloLabel)}</b>` : ' al que estás recibiendo') + ':'
      + `<br><br>${filas}${resto}<br><br>`
      + `Continúa <b>solo si de verdad son equipos distintos</b> que comparten numeración`
      + ` (caso Kenwood NX-420 / NX-920): se creará una ficha aparte para cada uno.`
      + `<br><br>Si el modelo que seleccionaste está equivocado, cancela y corrígelo —`
      + ` crear la ficha aparte cuenta el mismo radio dos veces en el inventario.`;
  },

  // Texto del diálogo de reubicación. Mismas reglas que el de colisión: va
  // dentro de un <p>, solo <b>/<br>, todo dato escapado.
  //
  // Dice de dónde viene cada unidad —con cliente y contrato— porque ahí está la
  // decisión: traer a bodega un radio que figura entregado deja al contrato
  // listándolo. Si la lista no cuadra, se cancela y se revisa, no se confirma.
  _mensajeReubicacion(pendientes) {
    const esc = this._esc.bind(this);
    const MAX = 12;
    const filas = pendientes.slice(0, MAX).map(c => {
      const donde = EquiposPoolService.ESTADO_LABELS[c.estado] || c.estado;
      const quien = c.cliente ? ` con ${esc(c.cliente)}` : '';
      const cont = c.contrato ? ` (${esc(c.contrato)})` : '';
      return `<b>${esc(c.serial)}</b> — el sistema lo tiene en ${esc(donde)}${quien}${cont}`;
    }).join('<br>');
    const resto = pendientes.length > MAX ? `<br>… y ${pendientes.length - MAX} más` : '';
    const n = pendientes.length;
    return `${n === 1 ? 'Este serial ya tiene ficha' : `Estos ${n} seriales ya tienen ficha`}`
      + ` de este modelo, pero el sistema ${n === 1 ? 'no lo tenía' : 'no los tenía'} en bodega:`
      + `<br><br>${filas}${resto}<br><br>`
      + `Al confirmar estás <b>afirmando que ${n === 1 ? 'está' : 'están'} físicamente en bodega</b>`
      + ` porque ${n === 1 ? 'lo acabas' : 'los acabas'} de contar.`
      + ` ${n === 1 ? 'Pasa' : 'Pasan'} a <b>En bodega</b>, se ${n === 1 ? 'suelta' : 'sueltan'} sus`
      + ` vínculos (contrato, orden, device POC) y queda movimiento en el kardex.`
      + `<br><br>Si alguno sigue con un cliente, cancela: el inventario quedaría mintiendo.`
      + ` Un contrato vigente <b>seguirá listando el serial</b> — hay que corregirlo también`
      + ` en Seriales del contrato.`;
  },

  // ── Overlay propio (patrón equipo-ficha._render) ─────────────────────
  _render() {
    document.getElementById('asistenteRecibirOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'asistenteRecibirOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px; width:min(520px, 94vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;"><i data-lucide="package-plus"></i> Recibir equipos en bodega</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:14px 8px;">
          <div class="form-field">
            <label class="form-label" for="asrModelo">Modelo</label>
            <input class="form-input" id="asrModeloFiltro" type="search"
                   placeholder="Filtrar modelo… (ej. NX-410)" style="margin-bottom:4px;"
                   autocomplete="off">
            <select class="form-select" id="asrModelo"><option value="">Seleccione…</option></select>
          </div>
          <div class="form-field">
            <label class="form-label" for="asrSeriales">Seriales <span class="optional">(uno por línea — acepta lector de código de barras)</span></label>
            <textarea class="form-input" id="asrSeriales" rows="6" placeholder="B12345678&#10;B12345679&#10;…" style="font-family:var(--font-mono);"></textarea>
            <p id="asrContador" style="font-size:12px; color:var(--fg-2); margin:4px 0 0; display:none;"></p>
            <p style="font-size:12px; color:var(--fg-3); margin:4px 0 0;">
              Sirve para contar el estante: los seriales que no existan se dan de alta y los que el
              sistema tenga en otro lado se preguntan antes de traerlos a bodega.</p>
          </div>
          <div style="display:flex; gap:var(--sp-3);">
            <div class="form-field" style="flex:1;">
              <label class="form-label" for="asrCondicion">Condición</label>
              <select class="form-select" id="asrCondicion" disabled
                      title="La determina el modelo: las filas con sufijo -R son refurbished.">
                <option value="nuevo">Nuevo</option>
                <option value="reuso">Refurbished</option>
              </select>
              <p id="asrCondicionHint" style="font-size:12px; color:var(--fg-3); margin:4px 0 0;">
                La define el modelo escogido.</p>
            </div>
            <div class="form-field" style="flex:2;">
              <label class="form-label" for="asrProveedor">Proveedor / factura <span class="optional">(opcional)</span></label>
              <input class="form-input" id="asrProveedor" type="text">
            </div>
          </div>
          <div class="form-field">
            <label class="form-label" for="asrNotas">Notas <span class="optional">(opcional)</span></label>
            <input class="form-input" id="asrNotas" type="text">
          </div>
          <label class="toggle-pill" style="margin-top:var(--sp-1);">
            <input type="checkbox" id="asrTomaFisica"> Toma física inicial (migración del stock existente)
          </label>
        </div>
        <div class="footer" style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
          <button class="btn btn-primary" id="asrBtnGuardar"><i data-lucide="check"></i> Recibir</button>
        </div>
      </div>`;

    const kb = (e) => { if (e.key === 'Escape') this._cerrar(); };
    this._kb = kb;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-action="cerrar"]')) this._cerrar();
    });
    document.addEventListener('keydown', kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    this._el = overlay;

    overlay.querySelector('#asrModelo').addEventListener('change', () => this._sincronizarCondicion());
    overlay.querySelector('#asrModeloFiltro').addEventListener('input', (e) => this._pintarOpcionesModelo(e.target.value));
    overlay.querySelector('#asrSeriales').addEventListener('input', () => this._actualizarContador());
    overlay.querySelector('#asrBtnGuardar').addEventListener('click', () => this.guardar());
    this._sincronizarCondicion();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    // Foco directo al filtro: es el primer gesto del flujo real de bodega.
    overlay.querySelector('#asrModeloFiltro').focus();
  },

  // Contador en vivo (auditoría): al escanear con lector nadie mira la
  // pantalla — un serial repetido solo se descubría al final, sumado a
  // "inválidos" en el mismo número. Aquí se ve al momento.
  _actualizarContador() {
    const el  = this._el?.querySelector('#asrContador');
    const txt = this._el?.querySelector('#asrSeriales');
    if (!el || !txt) return;
    const lineas = txt.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lineas.length) { el.style.display = 'none'; return; }
    const norm = lineas.map(s => s.toUpperCase());
    const repetidos = norm.length - new Set(norm).size;
    el.style.display = '';
    el.innerHTML = `<b>${lineas.length}</b> serial(es) en la tanda` +
      (repetidos ? ` · <b style="color:#B45309;">${repetidos} repetido(s)</b> — se reciben una sola vez` : '');
  },

  // Cierra el overlay — salvo mientras la recepción corre (los confirm en
  // fases viven encima; un Escape ahí no debe tumbar el formulario a medias).
  _cerrar() {
    if (this._busy || !this._el) return;
    this._el.remove();
    this._el = null;
    document.body.style.overflow = '';
    if (this._kb) { document.removeEventListener('keydown', this._kb); this._kb = null; }
  },
};

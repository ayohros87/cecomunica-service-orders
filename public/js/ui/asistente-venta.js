// Asistente "Registrar venta" (venta directa facturada en QuickBooks) —
// componente reutilizable extraído de Inventario · Equipos por serial
// (2026-08-10) para que el espacio /almacen/ pueda montarlo sin depender de
// esa página. UNA sola implementación: la página vieja delega aquí
// (EquiposPool.abrirVenta → AsistenteVenta.abrir).
//
// La factura ya existe en QBO; aquí solo se descuenta la unidad de bodega
// (estado vendido, propiedad cliente) con el vínculo a esa factura.
//
// API:
//   AsistenteVenta.abrir({ user, serialesPrefill, desdeUnidadId, rol, onDone })
//     user            — firebase.auth().currentUser del llamador (el
//                       componente NO gatea rol: confía en que la página ya
//                       lo hizo, igual que hoy).
//     serialesPrefill — opcional: array (o string) de seriales para
//                       pre-llenar el textarea (venta desde una fila/ficha).
//     desdeUnidadId   — opcional: id de la unidad del pool desde cuya fila se
//                       abrió la venta; desambigua seriales compartidos con
//                       2+ unidades en bodega.
//     rol             — opcional: rol efectivo del usuario; decide el CTA
//                       post-venta "Crear orden de programación" (canRole
//                       'crear-orden'). Si falta, se cae a window.userRole.
//     onDone          — callback(resumen) tras registrar la venta, para que
//                       la página refresque. resumen = { ok, errores, vendidas }.
//
// El overlay es propio (mismo patrón que js/ui/equipo-ficha.js): clases
// .overlay/.modal del kit ceco-ui, cierre por ✕ / click-fuera / Escape.
// No depende de markup en el HTML de la página.
//
// Dependencias del host: firebase compat (global), EquiposPoolService,
// ClientesService, FMT (core/formatting.js — normalize para el autocomplete),
// Modal (js/ui/modal.js) y ceco-ui.css. Opcionales: Toast, lucide, roles.js
// (canRole, para el CTA post-venta).
window.AsistenteVenta = {

  _opts: null,
  _el: null,            // overlay montado
  _busy: false,         // bloquea el cierre mientras la venta corre
  _desdeUnidadId: null, // unidad concreta (fila) — desambigua serial compartido

  // Autocompletado de cliente — mismo patrón que POC/vendedores-batch: caché
  // local de clientes (6h, misma clave 'cache_clientes_v1') + sugerencias por
  // subcadena normalizada. La venta debe quedar ligada a un cliente existente
  // de la app; un nombre libre solo pasa como excepción confirmada.
  _clientesCache: null,
  _clienteSel: null,
  _cliTimer: null,
  _cliRefrescado: false, // ya se releyó del servidor en esta apertura

  _esc(s) {
    if (window.FMT && typeof FMT.esc === 'function') return FMT.esc(s);
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  },

  _toast(msg, tipo) {
    if (window.Toast) Toast.show(msg, tipo);
  },

  abrir(opts = {}) {
    this._opts = opts || {};
    this._desdeUnidadId = opts.desdeUnidadId || null;
    this._clienteSel = null;
    this._cliRefrescado = false;
    this._render();
    const pref = opts.serialesPrefill;
    this._el.querySelector('#asvSeriales').value =
      Array.isArray(pref) ? pref.join('\n') : (pref || '');
    this._cargarClientesCache().catch(e => console.error('Error al precargar clientes:', e));
  },

  // `fresh` ignora las DOS cachés (memoria y localStorage) y relee del servidor.
  // Un cliente recién creado en otra máquina no está en ninguna de las dos, y
  // hasta 2026-08-10 eso lo volvía invisible aquí durante horas.
  async _cargarClientesCache(fresh = false) {
    if (this._clientesCache && !fresh) return this._clientesCache;
    if (!fresh) {
      try {
        const raw = localStorage.getItem('cache_clientes_v1');
        if (raw) {
          const { exp, data } = JSON.parse(raw);
          if (exp && Date.now() < exp && Array.isArray(data) && data.length) {
            this._clientesCache = data;
            return data;
          }
        }
      } catch (_) { /* caché ilegible: se reconstruye */ }
    }
    const clientes = await ClientesService.getAllClientes({ fresh });
    this._clientesCache = clientes.map(c => {
      const nombre = (c.nombre || '').toString();
      return { id: c.id, nombre, norm: FMT.normalize(nombre) };
    });
    try {
      localStorage.setItem('cache_clientes_v1',
        JSON.stringify({ exp: Date.now() + 6 * 60 * 60 * 1000, data: this._clientesCache }));
    } catch (_) { /* localStorage lleno: seguimos solo en memoria */ }
    return this._clientesCache;
  },

  sugerirCliente() {
    this._clienteSel = null; // editar el texto invalida la selección previa
    const cont  = this._el?.querySelector('#asvClienteSugs');
    const input = this._el?.querySelector('#asvCliente');
    if (!cont || !input) return;
    cont.innerHTML = '';
    const texto = (input.value || '').trim();
    if (texto.length < 2) return;
    clearTimeout(this._cliTimer);
    this._cliTimer = setTimeout(async () => {
      try { await this._cargarClientesCache(); } catch (e) { console.error('Error al cargar clientes:', e); return; }
      const needle  = FMT.normalize(texto);
      const filtrar = () => this._clientesCache.filter(c => c.norm.includes(needle));
      // Cero coincidencias puede ser un cliente creado después de que se llenó
      // la caché. Se relee del servidor UNA vez por apertura antes de decir que
      // no existe — es la diferencia entre facturar y no poder facturar.
      if (!filtrar().length && !this._cliRefrescado) {
        this._cliRefrescado = true;
        try { await this._cargarClientesCache(true); } catch (e) { console.error('Error al refrescar clientes:', e); }
      }
      const matches = filtrar()
        .map(c => ({ ...c, pos: c.norm.indexOf(needle) }))
        .sort((a, b) => a.pos !== b.pos ? a.pos - b.pos
          : a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
        .slice(0, 30);
      cont.innerHTML = '';
      if (!matches.length) return;
      const ul = document.createElement('ul');
      ul.className = 'suggest-list';
      matches.forEach(m => {
        const li = document.createElement('li');
        li.className = 'suggest-item';
        li.textContent = m.nombre;
        li.onclick = () => {
          input.value = m.nombre;
          this._clienteSel = { id: m.id, nombre: m.nombre };
          cont.innerHTML = '';
        };
        ul.appendChild(li);
      });
      cont.appendChild(ul);
    }, 200);
  },

  async guardar() {
    const esc = this._esc.bind(this);
    const cliente = this._el.querySelector('#asvCliente').value.trim();
    const factura = this._el.querySelector('#asvFactura').value.trim();
    const notas   = this._el.querySelector('#asvNotas').value.trim();
    const seriales = this._el.querySelector('#asvSeriales').value
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!seriales.length) { this._toast('Pega o escanea al menos un serial.', 'bad'); return; }
    if (!cliente) { this._toast('Indica a quién se vendió (el cliente de la factura).', 'bad'); return; }

    // El cliente debe existir en la app: o se eligió de las sugerencias, o el
    // texto coincide exacto con uno del caché. Un nombre libre solo pasa como
    // excepción confirmada y la venta queda marcada (cliente_excepcion).
    let clienteSel = (this._clienteSel && this._clienteSel.nombre === cliente)
      ? this._clienteSel : null;
    let clienteExcepcion = false;
    if (!clienteSel) {
      try { await this._cargarClientesCache(); } catch (e) { console.error('Error al cargar clientes:', e); }
      const needle = FMT.normalize(cliente);
      const buscar = () => (this._clientesCache || []).find(c => c.norm === needle);
      // Nunca marcar "cliente no registrado" contra una caché vieja: antes de
      // ofrecer la excepción se relee del servidor.
      let hit = buscar();
      if (!hit && !this._cliRefrescado) {
        this._cliRefrescado = true;
        try { await this._cargarClientesCache(true); } catch (e) { console.error('Error al refrescar clientes:', e); }
        hit = buscar();
      }
      if (hit) {
        clienteSel = { id: hit.id, nombre: hit.nombre };
      } else {
        if (!await Modal.confirm({
          title: 'Cliente no registrado',
          message: `<strong>${esc(cliente)}</strong> no existe como cliente en la app.<br><br>
            Lo normal es elegirlo de las sugerencias al escribir. ¿Registrar la venta
            <strong>por excepción</strong> con este nombre tal cual? Quedará marcada como
            venta a cliente no registrado.`,
          confirmLabel: 'Registrar por excepción',
        })) return;
        clienteSel = { id: '', nombre: cliente };
        clienteExcepcion = true;
      }
    }

    const btn = this._el.querySelector('#asvBtnGuardar');
    btn.disabled = true;
    this._busy = true;
    try {
      const user = this._opts.user || firebase.auth().currentUser;
      // Validación previa: solo se venden unidades EN BODEGA. Lo demás se
      // reporta (no está en el pool / otro estado / colisión ambigua) y la
      // venta puede seguir con las válidas.
      const vendibles = [], problemas = [];
      const vistos = new Set();
      let revisados = 0;
      for (const s of seriales) {
        // Progreso visible: con 30+ seriales la validación tarda y el botón
        // deshabilitado a secas parecía cuelgue.
        btn.textContent = `Validando ${++revisados}/${seriales.length}…`;
        const norm = EquiposPoolService.normalizarSerial(s);
        if (!EquiposPoolService.esSerialValido(norm)) { problemas.push(`${esc(s)}: serial inválido`); continue; }
        if (vistos.has(norm)) continue;
        vistos.add(norm);
        const docs = await EquiposPoolService.findBySerial(s);
        if (!docs.length) { problemas.push(`${esc(norm)}: no está en el pool`); continue; }
        const enBodega = docs.filter(d => d.estado === 'en_bodega');
        if (!enBodega.length) {
          const estados = docs.map(d => EquiposPoolService.ESTADO_LABELS[d.estado] || d.estado).join(', ');
          problemas.push(`${esc(norm)}: no está en bodega (${esc(estados)})`);
          continue;
        }
        // Serial compartido con 2+ unidades en bodega: solo es inequívoco si la
        // venta se abrió desde la fila de una unidad concreta.
        const unidad = enBodega.length === 1 ? enBodega[0]
          : enBodega.find(d => d.id === this._desdeUnidadId);
        if (!unidad) { problemas.push(`${esc(norm)}: serial en 2+ modelos en bodega — regístralo desde el botón de venta de su fila`); continue; }
        vendibles.push(unidad);
      }

      if (!vendibles.length) {
        this._toast('Ningún serial se puede vender: ' + problemas.join(' · ').replace(/<[^>]*>/g, ''), 'bad');
        return;
      }
      const detalle = vendibles.map(u =>
        `<span style="font-family:var(--font-mono);">${esc(u.serial || u.serial_norm)}</span> (${esc(u.modelo_label || 'sin modelo')})`).join('<br>');
      const avisos = problemas.length
        ? `<br><br><strong>${problemas.length} serial(es) NO se venderán:</strong><br>${problemas.join('<br>')}` : '';
      if (!await Modal.confirm({
        title: 'Registrar venta',
        message: `Venta a <strong>${esc(clienteSel.nombre)}</strong>${clienteExcepcion ? ' <em>(por excepción — no registrado en la app)</em>' : ''}${factura ? ` — factura QBO <strong>${esc(factura)}</strong>` : ''}.<br>
          Salen de bodega de forma permanente:<br><br>${detalle}${avisos}`,
        confirmLabel: `Vender ${vendibles.length} equipo(s)`,
      })) return;

      let ok = 0; const errores = []; const vendidas = [];
      for (const u of vendibles) {
        try {
          await EquiposPoolService.vender(u.id, {
            factura, notas,
            cliente_id: clienteSel.id, cliente_nombre: clienteSel.nombre,
            cliente_excepcion: clienteExcepcion,
          }, user);
          ok++;
          vendidas.push(u);
        } catch (e) {
          errores.push(`${u.serial || u.id}: ${e.message || e}`);
        }
      }
      this._cerrarForzado();
      let msg = `${ok} equipo(s) registrados como vendidos.`;
      if (errores.length) msg += ` ${errores.length} fallaron: ${errores.join(' · ')}`;
      this._toast(msg, errores.length ? 'warn' : 'ok');
      this._onDone({ ok, errores, vendidas });

      // Encadenamiento venta → orden de PROGRAMACIÓN: los radios vendidos casi
      // siempre pasan por el taller a programarse antes de entregarse. El CTA
      // lleva a nueva-orden con el formulario precargado (cliente, seriales,
      // "no aplica contrato" + motivo); crear la orden sigue siendo decisión
      // humana. Requiere cliente con ficha (el select de la orden usa
      // cliente_id) y un rol que pueda crear órdenes (inventario no puede).
      const rol = this._opts.rol || window.userRole || null;
      if (ok > 0 && clienteSel.id && !clienteExcepcion
          && typeof canRole === 'function' && canRole(rol, 'crear-orden')) {
        const crear = await Modal.confirm({
          title: 'Venta registrada',
          message: `¿Crear la orden de servicio de <strong>PROGRAMACIÓN</strong> para
            <strong>${esc(clienteSel.nombre)}</strong> con los ${ok} equipo(s) vendidos?<br>
            El formulario llega precargado — nada se crea hasta que lo guardes.`,
          confirmLabel: 'Crear orden de programación',
        });
        if (crear) {
          const qs = new URLSearchParams({
            tipo: 'PROGRAMACION', origen: 'venta',
            cliente_id: clienteSel.id,
            seriales: vendidas.map(u => u.serial || u.serial_norm).join(','),
          });
          if (factura) qs.set('factura', factura);
          window.location.href = `../ordenes/nueva-orden.html?${qs.toString()}`;
        }
      }
    } catch (e) {
      console.error('Error al registrar la venta:', e);
      this._toast('Error al registrar la venta: ' + (e.message || e), 'bad');
    } finally {
      this._busy = false;
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check"></i> Registrar venta';
      if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
    }
  },

  _onDone(resumen) {
    if (typeof this._opts?.onDone !== 'function') return;
    try { this._opts.onDone(resumen); }
    catch (e) { console.error('onDone del asistente de venta falló:', e); }
  },

  // ── Overlay propio (patrón equipo-ficha._render) ─────────────────────
  // El desplegable de sugerencias venía del CSS local de equipos.html; ahora
  // lo trae el componente, acotado a su overlay para no pisar otras páginas.
  _injectCss() {
    if (document.getElementById('asistenteVentaCss')) return;
    const st = document.createElement('style');
    st.id = 'asistenteVentaCss';
    st.textContent = `
      #asistenteVentaOverlay .suggest-list {
        position: absolute; top: 100%; left: 0; right: 0;
        background: var(--surface-card); border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md); box-shadow: var(--shadow-md);
        padding: 6px; margin: 4px 0 0; list-style: none;
        max-height: 220px; overflow-y: auto; z-index: 2000;
      }
      #asistenteVentaOverlay .suggest-item { padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
      #asistenteVentaOverlay .suggest-item:hover { background: var(--surface-sunken); color: var(--accent); }`;
    document.head.appendChild(st);
  },

  _render() {
    this._injectCss();
    document.getElementById('asistenteVentaOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'asistenteVentaOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px; width:min(520px, 94vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;"><i data-lucide="banknote"></i> Registrar venta de equipos</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:14px 8px;">
          <p style="font-size:13px; color:var(--fg-2); margin:0 0 var(--sp-3);">
            Para equipos <strong>vendidos sin contrato de servicio</strong>: la factura ya se emitió en
            QuickBooks; aquí solo se descuentan de bodega. Solo se venden unidades
            <span class="eqpool-chip eqpool-chip-en_bodega">En bodega</span> — lo demás se avisa antes de confirmar.
          </p>
          <div class="form-field">
            <label class="form-label" for="asvSeriales">Seriales <span class="optional">(uno por línea — acepta lector de código de barras)</span></label>
            <textarea class="form-input" id="asvSeriales" rows="5" placeholder="B12345678&#10;B12345679&#10;…" style="font-family:var(--font-mono);"></textarea>
            <p id="asvContador" style="font-size:12px; color:var(--fg-2); margin:4px 0 0; display:none;"></p>
          </div>
          <div style="display:flex; gap:var(--sp-3);">
            <div class="form-field" style="flex:2;">
              <label class="form-label" for="asvCliente">Cliente (de la factura)</label>
              <input class="form-input" id="asvCliente" type="text" placeholder="Escribe para buscar el cliente…"
                     autocomplete="off">
              <div id="asvClienteSugs" style="position:relative;"></div>
              <span class="form-hint">Elígelo de la lista. Si no existe en la app, la venta se registra por excepción.</span>
            </div>
            <div class="form-field" style="flex:1.2;">
              <label class="form-label" for="asvFactura">Factura QBO <span class="optional">(recomendado)</span></label>
              <input class="form-input" id="asvFactura" type="text" placeholder="001-0000010274">
            </div>
          </div>
          <div class="form-field">
            <label class="form-label" for="asvNotas">Notas <span class="optional">(opcional)</span></label>
            <input class="form-input" id="asvNotas" type="text">
          </div>
        </div>
        <div class="footer" style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
          <button class="btn btn-primary" id="asvBtnGuardar"><i data-lucide="check"></i> Registrar venta</button>
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

    overlay.querySelector('#asvCliente').addEventListener('input', () => this.sugerirCliente());
    overlay.querySelector('#asvSeriales').addEventListener('input', () => this._actualizarContador());
    overlay.querySelector('#asvBtnGuardar').addEventListener('click', () => this.guardar());
    if (typeof lucide !== 'undefined') lucide.createIcons();
    overlay.querySelector('#asvSeriales').focus();
  },

  // Contador en vivo (auditoría): mismo motivo que en Recibir — al escanear
  // nadie mira la pantalla y el repetido solo aparecía al validar.
  _actualizarContador() {
    const el  = this._el?.querySelector('#asvContador');
    const txt = this._el?.querySelector('#asvSeriales');
    if (!el || !txt) return;
    const lineas = txt.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lineas.length) { el.style.display = 'none'; return; }
    const norm = lineas.map(s => s.toUpperCase());
    const repetidos = norm.length - new Set(norm).size;
    el.style.display = '';
    el.innerHTML = `<b>${lineas.length}</b> serial(es) en la tanda` +
      (repetidos ? ` · <b style="color:#B45309;">${repetidos} repetido(s)</b>` : '');
  },

  // Cierra el overlay — salvo mientras la venta corre (los confirm viven
  // encima; un Escape ahí no debe tumbar el formulario a medias).
  _cerrar() {
    if (this._busy) return;
    this._cerrarForzado();
  },

  _cerrarForzado() {
    if (!this._el) return;
    clearTimeout(this._cliTimer);
    this._el.remove();
    this._el = null;
    document.body.style.overflow = '';
    if (this._kb) { document.removeEventListener('keydown', this._kb); this._kb = null; }
  },
};

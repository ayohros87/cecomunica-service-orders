// @ts-nocheck
// Trabajar-Orden: modal de búsqueda/selección de pieza y catálogo
window.TOPieza = {

  _tDeb:       null,
  _tCatSearch: null,
  _catState: {
    abierto:         false,
    orden:           'marca',
    filtroMarca:     '',
    query:           '',
    pageSize:        50,
    lastDoc:         null,
    usandoFirestore: false,
    buffer:          []
  },

  abrirModal(eqId) {
    TO.equipoSeleccionado          = eqId;
    TO.piezaSeleccionada           = null;
    TO.byId('buscarPieza').value   = '';
    TO.byId('sugerencias').innerHTML = '';
    TO.byId('qty').value           = 1;
    TO.byId('tipo').value          = 'cobro';
    Modal.open('modalPieza');
    this.actualizarSubtotal();
  },

  cerrarModal() { Modal.close('modalPieza'); },

  pick(id) {
    TO.piezaSeleccionada = TO.inventario.find(p => p.id === id);
    const sug    = TO.byId('sugerencias');
    const nombre = TO.piezaSeleccionada?.descripcion || TO.piezaSeleccionada?.nombre
      || ((TO.piezaSeleccionada?.marca || '') + ' ' + (TO.piezaSeleccionada?.modelo || ''));
    const precio = TO.fmtMoney(Number(TO.piezaSeleccionada?.precio_venta || 0));
    sug.innerHTML = `<div class="muted">Seleccionado: <strong>${nombre || 'Pieza'}</strong> (${TO.piezaSeleccionada?.sku || '-'}) – ${precio}</div>`;
    this.actualizarSubtotal();
  },

  filtrarPiezas(v) {
    const q   = (v || '').trim().toLowerCase();
    const sug = TO.byId('sugerencias');
    if (!q) { sug.innerHTML = ''; return; }

    const list = PiezaSearch.search(TO.inventario, q);
    sug.innerHTML = list.map(p => {
      const nombre     = p.descripcion || p.nombre || ((p.marca || '') + ' ' + (p.modelo || ''));
      const price      = TO.fmtMoney(Number(p.precio_venta || 0));
      const stock      = Number(p.cantidad || 0);
      const sinControl = p.sin_control_inventario === true;
      const disabled   = (!sinControl && stock <= 0) ? 'disabled' : '';
      return `<button class="chip" ${disabled} title="${nombre || ''}\nStock: ${stock}"
        onclick='TOPieza.pick("${p.id}")'>
        ${nombre || 'Pieza'} · <span class="mono">${p.sku || '-'}</span> · ${price}
      </button>`;
    }).join('');
  },

  actualizarSubtotal() {
    const qty    = Math.max(1, parseInt(TO.byId('qty').value || '1', 10));
    const tipo   = TO.byId('tipo').value || 'cobro';
    const precio = Number(TO.piezaSeleccionada?.precio_venta || 0);
    const sub    = (tipo === 'cobro') ? (qty * precio) : 0;
    let info     = `Cantidad: ${qty}`;
    if (TO.piezaSeleccionada) info += ` · Precio: ${TO.fmtMoney(precio)} · Subtotal: <strong>${TO.fmtMoney(sub)}</strong>`;

    let ayuda = TO.byId('ayudaPieza');
    if (!ayuda) {
      ayuda = document.createElement('div'); ayuda.id = 'ayudaPieza'; ayuda.className = 'ayuda';
      TO.byId('modalPieza').querySelector('.modal').appendChild(ayuda);
    }
    ayuda.innerHTML = info;
  },

  async confirmarAgregar() {
    try {
      if (!TO.piezaSeleccionada) { Toast.show('Selecciona una pieza'); return; }
      if (!TO.ordenId)           { Toast.show('Orden no encontrada');   return; }

      const qty      = Math.max(1, parseInt(TO.byId('qty').value || '1', 10));
      const tipo     = TO.byId('tipo').value || 'cobro';
      const precio   = Number(TO.piezaSeleccionada?.precio_venta || 0);
      const subtotal = +((tipo === 'cobro' ? qty * precio : 0)).toFixed(2);

      const piezaDB  = await PiezasService.getPieza(TO.piezaSeleccionada.id);
      if (!piezaDB) { Toast.show('La pieza ya no existe'); return; }
      const sinControl = piezaDB.sin_control_inventario === true;

      await OrdenesService.addConsumo(TO.ordenId, {
        equipoId:     TO.equipoSeleccionado || null,
        pieza_id:     TO.piezaSeleccionada.id,
        pieza_nombre: TO.piezaSeleccionada.descripcion || TO.piezaSeleccionada.nombre
          || ((TO.piezaSeleccionada.marca || '') + ' ' + (TO.piezaSeleccionada.modelo || '')),
        sku:          TO.piezaSeleccionada.sku || '',
        qty, precio_unit: precio, tipo, subtotal,
        added_by_uid:   (firebase.auth().currentUser || {}).uid   || null,
        added_by_email: (firebase.auth().currentUser || {}).email || null,
        added_at:       firebase.firestore.FieldValue.serverTimestamp()
      });

      if (!sinControl) {
        await PiezasService.ajustarDelta(TO.piezaSeleccionada.id, -qty);
      }

      const sug = TO.byId('sugerencias'); if (sug) sug.innerHTML = '';
      const bus = TO.byId('buscarPieza'); if (bus) bus.value = '';
      this.cerrarModal();
    } catch (err) {
      console.error(err);
      Toast.show('Error al agregar pieza');
    }
  },

  // ==== Catálogo ====

  _uniq(arr) { return Array.from(new Set(arr)); },

  _getMarcas(list) {
    return this._uniq(list.map(p => String(p.marca || '').trim()).filter(Boolean))
      .sort((a, b) => a.localeCompare(b));
  },

  _catalogoMatch(p, q) {
    if (!q) return true;
    const s    = q.toLowerCase().trim();
    const sku  = String(p?.sku || '').toLowerCase();
    const desc = String(p?.descripcion || p?.nombre || '').toLowerCase();
    const marc = String(p?.marca || '').toLowerCase();
    const eqs  = Array.isArray(p?.equipos_asociados)
      ? p.equipos_asociados.join(' ').toLowerCase()
      : String(p?.equipos_asociados || '').toLowerCase();
    return sku.includes(s) || desc.includes(s) || marc.includes(s) || eqs.includes(s);
  },

  _aplicarOrden(list, key) {
    return [...list].sort((a, b) => {
      if (key === 'precio_venta') return Number(a.precio_venta || 0) - Number(b.precio_venta || 0);
      return String(a[key] || '').localeCompare(String(b[key] || ''));
    });
  },

  _fuenteLocal() {
    const src   = (TO.inventario || []).filter(p => p?.activo !== false);
    const marca = this._catState.filtroMarca || '';
    let base    = marca ? src.filter(p => String(p.marca || '') === marca) : src;
    const q     = (this._catState.query || '').trim();
    if (q) base = base.filter(p => this._catalogoMatch(p, q));
    return this._aplicarOrden(base, this._catState.orden || 'marca');
  },

  abrirCatalogo() {
    const wrap       = TO.byId('catalogoWrap');
    const selMarca   = TO.byId('catFiltroMarca');
    const selOrden   = TO.byId('catOrden');
    const btnRefresh = TO.byId('btnCatRefrescar');

    this._catState.abierto = !this._catState.abierto;
    if (!this._catState.abierto) {
      wrap.style.display       = 'none';
      selMarca.style.display   = 'none';
      selOrden.style.display   = 'none';
      btnRefresh.style.display = 'none';
      return;
    }

    this._catState.usandoFirestore = false;
    this._catState.lastDoc         = null;
    this._catState.buffer          = [];

    selOrden.style.display               = 'inline-block';
    selMarca.style.display               = 'inline-block';
    btnRefresh.style.display             = 'inline-block';
    TO.byId('catBuscar').style.display   = 'inline-block';
    TO.byId('catContador').style.display = 'inline-block';

    const marcas = this._getMarcas(TO.inventario || []);
    selMarca.innerHTML = `<option value="">— Todas las marcas —</option>` +
      marcas.map(m => `<option value="${m}">${m}</option>`).join('');

    wrap.style.display = 'block';
    this.renderCatalogo(true);
  },

  renderCatalogo(reset = false) {
    const cont = TO.byId('catTabla');
    if (reset) this._catState.buffer = [];

    let fuente, total;
    if (this._catState.usandoFirestore) {
      fuente = this._catState.buffer;
      total  = fuente.length;
    } else {
      fuente = this._fuenteLocal();
      this._catState.buffer = fuente;
      total  = fuente.length;
    }

    const rows = (fuente || []).map(p => {
      const nombre     = p.descripcion || p.nombre || ((p.marca || '') + ' ' + (p.modelo || ''));
      const price      = TO.fmtMoney(Number(p.precio_venta || 0));
      const stock      = Number(p.cantidad || 0);
      const sinControl = p.sin_control_inventario === true;
      const disabled   = (!sinControl && stock <= 0) ? 'disabled' : '';
      return `<tr>
        <td>${nombre || 'Pieza'}</td>
        <td class="mono">${p.sku || ''}</td>
        <td>${p.marca || ''}</td>
        <td class="right">${price}</td>
        <td class="right">${stock}</td>
        <td class="right"><button class="btn sm" ${disabled} onclick="TOPieza.pick('${p.id}')">Agregar</button></td>
      </tr>`;
    }).join('');

    cont.innerHTML = `<table>
      <thead><tr>
        <th>Descripción</th><th>SKU</th><th>Marca</th><th>Precio</th><th>Stock</th><th>Acción</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6"><em>Sin resultados</em></td></tr>'}</tbody>
    </table>`;

    const lbl    = TO.byId('catContador');
    const marca  = this._catState.filtroMarca;
    const q      = this._catState.query;
    const suffix = (marca ? ` | Marca: ${marca}` : '') + (q ? ` | Filtro: "${q}"` : '');
    lbl.textContent = this._catState.usandoFirestore
      ? `Cargadas: ${total}${suffix}`
      : `Resultados: ${total}${suffix}`;
  },

  async _cargarMasCatalogo(reset) {
    const { docs, lastDoc } = await PiezasService.listCatalogPage({
      marca:    this._catState.filtroMarca || '',
      lastDoc:  this._catState.lastDoc,
      pageSize: this._catState.pageSize,
    });
    docs.forEach(p => TO.inventarioById.set(p.id, p));
    if (lastDoc) this._catState.lastDoc = lastDoc;
    if (reset) this._catState.buffer = docs;
    else       this._catState.buffer = this._catState.buffer.concat(docs);
    this.renderCatalogo(false);
  },

  init() {
    const self = this;

    TO.byId('buscarPieza').addEventListener('input', e => {
      clearTimeout(self._tDeb);
      self._tDeb = setTimeout(() => self.filtrarPiezas(e.target.value), 120);
    });
    TO.byId('buscarPieza').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const sug = document.querySelector('#sugerencias .chip');
        if (sug) { sug.click(); e.preventDefault(); }
      }
    });

    TO.byId('qty').addEventListener('input',   () => self.actualizarSubtotal());
    TO.byId('tipo').addEventListener('change', () => self.actualizarSubtotal());

    TO.byId('btnVerCatalogo').addEventListener('click', () => self.abrirCatalogo());
    TO.byId('catOrden').addEventListener('change', e => {
      self._catState.orden = e.target.value || 'marca';
      if (!self._catState.usandoFirestore) self.renderCatalogo(true);
    });
    TO.byId('catFiltroMarca').addEventListener('change', e => {
      self._catState.filtroMarca = e.target.value || '';
      if (!self._catState.usandoFirestore) self.renderCatalogo(true);
    });
    TO.byId('btnCatRefrescar').addEventListener('click', async () => {
      self._catState.usandoFirestore = true;
      self._catState.lastDoc         = null;
      self._catState.buffer          = [];
      await self._cargarMasCatalogo(true);
    });
    TO.byId('btnCatMas').addEventListener('click', async () => {
      if (!self._catState.usandoFirestore) return;
      await self._cargarMasCatalogo(false);
    });
    TO.byId('catBuscar').addEventListener('input', e => {
      clearTimeout(self._tCatSearch);
      self._tCatSearch = setTimeout(() => {
        self._catState.query = e.target.value || '';
        self.renderCatalogo(!self._catState.usandoFirestore);
      }, 150);
    });
  }
};

TOPieza.init();

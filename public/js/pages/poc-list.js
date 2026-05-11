// @ts-nocheck
// POC list — load, filter, sort, row builder, export, duplicates
window.PocList = {
  _lastDoc:      null,
  _primeraCarga: true,
  _noMasDatos:   false,
  _campoOrden:   'created_at',
  _direccionAsc: false,
  _filtroID:     0,

  // Reload using current filter state
  refresh() {
    const v = document.getElementById('filtroValor')?.value.trim();
    if (v) this.filtrar(); else this.cargar(true);
  },

  // ── Cell builders ───────────────────────────────────────────────
  nuevaCelda(texto) {
    const td = document.createElement('td');
    td.textContent = texto || '';
    return td;
  },

  crearCeldaIp(ip) {
    const td  = document.createElement('td');
    const val = String(ip || '').trim();
    if (!val) return td;
    const dominio = '.cecomunica.net';
    if (val.toLowerCase().endsWith(dominio)) {
      const host = val.slice(0, val.length - dominio.length);
      const hostSpan = document.createElement('span');
      hostSpan.className = 'ip-host';
      hostSpan.textContent = host;
      const fullSpan = document.createElement('span');
      fullSpan.className = 'ip-domain';
      fullSpan.textContent = val;
      td.appendChild(hostSpan);
      td.appendChild(fullSpan);
    } else {
      td.textContent = val;
    }
    return td;
  },

  crearCeldaConExpansor(texto, campo = '') {
    const limitado = texto.length > 20 ? texto.slice(0, 20) + '...' : texto;
    const td = document.createElement('td');
    td.className = 'truncate-cell';
    td.textContent = limitado;
    if (texto.length > 20 && (campo === 'grupos' || campo === 'notas')) {
      const btn = document.createElement('span');
      btn.textContent = '🔍';
      btn.className = 'expand-btn';
      btn.title = texto;
      td.appendChild(btn);
    }
    return td;
  },

  // Shared row builder for Firestore doc results
  _buildRow(docId, d) {
    const COL           = PocState.COL;
    const nombreCliente = PocState.nombreClienteDe(d);
    const camposCrit    = [nombreCliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone];
    const algunoVacio   = camposCrit.some(v => !v || v.trim?.() === '');

    const row = document.createElement('tr');
    row.dataset.id = docId;

    // checkbox (0)
    const tdCh = document.createElement('td');
    const cb   = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'seleccion-sim';
    tdCh.appendChild(cb);
    row.appendChild(tdCh);

    // cliente (1)
    const tdCliente = document.createElement('td');
    tdCliente.innerHTML = algunoVacio
      ? `<span style="color:red;" title="Falta completar campos obligatorios">❗</span> ${nombreCliente}`
      : nombreCliente;
    row.appendChild(tdCliente);

    // activo (2)
    const tdEstado = this.nuevaCelda(d.activo ? '🟢' : '🔴');
    tdEstado.className = d.activo ? 'estado-activo' : 'estado-inactivo';
    row.appendChild(tdEstado);

    // serial (3), ip (4), unit_id (5), radio_name (6)
    row.appendChild(this.nuevaCelda(d.serial));
    row.appendChild(this.crearCeldaIp(d.ip));
    row.appendChild(this.nuevaCelda(d.unit_id));
    row.appendChild(this.nuevaCelda(d.radio_name));

    // grupos (7)
    row.appendChild(this.crearCeldaConExpansor((d.grupos || []).join(', '), 'grupos'));

    // sim_tel (8)
    row.appendChild(this.nuevaCelda(`📱 ${d.sim_number || ''} / ${d.sim_phone || ''}`));

    // acciones (9)
    const actionCell = document.createElement('td');
    if (!PocState.esLectura()) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.textContent = '✏️';
      editBtn.onclick = () => PocEdit.abrir(row, docId, d);
      actionCell.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Eliminar equipo';
      delBtn.onclick = () => {
        if (confirm('¿Seguro que quieres eliminar este equipo?'))
          PocService.softDeletePocDevice(docId).then(() => this.refresh());
      };
      actionCell.appendChild(delBtn);

      if (d.deleted) {
        const restBtn = document.createElement('button');
        restBtn.className = 'btn';
        restBtn.textContent = '♻️';
        restBtn.title = 'Restaurar';
        restBtn.onclick = () => PocService.restorePocDevice(docId).then(() => this.refresh());
        actionCell.appendChild(restBtn);
      }
    }
    row.appendChild(actionCell);
    return row;
  },

  // ── Main loader (paginated) ──────────────────────────────────────
  cargar(reset = false) {
    const tbody      = document.getElementById('devicesTable');
    const btnCargar  = document.getElementById('btnCargarMas');

    if (reset || this._primeraCarga) {
      tbody.innerHTML = '';
      this._lastDoc      = null;
      this._primeraCarga = false;
      this._noMasDatos   = false;
      if (btnCargar) btnCargar.style.display = 'block';
    }
    if (this._noMasDatos) return;

    const campoOrden    = this._campoOrden || 'cliente';
    const direccionOrden = this._direccionAsc ? 'asc' : 'desc';

    PocService.listPage({
      sortField: campoOrden, sortAsc: this._direccionAsc,
      cursorDoc: this._lastDoc || null, limit: 50,
    }).then(({ docs, lastDoc }) => {
      if (!docs.length) {
        this._noMasDatos = true;
        if (btnCargar) btnCargar.style.display = 'none';
        return;
      }
      this._lastDoc = lastDoc;
      const soloIncompletos = document.getElementById('soloIncompletos')?.checked;

      docs.forEach(d => {
        if (soloIncompletos) {
          const crit = [PocState.nombreClienteDe(d), d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone];
          if (!crit.some(v => !v || v.trim?.() === '')) return;
        }
        tbody.appendChild(this._buildRow(d.id, d));
      });

      const total = tbody.rows.length;
      const COL = PocState.COL;
      let activos = 0, incompletos = 0;
      [...tbody.rows].forEach(r => {
        if (r.cells[COL.activo]?.textContent?.includes('🟢')) activos++;
        if (r.cells[COL.cliente]?.innerHTML?.includes('❗'))   incompletos++;
      });
      PocState.actualizarResumen({ total, activos, incompletos });
      this.actualizarFlechitas();
    });
  },

  // ── Filtered search ──────────────────────────────────────────────
  filtrar() {
    const ejecucionID   = ++this._filtroID;
    const campo         = document.getElementById('filtroCampo').value;
    const valor         = document.getElementById('filtroValor').value.trim().toLowerCase();
    const tbody         = document.getElementById('devicesTable');
    const btnCargar     = document.getElementById('btnCargarMas');

    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    if (btnCargar) btnCargar.style.display = 'none';

    const idsVistos = new Set();
    const soloActivos     = document.getElementById('soloActivos')?.checked;
    const soloIncompletos = document.getElementById('soloIncompletos')?.checked;

    PocService.getAll({ sortField: 'created_at', sortAsc: false }).then(docs => {
        if (ejecucionID !== this._filtroID) return;
        let total = 0, activos = 0, incompletos = 0;

        docs.forEach(d => {
          if (idsVistos.has(d.id)) return;
          idsVistos.add(d.id);

          const nombreCliente = PocState.nombreClienteDe(d);
          const camposCrit    = [nombreCliente, d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone];
          const algunoVacio   = camposCrit.some(v => !v || v.trim?.() === '');

          if (soloIncompletos) {
            if (!algunoVacio) return;
            incompletos++;
          }

          if (campo !== 'cliente' && (d[campo] == null || (typeof d[campo] === 'string' && d[campo].trim() === ''))) return;

          let contenido;
          if (campo === 'cliente')          contenido = nombreCliente.toLowerCase();
          else if (Array.isArray(d[campo])) contenido = d[campo].join(' ').toLowerCase();
          else                              contenido = String(d[campo] ?? '').toLowerCase();

          if (!soloActivos || d.activo === true) {
            if (contenido.includes(valor)) {
              total++;
              if (d.activo) activos++;
              tbody.appendChild(this._buildRow(d.id, d));
            }
          }
        });
        PocState.actualizarResumen({ total, activos, incompletos });
      });
  },

  limpiarFiltro() {
    document.getElementById('filtroValor').value = '';
    document.getElementById('filtroCampo').value = 'cliente';
    document.getElementById('resumenEquipos').innerHTML =
      '<div class="loader" style="width:24px;height:24px;border-width:3px;"></div>';
    this.cargar(true);
  },

  ordenarPor(campo) {
    if (this._campoOrden === campo) this._direccionAsc = !this._direccionAsc;
    else { this._campoOrden = campo; this._direccionAsc = true; }
    this._primeraCarga = true;
    this.refresh();
  },

  actualizarFlechitas() {
    const encabezado = document.getElementById('encabezadoTabla');
    if (!encabezado) return;
    [...encabezado.children].forEach(th => {
      const campo = th.getAttribute('onclick')?.match(/'(.+)'/)?.[1];
      if (!campo) { th.className = ''; return; }
      th.className = campo === this._campoOrden
        ? (this._direccionAsc ? 'ordenado-asc' : 'ordenado-desc')
        : 'sortable';
    });
  },

  manejarCambioActivos() {
    const valorFiltro = document.getElementById('filtroValor').value.trim();
    if (valorFiltro) this.filtrar(); else this.cargar(true);
  },

  manejarCambioIncompletos() {
    const valorFiltro = document.getElementById('filtroValor').value.trim();
    if (valorFiltro) this.filtrar(); else this.cargar(true);
  },

  // ── Show-all (no pagination) ─────────────────────────────────────
  mostrarTodo() {
    const tbody = document.getElementById('devicesTable');
    tbody.innerHTML = '';
    this._lastDoc      = null;
    this._primeraCarga = true;
    this._noMasDatos   = false;
    const btnCargar = document.getElementById('btnCargarMas');
    if (btnCargar) btnCargar.style.display = 'none';

    const soloActivos     = document.getElementById('soloActivos')?.checked;
    const soloIncompletos = document.getElementById('soloIncompletos')?.checked;

    PocService.getAll({
      sortField: this._campoOrden, sortAsc: this._direccionAsc,
      onlyActivos: soloActivos,
    }).then(docs => {
      docs.forEach(d => {
        if (soloIncompletos) {
          const crit = [PocState.nombreClienteDe(d), d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone];
          if (!crit.some(v => !v || v.trim?.() === '')) return;
        }
        const row = this._buildRow(d.id, d);
        if (!PocState.esLectura()) {
          const ac = row.querySelector('td:last-child');
          if (ac && !ac.querySelector('button[title="Restaurar"]')) {
            const restBtn = document.createElement('button');
            restBtn.className = 'btn';
            restBtn.textContent = '♻️';
            restBtn.title = 'Restaurar';
            restBtn.onclick = () => PocService.restorePocDevice(d.id).then(() => this.mostrarTodo());
            ac.appendChild(restBtn);
          }
        }
        tbody.appendChild(row);
      });

      const total = tbody.rows.length;
      let activos = 0;
      [...tbody.rows].forEach(r => {
        if (r.cells[PocState.COL.activo]?.textContent?.includes('🟢')) activos++;
      });
      document.getElementById('resumenEquipos').textContent =
        total > 0 ? `Mostrando: ${total} equipos (${activos} activos)` : 'No se encontraron resultados.';
    });
  },

  // ── Results from pre-loaded array (duplicates / invalid groups) ──
  mostrarResultadosFiltrados(lista) {
    const tbody = document.getElementById('devicesTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    let activos = 0;

    lista.forEach(d => {
      const row = document.createElement('tr');
      if (d.id) row.dataset.id = d.id;

      const tdCh = document.createElement('td');
      const cb   = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'seleccion-sim';
      tdCh.appendChild(cb);
      row.appendChild(tdCh);

      const camposCrit = [d.cliente, d.unit_id, d.operador, d.ip, d.sim || d.sim_number, d.sim_phone];
      const algunoVacio = camposCrit.some(v => !v || v.trim?.() === '');
      const tdCliente = document.createElement('td');
      tdCliente.innerHTML = algunoVacio
        ? `<span style="color:red;" title="Falta completar campos obligatorios">❗</span> ${d.cliente || ''}`
        : (d.cliente || '');
      row.appendChild(tdCliente);

      const tdEstado = this.nuevaCelda(d.activo ? '🟢' : '🔴');
      tdEstado.className = d.activo ? 'estado-activo' : 'estado-inactivo';
      row.appendChild(tdEstado);
      if (d.activo) activos++;

      row.appendChild(this.nuevaCelda(d.serial));
      row.appendChild(this.crearCeldaIp(d.ip));
      row.appendChild(this.nuevaCelda(d.unit_id));
      row.appendChild(this.nuevaCelda(d.radio_name));
      row.appendChild(this.crearCeldaConExpansor(
        Array.isArray(d.grupos) ? d.grupos.join(', ') : (d.grupos || ''), 'grupos'
      ));
      row.appendChild(this.nuevaCelda(`📱 ${(d.sim || d.sim_number) || ''} / ${d.sim_phone || ''}`));

      const acciones = document.createElement('td');
      if (!PocState.esLectura()) {
        const btnEditar = document.createElement('button');
        btnEditar.className = 'btn'; btnEditar.textContent = '✏️';
        btnEditar.onclick = () => PocEdit.abrir(row, d.id, d);
        acciones.appendChild(btnEditar);

        const btnElim = document.createElement('button');
        btnElim.className = 'btn danger'; btnElim.textContent = '🗑️'; btnElim.title = 'Eliminar';
        btnElim.onclick = () => {
          if (confirm('¿Seguro que quieres eliminar este equipo?'))
            PocService.softDeletePocDevice(d.id).then(() => this.cargar(true));
        };
        acciones.appendChild(btnElim);

        if (d.deleted) {
          const btnRest = document.createElement('button');
          btnRest.className = 'btn'; btnRest.textContent = '♻️';
          btnRest.onclick = () => PocService.restorePocDevice(d.id).then(() => this.cargar(true));
          acciones.appendChild(btnRest);
        }
      }
      row.appendChild(acciones);
      tbody.appendChild(row);
    });

    document.getElementById('resumenEquipos').textContent =
      lista.length > 0 ? `Mostrando: ${lista.length} equipos (${activos} activos)` : 'No se encontraron resultados.';
  },

  async filtrarDuplicados(tipo) {
    const devices   = await PocService.getPocDevices();
    const soloActivos = document.getElementById('soloActivos')?.checked;
    const equipos   = [];

    devices.forEach(d => {
      if (d.deleted === true) return;
      if (soloActivos && !d.activo) return;
      equipos.push({
        id: d.id, serial: d.serial ? String(d.serial) : '',
        sim: d.sim_number ? String(d.sim_number) : '',
        cliente: PocState.nombreClienteDe(d) || '', cliente_id: d.cliente_id || '',
        unit_id: d.unit_id || '', operador: d.operador || '', ip: d.ip || '',
        sim_phone: d.sim_phone || '', gps: d.gps || false, activo: d.activo,
        radio_name: d.radio_name || '', grupos: d.grupos || [], notas: d.notas || '',
        created_at: d.created_at, updated_at: d.updated_at
      });
    });

    const campoClave = tipo === 'serial' ? 'serial' : 'sim';
    const duplicados = equipos
      .filter(e => {
        const val = e[campoClave]?.toString().toLowerCase().trim() || '';
        if (!val) return false;
        if (campoClave === 'serial' && ['n/d','nd','consola'].includes(val)) return false;
        return true;
      })
      .reduce((acc, curr) => {
        const clave = curr[campoClave].toLowerCase().trim();
        acc[clave] = acc[clave] || [];
        acc[clave].push(curr);
        return acc;
      }, {});

    const repetidos = Object.values(duplicados).filter(arr => arr.length > 1).flat();
    const unicos    = repetidos.filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);
    this.mostrarResultadosFiltrados(unicos);
  },

  async buscarGruposInvalidos() {
    const resumenEl = document.getElementById('resumenEquipos');
    if (resumenEl) resumenEl.innerHTML = '<div class="loader" style="width:20px;height:20px;border-width:2px;"></div>';

    const devices  = await PocService.getPocDevices();
    const invalidos = [];

    devices.forEach(d => {
      if (d.deleted === true) return;
      const grupos = d.grupos || [];
      if (!grupos.some(g => { const v = (g || '').toString(); return v.includes('...') || v.includes('🔍'); })) return;
      invalidos.push({
        id: d.id, serial: d.serial ? String(d.serial) : '',
        sim: d.sim_number ? String(d.sim_number) : '',
        cliente: PocState.nombreClienteDe(d) || '', cliente_id: d.cliente_id || '',
        unit_id: d.unit_id || '', operador: d.operador || '', ip: d.ip || '',
        sim_phone: d.sim_phone || '', gps: d.gps || false, activo: d.activo,
        radio_name: d.radio_name || '', grupos, notas: d.notas || '',
        created_at: d.created_at, updated_at: d.updated_at
      });
    });
    this.mostrarResultadosFiltrados(invalidos);
  },

  irAImpresion() {
    const seleccionados = this.obtenerSeleccionados();
    if (seleccionados.length === 0) { alert('Selecciona al menos un equipo para imprimir.'); return; }
    const ids   = seleccionados.map(s => s.id);
    const query = `?ids=${encodeURIComponent(JSON.stringify(ids))}`;
    window.open(`imprimir-equipos.html${query}`, '_blank');
  },

  obtenerSeleccionados() {
    return [...document.querySelectorAll('#devicesTable tr')]
      .filter(fila => fila.querySelector('.seleccion-sim')?.checked)
      .map(fila => ({ id: fila.dataset.id, fila }));
  },

  toggleSeleccionMasiva(master) {
    document.querySelectorAll('.seleccion-sim').forEach(cb => { cb.checked = master.checked; });
  },

  async exportarExcelSeleccionados() {
    try {
      const seleccionados = this.obtenerSeleccionados();
      if (!seleccionados.length) { alert('Selecciona al menos un equipo para exportar.'); return; }
      const ids = seleccionados.map(s => s.id).filter(Boolean);
      if (ids.length > 2000) {
        alert(`Has seleccionado ${ids.length} equipos. Reduce la selección (máx. 2000) o exporta por partes.`);
        return;
      }
      const docs = await Promise.all(ids.map(id => PocService.getPocDevice(id)));
      const f = ts => {
        try {
          const d = ts?.toDate?.(); if (!d) return '';
          const pad = n => String(n).padStart(2,'0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ''; }
      };
      const headers = [
        ['device_id','ID'],['cliente_name','Cliente'],['cliente_id','Cliente ID'],
        ['operador','Operador'],['serial','Serial'],['unit_id','Unit ID'],
        ['sim_number','SIM'],['sim_phone','Teléfono'],['ip','IP'],
        ['gps','GPS'],['activo','Activo'],['radio_name','Nombre del Radio'],
        ['grupos','Grupos'],['notas','Notas'],
        ['created_at_fmt','Creado'],['updated_at_fmt','Modificado'],['updated_by_email','Actualizado por']
      ];
      const registros = [];
      docs.forEach(d => {
        if (!d) return;
        const gruposTxt = Array.isArray(d.grupos) ? d.grupos.join(', ') : (d.grupos || '');
        registros.push({
          device_id: d.id, cliente_name: PocState.nombreClienteDe(d) || d.cliente || '',
          cliente_id: d.cliente_id || '', operador: d.operador || '',
          serial: d.serial || '', unit_id: d.unit_id || '',
          sim_number: d.sim_number || '', sim_phone: d.sim_phone || '', ip: d.ip || '',
          gps: d.gps === true ? 'Sí' : 'No', activo: d.activo === false ? 'No' : 'Sí',
          radio_name: d.radio_name || '', grupos: gruposTxt, notas: d.notas || '',
          created_at_fmt: f(d.created_at), updated_at_fmt: f(d.updated_at),
          updated_by_email: d.updated_by_email || ''
        });
      });
      if (!registros.length) { alert('No se encontraron datos para exportar.'); return; }

      const hoja = XLSX.utils.json_to_sheet(registros, { header: headers.map(h => h[0]) });
      headers.forEach(([key, titulo], idx) => {
        hoja[XLSX.utils.encode_cell({ r:0, c:idx })] = { t:'s', v:titulo };
      });
      hoja['!cols'] = headers.map(() => ({ wch:20 }));
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'Equipos');
      const n = new Date();
      const pad = x => String(x).padStart(2,'0');
      const stamp = `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}_${pad(n.getHours())}${pad(n.getMinutes())}`;
      XLSX.writeFile(libro, `POC_equipos_seleccion_${stamp}.xlsx`);
    } catch (err) {
      console.error('Error exportando Excel:', err);
      alert('Ocurrió un error al exportar. Revisa la consola.');
    }
  },

  // ── Event wiring ─────────────────────────────────────────────────
  init() {
    const self = this;
    const btnCargarMas = document.getElementById('btnCargarMas');
    if (btnCargarMas) btnCargarMas.addEventListener('click', () => self.cargar());
  }
};

PocList.init();

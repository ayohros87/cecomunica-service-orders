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
  nuevaCelda(texto, className = '') {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = texto || '';
    return td;
  },

  crearCeldaIp(ip) {
    const td  = document.createElement('td');
    td.className = 'td-mono';
    const val = String(ip || '').trim();
    td.dataset.ip = val;
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
      btn.innerHTML = '<i data-lucide="search"></i>';
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
      ? `<span style="color:var(--status-critical);" data-incomplete="true" title="Falta completar campos obligatorios"><i data-lucide="alert-circle"></i></span> <strong>${FMT.esc(nombreCliente)}</strong>`
      : `<strong>${FMT.esc(nombreCliente)}</strong>`;
    row.appendChild(tdCliente);

    // operador (2) — stamp raw value on the cell so bulk edit can pre-select.
    // Empty operadores get a critical marker so they're easy to spot/complete.
    const tdOperador = document.createElement('td');
    tdOperador.dataset.operador = d.operador || '';
    if (d.operador && d.operador.trim()) {
      tdOperador.textContent = d.operador;
    } else {
      tdOperador.innerHTML = '<span style="color:var(--status-critical);" title="Operador faltante"><i data-lucide="alert-circle"></i></span>';
    }
    row.appendChild(tdOperador);

    // activo (3)
    const tdEstado = document.createElement('td');
    tdEstado.dataset.activo = d.activo ? 'true' : 'false';
    tdEstado.className = 'poc-estado-cell';
    tdEstado.innerHTML = d.activo
      ? '<span class="status-dot status-activo"></span>'
      : '<span class="status-dot status-inactivo"></span>';
    row.appendChild(tdEstado);

    // serial (4), ip (5), unit_id (6), radio_name (7)
    row.appendChild(this.nuevaCelda(d.serial, 'td-mono'));
    row.appendChild(this.crearCeldaIp(d.ip));
    row.appendChild(this.nuevaCelda(d.unit_id, 'td-mono td-primary'));
    row.appendChild(this.nuevaCelda(d.radio_name));

    // modelo (8) — stamp the resolved FK so bulk edit / drawer can pre-select
    const tdModelo = this.nuevaCelda(PocState.obtenerModeloTexto(d));
    tdModelo.dataset.modeloId = PocState.obtenerModeloId(d) || '';
    row.appendChild(tdModelo);

    // grupos (9)
    row.appendChild(this.crearCeldaConExpansor((d.grupos || []).join(', '), 'grupos'));

    // sim_tel (10)
    const tdSim = document.createElement('td');
    tdSim.innerHTML = `<i data-lucide="smartphone"></i> ${FMT.esc(d.sim_number)} / ${FMT.esc(d.sim_phone)}`;
    row.appendChild(tdSim);

    // acciones (11)
    const actionCell = document.createElement('td');
    actionCell.style.whiteSpace = 'nowrap';
    if (!PocState.esLectura()) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-ghost btn-icon btn-sm';
      editBtn.title = 'Editar equipo';
      editBtn.setAttribute('aria-label', 'Editar equipo');
      editBtn.innerHTML = '<i data-lucide="pencil"></i>';
      editBtn.onclick = () => PocEdit.abrir(row, docId, d);
      actionCell.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-icon btn-sm';
      delBtn.title = 'Eliminar equipo';
      delBtn.setAttribute('aria-label', 'Eliminar equipo');
      delBtn.innerHTML = '<i data-lucide="trash-2"></i>';
      delBtn.onclick = async () => {
        if (await Modal.confirm({ message: '¿Seguro que quieres eliminar este equipo?', danger: true })) {
          await PocService.softDeletePocDevice(docId);
          // Equipo eliminado con SIM → ofrecer devolver el SIM al pool.
          await SimLiberar.procesarDesactivados([{ id: docId, antes: d, despues: { ...d, deleted: true } }]);
          this.refresh();
        }
      };
      actionCell.appendChild(delBtn);

      if (d.deleted) {
        const restBtn = document.createElement('button');
        restBtn.className = 'btn btn-ghost btn-icon btn-sm';
        restBtn.title = 'Restaurar';
        restBtn.setAttribute('aria-label', 'Restaurar equipo');
        restBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
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

    // On a reset/first load we want a fresh list, but DON'T wipe the tbody
    // here — that would drop the skeleton (or current rows) and leave the
    // table blank for the whole network round-trip. We clear it inside the
    // .then below, right before appending, so the swap is a single paint.
    const esReset = reset || this._primeraCarga;
    if (esReset) {
      this._lastDoc      = null;
      this._primeraCarga = false;
      this._noMasDatos   = false;
      if (btnCargar) btnCargar.style.display = 'block';
    }
    if (this._noMasDatos) return;

    const campoOrden    = this._campoOrden || 'cliente';
    const direccionOrden = this._direccionAsc ? 'asc' : 'desc';

    // Watchdog for the "página pensando" report (F1). Firestore connectivity
    // intermittency can leave listPage pending forever, leaving the skeleton
    // spinning. On a reset/first load, if nothing lands within the window we
    // show a friendly error + "Reintentar" instead of an endless skeleton.
    let _resuelto = false;
    let _watchdog = null;
    if (esReset) {
      _watchdog = setTimeout(() => {
        if (_resuelto) return;
        this._mostrarErrorCarga(tbody, btnCargar,
          'La carga está tardando más de lo normal',
          'Puede ser una intermitencia de conexión. Vuelve a intentar.');
      }, 15000);
    }

    PocService.listPage({
      sortField: campoOrden, sortAsc: this._direccionAsc,
      cursorDoc: this._lastDoc || null, limit: 50,
    }).then(({ docs, lastDoc }) => {
      _resuelto = true;
      if (_watchdog) clearTimeout(_watchdog);
      // Clear the skeleton/old rows now that the data is in (reset only;
      // pagination appends below the existing rows). This also clears any
      // timeout-error row painted by the watchdog if data lands late.
      if (esReset) tbody.innerHTML = '';
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
        if (r.cells[COL.activo]?.dataset.activo === 'true') activos++;
        if (r.cells[COL.cliente]?.querySelector('[data-incomplete]')) incompletos++;
      });
      PocState.actualizarResumen({ total, activos, incompletos });
      this.actualizarFlechitas();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }).catch(err => {
      _resuelto = true;
      if (_watchdog) clearTimeout(_watchdog);
      console.error('❌ Error al cargar la base POC:', err);
      // Only take over the table on a reset load — a failed "Cargar más"
      // shouldn't wipe the rows already on screen.
      if (esReset) {
        this._mostrarErrorCarga(tbody, btnCargar,
          'Error al cargar la base POC',
          'Revisa tu conexión e intenta de nuevo.');
      }
    });
  },

  // Friendly error/timeout state for the device table (F1). Spans all 12
  // columns and offers a retry that re-runs a clean reset load.
  _mostrarErrorCarga(tbody, btnCargar, titulo, sub) {
    if (!tbody) return;
    if (btnCargar) btnCargar.style.display = 'none';
    tbody.innerHTML = `
      <tr><td colspan="12" style="padding:32px 16px;text-align:center;color:var(--muted,#64748b);">
        <div style="display:inline-flex;flex-direction:column;align-items:center;gap:8px;">
          <i data-lucide="wifi-off" style="width:32px;height:32px;"></i>
          <strong style="color:var(--text,#0f172a);">${titulo}</strong>
          <span style="font-size:13px;">${sub}</span>
          <button class="btn btn-secondary" id="btnReintentarPoc" style="margin-top:8px;">
            <i data-lucide="refresh-cw"></i> Reintentar
          </button>
        </div>
      </td></tr>`;
    const btn = document.getElementById('btnReintentarPoc');
    if (btn) btn.addEventListener('click', () => {
      tbody.innerHTML = '<tr><td colspan="12" style="padding:24px;text-align:center;color:var(--muted,#64748b);">Cargando…</td></tr>';
      // refresh() re-dispatches based on the current filter input: a clean
      // reset load when empty, or the same filtered search when not — so the
      // retry redoes whatever actually failed.
      this._primeraCarga = true;
      this.refresh();
    }, { once: true });
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }).catch(err => {
        // Stale-search guard: ignore errors from a superseded query.
        if (ejecucionID !== this._filtroID) return;
        console.error('❌ Error al filtrar la base POC:', err);
        this._mostrarErrorCarga(tbody, btnCargar,
          'Error al buscar en la base POC',
          'Revisa tu conexión e intenta de nuevo.');
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
            restBtn.className = 'btn btn-ghost btn-icon btn-sm';
            restBtn.title = 'Restaurar';
            restBtn.setAttribute('aria-label', 'Restaurar equipo');
            restBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
            restBtn.onclick = () => PocService.restorePocDevice(d.id).then(() => this.mostrarTodo());
            ac.appendChild(restBtn);
          }
        }
        tbody.appendChild(row);
      });

      const total = tbody.rows.length;
      let activos = 0;
      [...tbody.rows].forEach(r => {
        if (r.cells[PocState.COL.activo]?.dataset.activo === 'true') activos++;
      });
      PocState.actualizarResumen({ total, activos });
      if (typeof lucide !== 'undefined') lucide.createIcons();
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
        ? `<span style="color:var(--status-critical);" data-incomplete="true" title="Falta completar campos obligatorios"><i data-lucide="alert-circle"></i></span> <strong>${FMT.esc(d.cliente)}</strong>`
        : `<strong>${FMT.esc(d.cliente)}</strong>`;
      row.appendChild(tdCliente);

      const tdOperador = document.createElement('td');
      tdOperador.dataset.operador = d.operador || '';
      if (d.operador && d.operador.trim()) {
        tdOperador.textContent = d.operador;
      } else {
        tdOperador.innerHTML = '<span style="color:var(--status-critical);" title="Operador faltante"><i data-lucide="alert-circle"></i></span>';
      }
      row.appendChild(tdOperador);

      const tdEstado = document.createElement('td');
      tdEstado.dataset.activo = d.activo ? 'true' : 'false';
      tdEstado.className = 'poc-estado-cell';
      tdEstado.innerHTML = d.activo
        ? '<span class="status-dot status-activo"></span>'
        : '<span class="status-dot status-inactivo"></span>';
      row.appendChild(tdEstado);
      if (d.activo) activos++;

      row.appendChild(this.nuevaCelda(d.serial, 'td-mono'));
      row.appendChild(this.crearCeldaIp(d.ip));
      row.appendChild(this.nuevaCelda(d.unit_id, 'td-mono td-primary'));
      row.appendChild(this.nuevaCelda(d.radio_name));
      const tdModeloF = this.nuevaCelda(PocState.obtenerModeloTexto(d));
      tdModeloF.dataset.modeloId = PocState.obtenerModeloId(d) || '';
      row.appendChild(tdModeloF);
      row.appendChild(this.crearCeldaConExpansor(
        Array.isArray(d.grupos) ? d.grupos.join(', ') : (d.grupos || ''), 'grupos'
      ));
      const tdSimF = document.createElement('td');
      tdSimF.innerHTML = `<i data-lucide="smartphone"></i> ${FMT.esc((d.sim || d.sim_number))} / ${FMT.esc(d.sim_phone)}`;
      row.appendChild(tdSimF);

      const acciones = document.createElement('td');
      acciones.style.whiteSpace = 'nowrap';
      if (!PocState.esLectura()) {
        const btnEditar = document.createElement('button');
        btnEditar.className = 'btn btn-ghost btn-icon btn-sm';
        btnEditar.title = 'Editar equipo';
        btnEditar.setAttribute('aria-label', 'Editar equipo');
        btnEditar.innerHTML = '<i data-lucide="pencil"></i>';
        btnEditar.onclick = () => PocEdit.abrir(row, d.id, d);
        acciones.appendChild(btnEditar);

        const btnElim = document.createElement('button');
        btnElim.className = 'btn btn-danger btn-icon btn-sm';
        btnElim.title = 'Eliminar';
        btnElim.setAttribute('aria-label', 'Eliminar equipo');
        btnElim.innerHTML = '<i data-lucide="trash-2"></i>';
        btnElim.onclick = async () => {
          if (await Modal.confirm({ message: '¿Seguro que quieres eliminar este equipo?', danger: true })) {
            await PocService.softDeletePocDevice(d.id);
            // Equipo eliminado con SIM → ofrecer devolver el SIM al pool.
            await SimLiberar.procesarDesactivados([{ id: d.id, antes: d, despues: { ...d, deleted: true } }]);
            this.cargar(true);
          }
        };
        acciones.appendChild(btnElim);

        if (d.deleted) {
          const btnRest = document.createElement('button');
          btnRest.className = 'btn btn-ghost btn-icon btn-sm';
          btnRest.title = 'Restaurar';
          btnRest.setAttribute('aria-label', 'Restaurar equipo');
          btnRest.innerHTML = '<i data-lucide="rotate-ccw"></i>';
          btnRest.onclick = () => PocService.restorePocDevice(d.id).then(() => this.cargar(true));
          acciones.appendChild(btnRest);
        }
      }
      row.appendChild(acciones);
      tbody.appendChild(row);
    });

    PocState.actualizarResumen({ total: lista.length, activos });
    if (typeof lucide !== 'undefined') lucide.createIcons();
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
    const soloActivos = document.getElementById('soloActivos')?.checked;
    const invalidos = [];

    devices.forEach(d => {
      if (d.deleted === true) return;
      if (soloActivos && !d.activo) return;
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
    if (seleccionados.length === 0) { Toast.show('Selecciona al menos un equipo para imprimir.', 'bad'); return; }
    const ids   = seleccionados.map(s => s.id);
    const query = `?ids=${encodeURIComponent(JSON.stringify(ids))}`;
    window.open(`imprimir-equipos.html${query}`, '_blank');
  },

  obtenerSeleccionados() {
    return [...document.querySelectorAll('#devicesTable tr')]
      .filter(fila => fila.querySelector('.seleccion-sim')?.checked)
      .map(fila => ({ id: fila.dataset.id, fila }));
  },

  // Copy the serials of the checked rows, one per line, ready to paste.
  // Workflow for "los de un cliente": filtrar por Cliente → seleccionar todos → copiar.
  async copiarSerialesSeleccionados() {
    const seleccionados = this.obtenerSeleccionados();
    if (!seleccionados.length) { Toast.show('Selecciona al menos un equipo para copiar.', 'bad'); return; }

    const COL = PocState.COL;
    const seriales = seleccionados
      .map(({ fila }) => {
        const celda = fila.cells?.[COL.serial];
        if (!celda) return '';
        // En edición masiva la celda contiene un <input>; si no, es texto plano.
        return (celda.querySelector('input')?.value ?? celda.textContent).trim();
      })
      .filter(Boolean);

    if (!seriales.length) { Toast.show('No hay seriales para copiar en la selección.', 'warn'); return; }

    const texto = seriales.join('\n');
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    Toast.show(`${seriales.length} ${seriales.length === 1 ? 'serial copiado' : 'seriales copiados'} al portapapeles.`, 'ok');
  },

  toggleSeleccionMasiva(master) {
    document.querySelectorAll('.seleccion-sim').forEach(cb => { cb.checked = master.checked; });
    this.actualizarSeleccion();
  },

  // Live count of checked rows, shown in the top summary strip. Lets the user
  // see "X de N" at a glance (e.g. 13 de 14) without printing the list.
  actualizarSeleccion() {
    const el = document.getElementById('resumenSeleccionados');
    if (!el) return;
    const n = document.querySelectorAll('#devicesTable .seleccion-sim:checked').length;
    el.textContent = `${n} ${n === 1 ? 'seleccionado' : 'seleccionados'}`;
    el.classList.toggle('recibido', n > 0);
  },

  async exportarExcelSeleccionados() {
    try {
      const seleccionados = this.obtenerSeleccionados();
      if (!seleccionados.length) { Toast.show('Selecciona al menos un equipo para exportar.', 'bad'); return; }
      const ids = seleccionados.map(s => s.id).filter(Boolean);
      if (ids.length > 2000) {
        Toast.show(`Has seleccionado ${ids.length} equipos. Reduce la selección (máx. 2000) o exporta por partes.`, 'bad');
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
      if (!registros.length) { Toast.show('No se encontraron datos para exportar.', 'bad'); return; }

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
      Toast.show('Ocurrió un error al exportar. Revisa la consola.', 'bad');
    }
  },

  // ── Event wiring ─────────────────────────────────────────────────
  init() {
    const self = this;
    const btnCargarMas = document.getElementById('btnCargarMas');
    if (btnCargarMas) btnCargarMas.addEventListener('click', () => self.cargar());

    // Delegated listener: any row checkbox toggling updates the live tally.
    const tbody = document.getElementById('devicesTable');
    if (tbody) tbody.addEventListener('change', (e) => {
      if (e.target?.classList?.contains('seleccion-sim')) self.actualizarSeleccion();
    });
  }
};

PocList.init();

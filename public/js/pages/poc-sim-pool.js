// @ts-nocheck
// Asignación de SIMs desde el pool (sim_cards) a los equipos seleccionados en
// la lista POC. Los SIMs se asignan en orden: primer SIM marcado → primer
// equipo de la tabla, y así sucesivamente. Cada asignación corre en
// transacción (SimCardsService.asignar) — si otra usuaria tomó un SIM primero,
// ese par se reporta como fallido sin frenar el resto.
window.PocSimPool = {
  _devices: [],   // [{id, ...data}] equipos seleccionados, en orden de tabla
  _sims: [],      // SIMs disponibles del pool

  async abrir() {
    if (PocState.esLectura()) {
      Toast.show('Modo lectura: tu rol no puede asignar SIMs.', 'bad');
      return;
    }
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { Toast.show('Selecciona al menos un equipo.', 'bad'); return; }

    try {
      // Data fresca de cada equipo (serial/cliente para el registro y el log),
      // en paralelo — el orden de `seleccionados` (orden de tabla) se preserva.
      const [devices, sims] = await Promise.all([
        Promise.all(seleccionados.map(({ id }) => PocService.getPocDevice(id))),
        SimCardsService.listar({ estado: 'disponible' }),
      ]);
      this._devices = devices.filter(Boolean);
      this._sims = sims;
    } catch (e) {
      console.error('Error al abrir el pool de SIMs:', e);
      Toast.show('Error al cargar los SIMs disponibles: ' + (e.message || e), 'bad');
      return;
    }

    // Filtro de operador con los operadores presentes en los disponibles.
    const ops = [...new Set(this._sims.map(s => (s.operador || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    const sel = document.getElementById('poolFiltroOperador');
    sel.innerHTML = '<option value="">Todos los operadores</option>' +
      ops.map(op => `<option value="${FMT.esc(op)}">${FMT.esc(op)}</option>`).join('');
    document.getElementById('poolBusqueda').value = '';

    this.render();
    Modal.open('simPoolModal');
  },

  cerrar() {
    Modal.close('simPoolModal');
    this._devices = [];
    this._sims = [];
  },

  _simsFiltrados() {
    const q  = (document.getElementById('poolBusqueda')?.value || '').trim().toLowerCase();
    const op = document.getElementById('poolFiltroOperador')?.value || '';
    return this._sims.filter(s => {
      if (op && (s.operador || '').trim() !== op) return false;
      if (q && !`${s.sim_number} ${s.sim_phone || ''} ${s.operador || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  },

  render() {
    const esc = FMT.esc;

    // Resumen de equipos seleccionados; los que ya tienen SIM se marcan (se
    // les reemplazará y el SIM anterior vuelve al pool si estaba registrado).
    const conSim = this._devices.filter(d => (d.sim_number || '').trim()).length;
    document.getElementById('poolEquiposResumen').innerHTML = `
      <strong>${this._devices.length}</strong> equipos seleccionados
      ${conSim ? `<span style="color:#a16207;"> · ${conSim} ya tienen SIM (se reemplazará)</span>` : ''}
      <span class="form-hint" style="display:block; margin-top:2px;">
        ${this._devices.map(d => esc(d.serial || d.unit_id || d.id)).join(', ')}
      </span>`;

    // Preserva los checks al re-renderizar (filtros).
    const marcados = new Set(this.seleccionados());
    const lista = this._simsFiltrados();
    const tbody = document.getElementById('poolTabla');
    tbody.innerHTML = lista.length ? lista.map(s => `
      <tr>
        <td style="width:34px;"><input type="checkbox" class="pool-check" value="${esc(s.id)}"
          ${marcados.has(s.id) ? 'checked' : ''} onchange="PocSimPool.actualizarContador()"></td>
        <td class="td-mono">${esc(s.sim_number)}</td>
        <td class="td-mono">${esc(s.sim_phone || '—')}</td>
        <td>${esc(s.operador || '—')}</td>
      </tr>`).join('')
      : `<tr><td colspan="4" style="text-align:center; color:var(--fg-3); padding:var(--sp-4);">
           ${this._sims.length ? 'Sin SIMs con el filtro actual.' : 'No hay SIMs disponibles en el pool. Cárgalos en POC → SIM cards.'}
         </td></tr>`;
    this.actualizarContador();
  },

  seleccionados() {
    return [...document.querySelectorAll('#poolTabla .pool-check:checked')].map(c => c.value);
  },

  actualizarContador() {
    const n = this.seleccionados().length;
    const el = document.getElementById('poolContador');
    el.textContent = `${n} de ${this._devices.length} SIMs seleccionados`;
    el.style.color = n === this._devices.length ? '#15803d' : 'var(--fg-2)';
  },

  // Marca los primeros N SIMs visibles (N = equipos seleccionados).
  autoSeleccionar() {
    const checks = [...document.querySelectorAll('#poolTabla .pool-check')];
    checks.forEach(c => { c.checked = false; });
    checks.slice(0, this._devices.length).forEach(c => { c.checked = true; });
    this.actualizarContador();
  },

  async procesar() {
    const simIds = this.seleccionados();
    if (simIds.length !== this._devices.length) {
      Toast.show(`Seleccionaste ${this._devices.length} equipos pero ${simIds.length} SIMs. Deben coincidir.`, 'bad');
      return;
    }
    if (!await Modal.confirm({
      message: `Vas a asignar ${simIds.length} SIMs del pool a los equipos seleccionados. El operador de cada equipo se tomará del SIM. ¿Continuar?`,
    })) return;

    const user = firebase.auth().currentUser;
    let ok = 0;
    const fallidos = [];

    for (let i = 0; i < this._devices.length; i++) {
      const device = this._devices[i];
      const clienteNombre = PocState.nombreClienteDe(device);
      let simAsignado;
      try {
        simAsignado = await SimCardsService.asignar(simIds[i], {
          id: device.id,
          serial: device.serial || '',
          cliente_nombre: clienteNombre,
        }, user);
        ok++;
      } catch (e) {
        console.error(`Fallo asignando SIM ${simIds[i]} a ${device.serial}:`, e);
        fallidos.push(simIds[i]);
        continue;
      }

      // Trabajo POST-commit: la asignación ya persistió — un fallo aquí no
      // debe contarla como fallida (el toast de "lo tomó otra sesión" sería
      // falso). Solo se loguea a consola.
      try {
        // Si el equipo tenía otro SIM y ese SIM estaba en el pool asignado a
        // este equipo, vuelve como disponible (SIM físicamente intercambiado).
        const prevSim = SimCardsService.normalizarSim(device.sim_number);
        if (prevSim && prevSim !== SimCardsService.normalizarSim(simIds[i])) {
          const prevDoc = await SimCardsService.getSim(prevSim);
          if (prevDoc && prevDoc.estado === 'asignado' && prevDoc.asignado_a?.device_id === device.id) {
            await SimCardsService.liberar({
              sim_number: prevSim, sim_phone: prevDoc.sim_phone, operador: prevDoc.operador,
              desde: { device_id: device.id, serial: device.serial || '', cliente_nombre: clienteNombre },
            }, user);
          }
        }

        PocService.addLog({
          equipo_id: device.id,
          fecha:     firebase.firestore.FieldValue.serverTimestamp(),
          usuario:   user?.email,
          cambios:   {
            antes:   device,
            despues: { ...device, ...simAsignado },
          },
        }).catch(e => console.warn('poc_log write failed (non-critical):', e));
      } catch (e) {
        console.warn(`Asignación de ${simIds[i]} OK, pero falló la liberación del SIM anterior o el log:`, e);
      }
    }

    if (fallidos.length) {
      Toast.show(`${ok} asignados. ${fallidos.length} SIMs ya no estaban disponibles (los tomó otra sesión): ${fallidos.slice(0, 3).join(', ')}${fallidos.length > 3 ? '…' : ''}`, 'bad');
    } else {
      Toast.show(`${ok} equipos actualizados con SIM y operador del pool.`, 'ok');
    }
    this.cerrar();
    PocList.refresh();
  },
};

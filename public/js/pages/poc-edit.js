// @ts-nocheck
// POC edit drawer — open, close, save
window.PocEdit = {
  _docId: null,
  _row:   null,
  _data:  null,
  _catalogo: [],   // grupos del catálogo del cliente (clientes/{id}.poc_grupos)
  _prefijo: null,  // prefijo de 3 letras del cliente (clientes/{id}.poc_grupo_prefix)

  abrir(row, docId, data) {
    if (PocState.esLectura()) {
      Toast.show('Modo lectura: el rol técnico no puede editar PoC.', 'bad');
      return;
    }
    this._docId = docId;
    this._row   = row;
    this._data  = data;

    document.querySelectorAll('tr.row-editing').forEach(r => r.classList.remove('row-editing'));
    row.classList.add('row-editing');

    document.getElementById('drawer-serial').value     = data.serial     || '';
    document.getElementById('drawer-unit-id').value    = data.unit_id    || '';
    document.getElementById('drawer-radio-name').value = data.radio_name || '';

    // Populate the modelo dropdown from the active-models list, preselecting
    // the device's current modelo.
    const modeloIdActual = PocState.obtenerModeloId(data);
    document.getElementById('drawer-modelo').innerHTML =
      PocState.buildModeloOptionsHTML(modeloIdActual);

    document.getElementById('drawer-grupos').value     = (data.grupos || []).join(', ');
    // Mensaje "crear grupo" según rol: el vendedor no entra a Administrar grupos.
    const ghint = document.getElementById('drawerGruposHint');
    if (ghint) {
      ghint.innerHTML = (PocState.rolActual === ROLES.VENDEDOR)
        ? 'Toca un grupo del catálogo para añadir o quitar. Para crear uno nuevo, <strong>pídele a recepción</strong>.'
        : 'Toca un grupo del catálogo para añadir o quitar. Para crear uno nuevo, ve a <strong>Administrar grupos</strong> (menú “Más” en POC).';
    }
    // Catálogo del cliente → chips toggle encima del input (async, no bloquea).
    this._cargarCatalogo(data.cliente_id);
    document.getElementById('drawer-activo').checked   = data.activo !== false;
    document.getElementById('drawer-sim-number').value = data.sim_number || '';
    document.getElementById('drawer-sim-phone').value  = data.sim_phone  || '';
    document.getElementById('drawer-ip').value         = data.ip         || '';
    document.getElementById('drawer-gps').checked      = data.gps        || false;
    document.getElementById('drawer-notas').value      = data.notas      || '';

    const sel = document.getElementById('drawer-operador');
    sel.innerHTML = '<option value="">Seleccione...</option>';
    const opList = [...(PocState.listaOperadores || [])];
    if (data.operador && !opList.includes(data.operador)) opList.push(data.operador);
    opList.forEach(op => {
      const opt = document.createElement('option');
      opt.value = op;
      opt.textContent = op;
      if (op === data.operador) opt.selected = true;
      sel.appendChild(opt);
    });

    document.getElementById('editDrawerOverlay').classList.add('active');
    document.getElementById('editDrawer').classList.add('active');
  },

  cerrar() {
    document.getElementById('editDrawerOverlay').classList.remove('active');
    document.getElementById('editDrawer').classList.remove('active');
    if (this._row) this._row.classList.remove('row-editing');
    this._docId = null;
    this._row   = null;
    this._data  = null;
    this._catalogo = [];
  },

  // ── Catálogo de grupos del cliente ──────────────────────────────────
  // Carga clientes/{id}.poc_grupos y pinta chips toggle. Legacy sin
  // cliente_id → sin catálogo (solo chips de los grupos que ya trae el equipo).
  async _cargarCatalogo(clienteId) {
    this._catalogo = [];
    this._prefijo = null;
    try {
      if (clienteId) {
        const [cat, pfx] = await Promise.all([
          PocService.getCatalogoGrupos(clienteId),
          PocService.getGrupoPrefix(clienteId),
        ]);
        this._catalogo = Array.isArray(cat) ? cat : [];
        this._prefijo = pfx || null;
      }
    } catch (e) {
      console.warn('No se pudo cargar el catálogo de grupos:', e?.code || e);
    }
    this.renderGruposChips();
  },

  _inputGrupos() {
    return FMT.dedupGrupos((document.getElementById('drawer-grupos').value || '').split(','));
  },
  _setInputGrupos(arr) {
    document.getElementById('drawer-grupos').value = FMT.dedupGrupos(arr).join(', ');
  },

  renderGruposChips() {
    const cont = document.getElementById('drawer-grupos-catalog');
    if (!cont) return;
    const seleccion = this._inputGrupos();
    const selNorms = new Set(seleccion.map(g => FMT.normalize(g)));
    // Universo = catálogo ∪ grupos que ya trae el equipo (para no perder de
    // vista los escritos a mano; se marcan punteados como "fuera de catálogo").
    const universo = [];
    const vistos = new Set();
    const push = (g) => { const k = FMT.normalize(g); if (k && !vistos.has(k)) { vistos.add(k); universo.push(g); } };
    (this._catalogo || []).forEach(push);
    seleccion.forEach(push);
    if (!universo.length) {
      cont.innerHTML = '<span class="drawer-grupos-empty">Sin grupos en el catálogo. Escríbelos abajo o créalos en Admin · Grupos.</span>';
      return;
    }
    universo.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    const catNorms = new Set((this._catalogo || []).map(c => FMT.normalize(c)));
    cont.innerHTML = universo.map(g => {
      const activo = selNorms.has(FMT.normalize(g));
      const extra  = !catNorms.has(FMT.normalize(g));
      const safe = (g || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      return `<button type="button" class="grupo-chip ${activo ? 'is-active' : ''} ${extra ? 'is-extra' : ''}" data-grupo="${safe}">${safe}${activo ? ' ✓' : ''}</button>`;
    }).join('');
    cont.querySelectorAll('.grupo-chip').forEach(btn => {
      btn.addEventListener('click', () => this.toggleGrupoChip(btn.dataset.grupo));
    });
  },

  toggleGrupoChip(nombre) {
    const arr = this._inputGrupos();
    const k = FMT.normalize(nombre);
    const idx = arr.findIndex(g => FMT.normalize(g) === k);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(nombre);
    this._setInputGrupos(arr);
    this.renderGruposChips();
  },

  async guardar() {
    if (!this._docId) return;
    try {
      const docId        = this._docId;
      const rowRef       = this._row;
      const originalData = this._data;
      let grupos = FMT.dedupGrupos(
        document.getElementById('drawer-grupos').value.split(',')
      );
      // Si el cliente tiene prefijo, todos los grupos quedan como PREFIJO-Nombre.
      if (this._prefijo) {
        grupos = FMT.dedupGrupos(grupos.map(g => FMT.aplicarPrefijoGrupo(this._prefijo, g)));
      }
      const user   = firebase.auth().currentUser;

      // Modelo is now picked from a dropdown — write the canonical FK and a
      // label snapshot (modelo_label) matching the field name used by the
      // vendedores-batch flow. Other alias keys are cleared below.
      const newModeloId    = (document.getElementById('drawer-modelo').value || '').trim();
      const newModeloLabel = newModeloId ? (PocState.modelosMap[newModeloId] || '') : '';
      const oldModeloId    = PocState.obtenerModeloId(originalData);
      const modeloEditado  = newModeloId !== oldModeloId;

      // Fields sent to Firestore update() — FieldValue sentinels are valid here.
      const updatePayload = {
        serial:           document.getElementById('drawer-serial').value,
        unit_id:          document.getElementById('drawer-unit-id').value,
        radio_name:       document.getElementById('drawer-radio-name').value,
        modelo_id:        newModeloId || firebase.firestore.FieldValue.delete(),
        modelo_label:     newModeloLabel,
        grupos,
        activo:           document.getElementById('drawer-activo').checked,
        sim_number:       document.getElementById('drawer-sim-number').value,
        sim_phone:        document.getElementById('drawer-sim-phone').value,
        operador:         document.getElementById('drawer-operador').value,
        ip:               document.getElementById('drawer-ip').value,
        gps:              document.getElementById('drawer-gps').checked,
        notas:            document.getElementById('drawer-notas').value,
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null
      };

      // Stale aliases that obtenerModeloTexto could fall back to. We now write
      // modelo_id (FK) and modelo_label (snapshot) as the only sources of truth,
      // so drop every other variant so none shadow the new value.
      const MODEL_ALIAS_KEYS_TO_CLEAR = [
        'modeloId', 'model_id', 'modelId',
        'modeloLabel', 'Modelo', 'modelo',
        'model_label', 'modelLabel', 'model'
      ];

      if (modeloEditado) {
        MODEL_ALIAS_KEYS_TO_CLEAR.forEach(k => {
          if (k in (originalData || {})) {
            updatePayload[k] = firebase.firestore.FieldValue.delete();
          }
        });
      }

      await PocService.updatePocDevice(docId, updatePayload);

      // Clean snapshot for the UI row and audit log — strip FieldValue sentinels.
      const cleanFields = PocService.stripSentinels(updatePayload);

      PocService.addLog({
        equipo_id: docId,
        fecha:     firebase.firestore.FieldValue.serverTimestamp(),
        usuario:   user?.email,
        cambios:   { antes: originalData || {}, despues: cleanFields }
      }).catch(e => console.warn('poc_log write failed (non-critical):', e));

      const mergedData = { ...originalData, ...cleanFields };
      if (modeloEditado) {
        MODEL_ALIAS_KEYS_TO_CLEAR.forEach(k => delete mergedData[k]);
        // FieldValue.delete() sentinels were filtered out of cleanFields, so
        // when the user cleared the modelo we must also drop the inherited FK.
        if (!newModeloId) delete mergedData.modelo_id;
      }

      // Equipo desactivado con SIM → ofrecer devolver el SIM al pool.
      const liberados = await SimLiberar.procesarDesactivados([
        { id: docId, antes: originalData || {}, despues: mergedData },
      ]);
      if (liberados.has(docId)) {
        mergedData.sim_number = ''; mergedData.sim_phone = ''; mergedData.operador = '';
      } else if (mergedData.activo !== false) {
        // SIM tecleado a mano que existe disponible en el pool → marcarlo
        // asignado para que no se ofrezca dos veces. Best-effort.
        const simNuevo = SimCardsService.normalizarSim(mergedData.sim_number);
        const simPrev  = SimCardsService.normalizarSim(originalData?.sim_number);
        if (simNuevo && simNuevo !== simPrev) {
          SimCardsService.marcarAsignadoSiExiste(simNuevo, {
            id: docId, serial: mergedData.serial || '',
            cliente_nombre: PocState.nombreClienteDe(mergedData),
          }, user);
        }
      }

      this.cerrar();
      Toast.show('Cambios guardados', 'ok');
      const newRow = PocList._buildRow(docId, mergedData);
      rowRef.replaceWith(newRow);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
      console.error('Error en guardar():', err);
      Toast.show('Error al guardar: ' + (err.message || err), 'bad');
    }
  },

  init() {
    const overlay = document.getElementById('editDrawerOverlay');
    if (overlay) overlay.addEventListener('click', () => this.cerrar());
    // Escribir a mano en el input refleja en los chips (activa/atenúa).
    const gi = document.getElementById('drawer-grupos');
    if (gi) gi.addEventListener('input', () => this.renderGruposChips());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('editDrawer')?.classList.contains('active')) {
        this.cerrar();
      }
    });
  }
};

PocEdit.init();

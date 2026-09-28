// @ts-nocheck
// POC list — load, filter, sort, row builder, export, duplicates
window.PocList = {
  _lastDoc:      null,
  _primeraCarga: true,
  _noMasDatos:   false,
  _campoOrden:   'created_at',
  _direccionAsc: false,
  _filtroID:     0,
  _cargando:     false,          // guard en vuelo de cargar()
  _debounceTimer: null,          // debounce del buscador
  // ── Conjuntos de búsqueda: suscripción viva + memo de respaldo ──────
  // (2026-09-25) La búsqueda trae las ~4,600 fichas vivas (y las ~1,870
  // cerradas si se prende el toggle). Era el mayor consumidor de Firestore
  // que quedaba: ~36,000 lecturas/día, casi todo de recepción, con un memo de
  // solo 60 s que obligaba a rebajar el conjunto en cada búsqueda.
  //
  // Ahora cada conjunto se mantiene con una suscripción VIVA (onSnapshot)
  // mientras la página esté abierta: la primera búsqueda paga, las siguientes
  // salen gratis y SIEMPRE al día — lo que cierra una devolución o toca otra
  // persona llega solo. Si la suscripción no se puede abrir o no sincroniza a
  // tiempo (sin red, permisos), se cae al get de siempre con un memo de
  // _ALL_TTL_MS: el respaldo. Con la suscripción viva ese TTL no se consulta.
  _escuchas:     { vivas: null, cerradas: null }, // estado de cada suscripción
  _allDocs:      null,           // memo de RESPALDO {t, docs} de las vivas
  _cerradasDocs: null,           // memo de RESPALDO {t, docs} de las cerradas
  _ALL_TTL_MS:   10 * 60 * 1000, // respaldo: 10 min (antes 60 s; ver arriba)
  _ESCUCHA_TOPE_MS: 15000,       // sin snapshot del servidor en 15 s → respaldo
  _docsPorId:    new Map(),      // docId → doc de la última vez que se pintó

  // Para cuando CAMBIARON los datos (se reabrió o cerró una ficha, un lote,
  // un cambio de SIM). Un conjunto con suscripción viva ya está al día: todas
  // esas mutaciones son .update() del cliente, y Firestore le avisa al
  // listener con el cambio local ANTES de que la escritura termine. Solo se
  // tira el memo de respaldo de lo que no está escuchando.
  refresh() {
    if (!this._escuchas.vivas?.completo) this._allDocs = null;
    if (!this._escuchas.cerradas?.completo) this._cerradasDocs = null;
    this._redespachar();
  },

  // Vuelve a pintar según lo que haya en el buscador, SIN tirar la memoria.
  // Es lo que usa ordenar: filtrar() ordena EN MEMORIA (_ordenarDocs), así que
  // el orden no cambia qué fichas hay — tirar la memoria por un clic en una
  // columna obligaba a bajar otra vez las ~4,600 fichas vivas (2026-09-25).
  _redespachar() {
    const v = document.getElementById('filtroValor')?.value.trim() || '';
    if (v.length >= 2) this.filtrar();
    else if (!v) this.cargar(true);
    // 1 solo carácter: no barrer 5,000+ docs por una letra (ver filtrarDebounced)
  },

  // Buscador: debounce de 300 ms + mínimo 2 caracteres. Antes cada TECLA
  // disparaba PocService.getAll() sin limit (colección completa, ~5,225 docs).
  filtrarDebounced() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      const v = document.getElementById('filtroValor')?.value.trim() || '';
      if (v.length === 1) {
        const res = document.getElementById('resumenEquipos');
        if (res) res.innerHTML = '<span class="resumen-badge">escribe al menos 2 caracteres…</span>';
        return;
      }
      if (v) this.filtrar(); else this.cargar(true);
    }, 300);
  },

  // Fichas vivas para la búsqueda. NUNCA usa {source:'cache'} ni un snapshot
  // de caché como conjunto completo: devolvería resultados incompletos en
  // silencio ("no existe" de una ficha que sí existe).
  _getAllMemo() { return this._conjunto('vivas'); },

  // Fichas CERRADAS (deleted:true), ~1,870. NO se pagan en la carga normal:
  // solo entran cuando alguien prende "Incluir cerradas" para buscar un equipo
  // que el cliente ya devolvió. También con suscripción viva: una ficha que se
  // cierra sale de las vivas y tiene que aparecer aquí sin esperar a un TTL.
  _getCerradasMemo() { return this._conjunto('cerradas'); },

  _conjunto(nombre) {
    const e = this._escuchas[nombre];
    if (e && e.completo) return Promise.resolve(e.docs);
    if (e && !e.fallo && e.listo) return e.listo;
    if (e && e.fallo) return this._conjuntoPorGet(nombre);
    return this._escuchar(nombre);
  },

  // El camino de siempre (get + memo con TTL). Es el RESPALDO: se usa solo si
  // la suscripción no se pudo abrir, falló, o no sincronizó a tiempo.
  _conjuntoPorGet(nombre) {
    const clave = nombre === 'cerradas' ? '_cerradasDocs' : '_allDocs';
    const m = this[clave];
    if (m && Date.now() - m.t < this._ALL_TTL_MS) return Promise.resolve(m.docs);
    const pedir = nombre === 'cerradas'
      ? PocService.getCerradas()
      : PocService.getAll({ sortField: 'created_at', sortAsc: false });
    return pedir.then(docs => { this[clave] = { t: Date.now(), docs }; return docs; });
  },

  _escuchar(nombre) {
    const e = { unsub: null, docs: null, completo: false, fallo: false, listo: null };
    this._escuchas[nombre] = e;
    e.listo = new Promise((resolver) => {
      let tope = null;
      // Pasar al respaldo. Si ya se había entregado el conjunto, la próxima
      // búsqueda lo pedirá por get: una suscripción caída no sigue avisando, y
      // sus datos dejarían de estar al día sin que nadie lo notara.
      const abandonar = (motivo, err) => {
        if (tope) clearTimeout(tope);
        if (err) console.warn(`[POC] suscripción de ${nombre} → respaldo (${motivo}):`, err?.code || err);
        try { if (e.unsub) e.unsub(); } catch (x) { /* ya estaba cerrada */ }
        e.unsub = null;
        e.fallo = true;
        const yaEntregado = e.completo;
        e.completo = false;
        if (!yaEntregado) resolver(this._conjuntoPorGet(nombre));
      };
      tope = setTimeout(() => { if (!e.completo) abandonar('sin sincronizar a tiempo'); }, this._ESCUCHA_TOPE_MS);
      try {
        e.unsub = PocService.escuchar(nombre, (docs, delServidor) => {
          if (e.fallo) return;
          // Antes de tener el conjunto completo SOLO vale un snapshot del
          // servidor: el primero suele venir de la caché local y puede estar
          // incompleto. Ya sincronizado, todo snapshot es la mejor vista.
          if (!e.completo && !delServidor) return;
          e.docs = docs;
          if (!e.completo) {
            e.completo = true;
            if (tope) clearTimeout(tope);
            resolver(docs);
          }
        }, (err) => abandonar('error', err));
      } catch (err) {
        // Un pocService.js viejo en caché no tiene escuchar(): llamarlo lanza
        // en el acto. Se cae al respaldo en vez de romper la búsqueda.
        abandonar('no disponible', err);
      }
    });
    return e.listo;
  },

  // ── Fichas cerradas ─────────────────────────────────────────────
  // Una ficha cerrada (deleted:true por una devolución) tiene el SIM y el
  // operador en blanco —el SIM volvió al pool— y la foto de lo que tenía en
  // `cierre`. Para buscar y para pintar, ese es el valor que la gente espera
  // ver: es el dato con el que se pide la desconexión del airtime.
  _campoVisible(d, campo) {
    const v = d[campo];
    if (v != null && !(typeof v === 'string' && v.trim() === '')) return v;
    if (d.deleted === true && d.cierre && d.cierre[campo] != null) return d.cierre[campo];
    return v;
  },

  // "Incompleta" es un pendiente de captura, y una ficha cerrada no lo es:
  // nadie va a volver a llenarle el SIM a un radio que ya devolvieron.
  _incompleta(d) {
    if (d.deleted === true) return false;
    return [PocState.nombreClienteDe(d), d.unit_id, d.operador, d.ip, d.sim_number, d.sim_phone]
      .some(v => !v || v.trim?.() === '');
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
    const algunoVacio   = this._incompleta(d);
    const cerrada       = d.deleted === true;

    const row = document.createElement('tr');
    row.dataset.id = docId;
    if (cerrada) { row.dataset.cerrada = '1'; row.style.opacity = '.72'; }
    // Para refrescarNombresVisibles: los nombres de cliente pueden llegar
    // DESPUÉS del primer paint (los mapas ya no bloquean la lista).
    this._docsPorId.set(docId, d);

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
    // Vínculo POC↔contrato: sub-línea bajo el cliente (sin columna nueva para
    // no mover los índices de PocState.COL ni el export/bulk-edit).
    if (d.contrato_id || d.contrato_doc_id) {
      const sub = document.createElement('a');
      sub.className = 'eq-link';
      sub.href = `../contratos/index.html?buscar=${encodeURIComponent(d.contrato_id || d.contrato_doc_id)}`;
      sub.title = 'Contrato vinculado — buscar en la lista de contratos';
      sub.textContent = d.contrato_id || 'contrato';
      sub.style.cssText = 'display:inline-block;font-size:11px;color:var(--fg-3);font-family:var(--font-mono,monospace);margin-top:2px;';
      tdCliente.appendChild(document.createElement('br'));
      tdCliente.appendChild(sub);
    }
    // Ficha cerrada: se dice de UNA vez de qué devolución salió. Sin esto la
    // fila parece viva y con datos a medias.
    if (cerrada) {
      const c = d.cierre || {};
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-block;margin-top:3px;padding:1px 7px;border-radius:999px;'
        + 'border:1px solid var(--line);background:var(--gray-100,#f1f3f5);color:var(--fg-3);'
        + 'font-size:10.5px;font-weight:600;';
      const de = c.ref?.label || c.ref?.id || '';
      chip.textContent = `Cerrada${c.at ? ' ' + FMT.date(c.at) : ''}${de ? ' · ' + de : ''}`;
      chip.title = c.motivo ? `${c.motivo}. El equipo ya no está con el cliente.`
                            : 'El equipo ya no está con el cliente.';
      tdCliente.appendChild(document.createElement('br'));
      tdCliente.appendChild(chip);
    }
    row.appendChild(tdCliente);

    // operador (2) — stamp raw value on the cell so bulk edit can pre-select.
    // Empty operadores get a critical marker so they're easy to spot/complete.
    const tdOperador = document.createElement('td');
    tdOperador.dataset.operador = d.operador || '';
    const operadorVisible = String(this._campoVisible(d, 'operador') || '').trim();
    if (operadorVisible) {
      tdOperador.textContent = operadorVisible;
      if (!d.operador) tdOperador.title = 'Operador que tenía al cerrarse la ficha';
    } else if (cerrada) {
      tdOperador.textContent = '—';
    } else {
      tdOperador.innerHTML = '<span style="color:var(--status-critical);" title="Operador faltante"><i data-lucide="alert-circle"></i></span>';
    }
    row.appendChild(tdOperador);

    // activo (3)
    const tdEstado = document.createElement('td');
    tdEstado.dataset.activo = d.activo ? 'true' : 'false';
    tdEstado.className = 'poc-estado-cell';
    // El punto solo no se entendía (auditoría UX 2026-09-28, T1): va con texto.
    tdEstado.innerHTML = d.activo
      ? '<span class="status-dot status-activo" aria-hidden="true"></span> <span class="poc-estado-txt">Activo</span>'
      : '<span class="status-dot status-inactivo" aria-hidden="true"></span> <span class="poc-estado-txt">Inactivo</span>';
    tdEstado.title = d.activo ? 'Activo: el equipo está en servicio con el cliente' : 'Inactivo: la ficha sigue abierta pero el equipo no está en servicio';
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

    // sim_tel (10) — en una ficha cerrada el SIM ya volvió al pool, pero se
    // muestra el que tenía: es lo que recepción manda a desconectar.
    const tdSim = document.createElement('td');
    const simNum = FMT.esc(this._campoVisible(d, 'sim_number'));
    const simTel = FMT.esc(this._campoVisible(d, 'sim_phone'));
    tdSim.innerHTML = `<i data-lucide="smartphone"></i> ${simNum} / ${simTel}`;
    if (cerrada && (simNum || simTel)) tdSim.title = 'SIM que tenía al cerrarse la ficha (ya liberado del equipo)';
    row.appendChild(tdSim);

    // acciones (11)
    const actionCell = document.createElement('td');
    actionCell.style.whiteSpace = 'nowrap';
    if (cerrada) {
      // Una ficha cerrada es histórico: se consulta, no se edita. Lo único que
      // queda es reabrirla si se cerró por error (el radio nunca volvió).
      if (!PocState.esLectura()) {
        const restBtn = document.createElement('button');
        restBtn.className = 'btn btn-ghost btn-icon btn-sm';
        restBtn.title = 'Reabrir la ficha (el equipo volvió a estar con el cliente)';
        restBtn.setAttribute('aria-label', 'Reabrir ficha');
        restBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
        restBtn.onclick = async () => {
          if (!await Modal.confirm({ message: '¿Reabrir esta ficha de POC? El equipo vuelve a contar como activo con el cliente.' })) return;
          await PocService.restorePocDevice(docId, {
            antes: d, user: firebase.auth().currentUser, origen: 'poc-lista',
          });
          this.refresh();
        };
        actionCell.appendChild(restBtn);
      }
    } else if (!PocState.esLectura()) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-ghost btn-icon btn-sm';
      editBtn.title = 'Editar equipo';
      editBtn.setAttribute('aria-label', 'Editar equipo');
      editBtn.innerHTML = '<i data-lucide="pencil"></i>';
      editBtn.onclick = () => PocEdit.abrir(row, docId, d);
      actionCell.appendChild(editBtn);

      // "Eliminar" producía una ficha "Cerrada" reabrible: se llama por lo que
      // hace (auditoría UX 2026-09-28, T1 y 4.7 #6).
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-icon btn-sm';
      delBtn.title = 'Cerrar ficha (el equipo ya no está con el cliente)';
      delBtn.setAttribute('aria-label', 'Cerrar ficha');
      delBtn.innerHTML = '<i data-lucide="archive"></i>';
      delBtn.onclick = async () => {
        if (await this.cerrarFicha(docId, d)) this.refresh();
      };
      actionCell.appendChild(delBtn);
      // (el "Reabrir" de una ficha cerrada va en la rama de arriba)
    }
    row.appendChild(actionCell);
    return row;
  },

  // ── Main loader (paginated) ──────────────────────────────────────
  // ?focus=<valor>&campo=<campo>&id=<docId> (lo manda el Ctrl+K): la primera
  // carga se convierte en la búsqueda de ese equipo y la fila queda resaltada.
  // Antes el palette mandaba ?focus= y nadie lo leía (auditoría UX 2026-09-28,
  // P0 #5). Devuelve true si tomó el control de la carga.
  _focusLeido:     false,
  _focusPendiente: false,
  _focusId:        null,
  _tomarFocusDeUrl() {
    if (this._focusLeido) return false;
    this._focusLeido = true;
    let p;
    try { p = new URLSearchParams(location.search); } catch (_) { return false; }
    const valor = (p.get('focus') || '').trim();
    if (!valor) return false;
    const inCampo = document.getElementById('filtroCampo');
    const inValor = document.getElementById('filtroValor');
    if (!inCampo || !inValor) return false;
    const campo = p.get('campo') || 'serial';
    const valido = Array.from(inCampo.options || []).some(o => o.value === campo);
    inCampo.value = valido ? campo : 'serial';
    inValor.value = valor;
    this._focusId = p.get('id') || null;
    this._focusPendiente = true;
    this.filtrar();
    return true;
  },

  // Tras pintar la búsqueda del ?focus=: resalta la fila (por docId; si no,
  // la única coincidencia) y la trae a la vista. Una sola vez.
  _aplicarFocus(tbody) {
    if (!this._focusPendiente) return;
    this._focusPendiente = false;
    const filas = Array.from(tbody.querySelectorAll('tr[data-id]'));
    const fila = (this._focusId && filas.find(r => r.dataset.id === this._focusId))
      || (filas.length === 1 ? filas[0] : null);
    if (!fila) return;
    fila.style.outline = '2px solid var(--accent, #0074AC)';
    fila.style.outlineOffset = '-2px';
    fila.style.background = 'var(--accent-soft, #e0f2fe)';
    fila.setAttribute('tabindex', '-1');
    try { fila.scrollIntoView({ block: 'center' }); fila.focus({ preventScroll: true }); } catch (_) { /* navegador viejo */ }
  },

  cargar(reset = false) {
    const tbody      = document.getElementById('devicesTable');
    const btnCargar  = document.getElementById('btnCargarMas');

    if (this._tomarFocusDeUrl()) return;

    // Guard en vuelo: el botón "Cargar más" tenía doble wiring (onclick del
    // HTML + addEventListener) y un clic disparaba DOS listPage con el mismo
    // cursor, duplicando filas.
    if (this._cargando) return;

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
    this._cargando = true;

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

    // Cache-first (solo reset): pinta al instante la primera página desde la
    // persistencia local mientras el pase de servidor viaja; este repinta la
    // verdad. El cursor y _noMasDatos SOLO se tocan en el pase de servidor.
    if (esReset) {
      PocService.listPage({
        sortField: campoOrden, sortAsc: this._direccionAsc,
        cursorDoc: null, limit: 50, source: 'cache',
      }).then(({ docs }) => {
        if (_resuelto || !docs.length) return;   // el servidor ganó o caché frío
        tbody.innerHTML = '';
        this._pintarPagina(tbody, docs);
      }).catch(() => { /* caché frío (primera visita): sin preview */ });
    }

    PocService.listPage({
      sortField: campoOrden, sortAsc: this._direccionAsc,
      cursorDoc: this._lastDoc || null, limit: 50,
    }).then(({ docs, lastDoc }) => {
      _resuelto = true;
      this._cargando = false;
      if (_watchdog) clearTimeout(_watchdog);
      // Clear the skeleton/old rows now that the data is in (reset only;
      // pagination appends below the existing rows). This also clears any
      // timeout-error row painted by the watchdog if data lands late, and
      // the cache-first preview.
      if (esReset) tbody.innerHTML = '';
      if (!docs.length) {
        this._noMasDatos = true;
        if (btnCargar) btnCargar.style.display = 'none';
        return;
      }
      this._lastDoc = lastDoc;
      this._pintarPagina(tbody, docs);
    }).catch(err => {
      _resuelto = true;
      this._cargando = false;
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

  // Pinta una tanda de docs (respetando los toggles) y actualiza el resumen.
  // Compartido por el pase de servidor y el preview cache-first.
  _pintarPagina(tbody, docs) {
    const soloIncompletos = document.getElementById('soloIncompletos')?.checked;
    const soloInactivos   = document.getElementById('soloInactivos')?.checked;
    const soloSinContrato = document.getElementById('soloSinContrato')?.checked;

    docs.forEach(d => {
      if (soloInactivos && d.activo) return;
      if (soloSinContrato && (d.contrato_id || d.contrato_doc_id)) return;
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
    if (window.Icons) Icons.pintar(tbody);
    else if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // Corrige la celda de cliente de las filas visibles cuando los mapas de
  // clientes/modelos resuelven (ya no bloquean el primer paint de la lista).
  refrescarNombresVisibles() {
    const tbody = document.getElementById('devicesTable');
    if (!tbody) return;
    const COL = PocState.COL;
    [...tbody.rows].forEach(r => {
      const d = this._docsPorId.get(r.dataset.id);
      if (!d) return;
      const strong = r.cells[COL.cliente]?.querySelector('strong');
      const nombre = PocState.nombreClienteDe(d);
      if (strong && nombre && strong.textContent !== nombre) strong.textContent = nombre;
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

  // La búsqueda filtrada pinta client-side (getAll por created_at) — este
  // comparador aplica la columna de orden activa al resultado, imitando el
  // orden de Firestore de la vista paginada: unit_id ordena por su espejo
  // numérico (unit_id_num) y los vacíos/no numéricos van primero en asc.
  _ordenarDocs(docs) {
    const campo = this._campoOrden || 'cliente';
    const dir   = this._direccionAsc ? 1 : -1;
    const val = d => {
      if (campo === 'unit_id')    return (typeof d.unit_id_num === 'number') ? d.unit_id_num : null;
      if (campo === 'created_at') return d.created_at?.toMillis ? d.created_at.toMillis() : (d.created_at?.seconds ?? null);
      if (campo === 'cliente')    return PocState.nombreClienteDe(d) || null;
      const v = d[campo];
      return (v === undefined || v === null || v === '') ? null : v;
    };
    docs.sort((a, b) => {
      const va = val(a), vb = val(b);
      let r;
      if (va === null && vb === null) r = 0;
      else if (va === null) r = -1;
      else if (vb === null) r = 1;
      else if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
      else r = String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
      // Desempate estable para unit_id no numéricos (ej. CONSOLA_DSI).
      if (r === 0 && campo === 'unit_id') {
        r = String(a.unit_id || '').localeCompare(String(b.unit_id || ''), 'es', { numeric: true });
      }
      return r * dir;
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
    const soloInactivos   = document.getElementById('soloInactivos')?.checked;
    const soloIncompletos = document.getElementById('soloIncompletos')?.checked;
    const soloSinContrato = document.getElementById('soloSinContrato')?.checked;
    const incluirCerradas = document.getElementById('incluirCerradas')?.checked;

    // Las cerradas se suman al barrido vivo SOLO si el toggle está prendido:
    // la búsqueda de todos los días no paga esos ~1,800 docs.
    const fuente = incluirCerradas
      ? Promise.all([this._getAllMemo(), this._getCerradasMemo()]).then(([a, b]) => a.concat(b))
      : this._getAllMemo();

    fuente.then(docs => {
        if (ejecucionID !== this._filtroID) return;
        let total = 0, activos = 0, incompletos = 0;
        const coincidencias = [];

        docs.forEach(d => {
          if (idsVistos.has(d.id)) return;
          idsVistos.add(d.id);

          const nombreCliente = PocState.nombreClienteDe(d);
          const algunoVacio   = this._incompleta(d);

          if (soloSinContrato && (d.contrato_id || d.contrato_doc_id)) return;
          if (soloIncompletos) {
            if (!algunoVacio) return;
            incompletos++;
          }

          const valorCampo = this._campoVisible(d, campo);
          if (campo !== 'cliente' && (valorCampo == null || (typeof valorCampo === 'string' && valorCampo.trim() === ''))) return;

          let contenido;
          if (campo === 'cliente')          contenido = nombreCliente.toLowerCase();
          else if (Array.isArray(valorCampo)) contenido = valorCampo.join(' ').toLowerCase();
          else                              contenido = String(valorCampo ?? '').toLowerCase();

          if ((!soloActivos || d.activo === true) && (!soloInactivos || !d.activo)) {
            if (contenido.includes(valor)) {
              total++;
              if (d.activo) activos++;
              coincidencias.push(d);
            }
          }
        });
        // Respetar la columna de orden activa (antes la vista filtrada quedaba
        // clavada en created_at desc y "ordenar por Unit ID" no hacía nada).
        this._ordenarDocs(coincidencias);
        coincidencias.forEach(d => tbody.appendChild(this._buildRow(d.id, d)));
        this._aplicarFocus(tbody);
        PocState.actualizarResumen({ total, activos, incompletos });
        // "No se encontraron resultados" se leía como "este equipo nunca estuvo
        // en POC", y muchas veces es al revés: la devolución CERRÓ la ficha
        // (Brenda, 2026-09-16). Si el histórico lo tiene, se dice aquí mismo.
        if (!total && !incluirCerradas && valor) this._ofrecerCerradas(ejecucionID, campo, valor);
        this.actualizarFlechitas();
        if (window.Icons) Icons.pintar(tbody);
        else if (typeof lucide !== 'undefined') lucide.createIcons();
      }).catch(err => {
        // Stale-search guard: ignore errors from a superseded query.
        if (ejecucionID !== this._filtroID) return;
        console.error('❌ Error al filtrar la base POC:', err);
        this._mostrarErrorCarga(tbody, btnCargar,
          'Error al buscar en la base POC',
          'Revisa tu conexión e intenta de nuevo.');
      });
  },

  // Busca lo mismo en las fichas cerradas y, si aparece, lo ofrece en el
  // resumen con un botón que prende el toggle. Solo corre cuando la búsqueda
  // viva quedó en cero, así que el barrido del histórico casi nunca se paga.
  _ofrecerCerradas(ejecucionID, campo, valor) {
    this._getCerradasMemo().then(docs => {
      if (ejecucionID !== this._filtroID) return;
      const hits = docs.filter(d => {
        const v = campo === 'cliente' ? PocState.nombreClienteDe(d) : this._campoVisible(d, campo);
        const contenido = Array.isArray(v) ? v.join(' ') : String(v ?? '');
        return contenido.toLowerCase().includes(valor);
      }).length;
      if (!hits) return;

      const pintar = (el) => {
        if (!el) return;
        el.textContent = '';
        const txt = document.createElement('span');
        txt.textContent = hits === 1
          ? 'Sin equipos activos — hay 1 ficha cerrada (equipo devuelto). '
          : `Sin equipos activos — hay ${hits} fichas cerradas (equipos devueltos). `;
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary btn-sm';
        btn.innerHTML = '<i data-lucide="archive"></i> Ver el histórico';
        btn.onclick = () => {
          const chk = document.getElementById('incluirCerradas');
          if (chk) chk.checked = true;
          this.filtrar();
        };
        el.appendChild(txt);
        el.appendChild(btn);
        if (window.Icons) Icons.pintar(el);
        else if (typeof lucide !== 'undefined') lucide.createIcons();
      };
      pintar(document.getElementById('resumenEquipos'));
      pintar(document.getElementById('resumenEquiposTop'));
    }).catch(() => { /* el histórico es un extra: si falla, la búsqueda ya respondió */ });
  },

  limpiarFiltro() {
    document.getElementById('filtroValor').value = '';
    document.getElementById('filtroCampo').value = 'cliente';
    const cerradas = document.getElementById('incluirCerradas');
    if (cerradas) cerradas.checked = false;
    document.getElementById('resumenEquipos').innerHTML =
      '<div class="loader" style="width:24px;height:24px;border-width:3px;"></div>';
    this.cargar(true);
  },

  ordenarPor(campo) {
    if (this._campoOrden === campo) this._direccionAsc = !this._direccionAsc;
    else { this._campoOrden = campo; this._direccionAsc = true; }
    this._primeraCarga = true;
    // Ordenar no cambia los datos: repintar sin tirar la memoria (ver
    // _redespachar). Sin buscar, cargar(true) pide la página ordenada al
    // servidor como siempre — esa sí depende del orden, y son 50 fichas.
    this._redespachar();
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

  // "Cerrar ficha" (antes "Eliminar", que producía una ficha Cerrada
  // reabrible; auditoría UX 2026-09-28, T1 y 4.7 #6). Explica qué pasa y qué
  // se hace con el SIM; devuelve true si se cerró.
  async cerrarFicha(docId, d) {
    const sim = ((d.sim_number || d.sim || '') + '').trim();
    const msg = 'La ficha pasa al histórico: deja de salir en la lista y en los conteos, y su Unit ID queda libre. '
      + 'No se borra: se ve con "Incluir cerradas" y se puede <b>reabrir</b> si se cerró por error.'
      + (sim ? `<br><br>Tiene el SIM <b>${FMT.esc(sim)}</b>: al cerrar te preguntamos si lo pones disponible en el pool de SIM o lo conservas en la ficha.` : '');
    if (!await Modal.confirm({ title: 'Cerrar ficha', confirmLabel: 'Cerrar ficha', message: msg, danger: true })) return false;
    try {
      await PocService.softDeletePocDevice(docId, {
        antes: d, user: firebase.auth().currentUser, origen: 'poc-lista',
      });
    } catch (e) {
      console.error('[PocList] cerrar ficha', docId, e);
      Toast.show('No se pudo cerrar la ficha: ' + (e.message || e), 'bad');
      return false;
    }
    // Ficha cerrada con SIM → ofrecer devolver el SIM al pool. Las filas de
    // duplicados traen el SIM como `sim`, no `sim_number`.
    const antes = { ...d, sim_number: d.sim_number || d.sim || '' };
    await SimLiberar.procesarDesactivados([{ id: docId, antes, despues: { ...antes, deleted: true } }]);
    return true;
  },

  // Segmento único Todos/Activos/Inactivos (auditoría UX 2026-09-28, 4.7 #6).
  // Reemplaza las dos casillas excluyentes; conserva #soloActivos y
  // #soloInactivos (ocultas) porque el resto del archivo filtra con ellas.
  cambiarEstadoActivo(valor) {
    const a = document.getElementById('soloActivos');
    const i = document.getElementById('soloInactivos');
    if (a) a.checked = valor === 'activos';
    if (i) i.checked = valor === 'inactivos';
    const valorFiltro = document.getElementById('filtroValor').value.trim();
    if (valorFiltro) this.filtrar(); else this.cargar(true);
  },

  manejarCambioIncompletos() {
    const valorFiltro = document.getElementById('filtroValor').value.trim();
    if (valorFiltro) this.filtrar(); else this.cargar(true);
  },

  manejarCambioSinContrato() {
    const valorFiltro = document.getElementById('filtroValor').value.trim();
    if (valorFiltro) this.filtrar(); else this.cargar(true);
  },

  // "Incluir cerradas" solo tiene sentido BUSCANDO: la lista de todos los días
  // es de equipos vivos y volcarle 1,800 fichas cerradas no le sirve a nadie
  // (ni a la cuota de lecturas). Sin texto de búsqueda se avisa y ya.
  manejarCambioCerradas() {
    const valorFiltro = document.getElementById('filtroValor').value.trim();
    if (valorFiltro) { this.filtrar(); return; }
    if (document.getElementById('incluirCerradas')?.checked) {
      Toast.show('Escribe un serial, cliente o Unit ID: las fichas cerradas salen en la búsqueda.', 'info');
    }
    this.cargar(true);
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
    const soloInactivos   = document.getElementById('soloInactivos')?.checked;
    const soloIncompletos = document.getElementById('soloIncompletos')?.checked;
    const soloSinContrato = document.getElementById('soloSinContrato')?.checked;

    PocService.getAll({
      sortField: this._campoOrden, sortAsc: this._direccionAsc,
      onlyActivos: soloActivos,
    }).then(docs => {
      docs.forEach(d => {
        if (soloInactivos && d.activo) return;
        if (soloSinContrato && (d.contrato_id || d.contrato_doc_id)) return;
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
            restBtn.onclick = () => PocService.restorePocDevice(d.id, {
              antes: d, user: firebase.auth().currentUser, origen: 'poc-lista',
            }).then(() => this.mostrarTodo());
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
        ? '<span class="status-dot status-activo" aria-hidden="true"></span> <span class="poc-estado-txt">Activo</span>'
        : '<span class="status-dot status-inactivo" aria-hidden="true"></span> <span class="poc-estado-txt">Inactivo</span>';
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
        btnElim.title = 'Cerrar ficha (el equipo ya no está con el cliente)';
        btnElim.setAttribute('aria-label', 'Cerrar ficha');
        btnElim.innerHTML = '<i data-lucide="archive"></i>';
        btnElim.onclick = async () => {
          if (await this.cerrarFicha(d.id, d)) this.cargar(true);
        };
        acciones.appendChild(btnElim);

        if (d.deleted) {
          const btnRest = document.createElement('button');
          btnRest.className = 'btn btn-ghost btn-icon btn-sm';
          btnRest.title = 'Restaurar';
          btnRest.setAttribute('aria-label', 'Restaurar equipo');
          btnRest.innerHTML = '<i data-lucide="rotate-ccw"></i>';
          btnRest.onclick = () => PocService.restorePocDevice(d.id, {
            antes: d, user: firebase.auth().currentUser, origen: 'poc-lista',
          }).then(() => this.cargar(true));
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

    // Unit ID: se repite solo DENTRO del mismo cliente (misma regla que el
    // lote, la consola y el cajón), así que la clave lleva el cliente
    // (auditoría UX 2026-09-28, 4.7 #4).
    if (tipo === 'unit_id') {
      const grupos = {};
      equipos.forEach(e => {
        const u = (e.unit_id ?? '').toString().trim().toUpperCase();
        if (!u) return;
        const k = (e.cliente_id || ('n:' + (e.cliente || '').toLowerCase())) + '|' + u;
        (grupos[k] = grupos[k] || []).push(e);
      });
      const rep = Object.values(grupos).filter(arr => arr.length > 1).flat();
      if (!rep.length) Toast.show('No hay Unit ID repetidos dentro de un mismo cliente.', 'ok');
      this.mostrarResultadosFiltrados(rep);
      return;
    }

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

  // ── Contratos recientes (selección de un batch completo) ─────────
  // Llena el menú desplegable con los últimos contratos que tienen equipos POC.
  // Se llama al ABRIR el menú (lazy) — una lectura acotada, no en la carga de
  // la página. Cada ítem selecciona de un clic todo el contrato.
  async cargarMenuContratosRecientes() {
    const drop = document.getElementById('pocContratosDrop');
    if (!drop) return;
    drop.innerHTML =
      '<div class="overflow-menu-item" aria-disabled="true" style="opacity:.7;cursor:default;">'
      + '<i data-lucide="loader"></i> Cargando…</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    try {
      const contratos = await PocService.getContratosRecientes();
      if (!contratos.length) {
        drop.innerHTML =
          '<div class="overflow-menu-item" aria-disabled="true" style="opacity:.7;cursor:default;">'
          + 'Sin contratos recientes</div>';
        return;
      }
      drop.innerHTML = '';
      contratos.forEach(c => {
        const cliente = PocState.nombreClienteDe(c) || 'Sin cliente';
        const ref     = c.contrato_id || '(sin ref)';
        const btn = document.createElement('button');
        btn.className = 'overflow-menu-item';
        btn.title = `Seleccionar los ${c.count} equipos del contrato ${ref}`;
        btn.innerHTML =
          '<i data-lucide="file-check"></i>'
          + '<span style="flex:1;min-width:0;">'
          +   `<strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${FMT.esc(cliente)}</strong>`
          +   `<span style="font-size:11px;color:var(--fg-3);font-family:var(--font-mono,monospace);">${FMT.esc(ref)}</span>`
          + '</span>'
          + `<span class="badge" style="margin-left:auto;">${c.count}</span>`;
        btn.addEventListener('click', () => {
          drop.classList.remove('open');
          document.getElementById('pocContratosBtn')?.setAttribute('aria-expanded', 'false');
          this.seleccionarContrato(c);
        });
        drop.appendChild(btn);
      });
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
      console.error('❌ Error al listar contratos recientes:', err);
      drop.innerHTML =
        '<div class="overflow-menu-item" aria-disabled="true" style="opacity:.7;cursor:default;color:var(--status-critical);">'
        + 'Error al cargar. Reintenta.</div>';
    }
  },

  // Filtra la tabla al contrato elegido y deja TODOS sus equipos seleccionados
  // (un clic desde "Contratos recientes"). Re-consulta el contrato completo, así
  // que la selección es exacta aunque el batch supere la ventana del menú. Para
  // volver a la lista normal: el botón de limpiar filtro o cualquier toggle
  // resetea la vista (cargar(true) reactiva la paginación).
  async seleccionarContrato(c) {
    const tbody     = document.getElementById('devicesTable');
    const btnCargar = document.getElementById('btnCargarMas');
    if (!tbody) return;
    const ref = c?.contrato_id || '';

    tbody.innerHTML =
      '<tr><td colspan="12" style="padding:24px;text-align:center;color:var(--muted,#64748b);">'
      + 'Cargando equipos del contrato…</td></tr>';
    if (btnCargar) btnCargar.style.display = 'none';
    // La vista de contrato no pagina: bloquea "Cargar más" hasta el próximo reset.
    this._noMasDatos = true;
    this._lastDoc    = null;

    try {
      const devices = (await PocService.getByContrato({
        contratoDocId: c?.contrato_doc_id || null,
        contratoRef:   ref || null,
      })).filter(d => d.deleted !== true);

      // Respeta la columna de orden activa (igual que la búsqueda filtrada).
      this._ordenarDocs(devices);

      tbody.innerHTML = '';
      if (!devices.length) {
        PocState.actualizarResumen({ total: 0 });
        Toast.show(`El contrato ${ref} no tiene equipos activos.`, 'warn');
        return;
      }
      devices.forEach(d => tbody.appendChild(this._buildRow(d.id, d)));

      // Marca todos los equipos del contrato.
      tbody.querySelectorAll('.seleccion-sim').forEach(cb => { cb.checked = true; });

      const COL = PocState.COL;
      let activos = 0, incompletos = 0;
      [...tbody.rows].forEach(r => {
        if (r.cells[COL.activo]?.dataset.activo === 'true') activos++;
        if (r.cells[COL.cliente]?.querySelector('[data-incomplete]')) incompletos++;
      });
      PocState.actualizarResumen({ total: devices.length, activos, incompletos });
      this.actualizarSeleccion();
      this.actualizarFlechitas();
      if (typeof lucide !== 'undefined') lucide.createIcons();

      const cliente = PocState.nombreClienteDe(c) || 'contrato';
      const n = devices.length;
      Toast.show(`${n} ${n === 1 ? 'equipo seleccionado' : 'equipos seleccionados'} del contrato ${ref} · ${cliente}.`, 'ok');
    } catch (err) {
      console.error('❌ Error al seleccionar el contrato:', err);
      this._mostrarErrorCarga(tbody, btnCargar,
        'Error al cargar los equipos del contrato',
        'Revisa tu conexión e intenta de nuevo.');
    }
  },

  async exportarExcelSeleccionados() {
    try {
      const seleccionados = this.obtenerSeleccionados();
      if (!seleccionados.length) { Toast.show('Selecciona al menos un equipo para exportar.', 'bad'); return; }
      await cargarXLSX();   // SheetJS bajo demanda — no se descarga al abrir la página
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
        ['modelo','Modelo'],['grupos','Grupos'],['notas','Notas'],
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
          radio_name: d.radio_name || '', modelo: PocState.obtenerModeloTexto(d),
          grupos: gruposTxt, notas: d.notas || '',
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

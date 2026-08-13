// @ts-nocheck
// Asistente "Importar hoja de bodega" — carga el conteo desde el Excel/CSV tal
// como bodega lo manda, muestra el diff ANTES de escribir, y deja resolver ahí
// mismo todo lo que hoy obliga a escalar por WhatsApp.
//
// POR QUÉ EXISTE. Entre el 2026-08-12 y el 13 bodega mandó seis hojas y en
// cinco no pudo terminar sola. Lo que las trabó no fue dar de alta un radio
// —eso ya funcionaba— sino todo lo demás:
//   · 12 bases MD786 mal clasificadas: reclasificar el modelo de un lote no
//     existía en la UI, solo ficha por ficha.
//   · B8310025: el sistema decía "la tiene EXOLUM en contrato" y bodega no
//     podía comprobarlo, así que escaló. No había tal contrato — era una orden
//     de préstamo de marzo.
//   · Dos bases marcadas DAÑADA: no había dónde ponerlo.
//   · Hojas de 27/29/45 seriales: un textarea de pegar, un modelo por tanda.
//   · 47 fichas en bodega marcadas "del cliente" por la regla 4 del backfill:
//     corregir propiedad no existía en la UI, ni suelta ni en lote.
//
// LA REGLA DE LA CASA: contar un radio es AFIRMAR dónde está. Por eso nada se
// escribe desde el paso 1 — el paso 2 enseña qué va a pasar con cada serial, con
// la evidencia al lado, y quien cuenta decide. Las escrituras salen todas por
// las funciones de EquiposPoolService que ya usan la ficha y la acción en lote:
// ninguna segunda ruta de escritura.
//
// API: AsistenteImportar.abrir({ user, onDone }). La página gatea el rol.
// Dependencias del host: firebase compat, EquiposPoolService, ModelosService,
// InventarioService, SerialPatron, Modal, cargarXLSX (js/core/xlsx-loader.js).
window.AsistenteImportar = (() => {

  const esc = (v) => (window.FMT && typeof FMT.esc === 'function') ? FMT.esc(v)
    : String(v == null ? '' : v).replace(/[&<>"']/g, s =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const toast = (m, t) => { if (window.Toast) Toast.show(m, t); };

  const ctx = {
    opts: null, el: null, busy: false,
    modelos: [], modeloId: '',
    origen: '',          // nombre del archivo o "pegado"
    filas: [],           // filas crudas del archivo (array de arrays)
    columnas: [],        // { idx, muestra, nSeriales }
    colSerial: -1, colNota: -1,
    items: [],           // { crudo, norm, nota, ... } tras normalizar
    diff: null,
  };

  // ── Paso 1: modelo + archivo ────────────────────────────────────────────

  async function abrir(opts = {}) {
    Object.assign(ctx, { opts: opts || {}, filas: [], columnas: [], items: [], diff: null,
      colSerial: -1, colNota: -1, modeloId: '', origen: '' });
    render();
    try {
      const todos = await ModelosService.getModelos();
      // `modelo` se guarda aparte del label porque las hojas titulan la columna
      // con el modelo a secas ("NX-410-R"), sin la marca — ver esNombreDeModelo.
      ctx.modelos = (todos || []).filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim(),
                     modelo: m.modelo || '', estado: (m.estado || '').toUpperCase() }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo:', e);
      ctx.modelos = [];
    }
    paso1();
  }

  const modeloLabel = (id) => ctx.modelos.find(m => m.id === id)?.label || '';

  // La condición la impone la fila del catálogo, nunca se elige: una ficha no
  // puede decir "reuso" con un modelo que el catálogo tiene como nuevo.
  function condicionDe(id) {
    const m = ctx.modelos.find(x => x.id === id);
    if (!m) return 'nuevo';
    if (m.estado === 'R') return 'reuso';
    if (m.estado === 'N') return 'nuevo';
    return /[\s-]r$/i.test(m.label || '') ? 'reuso' : 'nuevo';
  }

  function paso1() {
    const opts = ctx.modelos.map(m =>
      `<option value="${esc(m.id)}" ${m.id === ctx.modeloId ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    cuerpo(`
      <div class="form-field">
        <label class="form-label" for="aiModelo">Modelo de la hoja</label>
        <select class="form-select" id="aiModelo" onchange="AsistenteImportar._setModelo(this.value)">
          <option value="">Seleccione…</option>${opts}
        </select>
        <p id="aiCondHint" style="font-size:12px; color:var(--fg-3); margin:4px 0 0;">
          La condición (nuevo / refurbished) la define el modelo escogido.</p>
      </div>

      <div id="aiDrop" style="border:2px dashed var(--border); border-radius:var(--radius-md);
           padding:18px; text-align:center; cursor:pointer; margin-top:var(--sp-2);">
        <i data-lucide="file-spreadsheet" style="width:26px;height:26px;"></i>
        <p style="margin:6px 0 2px; font-weight:600;">Arrastra el Excel o CSV aquí</p>
        <p style="margin:0; font-size:12px; color:var(--fg-3);">
          o haz clic para elegirlo · .xlsx, .xls, .csv — la hoja va tal como la mandan</p>
        <input type="file" id="aiFile" accept=".xlsx,.xls,.csv,text/csv" style="display:none;">
      </div>
      <p id="aiArchivoInfo" style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;"></p>

      <details style="margin-top:var(--sp-2);">
        <summary style="cursor:pointer; font-size:12.5px; color:var(--fg-3);">…o pegar los seriales a mano</summary>
        <textarea class="form-input" id="aiPegar" rows="4" placeholder="Un serial por línea"
          style="font-family:var(--font-mono); margin-top:6px;"></textarea>
        <button class="btn btn-sm" style="margin-top:6px;" onclick="AsistenteImportar._usarPegado()">Usar lo pegado</button>
      </details>`,
      `<button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
       <button class="btn btn-primary" id="aiBtnRevisar" disabled
         onclick="AsistenteImportar._revisar()">Revisar →</button>`);

    const drop = document.getElementById('aiDrop');
    const file = document.getElementById('aiFile');
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', (e) => { if (e.target.files?.[0]) leerArchivo(e.target.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.style.borderColor = 'var(--accent)';
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.style.borderColor = 'var(--border)';
    }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) leerArchivo(f);
    });
    sincronizarBoton();
  }

  function _setModelo(id) {
    ctx.modeloId = id;
    const hint = document.getElementById('aiCondHint');
    if (hint) {
      hint.textContent = !id ? 'La condición (nuevo / refurbished) la define el modelo escogido.'
        : condicionDe(id) === 'reuso'
          ? 'Refurbished: la fila del catálogo lleva sufijo -R.'
          : 'Nuevo: la fila del catálogo no lleva sufijo -R.';
    }
    sincronizarBoton();
  }

  function sincronizarBoton() {
    const btn = document.getElementById('aiBtnRevisar');
    if (btn) btn.disabled = !(ctx.modeloId && ctx.filas.length);
  }

  // ── Lectura del archivo ─────────────────────────────────────────────────

  // CSV propio en vez de delegarlo a SheetJS: las hojas de bodega vienen con
  // BOM y separadas por `;` (Excel en español), y el autodetect se equivoca
  // dejando una sola columna con todo dentro.
  function parsearCSV(texto) {
    const limpio = texto.replace(/^﻿/, '');
    const lineas = limpio.split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lineas.length) return [];
    const cand = [';', ',', '\t', '|'];
    const sep = cand
      .map(s => ({ s, n: lineas.slice(0, 10).reduce((a, l) => a + l.split(s).length - 1, 0) }))
      .sort((a, b) => b.n - a.n)[0];
    if (!sep || !sep.n) return lineas.map(l => [l.trim()]);
    return lineas.map(l => l.split(sep.s).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  }

  async function leerArchivo(file) {
    ctx.origen = file.name;
    const info = document.getElementById('aiArchivoInfo');
    if (info) info.textContent = `Leyendo ${file.name}…`;
    try {
      if (/\.csv$/i.test(file.name)) {
        ctx.filas = parsearCSV(await file.text());
      } else {
        const XLSX = await cargarXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const hoja = wb.Sheets[wb.SheetNames[0]];
        ctx.filas = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, raw: false })
          .map(f => (f || []).map(c => String(c ?? '').trim()));
      }
      detectarColumnas();
      if (info) {
        info.innerHTML = ctx.colSerial < 0
          ? `<span style="color:#b45309;">No encontré una columna con seriales en <b>${esc(file.name)}</b>.</span>`
          : `<b>${esc(file.name)}</b> — ${ctx.filas.length} filas. `
            + `Seriales en la ${selectorColumna()}${ctx.colNota >= 0 ? ` · notas en la columna ${ctx.colNota + 1}` : ''}.`;
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error('No se pudo leer el archivo:', e);
      if (info) info.innerHTML = `<span style="color:#b91c1c;">No se pudo leer: ${esc(e.message || e)}</span>`;
      ctx.filas = [];
    }
    sincronizarBoton();
  }

  // ¿Esta celda puede ser un serial? Tres filtros, cada uno puesto por una hoja
  // real que sin él entraba mal:
  //   · largo ≥5 — descarta la columna de numeración (1, 2, 3…) que abre todas
  //     las hojas de bodega.
  //   · sin espacios internos — descarta la columna que repite el MODELO
  //     ("TM-7PLUS R", "PD786G R"): normalizada queda "TM7PLUSR", que es
  //     alfanumérica y trae dígito, así que pasaba por serial en todas las filas
  //     y competía con la columna buena. También mata encabezados como
  //     "30 RADIOS", que si no se colaba como una unidad más.
  //   · el filtro de siempre (alfanumérico con al menos un dígito).
  function pareceSerial(crudo) {
    const v = (crudo || '').toString().trim();
    if (!v || /\s/.test(v)) return false;
    const norm = EquiposPoolService.normalizarSerial(v);
    if (!EquiposPoolService.esSerialValido(norm) || norm.length < 5) return false;
    return !esNombreDeModelo(v);
  }

  // Las hojas titulan la columna con el modelo —"NX-410-R", "TK-D240-R"— y ese
  // título cae DENTRO de la columna de seriales. Normalizado queda "NX410R":
  // alfanumérico, con dígito y de largo suficiente, así que pasaba todos los
  // filtros y entraba como una unidad fantasma más. Se descarta cotejándolo
  // contra el catálogo, que es quien sabe qué es un nombre de modelo.
  function esNombreDeModelo(v) {
    const t = EquiposPoolService._tightLabel(v);
    if (!t) return false;
    return ctx.modelos.some(m =>
      EquiposPoolService._tightLabel(m.label) === t ||
      EquiposPoolService._tightLabel(m.modelo || '') === t);
  }

  // Se puntúa por seriales DISTINTOS, no por celdas: un serial es único por
  // definición y el modelo se repite en cada fila. Sin esto, en la hoja de las
  // bases TM-7PLUS la columna del modelo empataba 45 a 45 con la de seriales.
  function detectarColumnas() {
    const ancho = ctx.filas.reduce((m, f) => Math.max(m, f.length), 0);
    ctx.columnas = [];
    for (let i = 0; i < ancho; i++) {
      const unicos = new Set();
      const muestra = [];
      for (const f of ctx.filas) {
        const v = (f[i] || '').toString().trim();
        if (!v) continue;
        if (muestra.length < 3) muestra.push(v);
        if (pareceSerial(v)) unicos.add(EquiposPoolService.normalizarSerial(v));
      }
      ctx.columnas.push({ idx: i, muestra, nSeriales: unicos.size });
    }
    const mejor = [...ctx.columnas].sort((a, b) => b.nSeriales - a.nSeriales)[0];
    ctx.colSerial = mejor && mejor.nSeriales >= 2 ? mejor.idx : -1;
    // Columna de nota: la que traiga BODEGA/DAÑADA/etc. Solo se miran las filas
    // que SÍ traen serial y gana la que más veces lo diga — si no, el subtítulo
    // "BASE DAÑADAS" de una fila suelta se llevaba la elección.
    ctx.colNota = -1;
    if (ctx.colSerial >= 0) {
      const conSerial = ctx.filas.filter(f => pareceSerial(f[ctx.colSerial]));
      let mejorN = 0;
      for (const c of ctx.columnas) {
        if (c.idx === ctx.colSerial) continue;
        const n = conSerial.filter(f =>
          /DA[NÑ]ADA|DA[NÑ]ADO|BODEGA|MALO|BUENO/i.test((f[c.idx] || '').toString())).length;
        if (n > mejorN) { mejorN = n; ctx.colNota = c.idx; }
      }
    }
  }

  function selectorColumna() {
    const opts = ctx.columnas.map(c =>
      `<option value="${c.idx}" ${c.idx === ctx.colSerial ? 'selected' : ''}>`
      + `columna ${c.idx + 1} (${c.nSeriales} seriales${c.muestra.length ? ` · ${esc(c.muestra[0])}…` : ''})`
      + `</option>`).join('');
    return `<select class="cc-input" style="font-size:12px; padding:2px 4px;"
              onchange="AsistenteImportar._setColSerial(this.value)">${opts}</select>`;
  }

  function _setColSerial(idx) { ctx.colSerial = Number(idx); sincronizarBoton(); }

  function _usarPegado() {
    const t = document.getElementById('aiPegar')?.value || '';
    const lineas = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lineas.length) { toast('Pega al menos un serial.', 'bad'); return; }
    ctx.filas = lineas.map(l => [l]);
    ctx.colSerial = 0; ctx.colNota = -1; ctx.origen = 'pegado a mano';
    ctx.columnas = [{ idx: 0, muestra: lineas.slice(0, 3), nSeriales: lineas.length }];
    const info = document.getElementById('aiArchivoInfo');
    if (info) info.innerHTML = `<b>${lineas.length}</b> seriales pegados a mano.`;
    sincronizarBoton();
  }

  // ── Paso 2: el diff ─────────────────────────────────────────────────────

  async function _revisar() {
    if (!ctx.modeloId) { toast('Selecciona el modelo.', 'bad'); return; }
    if (ctx.colSerial < 0) { toast('No hay columna de seriales.', 'bad'); return; }
    cuerpo(`<p style="color:var(--fg-3);">Cruzando ${ctx.filas.length} filas contra el inventario…</p>`, '');

    // 1. Normalizar y deduplicar, conservando el crudo para poder mostrarlo.
    const vistos = new Map();
    const invalidos = [], duplicados = [];
    for (const f of ctx.filas) {
      const crudo = (f[ctx.colSerial] || '').toString().trim();
      if (!crudo) continue;
      // Mismo filtro que la detección de columna: así los encabezados que caen
      // dentro de la columna buena ("30 RADIOS") se descartan aquí en vez de
      // entrar como una unidad más.
      if (!pareceSerial(crudo)) { invalidos.push(crudo); continue; }
      const norm = EquiposPoolService.normalizarSerial(crudo);
      if (vistos.has(norm)) { duplicados.push(norm); continue; }
      const nota = ctx.colNota >= 0 ? (f[ctx.colNota] || '').toString().trim() : '';
      vistos.set(norm, { crudo, norm, nota, limpiado: crudo.toUpperCase() !== norm });
    }
    const items = [...vistos.values()];

    // 2. Fichas existentes — por serial_norm (NO por documentId): el failsafe de
    //    colisión crea docs sufijados `serial__modelo`, y buscarlos por id los
    //    daría por inexistentes, duplicando la unidad.
    const fichas = new Map();
    const norms = items.map(i => i.norm);
    for (let i = 0; i < norms.length; i += 10) {
      const snap = await firebase.firestore().collection('equipos_pool')
        .where('serial_norm', 'in', norms.slice(i, i + 10)).get();
      snap.docs.forEach(d => {
        const arr = fichas.get(d.data().serial_norm) || [];
        arr.push({ id: d.id, ...d.data() });
        fichas.set(d.data().serial_norm, arr);
      });
    }

    // 3. Contratos referenciados: para poder decir si el vínculo sigue VIVO.
    //    Es la pregunta que bodega no pudo responder con B8310025 y por la que
    //    escaló — resultó que no había contrato ninguno.
    const contratoIds = new Set();
    fichas.forEach(arr => arr.forEach(d => {
      if (d.asignacion?.contrato_doc_id) contratoIds.add(d.asignacion.contrato_doc_id);
    }));
    const contratos = new Map();
    await Promise.all([...contratoIds].map(async id => {
      try {
        const s = await firebase.firestore().collection('contratos').doc(id).get();
        if (s.exists) contratos.set(id, { id, ...s.data() });
      } catch (e) { /* sin permiso o borrado: se trata como sin evidencia */ }
    }));

    // 4. Clasificar cada serial.
    const label = modeloLabel(ctx.modeloId);
    const cond = condicionDe(ctx.modeloId);
    const patron = SerialPatron.revisar(norms);
    const aviso = new Map(patron.revisados.filter(r => r.sospechoso).map(r => [r.serial, r]));

    for (const it of items) {
      const arr = fichas.get(it.norm) || [];
      const propia = arr.find(d => EquiposPoolService._mismoModelo(d, ctx.modeloId, label));
      it.sospecha = aviso.get(it.norm) || null;
      it.ficha = propia || null;
      it.otras = arr.filter(d => d !== propia);
      it.danada = /DA[NÑ]AD/i.test(it.nota || '');

      if (!arr.length)      it.clase = 'nueva';
      else if (!propia)     it.clase = 'colision';
      else if (propia.estado === EquiposPoolService.ESTADOS.EN_BODEGA) it.clase = 'en_bodega';
      else if (EquiposPoolService.REUBICABLES_DESDE.includes(propia.estado)) it.clase = 'reubicar';
      else it.clase = 'bloqueada';

      // Acciones propuestas. Se proponen marcadas salvo lo que exige criterio
      // humano (colisión) o lo que el sistema no debe decidir solo.
      it.acciones = {
        crear:       it.clase === 'nueva',
        reubicar:    it.clase === 'reubicar',
        modelo:      !!propia && (!propia.modelo_id || propia.modelo_id !== ctx.modeloId),
        propiedad:   !!propia && propia.propiedad !== 'cecomunica',
        // En una colisión NO se anota: la única ficha con ese serial es la del
        // OTRO modelo, y escribirle "DAÑADA" marcaría un radio ajeno. Si se
        // confirma la colisión la ficha nueva nace sufijada (`serial__modelo`)
        // y su id no se conoce hasta después, así que tampoco se intenta.
        nota:        it.danada && it.clase !== 'colision'
                       && (!propia || (propia.notas || '') !== notaDanada()),
        colision:    false,
      };
      it.contrato = propia?.asignacion?.contrato_doc_id
        ? contratos.get(propia.asignacion.contrato_doc_id) || null : null;
    }

    ctx.items = items;
    ctx.diff = { invalidos, duplicados, patron };
    paso2();
  }

  const notaDanada = () => `DAÑADA — reportada por bodega en el conteo físico`;

  function progreso(n, total, serial) {
    const barra = document.getElementById('aiBarra');
    const txt = document.getElementById('aiProgreso');
    if (barra) barra.style.width = `${Math.round((n / Math.max(total, 1)) * 100)}%`;
    if (txt) txt.textContent = `${n} de ${total} — ${serial}`;
  }

  const CLASES = {
    nueva:     { txt: 'Se da de alta',      color: '#15803d' },
    en_bodega: { txt: 'Ya está en bodega',  color: 'var(--fg-3)' },
    reubicar:  { txt: 'Hay que traerlo',    color: '#b45309' },
    colision:  { txt: 'Otro modelo',        color: '#b91c1c' },
    bloqueada: { txt: 'No se puede mover',  color: '#b91c1c' },
  };

  function paso2() {
    const it = ctx.items;
    const cuenta = (c) => it.filter(x => x.clase === c).length;
    const sospechosos = it.filter(x => x.sospecha).length;

    const resumen = Object.entries(CLASES)
      .filter(([c]) => cuenta(c))
      .map(([c, m]) => `<span style="color:${m.color}; font-weight:600;">${cuenta(c)}</span> ${esc(m.txt.toLowerCase())}`)
      .join(' · ');

    const filas = it.map((x, i) => {
      const meta = CLASES[x.clase];
      const f = x.ficha;
      let detalle = '';
      if (x.clase === 'reubicar') {
        const donde = EquiposPoolService.ESTADO_LABELS[f.estado] || f.estado;
        const quien = f.asignacion?.cliente_nombre ? ` con <b>${esc(f.asignacion.cliente_nombre)}</b>` : '';
        let ct = '';
        if (f.asignacion?.contrato_id) {
          const c = x.contrato;
          const vivo = c && ['activo', 'aprobado'].includes(String(c.estado || '').toLowerCase());
          ct = ` · contrato ${esc(f.asignacion.contrato_id)} `
            + (!c ? '<span style="color:#b45309;">(ya no existe)</span>'
                  : vivo ? `<span style="color:#b91c1c;">(VIGENTE — hay que corregirlo también)</span>`
                         : `<span style="color:var(--fg-3);">(${esc(c.estado)})</span>`);
        } else if (f.asignacion?.cliente_nombre) {
          ct = ' · <span style="color:var(--fg-3);">sin contrato que lo respalde</span>';
        }
        detalle = `el sistema lo tiene en ${esc(donde)}${quien}${ct}`;
      } else if (x.clase === 'colision') {
        detalle = `ya registrado como <b>${esc(x.otras[0]?.modelo_label || '(sin modelo)')}</b>`
          + ` — marca solo si de verdad es otro equipo que comparte numeración`;
      } else if (x.clase === 'bloqueada') {
        detalle = `está en ${esc(EquiposPoolService.ESTADO_LABELS[f.estado] || f.estado)}: se resuelve por su propio flujo`;
      } else if (x.clase === 'en_bodega' && !x.acciones.modelo && !x.acciones.propiedad && !x.acciones.nota) {
        detalle = 'sin cambios';
      }

      const chips = [];
      if (x.acciones.modelo) chips.push(chip(i, 'modelo',
        f?.modelo_id ? `Reclasificar de ${esc(f.modelo_label || '(sin modelo)')}` : 'Completar el modelo'));
      if (x.acciones.propiedad) chips.push(chip(i, 'propiedad',
        `Propiedad ${esc(f?.propiedad || 'sin dato')} → cecomunica`));
      if (x.acciones.nota) chips.push(chip(i, 'nota', 'Marcar DAÑADA'));
      if (x.clase === 'reubicar') chips.push(chip(i, 'reubicar', 'Está en mi estante: traerlo a bodega'));
      if (x.clase === 'colision') chips.push(chip(i, 'colision', 'Es otro equipo: crear ficha aparte'));

      const sosp = x.sospecha ? `
        <div style="margin-top:4px; font-size:12px; color:#b45309;">
          <i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-2px;"></i>
          Revisar: ${esc(x.sospecha.motivo)}
          ${x.sospecha.sugerencia ? `<button class="btn btn-sm" style="padding:0 6px; margin-left:4px;"
             onclick="AsistenteImportar._corregirSerial(${i})">Usar ${esc(x.sospecha.sugerencia)}</button>` : ''}
          <button class="btn btn-sm" style="padding:0 6px;" onclick="AsistenteImportar._excluir(${i})">Dejar fuera</button>
        </div>` : '';

      return `<tr style="${x.excluido ? 'opacity:.45;' : ''}">
        <td style="font-family:var(--font-mono); white-space:nowrap;">
          ${esc(x.norm)}
          ${x.limpiado ? `<span title="La hoja traía «${esc(x.crudo)}»" style="color:var(--fg-3);">*</span>` : ''}
        </td>
        <td>
          <span style="color:${meta.color}; font-weight:600;">${esc(meta.txt)}</span>
          ${detalle ? `<div style="font-size:12px; color:var(--fg-3);">${detalle}</div>` : ''}
          ${chips.length ? `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:6px;">${chips.join('')}</div>` : ''}
          ${sosp}
        </td>
      </tr>`;
    }).join('');

    const avisos = [];
    if (ctx.diff.invalidos.length) avisos.push(`${ctx.diff.invalidos.length} celda(s) no eran seriales y se ignoraron`);
    if (ctx.diff.duplicados.length) avisos.push(`${ctx.diff.duplicados.length} repetido(s) en la hoja`);
    if (sospechosos) avisos.push(`<b style="color:#b45309;">${sospechosos} con pinta de estar mal tecleado</b>`);

    cuerpo(`
      <p style="margin:0 0 4px; font-size:13px;">
        <b>${esc(modeloLabel(ctx.modeloId))}</b> · ${ctx.items.length} seriales de ${esc(ctx.origen)}
      </p>
      <p style="margin:0 0 8px; font-size:12.5px; color:var(--fg-3);">${resumen || 'sin cambios'}</p>
      ${avisos.length ? `<p style="margin:0 0 8px; font-size:12.5px; color:#b45309;">${avisos.join(' · ')}.</p>` : ''}
      ${ctx.diff.patron.patron ? `<p style="margin:0 0 8px; font-size:12px; color:var(--fg-3);">
        Forma de la serie: ${esc(SerialPatron.describirPatron(ctx.diff.patron.patron))}.</p>` : ''}
      <div style="max-height:44vh; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm);">
        <table class="app-table compact" style="margin:0;">
          <thead><tr><th>Serial</th><th>Qué va a pasar</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <label class="toggle-pill" style="margin-top:var(--sp-2);">
        <input type="checkbox" id="aiFijarConteo" checked>
        Fijar el conteo físico de ${esc(modeloLabel(ctx.modeloId))} en ${ctx.items.filter(x => !x.excluido).length}
      </label>`,
      `<button class="btn btn-ghost" onclick="AsistenteImportar._volver()">← Atrás</button>
       <button class="btn btn-primary" onclick="AsistenteImportar._aplicar()">
         <i data-lucide="check"></i> Aplicar</button>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function chip(i, accion, texto) {
    const on = ctx.items[i].acciones[accion];
    return `<label style="font-size:12px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;
             border:1px solid var(--border); border-radius:999px; padding:1px 8px;">
      <input type="checkbox" ${on ? 'checked' : ''}
        onchange="AsistenteImportar._toggle(${i}, '${accion}', this.checked)"> ${esc(texto)}</label>`;
  }

  function _toggle(i, accion, on) { ctx.items[i].acciones[accion] = on; }

  function _corregirSerial(i) {
    const it = ctx.items[i];
    if (!it.sospecha?.sugerencia) return;
    it.norm = it.sospecha.sugerencia;
    it.crudo = it.sospecha.sugerencia;
    it.sospecha = null;
    toast('Serial corregido. Vuelve a revisar para cruzarlo contra el inventario.', 'warn');
    _revisar();
  }

  function _excluir(i) {
    ctx.items[i].excluido = true;
    Object.keys(ctx.items[i].acciones).forEach(k => { ctx.items[i].acciones[k] = false; });
    paso2();
  }

  function _volver() { paso1(); }

  // ── Paso 3: aplicar ─────────────────────────────────────────────────────

  async function _aplicar() {
    const user = ctx.opts.user || firebase.auth().currentUser;
    const label = modeloLabel(ctx.modeloId);
    const cond = condicionDe(ctx.modeloId);
    const activos = ctx.items.filter(x => !x.excluido);
    const fijarConteo = document.getElementById('aiFijarConteo')?.checked;

    ctx.busy = true;
    cuerpo(`<p style="color:var(--fg-3);">Aplicando…</p>
      <div style="height:6px; background:var(--bg-2); border-radius:3px; overflow:hidden; margin-top:8px;">
        <div id="aiBarra" style="height:100%; width:0; background:var(--accent); transition:width .15s;"></div>
      </div>
      <p id="aiProgreso" style="font-size:12px; color:var(--fg-3); margin:6px 0 0;"></p>`, '');
    const r = { creadas: 0, reubicadas: 0, modelo: 0, propiedad: 0, notas: 0, colisiones: 0, errores: [] };
    const motivo = `Toma física de bodega — ${ctx.origen}`;

    try {
      // Altas: por `recibir`, que ya trae el failsafe de colisión y el batch.
      const nuevas = activos.filter(x => x.acciones.crear).map(x => x.norm);
      if (nuevas.length) {
        const res = await EquiposPoolService.recibir(nuevas, {
          modelo_id: ctx.modeloId, modelo_label: label, condicion: cond,
          notas: '', origen: 'toma_fisica',
        }, user);
        r.creadas = res.nuevos;
      }

      // Colisiones confirmadas: ficha aparte, sufijada.
      const coli = activos.filter(x => x.acciones.colision).map(x => x.norm);
      if (coli.length) {
        const res = await EquiposPoolService.recibir(coli, {
          modelo_id: ctx.modeloId, modelo_label: label, condicion: cond,
          origen: 'toma_fisica', confirmarColisiones: true,
        }, user);
        r.colisiones = res.colisiones;
      }

      // El resto, unidad por unidad y por las funciones de siempre. Va en serie
      // a propósito (cada una es una transacción) — con 300 seriales eso son
      // minutos, así que el progreso no es adorno: sin él parece colgado.
      const conTrabajo = activos.filter(x =>
        x.acciones.reubicar || x.acciones.modelo || x.acciones.propiedad || x.acciones.nota);
      let hechas = 0;
      for (const x of conTrabajo) {
        const f = x.ficha;
        progreso(++hechas, conTrabajo.length, x.norm);
        try {
          if (x.acciones.reubicar && f) {
            await EquiposPoolService.corregirABodega(f.id, motivo, user);
            r.reubicadas++;
            f.estado = EquiposPoolService.ESTADOS.EN_BODEGA;
          }
          if (x.acciones.modelo && f) {
            await EquiposPoolService.reclasificarModelo(f.id, {
              modelo_id: ctx.modeloId, modelo_label: label, condicion: cond,
              estadoActual: f.estado, antes: `${f.modelo_label || '(sin modelo)'} / ${f.condicion || '?'}`,
            }, motivo, user);
            r.modelo++;
          }
          if (x.acciones.propiedad && f) {
            await EquiposPoolService.corregirPropiedad(f.id, 'cecomunica',
              { estadoActual: f.estado, antes: f.propiedad || '' }, motivo, user);
            r.propiedad++;
          }
          if (x.acciones.nota) {
            // Puede ser una ficha recién creada: su id es el serial normalizado.
            const id = f?.id || x.norm;
            await EquiposPoolService.anotar(id, notaDanada(),
              { estadoActual: f?.estado || EquiposPoolService.ESTADOS.EN_BODEGA, antes: f?.notas || '' }, user);
            r.notas++;
          }
        } catch (e) {
          r.errores.push(`${x.norm}: ${e.message || e}`);
        }
      }

      if (fijarConteo) {
        try {
          await InventarioService.guardarInventario([{ modeloId: ctx.modeloId, cantidad: activos.length }]);
        } catch (e) { r.errores.push(`conteo físico: ${e.message || e}`); }
      }
    } catch (e) {
      r.errores.push(e.message || String(e));
    } finally {
      ctx.busy = false;
    }

    paso3(r, fijarConteo, activos.length);
    if (typeof ctx.opts.onDone === 'function') {
      try { ctx.opts.onDone(r); } catch (e) { console.error('onDone del importador falló:', e); }
    }
  }

  function paso3(r, fijoConteo, total) {
    const linea = (n, txt) => n ? `<li>${n} ${esc(txt)}</li>` : '';
    const hayError = r.errores.length > 0;
    cuerpo(`
      <p style="font-weight:600; margin:0 0 8px;">
        ${hayError ? 'Aplicado con avisos' : 'Listo'} — ${esc(modeloLabel(ctx.modeloId))}
      </p>
      <ul style="margin:0 0 10px 18px; font-size:13px;">
        ${linea(r.creadas, 'fichas dadas de alta')}
        ${linea(r.reubicadas, 'traídas a bodega')}
        ${linea(r.modelo, 'reclasificadas de modelo')}
        ${linea(r.propiedad, 'con la propiedad corregida')}
        ${linea(r.notas, 'marcadas DAÑADA')}
        ${linea(r.colisiones, 'creadas aparte por serial compartido')}
        ${fijoConteo ? `<li>conteo físico fijado en ${total}</li>` : ''}
      </ul>
      ${hayError ? `<div style="border:1px solid #fecaca; background:#fef2f2; color:#991b1b;
          border-radius:var(--radius-sm); padding:8px; font-size:12.5px; max-height:22vh; overflow:auto;">
          <b>No se pudo con:</b><br>${r.errores.map(e => esc(e)).join('<br>')}</div>` : ''}`,
      `<button class="btn btn-primary" data-action="cerrar">Cerrar</button>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Overlay (mismo patrón que asistente-recibir) ────────────────────────

  function render() {
    document.getElementById('asistenteImportarOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'asistenteImportarOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:720px; width:min(720px, 96vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;">
            <i data-lucide="file-spreadsheet"></i> Importar hoja de bodega</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" id="aiCuerpo" style="padding:14px 10px;"></div>
        <div class="footer" id="aiPie" style="display:flex; justify-content:flex-end; gap:8px;"></div>
      </div>`;
    const kb = (e) => { if (e.key === 'Escape') cerrar(); };
    ctx.kb = kb;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-action="cerrar"]')) cerrar();
    });
    document.addEventListener('keydown', kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    ctx.el = overlay;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cuerpo(html, pie) {
    const c = document.getElementById('aiCuerpo');
    const p = document.getElementById('aiPie');
    if (c) c.innerHTML = html;
    if (p && pie !== undefined) p.innerHTML = pie;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cerrar() {
    if (ctx.busy || !ctx.el) return;
    ctx.el.remove();
    ctx.el = null;
    document.body.style.overflow = '';
    if (ctx.kb) { document.removeEventListener('keydown', ctx.kb); ctx.kb = null; }
  }

  return { abrir, _setModelo, _setColSerial, _usarPegado, _revisar, _toggle,
           _corregirSerial, _excluir, _volver, _aplicar, _parsearCSV: parsearCSV,
           _detectar: detectarColumnas, _pareceSerial: pareceSerial, _ctx: ctx };
})();

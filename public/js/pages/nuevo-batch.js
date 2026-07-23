// @ts-nocheck
    // ── Modelo por serial desde el CONTRATO (fuente de verdad) ──────────────
    // Antes el modelo entraba por POSICIÓN del archivo del vendedor
    // (detallesBatch[i]), lo que desalineaba serial↔modelo si el pegado no seguía
    // el orden exacto del archivo. Ahora, cuando el batch se vincula a un
    // contrato, el modelo de cada serial se resuelve POR SERIAL contra
    // contratos/{id}/seriales — así el modelo del contrato coincide siempre con
    // lo que se registra, sin importar el orden en que se peguen los seriales.
    let modeloById = new Map();              // modelo_id → { modelo, label }
    let modeloContratoPorSerial = new Map(); // serialNorm → { serial, modelo, modelo_id }

    async function cargarModelosCatalogo() {
      try {
        const raw = await ModelosService.getModelos();
        modeloById = new Map((raw || []).map(m => {
          const modelo = (m.modelo || '').toString().trim();
          const marca  = (m.marca  || '').toString().trim();
          return [m.id, { modelo, label: `${marca} ${modelo}`.trim() || modelo }];
        }));
      } catch (e) {
        console.warn('[nuevo-batch] no se pudo cargar el catálogo de modelos:', e);
      }
    }

    // modelo_id (+ fallback de texto) → etiqueta completa "MARCA MODELO".
    function labelModelo(modeloId, modeloFallback) {
      const cat = modeloId ? modeloById.get(modeloId) : null;
      return cat ? cat.label : (modeloFallback || '');
    }

    // Carga el mapa serial→modelo del contrato elegido y pinta el preview. Se
    // llama al cambiar de contrato y (lazy) antes de guardar, para no depender de
    // que el usuario haya pulsado "Jalar seriales".
    async function cargarModeloContrato(contratoDocId) {
      modeloContratoPorSerial = contratoDocId
        ? await ContratosService.getModeloPorSerial(contratoDocId)
        : new Map();
      refrescarPreviews();
      return modeloContratoPorSerial;
    }

    function renderPreviewContrato() {
      const cont = document.getElementById('previewContrato');
      if (!cont) return;
      if (!modeloContratoPorSerial.size) { cont.innerHTML = ''; return; }
      const esc = (s) => String(s ?? '').replace(/</g, '&lt;');
      const filas = Array.from(modeloContratoPorSerial.values())
        .map(v => `<tr><td>${esc(v.serial)}</td><td>${esc(labelModelo(v.modelo_id, v.modelo))}</td></tr>`)
        .join('');
      cont.innerHTML =
        `<table><thead><tr><th>Serial del contrato (${modeloContratoPorSerial.size})</th><th>Modelo</th></tr></thead><tbody>${filas}</tbody></table>`;
    }

    // Resuelve el modelo de un serial: PRIMERO el contrato (por serial,
    // autoritativo); si no está, el archivo del vendedor (posicional, como antes).
    function resolverModeloSerial(serial, detalle) {
      const c = modeloContratoPorSerial.get(String(serial || '').trim().toLowerCase());
      if (c && (c.modelo_id || c.modelo)) {
        const label = labelModelo(c.modelo_id, c.modelo);
        return { modelo_id: c.modelo_id || null, modelo_label: label, modelo: label };
      }
      const label = detalle.modelo_label || detalle.modeloLabel || detalle.modelo || '';
      return { modelo_id: detalle.modelo_id || detalle.modeloId || null, modelo_label: label, modelo: label };
    }

    // Normaliza texto de modelo para comparar (minúsculas, espacios colapsados).
    // Los modelos son ASCII (HYTERA PNC360S-R, HYT-P50…), no hace falta quitar
    // acentos.
    function normModeloTxt(s) {
      return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // modelo_id de una fila del archivo del vendedor: usa modelo_id si es válido;
    // si no, lo resuelve por etiqueta/nombre contra el catálogo.
    function resolverModeloIdJson(detalle) {
      if (detalle.modelo_id && modeloById.has(detalle.modelo_id)) return detalle.modelo_id;
      const txt = normModeloTxt(detalle.modelo_label || detalle.modeloLabel || detalle.modelo || '');
      if (!txt) return '';
      for (const [id, v] of modeloById) {
        if (normModeloTxt(v.label) === txt || normModeloTxt(v.modelo) === txt) return id;
      }
      return '';
    }

    // Reordena el textarea de seriales para que el MODELO de cada serial (según el
    // contrato) coincida, posición a posición, con el orden de modelos del archivo
    // del vendedor — así el nombre/GPS/grupos (que van por posición) caen sobre un
    // serial de su mismo modelo. Requiere archivo cargado + contrato vinculado (para
    // conocer el modelo de cada serial). Los seriales cuyo modelo no aparece en el
    // archivo (o sobrantes) quedan al final.
    function alinearSerialesConJson() {
      const ta = document.getElementById('seriales');
      if (!ta) return;
      const seriales = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!detallesBatch?.length || !modeloContratoPorSerial.size || !seriales.length) return;

      const jsonIds = detallesBatch.map(resolverModeloIdJson);
      const pools = new Map();                 // modelo_id → [seriales], orden estable
      for (const s of seriales) {
        const mid = modeloContratoPorSerial.get(s.toLowerCase())?.modelo_id || '';
        if (!pools.has(mid)) pools.set(mid, []);
        pools.get(mid).push(s);
      }
      const nuevo = [];
      for (const mid of jsonIds) {
        const pool = pools.get(mid);
        if (pool && pool.length) nuevo.push(pool.shift());
      }
      const sobra = [];
      pools.forEach(arr => sobra.push(...arr));
      ta.value = [...nuevo, ...sobra].join('\n');
    }

    // Catálogo de grupos del cliente (para sugerir al agregar y validar). Se carga
    // al elegir/auto-seleccionar el cliente. Puede quedar vacío (cliente sin
    // catálogo) — en ese caso las sugerencias salen solo de los grupos del lote.
    let catalogoGruposCliente = [];
    async function cargarCatalogoGrupos(clienteId) {
      catalogoGruposCliente = [];
      if (!clienteId) return;
      try {
        const cat = await PocService.getCatalogoGrupos(clienteId);
        if (Array.isArray(cat)) catalogoGruposCliente = cat;
      } catch (e) { console.warn('[nuevo-batch] no se pudo cargar el catálogo de grupos:', e); }
    }

    // Clave de modelo de una fila (para "aplicar a todo el modelo").
    function _modeloKeyDe(d) {
      return (d && d.modelo_id) ? d.modelo_id : normModeloTxt(d?.modelo_label || d?.modelo || '');
    }

    // Preview combinado y EDITABLE (lo que se creará): una fila por equipo del
    // archivo, con el serial ya alineado, nombre, modelo, GPS y GRUPOS editables.
    // Marca en rojo desalineación de modelo / serial faltante, y en ámbar las filas
    // SIN grupos. Recepción corrige aquí mismo antes de guardar (chips: agregar/
    // quitar; "a todo el modelo" copia los grupos de la fila a todas las de su
    // modelo — resuelve faltantes y limpia grupos corruptos de un golpe).
    function renderPreviewCombinado() {
      const preview = document.getElementById('previewVendedor');
      if (!preview) return;
      if (!detallesBatch?.length) { preview.innerHTML = ''; return; }
      const seriales = document.getElementById('seriales').value.split('\n').map(s => s.trim()).filter(Boolean);
      const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
      // Cuántos equipos comparten cada modelo (para el botón "copiar a los N …").
      const conteoModelo = {};
      detallesBatch.forEach(d => { const k = _modeloKeyDe(d); conteoModelo[k] = (conteoModelo[k] || 0) + 1; });
      let malCount = 0, faltan = 0, sinGrupos = 0;
      const filas = detallesBatch.map((d, i) => {
        const serial = seriales[i] || '';
        if (!serial) faltan++;
        const c = serial ? modeloContratoPorSerial.get(serial.toLowerCase()) : null;
        const modeloLabel = c ? labelModelo(c.modelo_id, c.modelo) : (d.modelo_label || d.modelo || '—');
        const jsonId = resolverModeloIdJson(d);
        const mal = !!(c && jsonId && c.modelo_id !== jsonId);
        if (mal) malCount++;
        const grupos = Array.isArray(d.grupos) ? d.grupos : [];
        const vacio = grupos.length === 0;
        if (vacio) sinGrupos++;
        // Chips con tooltip (nombre completo) y texto truncado por CSS si es largo.
        const chips = grupos.map((g, gi) =>
          `<span class="gchip" title="${escAttr(g)}"><span class="gchip-txt">${esc(g)}</span>` +
          `<button type="button" class="gchip-x" title="Quitar grupo" onclick="grupoQuitar(${i},${gi})">×</button></span>`
        ).join('');
        const modeloCorto = esc(modeloLabel).replace('HYTERA ', '');
        const sameCount = conteoModelo[_modeloKeyDe(d)] || 1;
        // Control de agregar: input (Enter) + botón "+ agregar". Permite varios seguidos.
        const addCtrl =
          `<span class="gadd-wrap">` +
            `<input class="gadd" id="gadd-${i}" list="catalogoGruposList" placeholder="escribe o elige un grupo…" ` +
              `onkeydown="if(event.key==='Enter'){event.preventDefault();grupoAgregar(${i},this);}">` +
            `<button type="button" class="gadd-btn" title="Agregar el grupo escrito" ` +
              `onclick="grupoAgregar(${i},document.getElementById('gadd-${i}'))">+ agregar</button>` +
          `</span>`;
        // "Copiar a los N del modelo" — solo si la fila ya tiene grupos que copiar.
        const aplicarBtn = grupos.length
          ? `<button type="button" class="gaplicar" ` +
              `title="Copiar estos ${grupos.length} grupo(s) a los ${sameCount} equipos ${escAttr(modeloLabel)}" ` +
              `onclick="grupoAplicarModelo(${i})">⎘ copiar a los ${sameCount} ${modeloCorto}</button>`
          : '';
        const gruposCell =
          `<div class="grupos-edit">` +
            `<div class="gchips-row">${chips || '<span class="falta">— sin grupos —</span>'}</div>` +
            `<div class="gctrl-row">${addCtrl}${aplicarBtn}</div>` +
          `</div>`;
        return `<tr class="${mal ? 'fila-mal' : ''}${vacio ? ' fila-sin-grupos' : ''}">
          <td>${i + 1}</td>
          <td class="mono" title="${escAttr(serial)}">${serial ? esc(serial) : '<span class="falta">— falta —</span>'}</td>
          <td title="${escAttr(d.radio_name || '')}">${esc(d.radio_name || '—')}</td>
          <td title="${escAttr(modeloLabel)}">${esc(modeloLabel)}</td>
          <td>${d.gps ? '✅' : '—'}</td>
          <td class="grupos-cell">${gruposCell}</td>
        </tr>`;
      }).join('');

      // Sugerencias del datalist = catálogo del cliente ∪ grupos ya usados en el lote.
      const usados = new Set(catalogoGruposCliente);
      detallesBatch.forEach(d => (d.grupos || []).forEach(g => usados.add(g)));
      const datalist = `<datalist id="catalogoGruposList">` +
        [...usados].map(g => `<option value="${escAttr(g)}">`).join('') + `</datalist>`;

      const problemas = [];
      if (malCount) problemas.push(`${malCount} sin cuadrar por modelo`);
      if (faltan)   problemas.push(`${faltan} sin serial`);
      if (sinGrupos) problemas.push(`${sinGrupos} sin grupos`);
      const aviso = problemas.length
        ? `<div class="preview-aviso">⚠ ${problemas.join(' · ')}. Corrige abajo antes de guardar — edita los grupos o usa "a todo el modelo" para copiarlos.</div>`
        : `<div class="preview-ok">✅ ${detallesBatch.length} equipos · seriales alineados y grupos completos</div>`;
      preview.innerHTML = `${datalist}${aviso}<table>
        <thead><tr><th>#</th><th>Serial</th><th>Nombre</th><th>Modelo</th><th>GPS</th><th>Grupos (editables)</th></tr></thead>
        <tbody>${filas}</tbody></table>`;
    }

    // ── Edición de grupos en el preview (global para los onclick inline) ──────
    function grupoQuitar(i, gi) {
      const arr = detallesBatch[i] && detallesBatch[i].grupos;
      if (Array.isArray(arr)) { arr.splice(gi, 1); renderPreviewCombinado(); }
    }
    function grupoAgregar(i, inputEl) {
      const val = (inputEl && inputEl.value || '').trim();
      if (!val || !detallesBatch[i]) { if (inputEl) inputEl.focus(); return; }
      if (!Array.isArray(detallesBatch[i].grupos)) detallesBatch[i].grupos = [];
      const arr = detallesBatch[i].grupos;
      const norm = FMT.normalize(val);
      if (!arr.some(g => FMT.normalize(g) === norm)) arr.push(val);
      renderPreviewCombinado();
      // Re-enfoca (y limpia) el mismo input para poder agregar VARIOS grupos seguidos
      // sin volver a hacer clic — el re-render recrea el input, así que hay que
      // volver a enfocarlo por id.
      const inp = document.getElementById('gadd-' + i);
      if (inp) { inp.value = ''; inp.focus(); }
    }
    function grupoAplicarModelo(i) {
      const src = detallesBatch[i];
      if (!src) return;
      const key = _modeloKeyDe(src);
      const grupos = (Array.isArray(src.grupos) ? src.grupos : []).slice();
      let n = 0;
      detallesBatch.forEach(d => { if (_modeloKeyDe(d) === key) { d.grupos = grupos.slice(); n++; } });
      renderPreviewCombinado();
      Toast.show(`Grupos aplicados a ${n} equipo(s) ${src.modelo_label || src.modelo || ''}.`, 'ok');
    }

    // Orquesta los previews: con archivo cargado, alinea los seriales y muestra el
    // combinado (ocultando el simple del contrato); si solo hay contrato, muestra
    // el simple serial→modelo.
    function refrescarPreviews() {
      const pc = document.getElementById('previewContrato');
      if (detallesBatch?.length) {
        alinearSerialesConJson();
        renderPreviewCombinado();
        if (pc) pc.innerHTML = '';
      } else {
        renderPreviewContrato();
        const pv = document.getElementById('previewVendedor');
        if (pv) pv.innerHTML = '';
      }
    }

    async function cargarSelect(ruta, id) {
      const docId = ruta.split('/')[1];
      const snap = await EmpresaService.getDoc(docId);
      const select = document.getElementById(id);
      if (snap) {
        (snap.list || []).forEach(item => {
          const option = new Option(item, item);
          select.appendChild(option);
        });
      }
    }
async function cargarListaSelect(ruta, selectId) {
  const docId = ruta.split('/')[1];
  const snap = await EmpresaService.getDoc(docId);
  const select = document.getElementById(selectId);

  select.innerHTML = '<option value="" disabled selected>Seleccione...</option>';

  if (snap) {
    const lista = snap.list || [];
    lista.sort().forEach(item => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
  }
}

async function mostrarUltimosUnitIDs() {
  const recientes = await PocService.getRecent(5);

  const ul = document.getElementById("ultimosUnitIDs");
  ul.innerHTML = "";

  recientes.forEach(d => {
    const item = document.createElement("li");
    item.textContent = `${d.unit_id || "(sin Unit ID)"} – ${d.radio_name || "(sin nombre)"}`;
    ul.appendChild(item);
  });
}



async function agregarElemento(ruta, selectId, label) {
  const nuevo = prompt(`Nuevo ${label}:`);
  if (nuevo) {
    const docId = ruta.split('/')[1];
    const snap = await EmpresaService.getDoc(docId);
    const lista = snap ? (snap.list || []) : [];
    if (!lista.includes(nuevo)) {
      lista.push(nuevo);
      await EmpresaService.setDoc(docId, { list: lista });
      const option = new Option(nuevo, nuevo);
      const select = document.getElementById(selectId);
      select.appendChild(option);
      select.value = nuevo;
    }
  }
}
async function cargarClientes() {
  const { docs } = await ClientesService.listClientes({ limit: 2000 });
  const select = document.getElementById("cliente");
  select.innerHTML = '<option value="" disabled selected>Seleccione...</option>';
  docs.forEach(d => {
    const option = document.createElement("option");
    option.value = d.id;
    option.textContent = d.nombre;
    option.dataset.ip = d.ip || ""; // IP asignado del cliente (para auto-jalar)
    select.appendChild(option);
  });
}

// Aplica el IP asignado del cliente al <select id="ip">. Si el cliente no tiene
// IP, limpia la selección y muestra el aviso "Sin información de IP".
function aplicarIpDelCliente() {
  const clienteSelect = document.getElementById("cliente");
  const ipSelect = document.getElementById("ip");
  const aviso = document.getElementById("ipSinInfo");
  const ipCliente = (clienteSelect.selectedOptions[0]?.dataset.ip || "").trim();

  if (ipCliente) {
    if (![...ipSelect.options].some(o => o.value === ipCliente)) {
      ipSelect.appendChild(new Option(ipCliente, ipCliente));
    }
    ipSelect.value = ipCliente;
    if (aviso) aviso.style.display = "none";
  } else {
    ipSelect.value = "";
    if (aviso) aviso.style.display = "";
  }
}

// Cambio de cliente (manual o automático desde el JSON): jala el IP y carga los
// contratos del cliente. Async para poder esperar los contratos antes de intentar
// jalar seriales en el flujo automático.
async function onClienteChange() {
  aplicarIpDelCliente();
  const clienteId = document.getElementById("cliente")?.value || "";
  await cargarCatalogoGrupos(clienteId); // sugerencias de grupos al editar el preview
  await cargarContratosDelCliente();
}

// Normaliza nombres para comparar (sin acentos, minúsculas, espacios colapsados).
function normNombreCliente(s) {
  return String(s ?? "").trim().toLowerCase()
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/\s+/g, " ");
}

// ── Vínculo POC ↔ contrato (PLAN_CICLO_VIDA_EQUIPOS.md, conexión POC) ──────
// Carga los contratos vigentes del cliente en el select "contratoJalar". Elegir
// uno vincula el BATCH completo al contrato (contrato_doc_id/contrato_id en
// cada device) y habilita "Jalar seriales" para no re-teclearlos.
async function cargarContratosDelCliente() {
  const sel = document.getElementById("contratoJalar");
  if (!sel) return;
  modeloContratoPorSerial = new Map(); refrescarPreviews(); // nuevo cliente → limpiar binding del contrato anterior
  const clienteId = document.getElementById("cliente")?.value || "";
  if (!clienteId) { sel.innerHTML = '<option value="">Selecciona el cliente primero…</option>'; return; }
  sel.innerHTML = '<option value="">Cargando contratos…</option>';
  try {
    const contratos = await ContratosService.getContratosActivosPorCliente(clienteId);
    sel.innerHTML = contratos.length
      ? '<option value="">Sin vincular a contrato</option>' + contratos.map(c => {
          const label = `${c.contrato_id || c.id} · ${c.tipo_contrato || ''} · ${c.estado || ''}`;
          return `<option value="${c.id}" data-ref="${(c.contrato_id || c.id).replace(/"/g, '&quot;')}">${label.replace(/</g, '&lt;')}</option>`;
        }).join('')
      : '<option value="">El cliente no tiene contratos vigentes</option>';
  } catch (e) {
    console.warn("No se pudieron cargar los contratos del cliente", e);
    sel.innerHTML = '<option value="">No se pudieron cargar los contratos</option>';
  }
}

// Trae los seriales asignados al contrato elegido y los agrega al textarea
// (dedupe contra lo ya pegado). No pisa lo existente: agrega al final.
async function jalarSerialesDesdeContrato() {
  const sel = document.getElementById("contratoJalar");
  const contratoDocId = sel?.value || "";
  if (!contratoDocId) { Toast.show('Elige primero un contrato del cliente.', 'warn'); return; }
  const btn = document.getElementById("btnJalarContrato");
  if (btn) btn.disabled = true;
  try {
    // Trae serial + modelo del contrato (fuente de verdad) y pinta el preview.
    const mapa = await cargarModeloContrato(contratoDocId);
    const conSerial = Array.from(mapa.values()).map(s => String(s.serial || "").trim()).filter(Boolean);
    if (!conSerial.length) { Toast.show('El contrato no tiene seriales asignados todavía.', 'warn'); return; }

    const ta = document.getElementById("seriales");
    const actuales = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    const vistos = new Set(actuales.map(s => s.toLowerCase()));
    const nuevos = conSerial.filter(s => !vistos.has(s.toLowerCase()));
    ta.value = [...actuales, ...nuevos].join('\n');
    refrescarPreviews(); // si hay archivo cargado, alinea los seriales a su orden
    Toast.show(nuevos.length
      ? `${nuevos.length} serial(es) jalados del contrato con su modelo.${conSerial.length - nuevos.length ? ` ${conSerial.length - nuevos.length} ya estaban.` : ''}`
      : 'Todos los seriales del contrato ya estaban en la lista.', nuevos.length ? 'ok' : 'warn');
  } catch (e) {
    console.error("Error jalando seriales del contrato:", e);
    Toast.show('No se pudieron traer los seriales del contrato.', 'bad');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Automatización del batch (menos clics para recepción) ─────────────────
// Al cargar el JSON del vendedor, éste ya trae el cliente: se selecciona solo,
// se jala su IP, se cargan sus contratos, se propone el próximo Unit ID y se
// intentan jalar los seriales del contrato — dejando solo revisar y guardar.

// Selecciona el cliente del JSON en el <select> (por cliente_id; si no, por
// nombre normalizado) y dispara la cascada IP + contratos. Devuelve true si lo
// encontró y seleccionó.
async function autoSeleccionarCliente(clienteId, clienteNombre) {
  const select = document.getElementById("cliente");
  if (!select) return false;
  let opt = clienteId ? [...select.options].find(o => o.value === clienteId) : null;
  if (!opt && clienteNombre) {
    const objetivo = normNombreCliente(clienteNombre);
    opt = [...select.options].find(o => normNombreCliente(o.textContent) === objetivo);
  }
  if (!opt) {
    Toast.show(`El archivo es del cliente "${clienteNombre || clienteId}", que no está en la lista. Selecciónalo o créalo manualmente.`, 'warn');
    return false;
  }
  select.value = opt.value;
  await onClienteChange();   // jala IP + carga contratos (esperado)
  return true;
}

// Propone el próximo Unit ID en el campo, sin pisar lo que el usuario ya escribió.
// Usa el máximo entre los equipos MÁS RECIENTES (no el máximo global: hay clientes
// legacy con numeraciones altas aparte —p.ej. GIRAG en ~8.01M— que no son la
// secuencia corriente). Así continúa el número del último batch creado.
async function proponerProximoUnitId() {
  const input = document.getElementById("unit_id_inicial");
  if (!input || input.value.trim()) return;
  try {
    const snap = await firebase.firestore().collection('poc_devices')
      .orderBy('created_at', 'desc').limit(100).get();
    let max = 0;
    snap.forEach(d => { const n = d.data().unit_id_num; if (typeof n === 'number' && n > max) max = n; });
    if (max > 0) input.value = String(max + 1);
  } catch (e) {
    console.warn('[nuevo-batch] no se pudo proponer el próximo Unit ID:', e);
  }
}

// Intenta elegir el contrato y jalar sus seriales sin intervención. Auto-elige
// solo si es inequívoco: un único contrato vigente, o —con varios— el único cuyo
// número de seriales coincide con la cantidad de equipos del archivo. Si es
// ambiguo, deja el select para que recepción elija. Devuelve el nombre del
// contrato jalado o null.
async function autoJalarContrato(cantidadEsperada) {
  const sel = document.getElementById("contratoJalar");
  if (!sel) return null;
  const opciones = [...sel.options].filter(o => o.value); // contratos reales
  if (!opciones.length) return null;
  let elegido = null;
  if (opciones.length === 1) {
    elegido = opciones[0];
  } else if (cantidadEsperada) {
    const matches = [];
    for (const o of opciones) {
      try {
        const mapa = await ContratosService.getModeloPorSerial(o.value);
        if (mapa.size === cantidadEsperada) matches.push(o);
      } catch (_) {}
    }
    if (matches.length === 1) elegido = matches[0];
  }
  if (!elegido) return null;
  sel.value = elegido.value;
  await jalarSerialesDesdeContrato();   // llena textarea + alinea + preview
  return elegido.getAttribute("data-ref") || elegido.value;
}


    // Data-sanity validator + normalize-on-write: trim/whitespace-collapse,
    // accent+case insensitive dedup, drop the magnifying-glass placeholder and
    // single-symbol noise that older imports occasionally carried.
    function limpiarGrupos(grupos = []) {
      const sane = (grupos || [])
        .map(g => FMT.normalizeGrupo(g))
        .filter(g =>
          g !== "" &&
          g !== "🔍" &&
          !/^[🔍]+$/.test(g) &&
          g.length > 1
        );
      return FMT.dedupGrupos(sane);
    }

    document.addEventListener("DOMContentLoaded", async () => {
      firebase.auth().onAuthStateChanged(async user => {
        if (!user) return window.location.href = "/login.html";

        await cargarClientes();
        await cargarListaSelect("empresa/IPs", "ip");
        await mostrarUltimosUnitIDs();
        await cargarModelosCatalogo();
        await proponerProximoUnitId(); // prefill del próximo Unit ID al abrir

        // Auto-jalar el IP asignado del cliente al elegirlo.
        document.getElementById("cliente").addEventListener("change", onClienteChange);
        document.getElementById("btnJalarContrato")?.addEventListener("click", jalarSerialesDesdeContrato);
        // Elegir un contrato liga el modelo por serial (aunque no se pulse "Jalar").
        document.getElementById("contratoJalar")?.addEventListener("change", (e) => cargarModeloContrato(e.target.value || null));
document.getElementById("addCliente").onclick = async () => {
  const nombre = prompt("Ingrese el nombre del nuevo cliente:");
  if (!nombre) return;

  const nombreLimpio = nombre.trim();
  const regexProhibidos = /[\\/\\.#[\\]\\$]/;

  if (regexProhibidos.test(nombreLimpio)) {
    Toast.show('El nombre contiene caracteres no permitidos: / . # [ ]', 'bad');
    return;
  }

  await registrarCliente(nombreLimpio);
  await cargarClientes();

  // Selecciona automáticamente si se encuentra
  const select = document.getElementById("cliente");
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].textContent === nombreLimpio) {
      select.selectedIndex = i;
      break;
    }
  }
  onClienteChange(); // cliente nuevo → sin IP → muestra el aviso

  Toast.show('Cliente registrado y cargado.', 'ok');
};


        document.getElementById("addIP").onclick = () => agregarElemento("empresa/IPs", "ip", "IP");

        // Drag-and-drop para la zona de carga del JSON (el click ya lo maneja el <label>).
        const vendorInput = document.getElementById("vendorJson");
        const dropZone = vendorInput?.closest(".form-file-zone");
        if (dropZone) {
          const cancelar = e => { e.preventDefault(); e.stopPropagation(); };
          ["dragenter", "dragover"].forEach(ev => dropZone.addEventListener(ev, e => {
            cancelar(e);
            dropZone.classList.add("drag-over");
          }));
          ["dragleave", "dragend"].forEach(ev => dropZone.addEventListener(ev, e => {
            cancelar(e);
            dropZone.classList.remove("drag-over");
          }));
          dropZone.addEventListener("drop", e => {
            cancelar(e);
            dropZone.classList.remove("drag-over");
            const file = e.dataTransfer?.files?.[0];
            procesarArchivoJSON(file);
          });
        }


      });

      // Candado anti doble-submit: los lotes de Sociedad Israelita (may/jul-2026)
      // se crearon 2-3 veces por reenvíos del mismo formulario. Mientras un
      // guardado está en curso, cualquier submit adicional se ignora y el botón
      // queda deshabilitado hasta terminar (o hasta fallar una validación).
      let _guardando = false;

      document.getElementById("batchForm").addEventListener("submit", async e => {
        e.preventDefault();
        if (_guardando) return;

        const btnSubmit = document.querySelector('#batchForm button[type="submit"]');
        const bloquear = (v) => { _guardando = v; if (btnSubmit) btnSubmit.disabled = v; };

        const seriales = document.getElementById("seriales").value.trim().split('\n').map(s => s.trim()).filter(s => s);
        const unitIdInicial = parseInt(document.getElementById("unit_id_inicial").value.trim(), 10);

        if (isNaN(unitIdInicial)) {
          Toast.show('Debe ingresar un número válido para Unit ID inicial.', 'bad');
          return;
        }

        if (seriales.length === 0) {
          document.querySelector('.nb-adv')?.setAttribute('open', 'open'); // abre "Editar seriales manualmente"
          Toast.show('No hay seriales. Cárgalos con el archivo (jala del contrato) o ábrelos en "Editar seriales manualmente".', 'bad');
          return;
        }

        const clienteSelect = document.getElementById("cliente");
        const cliente = clienteSelect.value;
        // IP asignado del cliente al cargar la página (para decidir write-back).
        const ipOriginalCliente = (clienteSelect.selectedOptions[0]?.dataset.ip || "").trim();
        const ipElegido = document.getElementById("ip").value.trim();
        await registrarCliente(clienteSelect.selectedOptions[0].textContent);

        if ((detallesBatch || []).length > 0 && detallesBatch.length !== seriales.length) {
          Toast.show(`El archivo JSON tiene ${detallesBatch.length} filas pero ingresaste ${seriales.length} seriales. Deben coincidir para guardar modelo por equipo.`, 'bad');
          return;
        }

        // ✅ Hard-stop: Block save if invalid groups detected in batch
        const gruposInvalidos = (detallesBatch || [])
          .flatMap(d => d.grupos || [])
          .some(g => g === "🔍");

        if (gruposInvalidos) {
          Toast.show('El archivo contiene un grupo inválido (🔍). Corrige el archivo antes de continuar.', 'bad');
          return;
        }

        // ── Validación de duplicados (previene lotes repetidos) ──────────
        // 1) Seriales repetidos dentro del mismo pegado.
        const vistos = new Set(), repetidosLocal = [];
        for (const s of seriales) {
          const k = s.toUpperCase();
          if (vistos.has(k)) repetidosLocal.push(s); else vistos.add(k);
        }
        if (repetidosLocal.length) {
          Toast.show(`Seriales repetidos en la lista: ${repetidosLocal.join(', ')}`, 'bad');
          return;
        }

        bloquear(true);
        try {
          // 2) Seriales que YA existen como equipo no borrado. Para el MISMO
          //    cliente es un re-registro y se bloquea (borra/edita el existente).
          //    Para OTRO cliente solo se avisa (decisión 2026-07-22): el radio
          //    pudo reasignarse por reemplazo/devolución sin que nadie liberara
          //    el device viejo — quien registra confirma y queda a cargo de
          //    depurar el anterior para no dejarlo duplicado.
          const dbq = firebase.firestore();
          const nombreClienteSel = (clienteSelect.selectedOptions[0]?.textContent || '').trim().toUpperCase();
          const mismoCliente = [], otroCliente = [];
          for (let i = 0; i < seriales.length; i += 10) {
            const snap = await dbq.collection('poc_devices')
              .where('serial', 'in', seriales.slice(i, i + 10)).get();
            snap.forEach(doc => {
              const v = doc.data();
              if (v.deleted === true) return;
              const esMismo = v.cliente_id
                ? v.cliente_id === cliente
                : (v.cliente_nombre || v.cliente || '').trim().toUpperCase() === nombreClienteSel;
              (esMismo ? mismoCliente : otroCliente)
                .push(`${v.serial} (${v.cliente_nombre || v.cliente || 'sin cliente'})`);
            });
          }
          if (mismoCliente.length) {
            Toast.show(`Estos seriales ya existen en POC para este cliente: ${mismoCliente.join(', ')}. Si es un re-registro, borra o edita el equipo existente.`, 'bad');
            bloquear(false);
            return;
          }
          if (otroCliente.length) {
            const ok = window.confirm(`Estos seriales figuran en POC con OTRO cliente:\n\n- ${otroCliente.join('\n- ')}\n\nSi el radio se reasignó (reemplazo o devolución), continúa — y luego borra o libera el equipo del cliente anterior para no dejarlo duplicado.\n\n¿Continuar de todos modos?`);
            if (!ok) { bloquear(false); return; }
          }

          // 3) Unit IDs del rango nuevo ya usados por equipos no borrados del
          //    mismo cliente.
          const delCliente = await PocService.getByCliente({ clienteId: cliente, fresh: true });
          const unitsEnUso = new Set(delCliente
            .filter(d => d.deleted !== true)
            .map(d => (d.unit_id ?? '').toString().trim()).filter(Boolean));
          const choques = [];
          for (let i = 0; i < seriales.length; i++) {
            const u = String(unitIdInicial + i);
            if (unitsEnUso.has(u)) choques.push(u);
          }
          if (choques.length) {
            Toast.show(`Estos Unit ID ya están en uso por este cliente: ${choques.join(', ')}. Cambia el Unit ID inicial.`, 'bad');
            bloquear(false);
            return;
          }
        } catch (err) {
          console.error('[nuevo-batch] validación de duplicados falló:', err);
          Toast.show('No se pudo validar duplicados. Revisa tu conexión e intenta de nuevo.', 'bad');
          bloquear(false);
          return;
        }

        // Vínculo POC ↔ contrato: si el batch se asoció a un contrato, cada
        // device lo referencia (contrato_doc_id/contrato_id). Es el ancla que
        // conecta POC con contratos y con el pool de equipos.
        const contratoSel   = document.getElementById("contratoJalar");
        const contratoDocId = contratoSel?.value || null;
        const contratoRef   = contratoDocId
          ? (contratoSel.selectedOptions[0]?.getAttribute("data-ref") || null) : null;

        // Modelo autoritativo por serial: con contrato vinculado, el modelo de
        // cada serial se toma del contrato (no del archivo del vendedor). Carga
        // lazy por si se eligió el contrato sin pulsar "Jalar seriales".
        if (contratoDocId && !modeloContratoPorSerial.size) {
          try { await cargarModeloContrato(contratoDocId); } catch (_) {}
        }

        // Garantía final: alinear los seriales al orden del archivo del vendedor
        // (por modelo) para que nombre/GPS/grupos casen por posición; luego re-leer
        // el textarea ya ordenado y usar ESE orden para crear.
        if (contratoDocId && detallesBatch?.length && modeloContratoPorSerial.size) {
          alinearSerialesConJson();
          renderPreviewCombinado();
        }
        const serialesFinal = document.getElementById("seriales").value
          .split('\n').map(s => s.trim()).filter(Boolean);

        if (contratoDocId && modeloContratoPorSerial.size) {
          const fuera = serialesFinal.filter(s => !modeloContratoPorSerial.has(s.toLowerCase()));
          if (fuera.length) {
            const ok = window.confirm(
              `Estos seriales NO están en el contrato seleccionado:\n\n- ${fuera.join('\n- ')}\n\n` +
              `Se guardarán con el modelo del archivo del vendedor (emparejado por posición), que puede quedar equivocado. ` +
              `Lo ideal es corregir el contrato o el pegado. ¿Continuar de todos modos?`);
            if (!ok) { bloquear(false); return; }
          }
          // Filas donde el modelo del serial no cuadra con el del archivo (nombre
          // potencialmente desalineado): avisar antes de crear.
          if (detallesBatch?.length) {
            let mal = 0;
            for (let i = 0; i < serialesFinal.length; i++) {
              const c = modeloContratoPorSerial.get(serialesFinal[i].toLowerCase());
              const jsonId = resolverModeloIdJson(normalizarDetalleBatch(detallesBatch[i] || {}));
              if (c && jsonId && c.modelo_id !== jsonId) mal++;
            }
            if (mal) {
              const ok = window.confirm(
                `${mal} equipo(s) no cuadran por modelo entre el archivo del vendedor y el contrato — ` +
                `su NOMBRE podría quedar desalineado. Revisa el resumen de abajo. ¿Guardar de todos modos?`);
              if (!ok) { bloquear(false); return; }
            }
          }
        }

        // Candado suave: equipos que quedarían SIN grupos (fuente incompleta, como
        // el JSON de MIDES con los PNC460 vacíos). Se puede completar en el preview
        // con "a todo el modelo"; si aun así se guarda vacío, se avisa.
        if (detallesBatch?.length) {
          const sinGrupos = detallesBatch.filter(d => limpiarGrupos(d.grupos || []).length === 0).length;
          if (sinGrupos) {
            const ok = window.confirm(
              `${sinGrupos} equipo(s) se guardarán SIN grupos. Puedes completarlos en la vista previa ` +
              `(edita los grupos o usa "a todo el modelo"). ¿Guardar de todos modos?`);
            if (!ok) { bloquear(false); return; }
          }
        }

        try {
        for (let i = 0; i < serialesFinal.length; i++) {
         const detalle = normalizarDetalleBatch(detallesBatch?.[i] || {});
         const modeloResuelto = resolverModeloSerial(serialesFinal[i], detalle);
         const data = {
        cliente_id: cliente,
        cliente_nombre: document.getElementById("cliente").selectedOptions[0].textContent,
        contrato_doc_id: contratoDocId,
        contrato_id: contratoRef,
        ip: document.getElementById("ip").value,
        serial: serialesFinal[i],
        unit_id: String(unitIdInicial + i), // Unit ID consecutivo
        unit_id_num: unitIdInicial + i,     // espejo numérico para ordenar
        radio_name: "",
        notas: document.getElementById("notas").value,
        creado_por_uid: firebase.auth().currentUser.uid,
        creado_por_email: firebase.auth().currentUser.email,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        radio_name: detalle.radio_name || "",
        gps: detalle.gps ?? false,
        modelo: modeloResuelto.modelo,
        modelo_id: modeloResuelto.modelo_id,
        modelo_label: modeloResuelto.modelo_label,
        grupos: limpiarGrupos(detalle.grupos || []),
        activo: true,
        deleted: false
        };
          await PocService.addPocDevice(data);
        }

        // Write-back del IP a la ficha del cliente:
        //  - cliente sin IP → guarda el elegido sin preguntar (comportamiento
        //    original).
        //  - cliente CON un IP distinto al elegido → pregunta si corregir la
        //    ficha, para que la corrección no muera en el lote (antes el único
        //    camino era el formulario de Editar Cliente).
        if (cliente && ipElegido && ipElegido !== ipOriginalCliente) {
          let actualizarFicha = !ipOriginalCliente;
          if (!actualizarFicha) {
            actualizarFicha = await Modal.confirm({
              message: `La empresa tiene asignado el IP "${ipOriginalCliente}" y este lote se creó con "${ipElegido}". ¿Actualizar también el IP asignado de la empresa?`,
            });
          }
          if (actualizarFicha) {
            try {
              await ClientesService.updateCliente(cliente, { ip: ipElegido });
            } catch (err) {
              console.warn("[nuevo-batch] no se pudo guardar el IP en el cliente:", err?.code || err);
            }
          }
        }

        Toast.show('Equipos creados correctamente.', 'ok');
        window.location.href = "index.html";
        } catch (err) {
          console.error('[nuevo-batch] error creando equipos:', err);
          Toast.show('Error al crear los equipos. Revisa la lista antes de reintentar (puede haber quedado un lote parcial).', 'bad');
          bloquear(false);
        }
      });
    });

let detallesBatch = [];

function obtenerValor(...valores) {
  for (const valor of valores) {
    if (typeof valor === "string" && valor.trim() !== "") return valor.trim();
    if (valor !== undefined && valor !== null && typeof valor !== "string") return valor;
  }
  return "";
}

function normalizarBooleanGPS(valor) {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor === 1;
  if (typeof valor === "string") {
    const v = valor.trim().toLowerCase();
    return ["true", "1", "si", "sí", "yes", "y", "✅", "🛰️"].includes(v);
  }
  return false;
}

function normalizarDetalleBatch(item = {}) {
  const modeloIdRaw = obtenerValor(
    item.modelo_id,
    item.modeloId,
    item.model_id,
    item.modelId
  );
  const modeloLabelRaw = obtenerValor(
    item.modelo_label,
    item.modeloLabel,
    item.model_label,
    item.modelLabel,
    item.Modelo,
    item.modelo,
    item.model
  );

  return {
    ...item,
    radio_name: obtenerValor(item.radio_name, item.radioName, item.nombre_radio, item.nombreRadio, item.Nombre, item.nombre),
    gps: normalizarBooleanGPS(obtenerValor(item.gps, item.GPS)),
    modelo_id: typeof modeloIdRaw === "string" ? modeloIdRaw.trim() : String(modeloIdRaw || "").trim(),
    modelo_label: typeof modeloLabelRaw === "string" ? modeloLabelRaw.trim() : String(modeloLabelRaw || "").trim(),
    modelo: typeof modeloLabelRaw === "string" ? modeloLabelRaw.trim() : String(modeloLabelRaw || ""),
    grupos: Array.isArray(item.grupos)
      ? item.grupos
      : (typeof item.grupos === "string" ? item.grupos.split(",") : [])
  };
}

function cargarDesdeJSON(input) {
  procesarArchivoJSON(input.files[0]);
  // Permite re-adjuntar el mismo archivo (de lo contrario 'change' no se vuelve a disparar).
  input.value = "";
}

function procesarArchivoJSON(file) {
  if (!file) return;

  const esJson = file.type === "application/json" || /\.json$/i.test(file.name);
  if (!esJson) {
    Toast.show('El archivo debe ser un .json', 'bad');
    return;
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const dataRaw = JSON.parse(e.target.result);
      if (!Array.isArray(dataRaw)) throw "Formato inválido";
      const data = dataRaw.map(normalizarDetalleBatch);
      detallesBatch = data;

      // El JSON del vendedor manda: dispara toda la cascada para que recepción
      // solo revise y guarde.
      //  1) Auto-seleccionar el cliente del archivo → jala IP + carga contratos.
      const clienteOk = await autoSeleccionarCliente(data[0]?.cliente_id || "", data[0]?.cliente_nombre || "");
      //  2) Proponer el próximo Unit ID (si el campo está vacío).
      await proponerProximoUnitId();
      //  3) Intentar jalar los seriales del contrato automáticamente.
      let contratoJalado = null;
      if (clienteOk) {
        try { contratoJalado = await autoJalarContrato(data.length); }
        catch (err) { console.warn('[nuevo-batch] auto-jalar contrato falló:', err); }
      }
      //  4) Pintar el preview combinado (auto-jalar ya lo refresca; esto cubre el
      //     caso sin contrato jalado).
      refrescarPreviews();

      const partes = [`Archivo cargado: ${data.length} equipos`];
      if (clienteOk) partes.push('cliente e IP autocompletados');
      if (contratoJalado) partes.push(`seriales jalados del contrato ${contratoJalado}`);
      else if (clienteOk) partes.push('elige el contrato y jala los seriales');
      Toast.show(partes.join(' · ') + '.', 'ok');
    } catch (err) {
      Toast.show('Error al leer el archivo JSON: ' + err, 'bad');
    }
  };
  reader.readAsText(file);
}

async function registrarCliente(nombreCliente) {
  if (!nombreCliente) return;

  const nombre = nombreCliente.trim();
  if (await ClientesService.existsByNorm("nombre", nombre)) return; // ya existe

  await ClientesService.createCliente({
    nombre,
    fecha_creacion: new Date()
  });
}



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
      renderPreviewContrato();
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

// Auto-jala el IP del cliente seleccionado al <select id="ip">. Si el cliente no
// tiene IP, limpia la selección y muestra el aviso "Sin información de IP".
function onClienteChange() {
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
  cargarContratosDelCliente();
}

// ── Vínculo POC ↔ contrato (PLAN_CICLO_VIDA_EQUIPOS.md, conexión POC) ──────
// Carga los contratos vigentes del cliente en el select "contratoJalar". Elegir
// uno vincula el BATCH completo al contrato (contrato_doc_id/contrato_id en
// cada device) y habilita "Jalar seriales" para no re-teclearlos.
async function cargarContratosDelCliente() {
  const sel = document.getElementById("contratoJalar");
  if (!sel) return;
  modeloContratoPorSerial = new Map(); renderPreviewContrato(); // nuevo cliente → limpiar binding del contrato anterior
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
          Toast.show('Debe ingresar al menos un serial.', 'bad');
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
        if (contratoDocId && modeloContratoPorSerial.size) {
          const fuera = seriales.filter(s => !modeloContratoPorSerial.has(s.toLowerCase()));
          if (fuera.length) {
            const ok = window.confirm(
              `Estos seriales NO están en el contrato seleccionado:\n\n- ${fuera.join('\n- ')}\n\n` +
              `Se guardarán con el modelo del archivo del vendedor (emparejado por posición), que puede quedar equivocado. ` +
              `Lo ideal es corregir el contrato o el pegado. ¿Continuar de todos modos?`);
            if (!ok) { bloquear(false); return; }
          }
        }

        try {
        for (let i = 0; i < seriales.length; i++) {
         const detalle = normalizarDetalleBatch(detallesBatch?.[i] || {});
         const modeloResuelto = resolverModeloSerial(seriales[i], detalle);
         const data = {
        cliente_id: cliente,
        cliente_nombre: document.getElementById("cliente").selectedOptions[0].textContent,
        contrato_doc_id: contratoDocId,
        contrato_id: contratoRef,
        ip: document.getElementById("ip").value,
        serial: seriales[i],
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
  reader.onload = function (e) {
    try {
            const dataRaw = JSON.parse(e.target.result);
          if (!Array.isArray(dataRaw)) throw "Formato inválido";
          const data = dataRaw.map(normalizarDetalleBatch);

      const clienteSelect = document.getElementById("cliente");
      const clienteIdSeleccionado = clienteSelect.value;
      const clienteNombreSeleccionado = clienteSelect.options[clienteSelect.selectedIndex]?.textContent || "";

      if (data.length > 0 && data[0].cliente_id && data[0].cliente_id !== clienteIdSeleccionado) {
        Toast.show('El cliente seleccionado no coincide con el del archivo JSON. Verifica la selección.', 'bad');
        return;
      }

      detallesBatch = data;

      const preview = document.getElementById("previewVendedor");
      preview.className = "file-preview";
      preview.innerHTML = `
        <strong style="color: #155724;">✅ Archivo cargado: ${data.length} equipos detectados</strong>
        <table>
          <thead>
            <tr>
              <th>Nombre del Radio</th>
              <th>Modelo</th>
              <th>GPS</th>
              <th>Grupos</th>
              <th>Cliente Referencia</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(d => `
              <tr>
                <td>${d.radio_name || "—"}</td>
                <td>${d.modelo || "—"}</td>
                <td>${d.gps ? "✅" : "❌"}</td>
                <td>${(d.grupos || []).join(", ") || "—"}</td>
                <td>${d.cliente_nombre || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      
      Toast.show('Archivo cargado correctamente. Puedes continuar pegando los seriales y eligiendo el cliente correcto.', 'ok');
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



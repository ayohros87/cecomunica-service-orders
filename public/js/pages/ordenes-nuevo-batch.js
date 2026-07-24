// @ts-nocheck
// Nuevo batch de equipos — página dedicada para cargar muchos equipos a una
// orden de una sola vez. Siempre va asociada a una orden (?orden_id=…).
//
// Flujo:
//   • "Jalar desde POC" trae los seriales del cliente Y su modelo reconocido
//     automáticamente, una fila por equipo.
//   • "Agregar a la tabla" suma filas desde seriales pegados.
//   • Cada fila es editable (serial · modelo · accesorios · observaciones).
//   • "Guardar todos" agrega los equipos a la orden.

let modelos = [];

let ordenId = "";
let clienteId = "";
let clienteNombre = "";
let contratoDocId = "";      // contrato vinculado a la orden (si aplica)
let contratoIdVisible = "";
// serialLower -> { serial, modelo, modelo_id } del contrato. Es la verdad del
// modelo por serial: la tabla la muestra por fila y avisa cuando no coincide.
let contratoSeriales = new Map();

let filaSeq = 0;

// Escapes mínimos para inyectar valores de usuario en el markup de la fila.
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const normName = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/\s+/g, " ");

const $ = (id) => document.getElementById(id);

async function cargarModelos() {
  const raw = await ModelosService.getModelos();
  modelos = raw
    .map(m => ({ id: m.id, nombre: (m.modelo || m.nombre || "(sin nombre)").trim() }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

function modelOptionsHtml(selectedId = "") {
  return `<option value="">Seleccione modelo</option>` +
    modelos.map(m => `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${escHtml(m.nombre)}</option>`).join('');
}

async function cargarOrden() {
  ordenId = new URLSearchParams(window.location.search).get("orden_id") || "";
  if (!ordenId) {
    Toast.show("Falta el número de orden. Abre el batch desde una orden.", "bad");
    return;
  }
  $("ordenNumero").value = ordenId;

  const data = await OrdenesService.getOrder(ordenId);
  if (!data) {
    Toast.show("No se encontró la orden " + ordenId, "bad");
    return;
  }

  let nombreCliente = "";
  if (typeof data.cliente === "string" && data.cliente) {
    nombreCliente = data.cliente;
  } else if (data.cliente?.nombre) {
    nombreCliente = data.cliente.nombre;
  } else if (data.cliente_id) {
    try {
      const cli = await ClientesService.getCliente(data.cliente_id);
      if (cli) nombreCliente = cli.nombre || "";
    } catch (e) {
      console.error("Error cargando cliente:", e);
    }
  }

  clienteNombre = nombreCliente;
  clienteId = data.cliente_id || "";
  $("cliente").value = nombreCliente || "—";
  $("tipo").value = data.tipo_de_servicio || data.tipo || "";

  // Orden con contrato vinculado (PROGRAMACIÓN) → ofrecer "Jalar del contrato".
  contratoDocId = (data.contrato?.aplica && data.contrato?.contrato_doc_id) ? data.contrato.contrato_doc_id : "";
  contratoIdVisible = data.contrato?.contrato_id || "";
  const btnContrato = $("btnJalarContrato");
  if (btnContrato && contratoDocId) btnContrato.style.display = "";

  // Seriales del contrato (serial -> modelo): permite mostrar "Según el contrato"
  // por fila y avisar de desajustes antes de guardar.
  if (contratoDocId) {
    try { contratoSeriales = await ContratosService.getModeloPorSerial(contratoDocId); }
    catch (e) { console.warn("No se pudieron cargar los seriales del contrato:", e); }
  }

  // Modelo común (defaults para filas pegadas / "aplicar a todas").
  $("comunModelo").innerHTML = `<option value="">— Sin modelo —</option>` +
    modelos.map(m => `<option value="${m.id}">${escHtml(m.nombre)}</option>`).join('');
}

// Conjunto de seriales (en minúsculas) ya presentes en la tabla, para deduplicar.
function serialesActuales() {
  const set = new Set();
  document.querySelectorAll("#filasBatch tr").forEach(tr => {
    const v = tr.querySelector(".serie")?.value.trim().toLowerCase();
    if (v) set.add(v);
  });
  return set;
}

function addRow({ serial = "", modeloId = "", accesorios = {}, observaciones = "", focus = false } = {}) {
  const acc = accesorios || {};
  const id = `fila_${filaSeq++}`;
  const tr = document.createElement("tr");
  tr.id = id;
  tr.innerHTML = `
    <td class="batch-num"><span class="rowdot" title=""></span><span class="num"></span></td>
    <td><input type="text" class="serie table-input sm" value="${escAttr(serial)}" placeholder="Serial"></td>
    <td><select class="modelo table-select">${modelOptionsHtml(modeloId)}</select></td>
    <td class="contrato-cell"></td>
    <td>
      <div class="batch-acc">
        <label title="Batería"><input type="checkbox" class="bateria" ${acc.bateria ? 'checked' : ''}> Bat</label>
        <label title="Clip"><input type="checkbox" class="clip" ${acc.clip ? 'checked' : ''}> Clip</label>
        <label title="Cargador"><input type="checkbox" class="cargador" ${acc.cargador ? 'checked' : ''}> Carg</label>
        <label title="Fuente"><input type="checkbox" class="fuente" ${acc.fuente ? 'checked' : ''}> Fte</label>
        <label title="Antena"><input type="checkbox" class="antena" ${acc.antena ? 'checked' : ''}> Ant</label>
        <label title="Cubre Polvo"><input type="checkbox" class="cubrepolvo" ${acc.cubrepolvo ? 'checked' : ''}> CPolvo</label>
      </div>
    </td>
    <td><input type="text" class="observaciones table-input sm" value="${escAttr(observaciones)}" placeholder="Observaciones"></td>
    <td class="batch-acciones"><button type="button" class="btn btn-ghost btn-sm" title="Eliminar fila" onclick="eliminarFila(this)"><i data-lucide="trash-2"></i></button></td>
  `;
  $("filasBatch").appendChild(tr);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  renumber();
  if (focus) tr.querySelector(".serie")?.focus();
  return tr;
}

window.eliminarFila = (btn) => {
  btn.closest("tr")?.remove();
  renumber();
};

function renumber() {
  const filas = document.querySelectorAll("#filasBatch tr");
  filas.forEach((tr, i) => { const n = tr.querySelector(".batch-num .num"); if (n) n.textContent = i + 1; });
  $("emptyBatch").style.display = filas.length ? "none" : "";
  $("tablaWrap").style.display = filas.length ? "" : "none";
  $("contadorBatch").textContent = filas.length ? `${filas.length} equipo(s)` : "";
  if (!filas.length) mostrarOrigenEquipos("");
  refrescarContrato();
}

// ── Validación visual contra el contrato ──────────────────────────────────
// El contrato define qué modelo es cada serial. Por fila mostramos ese modelo,
// marcamos el estado (coincide / variante X-vs-X-R / distinto / falta / fuera del
// contrato) y ofrecemos "usar" para corregir. Antes esto se corregía en silencio
// al guardar; ahora el técnico lo ve y decide.
const baseModelo = (s) => normName(s).replace(/-r$/, "").replace(/\s*pro$/, "").trim();

function modeloIdDeContrato(c) {
  if (!c) return "";
  const idsValidos = new Set(modelos.map(m => m.id));
  if (c.modelo_id && idsValidos.has(c.modelo_id)) return c.modelo_id;
  const porNombre = new Map(modelos.map(m => [normName(m.nombre), m.id]));
  return porNombre.get(normName(c.modelo || "")) || "";
}

function refrescarContrato() {
  const filas = Array.from(document.querySelectorAll("#filasBatch tr"));
  const hayContrato = contratoSeriales.size > 0;
  const btnUsar = `<button type="button" class="c-usar" title="Poner el modelo que dice el contrato" onclick="usarModeloContrato(this)">usar</button>`;
  let ok = 0, variante = 0, distinto = 0, sinModelo = 0, fuera = 0;

  filas.forEach(tr => {
    const serial   = (tr.querySelector(".serie")?.value || "").trim();
    const modeloId = tr.querySelector(".modelo")?.value || "";
    const celda = tr.querySelector(".contrato-cell");
    const dot   = tr.querySelector(".rowdot");
    const sel   = tr.querySelector(".modelo");
    tr.classList.remove("fila-warn", "fila-bad");
    if (sel) sel.classList.remove("falta");
    let estado = "", html = '<span class="c-muted">—</span>', titulo = "";

    if (!hayContrato)      { html = '<span class="c-muted">sin contrato</span>'; }
    else if (!serial)      { html = '<span class="c-muted">—</span>'; }
    else {
      const c = contratoSeriales.get(serial.toLowerCase());
      if (!c) {
        estado = "warn"; fuera++;
        html = '<span class="c-tag warn">no está en el contrato</span>';
        titulo = "Este serial no aparece en el contrato de la orden";
      } else {
        const nombreEsperado = escHtml(c.modelo || "");
        const esperado = modeloIdDeContrato(c);
        if (!modeloId) {
          estado = "bad"; sinModelo++;
          if (sel) sel.classList.add("falta");
          html = `<span class="c-val">${nombreEsperado}</span><span class="c-tag bad">falta</span>${btnUsar}`;
          titulo = "Sin modelo — el contrato dice " + (c.modelo || "");
        } else if (esperado && modeloId === esperado) {
          estado = "ok"; ok++;
          html = `<span class="c-val">${nombreEsperado}</span><span class="c-tag ok">coincide</span>`;
          titulo = "Coincide con el contrato";
        } else {
          const actual = modelos.find(m => m.id === modeloId)?.nombre || "";
          const esVar = baseModelo(actual) === baseModelo(c.modelo || "");
          if (esVar) { estado = "warn"; variante++; } else { estado = "bad"; distinto++; }
          html = `<span class="c-val">${nombreEsperado}</span>` +
                 `<span class="c-tag ${esVar ? "warn" : "bad"}">${esVar ? "variante" : "distinto"}</span>${btnUsar}`;
          titulo = esVar ? "Misma familia, distinta variante (X / X-R)" : "El contrato dice otro modelo";
        }
      }
    }

    if (celda) celda.innerHTML = html;
    if (dot) { dot.className = "rowdot" + (estado ? " " + estado : ""); dot.title = titulo; }
    if (estado === "warn") tr.classList.add("fila-warn");
    if (estado === "bad")  tr.classList.add("fila-bad");
  });

  const resumen = $("resumenContrato");
  if (resumen) {
    if (!hayContrato || !filas.length) resumen.innerHTML = "";
    else {
      const partes = [`<span class="c-pill ok">● ${ok} coinciden</span>`];
      if (variante)  partes.push(`<span class="c-pill warn">▲ ${variante} variante (X / X-R)</span>`);
      if (distinto)  partes.push(`<span class="c-pill bad">▲ ${distinto} modelo distinto</span>`);
      if (sinModelo) partes.push(`<span class="c-pill bad">▲ ${sinModelo} sin modelo</span>`);
      if (fuera)     partes.push(`<span class="c-pill warn">▲ ${fuera} fuera del contrato</span>`);
      resumen.innerHTML = partes.join("");
    }
  }
  const n = variante + distinto + sinModelo;
  const btnBulk = $("btnUsarContrato");
  if (btnBulk) {
    btnBulk.style.display = (hayContrato && n) ? "" : "none";
    btnBulk.innerHTML = `<i data-lucide="wand-2"></i> Usar los del contrato en los ${n} que no coinciden`;
    if (typeof lucide !== "undefined") lucide.createIcons();
  }
}

// Pone en la fila el modelo que dice el contrato para su serial.
window.usarModeloContrato = (btn) => {
  const tr = btn?.closest("tr");
  if (!tr) return;
  const serial = (tr.querySelector(".serie")?.value || "").trim();
  const id = modeloIdDeContrato(contratoSeriales.get(serial.toLowerCase()));
  if (!id) { Toast.show("El modelo que indica el contrato no está en el catálogo de modelos.", "warn"); return; }
  const sel = tr.querySelector(".modelo");
  if (sel) sel.value = id;
  refrescarContrato();
};

// Corrige de golpe todas las filas que no coinciden con el contrato.
window.usarContratoEnTodos = () => {
  let n = 0;
  document.querySelectorAll("#filasBatch tr").forEach(tr => {
    const serial = (tr.querySelector(".serie")?.value || "").trim();
    const id = modeloIdDeContrato(contratoSeriales.get(serial.toLowerCase()));
    const sel = tr.querySelector(".modelo");
    if (id && sel && sel.value !== id) { sel.value = id; n++; }
  });
  refrescarContrato();
  Toast.show(n ? `${n} modelo(s) ajustados al del contrato.` : "Todos ya coincidían con el contrato.", n ? "ok" : "warn");
};

window.agregarFila = () => addRow({ focus: true });

// Trae los seriales asignados al CONTRATO vinculado a la orden (subcolección
// contratos/{id}/seriales) — el caso típico de una orden de PROGRAMACIÓN para
// entrega: los seriales ya se eligieron en el contrato y aquí no se re-teclean.
// El modelo entra por modelo_id del contrato (misma FK del catálogo) o, en su
// defecto, por nombre normalizado.
window.jalarSerialesDesdeContrato = async () => {
  if (!contratoDocId) { Toast.show("La orden no tiene contrato vinculado.", "warn"); return; }
  const btn = $("btnJalarContrato");
  if (btn) btn.disabled = true;
  try {
    const seriales = await ContratosService.getSerialesManual(contratoDocId);
    const conSerial = (seriales || []).filter(s => String(s.serial || "").trim());
    if (!conSerial.length) { Toast.show("El contrato no tiene seriales asignados todavía.", "warn"); return; }

    const modeloPorNombre = new Map(modelos.map(m => [normName(m.nombre), m.id]));
    const idsValidos = new Set(modelos.map(m => m.id));
    const presentes = serialesActuales();
    let agregados = 0, omitidos = 0;
    for (const s of conSerial) {
      const serial = String(s.serial).trim();
      const key = serial.toLowerCase();
      if (presentes.has(key)) { omitidos++; continue; }
      const modeloId = (s.modelo_id && idsValidos.has(s.modelo_id))
        ? s.modelo_id
        : (modeloPorNombre.get(normName(s.modelo || "")) || "");
      addRow({ serial, modeloId });
      presentes.add(key);
      agregados++;
    }
    if (agregados) mostrarOrigenEquipos(`Jalado del contrato${contratoIdVisible ? ` ${contratoIdVisible}` : ""}`);
    let msg = `${agregados} equipo(s) jalados del contrato.`;
    if (omitidos) msg += ` ${omitidos} ya estaban en la tabla.`;
    Toast.show(agregados ? msg : "Esos seriales ya estaban en la tabla.", agregados ? "ok" : "warn");
  } catch (e) {
    console.error("Error jalando seriales del contrato:", e);
    Toast.show("No se pudieron traer los seriales del contrato.", "bad");
  } finally {
    if (btn) btn.disabled = false;
  }
};

// Enforcement del modelo del contrato: con una orden vinculada a contrato, el
// modelo de cada serial es el del contrato (contratos/{id}/seriales), no el que
// quedó en la tabla. Corrige por serial cualquier modelo que no coincida y
// devuelve los seriales que no pertenecen al contrato para avisar. Es la contra-
// parte del arreglo de POC: en ambos flujos el modelo se liga por serial, no por
// posición ni por elección manual suelta.
async function enforceContratoModelos() {
  if (!contratoDocId) return { corregidos: 0, fuera: [] };
  let mapa;
  try {
    mapa = await ContratosService.getModeloPorSerial(contratoDocId);
  } catch (e) {
    console.warn("No se pudo cargar el modelo por serial del contrato:", e);
    return { corregidos: 0, fuera: [] };
  }
  if (!mapa.size) return { corregidos: 0, fuera: [] };

  const modeloPorNombre = new Map(modelos.map(m => [normName(m.nombre), m.id]));
  const idsValidos = new Set(modelos.map(m => m.id));
  let corregidos = 0;
  const fuera = [];
  document.querySelectorAll("#filasBatch tr").forEach(tr => {
    const serial = tr.querySelector(".serie")?.value.trim();
    if (!serial) return;
    const c = mapa.get(serial.toLowerCase());
    if (!c) { fuera.push(serial); return; }
    const catId = (c.modelo_id && idsValidos.has(c.modelo_id))
      ? c.modelo_id
      : (modeloPorNombre.get(normName(c.modelo || "")) || "");
    const sel = tr.querySelector(".modelo");
    if (catId && sel && sel.value !== catId) { sel.value = catId; corregidos++; }
  });
  return { corregidos, fuera };
}

// Trae los seriales del cliente desde POC. Un cliente puede tener cientos de
// equipos acumulados de importaciones viejas, pero al crear una orden normalmente
// solo interesan los del ÚLTIMO batch importado. Por eso, en vez de volcar TODO,
// detecta los batches de importación (equipos creados en la misma sesión,
// agrupados por cercanía de `created_at`) y deja elegir cuál jalar — el último
// importado aparece primero. "Jalar todos" conserva el comportamiento anterior.
window.jalarSerialesDesdePoc = async () => {
  if (typeof PocService === "undefined") { Toast.show("POC no está disponible.", "bad"); return; }
  if (!clienteId && !clienteNombre) { Toast.show("La orden no tiene un cliente asociado para buscar en POC.", "warn"); return; }

  const btn = $("btnJalarPoc");
  if (btn) btn.disabled = true;
  try {
    let devices = await PocService.getByCliente({ clienteId, clienteNombre });
    devices = (devices || []).filter(d => d.deleted !== true && String(d.serial || "").trim());
    if (!devices.length) { Toast.show("No hay equipos en POC para este cliente.", "warn"); return; }

    const batches = agruparDevicesPorBatch(devices);

    // Un solo batch: no hay nada que elegir, jala directo.
    let seleccion, origen;
    if (batches.length <= 1) {
      seleccion = devices;
      origen = origenDeBatch(batches[0]);
    } else {
      const elegido = await abrirSelectorBatchPoc(batches, devices.length);
      if (elegido === null) return;                       // cancelado
      if (elegido === "__todos__") { seleccion = devices; origen = "todos los batches"; }
      else { seleccion = elegido.devices; origen = origenDeBatch(elegido); }
    }

    volcarDevicesEnTabla(seleccion, origen);
  } catch (e) {
    console.error("Error consultando POC:", e);
    Toast.show("No se pudo consultar POC.", "bad");
  } finally {
    if (btn) btn.disabled = false;
  }
};

// created_at (Firestore Timestamp | Date | epoch) → milisegundos. 0 si falta.
function deviceMillis(d) {
  const t = d?.created_at;
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? 0 : n;
}

// Detecta los "batches" de importación de un cliente agrupando los equipos por
// cercanía de `created_at`: los de una misma importación se crean en ráfaga
// (segundos), mientras que entre dos importaciones distintas hay horas o días de
// diferencia. Recorre los equipos del más nuevo al más viejo y abre un corte
// nuevo cuando el salto entre dos consecutivos supera BATCH_GAP_MS. Devuelve los
// batches del más reciente al más viejo, cada uno etiquetado con su fecha.
const BATCH_GAP_MS = 2 * 60 * 60 * 1000; // 2 h
function agruparDevicesPorBatch(devices) {
  const ordenados = devices
    .map(d => ({ d, ms: deviceMillis(d) }))
    .sort((a, b) => b.ms - a.ms);

  const batches = [];
  let actual = null;
  let prevMs = null;
  for (const { d, ms } of ordenados) {
    if (actual === null || (prevMs - ms) > BATCH_GAP_MS) {
      actual = { devices: [], maxTs: d.created_at || null };
      batches.push(actual);
    }
    actual.devices.push(d);
    prevMs = ms;
  }

  batches.forEach(b => { b.nombre = b.maxTs ? FMT.date(b.maxTs) : "Sin fecha"; });
  return batches;
}

// Descriptor legible del batch jalado (para la nota de origen). Vacío si no hay
// fecha utilizable; en ese caso la nota solo dirá "POC".
function origenDeBatch(batch) {
  const fecha = batch?.nombre && batch.nombre !== "Sin fecha" ? batch.nombre : "";
  return fecha ? `batch del ${fecha}` : "";
}

// Pinta (o esconde) la nota persistente de "de dónde se jalaron los equipos",
// análoga a la anotación de origen en contratos-seriales.
function mostrarOrigenEquipos(texto) {
  const el = $("origenEquipos");
  const txt = $("origenEquiposTexto");
  if (!el || !txt) return;
  if (texto) { txt.textContent = texto; el.style.display = ""; }
  else { el.style.display = "none"; }
}

// Vuelca una lista de devices POC en la tabla: una fila por equipo con su
// serial Y el modelo reconocido automáticamente. Deduplica contra la tabla.
function volcarDevicesEnTabla(devices, origen = "") {
  const modeloPorNombre = new Map(modelos.map(m => [normName(m.nombre), m.id]));
  const yaPresentes = serialesActuales();

  let agregados = 0, reconocidos = 0, omitidos = 0;
  (devices || []).forEach(d => {
    const serial = String(d.serial || "").trim();
    if (!serial) return;
    if (yaPresentes.has(serial.toLowerCase())) { omitidos++; return; }
    const modeloId = modeloPorNombre.get(normName(d.modelo_label || d.modelo || "")) || "";
    if (modeloId) reconocidos++;
    addRow({ serial, modeloId });
    yaPresentes.add(serial.toLowerCase());
    agregados++;
  });

  // Nota persistente = solo el ORIGEN (de dónde se jaló). El conteo va en el
  // Toast: meterlo aquí choca con el contador del header tras un segundo jalado.
  if (agregados) {
    const partes = ["Jalado desde POC"];
    if (origen) partes.push(origen);
    mostrarOrigenEquipos(partes.join(" · "));
  }

  let msg = `${agregados} equipo(s) jalados desde POC · ${reconocidos} con modelo reconocido.`;
  if (omitidos) msg += ` ${omitidos} ya estaban en la tabla.`;
  Toast.show(agregados ? msg : "Esos seriales ya estaban en la tabla.", agregados ? "ok" : "warn");
}

// Modal para elegir el batch de importación a jalar. Resuelve con el batch
// elegido, la cadena "__todos__", o null si se cancela. Construido a mano (no hay
// picker de lista en Modal) siguiendo el patrón de Modal.confirm.
function abrirSelectorBatchPoc(batches, total) {
  return new Promise(resolve => {
    const filas = batches.map((b, i) => `
      <button type="button" class="lote-item" data-idx="${i}">
        <span class="lote-nombre">${escHtml(b.nombre)}${i === 0 ? ' <span class="lote-badge">último</span>' : ''}</span>
        <span class="lote-meta">${b.devices.length} equipo(s)</span>
      </button>`).join("");

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="sheet-header"><h3 class="sheet-title">Jalar equipos desde POC</h3></div>
        <div class="sheet-body" style="padding:12px 8px">
          <p style="margin:0 0 10px;font-size:14px;color:var(--fg-3)">Elige el batch de importación a jalar. El último importado aparece primero; solo se jalarán los equipos de ese batch.</p>
          <div class="lote-list">${filas}</div>
        </div>
        <div class="footer">
          <button class="btn btn-ghost" data-action="cancel">Cancelar</button>
          <button class="btn btn-secondary" data-action="todos">Jalar todos (${total})</button>
        </div>
      </div>`;

    const cleanup = (result) => {
      overlay.remove();
      document.body.style.overflow = "";
      document.removeEventListener("keydown", kb);
      resolve(result);
    };
    const kb = (e) => { if (e.key === "Escape") cleanup(null); };
    overlay.addEventListener("click", (e) => {
      const item = e.target.closest(".lote-item");
      if (item) { cleanup(batches[Number(item.dataset.idx)]); return; }
      const action = e.target.closest("[data-action]")?.dataset?.action;
      if (action === "todos") cleanup("__todos__");
      else if (action === "cancel" || e.target === overlay) cleanup(null);
    });

    document.addEventListener("keydown", kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    if (typeof lucide !== "undefined") lucide.createIcons();
  });
}

// Agrega filas desde el textarea de seriales pegados, aplicando los valores
// comunes (modelo / accesorios / observaciones) como defaults editables.
window.agregarDesdePegado = () => {
  const lineas = $("pegarSeriales").value.split("\n").map(s => s.trim()).filter(Boolean);
  if (!lineas.length) { Toast.show("Pega al menos un serial.", "warn"); return; }

  const yaPresentes = serialesActuales();
  const defaults = leerComunes();

  let agregados = 0, duplicados = 0;
  lineas.forEach(serial => {
    const k = serial.toLowerCase();
    if (yaPresentes.has(k)) { duplicados++; return; }
    yaPresentes.add(k);
    addRow({ serial, modeloId: defaults.modeloId, accesorios: defaults.accesorios, observaciones: defaults.observaciones });
    agregados++;
  });

  $("pegarSeriales").value = "";
  let msg = `${agregados} fila(s) agregadas.`;
  if (duplicados) msg += ` ${duplicados} serial(es) duplicado(s) omitido(s).`;
  Toast.show(msg, agregados ? "ok" : "warn");
};

function leerComunes() {
  return {
    modeloId: $("comunModelo").value || "",
    accesorios: {
      bateria:  $("comunBateria").checked,
      clip:     $("comunClip").checked,
      cargador: $("comunCargador").checked,
      fuente:   $("comunFuente").checked,
      antena:   $("comunAntena").checked,
      cubrepolvo: $("comunCubrePolvo").checked,
    },
    observaciones: $("comunObs").value.trim(),
  };
}

// Aplica los valores comunes a las filas existentes:
//   • Modelo: solo a filas SIN modelo (respeta los reconocidos por POC).
//   • Accesorios: marca los seleccionados en todas las filas (no desmarca).
//   • Observaciones: solo a filas con observaciones vacías.
window.aplicarComunes = () => {
  const filas = document.querySelectorAll("#filasBatch tr");
  if (!filas.length) { Toast.show("No hay filas a las que aplicar.", "warn"); return; }

  const { modeloId, accesorios, observaciones } = leerComunes();
  filas.forEach(tr => {
    const sel = tr.querySelector(".modelo");
    if (modeloId && sel && !sel.value) sel.value = modeloId;
    if (accesorios.bateria)  tr.querySelector(".bateria").checked = true;
    if (accesorios.clip)     tr.querySelector(".clip").checked = true;
    if (accesorios.cargador) tr.querySelector(".cargador").checked = true;
    if (accesorios.fuente)   tr.querySelector(".fuente").checked = true;
    if (accesorios.antena)   tr.querySelector(".antena").checked = true;
    if (accesorios.cubrepolvo) tr.querySelector(".cubrepolvo").checked = true;
    const obs = tr.querySelector(".observaciones");
    if (observaciones && obs && !obs.value.trim()) obs.value = observaciones;
  });
  Toast.show("Valores comunes aplicados a las filas.", "ok");
};

window.guardarBatch = async () => {
  if (!ordenId) { Toast.show("Falta el número de orden.", "bad"); return; }

  // Con contrato vinculado, el modelo del contrato manda por serial: corrige en
  // la tabla cualquier modelo que no coincida y avisa de seriales ajenos ANTES
  // de leer las filas (así se guardan ya corregidas).
  if (contratoDocId) {
    const { corregidos, fuera } = await enforceContratoModelos();
    if (fuera.length) {
      const ok = window.confirm(
        `Estos seriales NO están en el contrato vinculado a la orden:\n\n- ${fuera.join("\n- ")}\n\n` +
        `Se guardarán con el modelo elegido en la tabla. ¿Continuar de todos modos?`);
      if (!ok) return;
    }
    if (corregidos) Toast.show(`${corregidos} modelo(s) ajustados al del contrato.`, "ok");
  }

  const filas = Array.from(document.querySelectorAll("#filasBatch tr"));
  const nuevosEquipos = [];

  for (const tr of filas) {
    const serial = tr.querySelector(".serie").value.trim();
    const modeloId = tr.querySelector(".modelo").value;
    const bateria  = tr.querySelector(".bateria").checked;
    const clip     = tr.querySelector(".clip").checked;
    const cargador = tr.querySelector(".cargador").checked;
    const fuente   = tr.querySelector(".fuente").checked;
    const antena   = tr.querySelector(".antena").checked;
    const cubrepolvo = tr.querySelector(".cubrepolvo").checked;
    const observaciones = tr.querySelector(".observaciones").value.trim();

    // Fila totalmente vacía: se ignora.
    if (!serial && !modeloId && !bateria && !clip && !cargador && !fuente && !antena && !cubrepolvo && !observaciones) continue;

    // Una fila con datos pero sin serial no se puede guardar.
    if (!serial) {
      Toast.show("Hay una fila sin serial. Complétala o elimínala.", "warn");
      tr.querySelector(".serie")?.focus();
      return;
    }

    nuevosEquipos.push(EquipoNormalize.normalize({
      id: crypto.randomUUID(),
      modelo_id: modeloId || "",
      modelo: modelos.find(m => m.id === modeloId)?.nombre || "",
      serial,
      // Alias de escritura mantenido mientras los lectores consolidan en `serial`.
      numero_de_serie: serial,
      bateria, clip, cargador, fuente, antena, cubrepolvo,
      observaciones: observaciones || "sin observaciones",
    }));
  }

  if (!nuevosEquipos.length) { Toast.show("Agrega al menos un equipo con serial.", "warn"); return; }

  const btn = $("btnGuardar");
  if (btn) btn.disabled = true;
  try {
    const ordenData = await OrdenesService.getOrder(ordenId);
    if (!ordenData) { Toast.show("No se encontró la orden.", "bad"); if (btn) btn.disabled = false; return; }
    const equiposExistentes = ordenData.equipos || [];

    // La tabla deduplica contra sí misma, pero no contra lo YA guardado en la
    // orden — un segundo guardado con las mismas filas duplicaría seriales.
    const presentesEnOrden = new Set(
      equiposExistentes
        .filter(e => !e.eliminado)
        .map(e => String(e.serial || e.numero_de_serie || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const aGuardar = nuevosEquipos.filter(e => !presentesEnOrden.has(String(e.serial).trim().toLowerCase()));
    const omitidos = nuevosEquipos.length - aGuardar.length;

    if (!aGuardar.length) {
      Toast.show(`Esos ${omitidos} serial(es) ya están guardados en la orden — nada que agregar.`, "warn");
      if (btn) btn.disabled = false;
      return;
    }

    await OrdenesService.updateOrder(ordenId, { equipos: [...equiposExistentes, ...aGuardar] });

    let msg = `✅ Se guardaron ${aGuardar.length} equipo(s) en la orden.`;
    if (omitidos) msg += ` ${omitidos} ya estaban guardados.`;
    Toast.show(msg, "ok");
    setTimeout(() => { window.location.href = "index.html"; }, 1200);
  } catch (e) {
    console.error("Error guardando batch:", e);
    Toast.show("No se pudieron guardar los equipos.", "bad");
    if (btn) btn.disabled = false;
  }
};

function wireComunTodos() {
  const todos = $("comunTodos");
  if (!todos) return;
  todos.addEventListener("change", function () {
    ["comunBateria", "comunClip", "comunCargador", "comunFuente", "comunAntena", "comunCubrePolvo"]
      .forEach(idc => { const el = $(idc); if (el) el.checked = this.checked; });
  });
}

async function init() {
  try {
    await cargarModelos();
    await cargarOrden();
    wireComunTodos();
    // Editar el serial o el modelo revalida la fila contra el contrato.
    const cuerpo = $("filasBatch");
    if (cuerpo) {
      cuerpo.addEventListener("input",  () => refrescarContrato());
      cuerpo.addEventListener("change", () => refrescarContrato());
    }
    renumber();
  } catch (error) {
    console.error("Error al iniciar la página:", error);
    Toast.show("Error al cargar la página.", "bad");
  }
}

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    await init();
  }
});

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
    <td class="batch-num"></td>
    <td><input type="text" class="serie table-input sm" value="${escAttr(serial)}" placeholder="Serial"></td>
    <td><select class="modelo table-select">${modelOptionsHtml(modeloId)}</select></td>
    <td>
      <div class="batch-acc">
        <label title="Batería"><input type="checkbox" class="bateria" ${acc.bateria ? 'checked' : ''}> Bat</label>
        <label title="Clip"><input type="checkbox" class="clip" ${acc.clip ? 'checked' : ''}> Clip</label>
        <label title="Cargador"><input type="checkbox" class="cargador" ${acc.cargador ? 'checked' : ''}> Carg</label>
        <label title="Fuente"><input type="checkbox" class="fuente" ${acc.fuente ? 'checked' : ''}> Fte</label>
        <label title="Antena"><input type="checkbox" class="antena" ${acc.antena ? 'checked' : ''}> Ant</label>
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
  filas.forEach((tr, i) => { tr.querySelector(".batch-num").textContent = i + 1; });
  $("emptyBatch").style.display = filas.length ? "none" : "";
  $("tablaWrap").style.display = filas.length ? "" : "none";
  $("contadorBatch").textContent = filas.length ? `${filas.length} equipo(s)` : "";
}

window.agregarFila = () => addRow({ focus: true });

// Trae los seriales del cliente desde POC y crea una fila por equipo con su
// serial Y el modelo reconocido automáticamente. Deduplica contra la tabla.
window.jalarSerialesDesdePoc = async () => {
  if (typeof PocService === "undefined") { Toast.show("POC no está disponible.", "bad"); return; }
  if (!clienteId && !clienteNombre) { Toast.show("La orden no tiene un cliente asociado para buscar en POC.", "warn"); return; }

  const btn = $("btnJalarPoc");
  if (btn) btn.disabled = true;
  try {
    let devices = await PocService.getByCliente({ clienteId, clienteNombre });
    devices = (devices || []).filter(d => d.deleted !== true && String(d.serial || "").trim());
    if (!devices.length) { Toast.show("No hay equipos en POC para este cliente.", "warn"); return; }

    const modeloPorNombre = new Map(modelos.map(m => [normName(m.nombre), m.id]));
    const yaPresentes = serialesActuales();

    let agregados = 0, reconocidos = 0, omitidos = 0;
    devices.forEach(d => {
      const serial = String(d.serial).trim();
      if (yaPresentes.has(serial.toLowerCase())) { omitidos++; return; }
      const modeloId = modeloPorNombre.get(normName(d.modelo_label || d.modelo || "")) || "";
      if (modeloId) reconocidos++;
      addRow({ serial, modeloId });
      yaPresentes.add(serial.toLowerCase());
      agregados++;
    });

    let msg = `${agregados} equipo(s) jalados desde POC · ${reconocidos} con modelo reconocido.`;
    if (omitidos) msg += ` ${omitidos} ya estaban en la tabla.`;
    Toast.show(agregados ? msg : "Los seriales de POC ya estaban en la tabla.", agregados ? "ok" : "warn");
  } catch (e) {
    console.error("Error consultando POC:", e);
    Toast.show("No se pudo consultar POC.", "bad");
  } finally {
    if (btn) btn.disabled = false;
  }
};

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
    const obs = tr.querySelector(".observaciones");
    if (observaciones && obs && !obs.value.trim()) obs.value = observaciones;
  });
  Toast.show("Valores comunes aplicados a las filas.", "ok");
};

window.guardarBatch = async () => {
  if (!ordenId) { Toast.show("Falta el número de orden.", "bad"); return; }

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
    const observaciones = tr.querySelector(".observaciones").value.trim();

    // Fila totalmente vacía: se ignora.
    if (!serial && !modeloId && !bateria && !clip && !cargador && !fuente && !antena && !observaciones) continue;

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
      bateria, clip, cargador, fuente, antena,
      observaciones: observaciones || "sin observaciones",
    }));
  }

  if (!nuevosEquipos.length) { Toast.show("Agrega al menos un equipo con serial.", "warn"); return; }

  const btn = $("btnGuardar");
  if (btn) btn.disabled = true;
  try {
    const ordenData = await OrdenesService.getOrder(ordenId);
    if (!ordenData) { Toast.show("No se encontró la orden.", "bad"); return; }
    const equiposExistentes = ordenData.equipos || [];
    await OrdenesService.updateOrder(ordenId, { equipos: [...equiposExistentes, ...nuevosEquipos] });

    Toast.show(`✅ Se guardaron ${nuevosEquipos.length} equipo(s) en la orden.`, "ok");
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
    ["comunBateria", "comunClip", "comunCargador", "comunFuente", "comunAntena"]
      .forEach(idc => { const el = $(idc); if (el) el.checked = this.checked; });
  });
}

async function init() {
  try {
    await cargarModelos();
    await cargarOrden();
    wireComunTodos();
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

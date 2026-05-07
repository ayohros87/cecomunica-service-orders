// @ts-nocheck
    const auth = firebase.auth();
    let listaClientes = {};

// =======================================
// PREVIEW MODAL
// =======================================
let __previewDraft = null;
let __guardando = false;
let __currentUser = null;

function openPreviewModal() { Modal.open("previewOverlay"); }
function closePreviewModal() { Modal.close("previewOverlay"); }

function buildContratoDraft() {
  const clienteId = document.getElementById("cliente").value;
  const cliente = listaClientes[clienteId] || {};
  const tipoSel = document.getElementById("tipo_contrato");
  const tipoNombre = tipoSel.options[tipoSel.selectedIndex]?.text || "";
  const accion = document.getElementById("accion").value;
  const esRenovacion = accion === "Renovación";
  const renovacionSinEquipo = esRenovacion && !!document.getElementById("renovacion_sin_equipo")?.checked;
  const renovacionRefurbishedComponentes = esRenovacion
    && renovacionSinEquipo
    && !!document.getElementById("renovacion_refurbished_componentes")?.checked;
  const duracionSeleccionada = document.getElementById("duracion").value;
  const otraDuracion = document.getElementById("otra_duracion").value;
  const duracionFinal = duracionSeleccionada === "Otro"
    ? `${otraDuracion} meses`
    : duracionSeleccionada;

  const equipos = [...document.querySelectorAll("#tablaEquipos tbody tr")].map(row => {
    const modelo_id = row.querySelector(".modelo").value.trim();
    const modelo = modelosDisponibles.find(m => m.modelo_id === modelo_id)?.modelo || "";
    const descripcion = (row.querySelector(".descripcion")?.value || "").trim() || "Equipos de Comunicación";
    const cantidad = parseInt(row.querySelector(".cantidad").value || 0);
    const precio = parseFloat(row.querySelector(".precio").value || 0);
    return {
      modelo_id,
      modelo,
      descripcion,
      cantidad,
      precio,
      total: (cantidad || 0) * (precio || 0)
    };
  });

  const tot = recalcularTotalesContrato();

  return {
    cliente_id: clienteId,
    cliente_nombre: cliente?.nombre || "",
    cliente_ruc: cliente?.ruc || "",
    cliente_dv: cliente?.dv || "",
    cliente_direccion: cliente?.direccion || "",
    cliente_telefono: cliente?.telefono || "",
    representante: cliente?.representante || "",
    representante_cedula: cliente?.representante_cedula || "",
    tipo_contrato: tipoNombre,
    accion,
    renovacion_sin_equipo: renovacionSinEquipo,
    renovacion_refurbished_componentes: renovacionRefurbishedComponentes,
    renovacion_modalidad: esRenovacion
      ? (renovacionSinEquipo ? "Renovación sin equipo" : "Renovación con equipo")
      : "",
    duracion: duracionFinal,
    observaciones: document.getElementById("observaciones").value.trim(),
    equipos,
    subtotal: tot.subtotal,
    itbms_aplica: tot.itbmsAplica,
    itbms_monto: tot.itbmsMonto,
    total_con_itbms: tot.totalConITBMS
  };
}

function renderPreviewHTML(draft) {
  const renovacionLabel = draft.accion === "Renovación"
    ? (draft.renovacion_sin_equipo ? "Renovación sin equipo" : "Renovación con equipo")
    : "";
  const refurbishedLabel = draft.accion === "Renovación" && draft.renovacion_sin_equipo
    ? (draft.renovacion_refurbished_componentes ? "Sí" : "No")
    : "";

  const eqRows = (draft.equipos || []).map((e, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(e.modelo || "")}</td>
      <td>${escapeHtml(e.descripcion || "")}</td>
      <td style="text-align:right;">${Number(e.cantidad || 0)}</td>
      <td style="text-align:right;">$${Number(e.precio || 0).toFixed(2)}</td>
      <td style="text-align:right;">$${Number(e.total || 0).toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <div class="preview-card">
      <h4>Cliente</h4>
      <div class="preview-grid">
        <div><b>Nombre:</b> ${escapeHtml(draft.cliente_nombre || "")}</div>
        <div><b>RUC/DV:</b> ${escapeHtml((draft.cliente_ruc || "") + (draft.cliente_dv ? " - DV" + draft.cliente_dv : ""))}</div>
        <div><b>Dirección:</b> ${escapeHtml(draft.cliente_direccion || "")}</div>
        <div><b>Teléfono:</b> ${escapeHtml(draft.cliente_telefono || "")}</div>
        <div><b>Representante:</b> ${escapeHtml(draft.representante || "")}</div>
        <div><b>Cédula Rep.:</b> ${escapeHtml(draft.representante_cedula || "")}</div>
      </div>
    </div>

    <div class="preview-card">
      <h4>Detalles del contrato</h4>
      <div class="preview-grid">
        <div><b>Tipo:</b> ${escapeHtml(draft.tipo_contrato || "")}</div>
        <div><b>Acción:</b> ${escapeHtml(draft.accion || "")}</div>
        ${renovacionLabel ? `<div><b>Modalidad renovación:</b> ${escapeHtml(renovacionLabel)}</div>` : ""}
        ${refurbishedLabel ? `<div><b>Refurbished batería/antena/clip/piezas:</b> ${escapeHtml(refurbishedLabel)}</div>` : ""}
        <div><b>Duración:</b> ${escapeHtml(draft.duracion || "")}</div>
        <div><b>Observaciones:</b> ${escapeHtml(draft.observaciones || "-")}</div>
      </div>
    </div>

    <div class="preview-card">
      <h4>Equipos</h4>
      <table class="preview-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Modelo</th>
            <th>Descripción</th>
            <th>Cant</th>
            <th>P.Unit</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${eqRows || "<tr><td colspan='6'>Sin equipos</td></tr>"}
        </tbody>
      </table>
    </div>

    <div class="preview-card">
      <h4>Totales</h4>
      <div class="preview-totals">
        <table>
          <tr><td>Subtotal</td><td style="text-align:right;">$${Number(draft.subtotal || 0).toFixed(2)}</td></tr>
          <tr><td>ITBMS</td><td style="text-align:right;">$${Number(draft.itbms_monto || 0).toFixed(2)}</td></tr>
          <tr><td><b>Total</b></td><td style="text-align:right;"><b>$${Number(draft.total_con_itbms || 0).toFixed(2)}</b></td></tr>
        </table>
      </div>
      <div class="preview-note">ID del contrato se asigna al guardar.</div>
    </div>
  `;
}

// =======================================
// BADGE UPDATE SYSTEM
// =======================================
function updateContratoBadges() {
  // Badge Cliente: verificar que hay cliente seleccionado
  const clienteId = document.getElementById("cliente").value;
  const badgeCliente = document.getElementById("badgeCliente");
  if (clienteId) {
    badgeCliente.textContent = "Listo";
    badgeCliente.className = "badge ready";
  } else {
    badgeCliente.textContent = "Pendiente";
    badgeCliente.className = "badge pending";
  }

  // Badge Detalles: verificar campos requeridos
  const tipoContrato = document.getElementById("tipo_contrato").value;
  const accion = document.getElementById("accion").value;
  const duracion = document.getElementById("duracion").value;
  const badgeDetalles = document.getElementById("badgeDetalles");

  if (tipoContrato && accion && duracion) {
    badgeDetalles.textContent = "Listo";
    badgeDetalles.className = "badge ready";
  } else {
    badgeDetalles.textContent = "Pendiente";
    badgeDetalles.className = "badge pending";
  }

  // Badge Equipos: verificar que hay al menos una fila
  const filas = document.querySelectorAll("#tablaEquipos tbody tr");
  const badgeEquipos = document.getElementById("badgeEquipos");

  if (filas.length > 0) {
    badgeEquipos.textContent = `${filas.length} equipo${filas.length !== 1 ? "s" : ""}`;
    badgeEquipos.className = "badge info";
  } else {
    badgeEquipos.textContent = "Pendiente";
    badgeEquipos.className = "badge pending";
  }
}

function syncAccionForTipoContrato() {
  const tipoContrato = document.getElementById("tipo_contrato").value;
  const accionSel = document.getElementById("accion");
  if (!accionSel) return;

  const isDemoOrTemp = tipoContrato === "DEMO" || tipoContrato === "TEMP";

  if (isDemoOrTemp) {
    if (!accionSel.dataset.prevValue) {
      accionSel.dataset.prevValue = accionSel.value || "";
    }
    accionSel.value = "No Aplica";
    accionSel.disabled = true;
    accionSel.classList.add("is-locked");
  } else {
    if (accionSel.disabled) {
      accionSel.disabled = false;
      accionSel.classList.remove("is-locked");
      if (accionSel.dataset.prevValue !== undefined) {
        accionSel.value = accionSel.dataset.prevValue;
      }
    }
  }

  refreshRenovacionModeUI();
  updateContratoBadges();
}

function refreshRenovacionModeUI() {
  const accion = document.getElementById("accion")?.value;
  const box = document.getElementById("renovacionModeBox");
  const checkbox = document.getElementById("renovacion_sin_equipo");
  const refurbishedBox = document.getElementById("renovacionRefurbishedBox");
  const refurbishedCheckbox = document.getElementById("renovacion_refurbished_componentes");
  const badge = document.getElementById("badgeRenovacionModo");
  if (!box || !checkbox || !badge || !refurbishedBox || !refurbishedCheckbox) return;

  const esRenovacion = accion === "Renovación";
  if (!esRenovacion) {
    box.style.display = "none";
    checkbox.checked = false;
    checkbox.disabled = true;
    refurbishedBox.style.display = "none";
    refurbishedCheckbox.checked = false;
    refurbishedCheckbox.disabled = true;
    badge.textContent = "Renovación con equipo";
    badge.className = "badge info";
    return;
  }

  box.style.display = "block";
  checkbox.disabled = false;

  if (checkbox.checked) {
    refurbishedBox.style.display = "block";
    refurbishedCheckbox.disabled = false;
  } else {
    refurbishedBox.style.display = "none";
    refurbishedCheckbox.checked = false;
    refurbishedCheckbox.disabled = true;
  }

  if (checkbox.checked) {
    badge.textContent = "Renovación sin equipo";
    badge.className = "badge ready";
  } else {
    badge.textContent = "Renovación con equipo";
    badge.className = "badge info";
  }
}

// =======================================
// AGREGAR FILA EQUIPO (MEJORADO)
// =======================================
function agregarFilaEquipo() {
  const tbody = document.querySelector("#tablaEquipos tbody");
  const fila = document.createElement("tr");
  fila.classList.add("fila-equipo", "highlight");

  const modeloSelect = modelosDisponibles.map(m =>
    `<option value="${m.modelo_id}">${m.modelo}</option>`
  ).join('');

  fila.innerHTML = `
    <td>
      <div style="display: flex; align-items: center; gap: 6px;">
        <select class="modelo">${modeloSelect}</select>
      </div>
    </td>
    <td><input type="text" class="descripcion" value="Equipos de Comunicación"></td>
    <td><input type="number" class="cantidad input-cantidad" min="1" value="1"></td>
    <td><input type="number" class="precio input-precio" step="0.01" min="0" value="0.00"></td>
    <td class="totalFila">$0.00</td>
    <td><button type="button" class="btn-del-fila">❌</button></td>
  `;

  tbody.appendChild(fila);

  // Remove highlight animation class after it completes
  setTimeout(() => fila.classList.remove("highlight"), 600);

  // Listeners por fila: actualiza total de la fila + totales del contrato
  const onChangeFila = () => {
    actualizarTotalDeFila(fila);
    recalcularTotalesContrato();
    updateContratoBadges();
  };

  fila.querySelectorAll(".input-cantidad, .input-precio").forEach(i => {
    i.addEventListener("input", onChangeFila);
    i.addEventListener("change", onChangeFila);
  });

  fila.querySelector(".btn-del-fila").addEventListener("click", () => {
    fila.remove();
    recalcularTotalesContrato();
    updateContratoBadges();
  });

  // Inicializa total de la fila
  actualizarTotalDeFila(fila);

  // Auto-focus en cantidad
  setTimeout(() => {
    const cantidadInput = fila.querySelector(".input-cantidad");
    if (cantidadInput) {
      cantidadInput.focus();
      cantidadInput.select();
    }
  }, 100);

  // Update badges
  updateContratoBadges();
}
function actualizarTotalDeFila(tr) {
  const cant = parseFloat(tr.querySelector(".input-cantidad")?.value || 0);
  const precio = parseFloat(tr.querySelector(".input-precio")?.value || 0);
  const subtotal = FMT.round2(cant * precio);
  const celda = tr.querySelector(".totalFila");
  if (celda) celda.textContent = `$${subtotal.toFixed(2)}`;
}

function mostrarMensaje(texto, color = "green", autoCenter = false) {
  const el = document.getElementById("mensaje");
  el.textContent = texto;
  el.style.color = color;
  el.style.fontWeight = "600";
  el.style.display = "block";
  el.style.textAlign = "center";
  el.style.margin = "16px auto";
  el.style.maxWidth = "800px";

  if (autoCenter) {
    // Desplaza suavemente y centra en la ventana
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
function toggleOtraDuracion(valor) {
  const campo = document.getElementById("otraDuracionLabel");
  campo.style.display = valor === "Otro" ? "block" : "none";
}

function calcularSubtotalDesdeFilas() {
  let subtotal = 0;
  document.querySelectorAll('.fila-equipo').forEach(row => {
    const qty = Number(row.querySelector('.input-cantidad')?.value || 0);
    const price = Number(row.querySelector('.input-precio')?.value || 0);
    subtotal += qty * price;
  });
  return FMT.round2(subtotal);
}


// Cálculo unificado: subtotal + itbms + total
function recalcularTotalesContrato() {
  const subtotal = calcularSubtotalDesdeFilas();
  const itbmsAplica = (document.getElementById('itbms_aplica')?.value ?? 'true') === 'true';
  const tot = ContractTotals.compute(subtotal, itbmsAplica);
  document.getElementById('itbms_label').textContent = tot.itbmsLabel;
  document.getElementById('subtotal_view').textContent = FMT.money(tot.subtotal);
  document.getElementById('itbms_view').textContent = FMT.money(tot.itbmsMonto);
  document.getElementById('total_con_itbms_view').textContent = FMT.money(tot.totalConITBMS);
  return tot;
}

// Eventos que disparan el recálculo en vivo
document.addEventListener('input', (e) => {
  if (e.target.matches('.input-cantidad, .input-precio')) {
    const tr = e.target.closest('tr.fila-equipo');
    if (tr) actualizarTotalDeFila(tr);
    recalcularTotalesContrato();
  }
});

document.getElementById('itbms_aplica')?.addEventListener('change', recalcularTotalesContrato);

// Inicializa al cargar
window.addEventListener('DOMContentLoaded', () => {
  recalcularTotalesContrato();
  updateContratoBadges();
  syncAccionForTipoContrato();

  // Add listeners to update badges when form fields change
  document.getElementById("tipo_contrato")?.addEventListener("change", syncAccionForTipoContrato);
  document.getElementById("accion")?.addEventListener("change", () => {
    const accionSel = document.getElementById("accion");
    if (accionSel && !accionSel.disabled) {
      accionSel.dataset.prevValue = accionSel.value || "";
    }
    refreshRenovacionModeUI();
    updateContratoBadges();
  });
  document.getElementById("renovacion_sin_equipo")?.addEventListener("change", refreshRenovacionModeUI);
  document.getElementById("renovacion_refurbished_componentes")?.addEventListener("change", refreshRenovacionModeUI);
  document.getElementById("duracion")?.addEventListener("change", updateContratoBadges);
});

function calcularTotal() {
  // Mantén esta función como helper legacy si otros sitios la llaman:
  // actualiza cada fila y luego recalcula el total del contrato.
  document.querySelectorAll("#tablaEquipos tbody tr.fila-equipo").forEach(row => {
    actualizarTotalDeFila(row);
  });
  recalcularTotalesContrato();
}


async function cargarClientes(limit = 25) {
  const { docs } = await ClientesService.listClientes({ limit });

  const items = [];
  listaClientes = {};
  docs.forEach(c => {
    listaClientes[c.id] = c;
    items.push({ id: c.id, d: c });
  });
  // Usa el renderer del combobox
  renderCombo(items);
}

let modelosDisponibles = [];

async function cargarModelos() {
  const raw = await ModelosService.getModelos();
  raw.sort((a, b) => (a.modelo || "").localeCompare(b.modelo || ""));
  modelosDisponibles = raw.map(m => ({ modelo_id: m.id, modelo: m.modelo }));
}


    auth.onAuthStateChanged(async user => {
      if (!user) return window.location.href = "/login.html";
      __currentUser = user;
      await cargarClientes();
      // Preseleccionar cliente si viene por URL
      const params = new URLSearchParams(window.location.search);
     const preseleccionado = params.get("cliente_id");
      if (preseleccionado) {
        const c = await ClientesService.getCliente(preseleccionado);
        if(c){
          listaClientes[preseleccionado] = c;
          selectCliente(preseleccionado, true);
        }
      }

      await cargarModelos();

// Aplica borrador si venimos de "Duplicar"
async function applyPrefillFromDuplicate() {
  const raw = sessionStorage.getItem("contrato_prefill");
  if (!raw) return; // no hay prefill pendiente

  let draft;
  try { draft = JSON.parse(raw); } catch { sessionStorage.removeItem("contrato_prefill"); return; }

  // 1) Cliente (ya soportas ?cliente_id=... y selectCliente() en tu onAuthStateChanged)
  //    Si no vino en query, y draft trae cliente, selecciona aquí:
  const params = new URLSearchParams(window.location.search);
  const yaTraeCliente = !!params.get("cliente_id");
  if (!yaTraeCliente && draft.cliente_id) {
    // Asegura que esté en cache y selecciónalo
    const c = await ClientesService.getCliente(draft.cliente_id);
    if (c) {
      listaClientes[draft.cliente_id] = c;
      selectCliente(draft.cliente_id, true);
    }
  }

  // 2) Tipo de contrato (usa código corto en tu <select id="tipo_contrato">)
  if (draft.codigo_tipo) {
    const sel = document.getElementById("tipo_contrato");
    sel.value = draft.codigo_tipo; // "ALQ" | "PROP" | "REEMP" | "DEMO"
  }

  // 3) Acción
  if (draft.accion) {
    const sel = document.getElementById("accion");
    sel.value = draft.accion;
  }
  syncAccionForTipoContrato();

  const checkboxRenovacion = document.getElementById("renovacion_sin_equipo");
  if (checkboxRenovacion) {
    const inferredSinEquipo = draft.renovacion_sin_equipo === true
      || String(draft.renovacion_modalidad || "").toLowerCase().includes("sin equipo");
    checkboxRenovacion.checked = inferredSinEquipo;
  }
  const checkboxRefurbished = document.getElementById("renovacion_refurbished_componentes");
  if (checkboxRefurbished) {
    checkboxRefurbished.checked = !!draft.renovacion_refurbished_componentes;
  }
  refreshRenovacionModeUI();

  // 4) Duración (si es "12 meses"/"18 meses" selecciona; si no, usa "Otro" + número)
  if (draft.duracion) {
    const sel = document.getElementById("duracion");
    const val = String(draft.duracion).toLowerCase();
    if (val.includes("12")) {
      sel.value = "12 meses";
      toggleOtraDuracion("12 meses");
    } else if (val.includes("18")) {
      sel.value = "18 meses";
      toggleOtraDuracion("18 meses");
    } else {
      sel.value = "Otro";
      toggleOtraDuracion("Otro");
      const meses = parseInt(val.replace(/\D+/g, ""), 10);
      if (!isNaN(meses) && meses > 0) {
        document.getElementById("otra_duracion").value = meses;
      }
    }
  }

  // 5) Observaciones
  if (typeof draft.observaciones === "string") {
    document.getElementById("observaciones").value = draft.observaciones;
  }

  // 6) Equipos (agrega filas y setea valores)
  if (Array.isArray(draft.equipos) && draft.equipos.length) {
    const tbody = document.querySelector("#tablaEquipos tbody");
    tbody.innerHTML = ""; // limpia cualquier fila previa

    for (const e of draft.equipos) {
      agregarFilaEquipo(); // crea una nueva fila
      const row = tbody.lastElementChild;

      // MODELO: si hay modelo_id y existe en modelosDisponibles, úsalo; si no, intenta por nombre
      let modeloId = e.modelo_id;
      if (!modeloId && e.modelo) {
        const found = modelosDisponibles.find(m => (m.modelo || "").trim().toLowerCase() === String(e.modelo).trim().toLowerCase());
        if (found) modeloId = found.modelo_id;
      }
      if (modeloId) row.querySelector(".modelo").value = modeloId;

      // Otros campos
      row.querySelector(".descripcion").value = e.descripcion || "Equipos de Comunicación";
      row.querySelector(".cantidad").value = Number(e.cantidad || 0);
      row.querySelector(".precio").value = Number(e.precio || 0).toFixed(2);
    }

    calcularTotal();
  }

  // Limpia el prefill para no re-aplicarlo si el usuario vuelve atrás
  sessionStorage.removeItem("contrato_prefill");
}

await applyPrefillFromDuplicate();
document.getElementById("clienteCombo").focus();

async function guardarContratoConfirmado(user) {
  // 🚨 Validar cliente seleccionado
  const clienteId = document.getElementById("cliente").value;
  if (!clienteId) {
    Toast.show("⚠️ Debe seleccionar un cliente antes de crear el contrato.", 'warn');
    document.getElementById("clienteCombo").focus();
    return;
  }

  const tipoSel = document.getElementById("tipo_contrato");
  const tipoCorto = tipoSel.value;
  const tipoNombre = tipoSel.options[tipoSel.selectedIndex].text;
  const accionSeleccionada = document.getElementById("accion").value;
  const esRenovacion = accionSeleccionada === "Renovación";
  const renovacionSinEquipo = esRenovacion && !!document.getElementById("renovacion_sin_equipo")?.checked;
  const renovacionRefurbishedComponentes = esRenovacion
    && renovacionSinEquipo
    && !!document.getElementById("renovacion_refurbished_componentes")?.checked;
  const renovacionModalidad = esRenovacion
    ? (renovacionSinEquipo ? "Renovación sin equipo" : "Renovación con equipo")
    : "";
  const hoy = new Date();
  const fechaStr = hoy.toISOString().slice(0,10).replace(/-/g,"");

  const inicio = new Date(fechaStr.slice(0,4), fechaStr.slice(4,6)-1, fechaStr.slice(6,8));
  const fin = new Date(inicio); fin.setDate(fin.getDate() + 1);

  const count = await ContratosService.contarPorTipoYFecha(tipoCorto, inicio, fin);
  const num = String(count + 1).padStart(2, "0");
  const contrato_id = tipoCorto + fechaStr + "-" + num;

  const equipos = [...document.querySelectorAll("#tablaEquipos tbody tr")].map(row => {
    const modelo_id = row.querySelector(".modelo").value.trim();
    const modelo = modelosDisponibles.find(m => m.modelo_id === modelo_id)?.modelo || "";
    const descripcion = (row.querySelector(".descripcion")?.value || "").trim() || "Equipos de Comunicación";
    return {
      modelo_id,
      modelo,
      descripcion,
      cantidad: parseInt(row.querySelector(".cantidad").value || 0),
      precio: parseFloat(row.querySelector(".precio").value || 0)
    };
  });
  const clienteData = listaClientes[clienteId];
  const duracionSeleccionada = document.getElementById("duracion").value;
  const otraDuracion = document.getElementById("otra_duracion").value;

  const duracionFinal = duracionSeleccionada === "Otro"
    ? `${otraDuracion} meses`
    : duracionSeleccionada;

  const tot = recalcularTotalesContrato();

  // Calcular total de equipos
  const total_equipos = equipos.reduce((acc, e) => acc + Number(e.cantidad || 0), 0);

  const contrato = {
    contrato_id,
    cliente_id: clienteId,
    cliente_nombre: clienteData?.nombre || "",
    cliente_nombre_lower: (clienteData?.nombre || "").toLowerCase(),
    cliente_direccion: clienteData?.direccion || "",
    cliente_telefono: clienteData?.telefono || "",
    cliente_ruc: clienteData?.ruc || "",
    cliente_dv: clienteData?.dv || "",
    cliente_rucdv: (clienteData?.ruc || "") + (clienteData?.dv ? (" - DV" + clienteData.dv) : ""),
    representante: clienteData?.representante || "",
    representante_cedula: clienteData?.representante_cedula || "",
    duracion: duracionFinal,

    codigo_tipo: tipoCorto,
    tipo_contrato: tipoNombre,
    accion: accionSeleccionada,
    renovacion_sin_equipo: renovacionSinEquipo,
    renovacion_refurbished_componentes: renovacionRefurbishedComponentes,
    renovacion_modalidad: renovacionModalidad,
    estado: "pendiente_aprobacion",
    observaciones: document.getElementById("observaciones").value.trim(),
    equipos,

    // Total de equipos (suma de cantidades)
    total_equipos,

    // Totales persistidos
    subtotal: tot.subtotal,                           // number
    itbms_aplica: tot.itbmsAplica,                    // boolean
    itbms_porcentaje: FMT.ITBMS_RATE,               // number (0.07)
    itbms_monto: FMT.round2(tot.itbmsMonto),              // number
    total_con_itbms: FMT.round2(tot.totalConITBMS),       // number

    // Compatibilidad (total = subtotal histórico)
    total: tot.subtotal,

    fecha_creacion: new Date(),
    fecha_modificacion: new Date(),
    deleted: false,
    creado_por_uid: user.uid
  };

  // Guardar contrato
  const docRef = await ContratosService.addContrato(contrato);

  // --- Encolar correo para envío en background y redirigir rápido ---
  try {
    const equiposHtml = contrato.equipos.map(e =>
      `<li>${e.modelo} – ${e.cantidad} × $${Number(e.precio || 0).toFixed(2)}</li>`
    ).join("");

    const renovacionBanner = contrato.accion === "Renovación"
      ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? "RENOVACIÓN SIN EQUIPO" : "RENOVACIÓN CON EQUIPO"}</div>`
      : "";

    await MailService.enqueue({
      to: "ventas@cecomunica.com",
      cc: firebase.auth().currentUser?.email || null,
      subject: `Nuevo contrato creado: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
      preheader: `Contrato pendiente de aprobación: ${contrato.cliente_nombre}`,
      bodyContent: `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Nuevo contrato creado</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          Se ha registrado un nuevo contrato con el ID <b>${contrato.contrato_id}</b>.
        </p>
        ${renovacionBanner}
        <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.cliente_nombre}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.tipo_contrato}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.accion}</td></tr>
          ${contrato.accion === "Renovación" ? `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? "Sin equipo" : "Con equipo"}</td></tr>` : ""}
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Duración</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.duracion || "-"}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${(contrato.observaciones || "-").replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">$${Number(contrato.total_con_itbms || 0).toFixed(2)}</td></tr>
        </table>
        ${
          (equiposHtml && equiposHtml.length)
            ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Equipos</h4>
               <ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${equiposHtml}</ul>`
            : ""
        }
      `,
      ctaUrl: `${location.origin}/contratos/index.html?aprobar=${docRef.id}`,
      ctaLabel: "Revisar contrato",
      meta: {
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        created_by: user.uid,
        source: "nuevo-contrato"
      },
      status: "queued"
    });

    Toast.show("✅ Contrato guardado. Enviaremos el correo a ventas@cecomunica.com en segundo plano…", 'ok');
    setTimeout(() => { window.location.href = "index.html"; }, 1200);
  } catch (e) {
    console.warn("No se pudo encolar el correo:", e);
    Toast.show("⚠️ Contrato guardado, pero no se pudo encolar el correo.", 'warn');
    setTimeout(() => { window.location.href = "index.html"; }, 1800);
  }
}

document.getElementById("formContrato").addEventListener("submit", async e => {
  e.preventDefault();
  // 🚨 Validar cliente seleccionado
  const clienteId = document.getElementById("cliente").value;
  if (!clienteId) {
    Toast.show("⚠️ Debe seleccionar un cliente antes de crear el contrato.", 'warn');
    document.getElementById("clienteCombo").focus();
    return;
  }

  const filas = [...document.querySelectorAll("#tablaEquipos tbody tr")];
  if (!filas.length) {
    Toast.show("⚠️ Debe agregar al menos un equipo.", 'warn');
    return;
  }

  __previewDraft = buildContratoDraft();
  const sub = `${__previewDraft.cliente_nombre || ""} · ${__previewDraft.tipo_contrato || ""} · ${__previewDraft.accion || ""}`;
  document.getElementById("previewSub").textContent = sub;
  document.getElementById("previewBody").innerHTML = renderPreviewHTML(__previewDraft);
  openPreviewModal();
});

document.getElementById("btnEditPreview").addEventListener("click", closePreviewModal);
document.getElementById("btnClosePreview").addEventListener("click", closePreviewModal);
document.querySelector("[data-close-preview]").addEventListener("click", closePreviewModal);
document.getElementById("previewOverlay").addEventListener("click", (e) => {
  if (e.target.id === "previewOverlay") closePreviewModal();
});

document.getElementById("btnConfirmPreview").addEventListener("click", async () => {
  if (__guardando) return;
  __guardando = true;
  document.getElementById("btnConfirmPreview").disabled = true;
  document.getElementById("btnGuardar").disabled = true;
  closePreviewModal();
  try {
    await guardarContratoConfirmado(__currentUser);
  } catch (err) {
    console.error(err);
    Toast.show("❌ Error al guardar el contrato.", 'bad');
    document.getElementById("btnConfirmPreview").disabled = false;
    document.getElementById("btnGuardar").disabled = false;
    __guardando = false;
  }
});
  document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    const combo = document.getElementById("clienteCombo");
    const hidden = document.getElementById("cliente");
    const q = (combo.value || "").trim();

    if (hidden.value) {
      // Si ya había uno seleccionado, vuelve a pintar su ficha por si cambió
      const c = await ClientesService.getCliente(hidden.value);
      if (c) {
        listaClientes[c.id] = c;
        selectCliente(c.id, true);
      }
    } else if (q.length >= 2) {
      // Si el usuario estaba buscando texto, re-ejecuta la consulta
      doSearch(q);
    } else {
      // Muestra sugerencias base
      await cargarClientes();
    }
  }
});

    });

// ---------- Helpers ----------
const debounce = (fn, ms=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
function splitTokens(q){ return FMT.normalize(q).split(/[^a-z0-9]+/).filter(Boolean); }

// ---------- Estado ----------
let comboIdx = -1;               // índice seleccionado con teclado
let comboItems = [];             // {id,d}
const $combo = document.getElementById('clienteCombo');
const $hidden = document.getElementById('cliente'); // guarda el cliente_id
const $list = document.getElementById('clienteList');
const $btnEditar = document.getElementById('btnEditarCliente');
const $btnClear = document.getElementById('btnClearCliente');
const nuevaClienteUrl = '../contratos/nuevo-cliente.html?redirect=true';
$btnClear.addEventListener('click', ()=>{
  $hidden.value = "";
  $combo.value = "";
  renderInfoCliente(null);
  $list.hidden = true;
  $combo.focus();
  updateContratoBadges();
  // Si deshabilitas Guardar sin cliente:
  const $btnGuardar = document.getElementById('btnGuardar');
  if($btnGuardar){
    $btnGuardar.disabled = true;
    $btnGuardar.title = "Seleccione un cliente";
  }
});


// Estado de búsqueda actual (para resaltar)
let currentQuery = "";
let currentQueryParts = [];


// Pinta info del cliente en el panel a la derecha
function renderInfoCliente(id){
  const c = listaClientes[id];
  const html = c ? `
    📍 <b>Dirección:</b> ${c.direccion||""}<br>
    🧾 <b>RUC:</b> ${c.ruc || ""}${c.dv ? (" - DV" + c.dv) : ""}<br>
    📧 <b>Email:</b> ${c.email||""}<br>
    ☎️ <b>Tel:</b> ${c.telefono||""}
  ` : "";
  document.getElementById("infoCliente").innerHTML = html;
  $btnEditar.disabled = !id;
}
function escapeHtml(s=""){
  return s.replace(/[&<>"'`=\/]/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'
  }[ch] || ch));
}

function highlightQuery(text){
  if(!text) return "";
  if(!currentQueryParts.length) return escapeHtml(text);
  let out = text;
  // Marca tokens simples (case-insensitive); evita duplicado de tags
  currentQueryParts.forEach(t=>{
    if(!t) return;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,"ig");
    out = out.replace(re,"<mark>$1</mark>");
  });
  return out;
}

function showLoading(){
  $list.innerHTML = `<div class="combo-empty">Buscando…</div>`;
  $list.hidden = false;
}

function showEmpty(){
  const propuesta = escapeHtml(($combo.value || "").trim());
  $list.innerHTML = `
    <div class="combo-empty">
      Sin resultados.<br>
      <button type="button" class="btn btn-pill" id="btnCrearDesdeCombo">➕ Crear cliente${propuesta ? ` "${propuesta}"` : ""}</button>
    </div>`;
  $list.hidden = false;
  const $btnCrear = document.getElementById('btnCrearDesdeCombo');
  if($btnCrear){
    $btnCrear.onclick = ()=> window.open(nuevaClienteUrl, "_blank");
  }
}
const RECENTS_KEY = "clientes_recent_v1";
function loadRecent(){
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
}
function saveRecent(id){
  const d = listaClientes[id];
  if(!d) return;
  const rec = loadRecent().filter(x=>x.id!==id);
  rec.unshift({id, nombre: d.nombre || "", ruc: d.ruc || "", dv: d.dv || ""});
  localStorage.setItem(RECENTS_KEY, JSON.stringify(rec.slice(0,5)));
}

function renderRecent(){
  const rec = loadRecent();
  if(!rec.length){ $list.hidden = true; return; }
  $list.innerHTML = "";
  rec.forEach((r,i)=>{
    const div = document.createElement("div");
    div.className = 'combo-item' + (i===0?' active':'');
    div.dataset.id = r.id;
    div.innerHTML = `
  ${escapeHtml(r.nombre || '(sin nombre)')}
  <span class="combo-sub">
    ${escapeHtml((r.ruc || "") + (r.dv ? (" - DV" + r.dv) : ""))} · reciente
  </span>`;

    div.onclick = ()=> selectCliente(r.id, true);
    $list.appendChild(div);
  });
  comboItems = rec.map(r=>({id:r.id, d:r}));
  comboIdx = 0;
  $list.hidden = false;
}
$combo.addEventListener('focus', ()=>{
  if(!$hidden.value && !$combo.value.trim()){
    renderRecent();
  }
});

function renderCombo(items){
  comboItems = items;
  comboIdx = (items.length ? 0 : -1);
  $list.innerHTML = '';

  if(!items.length){
    showEmpty();
    return;
  }
  for(let i=0;i<items.length;i++){
    const {id,d} = items[i];
    const div = document.createElement('div');
    div.className = 'combo-item' + (i===comboIdx?' active':'');
    div.dataset.id = id;

    const nombreHtml = highlightQuery(d.nombre || '(sin nombre)');
    div.innerHTML = `
      ${nombreHtml}
     <span class="combo-sub">
    ${d.ruc || ''}${d.dv ? (' - DV' + d.dv) : ''} ${d.representante ? '· ' + d.representante : ''}
  </span>

    `;
    div.onclick = ()=> selectCliente(id, true);
    $list.appendChild(div);
  }
  $list.hidden = false;
}

// Selecciona cliente (click o Enter)
function selectCliente(id, close=true){
  const d = listaClientes[id];
  if(!d) return;
  $hidden.value = id;               // set cliente_id
  $combo.value = d.nombre || '';    // muestra nombre en visible
  renderInfoCliente(id);
  if(close){ $list.hidden = true; }
  saveRecent(id);
  updateContratoBadges();
}

// Actualiza la fila activa visualmente
function updateActive(){
  const nodes = $list.querySelectorAll('.combo-item');
  nodes.forEach((n,i)=> n.classList.toggle('active', i===comboIdx));
}
const doSearch = debounce(async (text)=>{
  const parts = splitTokens(text);
  currentQuery = text;
  currentQueryParts = parts;

  if(parts.length < 1){
    $list.hidden = true;
    return;
  }

  showLoading();

  // Query por el primer token
  const first = parts[0];
  const rawDocs = await ClientesService.searchByToken(first, { limit: 50 });

  // Arma lista y filtra AND local por los demás tokens
  const items = [];
  listaClientes = {};  // refrescamos cache con los que muestra el combo

  rawDocs.forEach(c => {
    const d = c;
    const hasTokens = Array.isArray(d.searchTokens) && d.searchTokens.length;
    const pass = hasTokens
      ? parts.every(t => d.searchTokens.includes(t))
      : parts.every(t => FMT.normalize(d.nombre||"").includes(t));
    if(pass){
      listaClientes[c.id] = d;
      items.push({ id: c.id, d });
    }
  });

  // Fallback por nombre (legacy)
  if(items.length === 0){
    const snap = await db.collection("clientes")
       .where("deleted", "==", false)
      .orderBy("nombre")
      .startAt(text).endAt(text + "")
      .limit(25).get();
    snap.forEach(doc=>{
      const d = doc.data();
      if(FMT.normalize(d.nombre||"").includes(FMT.normalize(text))){
        listaClientes[doc.id] = d;
        items.push({ id: doc.id, d });
      }
    });
  }

  if(items.length === 0) showEmpty();
  else renderCombo(items);
}, 180);

// ---------- Eventos del combobox ----------
$combo.addEventListener('input', (e)=>{
  const v = e.target.value;
  $hidden.value = "";            // estás escribiendo: resetea selección
  $btnEditar.disabled = true;
  renderInfoCliente(null);
  if(v.trim().length < 2){ $list.hidden = true; return; }
  doSearch(v);
});
$combo.addEventListener('keydown', (e)=>{
  if($list.hidden) return;
  const max = comboItems.length - 1;
  const jump = 5;

  if(e.key === 'ArrowDown'){
    e.preventDefault();
    comboIdx = Math.min(max, comboIdx+1);
    updateActive();
  } else if(e.key === 'ArrowUp'){
    e.preventDefault();
    comboIdx = Math.max(0, comboIdx-1);
    updateActive();
  } else if(e.key === 'PageDown'){
    e.preventDefault();
    comboIdx = Math.min(max, comboIdx + jump);
    updateActive();
  } else if(e.key === 'PageUp'){
    e.preventDefault();
    comboIdx = Math.max(0, comboIdx - jump);
    updateActive();
  } else if(e.key === 'Home'){
    e.preventDefault();
    comboIdx = 0;
    updateActive();
  } else if(e.key === 'End'){
    e.preventDefault();
    comboIdx = max;
    updateActive();
  } else if(e.key === 'Enter'){
    e.preventDefault();
    if(comboIdx>=0 && comboIdx<comboItems.length){
      selectCliente(comboItems[comboIdx].id, true);
    }
  } else if(e.key === 'Escape'){
    $list.hidden = true;
  }
});

// Cierra si clicas fuera
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.combobox')) $list.hidden = true;
});

// Botón editar (usa el hidden #cliente)
$btnEditar.addEventListener('click', ()=>{
  const id = $hidden.value;
  if(!id) {
    Toast.show("Seleccione un cliente para editar", 'warn');
    return;
  }
  window.open(`../contratos/nuevo-cliente.html?id=${id}&redirect=true`, "_blank");
});

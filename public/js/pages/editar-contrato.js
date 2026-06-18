// @ts-nocheck
const params = new URLSearchParams(location.search);
const contratoDocId = params.get("id");
let modelosDisponibles = [];
let contratoActual = null;
// NCCargos llama window.NCForm.recalcularTotalesContrato() al cambiar conceptos;
// aquí lo apuntamos al recálculo de esta página.
window.NCForm = { recalcularTotalesContrato: () => calcularTotal() };

const ESTADO_CHIPS = {
  activo:               { label: 'Activo',                cls: 'chip-aprobada'  },
  pendiente_aprobacion: { label: 'Pendiente Aprobación', cls: 'chip-cotizada'  },
  vencido:              { label: 'Vencido',               cls: 'chip-cancelada' },
};

async function cargarContrato() {
  if (!contratoDocId) {
    Toast.show('Falta el id del contrato.', 'bad');
    window.location.href = "index.html";
    return;
  }

  // 1) Cargar modelos primero (para poblar los <select>)
  const todosModelos = await ModelosService.getModelos();
  todosModelos.sort((a, b) => (a.modelo || "").localeCompare(b.modelo || ""));
  modelosDisponibles = todosModelos.map(m => ({ modelo_id: m.id, modelo: m.modelo }));

  // 2) Traer el contrato
  const c = await ContratosService.getContrato(contratoDocId);
  if (!c) {
    Toast.show('Contrato no encontrado.', 'bad');
    window.location.href = "index.html";
    return;
  }
  contratoActual = c;

  // 3) Bloquear edición si ya fue aprobado
  if (c.estado === "activo") {
    Toast.show('Este contrato ya fue aprobado y no se puede editar.', 'bad');
    window.location.href = `imprimir-contrato.html?id=${c.contrato_id || contratoDocId}`;
    return;
  }

  // 4) Poblar formulario
  document.getElementById("cliente_nombre").value = c.cliente_nombre || "";
  document.getElementById("tipo_contrato").value = c.codigo_tipo || "";
  document.getElementById("accion").value = c.accion || "";
  document.getElementById("renovacion_sin_equipo").checked = !!c.renovacion_sin_equipo;
  refreshRenovacionEditorUI();
  document.getElementById("estado").value = c.estado || "";
  document.getElementById("observaciones").value = c.observaciones || "";

  // 4b) Breadcrumb + page header chip
  const bcId = document.getElementById("bc-contrato-id");
  if (bcId) bcId.textContent = c.contrato_id || contratoDocId;
  const subEl = document.getElementById("ph-subtitle");
  if (subEl) {
    const fecha = c.fecha_modificacion?.toDate
      ? c.fecha_modificacion.toDate().toLocaleDateString('es-PA')
      : (c.fecha_modificacion ? new Date(c.fecha_modificacion).toLocaleDateString('es-PA') : null);
    subEl.textContent = `${c.contrato_id || contratoDocId} · ${c.cliente_nombre || 'Cliente'}${fecha ? ' · Modificado ' + fecha : ''}`;
  }
  const chipEl = document.getElementById("ph-estado-chip");
  if (chipEl) {
    const cfg = ESTADO_CHIPS[c.estado] || { label: c.estado || '—', cls: 'chip-recibida' };
    chipEl.className = `chip-estado ${cfg.cls}`;
    chipEl.textContent = cfg.label;
  }

  // 5) Precargar duración
  if (c.duracion) {
    if (["12 meses", "18 meses"].includes(c.duracion)) {
      document.getElementById("duracion").value = c.duracion;
    } else {
      document.getElementById("duracion").value = "Otro";
      document.getElementById("otra_duracion").value = c.duracion.replace(" meses", "").trim();
      toggleOtraDuracion("Otro");
    }
  }

  // 6) Cargar filas de equipos
  (c.equipos || []).forEach(eq =>
    agregarEquipo(eq.modelo_id || "", eq.modelo || "", eq.cantidad, eq.precio, eq.descripcion)
  );

  // 6b) Cargar otros conceptos (del catálogo) y recalcular
  if (window.NCCargos) await NCCargos.cargar(c.cargos || []);
  calcularTotal();
}

function agregarEquipo(modelo_id = '', modeloNombre = '', cantidad = 1, precio = 0, descripcion = "Equipos de Comunicación") {
  const tr = document.createElement("tr");

  const opciones = modelosDisponibles
    .map(m => `<option value="${m.modelo_id}">${m.modelo}</option>`)
    .join('');

  tr.innerHTML = `
    <td><select class="td-select modelo" aria-label="Modelo">${opciones}</select></td>
    <td><input class="td-input descripcion" type="text" value="${descripcion}" aria-label="Descripción"></td>
    <td><input class="td-input td-mono cantidad" type="number" min="1" value="${cantidad}" aria-label="Cantidad"></td>
    <td><input class="td-input td-mono precio" type="number" min="0" step="0.01" value="${precio}" aria-label="Precio unitario"></td>
    <td class="td-amount subtotal">$0.00</td>
    <td class="td-actions">
      <button type="button" class="btn btn-ghost btn-icon btn-sm" aria-label="Eliminar equipo"
              onclick="this.closest('tr').remove(); calcularTotal();">
        <i data-lucide="trash-2"></i>
      </button>
    </td>
  `;

  const sel = tr.querySelector('.modelo');
  if (modelo_id) {
    sel.value = modelo_id;
  } else if (modeloNombre) {
    const match = modelosDisponibles.find(m => m.modelo === modeloNombre);
    if (match) sel.value = match.modelo_id;
  }

  tr.querySelectorAll("input").forEach(i => i.addEventListener("input", calcularTotal));
  document.getElementById("tablaEquipos").appendChild(tr);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [tr] });
  calcularTotal();
}

function calcularTotal() {
  let equiposSub = 0;
  document.querySelectorAll("#tablaEquipos tr").forEach(row => {
    const cant = parseFloat(row.querySelector(".cantidad")?.value || 0);
    const price = parseFloat(row.querySelector(".precio")?.value || 0);
    const subtotal = cant * price;
    const sc = row.querySelector(".subtotal"); if (sc) sc.textContent = "$" + subtotal.toFixed(2);
    equiposSub += subtotal;
  });
  equiposSub = FMT.round2(equiposSub);

  // Otros conceptos (si el módulo está cargado)
  const cargos = (window.NCCargos ? NCCargos.leer() : []);
  let cargosRec = 0, cargosUni = 0;
  cargos.forEach(c => { if (c.recurrente) cargosRec += Number(c.monto) || 0; else cargosUni += Number(c.monto) || 0; });
  cargosRec = FMT.round2(cargosRec); cargosUni = FMT.round2(cargosUni);

  // ITBMS: se preserva el del contrato (editar no tiene interruptor propio).
  const itbmsAplica = contratoActual ? (contratoActual.itbms_aplica !== false) : true;
  const mensual = ContractTotals.compute(FMT.round2(equiposSub + cargosRec), itbmsAplica);
  const inicial = ContractTotals.compute(FMT.round2(equiposSub + cargosRec + cargosUni), itbmsAplica);

  const tEl  = document.getElementById("total");        if (tEl)  tEl.textContent  = mensual.totalConITBMS.toFixed(2);
  const ppEl = document.getElementById("primer_pago");  if (ppEl) ppEl.textContent = inicial.totalConITBMS.toFixed(2);
  const ppSt = document.getElementById("stat-primer-pago"); if (ppSt) ppSt.style.display = cargosUni > 0 ? '' : 'none';

  return { equiposSub, cargosRec, cargosUni, itbmsAplica, mensual, inicial, cargos };
}

function refreshRenovacionEditorUI() {
  const accion = document.getElementById("accion")?.value;
  const box = document.getElementById("renovacionBox");
  const badge = document.getElementById("renovacionBadge");
  const checkbox = document.getElementById("renovacion_sin_equipo");
  const refurbWrap = document.getElementById("renovacionRefurbishedWrap");
  if (!box || !badge || !checkbox) return;

  const esRenovacion = accion === "Renovación";
  box.classList.toggle("visible", esRenovacion);

  if (!esRenovacion) {
    checkbox.checked = false;
    checkbox.disabled = true;
    if (refurbWrap) refurbWrap.classList.remove("visible");
    badge.textContent = "Renovación con equipo";
    return;
  }

  checkbox.disabled = false;
  badge.textContent = checkbox.checked ? "Renovación sin equipo" : "Renovación con equipo";
  if (refurbWrap) refurbWrap.classList.toggle("visible", !!checkbox.checked);
}

document.getElementById("formEditar").addEventListener("submit", async e => {
  e.preventDefault();

  const duracionSeleccionada = document.getElementById("duracion").value;
  const otraDuracion = document.getElementById("otra_duracion").value;
  const duracionFinal = duracionSeleccionada === "Otro"
    ? `${otraDuracion} meses`
    : duracionSeleccionada;

  const equipos = [...document.querySelectorAll("#tablaEquipos tr")].map(row => {
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
  const t = calcularTotal(); // recalcula equipos + otros conceptos (mensual + primer pago)
  const accionSeleccionada = document.getElementById("accion").value;
  const esRenovacion = accionSeleccionada === "Renovación";
  const renovacionSinEquipo = esRenovacion && !!document.getElementById("renovacion_sin_equipo")?.checked;
  const renovacionRefurbishedComponentes = esRenovacion
    && renovacionSinEquipo
    && !!document.getElementById("renovacion_refurbished_componentes")?.checked;
  const renovacionModalidad = esRenovacion
    ? (renovacionSinEquipo ? "Renovación sin equipo" : "Renovación con equipo")
    : "";

  const total_equipos = equipos.reduce((acc, e) => acc + Number(e.cantidad || 0), 0);

  await ContratosService.updateContrato(contratoDocId, {
    codigo_tipo: document.getElementById("tipo_contrato").value,
    tipo_contrato: document.getElementById("tipo_contrato").selectedOptions[0].text,
    accion: accionSeleccionada,
    renovacion_sin_equipo: renovacionSinEquipo,
    renovacion_refurbished_componentes: renovacionRefurbishedComponentes,
    renovacion_modalidad: renovacionModalidad,
    duracion: duracionFinal,
    observaciones: document.getElementById("observaciones").value.trim(),
    equipos,
    total_equipos,
    // Otros conceptos + totales consistentes con el alta (mensual + primer pago).
    cargos: t.cargos,
    subtotal_equipos: t.equiposSub,
    cargos_recurrente: t.cargosRec,
    cargos_unico: t.cargosUni,
    subtotal: t.mensual.subtotal,
    itbms_aplica: t.itbmsAplica,
    itbms_porcentaje: FMT.ITBMS_RATE,
    itbms_monto: t.mensual.itbmsMonto,
    total_con_itbms: t.mensual.totalConITBMS,
    total: t.mensual.totalConITBMS,
    total_mensual: t.mensual.totalConITBMS,
    primer_pago: t.inicial.totalConITBMS,
    fecha_modificacion: new Date()
  });

  Toast.show('Cambios guardados', 'ok');
  location.href = "index.html";
});


(async () => {
  await cargarContrato();
})();

document.addEventListener('DOMContentLoaded', () => {
  const selEstado = document.getElementById('estado');
  if (selEstado) selEstado.disabled = true;

  document.getElementById("accion")?.addEventListener("change", refreshRenovacionEditorUI);
  document.getElementById("renovacion_sin_equipo")?.addEventListener("change", refreshRenovacionEditorUI);
  document.getElementById("renovacion_refurbished_componentes")?.addEventListener("change", refreshRenovacionEditorUI);
});

function toggleOtraDuracion(valor) {
  const wrap = document.getElementById("otraDuracionLabel");
  if (wrap) wrap.style.display = valor === "Otro" ? "" : "none";
}

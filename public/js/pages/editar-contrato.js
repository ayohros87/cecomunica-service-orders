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
    window.location.href = `imprimir-contrato.html?id=${encodeURIComponent(contratoDocId)}`;
    return;
  }
  // 3b) Con un enlace de firma pendiente el cliente está leyendo una copia
  // congelada: editar por debajo la dejaría firmando otra cosa (2026-09-04).
  if (c.estado === "aprobado" && c.firma_solicitud_estado === "pendiente") {
    Toast.show('Este contrato tiene un enlace de firma pendiente: no se edita hasta que el cliente firme o se anule la solicitud.', 'bad');
    window.location.href = `../clientes/centro.html?id=${encodeURIComponent(c.cliente_id || "")}`;
    return;
  }
  // Plan por serial del Centro: la modalidad (sin equipo / refurbished) se
  // DERIVA del plan y aquí no se pregunta (mismo criterio que el wizard).
  planSerial = (c.transicion_plan?.nivel === "serial" && Array.isArray(c.transicion_plan.unidades)) ? c.transicion_plan : null;

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
    <td><span class="minput"><input class="td-input td-mono precio" type="number" min="0" step="any" value="${precio}" aria-label="Precio unitario"></span></td>
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
  cargos.forEach(c => { const t = (Number(c.monto) || 0) * (Number(c.cantidad) || 1); if (c.recurrente) cargosRec += t; else cargosUni += t; });
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

let planSerial = null; // contrato.transicion_plan nivel 'serial' (Centro) o null

// Modalidad derivada del plan por serial: mismas reglas que el wizard
// (TransicionPlan.derivarModalidad). `equipos` = líneas tal como están en
// la tabla ahora (la cantidad manda para "radios nuevos").
function modalidadDerivada(equipos) {
  if (!planSerial || !window.TransicionPlan) return null;
  return TransicionPlan.derivarModalidad(planSerial, equipos || []);
}
function leerEquiposTabla() {
  return [...document.querySelectorAll("#tablaEquipos tr")].map(row => ({
    modelo_id: row.querySelector(".modelo")?.value.trim() || "",
    cantidad: parseInt(row.querySelector(".cantidad")?.value || 0) || 0,
  }));
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

  // Plan por serial: las casillas no aplican — se muestra lo derivado.
  const derivWrap = document.getElementById("renovacionDerivada");
  if (esRenovacion && planSerial) {
    const m = modalidadDerivada(leerEquiposTabla());
    checkbox.checked = !!m?.sin_equipo; checkbox.disabled = true;
    const refurb = document.getElementById("renovacion_refurbished_componentes");
    if (refurb) { refurb.checked = !!m?.refurbished; refurb.disabled = true; }
    checkbox.closest("label")?.classList.add("hidden");
    if (refurbWrap) refurbWrap.classList.remove("visible");
    badge.textContent = m?.sin_equipo ? "Renovación sin equipo" : "Renovación con equipo";
    if (derivWrap && m) {
      derivWrap.classList.remove("hidden");
      derivWrap.textContent = `Derivado del plan por serial declarado en el Centro: ${m.continuan} continúa${m.continuan === 1 ? "" : "n"}`
        + (m.reemplazos ? ` · ${m.reemplazos} reemplazo${m.reemplazos === 1 ? "" : "s"}` : "")
        + (m.nuevos ? ` · ${m.nuevos} radio${m.nuevos === 1 ? "" : "s"} nuevo${m.nuevos === 1 ? "" : "s"} (cantidad de línea por encima de los seriales)` : "")
        + ` · refurbished: ${m.refurbished ? `sí (${m.refurbished_n})` : "no"}. Los seriales se corrigen en el Centro → Seriales de la cuenta.`;
    }
    return;
  }
  if (derivWrap) derivWrap.classList.add("hidden");
  checkbox.closest("label")?.classList.remove("hidden");

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

// Guardia de salida (kit de formularios): cambios sin guardar avisan antes de
// cerrar la pestaña; el submit la libera solo.
if (window.FormKit) FormKit.guardia(document.getElementById("formEditar"));

document.getElementById("formEditar").addEventListener("submit", async e => {
  e.preventDefault();

  const duracionSeleccionada = document.getElementById("duracion").value;
  const otraDuracionEl = document.getElementById("otra_duracion");
  const otraDuracion = otraDuracionEl.value.trim();
  // Mismo candado que el alta (nc-guardar.js): "Otro" sin meses guardaba
  // una duración " meses" vacía que llegaba al documento impreso. El error
  // se marca JUNTO AL CAMPO (formato único), no solo con el aviso.
  otraDuracionEl.closest(".form-field")?.classList.remove("has-error");
  if (duracionSeleccionada === "Otro" && !(parseInt(otraDuracion, 10) > 0)) {
    otraDuracionEl.closest(".form-field")?.classList.add("has-error");
    Toast.show('Elegiste duración "Otro": indica el número de meses.', 'warn');
    otraDuracionEl.focus();
    otraDuracionEl.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  const duracionFinal = duracionSeleccionada === "Otro"
    ? `${otraDuracion} meses`
    : duracionSeleccionada;

  // Guard anti doble-submit: dos clicks rápidos = dos updateContrato.
  const btnSubmit = e.target.querySelector('button[type="submit"]');
  if (btnSubmit) { if (btnSubmit.disabled) return; btnSubmit.disabled = true; }

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
  // Con plan por serial la modalidad se deriva (no de las casillas); sin
  // plan, refurbished ya no exige "sin equipo" (2026-09-04).
  const mDeriv = esRenovacion ? modalidadDerivada(equipos) : null;
  const renovacionSinEquipo = esRenovacion && (mDeriv ? mDeriv.sin_equipo : !!document.getElementById("renovacion_sin_equipo")?.checked);
  const renovacionRefurbishedComponentes = esRenovacion
    && (mDeriv ? mDeriv.refurbished : !!document.getElementById("renovacion_refurbished_componentes")?.checked);
  const renovacionModalidad = esRenovacion
    ? (renovacionSinEquipo ? "Renovación sin equipo" : "Renovación con equipo")
    : "";

  const total_equipos = equipos.reduce((acc, e) => acc + Number(e.cantidad || 0), 0);

  // Contrato APROBADO editado en lo económico o el plazo (2026-09-04, Alberto:
  // "el vendedor puede ajustar, pero sin reaprobación nadie se entera"):
  // vuelve a PENDIENTE DE APROBACIÓN con rastro de la aprobación anterior y
  // aviso a ventas. Los triggers de aprobación son idempotentes (seriales,
  // plan, verificación), así que re-aprobar no duplica nada.
  const re = (contratoActual?.estado === "aprobado" && window.ContratoTarifario?.requiereReaprobacion)
    ? ContratoTarifario.requiereReaprobacion(contratoActual, { equipos, cargos: t.cargos, duracion: duracionFinal, itbms_aplica: t.itbmsAplica })
    : { requiere: false, cambios: [] };
  const reaprobacion = re.requiere ? {
    estado: "pendiente_aprobacion",
    reaprobacion: {
      motivo: `Edición tras aprobar: ${re.cambios.join(", ")}`,
      at: new Date(),
      por_uid: firebase.auth().currentUser?.uid || null,
      aprobado_antes_por_uid: contratoActual.aprobado_por_uid || null,
      fecha_aprobacion_anterior: contratoActual.fecha_aprobacion || null,
      total_mensual_anterior: Number(contratoActual.total_mensual || 0),
    },
  } : {};

  const actualizacion = ContratosService.updateContrato(contratoDocId, {
    ...reaprobacion,
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
  try {
    await actualizacion;
  } catch (err) {
    Toast.show('No se pudo guardar: ' + ((err && err.message) || err), 'bad');
    if (btnSubmit) btnSubmit.disabled = false;
    return;
  }

  if (re.requiere) {
    // Aviso al aprobador — mismo buzón y mismo CTA que "Nuevo contrato creado".
    try {
      const esc = (s) => String(s ?? "").replace(/[<>&]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
      const filas = equipos.map(l => `<li>${esc(l.modelo)} – ${l.cantidad} × $${Number(l.precio || 0).toFixed(2)}</li>`).join("");
      await firebase.firestore().collection("mail_queue").add({
        to: "ventas@cecomunica.com",
        cc: firebase.auth().currentUser?.email || null,
        subject: `Contrato ${contratoActual.contrato_id || contratoDocId} editado tras aprobar — requiere nueva aprobación`,
        preheader: `${contratoActual.cliente_nombre || ""}: cambió ${re.cambios.join(", ")}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Contrato editado después de aprobado</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            El contrato <b>${esc(contratoActual.contrato_id || contratoDocId)}</b> de <b>${esc(contratoActual.cliente_nombre || "—")}</b>
            ya estaba aprobado y se editó: cambió <b>${esc(re.cambios.join(", "))}</b>.
            Volvió a <b>pendiente de aprobación</b>. Mensual anterior: $${Number(contratoActual.total_mensual || 0).toFixed(2)} →
            nuevo: <b>$${Number(t.mensual.totalConITBMS || 0).toFixed(2)}</b>.</p>
          <ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${filas}</ul>`,
        ctaUrl: `${location.origin}/clientes/centro.html?id=${encodeURIComponent(contratoActual.cliente_id || "")}`,
        ctaLabel: "Revisar y aprobar en el Centro",
        meta: { source: "editar-contrato-reaprobacion", contrato_id: contratoActual.contrato_id || contratoDocId, created_at: firebase.firestore.FieldValue.serverTimestamp() },
        status: "queued",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) { console.warn("No se pudo encolar el aviso de reaprobación:", err); }
    Toast.show('Cambios guardados — el contrato vuelve a pendiente de aprobación (se avisó a ventas)', 'warn');
  } else {
    Toast.show('Cambios guardados', 'ok');
  }
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

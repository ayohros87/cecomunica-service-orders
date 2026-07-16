// @ts-nocheck
// Cliente form (create + edit). Normalización + tokens viven en ClientesService.

const auth = firebase.auth();

// Pobla el <select id="ip"> con los bloques IP de empresa/IPs. Conserva la opción
// vacía ("Sin IP asignado") como primer ítem. Si se pasa un valor que no está en
// la lista, lo agrega para no perderlo (p. ej. un IP legacy guardado en el cliente).
async function cargarListaIPs(valorActual = "") {
  const select = document.getElementById("ip");
  if (!select) return;
  let lista = [];
  try {
    const snap = await EmpresaService.getDoc("IPs");
    lista = (snap && Array.isArray(snap.list)) ? snap.list.slice() : [];
  } catch (err) {
    console.warn("[nuevo-cliente] no se pudo cargar empresa/IPs:", err?.code || err);
  }
  lista.sort((a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" }));
  select.innerHTML = '<option value="">Sin IP asignado</option>';
  for (const ip of lista) {
    select.appendChild(new Option(ip, ip));
  }
  if (valorActual && !lista.includes(valorActual)) {
    select.appendChild(new Option(valorActual, valorActual));
  }
  select.value = valorActual || "";
}

// Agrega un bloque IP a empresa/IPs (mismo patrón que Nuevo batch) y lo selecciona.
async function agregarIP() {
  const nuevo = (prompt("Nuevo bloque IP (ej. cliente.cecomunica.net):") || "").trim();
  if (!nuevo) return;
  const snap = await EmpresaService.getDoc("IPs");
  const lista = snap && Array.isArray(snap.list) ? snap.list : [];
  if (!lista.includes(nuevo)) {
    lista.push(nuevo);
    await EmpresaService.setDoc("IPs", { list: lista });
  }
  const select = document.getElementById("ip");
  if (![...select.options].some(o => o.value === nuevo)) {
    select.appendChild(new Option(nuevo, nuevo));
  }
  select.value = nuevo;
}

function mostrarMensaje(texto, color = "green") {
  const msg = document.getElementById("mensaje");
  msg.textContent = texto;
  msg.style.color = color;
  msg.style.fontWeight = "bold";
  msg.style.marginTop = "10px";
  Toast.show(texto, color === "green" ? "ok" : "bad");
}

auth.onAuthStateChanged(user => {
  if (!user) { window.location.href = "/login.html"; return; }

  document.getElementById("formCliente").addEventListener("submit", async e => {
    e.preventDefault();

    const params = new URLSearchParams(window.location.search);
    const clienteId = params.get("id");
    const currentUser = firebase.auth().currentUser;

    // 1) Recolectar valores crudos del form
    const raw = {
      nombre: document.getElementById("nombre").value,
      ruc: document.getElementById("ruc").value,
      dv: document.getElementById("dv").value,
      direccion: document.getElementById("direccion").value,
      telefono: document.getElementById("telefono").value,
      email: document.getElementById("email").value,
      representante: document.getElementById("representante").value,
      representante_cedula: document.getElementById("representante_cedula").value,
      ip: document.getElementById("ip")?.value || "",
      direccion_facturacion: document.getElementById("direccion_facturacion").value,
      itbms_exento: document.getElementById("itbms_exento")?.value === "true",
      itbms_motivo_exencion: document.getElementById("itbms_motivo_exencion")?.value || "",
    };

    // 2) Validaciones mínimas
    if (!raw.nombre.trim()) { mostrarMensaje("⚠️ Debes ingresar un nombre", "red"); return; }
    if (raw.nombre.includes("/")) { mostrarMensaje("❌ El nombre no puede contener '/'", "red"); return; }
    if (raw.dv.trim() && !/^\d{1,2}$/.test(raw.dv.trim())) {
      mostrarMensaje("❌ DV inválido. Debe tener 1–2 dígitos.", "red"); return;
    }
    if (raw.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim().toLowerCase())) {
      mostrarMensaje("❌ Email inválido.", "red"); return;
    }

    // 3) Payload normalizado (single source of truth en el service)
    const cliente = ClientesService.buildClientePayload(raw, { user: currentUser, isCreate: !clienteId });

    // 4) Unicidad (SOLO al crear) — ignora soft-deleted para no bloquear reactivaciones
    if (!clienteId) {
      if (cliente.rucdv_norm && cliente.dv_norm) {
        if (await ClientesService.existsActiveByNorm("rucdv_norm", cliente.rucdv_norm)) {
          mostrarMensaje("❌ Ya existe un cliente con ese RUC + DV.", "red"); return;
        }
      }
      if (cliente.ruc_norm) {
        if (await ClientesService.existsActiveByNorm("ruc_norm", cliente.ruc_norm)) {
          mostrarMensaje("❌ Ya existe un cliente con ese RUC/Cédula.", "red"); return;
        }
      }
      if (await ClientesService.existsActiveByNorm("nombre_norm", cliente.nombre_norm)) {
        mostrarMensaje("❌ Ya existe un cliente con ese nombre.", "red"); return;
      }
    }

    // 5) Persistir
    let targetId = clienteId;
    if (clienteId) {
      await ClientesService.updateCliente(clienteId, cliente);
    } else {
      targetId = await ClientesService.createCliente(cliente);
    }

    // 6) Salida según contexto
    mostrarMensaje(clienteId ? "✅ Cliente actualizado correctamente" : "✅ Cliente guardado exitosamente", "green");
    setTimeout(() => {
      if (params.get("from") === "clientes") {
        window.location.href = "../clientes/index.html";
      } else if (params.get("from") === "cotizacion") {
        window.location.href = `../cotizaciones/nueva-cotizacion.html?cliente_id=${targetId}`;
      } else {
        window.location.href = `nuevo-contrato.html?cliente_id=${targetId}`;
      }
    }, 800);
  });
});

window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const clienteId = params.get("id");
  let ipActual = "";

  // Wire del botón "agregar IP" (independiente del modo crear/editar).
  document.getElementById("addIP")?.addEventListener("click", agregarIP);

  if (clienteId) {
    document.getElementById("pageTitle").textContent = "🧾 Editar Cliente";

    const d = await ClientesService.getCliente(clienteId);
    if (!d) return;

    document.getElementById("nombre").value = d.nombre || "";
    document.getElementById("ruc").value = d.ruc || "";
    document.getElementById("dv").value = d.dv || "";
    document.getElementById("direccion").value = d.direccion || "";
    document.getElementById("telefono").value = d.telefono || "";
    document.getElementById("email").value = d.email || "";
    document.getElementById("representante").value = d.representante || "";
    // Tolerar legacy `cedula_representante` además del canónico
    document.getElementById("representante_cedula").value =
      d.representante_cedula || d.cedula_representante || "";
    document.getElementById("direccion_facturacion").value = d.direccion_facturacion || "";
    ipActual = d.ip || "";

    const selExento = document.getElementById("itbms_exento");
    if (selExento) selExento.value = d.itbms_exento ? "true" : "false";
    const motivoInput = document.getElementById("itbms_motivo_exencion");
    if (motivoInput) motivoInput.value = d.itbms_motivo_exencion || "";

    cargarEquiposCliente(clienteId); // no bloquea el resto del formulario
  }

  // Cargar lista de bloques IP (preseleccionando el del cliente en edición).
  await cargarListaIPs(ipActual);

  // Mostrar/ocultar motivo según el select de ITBMS
  const selExento = document.getElementById("itbms_exento");
  const motivoWrap = document.getElementById("motivoExencionWrap");
  const syncMotivoVisibility = () => {
    if (!selExento || !motivoWrap) return;
    motivoWrap.style.display = (selExento.value === "true") ? "" : "none";
  };
  if (selExento) selExento.addEventListener("change", syncMotivoVisibility);
  syncMotivoVisibility();

  // Format RUC on the fly (remove spaces)
  document.getElementById("ruc").addEventListener("input", (e) => {
    e.target.value = (e.target.value || "").replace(/\s+/g, "");
  });

  document.getElementById("nombre").focus();
});

// Sección "Equipos del cliente" (solo edición): unidades del pool de equipos
// serializados asignadas a este cliente, con estado actual, link al contrato y
// al kardex. Best-effort: si el servicio no está o la consulta falla (o no hay
// unidades), la sección simplemente no se muestra.
async function cargarEquiposCliente(clienteId) {
  if (typeof EquiposPoolService === "undefined") return;
  let unidades = [];
  try { unidades = await EquiposPoolService.listarPorCliente(clienteId); }
  catch (e) { return; }
  if (!unidades.length) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));

  const filas = unidades.map(u => `
    <tr>
      <td style="padding:6px 10px; border-bottom:1px solid var(--border-subtle); font-family:var(--font-mono,monospace);">
        <a class="eq-link" href="${EquiposPoolService.kardexUrl(u.serial || u.serial_norm)}" title="Ver historia (kardex) en Equipos por serial">${esc(u.serial || u.serial_norm)}</a>
      </td>
      <td style="padding:6px 10px; border-bottom:1px solid var(--border-subtle);">${esc(u.modelo_label || "—")}</td>
      <td style="padding:6px 10px; border-bottom:1px solid var(--border-subtle);">${EquiposPoolService.chipEstadoHtml(u.estado)}</td>
      <td style="padding:6px 10px; border-bottom:1px solid var(--border-subtle);">
        ${u.asignacion?.contrato_id
          ? `<a class="eq-link" href="index.html?buscar=${encodeURIComponent(u.asignacion.contrato_id)}" title="Buscar el contrato en la lista">${esc(u.asignacion.contrato_id)}</a>`
          : "—"}
      </td>
    </tr>`).join("");

  const body = document.getElementById("equiposClienteBody");
  const section = document.getElementById("equiposClienteSection");
  if (!body || !section) return;
  body.innerHTML = `
    <p class="form-hint" style="margin-top:0;">
      ${unidades.length} unidad(es) registradas a este cliente en el pool de equipos serializados.
      El serial abre su historia (kardex).
    </p>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px; min-width:520px;">
        <thead>
          <tr style="text-align:left; color:var(--fg-3); font-size:12px;">
            <th style="padding:6px 10px;">Serial</th>
            <th style="padding:6px 10px;">Modelo</th>
            <th style="padding:6px 10px;">Estado</th>
            <th style="padding:6px 10px;">Contrato</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  section.style.display = "";
}

function volverAContrato() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") === "clientes") {
    window.location.href = "../clientes/index.html";
    return;
  }
  const clienteId = params.get("id");
  window.location.href = clienteId
    ? `nuevo-contrato.html?cliente_id=${clienteId}`
    : "nuevo-contrato.html";
}

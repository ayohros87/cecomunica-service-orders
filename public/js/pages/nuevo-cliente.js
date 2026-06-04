// @ts-nocheck
// Cliente form (create + edit). Normalización + tokens viven en ClientesService.

const auth = firebase.auth();

// Picker de organización (matriz). Se monta en DOMContentLoaded.
let orgPicker = null;

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
    const org = orgPicker ? orgPicker.getValue() : { id: "", nombre: "" };
    const raw = {
      nombre: document.getElementById("nombre").value,
      cuenta_alias: document.getElementById("cuenta_alias")?.value || "",
      organizacionId: org.id,
      organizacion_nombre: org.nombre,
      ruc: document.getElementById("ruc").value,
      dv: document.getElementById("dv").value,
      direccion: document.getElementById("direccion").value,
      telefono: document.getElementById("telefono").value,
      email: document.getElementById("email").value,
      representante: document.getElementById("representante").value,
      representante_cedula: document.getElementById("representante_cedula").value,
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
      // ¿Ya existe el RUC? Puede ser un duplicado real o una cuenta adicional
      // del mismo cliente (mismo RUC, distinta cuenta).
      let rucExiste = false;
      if (cliente.rucdv_norm && cliente.dv_norm) {
        rucExiste = await ClientesService.existsActiveByNorm("rucdv_norm", cliente.rucdv_norm);
      } else if (cliente.ruc_norm) {
        rucExiste = await ClientesService.existsActiveByNorm("ruc_norm", cliente.ruc_norm);
      }

      if (rucExiste) {
        // Para crear una cuenta adicional exigimos un alias que la distinga.
        if (!cliente.cuenta_alias) {
          mostrarMensaje("❌ Ya existe un cliente con ese RUC. Si es una cuenta adicional del mismo cliente, ponle un “Alias de cuenta” (ej. Sucursal X) para distinguirla.", "red");
          document.getElementById("cuenta_alias")?.focus();
          return;
        }
        if (!confirm(`Ya existe un cliente con el RUC ${cliente.ruc || cliente.ruc_norm}. ¿Crear “${cliente.cuenta_alias}” como cuenta adicional bajo el mismo RUC?`)) return;
        // Cuenta adicional: se permite compartir RUC (y, por ende, nombre).
      } else {
        // RUC nuevo → mantener el chequeo de nombre para evitar duplicados accidentales.
        if (cliente.nombre_norm && await ClientesService.existsActiveByNorm("nombre_norm", cliente.nombre_norm)) {
          mostrarMensaje("❌ Ya existe un cliente con ese nombre.", "red"); return;
        }
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

  // Monta el picker de organización (reutilizable).
  const orgMount = document.getElementById("organizacion");
  if (orgMount && window.OrganizacionPicker) {
    orgPicker = OrganizacionPicker.mount(orgMount, {});
  }

  if (clienteId) {
    document.getElementById("pageTitle").textContent = "🧾 Editar Cliente";

    const d = await ClientesService.getCliente(clienteId);
    if (!d) return;

    document.getElementById("nombre").value = d.nombre || "";
    const aliasInput = document.getElementById("cuenta_alias");
    if (aliasInput) aliasInput.value = d.cuenta_alias || "";
    if (orgPicker && d.organizacionId) {
      orgPicker.setValue({ id: d.organizacionId, nombre: d.organizacion_nombre || "" });
    }
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

    const selExento = document.getElementById("itbms_exento");
    if (selExento) selExento.value = d.itbms_exento ? "true" : "false";
    const motivoInput = document.getElementById("itbms_motivo_exencion");
    if (motivoInput) motivoInput.value = d.itbms_motivo_exencion || "";
  }

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

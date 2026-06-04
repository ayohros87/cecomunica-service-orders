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

      if (rucExiste && cliente.organizacionId) {
        // Pertenece a una organización: compartir RUC con sus otras cuentas (sedes)
        // es lo esperado. No exigimos nada extra.
      } else if (rucExiste) {
        // Sin organización: confirmamos crear otra cuenta con el mismo RUC.
        // (Si son sedes del mismo cliente, lo correcto es agruparlas en una organización.)
        if (!confirm(`Ya existe un cliente con el RUC ${cliente.ruc || cliente.ruc_norm}. ¿Crear “${cliente.nombre}” como otra cuenta con el mismo RUC?\n\nSugerencia: si son cuentas del mismo cliente, agrúpalas en una organización.`)) return;
      } else {
        // RUC nuevo → mantener el chequeo de nombre para evitar duplicados accidentales.
        if (cliente.nombre_norm && await ClientesService.existsActiveByNorm("nombre_norm", cliente.nombre_norm)) {
          mostrarMensaje("❌ Ya existe un cliente con ese nombre.", "red"); return;
        }
      }
    }

    // 4.5) Auto-provisión de organización por RUC (modelo: toda cuenta pertenece
    // a una organización = entidad legal). Si el usuario no eligió una org en el
    // picker y hay RUC, se busca-o-crea la organización de ese RUC y la cuenta
    // hereda su ficha fiscal (fuente única de verdad).
    if (!cliente.organizacionId && cliente.ruc_norm && window.OrganizacionesService) {
      try {
        const org = await OrganizacionesService.obtenerOCrearPorRuc({
          nombre: cliente.nombre,
          ruc: cliente.ruc, dv: cliente.dv,
          representante: cliente.representante,
          representante_cedula: cliente.representante_cedula,
          itbms_exento: cliente.itbms_exento,
          itbms_motivo_exencion: cliente.itbms_motivo_exencion,
        }, { user: currentUser });
        if (org) {
          cliente.organizacionId = org.id;
          Object.assign(cliente, OrganizacionesService.fiscalMirror(org));
          cliente.searchTokens = ClientesService.buildSearchTokens(cliente);
        }
      } catch (e) {
        console.error("auto-provisión de organización:", e);
        // No bloquea el alta del cliente, pero lo avisamos (queda sin organización).
        if (window.Toast) Toast.show("Aviso: no se pudo asignar la organización automáticamente (" + (e.message || e) + ").", "warn");
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

  const selExento = document.getElementById("itbms_exento");
  const motivoInput = document.getElementById("itbms_motivo_exencion");
  const motivoWrap = document.getElementById("motivoExencionWrap");
  const orgHint = document.getElementById("orgHerenciaHint");

  // Mostrar/ocultar motivo según el select de ITBMS
  const syncMotivoVisibility = () => {
    if (!selExento || !motivoWrap) return;
    motivoWrap.style.display = (selExento.value === "true") ? "" : "none";
  };
  if (selExento) selExento.addEventListener("change", syncMotivoVisibility);

  // ── Herencia fiscal desde la organización ──────────────────────────────
  // v2: la org POSEE la ficha fiscal. Si la cuenta tiene organización, esos
  // campos se heredan y se bloquean (se editan en Admin → Organizaciones).
  // El nombre, alias, dirección y contacto siguen siendo de la cuenta.
  function setFiscalReadonly(ro) {
    ["ruc", "dv", "representante", "representante_cedula", "itbms_motivo_exencion"].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.readOnly = ro; el.classList.toggle("is-inherited", ro); }
    });
    if (selExento) { selExento.disabled = ro; selExento.classList.toggle("is-inherited", ro); }
  }
  async function aplicarHerenciaOrg(orgId) {
    if (!orgId) {
      setFiscalReadonly(false);
      if (orgHint) orgHint.style.display = "none";
      return;
    }
    try {
      const org = await OrganizacionesService.getOrg(orgId);
      if (!org) return;
      document.getElementById("ruc").value = org.ruc || "";
      document.getElementById("dv").value = org.dv || "";
      document.getElementById("representante").value = org.representante || "";
      document.getElementById("representante_cedula").value = org.representante_cedula || "";
      if (selExento) selExento.value = org.itbms_exento ? "true" : "false";
      if (motivoInput) motivoInput.value = org.itbms_motivo_exencion || "";
      syncMotivoVisibility();
      setFiscalReadonly(true);
      if (orgHint) {
        orgHint.textContent = `Datos fiscales heredados de la organización “${org.nombre}”. Para cambiarlos, edita la organización en Admin → Organizaciones.`;
        orgHint.style.display = "";
      }
    } catch (e) { console.error("herencia org:", e); }
  }

  // Monta el picker de organización (reutilizable) con herencia al cambiar.
  const orgMount = document.getElementById("organizacion");
  if (orgMount && window.OrganizacionPicker) {
    orgPicker = OrganizacionPicker.mount(orgMount, { onChange: (v) => aplicarHerenciaOrg(v && v.id) });
  }

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
    if (selExento) selExento.value = d.itbms_exento ? "true" : "false";
    if (motivoInput) motivoInput.value = d.itbms_motivo_exencion || "";

    if (orgPicker && d.organizacionId) {
      orgPicker.setValue({ id: d.organizacionId, nombre: d.organizacion_nombre || "" });
      await aplicarHerenciaOrg(d.organizacionId);
    }
  }

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

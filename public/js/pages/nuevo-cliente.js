// @ts-nocheck
    const auth = firebase.auth();

    auth.onAuthStateChanged(user => {
      if (!user) {
        window.location.href = "/login.html";
        return;
      }

      function mostrarMensaje(texto, color = "green") {
        const msg = document.getElementById("mensaje");
        msg.textContent = texto;
        msg.style.color = color;
        msg.style.fontWeight = "bold";
        msg.style.marginTop = "10px";
        Toast.show(texto, color === "green" ? "ok" : "bad");
      }

// Normaliza: minúsculas, sin acentos
function norm(s){
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .trim();
}
// Prefijos por palabra: "instituto" → in, ins, inst, ...
function tokensFrom(text){
  if(!text) return [];
  const parts = norm(text).split(/[^a-z0-9]+/).filter(Boolean);
  const toks = new Set();
  for(const p of parts){
    for(let i=2; i<=p.length; i++) toks.add(p.slice(0,i));
  }
  return Array.from(toks).slice(0, 200); // seguridad
}

function buildSearchTokens(cliente){
  const tokens = new Set([
    ...tokensFrom(cliente.nombre),
    ...tokensFrom(cliente.representante),
    ...tokensFrom(cliente.direccion),
  ]);
  // tags (si en el futuro las agregas)
  if (Array.isArray(cliente.tags)) {
    for (const t of cliente.tags) tokensFrom(t).forEach(x=>tokens.add(x));
  }
  // RUC solo dígitos
  if (cliente.ruc) tokens.add(cliente.ruc.replace(/\D/g,""));
  // RUC+DV normalizado (solo dígitos); ej: "1234567-55" → "1234567-55" y "123456755"
  if (cliente.rucdv_norm) {
    tokens.add(cliente.rucdv_norm);
    tokens.add(cliente.rucdv_norm.replace(/\D/g,""));
  }
  return Array.from(tokens);
}

document.getElementById("formCliente").addEventListener("submit", async e => {
  e.preventDefault();

  const accion = (e.submitter && e.submitter.dataset.accion) || "guardar";

  // 1) Construir objeto base
  const cliente = {
    nombre: document.getElementById("nombre").value.trim(),
    ruc: document.getElementById("ruc").value.trim(),
    dv: (document.getElementById("dv").value || "").trim(),
    direccion: document.getElementById("direccion").value.trim(),
    telefono: document.getElementById("telefono").value.trim(),
    email: document.getElementById("email").value.trim(),
    representante: document.getElementById("representante").value.trim(),
    representante_cedula: document.getElementById("representante_cedula").value.trim(),
    direccion_facturacion: document.getElementById("direccion_facturacion").value.trim()
  };

  // 2) Validaciones mínimas
  if (!cliente.nombre) {
    mostrarMensaje("⚠️ Debes ingresar un nombre", "red"); return;
  }
  // Solo bloquear "/" porque no puede estar en IDs
if (cliente.nombre.includes("/")) {
  mostrarMensaje("❌ El nombre no puede contener '/'", "red");
  return;
}
// DV: si se ingresa, debe ser 1–2 dígitos
if (cliente.dv && !/^\d{1,2}$/.test(cliente.dv)) {
  mostrarMensaje("❌ DV inválido. Debe tener 1–2 dígitos.", "red"); 
  return;
}

  // 3) Sanitizar y normalizar (ANTES de consultas)
  cliente.email = cliente.email.toLowerCase().trim();
  cliente.telefono = cliente.telefono.replace(/[^\d+]/g, ""); // deja dígitos y '+'

  // Email
  if (cliente.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) {
    mostrarMensaje("❌ Email inválido.", "red"); return;
  }

  const user = firebase.auth().currentUser;
  const ahoraSrv = firebase.firestore.FieldValue.serverTimestamp();
  cliente.nombre_norm = cliente.nombre.toLowerCase().trim();
  cliente.ruc_norm = (cliente.ruc || "").replace(/\D/g, "");
  cliente.dv_norm = (cliente.dv || "").replace(/\D/g, "");
  cliente.rucdv_norm = cliente.ruc_norm + (cliente.dv_norm ? ("-" + cliente.dv_norm) : "");
  cliente.activo = true;
  cliente.updated_at = ahoraSrv;
  cliente.updated_by = user?.uid || null;
  cliente.searchTokens = buildSearchTokens(cliente);

  // 4) Deducción de contexto (crear vs editar)
  const params = new URLSearchParams(window.location.search);
  const clienteId = params.get("id");
// 5) Unicidad (SOLO al crear)
if (!clienteId) {
  if (cliente.rucdv_norm && cliente.dv_norm) {
    if (await ClientesService.existsByNorm("rucdv_norm", cliente.rucdv_norm)) {
      mostrarMensaje("❌ Ya existe un cliente con ese RUC + DV.", "red"); return;
    }
  }
  if (cliente.ruc_norm) {
    if (await ClientesService.existsByNorm("ruc_norm", cliente.ruc_norm)) {
      mostrarMensaje("❌ Ya existe un cliente con ese RUC/Cédula.", "red"); return;
    }
  }
  if (await ClientesService.existsByNorm("nombre_norm", cliente.nombre_norm)) {
    mostrarMensaje("❌ Ya existe un cliente con ese nombre.", "red"); return;
  }
}


  // 6) Guardar UNA sola vez (serverTimestamp)
  if (clienteId) {
    await ClientesService.updateCliente(clienteId, cliente);
  } else {
    cliente.created_at = ahoraSrv;
    cliente.created_by = user?.uid || null;
    cliente.vendedor_asignado = user?.uid || null;
    cliente.vendedor_email = user?.email || null;
    cliente.deleted = false;
    const nuevoClienteId = await ClientesService.createCliente(cliente);

    // Si es "guardar": redirige al contrato con el nuevo cliente_id
    mostrarMensaje("✅ Cliente guardado exitosamente", "green");
setTimeout(() => {
  if (params.has("from") && params.get("from") === "clientes") {
    window.location.href = "../clientes/index.html";
  } else {
    window.location.href = `nuevo-contrato.html?cliente_id=${nuevoClienteId}`;
  }
}, 800);

    return;
  }

// 7) Flujos de salida (editar o crear con "guardar")
mostrarMensaje("✅ Cliente actualizado correctamente", "green");
setTimeout(() => {
  if (params.has("from") && params.get("from") === "clientes") {
    window.location.href = "../clientes/index.html";
  } else {
    window.location.href = `nuevo-contrato.html?cliente_id=${clienteId}`;
  }
}, 800);

});
    });

    window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const clienteId = params.get("id");

  // Update page title if editing
  if (clienteId) {
    document.getElementById("pageTitle").textContent = "🧾 Editar Cliente";
    
    const doc = await ClientesService.getCliente(clienteId);
    if (!doc) return;

    const d = doc;
    document.getElementById("nombre").value = d.nombre || "";
    document.getElementById("ruc").value = d.ruc || "";
    document.getElementById("dv").value = d.dv || "";
    document.getElementById("direccion").value = d.direccion || "";
    document.getElementById("telefono").value = d.telefono || "";
    document.getElementById("email").value = d.email || "";
    document.getElementById("representante").value = d.representante || "";
    document.getElementById("representante_cedula").value = d.representante_cedula || "";
    document.getElementById("direccion_facturacion").value = d.direccion_facturacion || "";
  }

  // Format RUC on the fly (remove spaces)
  document.getElementById("ruc").addEventListener("input", (e) => {
    e.target.value = (e.target.value || "").replace(/\s+/g, "");
  });

  // Auto-focus on nombre field
  document.getElementById("nombre").focus();
});
function volverAContrato() {
  const params = new URLSearchParams(window.location.search);

  if (params.has("from") && params.get("from") === "clientes") {
    // Si vino desde el módulo de clientes
    window.location.href = "../clientes/index.html";
    return;
  }

  // Caso por defecto: flujo de contratos
  const clienteId = params.get("id");
  if (clienteId) {
    window.location.href = `nuevo-contrato.html?cliente_id=${clienteId}`;
  } else {
    window.location.href = "nuevo-contrato.html";
  }
}



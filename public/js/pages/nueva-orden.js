
    const form = document.getElementById("ordenForm");
    const mensaje = document.getElementById("mensaje");
    const clienteSelect = document.getElementById("cliente");
    const tipoSelect = document.getElementById("tipo");
    const numeroInput = document.getElementById("numero");
    
    // Variables para el bloque de contrato
    const contratoBlock = document.getElementById("contratoBlock");
    const contratoSelect = document.getElementById("contratoSelect");
    const contratoNoAplica = document.getElementById("contratoNoAplica");
    const contratoMotivo = document.getElementById("contratoMotivo");
    const contratoMotivoField = document.getElementById("contratoMotivoField");
    const contratoLabel = document.getElementById("contratoLabel");
    
    // Función para normalizar el tipo de servicio (sin tildes, sin espacios, mayúsculas)
    function normalizarTipo(tipo) {
      return (tipo || "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // Elimina diacríticos (tildes)
    }
    
    // Función para verificar si es tipo PROGRAMACION
    function esProgramacion(tipo) {
      return normalizarTipo(tipo) === "PROGRAMACION";
    }
    
    // Función para cargar contratos del cliente
    async function cargarContratosDelCliente(clienteId) {
      contratoSelect.innerHTML = '<option value="">Seleccione contrato</option>';
      
      if (!clienteId) return;
      
      try {
        // ✅ Query simplificado: Firestore no requiere orderBy para deleted cuando usamos == false
        // Esto evita errores de índice compuesto
        const contratosCliente = await ContratosService.getContratosActivosPorCliente(clienteId);

        contratosCliente.forEach(contrato => {
          const option = document.createElement("option");
          option.value = contrato.id;

          // Formato: CT-XXX — Tipo — Estado — 📻 X equipos
          const contratoId = contrato.contrato_id || contrato.id;
          const tipoContrato = contrato.tipo_contrato || "N/A";
          const estado = contrato.estado || "N/A";

          // Agregar total de equipos si existe
          const total = Number(contrato.total_equipos);
          const extra = Number.isFinite(total) ? ` — 📻 ${total} equipos` : "";

          option.textContent = `${contratoId} — ${tipoContrato} — ${estado}${extra}`;
          contratoSelect.appendChild(option);
        });

        if (contratosCliente.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "(No hay contratos vigentes)";
          option.disabled = true;
          contratoSelect.appendChild(option);
        }
      } catch (error) {
        console.error("Error cargando contratos:", error);
        mostrarMensaje("⚠️ Error al cargar contratos: " + error.message, "rojo");
      }
    }

    // Event listener para tipo de servicio
    tipoSelect.addEventListener("change", async function() {
      const tipo = tipoSelect.value;
      
      if (esProgramacion(tipo)) {
        // Mostrar bloque de contrato
        contratoBlock.style.display = "block";
        
        // Por defecto: aplica contrato (checkbox desmarcado)
        contratoNoAplica.checked = false;
        contratoSelect.disabled = false;
        contratoSelect.required = true;
        contratoLabel.classList.add("req");
        contratoMotivoField.style.display = "none";
        contratoMotivo.required = false;
        contratoMotivo.value = "";
        
        // Cargar contratos si hay cliente seleccionado
        if (clienteSelect.value) {
          await cargarContratosDelCliente(clienteSelect.value);
        }
      } else {
        // Ocultar y limpiar bloque de contrato
        contratoBlock.style.display = "none";
        contratoSelect.value = "";
        contratoSelect.required = false;
        contratoLabel.classList.remove("req");
        contratoNoAplica.checked = false;
        contratoMotivo.value = "";
        contratoMotivo.required = false;
        contratoMotivoField.style.display = "none";
      }
    });
    
    // Event listener para cambio de cliente
    clienteSelect.addEventListener("change", async function() {
      // Si el tipo actual es PROGRAMACIÓN, recargar contratos
      if (esProgramacion(tipoSelect.value) && clienteSelect.value) {
        contratoSelect.value = ""; // Limpiar selección previa
        await cargarContratosDelCliente(clienteSelect.value);
      }
    });
    
    // Event listener para checkbox "No aplica"
    contratoNoAplica.addEventListener("change", function() {
      if (contratoNoAplica.checked) {
        // No aplica contrato
        contratoSelect.disabled = true;
        contratoSelect.value = "";
        contratoSelect.required = false;
        contratoLabel.classList.remove("req");
        
        contratoMotivoField.style.display = "block";
        contratoMotivo.required = true;
      } else {
        // Sí aplica contrato
        contratoSelect.disabled = false;
        contratoSelect.required = true;
        contratoLabel.classList.add("req");
        
        contratoMotivoField.style.display = "none";
        contratoMotivo.value = "";
        contratoMotivo.required = false;
      }
    });
    
    function mostrarMensaje(texto, tipo = 'verde') {
      mensaje.textContent = texto;
      mensaje.style.display = 'block';
      if (tipo === 'verde') {
        mensaje.style.background = '#d4edda';
        mensaje.style.color = '#155724';
        mensaje.style.border = '2px solid #28a745';
      } else {
        mensaje.style.background = '#f8d7da';
        mensaje.style.color = '#721c24';
        mensaje.style.border = '2px solid #dc3545';
      }
    }

    async function generarNumeroOrden() {
      const fecha = new Date();
      const yyyy = fecha.getFullYear();
      const mm = String(fecha.getMonth() + 1).padStart(2, '0');
      const dd = String(fecha.getDate()).padStart(2, '0');
      const fechaBase = `${yyyy}${mm}${dd}`;

      const snapshot = await db.collection("ordenes_de_servicio").get();
      const existentes = snapshot.docs
        .filter(doc => doc.id.startsWith(fechaBase))
        .map(doc => parseInt(doc.id.slice(-2)))
        .filter(num => !isNaN(num));

      const siguiente = existentes.length > 0 ? Math.max(...existentes) + 1 : 1;
      numeroInput.value = `${fechaBase}${String(siguiente).padStart(2, '0')}`;
    }

    async function cargarClientes() {
  const { docs } = await ClientesService.listClientes({ limit: 2000 });
  clienteSelect.innerHTML = '<option value="">Seleccione un cliente</option>';
  docs.forEach(c => {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = c.nombre;
    clienteSelect.appendChild(option);
  });
  clienteSelect.addEventListener("change", async () => {
  const clienteId = clienteSelect.value;
  if (!clienteId) return;

  try {
    const c = await ClientesService.getCliente(clienteId);
    if (c) {
      const vendSelect = document.getElementById("vendedor");
      vendSelect.innerHTML = '<option value="">Seleccione vendedor</option>';

      const vendedores = await UsuariosService.getVendedores();
      vendedores.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = (v.nombre || v.email || v.id);
        if (c.vendedor_asignado === v.id) opt.selected = true;
        vendSelect.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("Error cargando vendedor:", e);
  }
});

}




    async function cargarTiposDeServicio() {
      const snap = await EmpresaService.getDoc("tipo_de_servicio");
      if (snap) {
        const lista = snap.list || [];
        lista.forEach(nombre => {
          const option = document.createElement("option");
          option.value = nombre;
          option.textContent = nombre;
          tipoSelect.appendChild(option);
        });
      }
    }

   document.getElementById("crearCliente").addEventListener("click", async () => {
  const nombre = prompt("Ingrese nombre del nuevo cliente:");
  if (!nombre) return;

  const nombreLimpio = nombre.trim();
  const regexProhibidos = /[\\/\\.#[\]$]/;
  if (regexProhibidos.test(nombreLimpio)) {
    alert("❌ El nombre contiene caracteres no permitidos: / . # [ ] $");
    return;
  }

  // Verificar si ya existe
  const snap = await db.collection("clientes").where("nombre", "==", nombreLimpio).limit(1).get();
  if (!snap.empty) {
    alert("⚠️ Ya existe un cliente con ese nombre.");
    return;
  }

  await ClientesService.createCliente({
    nombre: nombreLimpio,
    fecha_creacion: new Date(),
    deleted: false
  });

  alert("✅ Cliente registrado.");
  await cargarClientes();

  // Seleccionar automáticamente
  for (let i = 0; i < clienteSelect.options.length; i++) {
    if (clienteSelect.options[i].textContent === nombreLimpio) {
      clienteSelect.selectedIndex = i;
      break;
    }
  }
});


    firebase.auth().onAuthStateChanged(async user => {
      if (!user) {
        alert("No ha iniciado sesión. Redirigiendo al login...");
        window.location.href = "../login.html";
      } else {
        window.currentUser = user;
        await cargarClientes();
        await cargarTiposDeServicio();
        await generarNumeroOrden();
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!clienteSelect.value || !tipoSelect.value) {
        mostrarMensaje("Por favor seleccione un cliente y el tipo de servicio.", "rojo");
        return;
      }
      
      // Validación específica para PROGRAMACIÓN
      if (esProgramacion(tipoSelect.value)) {
        if (!contratoNoAplica.checked) {
          // Debe tener contrato seleccionado
          if (!contratoSelect.value) {
            mostrarMensaje("⚠️ Para PROGRAMACIÓN debe seleccionar un contrato o marcar 'No aplica'.", "rojo");
            return;
          }
        } else {
          // Debe tener motivo
          if (!contratoMotivo.value.trim()) {
            mostrarMensaje("⚠️ Debe indicar el motivo por el cual no aplica contrato.", "rojo");
            return;
          }
        }
      }

      const id = numeroInput.value;
      const cliente_id = clienteSelect.value;
      const cliente_nombre = clienteSelect.options[clienteSelect.selectedIndex]?.textContent || "";

        const data = {
          cliente_id,
          cliente_nombre,
          vendedor_asignado: document.getElementById("vendedor").value || "",
          tipo_de_servicio: tipoSelect.value,
          estado_reparacion: "POR ASIGNAR",
          fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
          observaciones: document.getElementById("observaciones").value?.trim() || "",
          equipos: [],
          creado_por_uid: window.currentUser?.uid || "",
          creado_por_email: window.currentUser?.email || "",
          eliminado: false,
          os_logs: firebase.firestore.FieldValue.arrayUnion({
            action: "CREAR",
            by: window.currentUser?.uid || ""
          })
        };
        
        // Agregar contrato solo si tipo = PROGRAMACION
        if (esProgramacion(tipoSelect.value)) {
          if (contratoNoAplica.checked) {
            // No aplica contrato
            data.contrato = {
              aplica: false,
              contrato_doc_id: null,
              contrato_id: null,
              motivo_no_aplica: contratoMotivo.value.trim()
            };
          } else {
            // Sí aplica contrato - obtener contrato_id del documento
            const contratoDocId = contratoSelect.value;
            let contratoId = null;
            
            try {
              const contratoDoc = await ContratosService.getContrato(contratoDocId);
              if (contratoDoc) {
                contratoId = contratoDoc.contrato_id || null;
              }
            } catch (error) {
              console.warn("No se pudo obtener contrato_id:", error);
            }
            
            data.contrato = {
              aplica: true,
              contrato_doc_id: contratoDocId,
              contrato_id: contratoId,
              motivo_no_aplica: null
            };
          }
        }

      try {
        await OrdenesService.setOrder(id, data);
        
        // ✅ Enviar notificación al jefe de taller
try {
await MailService.enqueue({
  to: "tecnico@cecomunica.com",
  subject: `Nueva Orden Creada – ${id}`,
  text: `
Se ha creado una nueva Orden de Servicio.

📋 Orden: ${id}
👤 Cliente: ${cliente_nombre}
🧑‍💼 Vendedor: ${data.vendedor_asignado || "No asignado"}
🔧 Tipo de servicio: ${data.tipo_de_servicio}
📅 Fecha de creación: (automática)

${window.location.origin}/ordenes/index.html
  `.trim(),
  html: `
<p>Se ha creado una nueva <strong>Orden de Servicio</strong>.</p>
<ul>
  <li><strong>Orden:</strong> ${id}</li>
  <li><strong>Cliente:</strong> ${cliente_nombre}</li>
  <li><strong>Vendedor:</strong> ${data.vendedor_asignado || "No asignado"}</li>
  <li><strong>Tipo de servicio:</strong> ${data.tipo_de_servicio}</li>
  <li><strong>Fecha de creación:</strong> (automática)</li>
</ul>
<p><a href="${window.location.origin}/ordenes/index.html">Abrir en plataforma</a></p>
  `.trim(),
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
});

  console.log("📧 Email encolado a taller@cecomunica.com");
} catch (err) {
  console.error("❌ Error encolando email:", err);
}

        mostrarMensaje("✅ Orden guardada correctamente.");
        setTimeout(() => window.location.href = 'index.html', 1000);
      } catch (error) {
        mostrarMensaje("Error al guardar: " + error.message, "rojo");
      }
    });

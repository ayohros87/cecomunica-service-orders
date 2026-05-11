// @ts-nocheck
    let currentUser = null;
    const form = document.getElementById("ordenForm");
    const mensaje = document.getElementById("mensaje");
    const params = new URLSearchParams(window.location.search);
    const ordenId = params.get("id");
    
    // Variables para el bloque de contrato
    const contratoBlock = document.getElementById("contratoBlock");
    const contratoSelect = document.getElementById("contratoSelect");
    const contratoNoAplica = document.getElementById("contratoNoAplica");
    const contratoMotivo = document.getElementById("contratoMotivo");
    const contratoMotivoField = document.getElementById("contratoMotivoField");
    const contratoLabel = document.getElementById("contratoLabel");
    const tipoSelect = document.getElementById("tipo");
    
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
    
    // Función para eliminar caché de contrato si ya no aplica
    async function deleteContratoCacheIfExists(ordenId, contratoDocId) {
      if (!contratoDocId) return;
      try {
        await ContratosService.unlinkOrden(contratoDocId, ordenId);
        console.log(`🗑️ Caché de contrato eliminado para orden ${ordenId}`);
      } catch (error) {
        console.warn("⚠️ No se pudo eliminar caché de contrato:", error);
      }
    }
    
    // Función para cargar contratos del cliente
    async function cargarContratosDelCliente(clienteId) {
      contratoSelect.innerHTML = '<option value="">Seleccione contrato</option>';
      
      if (!clienteId) return;
      
      try {
        const contratos = await ContratosService.getContratosActivosPorCliente(clienteId);

        contratos.forEach(contrato => {
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

        if (contratos.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "(No hay contratos vigentes)";
          option.disabled = true;
          contratoSelect.appendChild(option);
        }
      } catch (error) {
        console.error("Error cargando contratos:", error);
        mostrarMensaje("Error al cargar contratos: " + error.message, "rojo");
      }
    }
    
    // Event listener para cambio de tipo de servicio
    tipoSelect.addEventListener("change", async function() {
      const tipo = tipoSelect.value;
      
      if (esProgramacion(tipo)) {
        // Mostrar bloque de contrato
        contratoBlock.style.display = "block";
        
        // Por defecto: aplica contrato (checkbox desmarcado)
        if (!contratoNoAplica.checked) {
          contratoSelect.disabled = false;
          contratoSelect.required = true;
          contratoLabel.classList.add("req");
          contratoMotivoField.style.display = "none";
          contratoMotivo.required = false;
        }
        
        // Cargar contratos del cliente actual
        const clienteField = document.getElementById("cliente");
        const clienteIdMatch = clienteField.dataset.clienteId;
        if (clienteIdMatch) {
          await cargarContratosDelCliente(clienteIdMatch);
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

    function mostrarToast(mensaje, tipo = 'ok') {
      const toast = document.createElement('div');
      toast.className = `toast ${tipo}`;
      toast.textContent = mensaje;
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.right = '20px';
      toast.style.padding = '16px 24px';
      toast.style.borderRadius = '8px';
      toast.style.zIndex = '9999';
      toast.style.fontWeight = '500';
      toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      toast.style.animation = 'slideInRight 0.3s ease';
      
      if (tipo === 'ok' || tipo === 'verde') {
        toast.style.background = '#d4edda';
        toast.style.color = '#155724';
        toast.style.border = '2px solid #28a745';
      } else {
        toast.style.background = '#f8d7da';
        toast.style.color = '#721c24';
        toast.style.border = '2px solid #dc3545';
      }
      
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        const userDoc = await UsuariosService.getUsuario(user.uid);
        const rol = userDoc ? userDoc.rol || "" : "";
        limitarEdicionPorRol(rol);
      } else {
        alert("No ha iniciado sesión. Redirigiendo al login...");
        window.location.href = "../login.html";
      }
    });

    async function cargarOrden() {
      if (!ordenId) {
        mostrarMensaje("No se proporcionó ID de orden en la URL.", "rojo");
        return;
      }

      document.getElementById("orden_id").value = ordenId;
      document.getElementById("orderIdDisplay").textContent = `Orden #${ordenId}`;
      const d = await OrdenesService.getOrder(ordenId);

      if (d) {
        window.ordenDataOriginal = d;
        let nombreCliente = d.cliente_nombre || d.cliente || "";
        
        if (d.cliente_id) {
          try {
            const cli = await ClientesService.getCliente(d.cliente_id);
            if (cli) nombreCliente = cli.nombre || nombreCliente;
          } catch (e) { /* opcional: console.warn(e); */ }
        }
        
        document.getElementById("cliente").value = nombreCliente;
        // Guardar cliente_id para cargar contratos
        document.getElementById("cliente").dataset.clienteId = d.cliente_id || "";
        
        // Cargar vendedores
        const vendSelect = document.getElementById("vendedor");
        vendSelect.innerHTML = '<option value="">Seleccione vendedor</option>';
        const vendedores = await UsuariosService.getVendedores();

        vendedores.forEach(u => {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = (u.nombre || u.email || u.id);
          if (u.id === (d.vendedor_asignado || "")) opt.selected = true;
          vendSelect.appendChild(opt);
        });

        await cargarTipos();
        document.getElementById("tipo").value = d.tipo_de_servicio || "";
        
        // Manejar bloque de contrato si el tipo es PROGRAMACION
        if (esProgramacion(d.tipo_de_servicio)) {
          contratoBlock.style.display = "block";
          
          // Cargar contratos del cliente
          if (d.cliente_id) {
            await cargarContratosDelCliente(d.cliente_id);
          }
          
          // Prellenar datos del contrato
          if (d.contrato) {
            if (d.contrato.aplica === false) {
              // No aplica contrato
              contratoNoAplica.checked = true;
              contratoSelect.disabled = true;
              contratoSelect.required = false;
              contratoLabel.classList.remove("req");
              contratoMotivoField.style.display = "block";
              contratoMotivo.value = d.contrato.motivo_no_aplica || "";
              contratoMotivo.required = true;
            } else {
              // Sí aplica contrato
              contratoNoAplica.checked = false;
              contratoSelect.disabled = false;
              contratoSelect.required = true;
              contratoLabel.classList.add("req");
              contratoSelect.value = d.contrato.contrato_doc_id || "";
              contratoMotivoField.style.display = "none";
              contratoMotivo.required = false;
            }
          } else {
            // Orden antigua sin campo contrato - por defecto aplica
            contratoNoAplica.checked = false;
            contratoSelect.disabled = false;
            contratoSelect.required = true;
            contratoLabel.classList.add("req");
          }
        } else {
          // No es PROGRAMACION, ocultar bloque
          contratoBlock.style.display = "none";
        }
        
        await cargarTecnicos();
        document.getElementById("tecnico").value = d.tecnico_asignado || "";
        document.getElementById("estado").value = d.estado_reparacion || "POR ASIGNAR";
        document.getElementById("observaciones").value = d.observaciones || "";
      } else {
        mostrarMensaje("Orden no encontrada.", "rojo");
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const tipoServicio = document.getElementById("tipo").value;
      
      // Validación específica para PROGRAMACIÓN
      if (esProgramacion(tipoServicio)) {
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
      
      const data = {
        vendedor_asignado: document.getElementById("vendedor").value || "",
        tipo_de_servicio: tipoServicio,
        tecnico_asignado: document.getElementById("tecnico").value || "",
        estado_reparacion: document.getElementById("estado").value || "POR ASIGNAR",
        observaciones: document.getElementById("observaciones").value?.trim() || "",
        actualizado_por_uid: currentUser?.uid || "",
        actualizado_por_email: currentUser?.email || "",
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      // Agregar o remover contrato según el tipo de servicio
      if (esProgramacion(tipoServicio)) {
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
      } else {
        // Si no es PROGRAMACION, eliminar el campo contrato
        data.contrato = firebase.firestore.FieldValue.delete();
      }

      try {
        // Leer datos actuales para comparar contrato
        const datosActuales = (await OrdenesService.getOrder(ordenId)) || {};
        
        // Si antes tenía contrato pero ahora no (o cambió), eliminar caché anterior
        const contratoAnterior = datosActuales?.contrato;
        if (contratoAnterior?.contrato_doc_id) {
          // Si ya no aplica o cambió de contrato, eliminar el caché anterior
          if (!esProgramacion(tipoServicio) || 
              (data.contrato && !data.contrato.aplica) ||
              (data.contrato && data.contrato.contrato_doc_id !== contratoAnterior.contrato_doc_id)) {
            await deleteContratoCacheIfExists(ordenId, contratoAnterior.contrato_doc_id);
          }
        }
        
        await OrdenesService.mergeOrder(ordenId, data);
        
        mostrarToast("✅ Orden actualizada correctamente", "ok");
        setTimeout(() => window.location.href = 'index.html', 1500);
      } catch (error) {
        mostrarToast("❌ Error al guardar: " + error.message, "error");
      }
    });

    async function cargarTecnicos() {
      const select = document.getElementById("tecnico");
      select.innerHTML = '<option value="">Por asignar</option>';
      const tecnicos = await UsuariosService.getUsuariosByRol(["tecnico", "tecnico_operativo"]);
      tecnicos.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.nombre || u.email || u.id;
        select.appendChild(opt);
      });
    }

    async function cargarEstados() {
      const docSnap = await EmpresaService.getDoc("estado_de_reparacion");
      const select = document.getElementById("estado");
      select.innerHTML = "";
      if (docSnap) {
        const lista = docSnap.list || [];
        lista.forEach(nombre => {
          const option = document.createElement("option");
          option.value = nombre;
          option.textContent = nombre;
          select.appendChild(option);
        });
      }
    }

    async function cargarTipos() {
      const docSnap = await EmpresaService.getDoc("tipo_de_servicio");
      const select = document.getElementById("tipo");
      select.innerHTML = '<option value="">Seleccione tipo de servicio</option>';
      if (docSnap) {
        const lista = docSnap.list || [];
        lista.forEach(nombre => {
          const option = document.createElement("option");
          option.value = nombre;
          option.textContent = nombre;
          select.appendChild(option);
        });
      }
    }

    function limitarEdicionPorRol(rol) {
      // Asignación y estado SIEMPRE bloqueados
      document.getElementById("tecnico").disabled = true;
      document.getElementById("estado").disabled = true;

      // Tipo de servicio y observaciones editables solo para administrador/recepción
      const puedeEditarDetalles = rol === "administrador" || rol === "recepcion";
      document.getElementById("tipo").disabled = !puedeEditarDetalles;
      document.getElementById("observaciones").readOnly = !puedeEditarDetalles;
    }

    cargarOrden();
    cargarEstados();
    cargarTipos();

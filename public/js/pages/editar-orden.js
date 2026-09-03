// @ts-nocheck
    let currentUser = null;
    const form = document.getElementById("ordenForm");
    // Formato único (2026-09-03): la barra de guardado y la guardia de salida
    // las maneja FormKit.crear (abajo). El form ya no tiene botón submit; se
    // bloquea el submit implícito (Enter) para que no navegue.
    form.addEventListener("submit", (e) => e.preventDefault());
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
        mostrarToast("Error al cargar contratos: " + error.message, "error");
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
        mostrarToast("No ha iniciado sesión. Redirigiendo al login...", 'error');
        window.location.href = "../login.html";
      }
    });

    async function cargarOrden() {
      if (!ordenId) {
        mostrarToast("No se proporcionó ID de orden en la URL.", "error");
        return;
      }

      document.getElementById("orden_id").value = ordenId;
      document.getElementById("orderIdDisplay").textContent = ordenId;
      const volver = document.getElementById("fxVolver");
      if (volver) volver.href = `index.html?orden=${encodeURIComponent(ordenId)}`;
      const d = await OrdenesService.getOrder(ordenId);

      if (d) {
        // Guardrail (auditoría órdenes P2): esta página edita la CABECERA y el
        // menú ⋯ solo la ofrece en POR ASIGNAR — pero la URL era un bypass
        // (marcadores, historial del navegador). Espejo del menú: fuera de
        // POR ASIGNAR se avisa y se vuelve a la bandeja.
        const estadoActual = (d.estado_reparacion || "POR ASIGNAR").toUpperCase();
        if (estadoActual !== "POR ASIGNAR") {
          mostrarToast(`La orden está en ${estadoActual} — la cabecera solo se edita en POR ASIGNAR.`, "error");
          setTimeout(() => { window.location.href = `index.html?orden=${encodeURIComponent(ordenId)}`; }, 1800);
          return;
        }
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

        // Encabezado de contexto (formato único): cliente en la meta, estado
        // como chip — se mueve con los botones de flujo, no editando.
        const fxMeta = document.getElementById("fxMeta");
        if (fxMeta) fxMeta.textContent = nombreCliente || "—";
        const chipEstado = document.getElementById("fxChipEstado");
        if (chipEstado) chipEstado.textContent = estadoActual;
        
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
        const chipTipo = document.getElementById("fxChipTipo");
        if (chipTipo && d.tipo_de_servicio) { chipTipo.textContent = d.tipo_de_servicio; chipTipo.style.display = ""; }
        
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
          // No es PROGRAMACION, ocultar bloque y desactivar su validación
          // (un campo required oculto bloquea el submit de forma silenciosa).
          contratoBlock.style.display = "none";
          contratoSelect.required = false;
          contratoSelect.disabled = true;
          contratoLabel.classList.remove("req");
          contratoMotivo.required = false;
        }
        
        await cargarTecnicos();
        document.getElementById("tecnico").value = d.tecnico_asignado || "";
        await cargarEstados();
        document.getElementById("estado").value = d.estado_reparacion || "POR ASIGNAR";
        // Stepper del ciclo de vida (Command Center F3) — presentación pura.
        if (window.OrdenStepper) OrdenStepper.update(d.estado_reparacion || "POR ASIGNAR");
        document.getElementById("observaciones").value = d.observaciones || "";

        // Bloque "Equipos de la orden" (P5): resumen + puertas a donde SÍ viven
        // (la lista expandible y agregar-equipo) — esta página no los edita.
        const eqs = (Array.isArray(d.equipos) ? d.equipos : []).filter(e => e && !e.eliminado);
        const conSerial = eqs.filter(e => ((e.numero_de_serie || e.serial || '') + '').trim()).length;
        const resumenEl = document.getElementById("equiposResumen");
        if (resumenEl) {
          resumenEl.textContent = eqs.length
            ? `${eqs.length} equipo(s) en la orden · ${conSerial} con serial`
            : "Esta orden aún no tiene equipos registrados.";
        }
        const lnkVer = document.getElementById("lnkVerEquipos");
        if (lnkVer) lnkVer.href = `index.html?orden=${encodeURIComponent(ordenId)}`;
        const lnkAdd = document.getElementById("lnkAgregarEquipos");
        if (lnkAdd) lnkAdd.href = `agregar-equipo.html?orden_id=${encodeURIComponent(ordenId)}`;
      } else {
        mostrarToast("Orden no encontrada.", "error");
      }
    }

    // Guard anti doble-submit (patrón de agregar-equipo.js): el guardado hace
    // varios viajes a Firestore sin feedback inmediato; cada click extra en
    // esa ventana repetía el merge y el borrado de caché de contrato.
    let guardandoEdicion = false;

    // Guardado (formato único): lo invoca la barra de FormKit. Lanza en todo
    // camino que NO guarda, para que la barra no marque los campos como
    // limpios; los errores de negocio se marcan JUNTO AL CAMPO (.has-error)
    // además del aviso, en vez del toast flotante de antes.
    async function guardarOrden() {
      if (guardandoEdicion) return;

      const tipoServicio = document.getElementById("tipo").value;
      const wrapSel = contratoSelect.closest(".form-field");
      const wrapMot = contratoMotivo.closest(".form-field");
      wrapSel?.classList.remove("has-error");
      wrapMot?.classList.remove("has-error");

      // Validación específica para PROGRAMACIÓN
      if (esProgramacion(tipoServicio)) {
        if (!contratoNoAplica.checked && !contratoSelect.value) {
          wrapSel?.classList.add("has-error");
          contratoSelect.focus();
          contratoSelect.scrollIntoView({ block: "center", behavior: "smooth" });
          throw new Error("Para PROGRAMACIÓN selecciona un contrato o marca 'No aplica'.");
        }
        // Motivo REAL (≥10 chars) — mismo umbral que nueva-orden (auditoría
        // órdenes P2): sin él se colaban "n/a" y puntos.
        if (contratoNoAplica.checked && contratoMotivo.value.trim().length < 10) {
          wrapMot?.classList.add("has-error");
          contratoMotivo.focus();
          contratoMotivo.scrollIntoView({ block: "center", behavior: "smooth" });
          throw new Error("Indica el motivo por el cual no aplica contrato (mínimo 10 caracteres).");
        }
      }

      guardandoEdicion = true;

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

        // Re-chequeo al GUARDAR con datos frescos (la pestaña pudo quedar
        // abierta mientras la orden avanzaba de estado): mismo espejo del
        // menú que el gate de carga.
        const estadoFresco = (datosActuales.estado_reparacion || "POR ASIGNAR").toUpperCase();
        if (estadoFresco !== "POR ASIGNAR") {
          throw new Error(`La orden ya está en ${estadoFresco} — la cabecera solo se edita en POR ASIGNAR.`);
        }

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

        mostrarToast("Orden actualizada.", "ok");
        // Volver A LA ORDEN en la lista (no al index pelado): conserva la fila
        // a la vista sin perder el contexto — el deep-link ?orden= ya existe.
        setTimeout(() => window.location.href = `index.html?orden=${encodeURIComponent(ordenId)}`, 1500);
      } catch (error) {
        guardandoEdicion = false;
        // Re-lanza: la barra de FormKit avisa y NO marca los campos limpios.
        throw error;
      }
    }

    async function cargarTecnicos() {
      const select = document.getElementById("tecnico");
      select.innerHTML = '<option value="">Por asignar</option>';
      // jefe_taller incluido: el supervisor de taller también puede quedar
      // asignado a una orden, y este select (aunque bloqueado) muestra al
      // asignado actual — sin su rol en la query el nombre no aparecería.
      const tecnicos = await UsuariosService.getUsuariosByRol(["tecnico", "tecnico_operativo", "jefe_taller"]);
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
      const puedeEditarDetalles = rol === ROLES.ADMIN || rol === ROLES.RECEPCION;
      document.getElementById("tipo").disabled = !puedeEditarDetalles;
      document.getElementById("observaciones").readOnly = !puedeEditarDetalles;
    }

    // Barra de guardado + guardia de salida (formato único). Se crea ANTES de
    // cargar y se re-toma la foto de originales al terminar la carga: sin ese
    // setLimpio, los valores pintados por cargarOrden contarían como "cambios".
    let fk = null;
    if (window.FormKit) {
      fk = FormKit.crear({ root: document.getElementById("fkRoot"), onGuardar: guardarOrden });
    }

    // cargarOrden() orquesta internamente cargarTipos/cargarEstados/cargarTecnicos
    // en orden y luego fija los valores; no llamarlos aquí en paralelo (carrera que
    // puede borrar la selección de un campo required y bloquear el submit).
    cargarOrden().then(() => { if (fk) fk.setLimpio(); });

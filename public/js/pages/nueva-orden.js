// @ts-nocheck
    const form = document.getElementById("ordenForm");
    // Guardia de salida (kit de formularios): media orden a medio llenar no se
    // pierde en silencio al cerrar la pestaña. El submit la libera solo.
    if (window.FormKit) FormKit.guardia(form);
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

    function esEntrada(tipo) {
      return normalizarTipo(tipo) === "ENTRADA";
    }

    // PROGRAMACIÓN entrega equipo bajo un contrato; ENTRADA lo recibe de vuelta.
    // Las dos puntas del ciclo necesitan saber de qué contrato se trata: sin eso
    // la devolución no se puede amarrar y la cancelación del contrato queda en el
    // aire (de 460 ENTRADAs históricas, solo 3 tenían contrato — las que nacieron
    // automáticamente de una DEVOLUCIÓN).
    function requiereContrato(tipo) {
      return esProgramacion(tipo) || esEntrada(tipo);
    }

    // VISITA TECNICA: trabajo de campo (torres, repetidores, sitios del
    // cliente). Pide sitio/contacto al crear; el cierre es en sitio con
    // firma (ordenes-visita.js), sin entrega posterior.
    function esVisita(tipo) {
      return normalizarTipo(tipo).includes("VISITA");
    }

    const visitaBlock    = document.getElementById("visitaBlock");
    const visitaSitio    = document.getElementById("visitaSitio");
    const visitaContacto = document.getElementById("visitaContacto");

    function toggleVisitaBlock(tipo) {
      const es = esVisita(tipo);
      visitaBlock.style.display = es ? "block" : "none";
      visitaSitio.required = es;
      if (!es) { visitaSitio.value = ""; visitaContacto.value = ""; }
    }
    
    // ── Vendedor del CONTRATO (petición de recepción, 2026-08-26) ───────────
    // En una PROGRAMACIÓN/ENTRADA el vendedor es quien elaboró el contrato
    // (contratos.creado_por_uid — el mismo uid que va en CC del correo de
    // "contrato aprobado"). Recepción no lo tenía a mano en esta pantalla: el
    // único lugar donde aparecía era ese correo, así que se elegía de memoria
    // y se colaban errores (P.H. PLAZA DEL ESTE: la orden se rehízo entera por
    // haber puesto el vendedor equivocado). Ahora lo trae el contrato, se
    // muestra en la lista de contratos y queda editable.
    let _vendedoresCache = null;             // [{ id, nombre, email }]
    const _vendedorPorContrato = new Map();  // contrato_doc_id → uid del elaborador

    async function getVendedores() {
      if (!_vendedoresCache) _vendedoresCache = await UsuariosService.getVendedores();
      return _vendedoresCache;
    }

    function nombreVendedor(uid) {
      const v = (_vendedoresCache || []).find(x => x.id === uid);
      return v ? (v.nombre || v.email || v.id) : "";
    }

    function mostrarHintVendedor(texto) {
      const hint = document.getElementById("vendedorHint");
      if (!hint) return;
      hint.textContent = texto || "";
      hint.hidden = !texto;
    }

    // Rellena el select de vendedores y preselecciona `preseleccionUid`. Sin
    // preselección conserva lo que ya estaba elegido (el select se re-arma en
    // varios puntos y no debe perder la elección del usuario).
    async function poblarVendedores(preseleccionUid = "") {
      const vendSelect = document.getElementById("vendedor");
      if (!vendSelect) return;
      const actual = vendSelect.value;
      const vendedores = await getVendedores();
      vendSelect.innerHTML = '<option value="">Seleccione vendedor</option>';
      vendedores.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = (v.nombre || v.email || v.id);
        vendSelect.appendChild(opt);
      });
      const elegir = preseleccionUid || actual;
      if (elegir && [...vendSelect.options].some(o => o.value === elegir)) vendSelect.value = elegir;
    }

    // Aplica al select el vendedor del contrato elegido. No fuerza nada: si el
    // elaborador no está en el catálogo de vendedores (contratos viejos hechos
    // por recepción o por un usuario dado de baja) deja lo que haya y lo dice.
    async function aplicarVendedorDelContrato() {
      const contratoDocId = contratoSelect.value;
      if (!contratoDocId) { mostrarHintVendedor(""); return; }
      const uid = _vendedorPorContrato.get(contratoDocId) || "";
      await poblarVendedores(uid);
      const ref = contratoSelect.selectedOptions[0]?.dataset.ref || "el contrato";
      const nombre = uid ? nombreVendedor(uid) : "";
      if (nombre) {
        mostrarHintVendedor(`Tomado de ${ref} — lo elaboró ${nombre}. Cámbialo solo si no corresponde.`);
      } else if (uid) {
        // Contrato hecho por alguien que no figura como vendedor (recepción,
        // un usuario dado de baja): no se puede preseleccionar nada.
        mostrarHintVendedor(`Quien elaboró ${ref} no está en la lista de vendedores — selecciónalo a mano.`);
      } else {
        mostrarHintVendedor(`${ref} no registra quién lo elaboró — selecciona el vendedor a mano.`);
      }
    }

    // Función para cargar contratos del cliente
    async function cargarContratosDelCliente(clienteId) {
      contratoSelect.innerHTML = '<option value="">Seleccione contrato</option>';
      mostrarHintVendedor("");

      if (!clienteId) return;

      try {
        await getVendedores(); // para poder nombrar al elaborador en cada opción
        // ✅ Query simplificado: Firestore no requiere orderBy para deleted cuando usamos == false
        // Esto evita errores de índice compuesto
        const contratosCliente = await ContratosService.getContratosActivosPorCliente(clienteId);

        contratosCliente.forEach(contrato => {
          const option = document.createElement("option");
          option.value = contrato.id;

          // Formato: CT-XXX — Tipo — Estado — 📻 X equipos — 🧑‍💼 Vendedor
          const contratoId = contrato.contrato_id || contrato.id;
          const tipoContrato = contrato.tipo_contrato || "N/A";
          const estado = contrato.estado || "N/A";

          // Agregar total de equipos si existe
          const total = Number(contrato.total_equipos);
          const extra = Number.isFinite(total) ? ` — 📻 ${total} equipos` : "";

          // Elaborador del contrato = vendedor de la orden (ver bloque de arriba).
          const uidVendedor = contrato.creado_por_uid || "";
          if (uidVendedor) _vendedorPorContrato.set(contrato.id, uidVendedor);
          const nombre = uidVendedor ? nombreVendedor(uidVendedor) : "";
          const vend = nombre ? ` — 🧑‍💼 ${nombre}` : "";

          option.dataset.ref = contratoId;
          option.textContent = `${contratoId} — ${tipoContrato} — ${estado}${extra}${vend}`;
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
        mostrarMensaje("No se pudieron cargar los contratos: " + error.message, "rojo");
      }
    }

    // Event listener para tipo de servicio
    tipoSelect.addEventListener("change", async function() {
      const tipo = tipoSelect.value;
      toggleVisitaBlock(tipo);

      if (requiereContrato(tipo)) {
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
      // Si el tipo actual pide contrato, recargar los del cliente
      if (requiereContrato(tipoSelect.value) && clienteSelect.value) {
        contratoSelect.value = ""; // Limpiar selección previa
        await cargarContratosDelCliente(clienteSelect.value);
      }
    });

    // Elegir contrato fija el vendedor (el que lo elaboró).
    contratoSelect.addEventListener("change", () => { aplicarVendedorDelContrato(); });
    
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

    function fechaBaseHoy() {
      const f = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      return `${f.getFullYear()}${p2(f.getMonth() + 1)}${p2(f.getDate())}`;
    }

    // Solo VISTA PREVIA (auditoría A5): el número REAL se reserva al guardar
    // con el contador atómico (contadores/ordenes_YYYYMMDD). Calcularlo aquí
    // con listAll() era un full-scan de la colección por cada alta, con
    // carrera de concurrencia (dos usuarios simultáneos → mismo número →
    // setOrder pisaba el doc) y tope de 99 órdenes/día por el slice(-2).
    async function generarNumeroOrden() {
      numeroInput.value = '';
      numeroInput.placeholder = `${fechaBaseHoy()}·· (se asigna al guardar)`;
      numeroInput.title = 'El correlativo definitivo se reserva al guardar la orden.';
    }

    // Catálogo en memoria + select filtrable (auditoría A6): ~2,000 opciones
    // en un select nativo sin búsqueda era el punto de captura más caro de
    // equivocarse — el cliente elegido contamina contrato, entrega y correo.
    let _clientesDocs = [];
    const _normTxt = (s) => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');

    function pintarOpcionesClientes(filtro = '') {
      const q = _normTxt(filtro).trim();
      const actual = clienteSelect.value;
      const lista = q ? _clientesDocs.filter(c => _normTxt(c.nombre).includes(q)) : _clientesDocs;
      clienteSelect.innerHTML = '<option value="">Seleccione un cliente</option>';
      lista.forEach(c => {
        const option = document.createElement("option");
        option.value = c.id;
        option.textContent = c.nombre;
        clienteSelect.appendChild(option);
      });
      if (actual && lista.some(c => c.id === actual)) {
        clienteSelect.value = actual;
      } else if (q && lista.length === 1) {
        // Un único match → se auto-selecciona y dispara el change (carga el
        // vendedor asignado y los contratos del cliente, como un click).
        clienteSelect.value = lista[0].id;
        clienteSelect.dispatchEvent(new Event('change'));
      }
    }

    async function cargarClientes() {
  const { docs } = await ClientesService.listClientes({ limit: 2000 });
  _clientesDocs = docs;
  pintarOpcionesClientes();
  const filtroInput = document.getElementById('clienteFiltro');
  if (filtroInput) filtroInput.addEventListener('input', (e) => pintarOpcionesClientes(e.target.value));
  clienteSelect.addEventListener("change", async () => {
  const clienteId = clienteSelect.value;
  if (!clienteId) return;

  try {
    const c = await ClientesService.getCliente(clienteId);
    if (c) {
      // Manda el contrato si ya hay uno elegido (su elaborador ES el vendedor
      // de la orden); el vendedor asignado del cliente es el respaldo, y hoy
      // está vacío en la mayoría de las fichas.
      const uidContrato = _vendedorPorContrato.get(contratoSelect.value) || "";
      await poblarVendedores(uidContrato || c.vendedor_asignado || "");
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
    Toast.show('El nombre contiene caracteres no permitidos: / . # [ ] $', 'bad');
    return;
  }

  if (await ClientesService.existsByNorm("nombre", nombreLimpio)) {
    Toast.show('Ya existe un cliente con ese nombre.', 'bad');
    return;
  }

  await ClientesService.createCliente({
    nombre: nombreLimpio,
    fecha_creacion: new Date(),
    deleted: false
  });

  Toast.show('Cliente registrado.', 'ok');
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
        Toast.show('No ha iniciado sesión. Redirigiendo al login...', 'bad');
        window.location.href = "../login.html";
      } else {
        window.currentUser = user;
        await cargarClientes();
        await cargarTiposDeServicio();
        await generarNumeroOrden();
        await aplicarPrefillDesdeParams();
      }
    });

    // Prefill "venta directa" (?origen=venta&factura=&seriales=) — CTA del
    // registro de venta en inventario/equipos.html. Al guardar, la orden nace
    // con esos equipos y el vínculo a la factura (ver submit).
    let prefillVenta = null;

    // Precarga desde query params (?cliente_id=&contrato_doc_id=&tipo=) — CTA
    // "Crear orden de programación" desde la lista de contratos (Fase D.2) y
    // CTA post-venta del pool de equipos (?origen=venta).
    // Solo prepara el formulario: crear la orden sigue siendo decisión humana.
    async function aplicarPrefillDesdeParams() {
      const p = new URLSearchParams(window.location.search);
      const cid           = p.get("cliente_id");
      const contratoDocId = p.get("contrato_doc_id");
      const tipo          = p.get("tipo");
      const origen        = p.get("origen");
      if (!cid && !tipo && !contratoDocId) return;

      if (cid && [...clienteSelect.options].some(o => o.value === cid)) {
        clienteSelect.value = cid;
        clienteSelect.dispatchEvent(new Event("change")); // carga el vendedor asignado
      }
      if (tipo) {
        // Las opciones vienen de empresa/tipo_de_servicio (con tildes); el
        // parámetro llega normalizado — matchear ambos normalizados.
        const opt = [...tipoSelect.options].find(o => normalizarTipo(o.value) === normalizarTipo(tipo));
        if (opt) tipoSelect.value = opt.value;
      }
      toggleVisitaBlock(tipoSelect.value);
      // Bloque de contrato: mismo setup que el change handler de tipo, pero en
      // línea para poder esperar la carga y preseleccionar el contrato.
      if (requiereContrato(tipoSelect.value)) {
        contratoBlock.style.display = "block";
        if (origen === "venta") {
          // Venta directa: sin contrato por definición — "No aplica" con el
          // motivo autollenado (editable). El change handler arma el resto.
          const factura = (p.get("factura") || "").trim();
          contratoNoAplica.checked = true;
          contratoNoAplica.dispatchEvent(new Event("change"));
          contratoMotivo.value = factura
            ? `Venta directa — factura QBO ${factura}` : "Venta directa";
          const seriales = (p.get("seriales") || "")
            .split(",").map(s => s.trim()).filter(Boolean);
          if (seriales.length) {
            prefillVenta = { factura, seriales };
            mostrarMensaje(`Orden desde venta directa: al guardar se agregarán ${seriales.length} equipo(s) vendidos (${seriales.join(", ")}).`);
          }
        } else {
          contratoNoAplica.checked = false;
          contratoSelect.disabled = false;
          contratoSelect.required = true;
          contratoLabel.classList.add("req");
          contratoMotivoField.style.display = "none";
          if (clienteSelect.value) await cargarContratosDelCliente(clienteSelect.value);
          if (contratoDocId && [...contratoSelect.options].some(o => o.value === contratoDocId)) {
            contratoSelect.value = contratoDocId;
            await aplicarVendedorDelContrato(); // el contrato precargado también trae su vendedor
          }
        }
      }
    }

    // Guard anti doble-submit (mismo patrón que agregar-equipo.js): dos clicks
    // rápidos hacían dos setOrder al MISMO id (pisándose el doc, con el log
    // CREAR duplicado) y encolaban DOS correos de notificación.
    let guardandoOrden = false;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (guardandoOrden) return;
      if (!clienteSelect.value || !tipoSelect.value) {
        mostrarMensaje("Por favor seleccione un cliente y el tipo de servicio.", "rojo");
        return;
      }
      
      // Validación específica para VISITA TECNICA
      if (esVisita(tipoSelect.value) && !visitaSitio.value.trim()) {
        mostrarMensaje("Para VISITA TÉCNICA indica el sitio o la ubicación de la visita.", "rojo");
        return;
      }

      // Validación para los tipos que van amarrados a un contrato
      if (requiereContrato(tipoSelect.value)) {
        if (!contratoNoAplica.checked) {
          // Debe tener contrato seleccionado
          if (!contratoSelect.value) {
            const t = esEntrada(tipoSelect.value) ? "ENTRADA" : "PROGRAMACIÓN";
            mostrarMensaje(`Para ${t} selecciona un contrato o marca 'No aplica'.`, "rojo");
            return;
          }
        } else {
          // Debe tener motivo REAL (auditoría órdenes P2): con el campo libre
          // se colaban "n/a" y puntos — el motivo es lo único que explica por
          // qué una PROGRAMACIÓN/ENTRADA quedó fuera de contrato.
          if (contratoMotivo.value.trim().length < 10) {
            mostrarMensaje("Indica el motivo por el cual no aplica contrato (mínimo 10 caracteres).", "rojo");
            return;
          }
        }
      }

      // Validaciones pasadas: candado puesto ANTES de la preparación async
      // (el prefill de venta puede tardar segundos y era la ventana del doble
      // click). Se libera solo si el guardado falla.
      guardandoOrden = true;
      const btnSubmitOrden = form.querySelector("button[type='submit']");
      if (btnSubmitOrden) btnSubmitOrden.disabled = true;

      // Correlativo REAL, reservado dentro del candado anti doble-submit:
      // transacción atómica + piso del día para sembrar el contador la
      // primera vez. String(seq).padStart(2) crece a 3 dígitos a partir de
      // la orden 100 — levanta el tope de 99/día sin cambiar el formato.
      let id;
      try {
        const fechaStr = fechaBaseHoy();
        let piso = 0;
        try { piso = await OrdenesService.maxSufijoOrdenDelDia(fechaStr); }
        catch (_) { /* piso 0: la reserva atómica garantiza unicidad igual */ }
        const seq = await OrdenesService.reservarNumeroOrden(fechaStr, piso);
        id = `${fechaStr}${String(seq).padStart(2, '0')}`;
        numeroInput.value = id;
      } catch (e) {
        console.error("No se pudo reservar el número de orden:", e);
        mostrarMensaje("No se pudo reservar el número de orden. Revisa la conexión e intenta de nuevo.", "rojo");
        guardandoOrden = false;
        if (btnSubmitOrden) btnSubmitOrden.disabled = false;
        return;
      }

      const cliente_id = clienteSelect.value;
      const cliente_nombre = clienteSelect.options[clienteSelect.selectedIndex]?.textContent || "";

      // Equipos de la venta directa (prefill ?origen=venta): la orden nace con
      // los seriales vendidos, con el modelo resuelto desde el pool. Accesorios
      // en falso y observaciones por defecto — editables en la orden después.
      const equiposVenta = [];
      const poolIdsVenta = [];
      if (prefillVenta) {
        for (const s of prefillVenta.seriales) {
          let unidad = null;
          try {
            const docs = await EquiposPoolService.findBySerial(s);
            // Con colisión de serial entre modelos, la unidad recién vendida
            // es la que está en estado 'vendido'.
            unidad = docs.find(d => d.estado === "vendido") || docs[0] || null;
          } catch (e) { console.warn("Pool no disponible para", s, e); }
          if (unidad) poolIdsVenta.push(unidad.id);
          equiposVenta.push(EquipoNormalize.normalize({
            id: crypto.randomUUID(),
            modelo_id: unidad?.modelo_id || "",
            modelo: unidad?.modelo_label || "",
            serial: s,
            numero_de_serie: s,
            bateria: false, clip: false, cargador: false,
            fuente: false, antena: false, cubrepolvo: false,
            observaciones: "sin observaciones",
          }));
        }
      }

        const data = {
          cliente_id,
          cliente_nombre,
          vendedor_asignado: document.getElementById("vendedor").value || "",
          tipo_de_servicio: tipoSelect.value,
          estado_reparacion: "POR ASIGNAR",
          fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
          observaciones: document.getElementById("observaciones").value?.trim() || "",
          equipos: equiposVenta,
          creado_por_uid: window.currentUser?.uid || "",
          creado_por_email: window.currentUser?.email || "",
          eliminado: false,
          os_logs: firebase.firestore.FieldValue.arrayUnion({
            action: "CREAR",
            by: window.currentUser?.uid || ""
          })
        };
        
        // Datos de sitio solo si tipo = VISITA TECNICA
        if (esVisita(tipoSelect.value)) {
          data.visita = {
            sitio: visitaSitio.value.trim(),
            contacto_sitio: visitaContacto.value.trim() || null
          };
        }

        // El bloque de contrato se guarda para PROGRAMACIÓN y ENTRADA
        if (requiereContrato(tipoSelect.value)) {
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

        // Vínculo con la venta directa que originó la orden (trazabilidad
        // factura QBO ↔ orden; el espejo en el pool se escribe tras guardar).
        if (prefillVenta) {
          data.origen_venta = {
            factura_qbo: prefillVenta.factura || null,
            seriales: prefillVenta.seriales,
          };
        }

      try {
        await OrdenesService.setOrder(id, data);

        // Amarre inverso: deja en cada unidad vendida el id de esta orden y una
        // línea en su kardex. Best-effort — si el rol no puede escribir el pool
        // (rules: puedeGestionarSeriales), la orden ya quedó creada igual.
        for (const poolId of poolIdsVenta) {
          try {
            await EquiposPoolService.vincularOrdenProgramacion(poolId, id, window.currentUser);
          } catch (e) { console.warn("No se pudo vincular la orden en el pool:", poolId, e); }
        }
        
        // ✅ Enviar notificación de orden creada. Destinatarios configurables
        // en empresa/config.mail_orden_creada_to (primero = to, resto = cc);
        // el literal es el fallback ante config vacía o Firestore caído.
try {
const destinos = (window.EMPRESA_CONFIG?.mail_orden_creada_to || []).filter(Boolean);
const to = destinos[0] || "tecnico@cecomunica.com";
const cc = destinos.slice(1);
await MailService.enqueue({
  to,
  ...(cc.length ? { cc } : {}),
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

  console.log("📧 Email de orden creada encolado a", to);
} catch (err) {
  console.error("❌ Error encolando email:", err);
}

        // Aterrizaje según lo que sigue (auditoría Q1): la orden nace sin
        // equipos y el redirect al index obligaba a buscarla, expandirla y
        // entrar a "+" (~4-5 interacciones extra en el flujo más repetido de
        // recepción). VISITA no lleva equipos y la venta directa ya los trae:
        // esas aterrizan en la orden dentro de la lista (?orden= la filtra).
        //
        // Con contrato vinculado los seriales YA están decididos en el contrato:
        // teclearlos uno por uno en agregar-equipo era volver a capturar lo que
        // el sistema ya sabe (observación de recepción, ago-2026 — por eso el
        // panel de "órdenes por crear" se usaba poco: la orden terminaba
        // creándose por el camino largo solo para llegar al batch). Esas
        // aterrizan en el batch, y la PROGRAMACIÓN además jala sola del contrato
        // (?jalar=contrato). En ENTRADA no se auto-jala: vuelve lo que el
        // cliente devuelve, que puede ser una parte del contrato — el botón
        // "Jalar del contrato" queda a un click.
        const conContrato = requiereContrato(tipoSelect.value)
          && !contratoNoAplica.checked && !!contratoSelect.value;
        let destino, aviso;
        if (conContrato) {
          const auto = esProgramacion(tipoSelect.value);
          destino = `nuevo-batch.html?orden_id=${encodeURIComponent(id)}${auto ? "&jalar=contrato" : ""}`;
          aviso = auto
            ? "Orden guardada. Abriendo la carga de equipos con los seriales del contrato…"
            : "Orden guardada. Abriendo la carga de equipos…";
        } else if (!prefillVenta && !esVisita(tipoSelect.value)) {
          destino = `agregar-equipo.html?orden_id=${encodeURIComponent(id)}`;
          aviso = "Orden guardada. Abriendo la captura de equipos…";
        } else {
          destino = `index.html?orden=${encodeURIComponent(id)}`;
          aviso = "Orden guardada.";
        }
        mostrarMensaje(aviso);
        setTimeout(() => window.location.href = destino, 800);
      } catch (error) {
        mostrarMensaje("Error al guardar: " + error.message, "rojo");
        guardandoOrden = false;
        if (btnSubmitOrden) btnSubmitOrden.disabled = false;
      }
    });

// @ts-nocheck
    let clientesMap = {};
    let clientesList = [];
    let modelosMap = {};
    let items = [];
    let docId = null;
    let cotizacionId = null;
    let estadoActual = "borrador";
    let rolActual = "";

    function cerrarSesion() { firebase.auth().signOut().then(() => location.href = "../login.html"); }
    function money(n) { return Number(n || 0).toLocaleString("es-PA", { style: "currency", currency: "USD" }); }

    function mostrarToast(mensaje) {
      const t = document.createElement("div");
      t.className = "toast";
      t.textContent = mensaje;
      document.body.appendChild(t);
      requestAnimationFrame(() => t.classList.add("show"));
      setTimeout(() => {
        t.classList.remove("show");
        setTimeout(() => t.remove(), 200);
      }, 2200);
    }

    async function cargarClientes() {
      const raw = await ClientesService.loadClientes();
      clientesMap = {};
      clientesList = [];
      for (const [id, d] of raw) {
        clientesMap[id] = d;
        clientesList.push({ id, nombre: d.nombre || id, data: d });
      }
      renderClienteDropdown("");
    }

    function renderClienteDropdown(query) {
      const dropdown = document.getElementById("clienteDropdown");
      const q = (query || "").toLowerCase().trim();
      dropdown.innerHTML = "";
      const lista = clientesList.filter(c => (c.nombre || "").toLowerCase().includes(q));
      lista.slice(0, 30).forEach(c => {
        const div = document.createElement("div");
        div.className = "cliente-option";
        div.textContent = c.nombre;
        div.onclick = () => seleccionarCliente(c.id);
        dropdown.appendChild(div);
      });
      dropdown.style.display = lista.length ? "block" : "none";
    }

    function seleccionarCliente(id) {
      const c = clientesMap[id];
      document.getElementById("clienteId").value = id || "";
      document.getElementById("clienteBuscar").value = c?.nombre || "";
      document.getElementById("clienteDropdown").style.display = "none";
      actualizarClientePreview(c);
    }

    function actualizarClientePreview(c) {
      const el = document.getElementById("clientePreview");
      if (!c) {
        el.textContent = "Sin seleccionar";
        return;
      }
      el.innerHTML = `
        <strong>${c.nombre || ""}</strong><br>
        ${c.ruc ? `RUC: ${c.ruc}<br>` : ""}
        ${c.direccion ? `Dirección: ${c.direccion}<br>` : ""}
        ${c.representante ? `Representante: ${c.representante}<br>` : ""}
        ${c.email ? `Email: ${c.email}` : ""}
      `;
    }

    async function cargarModelos() {
      const modelos = await ModelosService.getModelos();
      modelosMap = {};
      const select = document.getElementById("modeloSelect");
      select.innerHTML = "<option value=\"\">Seleccione modelo...</option>";

      const lista = [];
      modelos.forEach(m => {
        const label = `${m.marca || ""} ${m.modelo || ""}`.trim() || m.id;
        modelosMap[m.id] = m;
        lista.push({ id: m.id, label });
      });

      lista
        .sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }))
        .forEach(item => {
          const opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.label;
          select.appendChild(opt);
        });
    }

    function actualizarModeloSeleccionado() {
      const id = document.getElementById("modeloSelect").value;
      const d = modelosMap[id] || {};
      const modelo = `${d.marca || ""} ${d.modelo || ""}`.trim();
      const precioInput = document.getElementById("modeloPrecio");
      const descInput = document.getElementById("modeloDescripcion");
      const hint = document.getElementById("modeloPrecioHint");
      if (modelo && !descInput.value) descInput.value = modelo;
      if ((!precioInput.value || Number(precioInput.value) === 0) && d.precio_venta) {
        precioInput.value = d.precio_venta;
      }
      hint.textContent = d.precio_venta ? `Precio sugerido: ${money(d.precio_venta)}` : "";
    }

    function agregarItem(item) {
      item.total = Number(item.cantidad || 0) * Number(item.precio_unitario || 0);
      items.push(item);
      renderItems();
    }

    function agregarDesdeModelo() {
      const id = document.getElementById("modeloSelect").value;
      if (!id) return mostrarToast("Seleccione un modelo.");
      const d = modelosMap[id] || {};
      const modalidad = document.getElementById("modeloModalidad").value;
      const descripcionInput = (document.getElementById("modeloDescripcion").value || "").trim();
      const cantidad = Number(document.getElementById("modeloCantidad").value || 1);
      const precio = Number(document.getElementById("modeloPrecio").value || d.precio_venta || 0);
      const modelo = `${d.marca || ""} ${d.modelo || ""}`.trim();
      agregarItem({
        tipo: "Radio",
        modalidad,
        fuente: "modelos",
        ref_id: id,
        modelo,
        descripcion: descripcionInput || modelo,
        cantidad,
        precio_unitario: precio
      });

      document.getElementById("modeloSelect").value = "";
      document.getElementById("modeloModalidad").value = "venta";
      document.getElementById("modeloDescripcion").value = "";
      document.getElementById("modeloCantidad").value = "1";
      document.getElementById("modeloPrecio").value = "0";
      document.getElementById("modeloPrecioHint").textContent = "";
    }

    function renderItems() {
      const tbody = document.getElementById("itemsTabla");
      tbody.innerHTML = "";
      items.forEach((it, idx) => {
        const tr = document.createElement("tr");
        const sufijo = it.modalidad === "alquiler" ? " / mes" : "";
        tr.innerHTML = `
          <td>${it.tipo} · ${it.modalidad === "alquiler" ? "Alquiler" : "Venta"}</td>
          <td>${it.modelo || ""}</td>
          <td><input type="text" value="${it.descripcion || ""}" data-idx="${idx}" data-field="descripcion"></td>
          <td><input type="number" min="1" value="${it.cantidad}" data-idx="${idx}" data-field="cantidad"></td>
          <td><input type="number" min="0" step="0.01" value="${it.precio_unitario}" data-idx="${idx}" data-field="precio_unitario"></td>
          <td class="item-total" data-total="${idx}">${money(it.total)}${sufijo}</td>
          <td><button class="btn secondary" title="Eliminar ítem" data-remove="${idx}">🗑️</button></td>
        `;
        tbody.appendChild(tr);
      });
      recalcularTotales();
    }

    function recalcularTotales() {
      items = items.map(it => ({ ...it, total: Number(it.cantidad || 0) * Number(it.precio_unitario || 0) }));
      const subtotal = items.reduce((acc, it) => acc + Number(it.total || 0), 0);
      const itbms = subtotal * 0.07;
      const total = subtotal + itbms;
      document.getElementById("subtotalTxt").textContent = money(subtotal);
      document.getElementById("itbmsTxt").textContent = money(itbms);
      document.getElementById("totalTxt").textContent = money(total);
      document.getElementById("notaAlquiler").style.display = items.some(it => it.modalidad === "alquiler") ? "block" : "none";
      return { subtotal, itbms, total };
    }

    async function generarCotizacionIdSimple() {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const prefix = `COT-${y}${m}${d}-`;

      const start = new Date(y, now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(y, now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const cotizacionesHoy = await CotizacionesService.getCotizacionesPorFecha(start, end);

      let max = 0;
      cotizacionesHoy.forEach(c => {
        const id = c.cotizacion_id || "";
        if (id.startsWith(prefix)) {
          const n = parseInt(id.replace(prefix, ""), 10);
          if (!isNaN(n)) max = Math.max(max, n);
        }
      });
      const next = String(max + 1).padStart(3, "0");
      return `${prefix}${next}`;
    }

    document.addEventListener("input", (e) => {
      const idx = e.target.getAttribute("data-idx");
      const field = e.target.getAttribute("data-field");
      if (idx == null || !field) return;
      if (field === "descripcion") {
        items[idx][field] = e.target.value || "";
      } else {
        items[idx][field] = Number(e.target.value || 0);
      }
      items[idx].total = Number(items[idx].cantidad || 0) * Number(items[idx].precio_unitario || 0);
      const sufijo = items[idx].modalidad === "alquiler" ? " / mes" : "";
      const totalCell = document.querySelector(`[data-total="${idx}"]`);
      if (totalCell) totalCell.textContent = `${money(items[idx].total)}${sufijo}`;
      recalcularTotales();
    });

    document.addEventListener("click", (e) => {
      const idx = e.target.getAttribute("data-remove");
      if (idx == null) return;
      items.splice(Number(idx), 1);
      renderItems();
    });

    async function cargarCotizacion(id) {
      const d = await CotizacionesService.getCotizacion(id);
      if (!d) { mostrarToast("Cotización no encontrada"); return; }
      docId = d.id;
      cotizacionId = d.cotizacion_id || "";
      estadoActual = d.estado || "borrador";
      document.getElementById("sumCotizacionId").textContent = cotizacionId || "-";
      const badge = document.getElementById("sumEstado");
      badge.textContent = estadoActual;
      badge.className = `badge ${estadoActual}`;
      const fechaMod = d.fecha_modificacion || d.fecha_creacion;
      document.getElementById("sumModificacion").textContent = fechaMod?.toDate?.()?.toLocaleDateString?.("es-PA", { day: "2-digit", month: "short", year: "numeric" }) || "-";

      document.getElementById("clienteId").value = d.cliente_id || "";
      document.getElementById("clienteBuscar").value = d.cliente_nombre || "";
      actualizarClientePreview(clientesMap[d.cliente_id] || {
        nombre: d.cliente_nombre || "",
        ruc: d.cliente_ruc || "",
        direccion: d.cliente_direccion || "",
        representante: d.representante || "",
        email: d.cliente_email || ""
      });
      document.getElementById("validezDias").value = d.validez_dias || 30;
      document.getElementById("formaPago").value = d.forma_pago || "contado";
      document.getElementById("tiempoEntrega").value = d.tiempo_entrega || "";
      document.getElementById("notas").value = d.notas || "";

      items = Array.isArray(d.items) ? d.items : [];
      renderItems();

      document.getElementById("firmadoNombre").value = d.firmado_por_nombre || document.getElementById("firmadoNombre").value || "";
      document.getElementById("firmadoCargo").value = d.firmado_por_cargo || "Asistente Ejecutiva";
      document.getElementById("firmadoTel").value = d.firmado_por_tel || "279-5570";
      document.getElementById("firmadoCel").value = d.firmado_por_cel || document.getElementById("firmadoCel").value || "";
      document.getElementById("bancoNombre").value = d.banco_nombre || "Banistmo";
      document.getElementById("bancoTipo").value = d.banco_tipo_cuenta || "Cuenta corriente";
      document.getElementById("bancoNumero").value = d.banco_numero || "0101081314";
      document.getElementById("bancoTitular").value = d.banco_titular || "C COMUNICA, S.A.";

      if (estadoActual === "emitida" && rolActual !== "administrador") {
        document.getElementById("wrapper").classList.add("locked");
        alert("Esta cotización está emitida y no es editable.");
      }
    }

    async function guardar(estado) {
      if (!docId) return mostrarToast("ID inválido.");
      const clienteId = document.getElementById("clienteId").value;
      if (!clienteId) return mostrarToast("Seleccione un cliente.");
      if (!items.length) return mostrarToast("Agregue al menos un ítem.");

      const cliente = clientesMap[clienteId] || {};
      const totales = recalcularTotales();
      const user = firebase.auth().currentUser;

      const data = {
        cliente_id: clienteId,
        cliente_nombre: cliente.nombre || "",
        cliente_ruc: cliente.ruc || null,
        representante: cliente.representante || null,
        cliente_email: cliente.email || null,
        cliente_direccion: cliente.direccion || null,
        items,
        subtotal: totales.subtotal,
        itbms_rate: 0.07,
        itbms: totales.itbms,
        total: totales.total,
        validez_dias: Number(document.getElementById("validezDias").value || 30),
        forma_pago: document.getElementById("formaPago").value,
        notas: document.getElementById("notas").value || "",
        tiempo_entrega: document.getElementById("tiempoEntrega").value || "",
        firmado_por_nombre: document.getElementById("firmadoNombre").value || "",
        firmado_por_cargo: document.getElementById("firmadoCargo").value || "",
        firmado_por_tel: document.getElementById("firmadoTel").value || "",
        firmado_por_cel: document.getElementById("firmadoCel").value || "",
        banco_nombre: document.getElementById("bancoNombre").value || "",
        banco_tipo_cuenta: document.getElementById("bancoTipo").value || "",
        banco_numero: document.getElementById("bancoNumero").value || "",
        banco_titular: document.getElementById("bancoTitular").value || "",
        estado,
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp(),
        updated_by: user?.uid || null,
        updated_by_email: user?.email || null
      };

      await CotizacionesService.updateCotizacion(docId, data);
      estadoActual = estado;
      mostrarToast("✅ Cotización actualizada");
    }

    async function duplicarCotizacion() {
      if (!docId) return;
      const user = firebase.auth().currentUser;
      const cotizacion_id = await generarCotizacionIdSimple();
      const data = {
        ...items.length ? { items } : {},
        cotizacion_id,
        cliente_id: document.getElementById("clienteId").value || "",
        cliente_nombre: (document.getElementById("clienteBuscar").value || "").trim(),
        cliente_ruc: clientesMap[document.getElementById("clienteId").value]?.ruc || null,
        representante: clientesMap[document.getElementById("clienteId").value]?.representante || null,
        cliente_email: clientesMap[document.getElementById("clienteId").value]?.email || null,
        cliente_direccion: clientesMap[document.getElementById("clienteId").value]?.direccion || null,
        subtotal: recalcularTotales().subtotal,
        itbms_rate: 0.07,
        itbms: recalcularTotales().itbms,
        total: recalcularTotales().total,
        validez_dias: Number(document.getElementById("validezDias").value || 30),
        forma_pago: document.getElementById("formaPago").value,
        notas: document.getElementById("notas").value || "",
        tiempo_entrega: document.getElementById("tiempoEntrega").value || "",
        firmado_por_nombre: document.getElementById("firmadoNombre").value || "",
        firmado_por_cargo: document.getElementById("firmadoCargo").value || "",
        firmado_por_tel: document.getElementById("firmadoTel").value || "",
        firmado_por_cel: document.getElementById("firmadoCel").value || "",
        banco_nombre: document.getElementById("bancoNombre").value || "",
        banco_tipo_cuenta: document.getElementById("bancoTipo").value || "",
        banco_numero: document.getElementById("bancoNumero").value || "",
        banco_titular: document.getElementById("bancoTitular").value || "",
        estado: "borrador",
        deleted: false,
        creado_por_uid: user?.uid || null,
        creado_por_email: user?.email || null,
        vendedor_uid: user?.uid || null,
        fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp()
      };
      const ref = await CotizacionesService.addCotizacion(data);
      mostrarToast("✅ Cotización duplicada");
      window.location.href = `editar-cotizacion.html?id=${encodeURIComponent(ref.id)}`;
    }

    function imprimir() {
      if (!docId) return;
      window.open(`imprimir-cotizacion.html?id=${encodeURIComponent(docId)}`, "_blank");
    }

    async function cargarPerfilUsuario(user) {
      const perfil = { nombre: user?.displayName || user?.email || "", cel: "", cargo: "" };
      try {
        const d = await UsuariosService.getUsuario(user.uid);
        if (d) {
          perfil.nombre = d.nombre || d.name || perfil.nombre;
          perfil.cel = d.user_cel || d.cel || d.celular || "";
          perfil.cargo = d.cargo || d.puesto || d.rol_titulo || "";
        }
      } catch {}
      return perfil;
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { location.href = "../login.html"; return; }
      verificarAccesoYAplicarVisibilidad(async (rol) => {
        rolActual = rol;
        const permitidos = ["administrador", "vendedor"];
        if (!permitidos.includes(rol)) {
          mostrarToast("Sin acceso");
          location.href = "../index.html";
          return;
        }
        const perfil = await cargarPerfilUsuario(user);
        document.getElementById("firmadoNombre").value = perfil.nombre || "";
        document.getElementById("firmadoCargo").value = perfil.cargo || document.getElementById("firmadoCargo").value || "";
        document.getElementById("firmadoCel").value = perfil.cel || "";
        document.getElementById("firmaResumenNombre").textContent = perfil.nombre || "Sin firmante";
        const params = new URLSearchParams(location.search);
        const id = params.get("id");
        if (!id) { mostrarToast("Falta ID"); location.href = "index.html"; return; }
        await cargarClientes();
        await cargarModelos();
        await cargarCotizacion(id);
        document.getElementById("modeloSelect").addEventListener("change", actualizarModeloSeleccionado);
        document.getElementById("clienteBuscar").addEventListener("input", (e) => renderClienteDropdown(e.target.value));
        document.getElementById("clienteBuscar").addEventListener("focus", (e) => renderClienteDropdown(e.target.value));
        document.addEventListener("click", (e) => {
          if (!document.querySelector(".cliente-search")?.contains(e.target)) {
            document.getElementById("clienteDropdown").style.display = "none";
          }
        });
        document.getElementById("firmadoNombre").addEventListener("input", (e) => {
          document.getElementById("firmaResumenNombre").textContent = e.target.value || "Sin firmante";
        });
      });
    });

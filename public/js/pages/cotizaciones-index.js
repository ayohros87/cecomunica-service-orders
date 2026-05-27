// @ts-nocheck
    let cotizaciones = [];
    let lastDoc = null;
    let isLoading = false;

    function cerrarSesion() { firebase.auth().signOut().then(() => location.href = "../login.html"); }

    function estadoBadge(estado) {
      const map = {
        borrador: "chip-recibida",
        emitida:  "chip-cotizada",
        enviada:  "chip-cotizada",
        aprobada: "chip-aprobada",
        anulada:  "chip-cancelada"
      };
      return `<span class="chip-estado ${map[estado] || "chip-recibida"}">${estado || ""}</span>`;
    }

    function formatFecha(ts) {
      const d = ts?.toDate?.();
      if (!d) return "";
      return d.toLocaleDateString("es-PA", { day: "2-digit", month: "short", year: "numeric" });
    }

    function formatMoney(n) {
      const v = Number(n || 0);
      return v.toLocaleString("es-PA", { style: "currency", currency: "USD" });
    }

    async function cargarCotizaciones(esInicial = true) {
      if (isLoading) return;
      isLoading = true;
      const btn = document.getElementById("btnCargarMas");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader"></i> Cargando...';
      }

      if (esInicial) {
        cotizaciones = [];
        lastDoc = null;
      }

      const { docs, lastDoc: newCursor } = await CotizacionesService.listCotizaciones({ lastDoc, limit: 30 });

      if (docs.length > 0) {
        lastDoc = newCursor;
        cotizaciones.push(...docs);
      }

      aplicarFiltros();

      if (btn) {
        btn.disabled = false;
        const hasMore = docs.length > 0;
        btn.style.display = hasMore ? "inline-block" : "none";
        const totalVisible = getFilteredCotizaciones().length;
        btn.innerHTML = `<i data-lucide="chevron-down"></i> Cargar más cotizaciones (${totalVisible})`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
      isLoading = false;
    }

    function getFilteredCotizaciones() {
      const q = (document.getElementById("filtroTexto").value || "").toLowerCase().trim();
      const estado = document.getElementById("filtroEstado").value;
      const mostrarEliminadas = document.getElementById("toggleEliminadas").checked;

      return cotizaciones.filter(c => {
        if (!mostrarEliminadas && c.deleted) return false;
        if (estado && c.estado !== estado) return false;
        if (!q) return true;
        const texto = `${c.cotizacion_id || ""} ${c.cliente_nombre || ""}`.toLowerCase();
        return texto.includes(q);
      });
    }

    function aplicarFiltros() {
      const filtradas = getFilteredCotizaciones();
      renderTabla(filtradas);
      actualizarResumenCotizaciones(filtradas, cotizaciones.length);
      const btn = document.getElementById("btnCargarMas");
      if (btn) { btn.innerHTML = `<i data-lucide="chevron-down"></i> Cargar más cotizaciones (${filtradas.length})`; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    }

    function limpiarFiltros() {
      document.getElementById("filtroTexto").value = "";
      document.getElementById("filtroEstado").value = "";
      aplicarFiltros();
    }

    function renderTabla(lista) {
      const tbody = document.getElementById("tablaCotizaciones");
      const cards = document.getElementById("listaCotizacionesMovil");
      tbody.innerHTML = "";
      if (cards) cards.innerHTML = "";
      if (!lista || lista.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td colspan="6">
            <div class="empty-state-hint">
              <div class="empty-state-hint-icon"><i data-lucide="receipt"></i></div>
              <p class="title">No hay cotizaciones para mostrar</p>
              <p class="hint">Prueba ajustando los filtros o crea una nueva cotización.</p>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
        if (cards) {
          const empty = document.createElement("div");
          empty.className = "empty-state-hint";
          empty.innerHTML = `<div class="empty-state-hint-icon"><i data-lucide="receipt"></i></div><p class="title">No hay cotizaciones para mostrar</p><p class="hint">Prueba ajustando los filtros o crea una nueva cotización.</p>`;
          cards.appendChild(empty);
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }
      lista.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="td-primary">${c.cotizacion_id || ""}</td>
          <td>${c.cliente_nombre || ""}</td>
          <td class="td-muted">${formatFecha(c.fecha_creacion)}</td>
          <td>${estadoBadge(c.estado || "borrador")}</td>
          <td class="td-amount">${formatMoney(c.total)}</td>
          <td class="td-actions"></td>
        `;

        const tdActions = tr.lastElementChild;

        const btnEditar = document.createElement("button");
        btnEditar.className = "btn btn-ghost btn-sm";
        btnEditar.innerHTML = '<i data-lucide="pencil"></i> Editar';
        btnEditar.onclick = () => location.href = `editar-cotizacion.html?id=${encodeURIComponent(c.id)}`;
        tdActions.appendChild(btnEditar);

        const btnImprimir = document.createElement("button");
        btnImprimir.className = "btn btn-ghost btn-sm";
        btnImprimir.innerHTML = '<i data-lucide="printer"></i> Imprimir';
        btnImprimir.onclick = () => window.open(`imprimir-cotizacion.html?id=${encodeURIComponent(c.id)}`, "_blank");
        tdActions.appendChild(btnImprimir);

        const btnDuplicar = document.createElement("button");
        btnDuplicar.className = "btn btn-ghost btn-sm";
        btnDuplicar.innerHTML = '<i data-lucide="copy"></i> Duplicar';
        btnDuplicar.onclick = () => duplicarCotizacion(c.id);
        tdActions.appendChild(btnDuplicar);

        const btnAnular = document.createElement("button");
        btnAnular.className = "btn btn-danger-ghost btn-sm";
        btnAnular.innerHTML = '<i data-lucide="ban"></i> Anular';
        btnAnular.onclick = () => anularCotizacion(c.id);
        tdActions.appendChild(btnAnular);

        const btnEliminar = document.createElement("button");
        btnEliminar.className = "btn btn-ghost btn-sm";
        btnEliminar.innerHTML = '<i data-lucide="trash-2"></i> Eliminar';
        btnEliminar.onclick = () => eliminarCotizacion(c.id);
        tdActions.appendChild(btnEliminar);

        tbody.appendChild(tr);

        if (cards) {
          const card = document.createElement("div");
          card.className = "responsive-card";
          card.innerHTML = `
            <div class="responsive-card-top">
              <div>
                <div class="responsive-card-title">${c.cliente_nombre || "—"}</div>
                <div class="responsive-card-sub">${c.cotizacion_id || ""} · ${formatFecha(c.fecha_creacion)}</div>
              </div>
              ${estadoBadge(c.estado || "borrador")}
            </div>
            <div class="responsive-card-meta">
              <strong style="color:var(--fg-1); font-size:14px;">${formatMoney(c.total)}</strong>
            </div>
            <div class="responsive-card-actions">
              <button class="btn btn-secondary btn-sm" onclick="location.href='editar-cotizacion.html?id=${encodeURIComponent(c.id)}'"><i data-lucide="pencil"></i> Editar</button>
              <button class="btn btn-secondary btn-sm" onclick="window.open('imprimir-cotizacion.html?id=${encodeURIComponent(c.id)}','_blank')"><i data-lucide="printer"></i> Imprimir</button>
              <button class="btn btn-secondary btn-sm" onclick="duplicarCotizacion('${c.id}')"><i data-lucide="copy"></i> Duplicar</button>
              <button class="btn btn-danger-ghost btn-sm" onclick="anularCotizacion('${c.id}')"><i data-lucide="ban"></i> Anular</button>
              <button class="btn btn-ghost btn-sm" onclick="eliminarCotizacion('${c.id}')"><i data-lucide="trash-2"></i> Eliminar</button>
            </div>
          `;
          cards.appendChild(card);
        }
      });
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function actualizarResumenCotizaciones(lista, total) {
      const el = document.getElementById("resumenCotizaciones");
      if (!el) return;
      const totalVisible = (lista || []).length;
      el.textContent = `Mostrando ${totalVisible} de ${total}`;
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

    async function duplicarCotizacion(id) {
      if (!await Modal.confirm({ message: "¿Duplicar esta cotización?" })) return;
      const d = await CotizacionesService.getCotizacion(id);
      if (!d) return;
      const user = firebase.auth().currentUser;
      const cotizacion_id = await generarCotizacionIdSimple();

      const nuevo = {
        ...d,
        cotizacion_id,
        estado: "borrador",
        deleted: false,
        fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp(),
        creado_por_uid: user?.uid || null,
        creado_por_email: user?.email || null,
        vendedor_uid: user?.uid || null
      };

      await CotizacionesService.addCotizacion(nuevo);
      await cargarCotizaciones();
    }

    async function anularCotizacion(id) {
      if (!await Modal.confirm({ message: "¿Anular esta cotización?", danger: true })) return;
      await CotizacionesService.updateCotizacion(id, {
        estado: "anulada",
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp()
      });
      await cargarCotizaciones();
    }

    async function eliminarCotizacion(id) {
      if (!await Modal.confirm({ message: "¿Eliminar (ocultar) esta cotización?", danger: true })) return;
      await CotizacionesService.updateCotizacion(id, {
        deleted: true,
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp()
      });
      await cargarCotizaciones();
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { location.href = "../login.html"; return; }
      verificarAccesoYAplicarVisibilidad(async (rol) => {
        const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR];
        if (!permitidos.includes(rol)) {
          Toast.show("Sin acceso", 'bad');
          location.href = "../index.html";
          return;
        }
        await cargarCotizaciones(true);
      });
    });

    document.getElementById("toggleEliminadas").addEventListener("change", aplicarFiltros);
    document.getElementById("btnCargarMas").addEventListener("click", () => cargarCotizaciones(false));

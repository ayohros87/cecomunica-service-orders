// @ts-nocheck
    let cotizaciones = [];
    let lastDoc = null;
    let isLoading = false;

    function cerrarSesion() { firebase.auth().signOut().then(() => location.href = "../login.html"); }

    function estadoBadge(estado) {
      const map = {
        borrador: "estado-borrador",
        emitida: "estado-emitida",
        enviada: "estado-enviada",
        anulada: "estado-anulada"
      };
      return `<span class="badge ${map[estado] || ""}">${estado || ""}</span>`;
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
        btn.textContent = "⏳ Cargando...";
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
        btn.textContent = `⬇️ Cargar más cotizaciones (${totalVisible})`;
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
      if (btn) btn.textContent = `⬇️ Cargar más cotizaciones (${filtradas.length})`;
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
            <div class="empty-state">
              <div class="title">No hay cotizaciones para mostrar</div>
              <div class="hint">Prueba ajustando los filtros o crea una nueva cotización.</div>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
        if (cards) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.innerHTML = `<div class="title">No hay cotizaciones para mostrar</div><div class="hint">Prueba ajustando los filtros o crea una nueva cotización.</div>`;
          cards.appendChild(empty);
        }
        return;
      }
      lista.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${c.cotizacion_id || ""}</td>
          <td>${c.cliente_nombre || ""}</td>
          <td>${formatFecha(c.fecha_creacion)}</td>
          <td>${estadoBadge(c.estado || "borrador")}</td>
          <td>${formatMoney(c.total)}</td>
          <td></td>
        `;

        const acciones = document.createElement("div");
        acciones.className = "actions";

        const btnEditar = document.createElement("button");
        btnEditar.className = "btn";
        btnEditar.textContent = "✏️ Editar";
        btnEditar.onclick = () => location.href = `editar-cotizacion.html?id=${encodeURIComponent(c.id)}`;
        acciones.appendChild(btnEditar);

        const btnImprimir = document.createElement("button");
        btnImprimir.className = "btn";
        btnImprimir.textContent = "🖨️ Imprimir";
        btnImprimir.onclick = () => window.open(`imprimir-cotizacion.html?id=${encodeURIComponent(c.id)}`, "_blank");
        acciones.appendChild(btnImprimir);

        const btnDuplicar = document.createElement("button");
        btnDuplicar.className = "btn";
        btnDuplicar.textContent = "🧾 Duplicar";
        btnDuplicar.onclick = () => duplicarCotizacion(c.id);
        acciones.appendChild(btnDuplicar);

        const btnAnular = document.createElement("button");
        btnAnular.className = "btn danger";
        btnAnular.textContent = "⛔ Anular";
        btnAnular.onclick = () => anularCotizacion(c.id);
        acciones.appendChild(btnAnular);

        const btnEliminar = document.createElement("button");
        btnEliminar.className = "btn secondary";
        btnEliminar.textContent = "🗑️ Eliminar";
        btnEliminar.onclick = () => eliminarCotizacion(c.id);
        acciones.appendChild(btnEliminar);

        tr.lastElementChild.appendChild(acciones);
        tbody.appendChild(tr);

        if (cards) {
          const card = document.createElement("div");
          card.className = "card-cotizacion";
          card.innerHTML = `
            <div class="row">
              <div class="t1">${c.cotizacion_id || ""}</div>
              <div>${estadoBadge(c.estado || "borrador")}</div>
            </div>
            <div class="t2">${c.cliente_nombre || ""}</div>
            <div class="meta">${formatFecha(c.fecha_creacion)} · ${formatMoney(c.total)}</div>
            <div class="acciones">
              <button class="btn" onclick="location.href='editar-cotizacion.html?id=${encodeURIComponent(c.id)}'">✏️ Editar</button>
              <button class="btn" onclick="window.open('imprimir-cotizacion.html?id=${encodeURIComponent(c.id)}','_blank')">🖨️ Imprimir</button>
              <button class="btn" onclick="duplicarCotizacion('${c.id}')">🧾 Duplicar</button>
              <button class="btn danger" onclick="anularCotizacion('${c.id}')">⛔ Anular</button>
              <button class="btn secondary" onclick="eliminarCotizacion('${c.id}')">🗑️ Eliminar</button>
            </div>
          `;
          cards.appendChild(card);
        }
      });
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
      if (!confirm("¿Duplicar esta cotización?")) return;
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
      if (!confirm("¿Anular esta cotización?")) return;
      await CotizacionesService.updateCotizacion(id, {
        estado: "anulada",
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp()
      });
      await cargarCotizaciones();
    }

    async function eliminarCotizacion(id) {
      if (!confirm("¿Eliminar (ocultar) esta cotización?")) return;
      await CotizacionesService.updateCotizacion(id, {
        deleted: true,
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp()
      });
      await cargarCotizaciones();
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { location.href = "../login.html"; return; }
      verificarAccesoYAplicarVisibilidad(async (rol) => {
        const permitidos = ["administrador", "vendedor"];
        if (!permitidos.includes(rol)) {
          alert("Sin acceso");
          location.href = "../index.html";
          return;
        }
        await cargarCotizaciones(true);
      });
    });

    document.getElementById("toggleEliminadas").addEventListener("change", aplicarFiltros);
    document.getElementById("btnCargarMas").addEventListener("click", () => cargarCotizaciones(false));

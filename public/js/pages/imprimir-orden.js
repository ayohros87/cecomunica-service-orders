// @ts-nocheck
    (function ensureFirebaseInit(){
      function ok(){
        try { return firebase && firebase.apps && firebase.apps.length>0 && typeof db!=="undefined"; }
        catch { return false; }
      }
      if (ok()) return;

      // 2do intento: ./js
      var s=document.createElement('script');
      s.src='./js/firebase-init.js';
      s.onload=function(){ if(!ok()){ thirdTry(); } };
      s.onerror=function(){ thirdTry(); };
      document.head.appendChild(s);

      function thirdTry(){
        var s2=document.createElement('script');
        s2.src='/js/firebase-init.js';
        document.head.appendChild(s2);
      }
    })();

    const params = new URLSearchParams(window.location.search);
    const ordenId = params.get("id");

    // Fecha de generación
    const ahora = new Date();
    document.getElementById("fechaGeneracion").textContent = ahora.toLocaleString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    function firebaseListo() {
      try {
        return (firebase?.apps?.length > 0) && (typeof db !== "undefined");
      } catch { return false; }
    }

    function resolverNombreCliente(o) {
      return new Promise((resolve) => {
        const fallback = o.cliente_nombre || o.cliente || "—";
        if (!o.cliente_id) return resolve(fallback);
        ClientesService.getCliente(o.cliente_id)
          .then(c => resolve(c ? (c.nombre || fallback) : fallback))
          .catch(() => resolve(fallback));
      });
    }

    function renderOrden(datos, equipos, infoContainer, tablaContainer) {
      const tituloEquipos = document.getElementById("tituloEquipos");
      switch ((datos.tipo_de_servicio || "").toUpperCase()) {
        case "ENTRADA":     tituloEquipos.textContent = "Equipos en Entrada"; break;
        case "REPARACIÓN":  tituloEquipos.textContent = "Equipos en Reparación"; break;
        case "PROGRAMACIÓN":tituloEquipos.textContent = "Equipos a Programar"; break;
        default:            tituloEquipos.textContent = "Equipos Asociados";
      }
      infoContainer.innerHTML = `
        <div class="info-grid">
          <div class="info-item"><span class="info-label">N° Orden:</span> <span class="info-value">${ordenId}</span></div>
          <div class="info-item"><span class="info-label">Fecha Creación:</span> <span class="info-value">${datos.fechaCreacion}</span></div>
          <div class="info-item"><span class="info-label">Fecha Entrega:</span> <span class="info-value">${datos.fechaEntrega}</span></div>
          <div class="info-item full"><span class="info-label">Cliente:</span> <span class="info-value">${datos.cliente}</span></div>
          <div class="info-item"><span class="info-label">Tipo Servicio:</span> <span class="info-value">${datos.tipo_de_servicio || '—'}</span></div>
          <div class="info-item"><span class="info-label">Técnico:</span> <span class="info-value">${datos.tecnico_asignado || 'Sin asignar'}</span></div>
          <div class="info-item"><span class="info-label">Estado:</span> <span class="info-value">${datos.estado_reparacion || 'POR ASIGNAR'}</span></div>
          ${datos.observaciones ? `<div class="info-item full"><span class="info-label">Observaciones Generales:</span> <span class="info-value">${datos.observaciones}</span></div>` : ''}
        </div>
      `;
      if (!equipos || equipos.length === 0) {
        tablaContainer.innerHTML = `<div class="alert-box">⚠️ No hay equipos asociados a esta orden</div>`;
      } else {
        let tabla = `<table class="equipos-table"><thead><tr>
          <th style="width:40px;">#</th><th>Serie</th><th>Modelo</th>
          <th style="width:60px;">Batería</th><th style="width:60px;">Clip</th>
          <th style="width:60px;">Cargador</th><th style="width:60px;">Fuente</th>
          <th style="width:60px;">Antena</th><th>Observaciones</th>
        </tr></thead><tbody>`;
        equipos.forEach((e, i) => {
          tabla += `<tr>
            <td><strong>${i + 1}</strong></td>
            <td>${e.numero_de_serie || '—'}</td><td>${e.modelo || '—'}</td>
            <td>${e.bateria ? '✅' : '❌'}</td><td>${e.clip ? '✅' : '❌'}</td>
            <td>${e.cargador ? '✅' : '❌'}</td><td>${e.fuente ? '✅' : '❌'}</td>
            <td>${e.antena ? '✅' : '❌'}</td>
            <td style="text-align:left;">${e.observaciones || '—'}</td>
          </tr>`;
        });
        tabla += `</tbody></table>`;
        tablaContainer.innerHTML = tabla;
      }
    }

    function cargarOrden() {
      const infoContainer = document.getElementById("infoContainer");
      const tablaContainer = document.getElementById("tablaContainer");

      // Fast path: data passed from the index page via localStorage (no network needed)
      try {
        const raw = localStorage.getItem('imprimirOrdenData');
        if (raw) {
          const d = JSON.parse(raw);
          if (d && d.ordenId === ordenId) {
            localStorage.removeItem('imprimirOrdenData');
            renderOrden({
              tipo_de_servicio: d.tipo_de_servicio,
              tecnico_asignado: d.tecnico_asignado,
              estado_reparacion: d.estado_reparacion,
              observaciones: d.observaciones,
              cliente: d.cliente,
              fechaCreacion: d.fecha_creacion ? d.fecha_creacion.slice(0, 10) : '—',
              fechaEntrega: d.fecha_entrega ? d.fecha_entrega.slice(0, 10) : '—'
            }, d.equipos || [], infoContainer, tablaContainer);
            return;
          }
        }
      } catch (_) {}

      // Fallback: load directly from Firestore (e.g. direct URL access)
      OrdenesService.getOrder(ordenId).then(async (o) => {
        if (!o) {
          infoContainer.innerHTML = `<div class="alert-box">❌ Orden no encontrada</div>`;
          return;
        }
        const equipos = Array.isArray(o.equipos) ? o.equipos.filter(e => !e.eliminado) : [];
        const nombreCliente = await resolverNombreCliente(o);
        renderOrden({
          tipo_de_servicio: o.tipo_de_servicio,
          tecnico_asignado: o.tecnico_asignado,
          estado_reparacion: o.estado_reparacion,
          observaciones: o.observaciones,
          cliente: nombreCliente,
          fechaCreacion: o.fecha_creacion?.toDate ? o.fecha_creacion.toDate().toISOString().slice(0,10) : '—',
          fechaEntrega: o.fecha_entrega?.toDate ? o.fecha_entrega.toDate().toISOString().slice(0,10) : '—'
        }, equipos.map(e => ({
          numero_de_serie: e.numero_de_serie,
          modelo: e.modelo,
          bateria: e.bateria,
          clip: e.clip,
          cargador: e.cargador,
          fuente: e.fuente,
          antena: e.antena,
          observaciones: e.observaciones
        })), infoContainer, tablaContainer);
      }).catch((error) => {
        console.error("❌ Error al cargar la orden:", error);
        infoContainer.innerHTML = `<div class="alert-box">❌ Error al cargar la orden</div>`;
      });
    }

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!ordenId) {
        document.getElementById("infoContainer").innerHTML = `
          <div class="alert-box">❌ Falta el parámetro ?id en la URL</div>
        `;
        return;
      }

      if (!firebaseListo()) {
        document.getElementById("infoContainer").innerHTML = `
          <div class="alert-box">❌ Firebase no inicializó correctamente</div>
        `;
        return;
      }

      if (!user) {
        document.getElementById("infoContainer").innerHTML = `
          <div class="alert-box">❌ Debes iniciar sesión para ver esta orden</div>
        `;
        return;
      }

      try {
        await cargarOrden();
      } catch (e) {
        console.error("❌ Error al cargar la orden:", e);
        document.getElementById("infoContainer").innerHTML = `
          <div class="alert-box">❌ Error al cargar la orden (ver consola)</div>
        `;
      }
    });

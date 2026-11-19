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

    // Fechas en hora de Panamá, mismo formato corto/largo que la bandeja
    // (ordenes-state.js formatFecha/formatFechaHora; esta página no carga ese
    // archivo). Antes era toISOString().slice(0,10): UTC, un día corrido
    // después de las 7 p. m. (auditoría de módulos 2026-09-30, 01 R3).
    const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const partesPanama = (d) => {
      const p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Panama', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(d).forEach(x => { p[x.type] = x.value; });
      return p;
    };
    const fechaCorta = (ts) => {
      const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
      if (!d || isNaN(d.getTime())) return '—';
      const p = partesPanama(d);
      return `${p.day} ${MESES_CORTOS[Number(p.month) - 1]} ${p.year}`;
    };
    const fechaLarga = (d) => {
      const p = partesPanama(d);
      return `${p.day} ${MESES_CORTOS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase() === 'PM' ? 'p. m.' : 'a. m.'}`;
    };

    // Fecha de generación
    document.getElementById("fechaGeneracion").textContent = fechaLarga(new Date());

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

    // Órdenes de ENTRADA creadas por una devolución: la observación
    // auto-generada quedaba con el conteo de la PRIMERA tanda del check-in
    // (casi siempre 1) porque las tandas siguientes agregaban equipos sin
    // reescribirla. El backend ya la mantiene al día, pero las órdenes que ya
    // existen siguen con el número viejo — el conteo real es el del array de
    // equipos, así que se corrige aquí al imprimir (con el plural correcto).
    const RE_INSPECCION = /(inspecci[oó]n de\s+)\d+\s+equipos?(?:\(s\))?\s+devueltos?(?:\(s\))?/gi;
    function corregirConteoInspeccion(texto, n) {
      if (!texto) return texto;
      const s = n === 1 ? '' : 's';
      return String(texto).replace(RE_INSPECCION, (_m, pre) => `${pre}${n} equipo${s} devuelto${s}`);
    }

    // ── Visita técnica: radios atendidos (2026-11-19, Brenda) ───────────────
    // La visita impresa traía solo el informe: los radios, lo que el técnico
    // le hizo a cada uno y las piezas que le cambió había que consultarlos
    // dentro del módulo. Ahora salen en una tabla debajo del informe.
    const esTipoVisita = (tipo) => String(tipo || "").toLowerCase().includes("visita");
    // Todo texto libre de esta sección va escapado (el resto de la página
    // interpola tal cual; no se toca para no cambiar lo que ya imprime).
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

    // Piezas de la orden (subcolección `consumos`). Tolerante a fallo: si no
    // se pueden leer devuelve null y la columna sale "—"; la orden se imprime
    // igual.
    function cargarConsumos() {
      try {
        return Promise.resolve(OrdenesService.getConsumos(ordenId))
          .then((r) => (Array.isArray(r) ? r : null))
          .catch((e) => { console.warn("[imprimir-orden] no se pudieron cargar las piezas (consumos):", e); return null; });
      } catch (e) {
        console.warn("[imprimir-orden] no se pudieron cargar las piezas (consumos):", e);
        return Promise.resolve(null);
      }
    }

    // "2× Teclado PNC360" por pieza; las de garantía se marcan "(sin costo)".
    // La misma pieza cobrada y sin costo sale en dos líneas: son dos cosas
    // distintas para quien lee el papel.
    function piezasTexto(cons) {
      const porPieza = new Map();
      (cons || []).forEach((c) => {
        const qty = Number(c.qty || 0);
        if (!(qty > 0)) return;
        const nombre = String(c.pieza_nombre || c.sku || "").trim() || "(pieza sin nombre)";
        const sinCosto = String(c.tipo || "") === "garantia";
        const k = `${String(c.pieza_id || c.sku || nombre).toLowerCase()}|${sinCosto ? "g" : "c"}`;
        if (!porPieza.has(k)) porPieza.set(k, { nombre, sinCosto, qty: 0 });
        porPieza.get(k).qty += qty;
      });
      return [...porPieza.values()]
        .map((p) => `${p.qty}× ${esc(p.nombre)}${p.sinCosto ? " (sin costo)" : ""}`)
        .join("<br>");
    }

    // `consumos`: undefined = todavía cargando · null = no se pudieron leer ·
    // array = lo registrado. Los consumos se casan con su radio por `equipoId`
    // (id del equipo; los equipos legacy sin id los guardaban bajo el número
    // de serie — mismo respaldo que cotizar-orden.js).
    function radiosVisitaHtml(equipos, consumos) {
      const list = Array.isArray(equipos) ? equipos : [];
      if (!list.length) return "";
      const porEquipo = {};
      (Array.isArray(consumos) ? consumos : []).forEach((c) => {
        const k = String(c.equipoId || "").trim();
        (porEquipo[k] = porEquipo[k] || []).push(c);
      });
      const usados = new Set();
      const consumosDe = (e) => {
        const serial = String(e.numero_de_serie || "").trim();
        const out = [];
        [e.id, serial].forEach((k) => {
          if (k && porEquipo[k] && !usados.has(k)) { usados.add(k); out.push(...porEquipo[k]); }
        });
        return out;
      };
      const piezasCelda = (e) => {
        if (consumos === undefined) return "…";
        if (consumos === null) return "—";
        return piezasTexto(consumosDe(e)) || "—";
      };
      let html = `<h3 class="section-title" style="margin-top:14px;">Radios atendidos (${list.length})</h3>
        <table class="equipos-table"><thead><tr>
          <th style="width:30px;">#</th><th style="width:16%;">Serie</th><th style="width:14%;">Modelo</th>
          <th>Intervención</th><th style="width:22%;">Piezas</th><th style="width:18%;">Observaciones</th>
        </tr></thead><tbody>`;
      list.forEach((e, i) => {
        const trabajo = String(e.trabajo_tecnico || "").trim();
        const intervencion = e.intervencion_no_disponible
          ? `<strong>No disponible</strong>${String(e.motivo_no_disponible || "").trim() ? ` — ${esc(String(e.motivo_no_disponible).trim())}` : ""}`
          : (trabajo ? esc(trabajo) : "—");
        html += `<tr>
          <td><strong>${i + 1}</strong></td>
          <td>${esc(e.numero_de_serie || "—")}</td><td>${esc(e.modelo || "—")}</td>
          <td style="text-align:left;white-space:pre-wrap;">${intervencion}</td>
          <td style="text-align:left;">${piezasCelda(e)}</td>
          <td style="text-align:left;">${esc(e.observaciones || "—")}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
      // Piezas registradas sin radio (o de un radio que ya no está en la
      // orden): no se pierden, van al pie de la tabla.
      if (Array.isArray(consumos)) {
        const sueltas = Object.keys(porEquipo).filter((k) => !usados.has(k)).flatMap((k) => porEquipo[k]);
        const txt = piezasTexto(sueltas);
        if (txt) html += `<div class="info-item" style="margin-top:4px;"><span class="info-label">Piezas sin radio asociado:</span> <span class="info-value">${txt.replace(/<br>/g, " · ")}</span></div>`;
      }
      return html;
    }

    function renderOrden(datos, equipos, infoContainer, tablaContainer, consumos) {
      const tituloEquipos = document.getElementById("tituloEquipos");
      const esVisita = esTipoVisita(datos.tipo_de_servicio);
      switch ((datos.tipo_de_servicio || "").toUpperCase()) {
        case "ENTRADA":     tituloEquipos.textContent = "Equipos en Entrada"; break;
        case "REPARACIÓN":  tituloEquipos.textContent = "Equipos en Reparación"; break;
        case "PROGRAMACIÓN":tituloEquipos.textContent = "Equipos a Programar"; break;
        default:            tituloEquipos.textContent = esVisita ? "Informe de visita técnica" : "Equipos Asociados";
      }

      // Resumen: cantidad de radios + accesorios (>0). Misma lógica
      // de cuenta que el modal de entrega y las notas de entrega.
      const list = Array.isArray(equipos) ? equipos : [];
      const tot = { radios: list.length, bateria: 0, clip: 0, cargador: 0, fuente: 0, antena: 0, cubrepolvo: 0 };
      list.forEach(e => { ['bateria','clip','cargador','fuente','antena','cubrepolvo'].forEach(k => { if (e[k]) tot[k]++; }); });
      const accMap = [
        ['bateria',  'batería',  'baterías'],
        ['clip',     'clip',     'clips'],
        ['cargador', 'cargador', 'cargadores'],
        ['fuente',   'fuente',   'fuentes'],
        ['antena',   'antena',   'antenas'],
        ['cubrepolvo', 'cubre polvo', 'cubre polvos'],
      ];
      const resumenPartes = [`<strong>${tot.radios}</strong> radio${tot.radios !== 1 ? 's' : ''}`];
      accMap.forEach(([k, sing, plur]) => {
        if (tot[k] > 0) resumenPartes.push(`<strong>${tot[k]}</strong> ${tot[k] === 1 ? sing : plur}`);
      });
      const resumenHtml = resumenPartes.join(' · ');
      const observaciones = corregirConteoInspeccion(datos.observaciones, tot.radios);

      infoContainer.innerHTML = `
        <div class="info-grid">
          <div class="info-item"><span class="info-label">N° Orden:</span> <span class="info-value">${ordenId}</span></div>
          <div class="info-item"><span class="info-label">Fecha Creación:</span> <span class="info-value">${datos.fechaCreacion}</span></div>
          <div class="info-item"><span class="info-label">Fecha Entrega:</span> <span class="info-value">${datos.fechaEntrega}</span></div>
          <div class="info-item full"><span class="info-label">Cliente:</span> <span class="info-value">${datos.cliente}</span></div>
          <div class="info-item"><span class="info-label">Tipo Servicio:</span> <span class="info-value">${datos.tipo_de_servicio || '—'}</span></div>
          <div class="info-item"><span class="info-label">Técnico:</span> <span class="info-value">${datos.tecnico_asignado || 'Sin asignar'}</span></div>
          <div class="info-item"><span class="info-label">Estado:</span> <span class="info-value">${datos.estado_reparacion || 'POR ASIGNAR'}</span></div>
          ${esVisita ? '' : `<div class="info-item full"><span class="info-label">Resumen:</span> <span class="info-value">${resumenHtml}</span></div>`}
          ${esVisita && datos.visita?.sitio ? `<div class="info-item full"><span class="info-label">Sitio:</span> <span class="info-value">${datos.visita.sitio}</span></div>` : ''}
          ${esVisita && datos.visita?.contacto_sitio ? `<div class="info-item"><span class="info-label">Contacto en sitio:</span> <span class="info-value">${datos.visita.contacto_sitio}</span></div>` : ''}
          ${observaciones ? `<div class="info-item full"><span class="info-label">Observaciones Generales:</span> <span class="info-value">${observaciones}</span></div>` : ''}
        </div>
      `;
      // Las visitas técnicas llevan el informe estructurado (motivo, trabajo,
      // hallazgos, elementos de sitio) y, debajo, los radios atendidos con su
      // intervención y sus piezas (2026-11-19). Sin columnas de accesorios:
      // en una visita no entra ni sale nada del taller. Una visita con radios
      // pero todavía sin informe muestra el aviso Y la tabla.
      if (esVisita) {
        const inf = datos.informe_visita;
        let html;
        if (!inf || (!inf.trabajo_realizado && !inf.hallazgos && !(inf.elementos || []).length)) {
          html = `<div class="alert-box">⚠️ Visita sin informe registrado todavía</div>`;
        } else {
          html = `<div class="info-grid" style="margin-bottom:12px;">
            ${inf.fecha_visita ? `<div class="info-item"><span class="info-label">Fecha de visita:</span> <span class="info-value">${esc(inf.fecha_visita)}</span></div>` : ''}
            ${inf.motivo ? `<div class="info-item"><span class="info-label">Motivo:</span> <span class="info-value">${esc(inf.motivo)}</span></div>` : ''}
            ${inf.trabajo_realizado ? `<div class="info-item full"><span class="info-label">Trabajo realizado:</span> <span class="info-value" style="white-space:pre-wrap;">${esc(inf.trabajo_realizado)}</span></div>` : ''}
            ${inf.hallazgos ? `<div class="info-item full"><span class="info-label">Hallazgos:</span> <span class="info-value" style="white-space:pre-wrap;">${esc(inf.hallazgos)}</span></div>` : ''}
          </div>`;
          const els = inf.elementos || [];
          if (els.length) {
            html += `<table class="equipos-table"><thead><tr>
              <th style="width:40px;">#</th><th>Elemento</th><th>Detalle</th><th>Serial</th>
            </tr></thead><tbody>`;
            els.forEach((el, i) => {
              html += `<tr><td><strong>${i + 1}</strong></td><td>${esc(el.tipo || '—')}</td><td style="text-align:left;">${esc(el.detalle || '—')}</td><td>${esc(el.serial || '—')}</td></tr>`;
            });
            html += `</tbody></table>`;
          }
        }
        tablaContainer.innerHTML = html + radiosVisitaHtml(list, consumos);
        return;
      }
      if (!equipos || equipos.length === 0) {
        tablaContainer.innerHTML = `<div class="alert-box">⚠️ No hay equipos asociados a esta orden</div>`;
      } else {
        let tabla = `<table class="equipos-table"><thead><tr>
          <th style="width:40px;">#</th><th>Serie</th><th>Modelo</th>
          <th style="width:60px;">Batería</th><th style="width:60px;">Clip</th>
          <th style="width:60px;">Cargador</th><th style="width:60px;">Fuente</th>
          <th style="width:60px;">Antena</th><th style="width:60px;">Cubre Polvo</th><th>Observaciones</th>
        </tr></thead><tbody>`;
        equipos.forEach((e, i) => {
          tabla += `<tr>
            <td><strong>${i + 1}</strong></td>
            <td>${e.numero_de_serie || '—'}</td><td>${e.modelo || '—'}</td>
            <td>${e.bateria ? '✅' : '❌'}</td><td>${e.clip ? '✅' : '❌'}</td>
            <td>${e.cargador ? '✅' : '❌'}</td><td>${e.fuente ? '✅' : '❌'}</td>
            <td>${e.antena ? '✅' : '❌'}</td>
            <td>${e.cubrepolvo ? '✅' : '❌'}</td>
            <td style="text-align:left;">${e.sin_reparar ? '<strong style="color:#991B1B;">Se devuelve sin reparar.</strong> ' : ''}${e.observaciones || '—'}</td>
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
          // Una VISITA necesita los campos de intervención por radio, que la
          // bandeja manda desde la versión 2 del paquete. Si lo dejó una
          // pestaña de la bandeja abierta con el código anterior (sin `v`),
          // se descarta y se lee de Firestore: mejor un viaje que una tabla
          // de radios sin intervenciones.
          const viejoParaVisita = d && esTipoVisita(d.tipo_de_servicio) && Number(d.v || 0) < 2;
          if (d && d.ordenId === ordenId && viejoParaVisita) {
            localStorage.removeItem('imprimirOrdenData');
          } else if (d && d.ordenId === ordenId) {
            localStorage.removeItem('imprimirOrdenData');
            const datosRapidos = {
              tipo_de_servicio: d.tipo_de_servicio,
              tecnico_asignado: d.tecnico_asignado,
              estado_reparacion: d.estado_reparacion,
              observaciones: d.observaciones,
              cliente: d.cliente,
              visita: d.visita || null,
              informe_visita: d.informe_visita || null,
              fechaCreacion: d.fecha_creacion ? d.fecha_creacion.slice(0, 10) : '—',
              fechaEntrega: d.fecha_entrega ? d.fecha_entrega.slice(0, 10) : '—'
            };
            const eqsRapidos = d.equipos || [];
            // Visita con radios: se pinta ya (la columna Piezas dice "…") y
            // se completa cuando llegan los consumos — o queda "—" si fallan.
            const pidePiezas = esTipoVisita(d.tipo_de_servicio) && eqsRapidos.length > 0;
            renderOrden(datosRapidos, eqsRapidos, infoContainer, tablaContainer, pidePiezas ? undefined : null);
            if (pidePiezas) {
              cargarConsumos().then((cons) => renderOrden(datosRapidos, eqsRapidos, infoContainer, tablaContainer, cons));
            }
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
        // Sin los descartados que se quedan en Cecomunica: tras el QC, este
        // papel es el que firma el cliente al retirar (domain/descarteEntrega.js).
        // En una VISITA no se filtra nada por descarte: no hay retiro ni QC,
        // y el papel tiene que listar todos los radios atendidos.
        const DE = window.DescarteEntrega || null;
        const esVisitaO = esTipoVisita(o.tipo_de_servicio);
        const equipos = Array.isArray(o.equipos)
          ? o.equipos.filter(e => !e.eliminado && (esVisitaO || !(DE && DE.seQueda(o, e)))) : [];
        const [nombreCliente, consumos] = await Promise.all([
          resolverNombreCliente(o),
          (esVisitaO && equipos.length) ? cargarConsumos() : Promise.resolve(null),
        ]);
        renderOrden({
          tipo_de_servicio: o.tipo_de_servicio,
          tecnico_asignado: o.tecnico_asignado,
          estado_reparacion: o.estado_reparacion,
          observaciones: o.observaciones,
          cliente: nombreCliente,
          visita: o.visita || null,
          informe_visita: o.informe_visita || null,
          fechaCreacion: fechaCorta(o.fecha_creacion),
          fechaEntrega: fechaCorta(o.fecha_entrega)
        }, equipos.map(e => ({
          sin_reparar: !esVisitaO && !!(DE && DE.sinReparar(o, e)),
          id: e.id || '',
          numero_de_serie: e.numero_de_serie,
          modelo: e.modelo,
          bateria: e.bateria,
          clip: e.clip,
          cargador: e.cargador,
          fuente: e.fuente,
          antena: e.antena,
          cubrepolvo: e.cubrepolvo,
          observaciones: e.observaciones,
          trabajo_tecnico: e.trabajo_tecnico || '',
          intervencion_no_disponible: !!e.intervencion_no_disponible,
          motivo_no_disponible: e.motivo_no_disponible || ''
        })), infoContainer, tablaContainer, consumos);
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

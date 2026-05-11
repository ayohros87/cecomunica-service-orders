// @ts-nocheck
// Trabajar-Orden: equipos, consumos, chips de recomendación, adjuntos
window.TOEquipos = {

  async renderEquiposYConsumos() {
    const self = this;
    const wrap = TO.byId('equiposWrap');
    wrap.innerHTML = '';

    for (const [, unsub] of TO.unsubByEquipo.entries()) { try { unsub(); } catch {} }
    TO.unsubByEquipo.clear();

    await Promise.all(TO.equipos.map(async (e, i) => {
      const eid  = e.id || e.numero_de_serie || 'X';
      const card = document.createElement('div');
      card.className = 'fila-equipo';
      card.innerHTML = `
        <div class="hdr">
          <div class="titulo">
            <div><strong>#${i + 1}</strong> · <strong>Serie:</strong> ${e.numero_de_serie || '-'}</div>
            <div class="muted"><small>Modelo: ${e.modelo || '-'}</small></div>
          </div>
          <div class="acciones">
            <button class="toggle" title="Mostrar/Ocultar" onclick="TOEquipos.toggleBody('${eid}')">▾</button>
            <select class="sel-filtro-tipo" data-eid="${eid}" style="font-size:12px">
              <option value="todos">Todos</option>
              <option value="cobro">Cobro</option>
              <option value="garantia">Garantía</option>
              <option value="interno">Interno</option>
            </select>
            <button class="btn" data-role="agregar-pieza" onclick="TOPieza.abrirModal('${eid}')">🧩 Pieza</button>
            <button class="btn ok" onclick="TOServicio.abrirModal('${eid}')">🔧 Servicio</button>
          </div>
        </div>

        <div id="body_${eid}" class="body">
          <div>
            <div class="rec-label">Recomendadas para el modelo</div>
            <div class="recs-wrap" id="recs_asoc_${eid}"></div>
            <div class="rec-label" style="margin-top:4px;">Más usadas (inteligencia)</div>
            <div class="recs-wrap" id="recs_top_${eid}"></div>
          </div>
          <div class="consumos" id="consumos_${eid}">
            <div class="muted">Cargando consumos...</div>
          </div>

          <div class="mt-8 notas-box">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="col-int">
                <label><strong>Notas internas</strong></label>
                <textarea rows="3" class="inp-nota" data-scope="internas" data-eid="${eid}" placeholder="Comentarios para uso interno"></textarea>
              </div>
              <div class="col-cli">
                <label><strong>Notas para el cliente</strong></label>
                <textarea rows="3" class="inp-nota" data-scope="cliente" data-eid="${eid}" placeholder="Texto que aparecerá en la cotización"></textarea>
              </div>
            </div>
          </div>

          <div class="mt-8">
            <label><strong>Adjuntos</strong></label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="file" accept="image/*" data-eid="${eid}" class="inp-archivo">
              <button class="btn" onclick="TOEquipos.listarAdjuntos('${eid}')">🔄 Refrescar</button>
            </div>
            <div id="adj_${eid}" class="muted" style="margin-top:6px">Sin archivos.</div>
          </div>
        </div>
      `;
      wrap.appendChild(card);
      self.renderRecsParaEquipo(eid);

      try {
        const meta = await OrdenesService.getEquipoMeta(TO.ordenId, eid);
        if (meta) {
          const selInt = document.querySelector(`.inp-nota[data-scope="internas"][data-eid="${eid}"]`);
          const selCli = document.querySelector(`.inp-nota[data-scope="cliente"][data-eid="${eid}"]`);
          if (selInt) selInt.value = meta.notas_internas || '';
          if (selCli) selCli.value = meta.notas_cliente  || '';
        }
      } catch {}

      const unsub = OrdenesService.subscribeConsumos(TO.ordenId, eid, async items => {
        await self.pintarTablaConsumos(eid, items);
        await TOCotizacion.renderResumen();
      });
      TO.unsubByEquipo.set(eid, unsub);
    }));
  },

  async renderRecsParaEquipo(eid) {
    const self   = this;
    const eq     = TO.equiposById.get(eid) || {};
    const modelo = eq.modelo || '';
    const marca  = eq.marca  || eq.fabricante || '';
    const mnorm  = TO.modeloNorm(modelo, marca);

    const asociadas = TO.inventario.filter(p => {
      const lst = Array.isArray(p.equipos_asociados) ? p.equipos_asociados.map(x => TO.norm(x)) : [];
      return (p.activo !== false) && (lst.includes(TO.norm(modelo)) || lst.includes(TO.norm(marca)));
    }).slice(0, 8);
    self.pintarChips(`recs_asoc_${eid}`, asociadas, eid);

    let topPiezas = [];
    try {
      const rows = await PiezasService.getTopByModelo(mnorm, 8);
      topPiezas = rows.map(r => TO.inventarioById.get(r.pieza_id)).filter(Boolean);
    } catch {}
    self.pintarChips(`recs_top_${eid}`, topPiezas, eid);
  },

  async incrementarUsoAnalytics(eid, piezaId) {
    try {
      const eq    = TO.equiposById.get(eid) || {};
      const mnorm = TO.modeloNorm(eq.modelo || '', eq.marca || eq.fabricante || '');
      await PiezasService.incrementarUsoAnalytics(mnorm, piezaId);
    } catch {}
  },

  pintarChips(containerId, lista, eid) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!lista || lista.length === 0) { el.innerHTML = '<span class="muted">—</span>'; return; }
    el.innerHTML = lista.map(p => {
      const sinStock   = Number(p.cantidad || 0) <= 0;
      const price      = typeof p.precio_venta === 'number' ? p.precio_venta : 0;
      const sinControl = p.sin_control_inventario === true;
      const disabled   = (!sinControl && sinStock) ? 'disabled' : '';
      return `<button class="rec-chip" ${disabled}
        title="${p.descripcion || p.nombre || ''}\nStock: ${p.cantidad || 0}"
        onclick="TOEquipos.chipAddPieza('${eid}','${p.id}')">
        <span>${p.descripcion || p.nombre || ((p.marca || '') + ' ' + (p.modelo || '')) || 'Pieza'}</span>
        <span class="mono">${p.sku || ''}</span>
        <span class="price">${TO.fmtMoney(price)}</span>
      </button>`;
    }).join('');
  },

  async chipAddPieza(eid, piezaId) {
    try {
      if (TO.ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); return; }

      const p          = await PiezasService.getPieza(piezaId);
      if (!p) return;

      const qty        = 1;
      const tipo       = 'cobro';
      const precio     = Number(p.precio_venta || 0);
      const sinControl = p.sin_control_inventario === true;

      await OrdenesService.addConsumo(TO.ordenId, {
        equipoId:       eid,
        pieza_id:       piezaId,
        pieza_nombre:   p.descripcion || p.nombre || ((p.marca || '') + ' ' + (p.modelo || '')),
        sku:            p.sku || '',
        qty, precio_unit: precio, tipo, subtotal: precio,
        added_by_uid:   TO.usuarioActual.uid,
        added_by_email: TO.usuarioActual.email,
        added_at:       firebase.firestore.FieldValue.serverTimestamp()
      });

      if (!sinControl) {
        await PiezasService.ajustarDelta(piezaId, -qty);
      }

      await TO.ensureEnProgreso();
      await this.incrementarUsoAnalytics(eid, piezaId);
      TO.showToast('Pieza agregada');
    } catch (e) {
      console.error(e);
      TO.showToast('No se pudo agregar');
    }
  },

  toggleBody(eid) {
    const body = TO.byId('body_' + eid);
    body.style.display = (body.style.display === 'none' ? 'block' : 'none');
  },

  async pintarTablaConsumos(eid, items) {
    const zona = TO.byId('consumos_' + eid);
    if (!zona) return;

    if (items.length === 0) { zona.innerHTML = '<em>No hay piezas registradas.</em>'; return; }

    const filtroSel = document.querySelector(`.sel-filtro-tipo[data-eid="${eid}"]`);
    const filtro    = filtroSel ? filtroSel.value : 'todos';
    const data      = (filtro === 'todos') ? items : items.filter(x => x.tipo === filtro);

    let html = `<table><thead><tr>
      <th>Pieza/Servicio</th><th>SKU</th><th>Tipo</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th>Acciones</th>
    </tr></thead><tbody>`;

    let totalEquipo  = 0;
    const puedeEditar = [ROLES.ADMIN, ROLES.RECEPCION, ROLES.INVENTARIO].includes(TO.rolUsuario);

    data.forEach(it => {
      const sub = Number(it.subtotal || 0);
      if (it.tipo === 'cobro') totalEquipo += sub;

      const tipoSel = `<select data-id="${it.id}" class="sel-tipo" style="font-size:12px" data-prev="${it.tipo}">
        <option value="cobro"    ${it.tipo === 'cobro'    ? 'selected' : ''}>cobro</option>
        <option value="garantia" ${it.tipo === 'garantia' ? 'selected' : ''}>garantía</option>
        <option value="interno"  ${it.tipo === 'interno'  ? 'selected' : ''}>interno</option>
      </select>`;

      const qtyInp = `<input type="number" min="1" step="1" value="${it.qty}" data-prev="${it.qty}"
        data-id="${it.id}" class="inp-qty" style="width:72px">`;

      html += `<tr>
        <td>${it.pieza_nombre}</td>
        <td>${it.sku || '-'}</td>
        <td>${tipoSel}</td>
        <td>${qtyInp}</td>
        <td>${TO.fmtMoney(it.precio_unit)}</td>
        <td>${TO.fmtMoney(sub)}</td>
        <td>
          ${puedeEditar ? `<button class="btn" data-action="editar-precio" onclick="TOEquipos.editarPrecio('${it.id}')">✏️ Precio</button>` : ''}
          <button class="btn danger" data-action="eliminar-linea" title="Eliminar" onclick="TOEquipos.eliminarLinea('${it.id}','${eid}')">🗑️</button>
        </td>
      </tr>`;
    });

    html += `</tbody></table>
    <div class="total-mini">Subtotal cobrado (equipo): ${TO.fmtMoney(totalEquipo)}</div>`;
    zona.innerHTML = html;
  },

  async listarAdjuntos(equipoId) {
    const listRef = firebase.storage().ref().child(`ordenes/${TO.ordenId}/${equipoId}`);
    try {
      const res = await listRef.listAll();
      if (res.items.length === 0) { TO.byId('adj_' + equipoId).innerHTML = 'Sin archivos.'; return; }
      const first  = res.items.slice(0, 6);
      const urls   = await Promise.all(first.map(i => i.getDownloadURL()));
      const extras = res.items.length > 6 ? `<span class="muted"> +${res.items.length - 6} más</span>` : '';
      TO.byId('adj_' + equipoId).innerHTML = urls.map(u => `<a href="${u}" target="_blank">📎</a>`).join(' · ') + extras;
    } catch {
      TO.byId('adj_' + equipoId).innerHTML = 'Sin archivos.';
    }
  },

  async editarPrecio(lineaId) {
    if (TO.ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); return; }
    const d = await OrdenesService.getConsumo(TO.ordenId, lineaId);
    if (!d) return;
    const nuevo = Number(prompt('Nuevo precio unitario (USD)', d.precio_unit));
    if (!isFinite(nuevo) || nuevo < 0) return;
    const sub = (d.tipo === 'cobro') ? (nuevo * Number(d.qty || 0)) : 0;
    await OrdenesService.updateConsumo(TO.ordenId, lineaId, {
      precio_unit:          nuevo,
      subtotal:             sub,
      precio_unit_override: true,
      override_by_uid:      TO.usuarioActual.uid,
      override_at:          firebase.firestore.FieldValue.serverTimestamp()
    });
    await TO.ensureEnProgreso();
  },

  async eliminarLinea(lineaId) {
    if (!confirm('¿Eliminar esta línea?')) return;
    await OrdenesService.deleteConsumo(TO.ordenId, lineaId);
  },

  init() {
    const self = this;
    document.addEventListener('change', async e => {
      if (e.target.classList.contains('inp-archivo')) {
        if (TO.ordenData?.cotizacion_emitida === true) { alert('Orden bloqueada.'); e.target.value = ''; return; }
        const file = e.target.files?.[0]; if (!file) return;
        const equipoId = e.target.getAttribute('data-eid');
        const path = `ordenes/${TO.ordenId}/${equipoId}/${Date.now()}_${file.name}`;
        await firebase.storage().ref().child(path).put(file);
        await self.listarAdjuntos(equipoId);
        e.target.value = '';
        alert('✅ Archivo subido');
        return;
      }

      if (e.target.classList.contains('sel-tipo')) {
        if (TO.ordenData?.cotizacion_emitida === true) {
          e.target.value = e.target.getAttribute('data-prev') || 'cobro'; return;
        }
        const id        = e.target.getAttribute('data-id');
        const nuevoTipo = e.target.value;
        const d = await OrdenesService.getConsumo(TO.ordenId, id);
        if (!d) return;
        const qty      = Math.max(1, Number(d.qty || 1));
        const precio   = Number(d.precio_unit || 0);
        const nuevoSub = (nuevoTipo === 'cobro') ? (qty * precio) : 0;
        await OrdenesService.updateConsumo(TO.ordenId, id, { tipo: nuevoTipo, subtotal: nuevoSub, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
        e.target.setAttribute('data-prev', nuevoTipo);
        await TO.ensureEnProgreso();
        return;
      }

      if (e.target.classList.contains('inp-qty')) {
        if (TO.ordenData?.cotizacion_emitida === true) {
          const prev = e.target.getAttribute('data-prev'); if (prev) e.target.value = prev; return;
        }
        const id = e.target.getAttribute('data-id');
        let nuevaQty = parseInt(e.target.value, 10);
        if (!isFinite(nuevaQty) || nuevaQty < 1) nuevaQty = 1;
        e.target.value = String(nuevaQty);
        e.target.setAttribute('data-prev', String(nuevaQty));
        const d = await OrdenesService.getConsumo(TO.ordenId, id);
        if (!d) return;
        const precio   = Number(d.precio_unit || 0);
        const nuevoSub = (d.tipo === 'cobro') ? (nuevaQty * precio) : 0;
        await OrdenesService.updateConsumo(TO.ordenId, id, { qty: nuevaQty, subtotal: nuevoSub, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
        await TO.ensureEnProgreso();
        return;
      }
    });
  }
};

TOEquipos.init();

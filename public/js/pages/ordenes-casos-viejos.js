// @ts-nocheck
/* ========================================
 * ORDENES CASOS VIEJOS — la válvula para ir cerrando lo que lleva meses vivo
 *
 * Pedido 2026-09-09: "para órdenes que llevan más de 30 días, inclusive que
 * no tengan entrega parcial — tenemos que ir cerrando los casos."
 *
 * EL MALENTENDIDO QUE ESTA HOJA EVITA
 * Las órdenes que se acumulan en COMPLETADO no son todas "el cliente no
 * vino". El comentario de domain/pendientes.js lo dice: quedan así porque
 * NADIE LAS MARCÓ — 67 medidas el 2026-08-20. Una válvula que asumiera que
 * el radio sigue en el estante y lo mandara a inventario metería una mentira
 * grande: radios que están donde el cliente, contados en nuestra repisa.
 *
 * Por eso aquí no hay un botón de "cerrar": hay DOS PUERTAS y hay que elegir.
 *
 *   A · "Ya se entregó, no se marcó"  → entrega retroactiva. Camino que YA
 *        existe: el modal de entrega en modo firma en papel (`no_recibido`),
 *        que pide motivo y quién recibió. Cierra ENTREGADO AL CLIENTE y el
 *        pool manda las unidades a en_cliente — la verdad.
 *   B · "Sigue aquí, el cliente no vino" → cierre por no retiro. La orden
 *        pasa a CERRADA (SIN RETIRAR) con motivo obligatorio y las unidades
 *        quedan en `no_retirado`: nuestro estante, propiedad del cliente,
 *        esperando decisión de inventario.
 *
 * Módulo diferido: lo carga CargaDiferida.casosViejos() al primer uso.
 * ======================================== */

(function () {
  'use strict';

  const DIAS_UMBRAL = 30;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const aDate = (ts) => {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  };

  const diasDesde = (ts) => {
    const d = aDate(ts);
    if (!d) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };

  // Un caso viejo es una REPARACIÓN terminada que lleva ≥30 días sin que nadie
  // la cierre. Se exige el QC resuelto: si el control de calidad sigue
  // pendiente, el caso no está esperando al cliente — está esperando al
  // taller, y esa cola ya tiene su propia señal.
  function esCasoViejo(o) {
    if (!o || o.eliminado === true) return false;
    if ((o.estado_reparacion || '') !== 'COMPLETADO (EN OFICINA)') return false;
    if (typeof EntregaTandas !== 'undefined' && !EntregaTandas.admiteTandas(o)) return false;
    if (typeof PendientesDomain !== 'undefined' && PendientesDomain.qcPendiente(o)) return false;
    const d = diasDesde(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion);
    return d !== null && d >= DIAS_UMBRAL;
  }

  function filaCaso(o) {
    const d = diasDesde(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion);
    const r = (typeof EntregaTandas !== 'undefined')
      ? EntregaTandas.resumen(o) : { total: 0, pendientes: 0, parcial: false };
    // Lo que de verdad decide el operador es CUÁNTOS radios están en juego y
    // si ya salió una parte: sin eso hay que abrir la orden para cada fila.
    const detalle = r.parcial
      ? `${r.pendientes} de ${r.total} sin retirar`
      : `${r.pendientes} equipo${r.pendientes === 1 ? '' : 's'}`;
    const txt = `<b>${esc(o.ordenId)}</b> · ${esc(o.cliente_nombre || 'Sin cliente')}
      <span style="color:var(--fg-3);">· ${esc(detalle)}</span>`;
    const ctaHtml = `
      <button type="button" class="btn btn-secondary cv-btn" data-cv="entregada" data-orden-id="${esc(o.ordenId)}"
              style="height:28px;font-size:12px;white-space:nowrap;">Ya se entregó</button>
      <button type="button" class="btn btn-secondary cv-btn" data-cv="sin-retirar" data-orden-id="${esc(o.ordenId)}"
              style="height:28px;font-size:12px;white-space:nowrap;">No vino</button>`;
    return Bandeja.fila({
      chip: r.parcial ? 'parcial' : 'completa',
      tono: r.parcial ? 'info' : 'aviso',
      txt, dias: d, clase: 'senal', ctaHtml,
      // `orden-id` en kebab, no `ordenId`: Bandeja.fila escribe la clave tal
      // cual en el atributo, HTML la baja a minúsculas (`data-ordenid`) y
      // `dataset.ordenId` —que busca `data-orden-id`— nunca la encuentra. Los
      // demás usos del kit pasan claves de una palabra y no se topan con esto.
      data: { 'orden-id': o.ordenId },
    });
  }

  // ── Puerta B: cierre por no retiro ────────────────────────────────────
  async function cerrarSinRetirar(ordenId) {
    const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId)
      || await OrdenesService.getOrder(ordenId);
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return false; }
    const r = (typeof EntregaTandas !== 'undefined')
      ? EntregaTandas.resumen(orden) : { pendientes: (orden.equipos || []).length };

    const accion = await Modal.sheet({
      title: `El cliente no retiró · orden ${ordenId}`,
      icon: 'archive', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;color:var(--fg-2);">
          Se archiva la orden <b>con ${r.pendientes} equipo${r.pendientes === 1 ? '' : 's'} todavía en el taller</b>.
          No es una entrega: los radios quedan marcados
          <b>"Listo · el cliente no lo retiró"</b> en Equipos por serial, a nombre de
          <b>${esc(orden.cliente_nombre || 'este cliente')}</b>, hasta que alguien decida qué hacer con ellos.
        </p>
        <p style="margin:0 0 12px;font-size:12.5px;color:var(--fg-3);">
          Si en realidad el cliente <b>ya se los llevó</b> y solo faltó marcarlo, cierra esto y
          usa <b>"Ya se entregó"</b>: si no, el inventario va a decir que tenemos radios que no tenemos.
        </p>
        <label class="form-label" for="cvMotivo">¿Por qué se cierra? *</label>
        <textarea id="cvMotivo" class="form-input" rows="2"
          placeholder="Ej: cliente cerró operaciones en Colón, no contesta desde julio"></textarea>
        <label class="form-label" for="cvContactos" style="margin-top:8px;">Qué se intentó</label>
        <input type="text" id="cvContactos" class="form-input"
               placeholder="Opcional — ej: 3 llamadas y correo del 12/08">`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'archivar', label: 'Cerrar sin retirar', primary: true, icon: 'archive' },
      ],
      onAction: async (a, root) => {
        if (a !== 'archivar') return null;
        const motivo = (root.querySelector('#cvMotivo').value || '').trim();
        if (motivo.length < 10) {
          Toast.show('Explica en una frase por qué se cierra (mínimo 10 caracteres)', 'bad');
          return false;
        }
        const botones = root.querySelectorAll('button');
        botones.forEach(b => { b.disabled = true; });
        try {
          const res = await OrdenesService.cerrarSinRetirar(ordenId, {
            motivo, contactos: (root.querySelector('#cvContactos').value || '').trim(),
          });
          Toast.show(`✅ Orden ${ordenId} cerrada · ${res.equipos} equipo${res.equipos === 1 ? '' : 's'} en custodia`, 'ok');
          return 'ok';
        } catch (err) {
          console.error('[casos-viejos]', err);
          Toast.show('❌ ' + (err.message || 'No se pudo cerrar la orden'), 'bad');
          botones.forEach(b => { b.disabled = false; });
          return false;
        }
      },
    });
    return accion === 'ok';
  }

  // ── La hoja ───────────────────────────────────────────────────────────
  async function abrir() {
    let casos = [];
    try {
      const rows = await OrdenesService.filterByStatus('COMPLETADO (EN OFICINA)', 300);
      casos = rows.filter(esCasoViejo)
        .sort((a, b) => (diasDesde(b.fecha_completado) || 0) - (diasDesde(a.fecha_completado) || 0));
    } catch (err) {
      console.error('[casos-viejos]', err);
      Toast.show('No se pudieron cargar los casos', 'bad');
      return;
    }

    const cuerpo = casos.length
      ? casos.map(filaCaso).join('')
      : Bandeja.vacio('Ninguna reparación lleva más de 30 días esperando. Nada que cerrar hoy.');

    await Modal.sheet({
      title: 'Casos viejos · reparaciones sin cerrar',
      icon: 'archive', size: 'xl',
      html: `
        <p style="margin:0 0 6px;font-size:13px;color:var(--fg-2);">
          Reparaciones terminadas hace más de <b>${DIAS_UMBRAL} días</b> que nadie ha cerrado.
          Cada una es una de dos cosas — hay que decir cuál:
        </p>
        <ul style="margin:0 0 12px;padding-left:18px;font-size:12.5px;color:var(--fg-3);">
          <li><b>Ya se entregó</b> — el cliente se los llevó y faltó marcarlo. Cierra como entrega
              (firma en papel) y los radios pasan a estar con el cliente.</li>
          <li><b>No vino</b> — los radios siguen en el taller. Se archiva la orden y las unidades
              quedan en custodia, esperando decisión de inventario.</li>
        </ul>
        <div id="cvLista">${cuerpo}</div>`,
      buttons: [{ action: 'cerrar', label: 'Cerrar' }],
      onMount: (root, api) => {
        root.querySelector('#cvLista').addEventListener('click', async (ev) => {
          const btn = ev.target.closest('.cv-btn');
          if (!btn) return;
          const ordenId = btn.dataset.ordenId;
          const fila = btn.closest('.bj-row');

          if (btn.dataset.cv === 'entregada') {
            // Puerta A: el camino de siempre, abierto en "firma en papel".
            //
            // La hoja se CIERRA antes de abrirlo. No es preferencia: el modal
            // de entrega es un `.overlay` (z-index 1500) y esta hoja es un
            // `.modal-backdrop` (10000+), así que dejarla abierta enterraría
            // el modal detrás y el operador vería la lista congelada sin
            // entender por qué no responde. Se vuelve a "Casos viejos" para
            // el siguiente — la lista se recarga con el caso ya resuelto.
            api.close('entregada');
            await entregarOrden(ordenId, { noRecibido: true });
            return;
          }
          if (btn.dataset.cv === 'sin-retirar') {
            const hecho = await cerrarSinRetirar(ordenId);
            if (hecho && fila) {
              fila.classList.add('is-off');
              fila.querySelectorAll('.cv-btn').forEach(b => b.remove());
              fila.insertAdjacentHTML('beforeend',
                '<span class="bj-tag">cerrada sin retirar</span>');
            }
          }
        });
      },
    });
  }

  window.abrirCasosViejos = abrir;
  window.CasosViejos = { esCasoViejo, DIAS_UMBRAL };
})();

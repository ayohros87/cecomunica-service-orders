// Anexo de aumento DORMIDO: el plazo para decidir qué pasa con los equipos que
// aparta (Alberto, 5-oct-2026). Espejo de functions/src/domain/anexoDormido.js
// — si cambia uno, cambia el otro — y de esRetenerAnexoDormido /
// esSoltarAnexoDormido en firestore.rules.
//
// 15 días desde que se durmió para RETENER (motivo + fecha probable de firma,
// 30 días más; la segunda vez solo administración) o SOLTAR (anula el anexo y
// la anulación de siempre libera los radios). Si nadie decide, el cron lo
// suelta solo — salvo que el taller ya trabajó su orden: entonces decide
// bodega (`dormido_bodega`). Reactivar la solicitud saca al anexo del sueño y
// el plazo deja de correr.
window.AnexoDormido = {
  DIAS_DECIDIR: 15,
  DIAS_RETENCION: 30,
  DIA: 86400000,

  _d(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  },

  es(g) {
    return g?.tipo === 'aumento' && g?.estado === 'pendiente_firma' && g?.dormido === true && g?.deleted !== true;
  },
  retenciones(g) { return Number(g?.dormido_retencion?.n || 0); },
  esperaBodega(g) { return this.es(g) && !!g?.dormido_bodega; },

  // Cuándo se sueltan: fin de la retención, o dormido_at + 15. Una marca
  // recién escrita (serverTimestamp pendiente) cuenta desde ahora.
  plazo(g) {
    if (!this.es(g)) return null;
    const hasta = this._d(g.dormido_retener_hasta);
    if (hasta) return hasta;
    const base = this._d(g.dormido_at) || (g.dormido_at ? new Date() : null);
    return base ? new Date(base.getTime() + this.DIAS_DECIDIR * this.DIA) : null;
  },
  retenerHasta(g, now = new Date()) {
    const p = this.plazo(g);
    const desde = p && p > now ? p : now;
    return new Date(desde.getTime() + this.DIAS_RETENCION * this.DIA);
  },
  diasParaSoltar(g, now = new Date()) {
    const p = this.plazo(g);
    return p ? Math.ceil((p - now) / this.DIA) : null;
  },

  // { ok, motivo } — la página dice por qué no, en vez de esconder el botón.
  puedeRetener(g, rol) {
    if (!this.es(g)) return { ok: false, motivo: 'El anexo no está dormido.' };
    if (this.esperaBodega(g)) return { ok: false, motivo: 'El plazo venció con la orden trabajada: lo decide bodega.' };
    if (!['administrador', 'gerente', 'vendedor'].includes(rol)) return { ok: false, motivo: 'Lo retiene el vendedor o administración.' };
    if (this.retenciones(g) >= 1 && rol !== 'administrador') {
      return { ok: false, motivo: 'Ya se retuvo una vez: la segunda retención la hace administración.' };
    }
    return { ok: true, motivo: '' };
  },
  puedeSoltar(g, rol, uid) {
    if (!this.es(g)) return { ok: false, motivo: 'El anexo no está dormido.' };
    if (g?.cierre?.entrega === true) return { ok: false, motivo: 'Ya se entregó: no hay nada apartado.' };
    if (['administrador', 'gerente'].includes(rol)) return { ok: true, motivo: '' };
    if (rol === 'vendedor') {
      return g.responsable_uid && g.responsable_uid === uid
        ? { ok: true, motivo: '' } : { ok: false, motivo: 'Lo suelta el vendedor que lo pidió o administración.' };
    }
    if (rol === 'inventario') {
      return this.esperaBodega(g)
        ? { ok: true, motivo: '' } : { ok: false, motivo: 'Bodega decide solo cuando el plazo vence con la orden trabajada.' };
    }
    return { ok: false, motivo: 'Tu rol no suelta anexos.' };
  },

  equiposApartados(g) {
    return (g?.aumento?.seriales_asignados || []).filter(s => String(s?.serial || '').trim()).length;
  },

  // dd/mm/aaaa en hora de Panamá.
  fecha(d) {
    const x = this._d(d);
    if (!x) return '—';
    const p = new Date(x.getTime() - 5 * 3600000).toISOString().slice(0, 10).split('-');
    return `${p[2]}/${p[1]}/${p[0]}`;
  },

  // Una línea para el chip / la señal.
  resumen(g, now = new Date()) {
    if (!this.es(g)) return '';
    if (this.esperaBodega(g)) return 'orden trabajada: decide bodega';
    const p = this.plazo(g);
    if (!p) return '';
    const ret = this.retenciones(g) ? 'retenido · ' : '';
    return p <= now ? `${ret}se suelta en el próximo corte` : `${ret}se suelta el ${this.fecha(p)}`;
  },
};

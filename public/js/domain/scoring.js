// Parts search / scoring domain module — pure logic, no DOM dependency
// API: PiezaSearch.score(pieza, query)  PiezaSearch.search(inventario, query, limit?)
window.PiezaSearch = {
  _equiposStr(p) {
    if (Array.isArray(p?.equipos_asociados)) return p.equipos_asociados.join(' ').toLowerCase();
    return String(p?.equipos_asociados || '').toLowerCase();
  },

  // SKU exact >>> SKU partial >>> description >>> brand >>> associated equipment
  score(p, q) {
    if (!q) return -Infinity;
    const sku   = String(p?.sku  || '').toLowerCase();
    const desc  = String(p?.descripcion || p?.nombre || '').toLowerCase();
    const marca = String(p?.marca || '').toLowerCase();
    const equip = this._equiposStr(p);
    if (sku === q) return 1000;
    let s = 0;
    if (sku.includes(q))   s += 80;
    if (desc.includes(q))  s += 60;
    if (marca.includes(q)) s += 40;
    if (equip.includes(q)) s += 20;
    return s;
  },

  search(inventario, query, limit = 8) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return (inventario || [])
      .map(p => ({ p, s: this.score(p, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(x => x.p);
  }
};

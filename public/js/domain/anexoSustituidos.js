// @ts-nocheck
// Radios del Anexo A que un REEMPLAZO ya sustituyó — lógica PURA.
//
// El caso (Zuleika, 2026-09-30): el Anexo A de SERV20260918-01 salió con 9
// radios, los 2 que se reemplazaron (22806A0291/0294) junto a sus 2 entrantes.
// El documento sin firma digital se arma con el pool del MOMENTO, así que un
// dato malo que dure media hora queda impreso.
//
// No todo saliente en el Anexo A es un error:
//   · reemplazo EN CURSO (el entrante aún no se entrega): el cliente todavía
//     tiene ese radio — se anota, no se bloquea;
//   · entregado y el saliente estaba con el CLIENTE: lo tiene hasta que lo
//     devuelva — se anota "pendiente de devolución";
//   · entregado y el saliente ya estaba EN CASA (`saliente_en_casa`): el
//     cliente nunca lo tuvo después del cambio. Que figure es un dato roto —
//     se BLOQUEA la impresión hasta que bodega lo corrija.
//
// Las gestiones anuladas no cuentan: ahí el cambio no pasó.
(function () {
  const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

  // → Map serialNorm → { gid, entrante, estado: 'en_curso'|'por_devolver'|'incoherente' }
  function clasificar(gestiones) {
    const out = new Map();
    for (const g of (gestiones || [])) {
      if (!g || g.tipo !== 'reemplazo' || g.deleted === true || g.estado === 'anulada') continue;
      const entregada = g.cierre?.entrega === true || g.estado === 'cerrada';
      for (const it of (g.items || [])) {
        const s = norm(it.serial_saliente);
        if (!s) continue;
        const estado = !entregada ? 'en_curso' : it.saliente_en_casa ? 'incoherente' : 'por_devolver';
        out.set(s, { gid: g.id || g.gestion_id || '', entrante: String(it.serial_nuevo || '').trim(), estado });
      }
    }
    return out;
  }

  function nota(info) {
    if (!info) return '';
    const por = info.entrante ? `sustituido por ${info.entrante}` : 'en reemplazo';
    if (info.estado === 'en_curso') return `Reemplazo ${info.gid} en curso (${por})`;
    if (info.estado === 'por_devolver') return `${por[0].toUpperCase()}${por.slice(1)} (${info.gid}) — pendiente de devolución`;
    return `${por[0].toUpperCase()}${por.slice(1)} (${info.gid}) — ya estaba en CECOMUNICA: no debe figurar aquí`;
  }

  const API = { norm, clasificar, nota };
  if (typeof window !== 'undefined') window.AnexoSustituidos = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();

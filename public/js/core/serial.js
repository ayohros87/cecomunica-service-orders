// Identidad de un número de serie — UNA definición para el navegador
// (2026-09-08, F3 de "Bandejas y pickers"). Antes la misma regla vivía en
// equiposPoolService.normalizarSerial y en cinco copias "por si la página no
// cargó el servicio" (asignador, contratosService, ordenes-render,
// ordenes-equipos, almacen-asignar), y una sexta divergía (minúsculas).
//
// Espejo de functions/src/domain/equiposPool.js (normSerial / esSerialValido);
// functions/test/poolNormalizacion.test.js exige que sigan idénticas.
//
// Script SÍNCRONO y sin dependencias: va antes de cualquier servicio o página
// que hable de seriales.
window.Serial = (() => {
  // "PD-606 " → "PD606": mayúsculas, solo [A-Z0-9]. Es el `serial_norm` del
  // pool y el doc-ID de equipos_pool.
  function norm(raw) {
    return (raw ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  // 3–30 alfanuméricos Y al menos un dígito (mata "CONSOLA", "GPS", "DEMO").
  function valido(n) {
    const s = norm(n);
    return /^[A-Z0-9]{3,30}$/.test(s) && /\d/.test(s);
  }
  // Clave de identidad para mapas/sets: la norm, o `raw:` para los seriales
  // patológicos que normalizan a vacío (no deben colisionar entre sí).
  function clave(raw) {
    const s = String(raw ?? '').trim();
    const n = norm(s);
    return n || (s ? `raw:${s.toLowerCase()}` : '');
  }
  return { norm, valido, clave };
})();
// En el navegador window === globalThis. En un vm de tests, `window` es una
// propiedad del sandbox: dejar también el global para que los servicios que
// llaman `Serial.norm` a secas lo encuentren.
if (typeof globalThis !== 'undefined' && !globalThis.Serial) globalThis.Serial = window.Serial;

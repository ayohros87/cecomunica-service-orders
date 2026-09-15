// Cambio de serial — las preguntas que se contestan mirando el expediente,
// sin tocar Firestore: ¿qué ítems cambian algo? ¿ya está listo para aplicarse?
//
// Va aparte de lib/cambioSerial.js (que aplica la corrección) por la misma
// razón que domain/gestionSeriales.js: lib/ arrastra lib/admin y su
// initializeApp, y estas dos respuestas tienen que poder probarse a secas.
// Puras: test/cambioSerial.test.js.
"use strict";

// normSerial va COPIADO, no importado, por lo mismo: equiposPool.js arrastra
// lib/admin. Si cambia la identidad del serial allá, cámbiala aquí — el test
// lo cubre.
const normSerial = (raw) => (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Los ítems que de verdad corrigen algo: con serial viejo, con serial real
// declarado, y que no sean el mismo de siempre. Un ítem donde alguien escribió
// el mismo serial con guiones no es una corrección — es ruido.
function itemsAplicables(g) {
  return (g?.items || []).filter((it) => {
    const viejo = normSerial(it?.serial);
    const nuevo = normSerial(it?.serial_nuevo);
    return viejo && nuevo && viejo !== nuevo;
  });
}

// ¿Bodega ya declaró el serial correcto de TODOS los ítems? Es la condición
// de `cierre.asignacion` — el equivalente de "bodega asignó" en el reemplazo.
// Se exige COMPLETO a propósito: aplicar media corrección deja el contrato
// diciendo una cosa de un radio y otra del de al lado.
function asignacionCompleta(g) {
  const items = g?.items || [];
  return items.length > 0 && items.every((it) => String(it?.serial_nuevo || "").trim());
}

module.exports = { itemsAplicables, asignacionCompleta, normSerial };

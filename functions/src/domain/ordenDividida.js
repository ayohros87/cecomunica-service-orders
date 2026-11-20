// Órdenes DIVIDIDAS (madre + hermanas) — lado servidor, sin Firestore.
//
// "Dividir orden" (ordenes-dividir.js / OrdenesService.dividirOrden) reparte
// los equipos de una orden en órdenes hermanas que heredan cliente, contrato
// y gestión. La madre guarda `dividida_en: [ids]` y cada hija `dividida_de`.
// Una hija puede volver a dividirse, así que la familia es un árbol.
//
// Para una ENTRADA eso no cambia nada aguas abajo: cada una cierra sola. Para
// una PROGRAMACIÓN (Brenda, 2026-10-13: separar por modelo o por lo que pida
// el cliente) sí importa, porque la ENTREGA de una programación dispara
// efectos de TODO el contrato o de TODA la gestión: `entrega_confirmada` en
// el contrato (→ aviso "contrato entregado" a facturación), la devolución de
// los salientes de un reemplazo, la vigencia del tramo de un aumento. Si eso
// corriera con la primera hermana, facturación cobraría radios que siguen en
// el taller. Decisión (Alberto, 2026-10-13): esos efectos esperan a que se
// entregue la ÚLTIMA hermana viva.
//
// Consumidores: triggers/ordenes/onOrdenEntregada.js (contrato) y
// triggers/gestiones/onOrdenWriteGestion.js (gestión). La lectura de la
// familia vive en lib/ordenDividida.js.

const ENTREGADO = "ENTREGADO AL CLIENTE";

// Una hermana en cualquiera de estos estados ya no va a entregar nada: no
// detiene a las demás. ANULADA y CERRADA (SIN RETIRAR) incluidas a propósito:
// si una mitad se anuló, la otra mitad entregada es la entrega completa de
// lo que quedó vivo.
const TERMINALES = new Set([
  ENTREGADO, "ANULADA", "CERRADA (SIN RETIRAR)", "CERRADA (A BODEGA)", "CERRADA (ENTRADA)",
  "CERRADA (VISITA)", "CERRADA (DEVOLUCION)",
]);

const norm = (s) => String(s || "").trim().toUpperCase();

/** ¿La orden forma parte de una familia dividida? (cero lecturas) */
function estaDividida(o) {
  if (!o) return false;
  return !!(o.dividida_de || (Array.isArray(o.dividida_en) && o.dividida_en.length));
}

/**
 * Hermanas que todavía pueden entregar algo, EXCLUYENDO a `ordenId`.
 * @param {Array<{id:string, data:Object|null}>} familia  madre + descendientes
 * @param {string} ordenId  la que se está entregando ahora
 * @returns {string[]} ids pendientes
 */
function hermanasPendientes(familia, ordenId) {
  return (familia || [])
    .filter((f) => f && f.id !== ordenId && f.data && f.data.eliminado !== true)
    .filter((f) => !TERMINALES.has(norm(f.data.estado_reparacion)))
    .map((f) => f.id);
}

module.exports = { TERMINALES, estaDividida, hermanasPendientes };

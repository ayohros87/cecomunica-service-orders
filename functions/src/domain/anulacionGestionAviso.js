// Aviso de la ANULACIÓN de una gestión (2026-10-09, caso FORTALEZA).
//
// Anular una gestión no le avisaba a nadie: limpiarAnulacion revertía lo que
// colgaba del expediente y lo dejaba en la bitácora, pero recepción y bodega
// no se enteraban. El contrato sí tenía su correo (onContratoAnuladoNotify).
//
// Y lo que NO cuelga de la gestión ni siquiera se revertía: FORTALEZA anuló el
// aumento GA20260925-01 de 5 PNC360S-R, pero esos radios habían salido por una
// VENTA DIRECTA (vendido, factura 10848) con una OS de programación sin
// contrato. La gestión no tenía seriales, así que no había nada que soltar, y
// el POC siguió mostrando 15 radios en vez de 10. El sistema no puede saber si
// esa venta era la de esta gestión (puede ser otra compra legítima del mismo
// cliente): por eso NO la anula sola, la SEÑALA en el correo.
//
// Puro: el trigger lee el pool y las órdenes y le pasa los docs.

const { estaViva } = require("./ordenesAnulacion");

// Radios VENDIDOS al cliente que todavía no salieron: siguen colgando de una
// orden viva (la programación que los iba a entregar). Los vendidos ya
// entregados son del cliente y no tienen nada que ver con la anulación.
//   unidades: [{ id, estado, modelo_label, orden_actual_id, venta:{cliente_id,factura} }]
//   ordenes:  { [ordenId]: docOrden }
function ventasSinEntregar(unidades, ordenes, clienteId) {
  if (!clienteId) return [];
  return (unidades || [])
    .filter(u => u && u.estado === "vendido" && u.venta?.cliente_id === clienteId)
    .filter(u => {
      const o = u.orden_actual_id ? ordenes?.[u.orden_actual_id] : null;
      return !!o && estaViva(o);
    })
    .map(u => ({
      serial: u.id,
      modelo: u.modelo_label || "",
      factura: u.venta?.factura || "",
      orden: u.orden_actual_id,
    }));
}

// Una propuesta del taller rechazada ya tiene su correo propio (al técnico):
// no se manda este encima.
function debeAvisar(g) {
  if (!g || g.estado !== "anulada") return false;
  if (g.origen?.tipo === "taller") return false;
  return true;
}

module.exports = { ventasSinEntregar, debeAvisar };

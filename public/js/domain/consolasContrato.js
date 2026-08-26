// Consolas de despacho: dónde viven en el contrato y cómo se reconocen en POC.
// Fuente ÚNICA del criterio — lo usan el batch de equipos PoC (nuevo-batch.js,
// para avisar que las consolas no entran al lote) y el alta de consolas
// (poc-nueva-consola.js, para contar cuántas faltan). Si el criterio cambia,
// cambia solo aquí. Mismo patrón que js/domain/origenContrato.js.
//
// POR QUÉ (recepción, 26-ago-2026 — P.H. PLAZA DEL ESTE, ALQ20260825-01):
// "el cliente tiene contempladas 2 consolas además de los 18 radios; al cargar
// el archivo JSON el batch únicamente reconoce los 18". Correcto, y no es un
// bug del batch: una consola no es un radio.
//
//   · En el contrato va en `cargos` (concepto "Consola", cantidad 2), no en
//     `equipos` — por eso no tiene fila en contratos/{id}/seriales ni aparece
//     en el archivo del vendedor, y "Jalar seriales" no la va a traer nunca.
//   · En poc_devices no tiene serial: se usa el texto "CONSOLA" como cajón de
//     sastre (misma convención que las ~55 consolas ya cargadas), unit_id de
//     TEXTO (ANATI1, FEMSA1, MACHETAZO C4 → unit_id_num null) y sin modelo.
//     El modelo NO se le pone a propósito: la consola Site One se rompió en
//     jun-2026 justo después de que se le asignara uno.
window.ConsolasContrato = {
  // El serial-cajón-de-sastre con el que se guardan. No hay bandera propia:
  // las consolas históricas solo se reconocen así, y agregar un campo nuevo
  // dejaría a la mitad de la colección sin él.
  SERIAL: "CONSOLA",

  esConsola(device) {
    return String(device?.serial ?? "").trim().toUpperCase() === this.SERIAL;
  },

  // Cuántas consolas contempla el contrato, leyendo sus CARGOS. Un cargo de
  // consola sin cantidad cuenta como una.
  contratadas(contrato) {
    return (contrato?.cargos || []).reduce((n, c) => {
      if (!/consola/i.test(String(c?.concepto ?? ""))) return n;
      const cant = Number(c?.cantidad);
      return n + (Number.isFinite(cant) && cant > 0 ? cant : 1);
    }, 0);
  },

  // Consolas ya creadas: del contrato si se pasa `contratoDocId`, del cliente
  // entero si no. Las borradas no cuentan.
  creadas(devices, contratoDocId = null) {
    return (devices || []).filter(d => d.deleted !== true && this.esConsola(d)
      && (!contratoDocId || d.contrato_doc_id === contratoDocId)).length;
  },
};

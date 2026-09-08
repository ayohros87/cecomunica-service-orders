// Regularización de cuentas — marcadores "hay que recalcular".
// (docs/plans/PLAN_REGULARIZACION_CUENTAS.md §3). No calculan nada: escriben
// `clientes/{id}.regularizacion_dirty_at` y el barrido de cada 10 minutos
// (regularizacionMarcadas) hace el trabajo. Así una asignación masiva de 120
// seriales cuesta 120 marcas baratas y UN recálculo, no 120.
//
// Solo se marca cuando cambia algo que entra en la regla D1–D7:
//   · pool: estado, asignacion.cliente_id / contrato_doc_id, pendiente_devolucion,
//     ultima_asignacion.cliente_id (por_clasificar)
//   · contratos: estado, seriales_estado, reemplaza_seriales, regularizacion,
//     origen_tipo, deleted, cuenta_regularizacion (estampa → cuenta puntuales)
//   · gestiones: estado, deleted, aumento.contrato_papel / contrato_doc_id,
//     cuenta_regularizacion
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const RC = require("../../domain/regularizacionCuentas");

const j = (v) => JSON.stringify(v === undefined ? null : v);
const cambio = (a, b, campos) => campos.some(f => j(f(a)) !== j(f(b)));
const datos = (snap) => (snap && snap.exists ? snap.data() : null) || {};

const onPoolMarcaRegularizacion = onDocumentWritten(
  { document: "equipos_pool/{id}", region: "us-central1" },
  async (event) => {
    const a = datos(event.data?.before), b = datos(event.data?.after);
    if (!cambio(a, b, [x => x.estado, x => x.asignacion?.cliente_id, x => x.asignacion?.contrato_doc_id,
      x => !!x.pendiente_devolucion, x => x.ultima_asignacion?.cliente_id])) return null;
    const ids = new Set([a.asignacion?.cliente_id, b.asignacion?.cliente_id, a.ultima_asignacion?.cliente_id, b.ultima_asignacion?.cliente_id].filter(Boolean));
    for (const id of ids) await RC.marcar(id, "pool");
    return null;
  }
);

const onContratoMarcaRegularizacion = onDocumentWritten(
  { document: "contratos/{id}", region: "us-central1" },
  async (event) => {
    const a = datos(event.data?.before), b = datos(event.data?.after);
    if (!cambio(a, b, [x => x.estado, x => x.seriales_estado, x => x.reemplaza_seriales, x => x.regularizacion?.sobrantes,
      x => x.origen_tipo, x => x.origen_legacy_ref, x => !!x.deleted, x => x.cuenta_regularizacion?.at, x => x.cliente_id])) return null;
    for (const id of new Set([a.cliente_id, b.cliente_id].filter(Boolean))) await RC.marcar(id, "contrato");
    return null;
  }
);

const onGestionMarcaRegularizacion = onDocumentWritten(
  { document: "gestiones/{id}", region: "us-central1" },
  async (event) => {
    const a = datos(event.data?.before), b = datos(event.data?.after);
    if (!cambio(a, b, [x => x.estado, x => !!x.deleted, x => x.aumento?.contrato_papel, x => x.aumento?.contrato_doc_id,
      x => x.cuenta_regularizacion?.at, x => x.cliente_id])) return null;
    for (const id of new Set([a.cliente_id, b.cliente_id].filter(Boolean))) await RC.marcar(id, "gestion");
    return null;
  }
);

module.exports = { onPoolMarcaRegularizacion, onContratoMarcaRegularizacion, onGestionMarcaRegularizacion };

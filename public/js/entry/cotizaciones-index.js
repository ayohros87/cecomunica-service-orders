// Entry de cotizaciones/index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import { dbModular } from '/js/firebase-init.js';
import {
  collection, query, where, getAggregateFromServer, count, sum,
} from 'firebase/firestore';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/ui/modal.js';
import '/js/services/cotizacionesService.js';
import '/js/services/clientesService.js';
import '/js/services/modelosService.js';
import '/js/services/usuariosService.js';
import '/js/services/empresaService.js';
import '/js/services/mailService.js';
import '/js/domain/cotizacionesTotales.js';
import '/js/domain/cotizacionTaller.js';
import '/js/ui/entity-combo.js';
import '/js/pages/cot-editor-state.js';
// Modal de aprobación compartido lista/detalle (auditoría UX 2026-09-28, #11).
import '/js/pages/cot-aprobacion.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/pages/cotizaciones-index.js';

// KPIs de la lista con agregados del servidor (auditoría UX 2026-09-28 §4.5
// #12): count() y sum('total') sobre TODAS las cotizaciones del alcance, no
// sobre las 30 cargadas. El compat no trae agregados; este puente modular es
// lo mínimo para que cotizaciones-index.js (script clásico) los use.
// wheres = [[campo, op, valor], ...] — solo igualdad/in: los índices de un
// campo se combinan solos y no hace falta un compuesto por combinación.
window.CotAgg = {
  async contar(wheres, { conMonto = false } = {}) {
    const q = query(collection(dbModular, 'cotizaciones'), ...(wheres || []).map(([f, op, v]) => where(f, op, v)));
    const spec = conMonto ? { n: count(), monto: sum('total') } : { n: count() };
    const d = (await getAggregateFromServer(q, spec)).data();
    return { n: Number(d.n || 0), monto: Number(d.monto || 0) };
  },
};

// Entry de admin/kpi-reporte-print.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
// Los errores del PDF se avisan con Modal.alert; sin este import fallaban en
// silencio (auditoría UX 2026-09-28).
import '/js/ui/modal.js';
import '/js/services/kpiReportsService.js';
import '/js/domain/kpiDerived.js';
import '/js/pages/admin-kpi-reporte-print.js';

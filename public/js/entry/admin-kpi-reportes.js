// Entry de admin/kpi-reportes.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/core/xlsx-loader.js';
import '/js/firebase-init.js';
import '/js/ui/toast.js';
import '/js/ui/modal.js';
import '/js/services/kpiReportsService.js';
import '/js/domain/kpiDerived.js';
import '/js/domain/kpiImport.js';
import '/js/pages/admin-kpi-reportes.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';

// Entry de admin/financiero.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/core/xlsx-loader.js';
import '/js/firebase-init.js';
import '/js/ui/toast.js';
import '/js/services/contratosService.js';
import '/js/services/cotizacionesService.js';
import '/js/domain/cotizacionesTotales.js';
import '/js/pages/admin-financiero.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';

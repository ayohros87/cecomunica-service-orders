// Entry de POC/nueva-consola.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/pocService.js';
import '/js/services/clientesService.js';
import '/js/services/empresaService.js';
import '/js/services/contratosService.js';
import '/js/domain/consolasContrato.js';
import '/js/ui/toast.js';
import '/js/ui/modal.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/ui/entity-combo.js'; // núcleo común de los pickers (P2 auditoría UX 2026-09-28)
import '/js/ui/filtered-select.js';
import '/js/pages/poc-nueva-consola.js';

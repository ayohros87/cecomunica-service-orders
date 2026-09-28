// Entry de ordenes/nueva-orden.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/contratosService.js';
import '/js/services/mailService.js';
import '/js/services/clientesService.js';
import '/js/services/usuariosService.js';
import '/js/services/empresaService.js';
import '/js/services/ordenesService.js';
import '/js/services/equiposPoolService.js';
import '/js/domain/equipoNormalize.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/ui/modal.js';
import '/js/domain/docIdentidad.js';
import '/js/domain/rucPanama.js';
import '/js/ui/rucInput.js';
import '/js/ui/formKit.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/ui/entity-combo.js'; // núcleo común de los pickers (P2 auditoría UX 2026-09-28)
import '/js/ui/filtered-select.js';
import '/js/pages/nueva-orden.js';

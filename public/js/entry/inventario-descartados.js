// Entry de inventario/descartados.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/ui/modal.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/services/equiposPoolService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/ui/equipo-ficha.js';
import '/js/pages/inventario-descartados.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';

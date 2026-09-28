// Entry de POC/index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/pocService.js';
import '/js/services/usuariosService.js';
import '/js/services/modelosService.js';
import '/js/services/clientesService.js';
import '/js/services/empresaService.js';
import '/js/services/simCardsService.js';
import '/js/core/xlsx-loader.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js'; // withBusy de la edición masiva (auditoría UX 2026-09-28)
import '/js/ui/modal.js';
import '/js/services/equiposPoolService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/services/equiposCondicionesService.js';
import '/js/ui/equipo-ficha.js';
import '/js/ui/serial-field.js';
import '/js/pages/poc-state.js';
import '/js/pages/poc-sim-liberar.js';
import '/js/pages/poc-edit.js';
import '/js/pages/poc-bulk.js';
import '/js/pages/poc-sim.js';
import '/js/pages/poc-sim-pool.js';
import '/js/pages/poc-list.js';
import '/js/pages/poc-index.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';

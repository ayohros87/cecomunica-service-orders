// Entry de clientes/ficha.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/firebase-aggregates.js';
import '/js/services/usuariosService.js';
import '/js/services/clientesService.js';
import '/js/services/clienteDocumentosService.js';
import '/js/services/empresaService.js';
import '/js/ui/modal.js';
import '/js/domain/docIdentidad.js';
import '/js/domain/rucPanama.js';
import '/js/ui/rucInput.js';
import '/js/ui/formKit.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/ui/toast.js';
import '/js/pages/clientes-ficha.js';

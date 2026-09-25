// Entry de ordenes/imprimir-orden.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/clientesService.js';
import '/js/services/ordenesService.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/pages/imprimir-orden.js';

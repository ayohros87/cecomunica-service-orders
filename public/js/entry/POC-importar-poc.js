// Entry de POC/importar-poc.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/core/xlsx-loader.js';
import '/js/firebase-init.js';
import '/js/services/pocService.js';
import '/js/services/simCardsService.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';

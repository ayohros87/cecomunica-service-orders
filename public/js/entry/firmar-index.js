// Entry de firmar/index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/domain/docIdentidad.js';
import '/js/domain/firmante.js';
import '/js/domain/contratoV2Texto.js';
import '/js/ui/firmaPad.js'; // lienzo de firma del kit (P2 auditoría UX 2026-09-28)

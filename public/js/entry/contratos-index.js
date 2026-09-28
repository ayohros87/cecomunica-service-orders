// Entry de contratos/index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/contratosService.js';
import '/js/domain/documentoContrato.js';
// Columna "Tipo" = composición (Alquiler / Propio / Mixto) y su filtro (2026-09-28).
import '/js/domain/contratoComposicion.js';
import '/js/services/usuariosService.js';
import '/js/services/ordenesService.js';
import '/js/services/equiposPoolService.js';
import '/js/ui/equipo-ficha.js';
import '/js/domain/totales.js';
import '/js/ui/toast.js';
import '/js/ui/modal.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/domain/devolucionContrato.js';
import '/js/pages/contratos-state.js';
import '/js/pages/contratos-equipos.js';
import '/js/services/gestionesService.js';
import '/js/pages/archivo-expediente.js';
import '/js/pages/archivo-gestiones.js';
import '/js/pages/contratos-list.js';
import '/js/pages/contratos-index.js';

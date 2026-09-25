// Entry de contratos/documento.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/contratosService.js';
import '/js/domain/documentoContrato.js';
import '/js/services/usuariosService.js';
import '/js/domain/modeloFamilia.js';
import '/js/services/equiposPoolService.js';
import '/js/services/modelosService.js';
import '/js/domain/docIdentidad.js';
import '/js/domain/contratoV2Texto.js';
import '/js/domain/contratoFirma.js';
import '/js/ui/toast.js';
import '/js/pages/contrato-documento.js';

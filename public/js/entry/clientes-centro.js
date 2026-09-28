// Entry de clientes/centro.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/firebase-aggregates.js';
import '/js/services/aprobacionesService.js';
import '/js/pages/centro-aprobaciones.js';
import '/js/services/usuariosService.js';
import '/js/services/clientesService.js';
import '/js/services/clienteDocumentosService.js';
import '/js/services/contratosService.js';
import '/js/domain/modeloFamilia.js';
import '/js/services/equiposPoolService.js';
import '/js/services/modelosService.js';
import '/js/domain/contratoV2Texto.js';
import '/js/services/cargosService.js';
import '/js/services/gestionesService.js';
import '/js/services/mailService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/services/equiposCondicionesService.js';
import '/js/ui/serial-field.js';
import '/js/domain/totales.js';
import '/js/domain/contratoTarifario.js';
import '/js/domain/origenContrato.js';
import '/js/domain/docIdentidad.js';
import '/js/domain/firmante.js';
import '/js/domain/repValidacion.js';
import '/js/domain/transicionPlan.js';
import '/js/domain/contratoAnulacion.js';
import '/js/domain/contratoCierre.js';
import '/js/domain/contratoEdicion.js';
import '/js/domain/regularizacion.js';
import '/js/domain/gestionAutorizacion.js';
import '/js/domain/contratoFirma.js';
// "Documento completo" abre el papel correcto (v2 o clásico) — auditoría UX 2026-09-28.
import '/js/domain/documentoContrato.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/ui/modal.js';
import '/js/pages/contratos-upload.js';
import '/js/domain/garantiaEquipo.js';
import '/js/services/pocService.js';
import '/js/pages/clientes-centro.js';

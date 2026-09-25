// Entry de login.html (F3, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Antes: 3 <script> síncronos de gstatic + firebase-init + lucide. Ahora el SDK
// viene de npm vía firebase-init; el bloque inline de login.html es un módulo
// que corre después de este entry (orden de documento).
import '/js/firebase-init.js';
import '/js/vendor/lucide.min.js';

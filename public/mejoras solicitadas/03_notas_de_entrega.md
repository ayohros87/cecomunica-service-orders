# SCRIPT IA — Sección: Notas de Entrega

> **Instrucción para la IA:** Trabajas en la generación de la **Nota de Entrega** del sistema CECOMUNICA (documento/PDF derivado de la Orden de Servicio). Implementa A1. Localiza: plantilla/render de la Nota de Entrega y el origen de datos de la OS (campo observaciones / contrato).

---

## A1 — Incluir el campo "Contrato / Observaciones" en la Nota de Entrega

**Solicitud (reclamada el 26 y nuevamente el 30 de junio — sigue pendiente):**
Que en las **Notas de Entrega** se incluya el campo **"Contrato / Observaciones"** que se captura en la Orden de Servicio. Hoy lo que se escribe en observaciones de la OS **no aparece** en la Nota de Entrega.

**Caso de uso:** En renovaciones (ej. Compañía Goly), en la OS se especifica la **sucursal** a la que pertenecen los radios, pero esa observación no se ve en la Nota de Entrega. Incluir el campo permite identificar fácilmente sucursal y contrato, verificar entregas y evitar confusiones.

**Requerimientos:**
1. Agregar a la plantilla de la Nota de Entrega una sección/campo **"Contrato / Observaciones"** que tome el valor de las observaciones (y número de contrato) de la OS asociada.
2. Mostrarlo tanto en **pantalla** como en el **PDF/impresión** de la nota.
3. Si el campo está vacío, manejar el espacio con elegancia (ocultar la fila o mostrar "—" según el diseño actual).
4. Respetar el formato/estilo visual existente de la Nota de Entrega.
5. Verificar con una OS que tenga observaciones (ej. una renovación con sucursal) que el dato aparece correctamente.

**Criterios de aceptación:**
- Una OS con observación de sucursal/contrato genera una Nota de Entrega donde ese texto es visible e imprimible.
- El formato de la nota no se rompe cuando el campo está vacío.

> **Dependencia con B1:** este campo proviene de las observaciones de la OS; conviene resolver primero que las observaciones se **guarden** correctamente (ver `01_ordenes_de_servicio.md`, tarea B1).

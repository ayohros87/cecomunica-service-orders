# CECOMUNICA — Órdenes de Servicio / POC / Cotizaciones
## Resumen de mejoras solicitadas y guía de los scripts para IA

**Fecha:** 30 de junio de 2026
**Fuente:** Correos en la bandeja de Alberto Yohros (hilos "Inconsistencias detectadas tras actualización del sistema", "Nueva función: Cotizar directamente desde una orden de servicio", "PARA REVISION Entrega de Ordenes de Servicio", "Solicitud de mejora ... contratos de Reemplazos y Renovaciones").
**Solicitantes:** Brenda Martínez (Atención al Cliente), Solangel Ho Sang (Jefe de Taller / Analista de Producto), Zuleika Díaz (Gerente Administrativa).

---

## Cómo usar estos archivos

Cada archivo `0X_*.md` es un **prompt / especificación lista para entregar a un asistente de IA de programación** (Claude Code, Cursor, Copilot, etc.). Están escritos para que la IA implemente cada punto con contexto, requisitos funcionales y criterios de aceptación.

Orden sugerido de prioridad (de más rápido / mayor impacto a más grande):

1. `01_ordenes_de_servicio.md` — bugs y ajustes rápidos (editar OS, reasignar técnico, bug del modal "Ver").
2. `02_base_datos_poc_batch.md` — contadores, autoselección de servidor, carga de JSON.
3. `03_notas_de_entrega.md` — campo Contrato/Observaciones (pendiente, ya reclamado 2 veces).
4. `04_cotizacion_desde_os.md` — mejoras y bug del módulo de cotización.
5. `05_contratos_reemplazos_renovaciones.md` — proyecto grande (proceso completo, 2 fases).

---

## Índice de puntos solicitados

### A. Notas de Entrega
- **A1.** Incluir el campo **"Contrato / Observaciones"** en las Notas de Entrega (lo capturado en observaciones de la OS debe verse en la nota). *Pendiente — reclamado el 26 y el 30 de junio.*

### B. Órdenes de Servicio (OS)
- **B1.** Permitir **editar una OS ya creada y que los cambios SE GUARDEN** (hoy permite editar pero no guarda).
- **B2.** Al crear OS y elegir cliente, opción **"POC / Base de Datos POC"** que liste todos los seriales y modelos del cliente para **copiar en masa** (como al copiar seriales hacia el Batch).
- **B3.** **Reasignar / cambiar el técnico** de una OS (cuando un técnico toma por error la orden de otro). *Alberto indicó que ya se implementó en órdenes asignadas no entregadas — verificar.*
- **B4.** **Bug:** al oprimir **"Ver"** una OS, queda detrás la pantalla con la lista de todas las órdenes (problema de modal/navegación). *Alberto dijo "ya se debió resolver" — verificar.*
- **B5.** **Eliminar/modificar fotografía** en la sección de intervención técnica antes de enviar. *Parece resuelto ("logramos ver el apartado de eliminar") — confirmar.*

### C. Base de Datos POC (Batch)
- **C1.** Al seleccionar cliente, **jalar automáticamente el servidor** que le corresponde (evitar asignaciones erradas).
- **C2.** Volver a mostrar la **cantidad de radios** en la parte superior + dos indicadores: **total del cliente** (activos+inactivos) y **cantidad seleccionada** en el momento.
- **C3.** **Bug:** no permite **cargar archivo JSON** en el Batch (el drag/drop o selección no funciona).

### D. Cotizar desde Orden de Servicio (módulo nuevo)
- **D1.** Botón **"Vista previa"** antes de enviar (sin compartir automáticamente con otros departamentos/clientes).
- **D2.** Botón que despliegue los **accesorios disponibles del equipo de taller**, con **arrastrar y soltar** a la cotización.
- **D3.** Mostrar la **intervención del técnico** dentro de la cotización (serie, modelo, accesorios cambiados/reparados, comentario técnico) para la firma del cliente.
- **D4.** **Permisos:** los técnicos de taller no ven/seleccionan el nuevo método de cotización — habilitar acceso.
- **D5.** **Bug:** error al usar la cotización de taller (reportado por el técnico Marcos; adjunto `Error_cotizacion_taller.jpeg`).

### E. Contratos de Reemplazos y Renovaciones (proyecto completo)
- **E1.** Creación del contrato de reemplazo por el vendedor (seriales a reemplazar obligatorios, motivo) → aprobado pasa a Activaciones.
- **E2.** Asignación de seriales por **Bodega** (botón, mapa de modelos, copiar/pegar múltiples, email a activaciones+vendedor, seriales reservados y vinculados al contrato).
- **E3.** **Recepción** abre la OS asociada al contrato (manejo de seriales dañados/erróneos).
- **E4.** **Módulo POC** con opción de reemplazo/renovación: trae programación del serial anterior (serie, id, sim cards, línea, nombre, grupos), estado del equipo, y crea la relación serial actual↔reemplazo (mapeo) en el historial.
- **E5.** **Propuesta automática de mapeo** en renovaciones (por modelo), revisable/ajustable por el usuario.
- **E6.** **Vinculación obligatoria OS↔contrato** + regla de cierre (no cerrar sin info esencial ni contrato).
- **E7.** **Notificaciones automáticas** a las áreas responsables en cada momento clave.
- **E8.** **Control de devolución de equipos** (estado "Pendiente de devolución", comparar esperado vs recibido, devoluciones parciales no cierran).
- **E9.** *(2ª fase)* **Reporte de equipos pendientes de devolución.**

### F. Estabilidad / Infraestructura
- **F1.** Intermitencias: Órdenes de Servicio y Base POC no cargan ("página pensando"), atribuido a intermitencia de la base de datos. Recurrente.

---

## ⚠️ Acceso al proyecto (importante)

Para generar **código real** (parches/PRs concretos) necesito acceso al **código fuente del proyecto** "cecomunica órdenes de servicio". Hoy **no tengo ese acceso**. Indícame cómo está alojado para poder avanzar:

- ¿Está en **GitHub/GitLab**? → puedo pedir que se agregue el repositorio a esta sesión.
- ¿Está en una **carpeta local** de tu computadora? → puedo solicitar acceso a esa carpeta.
- ¿Qué **stack** usa? (lenguaje/framework del backend, framework del frontend, base de datos). Sin esto, los scripts adjuntos son **especificaciones agnósticas de tecnología**: describen exactamente qué construir, pero no traen el código final ajustado a tu base.

Mientras tanto, los archivos `01`–`05` ya sirven para que cualquier IA de programación con acceso al repo implemente cada punto.

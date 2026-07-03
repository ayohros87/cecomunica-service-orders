# SCRIPT IA — Sección: Cotizar desde una Orden de Servicio

> **Instrucción para la IA:** Trabajas en el módulo nuevo "Cotizar desde Orden de Servicio" del sistema CECOMUNICA. Ya existe: desde una OS → acciones (⋯) → "Cotizar"; genera un borrador COT-AAAA-NNNN con el formato del módulo de Cotizaciones, enlazado a la OS, y entra al flujo de aprobación/envío/PDF. Implementa D1–D5. Entrega backend, frontend y pruebas, sin romper el flujo de aprobación existente (el envío al cliente sigue requiriendo aprobación del administrador).

---

## D5 — Bug (PRIORITARIO): error al usar la cotización de taller

**Problema:** El técnico Marcos usó la nueva sección de cotización para taller y **surgió un error** (capturado en `Error_cotizacion_taller.jpeg`, correo de Solangel del 24/06).

**Requerimientos:**
1. Reproducir el flujo de cotización **con el rol de técnico de taller** (relacionado con D4: permisos).
2. Revisar el log del servidor para el stack trace del error mostrado en la imagen.
3. Corregir la causa raíz (probable: permisos faltantes, dato nulo de cliente/intervención, o catálogo de piezas no accesible para el rol).
4. Agregar manejo de error amigable en lugar de pantalla de error cruda.

**Criterios de aceptación:**
- Un técnico de taller puede generar la cotización sin error.

> **Acción:** revisar el adjunto `Error_cotizacion_taller.jpeg` del correo para el texto exacto del error.

---

## D4 — Permisos: técnicos de taller no ven/seleccionan el método de cotización

**Solicitud:** Actualmente los técnicos de taller **no pueden visualizar ni seleccionar** el nuevo método de cotización. Revisar/habilitar el acceso según corresponda. (Solangel también notó que no tenía permisos completos para ver todo el menú de "acciones".)

**Requerimientos:**
1. Revisar la matriz de roles del menú de acciones de la OS y del módulo de cotización.
2. Habilitar la acción "Cotizar" y el menú de acciones para el rol **técnico de taller** (y verificar jefe de taller).
3. Confirmar que el resto de permisos del rol no se amplíen de más (principio de menor privilegio).

**Criterios de aceptación:**
- El rol técnico de taller ve y usa "Cotizar" en las órdenes que le corresponden.

---

## D1 — Botón "Vista previa" antes de enviar

**Solicitud:** Agregar un botón de **vista previa** que permita ver la cotización **antes de enviarla**, sin que se comparta automáticamente con otros departamentos o clientes.

**Requerimientos:**
1. Botón "Vista previa" que renderice la cotización (mismo formato del PDF final) en modo solo-lectura.
2. La vista previa **no** debe disparar notificaciones ni cambiar el estado (no notificar a ventas, no enviar al cliente).
3. Desde la vista previa, permitir volver a editar o continuar a "Generar cotización".

**Criterios de aceptación:**
- El usuario ve exactamente cómo quedará la cotización sin generar el borrador ni notificar a nadie.

---

## D2 — Botón de accesorios disponibles con arrastrar y soltar

**Solicitud:** Incluir un botón que despliegue todos los **accesorios disponibles en el equipo de taller**, para seleccionarlos fácil. Idealmente poder **arrastrarlos directamente a la cotización** sin reescribirlos.

**Requerimientos:**
1. Panel/desplegable con el catálogo de accesorios/piezas de taller (con búsqueda y precio desde inventario).
2. **Drag & drop** del accesorio a la lista de piezas del equipo correspondiente; alternativamente, botón "Agregar" como fallback accesible.
3. Al soltar, autocompletar nº de pieza/descripción/precio (cantidad por defecto 1, editable) reutilizando la lógica de "Agregar pieza".

**Criterios de aceptación:**
- El usuario arrastra un accesorio del panel a un equipo y queda agregado con su precio, sin teclear.

---

## D3 — Mostrar la intervención del técnico dentro de la cotización

**Solicitud:** Dentro del apartado de cotización, mostrar la **intervención registrada por el técnico**, de modo que al firmar el cliente se lea la info completa: **número de serie, modelo, listado de accesorios cambiados o reparados, y el comentario técnico** que justifica el cambio de piezas.

**Requerimientos:**
1. Por cada equipo en la cotización, mostrar su intervención: serie, modelo, accesorios cambiados/reparados, y comentario técnico.
2. Incluir esa información en la **vista previa, el PDF y la versión para firma** del cliente, de forma legible.
3. Mantener el formato del documento ordenado (intervención asociada visualmente a su equipo y a sus piezas).

**Criterios de aceptación:**
- El PDF/firma muestra, por equipo, la intervención del técnico junto con las piezas cotizadas.

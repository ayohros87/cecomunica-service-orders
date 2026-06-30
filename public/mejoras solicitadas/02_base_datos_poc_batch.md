# SCRIPT IA — Sección: Base de Datos POC / Batch

> **Instrucción para la IA:** Trabajas en el módulo "Base de Datos POC" y su herramienta "Batch" del sistema CECOMUNICA. Implementa C1–C3. Localiza: pantalla de listado de radios por cliente, creación de equipos por Batch (carga de archivo JSON), y la relación cliente→servidor. Entrega backend, frontend, migraciones si aplican y pruebas.

---

## C1 — Autoselección del servidor según el cliente

**Solicitud:** Al crear equipos en la Base POC (Batch), al seleccionar un cliente el sistema debe **jalar automáticamente el servidor** que le corresponde, para evitar discrepancias por asignar el servidor equivocado y reducir correcciones posteriores.

**Requerimientos:**
1. Asegurar/crear la relación **cliente → servidor por defecto** (campo en el cliente o tabla de mapeo).
2. En el formulario de creación por Batch, al elegir cliente **autocompletar el servidor** correspondiente.
3. Permitir override manual solo a roles autorizados (y advertir si se cambia).
4. Si un cliente no tiene servidor asignado, mostrar aviso claro.

**Criterios de aceptación:**
- Elegir cliente con servidor configurado fija el servidor correcto automáticamente.
- No se pueden crear equipos con servidor en blanco/erróneo sin advertencia.

---

## C2 — Contadores de radios visibles (total y seleccionados)

**Solicitud:** Volver a mostrar la **cantidad de radios en la parte superior** (como antes). Además, dos indicadores:
- **Total de radios del cliente** (activos e inactivos).
- **Cantidad de radios seleccionados** en ese momento.

Ejemplo del reporte: cliente FETRATEDA tiene 14 radios en total; si se seleccionan 13, hoy el sistema sigue mostrando el conteo global. Se necesita ver ambos en pantalla (hoy solo se ve al imprimir y con muchos radios demora).

**Requerimientos:**
1. Encabezado del listado POC del cliente con: **"Total: X (activos Y / inactivos Z)"** y **"Seleccionados: N"**.
2. El contador de seleccionados se actualiza en vivo al marcar/desmarcar (incluido "seleccionar todos" y filtros).
3. Mantener buen rendimiento con muchos radios (no recalcular de forma costosa en cada clic).

**Criterios de aceptación:**
- Con FETRATEDA: muestra Total 14 y, al marcar 13, "Seleccionados: 13" sin necesidad de imprimir.

---

## C3 — Bug: no permite cargar archivo JSON en el Batch

**Problema:** Al intentar cargar archivos JSON en el Batch para crear seriales, el sistema **no permite cargar el archivo**: no lo arrastra ni lo coloca en el cuadro de carga (drag & drop / selección no responde).

**Requerimientos / diagnóstico:**
1. Reproducir la carga por **drag & drop** y por **selección de archivo** (input file).
2. Corregir el componente de carga: eventos `dragover`/`drop` con `preventDefault`, `accept=".json,application/json"`, y manejo del `FileReader`/`FormData`.
3. Validar el JSON: estructura esperada, tamaño máximo, y **mensajes de error claros** si el formato es inválido.
4. Mostrar feedback de progreso y resultado (cuántos seriales se crearon, cuáles fallaron y por qué).
5. Probar en los navegadores que usa el equipo.

**Criterios de aceptación:**
- Se puede cargar un JSON válido por arrastre y por botón; los seriales se crean para el cliente correcto.
- Un JSON inválido produce un error entendible, no una caída silenciosa.

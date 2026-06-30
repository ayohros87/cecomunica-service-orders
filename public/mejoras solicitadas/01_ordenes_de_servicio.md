# SCRIPT IA — Sección: Órdenes de Servicio (OS)

> **Instrucción para la IA:** Eres un ingeniero de software trabajando en el sistema "CECOMUNICA — Órdenes de Servicio". Implementa cada tarea (B1–B5, F1) respetando la arquitectura existente. Antes de codificar, localiza los módulos: lista de órdenes, detalle/edición de OS, asignación de técnico, y la capa de notificaciones. Para cada tarea entrega: cambios de backend (endpoints/validaciones), cambios de frontend (UI/UX), migraciones de BD si aplican, y pruebas. No rompas flujos existentes.

---

## B1 — Editar una OS ya creada y que los cambios SE GUARDEN

**Problema reportado:** "el sistema permite realizar la modificación, pero los cambios no se guardan" (ej. corregir número de contrato en observaciones de la OS de Girag Panamá; correcto `20260418-01`).

**Requerimientos:**
1. Habilitar edición de una OS existente para roles autorizados (administración, recepción).
2. El endpoint de actualización (PUT/PATCH) debe **persistir** todos los campos editables, especialmente **observaciones** y **número de contrato**.
3. Validar y devolver error claro si falla la persistencia (no fallar en silencio).
4. Registrar en **auditoría/historial**: usuario, fecha/hora, valores anteriores y nuevos.
5. Definir qué campos son editables tras la creación y cuáles quedan bloqueados según el estado de la OS (p. ej. no editar una OS ya entregada/cerrada salvo rol admin).

**Criterios de aceptación:**
- Editar observaciones de una OS y recargar muestra el valor nuevo.
- Existe registro de auditoría del cambio.
- Mensaje de éxito/error visible al usuario.

**A investigar (causa raíz):** probable bug donde el formulario hace submit pero el backend ignora campos, o falta `commit`/transacción, o el front no envía el body completo.

---

## B2 — Opción "POC / Base de Datos POC" al crear una OS (copiar seriales en masa)

**Solicitud:** Al crear una OS y seleccionar al cliente, mostrar una opción "POC" o "Base de Datos POC" que liste **todos los seriales y modelos** registrados de ese cliente, para **copiarlos en masa** y crear las órdenes más rápido (igual que ya se hace al copiar seriales hacia el Batch).

**Requerimientos:**
1. En el formulario de creación de OS, tras elegir cliente, agregar acción/botón "Cargar desde POC".
2. Consultar la base POC del cliente y mostrar seriales + modelos (con búsqueda/filtrado y selección múltiple / "seleccionar todos").
3. Permitir **copiar seleccionados** e insertarlos en la OS (o copiar al portapapeles en el mismo formato que el Batch acepta).
4. Reutilizar el mecanismo existente de "copiar seriales" del Batch para mantener consistencia de formato.

**Criterios de aceptación:**
- Con un cliente con N radios en POC, el usuario puede traer todos o un subconjunto a la OS sin teclear seriales manualmente.

---

## B3 — Reasignar / cambiar el técnico de una OS

**Solicitud:** Poder cambiar el técnico asignado a una OS, porque a veces un técnico inicia/registra por error una orden asignada a otro y no hay forma sencilla de corregirlo.

> Nota: Alberto indicó que ya se implementó "cambiar técnico" en el menú de órdenes **asignadas (no entregadas)**. Esta tarea es **verificar y completar**.

**Requerimientos:**
1. En el menú de acciones de la OS, acción "Cambiar técnico" disponible para órdenes **asignadas y no entregadas** (y evaluar si debe permitirse en órdenes ya iniciadas).
2. Selector de técnicos válidos; al confirmar, reasignar y notificar (opcional) al técnico anterior y al nuevo.
3. Conservar el trabajo ya registrado por el técnico anterior (intervención, fotos) o definir regla de qué se mantiene.
4. Registrar el cambio en el historial de la OS.
5. Validar permisos (jefe de taller / administración).

**Criterios de aceptación:**
- Una OS tomada por error puede reasignarse al técnico correcto sin recrearla; el cambio queda en historial.

---

## B4 — Bug: al "Ver" una OS queda detrás la lista de todas las órdenes

**Problema:** Al oprimir "Ver" la orden de servicio, se muestra **atrás** la pantalla con la lista de todas las órdenes (referencia: notificación de la Orden 2026061908).

> Nota: Alberto dijo "ya se debió resolver". Esta tarea es **verificar y, si persiste, corregir**.

**Requerimientos:**
1. Reproducir entrando a "Ver" una OS desde el enlace de la notificación de nota de entrega.
2. Corregir el comportamiento: el detalle de la OS debe abrirse correctamente (modal o página) **sin** dejar la lista visible/encimada ni perder el contexto (z-index, ruteo, o overlay que no cierra).
3. Verificar en escritorio y móvil.

**Criterios de aceptación:**
- "Ver" abre el detalle correcto de la OS; al cerrar regresa limpio a la lista.

---

## B5 — Eliminar / modificar fotografía en la intervención técnica

**Solicitud:** Poder eliminar o modificar una fotografía en la sección de intervención técnica **antes de que la información sea enviada/finalizada**. La eliminación solo debe estar disponible para quien subió la foto; el botón "eliminar" aparece al abrir la foto.

> Nota: Solangel confirmó "logramos ver el apartado de eliminar al abrir la foto" — parece **resuelto**. Esta tarea es **confirmar y cubrir casos faltantes** (reemplazo de foto, edición tras envío según rol).

**Criterios de aceptación:**
- El autor de la foto puede eliminarla antes del envío; otros usuarios no ven la opción.
- (Opcional) Permitir reemplazar una foto.

---

## F1 — Estabilidad: Órdenes de Servicio y Base POC "no cargan / página pensando"

**Problema recurrente:** Ambos sistemas (OS y Base POC) se quedan cargando; atribuido a "intermitencia del servicio en la base de datos".

**Requerimientos / diagnóstico:**
1. Agregar **timeouts y reintentos** en las llamadas a BD/API y un mensaje de error amigable en vez de spinner infinito.
2. Revisar **pool de conexiones** a la base de datos (tamaño, conexiones colgadas, fugas de conexión).
3. Revisar consultas lentas en los listados de OS y POC; agregar **índices** y **paginación** donde falten.
4. Añadir **logging/health-check** y, si es posible, un endpoint de estado para detectar la intermitencia.
5. Evaluar caché para catálogos (clientes, modelos, servidores).

**Criterios de aceptación:**
- Bajo carga normal, OS y POC cargan en tiempo razonable; ante fallo de BD se muestra error claro y reintento, no spinner infinito.

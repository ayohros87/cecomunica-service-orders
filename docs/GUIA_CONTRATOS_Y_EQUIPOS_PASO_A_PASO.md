# Guía rápida — Contratos y equipos, paso a paso

**Para:** ventas, recepción, inventario y taller · **Fecha:** agosto 2026
**En una línea:** el contrato dice *cuántos* radios; la ficha de cada serial dice *cuál*, *dónde está* y *qué le ha pasado*. El trabajo de todos es que esas dos historias cuadren — y el sistema ahora ayuda en cada paso.

---

## La regla de oro

> **Cada radio tiene una ficha con su historia** (a qué cliente fue, en qué contrato, cuándo entró al taller, quién lo reemplazó). Esa historia se escribe sola **si seguimos los pasos en el sistema**. Cada paso que se salta —una entrega sin marcar, un serial tecleado a mano donde había botón— es un radio que después hay que salir a buscar.

**Todo serial que veas en el sistema es clickeable** → abre la ficha del equipo con su historia completa. Si tienes duda de dónde está un radio, empieza ahí.

---

## 1 · Contrato NUEVO (cliente estrena equipos)

| Paso | Quién | Qué hace |
|---|---|---|
| 1 | Vendedor | Crea el contrato en **Contratos · Nuevo**: cliente, modelos y cantidades. |
| 2 | Gerencia | Aprueba. El sistema pide los seriales a inventario por correo. |
| 3 | Inventario | En la página de seriales, botón **"Tomar del pool (bodega)"** → escoge las unidades reales (o selección automática). **No teclear a mano lo que está en bodega.** Confirmar y enviar. |
| 4 | Recepción | Crea la **orden de PROGRAMACIÓN** (la lista de contratos se lo sugiere con un botón). Los seriales se jalan del contrato — tampoco se teclean. |
| 5 | Taller | Programa, marca **COMPLETADO**, pasa QC. |
| 6 | Recepción | Cuando el cliente recibe: **marcar la orden ENTREGADO AL CLIENTE**. |

> ⚠️ **El paso 6 es el que más se olvida y el que más cuesta.** Sin él, el sistema cree que los radios siguen en el taller, el contrato no registra la entrega y las renovaciones futuras no funcionan solas. Desde ahora llega un correo diario con las órdenes que están listas y sin entregar — la meta es que ese correo llegue vacío.

---

## 2 · RENOVACIÓN (el cliente sigue, se renueva el contrato)

Igual que un contrato nuevo, con **dos preguntas más al crearlo** — y las responde el vendedor, que es quien negoció:

1. **¿A qué contrato renueva?** — obligatorio. La lista muestra los contratos del cliente **con cuántos equipos tiene cada uno**, para elegir sin adivinar. Si el original es de papel (no está en el sistema), se marca la casilla y se anota la referencia.
2. **¿Qué pasa con cada radio del contrato viejo?** — aparece la lista real de sus equipos y cada uno se marca:
   - **Continúa** → el cliente lo conserva bajo el contrato nuevo *(es el valor por defecto en una renovación)*
   - **Se devuelve** → sale del servicio; el sistema pedirá recuperarlo
   - **Se reemplaza** → sale y un radio nuevo toma su lugar

**¿No sabes los seriales exactos?** Marca **"No sé los seriales — decidir por cantidades"** y anota cuántos continúan / se devuelven / se reemplazan por modelo. Recepción resuelve cuáles contra ese plan.

Después:
- En la página de seriales aparece el botón **"Traer del original (N continúan)"** — llena los seriales que siguen **sin re-teclear nada**.
- Al marcar la entrega, el sistema **solo** reclama los que dijiste que se devuelven, y abre el tiquete de recuperación con el correo a quien corresponde.

> **Renovación parcial** (renuevas 6 de 10): es exactamente esto — 6 "continúa", 4 "se devuelve". Ya no hay que explicarlo en observaciones.

---

## 3 · REEMPLAZO (se cambian radios por otros)

Igual que la renovación, con un default distinto: **todas las unidades parten en "se reemplaza"** — marca las excepciones si alguna continúa o solo se devuelve.

Al entregar, el sistema parea automáticamente radio viejo → radio nuevo del mismo modelo, y la ficha de cada uno queda enlazada ("reemplaza a X" / "reemplazado por Y"). La devolución de los viejos se pide sola.

---

## 4 · ADICIÓN (el cliente suma radios a lo que ya tiene)

- Es un contrato nuevo con acción **"Adición"**.
- Vincular el contrato original es **opcional** (ayuda a ver el total del cliente, pero no es obligatorio).
- **Una adición no devuelve nada**: el cliente conserva lo de antes Y recibe lo nuevo. El sistema no va a reclamar ningún equipo.
- El resto del flujo es idéntico al contrato nuevo (seriales → orden → entrega).

---

## 5 · Cuando los radios REGRESAN (devolución / entrada)

1. La devolución nace sola (renovación entregada, anulación, baja) o a mano: es una **orden de DEVOLUCIÓN** — el tiquete de "hay que recuperar estos radios".
2. Cuando el cliente entrega físicamente: **check-in por serial** (accesorios, daño, firma).
3. El taller los revisa con la orden de **ENTRADA**; al cerrarla, cada radio queda **disponible en bodega**.

> Nada de esto borra la historia: la ficha del radio muestra todo el ciclo.

---

## 6 · Dónde consultar (sin preguntar por WhatsApp)

| Pregunta | Dónde |
|---|---|
| ¿Qué equipos tiene este cliente? | **Clientes** → botón **"Equipos"** en la fila (agrupados por contrato, con estado) |
| ¿Qué equipos tiene este contrato? | Lista de contratos → icono de equipos → panel con la ruta del ciclo |
| ¿Dónde está este radio y qué le ha pasado? | Clic en el serial en cualquier pantalla → ficha del equipo |
| ¿Qué me toca hacer hoy? | El home (señales) + los correos diarios del sistema |

---

## 7 · Los correos automáticos y qué hacer con cada uno

| Correo | Le llega a | Qué hacer |
|---|---|---|
| Solicitud de seriales | Inventario | Asignar seriales del contrato aprobado |
| **Listas para entregar** *(nuevo)* | Recepción | Marcar ENTREGADO las órdenes que el cliente ya recibió |
| Control de calidad pendiente | Taller | Firmar el QC de las completadas |
| Equipos pendientes de devolución | Vendedor + recepción | Coordinar la recuperación con el cliente |
| Entradas sin inspección | Recepción | Pasar por inspección lo que está en cuarentena |

---

## 8 · Los 3 errores que más cuestan (y cómo evitarlos)

1. **No marcar ENTREGADO AL CLIENTE.** El trabajo está hecho pero el sistema no lo sabe: el inventario queda "en taller", el contrato sin entrega, la renovación no corre. → Marcarlo el mismo día que el cliente recibe.
2. **Teclear seriales que ya existen.** Cada tecleo es un typo posible y una ficha duplicada. → Usar siempre los botones: *Tomar del pool*, *Traer del original*, *Jalar del contrato*.
3. **Crear la renovación sin decir qué pasa con los radios viejos.** El sistema ahora lo pregunta al crear — respóndelo ahí, aunque sea por cantidades. Es un minuto del vendedor que ahorra días de conciliación.

---

*Dudas o casos raros (contrato de papel, serial que no aparece, radio de un cliente en otro): escríbele a Alberto con el número de contrato y el serial — la ficha del equipo casi siempre tiene la respuesta.*

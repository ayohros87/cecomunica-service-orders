# SCRIPT IA — Sección: Contratos de Reemplazos y Renovaciones

> **Instrucción para la IA:** Trabajas en el sistema CECOMUNICA (Contratos, Órdenes de Servicio, Base POC, Bodega/Inventario). Implementa un **flujo completo de reemplazos y renovaciones** que conecta Ventas → Bodega → Recepción/Activaciones → POC → Devoluciones. Diséñalo end-to-end con máquina de estados, vínculos obligatorios entre entidades, notificaciones y reglas de cierre. Divídelo en **Fase 1** (E1–E8) y **Fase 2** (E9 y partes marcadas). Entrega: modelo de datos/migraciones, endpoints, UI por rol, notificaciones y pruebas.

**Solicitante:** Zuleika Díaz (Gerente Administrativa), correo del 29/06/2026.

---

## Visión general del proceso

```
VENDEDOR                BODEGA                 RECEPCIÓN/ACTIVACIONES      POC / TÉCNICO            BODEGA (cierre)
Crea contrato   ->   Asigna seriales   ->     Abre OS vinculada   ->     Ejecuta reemplazo/   ->  Recibe equipos
(reemplazo/          por modelo,              al contrato                renovación usando        retirados;
 renovación,         reserva y                                           programación del         compara esperado
 seriales a          notifica                                            serial anterior;         vs recibido;
 reemplazar,                                                             crea mapeo serial        cierra cuando
 motivo)                                                                 actual<->reemplazo       devolución completa
```

Estados sugeridos del contrato: `Borrador → Aprobado → Seriales asignados (Bodega) → OS abierta → En ejecución → Pendiente de devolución de equipos → Cerrado`.

---

## E1 — Creación del contrato de reemplazo/renovación (Vendedor)

**Requerimientos:**
1. El vendedor crea un contrato tipo **Reemplazo** o **Renovación**.
2. Identifica los equipos a reemplazar/renovar y, **para poder avanzar, debe ingresar el/los seriales** que va a reemplazar.
3. Captura el **motivo del reemplazo**.
4. Al aprobarse, el contrato pasa a **Activaciones** ("autorizado para iniciar el proceso operativo").

**Criterios de aceptación:** No se puede avanzar el contrato sin seriales a reemplazar ni motivo; al aprobar, queda visible para Activaciones.

---

## E2 — Asignación de seriales por Bodega

**Requerimientos:**
1. Para **todos** los tipos de contrato (reemplazos, renovaciones, adiciones, nuevos), los números de serie se asignan **directamente por Bodega** dentro de la plataforma.
2. **Botón** para que el encargado de bodega proporcione los seriales según los **modelos** indicados en el contrato.
3. En reemplazos/renovaciones, desplegar un **mapa/tabla de modelos** para colocar seriales por modelo; permitir **copiar y pegar varios a la vez**.
4. Tras colocar los seriales por modelo, **botón para enviar email a Activaciones y al Vendedor** notificando los seriales asignados.
5. Los seriales quedan **reservados y vinculados al contrato** (no disponibles para otro uso).

**Criterios de aceptación:** Bodega asigna seriales por modelo, pega múltiples, y al confirmar se notifica a activaciones+vendedor; los seriales quedan reservados al contrato.

---

## E3 — Recepción abre la OS asociada al contrato

**Requerimientos:**
1. Con la info de Bodega, **Recepción** abre la **Orden de Servicio asociada al contrato**.
2. Contemplar el caso de **seriales dañados o con error en la serie**: permitir solicitar cambio/corrección del serial sin romper el vínculo con el contrato (re-asignación por Bodega).

**Criterios de aceptación:** La OS nace ligada al contrato; existe un camino para corregir seriales dañados/erróneos.

---

## E4 — Opción de reemplazo/renovación dentro del módulo POC

**Requerimientos:**
1. El módulo **POC** incluye una opción específica para gestionar reemplazos/renovaciones.
2. Al seleccionar el contrato, **trae los seriales y modelos** a reemplazar/renovar y muestra automáticamente la información del equipo.
3. El sistema toma como **referencia la programación del serial anterior** (para no buscar manualmente y evitar configurar mal el radio). Datos a mostrar:
   - **Programación actual:** serie, id, sim cards, línea, nombre del radio, grupos.
   - **Estado del equipo.**
4. Crear una **relación directa entre el serial actual y el serial que lo reemplaza** (concepto de **mapeo**).
5. Esta información (reemplazos/renovaciones de series) queda como parte del **historial del contrato y de la OS**.

**Criterios de aceptación:** Desde POC, al elegir el contrato se ve la programación del serial saliente y se registra el mapeo saliente→entrante en el historial.

---

## E5 — Propuesta automática de mapeo en renovaciones

**Requerimientos:**
1. Al renovar, la plataforma toma los **equipos activos** del contrato y **propone automáticamente** la relación con los nuevos seriales asignados (tomando en cuenta el **modelo**).
2. Flujo: (1) el sistema muestra los equipos activos; (2) propone qué nuevo serial reemplaza a cada serial actual; (3) el usuario **revisa, ajusta y confirma** la relación antes de aprobar.

**Criterios de aceptación:** En una renovación, el sistema pre-arma el mapeo por modelo y el usuario puede editarlo antes de confirmar.

---

## E6 — Vinculación obligatoria OS↔contrato y regla de cierre

**Requerimientos:**
1. Toda OS de reemplazo/renovación queda **vinculada obligatoriamente** al contrato que la originó.
2. La OS debe contener la información necesaria para ejecutar y verificar el servicio.
3. **Regla de cierre:** **no permitir cerrar** la OS si falta información esencial o si **no se ha identificado el contrato** de origen.

**Criterios de aceptación:** No es posible cerrar una OS de reemplazo/renovación sin contrato asociado e info completa.

---

## E7 — Notificaciones automáticas

**Requerimientos:**
1. El sistema envía avisos a las **áreas responsables** en los momentos principales del proceso (mínimo: contrato aprobado → activaciones; seriales asignados → activaciones+vendedor; OS abierta; reemplazo ejecutado; pendiente de devolución; devolución completa/cierre).
2. Definir destinatarios por evento y permitir configurarlos.

**Criterios de aceptación:** Cada transición clave de estado dispara la notificación correspondiente a quien corresponde.

---

## E8 — Control de devolución de equipos

**Requerimientos:**
1. Tras ejecutar la renovación/reemplazo, el contrato se mantiene en estado **"Pendiente de devolución de equipos"** hasta que Bodega reciba **todos** los radios retirados.
2. La **orden de entrada** (recepción en bodega) debe **vincularse** con la OS y el contrato de reemplazo/renovación.
3. El sistema **compara la cantidad esperada vs. la recibida**. *(comparación detallada por serial: 2ª fase)*
4. Si quedan seriales pendientes, el sistema **detecta las series no devueltas**.
5. El proceso **solo puede cerrarse cuando la devolución esté completa**.
6. **Criterio:** las **devoluciones parciales** pueden registrarse para seguimiento, pero **no permiten el cierre** de la OS ni del contrato hasta recibir la totalidad.

**Criterios de aceptación:** Un contrato con equipos sin devolver no puede cerrarse; las devoluciones parciales quedan registradas pero bloquean el cierre.

---

## E9 — (FASE 2) Reporte de equipos pendientes de devolución

**Requerimientos:** Crear un módulo/reporte que muestre todos los equipos pendientes de devolución, tomando la info del contrato y de las OS, con columnas:
- Cliente y número de contrato
- Número de orden de servicio
- Modelo y serial pendiente
- Fecha del reemplazo o renovación
- Cantidad de días pendientes
- Vendedor responsable
- Estado de seguimiento y observaciones

**Criterios de aceptación:** El reporte lista correctamente los pendientes con todas las columnas y es filtrable/exportable.

---

## Notas de implementación

- **Modelo de datos:** entidades `Contrato`, `ContratoLínea` (modelo+cantidad), `AsignaciónSerial` (serial↔contrato, estado reservado), `MapeoReemplazo` (serial_saliente↔serial_entrante, contrato, OS), `OrdenServicio` (FK contrato obligatoria en reemplazos), `Devolución`/`OrdenEntrada` (FK OS+contrato), historial/auditoría.
- **Reutilizar** los catálogos existentes de clientes, modelos, servidores y la programación de POC (ver `02_base_datos_poc_batch.md`).
- Implementar como **máquina de estados** con validaciones de transición y permisos por rol (Vendedor, Bodega, Recepción/Activaciones, POC/Técnico).
- Cubrir con **pruebas** los caminos felices y los bloqueos (avanzar sin seriales, cerrar sin contrato, cerrar con devolución incompleta).

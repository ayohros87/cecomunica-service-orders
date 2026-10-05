# Cierre de la ejecución · 2026-10-02

> Qué se hizo con las respuestas de Alberto del 1 de octubre ([plan](10-plan-ejecucion.md)).
> Dos olas de agentes por módulo; cada cambio se probó en el emulador con sesión real del rol
> y se commiteó por separado. Ola 1 desplegada el 1-oct; ola 2 desplegada el 2-oct.

## 1. Lo hecho, por módulo

| Módulo | Lo que cambió para quien lo usa | Medido |
|---|---|---|
| **Órdenes** | Las señales del home y Ctrl+K abren lo que anuncian (`?ids=`, `?estado=` al servidor). Fechas en hora de Panamá con un solo formato. El toast sale arriba en todo el app y la intervención no se pierde en el teléfono. Enter agrega fila en el lote. Entrega en papel pide la nota o una razón. Correos de entrega a cliente, vendedor, recepción y jefa. Bandeja legible a 1280/1024 y lápiz visible. Botón Menú en el teléfono. | "Por asignar" 6 → 42 filas; celdas cortadas 53 → 9; correos 5 → 4 |
| **Almacén** | Recepción y ventas ya no reciben ni venden (topbar y rules). Existencias con KPIs honestos. Recibir se cierra. Asignar solo verifica lo que no se tecleó. Bodega ve el catálogo sin precios y Piezas sin costo. Buscar un serial no baja el pool. | Asignar 25 seriales: 54 → 28 interacciones; búsqueda 7,834 → 1 lectura; "por inspeccionar" 151 → 5 |
| **PoC** | "Preparar lote" ve todos los clientes. El SIM que ya está en otro radio avisa y pide motivo en los cuatro caminos. Duplicados agrupados por serial (la más reciente se queda) con cierre en lote. Cabecera con totales reales. SIM editable en la fila con autocompletado y cámara. | Clientes en el combo 8 → 420; cambiar SIM 7 → 3 interacciones |
| **Contratos** | Job de cuadre del QR público + cron semanal. "Firmado por enlace". "Devolución pendiente" al servidor. Contrato **dormido** a los 45 días sin firma, con Reactivar. "Nuevo contrato" como respaldo con razón obligatoria. Paso de firma con vía, destinatario, edad y reenviar. | "Devolución pendiente" 1 → 14; señal "por firmar" 14 → 5 |
| **Cotizaciones** | Eliminar cierra el enlace del cliente. El detalle dice quién rechazó, descartó y aprobó. Aprueba administración. Una comercial vencida se puede marcar vendida. Eliminar solo borradores; lo enviado se descarta o se "Rehace". Autoguardado cada 2.5 s. "Cotizar" solo con intervención. | Lista 36 → 8 viajes |
| **Centro y Clientes** | Búsqueda con guiones y RUC a medias. Historial sin cambios fantasma. El botón primario es lo primero de "Ahora" y "por clasificar" es de bodega. Selector de seriales con buscador en los cuatro wizards. Aprobar con resumen y confirmación. RUC con formato. Un solo formato de fecha. Órdenes abiertas y "Almacén ↗" por serial en la ficha. | Selector de reemplazo: 273 filas → buscador |
| **Facturación** | Pestañas de futuro escondidas. "Ver hechos" siempre al servidor. El contrato que muere cierra sus avisos. Los -R heredan tarifa e ítem QBO del modelo base. Primer pago de comisiones en lote. Número de factura visible. Del contrato y la cotización al aviso en un clic. Señales del home para recepción y contabilidad. | Sin mapeo 214 → 106; contrato → aviso 5 pasos → 1 |
| **Home y admin** | KPI de contratos sin borrados. Todo abre órdenes con `?ids=`. Ctrl+K busca el pool y abre el cliente en el Centro. Contabilidad ve Finanzas, Centro y Clientes con señales propias. Consultas del home con tope explícito. Franja de contexto orden ↔ cliente ↔ contrato ↔ serial. | "Contratos pendientes" 49 → 0; orden → cliente 4.2 s → 1 clic |

## 2. Lo que necesita a Alberto para producción

Probado en el emulador, **no corrido en producción**:

1. **Cuadre del QR de contratos.** Job `cuadrarVerificaciones` en *Admin → Backfills*. En el emulador: 194 estados corregidos y 489 números de contrato. Después lo mantiene el cron semanal.
2. **Saneo de duplicados PoC.** `tools/poc-saneo-duplicados-serial.js` (vista previa por defecto, `--aplicar`). 566 seriales, 887 fichas se cerrarían.
3. **Espejos de cotizaciones eliminadas.** `tools/cotizaciones-espejar-eliminadas.js` (8 enlaces quedan "cerrada").
4. **Correo a Brenda** sobre la bandeja de facturación (texto en la respuesta de la sesión).

## 3. Preguntas abiertas

**De antes (sin respuesta):**
- Regla para la deuda de migración del pool: baja masiva, apartar de los contadores, o cruzar antes con PoC.
- ~~Política de cotizaciones: ¿15 %/$5,000 o 20 %/$15,000?~~ **20 %/$15,000** (Alberto, 2026-10-02).

**Nuevas, de los agentes:**
- **PoC:** en 134 seriales la ficha más reciente está inactiva y se cerraría una vieja activa. ¿Se aplica la regla igual? En 144 el pool dice otro cliente. ¿Se cierran o se apartan?
- **Contratos:** ¿los 45 días cuentan desde lo último que acercó la firma (así quedó) o desde la aprobación? ¿Los anexos de aumento también caducan? ¿Las 23 verificaciones de contratos borrados se marcan "no vigente"?
- **Almacén:** ¿recepción y ventas deben poder dar de **baja** una ficha del pool? (las rules aún lo permiten).
- **Cotizaciones:** desde vencida siguen "Marcar Enviada/Borrador". ¿Se quitan?
- **Catálogo:** el "1-19000-00011 SC2020" es un Sepura con el número de parte en la marca (corregir a SEPURA). ¿"HYTERA NO APLICA" sale del catálogo seleccionable?
- **Accesos:** ¿José (bodega) debe ver el Centro? ¿Admin quiere las dos tarjetas de Finanzas en su home?

## 4. Respuestas del 2-oct y lo hecho con ellas

| Pregunta | Respuesta | Hecho |
|---|---|---|
| Deuda de migración del pool | Dejarla por ahora | Sin cambios |
| Política de cotizaciones | 20 % y $15,000 | Código, defaults y docs alineados (5c2e53a) |
| Saneo PoC con la más reciente inactiva | No aplicar la regla | 134 seriales quedan "para revisar" a mano; el saneo cierra 681 fichas en 432 seriales (f0f997d) |
| PoC donde Almacén dice otro cliente | Explicado de nuevo | Quedan 63; en todos la custodia de Almacén viene de la migración sin verificar. Pendiente de respuesta |
| Contratos dormidos | Desde la aprobación; los anexos también caducan | 0492703, desplegado 2-oct |
| Bajas desde Almacén | Recepción y ventas no | Rules a admin/inventario (3de66fd), desplegado 2-oct |
| SC2020 | Es el modelo; la marca es SEPURA | Catálogo y 12 fichas corregidos en producción el 2-oct (15 escrituras) |
| "HYTERA NO APLICA" | Retirarlo | `activo:false` en producción; los selectores lo respetan (3b832d7); los 33 contratos quedan como estaban |

## 5. Respuestas del 5-oct y lo hecho con ellas

| Pregunta | Respuesta | Hecho |
|---|---|---|
| PoC: los 63 donde Almacén dice otro cliente | Procede | Incluidos en el saneo |
| Saneo de duplicados PoC | Procede | 679 fichas cerradas en producción el 5-oct; segunda pasada 0. Quedan 130 seriales "para revisar" |
| Cuadre del QR | Procede | Ya lo había hecho el cron del lunes 5-oct 05:30; 90 verificaciones anuladas |
| Enlaces de cotizaciones eliminadas | Cerrarlos | 8 espejos marcados en producción |
| Anexos dormidos | Retener o soltar | 15 días para decidir, retener 30 (la 2.ª solo admin), si nadie decide se sueltan; con orden trabajada decide bodega (db9186f, b2be3e7, desplegado 5-oct) |
| Ajustes de tarifa | También se duermen | Ya incluidos |
| Descuento de no devueltos | 20 % | 87b631a, desplegado 5-oct |


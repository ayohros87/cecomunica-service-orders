# SCRIPT IA — Sección: Inventario / Piezas y Tarifas + Integración QuickBooks (QBO)

> **Instrucción para la IA:** Trabajas en las pantallas nuevas "Ingreso de Piezas y Tarifas" y "Equipos y Tarifas" del sistema CECOMUNICA, que se alimentan de **QuickBooks Online (QBO)**. Corrige los problemas de integración y de UI reportados por Contabilidad (Cheila Sánchez, 30/06/2026, con copia a Zuleika Díaz). Localiza: el servicio de sincronización con QBO (mapeo de productos/ítems), la pantalla de ingreso de piezas/tarifas y la tabla de equipos/servicios (TABLA No. 1) usada para POC. Revisa las capturas adjuntas en los correos (`image001.png` y `image002.png`).

**Contexto de negocio:** se está conectando la app (app.cecomunica.net) con QuickBooks Online para que las piezas/tarifas y las facturas de contratos se mantengan al día automáticamente (ver hilo "Integración de contratos con QuickBooks", 15/06/2026).

---

## G1 — Datos traídos de QBO no concuerdan / aclarar mapeo de campos

**Problema:** Los 8 primeros productos se trajeron de QuickBooks, pero **la información no concuerda** con los productos existentes. Contabilidad necesita saber **cuál es el dato correcto** y confirmar el mapeo de campos.

**A confirmar / definir (mapeo):**
- ¿**"Pieza" = descripción** del producto?
- ¿**"SKU" = código** de la pieza?
- Cómo se resuelve un conflicto cuando el producto ya existe en la app y difiere del de QBO (¿gana QBO?, ¿gana la app?, ¿se marca para revisión manual?).

**Requerimientos:**
1. Documentar y aplicar un **mapeo claro** entre los campos de QBO (Name, SKU, Description, UnitPrice, etc.) y los campos de la app (descripción, código/SKU, precio, costo, margen).
2. Mostrar en pantalla el **origen** de cada dato (QBO vs. manual) para que Contabilidad sepa qué está sincronizado.
3. Definir y aplicar una **regla de conciliación** cuando los datos difieren (recomendado: marcar en estado "Por revisar" y permitir elegir el valor correcto).

**Criterios de aceptación:** Para los 8 productos del ejemplo, cada campo (pieza/descripción, SKU/código, precio) muestra el valor correcto y su origen; los conflictos quedan visibles y resolubles.

---

## G2 — "ITEM QBO" muestra "(no encontrado en QBO)" para productos importados desde QBO

**Problema:** En el campo **ITEM QBO** aparece **"(no encontrado en QBO)"**, aun cuando esa información **se seleccionó desde QuickBooks**. Es decir, la vinculación con el ítem de QBO se está perdiendo o el matching falla.

**Requerimientos / diagnóstico:**
1. Revisar cómo se guarda el **identificador del ítem de QBO** (debe persistirse el `Id`/`SyncToken` de QBO, no solo el nombre).
2. Corregir el matching para que use el **ID de QBO** y no una comparación por texto (que falla por mayúsculas/espacios/nombres duplicados).
3. Al importar/seleccionar desde QBO, **guardar el vínculo** y mostrar el ítem QBO correcto (no "(no encontrado)").
4. Manejar el caso real de "no encontrado" (ítem borrado/inactivo en QBO) con un mensaje distinto y accionable (re-vincular).

**Criterios de aceptación:** Un producto seleccionado desde QBO muestra su ítem QBO vinculado; "(no encontrado en QBO)" solo aparece cuando realmente no existe el vínculo.

---

## G3 — Ocultar costo y margen a los técnicos

**Problema:** Si la pantalla de piezas/tarifas es para **técnicos**, **no debe mostrar ni costo ni margen**. (No es para tecnicos este modulo, pero igual confirmar que no haya fuga de información de costos.)

**Requerimientos:**
1. Aplicar **visibilidad por rol**: el rol técnico ve descripción/precio de venta, pero **no costo ni margen**. (el tecnico no debe ver este modulo, pero en los modulos que si jala información de piezas, solo debe ver la descripcion, sku y precio)
2. Asegurar que el dato sensible **no se envíe** al frontend para ese rol (no solo ocultarlo con CSS).

**Criterios de aceptación:** Con sesión de técnico, las columnas de costo y margen no aparecen ni viajan en la respuesta del servidor.

---

## G4 — No hay opción para editar precios

**Problema:** No existe forma de **editar precios** en la pantalla.

**Requerimientos:**
1. Permitir **editar el precio** (y los campos editables que defina Contabilidad) a los roles autorizados (administración/contabilidad), no a técnicos.
2. Definir si el cambio de precio en la app debe **reflejarse en QBO** o solo en la app (coordinar con Contabilidad; recomendado: configurable, con auditoría).
3. Registrar en **auditoría** quién cambió el precio, cuándo y el valor anterior.

**Criterios de aceptación:** Un usuario autorizado edita y guarda el precio; queda auditado; el técnico no puede editar.

---

## G5 — Tarifas para POC y equipos con frecuencia: solo "alquiler de equipo" y "mantenimiento" (TABLA No. 1)

**Problema:** En la TABLA No. 1 **no aparece la opción de mapeo para mantenimiento ni para frecuencia.*.

**Requerimientos:**
1. Para equipos tipo **POC** permitir un switch que lo identifique como POC y restringir la columna de frecuencia para este equipo, tanto en monto como en mapeo. (POC **no lleva frecuencia**). Agregar columnas para mapear frecuencia y mantenimiento


**Criterios de aceptación:** En el flujo POC, las opciones de tarifa son solo alquiler y mantenimiento, sin campo habilitado de frecuencia, y se puede capturar el monto en cualquiera de las dos.

---

## G6 — Aclarar/relacionar inventario (izquierda) con servicios (derecha) en TABLA No. 1

**Problema/duda de Contabilidad:** ¿Qué **relación** guardan los productos de inventario mostrados a la izquierda de la TABLA No. 1 con los servicios mostrados a la derecha?

**Requerimientos:**
1. Documentar y, si hace falta, **rediseñar** la tabla para que la relación inventario↔servicio sea explícita (etiquetas, agrupación o columna que indique el vínculo).
2. Validar con Contabilidad que el modelo refleje el negocio.

**Criterios de aceptación:** La pantalla deja claro cómo se relaciona cada producto de inventario con su(s) servicio(s).

---


---

## Preguntas abiertas para Contabilidad (Cheila / Zuleika)
- Confirmar mapeo "pieza = descripción" y "SKU = código". SI
- ¿El precio editado en la app debe sincronizarse de vuelta a QBO? NO, los precios solamente viven en el app no en qbo.
- Criterio exacto para marcar un producto como "disponible para alquiler" (para G7). esto ya esta resuelto
- En conflictos QBO vs. app (G1), ¿qué fuente manda por defecto? por decidir...

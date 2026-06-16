# Integración con QuickBooks — Resumen para el equipo

> **Para:** Contabilidad y Administración
> **De:** Equipo de sistemas
> **Fecha:** 16 de junio de 2026
> **Estado:** Conexión lista ✅ · Automatización en construcción

Este documento explica, sin tecnicismos, qué vamos a hacer al conectar nuestro
sistema de contratos y órdenes (la aplicación en *app.cecomunica.net*) con
**QuickBooks Online**, por qué lo hacemos y qué cambia para cada quien.

---

## 1. En una frase

Vamos a lograr que **las facturas de los contratos se creen y se mantengan al
día solas** en QuickBooks, con el **desglose por contrato** que hoy nos falta, y
que **la información de clientes y pagos esté sincronizada** entre la app y
QuickBooks.

> **Importante — alcance:** esto aplica **solo a contratos nuevos**. Los contratos
> que ya existen **se siguen facturando como hoy** (manual en QuickBooks); no cambian.
> En el futuro se podría migrar los viejos, pero por ahora no.

---

## 2. El problema que resolvemos hoy

- **No se ve el detalle por contrato.** Cuando un cliente tiene varios
  contratos, en QuickBooks se ve "todo junto". No podemos saber fácilmente
  cuánto se ha facturado o cuánto debe **por cada contrato**.
- **La facturación mensual se arma a mano.** Eso toma tiempo cada mes y abre la
  puerta a errores u omisiones.
- **La información se escribe dos veces.** Los datos del cliente se cargan en la
  app y otra vez en QuickBooks.

---

## 3. La solución, en palabras simples

- Cada **cliente** de la app tendrá su ficha de **Cliente** en QuickBooks.
- Cada **contrato** será un **"sub-cliente"** dentro de ese cliente. Así
  QuickBooks muestra las facturas y el saldo **separados por contrato**, y al
  mismo tiempo el **total del cliente**. (Piénsenlo como carpetas: un cliente, y
  dentro una carpeta por cada contrato.)
- La facturación de un contrato **arranca cuando se entregan los equipos** al
  cliente — no cuando se firma o se aprueba el contrato.
- La **mensualidad se genera automáticamente** cada mes. Si un contrato empieza
  a mitad de mes, la primera factura se cobra **proporcional a los días**
  (prorrateo).
- Los **pagos** registrados en QuickBooks se reflejan **de vuelta en la app**,
  para ver el estado de cobro en un solo lugar.

---

## 4. Lo que encontramos en nuestro QuickBooks (buenas noticias)

Revisamos la cuenta real de **CE COMUNICA** y confirmamos que casi todo lo que
necesitamos ya existe:

- ✅ Ya se factura con las partidas **"Mensualidad - [modelo]"** (por ejemplo
  *Mensualidad - PD78X*). El sistema usará **esas mismas partidas** — no
  inventamos nada nuevo ni cambiamos cómo se ve la factura.
- ✅ El **ITBMS 7% ya está configurado** correctamente.
- ✅ Ya existen algunos **sub-clientes**, así que el método propuesto es el mismo
  que el equipo ya usa a veces; solo lo volvemos ordenado y automático.
- ✅ La **mayoría de los clientes ya tienen su RUC** registrado.

En resumen: la integración se acopla a **cómo ya trabajan**, no los obliga a
cambiar su forma de facturar.

---

## 5. Qué cambia en el día a día

### Para **Administración**
- **Ya no se arma la factura mensual a mano**; el sistema la prepara. La labor
  pasa a ser **revisar y confirmar**.
- Es clave **registrar bien la entrega de equipos** en la app, porque ese es el
  momento en que el sistema empieza a facturar el contrato.
- Menos doble digitación: el cliente y el contrato se cargan una sola vez.

### Para **Contabilidad**
- Las facturas llegan a QuickBooks ya con el **ITBMS**, las **partidas de
  mensualidad** y las **cuentas de ingreso** correctas (ej. *Alquiler de
  Equipo*, *Servicio de Mantenimiento*).
- La **conciliación de pagos** es más fácil: el estado de pago se ve también en
  la app, junto al contrato.
- **El paso de factura fiscal no cambia** (ver punto 6).

---

## 5.1 Cómo se arma la mensualidad (automático)

La mensualidad de cada equipo se compone de **alquiler + mantenimiento** (y
**frecuencia**, si el equipo la usa). Hoy ese reparto se hace a mano en cada
factura. Con la integración será automático:

- En un **panel administrativo** se define, **una sola vez por modelo**, el
  **valor de alquiler** del equipo (y el de frecuencia si aplica). Es
  configurable y se puede actualizar cuando cambien las tarifas.
- El **vendedor solo escribe la mensualidad negociada** del equipo — nada más.
- El sistema calcula el resto **tras bastidores**:
  - *Alquiler* = el valor fijo del panel.
  - *Frecuencia* = el valor fijo del panel (si el equipo la tiene).
  - *Mantenimiento* = lo que sobra de la mensualidad.
- **El vendedor no ve este desglose.** Lo ven **Administración y Recepción**.

**Si el monto negociado es muy bajo** (menor que el alquiler base), el sistema le
avisa al vendedor que parece un error y le pide confirmar antes de mandarlo a
aprobación. Queda a criterio del administrador aprobar esos casos excepcionales.

**En la factura, el cliente ve una sola línea** (la mensualidad del equipo); el
desglose por alquiler/mantenimiento/frecuencia queda **interno**, registrado en
las cuentas contables correctas de QuickBooks, pero **el cliente no lo ve**.

### Impuesto (ITBMS)
El sistema aplica **ITBMS 7%** o **Exento** según cómo esté marcado **cada
cliente** (ese dato ya se administra hoy en la ficha del cliente).

### Cuándo se factura
- Las facturas se **emiten el 1.º de cada mes** y cubren el mes completo.
- Si un contrato arranca a mitad de mes (al entregar equipos), la **primera
  factura es proporcional** a los días, calculada de forma simple (mensualidad
  ÷ 30 × días).

## 5.2 Panel de facturación (para quien factura)

La emisión es **automática**, pero habrá un **panel de facturación** para que la
persona encargada tenga control sin tener que aprobar factura por factura:

- **Próximo a facturar:** ver, días antes del corte, qué se va a facturar el 1.º
  (montos, contratos que inician, bajas), para revisarlo con anticipación.
- **Poner "en espera":** sacar un contrato del ciclo automático cuando hay una
  disputa o algo pendiente (se factura después, cuando se libere).
- **Red de seguridad:** si el monto de un contrato se **dispara** respecto al mes
  anterior, el sistema lo **retiene solo** y lo manda a revisión en vez de emitirlo.
- **Facturado:** lo ya emitido, con su **estado de pago** y enlace a QuickBooks.
- **Reintentar / facturar puntual:** para casos sueltos (un contrato que estaba en
  espera, una entrega de mitad de mes, o una factura que falló).
- **Ajuste puntual:** aplicar un **descuento o cargo único** a la próxima factura
  de un contrato (con su motivo), cuando se acuerda algo puntual con el cliente.

Las **anulaciones y notas de crédito** se hacen en **QuickBooks** (donde está la
cobranza), no en el panel.

## 5.3 Cancelación de equipos (bajas)

Cuando un cliente quiere **dar de baja** equipos de un contrato (p. ej. de 10 baja
a 9), hay un **procedimiento controlado** — un contrato activo **no se edita "a mano"**:

1. El cliente envía su **nota de cancelación**.
2. **Vendedor o Recepción** registran la solicitud en la app: qué equipos, y el
   **término según el contrato** — *hasta fin de mes*, *30 días más*, *60 días más*
   u *otro* — y **adjuntan la nota** del cliente.
3. La solicitud entra a una cola **"Cancelaciones pendientes"** (similar a los
   contratos pendientes de aprobación).
4. **Administración aprueba**; a partir de ahí el sistema deja de facturar esos
   equipos según el término (el último tramo se cobra **proporcional**, ÷30).

- **No se generan notas de crédito desde la app** (si hiciera falta, es manual).
- La **Tasa de Cancelación**, si aplica, se cobra **aparte**.
- **Control e historial:** cada contrato muestra su **"Historial de bajas"**
  (de cuánto a cuánto, con los documentos adjuntos); Administración/Recepción ven
  todo, y queda registrado quién solicitó y quién aprobó.

## 6. El módulo de facturación fiscal (importante)

La **factura fiscal** se seguirá generando **manualmente, igual que hoy**, a
partir de la factura ya creada en QuickBooks. La integración **no reemplaza** ese
paso. Lo que sí hace es asegurarse de que la ficha del cliente en QuickBooks
tenga el **RUC/DV** correcto para que el módulo fiscal lo tome bien.

---

## 7. Lo que necesitamos decidir (preguntas para el equipo)

**Ya definido:** prorrateo ÷ 30 · emisión el **1.º de cada mes** · la baja se
factura hasta su término con prorrateo del último tramo · solo contratos nuevos.

**Falta confirmar** (Contabilidad/Administración):

1. **Reportes por tipo de contrato:** ¿quieren ver ingresos separados por tipo
   de contrato (usando las "clases" de QuickBooks)?
2. **Pagos de vuelta:** ¿qué información traemos a la app: solo
   "pagado/pendiente", o también número de factura y saldo?
3. **Tabla de tarifas de alquiler por modelo:** validar los valores de alquiler
   (y frecuencia) que cargaremos en el panel administrativo.
4. **Equivalencia de modelos:** confirmar el nombre de cada modelo en QuickBooks
   (PD78X, AP516, etc.) frente al de la app, para emparejarlos.
5. **Factura fiscal:** confirmar que el módulo fiscal toma bien el RUC del cliente
   en facturas a sub-clientes.

---

## 8. Cómo lo haremos (por fases, sin frenar la operación)

| Fase | Qué se hace | Resultado visible |
|---|---|---|
| 1. Conexión | Enlace seguro con QuickBooks | **✅ Hecho** |
| 2. Base | Modelo de contrato por "líneas" + panel de tarifas por modelo | Listo para facturar |
| 3. Clientes | Crear/actualizar fichas de cliente (con RUC) | Clientes sincronizados |
| 4. Contratos + 1ra factura | Sub-cliente del contrato + primera factura (prorrateada) al entregar equipos | Facturación arranca sola |
| 5. Mensualidad | Facturación mensual automática | Cada mes se factura solo |
| 6. Panel de facturación | Próximo a facturar, en espera, alertas, ajustes | Control visual de la emisión |
| 7. Cancelaciones | Solicitud de baja, aprobación, control e historial | Bajas ordenadas |
| 8. Pagos | Traer el estado de pago a la app | Cobro visible en un lugar |

Cada fase se **prueba** antes de pasar a la siguiente, para no afectar la
facturación real.

---

## 9. Estado actual

- ✅ La **conexión con QuickBooks** ya está hecha y verificada (cuenta CE
  COMUNICA).
- ✅ Confirmamos en la cuenta real que la forma de facturar (bundle "Mensualidad",
  ITBMS, sub-clientes) **funciona como necesitamos**.
- 🔜 Falta construir la **automatización** (fases 2 a 8).

---

## 10. Seguridad

- Las credenciales de conexión se guardan de forma **cifrada y privada**; no
  quedan visibles en la aplicación ni para los usuarios.
- La conexión solo la usa el sistema; nadie del público puede acceder a ella.

---

## ¿Preguntas?

- **Sobre facturación, ITBMS, cuentas o el módulo fiscal** → Contabilidad +
  equipo de sistemas.
- **Sobre el flujo de contratos y la entrega de equipos** → Administración +
  equipo de sistemas.

Podemos arrancar la base (Fase 2) de inmediato; las respuestas del punto 7
destraban las fases siguientes.

# Integración con QuickBooks — Resumen para el equipo

> **Para:** Contabilidad y Administración
> **De:** Equipo de sistemas
> **Fecha:** 2 de julio de 2026 (v5)
> **Estado:** Conexión lista ✅ · Automatización en construcción

Este documento explica, sin tecnicismos, qué vamos a hacer al conectar nuestro
sistema de contratos y órdenes (la aplicación en *app.cecomunica.net*) con
**QuickBooks Online**, por qué lo hacemos y qué cambia para cada quien.

---

## 1. En una frase

Vamos a lograr que **las facturas se creen y se mantengan al día solas** en
QuickBooks: **una factura por cliente**, con el **detalle de los equipos agrupado
por contrato**, y con la **información de clientes y pagos sincronizada** entre la
app y QuickBooks.

> **Importante — alcance:** esto aplica **solo a contratos nuevos**. Los contratos
> que ya existen (legacy) **se siguen facturando como hoy** (manual en QuickBooks);
> no cambian. En el futuro se podría migrar los viejos, pero por ahora no.

---

## 2. El problema que resolvemos hoy

- **La facturación mensual se arma a mano.** Toma tiempo cada mes y abre la puerta
  a errores u omisiones.
- **No hay un sustento claro de lo que se cobra.** Cuesta responder "¿qué equipos
  exactamente le estoy facturando a este cliente y de qué contrato salieron?".
- **La información se escribe dos veces** (cliente en la app y otra vez en QuickBooks).

---

## 3. La solución, en palabras simples

- Cada **cliente** de la app tendrá su ficha de **Cliente** en QuickBooks, y se le
  emite **una sola factura mensual** (no una por contrato).
- **No usamos "sub-clientes".** El **detalle por contrato va dentro de la factura**
  (agrupado y subtotalizado por contrato), así se ve qué corresponde a cada uno sin
  multiplicar fichas en QuickBooks.
- **El sustento de la factura es el registro de equipos del cliente.** Cada equipo
  (por su número de serie) sabe **a qué contrato pertenece, su tarifa, desde cuándo
  y de dónde vino**. Ese registro es la **fuente de la factura**: se cobra lo que
  hay registrado como activo.
- El **contrato manda**: define qué se vendió y a qué precio, y **autoriza** los
  equipos. Si lo registrado no cuadra con lo acordado, el sistema **avisa**.
- La facturación de un equipo **arranca cuando se entrega** al cliente — no cuando
  se firma o aprueba el contrato. Si arranca a mitad de mes, la primera factura es
  **proporcional a los días** (prorrateo).
- Los **pagos** registrados en QuickBooks se reflejan **de vuelta en la app**.

---

## 4. Lo que encontramos en nuestro QuickBooks (buenas noticias)

Revisamos la cuenta real de **CE COMUNICA** y casi todo lo que necesitamos ya existe:

- ✅ Ya se factura con las partidas **"Mensualidad - [modelo]"** (ej. *Mensualidad -
  PD78X*). El sistema usará **esas mismas partidas** — no cambia cómo se ve la factura.
- ✅ El **ITBMS 7% ya está configurado** correctamente.
- ✅ La **mayoría de los clientes ya tienen su RUC** registrado.

La integración se acopla a **cómo ya trabajan**.

---

## 5. Qué cambia en el día a día

### Para **Administración**
- **Ya no se arma la factura mensual a mano**; el sistema la prepara. La labor pasa
  a ser **revisar y confirmar**.
- Es clave **registrar bien la entrega y los seriales de los equipos**, porque ese
  registro es el **sustento de lo que se cobra**.
- Menos doble digitación: el cliente y el contrato se cargan una sola vez.

### Para **Contabilidad**
- Las facturas llegan a QuickBooks ya con el **ITBMS**, las **partidas de
  mensualidad** y las **cuentas de ingreso** correctas.
- La **conciliación de pagos** es más fácil: el estado de pago se ve también en la app.
- **El paso de factura fiscal no cambia** (ver punto 6).

---

## 5.1 Cómo se arma la mensualidad (automático)

La mensualidad de cada equipo se compone de **alquiler + mantenimiento** (y
**frecuencia**, si el equipo la usa). Hoy ese reparto se hace a mano; con la
integración será automático:

- En un **panel administrativo** se define, **una sola vez por modelo**, el valor de
  **alquiler** (y de **frecuencia** si aplica). Configurable.
- El **vendedor solo escribe la mensualidad negociada** del equipo.
- El sistema calcula el resto tras bastidores (alquiler fijo + frecuencia fija +
  mantenimiento = lo que sobra). **El vendedor no ve el desglose**; sí Administración
  y Recepción.
- **En la factura el cliente ve una sola línea** por equipo; el desglose queda interno
  en las cuentas contables correctas.

**Otros cargos mensuales:**
- Si un cargo es **por equipo** (p. ej. GPS o consola de un radio) → va **incluido en
  la mensualidad de ese equipo** (arranca y termina con él).
- Si es un **cargo plano del contrato** (p. ej. una cuota mensual) → va como una
  **línea de cargo del contrato**, con su fecha de inicio/fin.
- Los **cargos únicos** (activación, instalación) se cobran **una sola vez**.

### Impuesto (ITBMS)
Se aplica **ITBMS 7%** o **Exento** según cómo esté marcado **cada cliente**.

### Cuándo se factura
- Las facturas se **emiten el 1.º de cada mes** y cubren el mes completo.
- Si un equipo arranca a mitad de mes (al entregarse), la **primera factura es
  proporcional** a los días (mensualidad ÷ 30 × días).

## 5.2 Registro de equipos y protección de datos (importante)

Como la factura sale del **registro de equipos**, ese registro debe ser confiable:

- El **número de serie y el modelo** de un equipo **que se está facturando quedan
  protegidos**: **no se cambian con un clic** en el módulo POC.
  - Un **cambio de serial** (equipo dañado o serie mal digitada) se hace por el
    **flujo de "solicitud de cambio de serial"** (ya existe): Recepción lo pide,
    Inventario lo reemplaza y queda en el historial.
  - Un **cambio de modelo** es una **enmienda del contrato** (no una edición suelta).
- **Los equipos que NO se facturan (legacy) mantienen la flexibilidad de siempre:**
  en POC se pueden editar serial/modelo libremente, porque no hay factura que
  proteger. *(Hoy POC permite editar todo; el ajuste es limitar esa edición solo
  para los equipos que sí se facturan.)*

Así POC sigue siendo flexible para lo operativo (grupos, SIM, programación) y para
el legacy, pero **lo que sostiene una factura no se altera por accidente**.

**Equipos refurbished (la "R"):** hoy se manejan como "dos modelos" (ej. *PD78X* y
*PD78X R*) porque en QuickBooks el equipo refurbished lleva **costo contable 0** y el
nuevo su **costo real (landed)**. Eso **no cambia en QuickBooks** — las dos partidas
se quedan tal cual, cada una con su costo. Lo que cambia es en la app: el modelo será
**uno solo** y la condición ("nuevo" o "refurbished") será un **dato del equipo**. El
sistema apunta a la partida correcta de QuickBooks según la condición. Así un radio
conserva su historia completa aunque pase de nuevo a reacondicionado, y no se
duplican tarifas ni catálogos por cada variante "R".

## 5.3 Panel de facturación (para quien factura)

La emisión es **automática**, pero habrá un **panel** para tener control sin aprobar
factura por factura:

- **Próximo a facturar:** ver, días antes del corte, qué se va a facturar el 1.º.
- **Poner "en espera":** sacar un contrato del ciclo (disputa o algo pendiente).
- **Red de seguridad:** si el monto se **dispara** respecto al mes anterior, se
  **retiene solo** y va a revisión.
- **Facturado:** lo emitido, con **estado de pago** y enlace a QuickBooks.
- **Reintentar / facturar puntual:** para casos sueltos.
- **Ajuste puntual:** **descuento o cargo único** a la próxima factura (con motivo).

Las **anulaciones y notas de crédito** se hacen en **QuickBooks**, no en el panel.

## 5.4 Cancelación de equipos (bajas)

Un contrato activo **no se edita "a mano"**; la baja es un **procedimiento controlado**:

1. El cliente envía su **nota de cancelación**.
2. **Vendedor o Recepción** registran la solicitud: qué equipos y el **término**
   (*fin de mes*, *+30*, *+60*, *otro*) y **adjuntan la nota**.
3. Entra a la cola **"Cancelaciones pendientes"**.
4. **Administración aprueba**; el sistema deja de facturar **esos equipos** según el
   término (el último tramo, proporcional). Cada equipo se cierra por su cuenta —
   no hay que "partir" nada.

- **No se generan notas de crédito desde la app** (manual si hace falta).
- La **Tasa de Cancelación**, si aplica, se cobra **aparte**.
- Cada contrato muestra su **"Historial de bajas"** con documentos adjuntos.

## 6. El módulo de facturación fiscal (importante)

La **factura fiscal** se seguirá generando **manualmente, igual que hoy**, a partir
de la factura ya creada en QuickBooks. La integración **no reemplaza** ese paso; sí
asegura que la ficha del **Cliente** en QuickBooks tenga el **RUC/DV** correcto.

---

## 7. Lo que necesitamos decidir (preguntas para el equipo)

**Ya definido:** una **factura por cliente** (sin sub-clientes) · prorrateo ÷ 30 ·
emisión el **1.º de cada mes** · la baja se factura hasta su término · **solo
contratos nuevos** · el registro de equipos es el sustento de la factura.

**Falta confirmar** (Contabilidad/Administración):

1. **Reportes por contrato:** ¿quieren ver ingresos separados por contrato (usando
   las "clases" de QuickBooks dentro de la factura del cliente)?
2. **Pagos de vuelta:** ¿solo "pagado/pendiente", o también número de factura y saldo?
3. **Tabla de tarifas de alquiler por modelo:** validar los valores (alquiler/frecuencia).
4. **Equivalencia de modelos:** confirmar el nombre de cada modelo en QuickBooks vs. la app
   (incluyendo las variantes **"R"** de refurbished, que en la app serán el mismo modelo
   con condición "refurbished").
5. **Factura fiscal:** confirmar que el módulo fiscal toma bien el **RUC del Cliente**.
6. **Alerta de descuadre:** qué hacer cuando los equipos registrados **no cuadran**
   con la cantidad acordada en el contrato (solo avisar, o retener la factura).

---

## 8. Cómo lo haremos (por fases, sin frenar la operación)

| Fase | Qué se hace | Resultado visible |
|---|---|---|
| 1. Conexión | Enlace seguro con QuickBooks | **✅ Hecho** |
| 2. Base | Registro de equipos facturables (con datos protegidos) + panel de tarifas por modelo | Listo para facturar |
| 3. Clientes | Crear/actualizar fichas de Cliente (con RUC) | Clientes sincronizados |
| 4. Contratos + 1ra factura | Activación al entregar equipos + primera factura (prorrateada) al Cliente | Facturación arranca sola |
| 5. Mensualidad | Facturación mensual automática (una por cliente) | Cada mes se factura solo |
| 6. Panel de facturación | Próximo a facturar, en espera, alertas, ajustes | Control visual de la emisión |
| 7. Cancelaciones | Solicitud de baja, aprobación, control e historial | Bajas ordenadas |
| 8. Pagos | Traer el estado de pago a la app | Cobro visible en un lugar |

Cada fase se **prueba** antes de pasar a la siguiente.

---

## 9. Estado actual

- ✅ La **conexión con QuickBooks** ya está hecha y verificada (cuenta CE COMUNICA).
- ✅ Confirmamos que la forma de facturar (bundle "Mensualidad", ITBMS) **funciona
  como necesitamos**.
- ✅ Ya existe el **emparejamiento de clientes** app ↔ QuickBooks (a nivel de cliente).
- 🔜 Falta construir la **automatización** (fases 2 a 8).

---

## 10. Seguridad

- Las credenciales de conexión se guardan **cifradas y privadas**; no quedan visibles
  en la aplicación ni para los usuarios.
- La conexión solo la usa el sistema.

---

## ¿Preguntas?

- **Facturación, ITBMS, cuentas, módulo fiscal** → Contabilidad + sistemas.
- **Flujo de contratos y entrega de equipos** → Administración + sistemas.

# Carta de portada — Integración con QuickBooks

> Email para adjuntar `PLAN_QUICKBOOKS_EQUIPO.md`.
> Reemplazar los campos entre [corchetes] antes de enviar.

---

**Asunto:** Integración de contratos con QuickBooks — resumen y decisiones que necesitamos

**Para:** [Nombre del contador], [Nombre de la gerente administrativa]
**CC:** [opcional]

---

Estimados [nombres]:

Estamos por conectar nuestro sistema de contratos y órdenes (la aplicación
*app.cecomunica.net*) con **QuickBooks Online**, con el objetivo de que **las
facturas de los contratos se generen y se mantengan al día automáticamente**, con
el **desglose por contrato** que hoy no tenemos.

Adjunto un documento corto y sin tecnicismos que explica el proyecto. Aquí va el
resumen en tres puntos:

1. **Qué resuelve.** Hoy un cliente con varios contratos se ve "todo junto" en
   QuickBooks y la mensualidad se arma a mano. Con esto, cada contrato tendrá su
   propio detalle y la facturación mensual será automática. *Importante: aplica
   solo a **contratos nuevos**; los actuales se siguen facturando como hoy.*

2. **Buenas noticias.** Revisamos nuestra cuenta real de QuickBooks y confirmamos
   que **la integración se acopla a cómo ya trabajamos**: usará las mismas
   partidas de "Mensualidad - [modelo]" que ya usan, el ITBMS 7% ya está
   configurado, y el método de "sub-clientes" propuesto ya se usa en la cuenta. El
   paso de **factura fiscal seguirá siendo manual, igual que hoy**.

   La mensualidad se seguirá descomponiendo en **alquiler + mantenimiento** (y
   frecuencia cuando aplique) en las cuentas contables de siempre; el **cliente
   verá una sola línea** en su factura, sin el desglose.

3. **Qué necesitamos de ustedes.** Ya definimos varias reglas (prorrateo ÷30,
   emisión el 1.º de mes). Faltan estas confirmaciones:
   - **Reportes por tipo de contrato:** ¿les interesa ver los ingresos separados
     por tipo de contrato (usando "clases" de QuickBooks)? *(Contabilidad)*
   - **Pagos:** qué información traer de vuelta a la app (¿solo pagado/pendiente, o
     también número de factura y saldo?). *(Contabilidad)*
   - **Factura fiscal:** confirmar que el módulo fiscal toma el RUC del campo
     estándar de QuickBooks. *(Contabilidad)*
   - **Tarifas de alquiler por modelo:** validar la tabla de valores de alquiler
     que cargaremos en el panel administrativo. *(Administración/Contabilidad)*

El trabajo se hará **por fases y probando cada una**, sin interrumpir la
facturación actual. La conexión técnica ya está lista; lo siguiente depende de
estas definiciones.

¿Podemos coordinar una reunión corta de [30 minutos] esta semana para revisar el
documento y cerrar estos puntos? Quedo atento a su disponibilidad.

Saludos,

[Tu nombre]
[Cargo]
CE COMUNICA

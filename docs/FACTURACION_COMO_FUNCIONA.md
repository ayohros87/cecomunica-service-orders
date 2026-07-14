# Cómo funciona el módulo de Facturación

> Guía legible (no técnica) del ciclo de facturación y su conexión con QuickBooks.
> Para administración, contabilidad y operaciones. Última actualización: 2026-06-24.

---

## 1. Para qué sirve

El objetivo es **generar las facturas mensuales de los contratos de alquiler de forma
automática hacia QuickBooks**, con el **desglose por contrato** que hoy es difícil de
mantener a mano. La cobranza se sigue trabajando en QuickBooks; este módulo se encarga
de **decidir qué se factura, a quién, cuándo y por cuánto**, y de mandarlo a QBO.

Hoy el módulo está en etapa de **preparación**: están listos los catálogos, el match de
clientes, la activación y el cálculo. **Todavía NO se emiten facturas** — eso es el último
paso (ver §8).

---

## 2. El ciclo completo, de un vistazo

```
  Contrato aprobado
        │
        ▼
  Se ENTREGAN los equipos  ──►  (señal: "entrega confirmada")
        │
        ▼
  ACTIVACIÓN de facturación  ──►  contabilidad revisa y activa (con fecha de inicio)
        │                          requisitos: contrato vigente + mapeo a QuickBooks
        ▼
  CÁLCULO mensual            ──►  prorrateo ÷30 + desglose + ITBMS  (hoy: solo vista previa)
        │
        ▼
  EMISIÓN a QuickBooks       ──►  (PRÓXIMO) crea la factura bajo el cliente correcto
```

Idea central: **la facturación NO arranca sola con un evento operativo.** Arranca cuando
alguien la **activa explícitamente**, apoyado en varias señales. Esto evita facturar de
más (por una entrega que era una reparación) o de menos (equipo en la calle que nadie
puso a facturar).

---

## 3. Los catálogos (la base)

Antes de facturar, el sistema necesita saber **precios y cómo se mapea cada cosa a
QuickBooks**. Eso vive en el hub de **Facturación** (solo administración y contabilidad):

- **Equipos y Tarifas** — cada modelo de radio con su **tarifa de alquiler** y su vínculo a
  los ítems de QuickBooks (el ítem "Alquiler" y el bundle "Mensualidad"). Aquí también se
  define el **desglose**: la mensualidad de cada equipo se reparte en **alquiler + frecuencia
  + mantenimiento** (el cliente ve una sola línea; por dentro son 3 cuentas).
- **Piezas y Tarifas** — repuestos con precio de venta, costo y su ítem de QuickBooks.
- **Cargos de facturación** — activación, instalación y otros conceptos.

Se pueden **importar desde QuickBooks** (equipos, piezas) y **proponer el mapeo**
automáticamente; contabilidad revisa y aprueba.

---

## 4. Clientes ↔ QuickBooks

Para facturar, cada cliente del sistema debe estar **vinculado a su cuenta (Customer) en
QuickBooks**. La página **Clientes ↔ QuickBooks** propone el match por **RUC y nombre**, y
contabilidad confirma.

Realidad encontrada en QuickBooks (509 cuentas): hay clientes con **varias cuentas**. Tres
casos:
1. **Misma empresa, varias cuentas por sitio/sucursal** (legítimo — ej. un grupo con varias
   sedes). → Se elige la cuenta correcta para cada uno.
2. **Mismo RUC en empresas distintas** (error de RUC). → La página **avisa "RUC coincide /
   nombre distinto"** para no vincular por error.
3. **Duplicados/basura** (typos, cuentas repetidas). → Se listan en **"Duplicados QBO"** para
   limpiarlos (fusionar) en QuickBooks.

Decisión: por ahora **un cliente ↔ una cuenta** (1-a-1); la limpieza de duplicados se hace
en QuickBooks aparte.

---

## 5. Activación de facturación

Es el corazón del módulo. La página **Activación de facturación** clasifica cada contrato:

- **Pendientes** — les falta algo **requerido**: estar **vigente** (activo/aprobado) o tener
  el **mapeo a QuickBooks** completo.
- **Listos** — cumplen los requeridos → se pueden **activar** (con su fecha de inicio).
- **Activos** — ya están facturando.
- **En espera** — excluidos del ciclo a propósito.
- **No facturables** — contratos que **no facturan** (ej. demo).

Cada contrato muestra una **lista de verificación** con chips:
- **Requerido (bloquea):** vigente · mapeo QuickBooks.
- **Recomendado (no bloquea, sale en amarillo):** entrega confirmada · seriales asignados ·
  contrato firmado.

> La **entrega de equipo NO es requisito** porque hay contratos que no la llevan
> (renovaciones, contratos de servicio). Es una **señal recomendada** que pre-llena la fecha
> de inicio.

**La activación es manual** (contabilidad confirma) y queda **auditada** (quién y cuándo).
Hay un interruptor opcional de **auto-activación** para que la corrida diaria active sola los
que estén "Listos" — apagado por defecto.

Cuando no hubo una orden de entrega formal, recepción/contabilidad puede **confirmar la
entrega a mano** desde la misma página.

---

## 6. El cálculo de la factura

Una vez activo, el sistema sabe calcular la factura del mes. La opción **"Vista previa
factura"** (en los contratos Activos) muestra exactamente lo que se facturaría, **sin tocar
QuickBooks todavía**:

- **Prorrateo ÷30:** si el equipo se entregó a mitad de mes, se cobra solo los días
  correspondientes (días ÷ 30). Mes completo = factor 1.
- **Desglose:** cada línea se reparte en **alquiler / frecuencia / mantenimiento**.
- **Cargos recurrentes** del contrato.
- **ITBMS:** según el cliente (gravado o exento).

Sirve para que contabilidad **valide los números** antes de emitir de verdad.

---

## 7. Alertas (red de seguridad)

Una **revisión diaria** (7:00 AM) detecta dos problemas y, si los hay, manda un correo a
administración/contabilidad:

- **Fuga de ingresos:** un contrato está **listo pero nadie lo activó** después de 7 días
  (equipo en la calle sin facturar).
- **Falso arranque:** un contrato está **facturando sin entrega ni serial** registrados.

Hay un interruptor **"Alertas por correo"** para apagarlas mientras todavía no se factura
(hoy están **apagadas**).

---

## 8. Emisión a QuickBooks (PRÓXIMO — aún no implementado)

El último paso será **crear la factura en QuickBooks**: bajo el cliente vinculado, creando
un **sub-cliente para el contrato** (eso da el desglose por contrato), con el bundle
"Mensualidad" y los cargos.

Se hará con cuidado: primero **manual y sin enviar** (para revisar en QBO y borrar si algo
está mal), validando en el **ambiente de prueba** antes que en producción. Recién cuando
cuadre, se prende la **emisión automática el 1.º de cada mes**.

---

## 9. Quién hace qué

| Rol | Responsabilidad en facturación |
|---|---|
| **Contabilidad** | Catálogos (tarifas, mapeo QBO), vincular clientes, **activar** contratos, validar el cálculo |
| **Administración** | Igual que contabilidad + supervisión |
| **Recepción** | Confirmar entregas, capturar seriales |
| **Vendedor** | Crear el contrato; capturar/jalar seriales |
| **Inventario** | Registrar equipos en POC (de ahí se jalan los seriales) |

---

## 10. Conceptos y decisiones clave

- **Activar = decisión explícita y fechada**, no un evento automático. Más confiable.
- **Entrega = recomendada, no requisito** (hay contratos sin entrega de equipo).
- **`No facturable`** para demos y contratos que no cobran → quedan fuera del ciclo y de
  las alertas.
- **Desglose** (alquiler/frecuencia/mantenimiento): el cliente ve una línea; QuickBooks la
  reparte en 3 cuentas internas.
- **Seriales** del contrato: identidad durable del equipo; se jalan de POC/órdenes. Semilla
  de un futuro **registro de equipos**.
- **Solo contratos nuevos** entran a este flujo; los viejos se siguen facturando como hoy.

---

## 11. Estado actual

| Pieza | Estado |
|---|---|
| Conexión con QuickBooks (lectura) | ✅ |
| Catálogos (Equipos, Piezas, Cargos) + importar/mapear | ✅ |
| Clientes ↔ QuickBooks (match) | ✅ |
| Activación (manual, por excepción) | ✅ |
| Alertas (con interruptor) | ✅ (apagadas por ahora) |
| Cálculo / vista previa de factura | ✅ |
| **Emisión a QuickBooks** | ⏳ próximo paso |
| Emisión automática mensual | ⏳ después |
| Estado de pago de vuelta (webhooks) | ⏳ después |

---

## 12. Glosario rápido

- **Customer (QuickBooks):** la cuenta del cliente en QBO.
- **Sub-customer / Job:** una cuenta "hija" bajo el cliente; aquí representa el **contrato**.
- **Bundle "Mensualidad":** ítem de QBO que agrupa el desglose de un modelo.
- **Prorrateo ÷30:** cobrar solo los días activos del mes (día = 1/30 de la mensualidad).
- **ITBMS:** impuesto; 7% o exento según el cliente.
- **Readiness:** la lista de verificación que dice si un contrato está listo para facturar.

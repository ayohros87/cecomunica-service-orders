# Reemplazos y Renovaciones — Explicación sencilla de la propuesta

**Para:** Dirección y áreas involucradas (Ventas, Bodega, Recepción/Activaciones, POC/Taller)
**Fecha:** 2026-07-01

Este documento explica, **sin tecnicismos**, cómo proponemos ordenar el proceso de reemplazos y renovaciones de equipos, y por qué.

---

## El problema, en simple

Hoy, cuando un cliente **renueva** o **reemplaza** equipos, el sistema no sabe con claridad **qué tenía antes**:

1. **Contratos viejos (legacy):** muchos contratos de años anteriores existen en papel o históricos, pero **no están cargados** en el sistema.
2. **Contratos sueltos:** una renovación se crea como un contrato nuevo que **no apunta** al contrato original. Las adiciones tampoco. No hay forma de decir "esta renovación viene de aquel contrato".

Resultado: al renovar o reemplazar, cuesta saber qué equipos salen, cómo estaban programados y a qué contrato pertenecían. Se hace manual y se cometen errores (radios mal configurados, series equivocadas).

---

## La idea central (una frase)

> **En vez de depender del contrato viejo, nos apoyamos en el REGISTRO DE EQUIPOS del cliente (la Base de Datos POC), que sí sabe qué tiene el cliente hoy.**

Piénsalo así: el **contrato** es el "papel de la venta". El **equipo** (radio, con su serial y su programación) es lo que el cliente realmente usa. Nosotros ya tenemos un registro de esos equipos por cliente (POC). Ese registro **existe aunque el contrato viejo no esté en el sistema**.

Entonces el reemplazo/renovación se vuelve simple: **"este equipo sale → este equipo entra"**, tomando la información del equipo que ya está registrado, no del contrato viejo.

---

## Cómo se vería por área

- **Ventas:** al crear un reemplazo/renovación, elige los equipos que salen **de una lista del cliente** (los que ya tiene registrados), en vez de escribirlos a mano. Indica el motivo.
- **Bodega:** asigna los seriales nuevos por modelo (como ya lo hace hoy) y, al confirmar, esos equipos quedan **reservados a ese contrato** y **vinculados** al equipo que reemplazan.
- **POC / Taller:** al ejecutar, el sistema le muestra **cómo estaba programado el equipo que sale** (grupos, SIM, etc.), para no reconfigurar a ciegas. Queda registrada la relación "equipo viejo → equipo nuevo".
- **Recepción/Activaciones:** abre la orden de servicio ya ligada al contrato y recibe los avisos automáticos en cada paso. (La corrección de un serial mal digitado o dañado **ya quedó lista** en una entrega reciente.)
- **Dirección:** obtiene trazabilidad real: qué equipo reemplazó a cuál, bajo qué contrato, y qué equipos están **pendientes de devolución**.

---

## Cómo resolvemos los contratos viejos (legacy)

No hay que cargar todo el historial de papel de golpe. Hay tres situaciones:

1. **El equipo ya está registrado en el sistema:** todo fluye normal, aunque el contrato viejo no esté.
2. **El equipo está registrado pero el contrato es viejo/no está:** funciona igual; solo se anota una **referencia** del contrato en papel (número/fecha) para el registro.
3. **El equipo no está registrado (caso más viejo):** en ese momento el sistema permite **darlo de alta rápido** (serial, modelo, programación básica). Así el reemplazo se convierte en la oportunidad de **ir poniendo al día** los equipos, poco a poco y solo cuando hace falta.

**En pocas palabras:** el legacy se regulariza **sobre la marcha**, sin un proyecto de migración enorme.

---

## Cómo conectamos los contratos entre sí

- A partir de ahora, cada renovación/reemplazo/adición puede **apuntar a su contrato original** (o marcarse como "viene de un contrato viejo/externo").
- El sistema incluso **propone** cuál es el contrato original (mirando el cliente y los equipos que salen), y una persona **confirma**. Para lo histórico se hace mediante una **lista de revisión**: el sistema sugiere, un administrador aprueba o marca "legacy". **No se conecta nada automáticamente sin revisión.**

---

## Beneficios

- **Menos errores** al renovar/reemplazar (se ve la programación del equipo que sale).
- **Trazabilidad completa:** de cada radio se sabe su historia (a quién reemplazó, bajo qué contrato).
- **Control de devoluciones:** un contrato no se cierra si faltan equipos por devolver.
- **Funciona con el legacy** sin frenar la operación ni exigir cargar todo el pasado.
- **Datos que se ordenan solos** con el tiempo: cada operación deja el registro más completo.

---

## Cómo se implementaría (por etapas)

Lo haremos **por fases**, de menor a mayor riesgo, entregando valor en cada una:

1. **Base:** preparar el registro de equipos y una **vista única "Equipo del cliente"** (qué tiene y bajo qué contrato).
2. **Puesta al día:** conectar lo conectable e iniciar la lista de revisión de contratos históricos.
3. **Ventas:** elegir los equipos que salen desde el registro (con opción de dar de alta el que falte) + reserva en Bodega.
4. **Ejecución:** el mapeo "equipo viejo → nuevo" con propuesta automática en renovaciones.
5. **Órdenes:** orden de servicio ligada al contrato + regla de cierre.
6. **Devoluciones y avisos:** control de equipos por devolver + notificaciones en cada paso.
7. **Reporte** de equipos pendientes de devolución.

---

## Qué ya está hecho

- La **corrección de seriales** (cuando hay un error humano o un equipo defectuoso): Recepción solicita el cambio, le llega a Bodega/Inventario, se reemplaza de forma controlada y queda en el historial. **Ya está en producción.**

---

## Decisiones tomadas

1. Nos apoyamos en el **registro de equipos (POC)** como fuente de verdad.
2. El legacy se **digitaliza en el momento** en que se necesita.
3. Los contratos históricos se conectan mediante una **lista de revisión** (el sistema sugiere, una persona confirma).

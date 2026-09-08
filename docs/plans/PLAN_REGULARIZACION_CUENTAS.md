# Regularización de cuentas — deuda visible, gestiones que no traban

**Estado:** F1, F2 y F3 implementadas y desplegadas el 2026-09-08 (commit
692a211): módulo compartido `domain/regularizacion.js`, job diario 06:50 +
barrido de marcadas cada 10 min, chip/panel/banda/estampa en la ficha, menú
por intención, precarga del plan por serial, señales del home y bandeja
`clientes/regularizacion.html`. **Pendientes:** F0 (dar vendedor a las 57
cuentas sin dueño — se hace desde la bandeja), F4 (asistida de las 5 grandes),
el párrafo ámbar en los correos de gestiones (gestiones.js estaba en vuelo en
otra sesión) y calibrar umbrales con datos (§9). Ajuste al plan: D7 (por
clasificar) es cola de bodega → cuenta puntos pero lleva etiqueta `migracion`
y no sube la escalera. Fecha del plan: 2026-09-08.
**Origen:** Elvia no encontraba "contrato temporal" para el Municipio de Arraiján
(2026-09-07). Al revisar el menú de gestiones salió la pregunta de fondo de
Alberto: qué pasa con las cuentas que no tienen los seriales ni los contratos
bien registrados y aun así necesitan una gestión. No se quiere trabar al
vendedor, pero sí empujar a regularizar.
**Censo:** corrido el 2026-09-08 en solo lectura con
`functions/scripts/censo-regularizacion.js` (desde `functions/` vía PowerShell
con `NODE_PATH`; no escribe nada).

---

## 1. Principio

> Nunca trabar, siempre estampar, y cada gestión puntual paga parte de la deuda.

- **Nunca trabar.** Toda gestión sobre una cuenta con deuda sale: reemplazo,
  aumento, temporal, demo, baja, ajuste. Los candados duros que hoy protegen
  datos siguen donde están (firma antes de entregar, factura antes de entregar
  en Propio, serial saliente en reemplazo).
- **Siempre estampar.** La gestión, su expediente, el correo y el aviso a
  facturación dicen "cuenta por regularizar" con el nivel y los números. Ya se
  hace para la adenda en papel; se generaliza.
- **Cada gestión paga.** Lo que el vendedor declara en una gestión puntual
  (seriales que el cliente tiene, el serial saliente de un reemplazo) queda
  escrito y baja la deuda. Regularizar del todo se vuelve más barato mientras
  más gestiones hicieron, porque el plan por serial arranca precargado.
- **La deuda tiene dueño y número.** Un solo indicador por cuenta, visible en
  la ficha, en el home del vendedor asignado y en una bandeja de gerencia.

## 2. Lo que dice el censo (2026-09-08)

La deuda es de **migración**, no de vendedores descuidados. Hay solo 16
gestiones registradas en todo el sistema, así que hoy ninguna "escalera" por
abuso dispararía; lo que empuja es la visibilidad.

| Medida | Valor |
|---|---|
| Cuentas con contratos o radios en campo | 238 |
| Cuentas con alguna deuda | 204 |
| Radios `en_cliente` sin contrato interno (D1) | 1,261 |
| Contratos vigentes con seriales `legacy` (D2) | 247 (236 con líneas de equipos) |
| Contratos vigentes con seriales `pendiente` (bodega, NO es deuda) | 4 |
| Contratos vigentes con origen en papel (D3) | 14 |
| Adendas a contrato en papel (D4) | 1 |
| REEMP sin serial saliente identificado (D5) | 2 |
| Sobrantes de conciliación (D6) | 0 |
| Cuentas con radios en campo y SIN contrato vigente | 73 |

**Por vendedor asignado (cuentas con deuda):** sin vendedor 57 · Elvia 55 ·
Alondra 37 · Zuleika 33 · Salomón 18 · otros 4.

**Distribución por tamaño:** 93 cuentas con 1–2 puntos · 46 con 3–5 · 27 con
6–10 · 38 con 11 o más. Las cinco más grandes concentran 325 radios: SEPROSA
(120), Colón Container Terminal (102), Ministerio de Cultura (38), Instituto
Alberto Einstein (36), Balboa Logistics (29). Arraiján tiene 3 puntos: tres
contratos `legacy` sin seriales.

Dos lecturas que cambian el plan:

1. **57 cuentas con deuda no tienen vendedor.** Sin dueño no hay a quién
   mostrarle nada. Es la primera acción y es administrativa (F0).
2. **La cola larga es corta.** 139 cuentas tienen 5 puntos o menos: se
   regularizan en una renovación normal con el plan por serial precargado. Las
   38 grandes necesitan regularización asistida por admin (script de custodia
   por órdenes, ya probado con SEPROSA), no un wizard.

## 3. Definición exacta de la deuda

Se calcula por cuenta (`clientes/{id}`) con campos que ya existen. Cada
componente tiene un nombre, una consulta y un peso.

| Código | Qué es | De dónde sale | Peso |
|---|---|---|---|
| D1 | Radios en campo sin contrato interno | `equipos_pool` con `estado = en_cliente`, `asignacion.cliente_id = cuenta` y sin `asignacion.contrato_doc_id` | 1 por radio |
| D2 | Contratos vigentes sin seriales declarados | `contratos` con `estado ∈ {activo, aprobado}`, tipo SERV/ALQ/PROP/REEMP, alguna línea con `cantidad > 0` y `seriales_estado = legacy` | 1 por contrato |
| D3 | Contrato marco en papel | contrato vigente con `origen_tipo = legacy` u `origen_legacy_ref` | 1 por contrato |
| D4 | Adenda a contrato en papel | `gestiones` tipo `aumento` con `aumento.contrato_papel` y sin `contrato_doc_id`, no anulada | 1 por adenda |
| D5 | Reemplazo sin serial saliente | contrato REEMP vigente con `reemplaza_seriales = []` | 1 por contrato |
| D6 | Sobrantes de conciliación | `contratos.regularizacion.sobrantes > 0` | 1 por unidad |
| D7 | "No lo tiene" sin clasificar | `equipos_pool` en `por_clasificar` con `ultima_asignacion.cliente_id = cuenta` | 1 por radio |

**No es deuda:** `seriales_estado = pendiente` (bodega debe asignar; ya tiene la
señal "Seriales por asignar"), radios `pendiente_devolucion` (tienen tiquete),
DEMO y TEMP (terminan por devolución y no cuentan para la cuenta).

**Nivel** (umbrales en `empresa/config`, valores iniciales):

| Nivel | Regla | Qué ve el vendedor |
|---|---|---|
| `al_dia` | puntos = 0 | Nada |
| `leve` | solo D3–D5, o D1 ≤ 2 y D2 = 0 | Chip gris "Detalle por regularizar (n)" |
| `por_regularizar` | D1 ≥ 3 o D2 ≥ 1 | Chip ámbar "Por regularizar · n" |
| `critica` | D1 ≥ 20, o radios en campo sin ningún contrato vigente | Chip rojo "Cuenta sin regularizar · n" |

**Dónde vive el resultado:** `clientes/{id}.regularizacion`:

```
{
  nivel, puntos,
  d1, d2, d3, d4, d5, d6, d7,
  etiqueta: 'migracion' | 'operativa',   // migracion = solo D2/D3 (cutover)
  gestiones_puntuales: n,                 // desde primera_marca_at
  primera_marca_at, ultima_gestion_puntual_at,
  vendedor_uid, vendedor_email,
  calculado_at
}
```

Se escribe desde Functions: un job diario (06:50, antes del recordatorio
operativo de 07:15) recalcula todas las cuentas, y un recálculo por cuenta con
debounce corre cuando cambia un contrato o una unidad del pool de esa cuenta.
El frontend **lee** este campo; nunca lo calcula por su lado. La lógica del
cálculo es un módulo compartido byte a byte front/back
(`functions/src/lib/regularizacion.js` = `public/js/domain/regularizacion.js`,
con el test de copia igual que `ModeloFamilia`), para que la ficha pueda
explicar "por qué" con la misma regla que el job.

## 4. Pantallas

### 4.1 Ficha del cliente (Centro)

- **Chip junto al nombre**, con el nivel y los puntos:
  "Por regularizar · 131 (120 radios sin contrato · 11 contratos sin seriales)".
  Clic abre un panel "Qué falta" con la lista por componente y, en cada fila,
  la acción que lo resuelve (§5).
- **La franja de señales deja de repetirlo.** Hoy la ficha dice "N equipos sin
  contrato formal" en una señal y el chip lo diría otra vez. La señal se
  convierte en la fila del panel; la franja queda para lo que vence y lo que
  está en taller.
- **Botón "Regularizar cuenta"** siempre arriba del menú de gestión cuando el
  nivel no es `al_dia` (§4.2).

### 4.2 Menú "Nueva gestión" (rediseño)

Depende de dos hechos y una excepción: ¿hay radios en campo?, ¿hay contrato
vigente?, ¿hay renovación en trámite? Mismo nombre para la misma intención en
todos los estados; lo que no aplica se esconde, no se deshabilita.

| Grupo | Nueva | Radios sin contrato | Consolidada / fragmentada | En trámite |
|---|---|---|---|---|
| Arriba, destacado | Nuevo contrato | Regularizar cuenta (contrato nuevo) | Regularizar cuenta (si hay deuda) | Ver renovación en trámite |
| Dar equipos | Temporal, Demo | Temporal, Demo | Agregar, Temporal, Demo | Temporal, Demo |
| Cambiar | – | Reemplazar | Reemplazar, Ajustar, Renovar* | Reemplazar, Ajustar |
| Retirar | – | Baja parcial | Baja parcial, Terminar | Baja parcial, Terminar |
| Pie discreto | – | Adenda en papel | – | – |

\* Renovar solo en ventana en cuenta consolidada; siempre en fragmentada porque
consolida. El predicado es el mismo que usa la señal de vencimiento.

Cotizar, Datos del cliente e Historial salen del menú a la cabecera de la
ficha, para los roles que ya los tienen. Edición masiva queda solo en el rail
de admin. Subtítulos de una línea o ninguno.

### 4.3 Wizards

- **Banda al abrir** cualquier wizard sobre una cuenta con deuda:
  "Esta cuenta está por regularizar (131). Esta gestión se registrará como
  puntual (#3)". Un solo renglón, sin bloquear.
- **Aumento** sobre cuenta con D1 > 0: paso "Radios que ya tiene" precargado
  con los D1, para incorporarlos al anexo (usa `es_regularizacion` y
  `regulariza_seriales`, que ya existen). El vendedor los marca o los deja.
- **Reemplazo**: ya exige el serial saliente. Si lo declara, D1 baja en uno.
- **Temporal y Demo**: no piden nada (no tocan la cuenta). Se estampan pero no
  cuentan como puntuales.
- **Baja parcial**: al declarar seriales que el cliente devuelve, D1 baja.

### 4.4 Expediente, correo y aviso a facturación

Estampa en la gestión: `cuenta_regularizacion: { nivel, puntos, puntual_n }`
al crearla. El expediente la muestra como chip; el correo de la gestión y el
aviso a facturación llevan el párrafo ámbar que hoy solo lleva la adenda en
papel ("Cuenta por regularizar: 120 radios sin contrato…"). Contabilidad y
gerencia lo ven en cada gestión sin entrar a la ficha.

### 4.5 Home

- **Vendedor:** señal "Mis cuentas por regularizar" (conteo por
  `SenalesService`, leyendo `clientes.regularizacion.vendedor_uid`), con lista:
  cuenta, nivel, puntos, última gestión puntual, botón "Abrir ficha". Es una
  fila de la bandeja de pendientes existente, con posponer y motivo.
- **Gerencia y admin:** señal "Cuentas por regularizar" global, ordenada por
  puntos y antigüedad, con filtro por vendedor y las sin vendedor arriba.

### 4.6 Bandeja "Regularización" (gerencia/admin)

Módulo aparte, como la bandeja de facturación: tabla cuentas × nivel ×
componentes × vendedor × gestiones puntuales × días desde la primera marca.
Acciones por fila: abrir ficha, asignar vendedor, posponer con motivo, marcar
"regularización asistida" (la toma admin con script). Sin montos: no es
información financiera.

## 5. Cómo se regulariza (el camino corto)

Hay un solo camino por componente, y la ficha lo ofrece en la fila del panel:

| Componente | Acción que lo cierra | Existe hoy |
|---|---|---|
| D1 radios sin contrato, cuenta con contrato vigente | "Regularizar cuenta" = renovación consolidadora con el plan por serial **precargado** con los D1 como "continúa" | Sí, el plan arranca vacío |
| D1, cuenta sin contrato vigente | "Regularizar cuenta" = contrato nuevo legacy que los cubre | Sí |
| D2 contrato legacy sin seriales | "Declarar seriales" abre el asignador de Almacén precargado con los D1 de la misma cuenta y `modelo_id` | Asignador sí; precarga no |
| D3 origen en papel | Se cierra solo al renovar | Sí |
| D4 adenda en papel | Se cierra al regularizar la cuenta (D1) | Sí |
| D5 REEMP sin saliente | "Confirmar serial saliente" desde el expediente | Sí (30 linajes esperan) |
| D6 sobrantes | "Agregar por anexo" o "liberar" | Sí |
| D7 por clasificar | Bandeja de por clasificar (bodega) | Sí |

La precarga es lo nuevo: el plan por serial de la renovación y el asignador
reciben la lista D1 de la cuenta. Todo lo que las gestiones puntuales
declararon ya está en el pool, así que la lista llega más corta cada vez.

**Cuentas grandes (11+ puntos, 38 cuentas):** regularización asistida. Admin
corre el script de custodia por órdenes por cuenta, revisa el diff, y el
vendedor confirma con el cliente. La bandeja las marca "asistida" para que el
vendedor no cargue con 120 seriales a mano.

## 6. Escalera, no candado

- La cuenta cuenta sus gestiones puntuales desde `primera_marca_at`.
- Umbrales en `empresa/config`: `regularizacion_max_puntuales` (3) y
  `regularizacion_max_dias` (90).
- Al superar cualquiera: la gestión **sigue saliendo**, pero (a) el expediente
  y el correo dicen "excede el margen sin regularizar", (b) gerencia recibe
  copia, (c) donde la gestión ya pasa por aprobación de gerencia (aumento,
  baja), la aprobación pide una nota "por qué no se regulariza aún".
- Las cuentas con etiqueta `migracion` (solo D2/D3) no suben la escalera: la
  deuda es de la empresa, no del vendedor.
- Con 16 gestiones en total, hoy no dispara. Se calibra con datos en F3.

## 7. Fases

| Fase | Qué | Esfuerzo |
|---|---|---|
| F0 | Asignar vendedor a las 57 cuentas sin dueño (edición masiva, admin). Mover el censo a `functions/scripts/censo-regularizacion.js` y dejarlo como reporte. | 1 día |
| F1 | Módulo `regularizacion.js` compartido + test de copia. Job diario + recálculo por cuenta. Chip y panel "Qué falta" en la ficha; la señal de la franja se funde. Estampa en gestiones, correos y avisos. Señal "Mis cuentas por regularizar" en el home del vendedor. | 3–4 días |
| F2 | Menú rediseñado (matriz §4.2), cabecera con Cotizar/Datos/Historial, "Regularizar cuenta" único. Plan por serial precargado con D1. "Declarar seriales" → asignador precargado. Banda en wizards. | 2–3 días |
| F3 | Bandeja "Regularización" para gerencia. Contador de puntuales, umbrales en config, escalera. Señal global en el home de gerencia. | 2 días |
| F4 | Regularización asistida de las 5 cuentas grandes con el script de custodia por órdenes (SEPROSA, Colón Container, Ministerio de Cultura, Einstein, Balboa). | asistida, por cuenta |

F1 sola ya cambia la conversación: el vendedor ve el número, gerencia lo ve
en cada correo. F2 es lo que hace barato pagar la deuda. F3 solo tiene sentido
cuando F1 lleva unas semanas y hay gestiones que contar.

## 8. Lo que no cambia y los riesgos

**No cambia:** ningún wizard nuevo; ningún trigger de contratos; los candados
de firma, factura y serial saliente; las reglas de Firestore para vendedor
(sigue viendo solo su cartera).

**Riesgos y cómo se cubren:**

- **Lecturas.** Calcular la deuda desde la ficha costaría cientos de lecturas
  por apertura (el tripwire está en 3,000/hora por usuario). Por eso el
  resultado vive en el doc del cliente y el home lee un campo.
- **Falsos positivos en D1.** Radios devueltos sin ENTRADA registrada siguen
  `en_cliente`. La conciliación semanal del pool ya los detecta; el panel
  "Qué falta" enlaza la fila a la bandeja de por clasificar en vez de
  culpar al vendedor.
- **Confundir `pendiente` con deuda.** Un contrato aprobado esperando a bodega
  no es deuda del vendedor. Queda fuera por definición.
- **Doble voz.** Chip, franja, señal del home y bandeja deben salir del mismo
  campo. Nada se calcula dos veces.

## 9. Decisiones para Alberto

1. **Umbrales** de nivel (D1 ≥ 3 / ≥ 20) y de escalera (3 puntuales / 90 días).
2. **Cuentas sin vendedor:** ¿se reparten en F0 o gerencia las toma como
   propias en la bandeja?
3. **Deuda de migración (D2/D3):** propuesta = cuenta y se muestra, pero con
   etiqueta y sin escalera. ¿O se excluye del chip del vendedor?
4. **Temporal y Demo:** propuesta = se estampan, no cuentan como puntuales.
5. **Bandeja de gerencia:** ¿ve también recepción (cobros), que hoy edita
   clientes? Propuesta: no en F3; se decide con uso.

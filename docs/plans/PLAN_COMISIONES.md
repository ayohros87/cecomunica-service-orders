# Comisiones — del check manual al expediente que se libera solo

**Estado:** **F0, F1 y F2 hechas y desplegadas** el 2026-09-10 (§9), con dos
puntos de la F2 movidos a la F4 (`venta_propio`) y a mejora aparte (el chip en
el Centro). **Pendientes: F3** (los dos amarres con QuickBooks — es trabajo de
contabilidad, no de código), **F4** (verificación automática del pago) y **F5**
(webhook). Las cinco decisiones abiertas quedaron resueltas por Alberto el
2026-09-10 (§11). Fecha del plan: 2026-09-10.

**Origen:** correo de Zuleika del 2026-09-10 con dos reclamos que resultaron
ser el mismo: (a) contratos firmados cuyo PDF **no aparece** en la gestión del
cliente, con cuatro ejemplos; (b) *"no tengo la opción o no veo la opción que
antes tenía, de que el contrato estaba listo de pago"*. Encima, la pregunta de
fondo de Alberto: **ya no manejamos todo por contrato**, así que reponer el
botón viejo sería reponer el error viejo.

**Proceso manual que Zuleika hace hoy**, para cada contrato, a mano: verificar
que entró el primer pago del cliente, que el cliente firmó, y que se
entregaron los equipos.

**Censo:** corrido el 2026-09-10 en solo lectura contra producción (scripts
efímeros con `NODE_PATH`, no escriben nada).

---

## 1. Los dos reclamos son uno solo

Zuleika no perdió un dato: perdió **la pantalla donde se ven los tres
requisitos juntos**. El módulo `/contratos/` pasó a ser archivo de consulta el
2026-09-09 (commit `6c207e3`) y sus 14 acciones de fila se mudaron al Centro
de gestión. Dos de ellas no llegaron:

- **"Ver el firmado (PDF)"** — se quedó en el archivo y nunca se agregó al
  Centro.
- **"Marcar listo para comisión"** — se retiró a propósito, porque el
  mecanismo era una mentira útil (§2.2).

Resultado: la persona que revisa comisiones tiene que saltar entre el Centro
(para el estado), el archivo (para el PDF) y QuickBooks (para el pago). Tres
pantallas para contestar una pregunta.

## 2. Diagnóstico con datos de producción (2026-09-10)

### 2.1 El firmado sí está — falta el enlace

Los cuatro casos del correo están **correctamente guardados**:

| Contrato | Cliente | Acción | Estado | `firmado` | PDF en Storage | `entrega_confirmada` |
|---|---|---|---|---|---|---|
| ALQ20260713-02 | AIR EUROPA | Renovación | activo | sí, 29-jul | sí | sí |
| ALQ20260619-02 | AGENCIA DE SEGURIDAD UNIDA | Adición | activo | sí, 23-jun | sí | sí |
| ALQ20260618-05 | AGENCIA DE SEGURIDAD UNIDA | Adición | activo | sí, 23-jun | sí | sí |
| ALQ20260601-02 | R. SMITH CORONADO | Renovación | activo | sí, 3-sep | sí | **no existe** |

Los cuatro tienen `firmado: true`, `firmado_url`, `firmado_storage_path`,
`firmado_por_uid` y `fecha_activacion`. El dato es impecable. Lo que falla es
la UI:

- `_accionesContrato()` (`public/js/pages/clientes-centro.js:3170-3174`) arma
  el grupo **Documentos** con *Ver el contrato* y *Documento completo*.
  `firmado_url` **nunca se pinta como enlace** en todo el Centro: aparece solo
  en el código que sube el archivo (`subirFirmadoContrato`, línea 1223) y en
  el guard `_puedeSubirFirmado`. El único sitio que lo abre es el archivo
  (`contratos-list.js:209`).
- El modal de vista previa (`verContrato`, línea 1025) escribe
  `Firmado: sí ✓ (firma digital)` — texto muerto, sin enlace.
- `_tramitesContrato()` (línea 2112) solo lista contratos
  `pendiente_aprobacion` o `aprobado && !firmado && <45 días`. **Apenas el
  contrato queda activo desaparece** de Gestiones con todo y su lista de
  pasos — justo lo que Zuleika quiere ver al revisar comisiones.
- `subir_firmado` se ofrece solo dentro de `if (esperaFirma)`, aunque
  `_aceptaFirmado()` contempla también `activo && !firmado_url`. Esa rama es
  **inalcanzable**: un contrato activo sin PDF no se puede completar.

**El caso R. Smith Coronado importa aparte:** es una Renovación de radios que
ya están en campo. `entrega_confirmada` no existe y **nunca va a existir**. Si
la comisión exige "entregado" a ciegas, esa comisión se traba para siempre.

### 2.2 La marca vieja no verificaba nada

Rescatado de `f0fad56:public/contratos/index.html:940`:

```js
async function marcarParaComision(id) {
  if (window.userRole !== 'administrador') { alert(...); return; }
  if (!confirm("¿Marcar este contrato como 'Listo para Comisión'?")) return;
  await db.collection("contratos").doc(id).update({
    listo_para_comision: true,
    fecha_envio_comision: firebase.firestore.Timestamp.now(),
    enviado_por_uid: firebase.auth().currentUser?.uid || null,
  });
}
```

Un booleano. Sin firma, sin pago, sin entrega: **un "ya revisé esto"**. Hoy
quedan **25 contratos** con la marca y el ✓ todavía se pinta en el archivo
(`contratos-list.js:302`), pero ya no hay botón que lo ponga. Reponer ese
botón devuelve el trabajo manual completo y no contesta la pregunta de Alberto.

### 2.3 Volumen (para dimensionar, no para asustarse)

| Medida | Valor |
|---|---|
| Contratos totales | 535 |
| Activos | 107 (todos con `firmado: true`) |
| Activos con `entrega_confirmada` | 30 |
| Firmados con PDF en papel | 105 |
| Firmados digitalmente (sin PDF; se reconstruye en `documento.html`) | 2 |
| Activos por acción | Adición 54 · Nuevo 27 · Renovación 20 · No Aplica 6 |
| Activaciones por mes | jul 15 · ago 9 · sep 12 |
| Gestiones (total histórico) | 22 — aumento 16, baja 3, demo 2, reemplazo 1 |
| `facturacion_avisos` | 11 (la colección nació el 2026-09-04) |
| Contratos con `listo_para_comision: true` | 25 |
| Clientes | 447 · **con `qbo_customer_id`: 0** |

Diez a quince eventos comisionables al mes. Es una bandeja **chica**: se puede
leer entera y ordenar en el navegador sin paginar.

### 2.4 Tres huecos que hay que cerrar antes de contar comisiones

1. **Nadie saca un aviso de `esperando`.** `onApproval.js:287` crea el aviso
   con `esperando = !esRenov && conEquipo && entrega_confirmada !== true`.
   Cuando la orden se entrega, `onOrdenEntregada.js:114` estampa
   `entrega_confirmada: true` en el contrato **y nada más**: no hay trigger que
   promueva el aviso. Hoy hay **3 avisos atascados en `esperando`**. Los tipos
   `contrato_entregado` y `venta_propio` están **declarados** en
   `facturacionAvisos.js:24,30` y **nunca se emiten**.

   Ojo con cómo se lee esto: la app **no factura** — Recepción emite a mano en
   QuickBooks (aclaración de Alberto, 2026-09-10). O sea que la factura no
   "deja de salir" por un bug técnico. Lo que pasa es peor de explicar y más
   fácil de arreglar: **a Recepción nunca se le avisa que ya puede facturar.**
   La fila se queda en "Espera" en su bandeja para siempre, y el correo que
   salió al activarse el contrato dice, con todas sus letras
   (`onApproval.js:308`):

   > *Lleva equipo por entregar: **la facturación arranca en la fecha de
   > entrega** (te avisaremos cuando se entregue).*

   Ese aviso no llega nunca. Es una promesa escrita que el sistema no cumple.
2. **Cliente ↔ Customer de QBO: 0 de 447 vinculados.** La página existe
   (`/facturacion/clientes-qbo`), parea por RUC y por nombre con buckets
   (sugeridos / múltiples / sin match), y nunca se usó.
3. **Evento ↔ factura de QBO: no existe.** La app no emite facturas —
   Recepción las hace a mano en QuickBooks y solo tilda el paso `qbo` en la
   bandeja. Existe un campo `pasos.qbo.ref` **libre y opcional**
   (`facturacionAvisosService.js:83`) que hoy nadie llena.

---

## 3. Principio

> La comisión no se marca: se libera sola cuando los tres hechos ya están
> escritos. La persona cierra el período, no verifica el expediente.

- **El sistema verifica, la persona decide.** Firma, entrega y pago ya son (o
  pueden ser) datos duros. Zuleika no debe volver a mirarlos uno por uno.
- **Un requisito que no aplica no traba.** Una renovación no entrega nada.
  Eso se declara, no se ignora ni se fuerza.
- **Nunca pagar dos veces el mismo dinero.** Un evento comisionable = un
  documento. Si el mismo hecho puede llegar por dos caminos, uno de los dos se
  promueve, no se duplica.
- **Aditivo.** No se toca el flujo de Recepción ni el estado de los avisos de
  facturación. La comisión es un bloque hermano, no un paso más (§5.4).

---

## 4. La unidad comisionable ya no es el contrato

Un aumento vive en `gestiones` y solo **modifica líneas** de un contrato que
ya existía. Una renovación no entrega nada. Una adición sí. Un ajuste de
tarifa puede ser negativo. Por contrato no cuadra.

Ya existe la pieza con el grano correcto: **`facturacion_avisos`** — un
documento por cada momento que cambia lo que el cliente paga. Trae
`vendedor_email`, `cliente_id`, `cliente_nombre`, `contrato_id`,
`contrato_doc_id`, `gestion_id`, `orden_id`, `fecha_efectiva`, `efecto`
(`arranca` / `cambia` / `termina`), `resumen.mensual`,
`resumen.delta_mensual`, `resumen.unico`, y el patrón `pasos` con
`aplica` + `hecho` + `at` + `por_email` + `historial[]` que solo crece.

Y trae, ya resuelto, el matiz que la comisión necesita
(`onApproval.js:280-287`):

```js
// Una RENOVACIÓN nunca espera entrega: los radios ya están en el cliente
const esperando = !esRenov && conEquipo && after.entrega_confirmada !== true;
```

Eso es exactamente la regla de "entrega aplica / no aplica". No hay que
inventarla.

### 4.1 Qué se comisiona

| tipo de aviso | efecto | ¿comisionable? | base |
|---|---|---|---|
| `contrato_activo` (Nuevo) | arranca | **sí** | `resumen.mensual` |
| `contrato_activo` (Adición) | arranca | **sí** | `resumen.mensual` |
| `renovacion_activa` | arranca | **sí** | `resumen.mensual` **completo** |
| `aumento_entregado` | cambia | **sí** | `resumen.delta_mensual` |
| `venta_propio` | arranca | **sí** | monto de la factura de venta |
| `contrato_entregado` | arranca | **no como doc propio** — promueve al `contrato_activo` que esperaba (§6.1) | — |
| `ajuste_tarifa` | cambia | **no** — el ajuste impacta en la renovación, y ahí se comisiona | — |
| `regularizacion` | cambia | **no** — corrige el registro, no es dinero nuevo | — |
| `baja_aprobada` | termina | **no** | — |
| `terminacion_completada` | termina | **no** | — |

La tabla vive en una constante `COMISIONABLE` dentro de
`functions/src/lib/facturacionAvisos.js`, al lado de `TIPOS`. Una sola voz
para front y back.

---

## 5. Los tres requisitos, derivados

### 5.1 Firma — ya está en el dato

- Contrato: `c.firmado === true` **y** sin `firmado_pendiente_validacion`
  (firmó alguien distinto al representante y falta que admin lo acepte).
- Aumento: `g.cierre.firma === true` con `anexo_firmado_path` o
  `anexo_firma_digital`.

Cuesta cero: los 107 activos ya lo cumplen.

### 5.2 Entrega — con `aplica`, igual que `qbo`/`poc`

- `aplica: false` cuando `accion === 'Renovación'`, cuando
  `renovacion_sin_equipo`, cuando el contrato no lleva líneas de equipo, y en
  `ajuste_tarifa` / `regularizacion`. Se reusa el mismo predicado que calcula
  `esperando` en `onApproval.js` — extraído a
  `facturacionAvisos.entregaAplica(contrato)` para que haya **una sola** copia.
- `hecho` cuando `c.entrega_confirmada === true` (lo estampa
  `onOrdenEntregada.js`, `confirmarEntregaContrato` o
  `gestionarFacturacion`), o `g.cierre.entrega === true` en un aumento.

Nota de refuerzo: `firestore.rules:492-514` **ya impide entregar** si el
contrato no está firmado (y exige el anexo firmado para entregar un aumento).
O sea: si hay entrega, hay firma. La observación de Alberto es correcta y está
respaldada por rules — pero el requisito de firma se conserva igual, porque
hay contratos sin entrega (renovaciones) donde la firma es lo único que hay.

### 5.3 Pago — el único requisito realmente nuevo

**Pago = la factura quedó en cero** (`Balance == 0`). Un abono parcial no
libera la comisión (decisión 3, §11).

Manual desde el día uno, automático en la F4 (§7). Zuleika marca el paso con
**fecha del pago** y **número de factura**, y queda el rastro
(`por_email` + `historial[]`) que hoy no existe.

### 5.4 Por qué NO es un tercer `paso`

Tentador y equivocado. `estadoDerivado()` (`facturacionAvisos.js:83-89`) pone
el aviso en `hecho` cuando **todos** los pasos que aplican están hechos. Si la
comisión fuera un paso más, un aviso ya procesado por Recepción se quedaría
`pendiente` en **su** bandeja hasta que se pague la comisión — semanas. Le
romperíamos la bandeja a Recepción para arreglarle la vista a Zuleika.

**La comisión es un bloque hermano** con su propio estado derivado. El
`estado` del aviso sigue siendo de Recepción.

---

## 6. Forma del dato

Campo nuevo `comision` en `facturacion_avisos/{id}` (aditivo, nadie más lo lee):

```js
comision: {
  aplica: true,                    // de la tabla COMISIONABLE (§4.1)
  estado: 'esperando',             // derivado: esperando | listo | pagada | no_aplica
  vendedor_email: 'karla.ferrer@cecomunica.com',  // congelado al crearse
  base: 173.34,                    // resumen.mensual o delta_mensual — NÚMERO
  // Reservados para cuando la bandeja calcule (decisión 4, §11). Hoy siempre
  // null: la casa aplica el porcentaje afuera. Nacen aquí para que agregar el
  // cálculo sea agregar el cálculo, no migrar 200 documentos.
  porcentaje: null, monto: null, regla_id: null,
  requisitos: {
    firma:   { aplica: true,  hecho: true,  at: <ts>, fuente: 'firmado_url' },
    entrega: { aplica: false, hecho: false, at: null, motivo: 'renovación: los radios ya están en el cliente' },
    // pago: `factura` es el DocNumber de QBO; `hecho` exige Balance == 0
    // (decisión 3, §11) — un abono parcial no libera la comisión.
    pago:    { aplica: true,  hecho: false, at: null, factura: null, monto: null, saldo: null, fuente: null },
  },
  periodo: null,                   // '2026-09' — lo estampa el cierre
  liberada_por: null, liberada_at: null,   // quién cerró el período
  nota: null,
}
```

- `estado` se **deriva**: `listo` cuando todo requisito que aplica está hecho;
  `pagada` cuando alguien cerró el período; `no_aplica` cuando
  `comision.aplica === false`. Nada de un booleano suelto que alguien prende.
- `firma` y `entrega` los mantienen **triggers** (nadie los teclea).
- `pago` lo marca una persona (F2) o el verificador de QBO (F4).
- `requisitos.entrega.motivo` es lo que el vendedor lee cuando pregunta por
  qué su comisión está trancada. Sin eso, un chip ámbar es una acusación sin
  explicación.
- Todo movimiento entra al `historial[]` que ya existe y solo crece.

### 6.1 El doble conteo, resuelto de una vez

Un contrato Nuevo con equipo genera `contrato_activo` con `esperando: true`.
Cuando se entrega, el impulso natural es crear un `contrato_entregado`. **No.**
Serían dos documentos para un solo hecho comisionable.

El trigger nuevo de la F1 **promueve el aviso existente**: le pone
`fecha_efectiva`, lo pasa de `esperando` a `pendiente` y estampa
`comision.requisitos.entrega.hecho`. El tipo `contrato_entregado` se queda
declarado en `TIPOS` únicamente para el caso en que el aviso original no
exista (contratos anteriores al 2026-09-04), y con el mismo id determinista
para que sea idempotente. Esto además **arregla los 3 avisos atascados** y el
bug de facturación de §2.4.

---

## 7. QuickBooks: qué es factible hoy, y qué no

### 7.1 Lo que sí

La conexión está **viva y en producción**: `integraciones/quickbooks` tiene
`realmId: 9130356242376366`, `env: "production"`, conectada el 2026-06-15 y
con tokens refrescados el 2026-09-04.

El scope es `com.intuit.quickbooks.accounting` (`lib/quickbooks/config.js:25`).
El comentario de esa línea dice *"Scope mínimo: solo contabilidad (NO
payments)"* y **se presta a confusión**: el scope
`com.intuit.quickbooks.payment` que falta es el de **cobrar tarjetas**, que no
hacemos. Leer las entidades `Invoice`, `Payment`, `Customer` y `Deposit` entra
en `accounting`. **No hace falta reconectar ni pedir permisos nuevos.**

`qboQuery()` (`lib/quickbooks/client.js:41`) ya existe y lo usan cuatro
callables. La consulta es una línea:

```sql
select * from Invoice where DocNumber = '1234'
-- Balance == 0  →  pagada
-- Payment enlazado (Line[].LinkedTxn[]) →  fecha y monto reales del pago
```

### 7.2 Lo que no, y por qué no es culpa de QuickBooks

El tapón son los dos enlaces de §2.4: **0 de 447 clientes vinculados** y
**ningún evento amarrado a una factura**. Sin ellos, lo máximo que se puede
contestar es *"este cliente pagó algo después de que el contrato activó"* — y
eso no es el primer pago de este contrato.

### 7.3 Sobre usar IA para el pago

**Recomendación: no.** Parear un pago con un contrato por monto y fecha
aproximados es justo el tipo de cosa que se ve inteligente y termina pagando
una comisión dos veces. Los casos que la rompen son los normales, no los
raros: un cliente con tres contratos activos (54 de los 107 activos son
Adición, o sea clientes que ya facturaban), un abono parcial, un pago que
cubre dos facturas, ITBMS que hace que el monto no cuadre con el mensual.

El arreglo determinista es **un campo**: cuando Recepción tilda el paso `qbo`,
que escriba el número de factura. Ya hay dónde ponerlo — `pasos.qbo.ref`
existe, es libre y opcional; solo hay que rotularlo *"Número de factura
(QBO)"*, validarlo y hacerlo obligatorio. Son ~12 números al mes. Con eso el
chequeo es exacto y de paso la bandeja muestra *"factura #1234 · pagada el
15-sep"* en vez de un ✓ mudo.

Si en algún momento se quiere el pareo difuso, que sea para **sugerir** sobre
el histórico anterior a la captura del número — y que la sugerencia entre
siempre por la mano de una persona, nunca como disparador del pago.

### 7.4 Poleo vs. webhook

`http/quickbooksWebhook.js` es hoy un stub honesto: valida la firma
`intuit-signature`, guarda el crudo en `qbo_webhook_events` (3 documentos
recibidos) y responde 200. Conectarle el evento `Payment` hace que el paso se
marque solo. Mientras tanto, un job diario que consulte las facturas de los
avisos con comisión pendiente resuelve lo mismo con 10-15 consultas al día.
El webhook es mejora, no requisito.

---

## 8. Dónde vive en la UI

**No es un módulo nuevo.** Pestaña **Comisiones** en `/facturacion/`, junto a
Bandeja, Activación, Emisión y Clientes QBO — donde las rules de need-to-know
de montos ya están puestas y donde ya está el hábito de trabajo.

Una fila por evento, agrupada por vendedor y por mes de `fecha_efectiva`:

```
KARLA FERRER · septiembre 2026                        3 listos · $412.80
─────────────────────────────────────────────────────────────────────────
● listo    AIR EUROPA          ALQ20260713-02  Renovación   $173.34
           ✓ firma 29-jul   — entrega (no aplica)   ✓ pago fact. #1189
● espera   MUNICIPIO ARRAIJÁN  ALQ20260902-01  Nuevo        $ 89.00
           ✓ firma 2-sep    ⏳ entrega pendiente     ⏳ pago
```

- El chip verde se pone solo. Zuleika no lo prende: **cierra el período**, y
  ahí es donde queda `liberada_por` / `liberada_at` / `periodo`.
- Los tres requisitos se ven en la fila, con su motivo cuando no aplican.
- Exportar CSV del período cerrado — es lo que ella necesita para pagar.
- Filtros: por vendedor, por período, y `listo` / `esperando` / `pagada`.

**En el Centro**, el chip de comisión se pinta en la fila del contrato para
que el vendedor vea por qué su comisión está trancada sin preguntarle a nadie.
Sin montos si el rol no tiene `ver-montos-contrato` (mismo criterio que ya
aplica el archivo).

---

## 9. Fases

### F0 — Desatascar a Zuleika · **HECHA 2026-09-10**

Todo en `public/js/pages/clientes-centro.js`. No toca datos ni rules.

1. **`_accFirmado()`** — nueva acción *"Ver el firmado"* en el grupo
   **Documentos** del menú "⋯", con dos ramas: `firmado_url` abre el PDF de
   Storage; firma digital (`firmado_tipo === 'digital'`, 2 contratos hoy) abre
   `contratos/documento.html?id=…`, que reconstruye el documento con la firma.
   El `hint` lleva la fecha de firma. El href se escapa: `_menuAccionesHtml`
   lo mete crudo en el atributo.
2. **`_firmadoTxt()`** — la fila `Firmado` de la vista previa deja de ser el
   texto muerto `sí ✓` y pasa a ser el enlace, con fecha.
3. **`_entregaTxt()` + `_entregaAplica()`** — fila `Entregado` nueva en la
   vista previa, solo para contratos activos. Dos de los tres requisitos de
   comisión quedan a la vista donde Zuleika ya está parada. Cuando la entrega
   no aplica **dice por qué** (`no aplica — los equipos ya están en el
   cliente`): un `—` a secas se lee como "falta", y ese es exactamente el caso
   R. Smith Coronado.

   *Cambio respecto al plan original,* que proponía devolver el contrato
   activo a `_tramitesContrato()` con su lista de pasos. Se descartó: esa
   sección es la cola de lo que **necesita acción**, y meterle ~25 contratos
   ya terminados le agrega ruido a los vendedores para resolverle la vista a
   una persona. La vista previa está a un clic del número de contrato y es
   donde ella ya entra.
4. **`subir_firmado` sale de `if (esperaFirma)`** — la rama
   `activo && !firmado_url` de `_aceptaFirmado()` era inalcanzable; ahora a un
   contrato activo al que le falta el papel se le puede completar el
   expediente ("Adjuntar el contrato firmado").
5. **`_aceptaFirmado()` excluye la firma digital.** Al volverse alcanzable esa
   rama, un contrato firmado digitalmente (que no tiene `firmado_url` y **no
   le falta nada**) empezaba a pedir que le adjuntaran un papel. Se corrigió
   en el mismo paso.

Verificado con los cinco casos reales (los cuatro del correo de Zuleika + un
contrato con firma digital) contra los helpers puros.

### F1 — Cerrar el hueco de `esperando` · **HECHA y DESPLEGADA 2026-09-10**

`onEntregaFacturacion` (trigger nuevo en `contratos`): al pasar
`entrega_confirmada` de falso a `true`, **promueve** el aviso que esté en
`esperando` — `fecha_efectiva`, `estado: 'pendiente'`, entrada en
`historial[]` — y encola el correo prometido con CTA a la fila de la bandeja.
Si el contrato no tiene ningún aviso (anterior al 2026-09-04), crea
`contrato_entregado` con id determinista. Una RENOVACIÓN no genera nada.

**La trampa que apareció al implementarlo.** Cloud Functions reentrega
eventos, y en un reintento el `before` sigue siendo el de antes de la entrega:
el guard de transición **no** frena la segunda pasada. Si
`promoverPorEntrega()` devolviera `null` tanto para "no hay aviso" como para
"ya lo promoví", ese reintento crearía un `contrato_entregado` encima del
aviso ya promovido — dos documentos para un solo hecho, o sea la comisión
pagada dos veces, que es exactamente lo que §6.1 promete evitar. Por eso el
valor de retorno distingue las dos situaciones (`promovido: true|false` vs.
`null`), y el harness lo congela.

`test-emulator/entrega-facturacion.js` — 6 comprobaciones contra el emulador
de Firestore a secas: promoción sin duplicado, correo con CTA a la fila,
reintento del mismo evento, contrato viejo, renovación y el guard.

`scripts/promueve-avisos-entregados.js` — el trigger cubre de aquí en
adelante; el script cubre lo que ya pasó. De los 3 avisos atascados, solo uno
tenía el contrato ya entregado: **GRUPO INDECSA, PROP20260818-01, entregado el
4-sep**, promovido y avisado el 2026-09-10 (correo `rZKBhXom842UYYedjwFL`,
`status: sent`). Los otros dos (Cristian Cerdas, MINSA) siguen esperando
entrega de verdad y el trigger los agarra.

**Nota que sale de correrlo:** el correo de GRUPO INDECSA salió **sin copia al
vendedor** porque la ficha no tiene `vendedor_asignado`. Para facturación es un
detalle; para comisiones es un bloqueo — una cuenta sin vendedor no tiene a
quién comisionar. Hay 57 cuentas así (censo de regularización, 2026-09-08).

**`venta_propio` se mueve a la F2.** Estaba aquí y no le corresponde: el aviso
se dispararía al registrarse `factura_venta.numero`, y ese número se registra
**después** de haber facturado en QuickBooks. O sea que su único paso (`qbo`)
ya está hecho el día que nace — un aviso de facturación que no pide nada. Como
hecho **comisionable** sí importa, así que nace con el bloque `comision`, en la
F2. (Ojo: la base de una venta Propio es el monto de la factura, y nosotros
solo guardamos el número — el monto sale de QBO en la F4.)

### F2 — El expediente de comisión · **HECHA y DESPLEGADA 2026-09-10**

1. **`COMISIONABLE`, `entregaAplica()` y el bloque `comision`** en
   `lib/facturacionAvisos.js`. `crearAviso()` lee el contrato y la gestión para
   derivar los tres requisitos al nacer el aviso. `comision.vendedor_email`
   sale de `gestion.responsable_email` (23/23 lo tienen) o del
   `creado_por_uid` del contrato — **no** del `vendedor_email` del aviso, que
   es el asignado del cliente y sirve para el CC del correo (§11, decisión 5).
2. **`triggers/comisiones/onRequisitos.js`** (dos triggers). Firma y entrega se
   re-derivan cuando el hecho se mueve. Hace falta porque el aviso no siempre
   nace con el hecho escrito: `onOrdenWriteGestion` crea el aviso de
   `aumento_entregado` **antes** de escribir `cierre.entrega` (su
   `gRef.set(patch)` está al final de la función), y un contrato puede nacer
   con `firmado_pendiente_validacion`. Una comisión ya `pagada` **no se
   reabre** porque un dato del contrato cambió después.
3. **Rules**: `comision` entra a la allowlist, pero solo admin/contabilidad la
   mueven, el estado tiene catálogo, y base / vendedor / aplica / requisitos
   derivados son **intocables** desde el navegador. 7 comprobaciones nuevas —
   incluida la forma exacta que manda el servicio (`update()` con rutas
   punteadas, no `set()+merge`).
4. **Pestaña Comisiones** en `/facturacion/`, agrupada por vendedor, con el
   grupo **sin vendedor primero** y el aviso arriba con el conteo. El paso
   `pago` se marca a mano (factura + fecha + monto + saldo), "Cerrar el
   período" está deshabilitado mientras falte algo, y el detalle dice **qué**
   falta y **por qué**. Deshacer / reabrir no borran nada. CSV con BOM.
5. **Backfill corrido**: 43 avisos, todos con bloque. 33 esperando · 9 pagadas
   (por la marca vieja) · 1 no_aplica. Abiertas por vendedor: Elvia 14,
   Alondra 7, Zuleika 6, Salomón 4, Alberto 2.
6. **`venta_propio` sigue pendiente** — es el único punto de la F2 que no
   entró. Ver la nota al final de la F1: el número de factura se registra
   después de facturar, así que su valor está en el lado de comisiones, no en
   el de facturación, y la base (el monto de la venta) solo la puede dar QBO
   en la F4. Entra con la F4, no antes.
7. **El chip en la fila del contrato del Centro tampoco entró** (punto 5 del
   plan original). La pantalla de comisiones ya resuelve el reclamo de Zuleika;
   el chip es para que el vendedor vea su comisión sin preguntar, y eso es una
   mejora aparte que además hay que pensar con el need-to-know de montos.

**Verificado.** `test-emulator/comision-requisitos.js` (8 comprobaciones sobre
la lógica del bloque), `test-emulator/rules.js` (+7) y
`test-browser/revisar-comisiones.js` (20 sobre la **página real** en Chrome:
intercepta Firebase e inyecta un Firestore de mentira, en vez de copiar el HTML
como `harness-pendientes.html` — el CSS de esta página vive inline y copiarlo
sería probar una copia). Ese último encontró dos defectos antes de desplegar:
el correo del vendedor se encimaba con el monto en el detalle y el encabezado
de grupo gritaba el correo completo en mayúsculas.

**Cero comisiones en `listo` hoy, y está bien:** el pago es el único requisito
que el sistema todavía no puede derivar. Zuleika pasa una vez por las 33 y de
ahí en adelante es incremental — o automático cuando entre la F4.

Con esto Zuleika ya trabaja en **una** pantalla, con rastro de quién liberó
qué. Lo único manual que le queda es mirar el pago en QuickBooks — lo mismo
que hace hoy, pero una vez y anotado.

### F3 — Los dos enlaces con QuickBooks

1. **Vincular clientes.** Solo importan los ~100 con contrato activo, no los
   447. La página ya sugiere por RUC y por nombre. Es trabajo de contabilidad,
   no de código.
2. **Número de factura obligatorio.** Rotular `pasos.qbo.ref` como *"Número de
   factura (QBO)"*, validarlo y exigirlo al tildar el paso. Retro-llenar los
   avisos ya marcados es opcional y a mano.

### F4 — Verificación automática del pago

`verificarPagoComision` (callable + job diario, solo admin/contabilidad): para
cada aviso con `comision.estado === 'esperando'` y requisito `pago` pendiente
que tenga número de factura, `qboQuery` la factura y estampa `requisitos.pago`
con `fuente: 'qbo_automatico'`. **`hecho: true` solo si `Balance == 0`**
(decisión 3, §11); con saldo pendiente guarda `saldo` y lo muestra —
*"factura #1234 · faltan $45.00"* — pero no libera nada. La fecha sale del
`Payment` enlazado. Los ~12 al mes caben de sobra en un job diario.

Sin número de factura: **no adivina**. Deja la fila en manual y lo dice.

### F5 — Webhook `Payment` (opcional)

Procesar el evento `Payment` en `quickbooksWebhook.js` y marcar el paso en el
acto. El crudo ya se guarda; falta el consumidor.

---

## 10. Rules y backfill

**Rules.** `facturacion_avisos` (`firestore.rules:840-857`) hoy permite
`update` a admin/recepción/contabilidad limitado a
`["pasos","estado","descarte","historial","reenvio_solicitado","updated_at","por_uid","por_email"]`.
Cambios:

- Agregar `"comision"` a esa lista.
- Los subcampos `comision.requisitos.firma` y `.entrega` los escribe **solo el
  backend** (Admin SDK ignora rules). Desde el navegador se acota igual que
  `avisoHistorialSoloCrece()`: el write que toca `comision` puede cambiar
  `requisitos.pago`, `estado`, `periodo`, `liberada_*` y `nota`, nada más.
- `liberada_por` / `periodo` (cerrar el período): solo `administrador` y
  `contabilidad`. Recepción marca pasos de facturación, no libera comisiones.

**Backfill.** `facturacion_avisos` nació el 2026-09-04 y tiene 11 documentos;
`backfill-facturacion-avisos.js` solo alcanza hasta el 2026-09-02 porque lee
`mail_queue`. Para que la bandeja sirva desde el arranque hace falta un script
nuevo que siembre desde `contratos` por `fecha_activacion` (107 activos) y
desde `gestiones` cerradas de tipo `aumento` (16). Dry-run por defecto,
`--apply` para escribir, ids deterministas para que sea idempotente.

Los **25 contratos con `listo_para_comision: true`** se importan como
`comision.estado: 'pagada'` con `nota: 'marca del módulo anterior'` y
`liberada_por: enviado_por_uid`. El campo viejo **no se borra** (los saneos
cierran, no eliminan) y el ✓ del archivo se repunta al nuevo estado.

---

## 11. Decisiones — resueltas por Alberto el 2026-09-10

1. **Las renovaciones SÍ se comisionan, sobre el mensual completo.** Nada de
   calcular el delta contra el contrato anterior. `base = resumen.mensual`.
2. **Los ajustes de tarifa NO se comisionan.** El ajuste impacta en la
   renovación, y es ahí donde se paga. `ajuste_tarifa` queda con
   `comision.aplica: false` y motivo escrito, no oculto.
3. **El primer pago es la factura en cero.** `Balance == 0` en la factura de
   QuickBooks. Un abono parcial **no** libera la comisión.
4. **La bandeja dice "listo" y muestra la base — por ahora.** No calcula el
   monto de la comisión todavía, pero el dato queda **preparado para que lo
   haga**: `base` es un número, no un texto, y el bloque `comision` reserva
   `porcentaje`, `monto` y `regla_id` en `null` desde el día uno (§6). Meter la
   tabla de porcentajes después es agregar el cálculo, no migrar el modelo.
5. **El vendedor de un aumento es quien hizo el aumento**, no el
   `vendedor_asignado` del cliente. Sale de `creado_por_uid` de la gestión —
   mismo criterio que ya rige en contratos. Cuidado: hoy
   `avisoFacturacion()` (`lib/gestiones.js:517`) llena `vendedor_email` con el
   vendedor asignado del cliente; para la comisión hay que resolverlo aparte y
   congelarlo en `comision.vendedor_email`. **No** se cambia el
   `vendedor_email` del aviso: ese sirve para el CC del correo y tiene otra
   razón de ser.

## 12. Lo que este plan NO hace

- **No repone el botón viejo.** Un booleano manual sin criterio es el problema,
  no la solución.
- **No crea un módulo de comisiones.** Es una pestaña en un módulo que ya
  existe, sobre una colección que ya existe.
- **No calcula porcentajes ni genera pagos** todavía. Dice "listo" y da la
  base, con los campos del cálculo reservados en `null` para cuando se decida
  meterlo (§11, decisión 4).
- **No adivina pagos.** Sin número de factura, el paso queda manual y la
  bandeja lo dice con todas sus letras.
- **No toca el flujo de Recepción.** El `estado` de los avisos de facturación
  sigue significando lo mismo que hoy.

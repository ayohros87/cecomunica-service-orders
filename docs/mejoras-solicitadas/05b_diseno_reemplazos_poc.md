# Diseño — Reemplazos y Renovaciones (ancla en POC)

**Reemplaza como base de implementación a:** `05_contratos_reemplazos_renovaciones.md` (spec original E1–E9).
**Fecha:** 2026-07-01
**Contexto:** análisis previo a construir el "Proyecto E". Se detectaron dos problemas estructurales que obligan a replantear el enfoque antes de codificar:

1. **Contratos legacy**: algunos contratos de renovación/reemplazo **no están en el sistema** (existen solo en papel/históricos).
2. **Sin relación entre contratos**: las renovaciones **no** apuntan al contrato original, y las adiciones **tampoco**. Hoy son contratos sueltos.

Además, `poc_devices` (Base de Datos POC) ya es el registro del **equipo real** del cliente (serial, modelo, grupos, SIM, activo), pero **no está ligado a ningún contrato**.

---

## Decisiones fijadas (2026-07-01)

1. **Fuente de verdad = POC (el equipo).** El mapeo de reemplazo/renovación arranca del equipo en POC; el contrato solo *referencia* equipos. Robusto ante legacy y sin depender de una cadena de contratos.
2. **Legacy puro se digitaliza en el momento.** Si el serial saliente no está en POC, el flujo permite capturarlo (serial, modelo, programación mínima) y sembrarlo en POC como parte del reemplazo (regularización bajo demanda; sin migración masiva).
3. **Histórico = cola de revisión.** El sistema *sugiere* el contrato origen (por cliente/fecha/seriales) y un admin confirma o marca `legacy`. **No** se auto-enlaza.

---

## Principio central

> El proceso se ancla en el **EQUIPO (POC)**, no en la cadena de contratos.

- Lo que el cliente tiene físicamente/lógicamente vive en **POC** y existe con o sin contrato original en el sistema.
- El **contrato** es un documento comercial/facturable que *referencia* equipos de POC.
- El **mapeo** de reemplazo/renovación se define como **serial saliente (device de POC) → serial entrante (nuevo)**. Funciona aunque el contrato original sea legacy o inexistente.
- El registro durable del "hilo" del equipo es el **linaje de serial** (`reemplaza_a`), más confiable que enlazar contrato-con-contrato.

---

## Modelo de datos

### `poc_devices` (equipo — fuente de verdad) — campos nuevos
| Campo | Tipo | Uso |
|---|---|---|
| `contrato_id` | string \| null | Contrato actual que cubre el equipo. Es también la **reserva** de E2 (serial ocupado por un contrato). Backfilleable. |
| `estado_equipo` | enum | `activo` \| `en_reemplazo` \| `pendiente_devolucion` \| `devuelto` \| `baja`. |
| `reemplaza_a` | string \| null | Serial anterior al que sustituye este equipo (**linaje**). |
| `origen_captura` | enum | `batch` \| `digitalizado_en_reemplazo` (marca los regularizados en el flujo). |

> Nota: la programación (SIM, grupos, etc.) ya vive en `poc_devices` (p. ej. `sim_number`, `grupos`). E4 la lee de aquí.

### `contratos` — enlace suave de origen (para Renovación / Reemplazo / Adición)
| Campo | Tipo | Uso |
|---|---|---|
| `origen_tipo` | enum | `interno` \| `legacy` \| `ninguno`. |
| `contrato_origen_id` | string \| null | Doc id del contrato original (cuando es `interno`). |
| `contrato_origen_ref` | string \| null | Id legible del original (para mostrar). |
| `origen_legacy_ref` | string \| null | Texto libre: número del contrato en papel/externo. |

### `contratos/{id}/mapeos` (nueva subcolección — registro durable)
```
{ saliente: string, entrante: string, modelo: string, modelo_id?: string,
  os_id?: string, at: timestamp, por: uid }
```

### `contratos/{id}/devoluciones` (Fase 4)
```
{ serial, modelo, esperado: bool, recibido: bool, recibido_at?, recibido_por?,
  orden_entrada_ref? }
```

---

## Cómo se resuelve el legacy (3 casos)

Al elegir los seriales salientes en la creación (E1):

1. **Serial en POC (normal):** jala device + programación + (si existe) `contrato_id`. Mapea saliente→entrante. Funciona sin link de contrato.
2. **Serial en POC pero contrato legacy/ausente:** funciona igual (POC es el ancla). Se marca `origen_tipo='legacy'` + `origen_legacy_ref` (referencia externa). Sin FK dura.
3. **Serial NO está en POC (legacy puro):** el flujo ofrece **"digitalizar equipo"** → captura serial/modelo/programación mínima, crea el device con `origen_captura='digitalizado_en_reemplazo'`. El reemplazo se vuelve la oportunidad de regularizar.

---

## Enlace entre contratos (arreglo del hueco padre-hijo)

- El origen se puede **inferir**: una vez que los seriales quedan ligados a su contrato (`poc_devices.contrato_id`), el sistema deduce el contrato original mirando qué contrato es dueño de los seriales salientes. Si no hay dueño → `legacy`.
- La **adición** apunta al mismo original (`contrato_origen_id`) para que el total de equipos del cliente sea coherente y una renovación posterior renueve la unión.
- Regla: **no auto-confirmar** el enlace inferido; pasa por la cola de revisión (decisión 3).

---

## Cómo cambia E1–E9 bajo este modelo

| # | Cambio respecto al spec original |
|---|---|
| **E1** | El vendedor elige los salientes **desde POC** (no a ciegas). Si no está → botón "digitalizar equipo" (caso 3). Motivo obligatorio. |
| **E2** | Igual que hoy (mapa por modelo, pegar múltiple, correo a activaciones+vendedor) **+** al confirmar setea `contrato_id`, `estado_equipo`, `reemplaza_a` en el device entrante (reserva + linaje). |
| **E3** | Recepción crea la OS **ligada al contrato**. La corrección de seriales dañados/erróneos **ya está construida** (solicitud de cambio de serial, 2026-07-01). |
| **E4** | El mapeo se alimenta de los **equipos activos de POC del cliente** (filtrando por `contrato_id` si hay link; si no, por cliente). Muestra programación del saliente desde POC. Registra en `mapeos`. |
| **E5** | Auto-propuesta por modelo tomando equipos activos de POC; ya **no** depende del contrato original. Editable antes de confirmar. |
| **E6** | OS↔contrato **obligatorio** + regla de cierre (no cerrar sin contrato/info). |
| **E7** | Notificaciones por transición (varias ya existen; se completan por fase). |
| **E8** | Devolución compara contra los salientes de POC marcados `pendiente_devolucion`; al recibir → `devuelto`; el cierre se bloquea mientras queden pendientes. Parciales registran pero no cierran. |
| **E9** | (Fase 2) Reporte de pendientes de devolución. |

---

## Backfill / regularización (sin big-bang)

- **Devices sin `contrato_id`:** setear donde sea inferible (por cliente + seriales de contratos activos). Lo no inferible queda null (se resuelve cuando un flujo lo toque).
- **Renovaciones/adiciones históricas sin enlace:** **cola de revisión** — el sistema sugiere origen (mismo `cliente_id`, fecha anterior, modelos/seriales solapados); admin confirma o marca `legacy`.
- **Contratos 100% en papel:** no migrar por adelantado; se digitalizan (caso 3) solo cuando un reemplazo/renovación toca su equipo.

---

## Roadmap (revisado)

| Fase | Contenido | Riesgo |
|---|---|---|
| **0** | Cimientos: campos POC (`contrato_id`, `estado_equipo`, `reemplaza_a`, `origen_captura`), campos de origen en contrato, subcolección `mapeos`, y **vista "Equipo del cliente"** (POC + contrato). | Bajo (aditivo) |
| **0.5** | Backfill: setear `contrato_id` inferible + **cola de revisión** de contratos históricos. | Medio |
| **1** | E1 (salientes desde POC + digitalizar) + reserva E2. | Bajo/Medio |
| **2** | E4/E5 (mapeo POC-driven + auto-propuesta). | Medio (núcleo) |
| **3** | E3/E6 (OS ligada + regla de cierre). | Medio |
| **4** | E8 devolución + E7 notificaciones completas. | Medio/Alto |
| **5** | E9 reporte de pendientes de devolución. | Bajo |

**Por qué ese orden:** Fase 0 desbloquea todo (el resto depende del modelo). E1 antes que E4 porque el mapeo necesita los salientes. E3/E6 antes que E8 porque la devolución cuelga del vínculo OS↔contrato y su cierre. E7 se teje en cada fase. E9 al final (consume E8).

---

## Pendientes de decidir dentro de cada fase

- **Reserva de serial:** ¿unicidad estricta (un serial activo no puede estar en dos contratos) o marca informativa? (afecta reglas de E2).
- **"Bodega" = rol `inventario`** actual (confirmar).
- **Estado del proceso:** usar un campo `proceso_reemplazo` aparte del `estado` del contrato (que está atado a facturación) — recomendado.
- **Detalle de la cola de revisión:** criterios de matching y umbral de confianza para sugerir origen.

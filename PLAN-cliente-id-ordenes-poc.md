# Plan — Enlazar órdenes y equipos POC por `cliente_id` (no por nombre)

> Problema raíz: `ordenes_de_servicio` y `poc_devices` referencian al cliente por
> **nombre** (campo `cliente`, string). Un rename/fusión/typo rompe el enlace.
> Meta: enlazar por **`cliente_id` estable**, dejando el nombre solo como display
> denormalizado.

Fecha: 2026-06-05. Rama sugerida: `feat/cliente-id-link`.

---

## Estado real (medido en producción)

| Colección | Activos | Con `cliente_id` | Sin id, matchean por nombre | Sin id, **huérfanos** |
|---|--:|--:|--:|--:|
| `contratos` | — | ✅ ya usa `cliente_id` | — | — |
| `ordenes_de_servicio` | 1456 | 846 (58%) | 215 | 395 (27%) |
| `poc_devices` | 5225 | 1179 (23%) | 3692 (71%) | 354 |

**El dual-write ya existe** en los caminos principales:
- Órdenes: `nueva-orden` guarda `cliente_id`; `editar-orden`/`cotizar-orden` lo leen.
- POC: `pocService.getByCliente` consulta por `cliente_id` **o** `cliente`; los equipos nuevos escriben `cliente_id`.

Lo que falta: backfill de los legacy, mover las **lecturas críticas** a `cliente_id`,
manejar los **huérfanos**, y mantener el nombre denormalizado fresco al renombrar.

---

## Principios

- **Aditivo y compatible:** `cliente_id` se agrega/usa sin quitar `cliente`/`cliente_nombre`
  (quedan como display denormalizado). Código viejo y nuevo coexisten.
- **`cliente_id` = fuente de verdad del enlace.** `cliente`/`cliente_nombre` = caché de display.
- Cada fase es desplegable y reversible. Dry-run antes de cada backfill.

---

## Fases

### Fase 1 — Cerrar el dual-write (que ningún camino nuevo cree docs sin `cliente_id`)
Auditar y arreglar los puntos de **escritura** de órdenes y POC que aún no setean
`cliente_id` (imports masivos, `nuevo-batch`, `poc-bulk`, alta rápida por `prompt`,
`agregar-equipo`). Donde se crea cliente por nombre, resolver/crear el id y guardarlo.
**Resultado:** de aquí en adelante, 0 documentos nuevos sin enlace estable.

### Fase 2 — Backfill por nombre (recupera la mayoría)
Acción server-side (`runBackfill: linkClienteId`): para cada orden/poc sin `cliente_id`,
match **normalizado** del `cliente` (nombre) contra los clientes → setea `cliente_id`.
Dry-run con reporte. Recupera ~**215 órdenes** + ~**3692 POC**. Idempotente.

### Fase 3 — Huérfanos (nombre que no resuelve a ningún cliente)
Hoy ~**749** (395 órdenes + 354 POC). Estrategia:
1. Segundo pase **fuzzy** (similitud de nombre, como el dedup) para recuperar los que
   difieren un poco → reporte de propuestas para aprobar.
2. Los que sigan sin match: reporte para **crear el cliente** o asignar a mano.
   (Muchos pueden ser nombres libres tecleados que nunca fueron cliente.)

### Fase 4 — Lecturas/operaciones por `cliente_id`
Migrar lo **crítico para el enlace** a `cliente_id` (manteniendo el nombre como display):
- **Dedup** (`mergeCluster`): re-apuntar órdenes/POC por `cliente_id` (exacto), no por nombre.
- **admin-grupos** (`pocService`): derivar/operar grupos por `cliente_id`.
- Listados/filtros de órdenes y POC que filtran por cliente: usar `cliente_id` donde el
  caller lo tenga.
- Índices compuestos nuevos en `ordenes_de_servicio`/`poc_devices` por `cliente_id`.

### Fase 5 — Nombre denormalizado fresco al renombrar (hardening)
Trigger `onWrite(clientes)`: si cambia `nombre`, propagar el nuevo nombre a `cliente`/
`cliente_nombre` de sus órdenes/POC (batch por `cliente_id`). Así el display nunca queda
viejo y el enlace nunca depende del string.

### Fase 6 — Dedup definitivo por id
Con el backfill hecho, la fusión de duplicados re-apunta por `cliente_id` (estable),
eliminando el barrido por nombre normalizado (Fase actual del dedup → simplificación).

---

## Orden recomendado
1. **Fase 1 + 2** (estabilizan el enlace sin cambiar comportamiento).
2. **Fase 3** (revisar huérfanos con el reporte).
3. **Fase 4** progresiva (empezando por dedup y admin-grupos).
4. **Fase 5 + 6** (hardening y simplificación).

## Archivos involucrados (resumen)
- Escritura: `nueva-orden.js`, `editar-orden.js`, `nuevo-equipo.js`, `nuevo-batch.js`,
  `poc-bulk.js`, `agregar-equipo.js`, `cotizar-orden*.js`, `importar-exportar.js`.
- Lectura/ops: `ordenesService.js`, `pocService.js`, `admin-grupos.js`,
  `clientesDedupService.js`, listados/filtros de órdenes y POC.
- Backend: `functions/src/callable/runBackfill.js` (acciones de backfill),
  nuevo trigger `onWrite(clientes)`; `firestore.indexes.json`.

## No se toca
- El snapshot histórico de contratos (ya enlaza por `cliente_id`).
- Se conservan `cliente`/`cliente_nombre` como display denormalizado.

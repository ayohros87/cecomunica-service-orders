# Auditoría de Órdenes de Servicio — rendimiento, procesos reales y UI
## 2026-08-17

> **Pregunta del negocio:** "la página se siente pesada y lenta para trabajar;
> ¿dónde pierde tiempo el personal y qué procesos no se están siguiendo?"
>
> **Método:** (1) medición de peso/render real del código (bytes, gzip, censo
> completo de clases CSS, análisis del pipeline de render); (2) auditoría de
> fricción de los flujos actuales POST-mejoras de agosto; (3) **minería de los
> datos reales de Firestore — 371 órdenes de los últimos 90 días** — para ver
> cómo trabaja el personal de verdad. Nada modificado; solo diagnóstico.
>
> Verificado: todo lo desplegado en agosto funciona (Asignármela, chip QC,
> aviso de completar, redirect a equipos, correlativo atómico, lote de texto,
> conteos count(), candados de estados). **El diagnóstico de hoy es NUEVO.**

---

## 1. Resumen ejecutivo — por qué se siente pesada y lenta

**Tres causas de la lentitud, todas medidas:**

1. **El motor de render tiene un bug y dos derroches.** El "scoping" de los
   iconos nunca funcionó: `lucide.createIcons({nodes})` usa una opción que el
   vendor NO soporta → **cada refresh re-crea TODOS los SVGs de la página**
   (~600+ iconos con 50 filas) — es la causa raíz del parpadeo de iconos que
   se intentó arreglar y no se pudo. Además cada snapshot remoto (un colega
   guardando, una Cloud Function estampando) **reconstruye la tabla entera
   (~10,000 nodos)** sin diff, y el 55% de ese DOM es la fila de detalle
   oculta que se construye eager para las 50 órdenes. Y **cada búsqueda sin
   resultados descarga la colección COMPLETA de órdenes** (el fallback
   full-scan quedó obsoleto: el backfill de searchTokens ya corrió).
2. **El costo real del técnico ya no está donde estaba.** Una orden de 5
   equipos = **~58 interacciones, y ~30 se van solo en materiales y fotos**
   (modal por equipo, sin lote de materiales, sin ‹anterior/siguiente›,
   buscador de piezas que exige teclear aunque la analítica de "más usadas
   por modelo" ya existe). Tres aterrizajes pierden el contexto (agregar-
   equipo cae al index pelado con 2 s de espera fija). La búsqueda deja la
   tabla EN BLANCO sin loader durante el roundtrip — la sensación de "lenta"
   más barata de arreglar (2 líneas).
3. **La bandeja acumuló 3 representaciones del mismo filtro** (KPIs + chips +
   dropdown "Resumen") ≈ 31 controles visibles, más señales muertas (el dot
   verde/naranja lee un campo que nada escribe desde julio) y features que
   los datos muestran muertas (fotos de taller: **7 subidas en 90 días**).

**Y los procesos que no se están siguiendo (datos de 371 órdenes/90 días):**

| Hallazgo de proceso | Dato |
|---|---|
| Entregadas con equipos SIN intervención registrada | **74 de 175 (42%)** |
| …en PROGRAMACIÓN (mediana 4 equipos, máx 32) | 54/111 órdenes · **326/701 equipos (46%)** |
| …en REPARACIÓN (donde SÍ importa) | 18/54 órdenes · 27/95 equipos (28%) |
| QC requerido, cobertura invertida | PROGRAMACIÓN 34 vs **REPARACIÓN solo 5** |
| QC bypass real (entregadas sin QC aprobado) | **0** — el candado funciona |
| Correcciones de estados terminales (cierres mal hechos) | **34 en 90 días** |
| Reasignaciones de técnico | 30 sobre 316 asignaciones (9.5%) |
| POR ASIGNAR estancadas >30 días | **9** (14 de 20 con >1 semana) |
| RECIBIDO EN MOSTRADOR estancadas >2 días | 17 de 18 |
| Fotos de taller (la página aparte) | **7 subidas en 90 días** — feature muerta |
| ENTRADA cerradas sin firma | 4 de 102 (con motivo — sano) |
| Ciclo creación→entrega | mediana 5 días · p90 16 días |
| Quién opera | recepción = 1 usuario (92% de altas) · 3 técnicos (64/56/53 entregas) |

**Lectura clave:** el modelo de intervención POR EQUIPO no calza con
PROGRAMACIÓN (lotes de radios idénticos → el 46% no se llena: es burocracia
percibida), y en REPARACIÓN — donde la intervención y el QC son el corazón —
un tercio sale sin registro y el QC casi no se marca. No es indisciplina:
es la UI cobrando 30 clicks por lo que el proceso pide.

---

## 2. Rendimiento — números medidos

- **Primera visita ≈ 950 KB–1 MB comprimido; ~3.4 MB de JS a parsear.**
  44 `<script>` (37 locales + 5 SDK + 2 inline); 5 síncronos bloqueantes tras
  216 KB de CSS render-blocking. Locales: 1.27 MB raw / 349 KB gz.
- **Lucide = 95 KB gz / 401 KB parse para 69 iconos usados** (27% del peso
  local). SDKs compat ≈ 560 KB gz — de los cuales **storage (~40) y
  functions (~10) solo se usan en acciones puntuales** (subir foto/firma, un
  callable).
- **Diferibles sin re-arquitectura ≈ 90–100 KB gz + ~400 KB parse**:
  storage/functions compat, ordenes-devolucion (22 gz — solo check-in),
  ordenes-visita, firmaPad, piezas+scoring+modelos+mail+clientes+usuarios.
- **CSS: 39 clases muertas (9%) + bloques legacy** concentrados en las
  secciones "MEJORAS…" (líneas 1916–3157) + duplicaciones (`.card-contrato`
  re-estilada; modo view-cards desktop ~180 líneas). Purgable 10–15%.
- **Lecturas Firestore al abrir (admin): ~70–100 docs**; expandir una fila
  consulta `equipos_pool` por serial **y se repite en cada snapshot** mientras
  siga expandida (sin caché). `loadTechnicians` se lee en el boot y OTRA vez
  en cada apertura del modal Asignar. Los soft-deleted se descargan y se
  botan en cliente. **El rol `tecnico` no filtra server-side**: baja órdenes
  ajenas de 15 en 15 y puede no ver las suyas viejas.
- Menores: `aplicarRestriccionesPorRol` corre 50 veces por página cargada
  (dentro del forEach de paginación); `filtrarPorEstado` no repinta iconos en
  el happy-path.

## 3. Fricción de flujos (estado actual, post-agosto)

**Técnico, orden de 5 equipos** (texto+material+foto): ~58 interacciones →
**~32 posibles**. Desglose del sobrecosto: materiales ~30 (sin lote, sin
sugerencias precargadas, 3-4 viajes por línea), fotos ~15 (reabrir modal por
equipo; fotos-taller es peor: página aparte, sin `multiple`, Volver al index
pelado), lote de texto con espera visible ("Aplicando 3/5…" = ~10 viajes en
serie que serían 2 con un solo write).

**Recepción**: crear+equipos ya está óptimo, pero el aterrizaje post-equipos
(`agregar-equipo.js:210`) espera 2 s fijos y cae al index SIN la orden — el
paso siguiente (Recibir/Imprimir) obliga a re-buscarla. `prompt()` de cliente
nuevo sigue sin email. El vendedor aún pasa por el modal intermedio de
impresión.

**Jefe (QC)**: cola a 1 click ✓, pero el modal de QC **no muestra los equipos
ni las intervenciones** (revisa a ciegas o alterna modal↔fila) y el checklist
de 4-5 ítems con 0 rechazos en 33 firmas es ritual → "Todo OK" dejaría 6-7
clicks en 3.

**Densidad**: ~31 controles visibles; triple filtro de estado; select de
ordenar con 2 opciones + botón (→ cabeceras clickeables); "Mostrar fecha
entrega" en primera fila; dot de trabajo muerto; chips de accesorios con
click muerto fuera del modo lote; menú ⋯ admin con 9 ítems (uno de ellos
"Editar" permanentemente gris fuera de POR ASIGNAR); `nota-entrega.html` y su
handler quedaron huérfanos.

## 4. Bypasses de proceso desde la UI

| Bypass | Estado | Acción |
|---|---|---|
| Entregar sin QC | **CERRADO** (UI + rules con caducidad) | — |
| Editar estado a mano | **CERRADO** (select disabled + máquina en rules) | — |
| Completar sin intervención | Soft (avisa, no bloquea) — intencional | Mantener; el dato dice que el fix real es el modelo por lote (§5) |
| Cerrar ENTRADA sin revisión por equipo | **Hueco menor** — el aviso se salta si esEntrada | Extender el aviso |
| PROGRAMACIÓN "No aplica contrato" | Demasiado fácil (motivo libre de 1 carácter, sin cola) | Mínimo de motivo + chip/filtro "sin contrato" |
| Eliminar orden en CUALQUIER estado (incl. ENTREGADO), sin motivo | **Hueco** (`ordenes-render.js:1011`; `eliminado` ni siquiera es campo protegido en rules) | Ocultar en terminales + motivo + proteger campo |
| editar-orden.html por URL directa en cualquier estado | **Hueco** (la página no valida estado) | Validar como el menú |
| Asignar "saltando recepción" | Intencional, pero sin marca en os_logs | Trazar |
| reporte-pendientes sin escape ni gate | **Hueco** (único arrastrado de agosto) | Corregir |

## 5. Plan de mejoras UI-first (priorizado por tiempo devuelto al personal)

**P0 — La tarde de "ya no se siente lenta"** (todas quirúrgicas):
1. Fix del scoping de lucide: `createIcons({root: nodo})` en icons.js /
   ordenes-state (la opción `nodes` no existe en el vendor) — mata el
   parpadeo de iconos y cientos de reemplazos DOM por render.
2. Loader/skeleton en la búsqueda rápida (hoy tabla en blanco sin señal).
3. Eliminar el fallback full-scan de `searchOrders` (searchTokens ya está
   backfilleado): 0 resultados = "sin resultados", no descargar la colección.
4. Coalescer snapshots con debounce ~150 ms + `docChanges()` para tocar solo
   filas afectadas (el cambio estructural n°1 de fluidez al trabajar).
5. `aplicarRestriccionesPorRol` fuera del forEach; `loadTechnicians` con
   caché 5 min; caché por sesión del decorado del pool en filas expandidas.

**P1 — La semana del técnico** (el 78% de su sobrecosto):
6. **Materiales en lote** (mismo patrón "aplicar también a estos seriales")
   + **sugerencias "más usadas por modelo" al abrir** (la analítica ya se
   escribe; solo falta leerla al abrir el buscador vacío). ~20 interacciones
   menos por orden con material.
7. **‹ Anterior / Siguiente ›** entre equipos dentro del modal de intervención.
8. Lote de texto en **un solo write** (updateTrabajoTecnico con lista de
   índices): adiós la espera "Aplicando 3/5…".
9. Aterrizaje post-equipos a `index.html?orden=<id>` sin los 2 s, con CTA
   "Recibir ahora / Imprimir" — cada alta del mostrador lo paga.
10. "Mis órdenes" server-side para el rol `tecnico` (hoy solo
    tecnico_operativo): percepción de velocidad + puede ver TODAS las suyas.
11. QC con contexto ("Equipos e intervenciones (N)" dentro del modal) +
    botón "Todo OK": 6-7 clicks → 3 por orden.

**P2 — Dieta de la bandeja** (quitar sin perder capacidad):
12. Un solo filtro de estado: fuera el dropdown "Resumen" y los 4 KPIs
    duplicados (o KPIs como texto no-interactivo); la chip bar manda. −9
    controles.
13. Quitar el dot de trabajo muerto; "Mostrar fecha entrega" al menú;
    ordenar por cabeceras (fuera select+botón); "Devolución sin contrato" al
    menú "Más"; omitir el "Editar" gris del ⋯; retirar nota-entrega.html
    huérfana; chips de accesorios vivos al primer click.
14. Guardrails: Eliminar solo en no-terminales + motivo + campo `eliminado`
    protegido en rules; editar-orden valida estado por URL; aviso de
    sin-intervención también en ENTRADA; motivo mínimo en "No aplica
    contrato" + chip/filtro "sin contrato"; marca en os_logs al saltar
    recepción; escape+gate en reporte-pendientes.

**P3 — Dieta de peso** (arranque y datos):
15. Diferir storage/functions compat + módulos de acción (~90–100 KB gz y
    ~400 KB de parse menos en la página más usada).
16. Sprite SVG con los 69 iconos usados en vez de lucide entero (−85 KB gz).
17. Fila de detalle LAZY (construir al expandir): pintados de ~10,000 →
    ~4,000 nodos.
18. Purga del CSS muerto/duplicado (10–15% del archivo, bloques listados).
19. Filtrar `eliminado` server-side; opcional: bundle por página (42
    requests → ~10) sin cambiar la arquitectura vanilla.

**Proceso (con los datos en la mano — decisiones de negocio pequeñas):**
20. **PROGRAMACIÓN: intervención por ORDEN, no por equipo** — al completar,
    un solo texto "programación aplicada a N radios" que se estampa a todos
    (el lote como camino por defecto, no como opción escondida). El 46% de
    equipos sin registro es el proceso diciendo que el modelo no calza.
21. **REPARACIÓN: asegurar qc_requerido** — hoy solo 5 de 54 lo llevan;
    revisar por qué (cierres históricos/correcciones lo rodean) y hacer del
    QC de reparación la regla, no la excepción.
22. Chip/alerta de edad en POR ASIGNAR (9 órdenes >30 días son inventario
    fantasma) y en RECIBIDO estancado.
23. **Retirar la página fotos-taller** (7 usos en 90 días) y dejar UNA
    galería en el modal (resuelve de paso la decisión M5 pendiente con datos,
    no con opiniones).

## 6. Qué NO tocar

El ciclo asignar→completar→QC→entregar con sus candados en rules; los
modales de recepción/entrega con firma y motivos obligatorios; el snapshot
en vivo; skeletons+watchdog; filas expandidas que sobreviven re-renders;
deep-links `?orden=`/`?entrega=`/`?qc=1`; presets; SerialField; guards
anti doble-submit; el flujo de DEVOLUCIÓN con su badge. La base es sólida —
lo pesado es el motor de render con su bug de iconos, los 30 clicks de
materiales/fotos, y una bandeja con tres copias del mismo filtro.

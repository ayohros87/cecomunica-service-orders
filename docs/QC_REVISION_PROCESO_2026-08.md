# Control de calidad del taller — revisión de los primeros 15 días

**Fecha:** 2026-08-04 · **Periodo medido:** 2026-07-21 (arranque) → 2026-08-04
**Para:** Solangel Hosang (jefatura de taller)

El módulo de QC lleva dos semanas en uso. Esto es lo que dicen los datos y las
tres preguntas que necesitamos responder para ajustarlo. **Ninguno de estos
números es un reproche**: el sistema se diseñó sin línea base, y la única forma
de calibrarlo es mirar cómo se está usando de verdad.

---

## Lo que pasó

| | |
|---|---|
| Órdenes que pasaron por el control | **37** |
| Firmas de QC | **33** (34 pasadas en total) |
| Aprobadas | **33** |
| Rechazadas | **0** |
| Equipos cubiertos por esas firmas | **128** |
| Entregas hechas sin QC aprobado | **0** ✅ |

**El candado funciona.** En 15 días no salió un solo equipo sin la firma. Eso
era lo primero que había que verificar y está limpio.

### Escala de cada firma

Una firma de QC cubre toda la orden, no equipo por equipo:

- Mediana: **3 equipos por orden**
- Máximo: **10 equipos** en una sola firma
- Total: 128 equipos con 33 firmas

### Momento de la firma

| | |
|---|---|
| Mediana entre completar y firmar | **6 minutos** |
| Firmadas en menos de 1 hora | **21 de 32** |
| Firmadas dentro de 24 h | **32 de 32** |

### Reparto por técnico (órdenes / equipos revisados)

| Técnico | Órdenes | Equipos |
|---|---|---|
| Jesus Santos | 16 | 71 |
| Marcos Perez | 14 | 44 |
| Ovidio Adames | 3 | 13 |

---

## Las tres preguntas

### 1. ¿Por qué cero rechazos?

Hay dos lecturas y llevan a decisiones opuestas:

- **El taller entrega bien.** Entonces revisar el 100% es caro y conviene pasar
  a muestreo — revisar todo lo de un técnico nuevo, y una fracción de lo demás.
- **Los problemas se corrigen hablando.** Si cuando algo sale mal se lo dices al
  técnico de palabra y él lo arregla antes de que firmes, el rechazo formal
  nunca se usa. Eso es razonable en el día a día, pero deja el sistema ciego:
  no hay registro de qué falla ni con qué frecuencia, y el tablero de progreso
  muestra 0% de rechazo para todos.

**Lo que necesitamos saber:** ¿ha habido órdenes que devolviste al técnico sin
usar el botón de "Rechazar"? Si sí, ¿aproximadamente cuántas y por qué motivo?

### 2. Con 3 equipos de mediana (hasta 10), ¿qué revisas exactamente?

El checklist es uno por orden. Cuando una orden trae 10 radios, marcar
"Programación cargada y verificada" cubre los 10 con un solo tap.

**Lo que necesitamos saber:** ¿los revisas todos, o revisas una muestra del
lote? Si es una muestra, deberíamos poder registrarlo así en vez de que el
sistema diga "todos revisados".

### 3. Seis minutos de mediana

La mitad de las firmas ocurre a los 6 minutos de que el técnico marca la orden
como completada, y 21 de 32 dentro de la primera hora.

Eso puede significar que estás en el taller y revisas en el momento —que es lo
ideal— o que la orden ya venía revisada de antes y la firma es el registro de
algo que pasó antes. Las dos cosas están bien, pero cambian qué mide el sistema.

**Lo que necesitamos saber:** ¿el equipo está físicamente delante tuyo cuando
firmas?

---

## Lo que cambió esta semana (lo vas a notar)

1. **"Ver QC" ahora muestra el resultado**, no un checklist en blanco. Para
   volver a revisar hay un botón "Repetir QC".
2. **La firma queda ligada a los equipos de la orden.** Si después de firmar
   alguien agrega equipos o un batch, el QC **caduca** y hay que repetirlo — el
   sistema no puede decir "aprobado" sobre unidades que nadie miró.
3. **Se guarda qué seriales cubrió cada firma** y el historial completo de
   pasadas (antes solo quedaba la última).
4. **Correo diario** al taller con las órdenes esperando QC hace 3+ días. Hoy
   hay 4 en cola, una desde el 21 de julio.
5. **Suplencia:** se puede habilitar a otra persona para firmar QC sin cambiarle
   el rol (hoy el 100% de las firmas son tuyas; si faltas, las entregas se
   detienen). Falta decidir quién.

---

## Dos decisiones pendientes

- **¿Quién es tu suplente de QC?** Se configura en el panel de administración
  (`empresa/config` → `qc_revisores_extra`).
- **¿Pasamos a muestreo por riesgo?** Depende de la respuesta a la pregunta 1.
  Si los cero rechazos son reales, el criterio propuesto es: 100% para técnicos
  con menos de 3 meses o tras un reclamo de cliente, y ~30% del resto.

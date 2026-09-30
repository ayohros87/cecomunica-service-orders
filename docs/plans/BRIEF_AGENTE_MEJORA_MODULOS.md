# Brief para un agente de IA: cómo mejorar cada módulo de Cecomunica

> **Para quién es esto.** Un agente de IA con acceso a este repositorio (lectura de código, terminal, navegador por Chrome/puppeteer, emulador de Firebase). Pégale este documento completo como instrucción inicial.
> **Escrito:** 2026-09-30, con lo que se sabe del sistema a esa fecha.
> **Idioma de trabajo y de entrega:** español de Panamá, tuteo. Nada de voseo ni de España.

---

## 1. Tu misión

Investiga a fondo cómo mejorar cada módulo del app de Cecomunica y entrega propuestas concretas, priorizadas y con evidencia. Lo que más le importa al dueño, Alberto Yohros, es:

1. **Lo visual.** Que cada pantalla se entienda de un vistazo, se vea profesional y consistente, y que la información importante salte a la vista antes que la accesoria.
2. **Los flujos.** Que cada tarea diaria se haga con el menor número de pasos, sin callejones sin salida, sin tener que saber de memoria dónde está cada cosa, y sin que el sistema permita equivocarse en silencio.
3. **Todo lo que sea práctico.** Lo que le ahorre tiempo o errores a la gente que usa el app todos los días.

No te limites. Si concluyes que la mejor mejora para un módulo es rediseñarlo desde cero, cambiar cómo se organiza la navegación, fusionar pantallas, eliminar alguna, cambiar la arquitectura del frontend o proponer una herramienta distinta, dilo y argumenta. Este documento te da contexto y preguntas para guiarte, no un límite de lo que puedes proponer. Si algo de lo que aquí se afirma resulta falso cuando lo veas, confía en lo que ves y dilo.

---

## 2. El negocio en dos párrafos

Cecomunica es una empresa de radiocomunicación en Panamá. Alquila y vende radios (Motorola, Kenwood, Hytera y radios PoC que funcionan con SIM celular), los repara en su taller, hace visitas técnicas en sitio (torres, repetidores) y factura mensualidades. Sus clientes son empresas de seguridad, municipios, empresas de logística, hospitales y similares, muchos con decenas o cientos de radios cada uno.

El app (`app.cecomunica.net`) cubre todo el ciclo: **cliente → cotización → contrato → asignación de seriales en bodega → entrega → facturación**, y en paralelo **órdenes de servicio de taller y visitas**, con un **pool de equipos por serial** que es el inventario de cada radio individual. `docs/SISTEMA_TOP_DOWN.md` explica el sistema de arriba abajo; léelo primero.

---

## 3. Quién usa el app y qué hace (datos reales, septiembre 2026)

Ranking de acciones de los últimos 30 días, sacado de los registros de auditoría de Firestore (escrituras hechas desde el app):

| Módulo | Acciones en 30 días |
|---|---|
| Órdenes de servicio | 1,515 |
| Cotizaciones | 901 (679 son autoguardado de borradores de cotización de taller) |
| POC (radios con SIM) | 591 |
| Almacén (pool de equipos) | 534 |
| Clientes | 276 |
| Firmas (tablet y enlace) | 226 |
| Facturación | 171 |
| Gestiones del cliente | 119 |
| Contratos | 89 |

Las acciones más frecuentes:

- Editar los equipos de una orden: 631.
- Cambiar la SIM de una ficha POC: 361.
- Mover equipos en Almacén: 243. Editar la ficha de un equipo: 236.
- Asignar vendedor a un cliente: 232.
- Firmar en la tablet: 203. Check-in de devoluciones: 202.
- Asignar técnico: 144. Completar una orden: 116. Control de calidad: 91.
- Vincular cliente con QuickBooks: 144.

Quién concentra el trabajo (cuentas de Firebase; verifica el rol de cada una en la colección `usuarios`):

| Cuenta | Acciones | Lo que más hace |
|---|---|---|
| cecrecep (recepción) | 1,408 | SIM de POC, equipos de órdenes, check-in de devoluciones, firmas en tablet, crear órdenes |
| solangel.hosang (jefa de taller) | 1,248 | cotizaciones de taller, asignar técnico, equipos de órdenes, control de calidad |
| jose.solis (bodega) | 580 | mover y editar equipos en Almacén, ventas, gestiones |
| zuleika.diaz (gerencia administrativa) | 383 | vincular clientes con QuickBooks, catálogo de modelos, cotizaciones |
| marcos.perez, ovidio.adames, jesus.santos (técnicos) | 76 a 255 | equipos de la orden, piezas usadas, completar |
| cobros | 236 | asignar vendedor a clientes |
| elvia.onodera, karla.ferrer, salomon.arauz, alondra.acevedo (ventas) | 8 a 84 | cotizaciones, gestiones, envío a firma |
| alberto.yohros (dueño) | 53 escrituras, pero el que más lee | aprobaciones, Centro de clientes, panel admin |

**Desde el 2026-09-30 hay un contador de páginas vistas** por pantalla y por usuario en la colección `uso_diario`, visible en `admin/uso.html`. Si ya pasaron días, úsalo: te dice qué pantallas se abren de verdad y cuáles nadie abre.

Implicación que no debes perder de vista: **recepción, taller y bodega son el corazón del uso diario.** Una mejora de 3 segundos en una acción que recepción hace 350 veces al mes vale más que un rediseño de una pantalla de admin.

---

## 4. Estado técnico que debes conocer

- **Frontend:** 103 páginas HTML multipágina en `public/`, JavaScript vanilla, empaquetado con Vite en `dist/` (un entry por página en `public/js/entry/`). Firebase 12 desde npm (API compat + modular). Detalle en `docs/plans/PLAN_MIGRACION_MODULAR.md`.
- **Kit visual:** `public/css/ceco-ui.css` (base), `ceco-rail.css` (rail lateral), `bandeja.css` (bandejas), y el design system en `design-system/` (tokens de color y tipografía, kits de UI, maquetas). Hay un plan de adopción en `docs/plans/DS_ADOPTION_PLAN.md`. Revisa qué tanto se usa de verdad.
- **Componentes compartidos:** `js/ui/modal.js` (Modal.sheet, confirm, prompt), `js/ui/bandeja.js`, `js/ui/entity-picker.js`, `js/ui/formKit.js`, `js/ui/serial-field.js`, `js/core/layout.js` (rail, topbar, Ctrl+K), `js/core/icons.js` con un vendor de lucide a medida de 208 iconos (`tools/lucide-iconos.json`).
- **Velocidad:** se acaba de hacer una pasada completa (`docs/plans/PLAN_VELOCIDAD_PANTALLAS.md`). Las pantallas de uso diario ya no encadenan lecturas y pintan desde la caché local. El primer viaje a Firestore por página (~400 ms) sigue ahí porque cada navegación recarga la página. Si tu análisis de flujos concluye que eso pesa, dilo.
- **Seguridad:** `firestore.rules` es el piso real de permisos; la visibilidad por rol en la UI sale de `js/core/modulos.js` y `js/core/roles.js`.

---

## 5. Lo que ya se investigó (léelo para no repetirlo)

- **`docs/AUDITORIA_UX_2026-09-28.md`** (988 líneas). Auditoría de las 99 páginas con conteo de interacciones por flujo, hallazgos P0/P1/P2 por módulo, 12 mejoras transversales (T1 a T12: un nombre y un color por estado, glosario, doble submit, guards de acceso, sesión, búsqueda, móvil y tablet, fechas de Panamá, una sola forma de hacer cada cosa, modales, código muerto, lector de barras en bodega), "lo que está bien" y métricas de partida. **Se hizo solo leyendo código: nada se vio en un navegador.** Muchos de sus P0 ya se corrigieron después; verifica el estado real.
- **`docs/AUDITORIA_UX_2026-08-13.md`**, `AUDITORIA_ORDENES_2026-08-17.md`, `AUDITORIA_UI_SERIALES_2026-08-04.md`, `PROPUESTA_UI_ALMACEN_FINANZAS_2026-08.md`: auditorías y propuestas anteriores, útiles para ver qué se intentó.
- **`docs/mejoras-solicitadas/`**: lo que el equipo pidió por correo (Brenda en atención al cliente, Solangel en taller, Zuleika en gerencia). Es la voz del usuario; úsala.
- **`docs/plans/`**: planes por tema (ciclo de vida de equipos, cotizaciones, devolución en contratos, entrega parcial, regularización de cuentas, comisiones, QuickBooks). Te dicen qué decisiones de negocio están detrás de cada pantalla.
- **`CHANGELOG.md`** y el historial de git: más de 900 commits en tres meses. `git log --oneline -- public/js/pages/<archivo>` te cuenta la historia de cada pantalla y por qué está como está.

**Tu diferencia con las auditorías anteriores:** tú vas a VER las pantallas funcionando con datos reales, medir los flujos haciéndolos, y cruzarlo con el uso real.

---

## 6. Cómo ver las pantallas de verdad

No te quedes en el código. Recorre el app con datos reales en el emulador, sin tocar producción:

1. **Exportar datos de producción, solo lectura:** `tools/emulador-almacen/emu-export.js` (Admin SDK con credenciales ADC; se corre desde `functions/` con `NODE_PATH`). Amplía la exportación a las colecciones que necesites para cada módulo (clientes, contratos, órdenes, gestiones, poc_devices, cotizaciones, usuarios, modelos, equipos_pool, empresa, cargos).
2. **Levantar emuladores:** `firebase emulators:start --only auth,firestore,hosting --project cecomunica-service-orders` (Java 21 en el PATH; puertos 9099, 8080 y 5000 según `firebase.json`). Construye antes con `npm run build`.
3. **Sembrar:** `tools/emulador-almacen/emu-seed.js` crea los usuarios de Auth con clave `emulador123` y carga los documentos.
4. **Recorrer con Chrome:** `tools/emulador-almacen/emu-walk-almacen.mjs` es el modelo. Parcha el chunk de firebase-init para apuntar a los emuladores, inicia sesión solo y mide tiempos. Adáptalo para iniciar sesión como cada rol (recepción, taller, técnico, bodega, vendedor, gerencia, admin), recorrer los flujos, tomar capturas en escritorio (1280×800), tablet (1024×768, recepción firma en tablet) y teléfono (390×844, técnicos y bodega), y medir.

Notas prácticas:
- Chrome está en `C:/Program Files/Google/Chrome/Application/chrome.exe`; puppeteer-core en `functions/node_modules`.
- Las rutas para capturas y `file:///` van en formato Windows (`C:/...`).
- Los datos exportados son reales y confidenciales: se quedan en la máquina, nunca se suben a un servicio externo, y `emu-data.json` está en `.gitignore`. Las capturas con datos de clientes no salen del repo local.
- **Nada se escribe en producción.** Si una prueba necesita crear o modificar datos, hazlo en el emulador.

---

## 7. Las lentes con las que mirar cada módulo

Úsalas como guía, no como checklist rígido.

**Visual**
- ¿Qué es lo primero que ve el ojo? ¿Es lo más importante para quien usa la pantalla?
- Jerarquía, densidad, espaciado, alineación, contraste, tipografía. ¿Se lee en una tablet a un brazo de distancia?
- Consistencia con el resto del app y con el design system: mismos colores para los mismos estados, mismos componentes para las mismas cosas, mismas palabras para los mismos conceptos.
- Estados vacíos, de carga y de error: ¿dicen qué pasó y qué hacer?
- ¿Se ve bien en tablet y teléfono, donde de verdad se usa en taller, bodega y recepción?

**Flujos**
- Cuenta interacciones reales haciendo la tarea: clics, campos, confirmaciones, cambios de pantalla. Compara con la tabla de la auditoría del 28 de septiembre.
- ¿Desde dónde llega la persona a esta tarea y a dónde va después? ¿Tiene que volver al inicio o abrir otra pestaña?
- ¿Qué pasa si se equivoca? ¿El sistema lo impide, lo avisa o lo deja pasar en silencio? ¿Se puede deshacer?
- ¿Hay dos formas distintas de hacer lo mismo? ¿Alguna es un callejón sin salida?
- ¿La pantalla le pide a la persona algo que el sistema ya sabe?
- ¿Qué parte del trabajo se hace fuera del app (Excel, WhatsApp, correo, papel) porque el app no lo resuelve?

**Práctico**
- Lector de código de barras en bodega y recepción, cámara en el teléfono, tablet de firmas.
- Atajos de teclado para quien hace la misma acción cientos de veces.
- Búsqueda: ¿se encuentra un radio por serial, un cliente por nombre o RUC, una orden por número, desde cualquier lado?
- Notificaciones y correos: ¿llegan a quien tienen que llegar, en el momento que sirven?
- Accesibilidad básica: foco del teclado, contraste, tamaño de objetivos táctiles.
- Números que se muestran: ¿son verdad? La auditoría anterior encontró KPIs que mentían.

---

## 8. Módulo por módulo: por dónde empezar

Estos son los puntos de partida con más peso según el uso real y lo que se sabe. Ve más allá.

### 8.1 Órdenes de servicio (`ordenes/`, `js/pages/ordenes-*.js`)
El módulo más usado. Recepción crea órdenes y hace check-in de devoluciones; taller asigna técnicos, completa y hace control de calidad; técnicos registran piezas; recepción entrega con firma en tablet.
- "Editar equipos de la orden" es la acción más frecuente del sistema (631 en un mes). Mídela haciéndola: ¿cuántos pasos cuesta agregar, quitar o corregir un equipo? ¿Se puede escanear el serial?
- El ciclo POR ASIGNAR → ASIGNADO → COMPLETADO → QC → ENTREGADO: ¿se entiende en qué paso está cada orden y qué le toca a quién? La bandeja se rediseñó para "calma visual" (`docs/plans`, memoria del proyecto); juzga si funciona.
- Visitas técnicas, devoluciones, entradas: son circuitos distintos dentro del mismo módulo. ¿Se distinguen bien? ¿Confunden?
- El técnico en teléfono: ¿puede trabajar su orden de pie en el taller?

### 8.2 Cotizaciones (`cotizaciones/`, `ordenes/cotizar-orden.html`)
Dos mundos: cotizaciones comerciales (ventas) y cotizaciones de taller desde una orden (Solangel).
- El borrador de taller se autoguarda 679 veces en un mes: ¿indica que el flujo es largo y la persona vuelve varias veces? Mídelo.
- Aprobación, envío, vencimiento, conversión a contrato u orden: ¿el estado se entiende? ¿Qué pasa después de enviar?
- 46 cotizaciones eliminadas en el mes: ¿por qué se eliminan tantas? ¿Errores al crear?

### 8.3 POC (`POC/`)
Radios con SIM celular. Recepción cambia SIMs 361 veces al mes.
- Cambiar una SIM: ¿cuántos pasos? ¿Se puede hacer en lote? ¿Se valida que la SIM no esté en otro radio?
- La base tiene 6,498 fichas: búsqueda, filtros, fichas cerradas vs. vivas, duplicados.
- Lotes nuevos (`nuevo-batch`, `vendedores-batch`), consolas, grupos por cliente, inventario de SIM: ¿es un módulo o son varios pegados?

### 8.4 Almacén (`almacen/`, `inventario/`)
Bodega (José Solís) mueve y edita equipos, asigna seriales a contratos, registra ventas.
- Mover un equipo y editar su ficha suman 480 acciones al mes en una sola persona: ¿se puede hacer en lote, con lector de barras, sin abrir ficha por ficha?
- Asignar seriales a un contrato (pestaña Asignar): mídelo con un contrato de 50 radios.
- Hoy, Existencias, Serial/Avanzado, conteos, descartados, no devueltos, piezas: ¿la persona sabe qué hacer al abrir el espacio?

### 8.5 Centro de gestión de clientes (`clientes/centro.html`)
La ficha 360 del cliente donde viven contratos, flota, gestiones (aumentos, reemplazos, renovaciones, bajas, demos), documentos y regularización. El dueño es quien más lo usa.
- ¿Una persona nueva entiende la ficha de un cliente con 300 radios y 10 contratos?
- Las gestiones tienen varios pasos y aprobaciones: ¿se sabe qué falta y quién lo debe hacer?
- "Asignar vendedor" se hace 232 veces al mes desde la cuenta de cobros: ¿hay una forma masiva?

### 8.6 Contratos (`contratos/`)
Alta, aprobación, firma por enlace o en papel, seriales, transición de equipos, devoluciones.
- El recorrido completo de un contrato nuevo, desde la cotización hasta la entrega: ¿cuántas pantallas y personas toca? ¿Dónde se atasca?
- Firma: tablet, enlace, papel. ¿Queda claro cuál aplica y qué falta?

### 8.7 Facturación (`facturacion/`)
Activación, bandeja de avisos, clientes en QuickBooks, comisiones, emisión.
- Vincular clientes con QuickBooks fue trabajo de una semana para Zuleika: ¿se puede automatizar o sugerir el emparejamiento?
- `docs/FACTURACION_COMO_FUNCIONA.md` explica el proceso; contrástalo con lo que la pantalla muestra.

### 8.8 Home, rail y navegación
- El home muestra señales (tarjetas con conteos) y feeds por rol. ¿Cada rol ve lo que tiene que hacer hoy?
- El rail lateral, el buscador Ctrl+K, los enlaces entre módulos: ¿la persona se orienta o se pierde?
- ¿Tiene sentido la organización en módulos tal como está, o las tareas reales cruzan módulos todo el tiempo?

### 8.9 Panel de administración (`admin/`)
Solo lo usa el dueño. Prioridad baja frente al resto, salvo que encuentres algo que le ahorre decisiones.

---

## 9. Lo que tienes que entregar

Un documento por módulo en `docs/auditoria-modulos/` (Markdown), más un resumen general. Cada documento con:

1. **Para quién es el módulo y qué hacen ahí**, con los números de uso.
2. **Recorrido real**: los flujos principales hechos en el emulador, con capturas (en `docs/auditoria-modulos/capturas/`, que queda fuera del git si llevan datos de clientes: agrégalo al `.gitignore`), conteo de interacciones y tiempos.
3. **Hallazgos**, cada uno con evidencia: captura, `archivo:línea` o dato de uso. Separa lo roto, lo confuso y lo lento.
4. **Propuestas**, de la más pequeña a la más ambiciosa. Para cada una: qué cambia, por qué, cuánto ahorra (pasos, segundos, errores evitados), cuánto cuesta hacerla (horas, días, semanas) y qué riesgo tiene. Para las visuales, incluye una maqueta: un HTML autocontenido que use el CSS real del app (`public/css/ceco-ui.css`) o un antes y después.
5. **Cómo saber si funcionó**: qué medir antes y después (contador de uso, audit logs, conteo de pasos).

El **resumen general** debe tener: los 10 cambios con mejor relación impacto/esfuerzo de todo el app, los problemas transversales que se repiten en varios módulos, y tu opinión franca sobre si la estructura actual del app sirve o hay que replantearla.

---

## 10. Cómo trabajar

- Empieza por los módulos con más uso: órdenes, cotizaciones, POC, almacén, Centro. Luego el resto.
- Puedes repartir el trabajo en subagentes por módulo si tu entorno lo permite; cada uno con este brief y su sección.
- Cuando algo dependa de una decisión de negocio que no puedes deducir del código ni de los documentos, no la supongas: anótala como pregunta para Alberto, con las opciones y lo que implica cada una.
- No modifiques el código del app en esta investigación. Las maquetas y los scripts de medición van en `docs/auditoria-modulos/` o en una carpeta temporal.
- Si encuentras algo roto que está afectando a los usuarios hoy (un dato falso, una acción que falla), repórtalo arriba del resumen, aparte, para que se atienda primero.

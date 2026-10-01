# Auditoría de módulos 2026-09-30 · método e instrucciones para cada auditor

> Este archivo es la instrucción común de los auditores por módulo (agentes de IA). El brief
> completo está en `docs/plans/BRIEF_AGENTE_MEJORA_MODULOS.md`: léelo entero antes de empezar;
> tu módulo es una sección de su §8. Idioma: español de Panamá, tuteo. Nada de voseo ni de España.

## 1. Lo que ya está montado (no lo levantes de nuevo)

- **Emuladores corriendo** en esta máquina: hosting `http://127.0.0.1:5000` (sirve `dist/`,
  build de hoy), Firestore `127.0.0.1:8080`, Auth `127.0.0.1:9099`. UI del emulador en
  `http://127.0.0.1:4000`. **No los arranques, no los pares, no los re-siembres.** Otros
  auditores los están usando al mismo tiempo.
- **Datos:** 60,436 documentos exportados de producción hoy (todas las colecciones menos
  `mail_queue`, `qbo_webhook_events` e `integraciones`, más las subcolecciones: seriales,
  seriales_estado/historial/cambios, movimientos del pool, eventos de gestiones, historial y
  documentos de clientes, consumos y equipos_meta de órdenes, borradores de cotización,
  órdenes cacheadas en contratos). Son reales y confidenciales: nunca salen de la máquina.
- **Usuarios de Auth** (clave `emulador123` para todos). `tools/emulador-almacen/emu-lib.mjs`
  exporta el mapa `USUARIOS`:

| Clave | Cuenta | Rol en `usuarios` | Persona |
|---|---|---|---|
| admin | alberto.yohros@cecomunica.com | administrador | Alberto (dueño) |
| gerencia | zuleika.diaz@cecomunica.com | administrador | Zuleika (gerencia administrativa) |
| recepcion | cecrecep@cecomunica.com | recepcion | Brenda (recepción) |
| cobros | cobros@cecomunica.com | recepcion | Andrea (cobros) |
| jefe_taller | solangel.hosang@cecomunica.com | jefe_taller | Solangel |
| tecnico | marcos.perez@cecomunica.com | tecnico | Marcos |
| tecnico_operativo | ovidio.adames@cecomunica.com | tecnico_operativo | Ovidio |
| inventario | jose.solis@cecomunica.com | inventario | José (bodega) |
| vendedor | karla.ferrer@cecomunica.com | vendedor | Karla |
| contabilidad | cheila.sanchez@cecomunica.com | contabilidad | Cheila |

  Otros: victor.mariche (recepcion), reynaldo.cruz y dionisio.quintero (tecnico_operativo),
  jesus.santos (tecnico), elvia.onodera / salomon.arauz / alondra.acevedo (vendedor). No hay
  ningún usuario con rol `gerente` ni `vista` en producción.

## 2. Reglas que no se negocian

1. **Nada se escribe en producción.** Nunca corras Admin SDK, `gcloud` ni `firebase` contra el
   proyecto real. Si necesitas leer o escribir datos por fuera del navegador, hazlo SOLO con
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` (y `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`)
   desde `functions/` con `NODE_PATH=./node_modules`.
2. **No modifiques el código del app** (`public/`, `functions/`, `firestore.rules`, `dist/`).
   Maquetas y scripts van en `docs/auditoria-modulos/`.
3. **Datos de prueba que crees en el emulador:** ponles el prefijo `PRUEBA-AUDIT-<modulo>` en
   el nombre o la observación, y no borres ni anules lo que no creaste tú. El emulador es
   compartido.
4. **Capturas** van en `docs/auditoria-modulos/capturas/<modulo>/` (carpeta en `.gitignore`
   porque llevan datos de clientes). Nómbralas `NN-rol-viewport-que-se-ve.png`.
5. **Scripts de recorrido y medición** van en `docs/auditoria-modulos/scripts/<modulo>/`
   (sin datos, se versionan). Reutiliza `emu-lib.mjs`; no dupliques el parche del emulador.
6. **Maquetas** en `docs/auditoria-modulos/maquetas/<modulo>-<nombre>.html`, autocontenidas:
   copia dentro de un `<style>` el CSS real de `public/css/ceco-ui.css` (y `bandeja.css` /
   `ceco-rail.css` si aplica) o enlázalo por ruta relativa `../../../public/css/ceco-ui.css`.
   Un antes/después con la captura real al lado vale más que una maqueta inventada.

## 3. Cómo recorrer el app

```js
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
const s = await abrir({ email: USUARIOS.recepcion, viewport: 'tablet', carpeta: 'ordenes' });
const info = await s.ir('/ordenes/index.html');   // {msTotal, fsReqs, primeraFs, quieto, url, titulo}
await s.captura('01-recepcion-tablet-bandeja');     // PNG; {full:true} para página completa; {el:'#selector'} para un elemento
await s.clic('#btnNuevaOrden');                     // clic + espera a que el DOM se aquiete
await s.hacer(() => document.querySelector('.modal-backdrop.open .btn-primary').click());
await s.texto('.modal-backdrop.open');              // texto visible
await s.geometria();                                // alto, scroll horizontal, objetivos táctiles < 36 px
s.errores; await s.toasts(); await s.consultas();   // errores de consola/pageerror/diálogos nativos; Toast.show; consultas por servicio con ms
s.page                                              // la página de puppeteer, para lo demás
await s.cerrar();
```

Correr con `node <script>.mjs` desde cualquier carpeta (la lib usa rutas absolutas). Viewports:
`escritorio` 1280×800, `tablet` 1024×768 (recepción firma en tablet), `telefono` 390×844
(técnicos y bodega). El login es automático (la lib parcha el chunk de firebase-init y se
traga el `null` de `onAuthStateChanged`); si una página rebota a `login.html`, `s.errores` lo
dice. Abre una sesión distinta (`abrir`) por usuario; no compartas el perfil de Chrome.

Trampas conocidas (de auditorías anteriores):
- Acota los selectores de diálogos a `.modal-backdrop.open`: las páginas traen modales
  estáticos con las mismas clases.
- Fija el viewport ANTES de abrir el diálogo que vas a medir; cambiarlo repinta la página.
- Un guardado bloqueado por validación se ve igual que "no pasó nada": mira `s.toasts()`.
- Un `<select>` que se llena antes de que el init enganche el `change` pierde el evento:
  dispara el `change` en bucle hasta ver el efecto.
- Estados de gestiones: los válidos están en `GestionesService.ESTADOS`; no inventes.
- La bandeja de órdenes muestra las 40 más recientes; para llegar a una orden vieja usa el
  deep-link por fila o el buscador.
- Para contar interacciones: 1 clic, 1 campo tecleado, 1 confirmación, 1 gesto = 1. Cuenta
  el camino feliz con el app ya abierto, y anota qué pasa si te equivocas.
- Para medir tiempo: `s.ir()` devuelve `msTotal` (hasta DOM quieto) y `primeraFs`; para una
  acción dentro de la página mide `performance.now()` antes del clic y `window.__m.ultimaMut`.

## 4. Fuentes que debes cruzar

- `docs/SISTEMA_TOP_DOWN.md` (arquitectura y flujos).
- `docs/AUDITORIA_UX_2026-09-28.md`: la sección 4.x de tu módulo y sus P0 en la sección 1.
  **Verifica en el navegador cuáles siguen vigentes** y dilo (resuelto / vigente / parcial).
- `docs/mejoras-solicitadas/` (la voz del usuario), `docs/plans/` (decisiones de negocio).
- `git log --oneline -- public/js/pages/<archivo>` para la historia de cada pantalla.
- Uso real: los números del §3 del brief. `uso_diario` solo tiene un día (hoy); si lo
  consultas, dilo.
- Código: `public/js/pages/`, `public/js/ui/`, `public/js/core/modulos.js` y `roles.js`
  (quién ve qué), `firestore.rules` (el piso real de permisos).

## 5. Lo que entregas

Un archivo `docs/auditoria-modulos/<NN>-<modulo>.md` con las cinco partes del §9 del brief:

1. **Para quién es y qué hacen ahí**, con los números de uso.
2. **Recorrido real**: flujos principales hechos en el emulador, por rol y dispositivo, con
   captura, conteo de interacciones y tiempos. Una tabla por flujo.
3. **Hallazgos** con evidencia (captura, `archivo:línea`, dato). Tres grupos: **roto**,
   **confuso**, **lento**. Arriba de todo, aparte, **"ROTO HOY"**: lo que está afectando a los
   usuarios en este momento (dato falso, acción que falla).
4. **Propuestas**, de la más chica a la más ambiciosa. Para cada una: qué cambia, por qué,
   cuánto ahorra (pasos, segundos, errores), cuánto cuesta (horas/días/semanas), riesgo. Las
   visuales con maqueta o antes/después.
5. **Cómo saber si funcionó**: qué medir antes y después.

Y al final, dos secciones cortas para el resumen general: **"Top 5 impacto/esfuerzo del
módulo"** (una línea cada una con ahorro y costo) y **"Preguntas para Alberto"** (decisiones de
negocio que no se pueden deducir; opciones y qué implica cada una).

Escribe para Alberto: claro, directo, sin relleno. Cada afirmación con su evidencia. Si algo
del brief o de la auditoría anterior resulta falso al verlo, dilo. Si concluyes que hay que
rediseñar, fusionar o eliminar pantallas, dilo y argumenta. No pegues archivos enteros ni
listas de 40 hallazgos menores: prioriza.

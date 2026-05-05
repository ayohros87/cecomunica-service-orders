# Arquitectura del Sistema Cecomunica

## 📋 Índice

1. [Descripción General](#descripción-general)
2. [Stack Tecnológico](#stack-tecnológico)
3. [Arquitectura de la Aplicación](#arquitectura-de-la-aplicación)
4. [Módulos del Sistema](#módulos-del-sistema)
5. [Base de Datos (Firestore)](#base-de-datos-firestore)
6. [Backend - Cloud Functions](#backend---cloud-functions)
7. [Sistema de Autenticación y Roles](#sistema-de-autenticación-y-roles)
8. [Flujos de Negocio Principales](#flujos-de-negocio-principales)
9. [Integraciones Externas](#integraciones-externas)
10. [Seguridad](#seguridad)
11. [Despliegue y Hosting](#despliegue-y-hosting)

---

## 📖 Descripción General

**Cecomunica Service Orders** es una plataforma web integral para la gestión de servicios de comunicación por radio. El sistema permite administrar:

- **Órdenes de servicio** para reparación de equipos
- **Inventario** de radios y piezas
- **Contratos** con clientes (ventas, alquileres, renovaciones)
- **Base de datos PoC** (Push-to-Talk over Cellular) para gestión de radios, SIM cards, IPs y grupos
- **Clientes** y su información comercial
- **Cotizaciones** y documentos formales

### Objetivo del Sistema
Centralizar todas las operaciones comerciales y técnicas de Cecomunica en una única plataforma accesible desde cualquier dispositivo con navegador web.

---

## 🛠 Stack Tecnológico

### Frontend
- **HTML5** + **CSS3** (custom design system: `ceco-ui.css`)
- **JavaScript Vanilla** (sin frameworks)
- **Firebase SDK 10.10.0** (compat mode)
  - `firebase-auth-compat.js`
  - `firebase-firestore-compat.js`
  - `firebase-storage-compat.js`

### Backend
- **Firebase Cloud Functions** (Node.js 22)
- **Firebase Admin SDK** 12.7.0
- **Puppeteer Core** 24.17.0 (generación de PDFs)
- **Nodemailer** 7.0.5 (envío de emails)
- **CORS** 2.8.5

### Base de Datos
- **Cloud Firestore** (NoSQL)
- **Firebase Storage** (almacenamiento de archivos)

### Herramientas Adicionales
- **SheetJS (XLSX)** 0.18.5 - Importación/exportación de Excel
- **SendGrid** - Servicio de email transaccional
- **QR Code API** - Generación de códigos QR para verificación

---

## 🏗 Arquitectura de la Aplicación

### Patrón Arquitectónico
**SPA (Single Page Application)** con navegación multi-página basada en carpetas funcionales.

```
┌─────────────────────────────────────────────────────┐
│                  USUARIO / BROWSER                   │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│          Firebase Hosting (Static Files)             │
│  ┌───────────────────────────────────────────────┐  │
│  │  /public/                                      │  │
│  │    - index.html (Dashboard)                    │  │
│  │    - login.html                                │  │
│  │    - /ordenes/  (módulo órdenes)              │  │
│  │    - /contratos/ (módulo contratos)           │  │
│  │    - /inventario/ (módulo inventario)         │  │
│  │    - /POC/ (base de datos radios)             │  │
│  │    - /clientes/ (gestión clientes)            │  │
│  │    - /verify/ (verificación contratos)        │  │
│  │    - /js/firebase-init.js (config global)     │  │
│  │    - /css/ceco-ui.css (design system)         │  │
│  └───────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│              Firebase Authentication                 │
│         (Email/Password + Session Tokens)            │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│                 Cloud Firestore                      │
│  ┌───────────────────────────────────────────────┐  │
│  │  Collections:                                  │  │
│  │    - usuarios                                  │  │
│  │    - ordenes_de_servicio                      │  │
│  │    - contratos                                │  │
│  │    - verificaciones                           │  │
│  │    - clientes                                 │  │
│  │    - inventario_radios                        │  │
│  │    - piezas                                   │  │
│  │    - poc_equipos                              │  │
│  │    - modelos                                  │  │
│  │    - empresa                                  │  │
│  └───────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│           Firebase Cloud Functions (v2)              │
│  ┌───────────────────────────────────────────────┐  │
│  │  - sendMail (envío de emails)                 │  │
│  │  - generateContractPDF                         │  │
│  │  - onContratoActivado (trigger)               │  │
│  └───────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│             Servicios Externos                       │
│    - SendGrid (emails)                               │
│    - QR Server API (códigos QR)                      │
│    - Chromium/Puppeteer (PDFs)                       │
└─────────────────────────────────────────────────────┘
```

---

## 📦 Módulos del Sistema

### 1. **Dashboard Principal** (`/public/index.html`)
- Punto de entrada único al sistema
- Grid de tarjetas con acceso a todos los módulos
- Buscador de módulos con filtrado en tiempo real
- Control de visibilidad por roles

**Módulos disponibles:**
- 🛠️ Órdenes de Servicio
- 📡 Base de Datos PoC
- 📦 Inventario de Radios
- 🧩 Inventario de Piezas
- 📝 Contratos
- 👥 Clientes
- 🧑‍💼 Vendedores
- 📊 Reportes

---

### 2. **Órdenes de Servicio** (`/public/ordenes/`)

#### Funcionalidades principales:
- **Gestión de órdenes de reparación**
  - Alta, edición, consulta de órdenes
  - Estados: recibido, diagnóstico, en_reparacion, reparado, entregado
  - Asignación de técnicos
  - Registro de equipos averiados

- **Cotizaciones**
  - `cotizar-orden.html` - Cotización simple
  - `cotizar-orden-formal.html` - Cotización formal con PDF
  - Cálculo automático de piezas, mano de obra e ITBMS (7%)

- **Gestión de equipos**
  - `agregar-equipo.html` - Añadir equipos a órdenes
  - Subcollección `equipos_meta` para metadata de cada equipo
  - Registro de consumos (piezas utilizadas)

- **Documentos**
  - `imprimir-orden.html` - Orden en PDF
  - `nota-entrega.html` - Comprobante de entrega
  - `firmar-entrega.html` - Firma digital del cliente

- **Configuración**
  - `config.html` - Parámetros del módulo
  - Modelos de radios
  - Estados de reparación personalizables

#### Estructura de datos:
```javascript
ordenes_de_servicio/{ordenId}
  - orden_id: string
  - cliente_id: string
  - cliente_nombre: string
  - fecha_recepcion: timestamp
  - estado: enum
  - tecnico_asignado: string
  - total: number
  - observaciones: string
  
  /equipos_meta/{equipoId}
    - descripcion: string
    - modelo: string
    - serial: string
    - problema_reportado: string
    - diagnostico: string
  
  /consumos/{consumoId}
    - tipo: "pieza" | "cobro"
    - descripcion: string
    - cantidad: number
    - precio: number
```

---

### 3. **Contratos** (`/public/contratos/`)

#### Funcionalidades principales:
- **Gestión de contratos**
  - `nuevo-contrato.html` - Creación de contratos
  - `editar-contrato.html` - Edición de contratos existentes
  - Tipos: venta, alquiler, renovación
  - Estados: pendiente_aprobacion, activo, vencido, anulado

- **Sistema de aprobación**
  - Workflow de dos niveles: vendedor → administrador
  - Firma digital con código de verificación
  - Hash SHA-256 para integridad del contrato

- **Verificación pública**
  - URL pública: `/c/{contratoId}?v={codigo}`
  - Verificación sin autenticación
  - Código QR en documentos PDF

- **Clientes**
  - `nuevo-cliente.html` - Alta de clientes desde contratos
  - Validación de RUC/Cédula
  - Vinculación automática

- **Generación de documentos**
  - `imprimir-contrato.html` - Plantilla HTML para PDF
  - Cloud Function para generación server-side
  - Términos y condiciones personalizables

#### Estructura de datos:
```javascript
contratos/{contratoId}
  - contrato_id: string
  - cliente_id: string
  - cliente_nombre: string
  - cliente_ruc: string
  - representante: string
  - tipo_contrato: "venta" | "alquiler" | "renovacion"
  - accion: "nuevo" | "renovacion" | "traspaso"
  - duracion: string (ej: "12 meses")
  - estado: enum
  - equipos: array
    - descripcion: string
    - modelo: string
    - cantidad: number
    - precio: number
  - subtotal: number
  - itbms: number (7%)
  - total_con_itbms: number
  - fecha_creacion: timestamp
  - fecha_modificacion: timestamp
  - fecha_aprobacion: timestamp
  - firma_url: string (URL de verificación)
  - firma_codigo: string (código único)
  - firma_hash: string (SHA-256)
  - aprobado_por_uid: string
  - vendedor_uid: string

verificaciones/{contratoId}
  - firma_codigo: string
  - firma_url: string
  - firma_hash: string
  - fecha_aprobacion: timestamp
  - aprobado_por_nombre: string
  - aprobado_por_email: string
  - aprobado_por_rol: string
  - total_con_itbms: number
```

---

### 4. **Inventario de Radios** (`/public/inventario/`)

#### Funcionalidades principales:
- **Control de stock**
  - Ingresos y salidas de radios
  - Estados: disponible, asignado, en_reparacion, baja
  - Movimientos con historial

- **Catálogo de modelos**
  - `modelos.html` - Gestión de modelos
  - Marca, modelo, especificaciones
  - Precio de referencia

- **Carga masiva**
  - `cargar-inventario.html` - Importación desde Excel
  - Plantilla estandarizada
  - Validación de datos

- **Vista de correo**
  - `vista-correo.html` - Formato de email para inventario
  - Resúmenes automáticos

#### Estructura de datos:
```javascript
inventario_radios/{radioId}
  - modelo: string
  - marca: string
  - serial: string
  - estado: enum
  - fecha_ingreso: timestamp
  - precio_compra: number
  - asignado_a: string (cliente_id)
  - notas: string

modelos/{modeloId}
  - marca: string
  - modelo: string
  - tipo: string
  - precio_venta: number
  - precio_alquiler_mensual: number
  - especificaciones: string
```

---

### 5. **Inventario de Piezas** (`/public/inventario/piezas.html`)

#### Funcionalidades principales:
- Catálogo de repuestos
- Control de stock
- Precios para cotizaciones
- Registro de uso en órdenes

#### Estructura de datos:
```javascript
piezas/{piezaId}
  - nombre: string
  - codigo: string
  - categoria: string
  - stock: number
  - precio_compra: number
  - precio_venta: number
  - proveedor: string
  - ubicacion: string
```

---

### 6. **Base de Datos PoC** (`/public/POC/`)

#### Funcionalidades principales:
- **Gestión de radios PoC**
  - Registro de radios con SIM, IP, GPS
  - Asignación a clientes
  - Grupos de comunicación
  - Estados: activo, inactivo, pendiente

- **Operadores y vendedores**
  - Asignación de vendedores a clientes
  - Gestión de operadores de radio

- **Importación/Exportación**
  - Excel bidireccional
  - Actualización masiva
  - `vendedores-batch.html` - Carga masiva de vendedores

#### Estructura de datos:
```javascript
poc_equipos/{equipoId}
  - serial: string
  - modelo: string
  - cliente_id: string
  - cliente: string (nombre)
  - sim_numero: string
  - sim_operador: string
  - ip_estatica: string
  - gps_lat: number
  - gps_lng: number
  - grupo: string
  - estado: enum
  - notas: string
  - vendedor: string
  - fecha_asignacion: timestamp
```

---

### 7. **Clientes** (`/public/clientes/`)

#### Funcionalidades principales:
- **CRUD de clientes**
  - Listado con paginación
  - Edición inline
  - Búsqueda avanzada

- **Operaciones masivas**
  - Activar/desactivar múltiples clientes
  - Asignación de tags
  - Exportación a Excel

- **Información comercial**
  - RUC/Cédula con dígito verificador
  - Representante legal
  - Datos de contacto
  - Vendedor asignado

#### Estructura de datos:
```javascript
clientes/{clienteId}
  - nombre: string (nombre comercial)
  - ruc: string
  - dv: string (dígito verificador)
  - representante: string
  - cedula_rep: string
  - telefono: string
  - email: string
  - direccion: string
  - vendedor: string
  - tags: array
  - activo: boolean
  - fecha_creacion: timestamp
```

---

### 8. **Sistema de Verificación** (`/public/verify/`)

#### Funcionalidades:
- Verificación pública de contratos
- URL amigable: `/c/{contratoId}?v={codigo}`
- Sin necesidad de autenticación
- Validación de hash
- Muestra información del contrato aprobado

---

## 🗄 Base de Datos (Firestore)

### Colecciones Principales

#### **usuarios**
```javascript
{
  uid: string (ID de auth),
  email: string,
  nombre: string,
  cargo: string,
  rol: "administrador" | "vendedor" | "tecnico" | "jefe_taller" | "readonly",
  activo: boolean,
  fecha_creacion: timestamp
}
```

#### **ordenes_de_servicio**
```javascript
{
  numero_orden: string (auto-generado YYYYMMDDNN),
  cliente_id: string,
  cliente_nombre: string,
  vendedor_asignado: string (uid),
  tecnico_uid: string,
  tecnico_nombre: string,
  tipo_de_servicio: string,
  estado_reparacion: enum,
  observaciones: string,
  fecha_creacion: timestamp,
  fecha_modificacion: timestamp,
  equipos: array[{
    serial: string,
    modelo: string,
    descripcion: string,
    eliminado: boolean
  }],
  
  // ⭐ Campo para vinculación con contratos
  contrato: {
    aplica: boolean,
    contrato_doc_id: string,      // ID del documento en contratos/
    contrato_id: string,           // CT-YYYY-NNN
    motivo_no_aplica: string       // Si aplica=false
  },
  
  eliminado: boolean,
  creado_por_uid: string,
  creado_por_email: string
}
```

#### **contratos**
```javascript
{
  contrato_id: string (CT-YYYY-NNN),
  cliente_id: string,
  cliente_nombre: string,
  cliente_ruc: string,
  representante: string,
  tipo_contrato: enum ("ALQUILER" | "VENTA" | "RENOVACION"),
  accion: enum,
  duracion: string,
  estado: enum ("pendiente_aprobacion" | "aprobado" | "activo" | "anulado" | "inactivo"),
  equipos: array[{
    modelo: string,
    cantidad: number,
    precio: number
  }],
  
  // Totales
  subtotal: number,
  itbms: number,
  total_con_itbms: number,
  
  // Firmas digitales (gestionadas por CF)
  firma_codigo: string,           // 10 char hex (generado por CF)
  firma_hash: string,             // HMAC SHA-256 (generado por CF)
  firma_url: string,              // URL de verificación (generada por CF)
  fecha_aprobacion: timestamp,    // Seteado por CF
  
  // Aprobación
  aprobado_por_uid: string,
  creado_por_uid: string,
  
  // ⭐ Campos de resumen para órdenes (mantenidos por CF)
  os_count: number,                    // Cantidad de órdenes asociadas
  equipos_total: number,               // Total de equipos en órdenes
  tiene_os: boolean,                   // true si os_count > 0
  os_linked: boolean,                  // true si tiene órdenes ligadas
  os_last_orden_id: string,            // ID de última orden
  os_last_updated_at: timestamp,       // Última actualización
  os_equipos_count_last: number,       // Equipos en última orden
  os_serials_preview: array[string],   // Primeros 3 serials [s1, s2, s3]
  os_has_equipos: boolean,             // true si tiene equipos
  os_dirty: boolean,                   // Marca para rebuild si necesario
  
  // Metadata
  fecha_creacion: timestamp,
  fecha_modificacion: timestamp,
  updated_at: timestamp,
  deleted: boolean,
  listo_para_comision: boolean
}

// Subcolección: contratos/{contratoId}/ordenes/{ordenId} (CACHE)
// Mantenida automáticamente por CF: onOrdenWriteSyncContratoCache
{
  numero_orden: string,
  cliente_id: string,
  cliente_nombre: string,
  tipo_de_servicio: string,
  estado_reparacion: string,
  fecha_creacion: timestamp,
  equipos: array[{
    serial: string,
    modelo: string,
    descripcion: string,
    unit_id: string,
    sim: string
  }],
  equipos_count: number,
  serials: array[string],
  updated_at: timestamp,
  _rebuilt_at: timestamp          // Si fue reconstruido por script
}
```

#### **verificaciones** (Espejo Público)
```javascript
{
  contrato_id: string (mismo que en contratos),
  cliente_nombre: string,
  total_con_itbms: number,
  aprobado_por_uid: string,
  aprobado_por_nombre: string,
  aprobado_por_email: string,
  aprobado_por_rol: string,
  fecha_aprobacion: timestamp,
  firma_codigo: string,
  firma_hash: string,
  firma_url: string,
  estado: string,
  creado_en: timestamp
}
```
**Nota**: Esta colección es de solo lectura pública (sin auth). Creada/actualizada solo por CF `onContratoActivado`.

#### **clientes**
```javascript
{
  nombre: string,
  ruc: string,
  email: string,
  telefono: string,
  direccion: string,
  vendedor_asignado: string (uid),
  fecha_creacion: timestamp,
  deleted: boolean,
  nombre_lower: string              // Para búsquedas case-insensitive
}
```

#### **inventario_radios** y **piezas**
- Control de stock
- Historial de movimientos

#### **poc_equipos**
- Radios PoC activos
- Asignación a clientes

#### **modelos**
- Catálogo de modelos de radios
- Usado en múltiples módulos

#### **empresa**
- Documentos especiales: `perfil`, `parametros`
- Configuración global del sistema

#### **mail_queue** (Cola de Emails)
```javascript
{
  to: string,
  cc: string,
  subject: string,
  bodyContent: string,             // HTML body
  preheader: string,
  ctaUrl: string,
  ctaLabel: string,
  status: "queued" | "sent" | "error",
  created_at: timestamp,
  sent_at: timestamp,
  error: string
}
```
**Nota**: Procesada por CF `onMailQueued` automáticamente al crear documento.

#### **tecnico_stats** (Estadísticas de Técnicos)
```javascript
tecnico_stats/{tecnicoUid}
  - total: number                   // Órdenes completadas total
  - updatedAt: timestamp

tecnico_stats/{tecnicoUid}/mensual/{YYYY-MM}
  - count: number
  - updatedAt: timestamp

tecnico_stats/{tecnicoUid}/semanal/{YYYY-Wnn}
  - count: number
  - updatedAt: timestamp

tecnico_stats/{tecnicoUid}/eventos/{ordenId}
  - ordenId: string
  - tecnicoUid: string
  - fecha: timestamp
  - estado: "COMPLETADO"
  - year: number
  - month: number
  - isoWeek: string
```

---

## ⚙️ Backend - Cloud Functions

### Resumen de Funciones

**Total:** 11 Cloud Functions (2 HTTP + 9 Triggers)

| # | Nombre | Tipo | Trigger | Descripción |
|---|--------|------|---------|-------------|
| 1 | sendMail | HTTP | onRequest | Envío de emails |
| 2 | sendContractPdf | HTTP | onRequest | Generación y envío de PDFs |
| 3 | onContratoActivado | Trigger | onDocumentUpdated | Firma digital de contratos |
| 4 | onContratoActivadoSendPdf | Trigger | onDocumentUpdated | Envío automático de contrato |
| 5 | onMailQueued | Trigger | onDocumentCreated | Procesamiento de cola de emails |
| 6 | onOrdenCompletada | Trigger | onDocumentUpdated | Notificación de orden completada |
| 7 | onContratoOrdenWrite | Trigger | onDocumentUpdated | Actualiza contadores (os_count, equipos_total) |
| 8 | onOrdenWriteSyncContratoCache | Trigger | onDocumentWritten | Sincroniza cache de contratos |
| 9 | onOrdenHardDelete | Trigger | onDocumentDeleted | Limpia cache en hard delete |

**Helpers:**
- `recalcularCacheContrato(contratoId)`: Recálculo completo de cache

---

### Funciones HTTP (onRequest)

#### 1. **sendMail**
```javascript
exports.sendMail = onRequest(async (req, res) => {
  // Envío de emails con Nodemailer + SMTP
  // Plantilla: templates/email-base.html
});
```

**Endpoint:** Callable desde frontend con API key
**Uso:** Cotizaciones, notificaciones, confirmaciones
**Payload:**
```json
{
  "to": "cliente@example.com",
  "subject": "Cotización #1234",
  "bodyContent": "<p>...</p>",
  "ctaUrl": "https://app.cecomunica.net/...",
  "ctaLabel": "Ver orden"
}
```

#### 2. **sendContractPdf**
```javascript
exports.sendContractPdf = onRequest(async (req, res) => {
  // Generación de PDF con Puppeteer + envío por email
  // Plantilla: templates/imprimir-contrato.html
  // Memory: 1GiB, Timeout: 120s
});
```

**Proceso:**
1. Lee contrato de Firestore
2. Genera HTML con plantilla
3. Convierte a PDF (Puppeteer + Chromium)
4. Envía email con PDF adjunto
5. Retorna messageId

---

### Triggers Firestore (onDocumentWritten/Updated)

#### 3. **onContratoActivado**
```javascript
exports.onContratoActivado = onDocumentUpdated(
  "contratos/{docId}",
  async (event) => {
    // Se dispara cuando un contrato pasa a "activo" o "aprobado"
    // Genera firma digital con HMAC SHA-256
  }
);
```

**Flujo:**
1. Detecta transición a estado "activo" o "aprobado"
2. Genera `firma_codigo` (10 caracteres hex)
3. Calcula `firma_hash` = HMAC(`contratoId|aprobadorUid`, SECRET)
4. Crea URL verificación: `/c/{contratoId}?v={codigo}`
5. Escribe en `verificaciones/{contratoId}` (espejo público)
6. Actualiza contrato con firma_url, firma_codigo, fecha_aprobacion

**Seguridad:** Usa secret `FIRMA_SECRET` de Secret Manager

#### 4. **onContratoActivadoSendPdf**
```javascript
exports.onContratoActivadoSendPdf = onDocumentUpdated(
  "contratos/{docId}",
  async (event) => {
    // Envía PDF automáticamente cuando se aprueba contrato
  }
);
```

**Flujo:**
1. Detecta transición a "aprobado"
2. Genera PDF del contrato
3. Envía email a activaciones@cecomunica.com
4. CC al elaborador del contrato
5. Adjunta PDF generado

#### 5. **onMailQueued**
```javascript
exports.onMailQueued = onDocumentCreated(
  "mail_queue/{mailId}",
  async (event) => {
    // Procesa cola de emails asíncronamente
  }
);
```

**Flujo:**
1. Frontend crea documento en `mail_queue`
2. Trigger se dispara automáticamente
3. Envía email vía SMTP
4. Actualiza status: "sent" o "error"

#### 6. **onOrdenCompletada**
```javascript
exports.onOrdenCompletada = onDocumentUpdated(
  "ordenes_de_servicio/{ordenId}",
  async (event) => {
    // Acumula estadísticas de técnicos cuando completan orden
  }
);
```

**Flujo:**
1. Detecta cambio a estado "COMPLETADO"
2. Actualiza `tecnico_stats/{tecnicoUid}`
3. Incrementa contadores mensuales/semanales
4. Encola email de notificación

#### 7. **onContratoOrdenWrite** ⭐ NUEVO
```javascript
exports.onContratoOrdenWrite = onDocumentUpdated(
  "contratos/{contratoId}/ordenes/{ordenId}",
  async (event) => {
    // Actualiza contadores automáticamente (os_count, equipos_total)
  }
);
```

**Flujo:**
1. Detecta cambios en subcolección `ordenes`
2. Calcula delta (crear/modificar/eliminar)
3. Actualiza contrato con transaction:
   - `os_count`: cantidad de órdenes
   - `equipos_total`: suma de equipos
   - `tiene_os`: boolean

**Ventaja:** Elimina queries N+1 en frontend (mejora 150-200x)

#### 8. **onOrdenWriteSyncContratoCache** ⭐ NUEVO
```javascript
exports.onOrdenWriteSyncContratoCache = onDocumentWritten(
  "ordenes_de_servicio/{ordenId}",
  async (event) => {
    // Sincroniza cache de contratos automáticamente
  }
);
```

**Flujo:**
1. Detecta cambios en orden (crear/modificar/eliminar)
2. Si orden tiene contrato aplicable:
   - Normaliza equipos (filtra eliminados)
   - Extrae serials
   - Escribe en `contratos/{id}/ordenes/{ordenId}` (cache)
   - Actualiza resumen en documento contrato:
     - `os_linked`: true
     - `os_serials_preview`: [serial1, serial2, serial3]
     - `os_equipos_count_last`: número
     - `os_has_equipos`: boolean
3. Maneja cambio de contrato (limpia cache anterior)
4. Maneja eliminación (borra cache)

**Ventaja:** Cache siempre sincronizado sin intervención manual

---

#### 9. **onOrdenHardDelete** ⭐ NUEVO (v2.1)
```javascript
exports.onOrdenHardDelete = onDocumentDeleted(
  "ordenes_de_servicio/{ordenId}",
  async (event) => {
    // Limpia cache cuando orden se elimina completamente
  }
);
```

**Trigger:** Hard delete (`.delete()`) de orden

**Flujo:**
1. Detecta eliminación completa de OS
2. Lee datos eliminados para obtener `contrato_doc_id`
3. Elimina cache en `contratos/{id}/ordenes/{ordenId}`
4. Ejecuta `recalcularCacheContrato(contratoId)`

**Ventaja:** Garantiza limpieza en eliminación real (no solo soft delete)

---

#### Helper: **recalcularCacheContrato(contratoId)** ⭐ NUEVO (v2.1)
```javascript
async function recalcularCacheContrato(contratoId) {
  // Recalcula todos los campos de cache del contrato
}
```

**Propósito:** Recalcular cache completo basándose en órdenes vigentes

**Proceso:**
1. Lee subcolección `contratos/{id}/ordenes`
2. Filtra órdenes vigentes (no eliminadas)
   - Verifica contra `ordenes_de_servicio` (source of truth)
   - Elimina cache huérfano (hard delete detectado)
   - Marca cache como eliminado (soft delete detectado)
3. Calcula nuevos valores:
   - `os_count`: número de órdenes vigentes
   - `os_linked`: true si os_count > 0
   - `os_has_equipos`: si alguna orden tiene equipos
   - `os_serials_preview`: primeros 3 serials únicos
   - `os_equipos_count_last`: equipos de última orden
4. **Si os_count === 0:** Limpia todos los campos a vacío
   ```javascript
   {
     os_count: 0,
     os_linked: false,
     os_has_equipos: false,
     os_serials_preview: [],
     os_equipos_count_last: 0,
     tiene_os: false
   }
   ```
5. Actualiza documento del contrato

**Invocado por:**
- `onOrdenWriteSyncContratoCache` (cuando detecta soft delete)
- `onOrdenHardDelete` (cuando detecta hard delete)
- `onOrdenWriteSyncContratoCache` (al cambiar de contrato)

**Ventaja:** Garantiza consistencia eliminando "cuadros fantasma" (📦 en contratos vacíos)

---

### Scripts Administrativos

#### backfill-contract-summaries.js
```bash
node functions/backfill-contract-summaries.js
```
- Calcula `os_count` y `equipos_total` para contratos existentes
- One-time script (ejecutar después de deploy inicial)
- Dry-run mode disponible

#### rebuild-all-contratos-cache.js
```bash
node functions/rebuild-all-contratos-cache.js
```
- Reconstruye cache completo de `contratos/{id}/ordenes/{ordenId}`
- Útil para migración inicial
- Actualiza campos de resumen
- Batch processing (500 docs/batch)

---

## 🔐 Sistema de Autenticación y Roles

### Autenticación
- **Proveedor:** Firebase Authentication
- **Método:** Email/Password
- **Persistencia:** LOCAL (sesión persiste en navegador)
- **Archivo:** `/public/js/firebase-init.js`

### Roles y Permisos

| Rol       | Permisos                                                                 |
|-----------|--------------------------------------------------------------------------|
| **admin** | Acceso total. Aprobar contratos, gestionar usuarios, configuración       |
| **vendedor** | Crear contratos, órdenes, gestionar clientes asignados. No puede aprobar |
| **tecnico** | Gestionar órdenes, inventario de piezas, equipos. Solo lectura en contratos |
| **readonly** | Solo visualización de todos los módulos. Sin edición                    |

### Control de Acceso
```javascript
// firebase-init.js
window.verificarAccesoYAplicarVisibilidad = async function (callback) {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    
    const doc = await db.collection("usuarios").doc(user.uid).get();
    const rol = doc.exists ? doc.data().rol : null;
    window.userRole = rol;
    
    if (typeof callback === "function") {
      callback(rol); // Aplica lógica por página
    }
  });
};
```

### Visibilidad Condicional
Cada módulo implementa lógica específica:
```javascript
// Ejemplo en ordenes/index.html
verificarAccesoYAplicarVisibilidad((rol) => {
  if (rol === "readonly") {
    document.querySelectorAll(".btn-edit, .btn-delete").forEach(btn => {
      btn.style.display = "none";
    });
  }
});
```

---

## 🔄 Flujos de Negocio Principales

### Flujo 1: Creación y Aprobación de Contrato

```
┌─────────────┐
│  Vendedor   │
└──────┬──────┘
       │
       ▼
[1. Crear nuevo contrato]
   - Seleccionar/crear cliente
   - Agregar equipos
   - Tipo: venta/alquiler
   - Estado: pendiente_aprobacion
       │
       ▼
[2. Guardar en Firestore]
   contratos/{contratoId}
   estado: "pendiente_aprobacion"
   vendedor_uid: {uid}
       │
       ▼
┌──────────────┐
│ Administrador│
└──────┬───────┘
       │
       ▼
[3. Revisar contrato]
   - Ver listado de pendientes
   - Filtrar por estado
       │
       ▼
[4. Aprobar contrato]
   - Cambiar estado a "activo"
   - Registrar aprobador
       │
       ▼
[5. Trigger onContratoActivado]
   - Generar código verificación
   - Crear en verificaciones/
   - Actualizar firma_url, firma_codigo
       │
       ▼
[6. Generar PDF]
   - Cloud Function generateContractPDF
   - Subir a Storage
   - Enviar email (opcional)
       │
       ▼
[Contrato activo y verificable]
```

### Flujo 2: Orden de Servicio Completa

```
┌─────────────┐
│  Recepción  │
└──────┬──────┘
       │
       ▼
[1. Nueva orden]
   - Cliente
   - Equipos averiados
   - Problema reportado
   - Estado: recibido
       │
       ▼
[2. Asignar técnico]
   estado: diagnostico
       │
       ▼
┌──────────────┐
│   Técnico    │
└──────┬───────┘
       │
       ▼
[3. Diagnóstico]
   - Agregar equipos_meta
   - Registrar problema
   - Estado: en_reparacion
       │
       ▼
[4. Reparación]
   - Agregar consumos (piezas)
   - Registrar mano de obra
   - Actualizar inventario
       │
       ▼
[5. Cotizar]
   - Calcular total
   - Generar PDF cotización
   - Enviar email
       │
       ▼
[6. Completar reparación]
   estado: reparado
       │
       ▼
┌──────────────┐
│   Cliente    │
└──────┬───────┘
       │
       ▼
[7. Firmar entrega]
   - Firma digital
   - Estado: entregado
       │
       ▼
[Orden cerrada]
```

### Flujo 3: Verificación Pública de Contrato

```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │
       ▼
[Recibe URL]
https://app.cecomunica.net/c/CONT-2025-001?v=abc123
       │
       ▼
[Firebase Hosting]
   Rewrite: /c/** → /verify/index.html
       │
       ▼
[verify/index.html]
   - Lee contratoId de URL
   - Lee código "v" de query
       │
       ▼
[Consulta Firestore]
verificaciones/{contratoId}
   - Sin autenticación
   - Lee firma_codigo
       │
       ▼
[Validación]
   if (codigo_url === firma_codigo)
     ✅ Mostrar info contrato
   else
     ❌ Código incorrecto
```

---

## 🔗 Integraciones Externas

### 1. SendGrid (Email)
- **API Key:** Configurada en Cloud Functions
- **Uso:** Envío de cotizaciones, notificaciones
- **Archivo:** `functions/index.js` → `sendMail`

### 2. QR Code Generator
- **Servicio:** `https://api.qrserver.com/v1/create-qr-code/`
- **Uso:** Códigos QR en contratos PDF
- **Parámetros:** `?size=100x100&data={url}`

### 3. Puppeteer + Chromium
- **Paquetes:**
  - `puppeteer-core` 24.17.0
  - `@sparticuz/chromium` 138.0.2
- **Uso:** Conversión HTML → PDF server-side
- **Optimización:** Chromium headless para Cloud Functions

---

## 🔒 Seguridad

### Firestore Security Rules

El sistema usa un modelo híbrido de seguridad:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // === Helper Function ===
    function userRole() {
      return get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol;
    }
    
    // === Default Rule (Catch-all) ===
    match /{document=**} {
      // ✅ Permite lectura/escritura para usuarios autenticados
      // ⚠️ Regla permisiva para desarrollo - en producción refinar por colección
      allow read, write: if request.auth != null;
    }
    
    // === Usuarios ===
    match /usuarios/{userId} {
      // ✅ Lectura: cualquier usuario autenticado
      allow read: if request.auth != null;
      
      // ❌ Escritura: BLOQUEADA (solo Cloud Functions pueden modificar)
      // Previene que usuarios cambien su propio rol o datos sensibles
      allow write: if false;
    }
    
    // === Contratos ===
    match /contratos/{docId} {
      // ✅ Lectura: cualquier usuario autenticado
      allow read: if request.auth != null;
      
      // ✅ Creación: cualquier usuario autenticado (vendedor/admin)
      allow create: if request.auth != null;
      
      // ✅ Actualización: con restricciones específicas
      allow update: if request.auth != null
        // ❌ NO puede modificar campos de firma (solo Cloud Function)
        && !(("firma_codigo" in request.resource.data) ||
             ("firma_hash" in request.resource.data) ||
             ("firma_url" in request.resource.data) ||
             ("fecha_aprobacion" in request.resource.data))
        // ❌ NO puede activar contrato a menos que sea admin/gerente
        && (!(resource.data.estado != "activo" && request.resource.data.estado == "activo")
            || (userRole() in ["administrador", "gerente"]));
      
      // ✅ Eliminación: solo admin/gerente
      allow delete: if request.auth != null && (userRole() in ["administrador", "gerente"]);
      
      // === Subcolección: ordenes (CACHE) ===
      match /ordenes/{ordenId} {
        // ✅ Lectura: usuarios autenticados
        allow read: if request.auth != null;
        
        // ❌ Escritura: BLOQUEADA (solo Cloud Functions)
        // La CF onOrdenWriteSyncContratoCache mantiene este cache
        allow write: if false;
      }
    }
    
    // === Verificaciones (Espejo Público) ===
    match /verificaciones/{contratoId} {
      // ✅ Lectura: PÚBLICA (sin autenticación)
      // Permite verificación externa de contratos
      allow read: if true;
      
      // ❌ Escritura: BLOQUEADA (solo Cloud Function onContratoActivado)
      allow write: if false;
    }
  }
}
```

#### 🔐 Análisis de Reglas

**Características de Seguridad:**

1. **Usuarios protegidos**: No pueden modificar su propio rol o permisos
2. **Campos de firma inmutables**: Solo Cloud Functions pueden generar/modificar firmas digitales
3. **Aprobación de contratos**: Solo admin/gerente puede cambiar estado a "activo"
4. **Cache protegido**: Subcolección `contratos/{id}/ordenes` de solo lectura para frontend
5. **Verificación pública**: Colección `verificaciones` accesible sin autenticación

**Ventajas:**
- ✅ Previene manipulación de datos críticos
- ✅ Single source of truth: Cloud Functions escriben, frontend lee
- ✅ Auditoría simplificada (logs en Cloud Functions)
- ✅ Verificación de contratos sin login

**Consideraciones de Producción:**

⚠️ La regla catch-all `/{document=**}` es permisiva. Recomendaciones:

```javascript
// RECOMENDACIÓN: Reemplazar catch-all por reglas específicas
match /ordenes_de_servicio/{ordenId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && 
    userRole() in ["administrador", "vendedor", "tecnico", "jefe_taller"];
}

match /clientes/{clienteId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && 
    userRole() in ["administrador", "vendedor"];
}

match /inventario_radios/{radioId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && 
    userRole() in ["administrador", "tecnico"];
}
```

---

### Configuración CORS
```javascript
// functions/index.js
const cors = require("cors")({
  origin: [
    "https://cecomunica-service-orders.web.app",
    "https://app.cecomunica.net",
    "http://127.0.0.1:5500"
  ]
});
```

### Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Usuarios: solo admin puede escribir
    match /usuarios/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol == 'admin';
    }
    
    // Contratos: vendedores y admin
    match /contratos/{contratoId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && 
                       (get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol in ['admin', 'vendedor']);
      allow update: if request.auth != null;
    }
    
    // Verificaciones: lectura pública
    match /verificaciones/{contratoId} {
      allow read: if true; // Público
      allow write: if false; // Solo Cloud Functions
    }
    
    // Órdenes: técnicos y admin
    match /ordenes_de_servicio/{ordenId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                      (get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol in ['admin', 'tecnico', 'vendedor']);
      
      // Subcollecciones
      match /equipos_meta/{equipoId} {
        allow read, write: if request.auth != null;
      }
      match /consumos/{consumoId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

### Autenticación de Functions
- **Admin SDK:** Inicialización con credenciales de servicio
- **Verificación:** Todas las functions verifican origen CORS

### Protección de Datos Sensibles
- Contraseñas: Hasheadas por Firebase Auth
- API Keys: Variables de entorno en Functions
- Documentos PDF: URLs firmadas temporales en Storage

---

## 🚀 Despliegue y Hosting

### Firebase Hosting
**Configuración:** `firebase.json`

```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "/api/sendMail",
        "function": "sendMail"
      },
      {
        "source": "/c/**",
        "destination": "/verify/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css|html)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "no-cache, no-store, must-revalidate"
          }
        ]
      }
    ]
  }
}
```

### Dominios
- **Principal:** `https://cecomunica-service-orders.web.app`
- **Personalizado:** `https://app.cecomunica.net`

### Despliegue de Functions
```bash
# Desplegar todas las functions
firebase deploy --only functions

# Desplegar hosting
firebase deploy --only hosting

# Desplegar todo
firebase deploy
```

### Variables de Entorno (Functions)
```bash
firebase functions:config:set sendgrid.api_key="SG.xxxxx"
firebase functions:config:set empresa.email="contacto@cecomunica.net"
```

---

## 📊 Estructura de Archivos del Proyecto

```
cecomunica-service-orders/
│
├── firebase.json                    # Configuración Firebase
├── firestore.rules                  # Reglas de seguridad (si existe)
├── firebase config firma secret.txt # Credenciales internas
├── api-sendgrid.txt                 # API Key SendGrid
│
├── functions/                       # Cloud Functions
│   ├── index.js                     # Código principal functions
│   ├── package.json                 # Dependencias Node.js
│   └── templates/
│       ├── email-base.html          # Plantilla email
│       └── imprimir-contrato.html   # Plantilla PDF contrato
│
├── public/                          # Frontend (static files)
│   ├── index.html                   # Dashboard principal
│   ├── login.html                   # Página de login
│   ├── perfil.html                  # Perfil de usuario
│   ├── verificar-contrato.html      # Verificación alternativa
│   │
│   ├── css/
│   │   └── ceco-ui.css              # Design system
│   │
│   ├── js/
│   │   └── firebase-init.js         # Configuración Firebase
│   │
│   ├── ordenes/                     # Módulo órdenes
│   │   ├── index.html
│   │   ├── nueva-orden.html
│   │   ├── editar-orden.html
│   │   ├── agregar-equipo.html
│   │   ├── cotizar-orden.html
│   │   ├── cotizar-orden-formal.html
│   │   ├── imprimir-orden.html
│   │   ├── nota-entrega.html
│   │   ├── firmar-entrega.html
│   │   ├── config.html
│   │   └── ...
│   │
│   ├── contratos/                   # Módulo contratos
│   │   ├── index.html
│   │   ├── nuevo-contrato.html
│   │   ├── editar-contrato.html
│   │   ├── nuevo-cliente.html
│   │   ├── imprimir-contrato.html
│   │   └── ...
│   │
│   ├── inventario/                  # Módulo inventario
│   │   ├── index.html
│   │   ├── piezas.html
│   │   ├── modelos.html
│   │   ├── cargar-inventario.html
│   │   └── vista-correo.html
│   │
│   ├── POC/                         # Base de datos PoC
│   │   ├── index.html
│   │   ├── vendedores-batch.html
│   │   └── ...
│   │
│   ├── clientes/                    # Módulo clientes
│   │   ├── index.html
│   │   ├── editar.html
│   │   └── ...
│   │
│   └── verify/                      # Verificación pública
│       └── index.html
│
└── backups/                         # Scripts de backup
    └── ...
```

---

## 🎨 Sistema de Diseño (ceco-ui.css)

### Paleta de Colores
```css
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --ink: #111111;
  --line: #e5e7eb;
  --primary: #0ea5a3;
  --danger: #dc2626;
  --success: #16a34a;
  --warning: #f59e0b;
}
```

### Componentes Principales
- **Topbar:** Barra superior fija
- **App Grid:** Grid responsive de tarjetas
- **Card:** Contenedores estándar
- **Toolbar:** Barras de herramientas
- **Table:** Tablas con edición inline
- **Forms:** Inputs, selects, checkboxes
- **Buttons:** Variantes primary, danger, ok
- **Chips/Badges:** Etiquetas de estado
- **Modal:** Diálogos modales

---

## 📈 Métricas y Monitoreo

### Logs de Cloud Functions
```bash
firebase functions:log --only sendMail
```

### Firestore Monitoring
- Console Firebase → Firestore → Métricas
- Lecturas/escrituras por colección
- Tamaño de documentos

### Errores Comunes
- **CORS errors:** Verificar orígenes permitidos
- **Persistencia offline:** `enablePersistence()` puede fallar en algunos navegadores
- **PDFs grandes:** Timeout en Cloud Functions (aumentar memoria)

---

## 🔮 Roadmap y Mejoras Futuras

### Mejoras Técnicas
- [ ] Migrar a Firebase SDK modular (v9+)
- [ ] Implementar TypeScript en frontend
- [ ] PWA con Service Workers
- [ ] Optimización de imágenes (WebP)
- [ ] Lazy loading de módulos
- [ ] Tests unitarios con Jest

### Funcionalidades
- [ ] Dashboard con KPIs y gráficos
- [ ] Notificaciones push
- [ ] Reportes exportables a Excel/PDF
- [ ] Integración con WhatsApp Business
- [ ] App móvil (React Native / Flutter)
- [ ] API REST pública

### Seguridad
- [ ] 2FA (Two-Factor Authentication)
- [ ] Auditoría de cambios (changelog)
- [ ] Backup automatizado diario
- [ ] Firestore Security Rules más granulares

---

## 📝 Notas de Desarrollo

### Convenciones de Código
- **HTML:** kebab-case para IDs y clases
- **JavaScript:** camelCase para variables y funciones
- **Firestore:** snake_case para campos de documentos
- **Comentarios:** Español en código interno

### Compatibilidad de Navegadores
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- **No soportado:** IE11

### Performance
- **Paginación:** Límite de 50 documentos por consulta
- **Cache:** Persistencia offline habilitada
- **CDN:** Firebase Hosting con CDN global

---

## 📞 Contacto y Soporte

**Equipo de Desarrollo**
- Email: soporte@cecomunica.net
- Repositorio: (privado)
- Documentación interna: [Confluence/Notion]

---

## 📄 Licencia

© 2025 Cecomunica - Todos los derechos reservados.
Sistema de uso interno exclusivo.

---

**Última actualización:** Enero 22, 2026
**Versión del documento:** 2.0
**Autor:** Sistema Cecomunica

**Cambios en v2.0:**
- ✅ Agregadas Cloud Functions para cache automático de contratos
- ✅ Documentadas reglas de seguridad Firestore
- ✅ Ampliada estructura de datos con campos de resumen
- ✅ Agregada documentación de cola de emails y estadísticas

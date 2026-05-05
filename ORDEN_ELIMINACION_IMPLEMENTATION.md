# ✅ Implementación: Limpieza Automática de Cache al Eliminar Órdenes

**Fecha:** 22 de enero de 2026  
**Autor:** GitHub Copilot (Claude Sonnet 4.5)

---

## 📋 Resumen Ejecutivo

Se implementó un sistema completo de limpieza automática de cache cuando se eliminan Órdenes de Servicio (OS), garantizando que los contratos siempre muestren información consistente y actualizada.

**Problema resuelto:** Cuando una OS se eliminaba, el cache en `contratos/{contratoId}/ordenes/{osId}` permanecía, causando que el frontend mostrara "cuadros fantasma" (📦) en contratos sin órdenes vigentes.

**Solución:** Cloud Functions que detectan eliminaciones (soft y hard delete) y recalculan automáticamente todos los campos de cache del contrato.

---

## 🔧 Archivos Modificados

### 1. **`functions/index.js`** (Backend - Cloud Functions)

#### Cambios realizados:

1. **Import adicional:**
   - Agregado `onDocumentDeleted` a los imports de Firebase Functions v2

2. **Nueva función helper: `recalcularCacheContrato(contratoId)`** (Líneas ~1115-1289)
   - Recalcula todos los campos de cache basándose en órdenes vigentes
   - Verifica cada orden contra la fuente de verdad (`ordenes_de_servicio`)
   - Limpia órdenes eliminadas del cache
   - Si `os_count === 0`, establece campos a valores "vacíos":
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

3. **Modificación: `onOrdenWriteSyncContratoCache`** (Línea ~1337+)
   - **Nuevo caso:** Detecta soft delete (`eliminado: true`)
   - Marca orden en cache como eliminada
   - Llama a `recalcularCacheContrato()` para actualizar contrato
   - **CASO 1 mejorado:** Usa `recalcularCacheContrato()` en lugar de marcar "dirty"
   - **CASO 3 mejorado:** Usa `recalcularCacheContrato()` para limpieza completa

4. **Nueva Cloud Function: `onOrdenHardDelete`** (Líneas ~1577-1656)
   - Trigger: `onDocumentDeleted` en `ordenes_de_servicio/{ordenId}`
   - Se dispara en hard delete (`.delete()`)
   - Elimina cache en `contratos/{contratoId}/ordenes/{ordenId}`
   - Llama a `recalcularCacheContrato()` para actualizar contrato

### 2. **`public/ordenes/index.html`** (Frontend)

#### Cambios realizados:

**Líneas ~860-885:**
- **Removida lógica manual de limpieza de cache**
- Antes: El frontend intentaba eliminar `contratos/{id}/ordenes/{osId}` manualmente
- Ahora: Cloud Functions se encargan automáticamente
- Comentario agregado explicando que CF maneja todo

---

## 🚀 Cómo Funciona

### Flujo: Soft Delete (Marca `eliminado: true`)

```
1. Usuario elimina OS en frontend
   ↓
2. Frontend: UPDATE ordenes_de_servicio/{osId}
   { eliminado: true, fecha_eliminacion: timestamp }
   ↓
3. CF: onOrdenWriteSyncContratoCache detecta cambio
   ↓
4. CF: Detecta transición eliminado: false → true
   ↓
5. CF: UPDATE contratos/{contratoId}/ordenes/{osId}
   { eliminado: true }
   ↓
6. CF: Ejecuta recalcularCacheContrato(contratoId)
   ↓
7. CF: Lee todas las órdenes de la subcolección
   ↓
8. CF: Filtra solo órdenes vigentes (eliminado !== true)
   ↓
9. CF: Si os_count === 0:
      → os_linked = false
      → os_serials_preview = []
      → os_has_equipos = false
   ↓
10. Frontend: cargarIconosEquipos() muestra ⬜
```

### Flujo: Hard Delete (`.delete()`)

```
1. DELETE ordenes_de_servicio/{osId}
   ↓
2. CF: onOrdenHardDelete se dispara
   ↓
3. CF: Lee datos eliminados (beforeData)
   ↓
4. CF: Obtiene contratoId del campo contrato.contrato_doc_id
   ↓
5. CF: DELETE contratos/{contratoId}/ordenes/{osId}
   ↓
6. CF: Ejecuta recalcularCacheContrato(contratoId)
   ↓
7. (Mismo proceso de recálculo que soft delete)
```

---

## 🔍 Función `recalcularCacheContrato()` - Detalles

### Inputs
- `contratoId` (string): Document ID del contrato en colección `contratos`

### Proceso

1. **Lee subcolección** `contratos/{contratoId}/ordenes`
   - Ordena por `updated_at desc`

2. **Filtra órdenes vigentes:**
   - ❌ Ignorar si cache tiene `eliminado: true`
   - ❌ Ignorar si OS no existe en `ordenes_de_servicio`
   - ❌ Ignorar si OS tiene `eliminado: true`
   - ✅ Solo cuenta órdenes activas reales

3. **Limpia cache inconsistente:**
   - Elimina docs de subcolección si OS no existe (hard delete)
   - Marca docs como `eliminado: true` si OS está soft-deleted

4. **Calcula nuevos valores:**
   ```javascript
   os_count = órdenes vigentes
   os_linked = os_count > 0
   os_has_equipos = alguna orden tiene equipos
   os_serials_preview = primeros 3 serials únicos
   os_equipos_count_last = equipos de última orden
   tiene_os = os_count > 0
   ```

5. **Actualiza documento contrato**
   - Atomic update con todos los campos calculados
   - Marca `os_dirty: false` (cache limpio)

### Casos especiales

**Caso A: Contrato sin órdenes vigentes**
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
→ Frontend muestra: **⬜**

**Caso B: Contrato con 2 OS, se elimina 1**
- Recalcula preview con seriales de la OS restante
- `os_count: 1`
- `os_linked: true`

---

## 📊 Campos de Cache Actualizados

| Campo | Tipo | Descripción | Valor cuando os_count=0 |
|-------|------|-------------|------------------------|
| `os_count` | number | Número de OS activas | `0` |
| `os_linked` | boolean | Si tiene OS vinculadas | `false` |
| `os_has_equipos` | boolean | Si alguna OS tiene equipos | `false` |
| `os_serials_preview` | array | Primeros 3 seriales (preview) | `[]` |
| `os_equipos_count_last` | number | Equipos de última OS | `0` |
| `tiene_os` | boolean | Redundante con os_linked | `false` |
| `os_dirty` | boolean | Cache necesita recálculo | `false` |

---

## ✅ Pruebas Obligatorias

### Prueba 1: Eliminar única OS de un contrato

**Setup:**
1. Crear contrato con `contrato_id = "TEST-001"`
2. Crear OS con 2 equipos, vincular a TEST-001
3. Verificar en Firestore:
   - `contratos/{docId}`: `os_count = 1`, `os_linked = true`
   - `contratos/{docId}/ordenes/{osId}` existe

**Acción:**
4. Eliminar OS (soft delete)

**Resultado esperado:**
5. En Firestore `contratos/{docId}`:
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
6. En `contratos/{docId}/ordenes/{osId}`:
   ```javascript
   { eliminado: true }
   ```
7. Frontend (contratos/index.html): Muestra **⬜**

### Prueba 2: Eliminar 1 de 2 OS

**Setup:**
1. Contrato con 2 OS (OS-A: 3 equipos, OS-B: 2 equipos)
2. Verificar `os_count = 2`

**Acción:**
3. Eliminar OS-A

**Resultado esperado:**
4. `os_count = 1`
5. `os_serials_preview` contiene solo seriales de OS-B
6. Frontend: Sigue mostrando **📦**

### Prueba 3: Hard Delete

**Setup:**
1. Contrato con 1 OS

**Acción:**
2. Ejecutar en Firestore Console:
   ```javascript
   db.collection('ordenes_de_servicio').doc('osId').delete()
   ```

**Resultado esperado:**
3. `onOrdenHardDelete` se dispara
4. Cache limpiado igual que soft delete
5. `os_count = 0`
6. Frontend: **⬜**

---

## 🔧 Deploy

### Comandos

```bash
# Deploy solo las nuevas Cloud Functions
cd functions
npm install  # Si es necesario

# Deploy functions
firebase deploy --only functions:onOrdenWriteSyncContratoCache
firebase deploy --only functions:onOrdenHardDelete

# O deploy todas
firebase deploy --only functions
```

### Logs en producción

```bash
# Ver logs en tiempo real
firebase functions:log --only onOrdenWriteSyncContratoCache
firebase functions:log --only onOrdenHardDelete

# Filtrar por contratoId específico
firebase functions:log | grep "contratoId: XYZ"
```

---

## 🐛 Troubleshooting

### Problema: Contrato sigue mostrando 📦 después de eliminar todas las OS

**Diagnóstico:**
1. Verificar en Firestore `contratos/{docId}`:
   - ¿Existe `os_dirty: true`?
   - ¿`os_count` es correcto?

2. Ver logs de CF:
   ```bash
   firebase functions:log --only recalcularCacheContrato
   ```

3. Ejecutar manualmente:
   ```javascript
   // En Firebase Console o script
   const functions = require('firebase-functions');
   await recalcularCacheContrato('docId');
   ```

**Solución:** Si cache está corrupto, ejecutar script de backfill:
```bash
node functions/rebuild-all-contratos-cache.js
```

### Problema: Race condition (cache actualizado antes que CF)

**Síntoma:** Eliminas OS pero cache no se limpia inmediatamente

**Causa:** Frontend aún intenta limpiar cache manualmente

**Solución:** ✅ Ya implementada (removida lógica manual en frontend)

---

## 📈 Mejoras Futuras

1. **Batch recalculation endpoint:**
   - Crear HTTP function para recalcular múltiples contratos
   - Útil para migración o corrección masiva

2. **Scheduled function para limpieza:**
   - Ejecutar cada noche para verificar consistencia
   - Detectar y corregir cache huérfano

3. **Webhook notifications:**
   - Notificar admin cuando os_count llega a 0
   - Alertar si contrato grande pierde todas sus OS

---

## 🔗 Archivos Relacionados

- `functions/index.js`: Cloud Functions (nueva lógica)
- `public/ordenes/index.html`: Frontend eliminación de órdenes
- `public/contratos/index.html`: Frontend visualización de cache
- `functions/backfill-contract-summaries.js`: Script de backfill
- `functions/rebuild-all-contratos-cache.js`: Script de reconstrucción
- `ARQUITECTURA_CECOMUNICA.md`: Documentación completa del sistema

---

## ✅ Checklist de Entrega

- [x] Función `recalcularCacheContrato()` implementada
- [x] Soft delete detectado en `onOrdenWriteSyncContratoCache`
- [x] Hard delete manejado con `onOrdenHardDelete`
- [x] Frontend limpio (removida lógica manual)
- [x] Logs informativos agregados
- [x] Sin errores de sintaxis
- [x] Documentación completa
- [ ] Deploy a producción
- [ ] Pruebas en producción ejecutadas
- [ ] Verificación con datos reales

---

**Estado:** ✅ Implementación completa  
**Pendiente:** Deploy y pruebas en producción

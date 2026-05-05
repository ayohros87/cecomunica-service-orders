# 🔒 Reglas de Seguridad para Cache de Contratos

## Propósito

Proteger la subcolección `contratos/{contratoId}/ordenes/{ordenId}` para que:
- ✅ Solo Cloud Functions puedan escribir
- ✅ Frontend solo pueda leer
- ✅ Prevenir manipulación de datos

---

## Reglas Recomendadas

Agregar a `firestore.rules`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // === Contratos (documento principal) ===
    match /contratos/{contratoId} {
      // Lectura según rol
      allow read: if request.auth != null && (
        resource.data.creado_por_uid == request.auth.uid ||
        get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol in ['administrador', 'jefe_taller']
      );
      
      // Escritura según rol
      allow create, update: if request.auth != null && (
        get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol in ['administrador', 'vendedor']
      );
      
      allow delete: if request.auth != null && (
        get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol == 'administrador'
      );
      
      // === Subcolección: ordenes (CACHE) ===
      match /ordenes/{ordenId} {
        // ✅ Solo lectura desde frontend
        allow read: if request.auth != null;
        
        // ❌ Escritura BLOQUEADA para usuarios (solo Cloud Functions)
        allow write: if false;
        
        // Nota: Cloud Functions bypasean estas reglas usando admin SDK
        // Por lo tanto, la CF puede escribir sin problemas
      }
    }
    
    // === Órdenes de Servicio ===
    match /ordenes_de_servicio/{ordenId} {
      allow read: if request.auth != null;
      
      allow create, update: if request.auth != null && (
        get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol in ['administrador', 'vendedor', 'tecnico', 'jefe_taller']
      );
      
      allow delete: if request.auth != null && (
        get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol in ['administrador', 'jefe_taller']
      );
    }
  }
}
```

---

## Verificación

### Test de Lectura (debe funcionar)
```javascript
// En contratos/index.html
const ordenes = await db.collection("contratos")
  .doc(contratoId)
  .collection("ordenes")
  .get();
// ✅ Funciona (autenticado)
```

### Test de Escritura (debe fallar)
```javascript
// Intento de escritura desde frontend
await db.collection("contratos")
  .doc(contratoId)
  .collection("ordenes")
  .doc(ordenId)
  .set({ malicious: true });
// ❌ Error: Missing or insufficient permissions
```

### Cloud Function (debe funcionar)
```javascript
// En Cloud Function
await admin.firestore()
  .collection("contratos")
  .doc(contratoId)
  .collection("ordenes")
  .doc(ordenId)
  .set(cacheData);
// ✅ Funciona (admin SDK bypasea reglas)
```

---

## Despliegue

```bash
# Actualizar reglas
firebase deploy --only firestore:rules

# Verificar en consola
# https://console.firebase.google.com/project/cecomunica-service-orders/firestore/rules
```

---

## Ventajas

1. **Integridad de Datos**: Frontend no puede corromper cache
2. **Single Source of Truth**: Solo CF escribe → siempre consistente
3. **Auditoría**: Logs centralizados en Cloud Functions
4. **Performance**: Frontend solo lee (operación más rápida)

---

## Compatibilidad

- ✅ Reglas existentes para otros documentos NO afectadas
- ✅ Frontend puede seguir leyendo normalmente
- ✅ Cloud Functions pueden escribir sin cambios
- ⚠️ Función `syncContratoCacheFromOrden` del frontend dejará de funcionar (esperado - ahora es CF)

# 🚀 Setup Rápido: Contract Summaries Optimization

## ¿Qué hace esta optimización?

Elimina las **queries N+1** que hacían que cargar 50 contratos tomara 15-20 segundos.

**Antes**: 100+ queries para mostrar iconos 📦
**Ahora**: 0 queries (campos mantenidos automáticamente) → **<100ms** ⚡

---

## 📋 Pasos de Implementación

### 1️⃣ Desplegar Cloud Function

```bash
cd functions
firebase deploy --only functions:onContratoOrdenWrite
```

**Resultado esperado**:
```
✔ functions[onContratoOrdenWrite(us-central1)] Successful update operation.
```

---

### 2️⃣ Ejecutar Backfill (una sola vez)

```bash
cd functions
node backfill-contract-summaries.js
```

**Preview mode (sin escribir)**:
1. Abrir `functions/backfill-contract-summaries.js`
2. Verificar línea 26: `const DRY_RUN = true;`
3. Ejecutar: `node backfill-contract-summaries.js`
4. Revisar output para confirmar
5. Cambiar a `const DRY_RUN = false;`
6. Re-ejecutar para escribir

**Output esperado**:
```
🚀 Iniciando backfill de resúmenes de contratos...
   Modo: WRITE (escribirá en DB)

📥 Cargando contratos...
   ✅ 127 contratos encontrados

⚙️  Procesando contratos...
   📊 Progreso: 50/127
   📊 Progreso: 100/127

📊 Análisis completado:
   ⏭️  Saltados (ya tenían os_count): 0
   ❌ Errores: 0
   ✅ Para actualizar: 127

💾 Escribiendo actualizaciones en DB...
   ✅ Batch 1 committed (127 docs)

🎉 Backfill completado exitosamente!
   📝 127 contratos actualizados
   📦 1 batches escritos
```

---

### 3️⃣ Verificar en Front-End

1. Abrir: `https://app.cecomunica.net/contratos/`
2. ✅ Los iconos 📦 deben aparecer **instantáneamente**
3. ✅ Contador visible si hay múltiples órdenes: "📦3"
4. ✅ Sin delays ni spinners largos

---

## 🧪 Testing

### Test 1: Crear Orden Nueva

1. Ir a `ordenes/nueva-orden.html`
2. Crear orden tipo **PROGRAMACION** con contrato
3. Volver a `contratos/index.html`
4. **Verificar**: El icono 📦 debe actualizar automáticamente

### Test 2: Agregar Equipos

1. Abrir orden existente en `ordenes/trabajar-orden.html`
2. Agregar 2 equipos nuevos
3. Volver a `contratos/index.html`
4. **Verificar**: El contador debe incrementar (ej: 📦3 → 📦5)

### Test 3: Eliminar Orden

1. En `ordenes/index.html`, eliminar una orden
2. Volver a `contratos/index.html`
3. **Verificar**: El contador debe decrementar

---

## 🔍 Verificación Manual

### Opción 1: Firebase Console

1. Ir a: https://console.firebase.google.com
2. Firestore Database → `contratos`
3. Abrir cualquier documento
4. **Buscar campos**:
   ```
   os_count: 3
   equipos_total: 12
   tiene_os: true
   ```

### Opción 2: Console del Navegador

```javascript
// En contratos/index.html, abrir DevTools Console
const contrato = contratosCargados[0];
console.log({
  id: contrato.contrato_id,
  os_count: contrato.os_count,
  equipos_total: contrato.equipos_total,
  tiene_os: contrato.tiene_os
});
```

---

## 📊 Métricas Esperadas

| Métrica | Antes | Después |
|---------|-------|---------|
| Tiempo de carga (50 contratos) | 15-20s ⏳ | <100ms ⚡ |
| Queries | 100+ | 0 |
| Experiencia | Lenta | Instantánea |

---

## 🐛 Troubleshooting

### Problema: Iconos no aparecen

**Solución 1**: Verificar que backfill se ejecutó
```bash
cd functions
node backfill-contract-summaries.js
# Debe decir "Saltados: 127" (si ya se ejecutó)
```

**Solución 2**: Verificar logs de Cloud Function
```bash
firebase functions:log --only onContratoOrdenWrite
```

**Solución 3**: Hard refresh en navegador
```
Ctrl + Shift + R (Windows/Linux)
Cmd + Shift + R (Mac)
```

---

### Problema: Contador incorrecto

**Solución**: Re-backfill con modo forzado
```javascript
// En backfill-contract-summaries.js, línea 62
// Comentar este check:
// if (contratoData.os_count !== undefined && contratoData.os_count !== null) {
//   return { contratoId, skipped: true, reason: "already_has_os_count" };
// }

// Ejecutar:
node backfill-contract-summaries.js
```

---

### Problema: Cloud Function no se dispara

**Verificar deployment**:
```bash
firebase functions:list

# Debe mostrar:
# ┌──────────────────────────┬──────────────┐
# │ Function Name            │ Version      │
# ├──────────────────────────┼──────────────┤
# │ onContratoOrdenWrite     │ 1            │
# └──────────────────────────┴──────────────┘
```

**Re-deployar si falta**:
```bash
firebase deploy --only functions:onContratoOrdenWrite
```

---

## 📁 Archivos Clave

```
cecomunica-service-orders/
├── functions/
│   ├── index.js                              ← Cloud Function principal
│   └── backfill-contract-summaries.js        ← Script one-time
├── public/
│   └── contratos/
│       └── index.html                        ← Front-end optimizado
└── CONTRACT_SUMMARIES_OPTIMIZATION.md        ← Documentación completa
```

---

## ✅ Checklist Final

- [ ] Cloud Function deployada
- [ ] Backfill ejecutado (127+ contratos actualizados)
- [ ] Iconos 📦 aparecen en <100ms
- [ ] Test CREATE orden → icono actualiza
- [ ] Test UPDATE equipos → contador incrementa
- [ ] Test DELETE orden → contador decrementa
- [ ] Logs de Cloud Function sin errores
- [ ] Documentación leída por el equipo

---

## 🎓 Para Más Información

Ver documentación completa: [`CONTRACT_SUMMARIES_OPTIMIZATION.md`](./CONTRACT_SUMMARIES_OPTIMIZATION.md)

---

**¿Dudas?** Revisar logs:
```bash
firebase functions:log --only onContratoOrdenWrite --limit 100
```

**¿Todo funciona?** 🎉 ¡Listo! La optimización está activa.

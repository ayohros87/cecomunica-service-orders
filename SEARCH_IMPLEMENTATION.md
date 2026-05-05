# 🔍 Server-Side Search Implementation

## Overview
The contracts search function has been upgraded to search the **entire database** instead of only loaded contracts. This uses Firestore range queries for text search.

## Changes Made

### 1. **Frontend Changes** ([index.html](public/contratos/index.html))
- ✅ Added `getSearchRange()` helper function for Firestore text queries
- ✅ Modified `cargarContratos()` to use Firestore queries with `cliente_nombre_lower` field
- ✅ Added debounced search (500ms delay) that triggers automatically as user types
- ✅ Search triggers on Enter key press
- ✅ Removed client-side name filtering from `filtrarLocal()` function

### 2. **Contract Creation** ([nuevo-contrato.html](public/contratos/nuevo-contrato.html))
- ✅ Added `cliente_nombre_lower` field to new contracts

### 3. **Migration Script** ([migrate-add-cliente-nombre-lower.js](functions/migrate-add-cliente-nombre-lower.js))
- ✅ Created script to add `cliente_nombre_lower` to existing contracts

## Required Setup Steps

### Step 1: Run Migration Script
Add the lowercase field to all existing contracts:

```bash
cd functions
node migrate-add-cliente-nombre-lower.js
```

**Note:** You need a `serviceAccountKey.json` file in the `functions/` directory.

### Step 2: Create Firestore Composite Index

The new query requires a composite index. You'll see this error when first searching:

```
The query requires an index. You can create it here: [URL]
```

**Click the URL** to auto-create the index in Firebase Console, or manually create:

**Collection:** `contratos`  
**Fields:**
1. `deleted` (Ascending)
2. `estado` (Ascending) *(if filtering by status)*
3. `creado_por_uid` (Ascending) *(if user is vendedor)*
4. `cliente_nombre_lower` (Ascending)
5. `fecha_creacion` (Descending) *(or your default sort field)*

**Query Scope:** Collection

#### Example Index Configurations

**For admins searching with status filter:**
```
deleted ASC → estado ASC → cliente_nombre_lower ASC → fecha_creacion DESC
```

**For vendedores searching:**
```
deleted ASC → creado_por_uid ASC → cliente_nombre_lower ASC → fecha_creacion DESC
```

**For basic search without filters:**
```
deleted ASC → cliente_nombre_lower ASC → fecha_creacion DESC
```

### Step 3: Test the Search
1. Open [/contratos/](public/contratos/index.html)
2. Type a client name in the search box
3. Results should update after 500ms automatically
4. Should search across ALL contracts in database

## How It Works

### Text Search with Firestore
Firestore doesn't have full-text search, so we use **range queries**:

```javascript
// Searching for "juan" finds: juan, juana, juanita, etc.
.where("cliente_nombre_lower", ">=", "juan")
.where("cliente_nombre_lower", "<", "juao")  // Next char in sequence
```

### Performance
- **Indexed queries:** Fast (< 100ms for thousands of records)
- **Debounced input:** Reduces query load
- **Pagination still works:** Load more continues to work

## Limitations

1. **No typo tolerance:** Must type exact characters
2. **Prefix search only:** Can't search middle or end of words
3. **Case-insensitive but exact match:** "Juan" finds "Juan García" but not "García Juan"

## Alternative Solutions (Future)

For better search capabilities, consider:
- **Algolia:** Full-text search with typo tolerance
- **Cloud Functions + Elasticsearch:** Self-hosted search
- **MeiliSearch:** Open-source alternative to Algolia

## Troubleshooting

### Error: "The query requires an index"
→ Click the URL in the error message to create the index automatically

### Search returns no results
→ Check browser console for errors  
→ Verify migration script ran successfully  
→ Confirm `cliente_nombre_lower` field exists in documents

### Search is slow
→ Ensure Firestore index was created  
→ Check index status in Firebase Console → Firestore → Indexes

### Old contracts don't appear in search
→ Re-run migration script  
→ Check if `cliente_nombre_lower` field is missing

## Rollback

To revert to client-side search:
1. Restore `filtrarLocal()` to include client name filtering
2. Remove `getSearchRange()` function
3. Remove Firestore query conditions for `cliente_nombre_lower`
4. Remove debounced search listeners

Keep the `cliente_nombre_lower` field for future use.

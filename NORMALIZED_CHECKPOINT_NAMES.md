# Normalized Checkpoint Names

## Overview

All packages now use **"finalized"** as the name of the final checkpoint that contains the `Final/` output directory. This creates consistency across all build workflows.

## Standardized Final Checkpoint

### Before (Inconsistent)
```
ONNX Runtime:  wasm-finalized.tar.gz
Yoga Layout:   wasm-finalized.tar.gz
Models:        quantized.tar.gz (no finalized)
Node.js Smol:  finalized.tar.gz
```

### After (Consistent)
```
ONNX Runtime:  finalized.tar.gz  ← renamed from wasm-finalized
Yoga Layout:   finalized.tar.gz  ← renamed from wasm-finalized
Models:        finalized.tar.gz  ← NEW (copies quantized)
Node.js Smol:  finalized.tar.gz  ← already correct
```

## Complete Checkpoint Chains

### ONNX Runtime (`onnxruntime-builder`)

```yaml
# Dev mode (optimization skipped)
checkpoint-chain: 'finalized,wasm-synced,wasm-released,wasm-compiled,source-cloned'

# Prod mode (includes optimization)
checkpoint-chain: 'finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-cloned'
```

**Checkpoints:**
```
shared/checkpoints/
└── source-cloned.tar.gz       [Shared] Pristine ONNX Runtime source

{mode}/checkpoints/
├── wasm-compiled.tar.gz       [Mode] Compiled WASM
├── wasm-released.tar.gz       [Mode] Copied to Release/
├── wasm-optimized.tar.gz      [Mode] Optimized WASM (prod only)
├── wasm-synced.tar.gz         [Mode] Generated sync wrapper
└── finalized.tar.gz           [Mode] Final/ directory ← RENAMED
```

**What changed:** `wasm-finalized` → `finalized`

**Note:** In dev mode, `wasm-optimized` is skipped to speed up builds. The checkpoint chain is dynamically set based on build mode.

---

### Yoga Layout (`yoga-layout-builder`)

```yaml
# Dev mode (optimization skipped)
checkpoint-chain: 'finalized,wasm-synced,wasm-released,wasm-compiled,source-configured,source-cloned'

# Prod mode (includes optimization)
checkpoint-chain: 'finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-configured,source-cloned'
```

**Checkpoints:**
```
shared/checkpoints/
└── source-cloned.tar.gz          [Shared] Pristine Yoga source

{mode}/checkpoints/
├── source-configured.tar.gz      [Mode] CMake configured
├── wasm-compiled.tar.gz          [Mode] Compiled WASM
├── wasm-released.tar.gz          [Mode] Copied to Release/
├── wasm-optimized.tar.gz         [Mode] Optimized WASM (prod only)
├── wasm-synced.tar.gz            [Mode] Generated sync wrapper
└── finalized.tar.gz              [Mode] Final/ directory ← RENAMED
```

**What changed:** `wasm-finalized` → `finalized`

**Note:** In dev mode, `wasm-optimized` is skipped to speed up builds. The checkpoint chain is dynamically set based on build mode.

---

### Models (`models`)

```yaml
checkpoint-chain: 'finalized,quantized,converted,downloaded'
```

**Checkpoints:**
```
{mode}/checkpoints/
├── downloaded.tar.gz       [Mode] Downloaded from Hugging Face
├── converted.tar.gz        [Mode] Converted to ONNX format
├── quantized.tar.gz        [Mode] Quantized (int4/int8)
└── finalized.tar.gz        [Mode] Final/ directory ← NEW (copy of quantized)
```

**What changed:** Added new `finalized` checkpoint that copies `quantized`

**Why:** Models already puts everything in `Final/` during quantization, so `finalized` is just a normalized copy for consistency.

---

### Node.js Smol (`node-smol-builder`)

```yaml
checkpoint-chain: 'finalized,binary-compressed,binary-stripped,binary-released,source-patched,source-cloned'
```

**Checkpoints:**
```
shared/checkpoints/
└── source-cloned.tar.gz             [Shared] Pristine Node.js source

{mode}/checkpoints/
├── source-patched.tar.gz            [Mode] Platform-specific patches
├── binary-released.tar.gz           [Mode] Built Node.js binary
├── binary-stripped.tar.gz           [Mode] Stripped debug symbols
├── binary-compressed.tar.gz         [Mode] Compressed binary
└── finalized.tar.gz                 [Mode] Final/ directory (decompressed)
```

**What changed:** Nothing - already used `finalized`

**Note:** Node.js Smol has a `binary-compressed` checkpoint with the compressed binary, and `finalized` contains the decompressed final binary in `Final/`.

---

## Benefits of Normalization

### 1. Consistent Naming
```yaml
# All workflows now use the same final checkpoint name
checkpoint-chain: 'finalized,...'
```

### 2. Easier Automation
```bash
# Generic script works for all packages
FINAL_CHECKPOINT="finalized"
tar -xzf "${CHECKPOINT_DIR}/${FINAL_CHECKPOINT}.tar.gz"
```

### 3. Clear Intent
- **`finalized`** = Always contains `Final/` output directory
- **Other checkpoints** = Intermediate build states

### 4. Future-Proof
Adding new packages? Just use `finalized` for the final checkpoint.

## Checkpoint Location Logic

The restoration action now handles both **shared** and **mode-specific** checkpoints:

```bash
if [ "${CHECKPOINT}" = "source-cloned" ]; then
  # Shared checkpoint (same for dev/prod)
  CHECKPOINT_FILE="build/shared/checkpoints/${CHECKPOINT}.tar.gz"
else
  # Mode-specific checkpoint (different for dev/prod)
  CHECKPOINT_FILE="build/${MODE}/checkpoints/${CHECKPOINT}.tar.gz"
fi
```

**Packages with shared checkpoints:**
- ONNX Runtime: `source-cloned`
- Yoga Layout: `source-cloned`
- Node.js Smol: `source-cloned`

**Packages without shared checkpoints:**
- Models: All checkpoints are mode-specific

## Implementation Notes

### ONNX & Yoga: Rename Existing

The build scripts will need to be updated to create `finalized.tar.gz` instead of `wasm-finalized.tar.gz`:

```javascript
// Before
await checkpoint.save('wasm-finalized', finalDir)

// After
await checkpoint.save('finalized', finalDir)
```

### Models: Add Copy Step

Add a new finalization phase that copies the quantized checkpoint:

```javascript
// After quantization
await checkpoint.save('quantized', finalDir)

// NEW: Also save as finalized for consistency
await checkpoint.save('finalized', finalDir)
```

Alternatively, just create a hard link or symbolic link if the filesystem supports it.

### Node.js Smol: No Changes Needed

Already uses `finalized` correctly.

## Migration Path

### Phase 1: Backward Compatibility (Current)

Workflows accept both old and new names:

```yaml
checkpoint-chain: 'finalized,wasm-finalized,wasm-synced,...'
                   ↑ Try new     ↑ Fallback to old
```

This allows gradual migration without breaking existing caches.

### Phase 2: Build Script Updates

Update build scripts to create `finalized` instead of `wasm-finalized`.

### Phase 3: Remove Old Names

Once all caches are migrated, remove old checkpoint names from chains:

```yaml
# Final state
checkpoint-chain: 'finalized,wasm-synced,...'
```

## Validation Updates

Validation logic now checks for `finalized`:

```bash
# ONNX & Yoga
MODE_CHECKPOINTS="wasm-compiled wasm-released wasm-synced finalized"

# Models (accepts both during migration)
if [ ! -f "finalized.json" ] && [ ! -f "quantized.json" ]; then
  echo "❌ No final checkpoint found"
  exit 1
fi
```

## Summary Table

| Package | Old Final Name | New Final Name | Implementation |
|---------|----------------|----------------|----------------|
| **ONNX Runtime** | `wasm-finalized` | `finalized` | Rename in build script |
| **Yoga Layout** | `wasm-finalized` | `finalized` | Rename in build script |
| **Models** | `quantized` (implicit) | `finalized` | Add copy/link step |
| **Node.js Smol** | `finalized` | `finalized` | No change needed |

## Complete Checkpoint Chains Reference

```yaml
# ONNX Runtime
# Dev:  finalized,wasm-synced,wasm-released,wasm-compiled,source-cloned
# Prod: finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-cloned

# Yoga Layout
# Dev:  finalized,wasm-synced,wasm-released,wasm-compiled,source-configured,source-cloned
# Prod: finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-configured,source-cloned

# Models
finalized,quantized,converted,downloaded

# Node.js Smol
finalized,binary-compressed,binary-stripped,binary-released,source-patched,source-cloned
```

## Conclusion

All packages now use **`finalized`** as the standard name for the final checkpoint containing the `Final/` output directory. This normalization simplifies workflows, improves consistency, and makes the codebase easier to understand and maintain.

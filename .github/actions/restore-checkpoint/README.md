# Restore Checkpoint Chain Action

A reusable GitHub Actions composite action for restoring build outputs from checkpoint tarballs using progressive restoration.

## Purpose

When using checkpoint-based builds with GitHub Actions cache:
1. **On first run**: Build creates checkpoint tarballs in `build/{mode}/checkpoints/` and `build/shared/checkpoints/`
2. **On cache hit**: Build may be skipped to save time if latest checkpoint exists
3. **Progressive restoration**: Walks backward through checkpoint chain to find latest valid checkpoint
4. **Resumable builds**: Restores from any checkpoint and resumes building remaining checkpoints

## Usage

```yaml
- name: Restore build output from checkpoint chain
  id: restore-checkpoint
  uses: ./.github/actions/restore-checkpoint
  with:
    package-name: 'onnxruntime-builder'
    build-mode: ${{ steps.build-mode.outputs.mode }}
    checkpoint-chain: 'finalized,wasm-synced,wasm-released,wasm-compiled,source-cloned'
    cache-hit: ${{ steps.checkpoint-cache.outputs.cache-hit }}
    cache-valid: ${{ steps.validate-cache.outputs.cache_valid }}

- name: Build (if needed)
  if: steps.restore-checkpoint.outputs.needs-build == 'true'
  run: pnpm --filter onnxruntime-builder build --prod
```

## Inputs

| Input | Required | Description | Example |
|-------|----------|-------------|---------|
| `package-name` | Yes | Package name in `packages/` directory | `onnxruntime-builder` |
| `build-mode` | Yes | Build mode (dev or prod) | `prod` |
| `checkpoint-chain` | Yes | Comma-separated list of checkpoints (newest to oldest) | `finalized,wasm-synced,wasm-compiled` |
| `cache-hit` | Yes | Whether checkpoint cache was hit (`true`/`false`) | `${{ steps.cache.outputs.cache-hit }}` |
| `cache-valid` | Yes | Whether checkpoint validation passed (`true`/`false`) | `${{ steps.validate.outputs.cache_valid }}` |

## Outputs

| Output | Description | Values |
|--------|-------------|--------|
| `restored` | Whether any checkpoint was successfully restored | `true` or `false` |
| `checkpoint-restored` | Name of the checkpoint that was restored | Checkpoint name or empty |
| `checkpoint-index` | Index of restored checkpoint in chain | `0` (newest) to `N-1` (oldest), or `-1` if none |
| `needs-build` | Whether build needs to run to complete remaining checkpoints | `true` or `false` |

## How It Works

### Progressive Restoration Algorithm

1. **Parse checkpoint chain**: Splits comma-separated list into array
2. **Walk backward** through chain (newest → oldest):
   - Check if checkpoint exists
   - Verify tarball integrity
   - If valid, restore and break
3. **Extract checkpoint** to output directory
4. **Determine if build needed**:
   - Index 0 (newest): Build can be skipped
   - Index > 0 (older): Build must run to complete remaining checkpoints

### Checkpoint Locations

- **Shared checkpoints**: `build/shared/checkpoints/` (e.g., `source-cloned`)
- **Mode-specific checkpoints**: `build/{mode}/checkpoints/` (e.g., `finalized`, `wasm-compiled`)

Currently only `source-cloned` is shared across dev/prod modes.

## Example Scenarios

### Scenario 1: Complete Cache (finalized found)
```
Checkpoint chain: finalized,wasm-synced,wasm-compiled,source-cloned
Found: finalized (index 0)
Result: restored=true, needs-build=false
Action: Skip build entirely
```

### Scenario 2: Partial Cache (wasm-compiled found)
```
Checkpoint chain: finalized,wasm-synced,wasm-compiled,source-cloned
Found: wasm-compiled (index 2)
Result: restored=true, needs-build=true
Action: Build runs to create wasm-synced → finalized
```

### Scenario 3: Early Cache (source-cloned found)
```
Checkpoint chain: finalized,wasm-synced,wasm-compiled,source-cloned
Found: source-cloned (index 3)
Result: restored=true, needs-build=true
Action: Build runs to create wasm-compiled → wasm-synced → finalized
```

### Scenario 4: No Cache
```
Checkpoint chain: finalized,wasm-synced,wasm-compiled,source-cloned
Found: none
Result: restored=false, needs-build=true
Action: Build runs from scratch
```

## Package-Specific Checkpoint Chains

| Package | Checkpoint Chain |
|---------|------------------|
| **ONNX Runtime** (dev) | `finalized,wasm-synced,wasm-released,wasm-compiled,source-cloned` |
| **ONNX Runtime** (prod) | `finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-cloned` |
| **Yoga Layout** (dev) | `finalized,wasm-synced,wasm-released,wasm-compiled,source-configured,source-cloned` |
| **Yoga Layout** (prod) | `finalized,wasm-synced,wasm-optimized,wasm-released,wasm-compiled,source-configured,source-cloned` |
| **Models** | `finalized,quantized,converted,downloaded` |
| **Node.js Smol** | `finalized,binary-compressed,binary-stripped,binary-released,source-patched,source-cloned` |

Note: ONNX and Yoga include `wasm-optimized` only in prod mode.

## Expected Checkpoint Structure

Checkpoints should contain a `Final/` directory with build outputs:

```
finalized.tar.gz
└── Final/
    ├── output.wasm
    ├── output.mjs
    └── output.js
```

## Error Handling

The action will fail with detailed error messages if:
- No valid checkpoints found in chain
- All tarballs are corrupted
- Extraction fails
- Output directory is invalid

## Benefits

### Progressive Restoration
- **Partial cache hits are useful**: Don't waste intermediate checkpoints
- **Resumable builds**: Continue from any point in the pipeline
- **Faster iterations**: Skip completed phases even if final checkpoint is missing

### Consistency
- **Single restoration logic**: Shared across all workflows
- **Maintainability**: Update in one place
- **Debugging**: Detailed logging shows which checkpoint was used

### Efficiency
- **Maximize cache utilization**: Use any valid checkpoint, not just the final one
- **Reduce build times**: Skip unnecessary rebuild of early phases
- **CI cost savings**: Less compute time = lower costs

## Migration Notes

This action replaced the older single-checkpoint restoration pattern. All packages now use progressive restoration with standardized checkpoint naming:

- All final checkpoints are named **`finalized`** (previously `wasm-finalized`, `quantized`, etc.)
- All restoration happens through checkpoint chains
- No separate Final output caches (checkpoint-only caching)

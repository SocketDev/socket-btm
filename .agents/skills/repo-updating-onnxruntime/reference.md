# updating-onnxruntime Reference Documentation

This document provides edge cases, troubleshooting, and additional context for the updating-onnxruntime skill.

## Table of Contents

- [Tag Format Reference](#tag-format-reference)
- [Cache Version Dependencies](#cache-version-dependencies)
- [Edge Cases](#edge-cases)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Tag Format Reference

- Format: `vX.Y.Z` (e.g., `v1.24.3`)
- .gitmodules comment: `# onnxruntime-X.Y.Z` (strip `v` prefix, e.g., `# onnxruntime-1.24.3`)
- Submodule path: `packages/onnxruntime-builder/upstream/onnxruntime`
- Upstream: `https://github.com/microsoft/onnxruntime.git`
- Exclude: Any tag with `rc`, `alpha`, `beta`, `dev`, `preview`

## Cache Version Dependencies

When updating ONNX Runtime, bump these cache versions:

```json
{
  "versions": {
    "onnxruntime": "v21", // ← Bump this
    "models": "v21"       // ← Bump this (models depends on onnxruntime)
  }
}
```

## Edge Cases

### Nested Submodules

**Critical:** ONNX Runtime has nested submodules (e.g., `cmake/external/onnx`, `cmake/external/emsdk`). After checkout, always run:

```bash
git submodule update --init --recursive packages/onnxruntime-builder/upstream/onnxruntime
```

Without this, `git status` will show `modified content` or `untracked content` in the submodule.

### Long Build Times

ONNX Runtime WASM builds can take **30+ minutes**. In CI mode, builds are skipped and run in separate workflow jobs.

### External Tools Dependencies

Check `packages/onnxruntime-builder/external-tools.json` after updating. New ONNX Runtime versions may require:
- Newer cmake version
- Newer emscripten version
- Newer Python version

### Model Compatibility

New ONNX Runtime versions may require model re-quantization or format updates. Test model loading after updating.

## Rollback Procedures

### Rollback After Commit

```bash
git reset --hard HEAD~1
```

### Rollback After Push

```bash
git revert HEAD
git push origin main
```

## Troubleshooting

### Submodule Shows Modified/Untracked Content

**Symptom:** `git status` shows `(modified content)` or `(untracked content)` for onnxruntime

**Solution:**
```bash
git submodule update --init --recursive packages/onnxruntime-builder/upstream/onnxruntime
```

### WASM Build Fails

**Symptom:** Emscripten compilation errors

**Cause:** emscripten version incompatible with new ONNX Runtime.

**Solution:**
1. Check `external-tools.json` for required emscripten version
2. Update emscripten if needed
3. Check ONNX Runtime build docs for WASM requirements

### Model Loading Fails After Update

**Symptom:** `Error loading ONNX model` or operator not supported

**Cause:** Model format version mismatch or deprecated operator.

**Solution:**
1. Check ONNX Runtime release notes for breaking changes
2. Re-export/re-quantize affected models
3. Or rollback if model updates aren't feasible

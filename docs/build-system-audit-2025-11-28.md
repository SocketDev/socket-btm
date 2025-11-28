# Build System Audit Report
**Date**: 2025-11-28
**Scope**: All packages in Socket BTM monorepo
**Overall Score**: 78/100

## Executive Summary

Comprehensive audit of 7 packages reveals a well-architected system with strong consistency, but 15 issues need attention:

- **Critical**: 3 issues (must fix immediately)
- **High**: 4 issues (should fix soon)
- **Medium**: 5 issues (improve when possible)
- **Low**: 3 issues (nice to have)

## Packages Audited

1. ✅ **node-smol-builder** - Binary package (Node.js custom builds)
2. ✅ **onnxruntime-builder** - WASM package (ONNX Runtime)
3. ✅ **yoga-layout-builder** - WASM package (Yoga Layout)
4. ⚠️ **models** - Unified model package (MiniLM + CodeT5)
5. ❌ **codet5-models-builder** - Legacy/standalone (no CI workflow)
6. ❌ **minilm-builder** - Legacy/standalone (no CI workflow)
7. ✅ **build-infra** - Shared infrastructure

## Critical Issues (Fix Immediately)

### 1. Node-Smol Missing Checkpoint Validation
**Location**: `.github/workflows/node-smol.yml` lines 358-365
**Impact**: Cache invalidation may miss changed intermediate checkpoints
**Fix**: Validate all 6 checkpoints (source-cloned, source-patched, binary-released, binary-stripped, binary-compressed, finalized)

### 2. Models Checkpoint Structure Mismatch
**Location**: `packages/models/scripts/build.mjs`
**Impact**: CI expects `build/${mode}/checkpoints`, local uses flat structure
**Fix**: Align directory structure between local and CI

### 3. CodeT5 and MiniLM Standalone Packages Have No CI
**Location**: `.github/workflows/` (missing)
**Impact**: No CI validation or automated releases
**Fix**: Either create workflows, deprecate packages, or document status clearly

## High Priority Issues (Fix This Sprint)

### 4. Missing Checkpoint Chain Scripts
**Packages**: onnxruntime-builder, yoga-layout-builder, models
**Impact**: Risk of drift between local and CI checkpoint chains
**Fix**: Create `get-checkpoint-chain.mjs` for each package (follow node-smol pattern)

### 5. Models Validation Incomplete
**Location**: `.github/workflows/models.yml` lines 178-189
**Impact**: Cache could be valid with corrupted intermediate checkpoints
**Fix**: Validate all 4 checkpoints (downloaded, converted, quantized, finalized)

### 6. Unclear Package Relationships
**Packages**: models vs codet5-models-builder vs minilm-builder
**Impact**: Confusion about which package to use/maintain
**Fix**: Document in main README which package is canonical

### 7. Emscripten Version Inconsistency (Yoga)
**Location**: `packages/yoga-layout-builder/scripts/build.mjs` line 267
**Impact**: Local and CI may use different Emscripten versions
**Fix**: Update local build to use external-tools.json

## Medium Priority Issues

8. Cache version not centralized (node-smol)
9-10. Missing checkpoint chain scripts (ONNX, Yoga) - duplicate of #4
11. Models size threshold missing in local builds
12. Emscripten version loading inconsistency (shared)

## Low Priority Issues

13-14. Missing size validation in ONNX and Yoga local builds
15. Standardize Emscripten version loading helper

## Action Items (Prioritized)

### Immediate (This Session)
1. ✅ Fix node-smol checkpoint validation - 1 hour
2. ✅ Fix models checkpoint structure - 2 hours
3. ✅ Clarify codet5/minilm package status - 1 hour (document deprecation)

### Soon (Next 1-2 Days)
4. ✅ Create checkpoint chain scripts (onnx, yoga, models) - 3 hours
5. ✅ Complete models validation - 2 hours
6. ✅ Document package relationships - 1 hour
7. ✅ Fix yoga emscripten version - 30 minutes

### When Possible (Next Sprint)
8. Centralize cache versions - 2 hours
9. Add size validation to local builds - 2 hours
10. Standardize emscripten loading - 3 hours

### Nice to Have (Backlog)
11. Add size validation everywhere - 1 hour
12. Create emscripten version helper - 1 hour

## Strengths of Current System

- ✅ Excellent checkpoint system for incremental builds
- ✅ Consistent patterns across WASM packages
- ✅ Sophisticated cache key generation with cumulative hashing
- ✅ Good separation of shared vs mode-specific artifacts
- ✅ Comprehensive validation in CI
- ✅ Strong Python dependency management

## Recommendations

### Short Term (1-2 weeks)
- Fix all Critical issues
- Create checkpoint chain scripts
- Clarify package structure

### Medium Term (1 month)
- Standardize emscripten version loading
- Add comprehensive validation
- Document build system architecture

### Long Term (Ongoing)
- Monitor checkpoint chain consistency
- Create shared build script templates
- Consider checkpoint chain validation tool

## Conclusion

The Socket BTM build system is **production-ready with strong foundations**. The identified issues are mostly about consistency and documentation rather than fundamental architectural problems. With critical and high-priority fixes, the system will be excellent.

**Estimated Total Fix Time**: ~26.5 hours
- Critical: 7 hours
- High: 10.5 hours
- Medium: 7 hours
- Low: 2 hours

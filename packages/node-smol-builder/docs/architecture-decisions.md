# Architecture Decision Records

This document explains the key architectural decisions made in the socket-btm project.

## ADR-001: LZFSE Compression Instead of UPX

### Context
We needed to compress Node.js binaries from ~93MB to a smaller distributable size.

### Decision
Use LZFSE compression with self-extracting stubs instead of UPX.

### Rationale

| Factor | UPX | LZFSE |
|--------|-----|-------|
| Compression ratio | 50-60% | 75-79% |
| macOS code signing | Broken | Preserved |
| AV false positives | 15-30% | 0% |
| Self-modifying code | Yes | No |
| Runtime overhead | Decompresses in memory | Decompresses to disk cache |

UPX modifies binaries in ways that break macOS code signing and trigger antivirus false positives. LZFSE provides better compression and avoids these issues.

### Consequences
- Binaries decompress to `~/.socket/_dlx/` on first run
- Subsequent runs use cached decompressed binary
- Code signing is preserved on macOS

---

## ADR-002: Batch Injection via LIEF

### Context
SEA and VFS resources need to be injected into Node.js binaries across platforms.

### Decision
Use batch injection (inject all resources in single LIEF parse/write cycle) instead of sequential injection.

### Rationale
Sequential LIEF operations cause memory corruption due to internal state management. Batch injection:
- Parses binary once
- Adds all sections in memory
- Writes modified binary once

### Consequences
- `binject_batch()` is the primary injection function
- Single-resource injection still supported but discouraged
- LIEF memory management is handled correctly

---

## ADR-003: Three Source Package Architecture

### Context
C/C++ code is shared across multiple binary tools (binject, binpress, binflate, stubs-builder) and embedded in node-smol.

### Decision
Organize shared code into three canonical source packages:
- `build-infra` - Used by all tools AND node-smol
- `bin-infra` - Used by binary tools only
- `binject` - Injection-specific code

### Rationale

```
Code Selection Rules:
├─ Used by binject/binpress/binflate AND node-smol → build-infra
├─ Used by binject/binpress/binflate only         → bin-infra
└─ Injection-specific                              → binject
```

### Consequences
- Source packages are canonical (edit there, not in additions/)
- additions/src/socketsecurity/ is generated via sync
- Cache version bumps cascade through dependency chain

---

## ADR-004: Checkpoint-Based Incremental Builds

### Context
Node.js builds take 15-30 minutes. Developers need fast iteration.

### Decision
Use checkpoint system with content-based cache invalidation.

### Rationale
Each build stage creates a checkpoint containing:
- Artifact hash (SHA-256 of output)
- Source file hashes (SHA-256 of inputs)
- Platform/arch metadata

Stages are skipped if checkpoint is valid and inputs unchanged.

### Consequences
- First build is slow, subsequent builds fast
- `--clean` flag forces full rebuild
- Cache invalidation is automatic based on file content

---

## ADR-005: Segment Removal and Recreation (LIEF Workaround)

### Context
LIEF cannot modify existing segment content in place.

### Decision
Remove existing segments entirely, then create new ones with updated content.

### Rationale
LIEF's `section.content()` setter doesn't work reliably for binary data. Instead:
1. Remove existing SMOL/NODE_SEA segment
2. Create new segment with new content
3. Write modified binary

### Consequences
- Injection always removes existing resources before adding new ones
- Re-injection works correctly
- Slight overhead from segment recreation

---

## ADR-006: Platform-Specific Injection Implementations

### Context
Mach-O, ELF, and PE have different segment/section models.

### Decision
Use LIEF for all platforms but with platform-specific wrapper code.

### Rationale

| Platform | Segment Model | Section Naming |
|----------|---------------|----------------|
| Mach-O | Segment → Section | `SMOL/__PRESSED_DATA` |
| ELF | PT_NOTE segments | `.note.smol_pressed_data` |
| PE | Resource sections | `.pressed_data` |

Each platform needs different LIEF API calls and naming conventions.

### Consequences
- `macho_inject_lief.cpp`, `elf_inject_lief.cpp`, `pe_inject_lief.cpp`
- Shared templates in `binject_section_ops.hpp`
- Platform detection routes to correct implementation

---

## ADR-007: NODE_SEA_FUSE Single Flip

### Context
Node.js SEA uses a fuse byte `:0` that must become `:1` to indicate SEA is present.

### Decision
Only flip fuse if NODE_SEA segment doesn't exist. If segment exists (re-injection), fuse is already flipped.

### Rationale
Flipping an already-flipped fuse would search for wrong pattern and fail. Detection logic:
1. Check for existing NODE_SEA segment
2. If exists: skip fuse flip (re-injection case)
3. If not exists: flip fuse and create segment

### Consequences
- First injection flips fuse
- Re-injection skips fuse flip
- Idempotent injection behavior

---

## ADR-008: DLX Cache Directory Structure

### Context
Decompressed binaries need persistent caching for performance.

### Decision
Use `~/.socket/_dlx/<cache_key>/` with 16-hex-char cache keys.

### Rationale
- `~/.socket/` is Socket Security's user data directory
- `_dlx/` prefix indicates decompression cache
- Cache key is first 16 hex chars of SHA-512 of compressed data
- Provides ~2^64 collision resistance

### Consequences
- Cache cleanup is user's responsibility
- Multiple versions coexist in cache
- Cache key derived from content, not filename

---

## ADR-009: VFS In-Memory vs On-Disk Modes

### Context
VFS archives can be extracted to memory or disk at runtime.

### Decision
Support three VFS modes: `in-memory`, `on-disk`, `compat`.

### Rationale

| Mode | Extraction | Use Case |
|------|------------|----------|
| `in-memory` | Extract to memory | Small VFS, fastest access |
| `on-disk` | Extract to temp dir | Large VFS, standard fs ops |
| `compat` | No extraction | API only, no embedded files |

### Consequences
- Mode specified in SVFG config (366 bytes)
- Runtime behavior differs based on mode
- All modes provide same API surface

---

## ADR-010: Small ICU Instead of Full ICU

### Context
Node.js full ICU adds ~30MB to binary size.

### Decision
Use small-icu with locale polyfills.

### Rationale
- Full ICU: ~30MB additional data
- Small ICU: Minimal locale support
- Polyfills restore essential `localeCompare()` functionality

### Consequences
- Some Intl features unavailable
- `locale-compare.js` polyfill handles common cases
- Binary size significantly reduced

---

## ADR-011: 14 Independent Node.js Patches

### Context
Node.js source needs modifications for SMOL/SEA/VFS integration.

### Decision
Maintain 14 independent patches, each modifying exactly one file.

### Rationale
- Independence: Each patch applies to pristine upstream
- Maintainability: Patches can be regenerated individually
- Clarity: Each patch has single purpose

### Consequences
- Patches don't depend on each other
- Order doesn't matter for application
- Easy to update for new Node.js versions

---

## ADR-012: Exceptions Disabled in C++ Code

### Context
C++ code added to node-smol compiles alongside Node.js source.

### Decision
Compile with `-fno-exceptions` to align with Node.js build configuration.

### Rationale
Node.js itself is compiled without exceptions (`-fno-exceptions`). Our additions must use the same compiler flags to:
- Link correctly with Node.js internals
- Avoid ABI incompatibilities
- Match Node.js's error handling patterns

### Consequences
- All C++ additions use return values for error handling
- LIEF wrappers convert exceptions to error codes
- No `try/catch` in socket-btm C++ additions

---

## ADR-013: LIEF Version Aligned with Upstream Node.js

### Context
LIEF is used for binary manipulation (segment injection, section creation). Node.js also uses LIEF internally for postject operations.

### Decision
Keep LIEF version aligned with the version used by upstream Node.js.

### Rationale
- **ABI compatibility**: LIEF compiled into node-smol must be compatible with Node.js internals
- **Build consistency**: Same compiler flags, same C++ standard, same runtime
- **Reduced conflicts**: Avoids symbol clashes or duplicate definitions
- **Upstream validation**: Node.js has already validated this LIEF version works

### Version Tracking

| Node.js Version | LIEF Version | Notes |
|-----------------|--------------|-------|
| v25.8.0 | 0.17.0 | Current |

### Consequences
- LIEF updates require checking upstream Node.js first
- `lief-builder` package manages LIEF submodule (at packages/lief-builder/upstream/lief)
- Version bumps cascade through dependent packages
- See `updating-lief` skill for upgrade procedure

# SMOL Stub Injection & Repack Flow

## Overview

When injecting SEA/VFS resources into a SMOL-compressed Node.js binary, the process involves extracting, modifying, recompressing, and repacking. Here's the complete flow:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SMOL STUB INJECTION FLOW                             │
└─────────────────────────────────────────────────────────────────────────────┘

INPUT FILES:
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Original SMOL   │    │   SEA Blob       │    │   VFS Blob       │
│  Compressed Stub │    │  (app.blob)      │    │  (vfs.blob)      │
│  (node-smol)     │    │                  │    │  [optional]      │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         ▼                       │                       │
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 0: SMOL EXTRACTION                                                     │
│ binject.c:binject_batch() → binject_get_extracted_path()                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐         ┌──────────────────────────────────────────┐ │
│  │  SMOL Stub       │  LZFSE  │  ~/.socket/_dlx/<cache_key>/node         │ │
│  │  __PRESSED_DATA  │ ──────► │  (Extracted uncompressed Node.js ~60MB)  │ │
│  │  (~22MB)         │ Decomp  │                                          │ │
│  └──────────────────┘         └────────────────────┬─────────────────────┘ │
│                                                    │                       │
└────────────────────────────────────────────────────┼───────────────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: LIEF BATCH INJECTION                                                │
│ macho_inject_lief.cpp:binject_macho_lief_batch() [line 678]                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────────────┐ │
│  │ Extracted Node   │    │  + SEA blob      │    │ Modified Binary       │ │
│  │ (~60MB)          │ +  │  + VFS blob      │ =  │ (written to temp file)│ │
│  │                  │    │  + Fuse flip     │    │                       │ │
│  └──────────────────┘    └──────────────────┘    └─────────────┬─────────┘ │
│                                                                │           │
│  Actions performed:                                            │           │
│  • Parse Mach-O with LIEF                                      │           │
│  • Check for existing NODE_SEA segment                         │           │
│  • Flip NODE_SEA_FUSE :0 → :1 (only if segment doesn't exist)  │           │
│  • Remove existing NODE_SEA segment (if present, for re-inject)│           │
│  • Create new NODE_SEA segment                                 │           │
│  • Add __NODE_SEA_BLOB section                                 │           │
│  • Add __SMOL_VFS_BLOB section [if VFS]                        │           │
│  • Add __SMOL_VFS_CONFIG section [if vfs_config_data, 1192B]   │           │
│  • Add segment to binary                                       │           │
│  • Remove existing code signature                              │           │
│  • Write to temp file                                          │           │
│  • Set executable permissions                                  │           │
│  • Ad-hoc sign with codesign                                   │           │
│  • Atomic rename to final output                               │           │
│                                                                │           │
└────────────────────────────────────────────────────────────────┼───────────┘
                                                                 │
                                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: RENAME TO .injected (SMOL stub path)                                │
│ binject.c:binject_batch() lines 980-989                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────┐    ┌──────────────────────────────┐│
│  │ ~/.socket/_dlx/<key>/node          │    │ ~/.socket/_dlx/<key>/        ││
│  │ (injected binary from LIEF)        │───►│ node.injected                ││
│  └────────────────────────────────────┘    └──────────────────────────────┘│
│                                                                             │
│  Line 980: snprintf(temp_injected, PATH_MAX, "%s.injected", target_binary);│
│  Lines 985-989: rename(injected_binary, temp_injected) with error handling │
│                                                                             │
│  Note: Non-SMOL compressed stubs follow a simpler path without rename      │
│        (lines 951-967).                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPACK WORKFLOW: binject_repack_workflow()                                  │
│ stub_repack.c lines 355-412                                                │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPACK STEP 1: Sign modified extracted binary                               │
│ stub_repack.c line 360                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────┐                                   │
│  │ ~/.socket/_dlx/<key>/node.injected   │ ─── codesign --sign - --force ──►│
│  │ (~62MB with SEA+VFS sections)        │      (Ad-hoc signature)          │
│  └──────────────────────────────────────┘                                   │
│                                                                             │
│  Note: May skip if already signed (check with codesign -v)                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPACK STEP 2: Re-compress modified binary                                  │
│ stub_repack.c line 375 → binject_compress_binary()                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────┐    ┌────────────────────────────┐│
│  │ ~/.socket/_dlx/<key>/node.injected   │    │ ~/.socket/_dlx/<key>/      ││
│  │ (~62MB uncompressed)                 │───►│ node.injected.compressed   ││
│  └──────────────────────────────────────┘    │ (~21MB LZFSE compressed)   ││
│                                              └────────────────────────────┘│
│                                                                             │
│  Line 368: snprintf(temp_compressed, ..., "%s.compressed", extracted_path);│
│  Line 375: binject_compress_binary(extracted_path, temp_compressed, ...)   │
│                                                                             │
│  Compression details:                                                       │
│  • Algorithm: LZFSE (Apple's compression)                                  │
│  • Input:  62,268,512 bytes                                                │
│  • Output: 21,094,769 bytes (33.9% ratio)                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPACK STEP 3: Stat + Repack stub with new compressed data                  │
│ stub_repack.c lines 384-399                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  First: Stat the .injected file to get its size                            │
│  ┌──────────────────────────────────┐                                       │
│  │ Lines 384-390:                   │                                       │
│  │ struct stat st;                  │  ← Gets uncompressed size for        │
│  │ stat(extracted_path, &st)        │    metadata in stub                  │
│  │ size_t uncompressed_size = st... │                                       │
│  └──────────────────────────────────┘                                       │
│                                                                             │
│  Then: Repack the original stub with new compressed data                   │
│                                                                             │
│  ┌────────────────────┐  ┌────────────────────────┐  ┌──────────────────┐  │
│  │ Original SMOL      │  │ node.injected          │  │ Output Binary    │  │
│  │ Stub Template      │ +│ .compressed            │ =│ (Final result)   │  │
│  │ (stub structure)   │  │ (new compressed data)  │  │                  │  │
│  └────────────────────┘  └────────────────────────┘  └──────────────────┘  │
│                                                                             │
│  Line 392: binject_repack_stub()                                           │
│  Line 399: remove(temp_compressed) ← cleanup of .compressed file           │
│                                                                             │
│  smol_repack_lief() [stub_smol_repack_lief.cpp line 24]:                   │
│  • Parse original stub with LIEF                                           │
│  • Remove existing SMOL segment entirely (LIEF limitation workaround)      │
│  • Create new SMOL segment with updated content                            │
│  • Create __PRESSED_DATA section with new compressed data                  │
│  • Remove existing code signature                                          │
│  • Write new stub to output path                                           │
│  • Set executable permissions                                              │
│  • Sign with ad-hoc signature (macOS)                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPACK STEP 4: Sign the output stub                                         │
│ stub_repack.c line 403                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────┐                                       │
│  │ Output Binary                    │ ─── codesign --sign - --force ───►   │
│  │ (repacked SMOL stub)             │      (Final ad-hoc signature)        │
│  └──────────────────────────────────┘                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Note: Only .compressed is removed during Step 3. The .injected file is    │
│  NOT removed by binject_repack_workflow().                                 │
│                                                                             │
│  Final state:                                                               │
│  • ~/.socket/_dlx/<key>/node           ← may need re-extraction            │
│  • ~/.socket/_dlx/<key>/node.injected  ← may still exist                   │
│  • <output_path>                       ← final repacked SMOL stub          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Lifecycle Summary

```
TIMELINE OF FILES:

1. START
   ├── Original SMOL stub (input)
   ├── SEA blob (input)
   └── VFS blob (input, optional)

2. AFTER EXTRACTION
   └── ~/.socket/_dlx/<cache_key>/node  [CREATED - extracted binary]

3. AFTER LIEF INJECTION
   └── ~/.socket/_dlx/<cache_key>/node  [MODIFIED - has SEA+VFS sections]

4. AFTER RENAME
   ├── ~/.socket/_dlx/<cache_key>/node          [EMPTY/MISSING - was renamed]
   └── ~/.socket/_dlx/<cache_key>/node.injected [CREATED - renamed from above]

5. AFTER COMPRESSION
   ├── ~/.socket/_dlx/<cache_key>/node.injected            [EXISTS]
   └── ~/.socket/_dlx/<cache_key>/node.injected.compressed [CREATED]

6. AFTER REPACK (Step 3)
   ├── ~/.socket/_dlx/<cache_key>/node.injected            [EXISTS]
   ├── ~/.socket/_dlx/<cache_key>/node.injected.compressed [REMOVED at line 399]
   └── <output_path>                                        [CREATED - final binary]

7. FINAL STATE
   ├── ~/.socket/_dlx/<cache_key>/node.injected [MAY EXIST - not cleaned up]
   └── <output_path>                             [FINAL OUTPUT]
```

## Key Code Locations

| Step | File | Line | Function |
|------|------|------|----------|
| Extract | `binject.c` | 471 | `binject_get_extracted_path()` |
| Batch dispatch | `binject.c` | 742 | `binject_batch()` |
| Format dispatch | `binject.c` | 934-943 | Format-specific batch injection |
| Inject (Mach-O) | `macho_inject_lief.cpp` | 678 | `binject_macho_lief_batch()` |
| Create `.injected` | `binject.c` | 980 | `snprintf(..., "%s.injected", ...)` |
| Rename | `binject.c` | 985-989 | `rename()` with error handling |
| Call repack | `binject.c` | 992-997 | `binject_repack_workflow()` |
| Repack workflow | `stub_repack.c` | 355-412 | `binject_repack_workflow()` |
| Sign Step 1 | `stub_repack.c` | 360 | `binject_codesign()` |
| Create `.compressed` | `stub_repack.c` | 368 | `snprintf(..., "%s.compressed", ...)` |
| Compress | `stub_repack.c` | 375 | `binject_compress_binary()` |
| Stat | `stub_repack.c` | 384-390 | `stat()` for uncompressed size |
| Repack stub | `stub_repack.c` | 392 | `binject_repack_stub()` |
| Cleanup .compressed | `stub_repack.c` | 399 | `remove(temp_compressed)` |
| Sign Step 4 | `stub_repack.c` | 403 | `binject_codesign()` |
| LIEF repack | `stub_smol_repack_lief.cpp` | 24 | `smol_repack_lief()` |

## Section Names Reference

| Section | Segment | Purpose | Optional |
|---------|---------|---------|----------|
| `__PRESSED_DATA` | `SMOL` | LZFSE-compressed Node.js binary | No |
| `__NODE_SEA_BLOB` | `NODE_SEA` | SEA application blob | No |
| `__SMOL_VFS_BLOB` | `NODE_SEA` | Virtual filesystem blob | Yes |
| `__SMOL_VFS_CONFIG` | `NODE_SEA` | SMOL configuration (1192 bytes, SMFG v2 format) | Yes |

**Notes:**
- Segment names do NOT have `__` prefix (Mach-O convention)
- Section names DO have `__` prefix (Mach-O convention)
- `__SMOL_NODE_VER` is defined in the codebase but not currently injected by binject

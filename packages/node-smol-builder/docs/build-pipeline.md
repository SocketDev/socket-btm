# Node.js Build Pipeline

Visual guide to the node-smol-builder build process.

## Complete Build Pipeline

```mermaid
flowchart TD
    A[Start] --> B[Download Node.js Source]
    B --> C[Apply 6 Socket Patches]
    C --> D[Configure Build]
    D --> E[Compile Source]
    E --> F[Strip Debug Symbols]
    F --> G[Inject SEA Support]
    G --> H[Inject VFS Support]
    H --> I{Compression Enabled?}
    I -->|Yes| J[Compress with binpress]
    I -->|No| K[Copy to Final]
    J --> K
    K --> L[Build Complete]
```

## Build Phases Detail

### Phase 1: Download

```mermaid
flowchart TD
    A[Start Download] --> B{Source Cached?}
    B -->|Yes| C[Extract from Cache]
    B -->|No| D[Download from nodejs.org]
    D --> E[Verify SHA256]
    E --> F[Extract Tarball]
    F --> G[Save to build/shared/source]
    C --> G
    G --> H[Checkpoint: download]
```

### Phase 2: Patch

```mermaid
flowchart TD
    A[Start Patch] --> B[Copy Source to Mode Dir]
    B --> C[Apply 6 Patches]
    C --> D{All Patches Applied?}
    D -->|Yes| E[Checkpoint: patch]
    D -->|No| F[Build Fails]
```

**Patch Categories:**
- Security hardening
- Dependency removal (npm, corepack, sqlite, inspector)
- SEA Brotli compression support
- VFS integration
- Size optimizations

### Phase 3: Configure

```mermaid
flowchart TD
    A[Start Configure] --> B{Build Mode?}
    B -->|dev| C[Enable JIT, Inspector, Debug]
    B -->|prod| D[Enable Lite Mode, Disable Inspector]
    C --> E[Run ./configure]
    D --> E
    E --> F[Generate config.gypi]
    F --> G[Generate Makefiles]
    G --> H[Checkpoint: configure]
```

**Configure Flags (Common):**
- `--ninja` - Use Ninja build system
- `--with-intl=small-icu` - English-only ICU
- `--without-npm` - Remove npm
- `--without-corepack` - Remove corepack
- `--without-amaro` - Remove TypeScript/amaro
- `--without-node-options` - Disable NODE_OPTIONS

**Configure Flags (Prod Only):**
- `--without-inspector` - Remove debugger
- `--enable-lto` - Link-time optimization (Linux only)

### Phase 4: Compile

```mermaid
flowchart TD
    A[Start Compile] --> B{Parallel Build?}
    B -->|Yes| C[make -j CPU_COUNT]
    B -->|No| D[make]
    C --> E[Link Binary]
    D --> E
    E --> F[Generate out/Release/node]
    F --> G[Smoke Test: ./node --version]
    G --> H{Test Passed?}
    H -->|Yes| I[Checkpoint: compile]
    H -->|No| J[Build Fails]
```

**Compile Time:**
- With cache: ~5 minutes (incremental)
- Without cache: ~30-45 minutes (full build)
- Parallel: Uses all CPU cores

### Phase 5: Strip

```mermaid
flowchart TD
    A[Start Strip] --> B{Platform?}
    B -->|macOS| C[strip -x node]
    B -->|Linux| D[strip --strip-all node]
    B -->|Windows| E[strip node.exe]
    C --> F[Copy to out/Stripped/]
    D --> F
    E --> F
    F --> G[Size Reduction: ~40-50%]
    G --> H[Checkpoint: strip]
```

### Phase 6: Inject SEA

```mermaid
flowchart TD
    A[Start SEA Injection] --> B[Run binject]
    B --> C{Platform?}
    C -->|macOS| D[LIEF: Create NODE_SEA_BLOB]
    C -->|Linux| E[ELF: Append NODE_SEA_BLOB]
    C -->|Windows| F[PE: Create NODE_SEA_BLOB]
    D --> G[Inject 1-byte Placeholder]
    E --> G
    F --> G
    G --> H[Flip Sentinel Byte]
    H --> I{macOS?}
    I -->|Yes| J[Code Sign with ad-hoc]
    I -->|No| K[Checkpoint: inject-sea]
    J --> K
```

**SEA Section:**
- Section name: `NODE_SEA_BLOB`
- Initial size: 1 byte (placeholder)
- Dynamic creation: No placeholder files needed, sections created at injection time
- macOS: Uses LIEF for unlimited size support
- Linux/Windows: Appends new sections dynamically
- Sentinel: Auto-flipped for Node.js compatibility

### Phase 7: Inject VFS

```mermaid
flowchart TD
    A[Start VFS Injection] --> B[Run binject]
    B --> C{Platform?}
    C -->|macOS| D[LIEF: Create NODE_VFS_BLOB]
    C -->|Linux| E[ELF: Append NODE_VFS_BLOB]
    C -->|Windows| F[PE: Create NODE_VFS_BLOB]
    D --> G[Inject 1-byte Placeholder]
    E --> G
    F --> G
    G --> H{macOS?}
    H -->|Yes| I[Code Sign with ad-hoc]
    H -->|No| J[Checkpoint: inject-vfs]
    I --> J
```

**VFS Section:**
- Section name: `NODE_VFS_BLOB`
- Initial size: 1 byte (placeholder)
- Dynamic creation: No placeholder files needed, sections created at injection time
- macOS: Uses LIEF for unlimited size support
- Linux/Windows: Appends new sections dynamically
- No compression: binpress will compress entire binary

### Phase 8: Compress (Optional)

```mermaid
flowchart TD
    A[Start Compress] --> B{Compression Enabled?}
    B -->|No| C[Skip Compression]
    B -->|Yes| D[Run binpress]
    D --> E{Platform?}
    E -->|macOS| F[Compress with LZFSE]
    E -->|Linux| G[Compress with LZMA]
    E -->|Windows| H[Compress with LZMS]
    F --> I[Create Self-Extracting Wrapper]
    G --> I
    H --> I
    I --> J[Embed binflate Stub]
    J --> K[Size Reduction: 50-70%]
    K --> L[Checkpoint: compress]
    C --> M[Checkpoint: compress skipped]
```

**Compression Benefits:**
- ~8-12 MB compressed vs ~23-27 MB uncompressed
- First-run decompression: ~100-200ms
- Cached runs: No decompression overhead
- Cache location: `~/.socket/_dlx/<cache-key>/`

### Phase 9: Finalize

```mermaid
flowchart TD
    A[Start Finalize] --> B{Compressed?}
    B -->|Yes| C[Copy Compressed Binary]
    B -->|No| D[Copy Stripped Binary]
    C --> E[Copy to out/Final/]
    D --> E
    E --> F[Symlink for Distribution]
    F --> G[Checkpoint: finalized]
    G --> H[Build Complete]
```

## Build Modes

### Development Mode

```mermaid
flowchart TD
    A[dev Mode] --> B[V8 JIT Enabled]
    B --> C[Inspector Enabled]
    C --> D[Debug Symbols Kept]
    D --> E[Faster JS Execution]
    E --> F[Larger Binary ~30-40 MB]
```

**Use Cases:**
- Local development
- Debugging
- Performance testing

### Production Mode

```mermaid
flowchart TD
    A[prod Mode] --> B[V8 Lite Mode]
    B --> C[Inspector Disabled]
    C --> D[Debug Symbols Stripped]
    D --> E[Slower JS Execution 5-10x]
    E --> F[Smaller Binary ~8-12 MB]
```

**Use Cases:**
- Distribution
- Embedded devices
- Size-constrained environments

## Binary Tools Integration

```mermaid
flowchart LR
    A[node binary] --> B[binject]
    B --> C[Add SEA/VFS sections]
    C --> D[binpress]
    D --> E[Compress binary]
    E --> F[Embed binflate]
    F --> G[Self-extracting binary]
```

**Tool Responsibilities:**
- `binject`: Resource injection into executables
- `binpress`: Binary compression
- `binflate`: Runtime decompression and execution

## Checkpoint Benefits

```mermaid
flowchart TD
    A[First Build] --> B[45 minutes]
    B --> C[All Checkpoints Saved]
    C --> D[Source Code Change]
    D --> E[Restore to patch]
    E --> F[Incremental Build]
    F --> G[5-10 minutes]
```

**Time Savings:**
- Full build: ~45 minutes
- Incremental (with checkpoints): ~5-10 minutes
- CI cache hit: ~2-3 minutes (just validation)

## Testing Pipeline

```mermaid
flowchart TD
    A[Build Complete] --> B[Run Node.js Test Suite]
    B --> C[Filter Disabled Features]
    C --> D[Run 4000+ Tests in Parallel]
    D --> E{All Tests Passed?}
    E -->|Yes| F[Build Verified]
    E -->|No| G[Fix Issues]
    G --> A
```

## Platform-Specific Notes

### macOS

- Uses LIEF for dynamic section creation with unlimited size support
- Requires code signing after injection
- LZFSE compression (Apple Compression Framework)
- Universal binaries possible (arm64 + x64)

### Linux

- Appends new ELF sections dynamically (no placeholders needed)
- LZMA compression (liblzma)
- Static linking for portability
- Separate glibc and musl builds

### Windows

- Creates new PE sections dynamically (no placeholders needed)
- LZMS compression (Windows Compression API)
- Requires MinGW or Visual Studio
- Cabinet.dll for compression

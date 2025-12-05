# Checkpoint Lifecycle

Visual guide to the checkpoint system used across all builder packages.

## Checkpoint Creation Flow

```mermaid
flowchart TD
    A[Start Build Phase] --> B{Artifacts Changed?}
    B -->|No| C[Skip Checkpoint]
    B -->|Yes| D[Run Smoke Tests]
    D -->|Failed| E[Build Fails]
    D -->|Passed| F[Create Tarball]
    F --> G[Write JSON Metadata]
    G --> H{CI Environment?}
    H -->|Yes| I[Delete Previous Tarballs]
    H -->|No| J[Keep All Tarballs]
    I --> K[Checkpoint Complete]
    J --> K
    K --> L[Continue to Next Phase]
```

## Checkpoint Restoration Flow

```mermaid
flowchart TD
    A[Start Restore] --> B[Load Checkpoint Array]
    B --> C[Walk Backwards from Newest]
    C --> D{Tarball Exists?}
    D -->|No| E[Try Previous Checkpoint]
    D -->|Yes| F{Valid JSON Metadata?}
    F -->|No| E
    F -->|Yes| G[Extract Tarball]
    G --> H{Artifacts Valid?}
    H -->|No| E
    H -->|Yes| I[Restore Complete]
    E --> J{More Checkpoints?}
    J -->|Yes| C
    J -->|No| K[No Valid Checkpoint]
```

## Checkpoint Structure

Each checkpoint consists of:

### 1. Tarball Archive
- **Location**: `build/<mode>/checkpoints/<name>.tar.gz`
- **Contents**: All artifacts from the build phase
- **Compression**: gzip
- **Cleanup**: In CI, previous tarballs deleted after new checkpoint validated

### 2. JSON Metadata
- **Location**: `build/<mode>/checkpoints/<name>.json`
- **Contents**:
  ```json
  {
    "name": "phase-name",
    "timestamp": "2025-12-09T12:34:56.789Z",
    "artifacts": ["file1", "file2"],
    "artifactPath": "build/prod/checkpoints/phase-name.tar.gz",
    "metadata": {
      "version": "1.0.0",
      "os": "darwin",
      "arch": "arm64"
    }
  }
  ```

## Progressive Cleanup (CI Only)

To conserve disk space in CI environments:

```mermaid
flowchart LR
    A[Phase 1 Complete] --> B[Create Tarball 1]
    B --> C[Phase 2 Complete]
    C --> D[Create Tarball 2]
    D --> E[Delete Tarball 1]
    E --> F[Phase 3 Complete]
    F --> G[Create Tarball 3]
    G --> H[Delete Tarball 2]
```

**Benefits:**
- Only 1 checkpoint tarball exists at a time
- Backward restoration still works (finds latest valid checkpoint)
- Saves gigabytes of disk space for large builds (ML models, Node.js)

**Local Development:**
- All checkpoint tarballs kept for debugging
- No automatic cleanup

## Cache Key Generation

Checkpoints are cached in GitHub Actions using content-addressable keys:

```mermaid
flowchart TD
    A[Start] --> B[Load CACHE_VERSION]
    B --> C[Load Tool Versions]
    C --> D[Hash Build Scripts]
    D --> E[Hash Source Files]
    E --> F[Combine Hashes]
    F --> G[Generate Cache Key]
    G --> H[Format: checkpoint-v1-OS-mode-hash]
```

**Key Components:**
- `CACHE_VERSION` - Manual cache invalidation
- Tool versions (Python, Node.js, compilers)
- Build script hashes (cumulative)
- OS and build mode

## Smoke Testing

Each checkpoint includes smoke tests to validate artifacts:

```mermaid
flowchart TD
    A[Artifacts Created] --> B{Has Smoke Tests?}
    B -->|Yes| C[Run Tests]
    B -->|No| D[Skip Validation]
    C --> E{Tests Passed?}
    E -->|Yes| F[Create Checkpoint]
    E -->|No| G[Build Fails]
    D --> F
```

**Common Smoke Tests:**
- Binary exists and is executable
- Binary runs with `--version`
- File size within expected range
- Model files have valid ONNX format

## Directory Structure

```
packages/<package>/
├── build/
│   ├── shared/              # Shared across dev/prod
│   │   ├── source/          # Downloaded/extracted sources
│   │   └── checkpoints/     # Shared checkpoint JSON files
│   ├── dev/
│   │   ├── source/          # Dev-specific source artifacts
│   │   ├── out/             # Dev build output
│   │   │   ├── Release/
│   │   │   ├── Stripped/
│   │   │   ├── Compressed/
│   │   │   └── Final/
│   │   └── checkpoints/     # Dev checkpoint tarballs + JSON
│   └── prod/
│       ├── source/          # Prod-specific source artifacts
│       ├── out/             # Prod build output
│       └── checkpoints/     # Prod checkpoint tarballs + JSON
```

## Example: Node.js Build Checkpoints

```mermaid
flowchart LR
    A[download] --> B[patch]
    B --> C[configure]
    C --> D[compile]
    D --> E[strip]
    E --> F[inject-sea]
    F --> G[inject-vfs]
    G --> H[compress]
    H --> I[finalized]
```

Each arrow represents a checkpoint that can be restored.

## Example: ML Model Checkpoints

```mermaid
flowchart TD
    A[downloaded] --> B1[converted-minilm]
    A --> B2[converted-codet5]
    B1 --> C1[quantized-minilm]
    B2 --> C2[quantized-codet5]
    C1 --> D[finalized]
    C2 --> D
```

Both model-specific and unified checkpoints are created.

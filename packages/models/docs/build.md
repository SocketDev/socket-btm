# models Build System

This document describes the build directory structure and progressive build pipeline for the models package.

## Quick Reference

```bash
pnpm run build           # Build all models (INT8, default)
pnpm run build --prod    # Production build (INT4 quantization)
pnpm run build --dev     # Development build (INT8 quantization)
pnpm run build --minilm  # Build MiniLM model only
pnpm run build --codet5  # Build CodeT5 model only
pnpm run build --force   # Force full rebuild
pnpm run clean           # Clean all build artifacts
```

## Directory Structure

```
packages/models/build/
├── shared/
│   └── checkpoints/               # Shared checkpoints
│
├── dev/                           # INT8 quantization (larger, faster build)
│   ├── checkpoints/               # Dev checkpoints
│   │   ├── downloaded-minilm.tar.gz
│   │   ├── downloaded-codet5.tar.gz
│   │   ├── converted-minilm.tar.gz
│   │   ├── converted-codet5.tar.gz
│   │   ├── quantized-minilm.tar.gz
│   │   ├── quantized-codet5.tar.gz
│   │   └── finalized.tar.gz
│   │
│   └── out/
│       ├── Release/               # Downloaded/converted models
│       └── Final/                 # Quantized models
│           ├── minilm/
│           │   └── model.onnx     # INT8 quantized MiniLM
│           └── codet5/
│               └── model.onnx     # INT8 quantized CodeT5
│
└── prod/                          # INT4 quantization (smaller, slower build)
    └── out/
        └── Final/
            ├── minilm/
            │   └── model.onnx     # INT4 quantized MiniLM
            └── codet5/
                └── model.onnx     # INT4 quantized CodeT5

# Downloaded models (shared location):
packages/build-infra/build/downloaded/models/
├── minilm/                        # Raw MiniLM from Hugging Face
└── codet5/                        # Raw CodeT5 from Hugging Face
```

## Build Stages

The build pipeline processes AI models through these stages:

| Stage | Checkpoint | Description |
|-------|------------|-------------|
| **downloaded** | `downloaded-{model}.tar.gz` | Download from Hugging Face |
| **converted** | `converted-{model}.tar.gz` | Convert to ONNX format |
| **quantized** | `quantized-{model}.tar.gz` | Apply INT4/INT8 quantization |
| **finalized** | `finalized.tar.gz` | Production-ready models |

## Quantization Levels

| Level | Flag | Size Reduction | Quality | Use Case |
|-------|------|----------------|---------|----------|
| **INT8** | `--dev` | ~50% | Better | Development, testing |
| **INT4** | `--prod` | ~75% | Good | Production, distribution |

## Build Dependencies

- **Python 3.8+** - Required for ONNX tools
- **onnx** - ONNX model format
- **onnxruntime** - ONNX inference
- **optimum** - Hugging Face optimization tools

Dependencies are auto-installed via pip.

## Models

### MiniLM-L6
Sentence embedding model for semantic similarity.
- Source: `sentence-transformers/all-MiniLM-L6-v2`
- Use: Text similarity, search

### CodeT5
Code understanding model for programming tasks.
- Source: `Salesforce/codet5-small`
- Use: Code analysis, completion

## Key Paths

| Path | Description |
|------|-------------|
| `build/dev/out/Final/minilm/model.onnx` | Dev MiniLM (INT8) |
| `build/dev/out/Final/codet5/model.onnx` | Dev CodeT5 (INT8) |
| `build/prod/out/Final/` | Prod models (INT4) |
| `../build-infra/build/downloaded/models/` | Raw downloaded models |

## Selective Building

Build specific models to save time:

```bash
pnpm run build --minilm  # Only MiniLM
pnpm run build --codet5  # Only CodeT5
pnpm run build --all     # Both models (default)
```

## Build Time

| Model | Download | Convert | Quantize | Total |
|-------|----------|---------|----------|-------|
| MiniLM | 1-2 min | 1 min | 2-5 min | ~5 min |
| CodeT5 | 2-3 min | 2 min | 5-10 min | ~10 min |

## Cleaning

```bash
pnpm run clean           # Clean checkpoints and outputs
```

Note: Downloaded models in `build-infra/build/downloaded/` are preserved to avoid re-downloading.

## Troubleshooting

### Python dependencies fail
```bash
pip install onnx onnxruntime optimum
```

### Download fails
Check network connectivity. Models are downloaded from Hugging Face Hub.

### Quantization fails
Ensure sufficient RAM (4GB+). Try INT8 (`--dev`) if INT4 fails.

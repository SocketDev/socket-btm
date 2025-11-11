# Unified WASM Bundle

Single WASM file with all AI models and execution engines.

## Contents

- ONNX Runtime (~2-5MB) - ML execution engine
- MiniLM model (~17MB int8) - Semantic understanding
- CodeT5 models (~90MB int4) - Code generation
- Tokenizers (~1MB) - Text tokenization
- Yoga Layout (~95KB) - Flexbox layout

Total: ~115MB

## Building

```bash
# Check prerequisites
node scripts/wasm/check-rust-toolchain.mjs

# Build unified WASM
node scripts/wasm/build-unified-wasm.mjs
```

## Output

- `external/socket-ai.wasm` - Unified WASM bundle
- `external/socket-ai-sync.mjs` - Synchronous loader

## Usage

```javascript
import { loadWasmSync } from './external/socket-ai-sync.mjs'

const wasm = loadWasmSync()
```

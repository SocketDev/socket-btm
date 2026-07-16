# minilm-builder

Downloads [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), converts it to ONNX, and quantizes it for embedded text-embedding inside Socket CLI. MiniLM generates 384-dimension sentence embeddings — small, fast, and good enough for the similarity and classification work we do against user code and package metadata.

Output is consumed by the `models` package.

## Build

```bash
pnpm --filter minilm-builder run build        # dev build (INT8 quantization)
pnpm --filter minilm-builder run build --int4 # prod build (INT4, smaller)
```

First run downloads ~90MB from HuggingFace and converts to ONNX; subsequent runs hit the checkpoint cache (~20s full build locally).

Prereqs: Python 3.11+ and the pinned `transformers`/`torch`/`onnx`/`onnxruntime` pip packages. The preflight auto-creates a venv at `~/.socket-btm-venv` and installs the pinned versions from `external-tools.json` — no manual `pip install` needed.

Output: `build/<mode>/<platform-arch>/<int4|int8>/models/minilm.onnx` + tokenizer files.

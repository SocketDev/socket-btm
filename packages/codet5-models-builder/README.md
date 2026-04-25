# codet5-models-builder

Downloads the [CodeT5](https://huggingface.co/Salesforce/codet5-base) model from HuggingFace, converts it to ONNX format, and quantizes it so it can run efficiently via ONNX Runtime inside a Node.js process. CodeT5 produces code-aware embeddings used by Socket for similarity search and classification tasks.

The output gets consumed by the `models` package, which bundles this alongside MiniLM.

## Build

```bash
pnpm --filter codet5-models-builder run build        # dev build (INT8 quantization)
pnpm --filter codet5-models-builder run build --int4 # prod build (INT4, smaller)
```

First run downloads ~900MB from HuggingFace and converts to ONNX; subsequent runs hit the checkpoint cache.

Prereqs: Python 3.11+ and the pinned `transformers`/`torch`/`onnx` pip packages. The preflight auto-creates a venv at `~/.socket-btm-venv` and installs the pinned versions from `external-tools.json` — no manual `pip install` needed.

Output: `build/<mode>/<platform-arch>/<int4|int8>/output/` containing `encoder.onnx`, `decoder.onnx`, and `tokenizer.json` (CodeT5 is a seq2seq model, so the encoder and decoder ship as separate ONNX graphs).

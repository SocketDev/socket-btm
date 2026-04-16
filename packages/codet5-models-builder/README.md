# codet5-models-builder

Downloads the [CodeT5](https://huggingface.co/Salesforce/codet5-base) model from HuggingFace, converts it to ONNX format, and quantizes it so it can run efficiently via ONNX Runtime inside a Node.js process. CodeT5 produces code-aware embeddings used by Socket for similarity search and classification tasks.

The output gets consumed by the `models` package, which bundles this alongside MiniLM. Run `pnpm run build` — the first run downloads and converts; subsequent runs hit the checkpoint cache.

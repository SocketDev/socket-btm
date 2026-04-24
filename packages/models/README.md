# models

Aggregates the ML models produced by `codet5-models-builder` and `minilm-builder` into a single consumable package, so downstream tools only need one workspace dep to pull in both the CodeT5 code embedder and the MiniLM sentence embedder.

The model definitions live in `package.json` under the `moduleSources` field (not `sources` — these are HuggingFace models, not git upstreams).

## Build

```bash
pnpm --filter models run build          # build both (minilm + codet5)
pnpm --filter models run build:minilm   # minilm only
pnpm --filter models run build:codet5   # codet5 only
```

`models` delegates to the individual builder packages; their prereqs apply (Python venv with the pinned pip packages — see their READMEs).

Output: `build/<mode>/<platform-arch>/out/Final/` containing `minilm.onnx` + `codet5.onnx` + tokenizers.

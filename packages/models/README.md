# models

Aggregates the ML models produced by `codet5-models-builder` and `minilm-builder` into a single consumable package, so downstream tools only need one workspace dep to pull in both the CodeT5 code embedder and the MiniLM sentence embedder.

The model definitions live in `package.json` under the `moduleSources` field (not `sources` — these are HuggingFace models, not git upstreams). Build with `pnpm run build`; use `build:minilm` or `build:codet5` to build one at a time.

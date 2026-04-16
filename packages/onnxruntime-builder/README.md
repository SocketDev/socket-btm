# onnxruntime-builder

Builds a custom WebAssembly build of [ONNX Runtime](https://onnxruntime.ai/) tailored for Socket CLI's embedded inference needs. We compile only the operators our models require, which keeps the WASM binary small and the startup cost low compared to the stock `onnxruntime-node` distribution.

Produces `ort.wasm` and the JS glue that loads it synchronously. Consumed by code that runs the `models` package's CodeT5 and MiniLM models without any external dependency at runtime.

/**
 * Required-files manifest for a MiniLM models install.
 *
 * MiniLM produces a quantized ONNX embedding model + tokenizer/config
 * under modelsDir. The model itself is named after the build's
 * outputName parameter (canonical: 'minilm').
 */
export const MINILM_REQUIRED_FILES = [
  'minilm.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
]

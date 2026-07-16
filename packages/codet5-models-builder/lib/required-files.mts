/**
 * Required-files manifest for a CodeT5 models install.
 *
 * CodeT5's prebuilt artifact contains the quantized ONNX models +
 * tokenizer/config files used by socket-cli's code-aware features.
 * All four files are required to load the model.
 */
export const CODET5_REQUIRED_FILES = [
  'encoder.onnx',
  'decoder.onnx',
  'tokenizer.json',
  'config.json',
]

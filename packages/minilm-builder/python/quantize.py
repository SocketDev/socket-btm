#!/usr/bin/env python3
"""Apply INT8 quantization to ONNX models."""
import sys
import json
from pathlib import Path

try:
    from onnxruntime.quantization import quantize_dynamic, QuantType
    from onnx import TensorProto
except ImportError:
    print(json.dumps({"error": "onnxruntime not installed"}))
    sys.exit(1)

model_dir = sys.argv[1]
output_dir = sys.argv[2]

try:
    print(json.dumps({"status": "loading_model"}))
    model_path = Path(model_dir) / 'model.onnx'

    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    quantized_model_path = output_path / 'model_quantized.onnx'

    print(json.dumps({"status": "quantizing"}))
    # Use onnxruntime's quantize_dynamic with extra_options for optimized models
    quantize_dynamic(
        model_input=str(model_path),
        model_output=str(quantized_model_path),
        weight_type=QuantType.QUInt8,
        per_channel=True,
        reduce_range=False,
        extra_options={
            'DefaultTensorType': TensorProto.FLOAT
        }
    )

    # Copy tokenizer and config files from input to output
    for file in ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'config.json']:
        src = Path(model_dir) / file
        if src.exists():
            dst = output_path / file
            dst.write_bytes(src.read_bytes())

    print(json.dumps({"status": "complete", "output_dir": str(output_path)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

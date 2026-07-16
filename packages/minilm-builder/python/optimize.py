#!/usr/bin/env python3
"""Optimize ONNX graphs for inference."""
import sys
import json
from pathlib import Path

try:
    from onnxruntime.transformers.optimizer import optimize_model
    from onnxruntime.transformers.fusion_options import FusionOptions
except ImportError:
    print(json.dumps({"error": "onnxruntime not installed"}))
    sys.exit(1)

model_path = sys.argv[1]
output_path = sys.argv[2]
num_heads = int(sys.argv[3])
hidden_size = int(sys.argv[4])

try:
    print(json.dumps({"status": "loading_model"}))

    print(json.dumps({"status": "optimizing"}))
    # Create FusionOptions with desired optimizations
    fusion_options = FusionOptions('bert')
    fusion_options.enable_gelu_approximation = True
    fusion_options.enable_skip_layer_norm = True

    optimized_model = optimize_model(
        input=model_path,
        model_type='bert',
        num_heads=num_heads,
        hidden_size=hidden_size,
        optimization_options=fusion_options
    )

    print(json.dumps({"status": "saving"}))
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    optimized_model.save_model_to_file(output_path)

    # Copy config and tokenizer files to optimized directory
    model_input_dir = Path(model_path).parent
    output_dir = Path(output_path).parent
    for file in ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt']:
        src = model_input_dir / file
        if src.exists():
            dst = output_dir / file
            dst.write_bytes(src.read_bytes())

    print(json.dumps({"status": "complete", "output_path": output_path}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

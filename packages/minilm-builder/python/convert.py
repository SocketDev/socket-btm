#!/usr/bin/env python3
"""Convert PyTorch models to ONNX format."""
import sys
import json
from pathlib import Path

try:
    from optimum.exporters.onnx import main_export
    from transformers import AutoTokenizer
except ImportError:
    print(json.dumps({"error": "optimum[exporters] not installed"}))
    sys.exit(1)

cache_dir = sys.argv[1]
output_dir = sys.argv[2]

try:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(json.dumps({"status": "exporting_to_onnx"}))
    # Export with opset 18 for compatibility with PyTorch 2.5+ and scaled_dot_product_attention
    main_export(
        model_name_or_path=cache_dir,
        output=output_path,
        task="feature-extraction",
        opset=18,
        device="cpu"
    )

    print(json.dumps({"status": "complete", "output_dir": str(output_path)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

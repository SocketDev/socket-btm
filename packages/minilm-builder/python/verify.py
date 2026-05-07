#!/usr/bin/env python3
"""Verify ONNX model inference."""
import sys
import json
import numpy as np

try:
    import onnxruntime
    from transformers import AutoTokenizer
except ImportError:
    print(json.dumps({"error": "onnxruntime or transformers not installed"}))
    sys.exit(1)

model_path = sys.argv[1]
tokenizer_path = sys.argv[2]
test_text = sys.argv[3] if len(sys.argv) > 3 else "This is a test"

try:
    print(json.dumps({"status": "loading_session"}))
    session = onnxruntime.InferenceSession(model_path)

    print(json.dumps({"status": "loading_tokenizer"}))
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)

    print(json.dumps({"status": "tokenizing"}))
    inputs = tokenizer(test_text, return_tensors="np", padding=True, truncation=True)

    print(json.dumps({"status": "running_inference"}))
    onnx_inputs = {k: v for k, v in inputs.items()}
    outputs = session.run(None, onnx_inputs)

    output_shape = outputs[0].shape
    output_mean = float(np.mean(outputs[0]))
    output_std = float(np.std(outputs[0]))

    print(json.dumps({
        "status": "complete",
        "test_text": test_text,
        "output_shape": list(output_shape),
        "output_mean": output_mean,
        "output_std": output_std
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

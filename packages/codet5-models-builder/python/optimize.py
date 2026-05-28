#!/usr/bin/env python3
"""
ONNX graph optimization for CodeT5 encoder/decoder.

Replaces inline `python -c '…'` that interpolated file paths into a
Python string literal. Same injection shape as the download path.

Inputs (sys.argv):
  argv[1]: input_path    — input ONNX model
  argv[2]: output_path   — optimized ONNX model
  argv[3]: num_heads     — int, attention head count (default 12)
  argv[4]: hidden_size   — int, hidden dimension (default 768)
"""

import sys

from onnxruntime.transformers import optimizer


def main():
    if len(sys.argv) < 3:
        print(
            "usage: optimize.py <input_path> <output_path> [num_heads] [hidden_size]",
            file=sys.stderr,
        )
        return 2

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    num_heads = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    hidden_size = int(sys.argv[4]) if len(sys.argv) > 4 else 768

    opt = optimizer.optimize_model(
        input_path,
        model_type="bert",
        num_heads=num_heads,
        hidden_size=hidden_size,
    )
    opt.save_model_to_file(output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())

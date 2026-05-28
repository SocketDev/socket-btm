#!/usr/bin/env python3
"""
INT8 dynamic quantization for CodeT5 ONNX models.

Replaces inline `python -c '…'` that interpolated input/output paths into
a Python string literal — same injection shape as download and optimize.

Inputs (sys.argv):
  argv[1]: input_path    — input ONNX model
  argv[2]: output_path   — output quantized ONNX model
"""

import sys

from onnxruntime.quantization import QuantType, quantize_dynamic


def main():
    if len(sys.argv) < 3:
        print("usage: quantize.py <input_path> <output_path>", file=sys.stderr)
        return 2

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    quantize_dynamic(input_path, output_path, weight_type=QuantType.QInt8)
    return 0


if __name__ == "__main__":
    sys.exit(main())

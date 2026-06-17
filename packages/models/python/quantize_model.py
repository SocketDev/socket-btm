#!/usr/bin/env python3
"""
ONNX model quantization (INT8 dynamic / INT4 MatMul-NBits).

Used by scripts/quantized/shared/quantize-model.mts.

Inputs (sys.argv):
  argv[1]: mode         — "int8" or "int4"
  argv[2]: onnx_path    — input ONNX model
  argv[3]: quant_path   — output quantized model

argv-only (not python -c) to avoid the interpolation injection shape on
file paths.
"""

import sys


def quantize_int8(onnx_path: str, quant_path: str) -> int:
    # Dynamic quantization (simpler, more compatible than static).
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(onnx_path, quant_path, weight_type=QuantType.QUInt8)
    return 0


def quantize_int4(onnx_path: str, quant_path: str) -> int:
    # MatMulNBitsQuantizer = maximum compression. onnxruntime 1.23.2+
    # defaults bits=4; explicit kwarg removed from __init__.
    from onnxruntime.quantization.matmul_nbits_quantizer import (
        MatMulNBitsQuantizer,
    )

    quant = MatMulNBitsQuantizer(onnx_path)
    quant.process()
    quant.model.save_model_to_file(quant_path, True)
    return 0


def main():
    if len(sys.argv) < 4:
        print("usage: quantize_model.py <int8|int4> <onnx_path> <quant_path>", file=sys.stderr)
        return 2

    mode = sys.argv[1].lower()
    onnx_path = sys.argv[2]
    quant_path = sys.argv[3]

    if mode == "int8":
        return quantize_int8(onnx_path, quant_path)
    if mode == "int4":
        return quantize_int4(onnx_path, quant_path)
    print(f"unknown quantization mode: {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Download CodeT5 tokenizer + model from HuggingFace.

Replaces an inline `python -c '…'` invocation that interpolated MODEL_NAME
and MODELS_DIR into a single-quoted Python literal. A model id with a
quote or backslash escape would otherwise execute arbitrary Python in the
build runner.

Inputs (sys.argv):
  argv[1]: model_name   — HuggingFace repo id (e.g. "Salesforce/codet5-small")
  argv[2]: output_dir   — local destination directory
"""

import sys

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


def main():
    if len(sys.argv) < 3:
        print("usage: download.py <model_name> <output_dir>", file=sys.stderr)
        return 2

    model_name = sys.argv[1]
    output_dir = sys.argv[2]

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    tokenizer.save_pretrained(output_dir)
    model.save_pretrained(output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())

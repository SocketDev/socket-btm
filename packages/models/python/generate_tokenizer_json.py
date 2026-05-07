#!/usr/bin/env python3
"""
Generate tokenizer.json from a model directory's tokenizer files.

Used by scripts/build.mts copyToDist() when the source model dir doesn't
already ship a tokenizer.json (older HuggingFace exports).

Inputs (sys.argv):
  argv[1]: model_dir   — input directory containing tokenizer files
  argv[2]: output_dir  — output directory to write tokenizer.json into

argv-only (not python -c) to avoid the interpolation injection shape on
model paths.
"""

import sys

from transformers import AutoTokenizer


def main():
    if len(sys.argv) < 3:
        print("usage: generate_tokenizer_json.py <model_dir> <output_dir>", file=sys.stderr)
        return 2

    model_dir = sys.argv[1]
    output_dir = sys.argv[2]

    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    tokenizer.save_pretrained(output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())

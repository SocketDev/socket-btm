#!/usr/bin/env python3
"""
Fallback HuggingFace download path used by scripts/downloaded/shared/download-model.mts
when the `hf` CLI is unavailable.

Inputs (sys.argv):
  argv[1]: source         — HuggingFace repo id (e.g. "sentence-transformers/all-MiniLM-L6-v2")
  argv[2]: output_dir     — local destination directory (will be created)
  argv[3]: revision       — optional, branch/tag/SHA (empty string means "no revision")

Reads identifiers as argv to avoid the python -c '…interpolation…' injection
shape: a HuggingFace identifier or revision containing a quote would otherwise
break out of the literal and execute arbitrary Python in the build runner.
"""

import sys

from transformers import AutoModel, AutoTokenizer


def main():
    if len(sys.argv) < 3:
        print("usage: download_hf_model.py <source> <output_dir> [revision]", file=sys.stderr)
        return 2

    source = sys.argv[1]
    output_dir = sys.argv[2]
    revision = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None

    kwargs = {"revision": revision} if revision else {}

    tokenizer = AutoTokenizer.from_pretrained(source, **kwargs)
    model = AutoModel.from_pretrained(source, **kwargs)
    tokenizer.save_pretrained(output_dir)
    model.save_pretrained(output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())

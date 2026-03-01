#!/usr/bin/env python3
"""Download MiniLM models from Hugging Face."""
import sys
import json
from pathlib import Path

try:
    from transformers import AutoModel, AutoTokenizer
except ImportError:
    print(json.dumps({"error": "transformers not installed"}))
    sys.exit(1)

model_name = sys.argv[1]
cache_dir = sys.argv[2]

try:
    print(json.dumps({"status": "downloading_model"}))
    model = AutoModel.from_pretrained(model_name)

    print(json.dumps({"status": "downloading_tokenizer"}))
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    cache_path = Path(cache_dir)
    cache_path.mkdir(parents=True, exist_ok=True)

    print(json.dumps({"status": "saving_model"}))
    model.save_pretrained(cache_path)

    print(json.dumps({"status": "saving_tokenizer"}))
    tokenizer.save_pretrained(cache_path)

    print(json.dumps({"status": "complete", "cache_dir": str(cache_path)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

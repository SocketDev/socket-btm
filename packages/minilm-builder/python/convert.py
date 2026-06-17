#!/usr/bin/env python3
"""Convert PyTorch models to ONNX format using native transformers export."""
import sys
import json
import os
import io
import logging
from pathlib import Path
from contextlib import contextmanager

# Suppress all logging output (we only want JSON on stdout)
logging.disable(logging.CRITICAL)
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TORCH_LOGS"] = "-all"

import warnings
warnings.filterwarnings("ignore")


@contextmanager
def redirect_stdout_to_stderr():
    """Redirect stdout to stderr temporarily.

    PyTorch 2.x torch.onnx export prints verbose messages like
    '[torch.onnx] Obtain model graph...' directly to stdout using print().
    This interferes with our JSON protocol. Redirect stdout to stderr
    during export so only our JSON messages go to stdout.
    """
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = old_stdout


def emit(data):
    """Emit JSON to the original stdout."""
    # Use the real stdout (fd 1) directly to ensure JSON goes to stdout
    os.write(1, (json.dumps(data) + "\n").encode("utf-8"))


try:
    import torch
    # Suppress torch's internal logging
    torch_logger = logging.getLogger("torch")
    torch_logger.setLevel(logging.CRITICAL)
    torch_logger.disabled = True

    # Suppress torch.onnx logging
    onnx_logger = logging.getLogger("torch.onnx")
    onnx_logger.setLevel(logging.CRITICAL)
    onnx_logger.disabled = True

    from transformers import AutoModel, AutoTokenizer, AutoConfig
    from transformers.onnx import export, FeaturesManager

    # Suppress transformers logging
    from transformers import logging as transformers_logging
    transformers_logging.set_verbosity_error()
except ImportError as e:
    emit({"error": f"transformers not installed: {e}"})
    sys.exit(1)

cache_dir = sys.argv[1]
output_dir = sys.argv[2]

try:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    emit({"status": "loading_model"})

    # Load the model and tokenizer from cache (may print verbose output)
    with redirect_stdout_to_stderr():
        model = AutoModel.from_pretrained(cache_dir)
        tokenizer = AutoTokenizer.from_pretrained(cache_dir)
        config = AutoConfig.from_pretrained(cache_dir)

    emit({"status": "exporting_to_onnx"})

    # Get the ONNX config for feature-extraction task
    model_kind, model_onnx_config = FeaturesManager.check_supported_model_or_raise(
        model, feature="default"
    )
    onnx_config = model_onnx_config(config)

    # Export the model (this prints verbose [torch.onnx] messages)
    onnx_output_path = output_path / "model.onnx"
    with redirect_stdout_to_stderr():
        export(
            preprocessor=tokenizer,
            model=model,
            config=onnx_config,
            opset=18,
            output=onnx_output_path,
        )

    # Copy tokenizer files to output directory
    tokenizer.save_pretrained(output_path)
    config.save_pretrained(output_path)

    emit({"status": "complete", "output_dir": str(output_path)})
except Exception as e:
    emit({"error": str(e)})
    sys.exit(1)

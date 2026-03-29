#!/usr/bin/env python3
"""Convert CodeT5 (seq2seq-lm) models to ONNX format using torch.onnx.export.

This script handles encoder-decoder models like T5/CodeT5 by exporting:
- encoder_model.onnx: The encoder component
- decoder_model.onnx: The decoder component with cross-attention

Uses stdout redirection to prevent PyTorch/transformers logging from interfering
with the JSON protocol used for communication with the Node.js build script.
"""
import sys
import json
import os
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

    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, AutoConfig

    # Suppress transformers logging
    from transformers import logging as transformers_logging
    transformers_logging.set_verbosity_error()
except ImportError as e:
    emit({"error": f"Required packages not installed: {e}"})
    sys.exit(1)


def export_encoder(model, tokenizer, output_path, opset_version):
    """Export the encoder component to ONNX."""
    encoder = model.get_encoder()

    # Create dummy inputs for encoder
    dummy_text = "def hello():"
    inputs = tokenizer(dummy_text, return_tensors="pt", padding=True)
    input_ids = inputs["input_ids"]
    attention_mask = inputs["attention_mask"]

    encoder_output_path = output_path / "encoder_model.onnx"

    with redirect_stdout_to_stderr():
        torch.onnx.export(
            encoder,
            (input_ids, attention_mask),
            str(encoder_output_path),
            input_names=["input_ids", "attention_mask"],
            output_names=["last_hidden_state"],
            dynamic_axes={
                "input_ids": {0: "batch_size", 1: "sequence_length"},
                "attention_mask": {0: "batch_size", 1: "sequence_length"},
                "last_hidden_state": {0: "batch_size", 1: "sequence_length"},
            },
            opset_version=opset_version,
            do_constant_folding=True,
        )

    return encoder_output_path


def export_decoder(model, tokenizer, output_path, opset_version):
    """Export the decoder component to ONNX with cross-attention.

    The decoder needs encoder hidden states as input for cross-attention.
    """
    # Get encoder to generate hidden states for decoder export
    encoder = model.get_encoder()

    # Create dummy inputs
    dummy_text = "def hello():"
    inputs = tokenizer(dummy_text, return_tensors="pt", padding=True)
    input_ids = inputs["input_ids"]
    attention_mask = inputs["attention_mask"]

    # Get encoder outputs
    with torch.no_grad():
        encoder_outputs = encoder(input_ids, attention_mask=attention_mask)
        encoder_hidden_states = encoder_outputs.last_hidden_state

    # Prepare decoder inputs
    decoder_input_ids = torch.tensor([[model.config.decoder_start_token_id]])
    decoder_attention_mask = torch.ones_like(decoder_input_ids)

    # Create a wrapper class for decoder export
    class DecoderWrapper(torch.nn.Module):
        def __init__(self, decoder, lm_head):
            super().__init__()
            self.decoder = decoder
            self.lm_head = lm_head

        def forward(self, decoder_input_ids, decoder_attention_mask, encoder_hidden_states, encoder_attention_mask):
            decoder_outputs = self.decoder(
                input_ids=decoder_input_ids,
                attention_mask=decoder_attention_mask,
                encoder_hidden_states=encoder_hidden_states,
                encoder_attention_mask=encoder_attention_mask,
            )
            logits = self.lm_head(decoder_outputs.last_hidden_state)
            return logits

    decoder_wrapper = DecoderWrapper(model.decoder, model.lm_head)
    decoder_wrapper.eval()

    decoder_output_path = output_path / "decoder_model.onnx"

    with redirect_stdout_to_stderr():
        torch.onnx.export(
            decoder_wrapper,
            (decoder_input_ids, decoder_attention_mask, encoder_hidden_states, attention_mask),
            str(decoder_output_path),
            input_names=["input_ids", "attention_mask", "encoder_hidden_states", "encoder_attention_mask"],
            output_names=["logits"],
            dynamic_axes={
                "input_ids": {0: "batch_size", 1: "decoder_sequence_length"},
                "attention_mask": {0: "batch_size", 1: "decoder_sequence_length"},
                "encoder_hidden_states": {0: "batch_size", 1: "encoder_sequence_length"},
                "encoder_attention_mask": {0: "batch_size", 1: "encoder_sequence_length"},
                "logits": {0: "batch_size", 1: "decoder_sequence_length"},
            },
            opset_version=opset_version,
            do_constant_folding=True,
        )

    return decoder_output_path


if len(sys.argv) < 3:
    emit({"error": "Usage: convert.py <cache_dir> <output_dir> [opset_version]"})
    sys.exit(1)

cache_dir = sys.argv[1]
output_dir = sys.argv[2]
opset_version = int(sys.argv[3]) if len(sys.argv) > 3 else 14

try:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    emit({"status": "loading_model"})

    # Load the model and tokenizer from cache (may print verbose output)
    with redirect_stdout_to_stderr():
        model = AutoModelForSeq2SeqLM.from_pretrained(cache_dir)
        tokenizer = AutoTokenizer.from_pretrained(cache_dir)
        config = AutoConfig.from_pretrained(cache_dir)

    model.eval()

    emit({"status": "exporting_encoder"})
    encoder_path = export_encoder(model, tokenizer, output_path, opset_version)

    emit({"status": "exporting_decoder"})
    decoder_path = export_decoder(model, tokenizer, output_path, opset_version)

    # Copy tokenizer files to output directory
    emit({"status": "saving_tokenizer"})
    tokenizer.save_pretrained(output_path)
    config.save_pretrained(output_path)

    emit({
        "status": "complete",
        "output_dir": str(output_path),
        "encoder_model": str(encoder_path),
        "decoder_model": str(decoder_path),
    })
except Exception as e:
    import traceback
    emit({"error": str(e), "traceback": traceback.format_exc()})
    sys.exit(1)

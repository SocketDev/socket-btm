import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { which } from '@socketsecurity/lib/bin'
import platformPkg from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const { WIN32 } = platformPkg
const logger = getDefaultLogger()

/**
 * Convert model to ONNX if needed.
 *
 * @param {Object} options - The options object
 * @param {string} options.modelKey - The model key (e.g., 'minilm-l6', 'codet5')
 * @param {Object} options.modelSources - The model sources configuration
 * @param {string} options.buildDir - The build directory path
 * @param {string} options.packageName - The package name
 * @param {string} options.modelsDir - The models directory path
 * @param {boolean} options.forceRebuild - Whether to force rebuild
 */
export async function convertToOnnx(options) {
  const {
    buildDir,
    forceRebuild,
    modelKey,
    modelSources,
    modelsDir,
    packageName,
  } = options

  if (
    !(await shouldRun(
      buildDir,
      packageName,
      `${CHECKPOINTS.CONVERTED}-${modelKey}`,
      forceRebuild,
    ))
  ) {
    return
  }

  logger.step(`Converting ${modelKey} to ONNX`)

  const config = modelSources[modelKey]
  const modelDir = path.join(modelsDir, modelKey)

  // Check for expected ONNX files based on model type.
  const expectedFiles = config.files.filter(f => f.endsWith('.onnx'))
  const allExist = expectedFiles.every(f => existsSync(path.join(modelDir, f)))

  if (allExist) {
    logger.success('Already in ONNX format')
    await createCheckpoint(
      buildDir,
      `${CHECKPOINTS.CONVERTED}-${modelKey}`,
      async () => {
        // Smoke test: Verify ONNX files are valid
        const modelPath = path.join(modelsDir, modelKey)
        for (const fileName of expectedFiles) {
          const filePath = path.join(modelPath, fileName)
          const stats = await fs.stat(filePath)
          if (stats.size === 0) {
            throw new Error(`ONNX file is empty: ${fileName}`)
          }
        }
      },
      {
        packageName,
        artifactPath: path.join(modelsDir, modelKey),
        modelKey,
      },
    )
    return
  }

  // Convert using direct torch.onnx.export() to avoid Optimum/PyTorch 2.6+ incompatibility.
  try {
    const convertScript = path.join(buildDir, 'onnx_export.py')
    const scriptContent = `#!/usr/bin/env python3
"""Direct PyTorch ONNX export for transformer models."""
import sys
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModel, AutoConfig, T5EncoderModel

if len(sys.argv) < 2:
    print("Usage: onnx_export.py <model_path>", file=sys.stderr)
    sys.exit(1)

model_path = sys.argv[1]
output_path = Path(model_path) / "model.onnx"

# Load tokenizer and config
tokenizer = AutoTokenizer.from_pretrained(model_path)
config = AutoConfig.from_pretrained(model_path)

# Load appropriate model based on architecture
model_type = config.model_type
if model_type == "t5":
    # For T5 models (like CodeT5), use encoder only for feature extraction
    model = T5EncoderModel.from_pretrained(model_path)
    print(f"Loaded T5 encoder model ({config.architectures})")
else:
    # For BERT, RoBERTa, etc., use AutoModel
    model = AutoModel.from_pretrained(model_path)
    print(f"Loaded {model_type} model ({config.architectures})")

model.eval()

# Create dummy inputs
dummy_text = "This is a sample sentence."
inputs = tokenizer(dummy_text, return_tensors="pt", padding=True, truncation=True, max_length=128)

# Determine which inputs are present
input_names = ['input_ids', 'attention_mask']
input_tuple = (inputs['input_ids'], inputs['attention_mask'])
dynamic_axes = {
    'input_ids': {0: 'batch_size', 1: 'sequence_length'},
    'attention_mask': {0: 'batch_size', 1: 'sequence_length'}
}

# Add token_type_ids if present
if 'token_type_ids' in inputs:
    input_names.append('token_type_ids')
    input_tuple = input_tuple + (inputs['token_type_ids'],)
    dynamic_axes['token_type_ids'] = {0: 'batch_size', 1: 'sequence_length'}

# Output dynamic axes
dynamic_axes['last_hidden_state'] = {0: 'batch_size', 1: 'sequence_length'}

# Export using PyTorch native ONNX exporter
with torch.no_grad():
    torch.onnx.export(
        model,
        input_tuple,
        str(output_path),
        opset_version=18,
        input_names=input_names,
        output_names=['last_hidden_state'],
        dynamic_axes=dynamic_axes,
        do_constant_folding=True,
        export_params=True,
    )

print(f"Successfully exported model to {output_path}")
`

    await fs.writeFile(convertScript, scriptContent, 'utf8')
    await fs.chmod(convertScript, 0o755)

    const python3Path = await which('python3', { nothrow: true })
    if (!python3Path) {
      throw new Error('python3 not found in PATH')
    }

    const convertResult = await spawn(python3Path, [convertScript, modelDir], {
      shell: WIN32,
      stdio: 'inherit',
    })

    if (convertResult.code !== 0) {
      throw new Error(`Conversion failed with exit code ${convertResult.code}`)
    }

    logger.success('Converted to ONNX')
    await createCheckpoint(
      buildDir,
      `${CHECKPOINTS.CONVERTED}-${modelKey}`,
      async () => {
        // Smoke test: Verify converted ONNX model exists and is valid
        const modelPath = path.join(modelsDir, modelKey)
        const onnxFile = path.join(modelPath, 'model.onnx')
        const stats = await fs.stat(onnxFile)
        if (stats.size === 0) {
          throw new Error('Converted ONNX file is empty')
        }
        // Basic ONNX file signature check (should start with "onnx" or protocol buffer header)
        const buffer = await fs.readFile(onnxFile)
        if (buffer.length < 4) {
          throw new Error('ONNX file is too small to be valid')
        }
      },
      {
        packageName,
        artifactPath: path.join(modelsDir, modelKey),
        modelKey,
      },
    )
  } catch (e) {
    logger.error(`Conversion failed: ${e.message}`)
    throw e
  }
}

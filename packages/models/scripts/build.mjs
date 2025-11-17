#!/usr/bin/env node

/**
 * Build script for @socketsecurity/models.
 *
 * Downloads AI models from Hugging Face, converts to ONNX, and applies quantization.
 *
 * Workflow:
 * 1. Download models from Hugging Face (with fallbacks)
 * 2. Convert to ONNX if needed
 * 3. Apply quantization (INT4 or INT8) for compression
 * 4. Output quantized ONNX models
 *
 * Options:
 * --dev    Development build (INT8 quantization, better compatibility, ~50% size reduction)
 * --prod   Production build (INT4 quantization, maximum compression, ~75% size reduction, default)
 * --int8   Alias for --dev (INT8 quantization)
 * --int4   Alias for --prod (INT4 quantization)
 * --minilm Build MiniLM-L6 model only
 * --codet5 Build CodeT5 model only
 * --all    Build all models
 * --force  Force rebuild even if checkpoints exist
 * --clean  Clean all checkpoints before building
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  cleanCheckpoint,
  createCheckpoint,
  shouldRun,
} from 'build-infra/lib/checkpoint-manager'
import { ensureAllPythonPackages } from 'build-infra/lib/python-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { DIST_ROOT, getBuildPaths } from './paths.mjs'

// Check if running in CI.
const _IS_CI = !!(
  process.env['CI'] ||
  process.env['GITHUB_ACTIONS'] ||
  process.env['GITLAB_CI'] ||
  process.env['CIRCLECI']
)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
const CLEAN_BUILD = args.includes('--clean')
const _NO_SELF_UPDATE = args.includes('--no-self-update')

// Model selection flags.
// Build all models by default unless a specific model is selected.
const hasModelFlag =
  args.includes('--minilm') ||
  args.includes('--codet5') ||
  args.includes('--all')
const BUILD_MINILM =
  !hasModelFlag || args.includes('--all') || args.includes('--minilm')
const BUILD_CODET5 =
  !hasModelFlag || args.includes('--all') || args.includes('--codet5')

// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
// Accept both --dev/--prod and legacy --int8/--int4 flags.
const QUANT_LEVEL =
  args.includes('--int4') || args.includes('--prod') ? 'int4' : 'int8'
// Build mode: prod (int4) vs dev (int8)
const BUILD_MODE = QUANT_LEVEL === 'int4' ? 'prod' : 'dev'

// Get paths from source of truth
const {
  buildDir: BUILD,
  distDir: DIST_MODE,
  modelsDir: MODELS,
} = getBuildPaths(BUILD_MODE)
const DIST = DIST_ROOT
const PACKAGE_NAME = 'models'

const logger = getDefaultLogger()

// Model sources (with fallbacks and versions).
const MODEL_SOURCES = {
  // MiniLM-L6 for embeddings (primary model).
  'minilm-l6': {
    primary: 'sentence-transformers/all-MiniLM-L6-v2',
    // Pin to specific revision for reproducible builds.
    revision: '7dbbc90392e2f80f3d3c277d6e90027e55de9125',
    fallbacks: ['microsoft/all-MiniLM-L6-v2', 'optimum/all-MiniLM-L6-v2'],
    files: ['model.onnx', 'tokenizer.json'],
    task: 'feature-extraction',
  },
  // CodeT5 for code analysis (encoder only for feature extraction).
  codet5: {
    primary: 'Salesforce/codet5-base',
    revision: 'main',
    fallbacks: ['Salesforce/codet5-small'],
    files: ['model.onnx', 'tokenizer.json'],
    task: 'feature-extraction',
  },
}

/**
 * Download model from Hugging Face.
 */
async function downloadModel(modelKey) {
  if (
    !(await shouldRun(
      BUILD,
      PACKAGE_NAME,
      `downloaded-${modelKey}`,
      FORCE_BUILD,
    ))
  ) {
    return
  }

  logger.step(`Downloading ${modelKey} model`)

  const config = MODEL_SOURCES[modelKey]
  const sources = [config.primary, ...config.fallbacks]
  const revision = config.revision

  for (const source of sources) {
    try {
      logger.substep(`Trying: ${source}@${revision}`)

      await fs.mkdir(MODELS, { recursive: true })

      // Download using hf CLI (fastest) or fallback to Python.
      try {
        // Try hf CLI first.
        const hfPath = await which('hf', { nothrow: true })
        if (!hfPath) {
          throw new Error('hf not found in PATH')
        }

        const cliArgs = ['download', source]
        if (revision) {
          cliArgs.push(`--revision=${revision}`)
        }
        cliArgs.push('--local-dir', `${MODELS}/${modelKey}`)
        const cliResult = await spawn(hfPath, cliArgs, {
          shell: WIN32,
          stdio: 'inherit',
        })

        if (cliResult.code !== 0) {
          throw new Error(`hf CLI failed with exit code ${cliResult.code}`)
        }

        logger.success(`Downloaded from ${source}`)
        await createCheckpoint(BUILD, PACKAGE_NAME, `downloaded-${modelKey}`, {
          source,
          revision,
          modelKey,
        })
        return
      } catch (cliError) {
        // Fallback to Python transformers.
        logger.substep(
          `hf CLI unavailable or failed, trying Python: ${cliError.message}`,
        )
        const python3Path = await which('python3', { nothrow: true })
        if (!python3Path) {
          throw new Error('python3 not found in PATH')
        }

        const revisionParam = revision ? `, revision='${revision}'` : ''
        const pythonCommand =
          'from transformers import AutoTokenizer, AutoModel; ' +
          `tokenizer = AutoTokenizer.from_pretrained('${source}'${revisionParam}); ` +
          `model = AutoModel.from_pretrained('${source}'${revisionParam}); ` +
          `tokenizer.save_pretrained('${MODELS}/${modelKey}'); ` +
          `model.save_pretrained('${MODELS}/${modelKey}')`

        const pythonResult = await spawn(python3Path, ['-c', pythonCommand], {
          stdio: 'inherit',
        })

        if (pythonResult.code !== 0) {
          throw new Error(
            `Python download failed with exit code ${pythonResult.code}`,
          )
        }

        logger.success(`Downloaded from ${source}`)
        await createCheckpoint(BUILD, PACKAGE_NAME, `downloaded-${modelKey}`, {
          source,
          revision,
          modelKey,
        })
        return
      }
    } catch (e) {
      logger.error(`Failed: ${source} - ${e.message}`)
      // Continue to next fallback.
    }
  }

  throw new Error(`Failed to download ${modelKey} from all sources`)
}

/**
 * Convert model to ONNX if needed.
 */
async function convertToOnnx(modelKey) {
  if (
    !(await shouldRun(
      BUILD,
      PACKAGE_NAME,
      `converted-${modelKey}`,
      FORCE_BUILD,
    ))
  ) {
    return
  }

  logger.step(`Converting ${modelKey} to ONNX`)

  const config = MODEL_SOURCES[modelKey]
  const modelDir = path.join(MODELS, modelKey)

  // Check for expected ONNX files based on model type.
  const expectedFiles = config.files.filter(f => f.endsWith('.onnx'))
  const allExist = expectedFiles.every(f => existsSync(path.join(modelDir, f)))

  if (allExist) {
    logger.success('Already in ONNX format')
    await createCheckpoint(BUILD, PACKAGE_NAME, `converted-${modelKey}`, {
      modelKey,
    })
    return
  }

  // Convert using direct torch.onnx.export() to avoid Optimum/PyTorch 2.6+ incompatibility.
  try {
    const convertScript = path.join(BUILD, 'onnx_export.py')
    const scriptContent = `#!/usr/bin/env python3
"""Direct PyTorch ONNX export for transformer models."""
import sys
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModel, AutoConfig, T5EncoderModel

model_path = "${modelDir}"
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

    const convertResult = await spawn(python3Path, [convertScript], {
      shell: true,
      stdio: 'inherit',
    })

    if (convertResult.code !== 0) {
      throw new Error(`Conversion failed with exit code ${convertResult.code}`)
    }

    logger.success('Converted to ONNX')
    await createCheckpoint(BUILD, PACKAGE_NAME, `converted-${modelKey}`, {
      modelKey,
    })
  } catch (e) {
    logger.error(`Conversion failed: ${e.message}`)
    throw e
  }
}

/**
 * Apply quantization for compression.
 *
 * Supports two quantization levels:
 * - INT4: MatMulNBitsQuantizer with RTN weight-only quantization (maximum compression).
 * - INT8: Dynamic quantization (better compatibility, moderate compression).
 *
 * Results in significant size reduction with minimal accuracy loss.
 */
async function quantizeModel(modelKey, quantLevel) {
  const suffix = quantLevel.toLowerCase()
  const checkpointKey = `quantized-${modelKey}-${suffix}`

  if (!(await shouldRun(BUILD, PACKAGE_NAME, checkpointKey, FORCE_BUILD))) {
    // Return existing quantized paths.
    const modelDir = path.join(MODELS, modelKey)
    return [path.join(modelDir, `model.${suffix}.onnx`)]
  }

  logger.step(`Applying ${quantLevel} quantization to ${modelKey}`)

  const modelDir = path.join(MODELS, modelKey)

  // All models use single model.onnx file.
  const models = [{ input: 'model.onnx', output: `model.${suffix}.onnx` }]

  const quantizedPaths = []
  let method = quantLevel

  for (const { input, output } of models) {
    const onnxPath = path.join(modelDir, input)
    const quantPath = path.join(modelDir, output)

    if (!existsSync(onnxPath)) {
      logger.warn(`No ONNX model found at ${onnxPath}, skipping`)
      continue
    }

    let originalSize
    let quantSize

    try {
      const python3Path = await which('python3', { nothrow: true })
      if (!python3Path) {
        throw new Error('python3 not found in PATH')
      }

      if (quantLevel.toLowerCase() === 'int8') {
        // INT8: Use dynamic quantization (simpler, more compatible).
        const int8Command =
          'from onnxruntime.quantization import quantize_dynamic, QuantType; ' +
          `quantize_dynamic('${onnxPath}', '${quantPath}', weight_type=QuantType.QUInt8)`

        const int8Result = await spawn(python3Path, ['-c', int8Command], {
          stdio: 'inherit',
        })

        if (int8Result.code !== 0) {
          throw new Error(
            `INT8 quantization failed with exit code ${int8Result.code}`,
          )
        }
      } else {
        // INT4: Use MatMulNBitsQuantizer (maximum compression).
        const int4Command =
          'from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, RTNWeightOnlyQuantConfig; ' +
          'from onnxruntime.quantization import quant_utils; ' +
          'from pathlib import Path; ' +
          'quant_config = RTNWeightOnlyQuantConfig(); ' +
          `model = quant_utils.load_model_with_shape_infer(Path('${onnxPath}')); ` +
          'quant = MatMulNBitsQuantizer(model, algo_config=quant_config); ' +
          'quant.process(); ' +
          `quant.model.save_model_to_file('${quantPath}', True)`

        const int4Result = await spawn(python3Path, ['-c', int4Command], {
          stdio: 'inherit',
        })

        if (int4Result.code !== 0) {
          throw new Error(
            `INT4 quantization failed with exit code ${int4Result.code}`,
          )
        }
      }

      // Get sizes.
      originalSize = (await fs.readFile(onnxPath)).length
      quantSize = (await fs.readFile(quantPath)).length
      const savings = ((1 - quantSize / originalSize) * 100).toFixed(1)

      logger.substep(
        `${input}: ${(originalSize / 1024 / 1024).toFixed(2)} MB → ${(quantSize / 1024 / 1024).toFixed(2)} MB (${savings}% savings)`,
      )
    } catch (e) {
      logger.warn(
        `${quantLevel} quantization failed for ${input}, using FP32 model: ${e.message}`,
      )
      // Copy the original ONNX model as the "quantized" version.
      await fs.copyFile(onnxPath, quantPath)
      method = 'FP32'
      originalSize = (await fs.readFile(onnxPath)).length
      quantSize = originalSize
    }

    quantizedPaths.push(quantPath)
  }

  logger.success(`Quantized to ${method}`)
  await createCheckpoint(BUILD, PACKAGE_NAME, checkpointKey, {
    modelKey,
    method,
    quantLevel,
  })

  return quantizedPaths
}

/**
 * Copy quantized models and tokenizers to dist.
 * Output structure: dist/${quantLevel}/${modelKey}/model.onnx
 */
async function copyToDist(modelKey, quantizedPaths, quantLevel) {
  logger.step('Copying models to dist')

  // Create nested directory structure: dist/dev/minilm-l6/ or dist/prod/minilm-l6/
  const outputDir = path.join(DIST_MODE, modelKey)
  await fs.mkdir(outputDir, { recursive: true })

  const modelDir = path.join(MODELS, modelKey)

  // Copy quantized model
  await fs.copyFile(quantizedPaths[0], path.join(outputDir, 'model.onnx'))

  // Copy or generate tokenizer.json
  const tokenizerJsonPath = path.join(modelDir, 'tokenizer.json')
  if (existsSync(tokenizerJsonPath)) {
    await fs.copyFile(tokenizerJsonPath, path.join(outputDir, 'tokenizer.json'))
  } else {
    // Generate tokenizer.json from tokenizer files
    logger.substep('Generating tokenizer.json from tokenizer files')
    const python3Path = await which('python3', { nothrow: true })
    if (!python3Path) {
      throw new Error('python3 not found in PATH')
    }

    const generateScript = `
from transformers import AutoTokenizer
tokenizer = AutoTokenizer.from_pretrained('${modelDir}')
tokenizer.save_pretrained('${outputDir}')
`
    const result = await spawn(python3Path, ['-c', generateScript], {
      stdio: 'inherit',
    })
    if (result.code !== 0) {
      throw new Error(
        `Failed to generate tokenizer.json with exit code ${result.code}`,
      )
    }
  }

  logger.success(
    `Copied ${modelKey} model (${quantLevel}) to dist/${quantLevel}/${modelKey}/`,
  )
}

/**
 * Check and install prerequisites.
 */
async function checkPrerequisites() {
  logger.step('Checking prerequisites')

  // Ensure Python 3 is installed.
  const pythonResult = await ensureToolInstalled('python3', {
    autoInstall: true,
  })
  if (!pythonResult.available) {
    logger.error('Python 3 is required but not found')
    logger.error('Please install Python 3.6+ manually')
    process.exit(1)
  }

  if (pythonResult.installed) {
    logger.success('Installed Python 3')
  }

  // Ensure required Python packages are installed.
  logger.substep('Checking Python packages...')
  const requiredPackages = [
    'transformers',
    'torch',
    'onnx',
    { name: 'onnxruntime', importName: 'onnxruntime' },
    'onnxscript',
    { name: 'huggingface_hub', importName: 'huggingface_hub' },
    { name: 'optimum', importName: 'optimum.exporters.onnx' },
    { name: 'sentence_transformers', importName: 'sentence_transformers' },
  ]

  const packagesResult = await ensureAllPythonPackages(requiredPackages, {
    autoInstall: true,
    quiet: false,
  })

  if (!packagesResult.allAvailable) {
    logger.error('Failed to install required Python packages:')
    for (const pkg of packagesResult.missing) {
      logger.error(`  - ${pkg}`)
    }
    logger.error('')
    logger.error('Please install manually:')
    logger.error(
      '  pip3 install --user transformers torch onnx onnxruntime onnxscript huggingface_hub optimum[exporters] sentence_transformers',
    )
    process.exit(1)
  }

  if (packagesResult.installed.length > 0) {
    logger.success(
      `Installed Python packages: ${packagesResult.installed.join(', ')}`,
    )
  } else {
    logger.success('All Python packages available')
  }

  logger.log('')
}

/**
 * Main build.
 */
async function main() {
  logger.info('Building @socketsecurity/models')
  logger.info('='.repeat(60))
  logger.info(`Quantization: ${QUANT_LEVEL}`)
  logger.info('')

  const startTime = Date.now()

  // Check and install prerequisites.
  await checkPrerequisites()

  // Clean checkpoints if requested or if output is missing.
  const outputMissing =
    !existsSync(path.join(DIST_MODE, 'minilm-l6', 'model.onnx')) &&
    !existsSync(path.join(DIST_MODE, 'codet5', 'model.onnx'))

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      logger.step('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint(BUILD, PACKAGE_NAME)
  }

  // Create directories.
  await fs.mkdir(DIST, { recursive: true })
  await fs.mkdir(BUILD, { recursive: true })

  try {
    // Build MiniLM-L6 if requested.
    if (BUILD_MINILM) {
      logger.info('')
      logger.info('Building MiniLM-L6...')
      logger.info('-'.repeat(60))

      await downloadModel('minilm-l6')
      await convertToOnnx('minilm-l6')
      const quantizedPaths = await quantizeModel('minilm-l6', QUANT_LEVEL)
      await copyToDist('minilm-l6', quantizedPaths, QUANT_LEVEL)
    }

    // Build CodeT5 if requested.
    if (BUILD_CODET5) {
      logger.info('')
      logger.info('Building CodeT5...')
      logger.info('-'.repeat(60))

      await downloadModel('codet5')
      await convertToOnnx('codet5')
      const quantizedPaths = await quantizeModel('codet5', QUANT_LEVEL)
      await copyToDist('codet5', quantizedPaths, QUANT_LEVEL)
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logger.info('')
    logger.info('='.repeat(60))
    logger.success('Build complete!')
    logger.info('')
    logger.substep(`Duration: ${duration}s`)
    logger.info('')
    logger.substep(`Output: ${DIST_MODE}`)

    if (BUILD_MINILM) {
      logger.substep(`  - minilm-l6/model.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep('  - minilm-l6/tokenizer.json')
    }
    if (BUILD_CODET5) {
      logger.substep(`  - codet5/model.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep('  - codet5/tokenizer.json')
    }
  } catch (error) {
    logger.info('')
    logger.error(`Build failed: ${error.message}`)
    process.exit(1)
  }
}

main()

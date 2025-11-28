import { promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Download model from Hugging Face.
 *
 * @param {Object} options - The options object
 * @param {string} options.modelKey - The model key (e.g., 'minilm-l6', 'codet5')
 * @param {Object} options.modelSources - The model sources configuration
 * @param {string} options.buildDir - The build directory path
 * @param {string} options.packageName - The package name
 * @param {string} options.modelsDir - The models directory path
 * @param {boolean} options.forceRebuild - Whether to force rebuild
 */
export async function downloadModel(options) {
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
      `downloaded-${modelKey}`,
      forceRebuild,
    ))
  ) {
    return
  }

  logger.step(`Downloading ${modelKey} model`)

  const config = modelSources[modelKey]
  const sources = [config.primary, ...config.fallbacks]
  const revision = config.revision

  for (const source of sources) {
    try {
      logger.substep(`Trying: ${source}@${revision}`)

      await fs.mkdir(modelsDir, { recursive: true })

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
        cliArgs.push('--local-dir', `${modelsDir}/${modelKey}`)
        const cliResult = await spawn(hfPath, cliArgs, {
          shell: WIN32,
          stdio: 'inherit',
        })

        if (cliResult.code !== 0) {
          throw new Error(`hf CLI failed with exit code ${cliResult.code}`)
        }

        logger.success(`Downloaded from ${source}`)
        await createCheckpoint(
          buildDir,
          `downloaded-${modelKey}`,
          async () => {
            // Smoke test: Verify model directory and files exist
            const modelPath = path.join(modelsDir, modelKey)
            const stats = await fs.stat(modelPath)
            if (!stats.isDirectory()) {
              throw new Error(`Model path is not a directory: ${modelPath}`)
            }
            // Verify at least some files were downloaded
            const files = await fs.readdir(modelPath)
            if (files.length === 0) {
              throw new Error(`No files downloaded to: ${modelPath}`)
            }
          },
          {
            packageName,
            artifactPath: path.join(modelsDir, modelKey),
            source,
            revision,
            modelKey,
          },
        )
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
          `tokenizer.save_pretrained('${modelsDir}/${modelKey}'); ` +
          `model.save_pretrained('${modelsDir}/${modelKey}')`

        const pythonResult = await spawn(python3Path, ['-c', pythonCommand], {
          stdio: 'inherit',
        })

        if (pythonResult.code !== 0) {
          throw new Error(
            `Python download failed with exit code ${pythonResult.code}`,
          )
        }

        logger.success(`Downloaded from ${source}`)
        await createCheckpoint(
          buildDir,
          `downloaded-${modelKey}`,
          async () => {
            // Smoke test: Verify model directory and files exist
            const modelPath = path.join(modelsDir, modelKey)
            const stats = await fs.stat(modelPath)
            if (!stats.isDirectory()) {
              throw new Error(`Model path is not a directory: ${modelPath}`)
            }
            // Verify at least some files were downloaded
            const files = await fs.readdir(modelPath)
            if (files.length === 0) {
              throw new Error(`No files downloaded to: ${modelPath}`)
            }
          },
          {
            packageName,
            artifactPath: path.join(modelsDir, modelKey),
            source,
            revision,
            modelKey,
          },
        )
        return
      }
    } catch (e) {
      logger.error(`Failed: ${source} - ${e.message}`)
      // Continue to next fallback.
    }
  }

  throw new Error(`Failed to download ${modelKey} from all sources`)
}

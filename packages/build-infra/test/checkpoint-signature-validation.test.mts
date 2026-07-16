import { describe, expect, it } from 'vitest'

/**
 * @file Tests for createCheckpoint call-site signature validation.
 *   Validates that all usages in the repo follow the correct three-argument
 *   form (no positional packageName). Split from checkpoint-manager.test.mts.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  findMjsFiles,
  validateCreateCheckpointCall,
} from './checkpoint-signature-validation-helpers.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')
const logger = getDefaultLogger()

describe('createCheckpoint signature validation', () => {
  it('should validate all createCheckpoint calls use correct signature', async () => {
    const packagesDir = path.join(REPO_ROOT, 'packages')

    if (!existsSync(packagesDir)) {
      logger.log('Skipping: packages directory not found')
      return
    }

    // Find all .mts files
    const files = await findMjsFiles(packagesDir)

    // Filter to only script files (not tests)
    const scriptFiles = files.filter(
      f =>
        !f.includes('/test/') &&
        !f.includes('.test.') &&
        !f.includes('node_modules'),
    )

    logger.log(`Validating ${scriptFiles.length} script files…`)

    // Validate each file
    const allErrors = []

    for (let i = 0, { length } = scriptFiles; i < length; i += 1) {
      const file = scriptFiles[i]
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(file, 'utf8')
      const errors = validateCreateCheckpointCall(content, file)
      allErrors.push(...errors)
    }

    // Report errors
    if (allErrors.length > 0) {
      logger.error('')
      logger.fail('Found createCheckpoint signature errors:')
      logger.error('')
      for (let i = 0, { length } = allErrors; i < length; i += 1) {
        const error = allErrors[i]
        logger.error('')
        logger.fail(`${error.file}:${error.line}`)
        logger.fail(`  Error: ${error.error}`)
        logger.fail('  Context:')
        const contextLines = error.context.split('\n')
        for (
          let j = 0, { length: contextLength } = contextLines;
          j < contextLength;
          j += 1
        ) {
          const line = contextLines[j]!
          logger.fail(`    ${line}`)
        }
        logger.error('')
      }

      expect(allErrors).toHaveLength(0)
    } else {
      logger.success(`All ${scriptFiles.length} files validated successfully`)
    }
  })

  it('should verify correct signature pattern', () => {
    const correctExample = `
      await createCheckpoint(
        buildDir,
        'checkpoint-name',
        async () => {
          // smoke test
        },
        {
          packageName: 'optional',
          artifactPath: '/path/to/artifact'
        }
      )
    `

    const errors = validateCreateCheckpointCall(correctExample, 'test.mts')
    expect(errors).toStrictEqual([])
  })

  it('should detect old signature with packageName as positional param', () => {
    const wrongExample = `
      await createCheckpoint(
        buildDir,
        packageName,
        'checkpoint-name',
        async () => {
          // smoke test
        }
      )
    `

    const errors = validateCreateCheckpointCall(wrongExample, 'test.mts')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].error).toContain('old signature')
  })

  it('should detect old signature with empty string', () => {
    const wrongExample = `
      await createCheckpoint(
        buildDir,
        '',
        'checkpoint-name',
        async () => {
          // smoke test
        }
      )
    `

    const errors = validateCreateCheckpointCall(wrongExample, 'test.mts')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].error).toContain('empty string')
  })
})

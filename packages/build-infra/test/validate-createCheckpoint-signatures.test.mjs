/**
 * Comprehensive validation test for all createCheckpoint() calls across the codebase.
 *
 * This test ensures that all createCheckpoint calls use the correct signature:
 *   createCheckpoint(buildDir, checkpointName, smokeTest, options)
 *
 * And NOT the old signature:
 *   createCheckpoint(buildDir, packageName, checkpointName, smokeTest, options)
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')

/**
 * Recursively find all .mjs files in a directory
 */
async function findMjsFiles(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // Skip node_modules and test directories
    if (entry.name === 'node_modules' || entry.name.includes('.test.')) {
      continue
    }

    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      await findMjsFiles(fullPath, files)
    } else if (entry.name.endsWith('.mjs')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Check if a createCheckpoint call uses the correct signature
 */
function validateCreateCheckpointCall(fileContent, filePath) {
  const lines = fileContent.split('\n')
  const errors = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Find createCheckpoint calls
    if (
      line.includes('createCheckpoint(') &&
      (line.includes('await') || line.trim().startsWith('createCheckpoint('))
    ) {
      // Get context (next 10 lines)
      const context = lines.slice(i, Math.min(i + 10, lines.length)).join('\n')

      // Check 1: Must have async callback as third parameter
      const hasAsyncCallback =
        /async\s*\(\s*\)\s*=>/.test(context) ||
        /async\s*\(\s*\)/.test(context) ||
        /async\s*function/.test(context)

      if (!hasAsyncCallback) {
        errors.push({
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
          error: 'Missing async callback as third parameter',
          context: lines.slice(i, Math.min(i + 5, lines.length)).join('\n'),
        })
        continue
      }

      // Check 2: Second parameter should be a string literal (checkpoint name), not a variable like "packageName"
      // Get the lines that contain the parameters
      const paramLines = []
      let braceCount = 0
      let foundStart = false

      for (let j = i; j < Math.min(i + 15, lines.length); j++) {
        const paramLine = lines[j]
        if (paramLine.includes('createCheckpoint(')) {
          foundStart = true
        }
        if (foundStart) {
          paramLines.push(paramLine)
          braceCount += (paramLine.match(/\(/g) || []).length
          braceCount -= (paramLine.match(/\)/g) || []).length

          if (braceCount === 0 && foundStart) {
            break
          }
        }
      }

      const fullCall = paramLines.join('\n')

      // Pattern: createCheckpoint(buildDir, packageName, 'checkpoint-name', async () => ...)
      // This is WRONG - packageName should not be a positional parameter
      const badPattern = /createCheckpoint\([^,]+,\s*packageName\s*,/
      if (badPattern.test(fullCall)) {
        errors.push({
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
          error:
            'Using old signature with packageName as second positional parameter',
          context: fullCall.substring(0, 200),
        })
      }

      // Pattern: createCheckpoint(buildDir, '', 'checkpoint-name', ...)
      // This is WRONG - empty string should not be a positional parameter
      const emptyStringPattern = /createCheckpoint\([^,]+,\s*['"]{2}\s*,/
      if (emptyStringPattern.test(fullCall)) {
        errors.push({
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
          error:
            'Using old signature with empty string as second positional parameter',
          context: fullCall.substring(0, 200),
        })
      }
    }
  }

  return errors
}

describe('createCheckpoint signature validation', () => {
  it('should validate all createCheckpoint calls use correct signature', async () => {
    const packagesDir = path.join(REPO_ROOT, 'packages')

    if (!existsSync(packagesDir)) {
      console.log('Skipping: packages directory not found')
      return
    }

    // Find all .mjs files
    const files = await findMjsFiles(packagesDir)

    // Filter to only script files (not tests)
    const scriptFiles = files.filter(
      f =>
        !f.includes('/test/') &&
        !f.includes('.test.') &&
        !f.includes('node_modules'),
    )

    console.log(`Validating ${scriptFiles.length} script files...`)

    // Validate each file
    const allErrors = []

    for (const file of scriptFiles) {
      // eslint-disable-next-line no-await-in-loop
      const content = await readFile(file, 'utf-8')
      const errors = validateCreateCheckpointCall(content, file)
      allErrors.push(...errors)
    }

    // Report errors
    if (allErrors.length > 0) {
      console.error('\n❌ Found createCheckpoint signature errors:\n')
      for (const error of allErrors) {
        console.error(`\n${error.file}:${error.line}`)
        console.error(`  Error: ${error.error}`)
        console.error(`  Context:\n${error.context}\n`)
      }

      expect(allErrors.length).toBe(0)
    } else {
      console.log(`✓ All ${scriptFiles.length} files validated successfully`)
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

    const errors = validateCreateCheckpointCall(correctExample, 'test.mjs')
    expect(errors).toEqual([])
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

    const errors = validateCreateCheckpointCall(wrongExample, 'test.mjs')
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

    const errors = validateCreateCheckpointCall(wrongExample, 'test.mjs')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].error).toContain('empty string')
  })
})

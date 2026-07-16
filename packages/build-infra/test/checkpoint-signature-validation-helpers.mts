/**
 * @file Source scanners used by checkpoint signature validation tests.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')

export interface CreateCheckpointCallError {
  context: string
  error: string
  file: string
  line: number
}

/**
 * Recursively find all `.mts` files below a directory.
 */
export async function findMjsFiles(
  dir: string,
  files: string[] = [],
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    if (!entry) {
      continue
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.name === 'node_modules' || entry.name.includes('.test.')) {
      continue
    }
    if (entry.isDirectory()) {
      await findMjsFiles(fullPath, files)
    } else if (entry.name.endsWith('.mts')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Check whether createCheckpoint calls use the current signature.
 */
export function validateCreateCheckpointCall(
  fileContent: string,
  filePath: string,
): CreateCheckpointCallError[] {
  const lines = fileContent.split('\n')
  const errors: CreateCheckpointCallError[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined) {
      continue
    }
    if (
      line.includes('createCheckpoint(') &&
      (line.includes('await') || line.trim().startsWith('createCheckpoint('))
    ) {
      const context = lines.slice(i, Math.min(i + 10, lines.length)).join('\n')
      const hasAsyncCallback =
        /async\s*\(\s*\)\s*=>/.test(context) ||
        /async\s*\(\s*\)/.test(context) ||
        /async\s*function/.test(context)
      const identifierThirdParam =
        /createCheckpoint\(\s*[^,]+,\s*[^,]+,\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*[,)]/.test(
          context,
        )

      if (!hasAsyncCallback && !identifierThirdParam) {
        errors.push({
          context: lines.slice(i, Math.min(i + 5, lines.length)).join('\n'),
          error:
            'Third parameter must be an inline async callback or a callback ' +
            'identifier/property-access (e.g. smokeTest or ctx.smoke)',
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
        })
        continue
      }

      const paramLines: string[] = []
      let braceCount = 0
      let foundStart = false

      for (let j = i; j < Math.min(i + 15, lines.length); j += 1) {
        const paramLine = lines[j]
        if (paramLine === undefined) {
          continue
        }
        if (paramLine.includes('createCheckpoint(')) {
          foundStart = true
        }
        if (foundStart) {
          paramLines.push(paramLine)
          braceCount += (paramLine.match(/\(/g) || []).length
          braceCount -= (paramLine.match(/\)/g) || []).length
          if (braceCount === 0) {
            break
          }
        }
      }

      const fullCall = paramLines.join('\n')
      if (/createCheckpoint\([^,]+,\s*packageName\s*,/.test(fullCall)) {
        errors.push({
          context: fullCall.substring(0, 200),
          error:
            'Using old signature with packageName as second positional parameter',
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
        })
      }
      if (/createCheckpoint\([^,]+,\s*['"]{2}\s*,/.test(fullCall)) {
        errors.push({
          context: fullCall.substring(0, 200),
          error:
            'Using old signature with empty string as second positional parameter',
          file: path.relative(REPO_ROOT, filePath),
          line: i + 1,
        })
      }
    }
  }

  return errors
}

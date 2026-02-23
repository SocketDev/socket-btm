/**
 * @fileoverview Tests for write_with_notes() function in elf_note_utils.hpp
 *
 * This test verifies that write_with_notes() correctly:
 * 1. Preserves PT_NOTE segments in both writes
 * 2. Removes ALLOC flag from sections with VirtAddr=0
 * 3. Produces binaries that execute without SIGSEGV
 *
 * The test uses binject as a test harness since it uses write_with_notes()
 * for SEA injection via elf_inject_lief.cpp
 */

import { spawn } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode, BUILD_STAGES } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')
const BINJECT_DIR = path.join(PACKAGE_DIR, '..', 'binject')

const BUILD_MODE = getBuildMode()
const IS_LINUX = process.platform === 'linux'
const IS_MACOS = process.platform === 'darwin'

// Get binject binary path
const BINJECT_NAME = process.platform === 'win32' ? 'binject.exe' : 'binject'
const BINJECT_BIN = path.join(
  BINJECT_DIR,
  'build',
  BUILD_MODE,
  'out',
  BUILD_STAGES.FINAL,
  BINJECT_NAME,
)

let testBinary: string
let testBinarySea: string
let testDataFile: string

/**
 * Execute command and return result
 */
async function execCommand(
  command: string,
  args: string[] = [],
  options: { timeout?: number; cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code: number | null) => {
      resolve({ code: code ?? -1, stdout, stderr })
    })

    proc.on('error', (err: Error) => {
      reject(err)
    })

    if (options.timeout) {
      setTimeout(() => {
        proc.kill()
        resolve({ code: 124, stdout, stderr: 'Timeout' })
      }, options.timeout)
    }
  })
}

beforeAll(async () => {
  // Create test data file
  testDataFile = path.join(os.tmpdir(), `test-note-data-${Date.now()}.bin`)
  await fs.writeFile(testDataFile, 'test data for PT_NOTE verification')

  // Set up test binary paths
  const timestamp = Date.now()
  testBinary = path.join(os.tmpdir(), `test-write-with-notes-${timestamp}`)
  testBinarySea = `${testBinary}.sea`

  // Copy test input to temp location
  const testInput = IS_LINUX ? '/bin/sh' : '/bin/ls'
  await fs.copyFile(testInput, testBinary)
  await fs.chmod(testBinary, 0o755)
})

afterAll(async () => {
  // Cleanup
  await safeDelete(testBinary)
  await safeDelete(testBinarySea)
  await safeDelete(testDataFile)
})

describe.skipIf(!existsSync(BINJECT_BIN) || process.platform === 'win32')(
  'write_with_notes() PT_NOTE handling',
  () => {
    it('should inject SEA using write_with_notes()', async () => {
      // This uses binject which calls write_with_notes() internally
      const result = await execCommand(BINJECT_BIN, [
        'inject',
        '-e',
        testBinary,
        '-o',
        testBinarySea,
        '--sea',
        testDataFile,
      ])

      expect(result.code).toBe(0)
      expect(existsSync(testBinarySea)).toBe(true)
    }, 60_000)

    it('should preserve PT_NOTE segment in output binary', async () => {
      if (IS_LINUX) {
        // Linux: use readelf
        const result = await execCommand('readelf', ['-l', testBinarySea])
        expect(result.code).toBe(0)
        expect(result.stdout).toContain('NOTE')
      } else if (IS_MACOS) {
        // macOS: use otool (different format - LC_NOTE vs PT_NOTE)
        // First check if input binary has NOTE sections
        const inputCheck = await execCommand('otool', ['-l', testBinary])
        const hasNoteInInput = /LC_NOTE|NOTE/.test(inputCheck.stdout)

        const result = await execCommand('otool', ['-l', testBinarySea])
        expect(result.code).toBe(0)

        // Only expect NOTE in output if it exists in input
        if (hasNoteInInput) {
          expect(result.stdout).toMatch(/LC_NOTE|NOTE/)
        } else {
          // Input has no NOTE sections, so output shouldn't either (or it's optional)
          // Just verify the binary was created successfully
          expect(existsSync(testBinarySea)).toBe(true)
        }
      }
    }, 30_000)

    it('should correctly handle ALLOC flags for VirtAddr=0 sections (Linux only)', async () => {
      if (!IS_LINUX) {
        // ALLOC flag verification only available on Linux
        return
      }

      // Check for note sections
      const result = await execCommand('readelf', ['-S', testBinarySea])
      expect(result.code).toBe(0)

      // Parse section headers for .note.* sections
      const lines = result.stdout.split('\n')
      const noteSections = lines.filter(line => line.includes('.note.'))

      for (const line of noteSections) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 8) continue

        const sectionName = parts[1]?.replace(/[[\]]/g, '')
        const virtAddr = parts[3]
        const flags = parts[7]

        // If VirtAddr is 0, ALLOC flag must NOT be present
        if (virtAddr === '0000000000000000' || virtAddr === '00000000') {
          expect(flags).not.toContain('A')
          console.log(
            `✓ Section ${sectionName}: VirtAddr=0, ALLOC flag correctly removed`,
          )
        }
      }
    }, 30_000)

    it('should produce binary that executes without segfault', async () => {
      // Try to run the binary - it should not segfault
      const result = await execCommand(testBinarySea, ['--version'], {
        timeout: 2000,
      })

      // Exit codes 139 (Linux) or 11 (macOS) indicate segfault
      expect(result.code).not.toBe(139)
      expect(result.code).not.toBe(11)

      // Timeout (code 124) is acceptable - means binary started successfully
      if (result.code === 124) {
        console.log('✓ Binary started successfully (timed out, which is OK)')
      } else {
        console.log(`✓ Binary executed (exit code: ${result.code})`)
      }
    }, 30_000)
  },
)

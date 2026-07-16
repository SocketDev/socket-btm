import { describe, expect, it } from 'vitest'

/**
 * @file Stub runtime capability tests: argument forwarding, native addons, ICU.
 *   Split out of stub-signing-extraction.test.mts to keep each file under
 *   the 500-line soft cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { createTestDir } from '../helpers/test-dir.mts'
import { getLatestFinalBinary } from '../paths.mts'

const stubBinaryPath = getLatestFinalBinary()
const skipTests = !stubBinaryPath || !existsSync(stubBinaryPath)

describe.skipIf(skipTests)('stub runtime capabilities', () => {
  describe('argument forwarding', () => {
    it('should forward --version to extracted node', async () => {
      const result = await spawn(stubBinaryPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v2[5-9]\.\d+\.\d+/)
    })

    it('should forward --eval arguments correctly', async () => {
      const result = await spawn(
        stubBinaryPath,
        ['--eval', 'console.log("eval-success")'],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('eval-success')
    })

    it('should forward multiple arguments', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          'console.log(process.argv.slice(1).join(" "))',
          'arg1',
          'arg2',
          'arg3',
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('arg1')
      expect(result.stdout).toContain('arg2')
      expect(result.stdout).toContain('arg3')
    })
  })

  describe('native addon support (snappy)', () => {
    it('should be able to load snappy native addon', async () => {
      const { dir: addonTestDir, cleanup } = await createTestDir('snappy')
      // node-smol is built --without-amaro (no TypeScript stripping), so
      // fixtures it executes must use .mjs/.js, never .mts.
      const testScript = path.join(addonTestDir, 'test-snappy.mjs')
      await fs.writeFile(
        testScript,
        `
import { compressSync, uncompressSync } from 'snappy';

const input = Buffer.from('hello from native addon test');
const compressed = compressSync(input);
const decompressed = uncompressSync(compressed);

console.log('Snappy works:', decompressed.toString() === input.toString());
console.log('Compressed size:', compressed.length, 'vs', input.length);
`,
      )

      try {
        const result = await spawn(stubBinaryPath, [testScript], {
          cwd: addonTestDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10_000,
        })

        expect(result.code).toBe(0)
        expect(result.stdout).toContain('Snappy works: true')
      } finally {
        await cleanup()
      }
    })
  })

  describe('iCU (Internationalization) support', () => {
    it('should use small-icu configuration', async () => {
      const result = await spawn(
        stubBinaryPath,
        ['--eval', 'console.log(process.config.variables.icu_small)'],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      // small-icu should be true for production builds
      const icuSmall = result.stdout.trim()
      expect(['true', 'undefined']).toContain(icuSmall)
    })

    it('should support basic Intl operations', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          `
const date = new Date('2024-01-15');
const formatted = new Intl.DateTimeFormat('en-US').format(date);
console.log('Date formatting works:', formatted);
`,
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Date formatting works')
    })

    it('should support number formatting', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          `
const number = 1234567.89;
const formatted = new Intl.NumberFormat('en-US').format(number);
console.log('Number formatting works:', formatted);
`,
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Number formatting works')
      expect(result.stdout).toContain('1,234,567.89')
    })

    it('should handle UTF-8 strings correctly', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          `
const str = '你好世界 🌍 مرحبا Привет';
console.log('UTF-8 length:', str.length);
console.log('UTF-8 string:', str);
`,
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('UTF-8 length:')
      expect(result.stdout).toContain('你好世界')
      expect(result.stdout).toContain('🌍')
    })
  })
})

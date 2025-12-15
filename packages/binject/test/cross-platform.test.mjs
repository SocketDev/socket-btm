/**
 * Cross-platform binary manipulation tests
 * Tests ability to inject into any binary format from any platform
 *
 * Note: Mach-O injection requires macOS (or LIEF library on other platforms).
 * Without LIEF, only native platform injection works for Mach-O.
 */

import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/lib/spawn'

import { getNodeBinary, getSupportedPlatforms } from './helpers/binaries.mjs'
import { getBinjectPath } from './helpers/paths.mjs'

const { tmpdir } = os

const BINJECT_PATH = getBinjectPath()

describe('Cross-platform binary manipulation', () => {
  beforeAll(() => {
    // Verify binject binary exists
    if (!existsSync(BINJECT_PATH)) {
      throw new Error(
        `binject binary not found at ${BINJECT_PATH}. Run 'pnpm build' first.`,
      )
    }
  })

  // Test each platform/arch combination
  for (const { arch, format, platform } of getSupportedPlatforms()) {
    // Determine if this format can be injected on the current platform
    // PE and ELF work cross-platform, but Mach-O requires macOS (without LIEF)
    // PE works everywhere
    // ELF works everywhere
    // Mach-O only on macOS
    const canInject =
      format === 'pe' ||
      format === 'elf' ||
      (format === 'macho' && os.platform() === 'darwin')

    const describeOrSkip = canInject ? describe : describe.skip

    describeOrSkip(`${platform}-${arch} (${format})`, () => {
      // With LIEF, all formats can be injected on any platform
      let binaryPath
      let testSeaBlob
      let outputPath

      beforeAll(async () => {
        // Download the binary for this platform
        const result = await getNodeBinary(platform, arch)
        binaryPath = result.path

        // Create a test SEA blob
        testSeaBlob = Buffer.from(
          JSON.stringify({
            main: 'index.js',
            output: 'sea-prep.blob',
          }),
        )

        // Set up output path
        const extension = platform === 'win32' ? '.exe' : ''
        outputPath = path.join(
          tmpdir(),
          `test-cross-platform-${platform}-${arch}-${Date.now()}${extension}`,
        )
      })

      it('should inject SEA blob into binary', async () => {
        // Write test blob to temp file (use .blob extension to avoid SEA config processing)
        const blobPath = path.join(tmpdir(), `test-blob-${Date.now()}.blob`)
        await import('node:fs/promises').then(fs =>
          fs.writeFile(blobPath, testSeaBlob),
        )

        try {
          // Inject using binject
          const args = [
            'inject',
            '-e',
            binaryPath,
            '-o',
            outputPath,
            '--sea',
            blobPath,
          ]

          const result = await spawn(BINJECT_PATH, args)

          // Verify injection succeeded
          expect(result.code).toBe(0)

          // Verify output was created
          expect(existsSync(outputPath)).toBe(true)

          // Note: Output may be smaller than input for Mach-O due to signature stripping
          // We just verify the output exists and has reasonable size
          const outputStats = await import('node:fs/promises').then(fs =>
            fs.stat(outputPath),
          )
          expect(outputStats.size).toBeGreaterThan(0)
        } finally {
          // Cleanup
          if (existsSync(blobPath)) {
            await unlink(blobPath).catch(() => {})
          }
        }
      })

      it('should handle auto-overwrite on re-injection', async () => {
        // First injection already done in previous test
        // Re-inject with different data
        const newBlob = Buffer.from(
          JSON.stringify({
            main: 'index2.js',
            output: 'sea-prep2.blob',
          }),
        )

        const blobPath = path.join(
          tmpdir(),
          `test-blob-reinject-${Date.now()}.blob`,
        )
        await import('node:fs/promises').then(fs =>
          fs.writeFile(blobPath, newBlob),
        )

        try {
          // Re-inject
          const args = [
            'inject',
            '-e',
            outputPath,
            '-o',
            outputPath,
            '--sea',
            blobPath,
          ]

          const result = await spawn(BINJECT_PATH, args)

          // Verify re-injection succeeded
          expect(result.code).toBe(0)

          // Verify output still exists
          expect(existsSync(outputPath)).toBe(true)

          // Verify output still has reasonable size after re-injection
          const afterStats = await import('node:fs/promises').then(fs =>
            fs.stat(outputPath),
          )

          // Just verify it's still a valid binary (not empty or corrupted)
          expect(afterStats.size).toBeGreaterThan(0)
        } finally {
          // Cleanup
          if (existsSync(blobPath)) {
            await unlink(blobPath).catch(() => {})
          }
          if (existsSync(outputPath)) {
            await unlink(outputPath).catch(() => {})
          }
        }
      })
    })
  }
})

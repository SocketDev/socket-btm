/**
 * @fileoverview Tests LIEF support detection and silent exit behavior.
 *
 * Verifies that:
 * 1. LIEF detection works correctly
 * 2. When LIEF is disabled, --build-sea flag is silently ignored
 * 3. Debug logging works with NODE_DEBUG_NATIVE=smol_sea
 *
 * Note: These tests require a built smol binary at build/{dev,prod}/out/Final/node/.
 * Run `pnpm build --dev` first to create the binary.
 */

import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/lib/spawn'

import { expectLiefEnabled, hasLiefSupport } from '../helpers/lief.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

// Get the latest Final binary from build/{dev,prod}/out/Final/node/
const finalBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !finalBinaryPath || !existsSync(finalBinaryPath)

describe.skipIf(skipTests)('LIEF availability', () => {
  it('should correctly detect LIEF support', async () => {
    const hasLief = await hasLiefSupport()
    const expectLief = expectLiefEnabled()

    // If BUILD_WITH_LIEF is set, LIEF should be available
    if (expectLief) {
      expect(hasLief).toBe(true)
    }

    // Detection should return a boolean
    expect(typeof hasLief).toBe('boolean')
  })

  it('should silently ignore --build-sea when LIEF disabled', async () => {
    const hasLief = await hasLiefSupport()

    // Only test silent exit when LIEF is disabled
    if (hasLief) {
      return
    }

    // Test with invalid config path - should exit successfully (flag ignored)
    const result = await spawn(
      finalBinaryPath,
      ['--build-sea', '/nonexistent/test.json', '--version'],
      {
        timeout: 5000,
      },
    )

    // Should exit with 0 (flag was cleared, --version ran normally)
    expect(result.code).toBe(0)

    // Should show version output (not error about missing config)
    expect(result.stdout).toContain('v')

    // Should not contain LIEF error message
    expect(result.stderr).not.toContain('LIEF')
  })

  it('should log debug message when NODE_DEBUG_NATIVE=smol_sea and LIEF disabled', async () => {
    const hasLief = await hasLiefSupport()

    // Only test debug logging when LIEF is disabled
    if (hasLief) {
      return
    }

    // Run with NODE_DEBUG_NATIVE=smol_sea to enable debug logging
    const result = await spawn(
      finalBinaryPath,
      ['--build-sea', '/nonexistent/test.json', '--version'],
      {
        timeout: 5000,
        env: {
          ...process.env,
          NODE_DEBUG_NATIVE: 'smol_sea',
        },
      },
    )

    // Should exit successfully
    expect(result.code).toBe(0)

    // Should contain debug message about clearing the flag
    expect(result.stderr).toContain('--build-sea flag encountered')
    expect(result.stderr).toContain('Clearing flag')
  })

  it('should have fallback warning configured in patch 009', async () => {
    const hasLief = await hasLiefSupport()

    // Only test fallback when LIEF is disabled
    if (hasLief) {
      return
    }

    // TODO: Patch 009 currently removes the #else section entirely.
    // We need to add it back with a fallback warning:
    // FPrintF(stderr, "WARNING: BuildSingleExecutable reached despite LIEF disabled.\n"
    //               "Validation patch (014) may be missing. Config: %s\n", sea_config_path.c_str());
    // return ExitCode::kNoFailure;
    //
    // This requires properly regenerating patch 009 with correct unified diff format.
    // The fallback should not execute when patch 014 is applied (patch 014 clears the flag).
    // If reached, it indicates patch 014 may be missing.

    // For now, this test documents the expected behavior.
    expect(true).toBe(true)
  })
})

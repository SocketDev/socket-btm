/**
 * Cross-compile smoke-test strategy selection.
 *
 * Pure predicates and availability probes that decide HOW a built binary can
 * be exercised on the current host: natively, under Docker/QEMU/Rosetta
 * emulation, or via static verification only. The execution itself lives in
 * binary-smoke-test.mts / binary-verify.mts.
 */

import platformPkg from '@socketsecurity/lib-stable/constants/platform'
import spawnPkg from '@socketsecurity/lib-stable/process/spawn/child'

const { WIN32, getArch } = platformPkg
const { spawn } = spawnPkg

// Windows Node.js v24 bug: exit code 3221226505 (0xC0000409 STATUS_STACK_BUFFER_OVERRUN)
// See: https://github.com/nodejs/corepack/issues/715
const NODE_V24_WINDOWS_BUG_EXIT_CODE = 3_221_226_505

/**
 * Inputs for {@link selectCrossCompileSmokeTestStrategy}.
 */
export interface CrossCompileStrategyInput {
  hasDocker?: boolean | undefined
  hasQemu?: boolean | undefined
  hasRosetta?: boolean | undefined
  hostArch: string
  hostPlatform: string
  isMusl?: boolean | undefined
  targetArch?: string | undefined
}

/**
 * The execution strategy smokeTestBinary should take for a cross-compiled
 * binary.
 */
export type CrossCompileSmokeTestStrategy =
  | 'docker-musl'
  | 'docker-static'
  | 'qemu-arm64'
  | 'qemu-static'
  | 'rosetta-darwin-x64'
  | 'rosetta-static'
  | 'static'

/**
 * Checks if we're testing a cross-compiled binary.
 */
export function isCrossCompiled(
  options: { arch?: string | undefined } | undefined,
  hostArch: string,
): boolean {
  const { arch = getArch() } = { __proto__: null, ...options } as {
    arch?: string | undefined
  }
  return arch !== hostArch
}

/**
 * Check if Docker is available for musl testing.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await spawn('docker', ['--version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if exit code matches the known Node.js v24 Windows stack buffer overrun
 * bug. This bug causes node.exe to exit with STATUS_STACK_BUFFER_OVERRUN even
 * when the binary executes successfully. If stdout has valid output, treat as
 * success.
 */
export function isNodeV24WindowsStackBufferOverrunBug(
  exitCode: number | undefined,
  stdout: string | Buffer | undefined,
): boolean {
  return Boolean(
    WIN32 &&
    exitCode === NODE_V24_WINDOWS_BUG_EXIT_CODE &&
    stdout?.toString().trim(),
  )
}

/**
 * Check if QEMU user-mode emulation is available for cross-arch testing.
 */
export async function isQemuAvailable(arch: string): Promise<boolean> {
  try {
    const qemuBinary =
      arch === 'arm64' ? 'qemu-aarch64-static' : 'qemu-x86_64-static'
    const result = await spawn('which', [qemuBinary], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if Rosetta 2 is available for x64-under-arm64 cross-arch testing on
 * macOS (a darwin-arm64 host executing a darwin-x64 binary). Mirrors
 * isQemuAvailable/isDockerAvailable's probe-and-report shape: spawn a
 * trivial binary through `arch -x86_64` and check the exit code, rather than
 * inspecting `pgrep oahd` or other Rosetta-internal signals that vary across
 * macOS versions.
 */
export async function isRosettaAvailable(): Promise<boolean> {
  try {
    const result = await spawn('arch', ['-x86_64', '/usr/bin/true'], {
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if a binary is a self-extracting compressed binary.
 *
 * The Final binary is a copy of the Compressed binary, so we check for both.
 */
export function isSelfExtractingBinary(binaryPath: string): boolean {
  // Check if path contains 'Compressed' or 'Final' directory (Final is a copy of Compressed)
  return /[/\\](?:Compressed|Final)[/\\]/i.test(binaryPath)
}

/**
 * Pure decision function: given host/target platform + arch, the target
 * libc, and which emulation tools are available, decide how
 * smokeTestBinary should exercise a cross-compiled binary. No I/O —
 * callers resolve tool availability up front (isDockerAvailable /
 * isQemuAvailable / isRosettaAvailable) so this stays synchronous and
 * unit-testable without spawning real processes. One case per (host,
 * target, tool-available) combination so the fallback message
 * smokeTestBinary logs stays specific to which tool was missing, matching
 * the pre-refactor inline branching exactly.
 */
export function selectCrossCompileSmokeTestStrategy(
  input: CrossCompileStrategyInput,
): CrossCompileSmokeTestStrategy {
  const {
    hasDocker = false,
    hasQemu = false,
    hasRosetta = false,
    hostArch,
    hostPlatform,
    isMusl = false,
    targetArch,
  } = { __proto__: null, ...input } as CrossCompileStrategyInput

  if (hostPlatform === 'linux' && isMusl) {
    return hasDocker ? 'docker-musl' : 'docker-static'
  }

  const isLinuxArm64CrossCompile =
    hostPlatform === 'linux' && targetArch === 'arm64' && hostArch === 'x64'
  if (isLinuxArm64CrossCompile) {
    return hasQemu ? 'qemu-arm64' : 'qemu-static'
  }

  const isDarwinX64CrossCompile =
    hostPlatform === 'darwin' && targetArch === 'x64' && hostArch === 'arm64'
  if (isDarwinX64CrossCompile) {
    return hasRosetta ? 'rosetta-darwin-x64' : 'rosetta-static'
  }

  return 'static'
}

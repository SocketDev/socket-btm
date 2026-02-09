/**
 * Local Build Setup
 *
 * Utilities for setting up Docker-based local builds.
 * Handles Docker availability checks, QEMU emulation setup,
 * and builder image initialization.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getArch,
  getPlatform,
  WIN32,
} from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { printError, printSuccess, printInfo } from './build-output.mjs'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCKER_DIR = path.join(__dirname, '..', 'docker')

/**
 * Mapping from build target to Docker image tag.
 */
const BUILDER_IMAGE_TAGS = {
  __proto__: null,
  'linux-arm64-glibc': 'socket-btm/builder-glibc:arm64',
  'linux-arm64-musl': 'socket-btm/builder-musl:arm64',
  'linux-x64-glibc': 'socket-btm/builder-glibc:x64',
  'linux-x64-musl': 'socket-btm/builder-musl:x64',
}

/**
 * Mapping from build target to docker-compose service name.
 */
const COMPOSE_SERVICE_NAMES = {
  __proto__: null,
  'linux-arm64-glibc': 'builder-glibc-arm64',
  'linux-arm64-musl': 'builder-musl-arm64',
  'linux-x64-glibc': 'builder-glibc-x64',
  'linux-x64-musl': 'builder-musl-x64',
}

/**
 * Supported Linux build targets.
 */
export const LINUX_TARGETS = [
  'linux-x64-glibc',
  'linux-arm64-glibc',
  'linux-x64-musl',
  'linux-arm64-musl',
]

/**
 * All supported build targets.
 */
export const ALL_TARGETS = [
  ...LINUX_TARGETS,
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
  'win32-arm64',
]

/**
 * Map target to Docker image tag.
 *
 * @param {string} target - Build target (e.g., 'linux-x64-glibc')
 * @returns {string|undefined} Docker image tag or undefined if not Docker-buildable
 */
export function getBuilderImageTag(target) {
  return BUILDER_IMAGE_TAGS[target]
}

/**
 * Map target to docker-compose service name.
 *
 * @param {string} target - Build target
 * @returns {string|undefined} Service name or undefined
 */
export function getComposeServiceName(target) {
  return COMPOSE_SERVICE_NAMES[target]
}

/**
 * Check if Docker is available.
 *
 * @returns {Promise<boolean>}
 */
export async function isDockerAvailable() {
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
 * Check if Docker daemon is running.
 *
 * @returns {Promise<boolean>}
 */
export async function isDockerRunning() {
  try {
    const result = await spawn('docker', ['info'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if Docker Buildx is available.
 *
 * @returns {Promise<boolean>}
 */
export async function isBuildxAvailable() {
  try {
    const result = await spawn('docker', ['buildx', 'version'], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check if a builder image exists locally.
 *
 * @param {string} target - Build target
 * @returns {Promise<boolean>}
 */
export async function hasBuilderImage(target) {
  const imageTag = getBuilderImageTag(target)
  if (!imageTag) {
    return false
  }

  try {
    const result = await spawn('docker', ['image', 'inspect', imageTag], {
      shell: WIN32,
      stdio: 'pipe',
    })
    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Setup QEMU emulation for cross-architecture builds.
 * This allows building arm64 images on x64 hosts and vice versa.
 *
 * @returns {Promise<boolean>} True if setup succeeded
 */
export async function setupQemuEmulation() {
  printInfo('Setting up QEMU emulation for cross-architecture builds...')

  try {
    // Use tonistiigi/binfmt to install QEMU handlers
    const result = await spawn(
      'docker',
      ['run', '--privileged', '--rm', 'tonistiigi/binfmt', '--install', 'all'],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    if (result.code === 0) {
      printSuccess('QEMU emulation configured')
      return true
    }

    printError('Failed to setup QEMU emulation')
    if (result.stderr) {
      logger.fail(result.stderr.toString())
    }
    return false
  } catch (error) {
    printError(`QEMU setup error: ${error.message}`)
    return false
  }
}

/**
 * Create or ensure Docker buildx builder exists.
 *
 * @returns {Promise<boolean>}
 */
export async function ensureBuildxBuilder() {
  const builderName = 'socket-btm-builder'

  // Check if builder exists
  try {
    const inspectResult = await spawn(
      'docker',
      ['buildx', 'inspect', builderName],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    if (inspectResult.code === 0) {
      // Builder exists, use it
      await spawn('docker', ['buildx', 'use', builderName], {
        shell: WIN32,
        stdio: 'pipe',
      })
      return true
    }
  } catch {
    // Builder doesn't exist, create it
  }

  // Create new builder
  printInfo('Creating Docker buildx builder...')
  try {
    const createResult = await spawn(
      'docker',
      [
        'buildx',
        'create',
        '--name',
        builderName,
        '--driver',
        'docker-container',
        '--use',
        '--bootstrap',
      ],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    if (createResult.code === 0) {
      printSuccess('Docker buildx builder created')
      return true
    }

    printError('Failed to create buildx builder')
    return false
  } catch (error) {
    printError(`Buildx builder creation error: ${error.message}`)
    return false
  }
}

/**
 * Build a specific builder image.
 *
 * @param {string} target - Build target
 * @param {object} options - Build options
 * @param {boolean} options.force - Force rebuild even if image exists
 * @returns {Promise<boolean>}
 */
export async function buildBuilderImage(target, options = {}) {
  const { force = false } = options
  const serviceName = getComposeServiceName(target)
  const imageTag = getBuilderImageTag(target)

  if (!serviceName || !imageTag) {
    printError(`Unknown target: ${target}`)
    return false
  }

  // Check if image already exists
  if (!force && (await hasBuilderImage(target))) {
    printInfo(`Image ${imageTag} already exists (use --force to rebuild)`)
    return true
  }

  printInfo(`Building ${imageTag}...`)

  try {
    const result = await spawn(
      'docker',
      ['compose', '-f', 'docker-compose.yml', 'build', serviceName],
      {
        shell: WIN32,
        stdio: 'inherit',
        cwd: DOCKER_DIR,
      },
    )

    if (result.code === 0) {
      printSuccess(`Built ${imageTag}`)
      return true
    }

    printError(`Failed to build ${imageTag}`)
    return false
  } catch (error) {
    printError(`Build error: ${error.message}`)
    return false
  }
}

/**
 * Verify a builder image works correctly.
 *
 * @param {string} target - Build target
 * @returns {Promise<boolean>}
 */
export async function verifyBuilderImage(target) {
  const imageTag = getBuilderImageTag(target)
  if (!imageTag) {
    return false
  }

  try {
    // Run a simple test command in the container
    const result = await spawn(
      'docker',
      ['run', '--rm', imageTag, 'sh', '-c', 'node --version && pnpm --version'],
      {
        shell: WIN32,
        stdio: 'pipe',
      },
    )

    return result.code === 0
  } catch {
    return false
  }
}

/**
 * Check Docker setup requirements.
 *
 * @returns {Promise<{ok: boolean, errors: string[]}>}
 */
export async function checkDockerSetup() {
  const errors = []

  // Check Docker is installed
  if (!(await isDockerAvailable())) {
    errors.push(
      'Docker is not installed. Install Docker Desktop (macOS/Windows) or Docker Engine (Linux).',
    )
    return { ok: false, errors }
  }

  // Check Docker daemon is running
  if (!(await isDockerRunning())) {
    errors.push(
      'Docker daemon is not running. Start Docker Desktop or the docker service.',
    )
    return { ok: false, errors }
  }

  // Check buildx is available
  if (!(await isBuildxAvailable())) {
    errors.push(
      'Docker Buildx is not available. Update Docker or enable buildx plugin.',
    )
    return { ok: false, errors }
  }

  return { ok: true, errors }
}

/**
 * Setup Docker builds for specified targets.
 *
 * @param {object} options - Setup options
 * @param {string[]} options.targets - Targets to setup (defaults to all Linux targets)
 * @param {boolean} options.force - Force rebuild of images
 * @param {boolean} options.skipQemu - Skip QEMU setup
 * @returns {Promise<{ok: boolean, results: Record<string, boolean>}>}
 */
export async function setupDockerBuilds(options = {}) {
  const { force = false, skipQemu = false, targets = LINUX_TARGETS } = options

  const results = {}

  // 1. Check Docker setup
  printInfo('Checking Docker setup...')
  const { errors, ok } = await checkDockerSetup()

  if (!ok) {
    for (const error of errors) {
      printError(error)
    }
    return { ok: false, results }
  }

  printSuccess('Docker is available and running')

  // 2. Setup buildx builder
  if (!(await ensureBuildxBuilder())) {
    printError('Failed to setup buildx builder')
    return { ok: false, results }
  }

  // 3. Setup QEMU for cross-arch (unless skipped)
  const hostArch = getArch()
  const needsCrossArch = targets.some(t => {
    const targetArch = t.includes('arm64') ? 'arm64' : 'x64'
    return targetArch !== hostArch
  })

  if (needsCrossArch && !skipQemu) {
    if (!(await setupQemuEmulation())) {
      printError('QEMU setup failed - cross-architecture builds may not work')
    }
  }

  // 4. Build images for each target
  // Note: Sequential builds are intentional for clearer output and to avoid
  // overwhelming Docker daemon with parallel builds
  printInfo(`Building images for ${targets.length} targets...`)

  for (const target of targets) {
    if (!LINUX_TARGETS.includes(target)) {
      printInfo(`Skipping ${target} (not Docker-buildable)`)
      results[target] = false
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    const success = await buildBuilderImage(target, { force })
    results[target] = success

    if (success) {
      // Verify the image works
      // eslint-disable-next-line no-await-in-loop
      const verified = await verifyBuilderImage(target)
      if (!verified) {
        printError(`Image ${target} built but verification failed`)
        results[target] = false
      }
    }
  }

  // 5. Report summary
  const successful = Object.values(results).filter(Boolean).length
  const total = targets.filter(t => LINUX_TARGETS.includes(t)).length

  if (successful === total) {
    printSuccess(`All ${total} builder images ready`)
    return { ok: true, results }
  }

  printError(`${successful}/${total} builder images ready`)
  return { ok: false, results }
}

/**
 * Get current host information.
 *
 * @returns {{platform: string, arch: string, target: string|undefined}}
 */
export function getHostInfo() {
  const platform = getPlatform()
  const arch = getArch()

  // Determine the native target for this host
  let target
  if (platform === 'linux') {
    // For Linux, we'd need to detect glibc vs musl
    // Default to glibc as it's more common
    target = `linux-${arch}-glibc`
  } else if (platform === 'darwin') {
    target = `darwin-${arch}`
  } else if (platform === 'win32') {
    target = `win32-${arch}`
  }

  return { arch, platform, target }
}

/**
 * Determine build strategy for a target.
 *
 * @param {string} target - Build target
 * @returns {'native' | 'docker' | 'download'}
 */
export function getBuildStrategy(target) {
  const { arch, platform } = getHostInfo()

  // Parse target
  const [targetPlatform, targetArch] = target.split('-')

  // Native build if platform and arch match
  if (targetPlatform === platform) {
    // For Linux, allow native build on matching arch
    if (platform === 'linux' && targetArch === arch) {
      return 'native'
    }
    // For macOS/Windows, must match arch exactly
    if (platform !== 'linux' && targetArch === arch) {
      return 'native'
    }
    // Windows can cross-compile arm64 on x64
    if (platform === 'win32' && arch === 'x64' && targetArch === 'arm64') {
      return 'native'
    }
  }

  // Docker build for Linux targets (from any host)
  if (LINUX_TARGETS.includes(target)) {
    return 'docker'
  }

  // Download pre-built for everything else
  return 'download'
}

/**
 * Local Build Setup.
 *
 * Utilities for setting up Docker-based local builds.
 * Handles Docker availability checks and builder image management.
 * Orchestration (buildx, QEMU, multi-target setup) lives in
 * local-build-docker-ops.mts.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getArch,
  getPlatform,
  WIN32,
} from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DOCKER_DIR = path.join(__dirname, '..', 'docker')

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
 * Check Docker setup requirements.
 *
 * @returns {Promise<{ ok: boolean; errors: string[] }>}
 */
export async function checkDockerSetup() {
  const errors = []

  // Check Docker is installed
  if (!(await isDockerAvailable())) {
    errors.push(
      'Docker is not installed. Install Docker Desktop (macOS/Windows) or Docker Engine (Linux).',
    )
    return { errors, ok: false }
  }

  // Check Docker daemon is running
  if (!(await isDockerRunning())) {
    errors.push(
      'Docker daemon is not running. Start Docker Desktop or the docker service.',
    )
    return { errors, ok: false }
  }

  // Check buildx is available
  if (!(await isBuildxAvailable())) {
    errors.push(
      'Docker Buildx is not available. Update Docker or enable buildx plugin.',
    )
    return { errors, ok: false }
  }

  return { errors, ok: true }
}

/**
 * Determine build strategy for a target.
 *
 * @param {string} target - Build target.
 *
 * @returns {'native' | 'docker' | 'download'}
 */
export function getBuildStrategy(target) {
  const { arch, platform } = getHostInfo()

  // Parse target (expects format: platform-arch or platform-arch-libc)
  const parts = target.split('-')
  const targetPlatform = parts[0] || ''
  const targetArch = parts[1] || ''

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

/**
 * Map target to Docker image tag.
 *
 * @param {string} target - Build target (e.g., 'linux-x64-glibc')
 *
 * @returns {string | undefined} Docker image tag or undefined if not
 *   Docker-buildable.
 */
export function getBuilderImageTag(target) {
  return BUILDER_IMAGE_TAGS[target]
}

/**
 * Map target to docker-compose service name.
 *
 * @param {string} target - Build target.
 *
 * @returns {string | undefined} Service name or undefined
 */
export function getComposeServiceName(target) {
  return COMPOSE_SERVICE_NAMES[target]
}

/**
 * Get current host information.
 *
 * @returns {{ platform: string; arch: string; target: string | undefined }}
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
 * Check if a builder image exists locally.
 *
 * @param {string} target - Build target.
 *
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
 * Verify a builder image works correctly.
 *
 * @param {string} target - Build target.
 *
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

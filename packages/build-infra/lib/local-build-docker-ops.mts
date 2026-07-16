/**
 * Docker orchestration utilities for local builds.
 *
 * Higher-level Docker orchestration: buildx management, QEMU emulation,
 * image building, and multi-target setup. Lower-level availability checks
 * and image-tag mappings live in local-build-setup.mts.
 */

import { getArch, WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { printError, printInfo, printSuccess } from './build-output.mts'
import { errorMessage } from './error-utils.mts'
import {
  checkDockerSetup,
  DOCKER_DIR,
  getBuilderImageTag,
  getComposeServiceName,
  hasBuilderImage,
  LINUX_TARGETS,
  verifyBuilderImage,
} from './local-build-setup.mts'

/**
 * Build a specific builder image.
 *
 * @param {string} target - Build target.
 * @param {object} options - Build options.
 * @param {boolean} options.force - Force rebuild even if image exists.
 *
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
        cwd: DOCKER_DIR,
        shell: WIN32,
        stdio: 'inherit',
      },
    )

    if (result.code === 0) {
      printSuccess(`Built ${imageTag}`)
      return true
    }

    printError(`Failed to build ${imageTag}`)
    return false
  } catch (e) {
    printError(`Build error: ${errorMessage(e)}`)
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
  printInfo('Creating Docker buildx builder…')
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
  } catch (e) {
    printError(`Buildx builder creation error: ${errorMessage(e)}`)
    return false
  }
}

/**
 * Setup Docker builds for specified targets.
 *
 * @param {object} options - Setup options.
 * @param {string[]} options.targets - Targets to setup (defaults to all Linux
 *   targets)
 * @param {boolean} options.force - Force rebuild of images.
 * @param {boolean} options.skipQemu - Skip QEMU setup.
 *
 * @returns {Promise<{ ok: boolean; results: Record<string, boolean> }>}
 */
export async function setupDockerBuilds(options = {}) {
  const { force = false, skipQemu = false, targets = LINUX_TARGETS } = options

  const results = {}

  // 1. Check Docker setup
  printInfo('Checking Docker setup…')
  const { errors, ok } = await checkDockerSetup()

  if (!ok) {
    for (let i = 0, { length } = errors; i < length; i += 1) {
      const error = errors[i]
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
  printInfo(`Building images for ${targets.length} targets…`)

  for (let i = 0, { length } = targets; i < length; i += 1) {
    const target = targets[i]
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
 * Setup QEMU emulation for cross-architecture builds.
 * This allows building arm64 images on x64 hosts and vice versa.
 *
 * @returns {Promise<boolean>} True if setup succeeded
 */
export async function setupQemuEmulation() {
  printInfo('Setting up QEMU emulation for cross-architecture builds…')

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
      printError(result.stderr.toString?.() ?? String(result.stderr))
    }
    return false
  } catch (e) {
    printError(`QEMU setup error: ${errorMessage(e)}`)
    return false
  }
}

/**
 * Docker Builder
 *
 * Utilities for building packages inside Docker containers.
 * Handles running builds in containers, extracting artifacts,
 * and managing build workflows.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DARWIN, WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { printError, printInfo, printSuccess } from './build-output.mjs'
import {
  getBuilderImageTag,
  hasBuilderImage,
  LINUX_TARGETS,
  getBuildStrategy,
} from './local-build-setup.mjs'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..')

/**
 * Clean macOS AppleDouble resource fork files (._*) from a directory.
 * These files are created by macOS when copying to non-HFS+ filesystems
 * and cause compilation errors when mounted in Docker containers.
 *
 * @param {string} dir - Directory to clean
 * @returns {Promise<number>} Number of files removed
 */
async function cleanAppleDoubleFiles(dir) {
  if (!DARWIN) {
    return 0
  }

  // Always use find -delete for reliability
  // dot_clean -m only merges files back to parents, it doesn't remove orphan ._* files
  // that exist when copying to non-HFS+ filesystems (like Docker volumes)
  try {
    const result = await spawn(
      'find',
      [dir, '-name', '._*', '-type', 'f', '-delete', '-print'],
      {
        shell: false,
        stdio: 'pipe',
      },
    )
    const files = (result.stdout?.toString() || '').split('\n').filter(Boolean)
    return files.length
  } catch {
    return 0
  }
}

/**
 * Get Docker platform string for a target.
 *
 * @param {string} target - Build target
 * @returns {string} Docker platform string
 */
function getDockerPlatform(target) {
  if (target.includes('arm64')) {
    return 'linux/arm64'
  }
  return 'linux/amd64'
}

/**
 * Run a command inside a Docker container.
 *
 * @param {object} options - Run options
 * @param {string} options.image - Docker image to use
 * @param {string[]} options.command - Command to run
 * @param {string} options.workdir - Working directory inside container
 * @param {Record<string, string>} options.env - Environment variables
 * @param {string[]} options.volumes - Volume mounts
 * @param {string} options.platform - Docker platform (e.g., 'linux/amd64')
 * @param {boolean} options.interactive - Run interactively
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export async function runInDocker(options) {
  const {
    command,
    env = {},
    image,
    interactive = false,
    platform,
    volumes = [],
    workdir = '/workspace',
  } = options

  const args = ['run', '--rm']

  // Add platform if specified
  if (platform) {
    args.push('--platform', platform)
  }

  // Add working directory
  args.push('-w', workdir)

  // Add environment variables
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`)
  }

  // Add volume mounts
  for (const volume of volumes) {
    args.push('-v', volume)
  }

  // Interactive mode
  if (interactive) {
    args.push('-it')
  }

  // Add image and command
  args.push(image)
  args.push(...command)

  // For interactive mode, use inherit directly
  if (interactive) {
    try {
      const result = await spawn('docker', args, {
        shell: WIN32,
        stdio: 'inherit',
      })
      return {
        code: result.code ?? 0,
        stdout: '',
        stderr: '',
      }
    } catch (error) {
      return {
        code: error.code ?? 1,
        stdout: '',
        stderr: '',
      }
    }
  }

  // For non-interactive mode, stream output while capturing it
  const result = spawn('docker', args, {
    shell: WIN32,
    stdio: 'pipe',
  })

  // Stream output to console in real-time
  result.process.stdout?.on('data', data => {
    process.stdout.write(data)
  })
  result.process.stderr?.on('data', data => {
    process.stderr.write(data)
  })

  try {
    const { code, stderr, stdout } = await result
    return {
      code: code ?? 0,
      stdout: stdout?.toString() ?? '',
      stderr: stderr?.toString() ?? '',
    }
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
    }
  }
}

/**
 * Build a package for a specific target using Docker.
 *
 * @param {object} options - Build options
 * @param {string} options.packageName - Package to build (e.g., 'binpress')
 * @param {string} options.target - Build target (e.g., 'linux-x64-glibc')
 * @param {string} options.outputDir - Directory to output build artifacts
 * @param {string} options.buildMode - Build mode ('dev' or 'prod')
 * @param {boolean} options.force - Force rebuild
 * @returns {Promise<{ok: boolean, artifactPath?: string}>}
 */
export async function buildWithDocker(options) {
  const {
    buildMode = 'prod',
    force = false,
    outputDir,
    packageName,
    target,
  } = options

  // Validate target is Docker-buildable
  if (!LINUX_TARGETS.includes(target)) {
    printError(`Target ${target} is not Docker-buildable`)
    return { ok: false }
  }

  // Check image exists
  const imageTag = getBuilderImageTag(target)
  if (!(await hasBuilderImage(target))) {
    printError(
      `Builder image ${imageTag} not found. Run setup-docker-builds.mjs first.`,
    )
    return { ok: false }
  }

  const platform = getDockerPlatform(target)

  printInfo(`Building ${packageName} for ${target} using Docker...`)

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true })

  // Clean macOS AppleDouble files from the package build directory
  // These cause compilation errors in Docker (ninja tries to compile ._*.cpp files)
  const packageBuildDir = path.join(
    WORKSPACE_ROOT,
    'packages',
    packageName,
    'build',
  )
  const cleanedCount = await cleanAppleDoubleFiles(packageBuildDir)
  if (cleanedCount !== 0) {
    printInfo('Cleaned macOS AppleDouble files from build directory')
  }

  // Run build in container
  // BUILD_TOOLS_FROM_SOURCE=true prevents downloading binpress/binflate from releases,
  // requiring locally built tools. This ensures Docker local dev builds use
  // local changes to these tools rather than released versions.
  // Only set for binsuite tool packages (binpress, binflate, binject) - NOT for
  // packages like node-smol-builder that consume these tools, since they need
  // to download the Linux-native versions (host macOS builds won't work in Docker).
  const binsuiteTools = ['binpress', 'binflate', 'binject']
  const isBinsuiteTool = binsuiteTools.includes(packageName)

  const result = await runInDocker({
    image: imageTag,
    platform,
    command: [
      'sh',
      '-c',
      `cd packages/${packageName} && pnpm run build${force ? ' -- --force' : ''}`,
    ],
    workdir: '/workspace',
    env: {
      BUILD_MODE: buildMode,
      CI: 'true',
      ...(isBinsuiteTool ? { BUILD_TOOLS_FROM_SOURCE: 'true' } : {}),
    },
    volumes: [`${WORKSPACE_ROOT}:/workspace`],
  })

  if (result.code !== 0) {
    printError(`Build failed with exit code ${result.code}`)
    // Print both stdout and stderr - ninja errors appear in stdout.
    if (result.stdout) {
      logger.info(result.stdout)
    }
    if (result.stderr) {
      logger.fail(result.stderr)
    }
    // Write full output to a log file for debugging long errors
    const logPath = path.join(outputDir, 'docker-build-error.log')
    const logContent = `=== STDOUT ===\n${result.stdout}\n\n=== STDERR ===\n${result.stderr}`
    await fs.writeFile(logPath, logContent, 'utf8')
    printInfo(`Full build output written to: ${logPath}`)
    return { ok: false }
  }

  printSuccess(`Build completed for ${target}`)

  // Find artifact path
  const artifactPath = path.join(
    WORKSPACE_ROOT,
    'packages',
    packageName,
    'build',
    buildMode,
    'out',
    'Final',
    packageName,
  )

  if (existsSync(artifactPath)) {
    return { ok: true, artifactPath }
  }
  // Artifact not at expected path
  printInfo(`Note: Artifact not found at expected path: ${artifactPath}`)
  return { ok: true }
}

/**
 * Build a package using the appropriate strategy (native, docker, or download).
 *
 * @param {object} options - Build options
 * @param {string} options.packageName - Package to build
 * @param {string} options.target - Build target
 * @param {string} options.outputDir - Output directory
 * @param {string} options.buildMode - Build mode
 * @param {boolean} options.force - Force rebuild
 * @param {Function} options.nativeBuild - Function to run native build
 * @param {Function} options.download - Function to download pre-built binary
 * @returns {Promise<{ok: boolean, strategy: string, artifactPath?: string}>}
 */
export async function buildForTarget(options) {
  const {
    buildMode = 'prod',
    download,
    force = false,
    nativeBuild,
    outputDir,
    packageName,
    target,
  } = options

  const strategy = getBuildStrategy(target)

  printInfo(`Building ${packageName} for ${target} (strategy: ${strategy})`)

  switch (strategy) {
    case 'native': {
      if (!nativeBuild) {
        printError('Native build function not provided')
        return { ok: false, strategy }
      }
      const result = await nativeBuild({
        packageName,
        target,
        outputDir,
        buildMode,
        force,
      })
      return { ...result, strategy }
    }

    case 'docker': {
      const result = await buildWithDocker({
        packageName,
        target,
        outputDir,
        buildMode,
        force,
      })
      return { ...result, strategy }
    }

    case 'download': {
      if (!download) {
        printError('Download function not provided')
        return { ok: false, strategy }
      }
      const result = await download({ packageName, target, outputDir })
      return { ...result, strategy }
    }

    default:
      printError(`Unknown build strategy: ${strategy}`)
      return { ok: false, strategy }
  }
}

/**
 * Test a binary built for a specific target.
 *
 * @param {string} binaryPath - Path to binary
 * @param {string} target - Build target
 * @returns {Promise<boolean>}
 */
export async function testBinaryForTarget(binaryPath, target) {
  // For native arch, run directly
  const strategy = getBuildStrategy(target)

  if (strategy === 'native') {
    // Direct execution test
    try {
      const result = await spawn(binaryPath, ['--version'], {
        shell: WIN32,
        stdio: 'pipe',
      })
      return result.code === 0
    } catch {
      return false
    }
  } else if (strategy === 'docker') {
    // Test in Docker container
    const imageTag = getBuilderImageTag(target)
    if (!imageTag) {
      return false
    }

    const platform = getDockerPlatform(target)
    const binaryName = path.basename(binaryPath)

    const result = await runInDocker({
      image: imageTag,
      platform,
      command: [`./${binaryName}`, '--version'],
      workdir: '/test',
      volumes: [`${path.dirname(binaryPath)}:/test:ro`],
    })

    return result.code === 0
  }

  // For download strategy, we can't easily test
  // Return true and rely on checksum verification
  return true
}

/**
 * Get all available targets for a package.
 *
 * @returns {string[]} Array of target names
 */
export function getAllTargets() {
  return [
    'linux-x64-glibc',
    'linux-arm64-glibc',
    'linux-x64-musl',
    'linux-arm64-musl',
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
    'win32-arm64',
  ]
}

/**
 * Get targets that can be built on the current host.
 *
 * @returns {string[]} Array of buildable target names
 */
export function getBuildableTargets() {
  return getAllTargets().filter(target => {
    const strategy = getBuildStrategy(target)
    return strategy === 'native' || strategy === 'docker'
  })
}

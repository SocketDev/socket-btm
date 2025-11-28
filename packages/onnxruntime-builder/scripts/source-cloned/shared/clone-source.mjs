/**
 * Source cloning phase for ONNX Runtime
 *
 * Clones ONNX Runtime source from Git repository with SHA verification and applies patches.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeReadFile } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Clone ONNX Runtime source code with patches.
 *
 * @param {object} options - Clone options
 * @param {string} options.onnxVersion - ONNX version to clone (e.g., 'v1.19.0')
 * @param {string} options.onnxSha - Expected commit SHA
 * @param {string} options.onnxRepo - Git repository URL
 * @param {string} options.eigenCommit - Eigen commit hash
 * @param {string} options.eigenSha1 - Eigen SHA1 hash
 * @param {string} options.sharedBuildDir - Shared build directory
 * @param {string} options.sharedSourceDir - Target source directory
 * @param {string} options.sharedCmakeDepsFile - CMake deps.txt file path
 * @param {string} options.sharedCmakeWebassemblyFile - CMake webassembly file path
 * @param {string} options.sharedPostBuildSourceFile - Post-build script file path
 * @param {string} options.sharedCmakeListsFile - CMakeLists.txt file path
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function cloneOnnxSource(options) {
  const {
    eigenCommit,
    eigenSha1,
    forceRebuild,
    onnxRepo,
    onnxSha,
    onnxVersion,
    sharedBuildDir,
    sharedCmakeDepsFile,
    sharedCmakeListsFile,
    sharedCmakeWebassemblyFile,
    sharedPostBuildSourceFile,
    sharedSourceDir,
  } = options

  if (!(await shouldRun(sharedBuildDir, '', 'source-cloned', forceRebuild))) {
    return
  }

  logger.step('Cloning ONNX Runtime Source')

  // Check if source exists and if it has the patches.
  if (existsSync(sharedSourceDir)) {
    logger.substep('ONNX Runtime source already exists')

    // Define patches to verify.
    const patches = [
      {
        name: 'Eigen SHA1 hash',
        path: sharedCmakeDepsFile,
        marker: eigenSha1,
      },
      {
        name: 'MLFloat16 build',
        path: sharedCmakeWebassemblyFile,
        marker: '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME',
      },
      {
        name: 'wasm_post_build.js',
        path: sharedPostBuildSourceFile,
        marker: 'if (matches.length === 0) {',
      },
    ]

    // Check if all patches have been applied.
    const results = await Promise.allSettled(
      patches.map(async ({ marker, path: filePath }) => {
        const content = await safeReadFile(filePath, 'utf-8')
        return content?.includes(marker) ?? false
      }),
    )
    const allPatchesApplied = results.every(
      r => r.status === 'fulfilled' && r.value === true,
    )

    if (!allPatchesApplied) {
      // Source exists but patches not applied - need to re-clone.
      logger.warn('Source exists but patches not applied')
      logger.substep('Removing old source to re-clone with patches...')
      await safeDelete(sharedSourceDir)
      logger.success('Old source removed')
    } else {
      logger.substep('All patches already applied, skipping clone')
      await createCheckpoint(
        sharedBuildDir,
        'source-cloned',
        async () => {
          // Smoke test: Verify source directory exists with CMakeLists.txt
          const cmakeLists = path.join(
            sharedSourceDir,
            'cmake',
            'CMakeLists.txt',
          )
          await fs.access(cmakeLists)
          logger.substep('Source directory validated')
        },
        {
          onnxVersion,
          onnxSha,
          artifactPath: sharedSourceDir,
        },
      )
      return
    }
  }

  await fs.mkdir(sharedBuildDir, { recursive: true })

  logger.substep(
    `Cloning ONNX Runtime ${onnxVersion} (${onnxSha.slice(0, 8)})...`,
  )

  // Clone using commit SHA for immutability.
  // We use the version tag with --branch for efficiency (works with --depth 1).
  const cloneResult = await spawn(
    'git',
    [
      '-c',
      'http.postBuffer=524288000',
      '-c',
      'http.version=HTTP/1.1',
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      onnxVersion,
      onnxRepo,
      sharedSourceDir,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (cloneResult.code !== 0) {
    throw new Error('Failed to clone ONNX Runtime repository')
  }

  // Verify the cloned commit matches the expected SHA.
  const verifyResult = await spawn(
    'git',
    ['-C', sharedSourceDir, 'rev-parse', 'HEAD'],
    {
      shell: WIN32,
    },
  )

  if (verifyResult.code !== 0) {
    throw new Error('Failed to verify cloned commit SHA')
  }

  const clonedSha = verifyResult.stdout.toString().trim()
  if (clonedSha !== onnxSha) {
    throw new Error(
      `SHA mismatch: expected ${onnxSha}, got ${clonedSha}. ` +
        `The tag ${onnxVersion} may have been updated. Please update sources.onnxruntime.ref in package.json.`,
    )
  }

  logger.success(
    `ONNX Runtime ${onnxVersion} cloned and verified (${onnxSha.slice(0, 8)})`,
  )

  // Patch 1: Update Eigen SHA1 hash (see docs/patches.md).
  // GitLab regenerated archives, causing SHA1 mismatch for Eigen v3.4.0.
  // We maintain the correct SHA1 hash in package.json sources.eigen.sha1.
  logger.substep(
    `Patching deps.txt to use Eigen ${eigenCommit.slice(0, 8)} with SHA1 ${eigenSha1.slice(0, 8)}...`,
  )
  const depsPath = sharedCmakeDepsFile
  let depsContent = await fs.readFile(depsPath, 'utf-8')

  // Log the current Eigen line for debugging
  const eigenLineMatch = depsContent.match(/eigen;[^\n]+/)
  logger.substep(
    `Current Eigen line: ${eigenLineMatch ? eigenLineMatch[0] : 'NOT FOUND'}`,
  )

  // Update SHA1 hash for Eigen (actual format: eigen;<URL>;<SHA1>)
  // The commit hash is embedded in the URL, not as a separate field
  // Pattern: eigen;<URL with commit in it>;<old SHA1> → eigen;<same URL>;<new SHA1>
  const eigenPattern = new RegExp(
    `eigen;([^;]+${eigenCommit}[^;]*);[a-f0-9]{40}`,
    'g',
  )
  depsContent = depsContent.replace(eigenPattern, `eigen;$1;${eigenSha1}`)

  // Verify the replacement worked by checking both patterns
  if (!depsContent.includes(eigenSha1)) {
    logger.warn('Primary pattern failed, trying direct replacement')
    // Direct replacement as fallback
    depsContent = depsContent.replace(
      /eigen;(https:\/\/gitlab\.com\/libeigen\/eigen\/-\/archive\/e7248b26a1ed53fa030c5c459f7ea095dfd276ac\/[^;]+);[a-f0-9]{40}/g,
      `eigen;$1;${eigenSha1}`,
    )
  }

  await fs.writeFile(depsPath, depsContent, 'utf-8')

  // Verify the patch was applied
  const verifyContent = await fs.readFile(depsPath, 'utf-8')
  if (!verifyContent.includes(eigenSha1)) {
    throw new Error(
      `Failed to patch Eigen SHA1 hash. Expected ${eigenSha1} in deps.txt`,
    )
  }

  logger.success('Eigen SHA1 hash updated in deps.txt')

  // Patch 2: Fix MLFloat16 build (see docs/patches.md).
  logger.substep(
    'Patching onnxruntime_webassembly.cmake to fix MLFloat16 build...',
  )
  const cmakePath = path.join(
    sharedSourceDir,
    'cmake',
    'onnxruntime_webassembly.cmake',
  )
  let cmakeContent = await fs.readFile(cmakePath, 'utf-8')
  cmakeContent = cmakeContent.replace(
    /add_compile_definitions\(\s*BUILD_MLAS_NO_ONNXRUNTIME\s*\)/,
    '# add_compile_definitions(\n  #   BUILD_MLAS_NO_ONNXRUNTIME\n  # )',
  )
  await fs.writeFile(cmakePath, cmakeContent, 'utf-8')
  logger.success('BUILD_MLAS_NO_ONNXRUNTIME commented out')

  // Patch 3: Modern Emscripten compatibility (see docs/patches.md).
  //
  // PROBLEM: ONNX Runtime's wasm_post_build.js expects specific Worker URL pattern
  // from older Emscripten versions. Modern Emscripten (3.1.50+) doesn't generate
  // this pattern, causing build to fail with "Unexpected number of matches" error.
  //
  // SOLUTION: Patch the script to handle modern Emscripten gracefully:
  // 1. Allow zero matches (modern Emscripten generates correct code already)
  // 2. Improve error message to show actual match count
  //
  // CACHE HANDLING: CMake copies wasm_post_build.js from source to build directory
  // during configuration. GitHub Actions may restore cached builds with old unpatched
  // copies, so we must:
  // 1. Patch source file (single source of truth)
  // 2. Delete cached build copy if present (forces CMake recopy from patched source)
  // 3. Clear CMake cache (ensures full reconfiguration)
  logger.substep('Patching wasm_post_build.js to handle modern Emscripten...')
  const postBuildSourcePath = path.join(
    sharedSourceDir,
    'js',
    'web',
    'script',
    'wasm_post_build.js',
  )
  if (existsSync(postBuildSourcePath)) {
    let postBuildContent = await fs.readFile(postBuildSourcePath, 'utf-8')

    // Patch 1: Allow zero matches (modern Emscripten case).
    // Insert early return when no Worker URL pattern found.
    postBuildContent = postBuildContent.replace(
      /if \(matches\.length !== 1\) \{/,
      `if (matches.length === 0) {\n      console.log('No Worker URL pattern found - skipping post-build transformation (modern Emscripten)');\n      return;\n    }\n    if (matches.length !== 1) {`,
    )

    // Patch 2: Improve error message to show actual match count.
    // Helps debug if we get unexpected pattern variations.
    postBuildContent = postBuildContent.replace(
      /Unexpected number of matches for "" in "": \./,
      'Unexpected number of Worker URL matches: found $' +
        '{matches.length}, expected 1. Pattern: $' +
        '{regex}',
    )

    await fs.writeFile(postBuildSourcePath, postBuildContent, 'utf-8')
    logger.success('wasm_post_build.js (source) patched')
  }

  await createCheckpoint(
    sharedBuildDir,
    'source-cloned',
    async () => {
      // Smoke test: Verify source directory exists with CMakeLists.txt
      const cmakeLists = sharedCmakeListsFile
      await fs.access(cmakeLists)
      logger.substep('Source directory validated')
    },
    {
      onnxVersion,
      onnxSha,
      artifactPath: sharedSourceDir,
    },
  )
}

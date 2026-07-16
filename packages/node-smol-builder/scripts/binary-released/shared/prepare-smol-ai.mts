import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { exec } from 'build-infra/lib/build-helpers'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mts'
import { LANGUAGE_MODEL_INFRA_DIR } from '../../paths.mts'

const logger = getDefaultLogger()

export async function copySmolAiArtifacts(
  buildMode: string,
  platformArch: string,
): Promise<void> {
  logger.step('Building pinned llama.cpp → deps/smol-ai/')
  const buildDir = path.join(
    LANGUAGE_MODEL_INFRA_DIR,
    'build',
    'node-smol',
    buildMode,
    platformArch,
  )
  await fs.mkdir(buildDir, { recursive: true })
  await exec(
    'cmake',
    [
      '-S',
      LANGUAGE_MODEL_INFRA_DIR,
      '-B',
      buildDir,
      '-G',
      'Ninja',
      `-DCMAKE_BUILD_TYPE=${buildMode === 'prod' ? 'Release' : 'Debug'}`,
      '-DSMOL_AI_BUILD_NAPI=OFF',
    ],
    { cwd: LANGUAGE_MODEL_INFRA_DIR },
  )
  await exec(
    'cmake',
    ['--build', buildDir, '--target', 'smol_ai_core', '--parallel'],
    { cwd: LANGUAGE_MODEL_INFRA_DIR },
  )

  const libraries =
    process.platform === 'win32'
      ? [
          ['smol_ai_core.lib'],
          ['llama', 'src', 'llama.lib'],
          ['llama', 'ggml', 'src', 'ggml.lib'],
          ['llama', 'ggml', 'src', 'ggml-cpu.lib'],
          ['llama', 'ggml', 'src', 'ggml-base.lib'],
        ]
      : [
          ['libsmol_ai_core.a'],
          ['llama', 'src', 'libllama.a'],
          ['llama', 'ggml', 'src', 'libggml.a'],
          ['llama', 'ggml', 'src', 'libggml-cpu.a'],
          ['llama', 'ggml', 'src', 'libggml-base.a'],
        ]
  const depsDir = path.join(
    ADDITIONS_SOURCE_PATCHED_DIR,
    'deps',
    'smol-ai',
    'lib',
  )
  await safeDelete(depsDir)
  await fs.mkdir(depsDir, { recursive: true })
  for (let i = 0, { length } = libraries; i < length; i += 1) {
    const segments = libraries[i]!
    const source = path.join(buildDir, ...segments)
    if (!existsSync(source)) {
      throw new Error(`Pinned llama.cpp build output is missing: ${source}`)
    }
    await fs.copyFile(source, path.join(depsDir, segments.at(-1)!))
  }
  logger.substep(`staged pinned llama.cpp libraries → ${depsDir}`)
}

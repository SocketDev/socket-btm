import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
)
export const repoRoot = path.dirname(path.dirname(packageRoot))
export const languageModelInfraRoot = path.join(
  repoRoot,
  'packages',
  'ai-infra',
)

export function getBuildDir(mode: string, target: string): string {
  return path.join(packageRoot, 'build', mode, target)
}

export function getBinaryPath(mode: string, target: string): string {
  return path.join(getBuildDir(mode, target), 'smol_ai.node')
}
